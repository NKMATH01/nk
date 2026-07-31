/* ═══════════════════════════════════════════════════════════════════
   공용 UI 헬퍼

   [렌더 규칙] 저장 성공 후 전체 재렌더 금지 — 해당 영역만 patchRegion 으로 갱신할 것.
   전체 재렌더는 스크롤 위치·입력 포커스·펼침 상태를 잃게 하고 불필요한 조회를 유발한다.
   ※ 기존 화면 코드는 아직 이 규칙을 따르지 않는다(Phase 2는 순수 분할이라 동작을 동결).
     새로 작성하거나 손대는 화면부터 patchRegion 을 적용한다.
   ═══════════════════════════════════════════════════════════════════ */

/* 특정 요소의 내용만 교체한다. 대상이 없으면 아무 일도 하지 않는다(렌더 경합 방지). */
export function patchRegion(elId, html){
  const el = $(elId);
  if(!el) return false;
  el.innerHTML = html;
  return true;
}

import { db } from './db.js';
import { app } from './state.js';
import { $, esc } from './util.js';

function destroyCharts(){app.state.charts.forEach(c=>{try{c.destroy();}catch(e){}});app.state.charts=[];}

function demoSwitchHTML(role){
  const roles=[['admin','관리자'],['student','학생'],['parent','학부모']];
  return `<div class="demo-switch"><span>미리보기</span><div class="seg">${roles.map(([r,l])=>`<button data-role="${r}" class="${role===r?'on':''}">${l}</button>`).join('')}</div></div>`;
}
function bindDemoSwitch(){document.querySelectorAll('.demo-switch [data-role]').forEach(b=>b.addEventListener('click',async()=>{
  const r=b.dataset.role;const demoStu=app.store.students[0].id;destroyCharts();await app.enterApp(r,r==='admin'?null:demoStu);}));}

/* 학생 선택 드롭다운(관리자/강사만) */
async function studentSelector(){
  if(app.cur.role==='student')return '';
  const studs=(await db.listStudents()).filter(s=>s.status==='재원'||!s.status);
  if(!studs.length)return '<div class="selectbar muted">재원 학생이 없습니다. [학생 관리]에서 등록하세요.</div>';
  if(!app.cur.studentId||!studs.find(s=>s.id===app.cur.studentId))app.cur.studentId=studs[0].id;
  return `<div class="selectbar"><label>학생</label><select id="stuSel">${studs.map(s=>`<option value="${esc(s.id)}" ${s.id===app.cur.studentId?'selected':''}>${esc(s.name)} · ${esc(s.grade_type)}</option>`).join('')}</select></div>`;
}
function bindStudentSelector(re){const s=$('stuSel');if(s)s.addEventListener('change',()=>{app.cur.studentId=s.value;re();});}

export { destroyCharts, demoSwitchHTML, bindDemoSwitch, studentSelector, bindStudentSelector };
