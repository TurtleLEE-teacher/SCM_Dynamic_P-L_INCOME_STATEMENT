/*
 * pnl.js — 손익 계산 엔진 (엑셀 SUMIFS 대체)
 *
 * 레코드를 한 번만 훑어 [회사 × 년월 × 구분 × 항목] 합계 인덱스를 만들고,
 * 관점(전사·법인)과 기간을 바꿀 때는 그 인덱스에서만 읽는다.
 *   - 전사 = 모든 회사의 합이므로 "전사 = 본사 + 폴란드법인"이 구조상 항상 성립한다
 *   - 합계 열의 이익률은 월 이익률을 더하지 않고 합계끼리 나눠 구한다
 *   - 매출액이 0이면 이익률은 null 로 둔다 (엑셀 IFERROR 에 해당)
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PnL = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ALL = '전사';

  // 손익계산서의 구분. items 는 과제 양식의 표준 항목과 표시 순서다
  var SECTIONS = {
    revenue: { label: '매출액', majors: ['매출액', '매출'], items: ['매출액'] },
    cogs: { label: '매출원가', majors: ['매출원가'], items: ['제조인건비', '재료비', '제조경비'] },
    sga: { label: '판매관리비', majors: ['판매관리비', '판관비', '판매비와관리비'], items: ['인건비', '판촉비', '감가상각비', '물류비', '기타판관비'] },
    nonopIncome: { label: '영업외수익', majors: [], items: ['영업외수익'] },
    nonopLoss: { label: '영업외손실', majors: [], items: ['영업외손실', '영업외비용'] }
  };
  var SECTION_KEYS = ['revenue', 'cogs', 'sga', 'nonopIncome', 'nonopLoss'];
  var NONOP_MAJORS = ['영외수지', '영업외손익', '영업외수지', '영업외'];

  function squash(s) { return String(s || '').replace(/\s+/g, ''); }

  function inList(list, name) {
    var n = squash(name);
    for (var i = 0; i < list.length; i++) if (squash(list[i]) === n) return true;
    return false;
  }

  /** 대분류·중분류 → {section, item}. 모르는 분류면 null */
  function classify(major, minor) {
    var item = minor || major;
    if (major) {
      for (var i = 0; i < 3; i++) {
        var key = SECTION_KEYS[i];
        if (inList(SECTIONS[key].majors, major)) {
          return { section: key, item: squash(item) === squash(major) ? SECTIONS[key].label : item };
        }
      }
      if (inList(NONOP_MAJORS, major)) {
        if (inList(SECTIONS.nonopLoss.items, item) || /손실|비용/.test(item)) return { section: 'nonopLoss', item: item };
        return { section: 'nonopIncome', item: item };
      }
    }
    for (var j = 0; j < SECTION_KEYS.length; j++) {
      var k = SECTION_KEYS[j];
      if (inList(SECTIONS[k].items, item)) return { section: k, item: item };
    }
    return null;
  }

  function periodKey(year, month) { return year * 100 + month; }

  /**
   * 레코드 → 합계 인덱스
   * data[회사][년월][구분][항목] = 금액 합계
   */
  function buildIndex(records) {
    var data = {}, companies = [], periodSeen = {}, periods = [];
    var itemOrder = {}, unmapped = {}, extras = {};
    SECTION_KEYS.forEach(function (k) { itemOrder[k] = []; });

    records.forEach(function (rec) {
      var cls = classify(rec.major, rec.minor);
      if (!cls) {
        var uk = (rec.major || '') + ' / ' + (rec.minor || '');
        if (!unmapped[uk]) unmapped[uk] = { major: rec.major, minor: rec.minor, count: 0, amount: 0 };
        unmapped[uk].count++;
        unmapped[uk].amount += rec.amount;
        return;
      }
      var pk = periodKey(rec.year, rec.month);
      if (!periodSeen[pk]) { periodSeen[pk] = true; periods.push(pk); }
      if (!data[rec.company]) { data[rec.company] = {}; companies.push(rec.company); }
      var byPeriod = data[rec.company];
      if (!byPeriod[pk]) byPeriod[pk] = {};
      var bySection = byPeriod[pk];
      if (!bySection[cls.section]) bySection[cls.section] = {};
      bySection[cls.section][cls.item] = (bySection[cls.section][cls.item] || 0) + rec.amount;
      if (itemOrder[cls.section].indexOf(cls.item) < 0) itemOrder[cls.section].push(cls.item);
      if (!inList(SECTIONS[cls.section].items, cls.item)) extras[cls.section + ' / ' + cls.item] = true;
    });

    periods.sort(function (a, b) { return a - b; });
    // 표준 항목은 과제 양식 순서대로, 새 항목은 뒤에 붙인다
    var items = {};
    SECTION_KEYS.forEach(function (k) {
      var std = SECTIONS[k].items.filter(function (it) { return itemOrder[k].indexOf(it) >= 0; });
      var extra = itemOrder[k].filter(function (it) { return std.indexOf(it) < 0; });
      items[k] = std.concat(extra);
    });
    var years = {};
    periods.forEach(function (p) { years[Math.floor(p / 100)] = true; });

    return {
      data: data,
      companies: companies,
      periods: periods,
      multiYear: Object.keys(years).length > 1,
      items: items,
      unmapped: Object.keys(unmapped).map(function (k) { return unmapped[k]; }),
      extraItems: Object.keys(extras)
    };
  }

  function entities(index) { return [ALL].concat(index.companies); }

  function periodLabel(index, pk) {
    var y = Math.floor(pk / 100), m = pk % 100;
    return index.multiYear ? String(y).slice(2) + '년 ' + m + '월' : m + '월';
  }

  function quarterKey(pk) { return Math.floor(pk / 100) * 10 + Math.ceil((pk % 100) / 3); }

  function quarterLabel(index, qk) {
    var y = Math.floor(qk / 10), q = qk % 10;
    return index.multiYear ? String(y).slice(2) + '년 ' + q + '분기' : q + '분기';
  }

  function periodsBetween(index, startKey, endKey) {
    return index.periods.filter(function (p) { return p >= startKey && p <= endKey; });
  }

  function ratio(a, b) { return b ? a / b : null; }

  /** 관점·기간의 손익 합계. 모든 파생 지표를 함께 돌려준다 */
  function sum(index, entity, periodKeys) {
    var companies = entity === ALL || !entity ? index.companies : [entity];
    var s = { items: {} };
    SECTION_KEYS.forEach(function (k) { s[k] = 0; s.items[k] = {}; index.items[k].forEach(function (it) { s.items[k][it] = 0; }); });
    companies.forEach(function (c) {
      var byPeriod = index.data[c] || {};
      periodKeys.forEach(function (pk) {
        var bySection = byPeriod[pk];
        if (!bySection) return;
        SECTION_KEYS.forEach(function (k) {
          var byItem = bySection[k];
          if (!byItem) return;
          for (var it in byItem) {
            s.items[k][it] += byItem[it];
            s[k] += byItem[it];
          }
        });
      });
    });
    s.grossProfit = s.revenue - s.cogs;
    s.operatingProfit = s.grossProfit - s.sga;
    s.nonop = s.nonopIncome - s.nonopLoss;
    s.pretax = s.operatingProfit + s.nonop;
    s.gpm = ratio(s.grossProfit, s.revenue);
    s.opm = ratio(s.operatingProfit, s.revenue);
    s.ptm = ratio(s.pretax, s.revenue);
    s.cogsRatio = ratio(s.cogs, s.revenue);
    s.sgaRatio = ratio(s.sga, s.revenue);
    return s;
  }

  /** 기간을 월 또는 분기 열로 묶는다 → [{key, label, periods}] */
  function columns(index, periodKeys, group) {
    if (group !== 'quarter') {
      return periodKeys.map(function (pk) { return { key: pk, label: periodLabel(index, pk), periods: [pk] }; });
    }
    var cols = [], byQ = {};
    periodKeys.forEach(function (pk) {
      var qk = quarterKey(pk);
      if (!byQ[qk]) { byQ[qk] = { key: qk, label: quarterLabel(index, qk), periods: [] }; cols.push(byQ[qk]); }
      byQ[qk].periods.push(pk);
    });
    return cols;
  }

  /** 열마다의 합계 → [{key, label, periods, sums}] */
  function series(index, entity, periodKeys, group) {
    return columns(index, periodKeys, group).map(function (col) {
      col.sums = sum(index, entity, col.periods);
      return col;
    });
  }

  /** 손익계산서 행 정의. 표준 데이터면 과제 양식과 같은 20행이 된다 */
  function rowDefs(index) {
    var defs = [];
    var itemRows = function (section) {
      index.items[section].forEach(function (it) {
        defs.push({ key: 'item:' + section + ':' + it, label: it, kind: 'amount', level: 1, section: section, item: it });
      });
    };
    defs.push({ key: 'revenue', label: '매출액', kind: 'amount', level: 0, style: 'section' });
    var rev = index.items.revenue;
    if (rev.length > 1 || (rev.length === 1 && rev[0] !== SECTIONS.revenue.items[0])) itemRows('revenue');
    defs.push({ key: 'cogs', label: '매출원가', kind: 'amount', level: 0, style: 'section' });
    itemRows('cogs');
    defs.push({ key: 'grossProfit', label: '매출이익', kind: 'amount', level: 0, style: 'subtotal' });
    defs.push({ key: 'gpm', label: '(매출이익률)', kind: 'ratio', level: 0, style: 'ratio' });
    defs.push({ key: 'sga', label: '판매관리비', kind: 'amount', level: 0, style: 'section' });
    itemRows('sga');
    defs.push({ key: 'operatingProfit', label: '영업이익', kind: 'amount', level: 0, style: 'subtotal' });
    defs.push({ key: 'opm', label: '(영업이익률)', kind: 'ratio', level: 0, style: 'ratio' });
    defs.push({ key: 'nonop', label: '영외수지', kind: 'amount', level: 0, style: 'section' });
    itemRows('nonopIncome');
    itemRows('nonopLoss');
    defs.push({ key: 'pretax', label: '세전이익', kind: 'amount', level: 0, style: 'subtotal' });
    defs.push({ key: 'ptm', label: '(세전이익률)', kind: 'ratio', level: 0, style: 'ratio' });
    return defs;
  }

  function valueOf(sums, def) {
    if (def.section) return sums.items[def.section][def.item] || 0;
    return sums[def.key];
  }

  /**
   * 손익계산서
   * @returns {{entity, columns:[{key,label}], rows:[{key,label,kind,level,style,values:[],total}]}}
   */
  function statement(index, opts) {
    var entity = opts.entity || ALL;
    var periodKeys = opts.periodKeys || index.periods;
    var cols = series(index, entity, periodKeys, opts.group);
    var total = sum(index, entity, periodKeys);
    var rows = rowDefs(index).map(function (def) {
      return {
        key: def.key, label: def.label, kind: def.kind, level: def.level, style: def.style || null,
        section: def.section || null, item: def.item || null,
        values: cols.map(function (c) { return valueOf(c.sums, def); }),
        total: valueOf(total, def)
      };
    });
    return {
      entity: entity,
      columns: cols.map(function (c) { return { key: c.key, label: c.label, periods: c.periods }; }),
      rows: rows,
      totals: total,
      series: cols
    };
  }

  return {
    ALL: ALL,
    SECTIONS: SECTIONS,
    SECTION_KEYS: SECTION_KEYS,
    classify: classify,
    buildIndex: buildIndex,
    entities: entities,
    periodKey: periodKey,
    periodLabel: periodLabel,
    quarterKey: quarterKey,
    quarterLabel: quarterLabel,
    periodsBetween: periodsBetween,
    sum: sum,
    columns: columns,
    series: series,
    rowDefs: rowDefs,
    statement: statement
  };
});
