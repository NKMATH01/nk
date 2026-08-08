-- ═══════════════════════════════════════════════════════════════════
--
--   ██  실행 순서  ██
--
--   **코드 배포보다 먼저 실행한다.**
--   감점 패널 저장(js/views/tests.js openTagMenu)과 AI 채점 확정
--   (api/grade-review.js)이 scores.wrong_reason_tags 를 payload 에 담는다.
--   컬럼이 없으면 그 두 경로의 저장이 통째로 실패한다.
--   (채점 그리드의 [전체 저장]은 이 컬럼을 쓰지 않으므로 영향받지 않는다.)
--
--   반대로 이 마이그레이션만 먼저 돌리는 것은 완전히 안전하다 —
--   구버전 코드는 이 컬럼을 모르는 채로 그대로 동작한다.
--
-- ═══════════════════════════════════════════════════════════════════
--
--  0018_error_axis
--
--  목적
--    "오류유형"을 진단의 주 축으로 세운다. 두 가지를 한 파일에 묶었다.
--
--    (1) 감점 태그 다중 보존 — scores.wrong_reason_tags
--        강사는 감점 항목을 **여러 개** 체크하는데, 저장할 때 가장 큰 감점
--        하나의 태그만 scores.wrong_reason 에 남고 나머지는 버려졌다.
--        이미 하고 있는 입력이 저장 단계에서 소실되던 것이라
--        **강사 추가 작업 0** 으로 진단 표본이 늘어난다.
--
--    (2) 오류유형 축 집계 — 스키마 변경 없음
--        첨삭 쪽 태그는 essay_gradings.items(0014) 의 criteria[].tag 에 들어간다.
--        jsonb 라 컬럼 추가가 필요 없다. tag 가 없는 기존 기준은 코드가
--        RUBRIC_TO_ERROR(js/config.js)로 라벨을 매핑한다 —
--        기존 첨삭 기록 대부분이 RUBRIC 기본 라벨을 쓰므로 백필 없이
--        그대로 진단에 편입된다.
--
--  값 규약
--    text[]. 그 문항에서 강사가 인정한 오답 원인 전부(중복 없음).
--    값의 어휘는 js/config.js WRONG_REASONS 를 그대로 쓴다.
--    null / 빈 배열 = 배열 기록이 없다는 뜻이며, 오류가 아니다.
--
--  ★ 폴백 규약 — 읽기는 js/calc.js 의 scoreTags() 하나만 쓴다
--      wrong_reason_tags 가 비어 있지 않으면  → 그 배열
--      비어 있거나 null 이면                  → [wrong_reason] 중 truthy 만
--    과거 행은 배열이 없으므로 지금까지와 똑같이 **단일 원인**으로 읽힌다.
--    기존 화면의 숫자가 이유 없이 바뀌지 않는다.
--
--    wrong_reason 은 앞으로도 계속 write-through 한다(주 원인 = 가장 큰
--    감점 항목의 태그). 이 컬럼을 대체하는 것이 아니라 **곁에 두는 것**이다.
--
--    ★ 백필하지 않는다. 과거 행에는 애초에 태그가 하나만 기록됐으므로
--      배열로 옮겨도 새로 아는 사실이 없고, 위 폴백이 같은 값을 준다.
--      옮기는 순간 "원래 하나였다"는 사실만 잃는다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 [Run].
--
--  안전성
--    멱등이다(add column if not exists). 컬럼 하나를 더할 뿐이며 기존 값을
--    읽지도 고치지도 않는다. RLS 정책 변경은 필요 없다 — scores 정책이 이미
--    존재하고, 컬럼 추가는 정책에 영향을 주지 않는다.
-- ═══════════════════════════════════════════════════════════════════

alter table public.scores add column if not exists wrong_reason_tags text[];

comment on column public.scores.wrong_reason_tags is
  '그 문항에서 인정된 오답 원인 전부(중복 없음). 어휘는 js/config.js WRONG_REASONS. '
  '읽기는 js/calc.js scoreTags() 하나만 쓴다 — 이 배열이 비어 있으면 [wrong_reason] 으로 폴백한다. '
  'wrong_reason(주 원인 = 가장 큰 감점의 태그)은 계속 write-through 하며 이 컬럼이 대체하지 않는다. '
  '과거 행은 null 로 두고 백필하지 않는다(폴백이 같은 값을 준다).';

comment on column public.scores.deduction_checks is
  '체크된 감점 항목 [{label, points, tag}]. 셀 재편집 시 복원용이며 tag 는 0018 부터 함께 남긴다. '
  '복원 매칭 기준은 label+points 다 — tag 가 없는 기존 기록도 그대로 복원된다.';

comment on column public.essay_gradings.items is
  '문항별 채점기준 [{no, criteria:[{label, points, mark, tag}]}]. mark 는 O(전액)|P(절반)|X(0점). '
  'null 이면 구 3분할(cond/proc/ans) 기록이다. '
  'tag(0018)는 그 기준의 오류유형이며 없으면 코드가 RUBRIC_TO_ERROR 로 label 을 매핑한다.';

insert into public.schema_migrations (version) values ('0018_error_axis')
on conflict do nothing;
