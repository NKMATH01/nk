/* 합격 가능성 */
import { admitBand, computeReadiness, essayRangeFor, ewma } from '../calc.js';
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
  const {readiness,parts,coverage}=computeReadiness({weeklyPercents:b.weeklyPercents,weeklyScaled:b.weeklyScaled,questionRecords:b.questionRecords,essays:b.essayInputs,homeworks:b.homeworks});
  const partMap={};parts.forEach(p=>partMap[p.key]=p.value);
  // 주차별 준비도 스파크라인(간이: 누적 회차까지 EWMA 기반 재계산)
  const sparkSrc=(b.weeklyScaled&&b.weeklyScaled.length)?b.weeklyScaled:b.weeklyPercents;
  const spark=[];for(let i=1;i<=sparkSrc.length;i++){spark.push(clamp(ewma(sparkSrc.slice(0,i))));}
  const targets=ctx.targets.filter(t=>t.student_id===sid).sort((a,b)=>a.priority-b.priority);

  const rawAvg=b.weeklyPercents.length?b.weeklyPercents[b.weeklyPercents.length-1]:null;
  const labels={weekly:'주간테스트 EWMA(난이도 보정)',mastery:'마스터리(득점)',essay:'첨삭 점수',homework:'과제 수행'};
  const evidence=['weekly','mastery','essay','homework'].map(k=>`<div class="kv"><span>${esc(labels[k])}</span><b>${partMap[k]==null?'N/A':r1(partMap[k])+'%'}</b></div>`).join('')
    +`<div class="kv"><span>최근 회차 원점수</span><b>${rawAvg==null?'N/A':r1(rawAvg)+'%'}</b></div>`
    +`<div class="kv"><span>진도 커버리지 <span class="muted" style="font-size:11px">(준비도 미반영)</span></span><b>${coverage==null?'N/A':Math.round(coverage)+'%'}</b></div>`;

  const cards=targets.length?targets.map(t=>{const u=ctx.universities.find(x=>x.id===t.university_id);if(!u)return '';
    const ab=admitBand(readiness,u);
    const er=essayRangeFor(b.rawEssays,u.name);
    // 합격선 비교는 산출 기준(last_cut_basis)이 확인된 대학에만 한다.
    const canCompare=er&&u.last_cut_pct!=null&&u.last_cut_basis;
    const gap=canCompare?er.avg-Number(u.last_cut_pct):null;
    return `<div class="uni-card"><div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div><h4>${t.priority}지망 · ${esc(u.name)}${u.campus?`<span class="muted"> (${esc(u.campus)})</span>`:''}</h4>
          <div class="region">${esc(u.region)} · ${u.essay_only?'논술 100%':esc(u.essay_ratio||'논술+내신')}</div></div>
        ${!u.confirmed?'<span class="chip gray">시행계획 기준</span>':''}</div>
      ${er?`<div style="margin:12px 0">
          <div class="muted" style="font-size:11.5px">이 대학 유형 첨삭 점수</div>
          <div style="display:flex;align-items:baseline;gap:6px"><b style="font-size:22px">${r1(er.min)}~${r1(er.max)}<span style="font-size:13px">%</span></b>
            <span class="muted" style="font-size:12px">평균 ${r1(er.avg)}%</span></div>
          <div class="muted" style="font-size:11px">근거 표본 ${er.n}회</div>
        </div>`:`<div style="margin:12px 0"><span class="muted" style="font-size:12.5px">이 대학 유형으로 채점된 첨삭이 없습니다.</span></div>`}
      ${canCompare?`<div class="kv"><span>작년 합격선 대비</span><b style="color:${gap>=0?'var(--green)':'var(--red)'}">${gap>=0?'+':''}${r1(gap)}%p</b></div>
        <div class="muted" style="font-size:11px">합격선 기준: ${esc(u.last_cut_basis)}</div>`
        :(u.last_cut_pct!=null?`<div class="muted" style="font-size:11.5px">합격선 정의 미확인 — 비교 생략<br><span style="font-size:11px">[대학 정보]에서 합격선 산출 기준을 입력하면 비교가 표시됩니다.</span></div>`:'')}
      <div class="kv" style="margin-top:8px"><span>논술고사일</span><b>${u.exam_date?esc(fmtDate(u.exam_date))+' ('+ddayLabel(u.exam_date)+')':'미정'}</b></div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
        <span class="muted" style="font-size:11.5px">참고 밴드</span><span class="chip ${ab.cls}">${ab.label}</span>
        <canvas class="spark" data-spark></canvas></div>
      ${(u.last_competition!=null||u.last_cut_pct!=null)?`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${u.last_competition!=null?`<span class="chip gray">작년 경쟁률 ${esc(u.last_competition)}:1</span>`:''}${u.last_cut_pct!=null?`<span class="chip gray">작년 합격선 ${esc(u.last_cut_pct)}%</span>`:''}</div>`:''}
    </div>`;}).join(''):'<p class="muted">목표 대학이 없습니다. [학생 관리]에서 설정하세요.</p>';

  c.innerHTML=await studentSelector()+`
    <div class="grid2" style="grid-template-columns:1.6fr 1fr">
      <div class="card"><h3>${svg('trending')}목표 대학별 대비 현황 <span class="sub">첨삭 점수 실적 구간과 작년 합격선 비교</span></h3>
        <div class="grid2">${cards}</div></div>
      <div class="card"><h3>${svg('activity')}준비도 근거</h3>
        <div style="font-size:32px;font-weight:800;margin-bottom:10px">${readiness==null?'N/A':r1(readiness)+'%'}</div>${evidence}</div>
    </div>
    <div class="card note-blue">본 지표는 학습 관리를 위한 참고 자료이며 합격을 보장하지 않습니다. 첨삭 점수 구간은 우리 학원 채점 기준이고 대학 합격선은 각 대학 기준이라, 산출 기준이 확인된 대학만 격차를 표시합니다. 표본이 적을수록(근거 표본 수 확인) 변동이 큽니다. 반영 비율·수능최저 등은 각 대학 모집요강을 확인하세요.</div>`;
  bindStudentSelector(()=>renderAdmission(c));
  // 스파크라인
  c.querySelectorAll('[data-spark]').forEach(cv=>{if(typeof Chart==='undefined')return;
    app.state.charts.push(new Chart(cv.getContext('2d'),{type:'line',data:{labels:spark.map((_,i)=>i+1),
      datasets:[{data:spark,borderColor:'#7C5CFC',borderWidth:2,pointRadius:0,tension:.35,fill:false}]},
      options:{responsive:false,plugins:{legend:{display:false}},scales:{x:{display:false},y:{display:false,min:0,max:100}}}}));});
}

export { renderAdmission };
