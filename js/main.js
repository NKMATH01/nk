/* 진입점 — 메뉴 정의, enterApp, navigate 라우터, 부트스트랩 */
import { doLogin, doLogout, exitPreview, loadSession, maybeRefreshSession, saveSession, savePreviewSession } from './auth.js';
import { cdnLoaded, isConfigured } from './config.js';
import { applySession, db } from './db.js';
import { buildDemoStore } from './demo.js';
import { svg } from './icons.js';
import { app } from './state.js';
import { bindDemoSwitch, demoSwitchHTML, destroyCharts, hidePreviewStrip, showPreviewStrip } from './ui.js';
import { $, esc } from './util.js';
import { renderAdmission } from './views/admission.js';
import { renderCounseling, renderStudentCounsel } from './views/counseling.js';
import { ensureReadinessSnapshots, renderDashboard } from './views/dashboard.js';
import { renderDiagnosis } from './views/diagnosis.js';
import { renderEssays } from './views/essays.js';
import { renderHomeworkCheck } from './views/homework.js';
import { renderParent } from './views/parent.js';
import { renderProblems } from './views/problems.js';
import { renderReport } from './views/report.js';
import { renderSettings } from './views/settings.js';
import { renderStudentTargets } from './views/studentTargets.js';
import { renderStudents } from './views/students.js';
import { renderTests } from './views/tests.js';
import { renderUniversities } from './views/universities.js';

/* ═══════════════════════════════════════════════════════════════════
   메뉴 정의
   ═══════════════════════════════════════════════════════════════════ */
const ADMIN_MENU=[
  {grp:'개요'},
  {id:'dashboard',label:'대시보드',icon:'dashboard'},
  {grp:'관리'},
  {id:'students',label:'학생 관리',icon:'users'},
  {id:'counsel',label:'상담 기록',icon:'chat'},
  {id:'problems',label:'문제은행',icon:'file'},
  {id:'tests',label:'주간테스트',icon:'grid'},
  {id:'hwcheck',label:'과제 점검',icon:'clipboardCheck'},
  {id:'diagnosis',label:'취약 진단',icon:'activity'},
  {id:'essays',label:'첨삭 관리',icon:'pen'},
  {grp:'분석'},
  {id:'admission',label:'합격 가능성',icon:'trending'},
  {id:'report',label:'진행 현황 리포트',icon:'file'},
  {id:'universities',label:'대학 정보',icon:'building'},
  {grp:'기타'},
  {id:'settings',label:'설정',icon:'settings'},
];
const STUDENT_MENU=[
  {id:'s_report',label:'내 리포트',icon:'file'},
  {id:'s_counsel',label:'상담 내역',icon:'chat'},
  {id:'s_diagnosis',label:'취약 진단',icon:'activity'},
  {id:'s_essays',label:'첨삭 이력',icon:'pen'},
  {id:'s_targets',label:'목표 대학',icon:'target'},
];
function menuFor(role){return role==='student'?STUDENT_MENU:ADMIN_MENU;}

async function enterApp(role,studentId){
  app.cur.role=role;app.cur.studentId=studentId||null;
  $('loginView').style.display='none';
  if(role==='parent'){await renderParent();return;}
  $('parentView').style.display='none';$('appView').style.display='block';
  $('demoStrip').style.display=app.DEMO?'block':'none';

  // 기본 대상 학생
  if(role!=='student'){const studs=await db.listStudents();app.cur.studentId=studs[0]?.id||null;}
  // 사용자 라벨
  const label=role==='admin'?'관리자':(role==='student'?await studentName(app.cur.studentId):'사용자');
  $('userLabel').textContent=label;$('userAv').textContent=label.slice(0,1);
  // 데모 역할 스위처
  $('topRight').innerHTML=app.DEMO?demoSwitchHTML(role):(role==='student'?'<span class="chip gray">학생용 · 본인 데이터만</span>':'');
  if(app.DEMO)bindDemoSwitch();

  const menu=menuFor(role);
  $('navMenu').innerHTML=menu.map(m=>m.grp?`<div class="grp">${esc(m.grp)}</div>`:
    `<button data-tab="${m.id}">${svg(m.icon)}${esc(m.label)}</button>`).join('');
  $('navMenu').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{navigate(b.dataset.tab);setSide(false);}));
  navigate(menu.find(m=>m.id).id);
}
async function studentName(sid){const s=(await db.listStudents()).find(x=>x.id===sid);return s?s.name:'학생';}

function navigate(tab){
  app.state.activeTab=tab;destroyCharts();$('globalErr').style.display='none';
  const menu=menuFor(app.cur.role);
  $('navMenu').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  const meta=menu.find(m=>m.id===tab);$('pageTitle').textContent=meta?meta.label:'';$('pageCrumb').textContent='';
  const c=$('tabContent');c.innerHTML='<p class="muted">불러오는 중...</p>';
  const R={dashboard:renderDashboard,students:renderStudents,counsel:renderCounseling,problems:renderProblems,tests:renderTests,hwcheck:renderHomeworkCheck,diagnosis:renderDiagnosis,
    essays:renderEssays,admission:renderAdmission,report:renderReport,universities:renderUniversities,settings:renderSettings,
    s_report:renderReport,s_counsel:renderStudentCounsel,s_diagnosis:renderDiagnosis,s_essays:renderEssays,s_targets:renderStudentTargets};
  (R[tab]||(x=>x.innerHTML='<p class="muted">준비 중</p>'))(c);
  /* 준비도 스냅샷을 하루 1회 적재한다 — **어느 화면을 열든**.
     학생 리포트가 이 스냅샷을 읽으므로(4-2), 적재가 "대시보드를 연 날"에만 돌면
     강사가 대시보드를 건너뛴 날은 학생 화면이 통째로 '산출 대기'가 된다.
     대시보드는 렌더 과정에서 이미 같은 계산을 하고 적재하므로 중복 호출하지 않는다.
     관리자·비데모가 아니면 함수가 즉시 빠진다. await 하지 않는다(화면을 막지 않는다). */
  if(tab!=='dashboard')ensureReadinessSnapshots();
}

/* 학부모 링크 토큰을 정식 세션으로 승격한다.
   /api/refresh 가 서명·만료·token_version 을 한 번에 검증해 주고,
   유효하면 student_id 까지 담긴 새 토큰을 돌려주므로 그대로 세션에 넣는다. */
async function adoptParentToken(){
  try{
    const res=await fetch('/api/refresh',{method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+app.session.token}});
    if(!res.ok)return false;
    const d=await res.json();
    if(!d||!d.token)return false;
    app.session={token:d.token,role:d.role,student_id:d.student_id||null,phone:d.phone,exp:d.exp,tv:d.tv};
    saveSession(app.session);
    applySession();
    return true;
  }catch(e){console.warn('학부모 링크 검증 실패',e&&e.message);return false;}
}

/* ═══════════ 미리보기(?preview=) ═══════════
   원장이 [학생 관리]에서 연 "그 학생 계정으로 로그인한 것과 같은 화면".
   ★ ptoken 과 **별개의 분기**다. 용도가 다르다 —
     ptoken : 학부모 본인 기기용. 정식 세션으로 승격하고 localStorage 에 남긴다.
     preview: 원장 기기의 그 탭에서만. sessionStorage 에 두어야 관리자 탭이 살아 있다. */

/* 미리보기 토큰의 페이로드를 읽는다. **서명은 검증하지 않는다** — 검증은 서버와
   PostgREST(RLS)가 한다. 여기서 읽는 값은 화면 표시·만료 판단용이다.
   ptoken 처럼 /api/refresh 로 승격하지 않는 이유: 승격하면 7일짜리 정식 토큰이 되어
   미리보기용 15분 수명이 사라진다. */
function decodeTokenPayload(t){
  try{
    const p=String(t).split('.')[1];
    return JSON.parse(atob(p.replace(/-/g,'+').replace(/_/g,'/')));
  }catch(e){return null;}
}
async function startPreview(token){
  const p=decodeTokenPayload(token);
  if(!p||!p.exp||p.exp*1000<=Date.now()||(p.app_role!=='student'&&p.app_role!=='parent'))return false;
  app.session={token,role:p.app_role,student_id:p.student_id||null,phone:null,exp:p.exp,tv:p.tv};
  app.preview={role:p.app_role,studentName:''};   // enterApp 전에 세워야 쓰기 UI 가 처음부터 잠긴다
  applySession();
  try{
    // 이 토큰의 RLS 로는 본인(자녀) 한 명만 돌아온다 — 배너에 쓸 이름을 그대로 받는다.
    const studs=await db.listStudents();
    app.preview.studentName=(studs.find(s=>s.id===app.session.student_id)||studs[0]||{}).name||'학생';
    savePreviewSession(Object.assign({},app.session,{preview:app.preview}));
    showPreviewStrip();
    await enterApp(app.session.role,app.session.student_id);
    return true;
  }catch(e){
    console.error('미리보기 진입 실패',e);
    hidePreviewStrip();
    return false;
  }
}

/* 하위 모듈이 순환 import 없이 라우터를 호출할 수 있도록 후크를 주입한다.
   아래 부트스트랩이 실행되기 전에 채워져 있어야 한다. */
app.enterApp = enterApp;
app.navigate = navigate;
app.doLogout = doLogout;
app.exitPreview = exitPreview;

/* ═══════════ 부트스트랩 ═══════════ */
$('loginLogo').innerHTML=svg('target');$('sideLogo').innerHTML=svg('target');$('logoutIcon').innerHTML=svg('logout');
$('pLogo').innerHTML=svg('target');$('menuToggle').innerHTML=svg('menu');
$('loginBtn').addEventListener('click',doLogin);
$('loginPw').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
$('loginPhone').addEventListener('keydown',e=>{if(e.key==='Enter')$('loginPw').focus();});
$('logoutBtn').addEventListener('click',doLogout);
function setSide(open){$('sidebar').classList.toggle('open',open);$('sideBackdrop').style.display=open?'block':'none';}
$('menuToggle').addEventListener('click',()=>setSide(!$('sidebar').classList.contains('open')));
$('sideClose').addEventListener('click',()=>setSide(false));
$('sideBackdrop').addEventListener('click',()=>setSide(false));

(async function boot(){
  const params=new URLSearchParams(location.search);
  if(!cdnLoaded()){$('cdnBanner').style.display='block';$('loginBtn').disabled=true;$('loginView').style.display='flex';return;}
  if(params.get('demo')==='1'){app.DEMO=true;app.store=buildDemoStore();await enterApp('admin',null);return;}
  $('loginView').style.display='flex';
  if(!isConfigured()){$('cfgBanner').style.display='block';$('loginBtn').disabled=true;return;}
  // 학부모 링크(?ptoken=)로 들어온 경우. 토큰 유효성은 서버가 판단한다
  // (클라이언트는 서명을 검증할 수 없으므로 /api/refresh 로 한 번 확인한다).
  const ptoken=params.get('ptoken');
  if(ptoken){
    app.session={token:ptoken,role:'parent',student_id:null,exp:Math.floor(Date.now()/1000)+60};
    applySession();
    const ok=await adoptParentToken();
    // 주소창에서 토큰을 지운다(뒤로가기·공유로 새어 나가지 않게).
    try{history.replaceState(null,'',location.pathname);}catch(e){}
    if(ok){await enterApp(app.session.role,app.session.student_id);return;}
    app.session=null;applySession();
    $('loginView').style.display='flex';
    $('loginErr').textContent='링크가 만료되었거나 올바르지 않습니다. 전화번호로 로그인해 주세요.';
    return;
  }

  // 미리보기(?preview=) — 관리자가 학생·학부모 화면을 그 역할의 토큰으로 여는 경로.
  // 주소창에서 토큰을 먼저 지운다(ptoken 과 같은 관례 — 뒤로가기·공유로 새어 나가지 않게).
  const preview=params.get('preview');
  if(preview){
    try{history.replaceState(null,'',location.pathname);}catch(e){}
    if(await startPreview(preview))return;
    app.session=null;app.preview=null;applySession();
    $('loginView').style.display='flex';
    $('loginErr').textContent='미리보기가 만료되었습니다(15분). [학생 관리]에서 다시 열어 주세요.';
    return;
  }

  const s=loadSession();
  app.session=s;
  // 미리보기 탭을 새로고침한 경우 — sessionStorage 세션에 실린 preview 정보를 복원한다.
  if(s&&s.preview){app.preview=s.preview;showPreviewStrip();}
  // 세션 토큰을 실은 클라이언트를 만든다. 토큰 클레임으로 RLS 가 판별되므로
  // 이 호출 전에는 어떤 조회도 하면 안 된다.
  applySession();
  if(s){
    try{
      await maybeRefreshSession();   // 만료가 가까우면 조용히 연장(실패해도 진행)
      await enterApp(app.session.role,app.session.student_id);
    }catch(e){console.error(e);doLogout();}
  }
})();
