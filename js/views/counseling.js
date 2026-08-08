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
/* 학생·학부모 화면에 보이는 본문 한 줄 규칙 — **두 화면이 같은 문장을 봐야 한다.**
   public_text(강사가 확정한 공개용 문장)가 있으면 그것, 없으면 content 로 폴백한다.
   ★ 폴백을 빼지 마라. public_text 는 0021 에서 생긴 컬럼이라 그 전에 쌓인 상담 기록에는
     전부 비어 있다. 폴백이 없으면 공개 표시된 과거 상담이 화면에서 통째로 사라진다.
   ★ ai_draft.student_safe_text 는 여기에 들어오지 않는다. 그건 강사가 확인하지 않았을 수
     있는 초안이고, 애초에 조회 화이트리스트(js/db.js COUNSEL_SAFE_COLS)에 없다. */
const counselPublicBody=n=>String(n.public_text||'').trim()||String(n.content||'').trim();
/* 실제 상담은 15~20분이다. 서버(api/counsel-transcribe.js)가 10MB 이하는 인라인,
   그 위는 Gemini Files API 로 올리므로 여기서는 100MB 까지 받는다.
   20분이면 휴대폰 기본 128kbps AAC 라도 약 19MB 라 한참 여유가 있다. */
const MAX_AUDIO_MB=100;
const AI_CHIP={uploaded:'<span class="chip gray">전사 대기</span>',transcribed:'<span class="chip blue">전사됨</span>',
  drafted:'<span class="chip green">초안 있음</span>',
  failed:'<span class="chip red">전사 실패</span>',blocked:'<span class="chip amber">차단됨</span>'};
/* ai_status 하나로는 **어느 단계가** 실패했는지 알 수 없다 — 전사 실패도 정돈 실패도
   'failed' 다(0015 가 정한 값 집합을 늘리지 않는다). 전사문이 남아 있으면 전사는 성공한
   것이므로 정돈 단계의 실패로 읽어 표시한다. "전사 실패" 라고 적힌 기록에 전사문이
   붙어 있으면 강사가 무엇을 해야 할지 판단할 수 없다. */
const AI_CHIP_LATE={failed:'<span class="chip red">정돈 실패</span>',blocked:'<span class="chip amber">정돈 차단됨</span>'};
function aiChip(n){
  if(!n.ai_status)return '';
  if(n.transcript&&AI_CHIP_LATE[n.ai_status])return AI_CHIP_LATE[n.ai_status];
  return AI_CHIP[n.ai_status]||'';
}

/* AI 초안 상자 — 회색 점선으로 강사 입력과 시각적으로 갈라 둔다
   (채점 패널 js/views/tests.js·리포트 초안 js/views/report.js 와 같은 관례).

   ★ 유형(category)은 **칩으로 제안만** 한다. 폼의 select 를 자동으로 바꾸지 않는다.
     유형은 상담 통계의 집계 축이라, AI 가 기본값을 정하면 강사가 손대지 않은 값이
     그대로 집계에 섞여 통계가 조용히 왜곡된다(설계서 9절의 결정). */
const DRAFT_BOX='border:1.5px dashed var(--line);border-radius:9px;padding:10px;background:#FAFAFB;margin-top:8px';
function draftBox(n){
  const d=n.ai_draft;if(!d)return '';
  const list=a=>(Array.isArray(a)&&a.length)
    ?'<ul style="margin:2px 0 0;padding-left:17px">'+a.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>'
    :'<div class="muted" style="font-size:12px">(없음)</div>';
  const safe=String(d.student_safe_text||'').trim();
  return `<div style="${DRAFT_BOX}">
    <div style="font-size:11px;font-weight:700;margin-bottom:6px">AI 초안 (미확정 · 강사 확인 필요)</div>
    <div style="font-size:12.5px"><b>요약</b>${d.category?` <span class="chip ${COUNSEL_CLS[d.category]||'gray'}">AI 제안: ${esc(d.category)}</span>`:''}
      <div style="white-space:pre-wrap;margin-top:2px">${esc(d.summary||'')}</div></div>
    <div style="font-size:12.5px;margin-top:6px"><b>주요 논점</b>${list(d.key_points)}</div>
    <div style="font-size:12.5px;margin-top:6px"><b>후속 조치 후보</b>${list(d.follow_ups)}</div>
    <div style="font-size:12.5px;margin-top:6px"><b>공개용 문장 (학부모·학생)</b>
      <div style="white-space:pre-wrap;margin-top:2px">${safe?esc(safe):'<span class="muted">(공개할 만한 문장이 없다고 판단됨)</span>'}</div></div>
    <div class="row" style="margin-top:8px">
      <button class="btn sm cd_take" data-id="${esc(n.id)}">초안 가져오기</button>
      ${safe?`<button class="btn line sm cd_safe" data-id="${esc(n.id)}">공개용 문장 가져오기</button>`:''}
    </div>
    <div class="muted" style="font-size:11px;margin-top:6px">가져온 뒤 고치고 [수정 저장]을 눌러야 기록에 남습니다. 유형은 제안일 뿐이니 폼에서 직접 고르세요.</div>
  </div>`;
}

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
  /* 정돈(AI 초안)을 막는 사유는 업로드와 다르다 — 녹음 동의는 이미 업로드 때 확인했고,
     여기서 다루는 것은 서버에 남아 있는 전사문뿐이라 동의를 다시 볼 일이 없다. */
  const draftBlock=app.DEMO?'데모 모드에서는 AI 정돈을 실행하지 않습니다.'
    :((!ai||!ai.configured)?'AI 기능 미설정 — GEMINI_API_KEY 가 등록되지 않았습니다.':'');

  const timeline=notes.length?notes.map(n=>`<div class="timeline-item">
      <div class="th"><div><span class="chip ${COUNSEL_CLS[n.category]||'gray'}">${esc(n.category)}</span> <span class="muted" style="font-size:12px;margin-left:6px">${esc(fmtDate(n.note_date))}</span>${n.visible_to_student?' <span class="chip green">학생·학부모 공개</span>':''}${n.ai_status?' '+aiChip(n):''}${n.audio_path?' <span title="녹음 있음">🎧</span>':(n.audio_purged_at?' <span class="muted" style="font-size:11.5px">음성 삭제됨</span>':'')}</div>
        <div><button class="btn line sm cn_edit" data-id="${esc(n.id)}">수정</button>${n.audio_path?` <button class="btn line sm cn_purge" data-id="${esc(n.id)}" title="음성 원본만 지웁니다. 전사문과 상담 기록은 남습니다.">음성 삭제 (되돌릴 수 없음)</button>`:''} <button class="btn danger sm cn_del" data-id="${esc(n.id)}">삭제</button></div></div>
      <div style="font-size:13.5px;white-space:pre-wrap;line-height:1.6">${esc(n.content)}</div>
      ${n.follow_up?`<div style="margin-top:8px;padding:8px 10px;background:var(--bg);border-radius:8px;font-size:12.5px"><b>후속 조치</b> · ${esc(n.follow_up)}</div>`:''}
      ${n.transcript?`<details style="margin-top:8px"><summary style="cursor:pointer;font-size:12.5px;font-weight:700">전사문 보기</summary>
        <div style="margin-top:6px;padding:8px 10px;background:var(--bg);border:1px dashed var(--line);border-radius:8px;font-size:12.5px;white-space:pre-wrap;line-height:1.6;max-height:320px;overflow:auto">${esc(n.transcript)}</div></details>`:''}
      ${n.transcript?`<div class="row" style="margin-top:8px;align-items:center;gap:8px">
        <button class="btn line sm cd_run" data-id="${esc(n.id)}" ${draftBlock?'disabled':''}>${svg('spark','sm')}${n.ai_draft?'AI로 다시 정돈하기':'AI로 정돈하기'}</button>
        ${draftBlock?`<span class="muted" style="font-size:11.5px">${esc(draftBlock)}</span>`:''}
      </div>
      <div id="cd_out_${esc(n.id)}">${draftBox(n)}</div>`:''}
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
      <div class="field" style="margin-top:2px"><label style="display:flex;align-items:center;gap:7px;cursor:pointer"><input type="checkbox" id="cn_visible" ${editing&&editing.visible_to_student?'checked':''}> 학생·학부모에게 공개</label>
        <div class="card-cap tight">체크하면 <b>학생 화면과 학부모 화면</b> 양쪽에 이 기록이 보입니다(유형과 무관합니다). 나가는 것은 날짜·유형·아래 <b>공개용 문장</b>(비어 있으면 상담 내용)·후속 조치뿐이며, <b>녹음 전사문과 AI 초안은 나가지 않습니다.</b></div></div>
      <div class="field" id="cn_pubwrap"><label>학부모·학생 공개용 문장 (선택)</label>
        <textarea id="cn_public" rows="3" style="padding:9px 11px;border:1.5px solid var(--line);border-radius:9px">${editing&&editing.public_text?esc(editing.public_text):''}</textarea>
        <div class="card-cap tight">비워 두면 위의 <b>상담 내용</b>이 그대로 보입니다. 상담 내용에 다른 학생·가정사 같은 이야기가 섞였을 때 여기에 따로 적으세요. AI 초안이 있으면 이력의 [공개용 문장 가져오기] 로 채운 뒤 고칠 수 있습니다.</div>
        <div class="card-cap tight" id="cn_puboff" style="display:none;color:var(--amber)">지금은 [학생·학부모에게 공개] 가 꺼져 있어 이 문장은 아무에게도 보이지 않습니다.</div></div>
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
  // stu 를 그대로 넘긴다 — uploadAndTranscribe 가 업로드 전에 녹음 동의를 다시 본다.
  $('cu_recgo')?.addEventListener('click',()=>{if(REC.blob)uploadAndTranscribe(c,sid,stu,REC.blob,'webm',true);});
  $('cu_go')?.addEventListener('click',()=>{
    const f=$('cu_file').files[0];
    if(!f){const m=$('cu_msg');m.className='msg err';m.textContent='녹음 파일을 선택하세요.';return;}
    uploadAndTranscribe(c,sid,stu,f,(f.name.split('.').pop()||'m4a').toLowerCase(),false);
  });
  // m4a·mp4 는 실측에서 전사가 '[불명]' 으로 나왔다. 막지는 않는다(될 수도 있다) — 미리 알린다.
  $('cu_file')?.addEventListener('change',()=>{
    const w=$('cu_warn');if(!w)return;
    const f=$('cu_file').files[0],ex=f?(f.name.split('.').pop()||'').toLowerCase():'';
    w.textContent=(ex==='m4a'||ex==='mp4')
      ?'m4a·mp4 는 전사가 되지 않는 경우가 있습니다(실측). 그대로 올려도 되지만, 실패하면 형식 때문일 수 있으니 wav·webm·mp3 로 다시 올려 주세요.':'';
  });

  /* 공개 체크가 꺼져 있으면 공개용 문장 칸은 아무 데도 쓰이지 않는다 — 흐리게 하고
     그 사실을 적어 둔다. 값은 지우지 않는다(체크를 다시 켜면 그대로 살아야 한다). */
  const syncPubVisible=()=>{
    const cb=$('cn_visible'),w=$('cn_pubwrap'),off=$('cn_puboff');
    if(!cb||!w)return;
    w.style.opacity=cb.checked?'':'.55';
    if(off)off.style.display=cb.checked?'none':'';
  };
  $('cn_visible')?.addEventListener('change',syncPubVisible);
  syncPubVisible();

  $('cn_save').addEventListener('click',async()=>{
    const m=$('cn_msg');m.className='msg';m.textContent='';
    const content=$('cn_content').value.trim();
    if(!content){m.className='msg err';m.textContent='상담 내용을 입력하세요.';return;}
    /* public_text 는 **강사가 확정한** 공개 문장이다. 빈 칸은 null 로 저장하고,
       학부모·학생 화면은 그때 content 로 폴백한다(js/views/parent.js·renderStudentCounsel).
       이 폴백이 없으면 public_text 가 비어 있는 **지금까지의 상담 기록이 전부**
       학부모 화면에서 사라진다. AI 초안이 이 값으로 자동으로 들어오는 경로는 없다 —
       강사가 [공개용 문장 가져오기] 로 폼에 채우고 다시 저장해야 한다. */
    const payload={note_date:$('cn_date').value,category:$('cn_cat').value,content,
      public_text:$('cn_public').value.trim()||null,
      follow_up:$('cn_follow').value.trim()||null,visible_to_student:$('cn_visible').checked};
    /* confirmed_at 은 30일 음성 자동 삭제(3차 counsel-purge)의 카운트 기준점이다.
       조건 없이 일괄로 찍는다 — 녹음에서 온 행만 찍으면 '찍히지 않은 행'이 다시 생기고,
       수기 기록은 audio_path 가 없어 애초에 purge 대상이 아니라 무해하다.
       ★ 수정 저장 때는 이미 있는 값을 덮지 않는다. 기준은 **최초 확정 시각**이며,
         수정할 때마다 뒤로 밀리면 30일이 영영 오지 않는다. */
    if(!(editing&&editing.confirmed_at))payload.confirmed_at=new Date().toISOString();
    try{if(editing){await db.updateCounseling(editing.id,payload);app.counselEdit=null;}
      else{await db.insertCounseling(Object.assign({student_id:sid},payload));}
      m.className='msg ok';m.textContent='저장되었습니다.';renderCounseling(c);}
    catch(e){m.className='msg err';m.textContent='실패: '+(e?.message||'오류');}
  });
  $('cn_cancel')?.addEventListener('click',()=>{app.counselEdit=null;renderCounseling(c);});
  c.querySelectorAll('.cn_edit').forEach(b=>b.addEventListener('click',()=>{app.counselEdit=b.dataset.id;renderCounseling(c);}));
  c.querySelectorAll('.cn_del').forEach(b=>b.addEventListener('click',async()=>{
    try{await db.deleteCounseling(b.dataset.id);if(app.counselEdit===b.dataset.id)app.counselEdit=null;renderCounseling(c);}catch(e){alert('삭제 실패: '+(e?.message||'오류'));}}));
  /* [음성 삭제] — 음성 원본만 지우고 전사문·상담 기록은 남긴다.
     삭제 요구가 늘 기록 전체 삭제는 아니다. "녹음만 지워 달라"는 요구에 상담 기록까지
     잃을 이유가 없어 [삭제] 와 따로 둔다.
     되돌릴 수 없지만 확인 모달은 띄우지 않는다 — 위 [삭제] 를 비롯한 기존 삭제 버튼이
     모두 모달 없이 바로 실행한다. 대신 버튼 문구에 그 사실을 적어 둔다. */
  c.querySelectorAll('.cn_purge').forEach(b=>b.addEventListener('click',async()=>{
    const n=notes.find(x=>x.id===b.dataset.id);if(!n||!n.audio_path)return;
    b.disabled=true;
    try{await db.purgeCounselingAudio(n.id,n.audio_path);renderCounseling(c);}
    catch(e){b.disabled=false;alert('음성 삭제 실패: '+(e?.message||'오류'));}}));

  /* [AI로 정돈하기] — 전사 버튼과 **분리**돼 있다. 전사는 성공했는데 정돈이 실패해도
     전사문은 남아야 하기 때문이다(설계서 0절 원칙 2). 그래서 전사 직후 자동으로
     이어 부르지도 않는다 — 강사가 전사문을 보고 나서 누른다.
     ★ 버튼의 조건은 ai_status 가 아니라 **전사문의 존재**다. 서버도 transcript 가 없으면
       400 을 돌려주고, 정돈이 blocked/failed 로 끝난 기록도 전사문이 남아 있으면
       다시 시도할 수 있어야 한다. */
  c.querySelectorAll('.cd_run').forEach(b=>b.addEventListener('click',()=>runDraft(c,b.dataset.id)));

  /* [초안 가져오기] — 폼에 **채우기만** 한다. 저장은 강사가 [수정 저장] 을 눌러야 일어난다(2단계).
     ★ 편집 대상을 먼저 그 기록으로 바꾼다. 입력 폼은 화면에 하나뿐이라, 편집 대상이
       다른 상태에서 채우면 초안이 엉뚱한 기록에 붙거나 새 기록으로 저장된다
       (녹음에서 만들어진 '(정돈 대기)' 행은 그대로 남고 중복이 생긴다). */
  c.querySelectorAll('.cd_take').forEach(b=>b.addEventListener('click',async()=>{
    const n=notes.find(x=>x.id===b.dataset.id);if(!n||!n.ai_draft)return;
    const d=n.ai_draft;
    app.counselEdit=n.id;
    await renderCounseling(c);
    const ta=$('cn_content');
    if(ta)ta.value=[String(d.summary||'').trim(),
      (Array.isArray(d.key_points)&&d.key_points.length)?d.key_points.map(x=>'· '+x).join('\n'):'']
      .filter(Boolean).join('\n\n');
    const fu=$('cn_follow');
    if(fu&&Array.isArray(d.follow_ups)&&d.follow_ups.length)fu.value=d.follow_ups.map(x=>'· '+x).join('\n');
    const m=$('cn_msg');
    if(m){m.className='msg';m.textContent='초안을 폼에 넣었습니다. 확인·수정한 뒤 [수정 저장]을 누르세요. 유형은 AI 제안을 참고해 직접 고르시면 됩니다.';}
  }));

  /* [공개용 문장 가져오기] — 초안의 student_safe_text 를 **공개용 문장 칸에만** 채운다.
     ★ 이 버튼은 상담 기록 화면에 하나뿐이다. 종전에는 같은 버튼이 이 문장을 상담 내용
       뒤에 덧붙였는데, 공개용 문장을 담을 자리(public_text, 0021)가 생겼으므로 그쪽으로
       옮긴다 — 버튼을 새로 만들지 않는다(같은 일을 하는 버튼이 둘이면 안 된다).
     ★ 채우기만 한다. 저장은 강사가 [수정 저장] 을 눌러야 일어난다(2단계). AI 초안이
       강사 확인 없이 확정 필드로 가는 경로를 만들지 않는다는 원칙 그대로다.
     ★ 공개 체크박스는 건드리지 않는다. 공개 여부는 강사가 정할 일이라,
       버튼 하나로 학생·학부모에게 보이는 상태가 되면 안 된다. */
  c.querySelectorAll('.cd_safe').forEach(b=>b.addEventListener('click',async()=>{
    const n=notes.find(x=>x.id===b.dataset.id);if(!n||!n.ai_draft)return;
    const t=String(n.ai_draft.student_safe_text||'').trim();if(!t)return;
    app.counselEdit=n.id;
    await renderCounseling(c);
    const ta=$('cn_public');if(!ta)return;
    const had=!!ta.value.trim();
    ta.value=t;
    const m=$('cn_msg');
    if(m){m.className='msg';
      m.textContent=(had?'공개용 문장 칸에 있던 값을 초안으로 바꿨습니다. ':'초안의 공개용 문장을 폼에 넣었습니다. ')
        +'확인·수정한 뒤 [수정 저장]을 눌러야 기록에 남습니다. 학부모·학생에게 보이려면 [학생·학부모에게 공개]도 체크하세요.';}
  }));
}

/* 전사문 → 구조화 초안. 결과는 서버가 ai_draft 에만 저장한다.
   ★ 여기에도, 서버에도 content·follow_up·category 로 곧장 가는 경로는 없다.
     폼에 들어가려면 강사가 [초안 가져오기] 를 눌러야 하고, 기록에 남으려면 다시
     [수정 저장] 을 눌러야 한다(2단계). */
async function runDraft(c,noteId){
  const box=h=>{const o=$('cd_out_'+noteId);if(o)o.innerHTML=h;};
  if(!$('cd_out_'+noteId))return;
  // 이력 전체의 AI 버튼을 잠근다 — 여러 기록을 동시에 돌리면 어느 결과인지 헷갈린다.
  const ctl=[...c.querySelectorAll('.cd_run,.cd_take,.cd_safe')];
  ctl.forEach(el=>el.disabled=true);
  box(`<div style="${DRAFT_BOX}"><span class="muted" style="font-size:12px">초안 생성 중... 잠시만 기다리세요.</span></div>`);
  try{
    const r=await db.draftCounseling(noteId);
    if(r&&r.ok===false){
      /* 검사기 거부는 오류가 아니라 **결과**다. 무엇이 왜 걸렸는지 그대로 보여 준다 —
         이게 화면에 보여야 패턴이 과도한지 판단하고 조정할 수 있다
         (설계서가 이월해 둔 '검사기 과도 리젝' 항목). 초안은 저장되지 않았다. */
      if(r.reason==='rejected'){
        const rows=(r.issues||[]).map(i=>`<li>${esc(i.field)} — ${esc(i.kind==='forbidden'
          ?'금지 표현('+i.detail+')':'전사문에 없는 숫자('+i.detail+')')}
          <div class="muted" style="font-size:11px">${esc(i.excerpt||'')}</div></li>`).join('');
        box(`<div style="${DRAFT_BOX}"><div style="font-size:11px;font-weight:700;color:var(--red);margin-bottom:4px">검수에 걸려 초안을 저장하지 않았습니다</div>
          <ul style="margin:2px 0 0;padding-left:17px;font-size:12px">${rows||'<li>사유 불명</li>'}</ul>
          <div class="muted" style="font-size:11px;margin-top:6px">다시 시도하거나, 전사문을 보고 직접 정돈하세요. 상담 기록과 전사문은 그대로 남아 있습니다.</div></div>`);
        return;
      }
      const why=r.ai_status==='blocked'
        ?'AI 가 응답을 차단했습니다('+(r.blocked||'사유 불명')+').'
        :(r.message||'AI 가 초안을 만들지 못했습니다.');
      box(`<div style="${DRAFT_BOX}"><div style="font-size:12px;color:var(--red)">${esc(why)}</div>
        <div class="muted" style="font-size:11px;margin-top:4px">전사문은 그대로 남아 있으니 직접 정돈하셔도 됩니다.</div></div>`);
      return;
    }
    await renderCounseling(c);   // 저장된 초안을 이력에서 다시 그린다
  }catch(e){
    box(`<div style="${DRAFT_BOX}"><div style="font-size:12px;color:var(--red)">실패: ${esc(e?.message||'오류')}</div>
      <div class="muted" style="font-size:11px;margin-top:4px">전사문과 상담 기록은 남아 있습니다.</div></div>`);
  }finally{ctl.forEach(el=>{el.disabled=false;});}
}

/* 녹음 업로드 → 전사. **파일 선택과 브라우저 녹음이 같은 함수를 쓴다** —
   기록 생성 → Storage 업로드 → audio_path 기록 → /api/counsel-transcribe 까지
   두 경로가 완전히 같아서 나눠 둘 이유가 없다.
     stu    대상 학생 레코드 — 업로드 전에 녹음 동의를 다시 보는 데 쓴다
     blob   업로드할 File 또는 녹음 Blob
     ext    저장 경로 확장자(파일은 원본 확장자, 녹음은 항상 'webm')
     fromRec 녹음 경로인지 — 업로드가 끝난 뒤 미리듣기를 정리할지 판단한다

   ★ 어느 단계에서 실패해도 만들어진 행을 지우지 않는다. 강사가 그 행을 열어
     손으로 이어 쓸 수 있어야 한다(전사 실패가 상담 기록 소실이 되면 안 된다). */
async function uploadAndTranscribe(c,sid,stu,blob,ext,fromRec){
  const m=$('cu_msg');
  m.className='msg';m.textContent='';
  /* ★ 동의 확인을 **업로드를 시작하기 전에** 한다.
     서버(api/counsel-transcribe.js)도 다시 보지만 그쪽은 전사 진입 직전이라,
     403 이 떨어지는 시점에는 음성이 이미 버킷에 들어가 있다. 버킷의 insert 정책도
     is_admin() 만 볼 뿐 동의는 보지 않는다. 동의 없는 음성은 아예 올리지 않는다. */
  if(!stu||!stu.recording_consent){m.className='msg err';
    m.textContent='이 학생의 녹음 동의가 없습니다. [학생 관리] 화면에서 동의를 먼저 등록한 뒤 올려 주세요.';return;}
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
     응답에 통째로 실려 학생에게 내려간다. RLS 는 행 단위라 이를 막지 못한다.
   ★ 본문은 public_text(강사가 확정한 공개용 문장)를 우선하고, 비어 있으면 content 로
     폴백한다. 폼의 체크박스가 [학생·학부모에게 공개] 라고 적혀 있으므로 학부모 화면과
     같은 문장이 보여야 한다. 폴백이 없으면 public_text 를 쓰지 않은 지금까지의
     기록이 학생 화면에서 통째로 사라진다. */
async function renderStudentCounsel(c){
  const sid=app.cur.studentId;if(!sid){c.innerHTML='<p class="muted">학생 정보를 찾을 수 없습니다.</p>';return;}
  const notes=await db.listStudentCounseling(sid);
  const list=notes.length?notes.map(n=>`<div class="timeline-item">
      <div class="th"><div><span class="chip ${COUNSEL_CLS[n.category]||'gray'}">${esc(n.category)}</span> <span class="muted" style="font-size:12px;margin-left:6px">${esc(fmtDate(n.note_date))}</span></div></div>
      <div style="font-size:13.5px;white-space:pre-wrap;line-height:1.6">${esc(counselPublicBody(n))}</div>
      ${n.follow_up?`<div style="margin-top:8px;padding:8px 10px;background:var(--bg);border-radius:8px;font-size:12.5px"><b>후속</b> · ${esc(n.follow_up)}</div>`:''}
    </div>`).join(''):'<p class="muted">공개된 상담 내역이 없습니다.</p>';
  c.innerHTML=`<div class="card"><h3>${svg('chat')}상담 내역</h3>${list}</div>`;
}

export { COUNSEL_CATS, COUNSEL_CLS, counselPublicBody, renderCounseling, renderStudentCounsel };
