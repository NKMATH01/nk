/* 대시보드. 행 클릭 시 이동하는 navigate 는 순환 import 를 피하려고 app 을 경유한다. */
import { READINESS_V2_SINCE, band, computeReadiness, heatFromRecords, prescriptionJudgment, shortfallContribution } from '../calc.js';
import { COGNITIONS, UNITS } from '../config.js';
import { db, loadContext, studentBundle } from '../db.js';
import { svg } from '../icons.js';
import { app } from '../state.js';
import { readinessFormulaHTML } from '../ui.js';
import { daysUntil, ddayLabel, esc, fmtDate, r1, todayStr } from '../util.js';

/* ═══════════════════════════════════════════════════════════════════
   1) 대시보드 (올인원)
   ═══════════════════════════════════════════════════════════════════ */
/* 취약 1순위 셀. 대시보드 표와 스냅샷 meta 가 **같은 계산**을 쓰도록 한 곳에 둔다. */
function weakCellOf(records){
  const heat=heatFromRecords(records);
  const totPts=records.reduce((s,r)=>s+r.points,0)||1;
  const ptsByCell={};records.forEach(r=>{const k=r.unit+'|'+r.cognition;ptsByCell[k]=(ptsByCell[k]||0)+r.points;});
  const cells=[];
  UNITS.forEach(u=>COGNITIONS.forEach(cg=>{const h=heat[u][cg];
    if(h.rate!=null)cells.push({unit:u,cognition:cg,rate:h.rate,pointShare:(ptsByCell[u+'|'+cg]||0)/totPts});}));
  return shortfallContribution(cells)[0]||null;
}

/* 준비도 추이를 하루 1행으로 적재한다(관리자·비데모 한정).
   화면 렌더를 막지 않도록 await 하지 않으며, 실패해도 콘솔 기록만 남긴다.

   ★ readiness 컬럼에는 **신규 산식(v2)** 값을 넣는다. 구 값은 meta.readiness_legacy 로 병기한다.
     이유: 이 컬럼은 학생 리포트가 그대로 읽어 표시하는 값이다(js/views/report.js).
     화면에 보이는 숫자와 다른 값이 들어가면 추이 그래프와 현재 숫자가 어긋나고,
     "강사 화면과 학생 화면의 준비도를 같게 한다"는 4-2 의 목적 자체가 깨진다.
     구 값을 잃지 않으므로 개편 전후를 이어 볼 수 있다.

   ★ 과거 행은 **고치지 않는다.** upsert 는 (student_id, snap_date) 충돌 시에만 덮으므로
     오늘 행 외에는 어떤 날짜의 행도 건드리지 않는다. 백필도 하지 않는다 —
     지금 다시 계산하면 "그날 강사가 본 숫자"가 사라진다.
     meta.formula_version 이 없는 행이 구 산식으로 적재된 과거 행이다. */
function snapshotRows(rows){
  return rows.filter(r=>r.readiness!=null).map(r=>({
    student_id:r.st.id,snap_date:todayStr(),readiness:r1(r.readiness),
    meta:{formula_version:'v2',formula_since:READINESS_V2_SINCE,
      readiness_legacy:r.readinessLegacy==null?null:r1(r.readinessLegacy),
      diligence:r.diligence==null?null:r1(r.diligence),
      weekly_scaled:r.weeklyScaledEwma==null?null:r1(r.weeklyScaledEwma),
      last_pct:r.lastPct==null?null:r1(r.lastPct),
      weak_unit:r.weak?r.weak.unit:null,weak_cognition:r.weak?r.weak.cognition:null}}));
}
/* 오늘 이미 적재했는지. 대시보드 렌더와 아래 ensureReadinessSnapshots 가 같은 날
   두 번 돌지 않게 한다(upsert 라 중복이 생기지는 않지만 조회를 아낀다). */
let snapDone=null;
function saveReadinessSnapshots(rows){
  if(app.DEMO||app.cur.role!=='admin')return;
  const snaps=snapshotRows(rows);
  if(!snaps.length)return;
  snapDone=todayStr();
  db.upsertReadinessSnapshot(snaps).catch(e=>{snapDone=null;console.error('준비도 스냅샷 적재',e);});
}

/* 대시보드를 열지 않아도 하루 1회 적재한다(라우터가 화면 전환마다 부른다).
   ★ 왜 넓혔나: 적재가 "대시보드를 연 날"에만 돌았다. 이제 학생 리포트가 이 값을
     **읽으므로**, 강사가 대시보드를 건너뛴 날은 학생 화면이 통째로 '산출 대기'가 된다.
   비용: 오늘 이미 적재했으면 즉시 빠진다(하루 한 번만 계산). 렌더를 막지 않도록
   await 하지 않고, 실패는 콘솔에만 남긴다.
   중복: db.upsertReadinessSnapshot 이 (student_id, snap_date) upsert 라 같은 날
   여러 번 돌아도 행이 늘지 않는다(0003 의 unique 제약 = 기존 규약 그대로). */
async function ensureReadinessSnapshots(){
  if(app.DEMO||app.cur.role!=='admin')return;
  if(snapDone===todayStr())return;
  snapDone=todayStr();                       // 동시 호출로 두 번 계산되지 않게 먼저 찍는다
  try{
    const ctx=await loadContext();
    const active=ctx.students.filter(s=>s.status==='재원'||!s.status);
    const rows=[];
    for(const st of active){
      const b=await studentBundle(st.id,ctx);
      const rd=computeReadiness({weeklyPercents:b.weeklyPercents,weeklyScaled:b.weeklyScaled,
        questionRecords:b.questionRecords,essays:b.essayInputs,homeworks:b.homeworks});
      const wp=b.weeklyPercents;
      // weak 도 함께 낸다 — 어느 경로로 적재됐든 meta 의 모양이 같아야 한다
      // (api/report-draft.js 가 meta.weak_unit 을 읽는다).
      rows.push(Object.assign({st,lastPct:wp.length?wp[wp.length-1]:null,
        weak:weakCellOf(b.questionRecords)},rd));
    }
    const snaps=snapshotRows(rows);
    if(snaps.length)await db.upsertReadinessSnapshot(snaps);
  }catch(e){snapDone=null;console.error('준비도 스냅샷 적재',e);}
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
    // rd 에는 신규 산식(readiness)과 구 산식(readinessLegacy)이 함께 들어 있다.
    // 화면은 신규 값을 쓰고, 구 값은 스냅샷 meta 로만 간다(0020).
    const rd=computeReadiness({weeklyPercents:b.weeklyPercents,weeklyScaled:b.weeklyScaled,questionRecords:b.questionRecords,essays:b.essayInputs,homeworks:b.homeworks});
    const {readiness,coverage}=rd;
    // 취약 1순위
    const weak=weakCellOf(b.questionRecords);
    // 최근/직전 점수
    const wp=b.weeklyPercents;const lastPct=wp.length?wp[wp.length-1]:null;const prevPct=wp.length>1?wp[wp.length-2]:null;
    const delta=(lastPct!=null&&prevPct!=null)?lastPct-prevPct:null;
    // 이번 주 입력 여부(최근 회차에 이 학생 점수 존재?)
    let entered=false;
    if(latest){const qids=ctx.questions.filter(q=>q.session_id===latest.id).map(q=>q.id);entered=b.scores.some(s=>qids.includes(s.question_id));}
    // 목표 1지망
    const t1=ctx.targets.filter(t=>t.student_id===st.id).sort((a,b)=>a.priority-b.priority)[0];
    const uni=t1?ctx.universities.find(u=>u.id===t1.university_id):null;
    rows.push(Object.assign({st,records:b.questionRecords,scores:b.scores,lastPct,delta,weak,entered,uni,
      lastCounsel:lastCounselBy[st.id]||null},rd));
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
    ${readinessFormulaHTML()}
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
  /* 학부모 상담 요청 (관리자 전용).
     ★ 여기 안 보이면 없는 기능이다. 학부모 화면의 [상담 요청]이 도착하는 유일한 곳이라
       대시보드 위쪽에 둔다 — 요청이 쌓이는데 아무도 모르는 상태가 되면 안 된다. */
  const reqCard=app.cur.role==='admin'?await counselReqCardHTML(ctx):'';

  c.innerHTML=kpi+'<div style="height:16px"></div>'+reqCard
    +`<div class="grid2" style="grid-template-columns:1.7fr 1fr">${tbl}${sched}</div>`+ungradedCard+rxCard;
  bindCounselReqCard(c);
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

/* ── 학부모 상담 요청 카드 (관리자 전용) ──
   학부모 화면(js/views/parent.js)의 [상담 요청]이 여기로 온다.
   대기(open) 건이 없으면 카드 자체를 그리지 않는다 — 늘 비어 있는 카드는 곧 안 보게 된다.
   요청에는 **자유 텍스트가 없다**(0020). 희망 날짜 후보와 유형뿐이고, 나머지는 통화·대면에서 듣는다. */
const REQ_STATUS={open:{label:'대기',cls:'amber'},scheduled:{label:'일정 잡음',cls:'blue'},
  done:{label:'완료',cls:'green'},cancelled:{label:'취소',cls:'gray'}};
async function counselReqCardHTML(ctx){
  let reqs=[];
  try{reqs=await db.listCounselRequests(null);}catch(e){reqs=[];}
  const open=reqs.filter(r=>r.status==='open'||r.status==='scheduled');
  if(!open.length)return '';
  const nameById={};ctx.students.forEach(s=>nameById[s.id]=s.name);
  const rows=open.map(r=>{
    const m=REQ_STATUS[r.status]||REQ_STATUS.open;
    const dates=(Array.isArray(r.pref_dates)?r.pref_dates:[]).map(d=>fmtDate(d)).filter(Boolean);
    return `<tr>
      <td><b>${esc(nameById[r.student_id]||'-')}</b> <span class="muted" style="font-size:11.5px">학부모</span></td>
      <td>${esc(r.category||'-')}</td>
      <td>${dates.length?dates.map(d=>`<span class="chip gray">${esc(d)}</span>`).join(' '):'<span class="muted">희망일 없음</span>'}</td>
      <td class="muted">${esc(fmtDate(r.created_at))}</td>
      <td><span class="chip ${m.cls}">${m.label}</span></td>
      <td>${r.status==='open'?`<button class="btn line sm cr_set" data-id="${esc(r.id)}" data-st="scheduled">일정 잡음</button> `:''}
        <button class="btn line sm cr_set" data-id="${esc(r.id)}" data-st="done">완료</button></td>
    </tr>`;}).join('');
  return `<div class="card"><h3>${svg('chat')}학부모 상담 요청 <span class="sub">희망 날짜 후보와 유형만 옵니다 · 상세는 상담에서 듣습니다</span></h3>
    <div style="overflow-x:auto"><table><thead><tr>
      <th>대상</th><th>유형</th><th>희망 날짜</th><th>요청일</th><th>상태</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table></div>
    <div class="muted" style="font-size:11.5px;margin-top:6px">상태는 관리자만 바꿀 수 있습니다(학부모 계정에는 수정 권한이 없습니다).</div></div>`;
}
function bindCounselReqCard(c){
  c.querySelectorAll('.cr_set').forEach(b=>b.addEventListener('click',async ev=>{
    ev.stopPropagation();b.disabled=true;
    try{await db.updateCounselRequestStatus(b.dataset.id,b.dataset.st);await renderDashboard(c);}
    catch(e){b.disabled=false;alert('상태 변경 실패: '+(e?.message||'오류'));}
  }));
}

export { saveReadinessSnapshots, ensureReadinessSnapshots, renderDashboard };
