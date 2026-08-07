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
/* 실제 상담은 15~20분이다. 서버(api/counsel-transcribe.js)가 10MB 이하는 인라인,
   그 위는 Gemini Files API 로 올리므로 여기서는 100MB 까지 받는다.
   20분이면 휴대폰 기본 128kbps AAC 라도 약 19MB 라 한참 여유가 있다. */
const MAX_AUDIO_MB=100;
const AI_CHIP={uploaded:'<span class="chip gray">전사 대기</span>',transcribed:'<span class="chip blue">전사됨</span>',
  failed:'<span class="chip red">전사 실패</span>',blocked:'<span class="chip amber">차단됨</span>'};

async function renderCounseling(c){
  if(app.cur.role!=='admin'){c.innerHTML='<p class="muted">권한이 없습니다.</p>';return;}
  c.innerHTML=await studentSelector()+'<p class="muted">불러오는 중...</p>';bindStudentSelector(()=>{app.counselEdit=null;renderCounseling(c);});
  const sid=app.cur.studentId;if(!sid){c.querySelector('p').textContent='학생을 선택하세요.';return;}
  const notes=await db.listCounseling(sid);
  const stu=(await db.listStudents()).find(s=>s.id===sid)||{};
  const ai=await db.getAiStatus();
  const editing=app.counselEdit?notes.find(n=>n.id===app.counselEdit):null;

  const consent=!!stu.recording_consent;
  const consentChip=consent
    ?`<span class="chip green">✅ 녹음 동의 완료${stu.recording_consent_at?' ('+esc(fmtDate(stu.recording_consent_at))+')':''}</span>`
    :'<span class="chip amber">⚠️ 녹음 동의 없음 — 업로드 불가</span>';
  // 업로드를 막는 사유. 있으면 버튼을 비활성화하고 사유를 그대로 보여준다.
  const block=app.DEMO?'데모 모드에서는 녹음을 업로드하지 않습니다.'
    :(!consent?'이 학생의 녹음 동의가 없습니다. [학생 관리] 화면에서 동의를 먼저 등록하세요.'
    :((!ai||!ai.configured)?'AI 기능 미설정 — GEMINI_API_KEY 가 등록되지 않았습니다. [설정] 화면의 AI 상태 카드를 참고하세요.':''));

  const timeline=notes.length?notes.map(n=>`<div class="timeline-item">
      <div class="th"><div><span class="chip ${COUNSEL_CLS[n.category]||'gray'}">${esc(n.category)}</span> <span class="muted" style="font-size:12px;margin-left:6px">${esc(fmtDate(n.note_date))}</span>${n.visible_to_student?' <span class="chip green">학생 공개</span>':''}${n.ai_status?' '+(AI_CHIP[n.ai_status]||''):''}${n.audio_path?' <span title="녹음 있음">🎧</span>':(n.audio_purged_at?' <span class="muted" style="font-size:11.5px">음성 삭제됨</span>':'')}</div>
        <div><button class="btn line sm cn_edit" data-id="${esc(n.id)}">수정</button> <button class="btn danger sm cn_del" data-id="${esc(n.id)}">삭제</button></div></div>
      <div style="font-size:13.5px;white-space:pre-wrap;line-height:1.6">${esc(n.content)}</div>
      ${n.follow_up?`<div style="margin-top:8px;padding:8px 10px;background:var(--bg);border-radius:8px;font-size:12.5px"><b>후속 조치</b> · ${esc(n.follow_up)}</div>`:''}
      ${n.transcript?`<details style="margin-top:8px"><summary style="cursor:pointer;font-size:12.5px;font-weight:700">전사문 보기</summary>
        <div style="margin-top:6px;padding:8px 10px;background:var(--bg);border:1px dashed var(--line);border-radius:8px;font-size:12.5px;white-space:pre-wrap;line-height:1.6;max-height:320px;overflow:auto">${esc(n.transcript)}</div></details>`:''}
    </div>`).join(''):'<p class="muted">상담 기록이 없습니다.</p>';

  c.innerHTML=await studentSelector()+`
    <div class="selectbar" style="margin-top:-8px"><span class="chip gray">상담 ${notes.length}회</span> ${consentChip}</div>
    <div class="card"><h3>${svg('spark')}녹음 업로드 · 전사</h3>
      <div class="muted" style="font-size:11.5px;margin-bottom:8px">녹음을 올리면 상담 기록이 먼저 만들어지고(내용 '(정돈 대기)'), 전사문이 붙습니다. 확정 내용은 강사가 아래 폼에서 직접 정돈합니다. 보통 길이인 15~20분 상담은 그대로 처리됩니다(${MAX_AUDIO_MB}MB 이하). 모노·낮은 비트레이트로 녹음하면 파일이 작아져 업로드가 빠릅니다.</div>
      <div class="row"><div class="field" style="flex:1"><label>녹음 파일</label><input id="cu_file" type="file" accept="audio/*" ${block?'disabled':''}></div>
        <button class="btn" id="cu_go" ${block?'disabled':''}>${svg('spark','sm')}올리고 전사하기</button></div>
      ${block?`<div class="muted" style="font-size:11.5px;margin-top:6px">${esc(block)}</div>`:''}
      <div id="cu_msg" class="msg"></div>
    </div>
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
  $('cu_go')?.addEventListener('click',()=>uploadAndTranscribe(c,sid));

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

/* 녹음 업로드 → 전사.
   순서: 상담 기록 행 생성 → Storage 업로드 → audio_path 기록 → /api/counsel-transcribe

   ★ 어느 단계에서 실패해도 만들어진 행을 지우지 않는다. 강사가 그 행을 열어
     손으로 이어 쓸 수 있어야 한다(전사 실패가 상담 기록 소실이 되면 안 된다). */
async function uploadAndTranscribe(c,sid){
  const m=$('cu_msg'),btn=$('cu_go'),file=$('cu_file').files[0];
  m.className='msg';m.textContent='';
  if(!file){m.className='msg err';m.textContent='녹음 파일을 선택하세요.';return;}
  if(file.size>MAX_AUDIO_MB*1024*1024){
    m.className='msg err';
    m.textContent=`녹음은 ${MAX_AUDIO_MB}MB 이하만 올릴 수 있습니다(현재 ${(file.size/1048576).toFixed(1)}MB). 모노·낮은 비트레이트로 다시 녹음하거나 나눠서 올리세요.`;return;}
  // 업로드·전사는 몇 분 걸린다. 그 사이 버튼과 파일 선택을 모두 잠근다
  // (버튼만 잠그면 파일을 바꿔치기한 뒤 다시 눌릴 여지가 남는다).
  const fileInput=$('cu_file');
  btn.disabled=true;fileInput.disabled=true;
  let noteId=null,cls='msg ok',txt='';
  try{
    m.textContent='기록 준비 중...';
    // content 가 not null 이라 확정 전에는 자리표시 문구를 넣는다(제약은 완화하지 않는다).
    const note=await db.insertCounseling({student_id:sid,note_date:todayStr(),category:COUNSEL_CATS[0],
      content:'(정돈 대기)',follow_up:null,visible_to_student:false,ai_status:'uploaded'});
    if(!note||!note.id)throw new Error('상담 기록 id 를 받지 못했습니다.');
    noteId=note.id;

    m.textContent=`업로드 중... (${(file.size/1048576).toFixed(1)}MB)`;
    const ext=(file.name.split('.').pop()||'m4a').toLowerCase();
    // 경로 최상위를 학생 id 로 둔다 — 서명 URL 소유자 확인 규칙과 같은 형식이다.
    const path=sid+'/'+noteId+'_'+Date.now()+'.'+ext;
    const up=await app.sb.storage.from('counseling-audio').upload(path,file);
    if(up.error)throw up.error;
    await db.updateCounseling(noteId,{audio_path:path});

    // 아직 실측 전이라 단정하지 않는다. 파일럿 뒤 실제 값으로 바꾼다.
    m.textContent='전사 중... (20분 녹음이면 1~3분 정도 걸릴 수 있습니다. 창을 닫지 마세요)';
    const r=await db.transcribeCounseling(noteId);
    // MAX_TOKENS 는 코드를 그대로 보여줘야 강사가 할 수 있는 일이 없다 — 풀어 쓴다.
    if(r&&r.ok===false){cls='msg err';txt=r.blocked==='MAX_TOKENS'
      ?'녹음이 너무 길어 전사가 중간에 끊겼습니다. 파일을 나눠 올리거나 더 짧게 녹음해 주세요. 기록은 남아 있으니 내용을 직접 입력하셔도 됩니다.'
      :'전사가 차단되었습니다('+(r.blocked||'사유 불명')+'). 기록은 남아 있으니 내용을 직접 입력하세요.';}
    else{txt='전사 완료 · '+((r&&r.transcript_len)||0)+'자. 이력에서 전사문을 확인하고 내용을 정돈하세요.';}
  }catch(e){
    cls='msg err';
    txt='실패: '+(e?.message||'오류')+(noteId?' — 상담 기록은 남아 있습니다. 아래 이력에서 직접 이어 쓰세요.':'');
  }
  finally{btn.disabled=false;fileInput.disabled=false;}
  // 이력을 새로 그린 뒤 결과 문구를 다시 붙인다(재렌더가 메시지를 지우기 때문).
  await renderCounseling(c);
  const m2=$('cu_msg');if(m2){m2.className=cls;m2.textContent=txt;}
}

/* 학생 화면: 공개된 상담 내역만 읽기 전용 표시.
   ★ listCounseling(select('*')) 을 쓰지 마라 — transcript·ai_draft·audio_path 가
     응답에 통째로 실려 학생에게 내려간다. RLS 는 행 단위라 이를 막지 못한다. */
async function renderStudentCounsel(c){
  const sid=app.cur.studentId;if(!sid){c.innerHTML='<p class="muted">학생 정보를 찾을 수 없습니다.</p>';return;}
  const notes=await db.listStudentCounseling(sid);
  const list=notes.length?notes.map(n=>`<div class="timeline-item">
      <div class="th"><div><span class="chip ${COUNSEL_CLS[n.category]||'gray'}">${esc(n.category)}</span> <span class="muted" style="font-size:12px;margin-left:6px">${esc(fmtDate(n.note_date))}</span></div></div>
      <div style="font-size:13.5px;white-space:pre-wrap;line-height:1.6">${esc(n.content)}</div>
      ${n.follow_up?`<div style="margin-top:8px;padding:8px 10px;background:var(--bg);border-radius:8px;font-size:12.5px"><b>후속</b> · ${esc(n.follow_up)}</div>`:''}
    </div>`).join(''):'<p class="muted">공개된 상담 내역이 없습니다.</p>';
  c.innerHTML=`<div class="card"><h3>${svg('chat')}상담 내역</h3>${list}</div>`;
}

export { COUNSEL_CATS, COUNSEL_CLS, renderCounseling, renderStudentCounsel };
