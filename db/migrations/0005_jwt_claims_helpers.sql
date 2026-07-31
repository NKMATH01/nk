-- ═══════════════════════════════════════════════════════════════════
--  0005_jwt_claims_helpers
--
--  목적
--    RLS 정책이 사용할 JWT 클레임 판별 함수와 accounts 보조 컬럼을 추가한다.
--    앱이 발급하는 토큰은 Supabase 레거시 JWT 시크릿으로 서명되므로 PostgREST 가
--    직접 검증하고, 그 클레임을 아래 함수들이 읽는다.
--
--    토큰 클레임 예시
--      { "iss":"yaknon", "sub":"<accounts.id>", "role":"authenticated",
--        "aud":"authenticated", "app_role":"admin", "student_id":null, "tv":1 }
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 [Run].
--
--  안전성
--    멱등이다. 이 파일만 실행해서는 접근 권한이 달라지지 않는다
--    (실제 정책 교체는 0006). 먼저 실행해도 안전하다.
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
--  1) accounts 보조 컬럼
-- ─────────────────────────────────────────────
--  token_version : 강제 로그아웃용. 값을 올리면 그 계정의 기존 토큰이 전부 무효가 된다.
--  hash_alg      : 비밀번호 해시 방식. 기존 행은 'sha256'(레거시)이며,
--                  로그인 성공 시 서버가 scrypt 로 재해시하면서 'scrypt' 로 바뀐다.
alter table public.accounts add column if not exists token_version integer not null default 1;
alter table public.accounts add column if not exists hash_alg text not null default 'sha256';

-- ─────────────────────────────────────────────
--  2) 클레임 판별 함수
-- ─────────────────────────────────────────────
--  ※ security definer + search_path 고정: 호출자의 RLS·search_path 에 영향받지 않게 한다.
--    accounts 를 조회하는 함수가 있으므로 accounts 에는 force row level security 를
--    걸지 않는다(걸면 소유자에게도 RLS 가 적용되어 이 함수들이 깨진다).

create or replace function public.jwt_claims()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$$;

comment on function public.jwt_claims() is
  '현재 요청의 JWT 클레임(JSON). 토큰이 없으면 빈 객체.';

create or replace function public.app_role()
returns text
language sql
stable
as $$
  select nullif(public.jwt_claims() ->> 'app_role', '');
$$;

create or replace function public.app_student_id()
returns uuid
language sql
stable
as $$
  select nullif(public.jwt_claims() ->> 'student_id', '')::uuid;
$$;

create or replace function public.app_account_id()
returns uuid
language sql
stable
as $$
  select nullif(public.jwt_claims() ->> 'sub', '')::uuid;
$$;

--  토큰이 유효하고, 그 계정이 아직 살아 있으며, token_version 이 일치하는지 확인한다.
--  (강제 로그아웃시킨 세션이 RLS 를 통과하지 못하게 하는 마지막 관문)
create or replace function public.app_token_ok()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.accounts a
    where a.id = public.app_account_id()
      and a.token_version = coalesce((public.jwt_claims() ->> 'tv')::int, -1)
  );
$$;

comment on function public.app_token_ok() is
  'JWT 의 sub/tv 가 accounts 의 현재 token_version 과 일치하는지. 강제 로그아웃 반영용.';

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.app_role() = 'admin' and public.app_token_ok();
$$;

comment on function public.is_admin() is
  '관리자 토큰인지. app_role=admin 이면서 token_version 이 유효할 때만 true.';

-- ─────────────────────────────────────────────
--  3) 실행 권한
-- ─────────────────────────────────────────────
grant execute on function public.jwt_claims()     to anon, authenticated;
grant execute on function public.app_role()       to anon, authenticated;
grant execute on function public.app_student_id() to anon, authenticated;
grant execute on function public.app_account_id() to anon, authenticated;
grant execute on function public.app_token_ok()   to anon, authenticated;
grant execute on function public.is_admin()       to anon, authenticated;

insert into public.schema_migrations (version) values ('0005_jwt_claims_helpers')
on conflict do nothing;
