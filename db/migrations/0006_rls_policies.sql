-- ═══════════════════════════════════════════════════════════════════
--
--   ██  실행 순서 주의  ██
--
--   반드시 아래를 먼저 끝낸 뒤에 실행할 것.
--     1) Phase 3 코드(JWT 클레임 토큰 발급 + Authorization 헤더를 붙인
--        Supabase 클라이언트)를 배포한다.
--     2) 0005_jwt_claims_helpers.sql 을 먼저 실행한다.
--     3) 배포된 사이트에서 **재로그인**해 새 토큰을 받고, 관리자 화면이
--        정상적으로 보이는지 확인한다. (세션 키가 v4 로 바뀌어 전원 재로그인 필요)
--
--   이 파일을 먼저 실행하면 화면이 전부 빈 목록이 된다.
--   구 토큰에는 role/app_role 클레임이 없어 anon 으로 취급되는데,
--   이 마이그레이션이 anon 전면 허용 정책을 제거하기 때문이다.
--
--   롤백: db/migrations/0001_baseline.sql 의 RLS 블록을 다시 실행하면
--        allow_all_anon / allow_all_auth 가 복구되어 즉시 되돌아간다.
--        (0007 까지 실행했다면 버킷 public 복구도 함께 필요)
--
-- ═══════════════════════════════════════════════════════════════════
--
--  0006_rls_policies
--
--  목적
--    anon 전면 허용 정책을 걷어내고 JWT 클레임 기반 실제 접근 통제를 건다.
--
--    관리자    : 전 테이블 읽기·쓰기
--    학생·학부모: 본인 데이터 읽기만. 쓰기 권한 없음.
--                 상담 기록은 visible_to_student = true 인 건만 보인다.
--    공용 참조 : universities / test_sessions / questions / schema_migrations 는
--                로그인한 사용자면 읽기 가능(학생 화면이 회차·문항 정보를 필요로 함)
--    anon      : 아무 접근 없음
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 [Run].
--
--  안전성
--    멱등이다(drop policy if exists 후 create). 데이터는 건드리지 않는다.
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
--  1) 기존 전면 허용 정책 제거 + RLS 보장
-- ─────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'students','universities','student_targets','test_sessions','questions',
    'scores','homework_records','essay_gradings','teacher_comments',
    'counseling_notes','readiness_snapshots'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "allow_all_anon" on public.%I;', t);
    execute format('drop policy if exists "allow_all_auth" on public.%I;', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────
--  2) 관리자: 전 테이블 전체 권한
-- ─────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'students','universities','student_targets','test_sessions','questions',
    'scores','homework_records','essay_gradings','teacher_comments',
    'counseling_notes','readiness_snapshots'
  ]
  loop
    execute format('drop policy if exists "admin_all" on public.%I;', t);
    execute format(
      'create policy "admin_all" on public.%I for all to authenticated '
      'using (public.is_admin()) with check (public.is_admin());', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────
--  3) 학생·학부모: 본인 데이터 읽기 전용
-- ─────────────────────────────────────────────
--  student_id 컬럼으로 본인 것을 가리는 테이블들
do $$
declare t text;
begin
  foreach t in array array[
    'student_targets','scores','homework_records','essay_gradings',
    'teacher_comments','readiness_snapshots'
  ]
  loop
    execute format('drop policy if exists "stu_self" on public.%I;', t);
    execute format(
      'create policy "stu_self" on public.%I for select to authenticated '
      'using (public.app_token_ok() and student_id = public.app_student_id());', t);
  end loop;
end $$;

--  students 는 자기 자신의 행(id 비교)
drop policy if exists "stu_self" on public.students;
create policy "stu_self" on public.students
  for select to authenticated
  using (public.app_token_ok() and id = public.app_student_id());

--  상담 기록은 공개 표시된 건만
drop policy if exists "stu_self" on public.counseling_notes;
create policy "stu_self" on public.counseling_notes
  for select to authenticated
  using (
    public.app_token_ok()
    and student_id = public.app_student_id()
    and coalesce(visible_to_student, false) = true
  );

-- ─────────────────────────────────────────────
--  4) 공용 참조 테이블: 로그인 사용자 전체 읽기
-- ─────────────────────────────────────────────
--  학생 화면도 대학 정보·회차·문항 메타를 읽어야 리포트가 그려진다.
do $$
declare t text;
begin
  foreach t in array array['universities','test_sessions','questions']
  loop
    execute format('drop policy if exists "auth_read" on public.%I;', t);
    execute format(
      'create policy "auth_read" on public.%I for select to authenticated '
      'using (public.app_token_ok());', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────
--  5) schema_migrations: 설정 화면 배지용 읽기
-- ─────────────────────────────────────────────
alter table public.schema_migrations enable row level security;
drop policy if exists "schema_migrations_anon_read" on public.schema_migrations;
drop policy if exists "auth_read" on public.schema_migrations;
create policy "auth_read" on public.schema_migrations
  for select to authenticated
  using (public.app_token_ok());

insert into public.schema_migrations (version) values ('0006_rls_policies')
on conflict do nothing;
