/* ═══════════════════════════════════════════════════════════════════
   POST /api/grade-run   { submission_id, stage }   (admin 전용)
     stage='transcribe' → 답안지 사진을 텍스트+LaTeX 로 전사, submissions.ocr_text 캐시
     stage='grade'      → 전사문 + 문항 정보로 감점 태그·피드백(·점수) 제안
     →  { run }  (grading_runs 행)

   중요: 여기서 나온 점수는 **제안일 뿐** scores 에 들어가지 않는다.
        강사가 /api/grade-review 로 확정해야 반영된다.

   실행 시간
     Vercel 함수 제한(플랜에 따라 10초/60초) 안에서 동기 처리한다.
     장당 1회 호출이라 보통 통과하지만, 초과하면 status='failed' 로 남기고
     클라이언트가 재시도하도록 안내한다(부분 성공 상태를 남기지 않는다).
   ═══════════════════════════════════════════════════════════════════ */
"use strict";
const L = require("./_lib.js");
const G = require("./_gemini.js");

// js/config.js 의 WRONG_REASONS 와 반드시 같아야 한다(enum 으로 모델을 묶는다).
const WRONG_REASONS = ['조건 해석', '계산 실수', '개념 누락', '풀이 근거 누락', '시간 부족'];
const MAX_IMAGES = 4;

async function insertRun(row){
  const out = await L.sbRest("grading_runs", {
    method: "POST", body: row, headers: { Prefer: "return=representation" },
  });
  return Array.isArray(out) && out.length ? out[0] : null;
}
async function patchRun(id, patch){
  const out = await L.sbRest("grading_runs?id=eq." + L.eqParam(id), {
    method: "PATCH", body: patch, headers: { Prefer: "return=representation" },
  });
  return Array.isArray(out) && out.length ? out[0] : null;
}

/* 같은 단원에서 강사가 이미 확정한 사례를 few-shot 으로 준다.
   모델이 우리 학원 채점 습관에 맞춰지도록 하는 것이 목적이다.

   note_source 필터가 있는 이유
     예시를 "강사메모"라는 이름표로 넣기 때문에, AI 가 쓴 문장이 여기 섞이면
     모델이 자기 출력을 학습하고 일치율이 자기충족적으로 오른다(0017 참고).
     null 은 **버리지 않고 포함한다** — 0017 이전 행은 출처를 구분할 수 없고
     그 대부분은 정상적인 강사 메모다. 전부 버리면 few-shot 이 통째로 비어
     품질이 오히려 떨어진다. 확실히 AI 유래인 것(ai_applied)만 제외한다.
     `not.eq` 는 SQL 3값 논리 때문에 null 까지 함께 떨어뜨리므로 or 로 쓴다. */
async function fewShotExamples(unit, cognition){
  try{
    const rows = await L.sbRest(
      "scores?select=wrong_reason,reason_note,earned,question_id!inner(unit,cognition,points)" +
      "&question_id.unit=eq." + L.eqParam(unit || "") +
      "&wrong_reason=not.is.null&reason_note=not.is.null" +
      "&or=(note_source.is.null,note_source.eq.teacher)" +
      "&limit=10&order=id.desc"
    );
    if(!Array.isArray(rows) || !rows.length) return "";
    return rows.slice(0, 10).map((r, i) =>
      `${i + 1}) 감점태그: ${r.wrong_reason} / 강사메모: ${String(r.reason_note).slice(0, 120)}`
    ).join("\n");
  }catch(e){
    // few-shot 은 품질 향상용이라 실패해도 채점은 계속한다.
    console.error("[grade-run] few-shot 조회 실패(무시):", e && e.message);
    return "";
  }
}

async function loadSubmission(id){
  const rows = await L.sbRest(
    "submissions?id=eq." + L.eqParam(id) +
    "&select=id,student_id,question_id,input_type,image_paths,answer_text,ocr_text&limit=1");
  const s = Array.isArray(rows) && rows.length ? rows[0] : null;
  if(!s) throw L.fail(404, "제출물을 찾을 수 없습니다.");
  return s;
}

async function loadQuestionContext(questionId){
  const rows = await L.sbRest(
    "questions?id=eq." + L.eqParam(questionId) +
    "&select=id,no,unit,cognition,points,source,problem_id,deduction_items,rubric&limit=1");
  const q = Array.isArray(rows) && rows.length ? rows[0] : null;
  if(!q) return null;
  if(q.problem_id){
    const pr = await L.sbRest(
      "problems?id=eq." + L.eqParam(q.problem_id) +
      "&select=body_latex,answer_latex,solution_latex,rubric,points&limit=1");
    q.problem = Array.isArray(pr) && pr.length ? pr[0] : null;
  }
  return q;
}

/* ── stage: transcribe ── */
async function runTranscribe(sub){
  const paths = (sub.image_paths || []).slice(0, MAX_IMAGES);
  if(!paths.length && !sub.answer_text) throw L.fail(400, "전사할 답안 이미지가 없습니다.");

  // 직접 입력한 답안은 전사할 것이 없다 — 그대로 캐시한다.
  if(!paths.length){
    await L.sbRest("submissions?id=eq." + L.eqParam(sub.id), {
      method: "PATCH", body: { ocr_text: sub.answer_text }, headers: { Prefer: "return=minimal" },
    });
    return { skipped: true, transcript: sub.answer_text };
  }

  const parts = [];
  for(const p of paths){
    const f = await L.storageDownload("answer-sheets", p);
    parts.push({ inlineData: { mimeType: f.mime, data: f.buffer.toString("base64") } });
  }
  // 정답을 주지 않는다. 정답을 알려주면 모델이 "있어야 할 풀이"를 지어내 옮겨 적는다.
  parts.push({ text:
    "이 이미지는 학생이 손으로 쓴 수학 답안이다.\n" +
    "적혀 있는 내용을 **그대로** 옮겨 적어라. 다음을 반드시 지켜라.\n" +
    "1. 학생이 쓰지 않은 풀이 단계를 만들어 넣지 마라.\n" +
    "2. 틀린 식이어도 고치지 말고 쓰인 그대로 옮겨라.\n" +
    "3. 수식은 LaTeX 로 표기하라.\n" +
    "4. 글자를 알아볼 수 없으면 추측하지 말고 unreadable_spans 에 위치를 적어라.\n" +
    "5. legibility 는 전체를 얼마나 확신 있게 판독했는지 0~1 로 적어라." });

  const r = await G.callGemini(parts, { schema: G.TRANSCRIBE_SCHEMA, maxOutputTokens: 4096 });
  if(!r.ok) return r;

  await L.sbRest("submissions?id=eq." + L.eqParam(sub.id), {
    method: "PATCH", body: { ocr_text: (r.json && r.json.transcript) || null },
    headers: { Prefer: "return=minimal" },
  });
  return r;
}

/* ── stage: grade ── */
async function runGrade(sub){
  const source = sub.ocr_text || sub.answer_text;
  if(!source) throw L.fail(400, "먼저 전사를 실행하세요(답안 텍스트가 없습니다).");

  const q = await loadQuestionContext(sub.question_id);
  const withScore = G.gradingMode() === "full";
  const pr = q && q.problem;

  const lines = [];
  lines.push("너는 수학 약술형 논술 답안을 채점하는 보조 역할이다.");
  lines.push("아래 학생 답안을 읽고 감점 사유를 판단하라.");
  if(q){
    lines.push("");
    lines.push("[문항 정보]");
    lines.push("단원: " + (q.unit || "-") + " / 사고과정: " + (q.cognition || "-"));
    lines.push("배점: " + (q.points == null ? "-" : q.points));
    if(q.source) lines.push("출처: " + q.source);
  }
  if(pr){
    if(pr.body_latex) lines.push("문제: " + pr.body_latex);
    if(pr.answer_latex) lines.push("정답: " + pr.answer_latex);
    if(pr.solution_latex) lines.push("모범 풀이: " + pr.solution_latex);
  }
  if(q && Array.isArray(q.rubric) && q.rubric.length){
    lines.push("채점 기준:");
    q.rubric.forEach(r => lines.push(" - " + r.criterion + " (" + r.points + "점)" + (r.tag ? " [" + r.tag + "]" : "")));
  }else if(pr && Array.isArray(pr.rubric) && pr.rubric.length){
    lines.push("채점 기준:");
    pr.rubric.forEach(r => lines.push(" - " + r.criterion + " (" + r.points + "점)" + (r.tag ? " [" + r.tag + "]" : "")));
  }else if(q && Array.isArray(q.deduction_items) && q.deduction_items.length){
    lines.push("감점 항목:");
    q.deduction_items.forEach(d => lines.push(" - " + d.label + " (-" + d.points + ")" + (d.tag ? " [" + d.tag + "]" : "")));
  }

  const shots = await fewShotExamples(q && q.unit, q && q.cognition);
  if(shots){
    lines.push("");
    lines.push("[이 단원에서 강사가 실제로 확정한 채점 사례]");
    lines.push(shots);
    lines.push("위 사례의 판단 기준을 따르라.");
  }

  lines.push("");
  lines.push("[학생 답안]");
  lines.push(source);
  lines.push("");
  lines.push("감점 태그는 반드시 주어진 목록에서만 고르고, 해당 없으면 빈 배열로 두어라.");
  lines.push("근거(evidence)에는 답안의 어느 부분 때문에 그렇게 판단했는지 적어라.");
  if(withScore){
    lines.push("채점 기준별로 득점을 분해하고 총점을 제안하라. 배점을 넘거나 음수가 되면 안 된다.");
  }else{
    // tags_only 모드: 점수를 아예 요청하지 않는다(스키마에도 없다).
    lines.push("점수는 매기지 마라. 감점 사유와 피드백만 판단하라.");
  }

  const schema = G.buildGradeSchema(WRONG_REASONS, withScore);
  return await G.callGemini([{ text: lines.join("\n") }], { schema: schema, maxOutputTokens: 2048 });
}

module.exports = async function handler(req, res){
  try{
    if(req.method !== "POST"){
      res.setHeader("Allow", "POST");
      return L.sendJson(res, 405, { error: "POST 요청만 허용됩니다." });
    }
    L.requireAdmin(req);

    const body = await L.readJsonBody(req);
    const stage = body && body.stage;
    if(stage !== "transcribe" && stage !== "grade") throw L.fail(400, "stage 는 transcribe 또는 grade 여야 합니다.");
    if(!body || !body.submission_id) throw L.fail(400, "submission_id 가 필요합니다.");

    if(!G.hasKey()){
      return L.sendJson(res, 503, { error: "AI 기능 미설정", aiUnconfigured: true });
    }

    const sub = await loadSubmission(body.submission_id);

    // 실행 기록을 먼저 남긴다 — 도중에 죽어도 흔적이 남아야 재시도 판단이 된다.
    let run = await insertRun({
      submission_id: sub.id, stage: stage, model: G.model(),
      prompt_version: G.PROMPT_VERSION, status: "running",
    });

    let r;
    try{
      r = stage === "transcribe" ? await runTranscribe(sub) : await runGrade(sub);
    }catch(e){
      if(run) await patchRun(run.id, { status: "failed", error_text: String((e && e.publicMessage) || (e && e.message) || "오류").slice(0, 500) });
      throw e;
    }

    if(r && r.skipped){
      run = await patchRun(run.id, { status: "done", feedback_text: "직접 입력 답안이라 전사를 건너뛰었습니다.", tokens_in: 0, tokens_out: 0, cost_usd: 0 });
      return L.sendJson(res, 200, { run: run });
    }

    if(!r.ok){
      run = await patchRun(run.id, {
        status: "failed",
        error_text: "AI 응답 사용 불가: " + r.blocked,
        tokens_in: r.tokensIn, tokens_out: r.tokensOut, cost_usd: r.costUsd,
        raw_response: r.raw || null,
      });
      return L.sendJson(res, 200, { run: run, blocked: r.blocked });
    }

    const j = r.json || {};
    const patch = {
      status: "done",
      tokens_in: r.tokensIn, tokens_out: r.tokensOut, cost_usd: r.costUsd,
      raw_response: r.raw || null,
      confidence: j.confidence != null ? j.confidence : (j.legibility != null ? j.legibility : null),
    };
    if(stage === "transcribe"){
      patch.feedback_text = j.transcript || null;
      patch.rubric_breakdown = { latex_blocks: j.latex_blocks || [], unreadable_spans: j.unreadable_spans || [] };
    }else{
      patch.wrong_reason_tags = j.wrong_reason_tags || [];
      patch.feedback_text = j.feedback_text || null;
      patch.rubric_breakdown = { breakdown: j.rubric_breakdown || null, evidence: j.evidence || null };
      // tags_only 모드에서는 점수를 저장하지 않는다(모델이 줘도 무시).
      patch.suggested_score = (G.gradingMode() === "full" && j.suggested_score != null) ? j.suggested_score : null;
    }
    run = await patchRun(run.id, patch);
    return L.sendJson(res, 200, { run: run, mode: G.gradingMode() });
  }catch(e){
    return L.sendError(res, e, "AI 분석 중 오류가 발생했습니다.");
  }
};
