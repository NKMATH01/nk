/* 학부모 화면 (모바일 단일 스크롤) */
import { doLogout } from '../auth.js';
import { hwAccuracyAvg, hwTimeAvg } from '../calc.js';
import { UNITS } from '../config.js';
import { db, loadContext, studentBundle } from '../db.js';
import { app } from '../state.js';
import { bindDemoSwitch, demoSwitchHTML, destroyCharts } from '../ui.js';
import { $, ddayLabel, esc, r1 } from '../util.js';

/* ═══════════════════════════════════════════════════════════════════
   학부모 화면 (모바일 단일 스크롤)
   ═══════════════════════════════════════════════════════════════════ */
async function renderParent(){
  $('loginView').style.display='none';$('appView').style.display='none';
  $('parentView').style.display='block';
  $('pTop').innerHTML=app.DEMO?demoSwitchHTML('parent'):`<button class="btn sm line" id="pLogout" style="color:#fff;border-color:#3a4152;background:transparent">로그아웃</button>`;
  if(app.DEMO)bindDemoSwitch();else $('pLogout')?.addEventListener('click',doLogout);
  const wrap=$('parentWrap');wrap.innerHTML='<p class="muted">불러오는 중...</p>';
  const sid=app.cur.studentId;const ctx=await loadContext();const st=ctx.students.find(s=>s.id===sid);
  if(!st){wrap.innerHTML='<p class="muted">연결된 학생 정보가 없습니다.</p>';return;}
  const b=await studentBundle(sid,ctx);const weeks=b.perSession.map(s=>s.week);
  const selWeek=(app.state.reportWeek&&weeks.includes(app.state.reportWeek))?app.state.reportWeek:(weeks.at(-1)||null);
  const wp=b.weeklyPercents;const idx=weeks.indexOf(selWeek);
  const curPct=idx>=0?wp[idx]:null,prevPct=idx>0?wp[idx-1]:null;const delta=(curPct!=null&&prevPct!=null)?curPct-prevPct:null;
  const hw=b.homeworks;
  const selDate=(b.perSession.find(s=>s.week===selWeek)||{}).date;
  let hwScoped=hw;
  if(selDate){const t0=new Date(selDate+'T00:00:00').getTime();const near=hw.filter(h=>h.week_date&&Math.abs(new Date(h.week_date+'T00:00:00').getTime()-t0)<=3*86400000);if(near.length)hwScoped=near;}
  const hwAcc=hwAccuracyAvg(hwScoped);const hwTime=hwTimeAvg(hw);
  const unitAgg={};UNITS.forEach(u=>unitAgg[u]={e:0,p:0});b.questionRecords.forEach(r=>{unitAgg[r.unit].e+=r.earned;unitAgg[r.unit].p+=r.points;});
  const comment=await db.getTeacherComment(sid,selWeek);
  const targets=ctx.targets.filter(t=>t.student_id===sid).sort((a,b)=>a.priority-b.priority);

  wrap.innerHTML=`
    <div class="p-card"><div style="display:flex;justify-content:space-between;align-items:center">
      <div><div class="muted" style="font-size:12px">주간 리포트</div><h2 style="margin:3px 0 0">${esc(st.name)}</h2><div class="muted" style="font-size:12px">${esc(st.grade_type)} · ${esc(st.school||'')}</div></div>
      <select id="pWeek" style="padding:8px 10px;border:1.5px solid var(--line);border-radius:9px">${weeks.map(w=>`<option value="${w}" ${w===selWeek?'selected':''}>${w}주차</option>`).join('')||'<option>-</option>'}</select>
    </div></div>
    <div class="p-card"><div class="p-kpi">
      <div class="b"><div class="l">회차 점수</div><div class="v">${curPct==null?'-':r1(curPct)+'%'}</div></div>
      <div class="b"><div class="l">직전 대비</div><div class="v">${delta==null?'-':(delta>=0?'+':'')+r1(delta)+'%p'}</div></div>
      <div class="b"><div class="l">과제 정답률</div><div class="v">${hwAcc==null?'-':r1(hwAcc)+'%'}</div></div>
      <div class="b"><div class="l">과제 풀이시간</div><div class="v">${hwTime==null?'-':r1(hwTime)+'<span style="font-size:12px">분/회</span>'}</div></div>
    </div></div>
    <div class="p-card"><h3 style="margin:0 0 10px;font-size:14px">주간 점수 추이</h3><canvas id="pLine" height="150"></canvas></div>
    <div class="p-card"><h3 style="margin:0 0 10px;font-size:14px">단원별 정답률</h3>
      ${UNITS.map(u=>{const a=unitAgg[u];const p=a.p>0?Math.round(a.e/a.p*100):null;
        return `<div class="hbar-row"><span>${esc(u)}</span><div class="bar-track"><div class="bar-fill" style="width:${p||0}%;background:${p==null?'#ccc':(p<40?'var(--red)':p<70?'var(--amber)':'var(--green)')}"></div></div><span class="num">${p==null?'-':p+'%'}</span></div>`;}).join('')}</div>
    <div class="p-card"><h3 style="margin:0 0 8px;font-size:14px">강사 코멘트</h3>
      <div class="muted" style="font-size:13px;line-height:1.6">${comment?esc(comment.comment):'등록된 코멘트가 없습니다.'}</div></div>
    <div class="p-card"><h3 style="margin:0 0 10px;font-size:14px">목표 대학 · D-day</h3>
      ${targets.length?targets.map(t=>{const u=ctx.universities.find(x=>x.id===t.university_id);if(!u)return '';
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--line-2)"><span>${t.priority}지망 <b>${esc(u.name)}</b></span>${u.exam_date?`<span class="pill"><span class="dday">${ddayLabel(u.exam_date)}</span></span>`:'<span class="muted">미정</span>'}</div>`;}).join(''):'<p class="muted">등록된 목표 대학이 없습니다.</p>'}</div>
    <div class="p-card note-blue">본 리포트는 학습 관리용 참고 자료이며 합격을 보장하지 않습니다.</div>`;
  $('pWeek')?.addEventListener('change',e=>{app.state.reportWeek=Number(e.target.value);renderParent();});
  if(typeof Chart!=='undefined'&&wp.length){destroyCharts();
    app.state.charts.push(new Chart($('pLine').getContext('2d'),{type:'line',
      data:{labels:weeks.map(w=>w+'주'),datasets:[{data:wp,borderColor:'#E8B54D',backgroundColor:'rgba(232,181,77,.15)',borderWidth:3,tension:.3,pointRadius:4,fill:true}]},
      options:{responsive:true,maintainAspectRatio:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,max:100}}}}));}
}

export { renderParent };
