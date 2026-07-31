-- ═══════════════════════════════════════════════════════════════════
--  0003_readiness_snapshots
--
--  목적
--    학생별 준비도(readiness)를 날짜 단위로 적재해 추이를 남긴다.
--    현재 준비도는 매번 클라이언트에서 재계산되어 과거 값이 남지 않는다.
--    관리자가 대시보드를 열 때 그날 값이 upsert 된다(하루 1행).
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 [Run].
--
--  안전성
--    모든 문이 멱등이다. 재실행해도 데이터가 삭제되거나 중복되지 않는다.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.readiness_snapshots (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete cascade,
  snap_date date not null default current_date,
  readiness numeric,
  meta jsonb,
  unique (student_id, snap_date)
);

-- ※ 임시 정책이다. 다른 테이블과 동일하게 anon 전면 허용 상태이며,
--   Phase 3(Supabase Auth 도입)에서 역할 기반 정책으로 강화한다.
alter table public.readiness_snapshots enable row level security;

drop policy if exists "allow_all_anon" on public.readiness_snapshots;
create policy "allow_all_anon" on public.readiness_snapshots
  for all to anon using (true) with check (true);

drop policy if exists "allow_all_auth" on public.readiness_snapshots;
create policy "allow_all_auth" on public.readiness_snapshots
  for all to authenticated using (true) with check (true);

insert into public.schema_migrations (version) values ('0003_readiness_snapshots')
on conflict do nothing;
