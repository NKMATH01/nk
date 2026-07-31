/* 대학 정보 */
import { db } from '../db.js';
import { svg } from '../icons.js';
import { $, ddayLabel, esc, fmtDate } from '../util.js';

/* ═══════════════════════════════════════════════════════════════════
   8) 대학 정보
   ═══════════════════════════════════════════════════════════════════ */
async function renderUniversities(c){
  const us=await db.listUniversities();
  c.innerHTML=`<div class="card"><h3>${svg('building')}약술형 논술 실시 대학 <span class="sub">${us.length}개 · 시행계획 기준(요강 확인 필요)</span></h3>
    <div style="overflow-x:auto"><table><thead><tr><th>대학</th><th>지역</th><th>논술100%</th><th>반영비율</th><th>수능최저</th><th>출제범위</th><th>문항구성</th><th>고사일</th><th class="num">모집</th><th>작년 결과</th><th></th></tr></thead><tbody>
    ${us.map(u=>`<tr data-uid="${esc(u.id)}">
      <td><b>${esc(u.name)}</b>${u.campus?` <span class="muted">(${esc(u.campus)})</span>`:''} ${!u.confirmed?'<span class="chip gray">시행계획</span>':'<span class="chip green">확정</span>'}</td>
      <td>${esc(u.region)}</td><td>${u.essay_only?'<span class="chip green">100%</span>':'<span class="chip gray">병행</span>'}</td>
      <td class="muted">${esc(u.essay_only?'미반영':(u.naesin_ratio||'-'))}</td>
      <td class="muted">${esc(u.min_grade_rule||'-')}</td><td class="muted">${esc(u.math_scope||'-')}</td>
      <td class="muted">${esc(u.question_mix||'-')}</td>
      <td>${u.exam_date?esc(fmtDate(u.exam_date))+' <span class="chip gray">'+ddayLabel(u.exam_date)+'</span>':'<span class="muted">미정</span>'}</td>
      <td class="num">${u.quota!=null?esc(u.quota):'-'}</td>
      <td class="muted"${u.last_result_note?` title="${esc(u.last_result_note)}"`:''}>${(u.last_competition!=null||u.last_cut_pct!=null)?`${u.last_competition!=null?'경쟁률 '+esc(u.last_competition)+':1':''}${u.last_competition!=null&&u.last_cut_pct!=null?' · ':''}${u.last_cut_pct!=null?'합격선 '+esc(u.last_cut_pct)+'%':''}`:'-'}</td>
      <td><button class="btn line sm uedit" data-uid="${esc(u.id)}">수정</button></td></tr>`).join('')}
    </tbody></table></div></div><div id="uEdit"></div>`;
  c.querySelectorAll('.uedit').forEach(b=>b.addEventListener('click',()=>editUniversity(b.dataset.uid,us,c)));
}
function editUniversity(uid,us,c){
  const u=us.find(x=>x.id===uid);const wrap=$('uEdit');
  wrap.innerHTML=`<div class="card"><h3>${svg('settings')}${esc(u.name)} 정보 수정</h3>
    <div class="row"><div class="field"><label>고사일</label><input id="ue_date" type="date" value="${u.exam_date?esc(fmtDate(u.exam_date)):''}"></div>
      <div class="field"><label>모집인원</label><input id="ue_quota" type="number" value="${u.quota!=null?esc(u.quota):''}"></div>
      <div class="field"><label>수능최저</label><input id="ue_mg" value="${esc(u.min_grade_rule||'')}"></div>
      <div class="field"><label>확정 여부</label><select id="ue_conf"><option value="false" ${!u.confirmed?'selected':''}>시행계획 기준</option><option value="true" ${u.confirmed?'selected':''}>확정</option></select></div></div>
    <div class="row" style="margin-top:8px"><div class="field" style="flex:2"><label>문항구성</label><input id="ue_mix" value="${esc(u.question_mix||'')}"></div>
      <div class="field" style="flex:2"><label>반영비율</label><input id="ue_ratio" value="${esc(u.essay_ratio||'')}"></div></div>
    <div class="row" style="margin-top:8px"><div class="field"><label>작년 경쟁률</label><input id="ue_comp" type="number" step="0.1" min="0" value="${u.last_competition!=null?esc(u.last_competition):''}" placeholder="예: 21.5"></div>
      <div class="field"><label>작년 합격선(%)</label><input id="ue_cut" type="number" step="0.1" min="0" max="100" value="${u.last_cut_pct!=null?esc(u.last_cut_pct):''}" placeholder="예: 72"></div>
      <div class="field" style="flex:2"><label>작년 결과 비고/출처</label><input id="ue_note" value="${esc(u.last_result_note||'')}" placeholder="출처·비고"></div></div>
    <div class="row" style="margin-top:8px"><div class="field" style="flex:1"><label>합격선 산출 기준</label>
      <input id="ue_basis" value="${esc(u.last_cut_basis||'')}" placeholder="예: 150점 만점 70%컷 환산">
      <div class="muted" style="font-size:11.5px;margin-top:4px">이 값을 입력해야 [합격 가능성] 화면에서 첨삭 점수와 합격선 격차를 비교합니다. 비워 두면 비교를 생략합니다(기준이 다른 값끼리 비교해 오판하는 것을 막기 위함).</div></div></div>
    <button class="btn" id="ue_save">${svg('check','sm')}저장</button> <button class="btn line" id="ue_cancel">닫기</button><div id="ue_msg" class="msg"></div>
    <div class="divider"></div>
    <div style="font-size:12px;font-weight:700;margin-bottom:4px">연도별 실적 <span class="muted" style="font-weight:400">여러 해를 쌓으면 추세를 볼 수 있습니다. 입력이 있으면 위 [작년] 값보다 우선합니다.</span></div>
    <div id="ue_stats"><span class="muted" style="font-size:12px">불러오는 중...</span></div>
    <div class="row" style="margin-top:6px;gap:6px">
      <div class="field" style="max-width:90px"><label>연도</label><input id="us_year" type="number" placeholder="2025"></div>
      <div class="field" style="max-width:100px"><label>경쟁률</label><input id="us_comp" type="number" step="0.1" min="0"></div>
      <div class="field" style="max-width:110px"><label>합격선(%)</label><input id="us_cut" type="number" step="0.1" min="0" max="100"></div>
      <div class="field" style="flex:2"><label>산출 기준</label><input id="us_basis" placeholder="예: 150점 만점 70%컷 환산"></div>
      <button class="btn sm" id="us_add" style="align-self:flex-end">추가/갱신</button></div>
    <div id="us_msg" class="msg"></div></div>`;
  wrap.scrollIntoView({behavior:'smooth',block:'nearest'});
  $('ue_cancel').addEventListener('click',()=>wrap.innerHTML='');
  loadUnivStats(uid,us,c);
  $('us_add').addEventListener('click',async()=>{
    const m=$('us_msg');m.className='msg';m.textContent='';
    const year=Number($('us_year').value);
    if(!year||year<2000||year>2100){m.className='msg err';m.textContent='연도를 확인하세요.';return;}
    try{
      await db.upsertUnivStat({university_id:uid,year,
        competition:$('us_comp').value?Number($('us_comp').value):null,
        cut_pct:$('us_cut').value?Number($('us_cut').value):null,
        cut_basis:$('us_basis').value.trim()||null});
      $('us_year').value='';$('us_comp').value='';$('us_cut').value='';$('us_basis').value='';
      m.className='msg ok';m.textContent='저장되었습니다.';
      loadUnivStats(uid,us,c);
    }catch(e){m.className='msg err';m.textContent='실패: '+(e?.message||'오류');}
  });
  $('ue_save').addEventListener('click',async()=>{const m=$('ue_msg');m.className='msg';
    try{await db.updateUniversity(uid,{exam_date:$('ue_date').value||null,quota:$('ue_quota').value?Number($('ue_quota').value):null,
      min_grade_rule:$('ue_mg').value.trim()||null,confirmed:$('ue_conf').value==='true',question_mix:$('ue_mix').value.trim()||null,essay_ratio:$('ue_ratio').value.trim()||null,
      last_competition:$('ue_comp').value?Number($('ue_comp').value):null,last_cut_pct:$('ue_cut').value?Number($('ue_cut').value):null,last_result_note:$('ue_note').value.trim()||null,
      last_cut_basis:$('ue_basis').value.trim()||null});
      m.className='msg ok';m.textContent='저장됨';renderUniversities(c);}
    catch(e){m.className='msg err';m.textContent='실패: '+(e?.message||'오류');}});
}

/* 연도별 실적 목록. 최신 연도가 위로 오고, 삭제는 단건으로만 한다. */
async function loadUnivStats(uid,us,c){
  const box=$('ue_stats');
  if(!box)return;
  let rows=[];
  try{rows=await db.listUnivStats(uid);}catch(e){}
  if(!rows.length){
    box.innerHTML='<span class="muted" style="font-size:12px">등록된 연도별 실적이 없습니다.</span>';
    return;
  }
  box.innerHTML=`<div style="overflow-x:auto"><table><thead><tr>
      <th class="num">연도</th><th class="num">경쟁률</th><th class="num">합격선</th><th>산출 기준</th><th></th>
    </tr></thead><tbody>
    ${rows.map(s=>`<tr>
      <td class="num"><b>${esc(s.year)}</b></td>
      <td class="num">${s.competition!=null?esc(s.competition)+':1':'-'}</td>
      <td class="num">${s.cut_pct!=null?esc(s.cut_pct)+'%':'-'}</td>
      <td class="muted" style="font-size:12px">${esc(s.cut_basis||'미기재')}</td>
      <td><button class="btn danger icon us_del" data-id="${esc(s.id)}">${svg('trash','xs')}</button></td>
    </tr>`).join('')}
    </tbody></table></div>`;
  box.querySelectorAll('.us_del').forEach(b=>b.addEventListener('click',async()=>{
    try{await db.deleteUnivStat(b.dataset.id);loadUnivStats(uid,us,c);}
    catch(e){alert('삭제 실패: '+(e?.message||'오류'));}
  }));
}

export { renderUniversities, editUniversity, loadUnivStats };
