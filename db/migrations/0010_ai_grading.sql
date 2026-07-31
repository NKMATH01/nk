-- ═══════════════════════════════════════════════════════════════════
--
--   ██  실행 순서 주의  ██
--
--   **코드 배포보다 먼저 실행할 것.** (0008·0009 와 동일)
--   새 코드가 submissions / grading_runs 를 조회·기록하므로 먼저 실행하지 않으면
--   답안 제출과 AI 분석이 즉시 실패한다.
--
--   이 파일만 먼저 실행하는 것은 안전하다 — 전부 신규 객체다.
--
-- ═══════════════════════════════════════════════════════════════════
--
--  0010_ai_grading
--
--  목적
--    답안지 사진 제출 → AI 전사 → AI 채점 제안 → **강사 확정** 파이프라인.
--
--  설계 원칙 (이 부분이 스키마의 존재 이유다)
--    · AI 출력은 절대 scores.earned 에 직접 들어가지 않는다.
--      grading_runs(제안) → grading_reviews(강사 확정) → scores(write-through) 순서.
--    · grading_runs 는 **관리자만** 읽을 수 있다. 확정되지 않은 AI 점수·피드백이
--      학생에게 새어 나가면 안 되기 때문이다(RLS 로 원천 차단).
--    · submissions 는 학생이 본인 것을 올리고 볼 수 있다(제출물은 본인 것이므로).
--
--  안전성
--    전부 멱등이다. 재실행해도 데이터가 삭제되거나 중복되지 않는다.
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
--  1) 제출물
-- ─────────────────────────────────────────────
create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete cascade,
  question_id uuid references public.questions(id) on delete cascade,
  input_type text default 'photo' check (input_type in ('photo','text')),
  image_paths text[],                 -- answer-sheets 버킷 내 경로
  answer_text text,                   -- 직접 입력한 답안
  ocr_text text,                      -- AI 전사 결과 캐시(재분석 시 재사용)
  submitted_at timestamptz default now()
);

create index if not exists submissions_student_question_idx
  on public.submissions (student_id, question_id);

alter table public.submissions enable row level security;

drop policy if exists "admin_all" on public.submissions;
create policy "admin_all" on public.submissions
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

--  학생·학부모: 본인 제출물 조회
drop policy if exists "stu_self" on public.submissions;
create policy "stu_self" on public.submissions
  for select to authenticated
  using (public.app_token_ok() and student_id = public.app_student_id());

--  학생: 본인 답안 제출(등록만. 수정·삭제는 관리자만)
drop policy if exists "stu_insert" on public.submissions;
create policy "stu_insert" on public.submissions
  for insert to authenticated
  with check (public.app_token_ok() and student_id = public.app_student_id());

-- ─────────────────────────────────────────────
--  2) AI 실행 기록 (관리자 전용)
-- ─────────────────────────────────────────────
create table if not exists public.grading_runs (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid references public.submissions(id) on delete cascade,
  stage text check (stage in ('transcribe','grade')),
  model text,
  prompt_version text,
  status text default 'queued' check (status in ('queued','running','done','failed')),
  suggested_score numeric,
  rubric_breakdown jsonb,
  wrong_reason_tags text[],
  feedback_text text,
  confidence numeric,
  raw_response jsonb,
  error_text text,
  tokens_in integer,
  tokens_out integer,
  cost_usd numeric,
  created_at timestamptz default now()
);

create index if not exists grading_runs_submission_idx
  on public.grading_runs (submission_id, created_at desc);

alter table public.grading_runs enable row level security;

--  ※ 학생 정책을 만들지 않는다. 확정 전 AI 제안은 강사만 본다.
drop policy if exists "admin_all" on public.grading_runs;
create policy "admin_all" on public.grading_runs
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

comment on table public.grading_runs is
  'AI 채점 제안. 관리자 전용 — 확정 전 값이 학생에게 노출되면 안 된다. 확정은 grading_reviews.';

-- ─────────────────────────────────────────────
--  3) 강사 확정 기록 (관리자 전용)
-- ─────────────────────────────────────────────
--  AI 제안 대비 강사가 얼마나 고쳤는지(agreed / score_delta)를 남긴다.
--  이 누적치가 6-2 게이트(일치율 70%)의 판단 근거가 된다.
create table if not exists public.grading_reviews (
  id uuid primary key default gen_random_uuid(),
  grading_run_id uuid references public.grading_runs(id) on delete cascade,
  final_score numeric,
  final_tags text[],
  final_comment text,
  agreed boolean,
  score_delta numeric,
  reviewed_at timestamptz default now()
);

create index if not exists grading_reviews_run_idx
  on public.grading_reviews (grading_run_id);

alter table public.grading_reviews enable row level security;

drop policy if exists "admin_all" on public.grading_reviews;
create policy "admin_all" on public.grading_reviews
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ─────────────────────────────────────────────
--  4) 답안지 버킷 (private)
-- ─────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('answer-sheets','answer-sheets', false)
on conflict (id) do nothing;

update storage.buckets set public = false where id = 'answer-sheets';

--  업로드는 로그인 사용자(학생이 본인 답안을 올린다). 열람 정책은 없다 —
--  강사 화면은 서명 URL, AI 전사는 서버가 service_role 로 직접 읽는다.
drop policy if exists "auth_upload_answer" on storage.objects;
create policy "auth_upload_answer" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'answer-sheets' and public.app_token_ok());

insert into public.schema_migrations (version) values ('0010_ai_grading')
on conflict do nothing;
