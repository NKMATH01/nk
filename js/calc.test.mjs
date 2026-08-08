/* js/calc.js 순수 계산 함수 테스트
   실행: node js/calc.test.mjs        (외부 의존성 없음 — node:assert 만 사용)

   calc.js 는 부수효과가 없어야 하므로 DOM 스텁 없이 그대로 import 한다.
   실패 시 첫 단언에서 즉시 중단되고 종료 코드가 0이 아니게 된다. */
import assert from 'node:assert/strict';
import {
  ewma, computeReadiness, weightedRecent3, shortfallContribution,
  hwAccuracyAvg, hwTimeAvg, band, admitBand,
  sessionPercentRows, cohortSessionStats, standardizeWeekly,
  cellRateSince, cellStatsSince, cellPooledRecent, judgePrescription, prescriptionJudgment,
  essayTotals, essayRangeFor,
  heatFromRecords, hasEnoughSample, SAMPLE_GATE, pointShareFromRecords,
  scoreTags, errorAxisFromRecords,
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

console.log('처방 표본 게이트 · 기준선 추정량(0019)');
t('cellStatsSince 는 rate 외에 표본(문항/배점/회차)을 함께 준다', () => {
  const rec = [
    { unit: '미분', cognition: '활용', points: 6, earned: 3, date: '2026-07-08' },
    { unit: '미분', cognition: '활용', points: 4, earned: 4, date: '2026-07-15' },
    { unit: '수열', cognition: '활용', points: 9, earned: 0, date: '2026-07-15' },   // 다른 셀
  ];
  const s = cellStatsSince(rec, '미분', '활용', '2026-07-01');
  near(s.rate, 70); assert.equal(s.n, 2); near(s.points, 10); assert.equal(s.sessions, 2);
});
t('cellRateSince 는 cellStatsSince 의 rate 와 완전히 같다(래퍼)', () => {
  const rec = [{ unit: '미분', cognition: '활용', points: 10, earned: 7, date: '2026-07-08' }];
  assert.equal(cellRateSince(rec, '미분', '활용', null), cellStatsSince(rec, '미분', '활용', null).rate);
  assert.equal(cellRateSince([], '미분', '활용', null), cellStatsSince([], '미분', '활용', null).rate);
});
t('재측정 배점이 10점 미만이면 판정하지 않고 표본 부족', () => {
  // 배점 9점으로 +20%p 가 나와도 판정하지 않는다. delta 도 내보내지 않는다 —
  // 판정하지 않기로 해 놓고 숫자를 보이면 그 숫자가 판정으로 읽힌다.
  const j = judgePrescription(50, 70, 9);
  assert.equal(j.key, 'insufficient');
  assert.equal(j.delta, null);
});
t('재측정 배점 10점은 경계 포함 — 판정한다', () => {
  assert.equal(judgePrescription(50, 70, 10).key, 'improved');
});
t('★ 배점을 넘기지 않으면 게이트를 적용하지 않는다(표본을 모르면 부족이라 말할 수 없다)', () => {
  assert.equal(judgePrescription(50, 70).key, 'improved');
  assert.equal(judgePrescription(50, 70, null).key, 'improved');
});
t('cellPooledRecent — 최근 3회 구간을 단순 배점 풀링으로 잰다(가중이 아니다)', () => {
  const rec = [
    { unit: '미분', cognition: '활용', points: 10, earned: 0, date: '2026-05-01' },  // 창 밖(4번째로 오래된 회차)
    { unit: '미분', cognition: '활용', points: 10, earned: 10, date: '2026-06-01' },
    { unit: '미분', cognition: '활용', points: 10, earned: 5,  date: '2026-06-08' },
    { unit: '미분', cognition: '활용', points: 20, earned: 5,  date: '2026-06-15' },
  ];
  const p = cellPooledRecent(rec, '미분', '활용', 3);
  near(p.rate, 50);           // (10+5+5)/(10+10+20) = 50. 최근 3회 가중이면 다른 값이 나온다
  assert.equal(p.n, 3); near(p.points, 40); assert.equal(p.sessions, 3);
});
t('cellPooledRecent — 표본이 없으면 rate=null', () => {
  assert.equal(cellPooledRecent([], '미분', '활용').rate, null);
});

console.log('prescriptionJudgment — 폴백 규약 · 저장된 판정 우선');
const RX_REC = [
  { unit: '미분', cognition: '활용', points: 20, earned: 4,  date: '2026-06-01' },  // 배정 전
  { unit: '미분', cognition: '활용', points: 20, earned: 14, date: '2026-07-01' },  // 배정 후 → 70%
];
t('★ pooled 가 있으면 pooled 로 비교한다(재측정과 같은 자)', () => {
  const j = prescriptionJudgment(
    { unit: '미분', cognition: '활용', created_at: '2026-06-15', baseline_rate: 20, baseline_rate_pooled: 60 }, RX_REC);
  assert.equal(j.baselinePooled, true);
  near(j.baseline, 60); near(j.delta, 10); assert.equal(j.key, 'improved');
});
t('★ pooled 가 없는 과거 처방은 구 baseline_rate 로 폴백한다(개편 전과 같은 판정)', () => {
  const p = { unit: '미분', cognition: '활용', created_at: '2026-06-15', baseline_rate: 20 };
  const j = prescriptionJudgment(p, RX_REC);
  assert.equal(j.baselinePooled, false);
  near(j.baseline, 20);
  // 개편 전 계산식과 한 글자도 다르지 않아야 한다
  const legacy = judgePrescription(p.baseline_rate, cellRateSince(RX_REC, p.unit, p.cognition, '2026-06-15'));
  assert.equal(j.key, legacy.key); near(j.delta, legacy.delta);
});
t('baseline_rate_pooled=0 은 값이 있는 것이다(0 과 null 을 구분한다)', () => {
  const j = prescriptionJudgment(
    { unit: '미분', cognition: '활용', created_at: '2026-06-15', baseline_rate: 90, baseline_rate_pooled: 0 }, RX_REC);
  assert.equal(j.baselinePooled, true); near(j.baseline, 0); assert.equal(j.key, 'improved');
});
t('기준선이 아예 없으면 재측정이 있어도 대기', () => {
  assert.equal(prescriptionJudgment({ unit: '미분', cognition: '활용', created_at: '2026-06-15' }, RX_REC).key, 'pending');
});
t('재측정 표본이 얇으면 표본 부족(과거 처방도 같은 게이트를 받는다)', () => {
  const thin = [{ unit: '미분', cognition: '활용', points: 4, earned: 4, date: '2026-07-01' }];
  const j = prescriptionJudgment({ unit: '미분', cognition: '활용', created_at: '2026-06-15', baseline_rate: 20 }, thin);
  assert.equal(j.key, 'insufficient'); near(j.recheck.points, 4);
});
t('★ 판정 멱등 — result 가 있으면 저장값을 그대로 읽고 다시 계산하지 않는다', () => {
  // 재측정 데이터는 '개선'을 가리키지만 저장된 판정은 '악화'다. 저장값이 이긴다 —
  // 데이터가 더 쌓여도 그때 내린 판정이 흔들리면 기록이 아니다.
  const j = prescriptionJudgment(
    { unit: '미분', cognition: '활용', created_at: '2026-06-15', baseline_rate_pooled: 20,
      result: 'worse', result_delta: -8 }, RX_REC);
  assert.equal(j.key, 'worse'); assert.equal(j.stored, true); near(j.delta, -8);
});
t('저장된 판정은 재측정 표본이 얇아도 표본 부족으로 뒤집히지 않는다', () => {
  const thin = [{ unit: '미분', cognition: '활용', points: 2, earned: 2, date: '2026-07-01' }];
  const j = prescriptionJudgment(
    { unit: '미분', cognition: '활용', created_at: '2026-06-15', baseline_rate_pooled: 20,
      result: 'improved', result_delta: 30 }, thin);
  assert.equal(j.key, 'improved'); assert.equal(j.stored, true);
});
t('알 수 없는 result 값은 대기로 떨어뜨린다(화면이 빈 칩을 그리지 않게)', () => {
  const j = prescriptionJudgment(
    { unit: '미분', cognition: '활용', created_at: '2026-06-15', baseline_rate_pooled: 20, result: 'zzz' }, RX_REC);
  assert.equal(j.key, 'pending');
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

console.log('표본 게이트 — 문항 3개 · 배점 6점 · 회차 2개');
t('세 조건을 모두 채우면 통과', () => {
  assert.equal(hasEnoughSample({ n: 3, points: 6, sessions: 2 }), true);
});
t('문항 수 경계: 2개는 미달, 3개는 통과', () => {
  assert.equal(hasEnoughSample({ n: 2, points: 20, sessions: 3 }), false);
  assert.equal(hasEnoughSample({ n: 3, points: 20, sessions: 3 }), true);
});
t('누적 배점 경계: 5점은 미달, 6점은 통과', () => {
  // 1점짜리 문항 5개를 여러 회차에 흩어도 배점이 얇으면 정답률이 요동친다
  assert.equal(hasEnoughSample({ n: 5, points: 5, sessions: 3 }), false);
  assert.equal(hasEnoughSample({ n: 5, points: 6, sessions: 3 }), true);
});
t('회차 경계: 한 회차에 몰린 표본은 미달(그 회차 난이도의 함수다)', () => {
  assert.equal(hasEnoughSample({ n: 5, points: 20, sessions: 1 }), false);
  assert.equal(hasEnoughSample({ n: 5, points: 20, sessions: 2 }), true);
});
t('빈 셀·결측 필드는 미달', () => {
  assert.equal(hasEnoughSample(null), false);
  assert.equal(hasEnoughSample({ rate: 0 }), false);           // 구 형태(n/points/sessions 없음)
  assert.equal(hasEnoughSample({ n: 3, points: 6 }), false);   // sessions 없음
});
t('SAMPLE_GATE 상수와 판정이 일치한다(화면 문구가 같은 값을 쓴다)', () => {
  assert.deepEqual(SAMPLE_GATE, { n: 3, points: 6, sessions: 2 });
});

console.log('heatFromRecords — 게이트용 필드(points·sessions)');
t('셀에 누적 배점과 관측 회차 수가 함께 담긴다', () => {
  const cell = heatFromRecords([
    { week: 1, unit: '미분', cognition: '활용', points: 4, earned: 2 },
    { week: 1, unit: '미분', cognition: '활용', points: 4, earned: 4 },
    { week: 2, unit: '미분', cognition: '활용', points: 4, earned: 0 },
  ])['미분']['활용'];
  assert.equal(cell.n, 3);
  near(cell.points, 12);
  assert.equal(cell.sessions, 2);
});
t('기존 반환 형태(rate·n)는 그대로다 — 게이트는 값을 바꾸지 않는다', () => {
  const recs = [{ week: 1, unit: '수열', cognition: '개념', points: 10, earned: 5 }];
  const cell = heatFromRecords(recs)['수열']['개념'];
  near(cell.rate, 50);
  assert.equal(cell.n, 1);
  // 표본 미달이어도 rate 자체는 계산된다(표시만 회색이 된다)
  assert.equal(hasEnoughSample(cell), false);
});
t('데이터가 없는 셀은 rate=null · sessions=0', () => {
  const cell = heatFromRecords([])['적분']['그래프'];
  assert.equal(cell.rate, null);
  assert.equal(cell.sessions, 0);
  near(cell.points, 0);
});

console.log('pointShareFromRecords — rate 와 같은 시간창(최근 3회)');
t('창 밖의 오래된 배점은 비중에서 빠진다', () => {
  const recs = [
    { week: 1, unit: '수열', cognition: '개념', points: 90, earned: 0 },   // 창 밖
    { week: 2, unit: '미분', cognition: '활용', points: 10, earned: 0 },
    { week: 3, unit: '미분', cognition: '활용', points: 10, earned: 0 },
    { week: 4, unit: '적분', cognition: '계산', points: 20, earned: 0 },
  ];
  const s = pointShareFromRecords(recs, 3);
  assert.equal(s['수열|개념'], undefined);   // 최근 3회(2·3·4주)에 없다
  near(s['미분|활용'], 20 / 40);
  near(s['적분|계산'], 20 / 40);
});
t('전 기간으로 넓히면 오래된 셀이 다시 들어온다(시간창이 실제로 작동)', () => {
  const recs = [
    { week: 1, unit: '수열', cognition: '개념', points: 90, earned: 0 },
    { week: 2, unit: '미분', cognition: '활용', points: 10, earned: 0 },
  ];
  near(pointShareFromRecords(recs, 99)['수열|개념'], 90 / 100);
});
t('비중의 합은 1', () => {
  const s = pointShareFromRecords([
    { week: 1, unit: '미분', cognition: '활용', points: 7, earned: 0 },
    { week: 1, unit: '적분', cognition: '계산', points: 3, earned: 0 },
  ]);
  near(Object.values(s).reduce((a, b) => a + b, 0), 1);
});
t('빈 입력·배점 0 이면 빈 객체', () => {
  assert.deepEqual(pointShareFromRecords([]), {});
  assert.deepEqual(pointShareFromRecords([{ week: 1, unit: '미분', cognition: '활용', points: 0 }]), {});
});

console.log('scoreTags — 배열(0018) 우선 · 단일 컬럼 폴백');
t('배열이 있으면 배열을 쓴다', () => {
  assert.deepEqual(scoreTags({ wrong_reason_tags: ['조건 해석', '계산 실수'], wrong_reason: '조건 해석' }),
    ['조건 해석', '계산 실수']);
});
t('★ 배열이 없는 과거 기록은 단일 원인으로 그대로 읽힌다', () => {
  assert.deepEqual(scoreTags({ wrong_reason: '계산 실수' }), ['계산 실수']);
  assert.deepEqual(scoreTags({ wrong_reason_tags: null, wrong_reason: '계산 실수' }), ['계산 실수']);
  assert.deepEqual(scoreTags({ wrong_reason_tags: [], wrong_reason: '계산 실수' }), ['계산 실수']);
});
t('중복과 빈 값을 걸러낸다', () => {
  assert.deepEqual(scoreTags({ wrong_reason_tags: ['조건 해석', '조건 해석', '', null] }), ['조건 해석']);
});
t('둘 다 없으면 빈 배열', () => {
  assert.deepEqual(scoreTags(null), []);
  assert.deepEqual(scoreTags({}), []);
  assert.deepEqual(scoreTags({ wrong_reason: null }), []);
});

console.log('errorAxisFromRecords — 오류유형 축(흘린 점수 단위)');
t('빈 입력은 빈 배열', () => {
  const r = errorAxisFromRecords([], [], {});
  assert.equal(r.length, 0);
  assert.equal(r.totalLostPoints, 0);
  assert.equal(r.skippedLegacyEssays, 0);
  assert.deepEqual(errorAxisFromRecords(null, null).length, 0);
});
t('주간테스트: 태그가 여러 개면 실점을 균등 분배한다', () => {
  // 10점 문항에서 4점을 잃고 태그 2개 → 각 2점
  const r = errorAxisFromRecords(
    [{ unit: '미분', cognition: '활용', points: 10, earned: 6, wrong_reason_tags: ['조건 해석', '계산 실수'] }], [], {});
  assert.equal(r.length, 2);
  near(r[0].lostPoints, 2); near(r[1].lostPoints, 2);
  near(r[0].share, 0.5);
  near(r.totalLostPoints, 4);
  assert.deepEqual(r.map(x => x.sources.test), [2, 2]);
});
t('주간테스트: 단일 태그(과거 기록)는 실점 전액을 가져간다', () => {
  const r = errorAxisFromRecords(
    [{ unit: '미분', cognition: '활용', points: 10, earned: 6, wrong_reason: '조건 해석' }], [], {});
  assert.equal(r[0].tag, '조건 해석');
  near(r[0].lostPoints, 4);
});
t('태그가 없는 실점은 미분류로 지어내지 않고 따로 센다', () => {
  const r = errorAxisFromRecords([{ unit: '미분', cognition: '활용', points: 10, earned: 6 }], [], {});
  assert.equal(r.length, 0);
  near(r.untaggedLostPoints, 4);
});
t('만점 문항은 집계에 들어가지 않는다', () => {
  const r = errorAxisFromRecords(
    [{ unit: '미분', cognition: '활용', points: 10, earned: 10, wrong_reason: '조건 해석' }], [], {});
  assert.equal(r.length, 0);
});
t('첨삭: RUBRIC 기본 라벨이 오류유형으로 매핑된다(백필 없이 즉시 편입)', () => {
  const r = errorAxisFromRecords([], [{
    week_date: '2026-07-01',
    items: [{ no: 1, criteria: [
      { label: '조건 해석', points: 8, mark: 'X' },   // 8점 손실 → '조건 해석'
      { label: '풀이 과정', points: 12, mark: 'P' },  // 6점 손실 → '풀이 근거 누락'
      { label: '최종 답안', points: 10, mark: 'X' },  // 10점 손실 → '답안 형식'
    ] }],
  }], {});
  const by = Object.fromEntries(r.map(x => [x.tag, x.lostPoints]));
  near(by['조건 해석'], 8);
  near(by['풀이 근거 누락'], 6);
  near(by['답안 형식'], 10);
  assert.equal(r[0].tag, '답안 형식');            // 손실 내림차순
  assert.equal(r[0].sources.test, 0);
  near(r[0].sources.essay, 10);
});
t('첨삭: O 는 손실이 없고, criteria.tag 가 있으면 라벨 매핑보다 우선한다', () => {
  const r = errorAxisFromRecords([], [{
    items: [{ no: 1, criteria: [
      { label: '조건 해석', points: 8, mark: 'O' },
      { label: '조건 해석', points: 8, mark: 'X', tag: '개념 누락' },
    ] }],
  }], {});
  assert.equal(r.length, 1);
  assert.equal(r[0].tag, '개념 누락');
  near(r[0].lostPoints, 8);
});
t('첨삭: 매핑에 없는 라벨은 미분류로 모인다', () => {
  const r = errorAxisFromRecords([], [{ items: [{ no: 1, criteria: [{ label: '서술 구조', points: 6, mark: 'X' }] }] }], {});
  assert.equal(r[0].tag, '미분류');
});
t('★ 구형 첨삭(items 없음)은 집계에서 빠지고 건수만 남는다', () => {
  const r = errorAxisFromRecords([], [
    { cond_earned: 4, cond_max: 10, proc_earned: 5, proc_max: 20, ans_earned: 0, ans_max: 10 },  // 구형
    { items: null, total_max: null },                                                            // 구형
    { items: [{ no: 1, criteria: [{ label: '조건 해석', points: 8, mark: 'X' }] }] },             // 신형
  ], {});
  assert.equal(r.length, 1);
  near(r[0].lostPoints, 8);
  assert.equal(r.skippedLegacyEssays, 2);
});
t('주간테스트와 첨삭이 같은 태그로 합쳐지고 sources 로 나뉜다', () => {
  const r = errorAxisFromRecords(
    [{ unit: '미분', cognition: '활용', points: 10, earned: 4, wrong_reason: '조건 해석' }],
    [{ items: [{ no: 1, criteria: [{ label: '조건 해석', points: 8, mark: 'X' }] }] }], {});
  assert.equal(r.length, 1);
  near(r[0].lostPoints, 14);
  near(r[0].sources.test, 6);
  near(r[0].sources.essay, 8);
  assert.equal(r[0].n, 2);
  near(r[0].share, 1);
});
t('sinceDate 는 주간테스트와 첨삭 양쪽을 자른다', () => {
  const recs = [
    { unit: '미분', cognition: '활용', points: 10, earned: 0, date: '2026-06-01', wrong_reason: '계산 실수' },
    { unit: '미분', cognition: '활용', points: 10, earned: 4, date: '2026-07-10', wrong_reason: '조건 해석' },
  ];
  const essays = [
    { week_date: '2026-06-02', items: [{ no: 1, criteria: [{ label: '최종 답안', points: 10, mark: 'X' }] }] },
    { week_date: '2026-07-11', items: [{ no: 1, criteria: [{ label: '조건 해석', points: 8, mark: 'X' }] }] },
  ];
  const r = errorAxisFromRecords(recs, essays, { sinceDate: '2026-07-01' });
  assert.equal(r.length, 1);
  assert.equal(r[0].tag, '조건 해석');
  near(r[0].lostPoints, 14);
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ' / 일부 실패' : ' / 전부 통과'));
