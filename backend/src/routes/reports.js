/**
 * AI 보고서 라우트
 * - 학부모: 보고서 열람 (읽기 전용)
 * - 강사: 보고서 생성 트리거
 */

const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const { authenticate, authorize, parentAccessOnly, ROLES } = require('../middleware/auth');
const { generateParentReport } = require('../services/reportService');

/**
 * GET /api/reports/students/:studentId
 * 학생의 보고서 목록 조회 (학부모/강사)
 */
router.get('/students/:studentId', authenticate, authorize(ROLES.PARENT, ROLES.INSTRUCTOR), parentAccessOnly, async (req, res) => {
  try {
    const { studentId } = req.params;
    const { type, limit = 10 } = req.query;

    let query = supabaseAdmin
      .from('ai_report_history')
      .select('*')
      .eq('student_id', studentId)
      .eq('status', 'generated')
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (type) {
      query = query.eq('report_type', type);
    }

    const { data: reports, error } = await query;

    if (error) {
      return res.status(500).json({
        success: false,
        error: '보고서 조회 중 오류가 발생했습니다.'
      });
    }

    res.json({
      success: true,
      reports
    });
  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({
      success: false,
      error: '보고서 조회 중 오류가 발생했습니다.'
    });
  }
});

/**
 * GET /api/reports/:reportId
 * 보고서 상세 조회 및 열람 기록
 */
router.get('/:reportId', authenticate, authorize(ROLES.PARENT, ROLES.INSTRUCTOR), async (req, res) => {
  try {
    const { reportId } = req.params;

    const { data: report, error } = await supabaseAdmin
      .from('ai_report_history')
      .select('*')
      .eq('id', reportId)
      .single();

    if (error || !report) {
      return res.status(404).json({
        success: false,
        error: '보고서를 찾을 수 없습니다.'
      });
    }

    // 학부모 접근 권한 확인
    if (req.user.role === ROLES.PARENT && !req.user.studentIds.includes(report.student_id)) {
      return res.status(403).json({
        success: false,
        error: '접근 권한이 없습니다.'
      });
    }

    // 학부모 열람 시 viewed_at 업데이트
    if (req.user.role === ROLES.PARENT && !report.viewed_at) {
      await supabaseAdmin
        .from('ai_report_history')
        .update({ viewed_at: new Date().toISOString() })
        .eq('id', reportId);
    }

    res.json({
      success: true,
      report
    });
  } catch (error) {
    console.error('Get report detail error:', error);
    res.status(500).json({
      success: false,
      error: '보고서 조회 중 오류가 발생했습니다.'
    });
  }
});

/**
 * POST /api/reports/generate
 * 새 보고서 생성 (강사 전용)
 *
 * 요청 본문:
 * {
 *   studentId: "uuid",
 *   reportType: "weekly" | "monthly",
 *   periodStart: "2024-12-01",
 *   periodEnd: "2024-12-07"
 * }
 */
router.post('/generate', authenticate, authorize(ROLES.INSTRUCTOR), async (req, res) => {
  try {
    const { studentId, reportType, periodStart, periodEnd } = req.body;

    if (!studentId || !reportType || !periodStart || !periodEnd) {
      return res.status(400).json({
        success: false,
        error: '필수 정보를 입력해주세요.'
      });
    }

    // 기존 보고서 중복 확인
    const { data: existingReport } = await supabaseAdmin
      .from('ai_report_history')
      .select('id')
      .eq('student_id', studentId)
      .eq('report_type', reportType)
      .eq('report_period_start', periodStart)
      .eq('report_period_end', periodEnd)
      .single();

    if (existingReport) {
      return res.status(409).json({
        success: false,
        error: '해당 기간의 보고서가 이미 존재합니다.',
        existingReportId: existingReport.id
      });
    }

    // 보고서 생성 상태로 레코드 생성
    const { data: pendingReport, error: insertError } = await supabaseAdmin
      .from('ai_report_history')
      .insert({
        student_id: studentId,
        report_type: reportType,
        report_period_start: periodStart,
        report_period_end: periodEnd,
        report_content: {},
        status: 'generating'
      })
      .select()
      .single();

    if (insertError) {
      return res.status(500).json({
        success: false,
        error: '보고서 생성 초기화 중 오류가 발생했습니다.'
      });
    }

    // AI 보고서 생성 (비동기)
    // 프로덕션에서는 메시지 큐(BullMQ 등)를 사용하는 것이 좋습니다.
    generateParentReport(pendingReport.id, studentId, reportType, periodStart, periodEnd)
      .catch(error => {
        console.error('Report generation failed:', error);
        // 실패 상태로 업데이트
        supabaseAdmin
          .from('ai_report_history')
          .update({ status: 'failed' })
          .eq('id', pendingReport.id);
      });

    res.status(202).json({
      success: true,
      message: '보고서 생성이 시작되었습니다.',
      reportId: pendingReport.id
    });
  } catch (error) {
    console.error('Generate report error:', error);
    res.status(500).json({
      success: false,
      error: '보고서 생성 중 오류가 발생했습니다.'
    });
  }
});

/**
 * GET /api/reports/:reportId/status
 * 보고서 생성 상태 확인
 */
router.get('/:reportId/status', authenticate, async (req, res) => {
  try {
    const { reportId } = req.params;

    const { data: report, error } = await supabaseAdmin
      .from('ai_report_history')
      .select('id, status, created_at')
      .eq('id', reportId)
      .single();

    if (error || !report) {
      return res.status(404).json({
        success: false,
        error: '보고서를 찾을 수 없습니다.'
      });
    }

    res.json({
      success: true,
      reportId: report.id,
      status: report.status
    });
  } catch (error) {
    console.error('Get report status error:', error);
    res.status(500).json({
      success: false,
      error: '상태 조회 중 오류가 발생했습니다.'
    });
  }
});

module.exports = router;
