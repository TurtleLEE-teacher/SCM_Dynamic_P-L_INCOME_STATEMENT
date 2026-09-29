/*
 * parser.js — Raw data 정비 자동화
 *
 * 엑셀·CSV 파일을 읽어 표준 레코드로 바꾼다. 과제의 "Raw data 정비" 단계에 해당한다.
 *   1) 시트 선택: 헤더에 회사명·금액이 있는 시트를 고른다
 *   2) 헤더 행 탐지: 원본 위에 제목 행이 있어도 앞 15행 안에서 헤더를 찾는다
 *   3) 정제: 빈 행 제거, 공백 제거, "1,234" 같은 텍스트 숫자 변환, 월·날짜 형식 통일
 *   4) 점검 리포트: 버린 행을 사유별로 센다. 조용히 버리지 않는다
 *
 * 브라우저에서는 window.PnLParser, node 에서는 require('./parser.js') 로 쓴다.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PnLParser = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 표준 열 이름 → 원본에서 허용하는 이름들 (공백은 비교 전에 모두 지운다)
  var COLUMN_ALIASES = {
    id: ['손익계산ID', 'ID', '번호'],
    date: ['거래일시', '거래일자', '일자', '날짜', '전표일자'],
    year: ['년도', '연도', '회계연도'],
    month: ['월', '회계월'],
    major: ['대분류코드', '대분류', '대분류명'],
    minor: ['중분류코드', '중분류', '중분류명', '계정', '계정명'],
    sub: ['소분류코드', '소분류', '소분류명'],
    company: ['회사명', '회사', '법인', '법인명'],
    amount: ['금액', '금액(원)', '금액원', 'amount']
  };

  var HEADER_SCAN_ROWS = 15;

  function squash(v) {
    return String(v == null ? '' : v).replace(/\s+/g, '').toLowerCase();
  }

  function clean(v) {
    if (v == null) return '';
    return String(v).replace(/\s+/g, ' ').trim();
  }

  /** 헤더 한 줄을 표준 열 → 열 번호 맵으로 바꾼다 */
  function mapHeader(row) {
    var map = {};
    if (!row) return map;
    for (var c = 0; c < row.length; c++) {
      var name = squash(row[c]);
      if (!name) continue;
      for (var key in COLUMN_ALIASES) {
        if (map[key] !== undefined) continue;
        var aliases = COLUMN_ALIASES[key];
        for (var i = 0; i < aliases.length; i++) {
          if (squash(aliases[i]) === name) { map[key] = c; break; }
        }
      }
    }
    return map;
  }

  /** 앞 15행 중 알려진 열이 3개 이상이고 금액 열이 있는 첫 행을 헤더로 본다 */
  function findHeaderRow(rows) {
    var limit = Math.min(rows.length, HEADER_SCAN_ROWS);
    for (var r = 0; r < limit; r++) {
      var map = mapHeader(rows[r]);
      if (map.amount !== undefined && Object.keys(map).length >= 3) {
        return { index: r, map: map };
      }
    }
    return null;
  }

  /** "15,839,296", " 1234 ", "(1,000)", "₩1,000원", "-" 를 숫자로 바꾼다. 실패하면 NaN */
  function parseNumber(v) {
    if (typeof v === 'number') return v;
    if (v == null) return NaN;
    var s = String(v).trim();
    if (s === '') return NaN;
    if (s === '-' || s === '–') return 0;
    var negative = false;
    if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
    s = s.replace(/[,\s₩원]/g, '');
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
    var n = Number(s);
    return negative ? -n : n;
  }

  /** "1월", "01", 1, "1" → 1. 범위 밖이면 null */
  function parseMonth(v) {
    if (v == null || v === '') return null;
    var n;
    if (typeof v === 'number') n = v;
    else {
      var m = String(v).match(/(\d{1,2})\s*월/) || String(v).trim().match(/^(\d{1,2})$/);
      if (!m) return null;
      n = Number(m[1]);
    }
    return n >= 1 && n <= 12 && Math.floor(n) === n ? n : null;
  }

  function parseYear(v) {
    if (v == null || v === '') return null;
    var m = String(v).match(/(\d{4})/);
    if (!m) return null;
    var n = Number(m[1]);
    return n >= 1900 && n <= 2999 ? n : null;
  }

  /** 20220101, 엑셀 날짜 일련번호, "2022-01-01", "2022.1.1", Date → {year, month} */
  function parseDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date && !isNaN(v)) return { year: v.getFullYear(), month: v.getMonth() + 1 };
    if (typeof v === 'number') {
      if (v >= 19000101 && v <= 29991231) {
        var y = Math.floor(v / 10000), mo = Math.floor(v / 100) % 100;
        return mo >= 1 && mo <= 12 ? { year: y, month: mo } : null;
      }
      if (v > 0 && v < 2958466) {
        // 엑셀 1900 날짜 체계 (1900-03-01 이후 기준)
        var d = new Date(Math.round((v - 25569) * 86400000));
        return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
      }
      return null;
    }
    var s = String(v).trim();
    var m = s.match(/^(\d{4})[-./\s]?(\d{1,2})[-./\s]?(\d{1,2})?/);
    if (m) {
      var mm = Number(m[2]);
      if (mm >= 1 && mm <= 12) return { year: Number(m[1]), month: mm };
    }
    if (/^\d+(\.\d+)?$/.test(s)) return parseDate(Number(s));
    return null;
  }

  function isBlankRow(row) {
    if (!row) return true;
    for (var i = 0; i < row.length; i++) {
      if (row[i] != null && String(row[i]).trim() !== '') return false;
    }
    return true;
  }

  /**
   * 2차원 배열(헤더 포함)을 표준 레코드와 점검 리포트로 바꾼다.
   * @param {Array<Array>} rows
   * @param {{sheetName?:string}} [opts]
   */
  function parseRows(rows, opts) {
    opts = opts || {};
    var report = {
      sheetName: opts.sheetName || null,
      headerRow: null,
      columns: {},
      totalRows: 0,
      usedRows: 0,
      skipped: { blank: 0, amount: 0, company: 0, period: 0, category: 0 },
      skippedSamples: [],
      amountSumAll: 0,
      amountSumUsed: 0,
      companies: [],
      years: [],
      missingColumns: [],
      warnings: []
    };
    var header = findHeaderRow(rows || []);
    if (!header) {
      report.warnings.push('헤더 행을 찾지 못했습니다. 앞 15행 안에 "회사명", "금액", "대분류 코드" 같은 열 이름이 있어야 합니다.');
      return { records: [], report: report };
    }
    var map = header.map;
    report.headerRow = header.index + 1;
    for (var k in map) report.columns[k] = clean(rows[header.index][map[k]]);
    ['company', 'amount', 'major', 'minor'].forEach(function (key) {
      if (map[key] === undefined) report.missingColumns.push(key);
    });
    if (map.month === undefined && map.date === undefined) report.missingColumns.push('month');
    if (map.minor === undefined && map.major !== undefined) {
      report.warnings.push('중분류 열이 없어 대분류로만 집계합니다.');
    }

    var records = [];
    var companySeen = {}, yearSeen = {};
    var get = function (row, key) { return map[key] === undefined ? null : row[map[key]]; };
    var skip = function (reason, rowNo, row) {
      report.skipped[reason]++;
      if (report.skippedSamples.length < 20) {
        report.skippedSamples.push({ row: rowNo, reason: reason, values: (row || []).slice(0, 12) });
      }
    };

    for (var r = header.index + 1; r < rows.length; r++) {
      var row = rows[r];
      var rowNo = r + 1;
      if (isBlankRow(row)) { report.skipped.blank++; continue; }
      report.totalRows++;

      var amount = parseNumber(get(row, 'amount'));
      if (isNaN(amount)) { skip('amount', rowNo, row); continue; }
      report.amountSumAll += amount;

      var company = clean(get(row, 'company'));
      if (!company) { skip('company', rowNo, row); continue; }

      var dateInfo = parseDate(get(row, 'date'));
      var month = parseMonth(get(row, 'month'));
      if (month == null && dateInfo) month = dateInfo.month;
      var year = parseYear(get(row, 'year'));
      if (year == null && dateInfo) year = dateInfo.year;
      if (year == null) year = 0; // 연도 정보가 전혀 없으면 한 해로 본다
      if (month == null) { skip('period', rowNo, row); continue; }

      var major = clean(get(row, 'major'));
      var minor = clean(get(row, 'minor')) || clean(get(row, 'sub')) || major;
      if (!major && !minor) { skip('category', rowNo, row); continue; }

      records.push({ company: company, year: year, month: month, major: major, minor: minor, amount: amount, row: rowNo });
      report.usedRows++;
      report.amountSumUsed += amount;
      if (!companySeen[company]) { companySeen[company] = true; report.companies.push(company); }
      if (!yearSeen[year]) { yearSeen[year] = true; report.years.push(year); }
    }
    report.years.sort(function (a, b) { return a - b; });
    return { records: records, report: report };
  }

  /* ───────── 브라우저 전용: SheetJS 로 파일 읽기 ───────── */

  /** 바이트를 글자로 바꾼다. UTF-8 이 아니면 한글 엑셀 기본값인 CP949(EUC-KR)로 읽는다 */
  function decodeText(bytes) {
    if (typeof TextDecoder === 'undefined') return null;
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''), encoding: 'UTF-8' };
    } catch (e) {
      return { text: new TextDecoder('euc-kr').decode(bytes), encoding: 'CP949' };
    }
  }

  function sheetRows(XLSX, ws) {
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
  }

  /** 워크북에서 Raw data 시트를 고른다: 헤더가 잡히는 시트 중 데이터가 가장 많은 시트 */
  function pickSheet(XLSX, wb) {
    var best = null;
    wb.SheetNames.forEach(function (name) {
      var rows = sheetRows(XLSX, wb.Sheets[name]);
      var header = findHeaderRow(rows);
      if (!header) return;
      var score = rows.length - header.index + (/raw/i.test(name) ? 1e6 : 0);
      if (!best || score > best.score) best = { name: name, rows: rows, score: score };
    });
    if (best) return best;
    var first = wb.SheetNames[0];
    return { name: first, rows: sheetRows(XLSX, wb.Sheets[first]) };
  }

  /**
   * 업로드한 파일(ArrayBuffer)을 읽는다.
   * @returns {{records:Array, report:Object}}
   */
  function readWorkbook(XLSX, buffer, fileName) {
    var bytes = new Uint8Array(buffer);
    var isText = /\.(csv|tsv|txt)$/i.test(fileName || '');
    var wb, encoding = null;
    if (isText) {
      var decoded = decodeText(bytes);
      encoding = decoded ? decoded.encoding : null;
      // raw:true 로 읽어야 "1월" 같은 값이 날짜로 바뀌지 않는다
      wb = decoded ? XLSX.read(decoded.text, { type: 'string', raw: true }) : XLSX.read(bytes, { type: 'array', raw: true });
    } else {
      wb = XLSX.read(bytes, { type: 'array', cellDates: false });
    }
    var picked = pickSheet(XLSX, wb);
    var result = parseRows(picked.rows, { sheetName: isText ? null : picked.name });
    result.report.fileName = fileName || null;
    result.report.encoding = encoding;
    result.report.sheetNames = wb.SheetNames.slice();
    return result;
  }

  return {
    COLUMN_ALIASES: COLUMN_ALIASES,
    mapHeader: mapHeader,
    findHeaderRow: findHeaderRow,
    parseNumber: parseNumber,
    parseMonth: parseMonth,
    parseYear: parseYear,
    parseDate: parseDate,
    parseRows: parseRows,
    decodeText: decodeText,
    pickSheet: pickSheet,
    readWorkbook: readWorkbook
  };
});
