/* ═══════════════════════════════════════════════════════════════════
   POST /api/counsel-transcribe   { note_id }   (admin 전용)
     →  { ok, ai_status, transcript_len, tokens_in, tokens_out, cost_usd, upload_mode, mime_used }
        인식 실패 시 ok:false · ai_status:'failed' · reason:'unintelligible' · message 가 더 붙는다.
        mime_used 는 어떤 형식으로 Gemini 에 보냈는지다 — 실패 원인을 좁히는 데 쓴다.

   상담 녹음(counseling-audio 버킷)을 받아 **전사문만** 만든다.
   요약·유형 분류·후속 조치 초안은 2차(counsel-draft)라 여기서 하지 않는다.

   왜 서버가 파일을 직접 읽는가
     Vercel 함수의 요청 본문 상한은 4.5MB 다. 상담 녹음은 쉽게 넘는다.
     브라우저가 Storage 로 바로 올리고, 여기서는 service_role 로 바이트를
     내려받는다(L.storageDownload) — 이 상한과 무관해진다.
     Phase 6 답안지 전사가 이미 쓰는 경로다.

   동의 재확인
     프런트에서 버튼을 비활성화하는 것만으로는 방어가 되지 않는다(요청은
     손으로도 만들 수 있다). 학생의 recording_consent 를 서버에서 다시 본다.

   오디오를 Gemini 로 보내는 두 경로
     10MB 이하는 inlineData(base64), 그 위는 Files API 업로드 후 fileUri 참조다.
     실제 상담은 15~20분이고, 휴대폰 기본 128kbps AAC 면 20분에 약 19MB 라
     인라인 상한을 넘는다. 자세한 근거는 아래 INLINE_MAX 주석에 있다.

   실행 시간
     vercel.json 에서 maxDuration 300 으로 올려 두었다. 그래도 초과하면
     ai_status 는 'uploaded' 로 남으므로 강사가 다시 실행하거나 손으로 이어 쓴다.
   ═══════════════════════════════════════════════════════════════════ */
"use strict";
const L = require("./_lib.js");
const G = require("./_gemini.js");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* 오디오 전달 경로의 두 임계값.

   INLINE_MAX (10MB) — 이 이하는 지금까지 쓰던 inlineData(base64) 경로 그대로 간다.
     Files API 경로는 아직 **실호출로 검증되지 않았다**(작성 시점에 API 키가 없었다).
     그래서 확실히 도는 인라인 경로를 작은 파일에 대해 남겨 둔다. Files API 가
     실제로 잘 돌아가는 것을 파일럿에서 확인하면 이 값을 내리면 된다.
     (참고: Gemini 인라인 페이로드 상한은 약 20MB, base64 는 약 1.33배로 부푼다.
      10MB → 약 13.3MB 라 상한 안쪽에 여유 있게 들어온다.)

   MAX_AUDIO (100MB) — 이보다 크면 아예 거부한다. 프런트 상한과 같은 값이다.
     20분 상담은 휴대폰 기본 128kbps AAC 라도 약 19MB 라 한참 여유가 있다. */
const INLINE_MAX = 10 * 1024 * 1024;
const MAX_AUDIO  = 100 * 1024 * 1024;

async function loadNote(id){
  const rows = await L.sbRest(
    "counseling_notes?id=eq." + L.eqParam(id) +
    "&select=id,student_id,audio_path,ai_status&limit=1");
  const n = Array.isArray(rows) && rows.length ? rows[0] : null;
  if(!n) throw L.fail(404, "상담 기록을 찾을 수 없습니다.");
  return n;
}

async function patchNote(id, patch){
  await L.sbRest("counseling_notes?id=eq." + L.eqParam(id), {
    method: "PATCH", body: patch, headers: { Prefer: "return=minimal" },
  });
}

/* 고유명사 힌트. 학원 상담은 대학명 오인식이 잦아 정확도에 직접 영향을 준다.
   조회에 실패해도 전사는 진행한다 — 힌트는 보조일 뿐이다. */
async function univHint(){
  try{
    const rows = await L.sbRest("universities?select=name");
    if(!Array.isArray(rows) || !rows.length) return "";
    const names = [...new Set(rows.map(r => r && r.name).filter(Boolean))];
    return names.length ? names.join(", ") : "";
  }catch(e){
    console.error("[counsel-transcribe] 대학명 힌트 조회 실패(무시):", e && e.message);
    return "";
  }
}

function buildSystemInstruction(univNames){
  const lines = [
    "너는 학원 상담 녹음을 받아 적는 전사기다. 한국어 음성을 한국어 텍스트로 옮긴다.",
    "들리지 않는 것을 지어내지 마라. 요약·해석·평가를 덧붙이지 마라.",
    "",
    "[자주 등장하는 용어]",
    "약술형 논술, 수시, 정시, 내신, 학생부교과, 학생부종합, 논술전형, 최저학력기준, 모의고사, 주간테스트",
  ];
  if(univNames){
    lines.push("");
    lines.push("[등장할 수 있는 대학명 — 비슷하게 들리면 이 표기를 따르라]");
    lines.push(univNames);
  }
  return lines.join("\n");
}

/* ★ 조용한 실패 차단.

   실측(2026-08-07): 같은 음성을 m4a(AAC/MP4)로 올리면 Gemini 가 전사문 대신
   '[불명]' 4자만 돌려준다. 같은 음성의 wav 는 345자, webm/opus 는 346자였다.
   그런데 응답 자체는 정상이라 지금까지는 ai_status='transcribed' 로 기록되고
   화면에도 "전사 완료" 로 표시됐다 — 강사는 전사가 됐다고 믿는다.

   그래서 저장 전에 **실질 내용**을 센다. '[불명]' 표기와 공백을 걷어낸 길이다.
   전사문이 '[불명]' 의 반복뿐이면 이 값이 0 에 수렴하므로 같은 자로 잡힌다.
   10자 미만은 failed 로 본다 — "네 알겠습니다"(실질 6자) 같은 진짜 짧은 녹음도 여기
   걸리지만, 그 정도 길이는 상담 기록으로 쓸 수 없고 **전사문을 함께 저장하므로**
   강사가 열어 보면 무엇이 나왔는지 그대로 확인할 수 있다. 잃는 것은 없다. */
const MIN_REAL_CHARS = 10;
function realLen(t){ return String(t || "").replace(/\[불명\]/g, "").replace(/\s+/g, "").length; }
const UNINTELLIGIBLE_MSG =
  "오디오를 알아듣지 못했습니다. 형식이 지원되지 않거나 소리가 녹음되지 않았을 수 있습니다. "
  + "wav·webm·mp3 형식을 권장합니다.";

const TRANSCRIBE_PROMPT = [
  "이 오디오는 학원 강사와 학생(또는 학부모)의 상담 녹음이다.",
  "들린 그대로 한국어로 받아 적어라. 다음을 반드시 지켜라.",
  "1. 요약·해석·추측을 하지 마라. 말하지 않은 내용을 채워 넣지 마라.",
  "2. 알아들을 수 없는 구간은 [불명] 으로 표기하라.",
  "3. 화자 구분은 시도하지 마라. 이름표나 'A:', 'B:' 같은 표시를 붙이지 않는다.",
  "4. 제목·머리말·따옴표 없이 전사문 본문만 출력하라.",
].join("\n");

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
    if(!note.audio_path) throw L.fail(400, "이 기록에는 녹음 파일이 없습니다.");

    // 동의 재확인 — 프런트 비활성만 믿지 않는다.
    const st = await L.sbRest(
      "students?id=eq." + L.eqParam(note.student_id) + "&select=recording_consent&limit=1");
    const consent = Array.isArray(st) && st.length ? st[0].recording_consent : false;
    if(!consent) throw L.fail(403, "녹음 동의가 등록되지 않은 학생입니다.");

    // 여기서부터가 "전사 시도" 다. 앞선 검증 실패(동의 없음 등)는 전사 실패가
    // 아니므로 ai_status 를 failed 로 덮지 않는다(아래 catch 가 noteId 로 판단).
    noteId = note.id;
    const f = await L.storageDownload("counseling-audio", note.audio_path);
    const size = f.buffer.length;
    if(size > MAX_AUDIO){
      throw L.fail(400, "녹음이 너무 깁니다(" + (size / 1048576).toFixed(1) + "MB). "
        + Math.round(MAX_AUDIO / 1048576) + "MB 이하로 나눠서 올려 주세요.");
    }
    const sysInstruction = buildSystemInstruction(await univHint());

    // 10MB 이하는 검증된 인라인 경로, 그 위는 Files API 로 올려 URI 로 참조한다.
    // 어느 쪽을 탔는지 응답에 실어 보낸다 — 파일럿 실측 때 이 값이 있어야
    // 미검증 경로가 실제로 도는지 판단할 수 있다.
    let audioPart, uploadMode;
    if(size <= INLINE_MAX){
      audioPart = { inlineData: { mimeType: f.mime, data: f.buffer.toString("base64") } };
      uploadMode = "inline";
    }else{
      const up = await G.uploadFile(f.buffer, f.mime, "counsel-" + note.id);
      audioPart = { fileData: { mimeType: up.mimeType, fileUri: up.fileUri } };
      uploadMode = "files_api";
    }

    // 전사는 평문이다 — schema 를 주지 않는다(JSON 으로 감싸면 긴 텍스트가 잘리기 쉽다).
    // maxOutputTokens 32768: 한국어 전사문은 대략 1토큰당 1.5~2자라, 8192 면 5~6천 자
    // (말로 10~15분)에서 끊긴다. 상한에 걸리면 _gemini.js 가 MAX_TOKENS 로 판정해
    // **전사문을 통째로 버리므로**, 20~30분 상담이 전부 실패한다. 32768 이면 40분 안팎까지 든다.
    // 실제 상담 길이인 15~20분은 전사문이 대략 8,000~12,000 토큰이라 여유가 크다.
    const r = await G.callGemini([
      audioPart,
      { text: TRANSCRIBE_PROMPT },
    ], { maxOutputTokens: 32768, temperature: 0, systemInstruction: sysInstruction });

    // 차단은 정상적인 결과의 하나다(Phase 6 관례). 예외를 던지지 않고 상태로 남긴다.
    if(!r.ok){
      await patchNote(note.id, { ai_status: "blocked" });
      return L.sendJson(res, 200, {
        ok: false, ai_status: "blocked", blocked: r.blocked, transcript_len: 0,
        tokens_in: r.tokensIn, tokens_out: r.tokensOut, cost_usd: r.costUsd,
        upload_mode: uploadMode, mime_used: f.mime,
      });
    }

    const transcript = (r.text || "").trim();
    const real = realLen(transcript);

    // 인식 실패. 차단과 마찬가지로 예외를 던지지 않고 **상태로** 남긴다(Phase 6 관례).
    // 전사문도 함께 저장한다 — 강사가 무엇이 나왔는지 눈으로 봐야 원인을 좁힐 수 있다.
    if(real < MIN_REAL_CHARS){
      await patchNote(note.id, { transcript: transcript || null, ai_status: "failed" });
      return L.sendJson(res, 200, {
        ok: false, ai_status: "failed", reason: "unintelligible", message: UNINTELLIGIBLE_MSG,
        transcript_len: transcript.length, real_len: real,
        tokens_in: r.tokensIn, tokens_out: r.tokensOut, cost_usd: r.costUsd,
        upload_mode: uploadMode, mime_used: f.mime,
      });
    }

    await patchNote(note.id, { transcript: transcript, ai_status: "transcribed" });
    return L.sendJson(res, 200, {
      ok: true, ai_status: "transcribed", transcript_len: transcript.length,
      tokens_in: r.tokensIn, tokens_out: r.tokensOut, cost_usd: r.costUsd,
      upload_mode: uploadMode, mime_used: f.mime,
    });
  }catch(e){
    // 실패 사실을 행에 남긴다 — 강사가 이어받을 수 있어야 한다. 행은 지우지 않는다.
    // 키 미설정(503)은 _gemini.js 가 이미 처리하므로 상태를 덮어쓰지 않는다.
    if(noteId && !(e && e.aiUnconfigured)){
      try{ await patchNote(noteId, { ai_status: "failed" }); }
      catch(e2){ console.error("[counsel-transcribe] 상태 기록 실패:", e2 && e2.message); }
    }
    return L.sendError(res, e, "전사 중 오류가 발생했습니다.");
  }
};
