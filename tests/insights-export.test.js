'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const XLSX = require('../vendor/xlsx.full.min.js');
const P = require('../js/parser.js');
const E = require('../js/pnl.js');
const F = require('../js/format.js');
const I = require('../js/insights.js');
const EX = require('../js/export.js');

const SAMPLE = path.join(__dirname, '..', 'sample');
const load = (file) => {
  const r = P.readWorkbook(XLSX, fs.readFileSync(path.join(SAMPLE, file)), file);
  return { ...r, index: E.buildIndex(r.records) };
};

test('샘플 xlsx(제목 행 포함)와 csv 가 같은 손익을 만든다', () => {
  const a = load('sample_rawdata.xlsx');
  const b = load('sample_rawdata.csv');
  assert.equal(a.report.headerRow, 3);
  assert.equal(b.report.headerRow, 1);
  assert.equal(a.report.usedRows, 1200);
  assert.equal(b.report.usedRows, 1200);
  E.entities(a.index).forEach((e) => {
    const x = E.sum(a.index, e, a.index.periods), y = E.sum(b.index, e, b.index.periods);
    assert.equal(Math.round(x.operatingProfit), Math.round(y.operatingProfit));
  });
});

test('샘플 인사이트: 설계한 패턴이 규칙에 걸린다', () => {
  const { index } = load('sample_rawdata.csv');
  const all = I.generate(index, { entity: E.ALL });
  assert.match(all.headline, /^전사 영업이익률 \*\*/);
  const ids = all.all.map((i) => i.id);
  ['contribution', 'marginGap', 'costStructure', 'lossMonth', 'costCut', 'risingCost'].forEach((id) => assert.ok(ids.includes(id), id));
  const loss = all.all.find((i) => i.id === 'lossMonth');
  assert.match(loss.text, /11월/);
  assert.match(loss.text, /물류비/);
  const cut = all.all.find((i) => i.id === 'costCut');
  assert.equal(cut.company, '폴란드법인');
  assert.match(cut.text, /판촉비/);
  assert.ok(all.insights.length <= 6);
  assert.ok(all.takeaway.includes('본사') && all.takeaway.includes('폴란드법인'));
});

test('법인 관점 헤드메시지는 주어를 반복하지 않는다', () => {
  const { index } = load('sample_rawdata.csv');
  const g = I.generate(index, { entity: '본사' });
  assert.match(g.headline, /^본사 영업이익률 \*\*[\d.]+%\*\*, /);
  assert.equal((g.headline.match(/본사/g) || []).length, 1);
});

test('문장 규칙: 이중 부정과 조사 오류가 없다', () => {
  const { index } = load('sample_rawdata.csv');
  E.entities(index).forEach((e) => {
    I.generate(index, { entity: e }).all.forEach((i) => {
      assert.doesNotMatch(i.text, /-[\d.]+% 줄었/, i.text);
      assert.doesNotMatch(i.text, /원\*?\*?로 /, i.text);
      assert.doesNotMatch(i.text, /—/, i.text);
    });
  });
});

test('조사 붙이기', () => {
  assert.equal(F.josa('본사', '은/는'), '본사는');
  assert.equal(F.josa('폴란드법인', '이/가'), '폴란드법인이');
  assert.equal(F.josa('판촉비', '을/를'), '판촉비를');
  assert.equal(F.josa('물류비', '으로/로'), '물류비로');
  assert.equal(F.josa('12월', '으로/로'), '12월로');
  assert.equal(F.josa('3분기', '은/는'), '3분기는');
});

test('엑셀 내보내기: SUMIFS 수식과 계산값이 함께 들어간다', () => {
  const { records, index, report } = load('sample_rawdata.csv');
  const { wb, sheets } = EX.buildWorkbook(XLSX, { records, index, report });
  assert.deepEqual(wb.SheetNames, ['읽는 법', '전사', '본사', '폴란드법인', '데이터 점검', '정비_Raw']);

  const hq = wb.Sheets['본사'], all = wb.Sheets['전사'];
  assert.match(hq.C4.f, /^SUMIFS\(정비_Raw!\$E\$2:\$E\$1201,정비_Raw!\$A\$2:\$A\$1201,"본사",/);
  assert.doesNotMatch(all.C4.f, /"본사"/);
  // 합계 열의 이익률은 합계끼리 나눈다
  const opmRow = sheets['본사'].rowNo.opm;
  assert.equal(hq['B' + opmRow].f, 'IF(B4=0,"",B' + sheets['본사'].rowNo.operatingProfit + '/B4)');

  // 계산값은 화면의 손익계산서와 같다
  const st = E.statement(index, { entity: '본사' });
  st.rows.forEach((r) => {
    const cell = hq['B' + sheets['본사'].rowNo[r.key]];
    if (r.total == null) return;
    assert.ok(Math.abs(cell.v - r.total) < 1e-6, r.label);
  });

  // 다시 읽어도 값이 유지된다
  const back = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  assert.equal(Math.round(back.Sheets['전사'].B4.v), Math.round(E.sum(index, E.ALL, index.periods).revenue));
});
