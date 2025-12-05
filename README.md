# NK-LMS v2.0

NK 학원 지능형 학습 관리 시스템 (Intelligent Learning Management System)

## 프로젝트 개요

NK-LMS는 학원 학생들의 학습 데이터를 관리하고 AI 기반 분석 보고서를 제공하는 시스템입니다.

### 주요 기능

- **학부모**: 전화번호 기반 Passwordless 로그인, AI 학습 보고서 열람
- **강사**: 시험지 배포, 학생 종합 분석, 보고서 생성
- **학생**: 시험 응시, 오답 원인 입력, AI 피드백 확인

## 기술 스택

| 영역 | 기술 |
|------|------|
| Frontend | React 18, Tailwind CSS, React Query, Vite |
| Backend | Node.js, Express |
| Database | Supabase (PostgreSQL) |
| AI | Gemini 2.5 Pro/Flash |

## 데이터베이스 전략

### 하이브리드 데이터 전략

**Zone A (Read-Only)** - 레거시 데이터, 절대 수정 금지
- `students` - 학생 정보
- `instructors` - 강사 정보
- `classes` - 반 정보
- `homework_logs` - 외부 숙제 프로그램 연동 데이터

**Zone B (Read/Write)** - 신규 NK-LMS 데이터
- `exam_papers` - 시험지
- `student_exam_submissions` - 학생 시험 제출
- `daily_mood_logs` - 일일 학습 태도
- `ai_report_history` - AI 보고서 캐싱

## AI 모델 전략

| 모델 | 용도 | 특징 |
|------|------|------|
| Gemini 2.5 Pro | 학부모 보고서 생성 | 깊이 있는 분석, 정중한 어조 |
| Gemini 2.5 Flash | 오답 분석, 격려 메시지 | 빠른 응답, 비용 효율 |

## 프로젝트 구조

```
nk/
├── backend/
│   ├── src/
│   │   ├── config/         # 설정 (Supabase, Gemini)
│   │   ├── middleware/     # 인증, 권한 관리
│   │   ├── routes/         # API 라우트
│   │   ├── services/       # 비즈니스 로직
│   │   └── index.js        # 서버 진입점
│   ├── migrations/         # DB 스키마
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/     # 공통 컴포넌트
│   │   ├── contexts/       # React Context
│   │   ├── pages/          # 페이지 컴포넌트
│   │   ├── services/       # API 서비스
│   │   └── App.jsx
│   └── package.json
└── docs/
```

## 설치 및 실행

### 사전 요구사항

- Node.js 18+
- Supabase 계정
- Google AI (Gemini) API 키

### 백엔드 설정

```bash
cd backend
npm install
cp .env.example .env
# .env 파일에 환경변수 설정
npm run dev
```

### 프론트엔드 설정

```bash
cd frontend
npm install
npm run dev
```

### 환경변수

```env
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Gemini AI
GEMINI_API_KEY=your-gemini-api-key

# Server
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
```

## API 엔드포인트

### 인증

| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/auth/parent-login` | 학부모 로그인 (전화번호) |
| POST | `/api/auth/instructor-login` | 강사 로그인 |
| POST | `/api/auth/student-login` | 학생 로그인 |

### 시험

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/exams/papers` | 시험지 목록 (강사) |
| POST | `/api/exams/papers` | 시험지 생성 (강사) |
| POST | `/api/exams/papers/:id/distribute` | 시험지 배포 (강사) |
| GET | `/api/exams/available` | 응시 가능 시험 (학생) |
| POST | `/api/exams/submissions/:id/submit` | 시험 제출 (학생) |

### 보고서

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/reports/students/:studentId` | 학생 보고서 목록 |
| GET | `/api/reports/:reportId` | 보고서 상세 |
| POST | `/api/reports/generate` | 보고서 생성 (강사) |

### 학생

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/students` | 학생 목록 (강사) |
| GET | `/api/students/:id/comprehensive` | 학생 종합 분석 (강사) |
| POST | `/api/students/:id/mood` | 학습 태도 기록 (강사) |

## 라이선스

Private - NK Academy
