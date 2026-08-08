/* ═══════════════════════════════════════════════════════════════════
   POST /api/counsel-draft   { note_id }   (admin 전용)
     →  { ok, draft, ai_status:'drafted', tokens_in, tokens_out, cost_usd }
        검사기 거부 시  { ok:false, reason:'rejected', issues:[...] }  ← ai_draft 저장 안 함
        차단           { ok:false, ai_status:'blocked', blocked }
        빈 응답        { ok:false, ai_status:'failed', reason:'empty' }

   전사문(counsel-transcribe 가 만든 transcript)을 읽어 **구조화 초안**을 만든다.
   요약·유형 제안·주요 논점·후속 조치 후보·학생 공개용 문장 다섯 가지다.

   확정 필드는 건드리지 않는다
     결과는 ai_draft(jsonb)에만 쓴다. content·follow_up·category 는 강사가 화면에서
     [초안 가져오기] 로 폼에 채우고 고친 뒤 [저장] 을 눌러야 바뀐다(설계서 0절 원칙 1).
     이 파일에는 확정 필드로 가는 경로 자체가 없다.

   전사와 정돈을 나눠 두는 이유
     정돈이 실패해도 전사문은 남아야 한다(설계서 0절 원칙 2). 그래서 별도 엔드포인트고,
     차단·실패·검사기 거부 어느 쪽도 예외로 던지지 않고 상태와 사유로 돌려준다.

   실행 시간
     vercel.json 에서 maxDuration 120 으로 올려 두었다. 입력은 전사문 텍스트뿐이라
     전사(300초)만큼 걸리지 않는다.
   ═══════════════════════════════════════════════════════════════════ */
"use strict";
const L = require("./_lib.js");
const G = require("./_gemini.js");
const R = require("./report-draft.js");   // 금지표현·숫자환각 검사기를 재사용한다

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ─── 검사기 ①: 금지 표현 ───────────────────────────────────────────

   검사 **로직**은 report-draft.js 의 findForbidden 을 그대로 쓴다. 갈라 두는 것은
   목록뿐이다. 왜 목록을 나누는가 —

   ① 리포트용의 /반드시|틀림없이|장담/ 은 상담에서 과도 리젝을 낳는다.
      후속 조치는 "원서 접수 전에 반드시 서류를 확인" 처럼 쓰이는 것이 정상이다.
      단정을 막자고 멀쩡한 조치 문장을 통째로 버릴 이유가 없어 '반드시' 만 뺀다.
      (설계서 3절: "422 가 잦으면 상담용 FORBIDDEN 패턴을 별도로 완화한다 — 리포트용과 분리")
   ② 반대로 상담 초안에는 리포트에 없는 금지가 있다 — **성적·점수·석차 수치**다.
      강사가 말한 수치를 AI 가 재구성하면 왜곡된다. 78.5점이 79점으로 적히면
      그 기록은 되돌릴 근거가 없다. 문맥과 무관하게 막는다.

   공통 항목(확률·합격 단정)은 R.FORBIDDEN 을 그대로 이어 붙여 쓴다 — 베껴 두면
   한쪽만 고쳐지는 날이 온다. */
const COUNSEL_FORBIDDEN = R.FORBIDDEN
  .filter(f => f.why !== "단정 표현")
  .concat([
    { re: /틀림없이|장담/, why: "단정 표현" },
    { re: /\d+(?:\.\d+)?\s*점/, why: "점수 수치" },
    { re: /\d+\s*등급/, why: "등급 수치" },
    { re: /\d+\s*등(?!록)/, why: "석차 수치" },        // 3등 — '등록금' 은 뺀다
    { re: /\d+\s*위(?![원험])/, why: "석차 수치" },     // 전교 3위
    { re: /(?:내신|모의고사|백분위|표준점수|원점수|평균|성적|석차|등수)\s*\d/, why: "성적 수치" },
  ]);

/* ─── 검사기 ②: 숫자 환각 ───────────────────────────────────────────

   리포트 초안은 서버가 계산한 facts 만 입력이라 "입력에 없는 숫자 = 환각" 이 그대로
   성립한다. 상담 초안의 입력은 전사문인데, 사람은 날짜·학년을 **말로** 한다
   ("구월 모의고사", "고삼", "삼 학년"). 모델이 이를 숫자로 옮기면 전사문에 없던 숫자가
   되어 멀쩡한 초안이 통째로 거부된다 — 설계서가 이월해 둔 '과도 리젝' 이 정확히 이것이다.

   그래서 상담에서 정상인 수치 문맥(학년·학기·날짜·시각·회차·개수)은 검사 전에
   걷어낸다. 이렇게 빼도 위험이 늘지 않는다: 정말 막아야 하는 성적·점수·석차 수치는
   검사기 ① 이 문맥과 무관하게 이미 막고 있기 때문이다.
   남은 숫자(금액, 정체불명의 수치 등)는 전사문에 있어야만 통과한다.

   ★ 대가를 적어 둔다: 개수 표현("지원 대학 12곳")도 걸러지지 않는다. 그래도 이렇게
     두는 쪽을 택했다. 개수가 틀리면 강사가 초안을 읽다가 고치면 되지만(초안은 강사가
     확인·수정해야만 기록이 된다), 과도 리젝은 **초안 전체를 버려** 강사가 고칠 기회
     자체를 없앤다. 사람이 검토하는 2단계 구조라서 성립하는 선택이다. */
const BENIGN_NUM = [
  /(?:고|중|초)\s*\d/g,                 // 고3, 중2
  /\d+\s*학년/g, /\d+\s*학기/g,
  /\d{4}\s*년/g, /\d+\s*월/g, /\d+\s*일/g, /\d+\s*주(?:차)?/g,
  /\d+\s*시/g, /\d+\s*분/g,
  /\d+\s*(?:회|차|번|개|명|곳|군데|가지)/g,
];
function stripBenign(t){
  let s = String(t || "");
  for(const re of BENIGN_NUM) s = s.replace(re, " ");
  return s;
}

/* 필드 하나를 두 검사기에 통과시킨다. 걸린 것은 예외가 아니라 issues 에 쌓는다 —
   무엇이 왜 걸렸는지 화면에서 보여야 강사가 판단하고 프롬프트를 조정할 수 있다. */
function checkField(field, text, allowed, issues){
  const t = String(text || "").trim();
  if(!t) return;
  const bad = R.findForbidden(t, COUNSEL_FORBIDDEN);
  if(bad) issues.push({ field: field, kind: "forbidden", detail: bad, excerpt: t.slice(0, 80) });
  const n = R.findInventedNumber(stripBenign(t), allowed);
  if(n != null){
    issues.push({ field: field, kind: "invented_number", detail: String(n), excerpt: t.slice(0, 80) });
  }
}

function checkDraft(draft, transcript){
  const allowed = R.numbersIn(transcript);
  const issues = [];
  checkField("요약", draft.summary, allowed, issues);
  (draft.key_points || []).forEach((v, i) => checkField("주요 논점 " + (i + 1), v, allowed, issues));
  (draft.follow_ups || []).forEach((v, i) => checkField("후속 조치 " + (i + 1), v, allowed, issues));
  checkField("학생 공개용 문장", draft.student_safe_text, allowed, issues);
  return issues;
}

/* 모델 출력을 저장할 형태로 다듬는다.
   category 가 enum 밖 값이면 **거부하지 않고 버린다** — 유형은 제안일 뿐이라
   그것 하나 때문에 멀쩡한 요약까지 잃을 이유가 없다. 화면에는 제안 칩이 안 뜬다. */
function normalize(j){
  const o = j || {};
  const arr = v => (Array.isArray(v) ? v.map(x => String(x || "").trim()).filter(Boolean) : []);
  const cat = String(o.category || "").trim();
  return {
    summary: String(o.summary || "").trim(),
    category: G.COUNSEL_CATS.indexOf(cat) >= 0 ? cat : null,
    key_points: arr(o.key_points),
    follow_ups: arr(o.follow_ups),
    student_safe_text: String(o.student_safe_text || "").trim(),
  };
}

const SYSTEM_INSTRUCTION = [
  "너는 학원 강사의 상담 녹음 전사문을 읽고 상담 기록 초안을 정돈하는 보조자다.",
  "이 초안은 강사가 확인하고 고쳐서 쓰는 재료이지 확정 기록이 아니다.",
  "",
  "[반드시 지킬 것]",
  "1. 전사문에 없는 사실을 지어내지 마라. 근거가 없으면 그 항목을 비워 두어라.",
  "2. **성적·점수·석차·등급·백분위 같은 수치를 쓰지 마라.** 전사문에 그런 말이 있어도",
  "   숫자로 옮기지 말고 '성적 이야기를 나눔' 처럼 사실만 적어라. 수치를 옮겨 적다",
  "   틀리면 그 기록은 되돌릴 근거가 없다.",
  "3. 추측을 단정으로 쓰지 마라. 강사가 '~인 것 같다' 고 말했으면 그대로 적어라.",
  "4. 합격 가능성·확률을 언급하지 마라. 이 글은 상담 기록이지 예측이 아니다.",
  "",
  "[각 항목]",
  "· summary: 무슨 이야기를 했는지 3~5문장. 존댓말 없이 담백한 기록체로.",
  "· category: 상담 유형 제안. 주어진 값 중에서만 고른다.",
  "· key_points: 오간 이야기의 핵심 3~6개. 한 줄씩.",
  "· follow_ups: 다음에 할 일 후보. 전사문에서 실제로 합의·언급된 것만. 없으면 빈 배열.",
  "· student_safe_text: 학생에게 그대로 보여도 되는 문장 2~3개.",
  "  다른 학생·다른 학부모·제3자에 대한 언급, 가정사·건강·경제 사정 같은 민감한 내용,",
  "  학생이 없는 자리에서 오간 평가는 **모두 빼라.** 뺄 것이 많아 남길 문장이 없으면",
  "  빈 문자열로 두어라 — 억지로 채우지 마라.",
].join("\n");

async function loadNote(id){
  const rows = await L.sbRest(
    "counseling_notes?id=eq." + L.eqParam(id) +
    "&select=id,student_id,transcript,ai_status&limit=1");
  const n = Array.isArray(rows) && rows.length ? rows[0] : null;
  if(!n) throw L.fail(404, "상담 기록을 찾을 수 없습니다.");
  return n;
}

async function patchNote(id, patch){
  await L.sbRest("counseling_notes?id=eq." + L.eqParam(id), {
    method: "PATCH", body: patch, headers: { Prefer: "return=minimal" },
  });
}

module.exports = async function handler(req, res){
  let noteId = null;
  try{
    if(req.method !== "POST"){
      res.setHeader("Allow", "POST");
      return L.sendJson(res, 405, { error: "POST 요청만 허용됩니다." });
    }
    const auth = L.requireAdmin(req);
    await L.assertTokenFresh(auth);

    const body = await L.readJsonBody(req);
    const id = body && body.note_id;
    if(!id || !UUID_RE.test(String(id))) throw L.fail(400, "note_id 가 필요합니다.");

    const note = await loadNote(id);
    const transcript = String(note.transcript || "").trim();
    if(!transcript) throw L.fail(400, "전사문이 없습니다. 먼저 전사를 실행하세요.");

    // 여기서부터가 "정돈 시도" 다. 앞선 검증 실패(권한·전사문 없음)는 정돈 실패가
    // 아니므로 ai_status 를 덮지 않는다(아래 catch 가 noteId 로 판단한다).
    noteId = note.id;
    const r = await G.callGemini([{ text: "[상담 전사문]\n" + transcript }], {
      schema: G.COUNSEL_DRAFT_SCHEMA, maxOutputTokens: 4096, temperature: 0.2,
      systemInstruction: SYSTEM_INSTRUCTION,
    });

    // 차단은 정상적인 결과의 하나다(counsel-transcribe.js 와 같은 관례). 예외를 던지지 않는다.
    if(!r.ok){
      await patchNote(note.id, { ai_status: "blocked" });
      return L.sendJson(res, 200, {
        ok: false, ai_status: "blocked", blocked: r.blocked,
        tokens_in: r.tokensIn, tokens_out: r.tokensOut, cost_usd: r.costUsd,
      });
    }

    const draft = normalize(r.json);
    if(!draft.summary){
      await patchNote(note.id, { ai_status: "failed" });
      return L.sendJson(res, 200, {
        ok: false, ai_status: "failed", reason: "empty",
        message: "AI 가 빈 초안을 돌려주었습니다. 다시 시도하거나 전사문을 보고 직접 정돈하세요.",
        tokens_in: r.tokensIn, tokens_out: r.tokensOut, cost_usd: r.costUsd,
      });
    }

    /* ★ 검사기에 걸리면 **저장하지 않는다.** ai_status 도 그대로 둔다 —
       전사문은 멀쩡하고 다시 시도할 수 있는 상태이므로 'transcribed' 를 유지해야
       화면의 [AI로 정돈하기] 가 살아 있다. 통과 못 한 문장을 "참고용으로" 내려보내지도
       않는다(report-draft.js 와 같은 원칙). 대신 무엇이 걸렸는지는 그대로 보여 준다. */
    const issues = checkDraft(draft, transcript);
    if(issues.length){
      return L.sendJson(res, 200, {
        ok: false, reason: "rejected", issues: issues,
        tokens_in: r.tokensIn, tokens_out: r.tokensOut, cost_usd: r.costUsd,
      });
    }

    await patchNote(note.id, { ai_draft: draft, ai_status: "drafted" });
    return L.sendJson(res, 200, {
      ok: true, draft: draft, ai_status: "drafted",
      tokens_in: r.tokensIn, tokens_out: r.tokensOut, cost_usd: r.costUsd,
    });
  }catch(e){
    // 실패 사실을 행에 남긴다(counsel-transcribe.js 와 같은 관례). 전사문은 지우지 않는다.
    // 키 미설정(503)은 _gemini.js 가 이미 처리하므로 상태를 덮어쓰지 않는다.
    if(noteId && !(e && e.aiUnconfigured)){
      try{ await patchNote(noteId, { ai_status: "failed" }); }
      catch(e2){ console.error("[counsel-draft] 상태 기록 실패:", e2 && e2.message); }
    }
    return L.sendError(res, e, "초안 생성 중 오류가 발생했습니다.");
  }
};

// 검사기를 테스트에서 직접 확인할 수 있도록 함께 내보낸다.
module.exports.COUNSEL_FORBIDDEN = COUNSEL_FORBIDDEN;
module.exports.checkDraft = checkDraft;
module.exports.stripBenign = stripBenign;
module.exports.normalize = normalize;
