/* 상담 기록 */
import { db } from '../db.js';
import { svg } from '../icons.js';
import { app } from '../state.js';
import { bindStudentSelector, studentSelector } from '../ui.js';
import { $, esc, fmtDate, todayStr } from '../util.js';

/* ═══════════════════════════════════════════════════════════════════
   2.5) 상담 기록 (관리자 전용 — 학생·학부모 화면 미노출)
   ═══════════════════════════════════════════════════════════════════ */
const COUNSEL_CATS=['정기상담','학부모상담','진로·지원상담','기타'];
const COUNSEL_CLS={'정기상담':'blue','학부모상담':'purple','진로·지원상담':'green','기타':'gray'};

async function renderCounseling(c){
  if(app.cur.role!=='admin'){c.innerHTML='<p class="muted">권한이 없습니다.</p>';return;}
  c.innerHTML=await studentSelector()+'<p class="muted">불러오는 중...</p>';bindStudentSelector(()=>{app.counselEdit=null;renderCounseling(c);});
  const sid=app.cur.studentId;if(!sid){c.querySelector('p').textContent='학생을 선택하세요.';return;}
  const notes=await db.listCounseling(sid);
  const editing=app.counselEdit?notes.find(n=>n.id===app.counselEdit):null;

  const timeline=notes.length?notes.map(n=>`<div class="timeline-item">
      <div class="th"><div><span class="chip ${COUNSEL_CLS[n.category]||'gray'}">${esc(n.category)}</span> <span class="muted" style="font-size:12px;margin-left:6px">${esc(fmtDate(n.note_date))}</span>${n.visible_to_student?' <span class="chip green">학생 공개</span>':''}</div>
        <div><button class="btn line sm cn_edit" data-id="${esc(n.id)}">수정</button> <button class="btn danger sm cn_del" data-id="${esc(n.id)}">삭제</button></div></div>
      <div style="font-size:13.5px;white-space:pre-wrap;line-height:1.6">${esc(n.content)}</div>
      ${n.follow_up?`<div style="margin-top:8px;padding:8px 10px;background:var(--bg);border-radius:8px;font-size:12.5px"><b>후속 조치</b> · ${esc(n.follow_up)}</div>`:''}
    </div>`).join(''):'<p class="muted">상담 기록이 없습니다.</p>';

  c.innerHTML=await studentSelector()+`
    <div class="selectbar" style="margin-top:-8px"><span class="chip gray">상담 ${notes.length}회</span></div>
    <div class="card"><h3>${svg('chat')}${editing?'상담 기록 수정':'새 상담 기록'}</h3>
      <div class="row">
        <div class="field"><label>날짜</label><input id="cn_date" type="date" value="${editing?esc(fmtDate(editing.note_date)):todayStr()}"></div>
        <div class="field"><label>유형</label><select id="cn_cat">${COUNSEL_CATS.map(k=>`<option ${editing&&editing.category===k?'selected':''}>${esc(k)}</option>`).join('')}</select></div>
      </div>
      <div class="field" style="margin-top:8px"><label>상담 내용</label><textarea id="cn_content" rows="3" style="padding:9px 11px;border:1.5px solid var(--line);border-radius:9px">${editing?esc(editing.content):''}</textarea></div>
      <div class="field"><label>후속 조치(선택)</label><textarea id="cn_follow" rows="2" style="padding:9px 11px;border:1.5px solid var(--line);border-radius:9px">${editing&&editing.follow_up?esc(editing.follow_up):''}</textarea></div>
      <div class="field" style="margin-top:2px"><label style="display:flex;align-items:center;gap:7px;cursor:pointer"><input type="checkbox" id="cn_visible" ${editing&&editing.visible_to_student?'checked':''}> 학생에게 공개</label></div>
      <button class="btn" id="cn_save">${svg('check','sm')}${editing?'수정 저장':'기록 저장'}</button>
      ${editing?'<button class="btn line" id="cn_cancel">취소</button>':''}
      <div id="cn_msg" class="msg"></div>
    </div>
    <div class="card"><h3>${svg('clock')}상담 이력 (최신순)</h3>${timeline}</div>`;
  bindStudentSelector(()=>{app.counselEdit=null;renderCounseling(c);});

  $('cn_save').addEventListener('click',async()=>{
    const m=$('cn_msg');m.className='msg';m.textContent='';
    const content=$('cn_content').value.trim();
    if(!content){m.className='msg err';m.textContent='상담 내용을 입력하세요.';return;}
    const payload={note_date:$('cn_date').value,category:$('cn_cat').value,content,follow_up:$('cn_follow').value.trim()||null,visible_to_student:$('cn_visible').checked};
    try{if(editing){await db.updateCounseling(editing.id,payload);app.counselEdit=null;}
      else{await db.insertCounseling(Object.assign({student_id:sid},payload));}
      m.className='msg ok';m.textContent='저장되었습니다.';renderCounseling(c);}
    catch(e){m.className='msg err';m.textContent='실패: '+(e?.message||'오류');}
  });
  $('cn_cancel')?.addEventListener('click',()=>{app.counselEdit=null;renderCounseling(c);});
  c.querySelectorAll('.cn_edit').forEach(b=>b.addEventListener('click',()=>{app.counselEdit=b.dataset.id;renderCounseling(c);}));
  c.querySelectorAll('.cn_del').forEach(b=>b.addEventListener('click',async()=>{
    try{await db.deleteCounseling(b.dataset.id);if(app.counselEdit===b.dataset.id)app.counselEdit=null;renderCounseling(c);}catch(e){alert('삭제 실패: '+(e?.message||'오류'));}}));
}
// 학생 화면: 공개된 상담 내역만 읽기 전용 표시
async function renderStudentCounsel(c){
  const sid=app.cur.studentId;if(!sid){c.innerHTML='<p class="muted">학생 정보를 찾을 수 없습니다.</p>';return;}
  const notes=(await db.listCounseling(sid)).filter(n=>n.visible_to_student);
  const list=notes.length?notes.map(n=>`<div class="timeline-item">
      <div class="th"><div><span class="chip ${COUNSEL_CLS[n.category]||'gray'}">${esc(n.category)}</span> <span class="muted" style="font-size:12px;margin-left:6px">${esc(fmtDate(n.note_date))}</span></div></div>
      <div style="font-size:13.5px;white-space:pre-wrap;line-height:1.6">${esc(n.content)}</div>
      ${n.follow_up?`<div style="margin-top:8px;padding:8px 10px;background:var(--bg);border-radius:8px;font-size:12.5px"><b>후속</b> · ${esc(n.follow_up)}</div>`:''}
    </div>`).join(''):'<p class="muted">공개된 상담 내역이 없습니다.</p>';
  c.innerHTML=`<div class="card"><h3>${svg('chat')}상담 내역</h3>${list}</div>`;
}

export { COUNSEL_CATS, COUNSEL_CLS, renderCounseling, renderStudentCounsel };
