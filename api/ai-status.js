/* ═══════════════════════════════════════════════════════════════════
   GET /api/ai-status   (admin 전용)
     →  { configured, model, mode, priceInPerM, priceOutPerM }

   클라이언트가 AI 버튼을 켤지 끌지 판단하는 근거.
   API 키 자체는 절대 반환하지 않고, 설정 여부(boolean)만 알려준다.
   ═══════════════════════════════════════════════════════════════════ */
"use strict";
const L = require("./_lib.js");
const G = require("./_gemini.js");

module.exports = async function handler(req, res){
  try{
    if(req.method !== "GET"){
      res.setHeader("Allow", "GET");
      return L.sendJson(res, 405, { error: "GET 요청만 허용됩니다." });
    }
    L.requireAdmin(req);
    return L.sendJson(res, 200, {
      configured: G.hasKey(),
      model: G.model(),
      mode: G.gradingMode(),
      priceInPerM: G.priceIn(),
      priceOutPerM: G.priceOut(),
      promptVersion: G.PROMPT_VERSION,
    });
  }catch(e){
    return L.sendError(res, e, "AI 상태 조회 중 오류가 발생했습니다.");
  }
};
