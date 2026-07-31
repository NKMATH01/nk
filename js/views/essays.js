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
  let ctx=null;   // 오답노트와 답안 제출 카드가 같은 컨텍스트를 공유한다(조회 1회)
  if(readonly){
    ctx=await loadContext();const b=await studentBundle(sid,ctx);
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

  // 학생 답안 제출: 본인 문항에 사진만 올린다. AI 결과는 여기 표시하지 않는다(RLS 로도 차단).
  const submitCard=readonly?await studentSubmitCardHTML(sid,ctx):'';

  c.innerHTML=await studentSelector()+form+`<div class="card"><h3>${svg('clock')}첨삭 이력 (최신순)</h3>${timeline}</div>`+wrongCard+submitCard;
  hydrateSignedPhotos(c);   // private 버킷이라 서명 URL 을 받아 채운다
  if(readonly)bindStudentSubmit(c,sid);
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

/* ═══════════════════════════════════════════════════════════════════
   학생: 내 답안 제출

   학생은 사진을 올리기만 한다. AI 분석 실행도, 결과 열람도 학생 몫이 아니다
   (grading_runs 는 RLS 로 관리자 전용 — 확정 전 제안이 새면 안 되므로).
   ═══════════════════════════════════════════════════════════════════ */
async function studentSubmitCardHTML(sid,ctx){
  const sessions=(ctx.sessions||[]).slice().sort((a,b)=>b.week_no-a.week_no);
  const qs=(ctx.questions||[]);
  const sessById={};sessions.forEach(s=>sessById[s.id]=s);
  // 최근 회차 문항만 보여준다(선택지가 너무 길어지지 않게)
  const recent=sessions.slice(0,3).map(s=>s.id);
  const opts=qs.filter(q=>recent.includes(q.session_id))
    .sort((a,b)=>{const sa=sessById[a.session_id],sb=sessById[b.session_id];
      return (sb.week_no-sa.week_no)||(a.no-b.no);})
    .map(q=>{const s=sessById[q.session_id];
      return `<option value="${esc(q.id)}">${esc(s.week_no)}주차 ${esc(q.no)}번 · ${esc(q.unit||'')}</option>`;}).join('');

  let mine=[];
  try{mine=await db.listSubmissions(sid,null);}catch(e){}
  const list=mine.length?mine.slice(0,5).map(s=>{
    const q=qs.find(x=>x.id===s.question_id);const ss=q?sessById[q.session_id]:null;
    return `<div class="kv"><span>${ss?esc(ss.week_no)+'주차 ':''}${q?esc(q.no)+'번':'문항'}</span><span class="muted">${esc(fmtDate(s.submitted_at))} 제출</span></div>`;
  }).join(''):'<p class="muted" style="font-size:12.5px">아직 제출한 답안이 없습니다.</p>';

  return `<div class="card"><h3>${svg('pen')}내 답안 제출 <span class="sub">사진을 올리면 선생님이 확인합니다</span></h3>
    ${opts?`<div class="row">
      <div class="field" style="flex:2"><label>문항 선택</label><select id="sub_q">${opts}</select></div>
      <div class="field" style="flex:2"><label>답안 사진</label><input type="file" id="sub_file" accept="image/*" style="font-size:12px"></div>
      <button class="btn" id="sub_go">제출</button></div>
      <div id="sub_msg" class="msg"></div>`
      :'<p class="muted">아직 등록된 문항이 없습니다.</p>'}
    <div class="divider"></div>
    <div class="muted" style="font-size:12px;font-weight:700;margin-bottom:4px">최근 제출</div>
    ${list}</div>`;
}

function bindStudentSubmit(c,sid){
  const btn=$('sub_go');
  if(!btn)return;
  btn.addEventListener('click',async()=>{
    const m=$('sub_msg');m.className='msg';m.textContent='';
    const qid=$('sub_q').value;
    const file=$('sub_file').files[0];
    if(!qid){m.className='msg err';m.textContent='문항을 선택하세요.';return;}
    if(!file){m.className='msg err';m.textContent='답안 사진을 선택하세요.';return;}
    if(app.DEMO){m.className='msg ok';m.textContent='데모 모드에서는 제출이 저장되지 않습니다.';return;}
    if(file.size>8*1024*1024){m.className='msg err';m.textContent='사진은 8MB 이하만 올릴 수 있습니다.';return;}
    btn.disabled=true;m.textContent='업로드 중...';
    try{
      const ext=(file.name.split('.').pop()||'jpg').toLowerCase();
      // 경로 최상위를 학생 id 로 둬야 서명 URL 소유자 확인이 통과한다.
      const path=sid+'/'+qid+'_'+Date.now()+'.'+ext;
      const up=await app.sb.storage.from('answer-sheets').upload(path,file);
      if(up.error)throw up.error;
      await db.insertSubmission({student_id:sid,question_id:qid,input_type:'photo',image_paths:[path]});
      m.className='msg ok';m.textContent='제출되었습니다.';
      renderEssays(c);
    }catch(e){m.className='msg err';m.textContent='제출 실패: '+(e?.message||'오류');}
    finally{btn.disabled=false;}
  });
}

export { renderEssays, studentSubmitCardHTML };
