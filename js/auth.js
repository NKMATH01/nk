/* 세션 저장/복원과 로그인·로그아웃.
   로그인 성공 후 호출하는 enterApp 은 순환 import 를 피하려고 app 을 경유한다. */
import { SESSION_KEY } from './config.js';
import { app } from './state.js';
import { applySession } from './db.js';
import { destroyCharts } from './ui.js';
import { $, normPhone } from './util.js';

/* ═══════════════════════════════════════════════════════════════════
   인증 / 부트
   ═══════════════════════════════════════════════════════════════════ */
// 세션: {token, role, student_id, phone, exp, tv}. exp 는 JWT 규약대로 초 단위.
// 토큰 수명이 7일이라, 남은 수명이 이 값 미만이면 앱 진입 시 조용히 갱신한다.
const REFRESH_BEFORE_MS = 2*24*60*60*1000;

/* ── 세션 저장소가 둘인 이유 ───────────────────────────────────────
   실제 로그인 세션 : localStorage   — 브라우저 전체(모든 탭) 공유. 기존 그대로.
   미리보기 세션    : sessionStorage — **탭 단위**.

   ★ 미리보기를 localStorage 로 옮기지 마라. localStorage 는 탭 간 공유라,
     원장이 [학생 화면 보기]로 연 탭이 관리자 세션을 학생 세션으로 덮어
     **원래 보던 관리자 탭이 학생으로 바뀌어 로그아웃된다.**
   loadSession 이 sessionStorage 를 먼저 보므로, 미리보기 세션은 그 탭에서만 이긴다. */
const PREVIEW_KEY = SESSION_KEY + '_preview';

function readStore(store,key){try{const s=JSON.parse(store.getItem(key)||'null');if(s&&s.token&&s.exp*1000>Date.now())return s;}catch(e){}store.removeItem(key);return null;}
function saveSession(s){localStorage.setItem(SESSION_KEY,JSON.stringify(s));}
// 미리보기 세션만 저장한다. app.preview(역할·학생 이름)도 함께 실어 새로고침에서 복원한다.
function savePreviewSession(s){sessionStorage.setItem(PREVIEW_KEY,JSON.stringify(s));}
function loadSession(){return readStore(sessionStorage,PREVIEW_KEY)||readStore(localStorage,SESSION_KEY);}
// 로그아웃 — 실제 세션과 미리보기 세션을 모두 지운다.
function clearSession(){localStorage.removeItem(SESSION_KEY);sessionStorage.removeItem(PREVIEW_KEY);}
// 미리보기 종료 — **sessionStorage 만** 지운다(다른 탭의 관리자 세션은 건드리지 않는다).
function clearPreviewSession(){sessionStorage.removeItem(PREVIEW_KEY);}

/* 미리보기 종료. sessionStorage 만 비우고 그 탭을 닫는다.
   window.close() 는 스크립트가 연 탭에서만 통하므로, 막히면 같은 탭을 새로 고쳐
   localStorage 의 관리자 세션으로 되돌아가게 한다. */
function exitPreview(){
  clearPreviewSession();
  app.preview=null;app.session=null;
  try{window.close();}catch(e){}
  setTimeout(()=>{try{location.replace(location.pathname);}catch(e){location.reload();}},150);
}

async function doLogin(){
  const phone=normPhone($('loginPhone').value),pw=$('loginPw').value,err=$('loginErr');err.textContent='';
  if(!phone||!pw){err.textContent='전화번호와 비밀번호를 입력하세요.';return;}
  if(app.DEMO){err.textContent='데모 모드에서는 로그인할 수 없습니다.';return;} // 데모는 서버 함수를 호출하지 않는다
  $('loginBtn').disabled=true;$('loginBtn').textContent='확인 중...';
  try{
    // 해시 대조는 서버(/api/login)에서 한다. 비밀번호 해시는 브라우저로 내려오지 않는다.
    const res=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({phone,password:pw})});
    let data=null;try{data=await res.json();}catch(e){}
    if(!res.ok){err.textContent=(data&&data.error)||'로그인에 실패했습니다.';}
    else{app.session={token:data.token,role:data.role,student_id:data.student_id||null,phone:data.phone,exp:data.exp,tv:data.tv};
      saveSession(app.session);
      applySession();   // 새 토큰으로 Supabase 클라이언트를 다시 만든다(RLS 판별의 근거)
      await app.enterApp(data.role,data.student_id);}
  }catch(e){err.textContent='로그인 오류: '+(e?.message||'네트워크 확인');}
  finally{$('loginBtn').disabled=false;$('loginBtn').textContent='로그인';}
}
/* 미리보기 탭에서는 [로그아웃]도 미리보기 종료로 처리한다 —
   여기서 clearSession 을 부르면 localStorage 까지 비워 다른 탭의 관리자가 로그아웃된다. */
function doLogout(){if(app.preview){exitPreview();return;}clearSession();app.session=null;applySession();destroyCharts();$('appView').style.display='none';$('parentView').style.display='none';$('loginView').style.display='flex';$('loginPw').value='';}

/* 남은 수명이 짧으면 토큰을 연장한다. 실패해도 조용히 넘어간다
   (기존 토큰이 아직 유효하므로 화면은 그대로 동작한다). */
async function maybeRefreshSession(){
  const s=app.session;
  // ★ 미리보기는 갱신하지 않는다 — /api/refresh 가 7일짜리 정식 토큰을 주므로
  //   갱신하는 순간 15분짜리 미리보기 수명이 사라진다.
  if(app.DEMO||app.preview||!s||!s.token||!s.exp)return false;
  const leftMs=s.exp*1000-Date.now();
  if(leftMs<=0||leftMs>=REFRESH_BEFORE_MS)return false;
  try{
    const res=await fetch('/api/refresh',{method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+s.token}});
    if(!res.ok)return false;
    const data=await res.json();
    if(!data||!data.token)return false;
    app.session={token:data.token,role:data.role,student_id:data.student_id||null,phone:data.phone,exp:data.exp,tv:data.tv};
    saveSession(app.session);
    applySession();
    return true;
  }catch(e){console.warn('세션 갱신 실패(기존 토큰 유지):',e&&e.message);return false;}
}

export { saveSession, savePreviewSession, loadSession, clearSession, clearPreviewSession, exitPreview,
         doLogin, doLogout, maybeRefreshSession };
