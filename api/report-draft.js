/* ═══════════════════════════════════════════════════════════════════
   POST /api/report-draft   { student_id, week_no }   (admin 전용)
     →  { draft, facts, attempts }

   학부모 리포트에 실을 강사 코멘트 **초안**을 만든다.

   왜 후처리 검사기가 필요한가
     학부모가 읽는 글이라 "합격 예상", "80% 확률" 같은 표현이 한 줄이라도
     들어가면 그 자체로 약속이 된다. 프롬프트로 금지하는 것만으로는 모자라서,
     생성된 문장을 코드로 다시 훑어 걸러낸다.

       · 금지 표현(확률·합격 단정)이 있으면 폐기
       · 입력으로 준 적 없는 숫자가 있으면 폐기(수치 환각 차단)

     1회 재생성하고 그래도 걸리면 오류를 반환한다 — 통과 못 한 문장을
     "그래도 참고용으로" 내려보내지 않는다.

   결과는 teacher_comments.ai_draft 에 저장한다. 확정 코멘트(comment)와
   분리돼 있어서, 강사가 옮겨 적지 않으면 리포트에 실리지 않는다.
   ═══════════════════════════════════════════════════════════════════ */
"use strict";
const L = require("./_lib.js");
const G = require("./_gemini.js");

const MAX_ATTEMPTS = 2;

/* 금지 표현 — 확률·합격 단정. 띄어쓰기 변형을 견디도록 느슨하게 잡는다. */
const FORBIDDEN = [
  { re: /\d\s*%\s*(확률|가능성)/, why: "확률 수치" },
  { re: /확률/, why: "확률 표현" },
  { re: /합격\s*(이|은|을)?\s*(예상|유력|확실|보장)/, why: "합격 단정" },
  { re: /안정적으로\s*합격/, why: "합격 단정" },
  { re: /합격\s*할\s*것/, why: "합격 단정" },
  { re: /충분히\s*합격/, why: "합격 단정" },
  { re: /(불합격|떨어질)\s*(예상|것)/, why: "불합격 단정" },
  { re: /반드시|틀림없이|장담/, why: "단정 표현" },
];

function findForbidden(text){
  const t = String(text || "");
  for(const f of FORBIDDEN){ if(f.re.test(t)) return f.why; }
  return null;
}

function numbersIn(s){
  return (String(s || "").match(/\d+(?:\.\d+)?/g) || []).map(Number).filter(n => Number.isFinite(n));
}

/* 출력의 숫자가 전부 입력에서 온 것인지 확인한다.
   반올림·버림 표기는 허용한다(72.5 → 73/72). 그 외 새 숫자는 환각으로 본다. */
function findInventedNumber(text, allowed){
  for(const n of numbersIn(text)){
    const ok = allowed.some(a =>
      Math.abs(a - n) < 1e-9 || Math.round(a) === n || Math.floor(a) === n || Math.ceil(a) === n);
    if(!ok) return n;
  }
  return null;
}

/* 서버가 DB 에서 직접 계산한 수치만 모은다.
   모델에게는 이 값만 주고, 여기 없는 숫자를 쓰면 위에서 걸러진다. */
async function collectFacts(studentId, weekNo){
  const st = await L.sbRest("students?id=eq." + L.eqParam(studentId) + "&select=name,grade_type&limit=1");
  const student = Array.isArray(st) && st.length ? st[0] : {};

  const snaps = await L.sbRest(
    "readiness_snapshots?student_id=eq." + L.eqParam(studentId) +
    "&select=readiness,snap_date,meta&order=snap_date.desc&limit=2");
  const latest = Array.isArray(snaps) && snaps.length ? snaps[0] : null;
  const prev = Array.isArray(snaps) && snaps.length > 1 ? snaps[1] : null;

  const rx = await L.sbRest(
    "prescriptions?student_id=eq." + L.eqParam(studentId) +
    "&select=unit,cognition,status,baseline_rate,due_date&order=created_at.desc&limit=10");

  const hw = await L.sbRest(
    "homework_records?student_id=eq." + L.eqParam(studentId) +
    "&select=problems_total,problems_correct&order=week_date.desc&limit=5");
  let hwRate = null;
  if(Array.isArray(hw) && hw.length){
    const rates = hw.map(h => (Number(h.problems_total) > 0)
      ? (Number(h.problems_correct) || 0) / Number(h.problems_total) * 100 : null).filter(v => v != null);
    if(rates.length) hwRate = Math.round(rates.reduce((a, b) => a + b, 0) / rates.length * 10) / 10;
  }

  const facts = {
    student_name: student.name || null,
    grade_type: student.grade_type || null,
    week_no: weekNo == null ? null : Number(weekNo),
    readiness: latest && latest.readiness != null ? Number(latest.readiness) : null,
    readiness_prev: prev && prev.readiness != null ? Number(prev.readiness) : null,
    last_score_pct: latest && latest.meta && latest.meta.last_pct != null ? Number(latest.meta.last_pct) : null,
    weak_unit: latest && latest.meta ? (latest.meta.weak_unit || null) : null,
    weak_cognition: latest && latest.meta ? (latest.meta.weak_cognition || null) : null,
    homework_accuracy: hwRate,
    prescriptions_active: Array.isArray(rx) ? rx.filter(p => p.status === "active").length : 0,
    prescriptions_done: Array.isArray(rx) ? rx.filter(p => p.status === "done").length : 0,
    prescription_targets: Array.isArray(rx) ? rx.slice(0, 3).map(p => p.unit + "·" + p.cognition) : [],
  };
  return facts;
}

async function generateDraft(facts){
  const lines = [
    "학원 강사가 학부모에게 보내는 주간 리포트의 코멘트 초안을 써라.",
    "",
    "[사용 가능한 수치 — 여기 없는 숫자는 절대 쓰지 마라]",
    JSON.stringify(facts, null, 2),
    "",
    "[작성 규칙]",
    "1. 3~5문장. 학부모가 읽는 글이므로 존댓말, 담백하고 사실 중심으로.",
    "2. 위 수치 외의 숫자를 만들어 쓰지 마라. 값이 null 인 항목은 언급하지 마라.",
    "3. **합격 가능성·확률을 절대 언급하지 마라.** '확률', '합격 예상', '합격 유력',",
    "   '안정적으로 합격' 같은 표현은 금지다. 이 글은 학습 상황 보고이지 예측이 아니다.",
    "4. '반드시', '장담' 같은 단정 표현을 쓰지 마라.",
    "5. 잘한 점 → 보완할 점 → 다음 주 학습 방향 순서로 쓰되, 항목 나누지 말고 이어지는 문장으로.",
    "6. 취약 단원이 있으면 그 단원 이름을 언급하고 무엇을 할지 구체적으로 적어라.",
    "",
    "코멘트 본문만 출력하라. 제목·머리말·따옴표 없이.",
  ];
  return await G.callGemini([{ text: lines.join("\n") }],
    { maxOutputTokens: 800, temperature: 0.4 });
}

module.exports = async function handler(req, res){
  try{
    if(req.method !== "POST"){
      res.setHeader("Allow", "POST");
      return L.sendJson(res, 405, { error: "POST 요청만 허용됩니다." });
    }
    L.requireAdmin(req);
    if(!G.hasKey()) return L.sendJson(res, 503, { error: "AI 기능 미설정", aiUnconfigured: true });

    const body = await L.readJsonBody(req);
    if(!body || !body.student_id) throw L.fail(400, "student_id 가 필요합니다.");
    const weekNo = body.week_no == null ? 0 : Number(body.week_no);

    const facts = await collectFacts(body.student_id, weekNo);
    const allowed = numbersIn(JSON.stringify(facts));

    let draft = null, lastReason = null, attempts = 0;
    for(let i = 0; i < MAX_ATTEMPTS; i++){
      attempts++;
      const r = await generateDraft(facts);
      if(!r.ok){ lastReason = "AI 응답 사용 불가(" + r.blocked + ")"; continue; }
      const text = (r.text || "").trim();
      if(!text){ lastReason = "빈 응답"; continue; }

      const bad = findForbidden(text);
      if(bad){ lastReason = "금지 표현 감지: " + bad; continue; }

      const invented = findInventedNumber(text, allowed);
      if(invented != null){ lastReason = "입력에 없는 숫자 사용: " + invented; continue; }

      draft = text;
      break;
    }

    if(!draft){
      // 통과 못 한 문장은 내려보내지 않는다.
      throw L.fail(422, "초안이 검수 기준을 통과하지 못했습니다(" + (lastReason || "사유 불명") + "). 다시 시도하거나 직접 작성하세요.");
    }

    // ai_draft 에만 저장한다. 확정 코멘트(comment)는 건드리지 않는다.
    const existing = await L.sbRest(
      "teacher_comments?student_id=eq." + L.eqParam(body.student_id) +
      "&week_no=eq." + L.eqParam(weekNo) + "&select=id&limit=1");
    const now = new Date().toISOString();
    if(Array.isArray(existing) && existing.length){
      await L.sbRest("teacher_comments?id=eq." + L.eqParam(existing[0].id), {
        method: "PATCH", body: { ai_draft: draft, ai_generated_at: now },
        headers: { Prefer: "return=minimal" },
      });
    }else{
      await L.sbRest("teacher_comments", {
        method: "POST",
        body: { student_id: body.student_id, week_no: weekNo, ai_draft: draft, ai_generated_at: now },
        headers: { Prefer: "return=minimal" },
      });
    }

    return L.sendJson(res, 200, { draft: draft, facts: facts, attempts: attempts });
  }catch(e){
    return L.sendError(res, e, "리포트 초안 생성 중 오류가 발생했습니다.");
  }
};

// 테스트에서 검사기를 직접 확인할 수 있도록 함께 내보낸다.
module.exports.findForbidden = findForbidden;
module.exports.findInventedNumber = findInventedNumber;
module.exports.numbersIn = numbersIn;
