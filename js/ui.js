/* ═══════════════════════════════════════════════════════════════════
   공용 UI 헬퍼

   [렌더 규칙] 저장 성공 후 전체 재렌더 금지 — 해당 영역만 patchRegion 으로 갱신할 것.
   전체 재렌더는 스크롤 위치·입력 포커스·펼침 상태를 잃게 하고 불필요한 조회를 유발한다.
   ※ 기존 화면 코드는 아직 이 규칙을 따르지 않는다(Phase 2는 순수 분할이라 동작을 동결).
     새로 작성하거나 손대는 화면부터 patchRegion 을 적용한다.
   ═══════════════════════════════════════════════════════════════════ */
import { db } from './db.js';
import { app } from './state.js';
import { $, esc } from './util.js';

/* 특정 요소의 내용만 교체한다. 대상이 없으면 아무 일도 하지 않는다(렌더 경합 방지). */
export function patchRegion(elId, html){
  const el = $(elId);
  if(!el) return false;
  el.innerHTML = html;
  return true;
}

/* 채점 사진 서명 URL 채우기.
   grading-photos 버킷이 private 이라 <img src>에 바로 넣을 URL 이 없다.
   템플릿은 data-photo-path 만 심어 두고, 렌더 후 이 함수가 서명 URL 을 받아 채운다.
   서명 URL 은 10분짜리라 화면을 다시 그릴 때마다 새로 받는다. */
export async function hydrateSignedPhotos(root){
  const scope = root || document;
  const nodes = [...scope.querySelectorAll('[data-photo-path]')];
  await Promise.all(nodes.map(async el => {
    const path = el.dataset.photoPath;
    if(!path) return;
    el.dataset.photoPath = '';           // 중복 요청 방지
    try{
      const url = await db.getSignedPhotoUrl(path);
      if(!url){ el.innerHTML = '<span class="muted" style="font-size:11px">사진을 불러올 수 없습니다.</span>'; return; }
      const h = el.dataset.photoHeight || '60';
      el.innerHTML = '<a href="' + esc(url) + '" target="_blank" rel="noopener">'
        + '<img src="' + esc(url) + '" style="max-height:' + esc(h) + 'px;border-radius:6px"></a>';
    }catch(e){
      console.warn('사진 서명 URL 실패', e);
      el.innerHTML = '<span class="muted" style="font-size:11px">사진 열람 권한이 없거나 만료되었습니다.</span>';
    }
  }));
}

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
