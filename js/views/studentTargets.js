/* 학생: 목표 대학 */
import { admitBand, computeReadiness, essayRangeFor } from '../calc.js';
import { loadContext, studentBundle } from '../db.js';
import { svg } from '../icons.js';
import { app } from '../state.js';
import { ddayLabel, esc, fmtDate, r1 } from '../util.js';

/* ═══════════ 학생: 목표 대학 ═══════════ */
/* 관리자 화면(admission.js)과 같은 원칙: 첨삭 실적 구간을 먼저 보여주고,
   합격선 산출 기준이 확인된 대학만 격차를 표시한다. 밴드는 보조 지표. */
async function renderStudentTargets(c){
  const sid=app.cur.studentId;const ctx=await loadContext();const b=await studentBundle(sid,ctx);
  const {readiness}=computeReadiness({weeklyPercents:b.weeklyPercents,weeklyScaled:b.weeklyScaled,questionRecords:b.questionRecords,essays:b.essayInputs,homeworks:b.homeworks});
  const targets=ctx.targets.filter(t=>t.student_id===sid).sort((a,b)=>a.priority-b.priority);
  const cards=targets.length?targets.map(t=>{const u=ctx.universities.find(x=>x.id===t.university_id);if(!u)return '';const ab=admitBand(readiness,u);
    const er=essayRangeFor(b.rawEssays,u.name);
    const canCompare=er&&u.last_cut_pct!=null&&u.last_cut_basis;
    const gap=canCompare?er.avg-Number(u.last_cut_pct):null;
    return `<div class="uni-card"><h4>${t.priority}지망 · ${esc(u.name)}${u.campus?' ('+esc(u.campus)+')':''}</h4><div class="region">${esc(u.region)} · ${u.essay_only?'논술 100%':esc(u.essay_ratio||'')}</div>
      ${er?`<div style="margin-top:10px"><div class="muted" style="font-size:11.5px">내 첨삭 점수</div>
          <div style="display:flex;align-items:baseline;gap:6px"><b style="font-size:20px">${r1(er.min)}~${r1(er.max)}<span style="font-size:12px">%</span></b>
            <span class="muted" style="font-size:12px">평균 ${r1(er.avg)}%</span></div>
          <div class="muted" style="font-size:11px">근거 표본 ${er.n}회</div></div>`
        :'<div class="muted" style="font-size:12.5px;margin-top:10px">이 대학 유형으로 채점된 첨삭이 아직 없습니다.</div>'}
      ${canCompare?`<div class="kv" style="margin-top:8px"><span>작년 합격선 대비</span><b style="color:${gap>=0?'var(--green)':'var(--red)'}">${gap>=0?'+':''}${r1(gap)}%p</b></div>
        <div class="muted" style="font-size:11px">합격선 기준: ${esc(u.last_cut_basis)}</div>`
        :(u.last_cut_pct!=null?'<div class="muted" style="font-size:11.5px;margin-top:8px">합격선 정의 미확인 — 비교 생략</div>':'')}
      <div class="kv" style="margin-top:8px"><span>논술고사일</span><b>${u.exam_date?esc(fmtDate(u.exam_date))+' ('+ddayLabel(u.exam_date)+')':'미정'}</b></div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:8px"><span class="muted" style="font-size:11.5px">참고 밴드</span><span class="chip ${ab.cls}">${ab.label}</span><span class="muted" style="font-size:12px">준비도 ${readiness==null?'N/A':r1(readiness)+'%'}</span></div>
      ${(u.last_competition!=null||u.last_cut_pct!=null)?`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${u.last_competition!=null?`<span class="chip gray">작년 경쟁률 ${esc(u.last_competition)}:1</span>`:''}${u.last_cut_pct!=null?`<span class="chip gray">작년 합격선 ${esc(u.last_cut_pct)}%</span>`:''}</div>`:''}</div>`;}).join(''):'<p class="muted">등록된 목표 대학이 없습니다.</p>';
  c.innerHTML=`<div class="card"><h3>${svg('target')}내 목표 대학</h3><div class="grid2">${cards}</div>
    <div class="note-blue" style="margin-top:12px">본 지표는 참고 자료이며 합격을 보장하지 않습니다. 첨삭 점수는 우리 학원 채점 기준이라 대학 합격선과 산출 방식이 다를 수 있습니다.</div></div>`;
}

export { renderStudentTargets };
