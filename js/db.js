/* 데이터 접근 계층(데모=메모리 / 실서버=Supabase)과 집계 헬퍼.
   401 응답 시 호출하는 doLogout 은 순환 import 를 피하려고 app 을 경유한다. */
import { app } from './state.js';
import { cohortSessionStats, essayTotals, sessionPercentRows, standardizeWeekly } from './calc.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { $, clamp, normPhone, todayStr, uuid } from './util.js';

/* ═══════════════════════════════════════════════════════════════════
   데이터 접근 계층 (데모=메모리 / 실서버=Supabase)
   ═══════════════════════════════════════════════════════════════════ */

/* 세션 토큰을 Authorization 헤더로 달아 Supabase 클라이언트를 만든다.
   PostgREST 가 이 토큰을 검증하고 클레임으로 RLS 를 판별한다.
   토큰이 없으면 anon 클라이언트가 되는데, RLS 적용 후에는 아무것도 읽지 못한다. */
function makeClient(token){
  const opts={auth:{persistSession:false,autoRefreshToken:false}};
  if(token)opts.global={headers:{Authorization:'Bearer '+token}};
  return supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY,opts);
}
/* 현재 세션 토큰으로 app.sb 를 다시 만든다. 로그인·토큰 갱신 직후 반드시 호출한다. */
function applySession(){
  app.sb=makeClient(app.session&&app.session.token);
  return app.sb;
}

function apiErr(prefix,e){console.error(prefix,e);const g=$('globalErr');if(g){g.style.display='block';g.textContent=prefix+': '+(e?.message||'네트워크 오류. 인터넷 연결을 확인하세요.');}return null;}

/* 토큰이 없거나 곧 만료되면 true. RLS 적용 후에는 이 상태에서 조회가
   에러 없이 "빈 결과"로 돌아오기 때문에, 빈 화면의 원인을 구분하는 데 쓴다. */
function sessionSuspect(){
  if(app.DEMO)return false;
  const s=app.session;
  if(!s||!s.token)return true;
  return !(s.exp&&s.exp*1000>Date.now()+30000);
}
function warnSessionExpired(prefix){
  console.warn(prefix+': 결과가 비어 있고 세션이 만료된 것으로 보입니다.');
  const g=$('globalErr');
  if(g){g.style.display='block';g.textContent='세션이 만료되었을 수 있습니다. 다시 로그인하세요.';}
}
/* 조회 결과가 비었는데 세션이 의심스러우면 경고를 띄운다.
   RLS 는 권한이 없을 때 에러 대신 0행을 주므로 이 분기가 없으면 원인을 알 수 없다. */
async function sbq(promise,prefix,fallback){
  try{
    const {data,error}=await promise;if(error)throw error;
    const empty=!data||(Array.isArray(data)&&data.length===0);
    if(empty&&sessionSuspect())warnSessionExpired(prefix);
    return data||fallback;
  }catch(e){apiErr(prefix,e);return fallback;}
}

/* 서버 함수(/api/*) 호출. 계정·비밀번호는 anon 키로 직접 접근하지 않고 여기를 거친다.
   세션 토큰이 있으면 Authorization 헤더로 붙인다. 실패 시 서버 메시지를 그대로 던진다. */
async function apiFetch(path,options){
  const opt=options||{};
  const headers=Object.assign({'Content-Type':'application/json'},opt.headers||{});
  if(app.session&&app.session.token)headers['Authorization']='Bearer '+app.session.token;
  const res=await fetch(path,{method:opt.method||'GET',headers,body:opt.body?JSON.stringify(opt.body):undefined});
  let data=null;try{data=await res.json();}catch(e){}
  if(!res.ok){
    if(res.status===401&&app.session){app.doLogout();}
    throw new Error((data&&data.error)||'서버 오류('+res.status+')');
  }
  return data||{};
}

/* counseling-audio 버킷에서 객체 하나를 지운다(0016 의 삭제 정책이 적용돼 있어야 한다).
   실패하면 던진다 — 부르는 쪽은 이 결과를 확인하기 전에 audio_path 를 지우면 안 된다.

   ★ error 만 보면 안 된다. remove() 는 **RLS 가 허용한 것만** 지우고 지워진 목록을
     돌려준다. 삭제 정책이 없으면 아무것도 지우지 않은 채 error 없이 빈 배열이 온다 —
     그대로 통과시키면 "지웠다고 믿는데 버킷에는 남아 있는" 바로 그 상태가 된다.
     그래서 빈 결과도 실패로 본다.
   그 대가로, 객체가 이미 없는 경로(부분 실패 후 재시도 등)도 실패로 잡힌다. 이 버킷에는
   열람(select) 정책이 없어 "없는 것"과 "권한이 없는 것"을 클라이언트에서 구분할 수
   없기 때문이다. 그 상태가 되면 [삭제]·[음성 삭제] 가 둘 다 막히므로(둘 다 이 함수를
   거친다) 화면에서 풀 방법이 없다 — 0016 적용 여부를 먼저 확인하고, 정말 객체만
   사라진 경우라면 Supabase 콘솔에서 audio_path 를 비워야 한다. 드문 경우로 본다. */
async function removeCounselAudio(path){
  const {data,error}=await app.sb.storage.from('counseling-audio').remove([path]);
  if(error)throw error;
  if(!data||!data.length)throw new Error('음성 파일을 지우지 못했습니다(대상 없음 또는 권한 없음). 마이그레이션 0016 이 적용되었는지 [설정] 화면의 DB 마이그레이션 상태에서 확인하세요.');
}

const db={
  async listStudents(){if(app.DEMO)return app.store.students.slice();return await sbq(app.sb.from('students').select('*').order('created_at'),'학생 조회',[]);},
  async listUniversities(){if(app.DEMO)return app.store.universities.slice();return await sbq(app.sb.from('universities').select('*').order('region').order('name'),'대학 조회',[]);},
  async listTargets(sid){if(app.DEMO)return app.store.student_targets.filter(t=>!sid||t.student_id===sid).slice();
    let q=app.sb.from('student_targets').select('*');if(sid)q=q.eq('student_id',sid);return await sbq(q,'목표대학 조회',[]);},
  async listSessions(){if(app.DEMO)return app.store.test_sessions.slice().sort((a,b)=>a.week_no-b.week_no);
    return await sbq(app.sb.from('test_sessions').select('*').order('week_no'),'회차 조회',[]);},
  async listQuestions(sessionId){if(app.DEMO)return app.store.questions.filter(q=>q.session_id===sessionId).slice().sort((a,b)=>a.no-b.no);
    return await sbq(app.sb.from('questions').select('*').eq('session_id',sessionId).order('no'),'문항 조회',[]);},
  async listAllQuestions(){if(app.DEMO)return app.store.questions.slice();return await sbq(app.sb.from('questions').select('*'),'문항 조회',[]);},
  async listScoresBySession(sessionId,qids){if(app.DEMO)return app.store.scores.filter(s=>qids.includes(s.question_id)).slice();
    if(!qids.length)return [];return await sbq(app.sb.from('scores').select('*').in('question_id',qids),'채점 조회',[]);},
  async listScoresByStudent(sid){if(app.DEMO)return app.store.scores.filter(s=>s.student_id===sid).slice();
    return await sbq(app.sb.from('scores').select('*').eq('student_id',sid),'채점 조회',[]);},
  async listHomework(sid){if(app.DEMO)return app.store.homework_records.filter(h=>h.student_id===sid).slice();
    return await sbq(app.sb.from('homework_records').select('*').eq('student_id',sid),'과제 조회',[]);},
  async listEssays(sid){if(app.DEMO)return app.store.essay_gradings.filter(e=>e.student_id===sid).slice().sort((a,b)=>a.week_date<b.week_date?1:-1);
    return await sbq(app.sb.from('essay_gradings').select('*').eq('student_id',sid).order('week_date',{ascending:false}),'첨삭 조회',[]);},
  async getTeacherComment(sid,weekNo){if(app.DEMO)return app.store.teacher_comments.find(t=>t.student_id===sid&&t.week_no===weekNo)||null;
    return await sbq(app.sb.from('teacher_comments').select('*').eq('student_id',sid).eq('week_no',weekNo).maybeSingle(),'코멘트 조회',null);},
  async listTeacherComments(sid){if(app.DEMO)return app.store.teacher_comments.filter(t=>t.student_id===sid).slice().sort((a,b)=>b.week_no-a.week_no);
    return await sbq(app.sb.from('teacher_comments').select('*').eq('student_id',sid).order('week_no',{ascending:false}),'코멘트 조회',[]);},
  // accounts 는 서버 함수 경유. 브라우저는 password_hash 를 받지 않는다.
  async listAccountsByStudent(sid){if(app.DEMO)return app.store.accounts.filter(a=>a.student_id===sid);
    try{const r=await apiFetch('/api/accounts?student_id='+encodeURIComponent(sid));return r.accounts||[];}
    catch(e){apiErr('계정 조회',e);return [];}},

  async insertStudent(s){if(app.DEMO){const o=Object.assign({id:uuid(),created_at:todayStr()},s);app.store.students.push(o);return o;}
    const {data,error}=await app.sb.from('students').insert(s).select().single();if(error)throw error;return data;},
  async updateStudent(id,patch){if(app.DEMO){const o=app.store.students.find(x=>x.id===id);Object.assign(o,patch);return o;}
    const {error}=await app.sb.from('students').update(patch).eq('id',id);if(error)throw error;},
  async updateUniversity(id,patch){if(app.DEMO){const o=app.store.universities.find(x=>x.id===id);Object.assign(o,patch);return o;}
    const {error}=await app.sb.from('universities').update(patch).eq('id',id);if(error)throw error;},
  async setTargets(sid,list){ // list:[{university_id,priority}]
    if(app.DEMO){app.store.student_targets=app.store.student_targets.filter(t=>t.student_id!==sid);
      list.forEach(l=>app.store.student_targets.push({id:uuid(),student_id:sid,university_id:l.university_id,priority:l.priority}));return;}
    const del=await app.sb.from('student_targets').delete().eq('student_id',sid);if(del.error)throw del.error;
    if(list.length){const {error}=await app.sb.from('student_targets').insert(list.map(l=>({student_id:sid,university_id:l.university_id,priority:l.priority})));if(error)throw error;}},
  async insertSession(s){if(app.DEMO){const o=Object.assign({id:uuid(),created_at:todayStr()},s);app.store.test_sessions.push(o);return o;}
    const {data,error}=await app.sb.from('test_sessions').insert(s).select().single();if(error)throw error;return data;},
  async saveQuestions(sessionId,rows){ // 전체 교체
    if(app.DEMO){app.store.questions=app.store.questions.filter(q=>q.session_id!==sessionId);
      rows.forEach(rw=>app.store.questions.push(Object.assign({id:uuid(),session_id:sessionId},rw)));return;}
    await app.sb.from('questions').delete().eq('session_id',sessionId);
    const {error}=await app.sb.from('questions').insert(rows.map(rw=>Object.assign({session_id:sessionId},rw)));if(error)throw error;},
  async saveScores(rows){ // upsert by (question_id,student_id)
    if(app.DEMO){rows.forEach(rw=>{const ex=app.store.scores.find(s=>s.question_id===rw.question_id&&s.student_id===rw.student_id);
      if(ex)Object.assign(ex,rw);else app.store.scores.push(Object.assign({id:uuid()},rw));});return;}
    const {error}=await app.sb.from('scores').upsert(rows,{onConflict:'question_id,student_id'});if(error)throw error;},
  async insertHomework(h){if(app.DEMO){app.store.homework_records.push(Object.assign({id:uuid(),created_at:todayStr()},h));return;}
    const {error}=await app.sb.from('homework_records').insert(h);if(error)throw error;},
  async deleteHomework(id){if(app.DEMO){app.store.homework_records=app.store.homework_records.filter(h=>h.id!==id);return;}
    const {error}=await app.sb.from('homework_records').delete().eq('id',id);if(error)throw error;},
  // 관리자 전용. select('*') 라 transcript·ai_draft·audio_path 까지 전부 돌아온다.
  // 학생·학부모 화면에서는 절대 쓰지 말 것 — 아래 listStudentCounseling 을 쓴다.
  async listCounseling(sid){if(app.DEMO)return app.store.counseling_notes.filter(n=>n.student_id===sid).slice().sort((a,b)=>a.note_date<b.note_date?1:-1);
    return await sbq(app.sb.from('counseling_notes').select('*').eq('student_id',sid).order('note_date',{ascending:false}),'상담 기록 조회',[]);},
  /* 학생·학부모 경로 전용.
     ★ 여기를 select('*') 로 되돌리지 마라. counseling_notes 의 학생용 RLS(stu_self)는
       **행 단위**라 컬럼을 가려 주지 못한다. 0015 로 생긴 transcript(전사문 원문)·
       ai_draft(미확정 AI 초안)·audio_path 가 그대로 학생 응답에 실려 나간다.
       공개 여부 필터도 서버(PostgREST) 쪽에 건다 — 클라이언트 filter 는 응답이
       이미 브라우저에 도착한 뒤라 유출을 막지 못한다. */
  async listStudentCounseling(sid){
    const COLS='id,note_date,category,content,follow_up,visible_to_student';
    if(app.DEMO)return app.store.counseling_notes.filter(n=>n.student_id===sid&&n.visible_to_student)
      .map(n=>Object.fromEntries(COLS.split(',').map(k=>[k,n[k]]))).sort((a,b)=>a.note_date<b.note_date?1:-1);
    return await sbq(app.sb.from('counseling_notes').select(COLS).eq('student_id',sid)
      .eq('visible_to_student',true).order('note_date',{ascending:false}),'상담 기록 조회',[]);},
  /* 대시보드가 학생별 '최근 상담일' 하나만 쓴다(js/views/dashboard.js).
     ★ select('*') 로 두지 마라. renderDashboard 에는 역할 가드가 없고 라우터 맵은
       역할과 무관해, 학생이 dashboard 로 들어오기만 해도 transcript(전사문 원문)·
       ai_draft·audio_path 가 응답에 실려 나간다. RLS 는 행 단위라 컬럼을 못 가린다.
       쓰는 컬럼 3개로 좁혀 화면이 늘어나도 유출되지 않게 한다. */
  async listAllCounseling(){
    const COLS='id,student_id,note_date';
    if(app.DEMO)return app.store.counseling_notes.map(n=>Object.fromEntries(COLS.split(',').map(k=>[k,n[k]])));
    return await sbq(app.sb.from('counseling_notes').select(COLS),'상담 기록 조회',[]);},
  // 삽입 결과의 id 를 돌려준다 — 녹음 업로드가 저장 경로(<sid>/<note_id>_...)에 쓴다.
  async insertCounseling(n){if(app.DEMO){const o=Object.assign({id:uuid(),created_at:todayStr()},n);app.store.counseling_notes.push(o);return o;}
    const {data,error}=await app.sb.from('counseling_notes').insert(n).select().single();if(error)throw error;return data;},
  async updateCounseling(id,patch){if(app.DEMO){const o=app.store.counseling_notes.find(x=>x.id===id);Object.assign(o,patch);return;}
    const {error}=await app.sb.from('counseling_notes').update(patch).eq('id',id);if(error)throw error;},
  /* 상담 기록 삭제 — **음성 원본을 먼저 지운다.**
     버킷의 객체에 닿는 열쇠는 행의 audio_path 뿐이다. 행을 먼저 지우면 그 경로를
     잃어, 버킷에 남은 미성년자 음성을 다시 찾아낼 방법이 없어진다(지운 줄 아는데
     남아 있고, 남아 있다는 사실조차 시스템이 모른다).
     그래서 순서를 조회 → Storage 삭제 → 행 삭제로 두고, **Storage 삭제가 실패하면
     여기서 던져 행을 남긴다.** 경로가 남아 있으면 다시 시도할 수 있다.
     (0016_counseling_audio_delete 의 삭제 정책이 적용돼 있어야 한다.) */
  async deleteCounseling(id){if(app.DEMO){app.store.counseling_notes=app.store.counseling_notes.filter(n=>n.id!==id);return;}
    const cur=await app.sb.from('counseling_notes').select('audio_path').eq('id',id).maybeSingle();
    if(cur.error)throw cur.error;
    if(cur.data&&cur.data.audio_path)await removeCounselAudio(cur.data.audio_path);
    const {error}=await app.sb.from('counseling_notes').delete().eq('id',id);if(error)throw error;},
  /* 음성만 지운다 — 전사문·확정 기록은 그대로 남긴다.
     삭제 요구가 늘 기록 전체 삭제는 아니다. "녹음만 지워 달라"는 요구에 상담 기록까지
     잃을 이유가 없다. 3차의 counsel-purge Cron 과 같은 처리를 사람이 손으로 하는 것이다. */
  async purgeCounselingAudio(id,path){
    if(app.DEMO){const o=app.store.counseling_notes.find(x=>x.id===id);
      if(o){o.audio_path=null;o.audio_purged_at=new Date().toISOString();}return;}
    await removeCounselAudio(path);   // 여기서 실패하면 audio_path 를 지우지 않는다(위와 같은 이유)
    const {error}=await app.sb.from('counseling_notes')
      .update({audio_path:null,audio_purged_at:new Date().toISOString()}).eq('id',id);if(error)throw error;},
  // 상담 녹음 전사. 길이에 따라 수 분 걸린다(vercel.json 에서 300초까지 허용).
  async transcribeCounseling(noteId){if(app.DEMO)throw new Error('데모 모드에서는 전사를 실행하지 않습니다.');
    return await apiFetch('/api/counsel-transcribe',{method:'POST',body:{note_id:noteId}});},
  async insertEssay(e){if(app.DEMO){app.store.essay_gradings.push(Object.assign({id:uuid(),created_at:todayStr()},e));return;}
    const {error}=await app.sb.from('essay_gradings').insert(e);if(error)throw error;},
  async updateEssay(id,patch){if(app.DEMO){const o=app.store.essay_gradings.find(x=>x.id===id);Object.assign(o,patch);return;}
    const {error}=await app.sb.from('essay_gradings').update(patch).eq('id',id);if(error)throw error;},
  async deleteEssay(id){if(app.DEMO){app.store.essay_gradings=app.store.essay_gradings.filter(e=>e.id!==id);return;}
    const {error}=await app.sb.from('essay_gradings').delete().eq('id',id);if(error)throw error;},
  async saveTeacherComment(sid,weekNo,comment){
    if(app.DEMO){let o=app.store.teacher_comments.find(t=>t.student_id===sid&&t.week_no===weekNo);
      if(o)o.comment=comment;else app.store.teacher_comments.push({id:uuid(),student_id:sid,week_no:weekNo,comment,created_at:todayStr()});return;}
    const ex=await app.sb.from('teacher_comments').select('id').eq('student_id',sid).eq('week_no',weekNo).maybeSingle();
    if(ex.data){await app.sb.from('teacher_comments').update({comment}).eq('id',ex.data.id);}
    else{const {error}=await app.sb.from('teacher_comments').insert({student_id:sid,week_no:weekNo,comment});if(error)throw error;}},
  // 해시는 서버에서 계산한다. 평문 비밀번호는 HTTPS 본문으로만 전달된다.
  async changeMyPassword(newPassword){if(app.DEMO)return 'demo';
    const r=await apiFetch('/api/accounts',{method:'POST',body:{action:'change_password',new_password:newPassword}});return r.result;},
  async upsertAccount(phone,password,role,sid){if(app.DEMO)return 'demo';
    const r=await apiFetch('/api/accounts',{method:'POST',body:{action:'upsert',phone:normPhone(phone),password,role,student_id:sid||null}});return r.result;},
  async upsertReadinessSnapshot(rows){if(app.DEMO)return;
    const {error}=await app.sb.from('readiness_snapshots').upsert(rows,{onConflict:'student_id,snap_date'});if(error)throw error;},
  // 회차 난이도 보정(코호트 z)에 쓸 전체 채점. 학생 계정은 RLS 때문에 본인 것만 돌아온다.
  async listAllScores(){if(app.DEMO)return app.store.scores.slice();
    return await sbq(app.sb.from('scores').select('question_id,student_id,earned'),'채점 조회',[]);},
  async listPrescriptions(sid){if(app.DEMO)return app.store.prescriptions.filter(p=>!sid||p.student_id===sid).slice();
    let q=app.sb.from('prescriptions').select('*').order('created_at',{ascending:false});
    if(sid)q=q.eq('student_id',sid);
    return await sbq(q,'처방 조회',[]);},
  async insertPrescription(p){if(app.DEMO){app.store.prescriptions.push(Object.assign({id:uuid(),status:'active',created_at:todayStr()},p));return;}
    const {error}=await app.sb.from('prescriptions').insert(p);if(error)throw error;},
  async updatePrescriptionStatus(id,status){if(app.DEMO){const o=app.store.prescriptions.find(x=>x.id===id);if(o)o.status=status;return;}
    const {error}=await app.sb.from('prescriptions').update({status}).eq('id',id);if(error)throw error;},
  /* private 버킷 파일 열람: 서버가 역할·소유를 확인하고 10분짜리 서명 URL 을 준다. */
  async getSignedPhotoUrl(path,bucket){if(app.DEMO)return null;
    const r=await apiFetch('/api/signed-url',{method:'POST',body:{path,bucket:bucket||'grading-photos'}});return r.signedUrl||null;},

  /* ── AI 자동채점 ──
     grading_runs 는 RLS 로 관리자만 읽힌다. 확정 전 제안이 학생에게 새지 않도록.
     AI 미설정(503)은 정상 상태로 취급해 화면이 죽지 않게 한다. */
  async getAiStatus(){if(app.DEMO)return {configured:false,demo:true,model:'-',mode:'tags_only'};
    try{return await apiFetch('/api/ai-status');}
    catch(e){return {configured:false,error:e&&e.message};}},
  async listSubmissions(sid,qid){if(app.DEMO)return (app.store.submissions||[]).filter(s=>(!sid||s.student_id===sid)&&(!qid||s.question_id===qid));
    let q=app.sb.from('submissions').select('*').order('submitted_at',{ascending:false});
    if(sid)q=q.eq('student_id',sid);
    if(qid)q=q.eq('question_id',qid);
    return await sbq(q,'제출물 조회',[]);},
  async insertSubmission(s){if(app.DEMO){const o=Object.assign({id:uuid(),submitted_at:todayStr()},s);(app.store.submissions=app.store.submissions||[]).unshift(o);return o;}
    const {data,error}=await app.sb.from('submissions').insert(s).select().single();if(error)throw error;return data;},
  async listGradingRuns(submissionId){if(app.DEMO)return [];
    return await sbq(app.sb.from('grading_runs').select('*').eq('submission_id',submissionId).order('created_at',{ascending:false}),'AI 기록 조회',[]);},
  async runGrading(submissionId,stage){if(app.DEMO)throw new Error('데모 모드에서는 AI 분석을 실행하지 않습니다.');
    return await apiFetch('/api/grade-run',{method:'POST',body:{submission_id:submissionId,stage}});},
  async submitGradeReview(payload){if(app.DEMO)throw new Error('데모 모드에서는 확정할 수 없습니다.');
    return await apiFetch('/api/grade-review',{method:'POST',body:payload});},

  /* ── 문제은행 (관리자 전용) ──
     RLS 로도 막혀 있지만, 화면 라우트 자체를 학생 메뉴에 넣지 않아 이중으로 차단한다. */
  async listProblems(){if(app.DEMO)return app.store.problems.slice();
    return await sbq(app.sb.from('problems').select('*').order('created_at',{ascending:false}),'문제은행 조회',[]);},
  async insertProblem(p){if(app.DEMO){const o=Object.assign({id:uuid(),created_at:todayStr(),updated_at:todayStr()},p);app.store.problems.unshift(o);return o;}
    const {data,error}=await app.sb.from('problems').insert(p).select().single();if(error)throw error;return data;},
  async updateProblem(id,patch){if(app.DEMO){const o=app.store.problems.find(x=>x.id===id);if(o)Object.assign(o,patch);return o;}
    const {error}=await app.sb.from('problems').update(Object.assign({updated_at:new Date().toISOString()},patch)).eq('id',id);if(error)throw error;},

  /* ── 대학 연도별 실적 / 입시 결과 / 학부모 링크 / 리포트 초안 ── */
  async listUnivStats(uid){if(app.DEMO)return (app.store.univ_admission_stats||[]).filter(s=>!uid||s.university_id===uid);
    let q=app.sb.from('univ_admission_stats').select('*').order('year',{ascending:false});
    if(uid)q=q.eq('university_id',uid);
    return await sbq(q,'대학 실적 조회',[]);},
  async upsertUnivStat(row){if(app.DEMO){const a=(app.store.univ_admission_stats=app.store.univ_admission_stats||[]);
      const ex=a.find(x=>x.university_id===row.university_id&&x.year===row.year);
      if(ex)Object.assign(ex,row);else a.push(Object.assign({id:uuid()},row));return;}
    const {error}=await app.sb.from('univ_admission_stats').upsert(row,{onConflict:'university_id,year'});if(error)throw error;},
  async deleteUnivStat(id){if(app.DEMO){app.store.univ_admission_stats=(app.store.univ_admission_stats||[]).filter(x=>x.id!==id);return;}
    const {error}=await app.sb.from('univ_admission_stats').delete().eq('id',id);if(error)throw error;},
  // 합격·불합격 기록은 관리자 전용(RLS). 학생·학부모 화면에서 호출하지 않는다.
  async listOutcomes(){if(app.DEMO)return (app.store.admission_outcomes||[]).slice();
    return await sbq(app.sb.from('admission_outcomes').select('*').order('year',{ascending:false}),'입시 결과 조회',[]);},
  async upsertOutcome(row){if(app.DEMO){const a=(app.store.admission_outcomes=app.store.admission_outcomes||[]);
      const ex=a.find(x=>x.student_id===row.student_id&&x.university_id===row.university_id&&x.year===row.year);
      if(ex)Object.assign(ex,row);else a.push(Object.assign({id:uuid()},row));return;}
    const {error}=await app.sb.from('admission_outcomes').upsert(row,{onConflict:'student_id,university_id,year'});if(error)throw error;},
  async createParentLink(sid,days){if(app.DEMO)throw new Error('데모 모드에서는 링크를 발급하지 않습니다.');
    return await apiFetch('/api/parent-link',{method:'POST',body:{student_id:sid,days}});},
  async generateReportDraft(sid,weekNo){if(app.DEMO)throw new Error('데모 모드에서는 초안을 생성하지 않습니다.');
    return await apiFetch('/api/report-draft',{method:'POST',body:{student_id:sid,week_no:weekNo}});},

  /* ── 변형 문제 (관리자 전용) ── */
  async listVariants(status){if(app.DEMO)return (app.store.problem_variants||[]).filter(v=>!status||v.review_status===status);
    let q=app.sb.from('problem_variants').select('*').order('created_at',{ascending:false});
    if(status)q=q.eq('review_status',status);
    return await sbq(q,'변형 조회',[]);},
  async generateVariant(sourceProblemId,variationSpec,count){if(app.DEMO)throw new Error('데모 모드에서는 변형을 생성하지 않습니다.');
    return await apiFetch('/api/generate-variant',{method:'POST',
      body:{source_problem_id:sourceProblemId,variation_spec:variationSpec,count}});},
  async reviewVariant(variantId,action,note){if(app.DEMO)throw new Error('데모 모드에서는 검수할 수 없습니다.');
    return await apiFetch('/api/variant-review',{method:'POST',body:{variant_id:variantId,action,note}});},
};

/* scores.photo_url 에는 이제 버킷 내 경로만 저장한다.
   Phase 2 이전에 저장된 값은 public 전체 URL이라 경로를 뽑아내는 폴백이 필요하다. */
function storagePathFromValue(v){
  const s=String(v||'').trim();
  if(!s)return '';
  if(!/^https?:\/\//i.test(s))return s.replace(/^\/+/,'');
  const m=/\/grading-photos\/(.+)$/.exec(s.split('?')[0]);
  return m?decodeURIComponent(m[1]):'';
}

/* ═══════════════════════════════════════════════════════════════════
   집계 헬퍼 — 학생별 번들, 히트맵, 실점
   ═══════════════════════════════════════════════════════════════════ */
async function loadContext(){
  // 계산에 필요한 공통 데이터
  const [students,universities,targets,sessions,questions,allScores]=await Promise.all([
    db.listStudents(),db.listUniversities(),db.listTargets(),db.listSessions(),db.listAllQuestions(),
    db.listAllScores()]);
  // 회차별 코호트 통계(평균·표준편차). 회차 난이도 보정에 쓴다.
  const cohort=cohortSessionStats(sessionPercentRows(allScores,questions,sessions));
  return {students,universities,targets,sessions,questions,cohort};
}
async function studentBundle(sid,ctx){
  const qById={};ctx.questions.forEach(q=>qById[q.id]=q);
  const sessById={};ctx.sessions.forEach(s=>sessById[s.id]=s);
  const [scores,homeworks,essays]=await Promise.all([db.listScoresByStudent(sid),db.listHomework(sid),db.listEssays(sid)]);
  // 회차별 득점 합
  const perSession={};
  scores.forEach(sc=>{const q=qById[sc.question_id];if(!q)return;const s=sessById[q.session_id];if(!s)return;
    (perSession[s.id]=perSession[s.id]||{earned:0,pts:0,total:s.total_score,date:s.exam_date,week:s.week_no}).earned+=Number(sc.earned)||0;
    perSession[s.id].pts+=Number(q.points)||0;});
  const sessArr=Object.values(perSession).sort((a,b)=>a.week-b.week);
  const weeklyPercents=sessArr.map(s=>{const denom=s.total||s.pts||0;return denom>0?clamp(s.earned/denom*100):0;});
  // 회차 난이도 보정 점수(코호트 z → 50±10z). 비교군이 없으면 원점수를 그대로 쓴다.
  const weeklyScaled=standardizeWeekly(
    sessArr.map((s,i)=>({session_id:s.id,percent:weeklyPercents[i]})), ctx&&ctx.cohort);
  // 문항 레코드(단원/사고/배점/득점) — date 는 처방 재측정 구간을 자르는 데 쓴다.
  const questionRecords=scores.map(sc=>{const q=qById[sc.question_id];if(!q)return null;
    // question_id 는 학생 제출물(submissions)과 이어 붙이는 열쇠다(js/views/essays.js).
    return {question_id:sc.question_id,unit:q.unit,cognition:q.cognition,points:Number(q.points)||0,earned:Number(sc.earned)||0,week:sessById[q.session_id]?.week_no,date:sessById[q.session_id]?.exam_date,session_id:q.session_id,wrong_reason:sc.wrong_reason,no:q.no,reason_note:sc.reason_note,photo_url:sc.photo_url};
  }).filter(Boolean);
  // 신형(items)·구형(3분할) 첨삭을 같은 규칙으로 접는다 — 준비도 15% 항목의 입력값.
  const essayInputs=essays.map(e=>essayTotals(e));
  return {scores,homeworks,essays,perSession:sessArr,weeklyPercents,weeklyScaled,questionRecords,essayInputs,rawEssays:essays};
}

export { apiErr, sbq, apiFetch, db, loadContext, studentBundle,
         makeClient, applySession, sessionSuspect, storagePathFromValue };
