/* ═══════════════════════════════════════════════════════════════════
   api/_gemini.js — Gemini REST 호출 공용 모듈 (의존성 0)

   전역 fetch 만 쓴다. SDK 를 넣지 않는 이유는 빌드 스텝 0 원칙 유지.
   파일명이 _ 로 시작하므로 Vercel 라우트로 노출되지 않는다.

   [모델·단가]
     기본값은 gemini-3.6-flash / 입력 $1.50 · 출력 $7.50 per 1M 이다.
     단가는 바뀔 수 있으므로 전부 환경변수로 덮어쓸 수 있게 했다.
       GEMINI_MODEL, GEMINI_PRICE_IN_PER_M, GEMINI_PRICE_OUT_PER_M
     비용 표시가 실제 청구와 어긋나면 이 값들을 먼저 확인할 것.

   [키가 없을 때]
     throw 하지 않고 503 + {error:'AI 기능 미설정'} 으로 내려보낸다.
     클라이언트는 이 신호를 받아 AI 버튼을 비활성화한다(기능 전체가 멈추면 안 된다).
   ═══════════════════════════════════════════════════════════════════ */
"use strict";
const L = require("./_lib.js");

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
const DEFAULT_MODEL = "gemini-3.6-flash";
const DEFAULT_PRICE_IN = 1.50;    // USD per 1M input tokens
const DEFAULT_PRICE_OUT = 7.50;   // USD per 1M output tokens
const PROMPT_VERSION = "p1";      // 프롬프트를 바꾸면 올린다(품질 비교의 기준선)

function model(){ return process.env.GEMINI_MODEL || DEFAULT_MODEL; }
function priceIn(){ return Number(process.env.GEMINI_PRICE_IN_PER_M || DEFAULT_PRICE_IN); }
function priceOut(){ return Number(process.env.GEMINI_PRICE_OUT_PER_M || DEFAULT_PRICE_OUT); }

function hasKey(){ return !!process.env.GEMINI_API_KEY; }

/* 채점 모드
     tags_only : 감점 태그·피드백만 받는다. 점수는 요청조차 하지 않는다.
                 강사가 AI 점수에 끌려가는 앵커링을 막기 위한 초기 운영 모드.
     full      : 점수 제안까지 받는다. 일치율 게이트를 통과한 뒤에 켠다. */
function gradingMode(){
  const m = String(process.env.AI_GRADING_MODE || "tags_only").toLowerCase();
  return m === "full" ? "full" : "tags_only";
}

function estimateCost(tokensIn, tokensOut){
  const ti = Number(tokensIn) || 0, to = Number(tokensOut) || 0;
  return (ti / 1e6) * priceIn() + (to / 1e6) * priceOut();
}

/* Gemini generateContent 호출.
   parts: [{text}] 또는 [{inlineData:{mimeType,data}}] 배열
   opts : { schema, maxOutputTokens, temperature, systemInstruction }

   반환
     { ok:true, json, text, tokensIn, tokensOut, costUsd, model, raw }
     { ok:false, blocked:'SAFETY'|'RECITATION'|... , raw }     ← 예외가 아니다
   호출 실패(네트워크·4xx·5xx)만 throw 한다. */
async function callGemini(parts, opts){
  if(!hasKey()){
    const e = new Error("AI 기능이 설정되지 않았습니다. 관리자에게 GEMINI_API_KEY 등록을 요청하세요.");
    e.statusCode = 503;
    e.publicMessage = "AI 기능 미설정";
    e.aiUnconfigured = true;
    throw e;
  }
  const o = opts || {};
  const generationConfig = {
    temperature: o.temperature == null ? 0.1 : o.temperature,   // 채점은 재현성이 우선
    maxOutputTokens: o.maxOutputTokens || 2048,
  };
  if(o.schema){
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = o.schema;
  }
  const body = { contents: [{ role: "user", parts: parts }], generationConfig: generationConfig };
  if(o.systemInstruction) body.systemInstruction = { parts: [{ text: o.systemInstruction }] };
  // 코드 실행 등 도구 사용. responseSchema 와 함께 쓰면 거부하는 경우가 있어
  // 도구를 쓸 때는 호출부가 schema 를 주지 않는 것을 전제로 한다.
  if(o.tools) body.tools = o.tools;

  const url = API_BASE + encodeURIComponent(model()) + ":generateContent";
  let res;
  try{
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify(body),
    });
  }catch(e){
    console.error("[gemini] network", e && e.message);
    throw L.fail(502, "AI 서버에 연결하지 못했습니다.");
  }

  const text = await res.text();
  if(!res.ok){
    console.error("[gemini]", res.status, text.slice(0, 500));
    if(res.status === 429) throw L.fail(429, "AI 요청이 한도를 초과했습니다. 잠시 후 다시 시도하세요.");
    if(res.status === 400) throw L.fail(502, "AI 요청 형식 오류입니다. 관리자에게 문의하세요.");
    if(res.status === 403) throw L.fail(502, "AI 키가 거부되었습니다. 키·결제 설정을 확인하세요.");
    throw L.fail(502, "AI 처리에 실패했습니다.");
  }

  let data;
  try{ data = JSON.parse(text); }
  catch(e){ throw L.fail(502, "AI 응답을 해석하지 못했습니다."); }

  const usage = data.usageMetadata || {};
  const tokensIn = usage.promptTokenCount || 0;
  const tokensOut = usage.candidatesTokenCount || 0;
  const costUsd = estimateCost(tokensIn, tokensOut);

  const cand = (data.candidates || [])[0];
  // 안전 필터·저작권 차단은 정상적인 결과의 하나로 취급한다(호출부가 상태로 기록).
  const blockReason = (data.promptFeedback && data.promptFeedback.blockReason) || null;
  const finish = cand && cand.finishReason;
  if(blockReason || finish === "SAFETY" || finish === "RECITATION" || finish === "PROHIBITED_CONTENT"){
    return { ok: false, blocked: blockReason || finish, tokensIn, tokensOut, costUsd, model: model(), raw: data };
  }
  if(!cand) return { ok: false, blocked: "NO_CANDIDATE", tokensIn, tokensOut, costUsd, model: model(), raw: data };

  const partsOut = (cand.content && cand.content.parts) || [];
  const out = partsOut.map(p => p.text || "").join("").trim();
  // 코드 실행 도구를 쓴 경우 실행 결과를 따로 모아 둔다(검증 근거로 저장).
  const codeOutput = partsOut
    .filter(p => p.codeExecutionResult || p.executableCode)
    .map(p => p.executableCode ? ("[code]\n" + (p.executableCode.code || ""))
      : ("[output]\n" + ((p.codeExecutionResult && p.codeExecutionResult.output) || "")))
    .join("\n");
  let json = null;
  if(o.schema){
    try{ json = JSON.parse(out); }
    catch(e){
      console.error("[gemini] JSON 파싱 실패:", out.slice(0, 300));
      return { ok: false, blocked: "BAD_JSON", tokensIn, tokensOut, costUsd, model: model(), raw: data };
    }
  }
  // 출력 토큰 상한에 걸려 잘린 응답은 신뢰할 수 없다.
  if(finish === "MAX_TOKENS"){
    return { ok: false, blocked: "MAX_TOKENS", tokensIn, tokensOut, costUsd, model: model(), raw: data };
  }
  return { ok: true, json, text: out, codeOutput, tokensIn, tokensOut, costUsd, model: model(), raw: data };
}

/* ── responseSchema 조립 ── */

// 전사: 정답을 주지 않는다. 답안에 적힌 것만 그대로 옮기게 한다.
const TRANSCRIBE_SCHEMA = {
  type: "OBJECT",
  properties: {
    transcript: { type: "STRING", description: "답안에 적힌 내용을 그대로 옮긴 텍스트. 수식은 LaTeX." },
    latex_blocks: { type: "ARRAY", items: { type: "STRING" }, description: "본문에 등장한 수식들" },
    legibility: { type: "NUMBER", description: "판독 확신도 0~1" },
    unreadable_spans: { type: "ARRAY", items: { type: "STRING" }, description: "판독 불가 구간 설명" },
  },
  required: ["transcript", "legibility"],
};

// 채점: 감점 태그는 enum 으로 고정해 자유 문자열이 섞이지 않게 한다.
function buildGradeSchema(tagEnum, withScore){
  const props = {
    wrong_reason_tags: {
      type: "ARRAY",
      items: { type: "STRING", enum: tagEnum },
      description: "해당하는 감점 사유. 없으면 빈 배열.",
    },
    feedback_text: { type: "STRING", description: "학생에게 줄 2~3문장 피드백" },
    evidence: { type: "STRING", description: "답안의 어느 부분을 근거로 판단했는지" },
    confidence: { type: "NUMBER", description: "판단 확신도 0~1" },
  };
  const required = ["wrong_reason_tags", "feedback_text", "confidence"];
  if(withScore){
    props.rubric_breakdown = {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          criterion: { type: "STRING" },
          max_points: { type: "NUMBER" },
          earned_points: { type: "NUMBER" },
          reason: { type: "STRING" },
        },
        required: ["criterion", "earned_points"],
      },
    };
    props.suggested_score = { type: "NUMBER", description: "총 득점 제안" };
    required.push("suggested_score");
  }
  return { type: "OBJECT", properties: props, required: required };
}

module.exports = {
  callGemini, hasKey, model, gradingMode, estimateCost,
  priceIn, priceOut, PROMPT_VERSION,
  TRANSCRIBE_SCHEMA, buildGradeSchema,
};
