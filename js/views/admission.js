/* 합격 가능성 */
import { admitBand, computeReadiness, ewma } from '../calc.js';
import { loadContext, studentBundle } from '../db.js';
import { svg } from '../icons.js';
import { app } from '../state.js';
import { bindStudentSelector, studentSelector } from '../ui.js';
import { clamp, ddayLabel, esc, fmtDate, r1 } from '../util.js';

/* ═══════════════════════════════════════════════════════════════════
   6) 합격 가능성
   ═══════════════════════════════════════════════════════════════════ */
async function renderAdmission(c){
  c.innerHTML=await studentSelector()+'<p class="muted">불러오는 중...</p>';bindStudentSelector(()=>renderAdmission(c));
  const sid=app.cur.studentId;if(!sid){c.querySelector('p').textContent='학생을 선택하세요.';return;}
  const ctx=await loadContext();const b=await studentBundle(sid,ctx);
  const {readiness,parts}=computeReadiness({weeklyPercents:b.weeklyPercents,questionRecords:b.questionRecords,essays:b.essayInputs,homeworks:b.homeworks});
  const partMap={};parts.forEach(p=>partMap[p.key]=p.value);
  // 주차별 준비도 스파크라인(간이: 누적 회차까지 EWMA 기반 재계산)
  const spark=[];for(let i=1;i<=b.weeklyPercents.length;i++){spark.push(clamp(ewma(b.weeklyPercents.slice(0,i))));}
  const targets=ctx.targets.filter(t=>t.student_id===sid).sort((a,b)=>a.priority-b.priority);

  const labels={weekly:'주간테스트 EWMA',coverage:'기출 커버리지',mastery:'마스터리(득점)',essay:'첨삭 점수',homework:'과제 수행'};
  const evidence=['weekly','coverage','mastery','essay','homework'].map(k=>`<div class="kv"><span>${esc(labels[k])}</span><b>${partMap[k]==null?'N/A':r1(partMap[k])+'%'}</b></div>`).join('');

  const cards=targets.length?targets.map(t=>{const u=ctx.universities.find(x=>x.id===t.university_id);if(!u)return '';
    const ab=admitBand(readiness,u);
    return `<div class="uni-card"><div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div><h4>${t.priority}지망 · ${esc(u.name)}${u.campus?`<span class="muted"> (${esc(u.campus)})</span>`:''}</h4>
          <div class="region">${esc(u.region)} · ${u.essay_only?'논술 100%':esc(u.essay_ratio||'논술+내신')}</div></div>
        ${!u.confirmed?'<span class="chip gray">시행계획 기준</span>':''}</div>
      <div style="display:flex;align-items:center;gap:10px;margin:12px 0"><span class="chip ${ab.cls}">${ab.label}</span><b style="font-size:22px">${readiness==null?'N/A':r1(readiness)+'%'}</b>
        <canvas class="spark" data-spark></canvas></div>
      <div class="kv"><span>논술고사일</span><b>${u.exam_date?esc(fmtDate(u.exam_date))+' ('+ddayLabel(u.exam_date)+')':'미정'}</b></div>
      ${(u.last_competition!=null||u.last_cut_pct!=null)?`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${u.last_competition!=null?`<span class="chip gray">작년 경쟁률 ${esc(u.last_competition)}:1</span>`:''}${u.last_cut_pct!=null?`<span class="chip gray">작년 합격선 ${esc(u.last_cut_pct)}%</span>`:''}</div>`:''}
      ${ab.delta?`<div class="muted" style="font-size:11px;margin-top:4px">기준 보정 ${ab.delta>0?'+':''}${ab.delta.toFixed(1)}</div>`:''}
    </div>`;}).join(''):'<p class="muted">목표 대학이 없습니다. [학생 관리]에서 설정하세요.</p>';

  c.innerHTML=await studentSelector()+`
    <div class="grid2" style="grid-template-columns:1.6fr 1fr">
      <div class="card"><h3>${svg('trending')}목표 대학별 합격 가능성 <span class="sub">밴드: 도전 &lt;55 · 적정 55~75 · 안정 &gt;75</span></h3>
        <div class="grid2">${cards}</div></div>
      <div class="card"><h3>${svg('activity')}준비도 근거</h3>
        <div style="font-size:32px;font-weight:800;margin-bottom:10px">${readiness==null?'N/A':r1(readiness)+'%'}</div>${evidence}</div>
    </div>
    <div class="card note-blue">본 지표는 학습 관리를 위한 참고 자료이며 합격을 보장하지 않습니다. 작년 경쟁률·합격선이 입력된 대학은 밴드 기준(도전/적정/안정 경계)이 대학별로 보정됩니다. 반영 비율·수능최저 등은 각 대학 모집요강을 확인하세요.</div>`;
  bindStudentSelector(()=>renderAdmission(c));
  // 스파크라인
  c.querySelectorAll('[data-spark]').forEach(cv=>{if(typeof Chart==='undefined')return;
    app.state.charts.push(new Chart(cv.getContext('2d'),{type:'line',data:{labels:spark.map((_,i)=>i+1),
      datasets:[{data:spark,borderColor:'#7C5CFC',borderWidth:2,pointRadius:0,tension:.35,fill:false}]},
      options:{responsive:false,plugins:{legend:{display:false}},scales:{x:{display:false},y:{display:false,min:0,max:100}}}}));});
}

export { renderAdmission };
