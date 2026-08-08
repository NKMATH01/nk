/* ═══════════════════════════════════════════════════════════════════
   POST /api/preview-token   { student_id, role }   (admin 전용)
     role: 'student' | 'parent'
     →  { token, expiresAt, role, phone }

   원장이 [학생 관리]에서 **그 학생 계정으로 로그인한 것과 똑같은 화면**을
   확인하기 위한 토큰이다.

   왜 관리자 토큰으로 학생 화면만 그리면 안 되는가
     학생 세션은 RLS 로 본인 데이터만 본다. 그래서 코호트가 n<2 가 되고
     회차 난이도 보정이 스스로 꺼진다(js/calc.js standardizeWeekly).
     관리자 토큰으로 같은 화면을 그리면 전체 데이터가 보여 **학생이 실제로 보는
     숫자와 달라진다** — Phase 4 에서 고친 문제를 미리보기가 되살리게 된다.
     그래서 실제 그 역할의 토큰을 발급한다.

   parent-link.js 와 같은 원칙: **해당 역할 계정의 클레임 그대로** 발급한다.
   새 권한을 지어내지 않으며, 그 역할의 계정이 없으면 발급하지 않는다.

   보안 메모
     · 이 엔드포인트는 관리자에게 새로운 데이터 접근을 주지 않는다 —
       관리자는 이미 전체 데이터를 읽는다. 늘어나는 것은 "그 계정으로 앉아 보는" 능력뿐이다.
     · 그럼에도 TTL 은 15분으로 짧게 둔다. 미리보기용이지 배포용 링크가 아니다.
       주소창·브라우저 기록·어깨너머로 새어 나간 토큰이 오래 살아 있을 이유가 없다
       (학부모 링크의 30일과 구분한다 — 그쪽은 학부모 본인 기기에서 계속 쓰는 링크다).
     · URL 을 만들지 않고 토큰만 돌려준다. 새 탭을 여는 것은 프런트의 몫이다.
   ═══════════════════════════════════════════════════════════════════ */
"use strict";
const L = require("./_lib.js");

const TTL_SEC = 15 * 60;                  // 미리보기 수명 15분
const ROLES = ["student", "parent"];
const ROLE_LABEL = { student: "학생", parent: "학부모" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async function handler(req, res){
  try{
    if(req.method !== "POST"){
      res.setHeader("Allow", "POST");
      return L.sendJson(res, 405, { error: "POST 요청만 허용됩니다." });
    }
    const auth = L.requireAdmin(req);
    await L.assertTokenFresh(auth);   // 강제 로그아웃된 관리자 토큰으로는 열리지 않는다

    const body = await L.readJsonBody(req);
    const sid = body && body.student_id;
    if(!sid || !UUID_RE.test(String(sid))) throw L.fail(400, "student_id(uuid)가 필요합니다.");
    const role = String((body && body.role) || "");
    if(ROLES.indexOf(role) < 0) throw L.fail(400, "role 은 student 또는 parent 여야 합니다.");

    // 해당 학생의 그 역할 계정을 찾는다. 없으면 토큰을 만들지 않는다.
    const accs = await L.sbRest(
      "accounts?student_id=eq." + L.eqParam(sid) + "&role=eq." + L.eqParam(role) +
      "&select=id,phone,role,student_id,token_version&limit=1");
    const acc = Array.isArray(accs) && accs.length ? accs[0] : null;
    if(!acc){
      throw L.fail(400, "이 학생의 " + ROLE_LABEL[role] + " 계정이 없습니다. [학생 관리]에서 계정을 먼저 만드세요.");
    }

    const signed = L.signJwt(L.buildClaims(acc), L.env("SUPABASE_JWT_SECRET"), TTL_SEC);

    return L.sendJson(res, 200, {
      token: signed.token,
      expiresAt: new Date(signed.exp * 1000).toISOString(),
      role: acc.role,
      phone: acc.phone,
    });
  }catch(e){
    return L.sendError(res, e, "미리보기 토큰 발급 중 오류가 발생했습니다.");
  }
};
