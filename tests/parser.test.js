'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/parser.js');

const HEADER = ['손익계산 ID', '거래일시', '년도', '월', '일', '전표번호', '대분류 코드', '중분류 코드', '소분류 코드', '회사명', '금액'];

test('제목 행과 빈 행이 있어도 헤더를 찾는다', () => {
  const rows = [
    ['손익계산서 Raw data'],
    [],
    HEADER,
    [1, 20220101, 2022, '1월', '1일', 'A1', '매출액', '매출액', '매출액', '본사', 1000],
    [],
    [2, 20220102, 2022, '1월', '2일', 'A2', '매출원가', '재료비', '재료비', '본사', 400]
  ];
  const { records, report } = P.parseRows(rows);
  assert.equal(report.headerRow, 3);
  assert.equal(records.length, 2);
  assert.equal(report.skipped.blank, 1);
  assert.deepEqual(records[1], { company: '본사', year: 2022, month: 1, major: '매출원가', minor: '재료비', amount: 400, row: 6 });
});

test('헤더의 앞뒤 공백과 열 순서가 달라도 연결한다', () => {
  const rows = [[' 금액 ', '회사명', '중분류', '대분류', ' 월 '], ['1,234', '폴란드법인 ', '판촉비', '판매관리비', '3월']];
  const { records, report } = P.parseRows(rows);
  assert.equal(report.columns.amount, '금액');
  assert.deepEqual(records[0], { company: '폴란드법인', year: 0, month: 3, major: '판매관리비', minor: '판촉비', amount: 1234, row: 2 });
});

test('텍스트 숫자를 숫자로 바꾼다', () => {
  assert.equal(P.parseNumber(' 15,839,296 '), 15839296);
  assert.equal(P.parseNumber('(1,000)'), -1000);
  assert.equal(P.parseNumber('₩2,500원'), 2500);
  assert.equal(P.parseNumber('-'), 0);
  assert.equal(P.parseNumber('12.5'), 12.5);
  assert.ok(Number.isNaN(P.parseNumber('abc')));
  assert.ok(Number.isNaN(P.parseNumber('')));
});

test('월 형식 세 가지를 받는다', () => {
  assert.equal(P.parseMonth('1월'), 1);
  assert.equal(P.parseMonth('01'), 1);
  assert.equal(P.parseMonth(12), 12);
  assert.equal(P.parseMonth('13월'), null);
  assert.equal(P.parseMonth('일월'), null);
});

test('월 열이 없으면 거래일시에서 뽑는다', () => {
  assert.deepEqual(P.parseDate(20220315), { year: 2022, month: 3 });
  assert.deepEqual(P.parseDate(44621), { year: 2022, month: 3 }); // 엑셀 날짜 일련번호 2022-03-01
  assert.deepEqual(P.parseDate('2022-11-05'), { year: 2022, month: 11 });
  assert.deepEqual(P.parseDate('2022.7.1'), { year: 2022, month: 7 });
  const rows = [['거래일시', '대분류', '중분류', '회사명', '금액'], [20220815, '매출액', '매출액', '본사', 10]];
  const { records } = P.parseRows(rows);
  assert.equal(records[0].month, 8);
  assert.equal(records[0].year, 2022);
});

test('버린 행을 사유별로 센다', () => {
  const rows = [
    HEADER,
    [1, 20220101, 2022, '1월', '1일', 'A', '매출액', '매출액', '매출액', '본사', 'abc'],
    [2, 20220101, 2022, '1월', '1일', 'A', '매출액', '매출액', '매출액', '', 100],
    [3, null, 2022, null, '1일', 'A', '매출액', '매출액', '매출액', '본사', 100],
    [4, 20220101, 2022, '1월', '1일', 'A', '매출액', '매출액', '매출액', '본사', 100]
  ];
  const { records, report } = P.parseRows(rows);
  assert.equal(records.length, 1);
  assert.equal(report.skipped.amount, 1);
  assert.equal(report.skipped.company, 1);
  assert.equal(report.skipped.period, 1);
  assert.equal(report.amountSumAll, 300);
  assert.equal(report.amountSumUsed, 100);
  assert.equal(report.skippedSamples.length, 3);
});

test('헤더를 못 찾으면 안내 문구를 남긴다', () => {
  const { records, report } = P.parseRows([['아무', '내용'], [1, 2]]);
  assert.equal(records.length, 0);
  assert.match(report.warnings[0], /헤더 행을 찾지 못했습니다/);
});
