/* ═══════════════════════════════════════════════════════════════════
   가변 공유 상태 싱글턴

   분할 전 전역 변수(sb, DEMO, session, cur, state, store, testUI, counselEdit)를
   하나의 객체로 모은 것이다. 재할당이 필요한 값은 전부 이 객체의 프로퍼티로 대입한다.
   (모듈 import 바인딩은 읽기 전용이라 `session = ...` 같은 재할당이 불가능하다.)

   enterApp / navigate / doLogout 은 라우터(main.js)와 하위 모듈 사이의 순환 import 를
   피하기 위한 후크다. main.js 가 로드되면서 채워 넣는다.
   이 파일은 어떤 모듈도 import 하지 않는다 — 의존성 그래프의 뿌리.
   ═══════════════════════════════════════════════════════════════════ */
export const app = {
  sb: null,                              // Supabase 클라이언트
  DEMO: false,                           // ?demo=1 여부
  session: null,                         // 실제 로그인 세션
  preview: null,                         // 미리보기 중이면 {role,studentName}. 이 값이 있으면 모든 쓰기를 막는다
  cur: { role: 'admin', studentId: null },  // 현재 화면 역할/대상 학생
  state: { activeTab: null, charts: [] },   // 화면 상태(활성 탭, Chart 인스턴스)
  store: null,                           // 데모 모드 메모리 저장소
  testUI: { step: 1, sessionId: null },  // 주간테스트 화면 단계
  counselEdit: null,                     // 상담 기록 수정 중인 id
  essayEdit: null,                       // 첨삭 기록 수정 중인 id

  enterApp: null,                        // main.js 가 주입
  navigate: null,                        // main.js 가 주입
  doLogout: null,                        // main.js 가 주입
  exitPreview: null,                     // main.js 가 주입
};
