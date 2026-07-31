-- ═══════════════════════════════════════════════════════════════════
--  0002_migration_tracking
--
--  목적
--    적용된 마이그레이션 버전을 DB에 기록하는 추적 테이블을 만든다.
--    앱(설정 화면)이 이 테이블을 읽어 미적용 마이그레이션을 표시한다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 [Run].
--
--  안전성
--    모든 문이 멱등(idempotent)이다. 여러 번 실행해도 데이터가
--    삭제되거나 중복되지 않는다.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.schema_migrations (
  version    text primary key,
  applied_at timestamptz not null default now()
);

alter table public.schema_migrations enable row level security;

drop policy if exists schema_migrations_anon_read on public.schema_migrations;
create policy schema_migrations_anon_read on public.schema_migrations
  for select to anon, authenticated using (true);

insert into public.schema_migrations (version) values
  ('0001_baseline'),
  ('0002_migration_tracking')
on conflict do nothing;
