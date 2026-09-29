'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/pnl.js');

// 수기로 계산할 수 있는 작은 데이터: 2개 법인 × 2개월
function rec(company, month, major, minor, amount) {
  return { company, year: 2022, month, major, minor, amount };
}
const RECORDS = [
  rec('본사', 1, '매출액', '매출액', 1000), rec('본사', 2, '매출액', '매출액', 2000),
  rec('본사', 1, '매출원가', '재료비', 300), rec('본사', 2, '매출원가', '재료비', 900),
  rec('본사', 1, '매출원가', '제조인건비', 100), rec('본사', 2, '매출원가', '제조인건비', 100),
  rec('본사', 1, '판매관리비', '판촉비', 200), rec('본사', 2, '판매관리비', '판촉비', 1200),
  rec('본사', 1, '영외수지', '영업외수익', 50), rec('본사', 2, '영외수지', '영업외손실', 30),
  rec('폴란드법인', 1, '매출액', '매출액', 500), rec('폴란드법인', 2, '매출액', '매출액', 500),
  rec('폴란드법인', 1, '매출원가', '재료비', 50), rec('폴란드법인', 2, '매출원가', '재료비', 50),
  rec('폴란드법인', 1, '판매관리비', '물류비', 100), rec('폴란드법인', 2, '판매관리비', '물류비', 100)
];

test('관점별 합계와 파생 지표', () => {
  const idx = E.buildIndex(RECORDS);
  const hq = E.sum(idx, '본사', idx.periods);
  assert.equal(hq.revenue, 3000);
  assert.equal(hq.cogs, 1400);
  assert.equal(hq.grossProfit, 1600);
  assert.equal(hq.sga, 1400);
  assert.equal(hq.operatingProfit, 200);
  assert.equal(hq.nonop, 20);
  assert.equal(hq.pretax, 220);
  assert.ok(Math.abs(hq.opm - 200 / 3000) < 1e-12);

  const all = E.sum(idx, E.ALL, idx.periods);
  const pl = E.sum(idx, '폴란드법인', idx.periods);
  ['revenue', 'cogs', 'sga', 'operatingProfit', 'pretax'].forEach((k) => assert.equal(all[k], hq[k] + pl[k]));
});

test('손익계산서 행 구성: 표준 항목은 양식 순서, 없는 항목은 빠진다', () => {
  const idx = E.buildIndex(RECORDS);
  const st = E.statement(idx, { entity: E.ALL });
  assert.deepEqual(st.rows.map((r) => r.label), [
    '매출액', '매출원가', '제조인건비', '재료비', '매출이익', '(매출이익률)',
    '판매관리비', '판촉비', '물류비', '영업이익', '(영업이익률)',
    '영외수지', '영업외수익', '영업외손실', '세전이익', '(세전이익률)'
  ]);
  assert.deepEqual(st.columns.map((c) => c.label), ['1월', '2월']);
});

test('합계 열 이익률은 합계끼리 나눈다 (월 이익률의 합이 아니다)', () => {
  const idx = E.buildIndex(RECORDS);
  const st = E.statement(idx, { entity: '본사' });
  const opm = st.rows.find((r) => r.key === 'opm');
  assert.ok(Math.abs(opm.values[0] - 400 / 1000) < 1e-12); // 1월: 1000-400-200
  assert.ok(Math.abs(opm.values[1] - -200 / 2000) < 1e-12); // 2월: 2000-1000-1200
  assert.ok(Math.abs(opm.total - 200 / 3000) < 1e-12);
  assert.notEqual(opm.total, opm.values[0] + opm.values[1]);
});

test('전사 = 법인 합: 모든 금액 행 × 모든 열', () => {
  const idx = E.buildIndex(RECORDS);
  const all = E.statement(idx, { entity: E.ALL });
  const parts = idx.companies.map((c) => E.statement(idx, { entity: c }));
  all.rows.forEach((r, i) => {
    if (r.kind !== 'amount') return;
    r.values.forEach((v, j) => assert.equal(v, parts.reduce((a, p) => a + p.rows[i].values[j], 0)));
    assert.equal(r.total, parts.reduce((a, p) => a + p.rows[i].total, 0));
  });
});

test('매출이 0이면 이익률은 null (IFERROR 대응)', () => {
  const idx = E.buildIndex([rec('본사', 1, '판매관리비', '판촉비', 100)]);
  const s = E.sum(idx, '본사', idx.periods);
  assert.equal(s.revenue, 0);
  assert.equal(s.opm, null);
});

test('분기 묶음', () => {
  const recs = [1, 2, 3, 4].map((m) => rec('본사', m, '매출액', '매출액', m * 100));
  const idx = E.buildIndex(recs);
  const cols = E.series(idx, '본사', idx.periods, 'quarter');
  assert.deepEqual(cols.map((c) => c.label), ['1분기', '2분기']);
  assert.deepEqual(cols.map((c) => c.sums.revenue), [600, 400]);
});

test('모르는 분류는 따로 모으고, 알려진 대분류의 새 항목은 하위 행으로 붙인다', () => {
  const idx = E.buildIndex([
    rec('본사', 1, '매출액', '매출액', 100),
    rec('본사', 1, '판매관리비', '광고선전비', 10),
    rec('본사', 1, '법인세', '법인세', 5)
  ]);
  assert.deepEqual(idx.items.sga, ['광고선전비']);
  assert.deepEqual(idx.extraItems, ['sga / 광고선전비']);
  assert.equal(idx.unmapped.length, 1);
  assert.equal(idx.unmapped[0].amount, 5);
});

test('분류 규칙: 영외수지는 중분류로 수익·손실을 가른다', () => {
  assert.deepEqual(E.classify('영외수지', '영업외손실'), { section: 'nonopLoss', item: '영업외손실' });
  assert.deepEqual(E.classify('영외수지', '영업외수익'), { section: 'nonopIncome', item: '영업외수익' });
  assert.deepEqual(E.classify('', '재료비'), { section: 'cogs', item: '재료비' });
  assert.deepEqual(E.classify('매출원가', '매출원가'), { section: 'cogs', item: '매출원가' });
  assert.equal(E.classify('법인세', '법인세'), null);
});
