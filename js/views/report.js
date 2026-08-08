/* 진행 현황 리포트 */
import { computeReadiness, heatFromRecords, hwAccuracyAvg, hwTimeAvg, prescriptionJudgment, shortfallContribution } from '../calc.js';
import { COGNITIONS, TODAY, UNITS } from '../config.js';
import { db, loadContext, studentBundle } from '../db.js';
import { svg } from '../icons.js';
import { app } from '../state.js';
import { bindStudentSelector, readinessFormulaHTML, studentSelector } from '../ui.js';
import { $, daysUntil, ddayLabel, esc, fmtDate, r1, todayStr } from '../util.js';

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

  /* KPI (전체 누적)
     ★ 학생 화면은 준비도를 **재계산하지 않는다.** 학생 세션은 RLS 때문에 본인 점수만
       보여 코호트가 n<2 가 되고, 그러면 강사 화면과 다른 숫자가 나온다(4-2).
       readiness_snapshots 의 최신 값을 그대로 읽고, 없으면 '산출 대기'로 적는다 —
       없다고 재계산으로 때우면 그 순간 두 화면의 숫자가 다시 갈라진다.
     coverage 는 준비도가 아니라 진도 진행 상황이라 학생 화면에서도 그대로 계산한다. */
  const rd=computeReadiness({weeklyPercents:b.weeklyPercents,weeklyScaled:b.weeklyScaled,questionRecords:b.questionRecords,essays:b.essayInputs,homeworks:b.homeworks});
  const coverage=rd.coverage;
  /* 데모는 예외다 — RLS 가 없어 학생 역할로도 전체 점수가 보이고, 따라서 코호트가
     정상이라 재계산 값이 강사 화면과 **완전히 같다**. 데모 저장소에는 스냅샷 자체가
     없으므로 여기서 읽으면 화면 전체가 '산출 대기'가 된다. */
  const useSnap=readonly&&!app.DEMO;
  const snap=useSnap?await db.latestReadinessSnapshot(sid):null;
  const readiness=useSnap?(snap&&snap.readiness!=null?Number(snap.readiness):null):rd.readiness;
  // 스냅샷이 없을 때(readonly)와 값이 없을 때(admin)를 화면에서 구분한다.
  const readinessCell=readiness!=null
    ?r1(readiness)+'<small>%</small>'
    :(useSnap?'<span style="font-size:15px">산출 대기</span>':'-');
  const readinessNote=useSnap
    ?(snap&&snap.snap_date
      ?`<span class="muted" style="font-size:11px">${esc(fmtDate(snap.snap_date))} 산출 기준</span>`
      :'<span class="muted" style="font-size:11px">아직 산출되지 않았습니다. 강사가 확인 후 반영됩니다.</span>')
    :'';
  // 최근 8주 처방 성과 요약
  const rxAll=await db.listPrescriptions(sid);
  const since=new Date(TODAY.getTime()-56*86400000);
  const sinceStr=since.getFullYear()+'-'+String(since.getMonth()+1).padStart(2,'0')+'-'+String(since.getDate()).padStart(2,'0');
  const rxRecent=rxAll.filter(p=>p.status!=='cancelled'&&String(p.created_at||'').slice(0,10)>=sinceStr);
  // 판정은 calc.js prescriptionJudgment 하나만 쓴다(취약 진단·대시보드와 같은 숫자여야 한다).
  const rxImproved=rxRecent.filter(p=>prescriptionJudgment(p,b.questionRecords).key==='improved').length;
  const rxLine=rxRecent.length
    ? `최근 8주 처방 ${rxRecent.length}건 중 <b>${rxImproved}건 개선</b>${rxRecent.length>rxImproved?` · ${rxRecent.length-rxImproved}건은 정체·악화 또는 재측정 대기`:''}`
    : '최근 8주에 배정된 처방이 없습니다.';
  const curPct=wp.length?wp[wp.length-1]:null;const prevPct=wp.length>1?wp[wp.length-2]:null;const delta=(curPct!=null&&prevPct!=null)?curPct-prevPct:null;
  const hw=b.homeworks;const hwAcc=hwAccuracyAvg(hw);const hwTime=hwTimeAvg(hw);
  const heat=heatFromRecords(b.questionRecords);let weakCells=0;UNITS.forEach(u=>COGNITIONS.forEach(cg=>{if(heat[u][cg].rate!=null&&heat[u][cg].rate<40)weakCells++;}));
  // 단원별 정답률
  const unitAgg={};UNITS.forEach(u=>unitAgg[u]={e:0,p:0});b.questionRecords.forEach(r=>{unitAgg[r.unit].e+=r.earned;unitAgg[r.unit].p+=r.points;});

  /* [다음 단계 안내] 이 화면이 이미 계산·조회해 둔 것만 쓴다(추가 조회 0).
     취약 1순위(shortfallContribution) · 진행 중 처방(rxAll) · 다음 회차 D-day(ctx.sessions).
     없는 것은 없다고 쓴다 — 모든 학생이 같은 문장을 보는 하드코딩 안내로 되돌리지 마라. */
  const totPts=b.questionRecords.reduce((s,r)=>s+r.points,0)||1;
  const ptsByCell={};b.questionRecords.forEach(r=>{const k=r.unit+'|'+r.cognition;ptsByCell[k]=(ptsByCell[k]||0)+r.points;});
  const cells=[];UNITS.forEach(u=>COGNITIONS.forEach(cg=>{const h=heat[u][cg];
    if(h.rate!=null)cells.push({unit:u,cognition:cg,rate:h.rate,pointShare:(ptsByCell[u+'|'+cg]||0)/totPts});}));
  const weak=shortfallContribution(cells)[0];
  const rxActive=rxAll.filter(p=>p.status==='active');
  const nextSess=(ctx.sessions||[]).filter(s=>s.exam_date&&daysUntil(fmtDate(s.exam_date))>=0)
    .sort((a,b)=>daysUntil(fmtDate(a.exam_date))-daysUntil(fmtDate(b.exam_date)))[0];
  const nextSteps=`<div>${weak
      ? `<b>보완 1순위</b> · ${esc(weak.unit)} · ${esc(weak.cognition)} <span class="muted">최근 3회 가중 정답률 ${Math.round(weak.rate)}%</span>`
      : '<b>보완 1순위</b> · 순위를 낼 채점 표본이 아직 없습니다.'}</div>
    <div style="margin-top:6px"><b>진행 중 보완 과제</b>${rxActive.length?` ${rxActive.length}건`:''}</div>
    ${rxActive.length?rxActive.map(p=>`<div style="font-size:12.5px">· ${esc(p.unit)} · ${esc(p.cognition)}${p.note?' — '+esc(p.note):''}${p.due_date?` <span class="muted">기한 ${esc(fmtDate(p.due_date))}</span>`:''}</div>`).join('')
      :'<div style="font-size:12.5px">· 현재 배정된 보완 과제가 없습니다.</div>'}
    <div style="margin-top:6px">${nextSess
      ? `<b>다음 주간테스트</b> · ${esc(nextSess.week_no)}주차 ${esc(fmtDate(nextSess.exam_date))} <span class="chip blue">${ddayLabel(fmtDate(nextSess.exam_date))}</span>`
      : '<b>다음 주간테스트</b> · 예정된 회차가 아직 등록되지 않았습니다.'}</div>`;
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
        <div class="kpi"><div class="lbl">준비도</div><div class="val">${readinessCell}</div>${readinessNote}</div>
        <div class="kpi"><div class="lbl">최근 회차 점수</div><div class="val">${curPct==null?'-':r1(curPct)+'<small>%</small>'} ${delta==null?'':(delta>=0?'<span class="delta up" style="font-size:13px">'+svg('arrowUp','xs')+r1(Math.abs(delta))+'%p</span>':'<span class="delta down" style="font-size:13px">'+svg('arrowDown','xs')+r1(Math.abs(delta))+'%p</span>')}</div></div>
        <div class="kpi"><div class="lbl">과제 누적 정답률</div><div class="val">${hwAcc==null?'-':r1(hwAcc)+'<small>%</small>'}</div></div>
        <div class="kpi"><div class="lbl">취약 셀 수</div><div class="val">${weakCells}<small> 개</small></div></div>
      </div>
      ${readinessFormulaHTML()}
      <div class="muted" style="font-size:12px;margin:-8px 0 6px">과제 정답률(성실성): <b>${rd.diligence==null?'-':r1(rd.diligence)+'%'}</b> · 과제 평균 풀이 시간: <b>${hwTime==null?'-':r1(hwTime)+'분/회'}</b> · 진도 커버리지: <b>${coverage==null?'-':Math.round(coverage)+'%'}</b></div>
      ${/* 회차 난이도 대비(z)는 **관리자 화면에만** 병기한다.
            학생 세션은 RLS 로 본인 점수만 보여 코호트가 n<2 이고, 그때
            standardizeWeekly 는 보정을 포기하고 원점수를 그대로 돌려준다.
            그 값을 "난이도 대비"라고 적으면 원점수를 보정값으로 잘못 읽게 된다. */''}
      ${readonly?'':`<div class="muted" style="font-size:12px;margin:0 0 6px">회차 난이도 대비(참고): <b>${rd.weeklyScaledEwma==null?'비교군 부족':r1(rd.weeklyScaledEwma)}</b> <span style="font-size:11px">같은 회차를 본 학생들 평균이 50, 10 차이가 표준편차 1개입니다. 준비도 점수에는 넣지 않습니다.</span></div>`}
      <div class="muted" style="font-size:12px;margin:0 0 14px">처방 성과: ${rxLine}</div>
      <div class="grid2">
        <div><h3 style="font-size:13px">주간 점수 추이</h3><canvas id="repLine" height="150"></canvas></div>
        <div><h3 style="font-size:13px">단원별 정답률</h3>${UNITS.map(u=>{const a=unitAgg[u];const p=a.p>0?Math.round(a.e/a.p*100):null;
          return `<div class="hbar-row"><span>${esc(u)}</span><div class="bar-track"><div class="bar-fill" style="width:${p||0}%;background:${p==null?'#ccc':(p<40?'var(--red)':p<70?'var(--amber)':'var(--green)')}"></div></div><span class="num">${p==null?'-':p+'%'}</span></div>`;}).join('')}</div>
      </div>
      <div style="margin-top:14px"><h3 style="font-size:13px">강사 코멘트</h3>
        ${readonly?'':`<textarea id="rep_comment" rows="3" style="width:100%;padding:10px;border:1.5px solid var(--line);border-radius:9px" placeholder="진행 현황 종합 코멘트">${curComment?esc(curComment.comment):''}</textarea>
            <button class="btn sm no-print" id="rep_save" style="margin-top:6px">${svg('check','xs')}코멘트 저장</button>
            <button class="btn line sm no-print" id="rep_ai" style="margin-top:6px">${svg('spark','xs')}AI 초안</button><span id="rep_msg" class="msg" style="margin-left:8px"></span>
            <div id="rep_draft" class="no-print"></div>`}
        <div style="margin-top:10px">${pastList}</div>
      </div>
      <div style="margin-top:14px"><h3 style="font-size:13px">다음 단계 안내</h3>
        <div class="note-blue">${nextSteps}</div></div>
      <div class="divider"></div>
      <p class="muted" style="font-size:11px">본 리포트는 학습 관리용 참고 자료이며 합격을 보장하지 않습니다. · 생성일 ${todayStr()}</p>
    </div>`;
  bindStudentSelector(()=>renderReport(c));
  $('printBtn')?.addEventListener('click',()=>window.print());
  $('rep_save')?.addEventListener('click',async()=>{const m=$('rep_msg');m.className='msg';try{await db.saveTeacherComment(sid,0,$('rep_comment').value.trim());m.className='msg ok';m.textContent='저장됨';renderReport(c);}catch(e){m.className='msg err';m.textContent='실패';}});
  bindAiDraft(sid,curComment);
  // 라인차트
  if(typeof Chart!=='undefined'&&wp.length){
    app.state.charts.push(new Chart($('repLine').getContext('2d'),{type:'line',
      data:{labels:weeks.map(w=>w+'주'),datasets:[{label:'점수%',data:wp,borderColor:'#E8B54D',backgroundColor:'rgba(232,181,77,.15)',borderWidth:3,tension:.3,pointBackgroundColor:'#E8B54D',pointRadius:4,fill:true}]},
      options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,max:100}}}}));}
}

/* AI 서술 초안.
   초안은 회색 점선 상자에만 표시되고, [가져오기]를 눌러야 입력란으로 들어간다.
   입력란에 들어간 뒤에도 강사가 [코멘트 저장]을 눌러야 리포트에 실린다(2단계). */
async function bindAiDraft(sid,curComment){
  const btn=$('rep_ai');
  if(!btn)return;
  const box=$('rep_draft');
  const show=html=>{const b=$('rep_draft');if(b)b.innerHTML=html;};
  const boxStyle='border:1.5px dashed var(--line);border-radius:9px;padding:10px;background:#FAFAFB;margin-top:8px';

  // 이전에 만들어 둔 초안이 있으면 먼저 보여 준다.
  if(curComment&&curComment.ai_draft){
    show(`<div style="${boxStyle}"><div style="font-size:11px;font-weight:700;margin-bottom:4px">이전 AI 초안 (미확정)</div>
      <div class="ai_draft_text" style="font-size:12.5px;white-space:pre-wrap">${esc(curComment.ai_draft)}</div>
      <button type="button" class="btn sm ai_take" style="margin-top:6px">입력란으로 가져오기</button></div>`);
    bindTake();
  }

  function bindTake(){
    box?.querySelector?.('.ai_take')?.addEventListener('click',()=>{
      const t=box.querySelector('.ai_draft_text');
      const ta=$('rep_comment');
      if(t&&ta){ta.value=t.textContent;ta.focus();}
    });
  }

  btn.addEventListener('click',async()=>{
    const m=$('rep_msg');m.className='msg';m.textContent='';
    if(app.DEMO){show('<div style="'+boxStyle+'"><span class="chip gray">데모 모드 — 초안을 생성하지 않습니다</span></div>');return;}
    const status=await db.getAiStatus();
    if(!status||!status.configured){
      show('<div style="'+boxStyle+'"><span class="chip amber">AI 미설정</span>'
        +'<div class="muted" style="font-size:11.5px;margin-top:4px">GEMINI_API_KEY 가 등록되지 않았습니다. [설정] 화면을 참고하세요. 코멘트는 직접 작성하시면 됩니다.</div></div>');
      return;
    }
    btn.disabled=true;
    show('<div style="'+boxStyle+'"><span class="muted" style="font-size:12px">초안 생성 중...</span></div>');
    try{
      const r=await db.generateReportDraft(sid,0);
      show(`<div style="${boxStyle}"><div style="font-size:11px;font-weight:700;margin-bottom:4px">AI 초안 (미확정 · 강사 확인 필요)</div>
        <div class="ai_draft_text" style="font-size:12.5px;white-space:pre-wrap">${esc(r.draft||'')}</div>
        <button type="button" class="btn sm ai_take" style="margin-top:6px">입력란으로 가져오기</button>
        <span class="muted" style="font-size:11px;margin-left:6px">가져온 뒤 수정하고 [코멘트 저장]을 눌러야 리포트에 실립니다.</span></div>`);
      bindTake();
    }catch(e){
      show('<div style="'+boxStyle+'"><div class="msg err">'+esc(e?.message||'오류')+'</div>'
        +'<div class="muted" style="font-size:11px;margin-top:4px">검수 기준(확률·합격 단정 표현, 근거 없는 숫자)에 걸리면 초안을 내보내지 않습니다.</div></div>');
    }finally{btn.disabled=false;}
  });
}

export { renderReport, bindAiDraft };
