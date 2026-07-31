-- ═══════════════════════════════════════════════════════════════════
--  0008_care_loop
--
--  목적
--    Phase 4 "촘촘한 관리" 3종을 위한 스키마.
--      1) questions.deduction_items  — 문항별 감점 항목(채점 보조 체크박스)
--      2) prescriptions              — 처방-재측정 루프
--      3) universities.last_cut_basis — 합격선 산출 기준(정의가 확인된 대학만 비교)
--
--  실행 시점
--    ※ 이 파일은 **코드 배포 전에 실행해도 무해하다.**
--      기존 테이블에는 nullable 컬럼만 추가하고, 권한 변화는 신규 테이블
--      prescriptions 에만 국한된다. 기존 화면 동작에 영향이 없다.
--    Supabase 대시보드 → SQL Editor → 전체 붙여넣고 [Run].
--
--  안전성
--    전부 멱등이다. 재실행해도 데이터가 삭제되거나 중복되지 않는다.
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
--  1) 문항별 감점 항목
-- ─────────────────────────────────────────────
--  형식: [{"label":"조건 누락","points":1,"tag":"조건 해석"}, ...]
--    label  : 감점 사유(강사가 자유 입력)
--    points : 감점 점수(양수). 합계가 문항 배점을 넘지 않도록 UI 에서 막는다.
--    tag    : WRONG_REASONS 중 하나 또는 null. 체크 시 오답원인 자동 제안에 쓴다.
alter table public.questions add column if not exists deduction_items jsonb;

comment on column public.questions.deduction_items is
  '문항별 감점 항목 [{label,points,tag}]. 채점 그리드에서 체크박스로 자동 감점 계산.';

-- ─────────────────────────────────────────────
--  2) 처방-재측정 루프
-- ─────────────────────────────────────────────
--  취약 진단에서 배정한 보완 과제. 배정 시점의 정답률(baseline_rate)을 남겨
--  이후 주간테스트에서 같은 단원×사고과정이 얼마나 올랐는지 비교한다.
create table if not exists public.prescriptions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete cascade,
  unit text,
  cognition text,
  due_date date,
  note text,
  baseline_rate numeric,
  status text not null default 'active' check (status in ('active','done','cancelled')),
  created_at timestamptz default now()
);

create index if not exists prescriptions_student_status_idx
  on public.prescriptions (student_id, status);

alter table public.prescriptions enable row level security;

--  관리자 전권
drop policy if exists "admin_all" on public.prescriptions;
create policy "admin_all" on public.prescriptions
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

--  학생·학부모는 본인 처방 읽기만
drop policy if exists "stu_self" on public.prescriptions;
create policy "stu_self" on public.prescriptions
  for select to authenticated
  using (public.app_token_ok() and student_id = public.app_student_id());

-- ─────────────────────────────────────────────
--  3) 합격선 산출 기준
-- ─────────────────────────────────────────────
--  예: "150점 만점 70%컷 환산", "논술 100% 기준 백분위"
--  이 값이 비어 있으면 우리 첨삭 점수와 직접 비교할 근거가 없으므로
--  화면에서 격차 비교를 생략한다(잘못된 비교로 오판하는 것을 막는다).
alter table public.universities add column if not exists last_cut_basis text;

comment on column public.universities.last_cut_basis is
  'last_cut_pct 가 무엇을 기준으로 산출된 값인지. 입력된 대학만 첨삭 점수와 격차를 비교한다.';

insert into public.schema_migrations (version) values ('0008_care_loop')
on conflict do nothing;
