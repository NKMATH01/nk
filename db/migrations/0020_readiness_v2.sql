-- ═══════════════════════════════════════════════════════════════════
--
--   ██  실행 순서  ██
--
--   **코드 배포보다 먼저 실행한다.**
--   학부모 화면의 [확인했습니다]는 parent_ack, [상담 요청]은 counsel_requests
--   테이블이 없으면 실패한다.
--
--   반대로 이 마이그레이션만 먼저 돌리는 것은 완전히 안전하다 —
--   구버전 코드는 새 테이블을 모르는 채로 그대로 동작한다.
--
-- ═══════════════════════════════════════════════════════════════════
--
--  0020_readiness_v2
--
--  목적
--    Phase 4. 준비도 산식을 v2 로 바꾸면서 **과거 스냅샷을 그대로 보존**하고,
--    학부모 화면의 개입 2개(확인·상담 요청)를 받을 최소 구조를 만든다.
--
--  ★★ 데이터 보존 — 이 파일은 기존 행을 단 하나도 건드리지 않는다 ★★
--    · readiness_snapshots 에 update 하지 않는다. 과거 스냅샷은 **구 산식 값 그대로**
--      남는다. 신규 산식은 오늘 이후 적재분부터 적용되고, 구 값은 meta 에 병기된다.
--    · 컬럼을 추가하지 않는다(아래 1) 참고). 신규 테이블 2개만 만든다.
--    · drop / truncate / delete / 기존 컬럼 의미 변경 없음.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 [Run].
--
--  안전성
--    전부 멱등이다(create table if not exists · drop policy if exists 후 create).
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
--  1) 준비도 스냅샷 — 컬럼 추가 없음. meta 에 신·구를 병기한다.
-- ─────────────────────────────────────────────
--  readiness_snapshots.meta(jsonb) 는 **0003 에서 이미 만들어져 있다.**
--  확인 후 컬럼을 추가하지 않았다. 병기는 전적으로 meta 안에서 한다.
--
--  0020 이후 적재되는 행의 형태 (js/views/dashboard.js saveReadinessSnapshots)
--    readiness : **신규 산식(v2)** 값
--                — 화면(대시보드·리포트)이 읽는 주 값이고, 학생 화면도 이 컬럼을
--                  읽어 강사 화면과 같은 숫자를 본다. 두 산식 중 하나를 골라야
--                  한다면 화면에 보이는 것과 같은 값이 들어가야 추이가 화면과 맞는다.
--    meta.formula_version : 'v2'  — 이 값이 없는 행이 구 산식으로 적재된 과거 행이다.
--    meta.formula_since   : 산출 기준 변경일(코드 상수 READINESS_V2_SINCE)
--    meta.readiness_legacy: 같은 시점의 **구 산식** 값. 개편 전후를 잇는 유일한 다리다.
--    meta.diligence       : 과제 정답률(성실성). 실력 가중에서 분리된 값.
--    meta.weekly_scaled   : 회차 난이도 보정(z) EWMA. 참고 지표.
--    meta.last_pct / weak_unit / weak_cognition : 종전과 같다.
--
--  ★ 과거 행을 백필하지 않는다. 지금 다시 계산하면 "그날 강사가 본 숫자"가 사라진다.
comment on column public.readiness_snapshots.meta is
  '스냅샷 부가 정보. 0020 이후: formula_version(v2) · formula_since · readiness_legacy(구 산식 값) · '
  'diligence(과제=성실성) · weekly_scaled(z 참고 지표) · last_pct · weak_unit · weak_cognition. '
  'formula_version 이 없는 행은 0020 이전(구 산식)이며 백필하지 않는다.';

--  ★ 학생·학부모 읽기 권한은 **이미 있다** — 0006 이 readiness_snapshots 에
--    stu_self(select, student_id = app_student_id()) 를 걸어 두었다.
--    학부모 토큰도 같은 student_id 클레임을 담으므로 그대로 통과한다.
--    확인했고, 그래서 여기서 정책을 다시 만들지 않는다(불필요한 재생성은 하지 않는다).

-- ─────────────────────────────────────────────
--  2) 학부모 확인 (parent_ack)
-- ─────────────────────────────────────────────
--  주간 리포트를 학부모가 열어 봤다는 사실 하나만 남긴다.
--  강사 입력 노동 0 · 학부모 입력 노동 0(버튼 한 번). 그 이상은 담지 않는다.
create table if not exists public.parent_ack (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete cascade,
  week_no integer not null,
  acked_at timestamptz not null default now(),
  unique (student_id, week_no)
);

comment on table public.parent_ack is
  '학부모가 해당 주차 리포트를 확인했다는 기록. (student_id, week_no) 유니크 — 같은 주차는 한 번만 남는다. '
  '기록이므로 update/delete 정책을 만들지 않는다(첫 확인 시각이 남아야 한다).';

create index if not exists parent_ack_student_idx
  on public.parent_ack (student_id, week_no desc);

alter table public.parent_ack enable row level security;

--  관리자 전권 (0008 prescriptions 와 같은 패턴·같은 판별 함수)
drop policy if exists "admin_all" on public.parent_ack;
create policy "admin_all" on public.parent_ack
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

--  학생·학부모: 본인 것 조회
drop policy if exists "stu_self" on public.parent_ack;
create policy "stu_self" on public.parent_ack
  for select to authenticated
  using (public.app_token_ok() and student_id = public.app_student_id());

--  학생·학부모: 본인 것 등록만 (0019 prescription_logs 의 stu_insert 와 같은 관용구)
--  ★ update / delete 정책은 만들지 않는다. 중복 확인은 코드가
--    on conflict do nothing 으로 흘려보내므로 update 권한이 필요 없다.
drop policy if exists "stu_insert" on public.parent_ack;
create policy "stu_insert" on public.parent_ack
  for insert to authenticated
  with check (public.app_token_ok() and student_id = public.app_student_id());

-- ─────────────────────────────────────────────
--  3) 상담 요청 (counsel_requests)
-- ─────────────────────────────────────────────
--  ★ 자유 텍스트 필드를 두지 않는다. 의도적이다 —
--    자유 문의함은 밤 11시에 긴 질문이 오고, 긴 질문에는 긴 답을 해야 한다.
--    8명을 혼자 보는 지금은 감당할 수 없다. 희망 날짜 3택 + 유형만 받고
--    나머지는 실제 상담에서 말로 한다.
create table if not exists public.counsel_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete cascade,
  pref_dates date[],
  category text,
  status text not null default 'open' check (status in ('open','scheduled','done','cancelled')),
  created_at timestamptz default now()
);

comment on table public.counsel_requests is
  '학부모가 보낸 상담 요청. 희망 날짜(최대 3개)와 유형만 받는다. 자유 텍스트 필드를 두지 않는다 — '
  '긴 질문에는 긴 답을 해야 하고 그게 밤 11시에 온다. 상세는 실제 상담에서 말로 한다.';

comment on column public.counsel_requests.pref_dates is '희망 날짜 후보(최대 3). 확정이 아니라 후보다.';
comment on column public.counsel_requests.category is
  '상담 유형. 화면(js/views/parent.js COUNSEL_REQ_CATS)의 고정 목록에서 고른다. '
  'check 제약을 걸지 않는다 — 나중에 목록을 늘릴 때 기존 행이 제약에 걸려 막히면 안 된다.';
comment on column public.counsel_requests.status is
  'open(접수 전) → scheduled(일정 잡음) → done. 상태 변경은 **관리자만** 한다(학생·학부모에게 update 정책이 없다).';

create index if not exists counsel_requests_status_idx
  on public.counsel_requests (status, created_at desc);
create index if not exists counsel_requests_student_idx
  on public.counsel_requests (student_id, created_at desc);

alter table public.counsel_requests enable row level security;

--  관리자 전권 — 상태 변경(open→scheduled→done)은 이 정책으로만 가능하다.
drop policy if exists "admin_all" on public.counsel_requests;
create policy "admin_all" on public.counsel_requests
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

--  학생·학부모: 본인 요청 조회 (보낸 것이 접수됐는지 보이지 않으면 다시 보낸다)
drop policy if exists "stu_self" on public.counsel_requests;
create policy "stu_self" on public.counsel_requests
  for select to authenticated
  using (public.app_token_ok() and student_id = public.app_student_id());

--  학생·학부모: 본인 요청 등록만.
--  ★ update / delete 정책은 만들지 않는다 — status 는 강사의 작업 목록이라,
--    학부모가 고칠 수 있으면 강사가 아직 처리하지 않은 요청이 화면에서 사라진다
--    (0019 가 prescriptions.status 를 강사 전용으로 둔 것과 같은 이유).
drop policy if exists "stu_insert" on public.counsel_requests;
create policy "stu_insert" on public.counsel_requests
  for insert to authenticated
  with check (public.app_token_ok() and student_id = public.app_student_id());

insert into public.schema_migrations (version) values ('0020_readiness_v2')
on conflict do nothing;
