-- ═══════════════════════════════════════════════════════════════════
--
--   ██  실행 순서  ██
--
--   **코드 배포보다 먼저 실행해도 안전하다.**
--   questions 에 nullable 컬럼 1개를 더하는 것이 전부라, 구버전 코드는
--   이 컬럼을 모르는 채로 그대로 동작한다.
--
-- ═══════════════════════════════════════════════════════════════════
--
--  0019_question_rubric
--
--  목적
--    회차 문항에 확정한 채점기준을 저장한다. 문제은행의 rubric 을 회차에
--    복사한 뒤에도 문항별로 독립 편집하고, 채점 그리드에서 기준별 충족
--    체크로 득점을 계산할 수 있게 한다.
--
--  저장 형식
--    [{ "criterion": "조건을 식으로 옮김", "points": 2,
--       "tag": "조건 해석" }, ...]
--    problems.rubric 과 같은 스키마다. 값이 없으면 기존 deduction_items
--    감점 방식으로 동작하므로 기존 회차도 그대로 사용할 수 있다.
--
--  안전성
--    멱등이다(add column if not exists). RLS 정책 변경은 필요 없다 —
--    questions 정책이 이미 존재하고, 컬럼 추가는 정책에 영향을 주지 않는다.
-- ═══════════════════════════════════════════════════════════════════

alter table public.questions add column if not exists rubric jsonb;

comment on column public.questions.rubric is
  '문항 채점기준 [{criterion, points, tag}]. problems.rubric과 동일 스키마. 채점 그리드에서 기준별 충족 체크로 득점을 계산하며, 없으면 기존 deduction_items로 동작한다.';

insert into public.schema_migrations (version) values ('0019_question_rubric')
on conflict do nothing;
