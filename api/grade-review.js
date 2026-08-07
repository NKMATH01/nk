/* ═══════════════════════════════════════════════════════════════════
   POST /api/grade-review
     { grading_run_id, final_score, final_tags, final_comment }   (admin 전용)
     →  { review, wrote_score, wrote_tags }

   강사 확정 지점. **AI 값이 scores 로 넘어가는 유일한 경로**이며,
   반드시 사람이 이 엔드포인트를 호출해야만 반영된다.

   함께 남기는 것
     agreed      : AI 제안과 강사 확정이 일치했는지(태그 집합 + 점수)
     score_delta : 강사가 점수를 얼마나 옮겼는지
   이 두 값의 누적이 "일치율 70% 게이트"의 근거가 된다.
   ═══════════════════════════════════════════════════════════════════ */
"use strict";
const L = require("./_lib.js");

function sameTags(a, b){
  const sa = [...new Set((a || []).filter(Boolean))].sort();
  const sb = [...new Set((b || []).filter(Boolean))].sort();
  return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
}

module.exports = async function handler(req, res){
  try{
    if(req.method !== "POST"){
      res.setHeader("Allow", "POST");
      return L.sendJson(res, 405, { error: "POST 요청만 허용됩니다." });
    }
    L.requireAdmin(req);

    const body = await L.readJsonBody(req);
    const runId = body && body.grading_run_id;
    if(!runId) throw L.fail(400, "grading_run_id 가 필요합니다.");

    const runs = await L.sbRest(
      "grading_runs?id=eq." + L.eqParam(runId) +
      "&select=id,submission_id,stage,suggested_score,wrong_reason_tags&limit=1");
    const run = Array.isArray(runs) && runs.length ? runs[0] : null;
    if(!run) throw L.fail(404, "AI 실행 기록을 찾을 수 없습니다.");

    const subs = await L.sbRest(
      "submissions?id=eq." + L.eqParam(run.submission_id) +
      "&select=id,student_id,question_id&limit=1");
    const sub = Array.isArray(subs) && subs.length ? subs[0] : null;
    if(!sub) throw L.fail(404, "제출물을 찾을 수 없습니다.");

    const finalScore = body.final_score == null || body.final_score === "" ? null : Number(body.final_score);
    if(finalScore != null && (!Number.isFinite(finalScore) || finalScore < 0)){
      throw L.fail(400, "확정 점수가 올바르지 않습니다.");
    }
    const finalTags = Array.isArray(body.final_tags) ? body.final_tags.filter(Boolean) : [];

    // 배점 초과 방지 — 문항 배점을 기준으로 잘라낸다.
    let maxPoints = null;
    const qs = await L.sbRest("questions?id=eq." + L.eqParam(sub.question_id) + "&select=points&limit=1");
    if(Array.isArray(qs) && qs.length) maxPoints = qs[0].points == null ? null : Number(qs[0].points);
    if(finalScore != null && maxPoints != null && finalScore > maxPoints){
      throw L.fail(400, "확정 점수가 배점(" + maxPoints + ")을 초과합니다.");
    }

    const agreed = sameTags(run.wrong_reason_tags, finalTags) &&
      (run.suggested_score == null || finalScore == null || Number(run.suggested_score) === finalScore);
    const scoreDelta = (run.suggested_score != null && finalScore != null)
      ? finalScore - Number(run.suggested_score) : null;

    const revRows = await L.sbRest("grading_reviews", {
      method: "POST",
      body: {
        grading_run_id: run.id,
        final_score: finalScore,
        final_tags: finalTags,
        final_comment: body.final_comment || null,
        agreed: agreed,
        score_delta: scoreDelta,
      },
      headers: { Prefer: "return=representation" },
    });
    const review = Array.isArray(revRows) && revRows.length ? revRows[0] : null;

    /* scores 로 write-through.
       기존 채점 그리드가 읽는 바로 그 테이블이라, 확정 즉시 모든 화면에 반영된다.

       ★ reason_note 를 여기서 쓰지 않는다.
         호출부가 final_comment 로 넘기는 값은 AI 가 쓴 문장(run.feedback_text)이다.
         그것을 scores.reason_note 에 넣으면 강사가 감점 패널에 직접 적어 둔 메모가
         AI 문장으로 덮이고, 그 문장이 다음 채점의 "강사메모" few-shot 으로 되돌아와
         AI 가 자기 출력을 학습한다(api/grade-run.js fewShotExamples).
         AI 문장은 위 grading_reviews.final_comment 에만 남긴다.

       ★ 점수가 없어도 태그는 확정한다.
         tags_only 모드는 suggested_score 가 아예 오지 않는다. 점수를 조건으로 걸면
         강사가 [반영]을 눌러도 태그까지 함께 버려져 아무것도 저장되지 않았다.
         점수가 null 이면 payload 에서 earned 를 빼서 기존 점수를 null 로 덮지 않고
         wrong_reason 만 기록한다(PostgREST 는 payload 에 있는 컬럼만 갱신한다). */
    const writeRow = {
      question_id: sub.question_id,
      student_id: sub.student_id,
      wrong_reason: finalTags.length ? finalTags[0] : null,
    };
    if(finalScore != null) writeRow.earned = finalScore;
    let wroteScore = false, wroteTags = false;
    if(finalScore != null || finalTags.length){
      await L.sbRest("scores?on_conflict=question_id,student_id", {
        method: "POST",
        body: [writeRow],
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      });
      wroteScore = finalScore != null;
      wroteTags = finalTags.length > 0;
    }

    return L.sendJson(res, 200, {
      review: review, wrote_score: wroteScore, wrote_tags: wroteTags, agreed: agreed,
    });
  }catch(e){
    return L.sendError(res, e, "채점 확정 중 오류가 발생했습니다.");
  }
};
