/* 첨삭 관리 */
import { RUBRIC } from '../config.js';
import { db, loadContext, storagePathFromValue, studentBundle } from '../db.js';
import { svg } from '../icons.js';
import { app } from '../state.js';
import { bindStudentSelector, hydrateSignedPhotos, studentSelector } from '../ui.js';
import { $, esc, fmtDate, todayStr } from '../util.js';

/* ═══════════════════════════════════════════════════════════════════
   5) 첨삭 관리
   ═══════════════════════════════════════════════════════════════════ */
async function renderEssays(c){
  const readonly=app.cur.role==='student';
  c.innerHTML=await studentSelector()+'<p class="muted">불러오는 중...</p>';bindStudentSelector(()=>renderEssays(c));
  const sid=app.cur.studentId;if(!sid){c.querySelector('p').textContent='학생을 선택하세요.';return;}
  const universities=await db.listUniversities();
  const essays=await db.listEssays(sid);
  const form=readonly?'':`<div class="card"><h3>${svg('pen')}첨삭 기록 입력</h3>
    <div class="row">
      <div class="field"><label>날짜</label><input id="es_date" type="date" value="${todayStr()}"></div>
      <div class="field"><label>대상 대학</label><input id="es_univ" list="ulist" placeholder="예: 국민대"><datalist id="ulist">${universities.map(u=>`<option value="${esc(u.name)}">`).join('')}</datalist></div>
    </div>
    <div class="row" style="margin-top:8px">
      ${RUBRIC.map((r,i)=>`<div class="field"><label>${esc(r)} (득점/만점)</label><div style="display:flex;gap:6px">
        <input class="rb_e" data-i="${i}" type="number" min="0" placeholder="득점" style="width:70px;padding:8px;border:1.5px solid var(--line);border-radius:8px">
        <input class="rb_m" data-i="${i}" type="number" min="0" placeholder="만점" style="width:70px;padding:8px;border:1.5px solid var(--line);border-radius:8px"></div></div>`).join('')}
    </div>
    <div class="field" style="margin-top:8px"><label>코멘트</label><textarea id="es_comment" rows="2" placeholder="첨삭 코멘트" style="padding:9px 11px;border:1.5px solid var(--line);border-radius:9px"></textarea></div>
    <button class="btn" id="es_add">${svg('check','sm')}기록 저장</button><div id="es_msg" class="msg"></div></div>`;

  const timeline=essays.length?essays.map(e=>{const items=[['조건 해석',e.cond_earned,e.cond_max],['풀이 과정',e.proc_earned,e.proc_max],['최종 답안',e.ans_earned,e.ans_max]];
    const tot=(e.cond_earned||0)+(e.proc_earned||0)+(e.ans_earned||0),max=(e.cond_max||0)+(e.proc_max||0)+(e.ans_max||0);
    return `<div class="timeline-item"><div class="th"><div><b>${esc(e.univ_name||'-')}</b> <span class="muted" style="font-size:12px">${esc(fmtDate(e.week_date))}</span></div>
      <span class="chip ${max>0&&tot/max>=0.75?'green':(tot/max>=0.55?'blue':'amber')}">${tot}/${max}</span></div>
      ${items.map(([l,ev,mv])=>{const p=mv>0?Math.round(ev/mv*100):0;return `<div class="hbar-row"><span>${esc(l)}</span><div class="bar-track"><div class="bar-fill" style="width:${p}%"></div></div><span class="num">${ev}/${mv}</span></div>`;}).join('')}
      ${e.comment?`<div class="muted" style="font-size:12.5px;margin-top:8px;padding:8px;background:var(--bg);border-radius:8px">${esc(e.comment)}</div>`:''}</div>`;}).join(''):'<p class="muted">첨삭 기록이 없습니다.</p>';

  let wrongCard='';
  if(readonly){
    const ctx=await loadContext();const b=await studentBundle(sid,ctx);
    const maxByWeek={};b.perSession.forEach(s=>{maxByWeek[s.week||0]=(s.total||s.pts||0);});
    const byWeek={};b.questionRecords.forEach(r=>{const w=r.week||0;(byWeek[w]=byWeek[w]||[]).push(r);});
    const wks=Object.keys(byWeek).map(Number).sort((a,b)=>b-a);
    const inner=wks.length?wks.map((w,wi)=>{
      const rows=byWeek[w].slice().sort((a,b)=>(a.no||0)-(b.no||0));
      const earnedSum=rows.reduce((s,r)=>s+(r.earned||0),0);
      const ptsSum=rows.reduce((s,r)=>s+(r.points||0),0);
      const maxSum=maxByWeek[w]||ptsSum;
      const wrongN=rows.filter(r=>r.earned<r.points).length;
      return `<details class="wk-note"${wi===0?' open':''}><summary><span class="wk-title">${w}주차</span>
        <span class="chip blue">${earnedSum}/${maxSum}</span>${wrongN?`<span class="chip amber">감점 ${wrongN}문항</span>`:'<span class="chip green">전항 만점</span>'}</summary>
        ${rows.map(r=>{const ok=r.earned>=r.points;return `<div class="timeline-item" style="padding:10px;margin-bottom:8px">
          <div style="font-size:13px"><b>${esc(String(r.no||'-'))}번</b> · ${esc(r.unit)}·${esc(r.cognition)} ${ok?`<span class="chip green">${r.earned}/${r.points}점</span>`:`<span class="muted">(${r.earned}/${r.points}점)</span> ${r.wrong_reason?`<span class="chip amber">${esc(r.wrong_reason)}</span>`:''}`}</div>
          ${r.reason_note?`<div class="muted" style="font-size:12.5px;margin-top:6px;padding:8px;background:var(--bg);border-radius:8px">${esc(r.reason_note)}</div>`:''}
          ${r.photo_url?`<div style="margin-top:6px" data-photo-path="${esc(storagePathFromValue(r.photo_url))}" data-photo-height="100"><span class="muted" style="font-size:11px">사진 불러오는 중...</span></div>`:''}
        </div>`;}).join('')}</details>`;}).join(''):'<p class="muted">채점된 주간테스트가 없습니다.</p>';
    wrongCard=`<div class="card"><h3>${svg('activity')}주간테스트 오답 노트</h3>${inner}</div>`;
  }

  c.innerHTML=await studentSelector()+form+`<div class="card"><h3>${svg('clock')}첨삭 이력 (최신순)</h3>${timeline}</div>`+wrongCard;
  hydrateSignedPhotos(c);   // private 버킷이라 서명 URL 을 받아 채운다
  bindStudentSelector(()=>renderEssays(c));
  if(!readonly){
    $('es_add').addEventListener('click',async()=>{
      const m=$('es_msg');m.className='msg';m.textContent='';
      const es=[...c.querySelectorAll('.rb_e')].map(i=>Number(i.value||0));
      const ms=[...c.querySelectorAll('.rb_m')].map(i=>Number(i.value||0));
      if(ms.some(v=>!v)){m.className='msg err';m.textContent='각 항목의 만점을 입력하세요.';return;}
      if(es.some((v,i)=>v>ms[i])){m.className='msg err';m.textContent='득점이 만점을 초과했습니다.';return;}
      try{await db.insertEssay({student_id:sid,week_date:$('es_date').value,univ_name:$('es_univ').value.trim()||null,
        cond_earned:es[0],cond_max:ms[0],proc_earned:es[1],proc_max:ms[1],ans_earned:es[2],ans_max:ms[2],comment:$('es_comment').value.trim()||null});
        m.className='msg ok';m.textContent='저장되었습니다.';renderEssays(c);}
      catch(e){m.className='msg err';m.textContent='실패: '+(e?.message||'오류');}
    });
  }
}

export { renderEssays };
