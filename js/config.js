/* 설정값과 상수. 다른 모듈을 import 하지 않는다(의존성 최하위). */

/* ═══════════════════════════════════════════════════════════════════
   설정: Supabase 프로젝트 정보를 여기에 붙여넣으세요
   ═══════════════════════════════════════════════════════════════════ */
const SUPABASE_URL = "https://eeontmmlhulrwkbusoxx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlb250bW1saHVscndrYnVzb3h4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2NzQ3MjIsImV4cCI6MjA4OTI1MDcyMn0.L8Nb4QYZ62UfyY7D69-WpsmcfhqiVH3pz_QVipPYSTM";

/* ═══════════ 상수 ═══════════ */
const UNITS = ['지수·로그함수','삼각함수','수열','극한과 연속','미분','적분'];
const COGNITIONS = ['개념','계산','그래프','활용'];
const WRONG_REASONS = ['조건 해석','계산 실수','개념 누락','풀이 근거 누락','시간 부족'];
const RUBRIC = ['조건 해석','풀이 과정','최종 답안'];
// v4부터 토큰이 Supabase JWT 클레임(role/app_role/tv)을 담는다.
// 구 v3 세션에는 그 클레임이 없어 RLS 를 통과하지 못하므로 키를 올려 재로그인을 강제한다.
const SESSION_KEY = 'nk_yak_session_v4';
const SESSION_DAYS = 30;      // 참고값. 실제 만료는 서버가 발급하는 JWT의 exp가 결정한다(api/_lib.js).
const TODAY = new Date(new Date().setHours(0,0,0,0));
// db/migrations/ 에 추가한 마이그레이션 버전을 여기에도 함께 등록한다.
const EXPECTED_MIGRATIONS = ['0001_baseline','0002_migration_tracking','0003_readiness_snapshots','0004_accounts_lockdown','0005_jwt_claims_helpers','0006_rls_policies','0007_storage_private','0008_care_loop','0009_problem_bank'];

function isConfigured(){return SUPABASE_URL&&SUPABASE_URL!=='여기에_붙여넣기'&&SUPABASE_ANON_KEY&&SUPABASE_ANON_KEY!=='여기에_붙여넣기';}
function cdnLoaded(){return typeof supabase!=='undefined'&&supabase&&typeof supabase.createClient==='function';}

export { SUPABASE_URL, SUPABASE_ANON_KEY, UNITS, COGNITIONS, WRONG_REASONS, RUBRIC, SESSION_KEY, SESSION_DAYS, TODAY, EXPECTED_MIGRATIONS, isConfigured, cdnLoaded };
