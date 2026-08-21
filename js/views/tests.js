/* 주간테스트 — 회차 / 문항 정의 / 채점 그리드 / 채점기준 태그 */
import { COGNITIONS, UNITS, WRONG_REASONS } from '../config.js';
import { db, storagePathFromValue } from '../db.js';
import { svg } from '../icons.js';
import { app } from '../state.js';
import { hydrateSignedPhotos } from '../ui.js';
import { $, esc, fmtDate, todayStr } from '../util.js';

/* ═══════════════════════════════════════════════════════════════════
   3) 주간테스트 — 회차 / 문항 정의 / 채점 그리드
   ═══════════════════════════════════════════════════════════════════ */

async function renderTests(c){
  const sessions=await db.listSessions();
  if(!app.testUI.sessionId&&sessions.length)app.testUI.sessionId=sessions[sessions.length-1].id;
  c.innerHTML=`
    <div class="stepper">
      <button data-step="1" class="${app.testUI.step===1?'on':''}"><span class="n">1</span>회차 관리</button>
      <button data-step="2" class="${app.testUI.step===2?'on':''}"><span class="n">2</span>문항 정의</button>
      <button data-step="3" class="${app.testUI.step===3?'on':''}"><span class="n">3</span>채점 그리드</button>
    </div>
    <div id="testBody"></div>`;
  c.querySelectorAll('.stepper button').forEach(b=>b.addEventListener('click',()=>{app.testUI.step=Number(b.dataset.step);renderTests(c);}));
  if(app.testUI.step===1)await renderSessions($('testBody'),c);
  else if(app.testUI.step===2)await renderQuestionDef($('testBody'),c);
  else await renderScoreGrid($('testBody'),c);
}
async function renderSessions(body,c){
  const sessions=await db.listSessions();
  body.innerHTML=`
    <div class="card"><h3>${svg('plus')}새 회차</h3>
      <div class="row">
        <div class="field"><label>주차 번호</label><input id="se_week" type="number" min="1" value="${(sessions.at(-1)?.week_no||0)+1}"></div>
        <div class="field"><label>시험일</label><input id="se_date" type="date" value="${todayStr()}"></div>
        <div class="field"><label>총점</label><input id="se_total" type="number" min="0" placeholder="예: 100"></div>
        <div class="field"><label>문항 수(초기)</label><input id="se_nq" type="number" min="1" value="10"></div>
      </div>
      <div class="field" style="margin-top:8px"><label>범위 단원(복수 선택)</label>
        <div id="se_units" style="display:flex;flex-wrap:wrap;gap:8px">${UNITS.map(u=>`<label class="pill" style="cursor:pointer"><input type="checkbox" value="${esc(u)}" style="margin-right:5px">${esc(u)}</label>`).join('')}</div></div>
      <button class="btn" id="se_add" style="margin-top:10px">${svg('plus','sm')}회차 생성</button>
      <div id="se_msg" class="msg"></div>
    </div>
    <div class="card"><h3>${svg('grid')}회차 목록</h3>
      <table><thead><tr><th>주차</th><th>시험일</th><th>범위</th><th class="num">총점</th><th></th></tr></thead><tbody>
      ${sessions.length?sessions.map(s=>`<tr><td><b>${s.week_no}주차</b></td><td>${esc(fmtDate(s.exam_date))}</td><td class="muted">${esc(s.scope_units||'-')}</td><td class="num">${esc(s.total_score)}</td>
        <td><button class="btn sm line goedit" data-id="${esc(s.id)}">문항/채점</button></td></tr>`).join(''):'<tr><td colspan="5" class="muted">회차가 없습니다.</td></tr>'}
      </tbody></table></div>`;
  $('se_add').addEventListener('click',async()=>{
    const m=$('se_msg');m.className='msg';m.textContent='';
    const week=Number($('se_week').value),date=$('se_date').value,total=Number($('se_total').value);
    const units=[...body.querySelectorAll('#se_units input:checked')].map(i=>i.value);
    if(!week||!date){m.className='msg err';m.textContent='주차와 시험일을 입력하세요.';return;}
    if(!($('se_total').value)||isNaN(total)){m.className='msg err';m.textContent='총점을 입력하세요.';return;}
    try{const sess=await db.insertSession({week_no:week,exam_date:date,scope_units:units.join(', '),total_score:total,memo:''});
      // 초기 문항 생성
      const nq=Math.max(1,Number($('se_nq').value)||10);const rows=[];
      for(let i=0;i<nq;i++)rows.push({no:i+1,unit:units[0]||UNITS[0],cognition:COGNITIONS[0],points:Math.round(total/nq),source:null});
      await db.saveQuestions(sess.id,rows);
      app.testUI.sessionId=sess.id;app.testUI.step=2;m.className='msg ok';m.textContent='생성되었습니다.';renderTests(c);
    }catch(e){m.className='msg err';m.textContent='실패: '+(e?.message||'오류');}
  });
  body.querySelectorAll('.goedit').forEach(b=>b.addEventListener('click',()=>{app.testUI.sessionId=b.dataset.id;app.testUI.step=2;renderTests(c);}));
}
async function renderQuestionDef(body,c){
  const sessions=await db.listSessions();
  const sess=sessions.find(s=>s.id===app.testUI.sessionId);
  if(!sess){body.innerHTML='<div class="card"><p class="muted">회차를 먼저 선택/생성하세요.</p></div>';return;}
  const questions=await db.listQuestions(sess.id);
  body.innerHTML=`
    <div class="card"><h3>${svg('grid')}${sess.week_no}주차 문항 정의 <span class="sub">${esc(fmtDate(sess.exam_date))} · 총점 ${sess.total_score}</span></h3>
      <div style="overflow-x:auto"><table id="qdef"><thead><tr><th style="width:52px">번호</th><th>단원</th><th>사고과정</th><th style="width:90px">배점</th><th>출처(선택)</th><th style="width:60px"></th></tr></thead><tbody></tbody></table></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
        <div><button class="btn line sm" id="qadd">${svg('plus','sm')}문항 추가</button>
          <button class="btn line sm" id="qbank">${svg('file','sm')}은행에서 가져오기</button></div>
        <div><span id="ptsum" class="chip gray"></span> <button class="btn" id="qsave">${svg('check','sm')}문항 저장</button></div>
      </div>
      <div id="qmsg" class="msg"></div>
    </div>`;
  const tb=body.querySelector('#qdef tbody');
  function addRow(q){
    const initialRubric=Array.isArray(q&&q.rubric)?q.rubric:
      (q&&Array.isArray(q.deduction_items)?q.deduction_items:[])
        .map(d=>({criterion:d.label,points:d.points,tag:d.tag}));
    const tr=document.createElement('tr');
    tr.innerHTML=`<td class="qnocell num"></td>
      <td><select class="q_unit field" style="width:100%;padding:6px 8px;border:1.5px solid var(--line);border-radius:7px">${UNITS.map(u=>`<option ${q&&q.unit===u?'selected':''}>${esc(u)}</option>`).join('')}</select></td>
      <td><select class="q_cog field" style="width:100%;padding:6px 8px;border:1.5px solid var(--line);border-radius:7px">${COGNITIONS.map(v=>`<option ${q&&q.cognition===v?'selected':''}>${esc(v)}</option>`).join('')}</select></td>
      <td><input class="q_pts" type="number" min="0" value="${q?esc(q.points):0}" style="width:76px;padding:6px 8px;border:1.5px solid var(--line);border-radius:7px"></td>
      <td><input class="q_src" value="${q&&q.source?esc(q.source):''}" placeholder="예: 수특 미적분 6-12" style="width:100%;padding:6px 8px;border:1.5px solid var(--line);border-radius:7px"></td>
      <td><button class="btn danger icon q_del">${svg('trash','xs')}</button></td>`;
    // 채점기준 편집 행 — 채점 그리드에서 충족 여부 체크박스로 쓰인다
    const rtr=document.createElement('tr');
    rtr.className='rub-row';
    rtr.innerHTML=`<td></td><td colspan="5" style="padding-top:0">
      <details class="rub-wrap"${initialRubric.length?' open':''}>
        <summary style="font-size:12px;cursor:pointer;color:var(--ink-2)">채점기준 <span class="rub-count chip gray"></span></summary>
        <div class="rub-list" style="margin-top:6px"></div>
        <button type="button" class="btn line sm rub-add" style="margin-top:6px">${svg('plus','xs')}기준 추가</button>
        <div class="rub-msg muted" style="font-size:11.5px;margin-top:4px"></div>
      </details></td>`;
    tr._rub=rtr;
    tr.dataset.problemId=(q&&q.problem_id)?q.problem_id:'';   // 은행 연결(누적 실적 집계용)
    tr.querySelector('.q_del').addEventListener('click',()=>{rtr.remove();tr.remove();renumber();});
    tr.querySelector('.q_pts').addEventListener('input',()=>{updateSum();checkRubric(tr);});
    tb.appendChild(tr);tb.appendChild(rtr);

    const list=rtr.querySelector('.rub-list');
    const addRubric=(r)=>{
      const row=document.createElement('div');
      row.className='rub-item';
      row.style.cssText='display:flex;gap:6px;align-items:center;margin-bottom:4px';
      row.innerHTML=`<input class="r_crit" value="${r&&r.criterion?esc(r.criterion):''}" placeholder="채점 기준(예: 조건 해석)" style="flex:2;padding:5px 7px;border:1.5px solid var(--line);border-radius:7px;font-size:12px">
        <input class="r_pts" type="number" min="0" step="0.5" value="${r&&r.points!=null?esc(r.points):1}" style="width:64px;padding:5px 7px;border:1.5px solid var(--line);border-radius:7px;font-size:12px">
        <select class="r_tag" style="flex:1;padding:5px 7px;border:1.5px solid var(--line);border-radius:7px;font-size:12px">
          <option value="">태그 없음</option>${WRONG_REASONS.map(x=>`<option ${r&&r.tag===x?'selected':''}>${esc(x)}</option>`).join('')}</select>
        <button type="button" class="btn danger icon r_del">${svg('trash','xs')}</button>`;
      row.querySelector('.r_del').addEventListener('click',()=>{row.remove();checkRubric(tr);});
      row.querySelector('.r_pts').addEventListener('input',()=>checkRubric(tr));
      list.appendChild(row);checkRubric(tr);
    };
    initialRubric.forEach(addRubric);
    rtr.querySelector('.rub-add').addEventListener('click',()=>addRubric(null));
    checkRubric(tr);
  }
  /* 채점기준 합계가 배점을 넘으면 저장을 막고, 남는 배점은 기본 점수임을 알린다. */
  function checkRubric(tr){
    const rtr=tr._rub;if(!rtr)return true;
    const max=Number(tr.querySelector('.q_pts').value)||0;
    const items=[...rtr.querySelectorAll('.rub-item')];
    const sum=items.reduce((s,r)=>s+(Number(r.querySelector('.r_pts').value)||0),0);
    const cnt=rtr.querySelector('.rub-count');
    cnt.textContent=items.length?items.length+'개':'없음';
    const over=items.length&&sum>max;
    const under=items.length&&sum<max;
    cnt.className='rub-count chip '+(over?'red':(under?'amber':(items.length?'blue':'gray')));
    const msg=rtr.querySelector('.rub-msg');
    msg.textContent=over?('기준 합계 '+sum+'점이 배점 '+max+'점을 초과합니다.'):
      (under?('기준 합계 '+sum+' / 배점 '+max+' — 남는 '+(max-sum)+'점은 항상 부여되는 기본 점수로 처리됩니다.'):
        (items.length?('기준 합계 '+sum+' / 배점 '+max):''));
    msg.style.color=over?'var(--red)':(under?'var(--amber)':'');
    return !over;
  }
  function qRows(){return [...tb.children].filter(tr=>!tr.classList.contains('rub-row'));}
  function renumber(){qRows().forEach((tr,i)=>tr.querySelector('.qnocell').textContent=i+1);updateSum();}
  function updateSum(){let sum=0;tb.querySelectorAll('.q_pts').forEach(i=>sum+=Number(i.value)||0);
    const el=$('ptsum');el.textContent='배점 합계 '+sum+' / 총점 '+sess.total_score;
    el.className='chip '+(sum===Number(sess.total_score)?'green':'red');}
  (questions.length?questions:[{unit:UNITS[0],cognition:COGNITIONS[0],points:0,source:null}]).forEach(addRow);
  renumber();
  $('qadd').addEventListener('click',()=>{addRow({unit:UNITS[0],cognition:COGNITIONS[0],points:0,source:null});renumber();});
  $('qbank').addEventListener('click',()=>openBankPicker(picked=>{
    // 은행 문항 → 회차 문항. 태그 유무와 관계없이 rubric 을 그대로 복사한다.
    picked.forEach(p=>addRow({
      unit:p.unit||UNITS[0],cognition:p.cognition||COGNITIONS[0],points:p.points!=null?p.points:0,
      source:p.source_citation||null,problem_id:p.id,
      rubric:(Array.isArray(p.rubric)?p.rubric:[]).filter(r=>r&&r.criterion&&Number(r.points)>0)
        .map(r=>({criterion:r.criterion,points:Number(r.points),tag:r.tag||null})),
    }));
    renumber();
  }));
  $('qsave').addEventListener('click',async()=>{
    const m=$('qmsg');m.className='msg';m.textContent='';
    const rows=[];let bad=false,rubricOver=false;
    qRows().forEach((tr,i)=>{const pts=Number(tr.querySelector('.q_pts').value);if(isNaN(pts)||pts<0)bad=true;
      if(!checkRubric(tr))rubricOver=true;
      const items=[...(tr._rub?tr._rub.querySelectorAll('.rub-item'):[])].map(r=>({
        criterion:r.querySelector('.r_crit').value.trim(),
        points:Number(r.querySelector('.r_pts').value)||0,
        tag:r.querySelector('.r_tag').value||null,
      })).filter(x=>x.criterion&&x.points>0);
      rows.push({no:i+1,unit:tr.querySelector('.q_unit').value,cognition:tr.querySelector('.q_cog').value,points:pts,source:tr.querySelector('.q_src').value.trim()||null,
        problem_id:tr.dataset.problemId||null,
        rubric:items.length?items:null});});
    if(!rows.length){m.className='msg err';m.textContent='문항이 없습니다.';return;}
    if(bad){m.className='msg err';m.textContent='배점을 확인하세요.';return;}
    if(rubricOver){m.className='msg err';m.textContent='기준 합계가 배점을 초과한 문항이 있습니다.';return;}
    try{await db.saveQuestions(sess.id,rows);m.className='msg ok';m.textContent='저장되었습니다. 채점 그리드로 이동하세요.';}
    catch(e){m.className='msg err';m.textContent='실패: '+(e?.message||'오류');}
  });
}
async function renderScoreGrid(body,c){
  const sessions=await db.listSessions();const sess=sessions.find(s=>s.id===app.testUI.sessionId);
  if(!sess){body.innerHTML='<div class="card"><p class="muted">회차를 먼저 선택하세요.</p></div>';return;}
  const questions=await db.listQuestions(sess.id);
  const students=(await db.listStudents()).filter(s=>s.status==='재원'||!s.status);
  const qids=questions.map(q=>q.id);
  const scores=await db.listScoresBySession(sess.id,qids);
  const scMap={};scores.forEach(s=>scMap[s.question_id+'|'+s.student_id]=s);
  if(!questions.length){body.innerHTML='<div class="card"><p class="muted">먼저 [문항 정의]에서 문항을 저장하세요.</p></div>';return;}
  if(!students.length){body.innerHTML='<div class="card"><p class="muted">재원 학생이 없습니다.</p></div>';return;}

  const head=`<thead><tr><th class="corner">학생 \\ 문항</th>${questions.map(q=>`<th><span class="qno">${q.no}</span><span class="qmeta">${esc(q.unit.slice(0,4))}·${esc(q.cognition)}</span><span class="qmeta">${q.points}점</span></th>`).join('')}<th class="corner right">합계</th></tr></thead>`;
  const rowsHTML=students.map((st,ri)=>`<tr><th class="stu">${esc(st.name)}</th>${questions.map((q,ci)=>{
    const sc=scMap[q.id+'|'+st.id];const val=sc?sc.earned:'';const tag=sc&&sc.wrong_reason?sc.wrong_reason:'';const note=sc&&sc.reason_note?sc.reason_note:'';const photo=sc&&sc.photo_url?sc.photo_url:'';
    const ded=sc&&sc.deduction_checks?JSON.stringify(sc.deduction_checks):'';   // 채점기준/감점 체크 상태(셀 재편집 시 복원용)
    return `<td class="scell" data-r="${ri}" data-c="${ci}" data-q="${esc(q.id)}" data-s="${esc(st.id)}" data-max="${q.points}" data-tag="${esc(tag)}" data-note="${esc(note)}" data-photo="${esc(photo)}" data-ded="${esc(ded)}">
      ${tag||note||photo?'<span class="tagdot" title="'+esc(tag||'메모/사진')+'"></span>':''}
      <input type="number" min="0" max="${q.points}" value="${val}" data-r="${ri}" data-c="${ci}">
      <button class="tagbtn" title="오답원인 태그">${svg('tag','xs')}</button></td>`;}).join('')}<td class="rowtot" data-rowtot="${ri}">0</td></tr>`).join('');
  const footHTML=`<tfoot><tr><th class="corner">문항 정답률</th>${questions.map((q,ci)=>`<td data-colrate="${ci}">-</td>`).join('')}<td></td></tr></tfoot>`;
  body.innerHTML=`<div class="card"><h3>${svg('grid')}${sess.week_no}주차 채점 <span class="sub">셀에 득점 입력 · 방향키 이동 · 태그 버튼으로 오답원인</span></h3>
    <div class="gridwrap"><table class="score-grid">${head}<tbody>${rowsHTML}</tbody>${footHTML}</table></div>
    <div class="grid-foot">
      <div class="card-cap tight">부분점수 허용(0~배점). 범위 밖은 빨강 표시.</div>
      <button class="btn gold" id="gridSave">${svg('check','sm')}전체 저장</button></div>
    <div id="gridMsg" class="msg"></div></div>`;

  const grid=body.querySelector('.score-grid');
  const inputs=[...grid.querySelectorAll('td.scell input')];
  const nCols=questions.length,nRows=students.length;
  function cellAt(r,co){return grid.querySelector(`td.scell input[data-r="${r}"][data-c="${co}"]`);}
  function recompute(){
    // 행 합계
    for(let r=0;r<nRows;r++){let sum=0;for(let co=0;co<nCols;co++){const v=Number(cellAt(r,co).value);if(!isNaN(v))sum+=v;}
      grid.querySelector(`[data-rowtot="${r}"]`).textContent=sum;}
    // 열 정답률(만점 대비 평균)
    for(let co=0;co<nCols;co++){const max=questions[co].points||0;let tot=0,cnt=0;
      for(let r=0;r<nRows;r++){const v=cellAt(r,co).value;if(v!==''){tot+=Number(v);cnt++;}}
      const cell=grid.querySelector(`[data-colrate="${co}"]`);
      cell.textContent=(cnt&&max>0)?Math.round(tot/(cnt*max)*100)+'%':'-';}
  }
  inputs.forEach(inp=>{
    const td=inp.closest('td.scell');const max=Number(td.dataset.max);
    const check=()=>{const v=inp.value;const bad=v!==''&&(isNaN(Number(v))||Number(v)<0||Number(v)>max);td.classList.toggle('bad',bad);};
    inp.addEventListener('input',()=>{check();recompute();});
    inp.addEventListener('keydown',e=>{
      const r=Number(inp.dataset.r),co=Number(inp.dataset.c);let t=null;
      if(e.key==='ArrowUp'){t=cellAt(r-1,co);}
      else if(e.key==='ArrowDown'||e.key==='Enter'){t=cellAt(r+1,co);}
      else if(e.key==='ArrowLeft'){t=cellAt(r,co-1);}
      else if(e.key==='ArrowRight'){t=cellAt(r,co+1);}
      if(t){e.preventDefault();t.focus();t.select();}
    });
    check();
  });
  // 태그 버튼
  const qById={};questions.forEach(q=>qById[q.id]=q);
  grid.querySelectorAll('.tagbtn').forEach(btn=>btn.addEventListener('click',()=>{
    const td=btn.closest('td.scell');const q=qById[td.dataset.q];
    openTagMenu(td,q);}));
  recompute();
  $('gridSave').addEventListener('click',async()=>{
    const m=$('gridMsg');m.className='msg';m.textContent='';
    const rows=[];let bad=false;
    grid.querySelectorAll('td.scell').forEach(td=>{const inp=td.querySelector('input');const v=inp.value;if(v==='')return;
      const max=Number(td.dataset.max);const n=Number(v);if(isNaN(n)||n<0||n>max){bad=true;return;}
      rows.push({question_id:td.dataset.q,student_id:td.dataset.s,earned:n,wrong_reason:td.dataset.tag||null});});
    if(bad){m.className='msg err';m.textContent='범위를 벗어난 점수가 있습니다(빨강 셀 확인).';return;}
    if(!rows.length){m.className='msg err';m.textContent='입력된 점수가 없습니다.';return;}
    m.textContent='저장 중...';
    try{await db.saveScores(rows);m.className='msg ok';m.textContent='저장 완료 · 대시보드와 진단에 반영됩니다.';}
    catch(e){m.className='msg err';m.textContent='실패: '+(e?.message||'오류');}
  });
}
/* 문제은행에서 published 문항을 골라 회차에 넣는 모달.
   문제은행 화면과 같은 필터를 쓰되, 여기서는 공개 상태 문항만 보여준다. */
async function openBankPicker(onPick){
  const back=document.createElement('div');
  back.style.cssText='position:fixed;inset:0;background:rgba(20,22,28,.45);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px';
  const panel=document.createElement('div');
  panel.style.cssText='background:#fff;border-radius:14px;box-shadow:var(--shadow);padding:16px;width:min(880px,96vw);max-height:86vh;overflow:auto';
  panel.innerHTML='<p class="muted">문제은행 불러오는 중...</p>';
  back.appendChild(panel);document.body.appendChild(back);
  const close=()=>back.remove();
  back.addEventListener('click',e=>{if(e.target===back)close();});

  let problems=[];
  try{problems=(await db.listProblems()).filter(p=>p.status==='published');}
  catch(e){panel.innerHTML='<p class="msg err">문제은행 조회 실패: '+esc(e?.message||'오류')+'</p>';return;}

  const state={unit:'',cognition:'',difficulty:'',q:''};
  const draw=()=>{
    const list=problems.filter(p=>
      (!state.unit||p.unit===state.unit)&&
      (!state.cognition||p.cognition===state.cognition)&&
      (!state.difficulty||String(p.difficulty||'')===state.difficulty)&&
      (!state.q||[p.source_citation,p.body_latex,(p.tags||[]).join(' ')].filter(Boolean).join(' ').toLowerCase().includes(state.q.toLowerCase())));
    panel.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h3 style="margin:0">${svg('file')}은행에서 가져오기 <span class="sub">공개 상태 ${list.length}문항</span></h3>
        <button class="btn line sm bp_close">닫기</button></div>
      <div class="row" style="margin-bottom:10px">
        <div class="field"><label>단원</label><select class="bp_unit"><option value="">전체</option>${UNITS.map(u=>`<option ${state.unit===u?'selected':''}>${esc(u)}</option>`).join('')}</select></div>
        <div class="field"><label>사고과정</label><select class="bp_cog"><option value="">전체</option>${COGNITIONS.map(v=>`<option ${state.cognition===v?'selected':''}>${esc(v)}</option>`).join('')}</select></div>
        <div class="field"><label>난이도</label><select class="bp_diff"><option value="">전체</option>${[1,2,3,4,5].map(n=>`<option value="${n}" ${state.difficulty===String(n)?'selected':''}>${n}단계</option>`).join('')}</select></div>
        <div class="field" style="flex:2"><label>검색</label><input class="bp_q" value="${esc(state.q)}" placeholder="출처·본문·태그"></div>
      </div>
      ${list.length?`<div style="overflow-x:auto"><table><thead><tr>
        <th style="width:40px"></th><th>단원·사고</th><th class="num">난이도</th><th class="num">배점</th><th>출처</th><th>태그</th>
      </tr></thead><tbody>
      ${list.map(p=>`<tr><td><input type="checkbox" class="bp_chk" value="${esc(p.id)}"></td>
        <td>${esc(p.unit||'-')} · ${esc(p.cognition||'-')}</td>
        <td class="num">${p.difficulty==null?'-':esc(p.difficulty)}</td>
        <td class="num">${p.points==null?'-':esc(p.points)}</td>
        <td class="muted" style="font-size:12px">${esc(p.source_citation||'미기재')}${p.license_scope==='internal'?' <span class="chip red" style="font-size:10px">내부 전용</span>':''}</td>
        <td class="muted" style="font-size:11.5px">${esc((p.tags||[]).join(', '))}</td></tr>`).join('')}
      </tbody></table></div>`:'<p class="muted">조건에 맞는 공개 문항이 없습니다. [문제은행]에서 상태를 [공개]로 바꾸면 여기에 나타납니다.</p>'}
      <div style="display:flex;justify-content:flex-end;gap:6px;margin-top:12px">
        <button class="btn line bp_close2">취소</button>
        <button class="btn bp_add">선택 문항 추가</button></div>`;
    panel.querySelectorAll('.bp_close,.bp_close2').forEach(b=>b.addEventListener('click',close));
    const bindF=(sel,key)=>{const el=panel.querySelector(sel);if(el)el.addEventListener('change',()=>{state[key]=el.value;draw();});};
    bindF('.bp_unit','unit');bindF('.bp_cog','cognition');bindF('.bp_diff','difficulty');
    const qi=panel.querySelector('.bp_q');if(qi)qi.addEventListener('change',()=>{state.q=qi.value.trim();draw();});
    const addBtn=panel.querySelector('.bp_add');
    if(addBtn)addBtn.addEventListener('click',()=>{
      const ids=[...panel.querySelectorAll('.bp_chk')].filter(x=>x.checked).map(x=>x.value);
      if(!ids.length)return;
      onPick(ids.map(id=>problems.find(p=>p.id===id)).filter(Boolean));
      close();
    });
  };
  draw();
}

function openTagMenu(td,q){
  const curTag=td.dataset.tag||'',curNote=td.dataset.note||'',curPhoto=td.dataset.photo||'';
  const maxPts=Number(td.dataset.max)||0;
  const rubricMode=!!(q&&Array.isArray(q.rubric)&&q.rubric.length);
  const rubricItems=rubricMode?q.rubric.filter(r=>r&&r.criterion&&Number(r.points)>0):[];
  const deductionItems=!rubricMode&&q&&Array.isArray(q.deduction_items)
    ?q.deduction_items.filter(d=>d&&d.label&&Number(d.points)>0):[];
  const items=rubricMode?rubricItems:deductionItems;
  let selTag=curTag,removePhoto=false;
  const panel=document.createElement('div');
  panel.style.cssText='position:fixed;z-index:100;background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);padding:12px;width:280px;max-height:80vh;overflow:auto';
  const rubricHTML=rubricMode&&items.length?`
    <div style="font-size:12px;font-weight:700;margin-bottom:6px">채점기준 <span class="muted" style="font-weight:400">미충족 기준의 체크를 해제하면 점수가 자동 계산됩니다.</span></div>
    <div class="tm_rubric" style="margin-bottom:6px">
      ${items.map((r,i)=>`<label style="display:flex;align-items:center;gap:6px;font-size:12.5px;padding:3px 0;cursor:pointer">
        <input type="checkbox" class="tm_rubchk" data-i="${i}" data-pts="${esc(r.points)}" data-tag="${esc(r.tag||'')}" checked>
        <span style="flex:1">${esc(r.criterion)}</span>
        <span class="chip blue" style="font-size:10.5px">+${esc(r.points)}</span></label>`).join('')}
    </div>
    <div class="tm_rubsum muted" style="font-size:11.5px;margin-bottom:10px"></div>`:'';
  const dedHTML=!rubricMode&&items.length?`
    <div style="font-size:12px;font-weight:700;margin-bottom:6px">감점 항목 <span class="muted" style="font-weight:400">체크하면 점수가 자동 계산됩니다</span></div>
    <div class="tm_ded" style="margin-bottom:6px">
      ${items.map((d,i)=>`<label style="display:flex;align-items:center;gap:6px;font-size:12.5px;padding:3px 0;cursor:pointer">
        <input type="checkbox" class="tm_dedchk" data-i="${i}" data-pts="${esc(d.points)}" data-tag="${esc(d.tag||'')}">
        <span style="flex:1">${esc(d.label)}</span>
        <span class="chip red" style="font-size:10.5px">-${esc(d.points)}</span></label>`).join('')}
    </div>
    <div class="tm_dedsum muted" style="font-size:11.5px;margin-bottom:10px"></div>`:'';
  panel.innerHTML=rubricHTML+dedHTML+`
    <div style="font-size:12px;font-weight:700;margin-bottom:6px">오답 원인</div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px">
      ${['(없음)',...WRONG_REASONS].map(r=>{const v=(r==='(없음)'?'':r);return `<button type="button" class="btn line sm tm_tag" data-r="${esc(v)}" style="${v===selTag?'border-color:var(--purple);color:var(--purple)':''}">${esc(r)}</button>`;}).join('')}
    </div>
    <div style="font-size:12px;font-weight:700;margin-bottom:4px">강사 메모</div>
    <textarea class="tm_note" rows="2" style="width:100%;padding:8px;border:1.5px solid var(--line);border-radius:8px;margin-bottom:10px" placeholder="감점 사유·피드백">${esc(curNote)}</textarea>
    <div style="font-size:12px;font-weight:700;margin-bottom:4px">사진 첨부</div>
    <div class="tm_photo" style="margin-bottom:8px">${curPhoto?`<div><span data-photo-path="${esc(storagePathFromValue(curPhoto))}" class="muted" style="font-size:11px">사진 불러오는 중...</span> <button type="button" class="btn danger sm tm_rmphoto">사진 삭제</button></div>`:''}</div>
    <input type="file" class="tm_file" accept="image/*" style="font-size:12px;margin-bottom:10px">
    <div class="divider"></div>
    <div style="font-size:12px;font-weight:700;margin-bottom:4px">답안지 · AI 분석</div>
    <div class="tm_ai" style="margin-bottom:8px"><span class="muted" style="font-size:11.5px">확인 중...</span></div>
    <div style="display:flex;gap:6px;justify-content:flex-end"><button type="button" class="btn line sm tm_close">닫기</button><button type="button" class="btn sm tm_save">저장</button></div>
    <div class="tm_msg msg" style="margin-top:6px"></div>`;
  const rect=td.getBoundingClientRect();panel.style.left=Math.min(rect.left,window.innerWidth-300)+'px';panel.style.top=Math.min(rect.bottom+4,window.innerHeight-220)+'px';
  document.body.appendChild(panel);
  hydrateSignedPhotos(panel);   // private 버킷이라 서명 URL 을 받아 채운다
  const close=()=>{panel.remove();document.removeEventListener('mousedown',out,true);};
  const out=e=>{if(!panel.contains(e.target))close();};
  setTimeout(()=>document.addEventListener('mousedown',out,true),0);
  const markTag=v=>{selTag=v;
    panel.querySelectorAll('.tm_tag').forEach(x=>{x.style.cssText=(x.dataset.r===v&&v)?'border-color:var(--purple);color:var(--purple)':'';});};
  panel.querySelectorAll('.tm_tag').forEach(b=>b.addEventListener('click',()=>markTag(b.dataset.r)));

  /* 감점 체크 → 득점 = 배점 - 체크된 감점 합계(0 미만 방지).
     가장 큰 감점 항목의 태그를 오답원인으로 자동 제안한다(수동 변경 가능).
     summaryOnly 는 저장된 체크 상태를 복원할 때만 쓴다 — 이미 저장된 득점·오답원인을
     다시 계산해 덮어쓰면 안 되므로 요약 문구만 갱신한다. */
  function recalcDeduction(summaryOnly){
    const chks=[...panel.querySelectorAll('.tm_dedchk:checked')];
    const sum=chks.reduce((s,c)=>s+(Number(c.dataset.pts)||0),0);
    const earned=Math.max(0,maxPts-sum);
    if(!summaryOnly){
      const inp=td.querySelector('input');
      inp.value=String(earned);
      inp.dispatchEvent(new Event('input',{bubbles:true}));   // 행 합계·정답률 갱신
    }
    const sumEl=panel.querySelector('.tm_dedsum');
    if(sumEl)sumEl.textContent=chks.length?('감점 '+sum+'점 → 득점 '+earned+' / '+maxPts):'체크한 감점 없음 → 만점 처리';
    if(!summaryOnly&&chks.length){
      const top=chks.slice().sort((a,b)=>(Number(b.dataset.pts)||0)-(Number(a.dataset.pts)||0))[0];
      if(top&&top.dataset.tag)markTag(top.dataset.tag);
    }
  }
  /* 채점기준 체크 → 득점 = 충족 기준 합계 + 기준에 배정되지 않은 기본 점수.
     가장 큰 미충족 기준의 태그를 오답원인으로 자동 제안한다(수동 변경 가능).
     summaryOnly 는 저장 상태 복원 중 기존 득점·오답원인을 보존한다. */
  function recalcRubric(summaryOnly){
    const chks=[...panel.querySelectorAll('.tm_rubchk')];
    const met=chks.filter(c=>c.checked),unmet=chks.filter(c=>!c.checked);
    const rubricSum=items.reduce((s,r)=>s+(Number(r.points)||0),0);
    const remainder=Math.max(0,maxPts-rubricSum);
    const earned=Math.min(maxPts,met.reduce((s,c)=>s+(Number(c.dataset.pts)||0),0)+remainder);
    if(!summaryOnly){
      const inp=td.querySelector('input');
      inp.value=String(earned);
      inp.dispatchEvent(new Event('input',{bubbles:true}));   // 행 합계·정답률 갱신
    }
    const sumEl=panel.querySelector('.tm_rubsum');
    if(sumEl)sumEl.textContent=unmet.length?('미충족 '+unmet.length+'개 → 득점 '+earned+' / '+maxPts):'전체 충족 → 만점 처리';
    if(!summaryOnly&&unmet.length){
      const top=unmet.slice().sort((a,b)=>(Number(b.dataset.pts)||0)-(Number(a.dataset.pts)||0))[0];
      if(top&&top.dataset.tag)markTag(top.dataset.tag);
    }
  }
  const recalcChecks=summaryOnly=>rubricMode?recalcRubric(summaryOnly):recalcDeduction(summaryOnly);
  panel.querySelectorAll('.tm_dedchk,.tm_rubchk').forEach(c=>c.addEventListener('change',()=>recalcChecks(false)));
  if(rubricMode)recalcRubric(true);

  /* 저장된 체크 상태 복원. 감점 모드는 체크된 항목, rubric 모드는 미충족 기준을
     deduction_checks 에 저장한다. label·points 가 같은 **아직 짝짓지 않은** 첫
     체크박스를 사용하며, 편집으로 매칭이 사라진 항목은 조용히 무시한다. */
  (function restoreDedChecks(){
    if(!items.length||!td.dataset.ded)return;
    let saved=null;
    try{saved=JSON.parse(td.dataset.ded);}catch(e){return;}
    if(!Array.isArray(saved)||!saved.length)return;
    const chks=[...panel.querySelectorAll(rubricMode?'.tm_rubchk':'.tm_dedchk')];
    saved.forEach(s=>{
      if(!s)return;
      const hit=chks.find(c=>{const d=items[Number(c.dataset.i)];
        const label=rubricMode?d&&d.criterion:d&&d.label;
        return c.checked===rubricMode&&d&&label===s.label&&Number(d.points)===Number(s.points);});
      if(hit)hit.checked=!rubricMode;
    });
    recalcChecks(true);
  })();
  // 빈 셀만 만점으로 시작한다 — 이미 저장되어 복원된 점수는 절대 덮어쓰지 않는다.
  if(rubricMode&&td.querySelector('input').value==='')recalcRubric(false);

  // AI 분석 섹션(관리자 전용). 키 미설정이면 버튼을 비활성화하고 이유를 보여준다.
  initAiSection(panel,td,markTag,rubricMode);
  panel.querySelector('.tm_rmphoto')?.addEventListener('click',()=>{removePhoto=true;panel.querySelector('.tm_photo').innerHTML='<span class="muted" style="font-size:12px">사진을 삭제합니다(저장 시 반영).</span>';});
  panel.querySelector('.tm_close').addEventListener('click',close);
  panel.querySelector('.tm_save').addEventListener('click',async()=>{
    const m=panel.querySelector('.tm_msg');m.className='tm_msg msg';m.textContent='';
    const inp=td.querySelector('input');const v=inp.value;
    if(v===''||isNaN(Number(v))){m.className='tm_msg msg err';m.textContent='점수를 먼저 입력하세요.';return;}
    const earned=Number(v);const note=panel.querySelector('.tm_note').value.trim()||null;
    /* deduction_checks 는 감점 모드에서는 체크된 감점 항목, rubric 모드에서는
       **미충족 기준**을 남긴다. rubric 에서도 DB 컬럼의 기존 명칭과 과거 기록의
       label+points 복원 규약을 지키려고 criterion 을 label 로 저장한다.
       tag 는 기록하되 복원 매칭에는 넣지 않아 tag 없는 과거 기록도 복원한다. */
    const checkedItems=rubricMode
      ?[...panel.querySelectorAll('.tm_rubchk:not(:checked)')]
      :[...panel.querySelectorAll('.tm_dedchk:checked')];
    const dedSaved=checkedItems.length?checkedItems.map(c=>({
      label:rubricMode?items[Number(c.dataset.i)].criterion:items[Number(c.dataset.i)].label,
      points:Number(c.dataset.pts)||0,tag:c.dataset.tag||null,
    })):null;
    /* 미충족 기준(또는 체크된 감점)의 태그 전부와 수동 선택한 주 원인(selTag)을
       중복 없이 저장한다. 강사가 제안을 덮어쓴 판단도 오류유형 축에 남는다. */
    const tagSet=[...new Set([...checkedItems.map(c=>c.dataset.tag||''),selTag||''].filter(Boolean))];
    const file=panel.querySelector('.tm_file').files[0];
    let photoUrl=removePhoto?null:(curPhoto||null),demoPhoto=false;
    if(file){
      if(app.DEMO){demoPhoto=true;}
      else{
        if(file.size>5*1024*1024){m.className='tm_msg msg err';m.textContent='사진은 5MB 이하만 첨부할 수 있습니다.';return;}
        m.textContent='업로드 중...';
        try{const ext=(file.name.split('.').pop()||'jpg').toLowerCase();
          // 학생 id 를 최상위 폴더로 둔다 — 서명 URL 발급 시 소유자 확인 근거가 된다.
          const path=td.dataset.s+'/'+td.dataset.q+'_'+Date.now()+'.'+ext;
          const up=await app.sb.storage.from('grading-photos').upload(path,file);if(up.error)throw up.error;
          photoUrl=path;   // 전체 URL 이 아니라 경로만 저장한다(버킷이 private)
        }catch(e){m.className='tm_msg msg err';m.textContent='사진 업로드 실패: '+(e?.message||'오류');return;}
      }
    }
    // note_source='teacher' — 이 경로의 메모는 전부 강사가 직접 친 것이다(빈 값이면 "메모 없음"이 강사 판단).
    // AI few-shot 이 자기 출력을 되먹임하지 않도록 출처를 남긴다(0017).
    // wrong_reason 은 계속 write-through 한다 — 주 원인(가장 큰 감점의 태그)이며 배열이 대체하지 않는다.
    try{await db.saveScores([{question_id:td.dataset.q,student_id:td.dataset.s,earned,wrong_reason:selTag||null,wrong_reason_tags:tagSet.length?tagSet:null,reason_note:note,note_source:'teacher',photo_url:photoUrl,deduction_checks:dedSaved}]);
      td.dataset.tag=selTag||'';td.dataset.note=note||'';td.dataset.photo=photoUrl||'';td.dataset.ded=dedSaved?JSON.stringify(dedSaved):'';
      let dot=td.querySelector('.tagdot');const hasMark=selTag||note||photoUrl;
      if(hasMark){if(!dot){dot=document.createElement('span');dot.className='tagdot';td.appendChild(dot);}dot.title=selTag||'메모/사진';}
      else if(dot)dot.remove();
      if(demoPhoto){m.className='tm_msg msg ok';m.textContent='데모 모드에서는 사진이 저장되지 않습니다. (메모·태그는 반영)';}
      else close();
    }catch(e){m.className='tm_msg msg err';m.textContent='저장 실패: '+(e?.message||'오류');}
  });
}

/* ═══════════════════════════════════════════════════════════════════
   채점 패널의 AI 분석 섹션

   원칙: AI 값은 어떤 경우에도 자동 반영되지 않는다.
     · 제안은 회색 점선 상자로 감싸 강사 입력과 시각적으로 구분한다.
     · [반영] 버튼을 눌러야 grade-review 를 거쳐 scores 에 기록된다.
     · tags_only 모드에서는 점수 제안 자체가 오지 않는다(앵커링 방지).
   ═══════════════════════════════════════════════════════════════════ */
async function initAiSection(panel,td,markTag,rubricMode){
  const box=panel.querySelector('.tm_ai');
  if(!box)return;
  const set=html=>{const b=panel.querySelector('.tm_ai');if(b)b.innerHTML=html;};

  if(app.DEMO){set('<span class="chip gray">데모 모드 — AI 분석을 실행하지 않습니다</span>');return;}
  if(app.cur.role!=='admin'){set('<span class="muted" style="font-size:11.5px">관리자만 사용할 수 있습니다.</span>');return;}

  const status=await db.getAiStatus();
  if(!status||!status.configured){
    set('<span class="chip amber">AI 미설정</span>'
      +'<div class="muted" style="font-size:11.5px;margin-top:4px">GEMINI_API_KEY 가 등록되지 않았습니다. [설정] 화면의 AI 상태 카드를 참고하세요. 사진 첨부·수동 채점은 그대로 사용할 수 있습니다.</div>');
    return;
  }

  const sid=td.dataset.s,qid=td.dataset.q;
  let subs=[];
  try{subs=await db.listSubmissions(sid,qid);}catch(e){/* 조회 실패는 아래에서 안내 */}
  const sub=subs&&subs.length?subs[0]:null;

  const modeChip=status.mode==='tags_only'
    ?'<span class="chip blue" title="점수 제안 없이 감점 태그만 받습니다(앵커링 방지)">태그만</span>'
    :'<span class="chip purple">점수 제안 포함</span>';

  if(!sub){
    set(modeChip+'<div class="muted" style="font-size:11.5px;margin-top:4px">이 학생의 답안 제출물이 없습니다. 학생이 [첨삭 이력] 화면에서 답안 사진을 올리면 분석할 수 있습니다.</div>');
    return;
  }

  /* 제출 원본 썸네일. AI 전사가 실패해도 강사가 답안을 직접 볼 수 있어야 한다 —
     전사 정확도를 검증할 방법이 없는 채로 AI 판단에 기대면 안 된다.
     서명 URL 은 hydrateSignedPhotos 가 채운다(버킷만 answer-sheets 로 지정). */
  const paths=Array.isArray(sub.image_paths)?sub.image_paths:[];
  const photos=paths.length
    ?'<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">'
      +paths.map(p=>`<span data-photo-path="${esc(p)}" data-photo-bucket="answer-sheets" data-photo-height="130"><span class="muted" style="font-size:11px">사진 불러오는 중...</span></span>`).join('')
      +'</div>'
    :(sub.answer_text?'<div class="muted" style="font-size:11.5px;margin-top:4px">직접 입력한 답안입니다(사진 없음).</div>':'');

  set(modeChip+' <span class="muted" style="font-size:11px">제출 '+esc(fmtDate(sub.submitted_at))+'</span>'
    +photos
    +'<div style="margin-top:6px"><button type="button" class="btn line sm ai_run" data-stage="transcribe">1. 답안 전사</button> '
    +'<button type="button" class="btn line sm ai_run" data-stage="grade">2. '+(rubricMode?'채점':'감점')+' 분석</button></div>'
    +(sub.ocr_text?'<div class="muted" style="font-size:11.5px;margin-top:4px">전사 결과가 이미 있습니다(재실행 시 갱신).</div>':'')
    +'<div class="ai_out" style="margin-top:6px"></div>');
  hydrateSignedPhotos(panel);   // 답안 원본도 private 버킷이라 서명 URL 이 필요하다

  panel.querySelectorAll('.ai_run').forEach(btn=>btn.addEventListener('click',async()=>{
    const out=panel.querySelector('.ai_out');
    const stage=btn.dataset.stage;
    panel.querySelectorAll('.ai_run').forEach(b=>b.disabled=true);
    out.innerHTML='<span class="muted" style="font-size:11.5px">분석 중... (10~30초 걸릴 수 있습니다)</span>';
    try{
      const r=await db.runGrading(sub.id,stage);
      const run=r&&r.run;
      if(!run){out.innerHTML='<span class="msg err">응답이 비어 있습니다.</span>';return;}
      if(run.status==='failed'){
        out.innerHTML='<div class="msg err">실패: '+esc(run.error_text||'알 수 없는 오류')+'</div>'
          +'<div class="muted" style="font-size:11px;margin-top:4px">다시 시도하거나, 계속 실패하면 사진 화질을 확인하세요.</div>';
        return;
      }
      renderAiResult(out,run,stage,td,markTag);
    }catch(e){
      out.innerHTML='<div class="msg err">'+esc(e?.message||'오류')+'</div>';
    }finally{
      panel.querySelectorAll('.ai_run').forEach(b=>b.disabled=false);
    }
  }));
}

/* AI 결과 표시 — 회색 점선 상자로 "아직 확정 아님"을 시각적으로 못박는다. */
function renderAiResult(out,run,stage,td,markTag){
  const boxStyle='border:1.5px dashed var(--line);border-radius:9px;padding:8px;background:#FAFAFB;color:var(--ink-2)';
  if(stage==='transcribe'){
    out.innerHTML='<div style="'+boxStyle+'">'
      +'<div style="font-size:11px;font-weight:700;margin-bottom:4px">AI 전사 (미확정)</div>'
      +'<div style="font-size:12px;white-space:pre-wrap">'+esc(run.feedback_text||'(내용 없음)')+'</div>'
      +(run.confidence!=null?'<div class="muted" style="font-size:11px;margin-top:4px">판독 확신도 '+Math.round(run.confidence*100)+'%</div>':'')
      +'</div>';
    return;
  }
  const tags=run.wrong_reason_tags||[];
  const rb=run.rubric_breakdown||{};
  out.innerHTML='<div style="'+boxStyle+'">'
    +'<div style="font-size:11px;font-weight:700;margin-bottom:4px">AI 제안 (미확정 · 강사 확인 필요)</div>'
    +(tags.length?'<div style="margin-bottom:4px">'+tags.map(t=>'<span class="chip amber" style="margin-right:4px">'+esc(t)+'</span>').join('')+'</div>'
      :'<div class="muted" style="font-size:12px">감점 사유 없음으로 판단</div>')
    +(run.suggested_score!=null?'<div style="font-size:12px">제안 점수: <b>'+esc(run.suggested_score)+'</b></div>':'')
    +(run.feedback_text?'<div style="font-size:12px;margin-top:4px">'+esc(run.feedback_text)+'</div>':'')
    +(rb.evidence?'<div class="muted" style="font-size:11px;margin-top:4px">근거: '+esc(rb.evidence)+'</div>':'')
    +(run.confidence!=null?'<div class="muted" style="font-size:11px;margin-top:2px">확신도 '+Math.round(run.confidence*100)+'%</div>':'')
    +'<div style="margin-top:6px"><button type="button" class="btn sm ai_apply">이 제안 반영</button>'
    +' <span class="muted" style="font-size:11px">누르기 전에는 아무것도 저장되지 않습니다 · 반영해도 강사 메모는 덮어쓰지 않습니다</span></div>'
    +'<div class="ai_apply_msg msg"></div></div>';

  out.querySelector('.ai_apply')?.addEventListener('click',async()=>{
    const m=out.querySelector('.ai_apply_msg');m.className='msg';m.textContent='';
    const inp=td.querySelector('input');
    const scoreVal=run.suggested_score!=null?Number(run.suggested_score):(inp.value===''?null:Number(inp.value));
    try{
      // final_comment 는 grading_reviews 에만 남는다 — scores.reason_note 는 건드리지 않는다(api/grade-review.js).
      const r=await db.submitGradeReview({grading_run_id:run.id,final_score:scoreVal,
        final_tags:tags,final_comment:run.feedback_text||null});
      // 화면에도 즉시 반영(서버는 scores 에 이미 기록됨)
      if(scoreVal!=null){inp.value=String(scoreVal);inp.dispatchEvent(new Event('input',{bubbles:true}));}
      if(tags.length)markTag(tags[0]);
      // 무엇이 저장됐는지 정확히 알린다 — tags_only 모드에서는 점수가 없어도 태그는 들어간다.
      const saved=[];
      if(r&&r.wrote_score)saved.push('점수 '+scoreVal);
      if(r&&r.wrote_tags)saved.push('오답원인 '+tags[0]);
      m.className=saved.length?'msg ok':'msg';
      m.textContent=saved.length
        ?('채점에 반영: '+saved.join(' · ')+' (강사 메모는 그대로)')
        :'반영할 점수·태그가 없어 채점에는 저장하지 않았습니다(AI 확정 기록만 남습니다).';
    }catch(e){m.className='msg err';m.textContent='반영 실패: '+(e?.message||'오류');}
  });
}

// openBankPicker 는 버튼 클릭으로만 열리는 경로라 테스트에서 직접 호출할 수 있게 함께 내보낸다.
export { renderTests, renderSessions, renderQuestionDef, renderScoreGrid, openTagMenu, openBankPicker, initAiSection };
