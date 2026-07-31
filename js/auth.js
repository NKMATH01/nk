/* 세션 저장/복원과 로그인·로그아웃.
   로그인 성공 후 호출하는 enterApp 은 순환 import 를 피하려고 app 을 경유한다. */
import { SESSION_KEY } from './config.js';
import { app } from './state.js';
import { destroyCharts } from './ui.js';
import { $, normPhone } from './util.js';

/* ═══════════════════════════════════════════════════════════════════
   인증 / 부트
   ═══════════════════════════════════════════════════════════════════ */
// 세션: {token, role, student_id, phone, exp}. exp 는 JWT 규약대로 초 단위.
function saveSession(s){localStorage.setItem(SESSION_KEY,JSON.stringify(s));}
function loadSession(){try{const s=JSON.parse(localStorage.getItem(SESSION_KEY)||'null');if(s&&s.token&&s.exp*1000>Date.now())return s;}catch(e){}localStorage.removeItem(SESSION_KEY);return null;}
function clearSession(){localStorage.removeItem(SESSION_KEY);}

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
    else{app.session={token:data.token,role:data.role,student_id:data.student_id||null,phone:data.phone,exp:data.exp};
      saveSession(app.session);await app.enterApp(data.role,data.student_id);}
  }catch(e){err.textContent='로그인 오류: '+(e?.message||'네트워크 확인');}
  finally{$('loginBtn').disabled=false;$('loginBtn').textContent='로그인';}
}
function doLogout(){clearSession();app.session=null;destroyCharts();$('appView').style.display='none';$('parentView').style.display='none';$('loginView').style.display='flex';$('loginPw').value='';}

export { saveSession, loadSession, clearSession, doLogin, doLogout };
