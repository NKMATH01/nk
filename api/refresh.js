/* ═══════════════════════════════════════════════════════════════════
   POST /api/refresh   (Authorization: Bearer <아직 유효한 토큰>)
     →  { token, role, student_id, phone, exp, tv }

   토큰 수명이 7일로 짧아졌기 때문에, 남은 수명이 얼마 안 남았을 때
   클라이언트가 앱 진입 시 한 번 호출해 조용히 연장한다.

   만료된 토큰으로는 갱신할 수 없다(requireAuth 가 거부) — 재로그인이 필요하다.
   DB 의 token_version 과 토큰의 tv 가 다르면 강제 로그아웃된 세션이므로 거부한다.
   ═══════════════════════════════════════════════════════════════════ */
"use strict";
const L = require("./_lib.js");

module.exports = async function handler(req, res){
  try{
    if(req.method !== "POST"){
      res.setHeader("Allow", "POST");
      return L.sendJson(res, 405, { error: "POST 요청만 허용됩니다." });
    }

    const auth = L.requireAuth(req);

    const rows = await L.sbRest(
      "accounts?id=eq." + L.eqParam(auth.sub) +
      "&select=id,phone,role,student_id,token_version&limit=1"
    );
    const acc = Array.isArray(rows) && rows.length ? rows[0] : null;
    if(!acc) throw L.fail(401, "계정을 찾을 수 없습니다. 다시 로그인하세요.");

    // 비밀번호 유출 등으로 관리자가 token_version 을 올렸다면 기존 토큰은 무효.
    const tv = acc.token_version == null ? 1 : Number(acc.token_version);
    if(Number(auth.tv) !== tv){
      throw L.fail(401, "세션이 무효화되었습니다. 다시 로그인하세요.");
    }

    const claims = L.buildClaims(acc);
    const signed = L.signJwt(claims, L.env("SUPABASE_JWT_SECRET"), L.TOKEN_TTL_SEC);

    return L.sendJson(res, 200, {
      token: signed.token,
      role: acc.role,
      student_id: acc.student_id || null,
      phone: acc.phone,
      exp: signed.exp,
      tv: claims.tv,
    });
  }catch(e){
    return L.sendError(res, e, "세션 갱신 중 오류가 발생했습니다.");
  }
};
