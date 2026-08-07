-- ═══════════════════════════════════════════════════════════════════
--
--   ██  실행 순서  ██
--
--   **코드 배포보다 먼저 실행해도 안전하다.**
--   essay_gradings 에 nullable 컬럼 3개를 더하는 것이 전부라, 구버전 코드는
--   이 컬럼들을 모르는 채로 그대로 동작한다.
--
-- ═══════════════════════════════════════════════════════════════════
--
--  0014_essay_items
--
--  목적
--    첨삭을 "문항 N개 × 채점기준 M개"로 남긴다. 지금은 한 행에 고정 3항목
--    (조건해석/풀이과정/최종답안)의 득점·만점만 있어 문항 번호 개념이 없고,
--    대학별 실제 채점표(문항마다 기준과 배점이 다름)를 그대로 옮길 수 없다.
--
--  저장 형식 (items)
--    [{ "no": 1, "criteria": [{ "label": "조건 해석", "points": 8, "mark": "O" }] }]
--    mark 는 "O"(배점 전액) | "P"(절반, 화면 표기 △) | "X"(0점) 세 값만 쓴다.
--    한글·기호를 DB 에 넣지 않는다 — 표기가 바뀌어도 저장값은 그대로 두려는 것이다.
--    문항 배점은 그 문항 기준 배점의 합이라 따로 저장하지 않는다.
--    total_earned / total_max 는 items 를 접은 값이며, 집계 시 items 를 펼치지
--    않으려고 함께 저장한다.
--
--  기존 데이터
--    기존 행은 items = null 이며 **3분할 컬럼(cond/proc/ans)을 그대로 쓴다.
--    데이터 변환을 하지 않는다.** 부분점수(예: 8/10)를 O/△/X 로 접으면
--    없던 판정을 지어내는 셈이라 의미가 왜곡되기 때문이다.
--    코드는 total_max 가 null 이면 3분할 합으로 폴백한다(js/calc.js essayTotals).
--
--  안전성
--    멱등이다(add column if not exists). RLS 정책 변경은 필요 없다 —
--    essay_gradings 정책이 이미 존재하고, 컬럼 추가는 정책에 영향을 주지 않는다.
-- ═══════════════════════════════════════════════════════════════════

alter table public.essay_gradings add column if not exists items        jsonb;
alter table public.essay_gradings add column if not exists total_earned numeric;
alter table public.essay_gradings add column if not exists total_max    numeric;

comment on column public.essay_gradings.items is
  '문항별 채점기준 [{no, criteria:[{label, points, mark}]}]. mark 는 O(전액)|P(절반)|X(0점). null 이면 구 3분할(cond/proc/ans) 기록이다.';
comment on column public.essay_gradings.total_earned is
  'items 기준 득점 합(0.5 단위). items 가 null 인 구 기록에서는 함께 null 이다.';
comment on column public.essay_gradings.total_max is
  'items 기준 배점 합. **이 값의 null 여부가 신·구 형식 판별 기준이다** — total_earned 는 0 일 수 있어 판별에 쓰지 않는다.';

insert into public.schema_migrations (version) values ('0014_essay_items')
on conflict do nothing;
