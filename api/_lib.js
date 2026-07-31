/* ═══════════════════════════════════════════════════════════════════
   api/_lib.js — Vercel Node 함수 공용 유틸 (의존성 0)
   내장 node:crypto 와 전역 fetch 만 사용한다. npm 패키지·빌드 스텝 없음.
   파일명이 _ 로 시작하므로 Vercel 라우트로 노출되지 않는다.
   ═══════════════════════════════════════════════════════════════════ */
"use strict";
const crypto = require("node:crypto");

const SESSION_DAYS = 30;

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
// index.html 의 normPhone 과 동일한 규칙(숫자만 남김)을 유지해야 한다.
function normPhone(s){ return String(s == null ? "" : s).replace(/[^0-9]/g, ""); }

// index.html 의 hashPassword 와 동일: SHA-256(정규화전화번호 + 비밀번호)
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

/* Authorization: Bearer <token> 검증. 실패 시 401 을 던진다. */
function requireAuth(req){
  const h = req.headers && (req.headers.authorization || req.headers.Authorization);
  const m = /^Bearer\s+(.+)$/i.exec(String(h || ""));
  if(!m) throw fail(401, "로그인이 필요합니다.");
  const payload = verifyJwt(m[1].trim(), env("SESSION_JWT_SECRET"));
  if(!payload) throw fail(401, "세션이 만료되었습니다. 다시 로그인하세요.");
  return payload;
}

function requireAdmin(req){
  const p = requireAuth(req);
  if(p.role !== "admin") throw fail(403, "관리자만 사용할 수 있습니다.");
  return p;
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

// PostgREST 쿼리 문자열용 값 이스케이프(전화번호는 숫자만이라 실질 위험은 없으나 방어적으로).
function eqParam(v){ return encodeURIComponent(String(v)); }

module.exports = {
  SESSION_DAYS,
  env, sendJson, sendError, fail, readJsonBody,
  normPhone, hashPassword, safeEqualHex,
  signJwt, verifyJwt, requireAuth, requireAdmin,
  sbRest, eqParam,
};
