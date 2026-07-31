/* 주간테스트 — 회차 / 문항 정의 / 채점 그리드 / 감점 태그 */
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
        <button class="btn line sm" id="qadd">${svg('plus','sm')}문항 추가</button>
        <div><span id="ptsum" class="chip gray"></span> <button class="btn" id="qsave">${svg('check','sm')}문항 저장</button></div>
      </div>
      <div id="qmsg" class="msg"></div>
    </div>`;
  const tb=body.querySelector('#qdef tbody');
  function addRow(q){
    const tr=document.createElement('tr');
    tr.innerHTML=`<td class="qnocell num"></td>
      <td><select class="q_unit field" style="width:100%;padding:6px 8px;border:1.5px solid var(--line);border-radius:7px">${UNITS.map(u=>`<option ${q&&q.unit===u?'selected':''}>${esc(u)}</option>`).join('')}</select></td>
      <td><select class="q_cog field" style="width:100%;padding:6px 8px;border:1.5px solid var(--line);border-radius:7px">${COGNITIONS.map(v=>`<option ${q&&q.cognition===v?'selected':''}>${esc(v)}</option>`).join('')}</select></td>
      <td><input class="q_pts" type="number" min="0" value="${q?esc(q.points):0}" style="width:76px;padding:6px 8px;border:1.5px solid var(--line);border-radius:7px"></td>
      <td><input class="q_src" value="${q&&q.source?esc(q.source):''}" placeholder="예: 수특 미적분 6-12" style="width:100%;padding:6px 8px;border:1.5px solid var(--line);border-radius:7px"></td>
      <td><button class="btn danger icon q_del">${svg('trash','xs')}</button></td>`;
    tr.querySelector('.q_del').addEventListener('click',()=>{tr.remove();renumber();});
    tr.querySelector('.q_pts').addEventListener('input',updateSum);
    tb.appendChild(tr);
  }
  function renumber(){[...tb.children].forEach((tr,i)=>tr.querySelector('.qnocell').textContent=i+1);updateSum();}
  function updateSum(){let sum=0;tb.querySelectorAll('.q_pts').forEach(i=>sum+=Number(i.value)||0);
    const el=$('ptsum');el.textContent='배점 합계 '+sum+' / 총점 '+sess.total_score;
    el.className='chip '+(sum===Number(sess.total_score)?'green':'red');}
  (questions.length?questions:[{unit:UNITS[0],cognition:COGNITIONS[0],points:0,source:null}]).forEach(addRow);
  renumber();
  $('qadd').addEventListener('click',()=>{addRow({unit:UNITS[0],cognition:COGNITIONS[0],points:0,source:null});renumber();});
  $('qsave').addEventListener('click',async()=>{
    const m=$('qmsg');m.className='msg';m.textContent='';
    const rows=[];let bad=false;
    [...tb.children].forEach((tr,i)=>{const pts=Number(tr.querySelector('.q_pts').value);if(isNaN(pts)||pts<0)bad=true;
      rows.push({no:i+1,unit:tr.querySelector('.q_unit').value,cognition:tr.querySelector('.q_cog').value,points:pts,source:tr.querySelector('.q_src').value.trim()||null});});
    if(!rows.length){m.className='msg err';m.textContent='문항이 없습니다.';return;}
    if(bad){m.className='msg err';m.textContent='배점을 확인하세요.';return;}
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

  const head=`<thead><tr><th class="corner">학생 \\ 문항</th>${questions.map(q=>`<th><span class="qno">${q.no}</span><span class="qmeta">${esc(q.unit.slice(0,4))}·${esc(q.cognition)}</span><span class="qmeta">${q.points}점</span></th>`).join('')}<th class="corner" style="left:auto;position:sticky;right:0">합계</th></tr></thead>`;
  const rowsHTML=students.map((st,ri)=>`<tr><th class="stu">${esc(st.name)}</th>${questions.map((q,ci)=>{
    const sc=scMap[q.id+'|'+st.id];const val=sc?sc.earned:'';const tag=sc&&sc.wrong_reason?sc.wrong_reason:'';const note=sc&&sc.reason_note?sc.reason_note:'';const photo=sc&&sc.photo_url?sc.photo_url:'';
    return `<td class="scell" data-r="${ri}" data-c="${ci}" data-q="${esc(q.id)}" data-s="${esc(st.id)}" data-max="${q.points}" data-tag="${esc(tag)}" data-note="${esc(note)}" data-photo="${esc(photo)}">
      ${tag||note||photo?'<span class="tagdot" title="'+esc(tag||'메모/사진')+'"></span>':''}
      <input type="number" min="0" max="${q.points}" value="${val}" data-r="${ri}" data-c="${ci}">
      <button class="tagbtn" title="오답원인 태그">${svg('tag','xs')}</button></td>`;}).join('')}<td class="rowtot" data-rowtot="${ri}">0</td></tr>`).join('');
  const footHTML=`<tfoot><tr><th class="corner">문항 정답률</th>${questions.map((q,ci)=>`<td data-colrate="${ci}">-</td>`).join('')}<td></td></tr></tfoot>`;
  body.innerHTML=`<div class="card"><h3>${svg('grid')}${sess.week_no}주차 채점 <span class="sub">셀에 득점 입력 · 방향키 이동 · 태그 버튼으로 오답원인</span></h3>
    <div class="gridwrap"><table class="score-grid">${head}<tbody>${rowsHTML}</tbody>${footHTML}</table></div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">
      <div class="muted" style="font-size:12px">부분점수 허용(0~배점). 범위 밖은 빨강 표시.</div>
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
  grid.querySelectorAll('.tagbtn').forEach(btn=>btn.addEventListener('click',()=>{
    const td=btn.closest('td.scell');openTagMenu(td);}));
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
function openTagMenu(td){
  const curTag=td.dataset.tag||'',curNote=td.dataset.note||'',curPhoto=td.dataset.photo||'';
  let selTag=curTag,removePhoto=false;
  const panel=document.createElement('div');
  panel.style.cssText='position:fixed;z-index:100;background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);padding:12px;width:280px;max-height:80vh;overflow:auto';
  panel.innerHTML=`
    <div style="font-size:12px;font-weight:700;margin-bottom:6px">오답 원인</div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px">
      ${['(없음)',...WRONG_REASONS].map(r=>{const v=(r==='(없음)'?'':r);return `<button type="button" class="btn line sm tm_tag" data-r="${esc(v)}" style="${v===selTag?'border-color:var(--purple);color:var(--purple)':''}">${esc(r)}</button>`;}).join('')}
    </div>
    <div style="font-size:12px;font-weight:700;margin-bottom:4px">강사 메모</div>
    <textarea class="tm_note" rows="2" style="width:100%;padding:8px;border:1.5px solid var(--line);border-radius:8px;margin-bottom:10px" placeholder="감점 사유·피드백">${esc(curNote)}</textarea>
    <div style="font-size:12px;font-weight:700;margin-bottom:4px">사진 첨부</div>
    <div class="tm_photo" style="margin-bottom:8px">${curPhoto?`<div><span data-photo-path="${esc(storagePathFromValue(curPhoto))}" class="muted" style="font-size:11px">사진 불러오는 중...</span> <button type="button" class="btn danger sm tm_rmphoto">사진 삭제</button></div>`:''}</div>
    <input type="file" class="tm_file" accept="image/*" style="font-size:12px;margin-bottom:10px">
    <div style="display:flex;gap:6px;justify-content:flex-end"><button type="button" class="btn line sm tm_close">닫기</button><button type="button" class="btn sm tm_save">저장</button></div>
    <div class="tm_msg msg" style="margin-top:6px"></div>`;
  const rect=td.getBoundingClientRect();panel.style.left=Math.min(rect.left,window.innerWidth-300)+'px';panel.style.top=Math.min(rect.bottom+4,window.innerHeight-220)+'px';
  document.body.appendChild(panel);
  hydrateSignedPhotos(panel);   // private 버킷이라 서명 URL 을 받아 채운다
  const close=()=>{panel.remove();document.removeEventListener('mousedown',out,true);};
  const out=e=>{if(!panel.contains(e.target))close();};
  setTimeout(()=>document.addEventListener('mousedown',out,true),0);
  panel.querySelectorAll('.tm_tag').forEach(b=>b.addEventListener('click',()=>{selTag=b.dataset.r;
    panel.querySelectorAll('.tm_tag').forEach(x=>x.style.cssText='');b.style.cssText='border-color:var(--purple);color:var(--purple)';}));
  panel.querySelector('.tm_rmphoto')?.addEventListener('click',()=>{removePhoto=true;panel.querySelector('.tm_photo').innerHTML='<span class="muted" style="font-size:12px">사진을 삭제합니다(저장 시 반영).</span>';});
  panel.querySelector('.tm_close').addEventListener('click',close);
  panel.querySelector('.tm_save').addEventListener('click',async()=>{
    const m=panel.querySelector('.tm_msg');m.className='tm_msg msg';m.textContent='';
    const inp=td.querySelector('input');const v=inp.value;
    if(v===''||isNaN(Number(v))){m.className='tm_msg msg err';m.textContent='점수를 먼저 입력하세요.';return;}
    const earned=Number(v);const note=panel.querySelector('.tm_note').value.trim()||null;
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
    try{await db.saveScores([{question_id:td.dataset.q,student_id:td.dataset.s,earned,wrong_reason:selTag||null,reason_note:note,photo_url:photoUrl}]);
      td.dataset.tag=selTag||'';td.dataset.note=note||'';td.dataset.photo=photoUrl||'';
      let dot=td.querySelector('.tagdot');const hasMark=selTag||note||photoUrl;
      if(hasMark){if(!dot){dot=document.createElement('span');dot.className='tagdot';td.appendChild(dot);}dot.title=selTag||'메모/사진';}
      else if(dot)dot.remove();
      if(demoPhoto){m.className='tm_msg msg ok';m.textContent='데모 모드에서는 사진이 저장되지 않습니다. (메모·태그는 반영)';}
      else close();
    }catch(e){m.className='tm_msg msg err';m.textContent='저장 실패: '+(e?.message||'오류');}
  });
}

export { renderTests, renderSessions, renderQuestionDef, renderScoreGrid, openTagMenu };
