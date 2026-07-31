-- ═══════════════════════════════════════════════════════════════════
--
--   ██  실행 순서 주의  ██
--
--   반드시 아래 두 가지를 먼저 끝낸 뒤에 실행할 것.
--     1) Phase 1 코드(api/login.js, api/accounts.js 포함)를 배포한다.
--     2) 배포된 사이트에서 실제로 로그인해 /api/login 이 동작하는지 확인한다.
--        (관리자·학생·학부모 계정 각각 1회 로그인 권장)
--
--   이 파일을 먼저 실행하면 로그인이 즉시 깨진다.
--   구버전 프론트엔드는 anon 키로 accounts 테이블을 직접 읽어 로그인하는데,
--   이 마이그레이션이 바로 그 경로를 차단하기 때문이다.
--
--   되돌리려면 db/migrations/0001_baseline.sql 의 RLS 블록을 다시 실행하면
--   accounts 의 allow_all_anon / allow_all_auth 정책이 복구된다.
--
-- ═══════════════════════════════════════════════════════════════════
--
--  0004_accounts_lockdown
--
--  목적
--    accounts 테이블의 anon / authenticated 전면 허용 정책을 제거한다.
--    RLS 는 켜 둔 채 정책을 남기지 않으므로, 이후 이 테이블에 접근할 수 있는
--    주체는 RLS 를 우회하는 service_role 뿐이다.
--    즉 비밀번호 해시는 서버(Vercel Functions)에서만 읽고 쓸 수 있게 된다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 [Run].
--
--  안전성
--    drop policy if exists 만 사용하므로 재실행해도 무해하다.
--    테이블과 데이터는 건드리지 않는다.
-- ═══════════════════════════════════════════════════════════════════

alter table public.accounts enable row level security;

drop policy if exists "allow_all_anon" on public.accounts;
drop policy if exists "allow_all_auth" on public.accounts;

insert into public.schema_migrations (version) values ('0004_accounts_lockdown')
on conflict do nothing;
