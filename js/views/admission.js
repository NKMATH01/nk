/* 합격 가능성 */
import { admitBand, computeReadiness, essayRangeFor, ewma } from '../calc.js';
import { db, loadContext, studentBundle } from '../db.js';
import { svg } from '../icons.js';
import { app } from '../state.js';
import { bindStudentSelector, studentSelector } from '../ui.js';
import { $, clamp, ddayLabel, esc, fmtDate, r1 } from '../util.js';

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
    ${await calibrationCardHTML(ctx)}
    <div class="card note-blue">본 지표는 학습 관리를 위한 참고 자료이며 합격을 보장하지 않습니다. 첨삭 점수 구간은 우리 학원 채점 기준이고 대학 합격선은 각 대학 기준이라, 산출 기준이 확인된 대학만 격차를 표시합니다. 표본이 적을수록(근거 표본 수 확인) 변동이 큽니다. 반영 비율·수능최저 등은 각 대학 모집요강을 확인하세요.</div>`;
  bindOutcomeForm(c,ctx,readiness);
  bindStudentSelector(()=>renderAdmission(c));
  // 스파크라인
  c.querySelectorAll('[data-spark]').forEach(cv=>{if(typeof Chart==='undefined')return;
    app.state.charts.push(new Chart(cv.getContext('2d'),{type:'line',data:{labels:spark.map((_,i)=>i+1),
      datasets:[{data:spark,borderColor:'#7C5CFC',borderWidth:2,pointRadius:0,tension:.35,fill:false}]},
      options:{responsive:false,plugins:{legend:{display:false}},scales:{x:{display:false},y:{display:false,min:0,max:100}}}}));});
}

/* ═══════════════════════════════════════════════════════════════════
   판정 캘리브레이션

   우리가 [적정]이라고 한 학생들이 실제로 어떻게 됐는지 되짚는다.
   **밴드 임계값을 자동으로 조정하지 않는다.** 숫자를 보여 줄 뿐이고,
   기준을 바꿀지는 사람이 판단한다. 표본이 몇 명인지 항상 함께 적고,
   5명 미만이면 "표본 부족"이라고 명시해 과잉 해석을 막는다.
   ═══════════════════════════════════════════════════════════════════ */
const MIN_SAMPLE = 5;
const BAND_ORDER = ['안정', '적정', '도전', '-'];

async function calibrationCardHTML(ctx){
  if(app.cur.role !== 'admin') return '';   // 결과 기록은 관리자 전용
  let outcomes = [];
  try{ outcomes = await db.listOutcomes(); }catch(e){}

  const uniById = {};
  ctx.universities.forEach(u => uniById[u.id] = u.name + (u.campus ? '(' + u.campus + ')' : ''));
  const stuById = {};
  ctx.students.forEach(s => stuById[s.id] = s.name);

  const years = [...new Set(outcomes.map(o => o.year))].sort((a, b) => b - a);
  const blocks = years.map(y => {
    const rows = outcomes.filter(o => o.year === y && o.result !== '미응시');
    const byBand = {};
    rows.forEach(o => {
      const b = o.band_at || '-';
      (byBand[b] = byBand[b] || { n: 0, pass: 0 });
      byBand[b].n++;
      if(o.result === '합격' || o.result === '추가합격') byBand[b].pass++;
    });
    const lines = BAND_ORDER.filter(b => byBand[b]).map(b => {
      const s = byBand[b];
      const thin = s.n < MIN_SAMPLE;
      return `<div class="kv"><span>${esc(b)} 판정</span>
        <span><b>${s.n}명 중 ${s.pass}명 합격</b>${thin ? ' <span class="chip amber">표본 부족</span>' : ''}
        <span class="muted" style="font-size:11.5px"> (추가합격 포함)</span></span></div>`;
    }).join('');
    return `<div style="margin-bottom:10px"><div class="muted" style="font-size:12px;font-weight:700;margin-bottom:4px">${esc(y)}학년도 · 응시 ${rows.length}건</div>${lines || '<span class="muted" style="font-size:12px">집계할 판정 기록이 없습니다.</span>'}</div>`;
  }).join('');

  const recent = outcomes.slice(0, 8).map(o =>
    `<div class="kv"><span>${esc(stuById[o.student_id] || '-')} · ${esc(uniById[o.university_id] || '-')}</span>
      <span><span class="chip ${o.result === '합격' || o.result === '추가합격' ? 'green' : o.result === '불합격' ? 'red' : 'gray'}">${esc(o.result || '-')}</span>
      <span class="muted" style="font-size:11.5px">${esc(o.year)} · 당시 ${o.band_at ? esc(o.band_at) : '-'} ${o.readiness_at != null ? r1(o.readiness_at) + '%' : ''}</span></span></div>`).join('');

  const stuOpts = ctx.students.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  const uniOpts = ctx.universities.map(u => `<option value="${esc(u.id)}">${esc(uniById[u.id])}</option>`).join('');
  const thisYear = new Date().getFullYear();

  return `<div class="card"><h3>${svg('target')}판정 캘리브레이션 <span class="sub">우리 판정이 실제 결과와 얼마나 맞았는지 — 기준은 자동 조정하지 않습니다</span></h3>
    ${blocks || '<p class="muted">아직 입력된 입시 결과가 없습니다. 아래에서 결과를 기록하면 판정별 적중률이 집계됩니다.</p>'}
    <div class="divider"></div>
    <div style="font-size:12px;font-weight:700;margin-bottom:6px">결과 기록 <span class="muted" style="font-weight:400">입력 시 그 학생의 현재 준비도·밴드가 함께 저장됩니다</span></div>
    <div class="row" style="gap:6px">
      <div class="field"><label>학생</label><select id="ao_stu">${stuOpts}</select></div>
      <div class="field" style="flex:2"><label>대학</label><select id="ao_uni">${uniOpts}</select></div>
      <div class="field" style="max-width:90px"><label>학년도</label><input id="ao_year" type="number" value="${thisYear + 1}"></div>
      <div class="field" style="max-width:120px"><label>결과</label><select id="ao_res">
        <option>합격</option><option>추가합격</option><option>불합격</option><option>미응시</option></select></div>
      <button class="btn sm" id="ao_save" style="align-self:flex-end">기록</button></div>
    <div id="ao_msg" class="msg"></div>
    ${recent ? `<div class="divider"></div><div class="muted" style="font-size:12px;font-weight:700;margin-bottom:4px">최근 기록</div>${recent}` : ''}
    <p class="muted" style="font-size:11.5px;margin-top:10px">이 표는 관리자만 볼 수 있습니다. 학생·학부모 화면에는 표시되지 않습니다.</p>
  </div>`;
}

function bindOutcomeForm(c, ctx, readiness){
  const btn = $('ao_save');
  if(!btn) return;
  btn.addEventListener('click', async () => {
    const m = $('ao_msg'); m.className = 'msg'; m.textContent = '';
    const sid = $('ao_stu').value, uid = $('ao_uni').value;
    const year = Number($('ao_year').value);
    if(!sid || !uid || !year){ m.className = 'msg err'; m.textContent = '학생·대학·학년도를 확인하세요.'; return; }
    // 지금 화면의 준비도는 선택된 학생 것이므로, 다른 학생을 고르면 스냅샷을 남기지 않는다.
    const sameStudent = sid === app.cur.studentId;
    const uni = ctx.universities.find(u => u.id === uid);
    const ab = (sameStudent && readiness != null) ? admitBand(readiness, uni) : null;
    try{
      await db.upsertOutcome({
        student_id: sid, university_id: uid, year: year, result: $('ao_res').value,
        readiness_at: sameStudent && readiness != null ? r1(readiness) : null,
        band_at: ab ? ab.label : null,
      });
      m.className = 'msg ok';
      m.textContent = sameStudent ? '기록되었습니다(준비도·밴드 스냅샷 포함).'
        : '기록되었습니다. 준비도 스냅샷은 해당 학생을 선택한 상태에서 입력해야 저장됩니다.';
      renderAdmission(c);
    }catch(e){ m.className = 'msg err'; m.textContent = '실패: ' + (e?.message || '오류'); }
  });
}

export { renderAdmission, calibrationCardHTML };
