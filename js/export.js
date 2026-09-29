/*
 * export.js — 손익계산서 엑셀 내보내기
 *
 * 값만 붙여넣지 않고 SUMIFS 수식이 살아 있는 통합문서를 만든다.
 *   정비_Raw   : 표준화된 Raw data (회사명 · 년월 · 구분 · 항목 · 금액)
 *   전사/법인  : 과제 양식의 월별 손익계산서. 항목 행은 SUMIFS, 소계·이익률은 행 간 수식
 *   인사이트   : 화면의 인사이트 문장
 *   데이터 점검: 정비 과정에서 읽은 행·버린 행
 * 엑셀에서 열면 계산된 값이 바로 보이고, 셀을 누르면 수식이 보인다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./pnl.js'), require('./format.js'));
  } else {
    root.PnLExport = factory(root.PnL, root.PnLFormat);
  }
})(typeof self !== 'undefined' ? self : this, function (PnL, F) {
  'use strict';

  var RAW = '정비_Raw';
  var SECTION_NAME = { revenue: '매출액', cogs: '매출원가', sga: '판매관리비', nonopIncome: '영업외수익', nonopLoss: '영업외손실' };
  var AMT = '#,##0;[Red]-#,##0';
  var PCT = '0.0%;[Red]-0.0%';

  function colName(i) {
    var s = '';
    i++;
    while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }

  function q(s) { return '"' + String(s).replace(/"/g, '""') + '"'; }

  function sheetSafe(name) { return String(name).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31); }

  /** 표준화 Raw 시트. 분류되지 않은 행은 넣지 않는다 (데이터 점검 시트에 따로 적는다) */
  function rawSheet(XLSX, records) {
    var aoa = [['회사명', '년월', '구분', '항목', '금액']];
    records.forEach(function (r) {
      var cls = PnL.classify(r.major, r.minor);
      if (!cls) return;
      aoa.push([r.company, PnL.periodKey(r.year, r.month), SECTION_NAME[cls.section], cls.item, r.amount]);
    });
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    for (var i = 2; i <= aoa.length; i++) { var c = ws['E' + i]; if (c) c.z = AMT; }
    ws['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 16 }];
    ws['!autofilter'] = { ref: 'A1:E' + aoa.length };
    return { ws: ws, lastRow: aoa.length };
  }

  /** 관점 1개의 손익계산서 시트 */
  function statementSheet(XLSX, index, entity, periodKeys, lastRawRow) {
    var st = PnL.statement(index, { entity: entity, periodKeys: periodKeys, group: 'month' });
    var ws = {};
    var nCols = st.columns.length;
    var firstCol = 2; // C열부터 월
    var lastColName = colName(firstCol + nCols - 1);
    var R = function (col) { return RAW + '!$' + col + '$2:$' + col + '$' + lastRawRow; };
    var set = function (addr, cell) { ws[addr] = cell; };

    set('A1', { t: 's', v: entity + ' 월별 손익계산서 (단위: 원)' });
    set('A2', { t: 's', v: '구분' });
    set('B2', { t: 's', v: '합계' });
    set('A3', { t: 's', v: '년월 키' });
    st.columns.forEach(function (c, i) {
      var col = colName(firstCol + i);
      set(col + '2', { t: 's', v: c.label });
      set(col + '3', { t: 'n', v: c.key });
    });

    // 행 번호 미리 매기기 (소계 수식이 다른 행을 가리키므로)
    var startRow = 4;
    var rowNo = {};
    st.rows.forEach(function (r, i) { rowNo[r.key] = startRow + i; });
    var childRows = function (section) {
      return st.rows.filter(function (r) { return r.section === section; }).map(function (r) { return rowNo[r.key]; });
    };
    var sumRows = function (col, rows) {
      if (!rows.length) return '0';
      var contiguous = rows.every(function (n, i) { return i === 0 || n === rows[i - 1] + 1; });
      return contiguous ? 'SUM(' + col + rows[0] + ':' + col + rows[rows.length - 1] + ')'
                        : rows.map(function (n) { return col + n; }).join('+');
    };
    var companyCrit = entity === PnL.ALL ? '' : ',' + R('A') + ',' + q(entity);

    st.rows.forEach(function (r) {
      var rn = rowNo[r.key];
      set('A' + rn, { t: 's', v: (r.level ? '  ' : '') + r.label });
      var formulaFor = function (col, isTotal) {
        var ref = function (key) { return col + rowNo[key]; };
        var ratio = function (num) { return 'IF(' + ref('revenue') + '=0,"",' + ref(num) + '/' + ref('revenue') + ')'; };
        if (r.kind === 'ratio') {
          return ratio({ gpm: 'grossProfit', opm: 'operatingProfit', ptm: 'pretax' }[r.key]);
        }
        if (isTotal) return 'SUM(' + colName(firstCol) + rn + ':' + lastColName + rn + ')';
        if (r.section) {
          return 'SUMIFS(' + R('E') + companyCrit + ',' + R('B') + ',' + col + '$3,' + R('C') + ',' + q(SECTION_NAME[r.section]) + ',' + R('D') + ',' + q(r.item) + ')';
        }
        switch (r.key) {
          case 'revenue': {
            var kids = childRows('revenue');
            return kids.length ? sumRows(col, kids)
              : 'SUMIFS(' + R('E') + companyCrit + ',' + R('B') + ',' + col + '$3,' + R('C') + ',' + q('매출액') + ')';
          }
          case 'cogs': return sumRows(col, childRows('cogs'));
          case 'sga': return sumRows(col, childRows('sga'));
          case 'grossProfit': return ref('revenue') + '-' + ref('cogs');
          case 'operatingProfit': return ref('grossProfit') + '-' + ref('sga');
          case 'nonop': return '(' + sumRows(col, childRows('nonopIncome')) + ')-(' + sumRows(col, childRows('nonopLoss')) + ')';
          case 'pretax': return ref('operatingProfit') + '+' + ref('nonop');
        }
        return null;
      };
      var cellFor = function (value, col, isTotal) {
        var f = formulaFor(col, isTotal);
        if (r.kind === 'ratio') {
          return value == null ? { t: 's', v: '', f: f } : { t: 'n', v: value, f: f, z: PCT };
        }
        return { t: 'n', v: value, f: f, z: AMT };
      };
      set('B' + rn, cellFor(r.total, 'B', true));
      r.values.forEach(function (v, i) {
        var col = colName(firstCol + i);
        set(col + rn, cellFor(v, col, false));
      });
    });

    var lastRow = startRow + st.rows.length - 1;
    ws['!ref'] = 'A1:' + lastColName + lastRow;
    ws['!cols'] = [{ wch: 16 }, { wch: 16 }].concat(st.columns.map(function () { return { wch: 14 }; }));
    return { ws: ws, statement: st, rowNo: rowNo };
  }

  function plain(text) { return String(text || '').replace(/\*\*/g, ''); }

  /**
   * @param XLSX SheetJS
   * @param opts {records, index, periodKeys, report, insightsByEntity}
   */
  function buildWorkbook(XLSX, opts) {
    var index = opts.index;
    var periodKeys = opts.periodKeys || index.periods;
    var wb = XLSX.utils.book_new();
    var raw = rawSheet(XLSX, opts.records);

    var guide = [
      ['자동 손익 대시보드 · 엑셀 내보내기'],
      [''],
      ['시트', '내용'],
      [RAW, '업로드한 Raw data 를 정비한 표 (회사명 · 년월 · 구분 · 항목 · 금액)'],
      ['전사 · 법인 시트', '월별 손익계산서. 항목 행은 SUMIFS, 소계·이익률은 행 간 수식으로 계산합니다'],
      ['인사이트', '화면에 나온 인사이트 문장과 근거 숫자'],
      ['데이터 점검', '정비 과정에서 읽은 행 · 사용한 행 · 제외한 행'],
      [''],
      ['기간', PnL.periodLabel(index, periodKeys[0]) + ' ~ ' + PnL.periodLabel(index, periodKeys[periodKeys.length - 1])],
      ['이익률 계산', '합계 열의 이익률은 월 이익률을 더하지 않고 합계 금액끼리 나눠 구합니다']
    ];
    var guideWs = XLSX.utils.aoa_to_sheet(guide);
    guideWs['!cols'] = [{ wch: 18 }, { wch: 80 }];
    XLSX.utils.book_append_sheet(wb, guideWs, '읽는 법');

    var sheets = {};
    PnL.entities(index).forEach(function (e) {
      var s = statementSheet(XLSX, index, e, periodKeys, raw.lastRow);
      sheets[e] = s;
      XLSX.utils.book_append_sheet(wb, s.ws, sheetSafe(e));
    });

    if (opts.insightsByEntity) {
      var aoa = [['관점', '순위', '제목', '내용', '근거']];
      Object.keys(opts.insightsByEntity).forEach(function (e) {
        var g = opts.insightsByEntity[e];
        aoa.push([e, '헤드', '헤드메시지', plain(g.headline), '']);
        g.insights.forEach(function (i, n) {
          aoa.push([e, n + 1, i.title, plain(i.text), i.evidence.map(function (x) { return x.label + ' ' + x.value; }).join(' · ')]);
        });
        if (g.takeaway) aoa.push([e, '시사점', '종합 시사점', g.takeaway, '']);
      });
      var iws = XLSX.utils.aoa_to_sheet(aoa);
      iws['!cols'] = [{ wch: 12 }, { wch: 6 }, { wch: 28 }, { wch: 100 }, { wch: 50 }];
      XLSX.utils.book_append_sheet(wb, iws, '인사이트');
    }

    if (opts.report) {
      var rp = opts.report;
      var rows = [
        ['항목', '값'],
        ['파일', rp.fileName || ''],
        ['시트', rp.sheetName || '(CSV)'],
        ['헤더 행', rp.headerRow],
        ['읽은 행', rp.totalRows],
        ['사용한 행', rp.usedRows],
        ['제외: 금액 없음', rp.skipped.amount],
        ['제외: 회사명 없음', rp.skipped.company],
        ['제외: 월 없음', rp.skipped.period],
        ['제외: 분류 없음', rp.skipped.category],
        ['빈 행', rp.skipped.blank],
        ['원본 금액 합계', rp.amountSumAll],
        ['사용 금액 합계', rp.amountSumUsed]
      ];
      (index.unmapped || []).forEach(function (u) {
        rows.push(['손익 양식에 없는 분류', (u.major || '') + ' / ' + (u.minor || '') + ' · ' + u.count + '행 · ' + F.won(u.amount) + '원']);
      });
      var rws = XLSX.utils.aoa_to_sheet(rows);
      rws['!cols'] = [{ wch: 20 }, { wch: 60 }];
      XLSX.utils.book_append_sheet(wb, rws, '데이터 점검');
    }

    XLSX.utils.book_append_sheet(wb, raw.ws, RAW);
    return { wb: wb, sheets: sheets };
  }

  return { buildWorkbook: buildWorkbook, colName: colName, RAW_SHEET: RAW };
});
