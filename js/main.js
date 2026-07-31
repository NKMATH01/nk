/* 진입점 — 메뉴 정의, enterApp, navigate 라우터, 부트스트랩 */
import { doLogin, doLogout, loadSession } from './auth.js';
import { SUPABASE_ANON_KEY, SUPABASE_URL, cdnLoaded, isConfigured } from './config.js';
import { db } from './db.js';
import { buildDemoStore } from './demo.js';
import { svg } from './icons.js';
import { app } from './state.js';
import { bindDemoSwitch, demoSwitchHTML, destroyCharts } from './ui.js';
import { $, esc } from './util.js';
import { renderAdmission } from './views/admission.js';
import { renderCounseling, renderStudentCounsel } from './views/counseling.js';
import { renderDashboard } from './views/dashboard.js';
import { renderDiagnosis } from './views/diagnosis.js';
import { renderEssays } from './views/essays.js';
import { initHashgen } from './views/hashgen.js';
import { renderHomeworkCheck } from './views/homework.js';
import { renderParent } from './views/parent.js';
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
  $('loginView').style.display='none';$('hashgenView').style.display='none';
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
  const R={dashboard:renderDashboard,students:renderStudents,counsel:renderCounseling,tests:renderTests,hwcheck:renderHomeworkCheck,diagnosis:renderDiagnosis,
    essays:renderEssays,admission:renderAdmission,report:renderReport,universities:renderUniversities,settings:renderSettings,
    s_report:renderReport,s_counsel:renderStudentCounsel,s_diagnosis:renderDiagnosis,s_essays:renderEssays,s_targets:renderStudentTargets};
  (R[tab]||(x=>x.innerHTML='<p class="muted">준비 중</p>'))(c);
}

/* 하위 모듈이 순환 import 없이 라우터를 호출할 수 있도록 후크를 주입한다.
   아래 부트스트랩이 실행되기 전에 채워져 있어야 한다. */
app.enterApp = enterApp;
app.navigate = navigate;
app.doLogout = doLogout;

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
  if(params.get('hashgen')==='1'){initHashgen();return;}
  if(!cdnLoaded()){$('cdnBanner').style.display='block';$('loginBtn').disabled=true;$('loginView').style.display='flex';return;}
  if(params.get('demo')==='1'){app.DEMO=true;app.store=buildDemoStore();await enterApp('admin',null);return;}
  $('loginView').style.display='flex';
  if(!isConfigured()){$('cfgBanner').style.display='block';$('loginBtn').disabled=true;return;}
  app.sb=supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
  const s=loadSession();
  if(s){app.session=s;try{await enterApp(s.role,s.student_id);}catch(e){console.error(e);doLogout();}}
})();
