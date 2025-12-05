/**
 * 시험 관련 라우트
 * - 강사: 시험지 생성/배포
 * - 학생: 시험 응시/제출
 */

const express = require('express');
const router = express.Router();
const { supabaseAdmin, assertWriteAllowed } = require('../config/supabase');
const { authenticate, authorize, ROLES } = require('../middleware/auth');
const { analyzeWrongAnswers } = require('../services/aiService');

// ============================================================================
// 강사 전용 API
// ============================================================================

/**
 * POST /api/exams/papers
 * 시험지 생성 (강사 전용)
 */
router.post('/papers', authenticate, authorize(ROLES.INSTRUCTOR), async (req, res) => {
  try {
    assertWriteAllowed('exam_papers');

    const { title, description, subject, classId, totalQuestions, totalPoints, questionData, dueDate } = req.body;

    if (!title || !classId || !subject) {
      return res.status(400).json({
        success: false,
        error: '필수 정보를 입력해주세요.'
      });
    }

    const { data: paper, error } = await supabaseAdmin
      .from('exam_papers')
      .insert({
        instructor_id: req.user.id,
        class_id: classId,
        title,
        description,
        subject,
        total_questions: totalQuestions || 0,
        total_points: totalPoints || 100,
        question_data: questionData || {},
        due_date: dueDate,
        status: 'draft'
      })
      .select()
      .single();

    if (error) {
      console.error('Create exam paper error:', error);
      return res.status(500).json({
        success: false,
        error: '시험지 생성 중 오류가 발생했습니다.'
      });
    }

    res.status(201).json({
      success: true,
      paper
    });
  } catch (error) {
    console.error('Create exam paper error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/exams/papers/:paperId/distribute
 * 시험지 배포 (강사 전용)
 */
router.post('/papers/:paperId/distribute', authenticate, authorize(ROLES.INSTRUCTOR), async (req, res) => {
  try {
    const { paperId } = req.params;

    // 시험지 존재 여부 및 권한 확인
    const { data: paper, error: fetchError } = await supabaseAdmin
      .from('exam_papers')
      .select('*')
      .eq('id', paperId)
      .eq('instructor_id', req.user.id)
      .single();

    if (fetchError || !paper) {
      return res.status(404).json({
        success: false,
        error: '시험지를 찾을 수 없습니다.'
      });
    }

    if (paper.status === 'distributed') {
      return res.status(400).json({
        success: false,
        error: '이미 배포된 시험지입니다.'
      });
    }

    // 배포 상태로 변경
    const { data: updatedPaper, error: updateError } = await supabaseAdmin
      .from('exam_papers')
      .update({
        status: 'distributed',
        distributed_at: new Date().toISOString()
      })
      .eq('id', paperId)
      .select()
      .single();

    if (updateError) {
      return res.status(500).json({
        success: false,
        error: '시험지 배포 중 오류가 발생했습니다.'
      });
    }

    // 해당 반의 모든 학생에게 빈 제출 레코드 생성
    const { data: students } = await supabaseAdmin
      .from('students')
      .select('id')
      .eq('class_id', paper.class_id);

    if (students && students.length > 0) {
      const submissions = students.map(student => ({
        student_id: student.id,
        exam_paper_id: paperId,
        total_points: paper.total_points,
        status: 'pending'
      }));

      await supabaseAdmin
        .from('student_exam_submissions')
        .insert(submissions);
    }

    res.json({
      success: true,
      paper: updatedPaper,
      distributedTo: students?.length || 0
    });
  } catch (error) {
    console.error('Distribute exam error:', error);
    res.status(500).json({
      success: false,
      error: '시험지 배포 중 오류가 발생했습니다.'
    });
  }
});

/**
 * GET /api/exams/papers
 * 강사의 시험지 목록 조회
 */
router.get('/papers', authenticate, authorize(ROLES.INSTRUCTOR), async (req, res) => {
  try {
    const { classId, status } = req.query;

    let query = supabaseAdmin
      .from('exam_papers')
      .select(`
        *,
        submissions:student_exam_submissions (
          id,
          status,
          score
        )
      `)
      .eq('instructor_id', req.user.id)
      .order('created_at', { ascending: false });

    if (classId) {
      query = query.eq('class_id', classId);
    }

    if (status) {
      query = query.eq('status', status);
    }

    const { data: papers, error } = await query;

    if (error) {
      return res.status(500).json({
        success: false,
        error: '시험지 조회 중 오류가 발생했습니다.'
      });
    }

    // 각 시험지별 통계 계산
    const papersWithStats = papers.map(paper => {
      const submissions = paper.submissions || [];
      const submitted = submissions.filter(s => s.status !== 'pending');
      const graded = submissions.filter(s => s.status === 'graded' || s.status === 'reviewed');
      const avgScore = graded.length > 0
        ? graded.reduce((sum, s) => sum + (s.score || 0), 0) / graded.length
        : null;

      return {
        ...paper,
        stats: {
          totalStudents: submissions.length,
          submitted: submitted.length,
          graded: graded.length,
          averageScore: avgScore ? Math.round(avgScore * 100) / 100 : null
        },
        submissions: undefined // 상세 데이터 제거
      };
    });

    res.json({
      success: true,
      papers: papersWithStats
    });
  } catch (error) {
    console.error('Get exam papers error:', error);
    res.status(500).json({
      success: false,
      error: '시험지 조회 중 오류가 발생했습니다.'
    });
  }
});

// ============================================================================
// 학생 전용 API
// ============================================================================

/**
 * GET /api/exams/available
 * 학생에게 배포된 시험지 목록 조회
 */
router.get('/available', authenticate, authorize(ROLES.STUDENT), async (req, res) => {
  try {
    const { data: submissions, error } = await supabaseAdmin
      .from('student_exam_submissions')
      .select(`
        id,
        status,
        exam_papers (
          id,
          title,
          description,
          subject,
          total_questions,
          total_points,
          due_date,
          distributed_at
        )
      `)
      .eq('student_id', req.user.id)
      .eq('status', 'pending');

    if (error) {
      return res.status(500).json({
        success: false,
        error: '시험 목록 조회 중 오류가 발생했습니다.'
      });
    }

    res.json({
      success: true,
      exams: submissions.map(s => ({
        submissionId: s.id,
        ...s.exam_papers
      }))
    });
  } catch (error) {
    console.error('Get available exams error:', error);
    res.status(500).json({
      success: false,
      error: '시험 목록 조회 중 오류가 발생했습니다.'
    });
  }
});

/**
 * POST /api/exams/submissions/:submissionId/submit
 * 학생 시험 제출
 */
router.post('/submissions/:submissionId/submit', authenticate, authorize(ROLES.STUDENT), async (req, res) => {
  try {
    const { submissionId } = req.params;
    const { answers, selfAnalysis } = req.body;

    // 제출 권한 확인
    const { data: submission, error: fetchError } = await supabaseAdmin
      .from('student_exam_submissions')
      .select(`
        *,
        exam_papers (
          total_points,
          question_data
        )
      `)
      .eq('id', submissionId)
      .eq('student_id', req.user.id)
      .single();

    if (fetchError || !submission) {
      return res.status(404).json({
        success: false,
        error: '시험을 찾을 수 없습니다.'
      });
    }

    if (submission.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: '이미 제출된 시험입니다.'
      });
    }

    // AI로 오답 분석 (Gemini Flash)
    let aiAnalysis = null;
    if (selfAnalysis && Object.keys(selfAnalysis).length > 0) {
      try {
        aiAnalysis = await analyzeWrongAnswers(selfAnalysis, submission.exam_papers.question_data);
      } catch (aiError) {
        console.error('AI analysis error:', aiError);
        // AI 분석 실패해도 제출은 진행
      }
    }

    // 제출 정보 업데이트
    const { data: updatedSubmission, error: updateError } = await supabaseAdmin
      .from('student_exam_submissions')
      .update({
        answers,
        self_analysis: selfAnalysis,
        ai_analysis: aiAnalysis,
        status: 'submitted',
        submitted_at: new Date().toISOString()
      })
      .eq('id', submissionId)
      .select()
      .single();

    if (updateError) {
      return res.status(500).json({
        success: false,
        error: '시험 제출 중 오류가 발생했습니다.'
      });
    }

    res.json({
      success: true,
      submission: updatedSubmission,
      aiAnalysis
    });
  } catch (error) {
    console.error('Submit exam error:', error);
    res.status(500).json({
      success: false,
      error: '시험 제출 중 오류가 발생했습니다.'
    });
  }
});

// ============================================================================
// 공통 API
// ============================================================================

/**
 * GET /api/exams/submissions/:submissionId
 * 제출 상세 조회
 */
router.get('/submissions/:submissionId', authenticate, async (req, res) => {
  try {
    const { submissionId } = req.params;

    let query = supabaseAdmin
      .from('student_exam_submissions')
      .select(`
        *,
        exam_papers (
          id,
          title,
          subject,
          total_points,
          question_data
        )
      `)
      .eq('id', submissionId);

    // 학생은 자신의 제출만 조회 가능
    if (req.user.role === ROLES.STUDENT) {
      query = query.eq('student_id', req.user.id);
    }

    const { data: submission, error } = await query.single();

    if (error || !submission) {
      return res.status(404).json({
        success: false,
        error: '제출 정보를 찾을 수 없습니다.'
      });
    }

    res.json({
      success: true,
      submission
    });
  } catch (error) {
    console.error('Get submission error:', error);
    res.status(500).json({
      success: false,
      error: '제출 정보 조회 중 오류가 발생했습니다.'
    });
  }
});

module.exports = router;
