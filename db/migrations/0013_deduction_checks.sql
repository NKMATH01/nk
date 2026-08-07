-- ═══════════════════════════════════════════════════════════════════
--
--   ██  실행 순서  ██
--
--   **코드 배포보다 먼저 실행해도 안전하다.**
--   scores 에 nullable 컬럼 1개를 더하는 것이 전부라, 구버전 코드는
--   이 컬럼을 모르는 채로 그대로 동작한다.
--
-- ═══════════════════════════════════════════════════════════════════
--
--  0013_deduction_checks
--
--  목적
--    채점 셀의 감점 항목 체크 상태를 남긴다. 지금은 체크로 득점(earned)만
--    계산하고 어떤 항목을 감점했는지는 버려서, 셀을 다시 열면 처음부터
--    다시 체크해야 한다.
--
--  저장 형식
--    [{ "label": "조건 누락", "points": 2 }, ...]
--    인덱스가 아니라 label+points 로 짝을 맞춘다 — 문항의 감점 항목이
--    나중에 편집되어도 어긋난 항목을 조용히 무시할 수 있다.
--
--  안전성
--    멱등이다(add column if not exists). RLS 정책 변경은 필요 없다 —
--    scores 정책이 이미 존재하고, 컬럼 추가는 정책에 영향을 주지 않는다.
-- ═══════════════════════════════════════════════════════════════════

alter table public.scores add column if not exists deduction_checks jsonb;

comment on column public.scores.deduction_checks is
  '채점 시 체크한 감점 항목 [{label, points}]. 셀 재편집 시 체크 상태 복원용이며 득점(earned)의 근거 기록이다.';

insert into public.schema_migrations (version) values ('0013_deduction_checks')
on conflict do nothing;
