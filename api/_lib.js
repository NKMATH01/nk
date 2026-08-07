/* ═══════════════════════════════════════════════════════════════════
   api/_lib.js — Vercel Node 함수 공용 유틸 (의존성 0)
   내장 node:crypto 와 전역 fetch 만 사용한다. npm 패키지·빌드 스텝 없음.
   파일명이 _ 로 시작하므로 Vercel 라우트로 노출되지 않는다.
   ═══════════════════════════════════════════════════════════════════ */
"use strict";
const crypto = require("node:crypto");

const SESSION_DAYS = 30;                       // (구) Phase 1 세션 수명 — 참고용
const TOKEN_DAYS = 7;                          // 토큰 수명. 탈취 시 노출 창을 줄이려고 단축했다.
const TOKEN_TTL_SEC = TOKEN_DAYS * 24 * 60 * 60;

/* ─── 환경변수 ───
   미설정 시 명확한 메시지와 함께 던진다. 호출부에서 500으로 변환한다. */
function env(name){
  const v = process.env[name];
  if(!v){
    const e = new Error("환경변수 "+name+" 가 설정되지 않았습니다. Vercel 프로젝트 Settings → Environment Variables 에서 추가하세요.");
    e.statusCode = 500;
    e.isConfigError = true;
    throw e;
  }
  return v;
}

/* ─── 응답 ─── */
function sendJson(res, status, body){
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

/* 예외를 상태코드로 변환. 설정 오류는 서버 로그에 원문을 남긴다. */
function sendError(res, e, fallbackMsg){
  const status = e && e.statusCode ? e.statusCode : 500;
  if(status >= 500) console.error("[api]", e);
  sendJson(res, status, { error: (e && e.publicMessage) || (e && e.isConfigError ? e.message : null) || fallbackMsg || "서버 오류가 발생했습니다." });
}

function fail(status, publicMessage){
  const e = new Error(publicMessage);
  e.statusCode = status;
  e.publicMessage = publicMessage;
  return e;
}

/* ─── 요청 본문 ───
   Vercel 은 application/json 요청의 본문을 req.body 로 파싱해 주지만,
   런타임에 따라 문자열이거나 비어 있을 수 있어 세 경우를 모두 처리한다. */
async function readJsonBody(req){
  if(req.body && typeof req.body === "object") return req.body;
  if(typeof req.body === "string" && req.body.length){
    try{ return JSON.parse(req.body); }catch(e){ throw fail(400, "요청 본문이 올바른 JSON이 아닙니다."); }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if(!chunks.length) return {};
  try{ return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch(e){ throw fail(400, "요청 본문이 올바른 JSON이 아닙니다."); }
}

/* ─── 문자열 유틸 ─── */
// js/util.js 의 normPhone 과 동일한 규칙(숫자만 남김)을 유지해야 한다.
function normPhone(s){ return String(s == null ? "" : s).replace(/[^0-9]/g, ""); }

// [레거시] Phase 1 까지 쓰던 방식: SHA-256(정규화전화번호 + 비밀번호).
// 솔트가 전화번호라 사실상 없는 것과 같고 계산이 너무 빨라 무차별 대입에 약하다.
// 새로 저장하지 않으며, 로그인 성공 시 scrypt 로 재해시(lazy rehash)한다.
function hashPassword(phone, password){
  return crypto.createHash("sha256").update(normPhone(phone) + String(password), "utf8").digest("hex");
}

// 길이가 다르면 timingSafeEqual 이 던지므로 먼저 걸러낸다(길이는 비밀이 아님).
function safeEqualHex(a, b){
  const ba = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if(ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/* ─── scrypt 비밀번호 해시 ───
   내장 node:crypto 만 사용한다(의존성 0 원칙 — bcrypt/argon2 패키지 미도입).
   저장 포맷: scrypt$N$r$p$saltBase64$hashBase64  */
const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, SCRYPT_KEYLEN = 32;
const SCRYPT_MAXMEM = 96 * 1024 * 1024;   // 128*N*r = 16MB. 여유 있게 잡는다.
const HASH_ALG_LEGACY = "sha256";
const HASH_ALG_SCRYPT = "scrypt";

function hashScrypt(password){
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN,
    { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM });
  return [HASH_ALG_SCRYPT, SCRYPT_N, SCRYPT_R, SCRYPT_P,
    salt.toString("base64"), dk.toString("base64")].join("$");
}

function verifyScrypt(stored, password){
  const parts = String(stored || "").split("$");
  if(parts.length !== 6 || parts[0] !== HASH_ALG_SCRYPT) return false;
  const N = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
  if(!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p) || N < 2 || r < 1 || p < 1) return false;
  let salt, expected;
  try{
    salt = Buffer.from(parts[4], "base64");
    expected = Buffer.from(parts[5], "base64");
  }catch(e){ return false; }
  if(!salt.length || !expected.length) return false;
  let dk;
  try{
    dk = crypto.scryptSync(String(password), salt, expected.length,
      { N: N, r: r, p: p, maxmem: SCRYPT_MAXMEM });
  }catch(e){ return false; }
  if(dk.length !== expected.length) return false;
  return crypto.timingSafeEqual(dk, expected);
}

/* 계정 존재 여부가 응답 시간으로 새지 않도록, 계정이 없을 때도 같은 비용의
   scrypt 연산을 돌리기 위한 더미 해시. 모듈 로드 시 1회만 만든다. */
const DUMMY_SCRYPT = hashScrypt(crypto.randomBytes(24).toString("hex"));

/* 저장된 해시가 어떤 방식이든 검증한다. 반환값의 needsRehash 가 true 면
   호출부가 scrypt 로 재해시해 저장해야 한다. */
function verifyPassword(stored, hashAlg, phone, password){
  if(hashAlg === HASH_ALG_SCRYPT || String(stored || "").startsWith(HASH_ALG_SCRYPT + "$")){
    return { ok: verifyScrypt(stored, password), needsRehash: false };
  }
  const ok = safeEqualHex(hashPassword(phone, password), stored);
  return { ok: ok, needsRehash: ok };
}

/* ─── JWT (HS256, 직접 구현) ─── */
function b64urlEncode(buf){
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str){
  const s = String(str).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(s + "=".repeat((4 - (s.length % 4)) % 4), "base64");
}
function hmac(data, secret){
  return crypto.createHmac("sha256", secret).update(data, "utf8").digest();
}

function signJwt(payload, secret, ttlSeconds){
  const now = Math.floor(Date.now() / 1000);
  const body = Object.assign({}, payload, { iat: now, exp: now + ttlSeconds });
  const head = b64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const data = head + "." + b64urlEncode(JSON.stringify(body));
  return { token: data + "." + b64urlEncode(hmac(data, secret)), exp: body.exp };
}

// 유효하면 payload, 아니면 null. 서명·만료를 모두 검사한다.
function verifyJwt(token, secret){
  if(!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if(parts.length !== 3) return null;
  const data = parts[0] + "." + parts[1];
  const expected = hmac(data, secret);
  const got = b64urlDecode(parts[2]);
  if(got.length !== expected.length) return null;
  if(!crypto.timingSafeEqual(got, expected)) return null;
  let payload;
  try{ payload = JSON.parse(b64urlDecode(parts[1]).toString("utf8")); }
  catch(e){ return null; }
  if(!payload || typeof payload.exp !== "number") return null;
  if(payload.exp <= Math.floor(Date.now() / 1000)) return null;
  return payload;
}

/* Authorization: Bearer <token> 검증. 실패 시 401 을 던진다.
   서명 키는 Supabase 레거시 JWT 시크릿이다 — 같은 토큰을 PostgREST 도 검증하므로
   서버 함수와 DB(RLS)가 동일한 키·동일한 클레임을 본다. */
function requireAuth(req){
  const h = req.headers && (req.headers.authorization || req.headers.Authorization);
  const m = /^Bearer\s+(.+)$/i.exec(String(h || ""));
  if(!m) throw fail(401, "로그인이 필요합니다.");
  const payload = verifyJwt(m[1].trim(), env("SUPABASE_JWT_SECRET"));
  if(!payload) throw fail(401, "세션이 만료되었습니다. 다시 로그인하세요.");
  return payload;
}

// 앱 역할은 app_role 클레임에 있다(role 은 PostgREST 용 'authenticated' 고정).
function requireAdmin(req){
  const p = requireAuth(req);
  if(p.app_role !== "admin") throw fail(403, "관리자만 사용할 수 있습니다.");
  return p;
}

/* 토큰의 tv 가 DB 의 현재 token_version 과 같은지 확인한다.
   requireAuth 는 서명만 보므로, 강제 로그아웃(token_version+1)된 세션도
   만료 전까지는 통과한다. 민감한 자료를 다루는 경로에서는 이 검사를 덧붙인다.
   DB 왕복이 1회 늘어나므로 모든 경로에 붙이지는 않는다. */
async function assertTokenFresh(auth){
  const rows = await sbRest(
    "accounts?id=eq." + eqParam(auth.sub) + "&select=id,token_version&limit=1"
  );
  const acc = Array.isArray(rows) && rows.length ? rows[0] : null;
  if(!acc) throw fail(401, "계정을 찾을 수 없습니다. 다시 로그인하세요.");
  const tv = acc.token_version == null ? 1 : Number(acc.token_version);
  if(Number(auth.tv) !== tv) throw fail(401, "세션이 무효화되었습니다. 다시 로그인하세요.");
  return auth;
}

/* ─── Supabase REST (service_role) ───
   service_role 키는 RLS 를 우회하므로 절대 클라이언트로 내보내지 않는다. */
async function sbRest(path, options){
  const url = env("SUPABASE_URL").replace(/\/+$/, "") + "/rest/v1/" + path.replace(/^\/+/, "");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const opt = options || {};
  const headers = Object.assign({
    apikey: key,
    Authorization: "Bearer " + key,
    "Content-Type": "application/json",
    Accept: "application/json",
  }, opt.headers || {});
  const res = await fetch(url, { method: opt.method || "GET", headers, body: opt.body ? JSON.stringify(opt.body) : undefined });
  const text = await res.text();
  if(!res.ok){
    console.error("[api] supabase", res.status, text);
    throw fail(502, "데이터베이스 요청에 실패했습니다.");
  }
  if(!text) return null;
  try{ return JSON.parse(text); }catch(e){ return null; }
}

/* Storage API(/storage/v1/...) 호출. service_role 로 서명 URL 을 만들 때 쓴다. */
async function storageRest(path, options){
  const base = env("SUPABASE_URL").replace(/\/+$/, "");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const opt = options || {};
  const res = await fetch(base + "/storage/v1/" + path.replace(/^\/+/, ""), {
    method: opt.method || "GET",
    headers: Object.assign({
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    }, opt.headers || {}),
    body: opt.body ? JSON.stringify(opt.body) : undefined,
  });
  const text = await res.text();
  if(!res.ok){
    console.error("[api] storage", res.status, text);
    if(res.status === 404) throw fail(404, "파일을 찾을 수 없습니다.");
    throw fail(502, "파일 서명 요청에 실패했습니다.");
  }
  try{ return JSON.parse(text); }catch(e){ return null; }
}

/* private 버킷의 파일을 서버가 직접 바이트로 읽는다.
   AI 전사는 서명 URL 을 거치지 않는다 — 외부에 노출되는 URL 을 만들 이유가 없고,
   service_role 로 바로 읽는 편이 단계가 적어 실패 지점도 적다. */
async function storageDownload(bucket, path){
  const base = env("SUPABASE_URL").replace(/\/+$/, "");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const url = base + "/storage/v1/object/" + encodeURIComponent(bucket) + "/" +
    String(path).split("/").map(encodeURIComponent).join("/");
  const res = await fetch(url, { headers: { apikey: key, Authorization: "Bearer " + key } });
  if(!res.ok){
    console.error("[api] storageDownload", res.status, await res.text().catch(() => ""));
    if(res.status === 404) throw fail(404, "파일을 찾을 수 없습니다.");
    throw fail(502, "파일을 읽지 못했습니다.");
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get("content-type") || "image/jpeg";
  return { buffer: buf, mime: mime.split(";")[0].trim() };
}

// PostgREST 쿼리 문자열용 값 이스케이프(전화번호는 숫자만이라 실질 위험은 없으나 방어적으로).
function eqParam(v){ return encodeURIComponent(String(v)); }

/* 토큰이 담고 있어야 하는 클레임을 한곳에서 만든다.
   role:'authenticated' 가 없으면 PostgREST 가 anon 으로 처리해 RLS 가 전부 막는다. */
function buildClaims(acc){
  return {
    iss: "yaknon",
    sub: acc.id,
    role: "authenticated",          // PostgREST DB 역할 — 반드시 authenticated
    aud: "authenticated",
    app_role: acc.role,             // 앱 역할(admin/student/parent)
    student_id: acc.student_id || null,
    tv: acc.token_version == null ? 1 : Number(acc.token_version),
  };
}

module.exports = {
  SESSION_DAYS, TOKEN_DAYS, TOKEN_TTL_SEC,
  HASH_ALG_LEGACY, HASH_ALG_SCRYPT, DUMMY_SCRYPT,
  env, sendJson, sendError, fail, readJsonBody,
  normPhone, hashPassword, safeEqualHex,
  hashScrypt, verifyScrypt, verifyPassword,
  signJwt, verifyJwt, requireAuth, requireAdmin, assertTokenFresh, buildClaims,
  sbRest, storageRest, storageDownload, eqParam,
};
