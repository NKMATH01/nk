/**
 * 인증 및 역할 기반 접근 제어 (RBAC) 미들웨어
 */

const { supabaseAdmin } = require('../config/supabase');

/**
 * 사용자 역할 정의
 */
const ROLES = {
  PARENT: 'parent',       // 학부모: 읽기 전용
  STUDENT: 'student',     // 학생: 제한된 쓰기
  INSTRUCTOR: 'instructor' // 강사: 전체 쓰기
};

/**
 * 세션 기반 인증 미들웨어
 * 요청 헤더에서 세션 토큰을 확인합니다.
 */
async function authenticate(req, res, next) {
  try {
    const sessionToken = req.headers['x-session-token'];

    if (!sessionToken) {
      return res.status(401).json({
        success: false,
        error: '인증이 필요합니다.'
      });
    }

    // 세션 검증 (실제 구현에서는 Redis 또는 DB 세션 스토어 사용)
    // 여기서는 간단한 구현을 위해 토큰 파싱
    const session = parseSessionToken(sessionToken);

    if (!session) {
      return res.status(401).json({
        success: false,
        error: '유효하지 않은 세션입니다.'
      });
    }

    req.user = session;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({
      success: false,
      error: '인증 처리 중 오류가 발생했습니다.'
    });
  }
}

/**
 * 역할 기반 접근 제어
 * @param {string[]} allowedRoles - 허용된 역할 배열
 */
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: '인증이 필요합니다.'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: '접근 권한이 없습니다.'
      });
    }

    next();
  };
}

/**
 * 학부모 전용 미들웨어
 * 자녀에 대한 접근만 허용
 */
function parentAccessOnly(req, res, next) {
  if (req.user.role !== ROLES.PARENT) {
    return next();
  }

  const requestedStudentId = req.params.studentId || req.body.studentId;

  if (requestedStudentId && !req.user.studentIds.includes(requestedStudentId)) {
    return res.status(403).json({
      success: false,
      error: '자녀의 정보에만 접근할 수 있습니다.'
    });
  }

  next();
}

/**
 * 세션 토큰 파싱 (간단한 구현)
 * 실제 프로덕션에서는 JWT 또는 보안 세션 관리 사용
 */
function parseSessionToken(token) {
  try {
    // Base64 디코딩 (실제로는 JWT 검증 필요)
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

/**
 * 세션 토큰 생성
 */
function createSessionToken(userData) {
  const session = {
    id: userData.id,
    role: userData.role,
    name: userData.name,
    studentIds: userData.studentIds || [],
    classIds: userData.classIds || [],
    createdAt: new Date().toISOString()
  };

  return Buffer.from(JSON.stringify(session)).toString('base64');
}

module.exports = {
  ROLES,
  authenticate,
  authorize,
  parentAccessOnly,
  createSessionToken,
  parseSessionToken
};
