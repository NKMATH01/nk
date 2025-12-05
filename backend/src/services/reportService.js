/**
 * 보고서 생성 서비스
 * Zone A (Read) + Zone B (Read/Write) 데이터를 통합하여 AI 보고서 생성
 */

const { supabaseAdmin } = require('../config/supabase');
const { generateParentReportContent } = require('./aiService');

/**
 * 학부모 보고서 생성 파이프라인
 *
 * 단계:
 * 1. 학생 기본 정보 조회 (Zone A: students, classes)
 * 2. 시험 성적 조회 (Zone B: student_exam_submissions)
 * 3. 숙제 데이터 조회 (Zone A: homework_logs)
 * 4. 학습 태도 조회 (Zone B: daily_mood_logs)
 * 5. 데이터 구조화 및 AI 전송
 * 6. 결과 저장 (Zone B: ai_report_history)
 *
 * @param {string} reportId - 미리 생성된 보고서 레코드 ID
 * @param {string} studentId - 학생 ID
 * @param {string} reportType - 보고서 유형 (weekly/monthly)
 * @param {string} periodStart - 기간 시작일
 * @param {string} periodEnd - 기간 종료일
 */
async function generateParentReport(reportId, studentId, reportType, periodStart, periodEnd) {
  console.log(`Starting report generation: ${reportId}`);

  try {
    // =========================================================================
    // Step 1: 학생 기본 정보 조회 (Zone A - Read Only)
    // =========================================================================
    const { data: student, error: studentError } = await supabaseAdmin
      .from('students')
      .select(`
        id,
        name,
        grade,
        parent_phone,
        classes:class_id (
          id,
          name,
          subject,
          instructors:instructor_id (
            name
          )
        )
      `)
      .eq('id', studentId)
      .single();

    if (studentError || !student) {
      throw new Error('학생 정보를 찾을 수 없습니다.');
    }

    const studentData = {
      name: student.name,
      grade: student.grade,
      className: student.classes?.name,
      subject: student.classes?.subject,
      instructorName: student.classes?.instructors?.name
    };

    // =========================================================================
    // Step 2: 시험 성적 조회 (Zone B)
    // =========================================================================
    const { data: examSubmissions } = await supabaseAdmin
      .from('student_exam_submissions')
      .select(`
        id,
        score,
        total_points,
        percentage,
        self_analysis,
        ai_analysis,
        submitted_at,
        exam_papers (
          title,
          subject
        )
      `)
      .eq('student_id', studentId)
      .gte('submitted_at', periodStart)
      .lte('submitted_at', periodEnd)
      .not('score', 'is', null)
      .order('submitted_at', { ascending: true });

    const examData = {
      totalExams: examSubmissions?.length || 0,
      exams: examSubmissions?.map(sub => ({
        title: sub.exam_papers?.title,
        subject: sub.exam_papers?.subject,
        score: sub.score,
        totalPoints: sub.total_points,
        percentage: sub.percentage,
        selfAnalysis: sub.self_analysis,
        aiAnalysis: sub.ai_analysis,
        date: sub.submitted_at
      })) || [],
      averagePercentage: examSubmissions?.length > 0
        ? examSubmissions.reduce((sum, s) => sum + (s.percentage || 0), 0) / examSubmissions.length
        : null,
      trend: calculateTrend(examSubmissions?.map(s => s.percentage) || [])
    };

    // =========================================================================
    // Step 3: 숙제 데이터 조회 (Zone A - Read Only)
    // 외부 숙제 프로그램과 연동된 homework_logs 테이블
    // =========================================================================
    const { data: homeworkLogs } = await supabaseAdmin
      .from('homework_logs')
      .select('*')
      .eq('student_id', studentId)
      .gte('assignment_date', periodStart)
      .lte('assignment_date', periodEnd)
      .order('assignment_date', { ascending: true });

    const homeworkData = {
      totalAssignments: homeworkLogs?.length || 0,
      assignments: homeworkLogs?.map(hw => ({
        date: hw.assignment_date,
        subject: hw.subject,
        completionRate: hw.completion_rate,
        accuracyRate: hw.accuracy_rate,
        timeSpent: hw.time_spent_minutes,
        notes: hw.notes
      })) || [],
      averageCompletionRate: homeworkLogs?.length > 0
        ? homeworkLogs.reduce((sum, h) => sum + (h.completion_rate || 0), 0) / homeworkLogs.length
        : null,
      averageAccuracyRate: homeworkLogs?.length > 0
        ? homeworkLogs.reduce((sum, h) => sum + (h.accuracy_rate || 0), 0) / homeworkLogs.length
        : null
    };

    // =========================================================================
    // Step 4: 학습 태도 조회 (Zone B)
    // =========================================================================
    const { data: moodLogs } = await supabaseAdmin
      .from('daily_mood_logs')
      .select('*')
      .eq('student_id', studentId)
      .gte('log_date', periodStart)
      .lte('log_date', periodEnd)
      .order('log_date', { ascending: true });

    const moodData = {
      totalLogs: moodLogs?.length || 0,
      logs: moodLogs?.map(log => ({
        date: log.log_date,
        moodScore: log.mood_score,
        focusScore: log.focus_score,
        participationScore: log.participation_score,
        instructorNote: log.instructor_note
      })) || [],
      averageMood: calculateAverage(moodLogs?.map(l => l.mood_score) || []),
      averageFocus: calculateAverage(moodLogs?.map(l => l.focus_score) || []),
      averageParticipation: calculateAverage(moodLogs?.map(l => l.participation_score) || [])
    };

    // =========================================================================
    // Step 5: AI 보고서 생성 (Gemini 2.5 Pro)
    // =========================================================================
    const reportMeta = {
      type: reportType,
      periodStart,
      periodEnd
    };

    const aiResult = await generateParentReportContent(
      studentData,
      examData,
      homeworkData,
      moodData,
      reportMeta
    );

    // =========================================================================
    // Step 6: 결과 저장 (Zone B)
    // =========================================================================
    const sourceDataSnapshot = {
      studentData,
      examData,
      homeworkData,
      moodData
    };

    const { error: updateError } = await supabaseAdmin
      .from('ai_report_history')
      .update({
        report_content: aiResult.content,
        source_data_snapshot: sourceDataSnapshot,
        ai_model: aiResult.model,
        generation_tokens: aiResult.tokens,
        status: 'generated'
      })
      .eq('id', reportId);

    if (updateError) {
      throw new Error('보고서 저장 중 오류가 발생했습니다.');
    }

    console.log(`Report generation completed: ${reportId}`);
    return aiResult.content;

  } catch (error) {
    console.error(`Report generation failed: ${reportId}`, error);

    // 실패 상태로 업데이트
    await supabaseAdmin
      .from('ai_report_history')
      .update({ status: 'failed' })
      .eq('id', reportId);

    throw error;
  }
}

/**
 * 학생 종합 데이터 조회 (강사용)
 * Zone A + Zone B 조인하여 시험-숙제 상관관계 분석
 *
 * @param {string} studentId - 학생 ID
 * @returns {Object} - 종합 데이터
 */
async function getStudentComprehensiveData(studentId) {
  // 학생 기본 정보 (Zone A)
  const { data: student } = await supabaseAdmin
    .from('students')
    .select(`
      id,
      name,
      grade,
      classes:class_id (name, subject)
    `)
    .eq('id', studentId)
    .single();

  // 최근 시험 제출 (Zone B)
  const { data: submissions } = await supabaseAdmin
    .from('student_exam_submissions')
    .select(`
      *,
      exam_papers (title, subject)
    `)
    .eq('student_id', studentId)
    .order('submitted_at', { ascending: false })
    .limit(10);

  // 최근 숙제 (Zone A)
  const { data: homework } = await supabaseAdmin
    .from('homework_logs')
    .select('*')
    .eq('student_id', studentId)
    .order('assignment_date', { ascending: false })
    .limit(10);

  // 최근 태도 로그 (Zone B)
  const { data: moodLogs } = await supabaseAdmin
    .from('daily_mood_logs')
    .select('*')
    .eq('student_id', studentId)
    .order('log_date', { ascending: false })
    .limit(10);

  // 숙제-시험 상관관계 분석
  // "숙제는 잘했는데 시험은 왜 틀렸는지" 분석
  const correlationAnalysis = analyzeHomeworkExamCorrelation(homework, submissions);

  return {
    student,
    recentExams: submissions,
    recentHomework: homework,
    recentMoodLogs: moodLogs,
    correlationAnalysis
  };
}

/**
 * 숙제-시험 상관관계 분석
 */
function analyzeHomeworkExamCorrelation(homework, examSubmissions) {
  if (!homework?.length || !examSubmissions?.length) {
    return {
      hasData: false,
      message: '분석을 위한 충분한 데이터가 없습니다.'
    };
  }

  const avgHomeworkCompletion = calculateAverage(homework.map(h => h.completion_rate));
  const avgHomeworkAccuracy = calculateAverage(homework.map(h => h.accuracy_rate));
  const avgExamScore = calculateAverage(examSubmissions.map(e => e.percentage));

  let insight = '';

  if (avgHomeworkCompletion > 80 && avgExamScore < 70) {
    insight = '숙제 완료율은 높지만 시험 성적이 낮습니다. 이해도 점검이 필요합니다.';
  } else if (avgHomeworkCompletion < 60 && avgExamScore > 80) {
    insight = '숙제 완료율은 낮지만 시험 성적이 우수합니다. 학습 습관 개선 권장.';
  } else if (avgHomeworkAccuracy > 90 && avgExamScore < 60) {
    insight = '숙제 정확도는 높은데 시험 점수가 낮습니다. 시험 환경 적응 훈련 필요.';
  } else {
    insight = '숙제와 시험 성적이 비교적 일관됩니다.';
  }

  return {
    hasData: true,
    avgHomeworkCompletion: Math.round(avgHomeworkCompletion * 10) / 10,
    avgHomeworkAccuracy: Math.round(avgHomeworkAccuracy * 10) / 10,
    avgExamScore: Math.round(avgExamScore * 10) / 10,
    insight
  };
}

/**
 * 유틸리티: 평균 계산
 */
function calculateAverage(numbers) {
  const validNumbers = numbers.filter(n => n !== null && n !== undefined);
  if (validNumbers.length === 0) return null;
  return validNumbers.reduce((sum, n) => sum + n, 0) / validNumbers.length;
}

/**
 * 유틸리티: 추세 계산
 */
function calculateTrend(numbers) {
  const validNumbers = numbers.filter(n => n !== null && n !== undefined);
  if (validNumbers.length < 2) return 'insufficient_data';

  const firstHalf = validNumbers.slice(0, Math.floor(validNumbers.length / 2));
  const secondHalf = validNumbers.slice(Math.floor(validNumbers.length / 2));

  const firstAvg = calculateAverage(firstHalf);
  const secondAvg = calculateAverage(secondHalf);

  const diff = secondAvg - firstAvg;

  if (diff > 5) return 'improving';
  if (diff < -5) return 'declining';
  return 'stable';
}

module.exports = {
  generateParentReport,
  getStudentComprehensiveData,
  analyzeHomeworkExamCorrelation
};
