-- ═══════════════════════════════════════════════════════════════════
--
--   ██  실행 순서  ██
--
--   **코드 배포보다 먼저 실행해도 안전하다.**
--   더하는 컬럼이 전부 nullable 이거나 default 를 가지므로, 구버전 코드는
--   이 컬럼들을 모르는 채로 그대로 동작한다.
--
-- ═══════════════════════════════════════════════════════════════════
--
--  0015_counseling_audio
--
--  목적
--    상담을 녹음해 올리면 Gemini 가 전사(transcript)까지 해 주는 경로를 연다.
--    지금은 강사가 상담 직후 기억에 의존해 손으로 요약을 적고 있어, 바쁜 날은
--    기록 자체가 누락된다. 음성 원본과 전사문을 남겨 그 손실을 줄인다.
--
--  ai_status 값
--    uploaded    음성만 올라간 상태(전사 전)
--    transcribed 전사 성공
--    failed      전사 중 오류
--    blocked     Gemini 안전 필터 등으로 응답을 받지 못함
--    → 어느 상태에서 멈춰도 강사가 그 행을 열어 손으로 이어 쓸 수 있어야 한다.
--      실패했다고 행을 지우지 않는다.
--
--  content 가 not null 인 점
--    녹음을 올린 시점에는 아직 확정 내용이 없다. 그래서 업로드 시 임시로
--    content = '(정돈 대기)' 를 넣는다. **컬럼 제약은 완화하지 않는다** —
--    제약 완화는 되돌리기 어렵고, 기존 수기 입력 경로의 안전장치를 없애기 때문이다.
--
--  ai_draft
--    2차(구조화 초안)에서 쓸 컬럼을 미리 만들어 둔다. 1차에서는 아무것도 쓰지 않는다.
--    마이그레이션을 한 번 더 돌리지 않으려고 함께 넣는 것뿐이다.
--
--  ★ 학생 노출 주의
--    counseling_notes 의 학생용 RLS(stu_self)는 **행 단위**라 transcript·ai_draft
--    같은 새 컬럼을 막지 못한다. 학생·학부모 경로는 select('*') 를 쓰지 않고
--    필요한 컬럼만 명시해 조회한다(js/db.js listStudentCounseling).
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 [Run].
--
--  안전성
--    멱등이다(add column if not exists / on conflict do nothing).
--    기존 행·기존 파일은 건드리지 않는다.
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
--  1) 상담 기록 — 녹음·전사 컬럼
-- ─────────────────────────────────────────────
alter table public.counseling_notes add column if not exists audio_path      text;
alter table public.counseling_notes add column if not exists audio_purged_at timestamptz;
alter table public.counseling_notes add column if not exists transcript      text;
alter table public.counseling_notes add column if not exists ai_draft        jsonb;
alter table public.counseling_notes add column if not exists ai_status       text;
alter table public.counseling_notes add column if not exists confirmed_at    timestamptz;

comment on column public.counseling_notes.audio_path is
  'counseling-audio 버킷 내 경로 <student_id>/<note_id>_<timestamp>.<ext>. 전체 URL 이 아니라 경로만 저장한다(버킷이 private).';
comment on column public.counseling_notes.audio_purged_at is
  '음성 원본을 삭제한 시각. 전사문·확정 기록은 지우지 않는다 — 지우는 것은 음성뿐이다.';
comment on column public.counseling_notes.transcript is
  'Gemini 전사문(평문). **학생·학부모에게 절대 내려보내지 않는다.**';
comment on column public.counseling_notes.ai_draft is
  '2차(구조화 초안)용 예약 컬럼 {summary, category, key_points, follow_ups, student_safe_text}. 1차에서는 쓰지 않는다.';
comment on column public.counseling_notes.ai_status is
  'uploaded → transcribed / failed / blocked. null 이면 녹음 없이 손으로 적은 기존 기록이다.';
comment on column public.counseling_notes.confirmed_at is
  '강사가 내용을 확정한 시각. 음성 자동 삭제(30일) 카운트의 기준점이다.';

-- ─────────────────────────────────────────────
--  2) 학생 — 녹음 동의
-- ─────────────────────────────────────────────
--  동의 없이는 업로드하지 않는다. 프런트에서 버튼을 비활성화하고,
--  서버(api/counsel-transcribe.js)도 이 값을 다시 확인한다(이중 방어).
alter table public.students add column if not exists recording_consent    boolean not null default false;
alter table public.students add column if not exists recording_consent_at date;

comment on column public.students.recording_consent is
  '상담 녹음 동의 여부. false 면 업로드·전사를 하지 않는다(서버에서도 재확인).';
comment on column public.students.recording_consent_at is
  '녹음 동의를 받은 날짜. 개인정보 동의일(consent_date)과 별개다.';

-- ─────────────────────────────────────────────
--  3) 상담 녹음 버킷 (private · 관리자 전용)
-- ─────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('counseling-audio','counseling-audio', false)
on conflict (id) do nothing;

-- 이미 만들어져 있던 경우에도 반드시 private 이어야 한다.
update storage.buckets set public = false where id = 'counseling-audio';

--  업로드는 **관리자만**. 답안지(answer-sheets)와 달리 학생이 올릴 일이 없고,
--  상담 음성에는 제3자(학부모·다른 학생) 이야기가 섞이므로 더 좁게 잡는다.
--  열람 정책은 만들지 않는다 — 강사 화면은 서명 URL(/api/signed-url),
--  AI 전사는 서버가 service_role 로 직접 읽는다.
drop policy if exists "admin_upload_counseling_audio" on storage.objects;
create policy "admin_upload_counseling_audio" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'counseling-audio' and public.is_admin());

drop policy if exists "admin_update_counseling_audio" on storage.objects;
create policy "admin_update_counseling_audio" on storage.objects
  for update to authenticated
  using (bucket_id = 'counseling-audio' and public.is_admin())
  with check (bucket_id = 'counseling-audio' and public.is_admin());

insert into public.schema_migrations (version) values ('0015_counseling_audio')
on conflict do nothing;
