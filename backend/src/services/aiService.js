/**
 * AI 서비스 (Gemini 2.5 통합)
 *
 * 모델 선택 전략:
 * - Gemini 2.5 Pro: 학부모 보고서 생성 (깊이 있는 분석, 정중한 어조)
 * - Gemini 2.5 Flash: 실시간 오답 분석, 격려 메시지 (빠른 응답)
 */

const { getProModel, getFlashModel, MODELS } = require('../config/gemini');

// ============================================================================
// 시스템 프롬프트 정의
// ============================================================================

/**
 * 학부모 보고서 생성용 시스템 프롬프트 (Gemini 2.5 Pro)
 */
const PARENT_REPORT_SYSTEM_PROMPT = `당신은 NK 학원의 AI 학습 분석 전문가입니다.
학생의 학습 데이터를 분석하여 학부모에게 전달할 보고서를 작성합니다.

## 역할 및 책임
- 학생의 시험 성적, 숙제 완료율, 학습 태도 데이터를 종합 분석
- 학부모가 이해하기 쉽고 실용적인 피드백 제공
- 긍정적이면서도 객관적인 어조 유지

## 출력 형식 (반드시 JSON)
다음 JSON 구조로만 응답하세요:

{
  "title": "보고서 제목 (예: 2024년 12월 1주차 학습 보고서)",
  "summary": "전체 요약 (2-3문장, 핵심 내용)",
  "detailedAnalysis": {
    "strengths": ["강점 1", "강점 2"],
    "areasForImprovement": ["개선점 1", "개선점 2"],
    "examPerformance": {
      "overview": "시험 성적 전반적 평가",
      "details": "구체적인 분석"
    },
    "homeworkPerformance": {
      "overview": "숙제 수행 전반적 평가",
      "details": "구체적인 분석"
    },
    "attitudeAssessment": {
      "overview": "학습 태도 전반적 평가",
      "details": "구체적인 분석"
    }
  },
  "recommendations": [
    "가정에서 실천할 수 있는 구체적인 조언 1",
    "가정에서 실천할 수 있는 구체적인 조언 2"
  ],
  "encouragementMessage": "학생과 학부모에게 전하는 격려의 말"
}

## 작성 원칙
1. **정중함**: 존댓말 사용, "~님의 자녀" 등 정중한 표현
2. **구체성**: "잘했습니다"보다는 "분수 연산 정확도가 85%에서 92%로 향상되었습니다"
3. **균형**: 칭찬과 개선점을 균형있게 제시
4. **실용성**: 가정에서 바로 실천할 수 있는 조언 포함
5. **격려**: 마지막은 항상 격려의 메시지로 마무리

## 주의사항
- HTML이나 마크다운 사용 금지, 순수 JSON만 출력
- 학생을 비하하거나 다른 학생과 비교하는 표현 금지
- 추측이나 가정 없이 제공된 데이터에 기반해서만 분석`;

/**
 * 오답 분석용 시스템 프롬프트 (Gemini 2.5 Flash)
 */
const WRONG_ANSWER_ANALYSIS_PROMPT = `당신은 학습 패턴 분석 AI입니다.
학생이 입력한 오답 원인을 분석하여 학습 개선 방향을 제시합니다.

## 출력 형식 (반드시 JSON)
{
  "primaryWeakness": "주요 약점 (한 단어 또는 짧은 구)",
  "pattern": "발견된 오답 패턴",
  "suggestion": "구체적인 개선 제안 (1문장)",
  "encouragement": "짧은 격려 메시지 (1문장)",
  "confidence": 0.85
}

## 오답 원인 분류
- 개념_미숙지: 기본 개념 이해 부족
- 계산_실수: 단순 연산 오류
- 문제_오독: 문제를 잘못 읽음
- 시간_부족: 시간 내 풀이 미완료
- 공식_착오: 공식을 잘못 적용

간결하고 명확하게 분석하세요.`;

/**
 * 격려 메시지 생성용 프롬프트 (Gemini 2.5 Flash)
 */
const ENCOURAGEMENT_PROMPT = `당신은 친근한 학습 도우미입니다.
학생의 오늘 학습 상태를 바탕으로 짧은 격려 메시지를 생성합니다.

## 출력 형식 (반드시 JSON)
{
  "message": "격려 메시지 (2문장 이내)"
}

## 원칙
- 학생 눈높이에 맞는 친근한 어조
- 구체적인 칭찬 또는 응원
- 다음 학습에 대한 긍정적 기대`;

// ============================================================================
// AI 함수 구현
// ============================================================================

/**
 * 학부모 보고서 생성 (Gemini 2.5 Pro)
 *
 * @param {Object} studentData - 학생 기본 정보
 * @param {Object} examData - 시험 성적 데이터
 * @param {Object} homeworkData - 숙제 현황 데이터
 * @param {Object} moodData - 학습 태도 데이터
 * @param {Object} reportMeta - 보고서 메타 정보 (기간, 유형 등)
 * @returns {Object} - 생성된 보고서 내용
 */
async function generateParentReportContent(studentData, examData, homeworkData, moodData, reportMeta) {
  const model = getProModel();

  const userPrompt = `다음 데이터를 분석하여 학부모 보고서를 작성해주세요.

## 보고서 정보
- 보고서 유형: ${reportMeta.type === 'weekly' ? '주간' : '월간'} 보고서
- 기간: ${reportMeta.periodStart} ~ ${reportMeta.periodEnd}

## 학생 정보
- 이름: ${studentData.name}
- 학년: ${studentData.grade}
- 반: ${studentData.className}
- 과목: ${studentData.subject}

## 시험 성적 데이터
${JSON.stringify(examData, null, 2)}

## 숙제 수행 데이터 (외부 시스템 연동)
${JSON.stringify(homeworkData, null, 2)}

## 학습 태도 데이터
${JSON.stringify(moodData, null, 2)}

위 데이터를 종합 분석하여 학부모에게 전달할 보고서를 JSON 형식으로 작성해주세요.`;

  try {
    const chat = model.startChat({
      history: [
        {
          role: 'user',
          parts: [{ text: PARENT_REPORT_SYSTEM_PROMPT }]
        },
        {
          role: 'model',
          parts: [{ text: '네, 이해했습니다. 학부모 보고서를 JSON 형식으로 작성하겠습니다.' }]
        }
      ]
    });

    const result = await chat.sendMessage(userPrompt);
    const responseText = result.response.text();

    // JSON 파싱
    const reportContent = JSON.parse(responseText);

    return {
      success: true,
      content: reportContent,
      model: MODELS.PRO,
      tokens: result.response.usageMetadata?.totalTokenCount || null
    };
  } catch (error) {
    console.error('Gemini Pro report generation error:', error);
    throw new Error('AI 보고서 생성 중 오류가 발생했습니다.');
  }
}

/**
 * 오답 원인 분석 (Gemini 2.5 Flash)
 *
 * @param {Object} selfAnalysis - 학생이 입력한 오답 원인
 * @param {Object} questionData - 문제 데이터
 * @returns {Object} - AI 분석 결과
 */
async function analyzeWrongAnswers(selfAnalysis, questionData) {
  const model = getFlashModel();

  const userPrompt = `학생이 입력한 오답 원인을 분석해주세요.

## 학생의 자가 분석
${JSON.stringify(selfAnalysis, null, 2)}

## 문제 정보
${JSON.stringify(questionData, null, 2)}

위 내용을 바탕으로 오답 패턴을 분석하고 개선 방향을 제시해주세요.`;

  try {
    const chat = model.startChat({
      history: [
        {
          role: 'user',
          parts: [{ text: WRONG_ANSWER_ANALYSIS_PROMPT }]
        },
        {
          role: 'model',
          parts: [{ text: '네, 오답 분석을 JSON 형식으로 제공하겠습니다.' }]
        }
      ]
    });

    const result = await chat.sendMessage(userPrompt);
    const responseText = result.response.text();

    return JSON.parse(responseText);
  } catch (error) {
    console.error('Gemini Flash analysis error:', error);
    // Flash 분석 실패 시 기본값 반환
    return {
      primaryWeakness: '분석 불가',
      pattern: '데이터 부족',
      suggestion: '추가 데이터가 필요합니다.',
      encouragement: '꾸준히 노력하면 좋은 결과가 있을 거예요!',
      confidence: 0
    };
  }
}

/**
 * 일일 격려 메시지 생성 (Gemini 2.5 Flash)
 *
 * @param {Object} moodData - 오늘의 학습 태도 데이터
 * @returns {string} - 격려 메시지
 */
async function generateEncouragement(moodData) {
  const model = getFlashModel();

  const userPrompt = `오늘의 학습 상태를 바탕으로 격려 메시지를 작성해주세요.

## 오늘의 학습 상태
- 기분 점수: ${moodData.moodScore}/5
- 집중도 점수: ${moodData.focusScore}/5
- 참여도 점수: ${moodData.participationScore}/5
- 강사 메모: ${moodData.instructorNote || '없음'}`;

  try {
    const chat = model.startChat({
      history: [
        {
          role: 'user',
          parts: [{ text: ENCOURAGEMENT_PROMPT }]
        },
        {
          role: 'model',
          parts: [{ text: '네, 격려 메시지를 작성하겠습니다.' }]
        }
      ]
    });

    const result = await chat.sendMessage(userPrompt);
    const responseText = result.response.text();
    const parsed = JSON.parse(responseText);

    return parsed.message;
  } catch (error) {
    console.error('Gemini Flash encouragement error:', error);
    // 실패 시 기본 메시지
    return '오늘도 수고했어요! 내일도 파이팅!';
  }
}

/**
 * 대시보드 요약 생성 (Gemini 2.5 Flash)
 *
 * @param {Object} classData - 반 전체 데이터
 * @returns {Object} - 요약 정보
 */
async function generateDashboardSummary(classData) {
  const model = getFlashModel();

  const prompt = `다음 반 데이터를 요약해주세요.

${JSON.stringify(classData, null, 2)}

## 출력 형식 (JSON)
{
  "overallTrend": "전반적 추세 (1문장)",
  "topPerformers": ["학생1", "학생2"],
  "needsAttention": ["주의가 필요한 학생"],
  "keyInsight": "핵심 인사이트 (1문장)"
}`;

  try {
    const result = await model.generateContent(prompt);
    return JSON.parse(result.response.text());
  } catch (error) {
    console.error('Dashboard summary error:', error);
    return {
      overallTrend: '데이터 분석 중 오류 발생',
      topPerformers: [],
      needsAttention: [],
      keyInsight: '다시 시도해주세요.'
    };
  }
}

module.exports = {
  generateParentReportContent,
  analyzeWrongAnswers,
  generateEncouragement,
  generateDashboardSummary,
  // 프롬프트 내보내기 (테스트/디버깅용)
  PROMPTS: {
    PARENT_REPORT_SYSTEM_PROMPT,
    WRONG_ANSWER_ANALYSIS_PROMPT,
    ENCOURAGEMENT_PROMPT
  }
};
