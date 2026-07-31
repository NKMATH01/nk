-- ═══════════════════════════════════════════════════════════════════
--  0001_baseline — NK 약술논술 AI 케어 현행 스키마 기준선
--
--  출처
--    2026-07-31 운영 DB의 information_schema / pg_catalog 실측 추출본.
--    db/legacy/supabase_setup_DO_NOT_RUN.sql(v2) 이후 앱 개발 과정에서
--    수동으로 추가된 컬럼(드리프트)까지 모두 반영했다.
--
--  범위
--    NK 약술논술 프로그램 소속 11개 테이블 + Storage 버킷 grading-photos
--    + storage.objects 정책 2개.
--    ※ 이 DB에는 타 프로젝트(영상 파이프라인) 테이블이 동거한다.
--      project, provider_job, render_job, scene, scene_alignment, scene_asset,
--      scene_audio, scene_subtitle, system_config, voice_preset 및 버킷
--      temp / characters 가 그것이며, 본 마이그레이션 체계의 관리 대상이 아니다.
--      이 파일은 그것들을 생성하지도 변경하지도 않는다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 [Run].
--
--  안전성
--    모든 문이 멱등(idempotent)이다. 재실행해도 데이터가 삭제되거나
--    중복되지 않는다. 두 가지 시나리오를 모두 상정한다.
--      (A) 신규 빈 DB  — create table if not exists 로 전체 스키마 재현
--      (B) 현행 운영 DB — create table 은 no-op, 아래 "드리프트 컬럼" 절의
--                        add column if not exists 만 실제로 동작
--    drop table / truncate / delete 는 이 파일에 존재하지 않는다.
--
--  제외
--    대학 시드 데이터는 포함하지 않는다(재실행 시 중복되므로).
--    운영 DB에는 이미 적재되어 있고, 신규 DB는 앱 [대학 정보] 화면에서 입력한다.
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ═══════════════════════════════════════════════════════════════════
--  1) 테이블 (FK 의존 순서대로)
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.students (
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

create table if not exists public.universities (
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
  quota integer,
  confirmed boolean default false,
  notes text,
  last_competition numeric,
  last_cut_pct numeric,
  last_result_note text
);

create table if not exists public.test_sessions (
  id uuid primary key default gen_random_uuid(),
  week_no integer,
  exam_date date,
  scope_units text,
  total_score numeric,
  memo text,
  created_at timestamptz default now()
);

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,
  password_hash text not null,
  role text not null check (role in ('admin','student','parent')),
  student_id uuid references public.students(id) on delete set null
);

create table if not exists public.student_targets (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete cascade,
  university_id uuid references public.universities(id) on delete cascade,
  priority integer check (priority >= 1 and priority <= 3),
  unique (student_id, university_id)
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.test_sessions(id) on delete cascade,
  no integer,
  unit text,
  cognition text,
  points numeric,
  source text,
  unique (session_id, no)
);

create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  question_id uuid references public.questions(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  earned numeric,
  wrong_reason text,
  reason_note text,
  photo_url text,
  unique (question_id, student_id)
);

-- 과제 점검(풀이 채점 결과). 숙제 제출 관리는 외부 앱 담당 → submitted 컬럼 없음.
create table if not exists public.homework_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete cascade,
  week_date date not null,
  problems_total integer not null,
  problems_correct integer not null,
  time_min integer,
  memo text,
  created_at timestamptz default now(),
  book text,
  page_from integer,
  page_to integer
);

create table if not exists public.essay_gradings (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete cascade,
  week_date date,
  univ_name text,
  cond_earned numeric,
  cond_max numeric,
  proc_earned numeric,
  proc_max numeric,
  ans_earned numeric,
  ans_max numeric,
  comment text,
  created_at timestamptz default now()
);

create table if not exists public.teacher_comments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete cascade,
  week_no integer,
  comment text,
  created_at timestamptz default now()
);

-- 상담 기록(관리자 전용). visible_to_student=true 인 건만 학생 화면에 노출.
create table if not exists public.counseling_notes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete cascade,
  note_date date not null,
  category text default '정기상담' check (category in ('정기상담','학부모상담','진로·지원상담','기타')),
  content text not null,
  follow_up text,
  created_at timestamptz default now(),
  visible_to_student boolean not null default false
);

-- ═══════════════════════════════════════════════════════════════════
--  2) 드리프트 컬럼 보정
--
--  아래 9개 컬럼은 v2 스크립트(db/legacy/) 이후 앱 개발 중 수동으로 추가된
--  것이라, 과거 v2로 구축한 DB에는 없을 수 있다. 위의 create table 은
--  기존 테이블에 대해 no-op 이므로 반드시 별도로 보정해야 한다.
--  신규 빈 DB에서는 이미 위에서 생성되었으므로 전부 no-op 이다.
-- ═══════════════════════════════════════════════════════════════════

alter table public.universities     add column if not exists last_competition   numeric;
alter table public.universities     add column if not exists last_cut_pct       numeric;
alter table public.universities     add column if not exists last_result_note   text;
alter table public.scores           add column if not exists reason_note        text;
alter table public.scores           add column if not exists photo_url          text;
alter table public.homework_records add column if not exists book               text;
alter table public.homework_records add column if not exists page_from          integer;
alter table public.homework_records add column if not exists page_to            integer;
alter table public.counseling_notes add column if not exists visible_to_student boolean not null default false;

-- ═══════════════════════════════════════════════════════════════════
--  3) RLS
--
--  ※ 현 상태를 그대로 기록한 것이다. anon/authenticated 전면 허용이며
--    실질적인 접근 통제가 없다. Phase 3(Supabase Auth 도입)에서
--    역할 기반 정책으로 강화할 예정이다. 보안 한계는 README_설치가이드.md 참조.
-- ═══════════════════════════════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array[
    'students','universities','student_targets','test_sessions','questions',
    'scores','homework_records','essay_gradings','teacher_comments','counseling_notes','accounts'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "allow_all_anon" on public.%I;', t);
    execute format('create policy "allow_all_anon" on public.%I for all to anon using (true) with check (true);', t);
    execute format('drop policy if exists "allow_all_auth" on public.%I;', t);
    execute format('create policy "allow_all_auth" on public.%I for all to authenticated using (true) with check (true);', t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════
--  4) Storage — 채점 사진 버킷
--
--  ※ public=true 이므로 URL을 아는 사람은 누구나 열람할 수 있다.
--    Phase 3에서 private 버킷 + 서명 URL로 전환 예정.
--    버킷 temp / characters 는 타 프로젝트 소속이라 여기서 다루지 않는다.
-- ═══════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
values ('grading-photos','grading-photos', true)
on conflict (id) do nothing;

drop policy if exists "anon_read_grading" on storage.objects;
create policy "anon_read_grading" on storage.objects
  for select to anon using (bucket_id = 'grading-photos');

drop policy if exists "anon_upload_grading" on storage.objects;
create policy "anon_upload_grading" on storage.objects
  for insert to anon with check (bucket_id = 'grading-photos');

-- ═══════════════════════════════════════════════════════════════════
--  5) 마이그레이션 기록
--
--  이 파일이 0002보다 먼저 실행될 수 있으므로 추적 테이블 정의를
--  자립적으로 포함한다. 정의는 0002_migration_tracking.sql 과 동일하다.
--  (RLS 정책은 0002에서 설정한다.)
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.schema_migrations (
  version    text primary key,
  applied_at timestamptz not null default now()
);

insert into public.schema_migrations (version) values ('0001_baseline')
on conflict do nothing;
