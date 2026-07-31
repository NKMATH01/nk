/* ═══════════════════════════════════════════════════════════════════
   POST /api/parent-link   { student_id, days }   (admin 전용)
     →  { url, expiresAt, phone }

   학부모가 비밀번호 없이 자녀 리포트를 볼 수 있는 링크를 만든다.
   토큰은 **해당 학부모 계정의 클레임 그대로** 발급된다 — 새 권한을 만드는
   것이 아니라 이미 있는 계정으로 로그인한 것과 같은 상태다.
   따라서 학부모 계정이 없으면 발급하지 않는다(권한 없는 토큰을 만들지 않기 위함).

   토큰의 tv 는 그 계정의 token_version 이라, 계정 token_version 을 올리면
   이미 뿌린 링크도 한 번에 무효화된다.

   URL 에는 토큰 외의 개인정보를 넣지 않는다.
   ═══════════════════════════════════════════════════════════════════ */
"use strict";
const L = require("./_lib.js");

const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* 배포 주소. 환경변수가 없으면 요청 헤더에서 유추한다(프리뷰 배포 대응). */
function baseUrl(req){
  if(process.env.PUBLIC_BASE_URL) return String(process.env.PUBLIC_BASE_URL).replace(/\/+$/, "");
  const host = (req.headers && (req.headers["x-forwarded-host"] || req.headers.host)) || "";
  const proto = (req.headers && req.headers["x-forwarded-proto"]) || "https";
  return host ? proto + "://" + host : "";
}

module.exports = async function handler(req, res){
  try{
    if(req.method !== "POST"){
      res.setHeader("Allow", "POST");
      return L.sendJson(res, 405, { error: "POST 요청만 허용됩니다." });
    }
    L.requireAdmin(req);

    const body = await L.readJsonBody(req);
    const sid = body && body.student_id;
    if(!sid || !UUID_RE.test(String(sid))) throw L.fail(400, "student_id(uuid)가 필요합니다.");

    let days = Number(body.days) || DEFAULT_DAYS;
    if(!Number.isFinite(days) || days < 1) days = DEFAULT_DAYS;
    if(days > MAX_DAYS) days = MAX_DAYS;

    // 해당 학생의 학부모 계정을 찾는다. 없으면 링크를 만들지 않는다.
    const accs = await L.sbRest(
      "accounts?student_id=eq." + L.eqParam(sid) + "&role=eq.parent" +
      "&select=id,phone,role,student_id,token_version&limit=1");
    const acc = Array.isArray(accs) && accs.length ? accs[0] : null;
    if(!acc){
      throw L.fail(400, "이 학생의 학부모 계정이 없습니다. [학생 관리]에서 학부모 계정을 먼저 발급하세요.");
    }

    const claims = L.buildClaims(acc);
    const signed = L.signJwt(claims, L.env("SUPABASE_JWT_SECRET"), days * 24 * 60 * 60);

    const base = baseUrl(req);
    const url = (base || "") + "/?ptoken=" + encodeURIComponent(signed.token);

    return L.sendJson(res, 200, {
      url: url,
      expiresAt: new Date(signed.exp * 1000).toISOString(),
      days: days,
      phone: acc.phone,
    });
  }catch(e){
    return L.sendError(res, e, "학부모 링크 발급 중 오류가 발생했습니다.");
  }
};
