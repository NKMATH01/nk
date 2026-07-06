-- ═══════════════════════════════════════════════════════════════════
--  NK 약술논술 AI 케어 — Supabase 초기 설정 스크립트 (v2)
--  사용법: Supabase 대시보드 → SQL Editor → 아래 전체 붙여넣고 [Run]
--
--  ⚠️ 경고: 아래 "기존 테이블 삭제" 블록은 v1 테이블을 포함해 이 앱의
--     모든 테이블과 그 안의 데이터를 삭제합니다. 처음 설치가 아니라면,
--     반드시 먼저 데이터를 백업하세요. 재설치가 아니면 DROP 블록을
--     주석 처리(각 줄 앞에 --)한 뒤 실행하세요.
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────
--  기존 테이블 삭제 (재설치 시). 신규 설치면 그대로 실행해도 무방합니다.
-- ─────────────────────────────────────────────
drop table if exists counseling_notes cascade;
drop table if exists teacher_comments cascade;
drop table if exists essay_gradings cascade;
drop table if exists homework_records cascade;
drop table if exists scores cascade;
drop table if exists questions cascade;
drop table if exists test_sessions cascade;
drop table if exists student_targets cascade;
drop table if exists accounts cascade;
drop table if exists universities cascade;
drop table if exists students cascade;
-- v1 잔재 테이블(있으면) 정리
drop table if exists weekly_tests cascade;
drop table if exists question_records cascade;
drop table if exists essay_records cascade;
drop table if exists target_universities cascade;

-- ─────────────────────────────────────────────
--  테이블 생성
-- ─────────────────────────────────────────────
create table students (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  grade_type text not null check (grade_type in ('고3','N수')),
  school text,
  naesin_grade numeric,
  parent_phone text,
  consent_date date,
  status text not null default '재원' check (status in ('재원','퇴원')),
  created_at timestamptz default now()
);

create table universities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  campus text,
  region text,
  essay_only boolean default false,
  essay_ratio text,
  naesin_ratio text,
  min_grade_rule text,
  math_scope text default '수Ⅰ·수Ⅱ',
  question_mix text,
  exam_date date,
  quota int,
  confirmed boolean default false,
  notes text
);

create table student_targets (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id) on delete cascade,
  university_id uuid references universities(id) on delete cascade,
  priority int check (priority between 1 and 3),
  unique (student_id, university_id)
);

create table test_sessions (
  id uuid primary key default gen_random_uuid(),
  week_no int,
  exam_date date,
  scope_units text,
  total_score numeric,
  memo text,
  created_at timestamptz default now()
);

create table questions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references test_sessions(id) on delete cascade,
  no int,
  unit text,
  cognition text,
  points numeric,
  source text,
  unique (session_id, no)
);

create table scores (
  id uuid primary key default gen_random_uuid(),
  question_id uuid references questions(id) on delete cascade,
  student_id uuid references students(id) on delete cascade,
  earned numeric,
  wrong_reason text,
  unique (question_id, student_id)
);

-- 과제 점검 (풀이 채점 결과. 숙제 제출 관리는 외부 앱 담당 → submitted 없음)
create table homework_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id) on delete cascade,
  week_date date not null,
  problems_total int not null,       -- 전체 문항 수
  problems_correct int not null,     -- 맞은 문항 수 (0 ~ problems_total)
  time_min int,                      -- 걸린 시간(분)
  memo text,
  created_at timestamptz default now()
);

create table essay_gradings (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id) on delete cascade,
  week_date date,
  univ_name text,
  cond_earned numeric, cond_max numeric,
  proc_earned numeric, proc_max numeric,
  ans_earned numeric,  ans_max numeric,
  comment text,
  created_at timestamptz default now()
);

create table teacher_comments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id) on delete cascade,
  week_no int,
  comment text,
  created_at timestamptz default now()
);

-- 상담 기록 (관리자 전용. 학생·학부모 화면에는 노출하지 않음)
create table counseling_notes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id) on delete cascade,
  note_date date not null,
  category text default '정기상담' check (category in ('정기상담','학부모상담','진로·지원상담','기타')),
  content text not null,
  follow_up text,
  created_at timestamptz default now()
);

create table accounts (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,
  password_hash text not null,
  role text not null check (role in ('admin','student','parent')),
  student_id uuid references students(id) on delete set null
);

-- ─────────────────────────────────────────────
--  RLS (단일 학원 내부용 · anon 전체 허용 permissive 정책)
--  ※ 보안 한계는 README_설치가이드.md 참조
-- ─────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'students','universities','student_targets','test_sessions','questions',
    'scores','homework_records','essay_gradings','teacher_comments','counseling_notes','accounts'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists "allow_all_anon" on %I;', t);
    execute format('create policy "allow_all_anon" on %I for all to anon using (true) with check (true);', t);
    execute format('drop policy if exists "allow_all_auth" on %I;', t);
    execute format('create policy "allow_all_auth" on %I for all to authenticated using (true) with check (true);', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────
--  대학 시드: 2027학년도 약술형 논술 실시 15개 대학 (시행계획 기준)
--  ※ confirmed=false → 앱에서 "시행계획 기준" 배지 표시. 반영비율·수능최저·
--     고사일·모집인원은 각 대학 최종 모집요강 확정 시 [대학 정보] 화면에서 갱신하세요.
--     exam_date는 예시(late Nov ~ early Dec 2026)이며 실제 일정과 다를 수 있습니다.
-- ─────────────────────────────────────────────
insert into universities (name, campus, region, essay_only, essay_ratio, naesin_ratio, min_grade_rule, question_mix, exam_date, quota, confirmed, notes) values
('국민대',   null,   '서울', true,  '논술 100%',         '미반영','요강 확인 필요','국어 단답+수학 서술 12문항','2026-11-22',210,false,'EBS 수특·수완 기반'),
('상명대',   null,   '서울', false, '논술 70%+내신 30%', '30%',  '요강 확인 필요','국어+수학 10문항',       '2026-11-29',160,false,null),
('서경대',   null,   '서울', true,  '논술 100%',         '미반영','요강 확인 필요','수학 서술 위주 10문항',   '2026-11-15',120,false,null),
('삼육대',   null,   '서울', true,  '논술 100%',         '미반영','요강 확인 필요','국어+수학 12문항',       '2026-12-06', 95,false,null),
('가천대',   null,   '경기', true,  '논술 100%',         '미반영','요강 확인 필요','국어 단답+수학 15문항',   '2026-11-28',360,false,'문항 수 많음'),
('강남대',   null,   '경기', false, '논술 60%+내신 40%', '40%',  '요강 확인 필요','국어+수학 10문항',       '2026-11-21',110,false,null),
('수원대',   null,   '경기', false, '논술 70%+내신 30%', '30%',  '요강 확인 필요','수학 서술 12문항',       '2026-11-22',180,false,null),
('신한대',   null,   '경기', false, '논술 60%+내신 40%', '40%',  '요강 확인 필요','국어+수학 10문항',       '2026-11-15', 90,false,null),
('을지대',   null,   '경기', false, '논술 70%+내신 30%', '30%',  '요강 확인 필요','수학 중심 10문항',       '2026-12-05', 70,false,null),
('한국공학대',null,  '경기', false, '논술 70%+내신 30%', '30%',  '요강 확인 필요','수학 서술 12문항',       '2026-11-29',130,false,null),
('한국외대', '글로벌','경기', true,  '논술 100%',         '미반영','요강 확인 필요','국어+수학 10문항',       '2026-11-22',150,false,'글로벌캠퍼스'),
('한신대',   null,   '경기', false, '논술 60%+내신 40%', '40%',  '요강 확인 필요','국어+수학 10문항',       '2026-11-28', 80,false,null),
('고려대',   '세종', '충청', true,  '논술 100%',         '미반영','요강 확인 필요','수학 서술 12문항',       '2026-12-06',200,false,'세종캠퍼스'),
('홍익대',   '세종', '충청', false, '논술 70%+내신 30%', '30%',  '요강 확인 필요','수학 중심 10문항',       '2026-11-29',140,false,'세종캠퍼스'),
('한국기술교육대',null,'충청',true, '논술 100%',         '미반영','요강 확인 필요','수학 서술 12문항',       '2026-11-21', 85,false,null);

-- ─────────────────────────────────────────────
--  초기 관리자 계정 생성
-- ─────────────────────────────────────────────
--  password_hash = SHA-256( 전화번호 + 비밀번호 )  (salt = 전화번호)
--  HTML 앱의 hashPassword()와 정확히 동일합니다.
--
--  ▶ 해시 만드는 방법:
--    1) index.html 을 브라우저에서 열되 주소 끝에 ?hashgen=1 을 붙입니다.
--    2) 전화번호·비밀번호를 입력하고 [해시 생성]을 누릅니다.
--    3) 아래 형식의 INSERT를 완성해 실행하세요. (도구가 완성된 INSERT도 보여줍니다.)
--
--    insert into accounts (phone, password_hash, role)
--    values ('01012345678', '여기에_hashgen으로_만든_해시', 'admin');
--
--  (참고) 전화번호 01012345678 / 비밀번호 nk1234 로 만든 실제 해시:
--    insert into accounts (phone, password_hash, role)
--    values ('01012345678',
--            '9e35bef181bc4b141aae745dbbde5ac19cbeded1a56e73eebcbd5b2bab34087d',
--            'admin');
--  ※ 위 예시를 실행하면 01012345678 / nk1234 로 로그인됩니다.
--    운영 시에는 반드시 본인만의 전화번호·비밀번호로 새 해시를 만드세요.
--
--  ※ 학생·학부모 계정은 앱의 [학생 관리] 화면에서 각 학생별로 생성합니다.
