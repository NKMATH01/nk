/* ═══════════════════════════════════════════════════════════════════
   POST /api/login  { phone, password }
     →  { token, role, student_id, phone, exp, tv }

   토큰은 Supabase 레거시 JWT 시크릿으로 서명한다. 따라서 이 토큰 하나로
   서버 함수 인증과 PostgREST/RLS 판별이 모두 이뤄진다(별도 Auth 사용자 없음).

   비밀번호는 scrypt 로 저장한다. 과거 sha256(전화번호+비번) 계정은 로그인에
   성공한 시점에 조용히 scrypt 로 재해시한다(lazy rehash) — 사용자는 비밀번호를
   바꿀 필요가 없고, 한 번 로그인하면 자동으로 강화된다.
   ═══════════════════════════════════════════════════════════════════ */
"use strict";
const L = require("./_lib.js");

const LOGIN_FAIL_MSG = "전화번호 또는 비밀번호가 올바르지 않습니다.";

module.exports = async function handler(req, res){
  try{
    if(req.method !== "POST"){
      res.setHeader("Allow", "POST");
      return L.sendJson(res, 405, { error: "POST 요청만 허용됩니다." });
    }

    const body = await L.readJsonBody(req);
    const phone = L.normPhone(body && body.phone);
    const password = body && body.password;

    if(!phone || !password || typeof password !== "string"){
      return L.sendJson(res, 400, { error: "전화번호와 비밀번호를 입력하세요." });
    }

    const rows = await L.sbRest(
      "accounts?phone=eq." + L.eqParam(phone) +
      "&select=id,phone,role,student_id,password_hash,token_version,hash_alg&limit=1"
    );
    const acc = Array.isArray(rows) && rows.length ? rows[0] : null;

    // 계정이 없어도 동일한 비용의 scrypt 를 돌려 응답 시간 차이를 없앤다.
    if(!acc){
      L.verifyScrypt(L.DUMMY_SCRYPT, password);
      return L.sendJson(res, 401, { error: LOGIN_FAIL_MSG });
    }

    const check = L.verifyPassword(acc.password_hash, acc.hash_alg, acc.phone, password);
    if(!check.ok) return L.sendJson(res, 401, { error: LOGIN_FAIL_MSG });

    // 레거시 해시였다면 이 시점에 scrypt 로 올린다. 실패해도 로그인은 계속 진행한다.
    if(check.needsRehash){
      try{
        await L.sbRest("accounts?id=eq." + L.eqParam(acc.id), {
          method: "PATCH",
          body: { password_hash: L.hashScrypt(password), hash_alg: L.HASH_ALG_SCRYPT },
          headers: { Prefer: "return=minimal" },
        });
      }catch(e){
        console.error("[api] scrypt 재해시 실패(로그인은 계속):", e && e.message);
      }
    }

    const claims = L.buildClaims(acc);
    const signed = L.signJwt(claims, L.env("SUPABASE_JWT_SECRET"), L.TOKEN_TTL_SEC);

    return L.sendJson(res, 200, {
      token: signed.token,
      role: acc.role,                       // 앱 역할(화면 분기용)
      student_id: acc.student_id || null,
      phone: acc.phone,
      exp: signed.exp,
      tv: claims.tv,
    });
  }catch(e){
    return L.sendError(res, e, "로그인 처리 중 오류가 발생했습니다.");
  }
};
