/* ═══════════════════════════════════════════════════════════════════
   POST /api/generate-variant
     { source_problem_id, variation_spec:{mode,note,difficulty_delta}, count }  (admin 전용)
     →  { variants: [problem_variants 행...] }

   왜 이렇게 여러 단계인가
     LLM 이 만든 수학 문제는 "문제는 그럴듯한데 정답이 틀린" 경우가 흔하다.
     그래서 생성물을 그대로 믿지 않고 두 겹으로 거른다.

       1) 스펙 추출   원본에서 유형 명세만 뽑는다(원문은 서버 프롬프트에만 쓴다).
       2) 변형 생성   정답을 **두 방식으로** 요구한다.
                      - answer_closed   : 최종 닫힌형 답
                      - answer_derived  : 풀이 마지막 줄에서 나온 답
       3) 자기모순 검사(서버 코드)  둘이 다르면 그 시점에 폐기(regenerate).
                      모델을 한 번 더 부르지 않으므로 비용이 들지 않는다.
       4) 독립 재풀이 생성된 문제만 새 세션에 주고(1·2단계 풀이는 감춘다)
                      가능하면 코드 실행으로 직접 계산시켜 대조한다.

     3·4 를 통과한 것만 pending 으로 검수 큐에 올라간다.
     통과했다고 정답이 보장되지는 않는다 — 마지막 판단은 강사가 한다.
   ═══════════════════════════════════════════════════════════════════ */
"use strict";
const L = require("./_lib.js");
const G = require("./_gemini.js");

const MAX_COUNT = 3;
const TEMPERATURE = 0.3;

/* 수식 답을 비교 가능한 형태로 정규화한다.
   목적은 "같은 답인데 표기만 다른" 경우를 같다고 보는 것이지,
   수학적 동치 판정이 아니다(그건 4단계 코드 실행이 맡는다). */
function normalizeAnswer(s){
  let t = String(s == null ? "" : s);
  t = t.replace(/\$+/g, " ");                       // $ ... $
  t = t.replace(/\\left|\\right/g, "");
  t = t.replace(/\\!|\\,|\\;|\\:|\\quad|\\qquad/g, "");
  t = t.replace(/\\displaystyle/g, "");
  t = t.replace(/\\dfrac|\\tfrac/g, "\\frac");
  t = t.replace(/\s+/g, "");
  t = t.replace(/[{}]/g, "");
  t = t.replace(/^\(+|\)+$/g, "");                  // 바깥 괄호만
  t = t.replace(/^(답|정답|answer)[:=]?/i, "");
  t = t.replace(/\.$/, "");
  return t.toLowerCase();
}
function answersAgree(a, b){
  const na = normalizeAnswer(a), nb = normalizeAnswer(b);
  if(!na || !nb) return false;
  return na === nb;
}

const SPEC_SCHEMA = {
  type: "OBJECT",
  properties: {
    unit: { type: "STRING" },
    cognition: { type: "STRING" },
    condition_structure: { type: "STRING", description: "주어진 조건이 어떤 구조인지" },
    solution_path: { type: "STRING", description: "정답까지 가는 해법 경로" },
    key_skill: { type: "STRING", description: "이 문항이 실제로 묻는 능력" },
    point_structure: { type: "STRING", description: "배점이 어떤 단계로 나뉘는지" },
    pitfalls: { type: "ARRAY", items: { type: "STRING" }, description: "학생이 흔히 틀리는 지점" },
  },
  required: ["condition_structure", "solution_path", "key_skill"],
};

const VARIANT_SCHEMA = {
  type: "OBJECT",
  properties: {
    stem_latex: { type: "STRING", description: "새 문제 본문. LaTeX." },
    answer_closed: { type: "STRING", description: "최종 정답을 닫힌형으로만." },
    solution_steps: { type: "ARRAY", items: { type: "STRING" }, description: "풀이 단계" },
    answer_derived: { type: "STRING", description: "위 풀이의 마지막 단계에서 실제로 나온 답. answer_closed 를 베끼지 말고 풀이를 따라가 다시 적을 것." },
    rubric: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          criterion: { type: "STRING" },
          points: { type: "NUMBER" },
          tag: { type: "STRING" },
        },
        required: ["criterion", "points"],
      },
    },
    points: { type: "NUMBER" },
    difficulty: { type: "NUMBER", description: "1~5" },
    changed_summary: { type: "STRING", description: "원본 대비 무엇을 바꿨는지" },
  },
  required: ["stem_latex", "answer_closed", "solution_steps", "answer_derived"],
};

async function loadSource(id){
  const rows = await L.sbRest(
    "problems?id=eq." + L.eqParam(id) +
    "&select=id,unit,cognition,difficulty,points,body_latex,answer_latex,solution_latex,rubric,source_citation,status&limit=1");
  const p = Array.isArray(rows) && rows.length ? rows[0] : null;
  if(!p) throw L.fail(404, "원본 문항을 찾을 수 없습니다.");
  return p;
}

async function insertVariant(row){
  const out = await L.sbRest("problem_variants", {
    method: "POST", body: row, headers: { Prefer: "return=representation" },
  });
  return Array.isArray(out) && out.length ? out[0] : null;
}

/* 1단계: 원본에서 유형 명세만 뽑는다. */
async function extractSpec(src){
  const lines = [
    "다음 수학 문항을 분석해 '유형 명세'만 추출하라. 문제를 새로 만들지 마라.",
    "",
    "[원본]",
    src.body_latex ? "문제: " + src.body_latex : "",
    src.answer_latex ? "정답: " + src.answer_latex : "",
    src.solution_latex ? "풀이: " + src.solution_latex : "",
    "단원: " + (src.unit || "-") + " / 사고과정: " + (src.cognition || "-"),
    src.points != null ? "배점: " + src.points : "",
  ].filter(Boolean);
  return await G.callGemini([{ text: lines.join("\n") }],
    { schema: SPEC_SCHEMA, maxOutputTokens: 1024, temperature: TEMPERATURE });
}

/* 2단계: 명세 + 사용자 지정 변형 방식으로 새 문항을 만든다. */
async function generateVariant(spec, src, variationSpec){
  const mode = (variationSpec && variationSpec.mode) || "numbers";
  const modeText = mode === "numbers" ? "숫자(계수·상수)만 바꾼다. 구조와 해법 경로는 그대로 유지한다."
    : mode === "condition" ? ("조건을 다음과 같이 바꾼다: " + ((variationSpec && variationSpec.note) || "(지정 없음)"))
    : "난이도를 조정한다.";
  const dd = Number((variationSpec && variationSpec.difficulty_delta) || 0);

  const lines = [
    "아래 유형 명세를 바탕으로 **새로운** 수학 문항 1개를 만들어라.",
    "",
    "[유형 명세]",
    JSON.stringify(spec, null, 2),
    "",
    "[변형 방식]",
    modeText,
    dd !== 0 ? ("목표 난이도: 원본" + (dd > 0 ? " +" + dd : " " + dd) + " 단계") : "난이도는 원본과 동일하게 유지한다.",
    "",
    "[반드시 지킬 것]",
    "1. 답이 깔끔하게 떨어지도록 숫자를 고를 것(무리한 소수·거대한 수 금지).",
    "2. solution_steps 를 실제로 계산하며 작성할 것.",
    "3. answer_derived 는 answer_closed 를 복사하지 말고, solution_steps 의 마지막 단계에서 나온 값을 다시 적을 것.",
    "   두 값이 어긋나면 이 문항은 폐기된다.",
    "4. 조건이 모순되거나 해가 존재하지 않는 문제를 만들지 말 것.",
    "5. rubric 은 채점 단계별로 나눌 것.",
  ];
  return await G.callGemini([{ text: lines.join("\n") }],
    { schema: VARIANT_SCHEMA, maxOutputTokens: 2048, temperature: TEMPERATURE });
}

/* 4단계: 독립 재풀이. 생성 과정의 풀이는 주지 않고 문제만 준다.
   코드 실행이 가능하면 sympy 로 계산시키고, 안 되면 코드 없이 재풀이한다. */
async function independentSolve(stem){
  const prompt =
    "다음 수학 문제를 처음 보는 문제로 여기고 직접 풀어라.\n" +
    "가능하면 파이썬(sympy)으로 계산해 검산하라.\n" +
    "마지막 줄에 정확히 다음 형식으로만 최종 답을 적어라.\n" +
    "FINAL_ANSWER: <닫힌형 정답>\n\n" +
    "[문제]\n" + stem;

  try{
    const r = await G.callGemini([{ text: prompt }], {
      tools: [{ codeExecution: {} }], maxOutputTokens: 4096, temperature: 0,
    });
    return { r, method: "code_execution" };
  }catch(e){
    // codeExecution 미지원 등으로 400 이 오면(=502 로 매핑됨) 도구 없이 재시도한다.
    console.error("[generate-variant] codeExecution 실패, 폴백:", e && e.publicMessage);
    const r = await G.callGemini([{ text: prompt }], { maxOutputTokens: 2048, temperature: 0 });
    return { r, method: "no_code_execution" };
  }
}

function parseFinalAnswer(text){
  const m = /FINAL_ANSWER\s*:\s*(.+)$/im.exec(String(text || ""));
  return m ? m[1].trim() : null;
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
    if(!body || !body.source_problem_id) throw L.fail(400, "source_problem_id 가 필요합니다.");
    const count = Math.min(MAX_COUNT, Math.max(1, Number(body.count) || 1));
    const variationSpec = body.variation_spec || { mode: "numbers" };

    const src = await loadSource(body.source_problem_id);

    // 스펙 추출은 1회만 하고 생성에 재사용한다(같은 원본이므로).
    const specR = await extractSpec(src);
    if(!specR.ok){
      return L.sendJson(res, 200, { variants: [], blocked: specR.blocked,
        message: "원본 분석 단계에서 사용할 수 없는 응답을 받았습니다(" + specR.blocked + ")." });
    }
    const spec = specR.json;

    const made = [];
    for(let i = 0; i < count; i++){
      const genR = await generateVariant(spec, src, variationSpec);
      if(!genR.ok){
        made.push(await insertVariant({
          source_problem_id: src.id, model: G.model(), prompt_version: G.PROMPT_VERSION,
          variation_spec: variationSpec, review_status: "regenerate",
          self_check: { stage: "generate", blocked: genR.blocked },
          review_note: "생성 단계 차단: " + genR.blocked,
        }));
        continue;
      }
      const v = genR.json || {};

      // ── 3단계: 자기모순 검사(코드로만 판단. 추가 호출 없음) ──
      const consistent = answersAgree(v.answer_closed, v.answer_derived);
      if(!consistent){
        made.push(await insertVariant({
          source_problem_id: src.id, model: G.model(), prompt_version: G.PROMPT_VERSION,
          variation_spec: variationSpec, raw_response: v, review_status: "regenerate",
          self_check: {
            stage: "self_consistency", consistent: false,
            closed_answer: v.answer_closed, derived_answer: v.answer_derived,
          },
          review_note: "정답 2회 계산 불일치로 자동 폐기",
        }));
        continue;
      }

      // ── 4단계: 독립 재풀이 ──
      let indep = null, matches = null, method = null, codeOutput = null, indepBlocked = null;
      try{
        const { r, method: m } = await independentSolve(v.stem_latex);
        method = m;
        if(!r.ok){ indepBlocked = r.blocked; }
        else{
          indep = parseFinalAnswer(r.text);
          codeOutput = (r.codeOutput || "").slice(0, 4000) || null;
          matches = indep ? answersAgree(indep, v.answer_closed) : null;
        }
      }catch(e){
        indepBlocked = "ERROR:" + String((e && e.publicMessage) || (e && e.message) || "").slice(0, 120);
      }

      const selfCheck = {
        stage: "independent", consistent: true,
        closed_answer: v.answer_closed, derived_answer: v.answer_derived,
        independent_answer: indep, matches: matches, method: method,
        code_output: codeOutput, blocked: indepBlocked,
      };

      // 독립 재풀이가 명확히 어긋나면 폐기. 재풀이 자체를 못 한 경우는
      // 폐기하지 않고 pending 으로 두되 검수 화면에서 "미검증"으로 표시한다.
      const status = (matches === false) ? "regenerate" : "pending";
      made.push(await insertVariant({
        source_problem_id: src.id, model: G.model(), prompt_version: G.PROMPT_VERSION,
        variation_spec: variationSpec, raw_response: v, self_check: selfCheck,
        review_status: status,
        review_note: status === "regenerate" ? "독립 재풀이 결과 불일치로 자동 폐기" : null,
      }));
    }

    return L.sendJson(res, 200, {
      variants: made.filter(Boolean),
      pending: made.filter(x => x && x.review_status === "pending").length,
      discarded: made.filter(x => x && x.review_status === "regenerate").length,
    });
  }catch(e){
    return L.sendError(res, e, "변형 문제 생성 중 오류가 발생했습니다.");
  }
};
