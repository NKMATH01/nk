/* 대시보드. 행 클릭 시 이동하는 navigate 는 순환 import 를 피하려고 app 을 경유한다. */
import { band, computeReadiness, heatFromRecords, prescriptionJudgment, shortfallContribution } from '../calc.js';
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
    const {readiness,coverage}=computeReadiness({weeklyPercents:b.weeklyPercents,weeklyScaled:b.weeklyScaled,questionRecords:b.questionRecords,essays:b.essayInputs,homeworks:b.homeworks});
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
    rows.push({st,readiness,coverage,records:b.questionRecords,scores:b.scores,lastPct,delta,weak,entered,uni,lastCounsel:lastCounselBy[st.id]||null});
  }
  saveReadinessSnapshots(rows);
  // 진행 중 처방 — 배정 이후 회차로 개선 여부 자동 판정
  const allRx=await db.listPrescriptions(null);
  const recById={};rows.forEach(r=>recById[r.st.id]=r.records);
  const nameById={};rows.forEach(r=>nameById[r.st.id]=r.st.name);
  const activeRx=allRx.filter(p=>p.status==='active');
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
      <th>학생</th><th>학년</th><th>목표(1지망)</th><th class="num">최근점수</th><th class="num">증감</th><th class="num">준비도</th><th>밴드</th><th class="num">진도 커버리지</th><th>취약 1순위</th><th>이번주</th><th>최근 상담일</th>
    </tr></thead><tbody>
    ${rows.map(r=>`<tr data-sid="${esc(r.st.id)}" style="cursor:pointer">
      <td><b>${esc(r.st.name)}</b></td><td>${esc(r.st.grade_type)}</td>
      <td>${r.uni?esc(r.uni.name):'<span class="muted">미설정</span>'}</td>
      <td class="num">${r.lastPct==null?'-':r1(r.lastPct)+'%'}</td>
      <td class="num">${deltaHTML(r.delta)}</td>
      <td class="num"><b>${r.readiness==null?'-':r1(r.readiness)+'%'}</b></td>
      <td>${r.readiness==null?'<span class="chip gray">N/A</span>':bandChip(r.readiness)}</td>
      <td class="num muted">${r.coverage==null?'-':Math.round(r.coverage)+'%'}</td>
      <td>${r.weak?`<span class="chip red">${esc(r.weak.unit)}·${esc(r.weak.cognition)}</span>`:'<span class="muted">-</span>'}</td>
      <td>${r.entered?'<span class="chip green">완료</span>':'<span class="chip amber">미입력</span>'}</td>
      <td class="muted">${r.lastCounsel?esc(fmtDate(r.lastCounsel)):'-'}</td>
    </tr>`).join('')}
    </tbody></table></div></div>`;

  const sched=`<div class="card"><h3>${svg('calendar')}다가오는 논술고사</h3>
    ${upcoming.length?upcoming.slice(0,8).map(u=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 2px;border-bottom:1px solid var(--line-2)">
      <div><b>${esc(u.name)}</b>${u.campus?` <span class="muted">(${esc(u.campus)})</span>`:''} <span class="muted" style="font-size:11.5px">${esc(fmtDate(u.exam_date))}</span></div>
      <span class="pill"><span class="dday">${ddayLabel(u.exam_date)}</span></span></div>`).join(''):'<p class="muted">등록된 고사일이 없습니다.</p>'}</div>`;

  const rxRows=activeRx.map(p=>{
    // 판정은 calc.js prescriptionJudgment 하나만 쓴다 — 화면마다 폴백을 다시 쓰면
    // 같은 처방이 대시보드와 취약 진단에서 다르게 보인다.
    const j=prescriptionJudgment(p,recById[p.student_id]||[]);
    const cur=j.recheck.rate;
    const overdue=p.due_date&&daysUntil(p.due_date)<0;
    return `<tr data-sid="${esc(p.student_id)}" style="cursor:pointer">
      <td><b>${esc(nameById[p.student_id]||'-')}</b></td>
      <td>${esc(p.unit)} · ${esc(p.cognition)}</td>
      <td class="num muted">${j.baseline==null?'-':r1(j.baseline)+'%'}</td>
      <td class="num">${cur==null?'<span class="muted">-</span>':r1(cur)+'%'}</td>
      <td><span class="chip ${j.cls}">${j.label}</span>${j.delta==null?'':` <span class="muted" style="font-size:11px">${j.delta>0?'+':''}${r1(j.delta)}%p</span>`}</td>
      <td class="muted">${p.due_date?esc(fmtDate(p.due_date))+(overdue?' <span class="chip red">기한 초과</span>':''):'-'}</td>
    </tr>`;}).join('');
  const rxCard=`<div class="card"><h3>${svg('clipboardCheck')}진행 중 처방 <span class="sub">배정 이후 실시된 주간테스트로 자동 판정 · 행 클릭 시 취약 진단으로 이동</span></h3>
    ${activeRx.length?`<div style="overflow-x:auto"><table><thead><tr>
      <th>학생</th><th>보완 대상</th><th class="num">기준선</th><th class="num">재측정</th><th>판정</th><th>기한</th>
    </tr></thead><tbody>${rxRows}</tbody></table></div>`
    :'<p class="muted">진행 중인 처방이 없습니다. [취약 진단]에서 배정하세요.</p>'}</div>`;

  /* 미채점 제출 (관리자 전용).
     학생이 답안을 올려도 강사가 그 사실을 알 방법이 없어, AI 채점이 대부분의 주에
     아예 실행되지 않았다. 새 조회는 submissions 하나뿐이고 나머지는 이미 읽어 둔
     ctx.questions·각 학생 scores 로 프런트에서 조인한다(마이그레이션 0건).
     ★ renderDashboard 에는 역할 가드가 없어 학생도 이 화면에 들어올 수 있다.
       submissions 는 전체 학생 것이므로 반드시 관리자일 때만 조회·표시한다. */
  const ungradedCard=app.cur.role==='admin'?await ungradedCardHTML(ctx,rows,nameById):'';

  c.innerHTML=kpi+'<div style="height:16px"></div>'+`<div class="grid2" style="grid-template-columns:1.7fr 1fr">${tbl}${sched}</div>`+ungradedCard+rxCard;
  c.querySelectorAll('tr[data-sid]').forEach(tr=>tr.addEventListener('click',()=>{app.cur.studentId=tr.dataset.sid;app.navigate('diagnosis');}));
  // 미채점 제출 행 → 해당 회차의 채점 그리드로. 라우팅 관례는 renderSessions 의 [문항/채점] 버튼과 같다.
  c.querySelectorAll('tr[data-goq]').forEach(tr=>tr.addEventListener('click',()=>{
    app.cur.studentId=tr.dataset.goStudent;
    app.testUI.sessionId=tr.dataset.goq;app.testUI.step=3;app.navigate('tests');}));
}

/* 미채점 제출 카드.
   대상 = submissions 중 같은 (question_id, student_id) 의 scores.earned 가 없는 것.
   태그만 붙고 점수가 없는 행(api/grade-review.js 의 tags_only 경로)도 미채점으로 본다 —
   강사가 아직 점수를 확정하지 않았다는 뜻이므로 목록에 남아 있어야 한다.
   재원 학생만 본다: rows 가 재원 학생 것이라, 그 밖의 학생은 채점 여부를 판정할 근거가 없다. */
async function ungradedCardHTML(ctx,rows,nameById){
  let subs=[];
  try{subs=await db.listSubmissions(null,null);}catch(e){subs=[];}
  const qById={};ctx.questions.forEach(q=>qById[q.id]=q);
  const sessById={};ctx.sessions.forEach(s=>sessById[s.id]=s);
  const scored={};rows.forEach(r=>(r.scores||[]).forEach(s=>{if(s.earned!=null)scored[s.question_id+'|'+s.student_id]=1;}));
  // 회차를 못 찾으면 이동할 곳이 없으므로 목록에서 뺀다(정상 데이터에서는 생기지 않는다).
  const pend=subs
    .filter(s=>nameById[s.student_id]&&qById[s.question_id]
      &&sessById[qById[s.question_id].session_id]
      &&!scored[s.question_id+'|'+s.student_id])
    .map(s=>{const q=qById[s.question_id],ss=sessById[q.session_id];
      return {sub:s,q,ss,elapsed:-(daysUntil(fmtDate(s.submitted_at))||0)};})
    .sort((a,b)=>b.elapsed-a.elapsed);   // 오래 방치된 것부터

  const body=pend.length?`<div style="overflow-x:auto"><table><thead><tr>
      <th>학생</th><th>문항</th><th>제출일</th><th class="num">경과</th>
    </tr></thead><tbody>
    ${pend.slice(0,20).map(p=>`<tr data-goq="${esc(p.ss.id)}" data-go-student="${esc(p.sub.student_id)}" style="cursor:pointer">
      <td><b>${esc(nameById[p.sub.student_id])}</b></td>
      <td>${esc(p.ss.week_no)}주차 ${esc(p.q.no)}번 <span class="muted">${esc(p.q.unit||'')}</span></td>
      <td class="muted">${esc(fmtDate(p.sub.submitted_at))}</td>
      <td class="num"><span class="chip ${p.elapsed>=7?'red':(p.elapsed>=3?'amber':'gray')}">${p.elapsed}일</span></td>
    </tr>`).join('')}
    </tbody></table></div>${pend.length>20?`<p class="muted" style="font-size:11.5px;margin-top:6px">외 ${pend.length-20}건</p>`:''}`
    :'<p class="muted">미채점 제출이 없습니다.</p>';
  return `<div class="card"><h3>${svg('clock')}미채점 제출 <span class="sub">학생이 올린 답안 중 아직 점수가 확정되지 않은 것 · 행 클릭 시 채점 그리드로 이동</span></h3>${body}</div>`;
}

export { saveReadinessSnapshots, renderDashboard };
