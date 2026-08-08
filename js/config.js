/* 설정값과 상수. 다른 모듈을 import 하지 않는다(의존성 최하위). */

/* ═══════════════════════════════════════════════════════════════════
   설정: Supabase 프로젝트 정보를 여기에 붙여넣으세요
   ═══════════════════════════════════════════════════════════════════ */
const SUPABASE_URL = "https://eeontmmlhulrwkbusoxx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlb250bW1saHVscndrYnVzb3h4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2NzQ3MjIsImV4cCI6MjA4OTI1MDcyMn0.L8Nb4QYZ62UfyY7D69-WpsmcfhqiVH3pz_QVipPYSTM";

/* ═══════════ 상수 ═══════════ */
const UNITS = ['지수·로그함수','삼각함수','수열','극한과 연속','미분','적분'];
const COGNITIONS = ['개념','계산','그래프','활용'];
// 오류유형 축(진단의 주 축)의 어휘다. **기존 값의 순서·문자열을 바꾸지 않는다** —
// 지금까지 쌓인 scores.wrong_reason 이 전부 미분류가 된다.
// '답안 형식'은 RUBRIC 의 '최종 답안'에 대응하는 항목이 없어 0018 에서 끝에 추가한 것이다.
const WRONG_REASONS = ['조건 해석','계산 실수','개념 누락','풀이 근거 누락','시간 부족','답안 형식'];
const RUBRIC = ['조건 해석','풀이 과정','최종 답안'];
/* 첨삭 채점기준 라벨 → 오류유형. criteria[].tag 가 없는 기준을 오류유형 축에 편입한다.
   기존 첨삭 기록 대부분이 RUBRIC 기본 라벨을 그대로 쓰므로 백필 없이 즉시 진단에 들어온다.
   여기에 없는 라벨(강사가 직접 친 기준명)은 '미분류'로 모인다(js/calc.js errorAxisFromRecords). */
const RUBRIC_TO_ERROR = { '조건 해석':'조건 해석', '풀이 과정':'풀이 근거 누락', '최종 답안':'답안 형식' };
// v4부터 토큰이 Supabase JWT 클레임(role/app_role/tv)을 담는다.
// 구 v3 세션에는 그 클레임이 없어 RLS 를 통과하지 못하므로 키를 올려 재로그인을 강제한다.
const SESSION_KEY = 'nk_yak_session_v4';
const SESSION_DAYS = 30;      // 참고값. 실제 만료는 서버가 발급하는 JWT의 exp가 결정한다(api/_lib.js).
const TODAY = new Date(new Date().setHours(0,0,0,0));
// db/migrations/ 에 추가한 마이그레이션 버전을 여기에도 함께 등록한다.
const EXPECTED_MIGRATIONS = ['0001_baseline','0002_migration_tracking','0003_readiness_snapshots','0004_accounts_lockdown','0005_jwt_claims_helpers','0006_rls_policies','0007_storage_private','0008_care_loop','0009_problem_bank','0010_ai_grading','0011_problem_variants','0012_admission_calibration','0013_deduction_checks','0014_essay_items','0015_counseling_audio','0016_counseling_audio_delete','0017_score_note_source','0018_error_axis','0019_prescription_loop','0020_readiness_v2'];

function isConfigured(){return SUPABASE_URL&&SUPABASE_URL!=='여기에_붙여넣기'&&SUPABASE_ANON_KEY&&SUPABASE_ANON_KEY!=='여기에_붙여넣기';}
function cdnLoaded(){return typeof supabase!=='undefined'&&supabase&&typeof supabase.createClient==='function';}

export { SUPABASE_URL, SUPABASE_ANON_KEY, UNITS, COGNITIONS, WRONG_REASONS, RUBRIC, RUBRIC_TO_ERROR, SESSION_KEY, SESSION_DAYS, TODAY, EXPECTED_MIGRATIONS, isConfigured, cdnLoaded };
