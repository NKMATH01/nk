-- ═══════════════════════════════════════════════════════════════════
--
--   ██  실행 순서  ██
--
--   **코드 배포보다 먼저 실행해도 안전하다.**
--   scores 에 nullable 컬럼 1개를 더하는 것이 전부라, 구버전 코드는
--   이 컬럼을 모르는 채로 그대로 동작한다.
--
--   다만 이 컬럼 없이 신버전 코드를 배포하면 few-shot 조회가
--   `or=(note_source.is.null,note_source.eq.teacher)` 로 없는 컬럼을 걸어
--   실패한다. few-shot 실패는 무시하고 채점을 계속하도록 만들어 두었으므로
--   채점이 멈추지는 않지만, 그동안 예시 없이 돌아간다.
--
-- ═══════════════════════════════════════════════════════════════════
--
--  0017_score_note_source
--
--  목적
--    scores.reason_note 에 담긴 문장이 **누가 쓴 것인지**를 남긴다.
--
--    지금까지 [제안 반영] 버튼이 AI 가 쓴 문장(grading_runs.feedback_text)을
--    scores.reason_note 에 그대로 써 넣었고, 그 문장이 다음 채점에서
--    "강사메모" few-shot 으로 되돌아왔다(api/grade-run.js fewShotExamples).
--    AI 가 자기 출력을 학습하고, full 전환 게이트인 일치율이 자기충족적으로
--    올라가는 되먹임이다.
--
--    api/grade-review.js 는 이제 reason_note 를 아예 건드리지 않으므로
--    앞으로 이 컬럼에는 강사 문장만 쌓인다. 이 컬럼은 **과거에 오염된 행을
--    few-shot 에서 걸러내기 위한** 판별 필드다.
--
--  값 규약
--    'teacher'     감점 패널에서 강사가 직접 입력한 메모
--    'ai_applied'  AI 문장이 반영된 것
--    null          구분 불가
--
--    ★ 기존 행은 전부 null 로 남긴다. 언제 어떤 행이 덮였는지 알 수 있는
--      기록이 없으므로 추정해서 채우면 없는 사실을 지어내는 것이 된다.
--      **null 은 "모른다"는 사실 자체를 보존한 값**이다. 지우거나 채우지 마라.
--
--    few-shot 은 null 을 포함한다. 과거 행의 대부분은 정상적인 강사 메모이고,
--    전부 버리면 예시가 통째로 비어 품질이 오히려 떨어진다. 확실히 AI 유래인
--    'ai_applied' 만 제외한다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 [Run].
--
--  안전성
--    멱등이다(add column if not exists). 컬럼 하나를 더할 뿐이며 기존 값을
--    읽지도 고치지도 않는다. RLS 정책 변경은 필요 없다 — scores 정책이 이미
--    존재하고, 컬럼 추가는 정책에 영향을 주지 않는다.
-- ═══════════════════════════════════════════════════════════════════

alter table public.scores add column if not exists note_source text;

comment on column public.scores.note_source is
  'reason_note 를 쓴 주체. teacher=강사 직접 입력, ai_applied=AI 문장 반영. '
  'null 인 기존 행은 구분 불가라는 사실 자체를 보존한 것이므로 채우거나 지우지 않는다. '
  'AI few-shot(api/grade-run.js)은 ai_applied 만 제외하고 null 은 포함한다.';

insert into public.schema_migrations (version) values ('0017_score_note_source')
on conflict do nothing;
