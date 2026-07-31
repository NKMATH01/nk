/* ═══════════════════════════════════════════════════════════════════
   POST /api/variant-review
     { variant_id, action:'approve'|'reject'|'regenerate', note }   (admin 전용)
     →  { variant, problem_id }

   승인하면 problems 에 **status='review'** 로 들어간다. published 가 아니다.
   공개 전환은 기존 문제은행 화면에서 사람이 한 번 더 한다(이중 게이트).

   일괄 승인 API 는 없다. 변형 문제는 한 건씩 눈으로 확인해야 하고,
   버튼 한 번으로 수십 건이 은행에 들어가면 그 검토가 형식화된다.
   ═══════════════════════════════════════════════════════════════════ */
"use strict";
const L = require("./_lib.js");

const ACTIONS = ["approve", "reject", "regenerate"];

module.exports = async function handler(req, res){
  try{
    if(req.method !== "POST"){
      res.setHeader("Allow", "POST");
      return L.sendJson(res, 405, { error: "POST 요청만 허용됩니다." });
    }
    L.requireAdmin(req);

    const body = await L.readJsonBody(req);
    const id = body && body.variant_id;
    const action = body && body.action;
    if(!id) throw L.fail(400, "variant_id 가 필요합니다.");
    if(ACTIONS.indexOf(action) === -1) throw L.fail(400, "action 이 올바르지 않습니다.");

    const rows = await L.sbRest(
      "problem_variants?id=eq." + L.eqParam(id) +
      "&select=id,source_problem_id,generated_problem_id,raw_response,review_status,variation_spec&limit=1");
    const v = Array.isArray(rows) && rows.length ? rows[0] : null;
    if(!v) throw L.fail(404, "변형 기록을 찾을 수 없습니다.");
    if(v.generated_problem_id) throw L.fail(409, "이미 승인되어 문제은행에 등록된 변형입니다.");

    let problemId = null;

    if(action === "approve"){
      const r = v.raw_response || {};
      if(!r.stem_latex) throw L.fail(400, "본문이 없는 변형은 승인할 수 없습니다.");

      const src = await L.sbRest(
        "problems?id=eq." + L.eqParam(v.source_problem_id) +
        "&select=unit,cognition,difficulty,points,university_id,source_citation&limit=1");
      const s = Array.isArray(src) && src.length ? src[0] : {};

      const solution = Array.isArray(r.solution_steps) ? r.solution_steps.join("\n") : (r.solution_steps || null);
      const inserted = await L.sbRest("problems", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: {
          origin: "변형",
          parent_id: v.source_problem_id,
          university_id: s.university_id || null,
          unit: r.unit || s.unit || null,
          cognition: r.cognition || s.cognition || null,
          difficulty: r.difficulty != null ? Math.max(1, Math.min(5, Math.round(Number(r.difficulty)))) : s.difficulty,
          points: r.points != null ? Number(r.points) : s.points,
          body_format: "latex",
          body_latex: r.stem_latex,
          answer_latex: r.answer_closed || null,
          solution_latex: solution,
          rubric: Array.isArray(r.rubric) && r.rubric.length ? r.rubric : null,
          // 변형은 자체 제작물이지만 원본 출처를 추적할 수 있게 남긴다.
          license_scope: "own",
          source_citation: "변형: " + (s.source_citation || "원본 출처 미기재") + " 기반",
          // ★ published 가 아니다. 문제은행에서 사람이 한 번 더 공개 전환한다.
          status: "review",
          tags: ["변형"],
        },
      });
      const p = Array.isArray(inserted) && inserted.length ? inserted[0] : null;
      if(!p) throw L.fail(502, "문제은행 등록에 실패했습니다.");
      problemId = p.id;
    }

    const patch = {
      review_status: action === "approve" ? "approved" : action,
      review_note: body.note || null,
      reviewed_at: new Date().toISOString(),
    };
    if(problemId) patch.generated_problem_id = problemId;

    const updated = await L.sbRest("problem_variants?id=eq." + L.eqParam(id), {
      method: "PATCH", body: patch, headers: { Prefer: "return=representation" },
    });

    return L.sendJson(res, 200, {
      variant: Array.isArray(updated) && updated.length ? updated[0] : null,
      problem_id: problemId,
    });
  }catch(e){
    return L.sendError(res, e, "변형 검수 처리 중 오류가 발생했습니다.");
  }
};
