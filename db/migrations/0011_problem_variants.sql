-- ═══════════════════════════════════════════════════════════════════
--
--   ██  실행 순서 주의  ██
--
--   **코드 배포보다 먼저 실행할 것.** (0008~0010 과 동일)
--   새 코드가 problem_variants 를 조회·기록한다.
--   이 파일만 먼저 실행하는 것은 안전하다 — 전부 신규 객체다.
--
-- ═══════════════════════════════════════════════════════════════════
--
--  0011_problem_variants
--
--  목적
--    기출 문항을 바탕으로 변형 문제를 생성하고, **강사가 승인해야만**
--    문제은행(problems)에 들어가게 하는 검수 큐.
--
--  왜 별도 테이블인가
--    생성물 대부분은 버려진다. 자기모순(정답 두 번 계산이 어긋남)이나
--    독립 재풀이 불일치로 걸러진 것까지 problems 에 넣으면 은행이 오염된다.
--    그래서 생성물은 여기 쌓이고, 승인된 것만 problems 로 승격한다.
--
--  이중 게이트
--    승인(approve) → problems.status='review' 로 들어간다. 곧바로 published 가
--    아니다. 공개 전환은 기존 문제은행 화면에서 한 번 더 사람이 한다.
--
--  안전성
--    전부 멱등이다. 재실행해도 데이터가 삭제되거나 중복되지 않는다.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.problem_variants (
  id uuid primary key default gen_random_uuid(),
  source_problem_id uuid references public.problems(id) on delete cascade,
  generated_problem_id uuid references public.problems(id),   -- 승인 시에만 채워진다
  model text,
  prompt_version text,
  variation_spec jsonb,      -- 사용자가 지정한 변형 방식 {mode, note, difficulty_delta}
  raw_response jsonb,        -- 생성된 문항 본문·정답·해설·루브릭
  self_check jsonb,          -- {closed_answer, derived_answer, consistent, independent_answer, matches, method, code_output}
  review_status text default 'pending'
    check (review_status in ('pending','approved','rejected','regenerate')),
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists problem_variants_source_status_idx
  on public.problem_variants (source_problem_id, review_status);

create index if not exists problem_variants_status_created_idx
  on public.problem_variants (review_status, created_at desc);

alter table public.problem_variants enable row level security;

--  ※ 학생 정책 없음. 원본 기출을 근거로 만든 미검수 문항이라 관리자 전용이다.
drop policy if exists "admin_all" on public.problem_variants;
create policy "admin_all" on public.problem_variants
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

comment on table public.problem_variants is
  '변형 문제 생성 검수 큐. review_status=approved 인 건만 problems 로 승격된다(그것도 status=review 로).';
comment on column public.problem_variants.self_check is
  '자동 검증 결과. 정답 2회 계산 일치 여부와 독립 재풀이(가능하면 코드 실행) 결과.';

insert into public.schema_migrations (version) values ('0011_problem_variants')
on conflict do nothing;
