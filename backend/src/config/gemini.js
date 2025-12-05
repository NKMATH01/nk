/**
 * Gemini AI 클라이언트 설정
 * - Gemini 2.5 Pro: 학부모 보고서 생성 (깊이 있는 분석)
 * - Gemini 2.5 Flash: 실시간 오답 분석, 간단한 요약 (빠른 응답)
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 모델 설정
const MODELS = {
  PRO: 'gemini-2.5-pro-preview-06-05',    // 고지능/고비용: 학부모 보고서
  FLASH: 'gemini-2.5-flash-preview-05-20'  // 고속/저비용: 실시간 분석
};

/**
 * Gemini 2.5 Pro 모델 (보고서 생성용)
 */
function getProModel() {
  return genAI.getGenerativeModel({
    model: MODELS.PRO,
    generationConfig: {
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json'
    }
  });
}

/**
 * Gemini 2.5 Flash 모델 (실시간 분석용)
 */
function getFlashModel() {
  return genAI.getGenerativeModel({
    model: MODELS.FLASH,
    generationConfig: {
      temperature: 0.5,
      topP: 0.8,
      topK: 20,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json'
    }
  });
}

module.exports = {
  genAI,
  getProModel,
  getFlashModel,
  MODELS
};
