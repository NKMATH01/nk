/**
 * NK-LMS v2.0 Backend Server
 * NK 학원 지능형 학습 관리 시스템
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const winston = require('winston');

// 라우터 임포트
const authRoutes = require('./routes/auth');
const examRoutes = require('./routes/exams');
const reportRoutes = require('./routes/reports');
const studentRoutes = require('./routes/students');

// ============================================================================
// 로거 설정
// ============================================================================
const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// ============================================================================
// Express 앱 설정
// ============================================================================
const app = express();
const PORT = process.env.PORT || 3001;

// 보안 헤더
app.use(helmet());

// CORS 설정
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// JSON 파싱
app.use(express.json({ limit: '10mb' }));

// 요청 로깅
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  next();
});

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: 100, // 최대 100 요청
  message: {
    success: false,
    error: '너무 많은 요청이 발생했습니다. 잠시 후 다시 시도해주세요.'
  }
});
app.use('/api/', limiter);

// AI 엔드포인트는 더 엄격한 제한
const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1분
  max: 10, // 최대 10 요청
  message: {
    success: false,
    error: 'AI 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.'
  }
});
app.use('/api/reports/generate', aiLimiter);

// ============================================================================
// 라우트 등록
// ============================================================================
app.use('/api/auth', authRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/students', studentRoutes);

// ============================================================================
// 헬스 체크
// ============================================================================
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    service: 'NK-LMS Backend'
  });
});

// API 문서 요약
app.get('/api', (req, res) => {
  res.json({
    name: 'NK-LMS API',
    version: '2.0.0',
    endpoints: {
      auth: {
        'POST /api/auth/parent-login': '학부모 Passwordless 로그인',
        'POST /api/auth/parent-select-child': '자녀 선택',
        'POST /api/auth/instructor-login': '강사 로그인',
        'POST /api/auth/student-login': '학생 로그인'
      },
      exams: {
        'GET /api/exams/papers': '시험지 목록 (강사)',
        'POST /api/exams/papers': '시험지 생성 (강사)',
        'POST /api/exams/papers/:id/distribute': '시험지 배포 (강사)',
        'GET /api/exams/available': '배포된 시험 목록 (학생)',
        'POST /api/exams/submissions/:id/submit': '시험 제출 (학생)'
      },
      reports: {
        'GET /api/reports/students/:studentId': '학생 보고서 목록',
        'GET /api/reports/:reportId': '보고서 상세 조회',
        'POST /api/reports/generate': '보고서 생성 (강사)'
      },
      students: {
        'GET /api/students': '학생 목록 (강사)',
        'GET /api/students/:id': '학생 상세',
        'GET /api/students/:id/comprehensive': '학생 종합 분석 (강사)',
        'GET /api/students/:id/mood': '학습 태도 로그',
        'POST /api/students/:id/mood': '학습 태도 기록 (강사)'
      }
    },
    aiModels: {
      'Gemini 2.5 Pro': '학부모 보고서 생성',
      'Gemini 2.5 Flash': '오답 분석, 격려 메시지'
    }
  });
});

// ============================================================================
// 에러 핸들링
// ============================================================================

// 404 처리
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: '요청하신 리소스를 찾을 수 없습니다.'
  });
});

// 전역 에러 핸들러
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', {
    error: err.message,
    stack: err.stack,
    path: req.path
  });

  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production'
      ? '서버 오류가 발생했습니다.'
      : err.message
  });
});

// ============================================================================
// 서버 시작
// ============================================================================
app.listen(PORT, () => {
  logger.info(`NK-LMS Backend Server is running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`API Documentation: http://localhost:${PORT}/api`);
});

module.exports = app;
