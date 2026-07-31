-- ═══════════════════════════════════════════════════════════════════
--
--   ██  실행 순서 주의  ██
--
--   **이 파일을 코드 배포보다 먼저 실행할 것.** (0008 과 동일)
--   새 코드가 problems 테이블을 조회하고 questions.problem_id 를 함께 저장하므로,
--   먼저 실행하지 않으면 문제은행 화면과 문항 저장이 즉시 실패한다.
--
--   반대로 이 파일만 먼저 실행하는 것은 안전하다.
--   기존 테이블에는 nullable 컬럼 하나만 추가하고, 나머지는 전부 신규 객체다.
--
-- ═══════════════════════════════════════════════════════════════════
--
--  0009_problem_bank
--
--  목적
--    기출·자체·변형 문항을 한곳에 모으는 문제은행.
--    주간테스트 회차를 만들 때 은행에서 골라 넣고, 그 문항의 누적 실적
--    (응시 수·평균 득점률·최다 감점 태그)을 다시 은행에서 확인한다.
--
--  저작권 통제
--    기출 원문은 내부 이용만 허용된다. 그래서
--      · problems 는 RLS 로 **관리자만** 접근(학생 정책 자체를 만들지 않는다)
--      · 문제 이미지 버킷 problem-images 는 private, 열람은 서명 URL 경유
--        (/api/signed-url 이 admin 인지 한 번 더 확인한다)
--      · source_citation 으로 출처를 항상 남기고, license_scope 로 이용 범위를 표시
--
--  안전성
--    전부 멱등이다. 재실행해도 데이터가 삭제되거나 중복되지 않는다.
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
--  1) problems
-- ─────────────────────────────────────────────
create table if not exists public.problems (
  id uuid primary key default gen_random_uuid(),
  origin text not null check (origin in ('기출','자체','변형')),
  parent_id uuid references public.problems(id),      -- 변형 문항의 원본
  university_id uuid references public.universities(id),
  exam_year integer,
  exam_round text,
  unit text,                                          -- js/config.js 의 UNITS 어휘
  cognition text,                                     -- js/config.js 의 COGNITIONS 어휘
  difficulty smallint check (difficulty between 1 and 5),
  body_format text default 'latex' check (body_format in ('latex','image','mixed')),
  body_latex text,
  body_image_paths text[],                            -- problem-images 버킷 내 경로
  answer_latex text,
  solution_latex text,
  rubric jsonb,                                       -- [{criterion,points,tag}]
  points numeric,
  tags text[],
  status text default 'draft' check (status in ('draft','review','published','retired')),
  license_scope text default 'internal' check (license_scope in ('internal','own')),
  source_citation text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table public.problems is
  '문제은행. 기출 원문을 포함하므로 관리자 전용(RLS). 삭제 대신 status=retired 로 보존한다.';
comment on column public.problems.license_scope is
  'internal = 외부 배포 불가(기출 원문 등) / own = 자체 제작물.';

-- 검색 인덱스: 공개된 문항을 단원×사고과정×난이도로 고르는 것이 기본 동선
create index if not exists problems_published_lookup_idx
  on public.problems (unit, cognition, difficulty)
  where status = 'published';

create index if not exists problems_tags_gin_idx
  on public.problems using gin (tags);

-- ─────────────────────────────────────────────
--  2) RLS — 관리자 전용
-- ─────────────────────────────────────────────
--  ※ 학생 정책을 만들지 않는다. 학생·학부모 토큰으로는 한 행도 읽히지 않는다.
--    화면 라우트도 등록하지 않아 이중으로 차단한다.
alter table public.problems enable row level security;

drop policy if exists "admin_all" on public.problems;
create policy "admin_all" on public.problems
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ─────────────────────────────────────────────
--  3) 회차 문항 ↔ 은행 연결
-- ─────────────────────────────────────────────
--  널 허용이라 기존 수동 입력 문항은 그대로 둔다(problem_id 가 비어 있을 뿐).
alter table public.questions add column if not exists problem_id uuid references public.problems(id);

create index if not exists questions_problem_id_idx on public.questions (problem_id);

comment on column public.questions.problem_id is
  '문제은행에서 가져온 문항이면 원본 problems.id. 누적 실적 집계의 연결고리.';

-- ─────────────────────────────────────────────
--  4) 문제 이미지 버킷 (private)
-- ─────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('problem-images','problem-images', false)
on conflict (id) do nothing;

-- 이미 만들어져 있던 경우에도 반드시 private 이어야 한다.
update storage.buckets set public = false where id = 'problem-images';

--  업로드는 로그인 사용자, 열람 정책은 만들지 않는다(서명 URL 전용).
drop policy if exists "auth_upload_problem" on storage.objects;
create policy "auth_upload_problem" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'problem-images' and public.app_token_ok());

drop policy if exists "admin_update_problem" on storage.objects;
create policy "admin_update_problem" on storage.objects
  for update to authenticated
  using (bucket_id = 'problem-images' and public.is_admin())
  with check (bucket_id = 'problem-images' and public.is_admin());

insert into public.schema_migrations (version) values ('0009_problem_bank')
on conflict do nothing;
