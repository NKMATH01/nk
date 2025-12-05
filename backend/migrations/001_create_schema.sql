-- ============================================================================
-- NK-LMS v2.0 Database Schema
-- 하이브리드 데이터 전략: Zone A (Read-Only) + Zone B (Read/Write)
-- ============================================================================

-- ============================================================================
-- [ZONE A] 레거시 테이블 (Read-Only) - 참조만 가능, 절대 수정 금지
-- 이 테이블들은 이미 존재한다고 가정합니다.
-- ============================================================================

/*
-- 기존 테이블 구조 (참조용 주석)

CREATE TABLE instructors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE,
    phone VARCHAR(20),
    subject VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE classes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    instructor_id UUID REFERENCES instructors(id),
    grade_level VARCHAR(20),
    subject VARCHAR(100),
    schedule JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    class_id UUID REFERENCES classes(id),
    parent_phone VARCHAR(20) NOT NULL,  -- 학부모 로그인 키
    grade VARCHAR(20),
    enrollment_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE homework_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES students(id),
    assignment_date DATE NOT NULL,
    subject VARCHAR(100),
    completion_rate DECIMAL(5,2),  -- 0.00 ~ 100.00
    accuracy_rate DECIMAL(5,2),
    time_spent_minutes INTEGER,
    notes TEXT,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);
*/

-- ============================================================================
-- [ZONE B] 신규 NK-LMS 테이블 (Read/Write)
-- Zone A의 id를 Foreign Key로 참조만 합니다.
-- ============================================================================

-- 1. 시험지 테이블 (강사가 배포하는 시험지)
CREATE TABLE IF NOT EXISTS exam_papers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Zone A 참조 (Foreign Key)
    instructor_id UUID NOT NULL,  -- REFERENCES instructors(id)
    class_id UUID NOT NULL,       -- REFERENCES classes(id)

    -- 시험지 정보
    title VARCHAR(255) NOT NULL,
    description TEXT,
    subject VARCHAR(100) NOT NULL,
    total_questions INTEGER NOT NULL DEFAULT 0,
    total_points INTEGER NOT NULL DEFAULT 100,

    -- 시험지 상태
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'distributed', 'closed')),
    distributed_at TIMESTAMPTZ,
    due_date TIMESTAMPTZ,

    -- 메타데이터
    question_data JSONB,  -- 문제 목록 JSON
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 학생 시험 제출 테이블 (답안 및 오답 원인 분석)
CREATE TABLE IF NOT EXISTS student_exam_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Zone A 참조
    student_id UUID NOT NULL,     -- REFERENCES students(id)

    -- Zone B 참조
    exam_paper_id UUID NOT NULL REFERENCES exam_papers(id) ON DELETE CASCADE,

    -- 점수 정보
    score DECIMAL(5,2),           -- 획득 점수
    total_points INTEGER,         -- 총점
    percentage DECIMAL(5,2),      -- 백분율

    -- 학생 입력 데이터
    answers JSONB,                -- 학생이 제출한 답안 {문제번호: 답안}
    wrong_answers JSONB,          -- 틀린 문제 목록

    -- 오답 원인 분석 (학생 자가 분석)
    self_analysis JSONB,          -- 학생이 입력한 오답 원인
    /*
    예시:
    {
        "question_3": {"reason": "개념_미숙지", "note": "공식 암기 안됨"},
        "question_7": {"reason": "계산_실수", "note": "부호 실수"}
    }
    */

    -- AI 자동 분석 (Gemini Flash)
    ai_analysis JSONB,            -- AI가 분석한 오답 패턴
    /*
    예시:
    {
        "primary_weakness": "분수_연산",
        "pattern": "반복적인 계산 실수",
        "suggestion": "계산 과정을 단계별로 적는 연습 필요",
        "confidence": 0.85
    }
    */

    -- 강사 상세 분석 (강사 입력)
    instructor_feedback TEXT,
    instructor_analysis JSONB,

    -- 상태 관리
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'graded', 'reviewed')),
    submitted_at TIMESTAMPTZ,
    graded_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 일일 학습 로그 테이블 (점수/태도/기분)
CREATE TABLE IF NOT EXISTS daily_mood_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Zone A 참조
    student_id UUID NOT NULL,     -- REFERENCES students(id)
    class_id UUID,                -- REFERENCES classes(id)

    -- 날짜
    log_date DATE NOT NULL DEFAULT CURRENT_DATE,

    -- 태도/기분 평가 (1-5 척도)
    mood_score INTEGER CHECK (mood_score BETWEEN 1 AND 5),        -- 학습 기분
    focus_score INTEGER CHECK (focus_score BETWEEN 1 AND 5),      -- 집중도
    participation_score INTEGER CHECK (participation_score BETWEEN 1 AND 5),  -- 참여도

    -- 강사 관찰 메모
    instructor_note TEXT,

    -- AI 격려 메시지 (Gemini Flash)
    ai_encouragement TEXT,

    -- 메타데이터
    recorded_by UUID,             -- 기록한 강사 ID
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- 중복 방지: 학생당 하루에 하나의 로그만
    UNIQUE(student_id, log_date)
);

-- 4. AI 리포트 히스토리 테이블 (생성된 보고서 캐싱)
CREATE TABLE IF NOT EXISTS ai_report_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Zone A 참조
    student_id UUID NOT NULL,     -- REFERENCES students(id)

    -- 보고서 유형
    report_type VARCHAR(20) NOT NULL CHECK (report_type IN ('weekly', 'monthly', 'special')),
    report_period_start DATE NOT NULL,
    report_period_end DATE NOT NULL,

    -- AI 생성 데이터 (Gemini 2.5 Pro)
    report_content JSONB NOT NULL,
    /*
    구조:
    {
        "title": "2024년 12월 1주차 학습 보고서",
        "summary": "이번 주 김민수 학생은...",
        "detailed_analysis": {
            "strengths": ["..."],
            "improvements": ["..."],
            "exam_performance": {...},
            "homework_performance": {...}
        },
        "recommendations": ["...", "..."],
        "encouragement_message": "...",
        "generated_at": "2024-12-05T10:00:00Z"
    }
    */

    -- 사용된 소스 데이터 스냅샷
    source_data_snapshot JSONB,

    -- AI 모델 정보
    ai_model VARCHAR(50) DEFAULT 'gemini-2.5-pro',
    generation_tokens INTEGER,

    -- 상태
    status VARCHAR(20) DEFAULT 'generated' CHECK (status IN ('generating', 'generated', 'failed', 'archived')),
    viewed_at TIMESTAMPTZ,        -- 학부모가 열람한 시간

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 인덱스 생성 (성능 최적화)
-- ============================================================================

-- exam_papers 인덱스
CREATE INDEX IF NOT EXISTS idx_exam_papers_class ON exam_papers(class_id);
CREATE INDEX IF NOT EXISTS idx_exam_papers_instructor ON exam_papers(instructor_id);
CREATE INDEX IF NOT EXISTS idx_exam_papers_status ON exam_papers(status);
CREATE INDEX IF NOT EXISTS idx_exam_papers_distributed ON exam_papers(distributed_at) WHERE status = 'distributed';

-- student_exam_submissions 인덱스
CREATE INDEX IF NOT EXISTS idx_submissions_student ON student_exam_submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_submissions_exam ON student_exam_submissions(exam_paper_id);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON student_exam_submissions(status);
CREATE INDEX IF NOT EXISTS idx_submissions_submitted ON student_exam_submissions(submitted_at);

-- daily_mood_logs 인덱스
CREATE INDEX IF NOT EXISTS idx_mood_logs_student ON daily_mood_logs(student_id);
CREATE INDEX IF NOT EXISTS idx_mood_logs_date ON daily_mood_logs(log_date);
CREATE INDEX IF NOT EXISTS idx_mood_logs_student_date ON daily_mood_logs(student_id, log_date);

-- ai_report_history 인덱스
CREATE INDEX IF NOT EXISTS idx_reports_student ON ai_report_history(student_id);
CREATE INDEX IF NOT EXISTS idx_reports_type ON ai_report_history(report_type);
CREATE INDEX IF NOT EXISTS idx_reports_period ON ai_report_history(report_period_start, report_period_end);
CREATE INDEX IF NOT EXISTS idx_reports_created ON ai_report_history(created_at DESC);

-- ============================================================================
-- RLS (Row Level Security) 정책
-- ============================================================================

-- 테이블별 RLS 활성화
ALTER TABLE exam_papers ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_exam_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_mood_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_report_history ENABLE ROW LEVEL SECURITY;

-- 정책은 Supabase 대시보드 또는 별도 마이그레이션에서 역할별로 설정

-- ============================================================================
-- 트리거: updated_at 자동 갱신
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_exam_papers_updated_at
    BEFORE UPDATE ON exam_papers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_submissions_updated_at
    BEFORE UPDATE ON student_exam_submissions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 유틸리티 뷰: 학생-숙제-시험 통합 조회 (Zone A + Zone B 조인)
-- ============================================================================

-- 이 뷰는 강사가 학생의 종합적인 학습 현황을 볼 때 사용합니다.
-- homework_logs(Zone A)와 student_exam_submissions(Zone B)를 조인합니다.

/*
CREATE OR REPLACE VIEW student_comprehensive_view AS
SELECT
    s.id AS student_id,
    s.name AS student_name,
    s.parent_phone,
    c.name AS class_name,

    -- 최근 시험 성적 (Zone B)
    sub.score AS latest_exam_score,
    sub.percentage AS latest_exam_percentage,
    sub.ai_analysis AS exam_ai_analysis,

    -- 최근 숙제 현황 (Zone A - homework_logs)
    hw.completion_rate AS latest_homework_completion,
    hw.accuracy_rate AS latest_homework_accuracy,

    -- 최근 태도 (Zone B)
    mood.mood_score,
    mood.focus_score,
    mood.participation_score

FROM students s
LEFT JOIN classes c ON s.class_id = c.id
LEFT JOIN LATERAL (
    SELECT * FROM student_exam_submissions
    WHERE student_id = s.id
    ORDER BY submitted_at DESC LIMIT 1
) sub ON true
LEFT JOIN LATERAL (
    SELECT * FROM homework_logs
    WHERE student_id = s.id
    ORDER BY assignment_date DESC LIMIT 1
) hw ON true
LEFT JOIN LATERAL (
    SELECT * FROM daily_mood_logs
    WHERE student_id = s.id
    ORDER BY log_date DESC LIMIT 1
) mood ON true;
*/

-- ============================================================================
-- 완료
-- ============================================================================
