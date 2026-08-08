/* 학부모 화면 (모바일 단일 스크롤) */
import { doLogout } from '../auth.js';
import { hwAccuracyAvg, hwTimeAvg, prescriptionJudgment } from '../calc.js';
import { UNITS } from '../config.js';
import { db, loadContext, studentBundle } from '../db.js';
import { app } from '../state.js';
import { bindDemoSwitch, demoSwitchHTML, destroyCharts } from '../ui.js';
import { $, ddayLabel, esc, fmtDate, r1, todayStr } from '../util.js';

/* ═══════════════════════════════════════════════════════════════════
   학부모 화면 (모바일 단일 스크롤)

   ★★ 이 화면에 **절대 넣지 않는 것** — 지우고 싶어질 때 이 목록을 먼저 읽을 것 ★★

   · 합격 가능성 밴드(admitBand)
       학원이 준 숫자는 약속으로 읽힌다. 재원 8명 규모에서 밴드의 근거 표본은
       사실상 0이고, 불합격했을 때 "적정이라고 하셨잖아요"가 분쟁이 된다.
   · 준비도 %
       coverage(진도 커버리지)가 낮으면 그 학생의 준비도는 뻥튀기된다 —
       아직 안 배운 단원이 분모에 없기 때문이다. 지금 이 화면에 없는 것이 옳다.
   · 반평균 · 순위
       8명이면 두세 주치 숫자로 다른 아이들의 점수가 역산된다.
   · 24셀 히트맵 · 오답 원인 상세
       빨간 칸이 7개면 식탁에서 그 얘기를 7번 하게 되고, 학생은 그 단원을
       더 안 하게 된다. (단원별 정답률 6줄은 종전부터 있던 것이라 유지한다)
   · 상담 전사문(transcript) · ai_draft · 미확정 AI 판단
       확정 전 문장은 강사의 판단이 아니다. db.listParentCounseling 은 컬럼
       화이트리스트(js/db.js COUNSEL_SAFE_COLS)로 이들을 아예 받지 않는다.
   · 답안 원본 사진
       "여기 왜 감점이죠"가 문항 단위로 온다. 8명을 혼자 보는 지금은 감당 못 한다.
   ═══════════════════════════════════════════════════════════════════ */

/* 상담 요청 유형. **자유 텍스트 입력을 두지 않는다** — 긴 질문에는 긴 답을 해야 하고
   그게 밤 11시에 온다. 유형과 희망 날짜만 받고 나머지는 실제 상담에서 말로 듣는다. */
const COUNSEL_REQ_CATS=['학습 상태','진로·지원 전략','과제·생활 습관','기타'];
const REQ_STATUS_LABEL={open:'접수됨',scheduled:'일정 조율 중',done:'상담 완료',cancelled:'취소됨'};
// 희망 날짜 후보 3개. 오늘 기준 앞으로 3주에서 고르게 한다(그 이상은 정해도 바뀐다).
function prefDateChoices(){
  const out=[];const base=new Date(todayStr()+'T00:00:00');
  for(let i=3;i<=21;i++){
    const d=new Date(base.getTime()+i*86400000);
    out.push(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'));
  }
  return out;
}
async function renderParent(){
  $('loginView').style.display='none';$('appView').style.display='none';
  $('parentView').style.display='block';
  $('pTop').innerHTML=app.DEMO?demoSwitchHTML('parent'):`<button class="btn sm line p-logout" id="pLogout">로그아웃</button>`;
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

  /* ── A/B/C 블록의 원천 (강사 입력 노동 0 — 전부 이미 쌓여 있는 데이터) ──
     RLS 확인:
       prescriptions      0008 stu_self (student_id = app_student_id())
       parent_ack         0020 stu_self / stu_insert
       counsel_requests   0020 stu_self / stu_insert
       counseling_notes   0006 stu_self (visible_to_student=true 인 행만)
     학부모 토큰도 student_id 클레임을 담으므로 전부 그대로 통과한다. */
  const rxAll=await db.listPrescriptions(sid);
  const rxActive=rxAll.filter(p=>p.status==='active');
  // 지난 처방 = 종료됐거나 판정이 확정된 것. 취소는 결과가 아니므로 뺀다.
  const rxPast=rxAll.filter(p=>p.status!=='cancelled'&&(p.status!=='active'||p.result)).slice(0,5);
  const acks=await db.listParentAcks(sid);
  const acked=acks.find(a=>a.week_no===selWeek)||null;
  const myReqs=await db.listCounselRequests(sid);
  const openReq=myReqs.find(r=>r.status==='open'||r.status==='scheduled')||null;
  const pCounsel=await db.listParentCounseling(sid);

  wrap.innerHTML=`
    <div class="p-card"><div class="split">
      <div><div class="p-eyebrow">주간 리포트</div><h2 class="p-name">${esc(st.name)}</h2><div class="p-sub">${esc(st.grade_type)} · ${esc(st.school||'')}</div></div>
      <select id="pWeek" class="p-week">${weeks.map(w=>`<option value="${w}" ${w===selWeek?'selected':''}>${w}주차</option>`).join('')||'<option>-</option>'}</select>
    </div></div>
    <div class="p-card"><div class="p-kpi">
      <div class="b"><div class="l">회차 점수</div><div class="v">${curPct==null?'-':r1(curPct)+'%'}</div></div>
      <div class="b"><div class="l">직전 대비</div><div class="v">${delta==null?'-':(delta>=0?'+':'')+r1(delta)+'%p'}</div></div>
      <div class="b"><div class="l">과제 정답률</div><div class="v">${hwAcc==null?'-':r1(hwAcc)+'%'}</div></div>
      <div class="b"><div class="l">과제 풀이시간</div><div class="v">${hwTime==null?'-':r1(hwTime)+'<span class="u">분/회</span>'}</div></div>
    </div></div>
    <div class="p-card"><h3>주간 점수 추이</h3><canvas id="pLine" height="150"></canvas></div>
    <div class="p-card"><h3>단원별 정답률</h3>
      ${UNITS.map(u=>{const a=unitAgg[u];const p=a.p>0?Math.round(a.e/a.p*100):null;
        return `<div class="hbar-row"><span>${esc(u)}</span><div class="bar-track"><div class="bar-fill" style="width:${p||0}%;background:${p==null?'#ccc':(p<40?'var(--red)':p<70?'var(--amber)':'var(--green)')}"></div></div><span class="num">${p==null?'-':p+'%'}</span></div>`;}).join('')}</div>
    <div class="p-card"><h3>강사 코멘트</h3>
      <div class="prose muted">${comment?esc(comment.comment):'등록된 코멘트가 없습니다.'}</div></div>
    ${blockA(rxActive)}
    ${blockB(rxPast,b.questionRecords)}
    ${blockParentCounsel(pCounsel)}
    ${blockC(selWeek,acked,openReq)}
    <div class="p-card"><h3>목표 대학 · D-day</h3>
      ${targets.length?targets.map(t=>{const u=ctx.universities.find(x=>x.id===t.university_id);if(!u)return '';
        return `<div class="split list-row"><span>${t.priority}지망 <b>${esc(u.name)}</b></span>${u.exam_date?`<span class="pill"><span class="dday">${ddayLabel(u.exam_date)}</span></span>`:'<span class="muted">미정</span>'}</div>`;}).join(''):'<p class="muted">등록된 목표 대학이 없습니다.</p>'}</div>
    <div class="p-card note-blue">본 리포트는 학습 관리용 참고 자료이며 합격을 보장하지 않습니다.</div>`;
  $('pWeek')?.addEventListener('change',e=>{app.state.reportWeek=Number(e.target.value);renderParent();});
  bindParentActions(sid,selWeek);
  if(typeof Chart!=='undefined'&&wp.length){destroyCharts();
    app.state.charts.push(new Chart($('pLine').getContext('2d'),{type:'line',
      data:{labels:weeks.map(w=>w+'주'),datasets:[{data:wp,borderColor:'#E8B54D',backgroundColor:'rgba(232,181,77,.15)',borderWidth:3,tension:.3,pointRadius:4,fill:true}]},
      options:{responsive:true,maintainAspectRatio:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,max:100}}}}));}
}

/* ── A. 지금 하고 있는 것 ──
   "올랐네/떨어졌네"만 있던 화면에 **지금 무엇을 하고 있는지**를 넣는다.
   떨어진 주에 전화가 오는 이유는 결과만 보이고 조치가 안 보이기 때문이다.
   진행 중 처방은 이미 강사가 취약 진단에서 배정한 것이라 추가 입력이 0이다.
   ★ 정답률·기준선 숫자는 여기 넣지 않는다 — 진행 중인 것은 아직 결과가 아니다. */
function blockA(rxActive){
  const body=rxActive.length
    ?rxActive.map(p=>`<div class="list-row">
        <b>${esc(p.unit||'')}${p.cognition?' · '+esc(p.cognition):''}</b>
        ${p.error_type?` <span class="pill">${esc(p.error_type)}</span>`:''}
        ${p.note?`<div class="rx-note">${esc(p.note)}</div>`:''}
        ${p.due_date?`<div class="card-cap tight">기한 ${esc(fmtDate(p.due_date))}</div>`:''}
      </div>`).join('')
    :'<p class="p-empty">현재 배정된 보완 과제가 없습니다.</p>';
  return `<div class="p-card"><h3>지금 하고 있는 것</h3>${body}</div>`;
}

/* ── B. 지난 처방 결과 ──
   "기준 38% → 재측정 61% ✅ 개선". 학원이 말로만 하지 않고 **시험으로 확인하고 있다**는 증거다.
   ★ 판정은 calc.js prescriptionJudgment 하나만 쓴다(강사 화면과 같은 숫자여야 한다).
   ★ 표본 부족·재측정 대기를 **숨기지 않는다.** 좋은 것만 보이면 그다음부터 전부
     광고로 읽힌다. 판정하지 않기로 한 건은 판정하지 않았다고 적는다. */
function blockB(rxPast,records){
  if(!rxPast.length)return '';
  const rows=rxPast.map(p=>{
    const j=prescriptionJudgment(p,records);
    const cur=j.recheck?j.recheck.rate:null;
    const arrow=(j.baseline!=null&&cur!=null)
      ?`기준 ${r1(j.baseline)}% → 재측정 ${r1(cur)}%`
      :(j.baseline!=null?`기준 ${r1(j.baseline)}%`:'기준값 없음');
    return `<div class="list-row">
      <div><b>${esc(p.unit||'')}${p.cognition?' · '+esc(p.cognition):''}</b> <span class="chip ${j.cls}">${esc(j.label)}</span></div>
      <div class="rx-note">${esc(arrow)}${j.delta==null?'':` (${j.delta>0?'+':''}${r1(j.delta)}%p)`}</div>
      ${j.key==='insufficient'?'<div class="card-cap tight">재측정 문항이 아직 적어 판정하지 않았습니다.</div>':''}
      ${j.key==='pending'?'<div class="card-cap tight">아직 재측정 회차가 실시되지 않았습니다.</div>':''}
    </div>`;}).join('');
  return `<div class="p-card"><h3>지난 보완 과제 결과</h3>${rows}
    <div class="card-cap">보완 과제를 배정한 뒤 실시된 주간테스트에서 같은 유형의 문항만 다시 모아 비교한 값입니다.</div></div>`;
}

/* 학부모 상담 기록 — 강사가 [학생에게 공개]로 표시한 '학부모상담' 건만.
   지금까지 학부모는 자기 상담 기록조차 볼 수 없었다.
   ★ 컬럼은 학생 경로와 같은 화이트리스트를 쓴다(js/db.js listParentCounseling).
     transcript·ai_draft·audio_path 는 조회 자체를 하지 않는다. */
function blockParentCounsel(notes){
  if(!notes||!notes.length)return '';
  const rows=notes.slice(0,5).map(n=>`<div class="list-row">
      <div class="card-cap tight">${esc(fmtDate(n.note_date))}</div>
      <div class="prose">${esc(n.content)}</div>
      ${n.follow_up?`<div class="card-cap tight"><b>후속</b> · ${esc(n.follow_up)}</div>`:''}
    </div>`).join('');
  return `<div class="p-card"><h3>상담 기록</h3>${rows}</div>`;
}

/* ── C. 개입 2개 ──
   확인 버튼과 상담 요청. 둘 다 학부모의 입력을 최소로 두고, 강사가 받는 것도 최소로 둔다. */
function blockC(selWeek,acked,openReq){
  // 미리보기(원장이 학부모 화면을 열어 본 상태)에서는 쓰기 버튼을 잠근다 —
  // 여기서 누르면 **진짜 학부모 확인 기록·상담 요청**이 만들어진다(db.js 에서도 한 번 더 막는다).
  const pv=!!app.preview;
  const pvNote='<div class="card-cap">미리보기에서는 저장되지 않습니다.</div>';
  const ackBox=selWeek==null?''
    :acked
      ?`<div class="pill">${selWeek}주차 리포트 확인함 · ${esc(fmtDate(acked.acked_at))}</div>`
      :`<button class="btn" id="pAck" ${pv?'disabled':''}>${selWeek}주차 리포트 확인했습니다</button>
         ${pv?pvNote:'<div class="card-cap">확인하셨다는 표시만 남습니다. 답장이 필요하지 않습니다.</div>'}`;
  const reqBox=openReq
    ?`<div class="pill">상담 요청 ${esc(REQ_STATUS_LABEL[openReq.status]||'접수됨')}</div>
       <div class="card-cap">희망일 ${
         (Array.isArray(openReq.pref_dates)?openReq.pref_dates:[]).map(d=>esc(fmtDate(d))).join(' / ')||'미지정'} · 원장이 확인 후 연락드립니다.</div>`
    :`<div class="field"><label>상담 유형</label>
        <select id="pReqCat" ${pv?'disabled':''}>${COUNSEL_REQ_CATS.map(k=>`<option>${esc(k)}</option>`).join('')}</select></div>
      <div class="field"><label>희망 날짜 (최대 3개)</label>
        ${[0,1,2].map(i=>`<select class="pReqDate" data-i="${i}" ${pv?'disabled':''}>
            <option value="">선택 안 함</option>${prefDateChoices().map(d=>`<option value="${esc(d)}">${esc(d)}</option>`).join('')}</select>`).join('')}</div>
      <button class="btn" id="pReqGo" ${pv?'disabled':''}>상담 요청 보내기</button>
      ${pv?pvNote:'<div class="card-cap">희망 날짜와 유형만 보냅니다. 자세한 이야기는 상담 때 직접 나눕니다.</div>'}`;
  return `<div class="p-card"><h3>확인 · 상담 요청</h3>
    <div class="p-act">${ackBox}</div>
    <div class="p-act-sep">${reqBox}</div>
    <div id="pActMsg" class="msg"></div></div>`;
}

function bindParentActions(sid,selWeek){
  $('pAck')?.addEventListener('click',async()=>{
    const btn=$('pAck');btn.disabled=true;
    try{await db.ackParent(sid,selWeek);await renderParent();}
    catch(e){btn.disabled=false;const m=$('pActMsg');if(m){m.className='msg err';m.textContent='실패: '+(e?.message||'오류');}}
  });
  $('pReqGo')?.addEventListener('click',async()=>{
    const m=$('pActMsg');if(m){m.className='msg';m.textContent='';}
    const dates=[...document.querySelectorAll('.pReqDate')].map(s=>s.value).filter(Boolean);
    const uniq=[...new Set(dates)];
    if(!uniq.length){if(m){m.className='msg err';m.textContent='희망 날짜를 하나 이상 골라 주세요.';}return;}
    const btn=$('pReqGo');btn.disabled=true;
    try{
      await db.insertCounselRequest({student_id:sid,pref_dates:uniq,category:$('pReqCat').value,status:'open'});
      await renderParent();
    }catch(e){btn.disabled=false;if(m){m.className='msg err';m.textContent='실패: '+(e?.message||'오류');}}
  });
}

export { renderParent };
