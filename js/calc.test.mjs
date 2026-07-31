/* js/calc.js 순수 계산 함수 테스트
   실행: node js/calc.test.mjs        (외부 의존성 없음 — node:assert 만 사용)

   calc.js 는 부수효과가 없어야 하므로 DOM 스텁 없이 그대로 import 한다.
   실패 시 첫 단언에서 즉시 중단되고 종료 코드가 0이 아니게 된다. */
import assert from 'node:assert/strict';
import {
  ewma, computeReadiness, weightedRecent3, shortfallContribution,
  hwAccuracyAvg, hwTimeAvg, band, admitBand,
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
t('문항기록은 coverage(25)와 mastery(20) 두 항목을 만든다', () => {
  const r = computeReadiness({
    questionRecords: [{ unit: '미분', points: 10, earned: 10 }],
  });
  const keys = r.parts.map(p => p.key).sort();
  assert.deepEqual(keys, ['coverage', 'mastery']);
  // 6단원 중 1단원 커버 = 16.666..., 만점이므로 mastery = 100
  const cov = r.parts.find(p => p.key === 'coverage');
  near(cov.value, 100 / 6);
  near(r.parts.find(p => p.key === 'mastery').value, 100);
  // 25:20 재정규화 -> (100/6)*(25/45) + 100*(20/45)
  near(r.readiness, (100 / 6) * (25 / 45) + 100 * (20 / 45));
});
t('모든 항목이 있으면 가중치 합이 100이라 재정규화가 항등이 된다', () => {
  const r = computeReadiness({
    weeklyPercents: [60],
    questionRecords: [
      { unit: '미분', points: 10, earned: 6 },
      { unit: '적분', points: 10, earned: 6 },
    ],
    essays: [{ earned: 30, max: 50 }],
    homeworks: [{ problems_total: 10, problems_correct: 6 }],
  });
  assert.equal(r.parts.reduce((s, p) => s + p.weight, 0), 100);
  const manual = r.parts.reduce((s, p) => s + p.value * (p.weight / 100), 0);
  near(r.readiness, manual);
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

console.log('\n' + passed + ' passed' + (process.exitCode ? ' / 일부 실패' : ' / 전부 통과'));
