-- ═══════════════════════════════════════════════════════════════════
--
--   ██  실행 순서  ██
--
--   **코드 배포와 무관하게 즉시 실행해도 안전하다.**
--   정책을 더할 뿐이라 구버전·신버전 코드 어느 쪽 동작도 깨지 않는다.
--   반대로 이 정책이 적용될 때까지 [삭제]·[음성 삭제] 는 계속 실패한다.
--
-- ═══════════════════════════════════════════════════════════════════
--
--  0022_counseling_audio_select
--
--  목적
--    counseling-audio 버킷에 **관리자 열람(select) 정책**을 만든다.
--
--    0016 이 삭제 정책을 만들었는데도 화면의 [삭제]·[음성 삭제] 는
--    "음성 파일을 지우지 못했습니다(대상 없음 또는 권한 없음)" 로 계속 실패했다.
--    원인: PostgreSQL 은 WHERE·RETURNING 이 붙은 DELETE 에 대해 대상 행이
--    **select(또는 all) 정책도 통과**할 것을 요구한다(CREATE POLICY 문서).
--    Supabase Storage 의 remove() 는 `delete ... where ... returning *` 을
--    사용자 권한으로 실행하므로, select 정책이 없는 이 버킷에서는 행이 한 줄도
--    보이지 않아 **아무것도 지우지 못한 채 오류 없이 빈 배열**이 돌아온다.
--    0015 가 "열람 정책은 만들지 않는다"(서명 URL·service_role 로만 읽는다)고
--    정한 결정이 의도치 않게 삭제까지 막고 있었던 것이다.
--
--  왜 관리자 select 를 열어도 되는가
--    관리자는 이미 /api/signed-url(관리자 전용)로 같은 음성을 듣고 있다.
--    이 정책은 그 관리자에게 Storage API 경유 열람을 추가로 허용할 뿐이고,
--    학생·학부모(비관리자)에게는 여전히 아무것도 보이지 않는다.
--    판별은 0015·0016 과 같은 public.is_admin() 을 쓴다.
--
--  0016 재보증
--    화면 증상만으로는 "0016 미적용"과 "select 정책 부재"를 구분할 수 없어
--    삭제 정책도 같은 정의로 한 번 더 적용해 둔다(멱등이라 이미 있어도 무해).
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 [Run].
--    마지막 select 가 확인용이다 — counseling_audio 정책 4개
--    (upload / update / delete / select)가 보이면 정상.
--
--  안전성
--    전부 멱등이다(drop policy if exists 후 create policy · on conflict do nothing).
--    정책만 더한다 — 이 파일은 어떤 객체도 행도 지우지 않는다.
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
--  1) 상담 녹음 열람 (관리자 전용) — 삭제가 요구하는 select 가시성
-- ─────────────────────────────────────────────
drop policy if exists "admin_select_counseling_audio" on storage.objects;
create policy "admin_select_counseling_audio" on storage.objects
  for select to authenticated
  using (bucket_id = 'counseling-audio' and public.is_admin());

-- ─────────────────────────────────────────────
--  2) 0016 삭제 정책 재보증 (동일 정의 · 멱등)
-- ─────────────────────────────────────────────
drop policy if exists "admin_delete_counseling_audio" on storage.objects;
create policy "admin_delete_counseling_audio" on storage.objects
  for delete to authenticated
  using (bucket_id = 'counseling-audio' and public.is_admin());

insert into public.schema_migrations (version) values ('0022_counseling_audio_select')
on conflict do nothing;

-- 적용 확인 — 아래 결과에 정책 4개가 보여야 한다.
select policyname, cmd from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and policyname like '%counseling_audio%'
 order by policyname;
