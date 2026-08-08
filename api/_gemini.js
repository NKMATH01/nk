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
const FILES_BASE = "https://generativelanguage.googleapis.com/v1beta/files";
const FILES_UPLOAD_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
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
   parts: [{text}] / [{inlineData:{mimeType,data}}] / [{fileData:{mimeType,fileUri}}] 배열
          (fileData 는 uploadFile() 로 올린 파일을 URI 로 참조하는 형태다.
           parts 는 body 에 그대로 실리므로 이 함수는 형태를 따로 구분하지 않는다.)
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

/* ── Files API ──
   인라인(base64)으로 싣기엔 큰 파일을 올리고 URI 로 참조한다.
   반환한 fileUri 를 callGemini 의 parts 에 {fileData:{mimeType,fileUri}} 로 넣으면 된다.

   ⚠️ **이 경로는 실호출로 검증되지 않았다.** 작성 시점에 이 저장소에는
      GEMINI_API_KEY 가 없어 요청을 실제로 보내 볼 수 없었다. 엔드포인트·헤더
      이름·응답 필드는 구글 문서 규격대로 썼으나, 실제 응답이 다를 가능성에 대비해
      실패 시 응답 본문 앞부분을 console.error 로 남긴다(키는 절대 로그에 남기지 않는다).
      첫 실사용 때 로그를 보고 맞춰야 한다.

   업로드 절차(resumable)
     ① POST /upload/v1beta/files
        X-Goog-Upload-Protocol: resumable / X-Goog-Upload-Command: start
        X-Goog-Upload-Header-Content-Length / -Content-Type
        → 응답 헤더 X-Goog-Upload-URL 에 실제 업로드 주소가 온다
     ② POST <그 주소>
        X-Goog-Upload-Command: upload, finalize / X-Goog-Upload-Offset: 0 + 바이트
        → { file: { uri, name, state, ... } }
     ③ state 가 PROCESSING 이면 ACTIVE 가 될 때까지 폴링(최대 60초, 2초 간격)

   반환 { fileUri, mimeType, name } */
const FILE_POLL_INTERVAL_MS = 2000;
const FILE_POLL_TIMEOUT_MS = 60000;

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

async function uploadFile(buffer, mimeType, displayName){
  if(!hasKey()){
    const e = new Error("AI 기능이 설정되지 않았습니다. 관리자에게 GEMINI_API_KEY 등록을 요청하세요.");
    e.statusCode = 503;
    e.publicMessage = "AI 기능 미설정";
    e.aiUnconfigured = true;
    throw e;
  }
  const key = process.env.GEMINI_API_KEY;
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const mime = mimeType || "application/octet-stream";

  // ① 업로드 세션 시작
  let start;
  try{
    start = await fetch(FILES_UPLOAD_URL, {
      method: "POST",
      headers: {
        "x-goog-api-key": key,
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(bytes.length),
        "X-Goog-Upload-Header-Content-Type": mime,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: displayName || "upload" } }),
    });
  }catch(e){
    console.error("[gemini/files] start network", e && e.message);
    throw L.fail(502, "AI 서버에 파일을 올리지 못했습니다.");
  }
  if(!start.ok){
    const t = await start.text().catch(() => "");
    console.error("[gemini/files] start", start.status, t.slice(0, 500));
    if(start.status === 429) throw L.fail(429, "AI 요청이 한도를 초과했습니다. 잠시 후 다시 시도하세요.");
    if(start.status === 403) throw L.fail(502, "AI 키가 거부되었습니다. 키·결제 설정을 확인하세요.");
    throw L.fail(502, "AI 서버에 파일 업로드를 시작하지 못했습니다.");
  }
  const uploadUrl = start.headers.get("x-goog-upload-url") || start.headers.get("X-Goog-Upload-URL");
  if(!uploadUrl){
    console.error("[gemini/files] start 응답에 업로드 URL 헤더가 없다");
    throw L.fail(502, "AI 서버가 업로드 주소를 주지 않았습니다.");
  }

  // ② 바이트 전송 + finalize
  let up;
  try{
    up = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Length": String(bytes.length),
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
      },
      body: bytes,
    });
  }catch(e){
    console.error("[gemini/files] upload network", e && e.message);
    throw L.fail(502, "AI 서버로 파일을 전송하지 못했습니다.");
  }
  const upText = await up.text();
  if(!up.ok){
    console.error("[gemini/files] upload", up.status, upText.slice(0, 500));
    throw L.fail(502, "AI 서버로 파일을 전송하지 못했습니다.");
  }
  let upJson;
  try{ upJson = JSON.parse(upText); }
  catch(e){
    console.error("[gemini/files] upload 응답 파싱 실패:", upText.slice(0, 300));
    throw L.fail(502, "AI 서버의 업로드 응답을 해석하지 못했습니다.");
  }
  let file = upJson.file || upJson;
  if(!file || !file.uri){
    console.error("[gemini/files] 업로드 응답에 uri 가 없다:", upText.slice(0, 300));
    throw L.fail(502, "AI 서버가 파일 주소를 주지 않았습니다.");
  }

  // ③ 처리 대기. name 은 "files/xxxx" 형태로 온다.
  const name = file.name || "";
  const firstUri = file.uri;   // 폴링 응답에 uri 가 빠져 오더라도 참조는 유지한다
  const deadline = Date.now() + FILE_POLL_TIMEOUT_MS;
  while(file.state === "PROCESSING"){
    if(!name){
      console.error("[gemini/files] PROCESSING 인데 name 이 없어 폴링할 수 없다");
      throw L.fail(502, "AI 서버의 파일 처리 상태를 확인할 수 없습니다.");
    }
    if(Date.now() >= deadline){
      throw L.fail(504, "AI 서버가 녹음 파일을 처리하지 못했습니다(대기 시간 초과). 잠시 후 다시 시도하세요.");
    }
    await sleep(FILE_POLL_INTERVAL_MS);
    let poll;
    try{
      // name 이 "files/xxx" 이므로 앞의 files/ 를 중복시키지 않는다.
      const path = name.indexOf("files/") === 0 ? name.slice("files/".length) : name;
      poll = await fetch(FILES_BASE + "/" + encodeURIComponent(path), {
        method: "GET", headers: { "x-goog-api-key": key },
      });
    }catch(e){
      console.error("[gemini/files] poll network", e && e.message);
      throw L.fail(502, "AI 서버의 파일 처리 상태를 확인하지 못했습니다.");
    }
    const pollText = await poll.text();
    if(!poll.ok){
      console.error("[gemini/files] poll", poll.status, pollText.slice(0, 500));
      throw L.fail(502, "AI 서버의 파일 처리 상태를 확인하지 못했습니다.");
    }
    try{ file = JSON.parse(pollText); }
    catch(e){
      console.error("[gemini/files] poll 응답 파싱 실패:", pollText.slice(0, 300));
      throw L.fail(502, "AI 서버의 파일 처리 응답을 해석하지 못했습니다.");
    }
    if(file && file.file) file = file.file;   // 응답이 한 겹 감싸여 오는 경우 대비
  }
  if(file.state === "FAILED"){
    console.error("[gemini/files] state FAILED:", JSON.stringify(file.error || {}).slice(0, 300));
    throw L.fail(502, "AI 서버가 녹음 파일을 처리하지 못했습니다. 파일 형식을 확인하세요.");
  }

  return { fileUri: file.uri || firstUri, mimeType: file.mimeType || mime, name: file.name || name };
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

/* 상담 초안: 전사문을 요약·유형·논점·후속 조치로 정돈한다(api/counsel-draft.js).

   ★ category 의 enum 은 세 곳이 **같은 값이어야 한다.**
       · DB check 제약   db/migrations/0001_baseline.sql:163
       · 프런트 목록     js/views/counseling.js 의 COUNSEL_CATS
       · 여기(모델에게 주는 enum)
     하나라도 어긋나면 모델이 고른 유형이 저장 단계에서 조용히 튕긴다. 지금은 제안까지만
     하므로 바로 저장되지는 않지만, 어긋난 값을 강사에게 보여 주는 것 자체가 잘못된 안내다.

   student_safe_text 는 학생에게 그대로 보여도 되는 문장이다 — 제3자 언급·민감한 표현을
   걷어낸 판본이며, 확정 내용(content)과는 다른 글이다. */
const COUNSEL_CATS = ["정기상담", "학부모상담", "진로·지원상담", "기타"];

const COUNSEL_DRAFT_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING", description: "상담 내용 3~5문장 요약. 전사문에 있는 사실만 쓴다." },
    category: { type: "STRING", enum: COUNSEL_CATS, description: "상담 유형 제안" },
    key_points: { type: "ARRAY", items: { type: "STRING" }, description: "주요 논점 3~6개" },
    follow_ups: { type: "ARRAY", items: { type: "STRING" }, description: "후속 조치 후보. 없으면 빈 배열." },
    student_safe_text: { type: "STRING", description: "학생에게 공개해도 되는 문장" },
  },
  required: ["summary", "category", "key_points", "follow_ups", "student_safe_text"],
};

module.exports = {
  callGemini, uploadFile, hasKey, model, gradingMode, estimateCost,
  priceIn, priceOut, PROMPT_VERSION,
  TRANSCRIBE_SCHEMA, buildGradeSchema, COUNSEL_DRAFT_SCHEMA, COUNSEL_CATS,
};
