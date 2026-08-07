/* js/calc.js 순수 계산 함수 테스트
   실행: node js/calc.test.mjs        (외부 의존성 없음 — node:assert 만 사용)

   calc.js 는 부수효과가 없어야 하므로 DOM 스텁 없이 그대로 import 한다.
   실패 시 첫 단언에서 즉시 중단되고 종료 코드가 0이 아니게 된다. */
import assert from 'node:assert/strict';
import {
  ewma, computeReadiness, weightedRecent3, shortfallContribution,
  hwAccuracyAvg, hwTimeAvg, band, admitBand,
  sessionPercentRows, cohortSessionStats, standardizeWeekly,
  cellRateSince, judgePrescription, essayTotals, essayRangeFor,
} from './calc.js';

let passed = 0;
function t(name, fn){
  try{ fn(); passed++; console.log('  ok   ' + name); }
  catch(e){ console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
// 부동소수 비교
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !== ${b}`);

console.log('ewma — 지수가중이동평균');
t('빈 입력은 null', () => {
  assert.equal(ewma([]), null);
  assert.equal(ewma(null), null);
});
t('값이 하나면 그 값 그대로', () => near(ewma([50]), 50));
t('alpha=0.4: 새 값 0.4 / 누적값 0.6 으로 갱신', () => {
  // e0 = 0,   e1 = 0.4*100 + 0.6*0   = 40
  near(ewma([0, 100]), 40);
  // e0 = 100, e1 = 0.4*0   + 0.6*100 = 60
  // 2회뿐일 때는 직전값 가중(0.6)이 더 커서 오래된 값이 더 크게 반영된다.
  near(ewma([100, 0]), 60);
});
t('3회 이상이면 최신 단일값의 가중(0.4)이 가장 크다', () => {
  // [a,b,c] -> 0.36a + 0.24b + 0.40c
  const a = 100, b = 0, c = 0;
  near(ewma([a, b, c]), 0.36 * a);
  near(ewma([0, 0, 100]), 40);
  assert.ok(ewma([0, 0, 100]) > ewma([0, 100, 0]), '최신값이 중간값보다 크게 반영');
});
t('alpha 를 키우면 최신값 쪽으로 더 붙는다', () => {
  near(ewma([0, 100], 0.9), 90);
});

console.log('computeReadiness — 결측 항목 가중치 재정규화');
t('입력이 전혀 없으면 readiness=null', () => {
  const r = computeReadiness({});
  assert.equal(r.readiness, null);
  assert.deepEqual(r.parts, []);
});
t('주간점수만 있으면 그 값이 곧 readiness (30/30 으로 재정규화)', () => {
  const r = computeReadiness({ weeklyPercents: [80] });
  assert.equal(r.parts.length, 1);
  assert.equal(r.parts[0].key, 'weekly');
  near(r.readiness, 80);
});
t('주간점수+과제: 30:10 비율로 가중 평균', () => {
  // weekly 80(가중30), homework 5/10=50%(가중10) -> 80*0.75 + 50*0.25 = 72.5
  const r = computeReadiness({
    weeklyPercents: [80],
    homeworks: [{ problems_total: 10, problems_correct: 5 }],
  });
  assert.equal(r.parts.length, 2);
  near(r.readiness, 72.5);
});
t('coverage 는 준비도 가중 항목에서 빠지고 별도 값으로 반환된다', () => {
  const r = computeReadiness({
    questionRecords: [{ unit: '미분', points: 10, earned: 10 }],
  });
  // 진도를 얼마나 훑었는지는 실력이 아니므로 점수에 섞지 않는다
  assert.deepEqual(r.parts.map(p => p.key), ['mastery']);
  assert.ok(!r.parts.some(p => p.key === 'coverage'));
  // 6단원 중 1단원 커버
  near(r.coverage, 100 / 6);
  // mastery 단독이므로 readiness = mastery
  near(r.readiness, 100);
});
t('coverage 는 문항기록이 없으면 null', () => {
  assert.equal(computeReadiness({}).coverage, null);
  assert.equal(computeReadiness({ weeklyPercents: [80] }).coverage, null);
});
t('모든 항목이 있으면 가중치 합이 75(=30+20+15+10)', () => {
  const r = computeReadiness({
    weeklyPercents: [60],
    questionRecords: [
      { unit: '미분', points: 10, earned: 6 },
      { unit: '적분', points: 10, earned: 6 },
    ],
    essays: [{ earned: 30, max: 50 }],
    homeworks: [{ problems_total: 10, problems_correct: 6 }],
  });
  assert.equal(r.parts.reduce((s, p) => s + p.weight, 0), 75);
  const manual = r.parts.reduce((s, p) => s + p.value * (p.weight / 75), 0);
  near(r.readiness, manual);
  // 진도 커버리지는 별도로 나온다(2/6 단원)
  near(r.coverage, 200 / 6);
});
t('weeklyScaled 가 있으면 원점수 대신 그것을 쓴다', () => {
  const raw = computeReadiness({ weeklyPercents: [90] });
  const scaled = computeReadiness({ weeklyPercents: [90], weeklyScaled: [30] });
  near(raw.readiness, 90);
  near(scaled.readiness, 30);
});
t('값은 0~100 으로 clamp 된다', () => {
  const r = computeReadiness({ weeklyPercents: [999] });
  near(r.readiness, 100);
});

console.log('weightedRecent3 — 최근 3회 0.2/0.3/0.5 가중');
t('빈 입력은 null', () => {
  assert.equal(weightedRecent3([]), null);
  assert.equal(weightedRecent3(null), null);
});
t('1회뿐이면 가중치 재정규화로 그 값 그대로', () => near(weightedRecent3([100]), 100));
t('2회면 0.3/0.5 만 사용해 재정규화', () => {
  // (60*0.3 + 80*0.5) / 0.8 = 58/0.8 = 72.5
  near(weightedRecent3([60, 80]), 72.5);
});
t('3회면 0.2/0.3/0.5 그대로', () => {
  near(weightedRecent3([10, 60, 80]), 10 * 0.2 + 60 * 0.3 + 80 * 0.5);
});
t('4회 이상이면 최근 3회만 본다', () => {
  near(weightedRecent3([0, 10, 60, 80]), weightedRecent3([10, 60, 80]));
});

console.log('shortfallContribution — 실점기여도 내림차순');
t('contrib = (1 - rate/100) * pointShare', () => {
  const out = shortfallContribution([{ unit: 'A', cognition: '개념', rate: 50, pointShare: 0.4 }]);
  near(out[0].contrib, 0.2);
});
t('기여도 큰 순으로 정렬된다', () => {
  const out = shortfallContribution([
    { unit: 'A', cognition: '개념', rate: 90, pointShare: 0.5 },  // 0.05
    { unit: 'B', cognition: '계산', rate: 20, pointShare: 0.4 },  // 0.32
    { unit: 'C', cognition: '활용', rate: 60, pointShare: 0.3 },  // 0.12
  ]);
  assert.deepEqual(out.map(c => c.unit), ['B', 'C', 'A']);
});
t('원본 배열을 변형하지 않는다(순수 함수)', () => {
  const src = [{ unit: 'A', rate: 10, pointShare: 0.9 }];
  const copy = JSON.parse(JSON.stringify(src));
  shortfallContribution(src);
  assert.deepEqual(src, copy);
});

console.log('과제 집계');
t('hwAccuracyAvg 는 회차별 정답률의 평균', () => {
  assert.equal(hwAccuracyAvg([]), null);
  near(hwAccuracyAvg([
    { problems_total: 10, problems_correct: 5 },
    { problems_total: 10, problems_correct: 10 },
  ]), 75);
});
t('hwAccuracyAvg 는 total=0 을 0%로 처리(0으로 나누지 않음)', () => {
  near(hwAccuracyAvg([{ problems_total: 0, problems_correct: 0 }]), 0);
});
t('hwTimeAvg 는 시간 미입력 회차를 제외', () => {
  assert.equal(hwTimeAvg([{ time_min: null }, { time_min: '' }]), null);
  near(hwTimeAvg([{ time_min: 30 }, { time_min: null }, { time_min: 50 }]), 40);
});

console.log('밴드 판정');
t('band 는 준비도 구간을 라벨로 변환', () => {
  assert.equal(band(null).label, 'N/A');
  assert.equal(band(85).label, '상');
  assert.equal(band(70).label, '중상');
  assert.equal(band(55).label, '중');
  assert.equal(band(30).label, '중하');
});
t('admitBand 는 작년 결과가 없으면 보정 0', () => {
  const r = admitBand(80, {});
  assert.equal(r.delta, 0);
  assert.equal(r.label, '안정');
});
t('경쟁률·합격선이 높을수록 기준이 올라간다(같은 준비도가 더 낮은 등급)', () => {
  const easy = admitBand(70, { last_competition: 5, last_cut_pct: 50 });   // delta -8.5
  const hard = admitBand(70, { last_competition: 40, last_cut_pct: 90 });  // delta +10
  assert.ok(hard.delta > easy.delta, '어려운 대학의 보정값이 더 커야 한다');
  assert.equal(easy.label, '안정');
  assert.equal(hard.label, '적정');
});
t('보정된 기준선 아래로 내려가면 도전', () => {
  assert.equal(admitBand(60, { last_competition: 40, last_cut_pct: 90 }).label, '도전');
});
t('보정값은 -10~+10 으로 제한된다', () => {
  const r = admitBand(70, { last_competition: 9999, last_cut_pct: 9999 });
  assert.ok(r.delta <= 10);
});

console.log('회차 난이도 보정 — 코호트 z 표준화');
t('sessionPercentRows 는 학생×회차로 집계한다', () => {
  const questions = [{ id: 'q1', session_id: 's1', points: 10 }, { id: 'q2', session_id: 's1', points: 10 }];
  const sessions = [{ id: 's1', total_score: 20 }];
  const scores = [
    { question_id: 'q1', student_id: 'A', earned: 10 },
    { question_id: 'q2', student_id: 'A', earned: 5 },
    { question_id: 'q1', student_id: 'B', earned: 4 },
  ];
  const rows = sessionPercentRows(scores, questions, sessions);
  assert.equal(rows.length, 2);
  const a = rows.find(r => r.student_id === 'A');
  near(a.percent, 75);                    // 15/20
  near(rows.find(r => r.student_id === 'B').percent, 20);  // 4/20
});
t('total_score 가 없으면 배점 합계를 분모로 쓴다', () => {
  const rows = sessionPercentRows(
    [{ question_id: 'q1', student_id: 'A', earned: 5 }],
    [{ id: 'q1', session_id: 's1', points: 10 }],
    [{ id: 's1', total_score: null }]);
  near(rows[0].percent, 50);
});
t('cohortSessionStats 는 회차별 평균·표준편차(모표준편차)', () => {
  const st = cohortSessionStats([
    { session_id: 's1', percent: 40 },
    { session_id: 's1', percent: 60 },
  ]);
  near(st.s1.mean, 50);
  near(st.s1.sd, 10);
  assert.equal(st.s1.n, 2);
});
t('평균 위 1σ 는 60점, 아래 1σ 는 40점으로 재스케일', () => {
  const stats = { s1: { mean: 50, sd: 10, n: 5 } };
  near(standardizeWeekly([{ session_id: 's1', percent: 60 }], stats)[0], 60);
  near(standardizeWeekly([{ session_id: 's1', percent: 40 }], stats)[0], 40);
  near(standardizeWeekly([{ session_id: 's1', percent: 50 }], stats)[0], 50);
});
t('어려운 회차의 같은 원점수가 더 높게 평가된다', () => {
  const easy = { s1: { mean: 80, sd: 10, n: 5 } };
  const hard = { s1: { mean: 40, sd: 10, n: 5 } };
  const raw = [{ session_id: 's1', percent: 60 }];
  assert.ok(standardizeWeekly(raw, hard)[0] > standardizeWeekly(raw, easy)[0]);
});
t('전원 동점(σ=0)이면 50', () => {
  near(standardizeWeekly([{ session_id: 's1', percent: 77 }], { s1: { mean: 77, sd: 0, n: 4 } })[0], 50);
});
t('비교군이 2명 미만이면 보정하지 않고 원점수를 쓴다', () => {
  // 학생 계정은 RLS 때문에 본인 점수만 보이므로 이 경로를 탄다
  near(standardizeWeekly([{ session_id: 's1', percent: 77 }], { s1: { mean: 77, sd: 0, n: 1 } })[0], 77);
  near(standardizeWeekly([{ session_id: 's1', percent: 77 }], {})[0], 77);
});
t('보정 결과는 0~100 으로 clamp', () => {
  const stats = { s1: { mean: 50, sd: 1, n: 5 } };
  const hi = standardizeWeekly([{ session_id: 's1', percent: 100 }], stats)[0];
  const lo = standardizeWeekly([{ session_id: 's1', percent: 0 }], stats)[0];
  assert.ok(hi <= 100 && lo >= 0);
});

console.log('처방-재측정 판정');
t('배정 이후 회차만 집계한다', () => {
  const rec = [
    { unit: '삼각함수', cognition: '활용', points: 10, earned: 2, date: '2026-06-01' },  // 배정 전
    { unit: '삼각함수', cognition: '활용', points: 10, earned: 9, date: '2026-07-01' },  // 배정 후
  ];
  near(cellRateSince(rec, '삼각함수', '활용', '2026-06-15'), 90);
  near(cellRateSince(rec, '삼각함수', '활용', null), 55);   // 전체
});
t('배정일과 같은 날짜의 회차는 재측정 표본에서 제외한다', () => {
  // 경계가 >= 였을 때는 배정 당일 회차가 재측정에 섞였다. 처방은 그 회차 결과를 보고
  // 배정되므로 기준선과 재측정이 같은 표본을 공유해 개선이 구조적으로 과소평가된다.
  const rec = [
    { unit: '미분', cognition: '활용', points: 10, earned: 2, date: '2026-07-01' },  // 배정 당일 = 처방의 근거
    { unit: '미분', cognition: '활용', points: 10, earned: 9, date: '2026-07-08' },  // 배정 이후
  ];
  near(cellRateSince(rec, '미분', '활용', '2026-07-01'), 90);   // 90 (당일 회차 제외), >= 였다면 55
});
t('배정일 이후 회차가 하나도 없으면 재측정 없음(null)', () => {
  const rec = [{ unit: '미분', cognition: '활용', points: 10, earned: 2, date: '2026-07-01' }];
  assert.equal(cellRateSince(rec, '미분', '활용', '2026-07-01'), null);
});
t('해당 셀 데이터가 없으면 null', () => {
  assert.equal(cellRateSince([], '미분', '개념', null), null);
  assert.equal(cellRateSince([{ unit: '미분', cognition: '개념', points: 0, earned: 0, date: '2026-07-01' }], '미분', '개념', null), null);
});
t('+5%p 이상이면 개선', () => {
  const j = judgePrescription(50, 56);
  assert.equal(j.key, 'improved');
  near(j.delta, 6);
});
t('-5%p 이하면 악화', () => assert.equal(judgePrescription(50, 44).key, 'worse'));
t('경계 ±5%p 미만 변화는 정체(측정 잡음으로 본다)', () => {
  assert.equal(judgePrescription(50, 54).key, 'flat');
  assert.equal(judgePrescription(50, 46).key, 'flat');
  assert.equal(judgePrescription(50, 55).key, 'improved');   // 경계 포함
  assert.equal(judgePrescription(50, 45).key, 'worse');
});
t('재측정 데이터가 없으면 대기', () => {
  assert.equal(judgePrescription(50, null).key, 'pending');
  assert.equal(judgePrescription(null, 60).key, 'pending');
});

console.log('대학별 첨삭 실적 구간');
const ESSAYS = [
  { univ_name: '국민대', cond_earned: 8, cond_max: 10, proc_earned: 16, proc_max: 20, ans_earned: 6, ans_max: 10 }, // 30/40=75
  { univ_name: '국민대', cond_earned: 5, cond_max: 10, proc_earned: 10, proc_max: 20, ans_earned: 5, ans_max: 10 }, // 20/40=50
  { univ_name: '가천대', cond_earned: 9, cond_max: 10, proc_earned: 18, proc_max: 20, ans_earned: 9, ans_max: 10 },
];
t('대학명이 일치하는 첨삭만 집계한다', () => {
  const r = essayRangeFor(ESSAYS, '국민대');
  assert.equal(r.n, 2);
  near(r.min, 50); near(r.max, 75); near(r.avg, 62.5);
});
t('표본이 없으면 null', () => assert.equal(essayRangeFor(ESSAYS, '서경대'), null));
t('limit 으로 최근 n회만 본다', () => assert.equal(essayRangeFor(ESSAYS, '국민대', 1).n, 1));
t('만점이 0인 첨삭은 제외한다(0으로 나누지 않음)', () => {
  assert.equal(essayRangeFor([{ univ_name: 'X', cond_max: 0, proc_max: 0, ans_max: 0 }], 'X'), null);
});

console.log('첨삭 총점 — 신(items)·구(3분할) 형식 폴백');
t('total_* 가 있으면 그것을 쓴다', () => {
  const r = essayTotals({ total_earned: 33, total_max: 60, cond_earned: 999, cond_max: 999 });
  near(r.earned, 33); near(r.max, 60);
});
t('total_* 가 없으면 cond/proc/ans 합으로 폴백한다', () => {
  const r = essayTotals({ cond_earned: 8, cond_max: 10, proc_earned: 16, proc_max: 20, ans_earned: 6, ans_max: 10 });
  near(r.earned, 30); near(r.max, 40);
});
t('total_earned 가 0 이어도 total_max 가 있으면 폴백하지 않는다(0 과 null 구분)', () => {
  // 전 문항 X 로 0점을 받은 신형 기록이 구 경로로 새면 0/0 이 되어 준비도에서 사라진다
  const r = essayTotals({ total_earned: 0, total_max: 40, cond_earned: 8, cond_max: 10 });
  near(r.earned, 0); near(r.max, 40);
});
t('빈 기록은 0/0', () => {
  const r = essayTotals(null);
  near(r.earned, 0); near(r.max, 0);
});
t('essayRangeFor 는 신·구 형식이 섞여 있어도 함께 집계한다', () => {
  const mixed = [
    { univ_name: '국민대', total_earned: 30, total_max: 60 },                                   // 50
    { univ_name: '국민대', cond_earned: 8, cond_max: 10, proc_earned: 16, proc_max: 20, ans_earned: 6, ans_max: 10 }, // 75
    { univ_name: '국민대', total_earned: 0, total_max: 40 },                                    // 0 (구 경로로 새면 제외돼 평균이 올라간다)
  ];
  const r = essayRangeFor(mixed, '국민대');
  assert.equal(r.n, 3);
  near(r.min, 0); near(r.max, 75); near(r.avg, 125 / 3);
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ' / 일부 실패' : ' / 전부 통과'));
