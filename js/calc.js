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
// bundle: {weeklyPercents:[num], questionRecords:[{unit,points,earned}], essays:[{earned,max}], homeworks:[{problems_total,problems_correct}]}
function computeReadiness(bundle){
  const parts=[];
  if(bundle.weeklyPercents && bundle.weeklyPercents.length){
    parts.push({key:'weekly',weight:30,value:clamp(ewma(bundle.weeklyPercents))});
  }
  const qr=bundle.questionRecords||[];
  if(qr.length){
    const covered=new Set(qr.map(r=>r.unit));
    parts.push({key:'coverage',weight:25,value:clamp(covered.size/UNITS.length*100)});
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
  return {readiness,parts};
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

export { ewma, computeReadiness, weightedRecent3, shortfallContribution, hwAccuracyAvg, hwTimeAvg, heatFromRecords, band, admitBand };
