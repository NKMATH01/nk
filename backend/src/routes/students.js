/**
 * 학생 관련 라우트
 * - 강사: 담당 반 학생 조회, 상세 분석
 * - 학생: 본인 정보 조회
 */

const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const { authenticate, authorize, ROLES } = require('../middleware/auth');
const { getStudentComprehensiveData } = require('../services/reportService');
const { generateEncouragement } = require('../services/aiService');

/**
 * GET /api/students
 * 담당 반 학생 목록 조회 (강사 전용)
 */
router.get('/', authenticate, authorize(ROLES.INSTRUCTOR), async (req, res) => {
  try {
    const { classId } = req.query;

    let query = supabaseAdmin
      .from('students')
      .select(`
        id,
        name,
        grade,
        class_id,
        classes:class_id (
          id,
          name,
          subject
        )
      `);

    // 특정 반 필터링
    if (classId) {
      query = query.eq('class_id', classId);
    } else if (req.user.classIds?.length > 0) {
      // 강사 담당 반만 조회
      query = query.in('class_id', req.user.classIds);
    }

    const { data: students, error } = await query.order('name');

    if (error) {
      return res.status(500).json({
        success: false,
        error: '학생 목록 조회 중 오류가 발생했습니다.'
      });
    }

    res.json({
      success: true,
      students
    });
  } catch (error) {
    console.error('Get students error:', error);
    res.status(500).json({
      success: false,
      error: '학생 목록 조회 중 오류가 발생했습니다.'
    });
  }
});

/**
 * GET /api/students/:studentId
 * 학생 상세 정보 조회 (강사/학부모/본인)
 */
router.get('/:studentId', authenticate, async (req, res) => {
  try {
    const { studentId } = req.params;

    // 접근 권한 확인
    if (req.user.role === ROLES.STUDENT && req.user.id !== studentId) {
      return res.status(403).json({
        success: false,
        error: '접근 권한이 없습니다.'
      });
    }

    if (req.user.role === ROLES.PARENT && !req.user.studentIds.includes(studentId)) {
      return res.status(403).json({
        success: false,
        error: '자녀의 정보에만 접근할 수 있습니다.'
      });
    }

    const { data: student, error } = await supabaseAdmin
      .from('students')
      .select(`
        id,
        name,
        grade,
        enrollment_date,
        classes:class_id (
          id,
          name,
          subject,
          schedule,
          instructors:instructor_id (
            id,
            name
          )
        )
      `)
      .eq('id', studentId)
      .single();

    if (error || !student) {
      return res.status(404).json({
        success: false,
        error: '학생 정보를 찾을 수 없습니다.'
      });
    }

    res.json({
      success: true,
      student
    });
  } catch (error) {
    console.error('Get student error:', error);
    res.status(500).json({
      success: false,
      error: '학생 정보 조회 중 오류가 발생했습니다.'
    });
  }
});

/**
 * GET /api/students/:studentId/comprehensive
 * 학생 종합 분석 조회 (강사 전용)
 * Zone A (homework_logs) + Zone B (exam_submissions) 조인
 */
router.get('/:studentId/comprehensive', authenticate, authorize(ROLES.INSTRUCTOR), async (req, res) => {
  try {
    const { studentId } = req.params;

    const data = await getStudentComprehensiveData(studentId);

    res.json({
      success: true,
      ...data
    });
  } catch (error) {
    console.error('Get comprehensive data error:', error);
    res.status(500).json({
      success: false,
      error: '종합 데이터 조회 중 오류가 발생했습니다.'
    });
  }
});

/**
 * GET /api/students/:studentId/mood
 * 학생의 최근 태도/기분 로그 조회
 */
router.get('/:studentId/mood', authenticate, async (req, res) => {
  try {
    const { studentId } = req.params;
    const { limit = 7 } = req.query;

    // 접근 권한 확인
    if (req.user.role === ROLES.STUDENT && req.user.id !== studentId) {
      return res.status(403).json({
        success: false,
        error: '접근 권한이 없습니다.'
      });
    }

    const { data: logs, error } = await supabaseAdmin
      .from('daily_mood_logs')
      .select('*')
      .eq('student_id', studentId)
      .order('log_date', { ascending: false })
      .limit(parseInt(limit));

    if (error) {
      return res.status(500).json({
        success: false,
        error: '조회 중 오류가 발생했습니다.'
      });
    }

    res.json({
      success: true,
      logs
    });
  } catch (error) {
    console.error('Get mood logs error:', error);
    res.status(500).json({
      success: false,
      error: '조회 중 오류가 발생했습니다.'
    });
  }
});

/**
 * POST /api/students/:studentId/mood
 * 일일 학습 로그 기록 (강사 전용)
 */
router.post('/:studentId/mood', authenticate, authorize(ROLES.INSTRUCTOR), async (req, res) => {
  try {
    const { studentId } = req.params;
    const { date, moodScore, focusScore, participationScore, instructorNote } = req.body;

    const logDate = date || new Date().toISOString().split('T')[0];

    // Upsert: 이미 있으면 업데이트, 없으면 삽입
    const { data: log, error } = await supabaseAdmin
      .from('daily_mood_logs')
      .upsert({
        student_id: studentId,
        log_date: logDate,
        mood_score: moodScore,
        focus_score: focusScore,
        participation_score: participationScore,
        instructor_note: instructorNote,
        recorded_by: req.user.id
      }, {
        onConflict: 'student_id,log_date'
      })
      .select()
      .single();

    if (error) {
      console.error('Create mood log error:', error);
      return res.status(500).json({
        success: false,
        error: '기록 저장 중 오류가 발생했습니다.'
      });
    }

    // AI 격려 메시지 생성 (Gemini Flash)
    let encouragement = null;
    try {
      encouragement = await generateEncouragement({
        moodScore,
        focusScore,
        participationScore,
        instructorNote
      });

      // 격려 메시지 저장
      await supabaseAdmin
        .from('daily_mood_logs')
        .update({ ai_encouragement: encouragement })
        .eq('id', log.id);

    } catch (aiError) {
      console.error('AI encouragement error:', aiError);
    }

    res.json({
      success: true,
      log: {
        ...log,
        ai_encouragement: encouragement
      }
    });
  } catch (error) {
    console.error('Create mood log error:', error);
    res.status(500).json({
      success: false,
      error: '기록 저장 중 오류가 발생했습니다.'
    });
  }
});

/**
 * GET /api/students/:studentId/feedback
 * 학생의 AI 피드백 조회 (학생 전용)
 */
router.get('/:studentId/feedback', authenticate, authorize(ROLES.STUDENT), async (req, res) => {
  try {
    const { studentId } = req.params;

    if (req.user.id !== studentId) {
      return res.status(403).json({
        success: false,
        error: '접근 권한이 없습니다.'
      });
    }

    // 최근 시험 AI 분석
    const { data: recentExam } = await supabaseAdmin
      .from('student_exam_submissions')
      .select(`
        score,
        percentage,
        ai_analysis,
        exam_papers (title)
      `)
      .eq('student_id', studentId)
      .not('ai_analysis', 'is', null)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    // 최근 격려 메시지
    const { data: recentMood } = await supabaseAdmin
      .from('daily_mood_logs')
      .select('log_date, ai_encouragement')
      .eq('student_id', studentId)
      .not('ai_encouragement', 'is', null)
      .order('log_date', { ascending: false })
      .limit(1)
      .single();

    res.json({
      success: true,
      feedback: {
        examFeedback: recentExam ? {
          examTitle: recentExam.exam_papers?.title,
          score: recentExam.score,
          percentage: recentExam.percentage,
          analysis: recentExam.ai_analysis
        } : null,
        encouragement: recentMood ? {
          date: recentMood.log_date,
          message: recentMood.ai_encouragement
        } : null
      }
    });
  } catch (error) {
    console.error('Get feedback error:', error);
    res.status(500).json({
      success: false,
      error: '피드백 조회 중 오류가 발생했습니다.'
    });
  }
});

module.exports = router;
