/* 순수 계산 로직 — 준비도/히트맵/실점기여도/밴드. 부수효과 0. js/calc.test.mjs 로 검증한다. */
import { COGNITIONS, UNITS } from './config.js';
import { clamp } from './util.js';

/* ═══════════════════════════════════════════════════════════════════
   계산 로직 (순수 함수) — 준비도 / 히트맵 / 실점기여도
   ═══════════════════════════════════════════════════════════════════ */
function ewma(percents,alpha=0.4){
  if(!percents||!percents.length)return null;
  let e=Number(percents[0])||0;
  for(let i=1;i<percents.length;i++)e=alpha*(Number(percents[i])||0)+(1-alpha)*e;
  return e;
}
/* bundle: {weeklyPercents:[num], weeklyScaled:[num], questionRecords:[{unit,points,earned}],
            essays:[{earned,max}], homeworks:[{problems_total,problems_correct}]}

   [주간점수] weeklyScaled 가 있으면 그것을 쓴다(회차 난이도를 보정한 값).
   없으면 weeklyPercents 원점수로 계산한다.

   [커버리지 분리] 진도를 얼마나 훑었는지(coverage)는 "실력"이 아니라 "진행 상황"이라,
   준비도 점수에 섞으면 시험을 많이 본 학생이 실력과 무관하게 높게 나온다.
   가중 항목에서 빼고 별도 반환값으로 돌려준다. */
function computeReadiness(bundle){
  const parts=[];
  const weekly=(bundle.weeklyScaled&&bundle.weeklyScaled.length)?bundle.weeklyScaled:bundle.weeklyPercents;
  if(weekly && weekly.length){
    parts.push({key:'weekly',weight:30,value:clamp(ewma(weekly))});
  }
  const qr=bundle.questionRecords||[];
  const covered=new Set(qr.map(r=>r.unit));
  const coverage=qr.length?clamp(covered.size/UNITS.length*100):null;
  if(qr.length){
    const pts=qr.reduce((s,r)=>s+(Number(r.points)||0),0);
    const earned=qr.reduce((s,r)=>s+(Number(r.earned)||0),0);
    parts.push({key:'mastery',weight:20,value:clamp(pts>0?earned/pts*100:0)});
  }
  const es=bundle.essays||[];
  if(es.length){
    const avg=es.reduce((s,e)=>s+((Number(e.max)||0)>0?(Number(e.earned)||0)/(Number(e.max))*100:0),0)/es.length;
    parts.push({key:'essay',weight:15,value:clamp(avg)});
  }
  const hw=bundle.homeworks||[];
  if(hw.length){
    const avg=hw.reduce((s,h)=>{const t=Number(h.problems_total)||0;const cc=Number(h.problems_correct)||0;return s+(t>0?cc/t*100:0);},0)/hw.length;
    parts.push({key:'homework',weight:10,value:clamp(avg)});
  }
  const tw=parts.reduce((s,p)=>s+p.weight,0);
  let readiness=null;
  if(tw>0)readiness=parts.reduce((s,p)=>s+p.value*(p.weight/tw),0);
  return {readiness,parts,coverage};
}

/* ── 회차 난이도 보정 (코호트 z-표준화) ──
   같은 70점이라도 쉬운 회차의 70점과 어려운 회차의 70점은 다르다.
   회차별로 전체 학생 분포를 구해 상대 위치(z)를 내고 50±10z 로 재스케일한다.
   원점수 %는 화면에 그대로 병행 표시한다(강사가 실제 점수를 봐야 하므로). */

// scores/questions/sessions → [{session_id, student_id, percent}] (학생×회차 1행)
function sessionPercentRows(scores,questions,sessions){
  const qById={},sessById={};
  (questions||[]).forEach(q=>qById[q.id]=q);
  (sessions||[]).forEach(s=>sessById[s.id]=s);
  const agg={};
  (scores||[]).forEach(sc=>{
    const q=qById[sc.question_id];if(!q)return;
    const s=sessById[q.session_id];if(!s)return;
    const k=sc.student_id+'|'+s.id;
    const a=(agg[k]=agg[k]||{session_id:s.id,student_id:sc.student_id,earned:0,pts:0,total:s.total_score});
    a.earned+=Number(sc.earned)||0;a.pts+=Number(q.points)||0;
  });
  return Object.values(agg).map(a=>{
    const denom=a.total||a.pts||0;
    return {session_id:a.session_id,student_id:a.student_id,percent:denom>0?clamp(a.earned/denom*100):0};
  });
}

// [{session_id, percent}] → {session_id: {mean, sd, n}}  (모표준편차)
function cohortSessionStats(rows){
  const by={};
  (rows||[]).forEach(r=>{if(r&&r.session_id!=null&&r.percent!=null)(by[r.session_id]=by[r.session_id]||[]).push(Number(r.percent));});
  const out={};
  Object.keys(by).forEach(k=>{
    const v=by[k],n=v.length;
    const mean=v.reduce((a,b)=>a+b,0)/n;
    const varr=n>1?v.reduce((s,x)=>s+(x-mean)*(x-mean),0)/n:0;
    out[k]={mean,sd:Math.sqrt(varr),n};
  });
  return out;
}

/* sessArr: [{session_id, percent}] (한 학생, 오래된→최신) → 보정 점수 배열
   비교군이 2명 미만이면 보정할 근거가 없으므로 원점수를 그대로 쓴다.
   (학생 계정은 RLS 때문에 본인 점수만 보이므로 이 경로를 타게 된다) */
function standardizeWeekly(sessArr,stats){
  return (sessArr||[]).map(s=>{
    const raw=clamp(Number(s.percent)||0);
    const st=stats&&stats[s.session_id];
    if(!st||st.n<2)return raw;
    if(st.sd===0)return 50;
    return clamp(50+10*((raw-st.mean)/st.sd));
  });
}

/* ── 처방-재측정 판정 ── */
const PRESCRIPTION_DELTA=5;   // %p. 이보다 작은 변화는 측정 잡음으로 본다.

// 배정 이후 실시된 회차만 모아 해당 단원×사고과정 정답률을 낸다. 데이터 없으면 null.
function cellRateSince(records,unit,cognition,sinceDate){
  const rs=(records||[]).filter(r=>r.unit===unit&&r.cognition===cognition
    &&(!sinceDate||(r.date&&String(r.date)>=String(sinceDate))));
  const pts=rs.reduce((s,r)=>s+(Number(r.points)||0),0);
  if(!pts)return null;
  return rs.reduce((s,r)=>s+(Number(r.earned)||0),0)/pts*100;
}

function judgePrescription(baselineRate,currentRate){
  if(baselineRate==null||currentRate==null)return {key:'pending',label:'재측정 대기',cls:'gray',delta:null};
  const d=Number(currentRate)-Number(baselineRate);
  if(d>=PRESCRIPTION_DELTA)return {key:'improved',label:'개선',cls:'green',delta:d};
  if(d<=-PRESCRIPTION_DELTA)return {key:'worse',label:'악화',cls:'red',delta:d};
  return {key:'flat',label:'정체',cls:'amber',delta:d};
}

/* ── 첨삭 점수 요약 (대학별 근거 표본) ──
   essay_gradings 중 해당 대학명으로 채점된 최근 n회의 총점 대비 %를
   최소~최대 구간·평균·표본 수로 돌려준다. 표본이 없으면 null. */
function essayRangeFor(essays,univName,limit=5){
  const rows=(essays||[])
    .filter(e=>e&&e.univ_name&&String(e.univ_name).trim()===String(univName||'').trim())
    .map(e=>{
      const earned=(Number(e.cond_earned)||0)+(Number(e.proc_earned)||0)+(Number(e.ans_earned)||0);
      const max=(Number(e.cond_max)||0)+(Number(e.proc_max)||0)+(Number(e.ans_max)||0);
      return max>0?clamp(earned/max*100):null;
    })
    .filter(v=>v!=null)
    .slice(0,limit);
  if(!rows.length)return null;
  return {
    n:rows.length,
    min:Math.min(...rows),
    max:Math.max(...rows),
    avg:rows.reduce((a,b)=>a+b,0)/rows.length,
  };
}
// 최근 3회 가중(0.5/0.3/0.2). sessionRates: 오래된-최신 순, 값 있는 회차만.
function weightedRecent3(sessionRates){
  if(!sessionRates||!sessionRates.length)return null;
  const last3=sessionRates.slice(-3);
  const wAll=[0.2,0.3,0.5];
  const wl=wAll.slice(3-last3.length);
  const wsum=wl.reduce((a,b)=>a+b,0);
  let acc=0;for(let i=0;i<last3.length;i++)acc+=Number(last3[i])*wl[i];
  return acc/wsum;
}
// cells: [{unit,cognition,rate(0..100),pointShare(0..1)}] -- 실점기여도 내림차순
function shortfallContribution(cells){
  return cells.map(c=>Object.assign({},c,{contrib:(1-(Number(c.rate)||0)/100)*(Number(c.pointShare)||0)}))
              .sort((a,b)=>b.contrib-a.contrib);
}
// 과제 점검: 정답률 평균(correct/total*100), 평균 풀이 시간
function hwAccuracyAvg(records){if(!records||!records.length)return null;
  return records.reduce((s,h)=>{const t=Number(h.problems_total)||0;return s+(t>0?(Number(h.problems_correct)||0)/t*100:0);},0)/records.length;}
function hwTimeAvg(records){const r=(records||[]).filter(h=>h.time_min!=null&&h.time_min!=='');if(!r.length)return null;
  return r.reduce((s,h)=>s+(Number(h.time_min)||0),0)/r.length;}

// 6x4 히트맵 (최근 3회 가중) + 셀 상세
function heatFromRecords(records){
  const bySess={}; // week -> unit -> cog -> {earned,pts}
  records.forEach(r=>{const w=r.week||0;
    (bySess[w]=bySess[w]||{});(bySess[w][r.unit]=bySess[w][r.unit]||{});
    const c=(bySess[w][r.unit][r.cognition]=bySess[w][r.unit][r.cognition]||{earned:0,pts:0,n:0});
    c.earned+=r.earned;c.pts+=r.points;c.n++;});
  const weeks=Object.keys(bySess).map(Number).sort((a,b)=>a-b);
  const grid={};
  UNITS.forEach(u=>{grid[u]={};COGNITIONS.forEach(cg=>{
    const rates=[];let n=0;
    weeks.forEach(w=>{const c=bySess[w]?.[u]?.[cg];if(c&&c.pts>0){rates.push(c.earned/c.pts*100);n+=c.n;}});
    grid[u][cg]={rate:weightedRecent3(rates),n};
  });});
  return grid;
}

function band(rd){if(rd==null)return {label:'N/A',cls:'gray'};if(rd>=80)return {label:'상',cls:'green'};if(rd>=65)return {label:'중상',cls:'blue'};if(rd>=50)return {label:'중',cls:'amber'};return {label:'중하',cls:'red'};}
function admitBand(rd,u){if(rd==null)return {label:'-',cls:'gray',delta:0};
  const cl=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  const compAdj=u&&u.last_competition!=null?cl((u.last_competition-15)*0.25,-5,5):0;
  const cutAdj=u&&u.last_cut_pct!=null?cl((u.last_cut_pct-65)*0.4,-8,8):0;
  const delta=cl(compAdj+cutAdj,-10,10);
  if(rd>75+delta)return {label:'안정',cls:'green',delta};
  if(rd>=55+delta)return {label:'적정',cls:'blue',delta};
  return {label:'도전',cls:'amber',delta};}

export { ewma, computeReadiness, weightedRecent3, shortfallContribution, hwAccuracyAvg, hwTimeAvg,
         heatFromRecords, band, admitBand,
         sessionPercentRows, cohortSessionStats, standardizeWeekly,
         cellRateSince, judgePrescription, essayRangeFor, PRESCRIPTION_DELTA };
