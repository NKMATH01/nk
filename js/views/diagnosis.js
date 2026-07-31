/* 취약 진단 */
import { cellRateSince, heatFromRecords, judgePrescription, shortfallContribution } from '../calc.js';
import { COGNITIONS, UNITS, WRONG_REASONS } from '../config.js';
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
  // 실점 기여도
  const totPts=b.questionRecords.reduce((s,r)=>s+r.points,0)||1;
  const ptsByCell={};b.questionRecords.forEach(r=>{const k=r.unit+'|'+r.cognition;ptsByCell[k]=(ptsByCell[k]||0)+r.points;});
  const cells=[];UNITS.forEach(u=>COGNITIONS.forEach(cg=>{const h=heat[u][cg];if(h.rate!=null)cells.push({unit:u,cognition:cg,rate:h.rate,n:h.n,pointShare:(ptsByCell[u+'|'+cg]||0)/totPts});}));
  const ranked=shortfallContribution(cells).slice(0,3);
  // 오답원인 분포
  const reasonCount={};WRONG_REASONS.forEach(r=>reasonCount[r]=0);let reasonTotal=0;
  b.questionRecords.forEach(r=>{if(r.wrong_reason&&reasonCount[r.wrong_reason]!=null){reasonCount[r.wrong_reason]++;reasonTotal++;}});
  // 셀별 최다 오답원인
  const cellReason={};b.questionRecords.forEach(r=>{if(!r.wrong_reason)return;const k=r.unit+'|'+r.cognition;(cellReason[k]=cellReason[k]||{});cellReason[k][r.wrong_reason]=(cellReason[k][r.wrong_reason]||0)+1;});
  const topReasonOf=(u,cg)=>{const m=cellReason[u+'|'+cg];if(!m)return null;return Object.entries(m).sort((a,b)=>b[1]-a[1])[0][0];};

  const heatTable=`<div style="overflow-x:auto"><table class="heat"><thead><tr><th class="unit">단원 \\ 사고</th>${COGNITIONS.map(cg=>`<th>${esc(cg)}</th>`).join('')}</tr></thead><tbody>
    ${UNITS.map(u=>`<tr><th class="unit">${esc(u)}</th>${COGNITIONS.map(cg=>{const h=heat[u][cg];
      if(h.rate==null)return '<td class="cell none">-</td>';
      const cls=h.rate<40?'weak':(h.rate<70?'mid':'master');
      return `<td class="cell ${cls}" title="문항 ${h.n}개 · 최근3회 가중 정답률 ${r1(h.rate)}%">${Math.round(h.rate)}%</td>`;}).join('')}</tr>`).join('')}
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
    </div>`;}).join(''):'<p class="muted">진단할 채점 데이터가 없습니다.</p>';

  // 현재 학생의 처방 목록(관리자·학생 모두 표시. 학생은 읽기 전용)
  const rxList=await db.listPrescriptions(sid);
  const rxCard=rxCardHTML(rxList,b.questionRecords,isAdmin);

  const reasonBars=reasonTotal?WRONG_REASONS.map(r=>{const pct=Math.round(reasonCount[r]/reasonTotal*100);
    return `<div class="hbar-row"><span>${esc(r)}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:var(--red)"></div></div><span class="num">${pct}%</span></div>`;}).join(''):'<p class="muted">기록된 오답원인이 없습니다. [주간테스트] 채점 그리드에서 문항별 태그 버튼(🏷)으로 입력하면 자동 집계됩니다.</p>';

  c.innerHTML=await studentSelector()+`
    <div class="card"><h3>${svg('activity')}단원 × 사고과정 히트맵 <span class="sub">최근 3회 가중(50/30/20%) · 득점/배점 기반</span></h3>${heatTable}
      <p class="muted" style="font-size:11.5px;margin-top:10px">색상: <span class="chip red">빨강 &lt;40</span> <span class="chip amber">주황 40~70</span> <span class="chip green">초록 ≥70</span> · 셀에 마우스를 올리면 상세가 표시됩니다.</p></div>
    <div class="grid2">
      <div class="card"><h3>${svg('target')}우선 보완 순위</h3>${rankCards}</div>
      <div class="card"><h3>${svg('activity')}오답 원인 패턴 <span class="sub">주간테스트 채점의 오답원인 태그 자동 집계</span></h3>${reasonBars}</div>
    </div>
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
