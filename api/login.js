/* ═══════════════════════════════════════════════════════════════════
   POST /api/login  { phone, password }  →  { token, role, student_id, phone, exp }

   비밀번호 해시를 브라우저로 내려보내지 않기 위해 대조를 서버에서 수행한다.
   해시 방식은 현행 유지(SHA-256(전화번호+비밀번호)) — bcrypt 전환은 Phase 3.
   ═══════════════════════════════════════════════════════════════════ */
"use strict";
const L = require("./_lib.js");

// 계정이 없을 때도 같은 양의 해시 연산을 수행해 응답 시간으로 존재 여부가
// 드러나지 않게 한다. 실제 해시와 길이가 같은 더미.
const DUMMY_HASH = "0".repeat(64);
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
      "accounts?phone=eq." + L.eqParam(phone) + "&select=id,phone,role,student_id,password_hash&limit=1"
    );
    const acc = Array.isArray(rows) && rows.length ? rows[0] : null;

    const candidate = L.hashPassword(phone, password);
    const ok = L.safeEqualHex(candidate, acc ? acc.password_hash : DUMMY_HASH) && !!acc;

    // 계정 존재 여부를 구분할 수 없도록 실패 메시지를 통일한다.
    if(!ok) return L.sendJson(res, 401, { error: LOGIN_FAIL_MSG });

    const signed = L.signJwt(
      { sub: acc.id, role: acc.role, student_id: acc.student_id || null, phone: acc.phone },
      L.env("SESSION_JWT_SECRET"),
      L.SESSION_DAYS * 24 * 60 * 60
    );

    return L.sendJson(res, 200, {
      token: signed.token,
      role: acc.role,
      student_id: acc.student_id || null,
      phone: acc.phone,
      exp: signed.exp,
    });
  }catch(e){
    return L.sendError(res, e, "로그인 처리 중 오류가 발생했습니다.");
  }
};
