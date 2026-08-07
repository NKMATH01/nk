/* ═══════════════════════════════════════════════════════════════════
   /api/accounts — 계정 조회·발급·비밀번호 변경

   GET  ?student_id=<uuid>                                  (admin 전용)
        → [{ id, phone, role, student_id }]  ※ password_hash 는 절대 반환하지 않는다
   POST { action:'upsert', phone, password, role, student_id }   (admin 전용)
        → { result: 'created' | 'updated' }
   POST { action:'change_password', new_password }               (본인 계정만)
        → { result: 'updated' }

   모든 요청은 Authorization: Bearer <token> 필요.
   ═══════════════════════════════════════════════════════════════════ */
"use strict";
const L = require("./_lib.js");

const ROLES = ["admin", "student", "parent"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_PW = 4;

async function findByPhone(phone){
  const rows = await L.sbRest(
    "accounts?phone=eq." + L.eqParam(phone) + "&select=id,phone,role,student_id&limit=1"
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function handleGet(req, res){
  await L.assertTokenFresh(L.requireAdmin(req));
  const url = new URL(req.url, "http://localhost");
  const sid = url.searchParams.get("student_id");
  if(!sid || !UUID_RE.test(sid)) throw L.fail(400, "student_id(uuid)가 필요합니다.");
  const rows = await L.sbRest(
    "accounts?student_id=eq." + L.eqParam(sid) + "&select=id,phone,role,student_id"
  );
  return L.sendJson(res, 200, { accounts: Array.isArray(rows) ? rows : [] });
}

async function handleUpsert(req, res, body){
  await L.assertTokenFresh(L.requireAdmin(req));
  const phone = L.normPhone(body.phone);
  const role = String(body.role || "");
  const sid = body.student_id ? String(body.student_id) : null;
  const password = body.password;

  if(!phone) throw L.fail(400, "전화번호를 입력하세요.");
  if(ROLES.indexOf(role) === -1) throw L.fail(400, "역할이 올바르지 않습니다.");
  if(sid && !UUID_RE.test(sid)) throw L.fail(400, "student_id 형식이 올바르지 않습니다.");
  if(password != null && (typeof password !== "string" || password.length < MIN_PW)){
    throw L.fail(400, "비밀번호는 " + MIN_PW + "자 이상이어야 합니다.");
  }

  const existing = await findByPhone(phone);

  if(existing){
    // 같은 번호를 다른 사람 계정으로 덮어쓰는 사고를 막는다(클라이언트 기존 규칙 유지).
    if(existing.role !== role || (existing.student_id && sid && existing.student_id !== sid)){
      throw L.fail(409, "이 전화번호는 이미 다른 계정(" + existing.role + ")에서 사용 중입니다. 다른 번호를 입력하세요.");
    }
    const patch = { role: role, student_id: sid || null };
    // 비밀번호를 새로 주면 항상 scrypt 로 저장한다(레거시 sha256 은 더 이상 쓰지 않는다).
    if(password){
      patch.password_hash = L.hashScrypt(password);
      patch.hash_alg = L.HASH_ALG_SCRYPT;
    }
    await L.sbRest("accounts?id=eq." + L.eqParam(existing.id), {
      method: "PATCH", body: patch, headers: { Prefer: "return=minimal" },
    });
    return L.sendJson(res, 200, { result: "updated" });
  }

  if(!password) throw L.fail(400, "새 계정을 만들려면 비밀번호가 필요합니다.");
  await L.sbRest("accounts", {
    method: "POST",
    body: {
      phone: phone,
      password_hash: L.hashScrypt(password),
      hash_alg: L.HASH_ALG_SCRYPT,
      role: role,
      student_id: sid || null,
    },
    headers: { Prefer: "return=minimal" },
  });
  return L.sendJson(res, 201, { result: "created" });
}

async function handleChangePassword(req, res, body){
  const auth = L.requireAuth(req); // 역할 제한 없음 — 단, 토큰의 sub 행만 건드린다.
  await L.assertTokenFresh(auth);
  const np = body.new_password;
  if(typeof np !== "string" || np.length < MIN_PW){
    throw L.fail(400, "비밀번호는 " + MIN_PW + "자 이상이어야 합니다.");
  }
  const rows = await L.sbRest("accounts?id=eq." + L.eqParam(auth.sub) + "&select=id,phone&limit=1");
  const acc = Array.isArray(rows) && rows.length ? rows[0] : null;
  if(!acc) throw L.fail(401, "계정을 찾을 수 없습니다. 다시 로그인하세요.");

  // token_version 은 올리지 않는다 — 본인이 바꾼 것이므로 지금 쓰는 세션은 유지한다.
  await L.sbRest("accounts?id=eq." + L.eqParam(acc.id), {
    method: "PATCH",
    body: { password_hash: L.hashScrypt(np), hash_alg: L.HASH_ALG_SCRYPT },
    headers: { Prefer: "return=minimal" },
  });
  return L.sendJson(res, 200, { result: "updated" });
}

module.exports = async function handler(req, res){
  try{
    if(req.method === "GET") return await handleGet(req, res);

    if(req.method === "POST"){
      const body = await L.readJsonBody(req);
      const action = body && body.action;
      if(action === "upsert") return await handleUpsert(req, res, body);
      if(action === "change_password") return await handleChangePassword(req, res, body);
      throw L.fail(400, "알 수 없는 action 입니다.");
    }

    res.setHeader("Allow", "GET, POST");
    return L.sendJson(res, 405, { error: "GET 또는 POST 요청만 허용됩니다." });
  }catch(e){
    return L.sendError(res, e, "계정 처리 중 오류가 발생했습니다.");
  }
};
