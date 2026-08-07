-- ═══════════════════════════════════════════════════════════════════
--
--   ██  실행 순서  ██
--
--   **코드 배포보다 먼저 실행해도 안전하다.**
--   정책을 하나 더할 뿐이라 구버전 코드의 동작은 달라지지 않는다.
--   다만 이 정책 없이 신버전 코드를 배포하면 상담 기록 삭제가 RLS 에 막혀
--   **행도 함께 남는다**(음성을 못 지우면 행을 지우지 않도록 만들었다).
--   그러니 코드 배포 전에 실행하는 쪽이 낫다.
--
-- ═══════════════════════════════════════════════════════════════════
--
--  0016_counseling_audio_delete
--
--  목적
--    counseling-audio 버킷에 **삭제 정책**을 만든다.
--    0015 는 insert·update 만 만들어 두었다. 그래서 지금은 관리자라도 객체를
--    지울 수 없고, 상담 기록(행)만 지우면 audio_path 가 함께 사라져
--    **버킷에 남은 미성년자 음성을 다시 찾아낼 방법이 없어진다.**
--
--    이 정책은 plan 5절 4번 "학부모 요구 시 원본·전사문을 즉시 지울 수 있는
--    경로를 UI 에 둔다"(삭제 요구권)를 이행하는 경로다. 화면 쪽 짝은
--    js/db.js 의 deleteCounseling · purgeCounselingAudio 두 함수다.
--
--  왜 관리자만인가
--    0015 의 업로드 정책과 같은 기준이다. 상담 음성에는 제3자(학부모·다른 학생)
--    이야기가 섞이므로 답안지 버킷보다 좁게 잡는다. 판별은 같은 함수
--    public.is_admin() 을 쓴다 — 버킷 하나에 서로 다른 기준을 섞지 않는다.
--
--  열람 정책은 여전히 만들지 않는다
--    강사 화면은 서명 URL(/api/signed-url), AI 전사는 서버가 service_role 로
--    직접 읽는다. 0015 의 결정을 그대로 둔다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 [Run].
--
--  안전성
--    멱등이다(drop policy if exists 후 create policy).
--    정책만 더한다 — 이 파일은 어떤 객체도 행도 지우지 않는다.
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
--  1) 상담 녹음 삭제 (관리자 전용)
-- ─────────────────────────────────────────────
drop policy if exists "admin_delete_counseling_audio" on storage.objects;
create policy "admin_delete_counseling_audio" on storage.objects
  for delete to authenticated
  using (bucket_id = 'counseling-audio' and public.is_admin());

insert into public.schema_migrations (version) values ('0016_counseling_audio_delete')
on conflict do nothing;
