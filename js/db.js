/* 데이터 접근 계층(데모=메모리 / 실서버=Supabase)과 집계 헬퍼.
   401 응답 시 호출하는 doLogout 은 순환 import 를 피하려고 app 을 경유한다. */
import { app } from './state.js';
import { $, clamp, normPhone, todayStr, uuid } from './util.js';

/* ═══════════════════════════════════════════════════════════════════
   데이터 접근 계층 (데모=메모리 / 실서버=Supabase)
   ═══════════════════════════════════════════════════════════════════ */
function apiErr(prefix,e){console.error(prefix,e);const g=$('globalErr');if(g){g.style.display='block';g.textContent=prefix+': '+(e?.message||'네트워크 오류. 인터넷 연결을 확인하세요.');}return null;}
async function sbq(promise,prefix,fallback){try{const {data,error}=await promise;if(error)throw error;return data||fallback;}catch(e){apiErr(prefix,e);return fallback;}}

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
  async listCounseling(sid){if(app.DEMO)return app.store.counseling_notes.filter(n=>n.student_id===sid).slice().sort((a,b)=>a.note_date<b.note_date?1:-1);
    return await sbq(app.sb.from('counseling_notes').select('*').eq('student_id',sid).order('note_date',{ascending:false}),'상담 기록 조회',[]);},
  async listAllCounseling(){if(app.DEMO)return app.store.counseling_notes.slice();
    return await sbq(app.sb.from('counseling_notes').select('*'),'상담 기록 조회',[]);},
  async insertCounseling(n){if(app.DEMO){app.store.counseling_notes.push(Object.assign({id:uuid(),created_at:todayStr()},n));return;}
    const {error}=await app.sb.from('counseling_notes').insert(n);if(error)throw error;},
  async updateCounseling(id,patch){if(app.DEMO){const o=app.store.counseling_notes.find(x=>x.id===id);Object.assign(o,patch);return;}
    const {error}=await app.sb.from('counseling_notes').update(patch).eq('id',id);if(error)throw error;},
  async deleteCounseling(id){if(app.DEMO){app.store.counseling_notes=app.store.counseling_notes.filter(n=>n.id!==id);return;}
    const {error}=await app.sb.from('counseling_notes').delete().eq('id',id);if(error)throw error;},
  async insertEssay(e){if(app.DEMO){app.store.essay_gradings.push(Object.assign({id:uuid(),created_at:todayStr()},e));return;}
    const {error}=await app.sb.from('essay_gradings').insert(e);if(error)throw error;},
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
};

/* ═══════════════════════════════════════════════════════════════════
   집계 헬퍼 — 학생별 번들, 히트맵, 실점
   ═══════════════════════════════════════════════════════════════════ */
async function loadContext(){
  // 계산에 필요한 공통 데이터
  const [students,universities,targets,sessions,questions]=await Promise.all([
    db.listStudents(),db.listUniversities(),db.listTargets(),db.listSessions(),db.listAllQuestions()]);
  return {students,universities,targets,sessions,questions};
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
  // 문항 레코드(단원/사고/배점/득점)
  const questionRecords=scores.map(sc=>{const q=qById[sc.question_id];if(!q)return null;
    return {unit:q.unit,cognition:q.cognition,points:Number(q.points)||0,earned:Number(sc.earned)||0,week:sessById[q.session_id]?.week_no,session_id:q.session_id,wrong_reason:sc.wrong_reason,no:q.no,reason_note:sc.reason_note,photo_url:sc.photo_url};
  }).filter(Boolean);
  const essayInputs=essays.map(e=>({earned:(e.cond_earned||0)+(e.proc_earned||0)+(e.ans_earned||0),max:(e.cond_max||0)+(e.proc_max||0)+(e.ans_max||0)}));
  return {scores,homeworks,essays,perSession:sessArr,weeklyPercents,questionRecords,essayInputs,rawEssays:essays};
}

export { apiErr, sbq, apiFetch, db, loadContext, studentBundle };
