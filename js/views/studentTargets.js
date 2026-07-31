/* 학생: 목표 대학 */
import { admitBand, computeReadiness } from '../calc.js';
import { loadContext, studentBundle } from '../db.js';
import { svg } from '../icons.js';
import { app } from '../state.js';
import { ddayLabel, esc, fmtDate, r1 } from '../util.js';

/* ═══════════ 학생: 목표 대학 ═══════════ */
async function renderStudentTargets(c){
  const sid=app.cur.studentId;const ctx=await loadContext();const b=await studentBundle(sid,ctx);
  const {readiness}=computeReadiness({weeklyPercents:b.weeklyPercents,questionRecords:b.questionRecords,essays:b.essayInputs,homeworks:b.homeworks});
  const targets=ctx.targets.filter(t=>t.student_id===sid).sort((a,b)=>a.priority-b.priority);
  const cards=targets.length?targets.map(t=>{const u=ctx.universities.find(x=>x.id===t.university_id);if(!u)return '';const ab=admitBand(readiness,u);
    return `<div class="uni-card"><h4>${t.priority}지망 · ${esc(u.name)}${u.campus?' ('+esc(u.campus)+')':''}</h4><div class="region">${esc(u.region)} · ${u.essay_only?'논술 100%':esc(u.essay_ratio||'')}</div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:10px"><span class="chip ${ab.cls}">${ab.label}</span><b>${readiness==null?'N/A':r1(readiness)+'%'}</b></div>
      <div class="kv" style="margin-top:8px"><span>논술고사일</span><b>${u.exam_date?esc(fmtDate(u.exam_date))+' ('+ddayLabel(u.exam_date)+')':'미정'}</b></div>
      ${(u.last_competition!=null||u.last_cut_pct!=null)?`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${u.last_competition!=null?`<span class="chip gray">작년 경쟁률 ${esc(u.last_competition)}:1</span>`:''}${u.last_cut_pct!=null?`<span class="chip gray">작년 합격선 ${esc(u.last_cut_pct)}%</span>`:''}</div>`:''}${ab.delta?`<div class="muted" style="font-size:11px;margin-top:4px">기준 보정 ${ab.delta>0?'+':''}${ab.delta.toFixed(1)}</div>`:''}</div>`;}).join(''):'<p class="muted">등록된 목표 대학이 없습니다.</p>';
  c.innerHTML=`<div class="card"><h3>${svg('target')}내 목표 대학</h3><div class="grid2">${cards}</div>
    <div class="note-blue" style="margin-top:12px">본 지표는 참고 자료이며 합격을 보장하지 않습니다.</div></div>`;
}

export { renderStudentTargets };
