/* 대시보드. 행 클릭 시 이동하는 navigate 는 순환 import 를 피하려고 app 을 경유한다. */
import { band, computeReadiness, heatFromRecords, shortfallContribution } from '../calc.js';
import { COGNITIONS, UNITS } from '../config.js';
import { db, loadContext, studentBundle } from '../db.js';
import { svg } from '../icons.js';
import { app } from '../state.js';
import { daysUntil, ddayLabel, esc, fmtDate, r1, todayStr } from '../util.js';

/* ═══════════════════════════════════════════════════════════════════
   1) 대시보드 (올인원)
   ═══════════════════════════════════════════════════════════════════ */
/* 준비도 추이를 하루 1행으로 적재한다(관리자·비데모 한정).
   화면 렌더를 막지 않도록 await 하지 않으며, 실패해도 콘솔 기록만 남긴다. */
function saveReadinessSnapshots(rows){
  if(app.DEMO||app.cur.role!=='admin')return;
  const snaps=rows.filter(r=>r.readiness!=null).map(r=>({
    student_id:r.st.id,snap_date:todayStr(),readiness:r1(r.readiness),
    meta:{last_pct:r.lastPct==null?null:r1(r.lastPct),weak_unit:r.weak?r.weak.unit:null,weak_cognition:r.weak?r.weak.cognition:null}}));
  if(!snaps.length)return;
  db.upsertReadinessSnapshot(snaps).catch(e=>console.error('준비도 스냅샷 적재',e));
}
async function renderDashboard(c){
  const ctx=await loadContext();
  const active=ctx.students.filter(s=>s.status==='재원'||!s.status);
  const latest=ctx.sessions[ctx.sessions.length-1]||null;
  // 상담 최근일 (관리자 전용 화면에서만 로드)
  const allCounsel=await db.listAllCounseling();
  const lastCounselBy={};allCounsel.forEach(n=>{if(!lastCounselBy[n.student_id]||n.note_date>lastCounselBy[n.student_id])lastCounselBy[n.student_id]=n.note_date;});

  // 학생별 요약
  const rows=[];
  for(const st of active){
    const b=await studentBundle(st.id,ctx);
    const {readiness}=computeReadiness({weeklyPercents:b.weeklyPercents,questionRecords:b.questionRecords,essays:b.essayInputs,homeworks:b.homeworks});
    const heat=heatFromRecords(b.questionRecords);
    // 취약 1순위
    const cells=[];const totPts=b.questionRecords.reduce((s,r)=>s+r.points,0)||1;
    const ptsByCell={};b.questionRecords.forEach(r=>{const k=r.unit+'|'+r.cognition;ptsByCell[k]=(ptsByCell[k]||0)+r.points;});
    UNITS.forEach(u=>COGNITIONS.forEach(cg=>{const h=heat[u][cg];if(h.rate!=null)cells.push({unit:u,cognition:cg,rate:h.rate,pointShare:(ptsByCell[u+'|'+cg]||0)/totPts});}));
    const weak=shortfallContribution(cells)[0];
    // 최근/직전 점수
    const wp=b.weeklyPercents;const lastPct=wp.length?wp[wp.length-1]:null;const prevPct=wp.length>1?wp[wp.length-2]:null;
    const delta=(lastPct!=null&&prevPct!=null)?lastPct-prevPct:null;
    // 이번 주 입력 여부(최근 회차에 이 학생 점수 존재?)
    let entered=false;
    if(latest){const qids=ctx.questions.filter(q=>q.session_id===latest.id).map(q=>q.id);entered=b.scores.some(s=>qids.includes(s.question_id));}
    // 목표 1지망
    const t1=ctx.targets.filter(t=>t.student_id===st.id).sort((a,b)=>a.priority-b.priority)[0];
    const uni=t1?ctx.universities.find(u=>u.id===t1.university_id):null;
    rows.push({st,readiness,lastPct,delta,weak,entered,uni,lastCounsel:lastCounselBy[st.id]||null});
  }
  saveReadinessSnapshots(rows);
  // KPI
  const avgLatest=(()=>{if(!latest)return null;let e=0,p=0;const qids=ctx.questions.filter(q=>q.session_id===latest.id);
    // 반평균 = 최근회차 학생 평균 점수%
    const vals=rows.map(r=>r.lastPct).filter(v=>v!=null);return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;})();
  const enteredRate=rows.length?Math.round(rows.filter(r=>r.entered).length/rows.length*100):0;
  // 최근접 고사
  const upcoming=ctx.universities.filter(u=>u.exam_date&&daysUntil(u.exam_date)>=0).sort((a,b)=>daysUntil(a.exam_date)-daysUntil(b.exam_date));
  const nearest=upcoming[0];

  const kpi=`<div class="kpi-grid">
    <div class="kpi"><div class="lbl">${svg('users','sm')}재원 학생</div><div class="val">${active.length}<small> 명</small></div></div>
    <div class="kpi"><div class="lbl">${svg('activity','sm')}최근 회차 반평균</div><div class="val">${avgLatest==null?'-':r1(avgLatest)+'<small>%</small>'}</div></div>
    <div class="kpi"><div class="lbl">${svg('check','sm')}이번 주 채점 입력</div><div class="val">${enteredRate}<small>%</small></div></div>
    <div class="kpi accent"><div class="lbl">${svg('clock','sm')}최근접 논술고사</div><div class="val">${nearest?ddayLabel(nearest.exam_date):'-'}<small> ${nearest?esc(nearest.name):''}</small></div></div>
  </div>`;

  const bandChip=rd=>{const b=band(rd);return `<span class="chip ${b.cls}">${b.label}</span>`;};
  const deltaHTML=d=>{if(d==null)return '<span class="delta flat">-</span>';
    if(d>0.05)return `<span class="delta up">${svg('arrowUp','xs')}${r1(Math.abs(d))}</span>`;
    if(d<-0.05)return `<span class="delta down">${svg('arrowDown','xs')}${r1(Math.abs(d))}</span>`;
    return '<span class="delta flat">0</span>';};
  const tbl=`<div class="card"><h3>${svg('users')}학생 현황 <span class="sub">행을 클릭하면 취약 진단으로 이동합니다</span></h3>
    <div style="overflow-x:auto"><table><thead><tr>
      <th>학생</th><th>학년</th><th>목표(1지망)</th><th class="num">최근점수</th><th class="num">증감</th><th class="num">준비도</th><th>밴드</th><th>취약 1순위</th><th>이번주</th><th>최근 상담일</th>
    </tr></thead><tbody>
    ${rows.map(r=>`<tr data-sid="${esc(r.st.id)}" style="cursor:pointer">
      <td><b>${esc(r.st.name)}</b></td><td>${esc(r.st.grade_type)}</td>
      <td>${r.uni?esc(r.uni.name):'<span class="muted">미설정</span>'}</td>
      <td class="num">${r.lastPct==null?'-':r1(r.lastPct)+'%'}</td>
      <td class="num">${deltaHTML(r.delta)}</td>
      <td class="num"><b>${r.readiness==null?'-':r1(r.readiness)+'%'}</b></td>
      <td>${r.readiness==null?'<span class="chip gray">N/A</span>':bandChip(r.readiness)}</td>
      <td>${r.weak?`<span class="chip red">${esc(r.weak.unit)}·${esc(r.weak.cognition)}</span>`:'<span class="muted">-</span>'}</td>
      <td>${r.entered?'<span class="chip green">완료</span>':'<span class="chip amber">미입력</span>'}</td>
      <td class="muted">${r.lastCounsel?esc(fmtDate(r.lastCounsel)):'-'}</td>
    </tr>`).join('')}
    </tbody></table></div></div>`;

  const sched=`<div class="card"><h3>${svg('calendar')}다가오는 논술고사</h3>
    ${upcoming.length?upcoming.slice(0,8).map(u=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 2px;border-bottom:1px solid var(--line-2)">
      <div><b>${esc(u.name)}</b>${u.campus?` <span class="muted">(${esc(u.campus)})</span>`:''} <span class="muted" style="font-size:11.5px">${esc(fmtDate(u.exam_date))}</span></div>
      <span class="pill"><span class="dday">${ddayLabel(u.exam_date)}</span></span></div>`).join(''):'<p class="muted">등록된 고사일이 없습니다.</p>'}</div>`;

  c.innerHTML=kpi+'<div style="height:16px"></div>'+`<div class="grid2" style="grid-template-columns:1.7fr 1fr">${tbl}${sched}</div>`;
  c.querySelectorAll('tr[data-sid]').forEach(tr=>tr.addEventListener('click',()=>{app.cur.studentId=tr.dataset.sid;app.navigate('diagnosis');}));
}

export { saveReadinessSnapshots, renderDashboard };
