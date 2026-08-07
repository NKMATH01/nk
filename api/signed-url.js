/* ═══════════════════════════════════════════════════════════════════
   POST /api/signed-url   { path, bucket }   (Authorization: Bearer <토큰>)
     →  { signedUrl, expiresIn }

   private 버킷의 파일을 10분짜리 서명 URL 로만 열람하게 한다.

   버킷별 권한
     grading-photos (기본)
       admin           : 전체 허용
       student/parent  : 경로가 자기 student_id 에 속할 때만 허용
     problem-images
       admin 전용. 기출 원문 저작권 통제 때문에 학생·학부모는 아예 차단한다.
     counseling-audio
       admin 전용. 상담 녹음에는 제3자 이야기와 미확정 판단이 섞여 있어
       학생·학부모에게는 어떤 경우에도 열어 주지 않는다.

   경로 규칙
     신규 업로드  <student_id>/<question_id>_<timestamp>.<ext>
     레거시       q<question_id>_s<student_id>_<timestamp>.<ext>
   둘 다 학생 id 를 뽑아낼 수 있어야 하므로 아래 pathStudentId 가 양쪽을 처리한다.

   토큰 검사는 서명만으로 끝내지 않는다 — 강제 로그아웃된 세션은 토큰이
   만료 전이어도 거부한다(assertTokenFresh).
   ═══════════════════════════════════════════════════════════════════ */
"use strict";
const L = require("./_lib.js");

const DEFAULT_BUCKET = "grading-photos";
// 허용 목록 방식 — 여기 없는 버킷 이름은 거부한다(임의 버킷 열람 방지).
const BUCKETS = {
  "grading-photos": { adminOnly: false },
  "problem-images": { adminOnly: true },
  "counseling-audio": { adminOnly: true },
};
const EXPIRES_IN = 600;   // 10분
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* 저장 경로에서 소유 학생 id 를 추출한다. 못 찾으면 null(=관리자만 열람 가능). */
function pathStudentId(path){
  const slash = path.indexOf("/");
  if(slash > 0){
    const head = path.slice(0, slash);
    if(UUID_RE.test(head)) return head.toLowerCase();
  }
  const m = /_s([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_/i.exec(path);
  return m ? m[1].toLowerCase() : null;
}

/* 경로 검증: 상위 디렉터리 탈출·절대경로·쿼리스트링을 막는다. */
function normalizePath(raw){
  const p = String(raw || "").trim();
  if(!p) throw L.fail(400, "path 가 필요합니다.");
  if(p.length > 512) throw L.fail(400, "경로가 너무 깁니다.");
  if(p.startsWith("/") || p.includes("..") || p.includes("\\") || p.includes("?") || p.includes("#")){
    throw L.fail(400, "경로 형식이 올바르지 않습니다.");
  }
  return p;
}

module.exports = async function handler(req, res){
  try{
    if(req.method !== "POST"){
      res.setHeader("Allow", "POST");
      return L.sendJson(res, 405, { error: "POST 요청만 허용됩니다." });
    }

    const auth = L.requireAuth(req);
    await L.assertTokenFresh(auth);
    const body = await L.readJsonBody(req);
    const path = normalizePath(body && body.path);

    const bucket = String((body && body.bucket) || DEFAULT_BUCKET);
    const rule = Object.prototype.hasOwnProperty.call(BUCKETS, bucket) ? BUCKETS[bucket] : null;
    if(!rule) throw L.fail(400, "알 수 없는 버킷입니다.");

    const isAdmin = auth.app_role === "admin";
    if(rule.adminOnly){
      if(!isAdmin) throw L.fail(403, "이 파일을 볼 권한이 없습니다.");
    }else if(!isAdmin){
      const owner = pathStudentId(path);
      if(!owner || !auth.student_id || owner !== String(auth.student_id).toLowerCase()){
        throw L.fail(403, "이 파일을 볼 권한이 없습니다.");
      }
    }

    const out = await L.storageRest("object/sign/" + bucket + "/" + path, {
      method: "POST",
      body: { expiresIn: EXPIRES_IN },
    });
    // Storage 는 "/object/sign/<bucket>/<path>?token=..." 형태의 상대 경로를 준다.
    const rel = out && (out.signedURL || out.signedUrl);
    if(!rel) throw L.fail(502, "서명 URL 을 받지 못했습니다.");
    const full = L.env("SUPABASE_URL").replace(/\/+$/, "") + "/storage/v1" +
      (rel.startsWith("/") ? rel : "/" + rel);

    return L.sendJson(res, 200, { signedUrl: full, expiresIn: EXPIRES_IN });
  }catch(e){
    return L.sendError(res, e, "서명 URL 발급 중 오류가 발생했습니다.");
  }
};
