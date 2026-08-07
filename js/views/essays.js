/* 첨삭 관리 */
import { essayTotals } from '../calc.js';
import { RUBRIC } from '../config.js';
import { db, loadContext, storagePathFromValue, studentBundle } from '../db.js';
import { svg } from '../icons.js';
import { app } from '../state.js';
import { bindStudentSelector, hydrateSignedPhotos, studentSelector } from '../ui.js';
import { $, esc, fmtDate, todayStr } from '../util.js';

/* ═══════════════════════════════════════════════════════════════════
   판정 O/△/X — 문항×채점기준 채점의 기본 단위

   O = 배점 전액 / P(화면 표기 △) = 배점의 절반 / X = 0점.
   △의 절반은 고정이다(기준별 비율 설정을 두지 않는다 — 강사가 매번 비율을
   정하기 시작하면 O/△/X 로 단순화한 의미가 사라진다).
   절반 때문에 0.5 가 생기므로 표시·저장 모두 0.5 단위로 반올림한다.
   DB 에는 "O"|"P"|"X" 만 넣는다(한글·기호를 저장값으로 쓰지 않는다).
   ═══════════════════════════════════════════════════════════════════ */
const MARK_CLS={O:'green',P:'amber',X:'red'};
const MARK_LABEL={O:'O',P:'△',X:'X'};
const round5=v=>Math.round(v*2)/2;
function markScore(points,mark){const p=Number(points)||0;return round5(mark==='O'?p:(mark==='P'?p/2:0));}
// 문항 배점은 그 문항 기준 배점의 합이다(별도 입력을 두지 않는다).
function itemTotals(items){let earned=0,max=0;
  (items||[]).forEach(it=>(it.criteria||[]).forEach(cr=>{earned+=markScore(cr.points,cr.mark);max+=Number(cr.points)||0;}));
  return {earned:round5(earned),max:round5(max)};}
// 새 문항의 채점기준 라벨은 RUBRIC 을 재사용한다(문자열을 다시 하드코딩하지 않는다).
function newCriterion(label){return {label:label||'',points:'',mark:'O'};}
function newItem(no){return {no,criteria:RUBRIC.map(r=>newCriterion(r))};}

/* ═══════════════════════════════════════════════════════════════════
   5) 첨삭 관리
   ═══════════════════════════════════════════════════════════════════ */
async function renderEssays(c){
  const readonly=app.cur.role==='student';
  c.innerHTML=await studentSelector()+'<p class="muted">불러오는 중...</p>';bindStudentSelector(()=>{app.essayEdit=null;renderEssays(c);});
  const sid=app.cur.studentId;if(!sid){c.querySelector('p').textContent='학생을 선택하세요.';return;}
  const universities=await db.listUniversities();
  const essays=await db.listEssays(sid);
  // 수정 대상은 items 기록뿐이다(옛 3분할 기록은 아래 timeline 주석 참고).
  const editing=(!readonly&&app.essayEdit)?essays.find(e=>e.id===app.essayEdit&&e.items&&e.items.length):null;
  const draft=editing?JSON.parse(JSON.stringify(editing.items)):[newItem(1)];

  const form=readonly?'':`<div class="card"><h3>${svg('pen')}${editing?'첨삭 기록 수정':'첨삭 기록 입력'}</h3>
    <div class="row">
      <div class="field"><label>날짜</label><input id="es_date" type="date" value="${editing?esc(fmtDate(editing.week_date)):todayStr()}"></div>
      <div class="field"><label>대상 대학</label><input id="es_univ" list="ulist" value="${editing&&editing.univ_name?esc(editing.univ_name):''}" placeholder="예: 국민대"><datalist id="ulist">${universities.map(u=>`<option value="${esc(u.name)}">`).join('')}</datalist></div>
    </div>
    <div id="es_items" style="margin-top:8px"></div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <button type="button" class="btn line sm" id="es_additem">${svg('plus','sm')}문항 추가</button>
      <span style="font-size:12.5px;font-weight:700">전체 총점</span><span class="chip blue" id="es_total">0/0</span></div>
    <div class="field" style="margin-top:8px"><label>코멘트</label><textarea id="es_comment" rows="2" placeholder="첨삭 코멘트" style="padding:9px 11px;border:1.5px solid var(--line);border-radius:9px">${editing&&editing.comment?esc(editing.comment):''}</textarea></div>
    <button class="btn" id="es_add">${svg('check','sm')}${editing?'수정 저장':'기록 저장'}</button>
    ${editing?'<button class="btn line" id="es_cancel">취소</button>':''}
    <div id="es_msg" class="msg"></div></div>`;

  /* 이력은 두 형식을 함께 다룬다. 총점 칩은 essayTotals 로 양쪽을 같은 규칙으로 접는다.
     items 가 없는 옛 기록은 3분할 막대를 그대로 유지하고 [수정]을 주지 않는다 —
     부분점수(8/10)를 O/△/X 로 옮기면 없던 판정을 지어내는 셈이라, 새 폼에 끼워 넣지 않는다. */
  const timeline=essays.length?essays.map(e=>{
    const tt=essayTotals(e),neo=!!(e.items&&e.items.length);
    const btns=readonly?'':`<span style="margin-left:8px">${neo?`<button class="btn line sm es_edit" data-id="${esc(e.id)}">수정</button> `:''}<button class="btn danger sm es_del" data-id="${esc(e.id)}">삭제</button></span>`;
    const body=neo?e.items.map(it=>{const crit=it.criteria||[],st=itemTotals([it]);
        return `<div style="margin-top:8px">
          <div style="display:flex;align-items:center;gap:6px;font-size:13px"><b>${esc(it.no)}번</b><span class="chip gray">${st.earned}/${st.max}</span></div>
          ${crit.map(cr=>`<div class="kv"><span>${esc(cr.label)} <span class="muted">${esc(cr.points)}점</span></span>
            <span><span class="chip ${MARK_CLS[cr.mark]||'gray'}">${esc(MARK_LABEL[cr.mark]||'-')}</span> <b>${markScore(cr.points,cr.mark)}</b></span></div>`).join('')}</div>`;}).join('')
      :[['조건 해석',e.cond_earned,e.cond_max],['풀이 과정',e.proc_earned,e.proc_max],['최종 답안',e.ans_earned,e.ans_max]]
        .map(([l,ev,mv])=>{const p=mv>0?Math.round(ev/mv*100):0;return `<div class="hbar-row"><span>${esc(l)}</span><div class="bar-track"><div class="bar-fill" style="width:${p}%"></div></div><span class="num">${ev}/${mv}</span></div>`;}).join('');
    return `<div class="timeline-item"><div class="th"><div><b>${esc(e.univ_name||'-')}</b> <span class="muted" style="font-size:12px">${esc(fmtDate(e.week_date))}</span></div>
      <div><span class="chip ${tt.max>0&&tt.earned/tt.max>=0.75?'green':(tt.earned/tt.max>=0.55?'blue':'amber')}">${tt.earned}/${tt.max}</span>${btns}</div></div>
      ${body}
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
  bindStudentSelector(()=>{app.essayEdit=null;renderEssays(c);});
  if(!readonly){
    const wrap=$('es_items');
    // 소계·총점은 입력·클릭 즉시 DOM 에서 직접 다시 센다(다시 그리지 않는다 — 포커스가 튄다).
    const refreshTotals=()=>{let te=0,tm=0;
      wrap.querySelectorAll('.es_item').forEach(el=>{let se=0,sm=0;
        el.querySelectorAll('.es_cri').forEach(r=>{const p=Number(r.querySelector('.es_pts').value)||0,g=markScore(p,r.dataset.mark);
          r.querySelector('.es_got').textContent=g;se+=g;sm+=p;});
        el.querySelector('.es_sub').textContent=round5(se)+'/'+round5(sm);te+=se;tm+=sm;});
      $('es_total').textContent=round5(te)+'/'+round5(tm);};
    // 선택된 판정만 강조한다(주간테스트 .tm_tag 와 같은 인라인 스타일 관례).
    const paintMarks=row=>row.querySelectorAll('.es_mark').forEach(x=>{const cl=MARK_CLS[x.dataset.m];
      x.style.cssText=(x.dataset.m===row.dataset.mark)?`border-color:var(--${cl});color:var(--${cl})`:'';});
    // DOM → draft. 문항·기준을 추가·삭제하면 다시 그리므로, 그 전에 입력 중인 값을 회수한다.
    const sync=()=>{const next=[...wrap.querySelectorAll('.es_item')].map(el=>({no:Number(el.querySelector('.es_no').value)||0,
        criteria:[...el.querySelectorAll('.es_cri')].map(r=>({label:r.querySelector('.es_label').value,points:r.querySelector('.es_pts').value,mark:r.dataset.mark}))}));
      draft.length=0;next.forEach(it=>draft.push(it));};
    const bindItems=()=>{
      wrap.querySelectorAll('.es_pts').forEach(i=>i.addEventListener('input',refreshTotals));
      wrap.querySelectorAll('.es_mark').forEach(b=>b.addEventListener('click',()=>{
        const row=b.closest('.es_cri');row.dataset.mark=b.dataset.m;paintMarks(row);refreshTotals();}));
      wrap.querySelectorAll('.es_addc').forEach(b=>b.addEventListener('click',()=>{
        const i=Number(b.closest('.es_item').dataset.i);sync();draft[i].criteria.push(newCriterion(''));paint();}));
      wrap.querySelectorAll('.es_delcri').forEach(b=>b.addEventListener('click',()=>{
        const row=b.closest('.es_cri'),i=Number(row.closest('.es_item').dataset.i),ci=Number(row.dataset.c);
        sync();draft[i].criteria.splice(ci,1);paint();}));
      wrap.querySelectorAll('.es_delitem').forEach(b=>b.addEventListener('click',()=>{
        const i=Number(b.closest('.es_item').dataset.i);sync();draft.splice(i,1);paint();}));};
    const paint=()=>{wrap.innerHTML=itemsHTML(draft);bindItems();refreshTotals();};
    paint();
    // 문항 번호 기본값은 현재 문항 수+1(중간 문항을 지운 뒤엔 강사가 직접 고친다).
    $('es_additem').addEventListener('click',()=>{sync();draft.push(newItem(draft.length+1));paint();});
    $('es_cancel')?.addEventListener('click',()=>{app.essayEdit=null;renderEssays(c);});

    $('es_add').addEventListener('click',async()=>{
      const m=$('es_msg');m.className='msg';m.textContent='';
      const fail=t=>{m.className='msg err';m.textContent=t;};
      sync();
      const items=draft.map(it=>({no:Number(it.no)||0,criteria:it.criteria.map(cr=>({label:String(cr.label||'').trim(),points:Number(cr.points)||0,mark:cr.mark||'X'}))}));
      if(!items.length)return fail('문항을 1개 이상 추가하세요.');
      for(const it of items){
        if(!it.criteria.length)return fail(it.no+'번 문항에 채점기준을 1개 이상 추가하세요.');
        if(it.criteria.some(cr=>!cr.label))return fail(it.no+'번 문항의 채점기준 이름을 모두 입력하세요.');
        if(it.criteria.some(cr=>!(cr.points>0)))return fail(it.no+'번 문항의 배점은 0보다 커야 합니다.');
      }
      const tt=itemTotals(items);
      // 신규 기록은 3분할을 쓰지 않는다 — 옛 컬럼을 null 로 명시해야 수정 시에도 섞이지 않는다.
      const payload={week_date:$('es_date').value,univ_name:$('es_univ').value.trim()||null,
        items,total_earned:tt.earned,total_max:tt.max,
        cond_earned:null,cond_max:null,proc_earned:null,proc_max:null,ans_earned:null,ans_max:null,
        comment:$('es_comment').value.trim()||null};
      try{if(editing){await db.updateEssay(editing.id,payload);app.essayEdit=null;}
        else{await db.insertEssay(Object.assign({student_id:sid},payload));}
        m.className='msg ok';m.textContent='저장되었습니다.';renderEssays(c);}
      catch(e){m.className='msg err';m.textContent='실패: '+(e?.message||'오류');}
    });
    c.querySelectorAll('.es_edit').forEach(b=>b.addEventListener('click',()=>{app.essayEdit=b.dataset.id;renderEssays(c);}));
    c.querySelectorAll('.es_del').forEach(b=>b.addEventListener('click',async()=>{
      try{await db.deleteEssay(b.dataset.id);if(app.essayEdit===b.dataset.id)app.essayEdit=null;renderEssays(c);}catch(e){alert('삭제 실패: '+(e?.message||'오류'));}}));
  }
}

/* 문항 블록 목록. 각 기준 행은 판정을 data-mark 에 들고 있어 다시 그리지 않고도 읽힌다. */
function itemsHTML(items){
  return items.map((it,ii)=>`<div class="timeline-item es_item" data-i="${ii}" style="padding:10px;margin-bottom:8px">
    <div class="th"><div style="display:flex;align-items:center;gap:6px">
      <input class="es_no" type="number" min="1" value="${esc(it.no)}" style="width:58px;padding:6px;border:1.5px solid var(--line);border-radius:8px">
      <span style="font-size:12.5px;font-weight:700">번</span><span class="chip blue es_sub">0/0</span></div>
      <div><button type="button" class="btn line sm es_addc">${svg('plus','sm')}기준</button> <button type="button" class="btn danger sm es_delitem">문항 삭제</button></div></div>
    ${(it.criteria||[]).map((cr,ci)=>`<div class="es_cri" data-c="${ci}" data-mark="${esc(cr.mark||'O')}" style="display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap">
      <input class="es_label" value="${esc(cr.label)}" placeholder="채점기준" style="flex:1;min-width:110px;padding:7px;border:1.5px solid var(--line);border-radius:8px">
      <input class="es_pts" type="number" min="0" step="0.5" value="${esc(cr.points)}" placeholder="배점" style="width:68px;padding:7px;border:1.5px solid var(--line);border-radius:8px">
      ${['O','P','X'].map(k=>`<button type="button" class="btn line sm es_mark" data-m="${k}" style="${(cr.mark||'O')===k?`border-color:var(--${MARK_CLS[k]});color:var(--${MARK_CLS[k]})`:''}">${MARK_LABEL[k]}</button>`).join('')}
      <b class="es_got" style="font-size:12.5px;width:34px;text-align:right">0</b>
      <button type="button" class="btn danger sm es_delcri">${svg('trash','sm')}</button></div>`).join('')}
  </div>`).join('');
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
