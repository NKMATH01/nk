/**
 * 인증 라우트
 * - 학부모: 전화번호 기반 Passwordless 로그인
 * - 강사/학생: 일반 로그인
 */

const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const { createSessionToken, ROLES } = require('../middleware/auth');

/**
 * POST /api/auth/parent-login
 * 학부모 Passwordless 로그인
 *
 * 요청: { phone: "010-1234-5678" }
 * 응답:
 *   - 자녀 1명: { success: true, sessionToken: "...", student: {...} }
 *   - 자녀 2명+: { success: true, requiresSelection: true, students: [...] }
 */
router.post('/parent-login', async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: '전화번호를 입력해주세요.'
      });
    }

    // 전화번호 정규화 (하이픈 제거)
    const normalizedPhone = phone.replace(/-/g, '');

    // Zone A: students 테이블에서 해당 전화번호를 가진 학생 조회
    const { data: students, error } = await supabaseAdmin
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
      `)
      .eq('parent_phone', normalizedPhone);

    if (error) {
      console.error('Parent login query error:', error);
      return res.status(500).json({
        success: false,
        error: '로그인 처리 중 오류가 발생했습니다.'
      });
    }

    if (!students || students.length === 0) {
      return res.status(404).json({
        success: false,
        error: '등록된 학생 정보를 찾을 수 없습니다.'
      });
    }

    const studentIds = students.map(s => s.id);

    // 자녀가 2명 이상이면 선택 화면 표시
    if (students.length > 1) {
      return res.json({
        success: true,
        requiresSelection: true,
        students: students.map(s => ({
          id: s.id,
          name: s.name,
          grade: s.grade,
          className: s.classes?.name,
          subject: s.classes?.subject
        }))
      });
    }

    // 자녀가 1명이면 즉시 로그인
    const sessionToken = createSessionToken({
      id: `parent_${normalizedPhone}`,
      role: ROLES.PARENT,
      name: `${students[0].name} 학부모`,
      studentIds: studentIds
    });

    res.json({
      success: true,
      sessionToken,
      student: {
        id: students[0].id,
        name: students[0].name,
        grade: students[0].grade,
        className: students[0].classes?.name
      }
    });
  } catch (error) {
    console.error('Parent login error:', error);
    res.status(500).json({
      success: false,
      error: '로그인 처리 중 오류가 발생했습니다.'
    });
  }
});

/**
 * POST /api/auth/parent-select-child
 * 자녀 선택 후 세션 생성
 */
router.post('/parent-select-child', async (req, res) => {
  try {
    const { phone, studentId } = req.body;

    if (!phone || !studentId) {
      return res.status(400).json({
        success: false,
        error: '전화번호와 자녀 ID를 입력해주세요.'
      });
    }

    const normalizedPhone = phone.replace(/-/g, '');

    // 해당 학부모의 자녀가 맞는지 확인
    const { data: students, error } = await supabaseAdmin
      .from('students')
      .select('id, name, grade')
      .eq('parent_phone', normalizedPhone);

    if (error || !students) {
      return res.status(500).json({
        success: false,
        error: '처리 중 오류가 발생했습니다.'
      });
    }

    const studentIds = students.map(s => s.id);

    if (!studentIds.includes(studentId)) {
      return res.status(403).json({
        success: false,
        error: '접근 권한이 없습니다.'
      });
    }

    const selectedStudent = students.find(s => s.id === studentId);

    const sessionToken = createSessionToken({
      id: `parent_${normalizedPhone}`,
      role: ROLES.PARENT,
      name: `${selectedStudent.name} 학부모`,
      studentIds: studentIds,
      selectedStudentId: studentId
    });

    res.json({
      success: true,
      sessionToken,
      student: selectedStudent
    });
  } catch (error) {
    console.error('Child selection error:', error);
    res.status(500).json({
      success: false,
      error: '처리 중 오류가 발생했습니다.'
    });
  }
});

/**
 * POST /api/auth/instructor-login
 * 강사 로그인
 */
router.post('/instructor-login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: '이메일과 비밀번호를 입력해주세요.'
      });
    }

    // Zone A: instructors 테이블에서 강사 조회
    // 실제로는 비밀번호 해시 비교 필요 (bcrypt 등)
    const { data: instructor, error } = await supabaseAdmin
      .from('instructors')
      .select(`
        id,
        name,
        email,
        subject,
        classes (
          id,
          name
        )
      `)
      .eq('email', email)
      .single();

    if (error || !instructor) {
      return res.status(401).json({
        success: false,
        error: '이메일 또는 비밀번호가 올바르지 않습니다.'
      });
    }

    // 실제 구현에서는 비밀번호 검증 필요
    // if (!await bcrypt.compare(password, instructor.password_hash)) { ... }

    const sessionToken = createSessionToken({
      id: instructor.id,
      role: ROLES.INSTRUCTOR,
      name: instructor.name,
      classIds: instructor.classes?.map(c => c.id) || []
    });

    res.json({
      success: true,
      sessionToken,
      instructor: {
        id: instructor.id,
        name: instructor.name,
        email: instructor.email,
        subject: instructor.subject,
        classes: instructor.classes
      }
    });
  } catch (error) {
    console.error('Instructor login error:', error);
    res.status(500).json({
      success: false,
      error: '로그인 처리 중 오류가 발생했습니다.'
    });
  }
});

/**
 * POST /api/auth/student-login
 * 학생 로그인
 */
router.post('/student-login', async (req, res) => {
  try {
    const { studentId, birthDate } = req.body;

    if (!studentId || !birthDate) {
      return res.status(400).json({
        success: false,
        error: '학생 ID와 생년월일을 입력해주세요.'
      });
    }

    // Zone A: students 테이블에서 학생 조회
    const { data: student, error } = await supabaseAdmin
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
      `)
      .eq('id', studentId)
      .single();

    if (error || !student) {
      return res.status(401).json({
        success: false,
        error: '학생 정보를 찾을 수 없습니다.'
      });
    }

    const sessionToken = createSessionToken({
      id: student.id,
      role: ROLES.STUDENT,
      name: student.name,
      classId: student.class_id
    });

    res.json({
      success: true,
      sessionToken,
      student: {
        id: student.id,
        name: student.name,
        grade: student.grade,
        className: student.classes?.name,
        subject: student.classes?.subject
      }
    });
  } catch (error) {
    console.error('Student login error:', error);
    res.status(500).json({
      success: false,
      error: '로그인 처리 중 오류가 발생했습니다.'
    });
  }
});

/**
 * POST /api/auth/logout
 * 로그아웃
 */
router.post('/logout', (req, res) => {
  // 클라이언트에서 세션 토큰 삭제 처리
  res.json({
    success: true,
    message: '로그아웃되었습니다.'
  });
});

module.exports = router;
