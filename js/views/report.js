/* 진행 현황 리포트 */
import { cellRateSince, computeReadiness, heatFromRecords, hwAccuracyAvg, hwTimeAvg, judgePrescription } from '../calc.js';
import { COGNITIONS, TODAY, UNITS } from '../config.js';
import { db, loadContext, studentBundle } from '../db.js';
import { svg } from '../icons.js';
import { app } from '../state.js';
import { bindStudentSelector, studentSelector } from '../ui.js';
import { $, esc, r1, todayStr } from '../util.js';

/* ═══════════════════════════════════════════════════════════════════
   7) 주간 리포트 (+인쇄)
   ═══════════════════════════════════════════════════════════════════ */
async function renderReport(c){
  const readonly=app.cur.role==='student';
  c.innerHTML=(readonly?'':await studentSelector())+'<p class="muted">불러오는 중...</p>';bindStudentSelector(()=>renderReport(c));
  const sid=app.cur.studentId;if(!sid){c.querySelector('p').textContent='학생을 선택하세요.';return;}
  const ctx=await loadContext();const b=await studentBundle(sid,ctx);const st=ctx.students.find(s=>s.id===sid);
  const weeks=b.perSession.map(s=>s.week);
  const wp=b.weeklyPercents;
  const printBar=`<div class="selectbar"><button class="btn line sm no-print" id="printBtn">${svg('print','sm')}인쇄/PDF</button></div>`;

  // KPI (전체 누적)
  const {readiness,coverage}=computeReadiness({weeklyPercents:b.weeklyPercents,weeklyScaled:b.weeklyScaled,questionRecords:b.questionRecords,essays:b.essayInputs,homeworks:b.homeworks});
  // 최근 8주 처방 성과 요약
  const rxAll=await db.listPrescriptions(sid);
  const since=new Date(TODAY.getTime()-56*86400000);
  const sinceStr=since.getFullYear()+'-'+String(since.getMonth()+1).padStart(2,'0')+'-'+String(since.getDate()).padStart(2,'0');
  const rxRecent=rxAll.filter(p=>p.status!=='cancelled'&&String(p.created_at||'').slice(0,10)>=sinceStr);
  const rxImproved=rxRecent.filter(p=>judgePrescription(p.baseline_rate,
    cellRateSince(b.questionRecords,p.unit,p.cognition,String(p.created_at||'').slice(0,10))).key==='improved').length;
  const rxLine=rxRecent.length
    ? `최근 8주 처방 ${rxRecent.length}건 중 <b>${rxImproved}건 개선</b>${rxRecent.length>rxImproved?` · ${rxRecent.length-rxImproved}건은 정체·악화 또는 재측정 대기`:''}`
    : '최근 8주에 배정된 처방이 없습니다.';
  const curPct=wp.length?wp[wp.length-1]:null;const prevPct=wp.length>1?wp[wp.length-2]:null;const delta=(curPct!=null&&prevPct!=null)?curPct-prevPct:null;
  const hw=b.homeworks;const hwAcc=hwAccuracyAvg(hw);const hwTime=hwTimeAvg(hw);
  const heat=heatFromRecords(b.questionRecords);let weakCells=0;UNITS.forEach(u=>COGNITIONS.forEach(cg=>{if(heat[u][cg].rate!=null&&heat[u][cg].rate<40)weakCells++;}));
  // 단원별 정답률
  const unitAgg={};UNITS.forEach(u=>unitAgg[u]={e:0,p:0});b.questionRecords.forEach(r=>{unitAgg[r.unit].e+=r.earned;unitAgg[r.unit].p+=r.points;});
  // 강사 코멘트(전체)
  const comments=await db.listTeacherComments(sid);
  const curComment=comments.find(t=>t.week_no===0);
  const wkLabel=w=>w===0?'종합':w+'주차';
  const pastList=comments.length?comments.map(t=>`<div class="timeline-item" style="padding:10px;margin-bottom:8px"><div class="th" style="margin-bottom:4px"><div><span class="chip ${t.week_no===0?'purple':'gray'}">${esc(wkLabel(t.week_no))}</span></div></div>
      <div style="font-size:13px;white-space:pre-wrap;line-height:1.6">${esc(t.comment)}</div></div>`).join(''):'<p class="muted">등록된 코멘트가 없습니다.</p>';

  c.innerHTML=(readonly?'':await studentSelector())+printBar+`
    <div class="card" id="reportSheet">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid var(--ink);padding-bottom:12px;margin-bottom:14px">
        <div><div style="font-size:12px;color:var(--muted)">NK 약술논술 AI 케어 · 진행 현황 리포트</div>
          <h2 style="margin:4px 0 0">${esc(st?.name||'')} <span class="muted" style="font-size:14px">${esc(st?.grade_type||'')}</span></h2></div>
        <div class="chip ${st?.status==='퇴원'?'red':'green'}">${esc(st?.status||'재원')}</div>
      </div>
      <div class="kpi-grid" style="margin-bottom:16px">
        <div class="kpi"><div class="lbl">준비도</div><div class="val">${readiness==null?'-':r1(readiness)+'<small>%</small>'}</div></div>
        <div class="kpi"><div class="lbl">최근 회차 점수</div><div class="val">${curPct==null?'-':r1(curPct)+'<small>%</small>'} ${delta==null?'':(delta>=0?'<span class="delta up" style="font-size:13px">'+svg('arrowUp','xs')+r1(Math.abs(delta))+'%p</span>':'<span class="delta down" style="font-size:13px">'+svg('arrowDown','xs')+r1(Math.abs(delta))+'%p</span>')}</div></div>
        <div class="kpi"><div class="lbl">과제 누적 정답률</div><div class="val">${hwAcc==null?'-':r1(hwAcc)+'<small>%</small>'}</div></div>
        <div class="kpi"><div class="lbl">취약 셀 수</div><div class="val">${weakCells}<small> 개</small></div></div>
      </div>
      <div class="muted" style="font-size:12px;margin:-8px 0 6px">과제 평균 풀이 시간: <b>${hwTime==null?'-':r1(hwTime)+'분/회'}</b> · 진도 커버리지: <b>${coverage==null?'-':Math.round(coverage)+'%'}</b></div>
      <div class="muted" style="font-size:12px;margin:0 0 14px">처방 성과: ${rxLine}</div>
      <div class="grid2">
        <div><h3 style="font-size:13px">주간 점수 추이</h3><canvas id="repLine" height="150"></canvas></div>
        <div><h3 style="font-size:13px">단원별 정답률</h3>${UNITS.map(u=>{const a=unitAgg[u];const p=a.p>0?Math.round(a.e/a.p*100):null;
          return `<div class="hbar-row"><span>${esc(u)}</span><div class="bar-track"><div class="bar-fill" style="width:${p||0}%;background:${p==null?'#ccc':(p<40?'var(--red)':p<70?'var(--amber)':'var(--green)')}"></div></div><span class="num">${p==null?'-':p+'%'}</span></div>`;}).join('')}</div>
      </div>
      <div style="margin-top:14px"><h3 style="font-size:13px">강사 코멘트</h3>
        ${readonly?'':`<textarea id="rep_comment" rows="3" style="width:100%;padding:10px;border:1.5px solid var(--line);border-radius:9px" placeholder="진행 현황 종합 코멘트">${curComment?esc(curComment.comment):''}</textarea>
            <button class="btn sm no-print" id="rep_save" style="margin-top:6px">${svg('check','xs')}코멘트 저장</button><span id="rep_msg" class="msg" style="margin-left:8px"></span>`}
        <div style="margin-top:10px">${pastList}</div>
      </div>
      <div style="margin-top:14px"><h3 style="font-size:13px">다음 단계 안내</h3>
        <div class="note-blue">취약 단원 집중 보완과 첨삭 서술 근거 정교화를 진행합니다. 자세한 사항은 담당 강사 코멘트를 참고하세요.</div></div>
      <div class="divider"></div>
      <p class="muted" style="font-size:11px">본 리포트는 학습 관리용 참고 자료이며 합격을 보장하지 않습니다. · 생성일 ${todayStr()}</p>
    </div>`;
  bindStudentSelector(()=>renderReport(c));
  $('printBtn')?.addEventListener('click',()=>window.print());
  $('rep_save')?.addEventListener('click',async()=>{const m=$('rep_msg');m.className='msg';try{await db.saveTeacherComment(sid,0,$('rep_comment').value.trim());m.className='msg ok';m.textContent='저장됨';renderReport(c);}catch(e){m.className='msg err';m.textContent='실패';}});
  // 라인차트
  if(typeof Chart!=='undefined'&&wp.length){
    app.state.charts.push(new Chart($('repLine').getContext('2d'),{type:'line',
      data:{labels:weeks.map(w=>w+'주'),datasets:[{label:'점수%',data:wp,borderColor:'#E8B54D',backgroundColor:'rgba(232,181,77,.15)',borderWidth:3,tension:.3,pointBackgroundColor:'#E8B54D',pointRadius:4,fill:true}]},
      options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,max:100}}}}));}
}

export { renderReport };
