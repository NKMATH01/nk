-- ═══════════════════════════════════════════════════════════════════
--
--   ██  실행 순서  ██
--
--   **코드 배포보다 먼저 실행한다.**
--   처방 배정(js/views/diagnosis.js)이 problem_ids·recheck_after·
--   baseline_rate_pooled 를 insert payload 에 담고, 판정 확정 시
--   result 를 update 한다. 컬럼이 없으면 그 저장이 통째로 실패한다.
--   학생의 [다 했어요]는 prescription_logs 테이블 자체가 없으면 실패한다.
--
--   반대로 이 마이그레이션만 먼저 돌리는 것은 완전히 안전하다 —
--   구버전 코드는 새 컬럼과 새 테이블을 모르는 채로 그대로 동작한다.
--
-- ═══════════════════════════════════════════════════════════════════
--
--  0019_prescription_loop
--
--  목적
--    "진단 → 처방 → 실행 → 재측정" 에서 비어 있던 **실행 층**을 채운다.
--    Phase 3-4·3-5 를 한 파일에 묶었다(같은 루프의 앞뒤라 따로 적용할 이유가 없다).
--
--    (1) 3-4 처방을 실행 가능하게 — prescriptions 컬럼 추가
--        지금 처방은 자유 텍스트 메모 한 줄이고, 재측정 판정은 화면을 그릴 때
--        계산됐다가 저장 없이 사라진다. 문제은행과 연결하고, 재측정 구간을
--        배정 시점에 확정하고, 판정을 영구 기록한다.
--
--    (2) 3-5 학생 처방 실행 로그 — prescription_logs 신규 테이블
--        학생이 처방을 실제로 했는지 강사가 알 방법이 지금은 없다.
--        아무것도 안 한 학생과 매일 한 학생이 강사 화면에서 똑같이 보인다.
--
--  안전성
--    전부 **추가만** 한다. add column if not exists(전부 nullable) ·
--    신규 테이블 · drop policy if exists 후 create policy.
--    기존 컬럼(unit/cognition/note/baseline_rate/status/due_date)의 의미를
--    바꾸지 않고, 기존 행의 값을 읽지도 고치지도 않는다. 백필하지 않는다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 [Run].
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
--  1) 처방을 실행 가능하게 (3-4)
-- ─────────────────────────────────────────────
--  전부 nullable 이다. 과거 처방은 이 컬럼들이 전부 null 인 채로 남고,
--  코드가 기존 컬럼으로 폴백해 **개편 전과 같은 판정**을 낸다.
alter table public.prescriptions add column if not exists error_type            text;
alter table public.prescriptions add column if not exists problem_ids           uuid[];
alter table public.prescriptions add column if not exists target_count          integer;
alter table public.prescriptions add column if not exists recheck_after         date;
alter table public.prescriptions add column if not exists baseline_rate_pooled  numeric;
alter table public.prescriptions add column if not exists baseline_n            integer;
alter table public.prescriptions add column if not exists baseline_points       numeric;
alter table public.prescriptions add column if not exists result                text;
alter table public.prescriptions add column if not exists result_delta          numeric;
alter table public.prescriptions add column if not exists result_recorded_at    timestamptz;
alter table public.prescriptions add column if not exists prev_prescription_id  uuid;
alter table public.prescriptions add column if not exists student_done_at       timestamptz;

--  후속 처방 사슬. 자기참조 FK 는 add column 과 분리해야 멱등하게 걸 수 있다.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'prescriptions_prev_fk'
  ) then
    alter table public.prescriptions
      add constraint prescriptions_prev_fk
      foreign key (prev_prescription_id) references public.prescriptions(id) on delete set null;
  end if;
end $$;

--  result 어휘 고정. **null 을 허용한다** — 판정이 아직 확정되지 않은 처방과
--  0019 이전에 배정된 처방이 전부 null 이다.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'prescriptions_result_chk'
  ) then
    alter table public.prescriptions
      add constraint prescriptions_result_chk
      check (result is null or result in ('improved','flat','worse'));
  end if;
end $$;

create index if not exists prescriptions_prev_idx
  on public.prescriptions (prev_prescription_id);

comment on column public.prescriptions.error_type is
  '오류유형 축(js/config.js WRONG_REASONS)의 표적. 기존 unit/cognition 표적과 **병행**한다 — '
  '재측정은 여전히 unit×cognition 으로 재므로 unit/cognition 을 대체하지 않는다.';

comment on column public.prescriptions.problem_ids is
  '배정한 문제은행 문항(problems.id). 강사가 문장을 짜내는 대신 고르게 하려고 둔다. '
  'FK 를 걸지 않는다 — 문항이 retired 되어도 "그때 무엇을 냈는지"는 기록으로 남아야 한다.';

comment on column public.prescriptions.target_count is '분량(문항 수). 문제를 고르지 않고 분량만 정할 수도 있다.';

comment on column public.prescriptions.recheck_after is
  '재측정 구간을 **배정 시점에 확정**한다. 이 날짜가 지나야 판정을 result 에 확정 기록한다. '
  '기본값은 배정일+2주이며 강사가 고칠 수 있다. null 이면(과거 처방) 판정을 기록하지 않고 매번 계산만 한다.';

--  ★ baseline_rate 와 baseline_rate_pooled 가 따로 있는 이유 — 서로 다른 자였다
--
--    기존 baseline_rate 는 히트맵 셀의 **최근 3회 가중평균**(50/30/20%)이고,
--    재측정 cellRateSince() 는 배정 이후 회차의 **단순 배점 풀링**이다.
--    지금까지 이 둘의 차이를 ±5%p 로 비교해 개선/정체/악화를 판정해 왔다 —
--    가중과 풀링이 다른 만큼이 그대로 판정에 섞였다.
--
--    baseline_rate_pooled 는 재측정과 **같은 추정량**(단순 배점 풀링, 최근 3회 구간)
--    으로 잰 기준선이다. 0019 이후 배정분에만 값이 들어간다.
--
--    ★ 폴백 규약 — 읽기는 js/calc.js prescriptionJudgment() 하나만 쓴다
--        baseline_rate_pooled 가 있으면 → 그 값(재측정과 같은 자)
--        null 이면(과거 처방)         → 기존 baseline_rate (개편 전과 같은 값)
--      과거 처방의 판정이 이유 없이 바뀌지 않는다.
--
--    ★ 백필하지 않는다. 과거 처방의 기준선을 지금 다시 계산하면 "배정 시점에
--      강사가 본 숫자"가 사라진다. 그 숫자가 처방의 근거였다.
comment on column public.prescriptions.baseline_rate is
  '배정 시점 정답률(히트맵 셀의 최근 3회 **가중**평균). 0019 이후에도 계속 저장한다. '
  '재측정과 추정량이 다르므로 판정에는 baseline_rate_pooled 를 우선 쓰고 이 값은 폴백이다.';

comment on column public.prescriptions.baseline_rate_pooled is
  '배정 시점 정답률을 재측정과 **같은 추정량**(단순 배점 풀링, 최근 3회 구간)으로 잰 값. '
  '판정은 pooled 끼리 비교한다. null 이면 baseline_rate 로 폴백(과거 처방). 백필하지 않는다.';

comment on column public.prescriptions.baseline_n is     '기준선 표본 문항 수. 기준선이 얼마나 얇은지 화면에 그대로 보여주려고 남긴다.';
comment on column public.prescriptions.baseline_points is '기준선 표본 배점 합. 재측정 표본 게이트(10점)와 같은 자로 읽는다.';

comment on column public.prescriptions.result is
  '확정된 재측정 판정 improved|flat|worse. recheck_after 가 지나고 판정이 확정되면 **한 번만** 쓴다. '
  '이후에는 저장값을 읽는다 — 데이터가 더 쌓여도 그때 내린 판정이 흔들리면 기록이 아니다. '
  '표본 부족·재측정 대기는 판정이 아니므로 기록하지 않는다(null 로 남는다).';
comment on column public.prescriptions.result_delta is       '확정 시점의 재측정 − 기준선 (%p).';
comment on column public.prescriptions.result_recorded_at is '판정을 확정 기록한 시각.';

comment on column public.prescriptions.prev_prescription_id is
  '악화·정체로 끝난 처방에 이어 배정한 후속 처방이면 그 이전 처방. 사슬이 보여야 루프가 된다(○차 시도).';

comment on column public.prescriptions.student_done_at is
  '(예약) 학생의 실행 완료 시각. 실행 기록은 prescription_logs 에 날짜별로 남기며 이 컬럼은 쓰지 않는다.';

-- ─────────────────────────────────────────────
--  2) 학생 처방 실행 로그 (3-5)
-- ─────────────────────────────────────────────
--  ★ prescriptions.status 는 **강사 전용 그대로** 둔다.
--    학생이 "다 했어요"를 눌러 강사의 작업 목록(active/done/cancelled)을
--    지울 수 있게 되면, 강사가 아직 확인하지 않은 처방이 화면에서 사라진다.
--    학생의 쓰기는 이 별도 테이블에만 닿는다.
create table if not exists public.prescription_logs (
  id uuid primary key default gen_random_uuid(),
  prescription_id uuid references public.prescriptions(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  log_date date not null,
  minutes integer,
  memo text,
  created_at timestamptz default now(),
  unique (prescription_id, log_date)
);

comment on table public.prescription_logs is
  '학생이 직접 남기는 처방 실행 기록(하루 1행). 허위 체크는 발생하지만 그래도 유용하다 — '
  '"6일 했는데 정답률이 그대로"는 학생이 게으른 게 아니라 **처방이 틀렸다는 신호**다. '
  '화면에는 최근 7일만 점으로 표시하고 연속·스트릭은 표시하지 않는다(끊긴 날이 앱을 마지막으로 연 날이 된다).';

comment on column public.prescription_logs.log_date is
  '실행한 날짜. (prescription_id, log_date) 유니크 — 같은 날 두 번 찍히지 않는다.';

create index if not exists prescription_logs_student_date_idx
  on public.prescription_logs (student_id, log_date desc);

alter table public.prescription_logs enable row level security;

--  관리자 전권 (0008 prescriptions 와 같은 패턴·같은 판별 함수)
drop policy if exists "admin_all" on public.prescription_logs;
create policy "admin_all" on public.prescription_logs
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

--  학생·학부모: 본인 실행 기록 조회 (0008 prescriptions 의 stu_self 와 동일)
drop policy if exists "stu_self" on public.prescription_logs;
create policy "stu_self" on public.prescription_logs
  for select to authenticated
  using (public.app_token_ok() and student_id = public.app_student_id());

--  학생: 본인 실행 기록 등록만 (0010 submissions 의 stu_insert 와 동일한 관용구)
--  ★ update / delete 정책은 만들지 않는다. 오늘 기록을 지우고 다시 찍는 동작은
--    필요가 없고, 그 경로가 있으면 기록이 "지금 상태"가 되어 기록이 아니게 된다.
drop policy if exists "stu_insert" on public.prescription_logs;
create policy "stu_insert" on public.prescription_logs
  for insert to authenticated
  with check (public.app_token_ok() and student_id = public.app_student_id());

insert into public.schema_migrations (version) values ('0019_prescription_loop')
on conflict do nothing;
