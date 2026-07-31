-- ═══════════════════════════════════════════════════════════════════
--
--   ██  실행 순서 주의  ██
--
--   반드시 Phase 3 코드를 배포하고 재로그인까지 끝낸 뒤에 실행할 것.
--   이 파일은 grading-photos 버킷을 private 으로 바꾸고 anon 접근을 끊는다.
--
--   먼저 실행하면 채점 사진이 보이지 않고 업로드도 실패한다.
--   구버전 프론트엔드는 anon 으로 업로드하고 public URL 로 표시하기 때문이다.
--
--   롤백:
--     update storage.buckets set public = true where id = 'grading-photos';
--     그리고 0001_baseline.sql 의 Storage 블록을 다시 실행하면 anon 정책이 복구된다.
--
-- ═══════════════════════════════════════════════════════════════════
--
--  0007_storage_private
--
--  목적
--    채점 사진 버킷을 비공개로 전환한다.
--    지금까지는 public=true 라 URL 만 알면 누구나 학생 답안 사진을 볼 수 있었다.
--    전환 후에는 /api/signed-url 이 발급하는 10분짜리 서명 URL 로만 열람 가능하다.
--    업로드는 로그인한 사용자(authenticated)만 할 수 있다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 [Run].
--
--  안전성
--    멱등이다. 파일 자체는 삭제하지 않는다(기존 사진은 그대로 남는다).
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
--  1) 버킷을 private 으로
-- ─────────────────────────────────────────────
update storage.buckets set public = false where id = 'grading-photos';

-- ─────────────────────────────────────────────
--  2) anon 정책 제거
-- ─────────────────────────────────────────────
drop policy if exists "anon_read_grading" on storage.objects;
drop policy if exists "anon_upload_grading" on storage.objects;

-- ─────────────────────────────────────────────
--  3) 로그인 사용자 업로드 허용
-- ─────────────────────────────────────────────
--  읽기 정책은 만들지 않는다. 열람은 service_role 이 발급하는 서명 URL 로만 한다
--  (/api/signed-url 이 역할·소유 학생을 확인한 뒤 발급).
drop policy if exists "auth_upload_grading" on storage.objects;
create policy "auth_upload_grading" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'grading-photos' and public.app_token_ok());

--  덮어쓰기(같은 경로 재업로드) 대비. 경로에 타임스탬프가 붙어 실제로는 드물다.
drop policy if exists "auth_update_grading" on storage.objects;
create policy "auth_update_grading" on storage.objects
  for update to authenticated
  using (bucket_id = 'grading-photos' and public.is_admin())
  with check (bucket_id = 'grading-photos' and public.is_admin());

insert into public.schema_migrations (version) values ('0007_storage_private')
on conflict do nothing;
