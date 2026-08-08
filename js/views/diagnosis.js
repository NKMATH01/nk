/* 취약 진단 */
import { cellRateSince, errorAxisFromRecords, hasEnoughSample, heatFromRecords, judgePrescription,
         pointShareFromRecords, SAMPLE_GATE, scoreTags, shortfallContribution } from '../calc.js';
import { COGNITIONS, UNITS } from '../config.js';
import { db, loadContext, studentBundle } from '../db.js';
import { svg } from '../icons.js';
import { app } from '../state.js';
import { bindStudentSelector, studentSelector } from '../ui.js';
import { esc, fmtDate, r1 } from '../util.js';

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
  const heatTable=`<div style="overflow-x:auto"><table class="heat"><thead><tr><th class="unit">단원 \\ 사고</th>${COGNITIONS.map(cg=>`<th>${esc(cg)}</th>`).join('')}</tr></thead><tbody>
    ${UNITS.map(u=>`<tr><th class="unit">${esc(u)}</th>${COGNITIONS.map(cg=>{const h=heat[u][cg];
      if(h.rate==null)return '<td class="cell none">-</td>';
      // 표본 미달은 숨기지 않는다 — 데이터가 없다는 사실 자체가 다음 출제에 주는 정보다.
      if(!hasEnoughSample(h))return `<td class="cell none" style="font-size:11px;font-weight:600" title="표본 부족 — 문항 ${h.n}개 · 배점 ${r1(h.points)}점 · ${h.sessions}개 회차 (기준 ${esc(gateText)}). 정답률 ${r1(h.rate)}% 는 참고값이며 우선 보완 순위에서 제외됩니다.">표본 ${h.n}문항</td>`;
      const cls=h.rate<40?'weak':(h.rate<70?'mid':'master');
      return `<td class="cell ${cls}" title="문항 ${h.n}개 · ${h.sessions}개 회차 · 최근3회 가중 정답률 ${r1(h.rate)}%">${Math.round(h.rate)}%</td>`;}).join('')}</tr>`).join('')}
    </tbody></table></div>`;

  const isAdmin=app.cur.role==='admin';
  const rankCards=ranked.length?ranked.map((r,i)=>{const tr=topReasonOf(r.unit,r.cognition);
    return `<div class="${i===0?'card':''}" style="${i===0?'background:linear-gradient(135deg,#FBE9E9,#fff);border-color:#F3C9C9':'border:1px solid var(--line);border-radius:11px;padding:12px;margin-bottom:8px'}">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div><span class="chip red">${i+1}순위</span> <b style="font-size:${i===0?'17px':'14px'}">${esc(r.unit)} · ${esc(r.cognition)}</b></div>
        <div class="muted" style="font-size:12px">정답률 ${Math.round(r.rate)}% · 실점기여 ${(r.contrib*100).toFixed(1)}</div></div>
      ${tr?`<div style="margin-top:6px;font-size:12.5px">최다 오답원인: <span class="chip amber">${esc(tr)}</span></div>`:''}
      ${isAdmin?`<div style="margin-top:8px"><button class="btn line sm rx_open" data-unit="${esc(r.unit)}" data-cog="${esc(r.cognition)}" data-rate="${esc(r1(r.rate))}">${svg('clipboardCheck','xs')}처방 배정</button>
        <div class="rx_form" style="display:none;margin-top:8px;padding:10px;border:1px solid var(--line);border-radius:9px;background:var(--bg)"></div></div>`:''}
    </div>`;}).join('')
    /* 초기에는 순위가 비거나 1~2개만 뜬다. 그게 옳다 — 없는 근거로 순위를 만들지 않는다.
       빈 자리에는 오류유형 축을 가리킨다(5축은 표본이 훨씬 빨리 찬다). */
    :(cells.length
      ?`<p class="muted">표본 기준(${esc(gateText)})을 채운 셀이 아직 없습니다. 회차가 쌓이면 순위가 나타납니다. 그때까지는 위 <b>오류유형 진단</b>을 기준으로 보완하세요.</p>`
      :'<p class="muted">진단할 채점 데이터가 없습니다.</p>');

  // 현재 학생의 처방 목록(관리자·학생 모두 표시. 학생은 읽기 전용)
  const rxList=await db.listPrescriptions(sid);
  const rxCard=rxCardHTML(rxList,b.questionRecords,isAdmin);

  /* 오류유형 축 카드. 비율이 아니라 **손실 점수**로 쓴다 —
     "조건 해석 34%" 는 다음 행동이 안 나오지만 "28점 손실" 은 나온다.
     표본이 없을 때의 안내는 역할마다 다르다 — 학생에게 없는 화면([주간테스트])을 안내하면 안 된다. */
  const noAxisMsg=isAdmin
    ?'<p class="muted">집계할 오류유형이 없습니다. [주간테스트] 채점 그리드의 태그 버튼(🏷)과 [첨삭 관리]의 문항별 채점기준이 쌓이면 자동으로 표시됩니다.</p>'
    :'<p class="muted">아직 집계된 오류유형이 없습니다. 주간테스트 채점과 첨삭이 끝나면 여기에 표시됩니다.</p>';
  const axisHead=axis.length
    ?`<div style="font-size:17px;font-weight:800;margin-bottom:10px">${esc(axis[0].tag)} <span style="color:var(--red)">— ${esc(axisSpan)} ${r1(axis[0].lostPoints)}점 손실</span></div>`
    :'';
  const axisBars=axis.length?axis.map(a=>`<div class="hbar-row" title="주간테스트 ${r1(a.sources.test)}점 · 첨삭 ${r1(a.sources.essay)}점 · 관측 ${a.n}건">
      <span>${esc(a.tag)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.round(a.share*100)}%;background:var(--red)"></div></div>
      <span class="num">${r1(a.lostPoints)}점</span></div>`).join(''):noAxisMsg;
  // 집계에서 뺀 것을 숨기지 않는다.
  const axisNotes=[
    axis.skippedLegacyEssays?`구형 첨삭 ${axis.skippedLegacyEssays}건은 채점기준별 기록이 없어 제외했습니다.`:'',
    axis.untaggedLostPoints>0?`태그가 없는 주간테스트 실점 ${r1(axis.untaggedLostPoints)}점은 원인을 알 수 없어 제외했습니다.`:'',
  ].filter(Boolean).join(' ');

  c.innerHTML=await studentSelector()+`
    <div class="card"><h3>${svg('target')}오류유형 진단 <span class="sub">${esc(axisSpan)} · 흘린 점수 기준</span></h3>
      ${axisHead}${axisBars}
      <p class="muted" style="font-size:11.5px;margin-top:10px">주간테스트 오답원인 태그와 첨삭 채점기준(O/△/X)에서 잃은 점수를 합산한 <b>자동 집계</b>입니다(AI 판단이 아닙니다). 한 문항에 태그가 여럿이면 실점을 균등 분배합니다.${axisNotes?' '+esc(axisNotes):''}</p></div>
    <div class="card"><h3>${svg('target')}우선 보완 순위 <span class="sub">표본 ${esc(gateText)} 이상인 셀만</span></h3>${rankCards}</div>
    <div class="card"><h3>${svg('activity')}단원 × 사고과정 히트맵 <span class="sub">보조 지표 · 최근 3회 가중(50/30/20%) · 득점/배점 기반</span></h3>${heatTable}
      <p class="muted" style="font-size:11.5px;margin-top:10px">색상: <span class="chip red">빨강 &lt;40</span> <span class="chip amber">주황 40~70</span> <span class="chip green">초록 ≥70</span> · 회색 <b>표본 N문항</b> 은 표본이 얇아 순위에서 제외한 셀입니다(정답률은 계산돼 있으며 셀에 마우스를 올리면 보입니다).</p></div>
    ${rxCard}`;
  bindStudentSelector(()=>renderDiagnosis(c));

  // 처방 배정 폼
  c.querySelectorAll('.rx_open').forEach(btn=>btn.addEventListener('click',()=>{
    const wrap=btn.parentElement.querySelector('.rx_form');
    if(wrap.style.display==='block'){wrap.style.display='none';return;}
    wrap.style.display='block';
    wrap.innerHTML=`<div class="row" style="gap:6px">
        <div class="field" style="flex:1"><label>완료 기한</label><input type="date" class="rx_due"></div>
      </div>
      <div class="field" style="margin-top:6px"><label>처방 내용</label>
        <textarea class="rx_note" rows="2" style="width:100%;padding:8px;border:1.5px solid var(--line);border-radius:8px" placeholder="예: 활용형 조건 도식화 훈련 주 2회"></textarea></div>
      <div class="muted" style="font-size:11.5px;margin-top:4px">배정 시점 정답률 ${esc(btn.dataset.rate)}% 를 기준선으로 기록합니다.</div>
      <div style="margin-top:6px"><button class="btn sm rx_save">배정</button> <button class="btn line sm rx_cancel">취소</button></div>
      <div class="rx_msg msg"></div>`;
    wrap.querySelector('.rx_cancel').addEventListener('click',()=>{wrap.style.display='none';});
    wrap.querySelector('.rx_save').addEventListener('click',async()=>{
      const m=wrap.querySelector('.rx_msg');m.className='msg';m.textContent='';
      const note=wrap.querySelector('.rx_note').value.trim();
      if(!note){m.className='msg err';m.textContent='처방 내용을 입력하세요.';return;}
      try{
        await db.insertPrescription({student_id:sid,unit:btn.dataset.unit,cognition:btn.dataset.cog,
          due_date:wrap.querySelector('.rx_due').value||null,note,
          baseline_rate:Number(btn.dataset.rate),status:'active'});
        renderDiagnosis(c);
      }catch(e){m.className='msg err';m.textContent='실패: '+(e?.message||'오류');}
    });
  }));
  // 처방 완료/취소
  c.querySelectorAll('.rx_status').forEach(btn=>btn.addEventListener('click',async()=>{
    try{await db.updatePrescriptionStatus(btn.dataset.id,btn.dataset.to);renderDiagnosis(c);}
    catch(e){alert('실패: '+(e?.message||'오류'));}
  }));
}

/* 처방 목록 카드. 배정 이후 회차의 같은 단원×사고과정 정답률을 기준선과 비교한다. */
function rxCardHTML(list,records,isAdmin){
  if(!list||!list.length){
    return `<div class="card"><h3>${svg('clipboardCheck')}처방 · 재측정</h3>
      <p class="muted">배정된 처방이 없습니다.${isAdmin?' 위 [우선 보완 순위]에서 [처방 배정]을 눌러 시작하세요.':''}</p></div>`;
  }
  const rows=list.map(p=>{
    const cur=cellRateSince(records,p.unit,p.cognition,p.created_at?String(p.created_at).slice(0,10):null);
    const j=judgePrescription(p.baseline_rate,cur);
    const statusChip=p.status==='done'?'<span class="chip blue">완료</span>'
      :p.status==='cancelled'?'<span class="chip gray">취소</span>':'<span class="chip green">진행 중</span>';
    return `<div style="border:1px solid var(--line);border-radius:10px;padding:10px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
        <div><b>${esc(p.unit)} · ${esc(p.cognition)}</b> ${statusChip} <span class="chip ${j.cls}">${j.label}</span></div>
        <div class="muted" style="font-size:12px">기준 ${p.baseline_rate==null?'-':r1(p.baseline_rate)+'%'}
          → ${cur==null?'재측정 없음':r1(cur)+'%'}${j.delta==null?'':' ('+(j.delta>0?'+':'')+r1(j.delta)+'%p)'}</div>
      </div>
      ${p.note?`<div class="muted" style="font-size:12.5px;margin-top:6px">${esc(p.note)}</div>`:''}
      <div class="muted" style="font-size:11.5px;margin-top:4px">배정 ${esc(fmtDate(p.created_at))}${p.due_date?' · 기한 '+esc(fmtDate(p.due_date)):''}</div>
      ${isAdmin&&p.status==='active'?`<div style="margin-top:6px">
        <button class="btn line sm rx_status" data-id="${esc(p.id)}" data-to="done">완료 처리</button>
        <button class="btn line sm rx_status" data-id="${esc(p.id)}" data-to="cancelled">취소</button></div>`:''}
    </div>`;}).join('');
  return `<div class="card"><h3>${svg('clipboardCheck')}처방 · 재측정 <span class="sub">배정 이후 실시된 주간테스트로 자동 판정 (±5%p 기준)</span></h3>${rows}</div>`;
}

export { renderDiagnosis };
