/* 취약 진단 */
import { cellPooledRecent, errorAxisFromRecords, hasEnoughSample, heatFromRecords, prescriptionJudgment,
         pointShareFromRecords, RECHECK_MIN_POINTS, SAMPLE_GATE, scoreTags, shortfallContribution } from '../calc.js';
import { COGNITIONS, TODAY, UNITS, WRONG_REASONS } from '../config.js';
import { db, loadContext, studentBundle } from '../db.js';
import { svg } from '../icons.js';
import { app } from '../state.js';
import { bindStudentSelector, studentSelector } from '../ui.js';
import { esc, fmtDate, pad, r1, todayStr } from '../util.js';

/* TODAY(자정 고정) 기준 오프셋 날짜. util.todayStr() 과 같은 기준을 쓴다. */
function dayStr(offset){
  const d=new Date(TODAY);d.setDate(d.getDate()+(offset||0));
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
}
const RECHECK_DEFAULT_DAYS=14;   // 재측정 기본 구간 2주. 주간테스트 2회가 들어간다.

/* ═══════════════════════════════════════════════════════════════════
   4) 취약 진단
   ═══════════════════════════════════════════════════════════════════ */
async function renderDiagnosis(c){
  c.innerHTML=await studentSelector()+'<p class="muted">불러오는 중...</p>';bindStudentSelector(()=>renderDiagnosis(c));
  const sid=app.cur.studentId;if(!sid){c.querySelector('p').textContent='학생을 선택하세요.';return;}
  const ctx=await loadContext();const b=await studentBundle(sid,ctx);
  const heat=heatFromRecords(b.questionRecords);
  /* 실점 기여도. pointShare 의 시간창을 rate(최근 3회 가중)와 맞춘다 —
     전 기간으로 재면 예전에 많이 출제됐다가 최근 안 나오는 셀이 과대평가된다. */
  const shares=pointShareFromRecords(b.questionRecords,3);
  const cells=[];UNITS.forEach(u=>COGNITIONS.forEach(cg=>{const h=heat[u][cg];
    if(h.rate!=null)cells.push({unit:u,cognition:cg,rate:h.rate,n:h.n,points:h.points,sessions:h.sessions,pointShare:shares[u+'|'+cg]||0});}));
  /* 표본 게이트 미달 셀은 순위에서 뺀다. 문항 1개를 틀려 rate=0 이 된 셀이
     1순위로 올라가면 그 0% 가 처방 기준선으로 박제된다.
     **히트맵에서는 지우지 않고 회색으로 남긴다**(값 자체는 그대로다). */
  const ranked=shortfallContribution(cells.filter(hasEnoughSample)).slice(0,3);

  /* ── 오류유형 축(주 진단) ── 최근 4회 회차 구간. 회차가 적으면 있는 만큼만 본다. */
  const AXIS_SESSIONS=4;
  const axisDates=[...new Set(b.questionRecords.map(r=>r.date).filter(Boolean))].sort().slice(-AXIS_SESSIONS);
  const axisSince=axisDates.length?axisDates[0]:null;
  const axisSpan=axisDates.length?`최근 ${axisDates.length}주`:'전체 기간';
  const axis=errorAxisFromRecords(b.questionRecords,b.essays,{sinceDate:axisSince});
  // 셀별 최다 오답원인(태그 다중 보존 이후에도 셀 요약은 "가장 자주 나온 하나"다)
  const cellReason={};b.questionRecords.forEach(r=>{const k=r.unit+'|'+r.cognition;
    scoreTags(r).forEach(t=>{(cellReason[k]=cellReason[k]||{});cellReason[k][t]=(cellReason[k][t]||0)+1;});});
  const topReasonOf=(u,cg)=>{const m=cellReason[u+'|'+cg];if(!m)return null;return Object.entries(m).sort((a,b)=>b[1]-a[1])[0][0];};

  const gateText=`문항 ${SAMPLE_GATE.n}개 · 배점 ${SAMPLE_GATE.points}점 · 서로 다른 회차 ${SAMPLE_GATE.sessions}개`;
  const heatTable=`<div class="tbl-wrap"><table class="heat"><thead><tr><th class="unit">단원 \\ 사고</th>${COGNITIONS.map(cg=>`<th>${esc(cg)}</th>`).join('')}</tr></thead><tbody>
    ${UNITS.map(u=>`<tr><th class="unit">${esc(u)}</th>${COGNITIONS.map(cg=>{const h=heat[u][cg];
      if(h.rate==null)return '<td class="cell none">-</td>';
      // 표본 미달은 숨기지 않는다 — 데이터가 없다는 사실 자체가 다음 출제에 주는 정보다.
      if(!hasEnoughSample(h))return `<td class="cell none thin" title="표본 부족 — 문항 ${h.n}개 · 배점 ${r1(h.points)}점 · ${h.sessions}개 회차 (기준 ${esc(gateText)}). 정답률 ${r1(h.rate)}% 는 참고값이며 우선 보완 순위에서 제외됩니다.">표본 ${h.n}문항</td>`;
      const cls=h.rate<40?'weak':(h.rate<70?'mid':'master');
      return `<td class="cell ${cls}" title="문항 ${h.n}개 · ${h.sessions}개 회차 · 최근3회 가중 정답률 ${r1(h.rate)}%">${Math.round(h.rate)}%</td>`;}).join('')}</tr>`).join('')}
    </tbody></table></div>`;

  const isAdmin=app.cur.role==='admin';
  /* 1순위 강조는 **색·굵기·테두리**로만 준다(.rank-card.top).
     종전에는 1순위에만 .card 를 달아 여백이 두 배가 됐고, 카드 높이가 2순위의 두 배였다.
     위계는 유지하되 크기 차이는 없앤다 — 여백만 큰 카드는 정보가 아니라 소음이다. */
  const rankCards=ranked.length?ranked.map((r,i)=>{const tr=topReasonOf(r.unit,r.cognition);
    return `<div class="rank-card${i===0?' top':''}">
      <div class="split wrap">
        <div><span class="chip red">${i+1}순위</span> <b class="rank-name">${esc(r.unit)} · ${esc(r.cognition)}</b></div>
        <div class="rank-meta">정답률 ${Math.round(r.rate)}% · 실점기여 ${(r.contrib*100).toFixed(1)}</div></div>
      ${tr?`<div class="rank-reason">최다 오답원인: <span class="chip amber">${esc(tr)}</span></div>`:''}
      ${isAdmin?`<div class="act-stack"><button class="btn line sm rx_open" data-unit="${esc(r.unit)}" data-cog="${esc(r.cognition)}" data-rate="${esc(r1(r.rate))}" data-error="${esc(tr||'')}">${svg('clipboardCheck','xs')}처방 배정</button>
        <div class="rx_form panel sunken fold"></div></div>`:''}
    </div>`;}).join('')
    /* 초기에는 순위가 비거나 1~2개만 뜬다. 그게 옳다 — 없는 근거로 순위를 만들지 않는다.
       빈 자리에는 오류유형 축을 가리킨다(5축은 표본이 훨씬 빨리 찬다). */
    :(cells.length
      ?`<p class="muted">표본 기준(${esc(gateText)})을 채운 셀이 아직 없습니다. 회차가 쌓이면 순위가 나타납니다. 그때까지는 위 <b>오류유형 진단</b>을 기준으로 보완하세요.</p>`
      :'<p class="muted">진단할 채점 데이터가 없습니다.</p>');

  /* 현재 학생의 처방 목록(관리자·학생 모두 표시).
     실행 로그는 양쪽 다 읽는다 — 강사 화면에서 판정과 **나란히** 보여야
     "6일 했는데 정답률이 그대로"(= 처방이 틀렸다)를 읽어낼 수 있다.
     문제은행은 관리자만 읽힌다(0009 RLS). 학생 경로에서는 아예 호출하지 않는다. */
  const [rxList,rxLogs,problems]=await Promise.all([
    db.listPrescriptions(sid), db.listPrescriptionLogs(sid),
    isAdmin?db.listProblems():Promise.resolve([])]);
  recordPrescriptionResults(rxList,b.questionRecords);
  const rxCard=rxCardHTML(rxList,b.questionRecords,rxLogs,isAdmin);

  /* 오류유형 축 카드. 비율이 아니라 **손실 점수**로 쓴다 —
     "조건 해석 34%" 는 다음 행동이 안 나오지만 "28점 손실" 은 나온다.
     표본이 없을 때의 안내는 역할마다 다르다 — 학생에게 없는 화면([주간테스트])을 안내하면 안 된다. */
  const noAxisMsg=isAdmin
    ?'<p class="muted">집계할 오류유형이 없습니다. [주간테스트] 채점 그리드의 태그 버튼(🏷)과 [첨삭 관리]의 문항별 채점기준이 쌓이면 자동으로 표시됩니다.</p>'
    :'<p class="muted">아직 집계된 오류유형이 없습니다. 주간테스트 채점과 첨삭이 끝나면 여기에 표시됩니다.</p>';
  const axisHead=axis.length
    ?`<div class="axis-head">${esc(axis[0].tag)} <span>— ${esc(axisSpan)} ${r1(axis[0].lostPoints)}점 손실</span></div>`
    :'';
  const axisBars=axis.length?axis.map(a=>`<div class="hbar-row" title="주간테스트 ${r1(a.sources.test)}점 · 첨삭 ${r1(a.sources.essay)}점 · 관측 ${a.n}건">
      <span>${esc(a.tag)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.round(a.share*100)}%;background:var(--red)"></div></div>
      <span class="num">${r1(a.lostPoints)}점</span></div>`).join(''):noAxisMsg;
  // 집계에서 뺀 것을 숨기지 않는다.
  const axisNotes=[
    axis.skippedLegacyEssays?`구형 첨삭 ${axis.skippedLegacyEssays}건은 채점기준별 기록이 없어 제외했습니다.`:'',
    axis.untaggedLostPoints>0?`태그가 없는 주간테스트 실점 ${r1(axis.untaggedLostPoints)}점은 원인을 알 수 없어 제외했습니다.`:'',
  ].filter(Boolean).join(' ');

  /* 캡션 원칙:
       · **강사가 오해하면 안 되는 사실**(자동 집계다 / AI 판단이 아니다, 집계에서 뺀 것)은
         접지 않고 그대로 보인다.
       · 계산 방법·부연만 <details class="cap-more"> 로 접는다.
     문구를 짧게 다듬되 사실관계는 하나도 빼지 않는다. */
  c.innerHTML=await studentSelector()+`
    <div class="card"><h3>${svg('target')}오류유형 진단 <span class="sub">${esc(axisSpan)} · 흘린 점수 기준</span></h3>
      ${axisHead}${axisBars}
      <p class="card-cap">주간테스트 오답원인 태그와 첨삭 채점기준에서 잃은 점수를 합산한 <b>자동 집계</b>입니다 — AI 판단이 아닙니다.${axisNotes?'<br>'+esc(axisNotes):''}</p>
      <details class="cap-more"><summary>집계 방법</summary>
        <div>첨삭은 채점기준별 O/△/X 기록에서 잃은 점수를 씁니다. 한 문항에 태그가 여럿이면 실점을 균등 분배합니다.</div></details></div>
    <div class="card"><h3>${svg('target')}우선 보완 순위 <span class="sub">표본 ${esc(gateText)} 이상인 셀만</span></h3>${rankCards}</div>
    <div class="card"><h3>${svg('activity')}단원 × 사고과정 히트맵 <span class="sub">보조 지표 · 최근 3회 가중(50/30/20%)</span></h3>${heatTable}
      <p class="card-cap">색상 <span class="chip red">빨강 &lt;40</span> <span class="chip amber">주황 40~70</span> <span class="chip green">초록 ≥70</span> · 회색 <b>표본 N문항</b> 은 표본이 얇아 순위에서 제외한 셀입니다(정답률은 계산돼 있으며 셀에 마우스를 올리면 보입니다).</p>
      <details class="cap-more"><summary>계산 기준</summary>
        <div>득점/배점 기반이며 최근 3회에 50/30/20% 가중을 둡니다.</div></details></div>
    ${rxCard}`;
  bindStudentSelector(()=>renderDiagnosis(c));

  // 처방 배정 폼 — 우선 보완 순위 카드와 처방 카드([후속 처방 배정])가 같은 폼을 쓴다.
  const openForm=btn=>{
    const wrap=btn.parentElement.querySelector('.rx_form');
    if(wrap.style.display==='block'){wrap.style.display='none';return;}
    wrap.style.display='block';
    const target={unit:btn.dataset.unit,cognition:btn.dataset.cog,
      rate:btn.dataset.rate===''||btn.dataset.rate==null?null:Number(btn.dataset.rate),
      errorType:btn.dataset.error||'',prevId:btn.dataset.prev||null};
    mountRxForm(wrap,target,sid,b.questionRecords,problems,()=>renderDiagnosis(c));
  };
  c.querySelectorAll('.rx_open').forEach(btn=>btn.addEventListener('click',()=>openForm(btn)));
  // 처방 완료/취소 — **강사 전용**이다. 학생 화면에는 이 버튼이 렌더되지 않는다.
  c.querySelectorAll('.rx_status').forEach(btn=>btn.addEventListener('click',async()=>{
    try{await db.updatePrescriptionStatus(btn.dataset.id,btn.dataset.to);renderDiagnosis(c);}
    catch(e){alert('실패: '+(e?.message||'오류'));}
  }));
  /* 학생 [다 했어요] — 쓰는 곳은 prescription_logs 뿐이다.
     prescriptions.status 는 건드리지 않는다(강사의 작업 목록이 학생 클릭으로 사라지면 안 된다). */
  c.querySelectorAll('.rx_done').forEach(btn=>btn.addEventListener('click',async()=>{
    btn.disabled=true;
    try{await db.insertPrescriptionLog({prescription_id:btn.dataset.id,student_id:sid,log_date:todayStr()});
      renderDiagnosis(c);}
    catch(e){btn.disabled=false;alert('기록하지 못했습니다: '+(e?.message||'오류'));}
  }));
}

/* ── 재측정 판정 영구 저장 ──
   recheck_after 가 지나고 판정이 확정되면 딱 한 번 기록한다. 이후에는 저장값을 읽으므로
   데이터가 더 쌓여도 그때 내린 판정이 흔들리지 않는다.

   기록하지 않는 경우
     · 이미 result 가 있다            → 멱등. 절대 덮지 않는다(db 쪽에서도 .is('result',null) 로 한 번 더 막는다)
     · recheck_after 가 없다(과거 처방) → 재측정 구간이 확정된 적이 없다. 종전처럼 매번 계산만 한다
     · 아직 recheck_after 이전이다      → 구간이 끝나지 않았다
     · 판정이 대기·표본 부족이다        → 판정이 아니다. 기록하면 "판정했다"는 거짓이 남는다
   화면 렌더 중 조용히 도는 저장이라 await 하지 않고 실패해도 화면을 깨뜨리지 않는다
   (dashboard.js saveReadinessSnapshots 관례). 실패하면 다음 렌더에서 다시 시도된다. */
function recordPrescriptionResults(list,records){
  if(app.DEMO||app.cur.role!=='admin')return;
  const today=todayStr();
  (list||[]).forEach(p=>{
    if(!p||p.result)return;
    if(!p.recheck_after||today<String(p.recheck_after).slice(0,10))return;
    const j=prescriptionJudgment(p,records);
    if(j.key!=='improved'&&j.key!=='flat'&&j.key!=='worse')return;
    db.recordPrescriptionResult(p.id,j.key,j.delta==null?null:r1(j.delta))
      .catch(e=>console.error('처방 판정 저장',e));
  });
}

/* ── 배정 폼 ──
   자유 텍스트를 짜내는 자리에서 **고르는 자리**로 바꾼다. 표적(단원×사고과정 +
   오류유형)으로 문제은행을 자동 필터해 체크박스로 제시하고, note 는 보조로 내린다. */
function problemMatchesError(p,err){
  if(!err)return false;
  if((p.tags||[]).includes(err))return true;
  return (p.rubric||[]).some(r=>r&&r.tag===err);
}
function rxCandidates(problems,target){
  return (problems||[])
    .filter(p=>p&&p.status==='published'&&p.unit===target.unit&&p.cognition===target.cognition)
    // 오류유형이 일치하는 문항을 위로. 같으면 쉬운 것부터(보완 과제는 다시 틀리라고 내는 게 아니다).
    .map(p=>Object.assign({},p,{errMatch:problemMatchesError(p,target.errorType)?1:0}))
    .sort((a,b)=>(b.errMatch-a.errMatch)||((a.difficulty||9)-(b.difficulty||9)));
}
function mountRxForm(wrap,target,sid,records,problems,refresh){
  /* 기준선은 재측정과 **같은 자**로 잰다(단순 배점 풀링, 최근 3회 구간).
     기존 baseline_rate(최근 3회 가중)도 함께 저장한다 — 강사가 배정 시점에 본 숫자다. */
  const pooled=cellPooledRecent(records,target.unit,target.cognition,3);
  const thin=pooled.points>0&&pooled.points<RECHECK_MIN_POINTS;
  wrap.innerHTML=`
    <div class="form-ttl">${esc(target.unit)} · ${esc(target.cognition)}
      ${target.prevId?'<span class="chip purple">후속 처방</span>':''}</div>
    <div class="row">
      <div class="field field-inline"><label>오류유형 표적</label>
        <select class="rx_err"><option value="">지정 안 함</option>${WRONG_REASONS.map(w=>`<option ${w===target.errorType?'selected':''}>${esc(w)}</option>`).join('')}</select></div>
      <div class="field field-inline"><label>완료 기한</label><input type="date" class="rx_due"></div>
      <div class="field field-inline"><label>재측정 시점</label><input type="date" class="rx_recheck" value="${esc(dayStr(RECHECK_DEFAULT_DAYS))}"></div>
    </div>
    <div class="field"><label>배정 문항 <span class="lbl-hint">공개(published) 상태인 같은 단원×사고과정 문항</span></label>
      <div class="rx_probs"></div></div>
    <div class="field" style="max-width:160px"><label>분량(문항 수)</label>
      <input type="number" class="rx_count" min="1" step="1" placeholder="선택 문항 수"></div>
    <div class="field"><label>메모 <span class="lbl-hint">선택</span></label>
      <textarea class="rx_note" rows="2" placeholder="예: 조건 도식화부터 쓰고 풀 것"></textarea></div>
    <div class="card-cap tight">
      기준선 <b>${pooled.rate==null?'표본 없음':r1(pooled.rate)+'%'}</b>
      <span title="재측정(cellRateSince)과 같은 단순 배점 풀링으로 잰 값입니다. 히트맵의 최근 3회 가중값(${target.rate==null?'-':esc(r1(target.rate))}%)과는 자가 다릅니다.">(재측정과 같은 자 · 표본 ${pooled.n}문항 ${r1(pooled.points)}점)</span>
      ${thin?`<span class="chip amber">기준선 표본 ${r1(pooled.points)}점</span> 재측정 배점이 ${RECHECK_MIN_POINTS}점 미만이면 판정하지 않고 표본 부족으로 표시됩니다.`:''}</div>
    <div class="act-row"><button class="btn sm rx_save">배정</button> <button class="btn line sm rx_cancel">취소</button></div>
    <div class="rx_msg msg"></div>`;

  const box=wrap.querySelector('.rx_probs');
  const errSel=wrap.querySelector('.rx_err');
  const drawProblems=()=>{
    const picked=new Set([...box.querySelectorAll('.rx_pid:checked')].map(i=>i.value));
    const list=rxCandidates(problems,{unit:target.unit,cognition:target.cognition,errorType:errSel.value});
    /* 후보가 0건이어도 기능을 막지 않는다 — 문제은행이 비어 있는 것은 강사 잘못이 아니고,
       그 때문에 처방을 못 내리면 진단이 다시 관찰로 되돌아간다. note 만으로 배정할 수 있다. */
    box.innerHTML=list.length?list.map(p=>`<label class="pick-row">
        <input type="checkbox" class="rx_pid" value="${esc(p.id)}" ${picked.has(p.id)?'checked':''}>
        ${p.errMatch?'<span class="chip amber">오류유형 일치</span> ':''}<span class="muted">난이도 ${p.difficulty==null?'-':esc(p.difficulty)} · 배점 ${p.points==null?'-':esc(p.points)}</span>
        ${p.body_latex?' '+esc(String(p.body_latex).slice(0,60)):' '+esc(p.source_citation||'(본문 없음)')}</label>`).join('')
      :'<p class="card-cap tight">연결할 문항이 없습니다. [문제은행]에 이 단원×사고과정의 공개 문항이 없습니다 — 아래 메모만으로 배정할 수 있습니다.</p>';
  };
  drawProblems();
  errSel.addEventListener('change',drawProblems);

  wrap.querySelector('.rx_cancel').addEventListener('click',()=>{wrap.style.display='none';});
  wrap.querySelector('.rx_save').addEventListener('click',async()=>{
    const m=wrap.querySelector('.rx_msg');m.className='msg';m.textContent='';
    const ids=[...box.querySelectorAll('.rx_pid:checked')].map(i=>i.value);
    const note=wrap.querySelector('.rx_note').value.trim();
    const count=Number(wrap.querySelector('.rx_count').value)||null;
    // 문항도 메모도 없으면 학생이 무엇을 해야 하는지 아무 데도 적히지 않는다.
    if(!ids.length&&!note){m.className='msg err';m.textContent='배정 문항을 고르거나 메모를 입력하세요.';return;}
    try{
      await db.insertPrescription({student_id:sid,unit:target.unit,cognition:target.cognition,
        error_type:errSel.value||null,
        problem_ids:ids.length?ids:null,
        target_count:count||(ids.length||null),
        due_date:wrap.querySelector('.rx_due').value||null,
        recheck_after:wrap.querySelector('.rx_recheck').value||null,
        note:note||null,
        baseline_rate:target.rate==null?null:target.rate,        // 기존 컬럼. 계속 저장한다
        baseline_rate_pooled:pooled.rate==null?null:r1(pooled.rate),
        baseline_n:pooled.n,baseline_points:r1(pooled.points),
        prev_prescription_id:target.prevId||null,
        status:'active'});
      refresh();
    }catch(e){m.className='msg err';m.textContent='실패: '+(e?.message||'오류');}
  });
}

/* ── 실행 로그 요약 ──
   ★ 최근 7일을 점 7개로만 보여준다. **연속·스트릭은 절대 표시하지 않는다** —
     끊긴 날이 곧 "앱을 마지막으로 연 날"이 되어, 학생은 공부를 쉰 것이 아니라
     앱을 안 연 것뿐인데도 기록이 0으로 리셋된 것처럼 보인다. 그 리셋을 피하려고
     앱을 여는 순간 이 기록은 공부량이 아니라 접속량이 된다. */
function last7(logs,pid){
  const done=new Set((logs||[]).filter(l=>l&&l.prescription_id===pid).map(l=>String(l.log_date).slice(0,10)));
  const out=[];for(let i=6;i>=0;i--){const d=dayStr(-i);out.push({date:d,done:done.has(d)});}
  return out;
}
function dotsHTML(days){
  // green = 실행함. 시맨틱 색 규약 그대로다(green=양호/이행).
  return `<span class="dots">${days.map(d=>
    `<i class="${d.done?'on':''}" title="${esc(d.date)}${d.done?' 실행함':''}"></i>`).join('')}</span>`;
}
// 후속 처방 사슬의 깊이. prev 를 따라 올라가며 센다(순환·유실 대비 상한 20).
function attemptSeq(p,byId){
  let n=1,cur=p,guard=0;
  while(cur&&cur.prev_prescription_id&&byId[cur.prev_prescription_id]&&guard++<20){n++;cur=byId[cur.prev_prescription_id];}
  return n;
}

/* 처방 목록 카드. 배정 이후 회차의 같은 단원×사고과정 정답률을 기준선과 비교한다.
   판정은 calc.js prescriptionJudgment() 하나만 쓴다(pooled 우선 · 구 baseline_rate 폴백 ·
   확정된 result 는 저장값 그대로). */
function rxCardHTML(list,records,logs,isAdmin){
  if(!list||!list.length){
    return `<div class="card"><h3>${svg('clipboardCheck')}처방 · 재측정</h3>
      <p class="muted">배정된 처방이 없습니다.${isAdmin?' 위 [우선 보완 순위]에서 [처방 배정]을 눌러 시작하세요.':''}</p></div>`;
  }
  const byId={};list.forEach(p=>{byId[p.id]=p;});
  const rows=list.map(p=>{
    const j=prescriptionJudgment(p,records);
    const seq=attemptSeq(p,byId);
    const days=last7(logs,p.id);
    const doneDays=days.filter(d=>d.done).length;
    const doneToday=days[days.length-1].done;
    const statusChip=p.status==='done'?'<span class="chip blue">완료</span>'
      :p.status==='cancelled'?'<span class="chip gray">취소</span>':'<span class="chip green">진행 중</span>';
    const cur=j.recheck.rate;
    return `<div class="panel">
      <div class="split wrap">
        <div><b>${esc(p.unit)} · ${esc(p.cognition)}</b>${p.error_type?` <span class="chip amber">${esc(p.error_type)}</span>`:''}
          ${seq>1?`<span class="chip purple">${seq}차 시도</span>`:''} ${statusChip}
          <span class="chip ${j.cls}">${j.label}</span>${j.stored?' <span class="chip gray" title="'+esc(fmtDate(p.result_recorded_at))+' 에 확정 기록된 판정입니다. 이후 데이터가 바뀌어도 다시 계산하지 않습니다.">확정</span>':''}</div>
        <div class="rank-meta">기준 ${j.baseline==null?'-':r1(j.baseline)+'%'}
          → ${cur==null?'재측정 없음':r1(cur)+'%'}${j.delta==null?'':' ('+(j.delta>0?'+':'')+r1(j.delta)+'%p)'}</div>
      </div>
      ${j.key==='insufficient'?`<div class="card-cap tight">재측정 표본이 ${r1(j.recheck.points)}점뿐입니다(${RECHECK_MIN_POINTS}점 이상 필요). 같은 단원×사고과정이 다음 회차에 출제되면 판정됩니다.</div>`:''}
      ${!j.baselinePooled&&j.baseline!=null?'<div class="card-cap tight" title="0019 이전에 배정된 처방입니다. 기준선은 최근 3회 가중, 재측정은 단순 배점 풀링이라 자가 다릅니다.">기준선이 구 방식(최근 3회 가중)입니다 — 참고용으로 보세요.</div>':''}
      ${p.note?`<div class="rx-note">${esc(p.note)}</div>`:''}
      <div class="card-cap tight">배정 ${esc(fmtDate(p.created_at))}${p.due_date?' · 기한 '+esc(fmtDate(p.due_date)):''}${p.recheck_after?' · 재측정 '+esc(fmtDate(p.recheck_after)):''}${
        isAdmin&&p.problem_ids&&p.problem_ids.length?' · 배정 문항 '+p.problem_ids.length+'개':''}${
        p.target_count?' · 분량 '+esc(p.target_count)+'문항':''}</div>
      <div class="card-cap tight">최근 7일 ${dotsHTML(days)} <b>${doneDays}일</b> 실행</div>
      ${isAdmin&&p.status==='active'?`<div class="act-row">
        <button class="btn line sm rx_status" data-id="${esc(p.id)}" data-to="done">완료 처리</button>
        <button class="btn line sm rx_status" data-id="${esc(p.id)}" data-to="cancelled">취소</button></div>`:''}
      ${isAdmin&&(j.key==='worse'||j.key==='flat')?`<div class="act-stack">
        <button class="btn line sm rx_open" data-unit="${esc(p.unit)}" data-cog="${esc(p.cognition)}" data-rate="${p.baseline_rate==null?'':esc(r1(p.baseline_rate))}" data-error="${esc(p.error_type||'')}" data-prev="${esc(p.id)}">${svg('clipboardCheck','xs')}후속 처방 배정</button>
        <div class="rx_form panel sunken fold"></div></div>`:''}
      ${!isAdmin&&p.status==='active'?`<div class="act-row">
        ${app.preview?'<button class="btn sm" disabled>다 했어요</button> <span class="card-cap tight">미리보기에서는 저장되지 않습니다</span>'
          :doneToday?'<button class="btn line sm" disabled>오늘 기록됨</button>'
          :`<button class="btn sm rx_done" data-id="${esc(p.id)}">다 했어요</button>`}</div>`:''}
    </div>`;}).join('');
  return `<div class="card"><h3>${svg('clipboardCheck')}처방 · 재측정 <span class="sub">배정 이후 주간테스트로 자동 판정 · ±5%p · 재측정 ${RECHECK_MIN_POINTS}점 이상</span></h3>${rows}
    ${isAdmin?`<p class="card-cap">실행 일수와 판정을 <b>나란히</b> 봅니다 — "6일 했는데 정답률이 그대로"는 학생이 게으른 것이 아니라 <b>처방이 맞지 않는다</b>는 신호입니다. 그때는 [후속 처방 배정]으로 표적을 바꾸세요. (실행 기록은 학생이 직접 남기므로 실제 학습량과 다를 수 있습니다.)</p>`
      :`<p class="card-cap">[다 했어요]는 그날 처방을 했다는 기록만 남깁니다. 처방의 완료 여부는 선생님이 확인 후 처리합니다.</p>`}</div>`;
}

export { renderDiagnosis };
