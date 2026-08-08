/* 순수 계산 로직 — 준비도/히트맵/실점기여도/밴드. 부수효과 0. js/calc.test.mjs 로 검증한다. */
import { COGNITIONS, RUBRIC_TO_ERROR, UNITS } from './config.js';
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
/* ── 준비도 산식 v2 (0020) ──
   bundle: {weeklyPercents:[num], weeklyScaled:[num], questionRecords:[{unit,points,earned}],
            essays:[{earned,max}], homeworks:[{problems_total,problems_correct}]}

   ★ 척도를 섞지 않는다 — 신규 산식은 z-표준화를 **쓰지 않는다**
     구 산식은 weekly 에 코호트 z-표준화 값(50+10z)을 넣고 mastery/essay/homework 는
     0~100 원시 %를 넣어 그대로 가중평균했다. z 척도의 50 은 "평균"이고 % 척도의
     50 은 "낙제"라, 두 척도를 더하면 상위권이 눌리고 하위권이 올라간다. 그 결과
     admitBand 의 75/55 **절대** 임계값이 의미를 잃는다.
       → 가중평균은 원점수 %(weeklyPercents)만 쓴다.
       → z 는 버리지 않는다. weeklyScaledEwma 로 따로 돌려주어 "회차 난이도 대비"
         참고 지표로 화면에 병기한다(같은 70점이라도 어려운 회차의 70점은 다르다).

   ★ 과제를 실력 가중에서 뺀다
     과제 정답률은 학생 자기채점이라 실력 측정치가 아니라 **성실성** 지표다.
     coverage 를 준비도에서 뺀 것과 같은 이유(아래)로 가중 항목에서 빼고
     diligence 로 따로 돌려준다. 화면에는 계속 "성실성"으로 표시한다.

   [커버리지 분리] 진도를 얼마나 훑었는지(coverage)는 "실력"이 아니라 "진행 상황"이라,
   준비도 점수에 섞으면 시험을 많이 본 학생이 실력과 무관하게 높게 나온다.

   ★ 신·구 병행 반환 — 기존 필드(readiness/parts/coverage)는 이름을 그대로 둔다
       readiness · parts             신규 산식
       readinessLegacy · partsLegacy 구 산식(과거 스냅샷과 같은 값이 나온다)
     스냅샷 적재는 둘을 함께 남기고(0020), readiness_snapshots 의 **기존 행은
     고치지 않는다**. 과거 스냅샷은 구 산식 값 그대로 보존된다. */
const READINESS_WEIGHTS={weekly:30,mastery:20,essay:15};
/* 화면에 그대로 내보내는 계산식 한 줄. 지금은 62 가 무엇인지 아무도 알려주지 않는다.
   ★ READINESS_WEIGHTS 를 고치면 이 문장도 함께 고쳐야 한다. */
const READINESS_FORMULA='주간점수 30% · 문항 정답률 20% · 첨삭 15% (없는 항목은 가중치를 나눠 재정규화)';
/* 산출 기준이 바뀐 날(코드 기준). 화면의 "산출 기준 변경일" 문구와 스냅샷 meta 에 쓴다.
   실제로 v2 로 적재되기 시작한 날짜는 meta.formula_version='v2' 인 첫 스냅샷의 snap_date 다. */
const READINESS_V2_SINCE='2026-08-08';

// 결측 항목의 가중치를 남은 항목에 나눠 재정규화한다(구·신 산식 공용).
function weightedAvg(defs){
  const parts=defs.filter(d=>d.value!=null);
  const tw=parts.reduce((s,p)=>s+p.weight,0);
  return {parts,value:tw>0?parts.reduce((s,p)=>s+p.value*(p.weight/tw),0):null};
}
function computeReadiness(bundle){
  const b=bundle||{};
  const weeklyRaw=(b.weeklyPercents&&b.weeklyPercents.length)?clamp(ewma(b.weeklyPercents)):null;
  const weeklyScaledEwma=(b.weeklyScaled&&b.weeklyScaled.length)?clamp(ewma(b.weeklyScaled)):null;
  const qr=b.questionRecords||[];
  const covered=new Set(qr.map(r=>r.unit));
  const coverage=qr.length?clamp(covered.size/UNITS.length*100):null;
  let mastery=null;
  if(qr.length){
    const pts=qr.reduce((s,r)=>s+(Number(r.points)||0),0);
    const earned=qr.reduce((s,r)=>s+(Number(r.earned)||0),0);
    mastery=clamp(pts>0?earned/pts*100:0);
  }
  const es=b.essays||[];
  const essay=es.length
    ?clamp(es.reduce((s,e)=>s+((Number(e.max)||0)>0?(Number(e.earned)||0)/(Number(e.max))*100:0),0)/es.length)
    :null;
  const hw=b.homeworks||[];
  const diligence=hw.length
    ?clamp(hw.reduce((s,h)=>{const t=Number(h.problems_total)||0;const cc=Number(h.problems_correct)||0;return s+(t>0?cc/t*100:0);},0)/hw.length)
    :null;

  // 신규 — 원점수 % 만. 과제는 빠진다.
  const nw=weightedAvg([
    {key:'weekly', weight:READINESS_WEIGHTS.weekly, value:weeklyRaw},
    {key:'mastery',weight:READINESS_WEIGHTS.mastery,value:mastery},
    {key:'essay',  weight:READINESS_WEIGHTS.essay,  value:essay}]);
  /* 구 — weeklyScaled 우선(없으면 원점수) + 과제 10%.
     ★ 이 분기를 "정리"하지 마라. 과거 스냅샷과 같은 값이 나와야 비교가 성립한다. */
  const lw=weightedAvg([
    {key:'weekly', weight:30,value:weeklyScaledEwma!=null?weeklyScaledEwma:weeklyRaw},
    {key:'mastery',weight:20,value:mastery},
    {key:'essay',  weight:15,value:essay},
    {key:'homework',weight:10,value:diligence}]);

  return {readiness:nw.value,parts:nw.parts,coverage,
          weeklyRaw,weeklyScaledEwma,diligence,
          readinessLegacy:lw.value,partsLegacy:lw.parts,
          formula:READINESS_FORMULA,formulaVersion:'v2'};
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
/* 재측정 표본 게이트. 배점 합이 이보다 얇으면 판정하지 않는다.
   ±5%p 가 의미를 가지려면 그만한 표본이 있어야 한다 — 2점짜리 한 문항으로
   "개선"을 선언하면 다음 주에 저절로 되돌아온다. 히트맵 게이트(SAMPLE_GATE)와
   달리 배점 하나만 본다: 재측정 구간은 배정 이후라 회차 수가 원래 적다. */
const RECHECK_MIN_POINTS=10;

/* 배정 이후 실시된 회차만 모아 해당 단원×사고과정 통계를 낸다.
   {rate, n, points, sessions}. 배점이 0이면 rate=null(재측정 없음).

   경계는 **초과(>)** 다. 같은 날짜의 회차는 재측정 표본에서 뺀다 —
   처방은 그 회차 결과를 보고 배정되므로, 취약을 만들어 낸 바로 그 회차가
   재측정에 섞이면 개선을 구조적으로 과소평가한다(기준선과 재측정이 같은 표본을 공유). */
function cellStatsSince(records,unit,cognition,sinceDate){
  const rs=(records||[]).filter(r=>r.unit===unit&&r.cognition===cognition
    &&(!sinceDate||(r.date&&String(r.date)>String(sinceDate))));
  const points=rs.reduce((s,r)=>s+(Number(r.points)||0),0);
  const sessions=new Set(rs.map(r=>r.date).filter(Boolean)).size;
  if(!points)return {rate:null,n:rs.length,points:0,sessions};
  return {rate:rs.reduce((s,r)=>s+(Number(r.earned)||0),0)/points*100,n:rs.length,points,sessions};
}
// 정답률만 필요한 호출부용 얇은 래퍼. 동작은 종전과 완전히 같다.
function cellRateSince(records,unit,cognition,sinceDate){
  return cellStatsSince(records,unit,cognition,sinceDate).rate;
}

/* 처방 기준선 — 재측정과 **같은 자**로 잰다.
   히트맵 rate 는 최근 3회 **가중**평균인데 재측정은 단순 배점 풀링이라,
   지금까지 서로 다른 추정량을 ±5%p 로 비교하고 있었다. 배정 시점에
   이 함수로 잰 값을 prescriptions.baseline_rate_pooled 에 함께 저장한다.
   구간은 그 셀에 기록이 있는 **최근 windowSessions 회차**(기본 3회)다. */
function cellPooledRecent(records,unit,cognition,windowSessions=3){
  const rs=(records||[]).filter(r=>r&&r.unit===unit&&r.cognition===cognition);
  const dates=[...new Set(rs.map(r=>r.date).filter(Boolean))].sort().slice(-windowSessions);
  // 날짜가 없는 기록만 있으면(구 데이터) 구간을 자를 근거가 없으므로 전부 쓴다.
  const win=dates.length?rs.filter(r=>dates.includes(r.date)):rs;
  const points=win.reduce((s,r)=>s+(Number(r.points)||0),0);
  if(!points)return {rate:null,n:win.length,points:0,sessions:dates.length};
  return {rate:win.reduce((s,r)=>s+(Number(r.earned)||0),0)/points*100,
          n:win.length,points,sessions:dates.length};
}

const JUDGE_META={
  improved:{label:'개선',cls:'green'},
  flat:{label:'정체',cls:'amber'},
  worse:{label:'악화',cls:'red'},
  pending:{label:'재측정 대기',cls:'gray'},
  insufficient:{label:'표본 부족',cls:'gray'},
};
function judgeOf(key,delta){
  const m=JUDGE_META[key]||JUDGE_META.pending;
  return {key:JUDGE_META[key]?key:'pending',label:m.label,cls:m.cls,delta:delta==null?null:Number(delta)};
}

/* judgePrescription(기준선, 재측정, 재측정배점)

   ★ 기준선과 재측정은 **같은 추정량**이어야 한다. 부르는 쪽이 섞지 않도록
     화면은 이 함수를 직접 부르지 말고 아래 prescriptionJudgment() 를 쓴다.

   recheckPoints 를 넘기면 표본 게이트가 걸린다. 넘기지 않으면(구 호출부)
   게이트를 적용하지 않는다 — 표본 크기를 모르는 채로 "부족"을 선언할 수는 없다. */
function judgePrescription(baselineRate,currentRate,recheckPoints){
  if(baselineRate==null||currentRate==null)return judgeOf('pending',null);
  // 재측정이 있는데 배점이 얇으면 판정하지 않는다. delta 도 내보내지 않는다 —
  // 판정하지 않기로 해 놓고 숫자를 보여주면 그 숫자가 판정으로 읽힌다.
  if(recheckPoints!=null&&Number(recheckPoints)<RECHECK_MIN_POINTS)return judgeOf('insufficient',null);
  const d=Number(currentRate)-Number(baselineRate);
  if(d>=PRESCRIPTION_DELTA)return judgeOf('improved',d);
  if(d<=-PRESCRIPTION_DELTA)return judgeOf('worse',d);
  return judgeOf('flat',d);
}

/* ── 처방 판정 진입점 (화면은 전부 이 함수만 쓴다) ──
   대시보드·취약진단·리포트가 각자 폴백을 쓰면 같은 처방이 화면마다 다르게 보인다.

   우선순위
     1) p.result 가 있으면 **저장된 판정을 그대로** 읽는다(0019).
        다시 계산하지 않는다 — 데이터가 더 쌓여도 그때 내린 판정이 흔들리면 기록이 아니다.
     2) 없으면 기준선과 재측정을 비교한다.

   ★ 기준선 폴백 규약 (0019)
        baseline_rate_pooled 가 있으면 → 그 값(재측정과 같은 단순 배점 풀링)
        null 이면(0019 이전 처방)      → 기존 baseline_rate (개편 전과 같은 값)
     과거 처방의 기준선·delta 는 개편 전과 **완전히 같다**. 달라지는 것은
     재측정 배점이 10점 미만일 때 판정 대신 '표본 부족'이 나오는 것뿐이며,
     이는 얇은 표본으로 내리던 판정을 의도적으로 거둬들인 것이다.

   반환에는 판정 외에 baseline(쓴 기준선)·baselinePooled(같은 자였는지)·
   recheck(재측정 통계)·stored(저장된 판정인지)를 함께 담는다. */
function prescriptionJudgment(p,records){
  if(!p)return Object.assign(judgeOf('pending',null),{baseline:null,baselinePooled:false,
    recheck:{rate:null,n:0,points:0,sessions:0},stored:false});
  const since=p.created_at?String(p.created_at).slice(0,10):null;
  const recheck=cellStatsSince(records,p.unit,p.cognition,since);
  const pooled=p.baseline_rate_pooled!=null;
  const baseline=pooled?Number(p.baseline_rate_pooled)
    :(p.baseline_rate==null?null:Number(p.baseline_rate));
  const extra={baseline,baselinePooled:pooled,recheck};
  if(p.result)return Object.assign(judgeOf(p.result,p.result_delta),extra,{stored:true});
  return Object.assign(judgePrescription(baseline,recheck.rate,recheck.points),extra,{stored:false});
}

/* ── 첨삭 총점 (신·구 형식 공용) ──
   items(문항×채점기준 O/△/X) 기록은 저장된 total_earned/total_max 를 쓰고,
   그 이전 3분할(조건해석/풀이과정/최종답안) 기록은 cond/proc/ans 합으로 폴백한다.
   판별은 **total_max 의 null 여부**로 한다 — total_earned 는 0점 기록일 수 있어
   0 과 null 을 구분하지 못하면 멀쩡한 신규 기록이 구 경로로 새어 0/0 이 된다.
   총점 합산은 이 함수 하나만 쓴다(db.js 준비도·essayRangeFor 양쪽). */
function essayTotals(e){
  if(!e)return {earned:0,max:0};
  if(e.total_max!=null)return {earned:Number(e.total_earned)||0,max:Number(e.total_max)||0};
  return {earned:(Number(e.cond_earned)||0)+(Number(e.proc_earned)||0)+(Number(e.ans_earned)||0),
          max:(Number(e.cond_max)||0)+(Number(e.proc_max)||0)+(Number(e.ans_max)||0)};
}

/* ── 첨삭 점수 요약 (대학별 근거 표본) ──
   essay_gradings 중 해당 대학명으로 채점된 최근 n회의 총점 대비 %를
   최소~최대 구간·평균·표본 수로 돌려준다. 표본이 없으면 null. */
function essayRangeFor(essays,univName,limit=5){
  const rows=(essays||[])
    .filter(e=>e&&e.univ_name&&String(e.univ_name).trim()===String(univName||'').trim())
    .map(e=>{
      const {earned,max}=essayTotals(e);
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

/* 6x4 히트맵 (최근 3회 가중) + 셀 상세
   셀은 {rate, n, points, sessions}. rate·n 은 기존 그대로이고 points(누적 배점)와
   sessions(관측된 서로 다른 회차 수)는 표본 게이트(hasEnoughSample)가 쓰려고 더한 값이다.
   **rate 계산은 손대지 않았다** — 게이트는 표시 여부만 바꾸고 값 자체를 바꾸지 않는다. */
function heatFromRecords(records){
  const bySess={}; // week -> unit -> cog -> {earned,pts}
  records.forEach(r=>{const w=r.week||0;
    (bySess[w]=bySess[w]||{});(bySess[w][r.unit]=bySess[w][r.unit]||{});
    const c=(bySess[w][r.unit][r.cognition]=bySess[w][r.unit][r.cognition]||{earned:0,pts:0,n:0});
    c.earned+=r.earned;c.pts+=r.points;c.n++;});
  const weeks=Object.keys(bySess).map(Number).sort((a,b)=>a-b);
  const grid={};
  UNITS.forEach(u=>{grid[u]={};COGNITIONS.forEach(cg=>{
    const rates=[];let n=0,pts=0;
    weeks.forEach(w=>{const c=bySess[w]?.[u]?.[cg];if(c&&c.pts>0){rates.push(c.earned/c.pts*100);n+=c.n;pts+=c.pts;}});
    grid[u][cg]={rate:weightedRecent3(rates),n,points:pts,sessions:rates.length};
  });});
  return grid;
}

/* ── 표본 게이트 ──
   히트맵 셀 하나를 "진단해도 되는 표본"으로 볼지 판정한다.
   문항 1개를 틀려 rate=0 이 된 셀이 취약 1순위로 올라가고, 그 0% 가 처방
   baseline_rate 로 **박제되는 것**을 막는다.

   문항 3개 이상 · 누적 배점 6점 이상 · **서로 다른 회차 2개 이상**.
   회차 조건이 따로 필요한 이유: 한 회차에 몰린 3문항의 정답률은 그 회차
   난이도의 함수이지 학생 능력의 함수가 아니다. 그 주 문제가 유난히 어려웠으면
   셀 전체가 통째로 취약으로 잘못 찍히고, 다음 회차에 저절로 되돌아온다.

   게이트는 **순위에서 빼는 것**이지 값을 지우는 것이 아니다. 히트맵에는
   회색으로 남긴다 — 표본이 없다는 사실 자체가 다음 출제에 주는 정보다. */
const SAMPLE_GATE={n:3,points:6,sessions:2};
function hasEnoughSample(cell){
  if(!cell)return false;
  return (Number(cell.n)||0)>=SAMPLE_GATE.n
    &&(Number(cell.points)||0)>=SAMPLE_GATE.points
    &&(Number(cell.sessions)||0)>=SAMPLE_GATE.sessions;
}

/* ── 실점기여도의 배점 비중 ──
   rate 는 최근 3회 가중인데 pointShare 가 전 기간이면 시간창이 어긋난다.
   예전에 많이 출제됐다가 최근에는 안 나오는 셀이 과대평가되고, 그 셀이
   우선 보완 순위 위쪽을 차지한다. 같은 최근 N회(기본 3회)의 배점만으로 낸다.
   반환: {'단원|사고': 0..1}. 창 안에 배점이 하나도 없으면 빈 객체.
   회차 구분은 heatFromRecords 와 같은 기준(week, 없으면 0)을 쓴다. */
function pointShareFromRecords(records,windowSessions=3){
  const rs=records||[];
  const weeks=[...new Set(rs.map(r=>r.week||0))].sort((a,b)=>a-b);
  const keep=new Set(weeks.slice(-windowSessions));
  const out={};let tot=0;
  rs.forEach(r=>{if(!keep.has(r.week||0))return;
    const p=Number(r.points)||0;if(!p)return;
    const k=r.unit+'|'+r.cognition;out[k]=(out[k]||0)+p;tot+=p;});
  if(!tot)return {};
  Object.keys(out).forEach(k=>{out[k]=out[k]/tot;});
  return out;
}

/* ── 오답원인 태그 읽기 ──
   **모든 소비처는 이 함수만 쓴다.** 배열(0018)과 단일 컬럼이 공존하므로
   폴백을 여러 군데에 흩어 두면 화면마다 다른 숫자가 나온다.
     wrong_reason_tags 가 비어 있지 않으면 → 그 배열(중복 제거)
     비어 있거나 null 이면              → [wrong_reason] 중 truthy 만
   배열이 없는 과거 기록은 지금까지와 똑같이 단일 원인으로 읽힌다. */
function scoreTags(sc){
  if(!sc)return [];
  const arr=Array.isArray(sc.wrong_reason_tags)?sc.wrong_reason_tags.filter(Boolean):[];
  if(arr.length)return [...new Set(arr)];
  return sc.wrong_reason?[sc.wrong_reason]:[];
}

/* ── 오류유형 축 ──
   주간테스트 태그와 첨삭 채점기준을 **"흘린 점수"** 단위로 합산한다.
   문항 수로 세지 않는 이유: 첨삭은 한 문항에 기준이 3개 이상이라 문항 수로 세면
   첨삭이 주간테스트를 압도한다. 점수 단위여야 "28점 손실 → 무엇부터"로 이어진다.

   errorAxisFromRecords(questionRecords, essays, opts)
     opts.sinceDate  이 날짜 이후(포함)만 집계. 없으면 전 기간
   반환은 [{tag, lostPoints, share, n, sources:{test,essay}}] 배열(손실 내림차순)이며,
   **집계에서 빠진 것**을 배열의 속성으로 함께 돌려준다 — 제외했다는 사실이
   화면에 표시되어야 하기 때문이다.
     .skippedLegacyEssays  기준별 정보가 없어 제외한 구형(3분할) 첨삭 건수
     .untaggedLostPoints   태그가 없어 원인을 알 수 없는 주간테스트 실점
     .totalLostPoints      share 의 분모 */
const UNCLASSIFIED_TAG='미분류';
// 첨삭 판정 → 득점. js/views/essays.js markScore 와 같은 규칙(O 전액 / P 절반 / X 0).
function markEarned(points,mark){const p=Number(points)||0;return mark==='O'?p:(mark==='P'?p/2:0);}
function errorAxisFromRecords(questionRecords,essays,opts){
  const since=opts&&opts.sinceDate?String(opts.sinceDate):null;
  const map={};
  const add=(tag,lost,src)=>{
    if(!tag||!(lost>0))return;
    const e=(map[tag]=map[tag]||{tag,lostPoints:0,share:0,n:0,sources:{test:0,essay:0}});
    e.lostPoints+=lost;e.n++;e.sources[src]+=lost;
  };
  /* 주간테스트 — 그 문항에서 잃은 점수(배점-득점)를 태그들에 배분한다.
     태그가 여러 개면 **균등 분배**한다. 어느 태그가 몇 점을 유발했는지는
     데이터에 없다(강사는 감점 항목을 체크할 뿐 태그별로 점수를 나누지 않는다).
     균등이 가장 약한 가정이며, 한 태그에 몰아주면 없는 사실을 지어내는 것이 된다. */
  let untagged=0;
  (questionRecords||[]).forEach(r=>{
    if(!r)return;
    if(since&&!(r.date&&String(r.date)>=since))return;
    const lost=(Number(r.points)||0)-(Number(r.earned)||0);
    if(!(lost>0))return;
    const tags=scoreTags(r);
    // 태그가 없으면 원인을 모른다. '미분류'로 채우지 않고 뺀 양만 남긴다.
    if(!tags.length){untagged+=lost;return;}
    tags.forEach(t=>add(t,lost/tags.length,'test'));
  });
  /* 첨삭 — mark 가 P/X 인 기준에서 잃은 점수를 그 기준의 태그에 넣는다.
     태그 결정 순서: criteria[].tag → RUBRIC_TO_ERROR[label] → '미분류'. */
  let skippedLegacyEssays=0;
  (essays||[]).forEach(e=>{
    if(!e)return;
    if(since&&!(e.week_date&&String(e.week_date)>=since))return;
    /* items 가 없는 구형 3분할 기록(0014 이전)은 기준별 판정이 없다.
       3분할 득점을 조건해석/풀이과정/최종답안으로 되돌려 매핑하면 없던
       기준별 판정을 지어내는 셈이라 **집계에서 제외**하고 건수만 남긴다. */
    if(!Array.isArray(e.items)){skippedLegacyEssays++;return;}
    e.items.forEach(it=>((it&&it.criteria)||[]).forEach(cr=>{
      if(!cr||(cr.mark!=='P'&&cr.mark!=='X'))return;
      const p=Number(cr.points)||0;
      add(cr.tag||RUBRIC_TO_ERROR[cr.label]||UNCLASSIFIED_TAG,p-markEarned(p,cr.mark),'essay');
    }));
  });
  const rows=Object.values(map).sort((a,b)=>b.lostPoints-a.lostPoints);
  const tot=rows.reduce((s,r)=>s+r.lostPoints,0);
  rows.forEach(r=>{r.share=tot>0?r.lostPoints/tot:0;});
  rows.skippedLegacyEssays=skippedLegacyEssays;
  rows.untaggedLostPoints=untagged;
  rows.totalLostPoints=tot;
  return rows;
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
         cellRateSince, cellStatsSince, cellPooledRecent, judgePrescription, prescriptionJudgment,
         essayTotals, essayRangeFor, PRESCRIPTION_DELTA, RECHECK_MIN_POINTS,
         READINESS_WEIGHTS, READINESS_FORMULA, READINESS_V2_SINCE,
         hasEnoughSample, SAMPLE_GATE, pointShareFromRecords,
         scoreTags, errorAxisFromRecords, UNCLASSIFIED_TAG };
