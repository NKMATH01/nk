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

/* ─── 브라우저 내 녹음 ─────────────────────────────────────────────
   형식을 audio/webm;codecs=opus 로 **고정**한다. 브라우저가 고르게 두지 않는다.

   실측(2026-08-07, 같은 음성을 형식만 바꿔 올려 전사시킨 결과)
     · wav                      → 345자, 11초. 정상
     · webm/opus(32kbps 모노)   → 346자,  3초. 정상
     · m4a(AAC/MP4 컨테이너)    → 전사문이 '[불명]' 4자. 실패
   그런데 이 브라우저의 MediaRecorder.isTypeSupported 는
     'audio/webm;codecs=opus' true · 'audio/webm' true · 'audio/mp4' **true**
   를 돌려준다. 즉 형식을 지정하지 않으면 브라우저가 mp4 를 고를 수 있고, 그러면
   녹음도 업로드도 성공한 것처럼 보이는데 전사문만 비는 **조용한 실패**가 된다.

   그래서 mp4 폴백을 두지 않는다 — 실패하는 것을 이미 아는 경로로 떨어뜨리지 않는다.
   webm/opus 를 지원하지 않는 브라우저에서는 녹음 버튼을 비활성화하고 파일 업로드로
   안내한다(파일 업로드 경로는 그대로 살아 있다).

   opus 32kbps 모노는 1분에 약 0.2MB 라 20분 녹음도 약 4MB —
   서버의 인라인 경로(10MB) 안쪽이라 미검증인 Files API 경로를 타지 않는다. */
const REC_MIME='audio/webm;codecs=opus';
const REC_BPS=32000;
function canRecord(){
  try{return !!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia
    &&typeof MediaRecorder!=='undefined'&&MediaRecorder.isTypeSupported(REC_MIME));}
  catch(e){return false;}
}

/* 녹음 상태는 **모듈 스코프**에 둔다.
   renderCounseling 이 innerHTML 을 통째로 갈아끼워도 MediaRecorder·스트림·타이머는
   DOM 이 아니라 여기에 매달려 있으므로 녹음이 끊기지 않는다. 경과 시간 타이머도 매 틱
   $('cu_time') 을 다시 찾으므로 재렌더된 새 노드에 그대로 이어 쓴다. */
const REC={state:'idle',rec:null,stream:null,chunks:[],startedAt:0,durSec:0,timer:null,blob:null,url:null,sid:null};
const mmss=s=>String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
const recElapsed=()=>Math.max(0,Math.floor((Date.now()-REC.startedAt)/1000));
function recTick(){const t=$('cu_time');if(t)t.textContent=mmss(recElapsed());}
// 녹음 중 페이지를 벗어나면 그때까지 받은 소리가 통째로 사라진다 — 브라우저 경고를 띄운다.
function recGuard(e){e.preventDefault();e.returnValue='';return '';}
function recStopStream(){if(REC.stream){REC.stream.getTracks().forEach(t=>t.stop());REC.stream=null;}}

/* 녹음/미리듣기를 모두 정리하고 idle 로 되돌린다. 다시 녹음·버리기·업로드 후에 쓴다. */
function recDiscard(){
  if(REC.timer){clearInterval(REC.timer);REC.timer=null;}
  if(REC.rec&&REC.state==='recording'){try{REC.rec.onstop=null;REC.rec.stop();}catch(e){}}
  recStopStream();
  if(REC.url){URL.revokeObjectURL(REC.url);REC.url=null;}
  window.removeEventListener('beforeunload',recGuard);
  REC.rec=null;REC.chunks=[];REC.blob=null;REC.durSec=0;REC.sid=null;REC.state='idle';
}

async function startRec(c,sid){
  const m=$('cu_msg');if(m){m.className='msg';m.textContent='';}
  recDiscard();   // [다시 녹음] 으로 들어오면 앞의 미리듣기를 먼저 버린다
  let stream;
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});
  }catch(e){
    const n=e&&e.name;const m2=$('cu_msg');if(!m2)return;
    m2.className='msg err';
    m2.textContent=n==='NotAllowedError'?'마이크 사용이 거부되었습니다. 주소창의 자물쇠 아이콘에서 마이크를 허용한 뒤 다시 시도하세요.'
      :n==='NotFoundError'?'마이크를 찾을 수 없습니다. 마이크가 연결되어 있는지 확인하세요.'
      :'마이크를 열 수 없습니다: '+(e?.message||'오류');
    return;
  }
  try{REC.rec=new MediaRecorder(stream,{mimeType:REC_MIME,audioBitsPerSecond:REC_BPS});}
  catch(e){
    stream.getTracks().forEach(t=>t.stop());
    const m3=$('cu_msg');if(m3){m3.className='msg err';m3.textContent='이 브라우저는 녹음을 지원하지 않습니다. 녹음 파일을 올려 주세요.';}
    return;
  }
  REC.stream=stream;REC.chunks=[];REC.sid=sid;REC.startedAt=Date.now();REC.durSec=0;REC.state='recording';
  REC.rec.ondataavailable=ev=>{if(ev.data&&ev.data.size)REC.chunks.push(ev.data);};
  REC.rec.onstop=async()=>{
    REC.durSec=recElapsed();
    if(REC.timer){clearInterval(REC.timer);REC.timer=null;}
    recStopStream();window.removeEventListener('beforeunload',recGuard);
    // Blob 의 type 에는 codecs 파라미터를 붙이지 않는다 — 이 값이 Storage 의 content-type 이 된다.
    REC.blob=new Blob(REC.chunks,{type:'audio/webm'});REC.chunks=[];REC.rec=null;
    REC.url=URL.createObjectURL(REC.blob);REC.state='ready';
    await renderCounseling(c);
    const m4=$('cu_msg');
    if(m4){m4.className='msg ok';
      m4.textContent='녹음 '+mmss(REC.durSec)+' ('+(REC.blob.size/1048576).toFixed(1)+'MB) 완료. 들어본 뒤 올리세요.';}
  };
  REC.rec.start(1000);   // 1초마다 조각을 받아 둔다 — 중간에 탭이 죽어도 받은 만큼은 남는다
  REC.timer=setInterval(recTick,1000);
  window.addEventListener('beforeunload',recGuard);
  await renderCounseling(c);
}
function stopRec(){if(REC.rec&&REC.state==='recording'){try{REC.rec.stop();}catch(e){}}}

async function renderCounseling(c){
  if(app.cur.role!=='admin'){c.innerHTML='<p class="muted">권한이 없습니다.</p>';return;}
  // 녹음 중 / 미리듣기가 남은 동안에는 학생을 바꿀 수 없다. 목록을 읽어 오는 이 짧은
  // 구간에도 셀렉트가 열려 있으면 그 틈으로 바뀔 수 있어 여기서부터 잠근다.
  const recOn=REC.state==='recording',recReady=REC.state==='ready'&&!!REC.blob,recBusy=recOn||recReady;
  c.innerHTML=await studentSelector()+'<p class="muted">불러오는 중...</p>';bindStudentSelector(()=>{app.counselEdit=null;renderCounseling(c);});
  if(recBusy){const s0=$('stuSel');if(s0)s0.disabled=true;}
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
  // ★ 녹음 자체는 막지 않는다 — 데모에서도 녹음·미리듣기는 되고 저장만 하지 않는다.
  const block=app.DEMO?'데모 모드에서는 녹음만 되고 업로드·전사는 하지 않습니다.'
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

  // 녹음 상태에 따라 카드 윗단이 셋 중 하나로 그려진다(녹음 중 / 미리듣기 / 대기).
  const recOk=canRecord();
  const recPane=recOn
    ?`<div class="row" style="align-items:center;gap:10px">
        <button class="btn danger" id="cu_stop">■ 정지</button>
        <span style="display:inline-flex;align-items:center;gap:6px;color:var(--red);font-weight:700;font-size:12.5px"><span style="width:9px;height:9px;border-radius:50%;background:var(--red);display:inline-block"></span>녹음 중</span>
        <span id="cu_time" style="font-weight:700;font-size:15px">${mmss(recElapsed())}</span>
      </div>
      <div class="muted" style="font-size:11.5px;margin-top:6px">녹음이 끝날 때까지 학생 선택과 페이지 이동이 잠깁니다. 상담 상대에게 녹음 중임을 알려 주세요.</div>`
    :recReady
    ?`<div class="row" style="align-items:center;gap:10px">
        <audio id="cu_play" controls src="${REC.url}" style="height:34px;max-width:280px"></audio>
        <span id="cu_time" style="font-weight:700;font-size:15px">${mmss(REC.durSec)}</span>
        <span class="muted" style="font-size:11.5px">${(REC.blob.size/1048576).toFixed(1)}MB</span>
      </div>
      <div class="row" style="margin-top:8px">
        <button class="btn" id="cu_recgo" ${block?'disabled':''}>${svg('spark','sm')}올리고 전사하기</button>
        <button class="btn line" id="cu_again">● 다시 녹음</button>
        <button class="btn line" id="cu_drop">녹음 버리기</button>
      </div>
      <div class="muted" style="font-size:11.5px;margin-top:6px">올리기 전까지는 저장되지 않습니다. 들어보고 이상하면 다시 녹음하세요.</div>`
    :`<div class="row" style="align-items:center;gap:10px">
        <button class="btn" id="cu_rec" ${recOk?'':'disabled'}>● 녹음 시작</button>
        <span id="cu_time" style="font-weight:700;font-size:15px">00:00</span>
      </div>
      ${recOk?'':'<div class="muted" style="font-size:11.5px;margin-top:6px">이 브라우저는 녹음을 지원하지 않습니다. 녹음 파일을 올려 주세요.</div>'}`;

  c.innerHTML=await studentSelector()+`
    <div class="selectbar" style="margin-top:-8px"><span class="chip gray">상담 ${notes.length}회</span> ${consentChip}</div>
    <div class="card"><h3>${svg('spark')}녹음 · 전사</h3>
      <div class="muted" style="font-size:11.5px;margin-bottom:10px">이 화면에서 바로 녹음하거나, 이미 녹음한 파일을 올릴 수 있습니다. 어느 쪽이든 상담 기록이 먼저 만들어지고(내용 '(정돈 대기)'), 전사문이 붙습니다. 확정 내용은 강사가 아래 폼에서 직접 정돈합니다. 보통 길이인 15~20분 상담은 그대로 처리됩니다(${MAX_AUDIO_MB}MB 이하).</div>
      ${recPane}
      <div style="border-top:1px dashed var(--line);margin:12px 0"></div>
      <div class="row"><div class="field" style="flex:1"><label>녹음 파일 올리기</label><input id="cu_file" type="file" accept="audio/*" ${block?'disabled':''}></div>
        <button class="btn line" id="cu_go" ${block?'disabled':''}>${svg('spark','sm')}올리고 전사하기</button></div>
      <div class="muted" style="font-size:11.5px;margin-top:6px">wav · webm · mp3 를 권장합니다. <b>m4a 는 전사되지 않는 경우가 있습니다</b>(실측). 모노·낮은 비트레이트로 녹음하면 파일이 작아져 업로드가 빠릅니다.</div>
      <div id="cu_warn" class="msg" style="color:var(--amber)"></div>
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
  // 녹음본이 남아 있는 동안에는 학생을 바꾸지 못하게 한다 — A 의 녹음이 B 의 기록으로
  // 붙는 사고를 막는다. [녹음 버리기] 나 업로드가 끝나면 다시 풀린다.
  if(recBusy){const ss=$('stuSel');if(ss)ss.disabled=true;}
  $('cu_rec')?.addEventListener('click',()=>startRec(c,sid));
  $('cu_again')?.addEventListener('click',()=>startRec(c,sid));
  $('cu_stop')?.addEventListener('click',stopRec);
  $('cu_drop')?.addEventListener('click',()=>{recDiscard();renderCounseling(c);});
  $('cu_recgo')?.addEventListener('click',()=>{if(REC.blob)uploadAndTranscribe(c,sid,REC.blob,'webm',true);});
  $('cu_go')?.addEventListener('click',()=>{
    const f=$('cu_file').files[0];
    if(!f){const m=$('cu_msg');m.className='msg err';m.textContent='녹음 파일을 선택하세요.';return;}
    uploadAndTranscribe(c,sid,f,(f.name.split('.').pop()||'m4a').toLowerCase(),false);
  });
  // m4a·mp4 는 실측에서 전사가 '[불명]' 으로 나왔다. 막지는 않는다(될 수도 있다) — 미리 알린다.
  $('cu_file')?.addEventListener('change',()=>{
    const w=$('cu_warn');if(!w)return;
    const f=$('cu_file').files[0],ex=f?(f.name.split('.').pop()||'').toLowerCase():'';
    w.textContent=(ex==='m4a'||ex==='mp4')
      ?'m4a·mp4 는 전사가 되지 않는 경우가 있습니다(실측). 그대로 올려도 되지만, 실패하면 형식 때문일 수 있으니 wav·webm·mp3 로 다시 올려 주세요.':'';
  });

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

/* 녹음 업로드 → 전사. **파일 선택과 브라우저 녹음이 같은 함수를 쓴다** —
   기록 생성 → Storage 업로드 → audio_path 기록 → /api/counsel-transcribe 까지
   두 경로가 완전히 같아서 나눠 둘 이유가 없다.
     blob   업로드할 File 또는 녹음 Blob
     ext    저장 경로 확장자(파일은 원본 확장자, 녹음은 항상 'webm')
     fromRec 녹음 경로인지 — 업로드가 끝난 뒤 미리듣기를 정리할지 판단한다

   ★ 어느 단계에서 실패해도 만들어진 행을 지우지 않는다. 강사가 그 행을 열어
     손으로 이어 쓸 수 있어야 한다(전사 실패가 상담 기록 소실이 되면 안 된다). */
async function uploadAndTranscribe(c,sid,blob,ext,fromRec){
  const m=$('cu_msg');
  m.className='msg';m.textContent='';
  if(!blob||!blob.size){m.className='msg err';m.textContent='올릴 녹음이 없습니다.';return;}
  if(blob.size>MAX_AUDIO_MB*1024*1024){
    m.className='msg err';
    m.textContent=`녹음은 ${MAX_AUDIO_MB}MB 이하만 올릴 수 있습니다(현재 ${(blob.size/1048576).toFixed(1)}MB). 모노·낮은 비트레이트로 다시 녹음하거나 나눠서 올리세요.`;return;}
  // 업로드·전사는 몇 분 걸린다. 그 사이 카드의 조작 요소를 전부 잠근다
  // (버튼만 잠그면 파일을 바꿔치기하거나 새로 녹음을 시작할 여지가 남는다).
  const ctl=[...c.querySelectorAll('#cu_go,#cu_file,#cu_rec,#cu_recgo,#cu_again,#cu_drop')];
  ctl.forEach(el=>el.disabled=true);
  let noteId=null,cls='msg ok',txt='';
  try{
    m.textContent='기록 준비 중...';
    // content 가 not null 이라 확정 전에는 자리표시 문구를 넣는다(제약은 완화하지 않는다).
    const note=await db.insertCounseling({student_id:sid,note_date:todayStr(),category:COUNSEL_CATS[0],
      content:'(정돈 대기)',follow_up:null,visible_to_student:false,ai_status:'uploaded'});
    if(!note||!note.id)throw new Error('상담 기록 id 를 받지 못했습니다.');
    noteId=note.id;

    m.textContent=`업로드 중... (${(blob.size/1048576).toFixed(1)}MB)`;
    // 경로 최상위를 학생 id 로 둔다 — 서명 URL 소유자 확인 규칙과 같은 형식이다.
    const path=sid+'/'+noteId+'_'+Date.now()+'.'+(ext||'webm');
    const up=await app.sb.storage.from('counseling-audio').upload(path,blob);
    if(up.error)throw up.error;
    await db.updateCounseling(noteId,{audio_path:path});
    // 여기까지 오면 음성은 서버에 있다 — 브라우저의 미리듣기는 더 붙들고 있을 이유가 없다.
    // (업로드 전에 실패하면 recDiscard 를 부르지 않으므로 녹음이 남아 다시 시도할 수 있다.)
    if(fromRec)recDiscard();

    // 아직 실측 전이라 단정하지 않는다. 파일럿 뒤 실제 값으로 바꾼다.
    m.textContent='전사 중... (20분 녹음이면 1~3분 정도 걸릴 수 있습니다. 창을 닫지 마세요)';
    const r=await db.transcribeCounseling(noteId);
    // 실패는 둘로 갈린다 — ① 차단(blocked) ② 인식 실패(failed). 강사가 할 일이 다르다.
    // MAX_TOKENS 는 코드를 그대로 보여줘야 강사가 할 수 있는 일이 없다 — 풀어 쓴다.
    if(r&&r.ok===false){cls='msg err';
      txt=r.ai_status==='failed'
        ?(r.message||'오디오를 알아듣지 못했습니다.')+' (보낸 형식: '+(r.mime_used||'불명')+') 기록과 전사 결과는 남아 있으니 이력에서 확인하고 내용을 직접 입력하세요.'
        :r.blocked==='MAX_TOKENS'
        ?'녹음이 너무 길어 전사가 중간에 끊겼습니다. 파일을 나눠 올리거나 더 짧게 녹음해 주세요. 기록은 남아 있으니 내용을 직접 입력하셔도 됩니다.'
        :'전사가 차단되었습니다('+(r.blocked||'사유 불명')+'). 기록은 남아 있으니 내용을 직접 입력하세요.';}
    else{txt='전사 완료 · '+((r&&r.transcript_len)||0)+'자. 이력에서 전사문을 확인하고 내용을 정돈하세요.';}
  }catch(e){
    cls='msg err';
    txt='실패: '+(e?.message||'오류')+(noteId?' — 상담 기록은 남아 있습니다. 아래 이력에서 직접 이어 쓰세요.':'');
  }
  finally{ctl.forEach(el=>{el.disabled=false;});}
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
