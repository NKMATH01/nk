/* 학생 관리 */
import { db } from '../db.js';
import { svg } from '../icons.js';
import { app } from '../state.js';
import { $, esc, normPhone, todayStr } from '../util.js';

/* 녹음 동의 체크를 켰는데 동의일이 비어 있으면 오늘 날짜를 채운다.
   체크만 하고 날짜를 빠뜨리면 언제 받은 동의인지 나중에 확인할 수 없다. */
function bindConsentDefault(chk,dateInput){
  if(!chk||!dateInput)return;
  chk.addEventListener('change',()=>{if(chk.checked&&!dateInput.value)dateInput.value=todayStr();});
}

/* ═══════════════════════════════════════════════════════════════════
   2) 학생 관리
   ═══════════════════════════════════════════════════════════════════ */
async function renderStudents(c){
  const students=await db.listStudents();const universities=await db.listUniversities();
  c.innerHTML=`
    <div class="card"><h3>${svg('plus')}학생 등록</h3>
      <div class="row">
        <div class="field"><label>이름 (필수)</label><input id="ns_name" placeholder="이름"></div>
        <div class="field"><label>학년</label><select id="ns_grade"><option>고3</option><option>N수</option></select></div>
        <div class="field"><label>학교</label><input id="ns_school" placeholder="예: 상록고"></div>
        <div class="field"><label>내신등급(선택)</label><input id="ns_naesin" type="number" step="0.1" min="1" max="9" placeholder="2.4"></div>
      </div>
      <div class="row" style="margin-top:10px">
        <div class="field"><label>학부모 연락처</label><input id="ns_pphone" placeholder="01000000000"></div>
        <div class="field"><label>개인정보 동의일</label><input id="ns_consent" type="date"></div>
        <div class="field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="ns_rec"> 녹음 동의</label><input id="ns_rec_at" type="date"></div>
        <div class="field"><label>상태</label><select id="ns_status"><option>재원</option><option>퇴원</option></select></div>
        <button class="btn" id="ns_add">${svg('plus','sm')}등록</button>
      </div>
      <div id="ns_msg" class="msg"></div>
    </div>
    <div id="stuCards"></div>`;
  $('ns_add').addEventListener('click',async()=>{
    const m=$('ns_msg');m.className='msg';m.textContent='';
    const name=$('ns_name').value.trim();if(!name){m.className='msg err';m.textContent='이름을 입력하세요.';return;}
    const naesin=$('ns_naesin').value?Number($('ns_naesin').value):null;
    try{await db.insertStudent({name,grade_type:$('ns_grade').value,school:$('ns_school').value.trim()||null,
      naesin_grade:naesin,parent_phone:normPhone($('ns_pphone').value)||null,consent_date:$('ns_consent').value||null,
      recording_consent:$('ns_rec').checked,recording_consent_at:$('ns_rec_at').value||null,status:$('ns_status').value});
      m.className='msg ok';m.textContent='등록되었습니다.';renderStuCards(universities);
      ['ns_name','ns_school','ns_naesin','ns_pphone'].forEach(id=>$(id).value='');
    }catch(e){m.className='msg err';m.textContent='등록 실패: '+(e?.message||'오류');}
  });
  bindConsentDefault($('ns_rec'),$('ns_rec_at'));
  renderStuCards(universities);
}
async function renderStuCards(universities,savedSid){
  const wrap=$('stuCards');const students=await db.listStudents();
  const blocks=[];
  for(const s of students){
    const targets=(await db.listTargets(s.id)).sort((a,b)=>a.priority-b.priority);
    const accs=await db.listAccountsByStudent(s.id);const sAcc=accs.find(a=>a.role==='student');const pAcc=accs.find(a=>a.role==='parent');
    const tSummary=targets.length?targets.map(t=>{const u=universities.find(x=>x.id===t.university_id);return u?`${t.priority}지망 ${esc(u.name)}`:'';}).join(' · '):'목표 미설정';
    blocks.push(`<div class="card" data-sid="${esc(s.id)}">
      <div><h3 style="margin:0">${esc(s.name)} <span class="chip gray">${esc(s.grade_type)}</span> ${s.status==='퇴원'?'<span class="chip red">퇴원</span>':'<span class="chip green">재원</span>'}</h3>
        <div class="muted" style="font-size:12px;margin-top:2px">${esc(tSummary)}</div></div>
      <div class="divider"></div>
      <div class="muted" style="font-size:12px;font-weight:700;margin-bottom:6px">기본정보</div>
      <div class="row">
        <div class="field"><label>이름 (필수)</label><input class="e_name" value="${esc(s.name||'')}" placeholder="이름"></div>
        <div class="field"><label>학년</label><select class="e_grade"><option ${s.grade_type!=='N수'?'selected':''}>고3</option><option ${s.grade_type==='N수'?'selected':''}>N수</option></select></div>
        <div class="field"><label>학교</label><input class="e_school" value="${esc(s.school||'')}" placeholder="예: 상록고"></div>
        <div class="field"><label>내신등급</label><input class="e_naesin" type="number" step="0.1" min="1" max="9" value="${esc(s.naesin_grade!=null?s.naesin_grade:'')}" placeholder="2.4"></div>
      </div>
      <div class="row" style="margin-top:10px">
        <div class="field"><label>학부모 연락처</label><input class="e_pphone" value="${esc(s.parent_phone||'')}" placeholder="01000000000"></div>
        <div class="field"><label>개인정보 동의일</label><input class="e_consent" type="date" value="${esc(s.consent_date||'')}"></div>
        <div class="field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" class="e_rec" ${s.recording_consent?'checked':''}> 녹음 동의</label><input class="e_rec_at" type="date" value="${esc(s.recording_consent_at||'')}"></div>
        <div class="field"><label>상태</label><select class="e_status"><option ${s.status!=='퇴원'?'selected':''}>재원</option><option ${s.status==='퇴원'?'selected':''}>퇴원</option></select></div>
      </div>
      <div class="divider"></div>
      <div class="muted" style="font-size:12px;font-weight:700;margin-bottom:6px">목표 대학 (최대 3, 지망순위)</div>
      ${[0,1,2].map(i=>{const t=targets[i];const selU=t?t.university_id:'';
        return `<div class="row" style="margin-bottom:6px"><span class="chip gray">${i+1}지망</span>
          <select class="t_uni field" data-pri="${i+1}" style="flex:1;padding:7px 9px;border:1.5px solid var(--line);border-radius:8px">
          <option value="">— 선택 —</option>${universities.map(u=>`<option value="${esc(u.id)}" ${u.id===selU?'selected':''}>${esc(u.name)}${u.campus?'('+esc(u.campus)+')':''}</option>`).join('')}</select></div>`;}).join('')}
      <div class="row" style="margin-top:8px"><button class="btn save_all">${svg('check','xs')}저장</button></div>
      <div class="msg all_msg"></div>
      <div class="divider"></div>
      <div><div class="muted" style="font-size:12px;font-weight:700;margin-bottom:6px">로그인 계정</div>
        <div class="muted" style="font-size:11.5px;margin-bottom:6px">계정은 전화번호+비밀번호 입력 후 [학생계정]/[학부모계정] 버튼으로 저장됩니다. 위 [저장] 버튼과는 별개입니다. 비밀번호는 변경할 때만 입력하세요.</div>
        <div class="row" style="margin-bottom:8px"><div class="field" style="flex:1"><label>학생 전화번호 ${sAcc?'<span class="chip green" style="font-size:10px">계정 있음</span>':''}</label><input class="acc_sphone" value="${esc(sAcc?sAcc.phone:'')}" placeholder="01000000000"></div>
          <div class="field" style="flex:1"><label>학생 비밀번호</label><input class="acc_spw" type="password" placeholder="4자 이상"></div>
          <button class="btn sm acc_student">학생계정</button></div>
        <div class="row"><div class="field" style="flex:1"><label>학부모 전화번호 ${pAcc?'<span class="chip green" style="font-size:10px">계정 있음</span>':''}</label><input class="acc_pphone" value="${esc(pAcc?pAcc.phone:(s.parent_phone||''))}" placeholder="01000000000"></div>
          <div class="field" style="flex:1"><label>학부모 비밀번호</label><input class="acc_ppw" type="password" placeholder="4자 이상"></div>
          <button class="btn sm acc_parent">학부모계정</button></div>
        <div class="msg acc_msg"></div>
        <div style="margin-top:8px"><button class="btn line sm plink">${svg('file','xs')}학부모 리포트 링크 발급</button>
          <span class="muted" style="font-size:11.5px">비밀번호 없이 자녀 리포트만 볼 수 있는 링크입니다(기본 30일).</span>
          <div class="plink_out" style="margin-top:6px"></div></div>
      </div>
    </div>`);
  }
  wrap.innerHTML=blocks.join('')||'<p class="muted">등록된 학생이 없습니다.</p>';
  if(savedSid){const okCard=wrap.querySelector(`.card[data-sid="${savedSid}"]`);if(okCard){const okMsg=okCard.querySelector('.all_msg');okMsg.className='msg ok';okMsg.textContent='저장되었습니다.';}}
  wrap.querySelectorAll('.card[data-sid]').forEach(card=>{
    const sid=card.dataset.sid;
    card.querySelector('.save_all').addEventListener('click',async()=>{
      const m=card.querySelector('.all_msg');m.className='msg';m.textContent='';
      const name=card.querySelector('.e_name').value.trim();
      if(!name){m.className='msg err';m.textContent='이름을 입력하세요.';return;}
      const list=[];const seen=new Set();let dup=false;
      card.querySelectorAll('.t_uni').forEach(sel=>{if(sel.value){if(seen.has(sel.value)){dup=true;return;}seen.add(sel.value);list.push({university_id:sel.value,priority:Number(sel.dataset.pri)});}});
      if(dup){m.className='msg err';m.textContent='같은 대학을 중복 선택할 수 없습니다.';return;}
      const naesinV=card.querySelector('.e_naesin').value;
      try{
        await db.updateStudent(sid,{name,grade_type:card.querySelector('.e_grade').value,school:card.querySelector('.e_school').value.trim()||null,
          naesin_grade:naesinV?Number(naesinV):null,parent_phone:normPhone(card.querySelector('.e_pphone').value)||null,
          consent_date:card.querySelector('.e_consent').value||null,
          recording_consent:card.querySelector('.e_rec').checked,
          recording_consent_at:card.querySelector('.e_rec_at').value||null,
          status:card.querySelector('.e_status').value});
        await db.setTargets(sid,list);
        renderStuCards(universities,sid);
      }catch(e){m.className='msg err';m.textContent='저장 실패: '+(e?.message||'오류');}
    });
    bindConsentDefault(card.querySelector('.e_rec'),card.querySelector('.e_rec_at'));
    const accMsg=card.querySelector('.acc_msg');
    card.querySelector('.acc_student').addEventListener('click',()=>createAcct(card,sid,'student',accMsg));
    card.querySelector('.acc_parent').addEventListener('click',()=>createAcct(card,sid,'parent',accMsg));
    card.querySelector('.plink').addEventListener('click',()=>issueParentLink(card,sid));
  });
}
async function createAcct(card,sid,role,m){
  m.className='msg';m.textContent='';
  const phone=normPhone(card.querySelector(role==='student'?'.acc_sphone':'.acc_pphone').value);
  const pw=card.querySelector(role==='student'?'.acc_spw':'.acc_ppw').value;
  if(!phone){m.className='msg err';m.textContent='전화번호를 입력하세요.';return;}
  if(!pw||pw.length<4){m.className='msg err';m.textContent='비밀번호는 4자 이상.';return;}
  if(app.DEMO){m.className='msg ok';m.textContent='데모 모드에서는 계정이 저장되지 않습니다.';return;}
  try{const res=await db.upsertAccount(phone,pw,role,sid);
    m.className='msg ok';m.textContent=(role==='student'?'학생':'학부모')+' 계정 '+(res==='created'?'생성됨':'비번 변경됨');}
  catch(e){m.className='msg err';m.textContent='실패: '+(e?.message||'오류');}
}

/* 학부모 리포트 링크 발급.
   URL 에는 토큰만 담긴다(이름·연락처 등 개인정보 없음).
   알림톡 자동 발송은 외부 계약이 필요해 v1 에서는 화면 표시 + 복사까지만 한다. */
async function issueParentLink(card,sid){
  const out=card.querySelector('.plink_out');
  const btn=card.querySelector('.plink');
  out.innerHTML='<span class="muted" style="font-size:12px">발급 중...</span>';
  if(app.DEMO){out.innerHTML='<span class="chip gray">데모 모드 — 링크를 발급하지 않습니다</span>';return;}
  btn.disabled=true;
  try{
    const r=await db.createParentLink(sid,30);
    const until=r.expiresAt?String(r.expiresAt).slice(0,10):'';
    out.innerHTML=`<div style="border:1px solid var(--line);border-radius:9px;padding:8px;background:var(--bg)">
      <div class="muted" style="font-size:11.5px;margin-bottom:4px">${esc(r.phone||'')} 학부모용 · ${esc(until)}까지 유효</div>
      <input class="plink_url" readonly value="${esc(r.url)}" style="width:100%;padding:6px 8px;border:1.5px solid var(--line);border-radius:7px;font-size:11.5px">
      <div style="margin-top:6px"><button type="button" class="btn sm plink_copy">링크 복사</button>
        <span class="muted" style="font-size:11.5px">카카오톡 등으로 전달하세요.</span></div>
      <div class="plink_msg msg"></div></div>`;
    out.querySelector('.plink_copy').addEventListener('click',async()=>{
      const m=out.querySelector('.plink_msg');
      try{await navigator.clipboard.writeText(r.url);m.className='msg ok';m.textContent='복사되었습니다.';}
      catch(e){
        // 클립보드 권한이 없을 수 있으니 선택 상태로 만들어 수동 복사를 돕는다.
        const inp=out.querySelector('.plink_url');inp.focus();inp.select();
        m.className='msg';m.textContent='자동 복사가 막혀 있습니다. 선택된 주소를 Ctrl+C 로 복사하세요.';
      }
    });
  }catch(e){out.innerHTML='<div class="msg err">'+esc(e?.message||'오류')+'</div>';}
  finally{btn.disabled=false;}
}

export { renderStudents, renderStuCards, createAcct, issueParentLink };
