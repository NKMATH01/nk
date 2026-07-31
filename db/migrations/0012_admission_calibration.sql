-- ═══════════════════════════════════════════════════════════════════
--
--   ██  실행 순서 주의  ██
--
--   **코드 배포보다 먼저 실행할 것.** (0008~0011 과 동일)
--   이 파일만 먼저 실행하는 것은 안전하다 — 신규 테이블 2개와
--   teacher_comments 의 nullable 컬럼 2개뿐이다.
--
-- ═══════════════════════════════════════════════════════════════════
--
--  0012_admission_calibration
--
--  목적
--    1) 대학별 입시 실적을 **연도별로** 쌓는다(지금은 작년 1개 값만 있다).
--    2) 우리 판정이 실제로 맞았는지 되짚을 수 있게 결과를 기록한다.
--    3) 리포트 서술 AI 초안을 확정 코멘트와 분리 보관한다.
--
--  중요한 설계 선택
--    admission_outcomes 는 **관리자 전용**이다. 합격·불합격 기록은
--    학생·학부모에게 보일 이유가 없고, 보이면 안 되는 정보다.
--    반면 univ_admission_stats(대학 경쟁률·합격선)는 학생 목표대학
--    화면에서도 참조하므로 로그인 사용자면 읽을 수 있다.
--
--  안전성
--    전부 멱등이다. 재실행해도 데이터가 삭제되거나 중복되지 않는다.
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
--  1) 대학별 연도 실적
-- ─────────────────────────────────────────────
create table if not exists public.univ_admission_stats (
  id uuid primary key default gen_random_uuid(),
  university_id uuid references public.universities(id) on delete cascade,
  year integer not null,
  competition numeric,
  cut_pct numeric,
  cut_basis text,          -- 합격선이 무엇을 기준으로 산출된 값인지
  note text,
  created_at timestamptz default now(),
  unique (university_id, year)
);

create index if not exists univ_admission_stats_univ_year_idx
  on public.univ_admission_stats (university_id, year desc);

alter table public.univ_admission_stats enable row level security;

drop policy if exists "admin_all" on public.univ_admission_stats;
create policy "admin_all" on public.univ_admission_stats
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

--  학생 목표대학 화면에서도 추세를 보여주므로 로그인 사용자 읽기 허용
drop policy if exists "auth_read" on public.univ_admission_stats;
create policy "auth_read" on public.univ_admission_stats
  for select to authenticated
  using (public.app_token_ok());

-- ─────────────────────────────────────────────
--  2) 실제 입시 결과 (관리자 전용)
-- ─────────────────────────────────────────────
--  readiness_at / band_at 은 입력 시점의 시스템 판정을 그대로 얼려 둔 값이다.
--  나중에 계산식이 바뀌어도 "그때 우리가 뭐라고 했는지"가 남아야
--  판정이 맞았는지 되짚을 수 있다.
create table if not exists public.admission_outcomes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete cascade,
  university_id uuid references public.universities(id) on delete cascade,
  year integer not null,
  result text check (result in ('합격','추가합격','불합격','미응시')),
  readiness_at numeric,
  band_at text,
  note text,
  created_at timestamptz default now(),
  unique (student_id, university_id, year)
);

create index if not exists admission_outcomes_year_band_idx
  on public.admission_outcomes (year, band_at);

alter table public.admission_outcomes enable row level security;

--  ※ 학생 정책 없음. 합격·불합격 기록은 관리자만 본다.
drop policy if exists "admin_all" on public.admission_outcomes;
create policy "admin_all" on public.admission_outcomes
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

comment on table public.admission_outcomes is
  '실제 입시 결과. 관리자 전용. 판정 캘리브레이션(밴드별 적중률)의 근거이며 학생·학부모에게 노출하지 않는다.';
comment on column public.admission_outcomes.readiness_at is
  '결과 입력 시점의 준비도 스냅샷. 계산식이 바뀌어도 당시 판정을 보존하기 위함.';

-- ─────────────────────────────────────────────
--  3) 리포트 AI 초안
-- ─────────────────────────────────────────────
--  확정 코멘트(comment)와 물리적으로 분리한다. 초안이 그대로 학부모에게
--  나가는 일이 없도록, 강사가 comment 로 옮겨 적어야 리포트에 실린다.
alter table public.teacher_comments add column if not exists ai_draft text;
alter table public.teacher_comments add column if not exists ai_generated_at timestamptz;

comment on column public.teacher_comments.ai_draft is
  'AI 서술 초안. 확정 코멘트(comment)와 분리 — 강사가 옮겨 적어야 리포트에 실린다.';

insert into public.schema_migrations (version) values ('0012_admission_calibration')
on conflict do nothing;
