/*
 * app.js — 화면 상태와 렌더링
 *
 * 상태(관점 · 기간 · 탭 · 집계 단위 · 금액 단위)가 바뀌면 헤드메시지와 현재 탭을 다시 그린다.
 * 계산은 pnl.js, 문장은 insights.js, 차트는 charts.js 가 맡고 여기서는 조립만 한다.
 */
(function () {
  'use strict';

  var X = window.XLSX, P = window.PnLParser, E = window.PnL, F = window.PnLFormat;
  var I = window.PnLInsights, CH = window.PnLCharts, EX = window.PnLExport;
  var ALL = E.ALL;
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    records: null, report: null, index: null, label: '',
    entity: ALL, from: null, to: null,
    tab: 'summary', group: 'month', unit: '원'
  };
  var view = { keys: [], insights: null, dirty: {} };

  /* ───────── 유틸 ───────── */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  /** **굵게** → 강조색 */
  function rich(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<span class="hl">$1</span>'); }

  var toastTimer = null;
  function toast(msg, isError) {
    var el = $('toast');
    el.textContent = msg;
    el.className = 'toast' + (isError ? ' error' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, isError ? 6000 : 2600);
  }

  function rangeLabel() {
    var idx = state.index, k = view.keys;
    if (!k.length) return '';
    var y0 = Math.floor(k[0] / 100), y1 = Math.floor(k[k.length - 1] / 100);
    var m0 = k[0] % 100, m1 = k[k.length - 1] % 100;
    if (!y0) return m0 + '월~' + m1 + '월';
    if (y0 === y1) return y0 + '년 ' + m0 + '월~' + m1 + '월';
    return E.periodLabel(idx, k[0]) + '~' + E.periodLabel(idx, k[k.length - 1]);
  }

  function wide(el, min) { return el && el.clientWidth >= min; }

  /* ───────── 파일 읽기 ───────── */

  function readFile(file) {
    if (!file) return;
    if (!/\.(xlsx|xlsm|xls|csv|tsv|txt)$/i.test(file.name)) {
      toast('엑셀(.xlsx) 또는 CSV 파일을 올려 주세요. 받은 파일: ' + file.name, true);
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        load(P.readWorkbook(X, reader.result, file.name), file.name);
      } catch (e) {
        console.error(e);
        toast('파일을 읽지 못했습니다. 암호가 걸린 파일이면 암호를 풀고 다시 저장해 주세요.', true);
      }
    };
    reader.onerror = function () { toast('파일을 읽는 중 오류가 났습니다. 다시 시도해 주세요.', true); };
    reader.readAsArrayBuffer(file);
  }

  function loadSample() {
    var s = window.PNL_SAMPLE;
    if (!s) { toast('샘플 데이터를 찾지 못했습니다.', true); return; }
    var bytes = new TextEncoder().encode(s.csv);
    load(P.readWorkbook(X, bytes.buffer, s.fileName), s.fileName + ' · 가상 샘플');
  }

  function load(result, label) {
    var index = E.buildIndex(result.records);
    state.records = result.records;
    state.report = result.report;
    state.index = index;
    if (!result.records.length || !index.periods.length) {
      renderCheck();
      $('checkDialog').showModal();
      toast('손익을 계산할 행을 찾지 못했습니다. 데이터 점검 리포트를 확인해 주세요.', true);
      return;
    }
    state.label = label;
    state.entity = ALL;
    state.from = index.periods[0];
    state.to = index.periods[index.periods.length - 1];
    $('fileName').textContent = label;
    $('empty').hidden = true;
    $('dash').hidden = false;
    $('exportBtn').disabled = false;
    buildControls();
    renderAll();
    var unmapped = index.unmapped.reduce(function (a, u) { return a + u.count; }, 0);
    toast(F.comma(result.report.usedRows - unmapped) + '행을 읽어 손익계산서를 만들었습니다.');
  }

  /* ───────── 컨트롤 ───────── */

  function buildControls() {
    var idx = state.index;
    $('entitySeg').innerHTML = E.entities(idx).map(function (e) {
      return '<button type="button" role="radio" data-v="' + esc(e) + '" aria-checked="' + (e === state.entity) + '">' + esc(e) + '</button>';
    }).join('');
    var opts = idx.periods.map(function (p) { return '<option value="' + p + '">' + esc(E.periodLabel(idx, p)) + '</option>'; }).join('');
    $('fromSel').innerHTML = opts;
    $('toSel').innerHTML = opts;
    $('fromSel').value = String(state.from);
    $('toSel').value = String(state.to);
  }

  function setSeg(el, value) {
    [].forEach.call(el.querySelectorAll('button'), function (b) { b.setAttribute('aria-checked', String(b.getAttribute('data-v') === String(value))); });
  }

  function setTab(tab) {
    state.tab = tab;
    [].forEach.call(document.querySelectorAll('.tab'), function (t) { t.setAttribute('aria-selected', String(t.getAttribute('data-tab') === tab)); });
    [].forEach.call(document.querySelectorAll('.tab-panel'), function (p) { p.hidden = p.id !== 'tab-' + tab; });
    renderTab(tab);
  }

  /* ───────── 렌더 ───────── */

  function renderAll() {
    var idx = state.index;
    if (state.from > state.to) { var t = state.from; state.from = state.to; state.to = t; $('fromSel').value = String(state.from); $('toSel').value = String(state.to); }
    view.keys = E.periodsBetween(idx, state.from, state.to);
    view.insights = I.generate(idx, { entity: state.entity, periodKeys: view.keys });
    $('title').textContent = state.entity + ' 손익 분석 · ' + rangeLabel();
    $('headline').innerHTML = rich(view.insights.headline);
    renderBadge();
    view.dirty = { summary: true, statement: true, profit: true, sga: true, insight: true };
    renderTab(state.tab);
  }

  function renderTab(tab) {
    if (!state.index || !view.dirty[tab]) return;
    view.dirty[tab] = false;
    ({ summary: renderSummary, statement: renderStatement, profit: renderProfit, sga: renderSga, insight: renderInsight })[tab]();
  }

  function kpiTile(label, value, unit, sub, alert) {
    return '<div class="kpi' + (alert ? ' alert' : '') + '"><span class="label">' + esc(label) + '</span>' +
      '<span class="value">' + esc(value) + (unit ? '<small>' + esc(unit) + '</small>' : '') + '</span>' +
      '<span class="sub">' + sub + '</span></div>';
  }

  function renderSummary() {
    var idx = state.index, keys = view.keys, ent = state.entity;
    var s = E.sum(idx, ent, keys), all = E.sum(idx, ALL, keys);
    var w = I.compareWindow(idx, keys);
    var h = w && E.sum(idx, ent, w.head), t = w && E.sum(idx, ent, w.tail);

    var rev = F.moneyParts(s.revenue), op = F.moneyParts(s.operatingProfit);
    var g = w && h.revenue ? (t.revenue - h.revenue) / Math.abs(h.revenue) : null;
    var tiles = [
      kpiTile('매출액', rev.value, rev.unit,
        w ? esc(w.headLabel) + ' 대비 ' + esc(w.tailLabel) + ' <b>' + esc(F.signedPct(g)) + '</b>' : keys.length + '개월 합계',
        g != null && g < -0.05),
      kpiTile('영업이익', op.value, op.unit,
        ent !== ALL && all.operatingProfit > 0 ? '전사 영업이익의 <b>' + esc(F.pct(s.operatingProfit / all.operatingProfit)) + '</b>'
          : '세전이익 ' + esc(F.money(s.pretax)),
        s.operatingProfit < 0),
      kpiTile('영업이익률', F.pct(s.opm), '',
        w ? esc(w.headLabel) + ' ' + esc(F.pct(h.opm)) + ' → ' + esc(w.tailLabel) + ' <b>' + esc(F.pct(t.opm)) + '</b>' : '매출이익률 ' + esc(F.pct(s.gpm)),
        (s.opm != null && s.opm < 0) || (w && h.opm != null && t.opm != null && t.opm < h.opm - 0.03)),
      kpiTile('판관비율', F.pct(s.sgaRatio), '',
        '원가율 <b>' + esc(F.pct(s.cogsRatio)) + '</b>',
        w && h.sgaRatio != null && t.sgaRatio != null && t.sgaRatio > h.sgaRatio + 0.02)
    ];
    $('kpiRow').innerHTML = tiles.join('');

    var series = E.series(idx, ent, keys, 'month');
    var margins = series.map(function (c) { return c.sums.opm; });
    var focusIdx = -1;
    margins.forEach(function (m, i) { if (m != null && (focusIdx < 0 || m < margins[focusIdx])) focusIdx = i; });
    var stackBy = ent === ALL && idx.companies.length > 1 ? idx.companies : null;
    var stackSeries = {};
    if (stackBy) stackBy.forEach(function (c) { stackSeries[c] = E.series(idx, c, keys, 'month'); });
    var showLabels = wide($('cRevenue').parentNode, 560);
    CH.revenueBars('cRevenue', { index: idx, series: series, focusIdx: focusIdx, stackBy: stackBy, stackSeries: stackSeries, showLabels: showLabels });
    CH.marginLine('cMargin', { series: series });
    $('capRevenue').innerHTML = focusIdx >= 0
      ? '영업이익률이 가장 낮은 달은 <b>' + esc(series[focusIdx].label) + ' ' + esc(F.pct(margins[focusIdx])) + '</b>입니다. ' +
        (stackBy ? '막대는 법인별 매출을 쌓은 값이고, 위 숫자가 전사 합계입니다.' : '그 달 막대를 블루로 표시했습니다.')
      : '';

    CH.waterfall('cWaterfall', s, !wide($('cWaterfall').parentNode, 400));
    $('capWaterfall').innerHTML = s.revenue
      ? '매출 100원 중 원가로 <b>' + esc(F.comma(s.cogsRatio * 100, 0)) + '원</b>, 판관비로 <b>' + esc(F.comma(s.sgaRatio * 100, 0)) + '원</b>을 쓰고 영업이익 <b>' +
        esc(F.comma(s.opm * 100, 0)) + '원</b>을 남깁니다.'
      : '';

    var top = view.insights.insights.slice(0, 3);
    $('miniInsights').innerHTML = top.length ? top.map(function (i, n) {
      return '<li><span class="num">' + (n + 1) + '</span><div><strong>' + esc(i.title) + '</strong><p>' + rich(i.short) + '.</p></div>' +
        '<button type="button" class="more" data-goto="insight">자세히</button></li>';
    }).join('') : '<li><p>이 기간에는 조건을 만족한 인사이트가 없습니다. 기간을 넓혀 보세요.</p></li>';
  }

  function renderStatement() {
    var idx = state.index, ent = state.entity, unit = state.unit;
    var st = E.statement(idx, { entity: ent, periodKeys: view.keys, group: state.group });
    var lossCols = st.series.map(function (c) { return c.sums.operatingProfit < 0; });
    var head = '<thead><tr><th scope="col">구분</th><th scope="col" class="col-total">합계</th>' + st.columns.map(function (c, i) {
      return '<th scope="col">' + esc(c.label) + (lossCols[i] ? '<span class="dot risk" title="영업적자"></span>' : '') + '</th>';
    }).join('') + '</tr></thead>';
    var cell = function (row, v, isTotal) {
      var cls = [];
      if (isTotal) cls.push('col-total');
      var text;
      if (row.kind === 'ratio') {
        text = F.pct(v);
        if (v != null && v < 0) cls.push('neg');
        else if (!isTotal && v != null && row.total != null && v < row.total - 0.05) cls.push('low');
      } else {
        text = F.inUnit(v, unit);
        if (v < 0 && Math.abs(v) >= 0.5) cls.push('neg');
      }
      return '<td' + (cls.length ? ' class="' + cls.join(' ') + '"' : '') + '>' + esc(text) + '</td>';
    };
    var body = '<tbody>' + st.rows.map(function (r) {
      var cls = r.level ? 'child' : (r.style || '');
      return '<tr class="' + cls + '"><td>' + esc(r.label) + '</td>' + cell(r, r.total, true) +
        r.values.map(function (v) { return cell(r, v, false); }).join('') + '</tr>';
    }).join('') + '</tbody>';
    $('plTable').innerHTML = head + body;
    $('stmtNote').textContent = '단위: ' + unit + ' · 음수 빨강 · 합계보다 5%p 이상 낮은 이익률 블루 · 빨간 점은 영업적자';

    // 검산: 전사 = 법인 합 (과제에서 가장 자주 깨지는 지점)
    var cap = '합계 열의 이익률은 월 이익률을 더한 값이 아니라 합계 금액끼리 나눈 값입니다.';
    if (ent === ALL && idx.companies.length > 1) {
      var parts = idx.companies.map(function (c) { return E.statement(idx, { entity: c, periodKeys: view.keys, group: state.group }); });
      var cells = 0, bad = 0;
      st.rows.forEach(function (r, ri) {
        if (r.kind !== 'amount') return;
        r.values.concat([r.total]).forEach(function (v, ci) {
          var sum = 0;
          parts.forEach(function (p) { var pr = p.rows[ri]; sum += ci < pr.values.length ? pr.values[ci] : pr.total; });
          cells++;
          if (Math.abs(sum - v) > 0.01) bad++;
        });
      });
      cap = '<b>검산</b> 전사 = ' + idx.companies.map(esc).join(' + ') + ' · 금액 ' + F.comma(cells) + '칸 중 ' +
        (bad ? '<b>' + bad + '칸 불일치</b>' : '<b>전부 일치</b>') + '. ' + cap;
    }
    $('capStatement').innerHTML = cap;
  }

  function renderProfit() {
    var idx = state.index, keys = view.keys, ent = state.entity;
    var byCompany = {};
    idx.companies.forEach(function (c) { byCompany[c] = E.sum(idx, c, keys); });
    var all = E.sum(idx, ALL, keys);
    CH.marginCompare('cMarginCompare', { index: idx, companies: idx.companies, byCompany: byCompany });
    $('capMarginCompare').innerHTML = '선택 기간 합계 기준입니다. 전사 영업이익률은 <b>' + esc(F.pct(all.opm)) + '</b>입니다.';

    var rows = (idx.companies.length > 1 ? [{ name: ALL, sums: all }] : []).concat(idx.companies.map(function (c) { return { name: c, sums: byCompany[c] }; }));
    CH.use100('cUse100', { rows: rows, cogsItems: idx.items.cogs });
    var focusSums = ent === ALL ? all : byCompany[ent];
    var bigCogs = idx.items.cogs.slice().sort(function (a, b) { return (focusSums.items.cogs[b] || 0) - (focusSums.items.cogs[a] || 0); })[0];
    $('capUse100').innerHTML = bigCogs && focusSums.revenue
      ? esc(F.josa(ent, '은/는')) + ' 매출 100원 중 <b>' + esc(bigCogs) + '</b>로 <b>' + esc(F.comma((focusSums.items.cogs[bigCogs] || 0) / focusSums.revenue * 100, 0)) +
        '원</b>, 판관비로 ' + esc(F.comma(focusSums.sgaRatio * 100, 0)) + '원을 쓰고 영업이익 <b>' + esc(F.comma(Math.max(focusSums.opm, 0) * 100, 0)) + '원</b>을 남깁니다.'
      : '';

    var q = E.series(idx, ent, keys, 'quarter');
    $('stQuarter').textContent = ent + ' 분기별 영업이익과 영업이익률';
    CH.quarterBars('cQuarterOp', { series: q });
    CH.quarterMargin('cQuarterOpm', { series: q });

    var m = E.series(idx, ent, keys, 'month');
    var lines = idx.items.cogs.map(function (it) {
      return { name: it, values: m.map(function (c) { return c.sums.revenue ? (c.sums.items.cogs[it] || 0) / c.sums.revenue : null; }) };
    });
    var focus = null, best = -Infinity;
    lines.forEach(function (l) {
      var first = l.values[0], last = l.values[l.values.length - 1];
      if (first == null || last == null) return;
      if (Math.abs(last - first) > best) { best = Math.abs(last - first); focus = l; }
    });
    CH.ratioLines('cCostRatio', { labels: m.map(function (c) { return c.label; }), lines: lines, focus: focus && focus.name });
    $('capCostRatio').innerHTML = focus && m.length > 1
      ? '<b>' + esc(focus.name) + '</b> 비율이 ' + esc(m[0].label) + ' ' + esc(F.pct(focus.values[0])) + '에서 ' + esc(m[m.length - 1].label) + ' <b>' +
        esc(F.pct(focus.values[focus.values.length - 1])) + '</b>로 가장 크게 움직였습니다.'
      : '';
  }

  function renderSga() {
    var idx = state.index, keys = view.keys, ent = state.entity;
    var s = E.sum(idx, ent, keys);
    var w = I.compareWindow(idx, keys);
    var items = idx.items.sga;
    var changes = [];
    if (w) {
      var h = E.sum(idx, ent, w.head), t = E.sum(idx, ent, w.tail);
      changes = items.map(function (it) {
        var a = h.items.sga[it] || 0, z = t.items.sga[it] || 0;
        return { item: it, a: a, z: z, d: z - a, g: a ? (z - a) / Math.abs(a) : null };
      });
      changes.sort(function (x, y) { return Math.abs(y.g || 0) - Math.abs(x.g || 0); });
      changes.push({ item: '판관비 합계', a: h.sga, z: t.sga, d: t.sga - h.sga, g: h.sga ? (t.sga - h.sga) / Math.abs(h.sga) : null, total: true });
      changes.push({ item: '(참고) 매출액', a: h.revenue, z: t.revenue, d: t.revenue - h.revenue, g: h.revenue ? (t.revenue - h.revenue) / Math.abs(h.revenue) : null, total: true });
    }
    var focus = changes.length && !changes[0].total ? changes[0].item
      : items.slice().sort(function (a, b) { return (s.items.sga[b] || 0) - (s.items.sga[a] || 0); })[0];

    CH.sgaMix('cSgaMix', { sums: s, items: items, focus: focus });
    $('capSgaMix').innerHTML = '선택 기간 합계와 판관비 안 비중입니다. ' + (changes.length ? '가장 크게 변한 <b>' + esc(focus) + '</b>를 블루로 표시했습니다.' : '');

    var series = E.series(idx, ent, keys, 'month');
    CH.sgaStack('cSgaTrend', { series: series, items: items, showLabels: wide($('cSgaTrend').parentNode, 560) });
    $('capSgaTrend').innerHTML = '막대 위 숫자는 그 달 판관비 합계입니다.';

    CH.sgaRatioLine('cSgaRatio', { series: series });
    var r0 = series[0] && series[0].sums.sgaRatio, r1 = series.length && series[series.length - 1].sums.sgaRatio;
    $('capSgaRatio').innerHTML = series.length > 1
      ? '판관비율(판관비 ÷ 매출액)은 ' + esc(series[0].label) + ' ' + esc(F.pct(r0)) + '에서 ' + esc(series[series.length - 1].label) + ' <b>' + esc(F.pct(r1)) + '</b>입니다.'
      : '';

    $('stSgaChange').textContent = w ? '항목별 증감 (' + w.headLabel + ' → ' + w.tailLabel + ')' : '항목별 증감';
    if (!w) {
      $('sgaChangeTable').innerHTML = '<tbody><tr><td>기간을 2개월 이상 고르면 처음과 끝을 비교합니다.</td></tr></tbody>';
    } else {
      var maxG = Math.max.apply(null, changes.map(function (c) { return Math.abs(c.g || 0); }).concat([0.0001]));
      $('sgaChangeTable').innerHTML = '<thead><tr><th>항목</th><th>' + esc(w.headLabel) + '</th><th>' + esc(w.tailLabel) + '</th><th>증감액</th><th>증감률</th></tr></thead><tbody>' +
        changes.map(function (c) {
          var width = Math.round(Math.min(Math.abs(c.g || 0) / maxG, 1) * 64);
          return '<tr' + (c.total ? ' style="font-weight:700"' : '') + '><td>' + esc(c.item) + '</td><td>' + esc(F.won(c.a)) + '</td><td>' + esc(F.won(c.z)) + '</td>' +
            '<td class="' + (c.d < 0 ? 'neg' : '') + '">' + esc(F.won(c.d)) + '</td>' +
            '<td><span class="bar-cell"><span class="mini-bar' + (c.d < 0 ? ' down' : '') + '" style="width:' + width + 'px"></span>' + esc(F.signedPct(c.g, 0)) + '</span></td></tr>';
        }).join('') + '</tbody>';
    }

    var showCompare = idx.companies.length > 1;
    $('sgaCompareWrap').hidden = !showCompare;
    if (showCompare) {
      var cols = idx.companies.concat([ALL]);
      var sums = {};
      cols.forEach(function (c) { sums[c] = E.sum(idx, c, keys); });
      var rowsDef = items.map(function (it) { return { label: it, get: function (x) { return x.revenue ? (x.items.sga[it] || 0) / x.revenue : null; } }; })
        .concat([{ label: '판관비 합계', get: function (x) { return x.sgaRatio; }, total: true }]);
      $('sgaCompareTable').innerHTML = '<thead><tr><th>항목</th>' + cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '<th>법인 간 차이</th></tr></thead><tbody>' +
        rowsDef.map(function (r) {
          var vals = idx.companies.map(function (c) { return r.get(sums[c]); });
          var hi = Math.max.apply(null, vals.map(function (v) { return v == null ? -Infinity : v; }));
          var lo = Math.min.apply(null, vals.map(function (v) { return v == null ? Infinity : v; }));
          var gap = hi - lo;
          return '<tr' + (r.total ? ' style="font-weight:700"' : '') + '><td>' + esc(r.label) + '</td>' +
            vals.map(function (v) { return '<td class="' + (gap >= 0.03 && v === hi ? 'em' : '') + '">' + esc(F.pct(v)) + '</td>'; }).join('') +
            '<td>' + esc(F.pct(r.get(sums[ALL]))) + '</td><td>' + esc(F.pp(gap)) + '</td></tr>';
        }).join('') + '</tbody>';
    }
  }

  var TONE = { risk: ['risk', '위험'], warn: ['warn', '주의'], info: ['ok', '참고'] };

  function renderInsight() {
    var g = view.insights;
    $('insightGrid').innerHTML = g.insights.length ? g.insights.map(function (i, n) {
      var tone = TONE[i.tone] || TONE.info;
      return '<article class="insight' + (i.tone === 'risk' ? ' risk' : '') + '"><div class="insight-body">' +
        '<div class="insight-head"><span class="num">' + (n + 1) + '</span><h4>' + esc(i.title) + '</h4>' +
        '<span class="tone"><span class="dot ' + tone[0] + '"></span>' + tone[1] + '</span></div>' +
        '<p>' + rich(i.text) + '</p>' +
        '<div class="chips">' + i.evidence.map(function (e) { return '<span class="chip">' + esc(e.label) + '<b>' + esc(e.value) + '</b></span>'; }).join('') + '</div>' +
        '</div></article>';
    }).join('') : '<p>이 기간에는 조건을 만족한 인사이트가 없습니다. 기간을 넓히거나 관점을 바꿔 보세요.</p>';
    $('takeaway').hidden = !g.takeaway;
    $('takeawayText').textContent = g.takeaway || '';
    $('allRules').innerHTML = g.all.map(function (i) {
      return '<li>' + esc(i.title) + ' · ' + esc(i.company) + ' · 점수 ' + Math.round(i.score) + '</li>';
    }).join('');
  }

  /* ───────── 데이터 점검 ───────── */

  function checkStatus() {
    var rp = state.report, idx = state.index;
    var dropped = rp.skipped.amount + rp.skipped.company + rp.skipped.period + rp.skipped.category;
    var unmapped = idx ? idx.unmapped.reduce(function (a, u) { return a + u.count; }, 0) : 0;
    var level = rp.missingColumns.length || !rp.usedRows ? 'risk' : (dropped || unmapped ? 'warn' : 'ok');
    return { level: level, dropped: dropped, unmapped: unmapped };
  }

  function renderBadge() {
    var st = checkStatus();
    var used = state.report.usedRows - st.unmapped;
    $('checkBtn').innerHTML = '<span class="dot ' + st.level + '"></span>' +
      (st.level === 'ok' ? F.comma(used) + '행 정상' : F.comma(used) + '행 사용 · ' + F.comma(st.dropped + st.unmapped) + '행 확인 필요');
  }

  var COL_NAME = { id: 'ID', date: '거래일시', year: '년도', month: '월', major: '대분류', minor: '중분류', sub: '소분류', company: '회사명', amount: '금액' };
  var SKIP_NAME = { amount: '금액이 숫자가 아님', company: '회사명 없음', period: '월을 알 수 없음', category: '분류 없음', blank: '빈 행' };

  function renderCheck() {
    var rp = state.report, idx = state.index, st = checkStatus();
    var html = '<p class="check-summary"><span class="dot ' + st.level + '"></span>' +
      (st.level === 'ok' ? '모든 행을 손익계산서에 반영했습니다.' : st.level === 'warn' ? '일부 행을 반영하지 못했습니다. 아래 사유를 확인해 주세요.' : '필요한 열을 찾지 못했습니다.') + '</p>';
    var rows = [
      ['파일', rp.fileName || '-'], ['시트', rp.sheetName || (rp.encoding ? 'CSV (' + rp.encoding + ')' : '-')],
      ['헤더 행', rp.headerRow ? rp.headerRow + '행' : '찾지 못함'],
      ['읽은 행', F.comma(rp.totalRows) + '행'], ['손익에 반영한 행', F.comma(rp.usedRows - st.unmapped) + '행'],
      ['원본 금액 합계', F.won(rp.amountSumAll) + '원'], ['반영 금액 합계', F.won(rp.amountSumUsed - (idx ? idx.unmapped.reduce(function (a, u) { return a + u.amount; }, 0) : 0)) + '원'],
      ['회사', rp.companies.join(', ') || '-'],
      ['기간', idx && idx.periods.length ? E.periodLabel(idx, idx.periods[0]) + ' ~ ' + E.periodLabel(idx, idx.periods[idx.periods.length - 1]) + ' (' + idx.periods.length + '개월)' : '-']
    ];
    html += '<table class="tbl"><tbody>' + rows.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</tbody></table>';

    html += '<h3>열 연결</h3><table class="tbl"><thead><tr><th>필요한 열</th><th>파일의 열 이름</th></tr></thead><tbody>' +
      Object.keys(COL_NAME).map(function (k) {
        var found = rp.columns[k];
        return '<tr><td>' + esc(COL_NAME[k]) + '</td><td>' + (found ? esc(found) : '<span style="color:var(--gray-d)">없음</span>') + '</td></tr>';
      }).join('') + '</tbody></table>';
    if (rp.missingColumns.length) {
      html += '<p>필수 열이 없습니다: <b>' + rp.missingColumns.map(function (k) { return esc(COL_NAME[k] || k); }).join(', ') + '</b>. 열 이름을 확인해 주세요.</p>';
    }
    rp.warnings.forEach(function (w) { html += '<p>' + esc(w) + '</p>'; });

    var skipRows = Object.keys(SKIP_NAME).filter(function (k) { return rp.skipped[k]; });
    if (skipRows.length) {
      html += '<h3>제외한 행</h3><table class="tbl"><thead><tr><th>사유</th><th>행 수</th></tr></thead><tbody>' +
        skipRows.map(function (k) { return '<tr><td>' + SKIP_NAME[k] + '</td><td>' + F.comma(rp.skipped[k]) + '</td></tr>'; }).join('') + '</tbody></table>';
      if (rp.skippedSamples.length) {
        html += '<table class="tbl"><thead><tr><th>원본 행</th><th>사유</th><th>값</th></tr></thead><tbody>' +
          rp.skippedSamples.map(function (s) { return '<tr><td>' + s.row + '</td><td>' + SKIP_NAME[s.reason] + '</td><td>' + esc(s.values.filter(function (v) { return v != null; }).join(' | ')) + '</td></tr>'; }).join('') +
          '</tbody></table>';
      }
    }
    if (idx && idx.unmapped.length) {
      html += '<h3>손익 양식에 없는 분류</h3><p>아래 분류는 매출액·매출원가·판매관리비·영외수지 어디에도 속하지 않아 손익계산서에서 뺐습니다.</p>' +
        '<table class="tbl"><thead><tr><th>대분류 / 중분류</th><th>행 수</th><th>금액</th></tr></thead><tbody>' +
        idx.unmapped.map(function (u) { return '<tr><td>' + esc((u.major || '') + ' / ' + (u.minor || '')) + '</td><td>' + u.count + '</td><td>' + esc(F.won(u.amount)) + '</td></tr>'; }).join('') +
        '</tbody></table>';
    }
    if (idx && idx.extraItems.length) {
      html += '<h3>양식에 새로 붙인 항목</h3><p>과제 양식에 없는 중분류라 해당 구분의 하위 행으로 추가했습니다: ' + idx.extraItems.map(esc).join(', ') + '</p>';
    }
    $('checkBody').innerHTML = html;
  }

  /* ───────── 엑셀 내보내기 ───────── */

  function exportExcel() {
    if (!state.index) return;
    var ins = {};
    E.entities(state.index).forEach(function (e) { ins[e] = I.generate(state.index, { entity: e, periodKeys: view.keys }); });
    var out = EX.buildWorkbook(X, { records: state.records, index: state.index, periodKeys: view.keys, report: state.report, insightsByEntity: ins });
    var d = new Date();
    var stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    var data = X.write(out.wb, { bookType: 'xlsx', type: 'array', compression: true });
    var blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'income_statement_' + stamp + '.xlsx'; // 한글 이름은 일부 환경에서 'download' 로 바뀐다
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('SUMIFS 수식이 살아 있는 엑셀 파일을 내려받았습니다.');
  }

  /* ───────── 이벤트 ───────── */

  function bind() {
    $('fileInput').addEventListener('change', function (e) { readFile(e.target.files[0]); e.target.value = ''; });
    [].forEach.call(document.querySelectorAll('label[for="fileInput"]'), function (l) {
      l.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('fileInput').click(); } });
    });
    $('sampleBtn').addEventListener('click', loadSample);
    $('sampleBtn2').addEventListener('click', loadSample);
    $('exportBtn').addEventListener('click', exportExcel);

    $('entitySeg').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      state.entity = b.getAttribute('data-v');
      setSeg($('entitySeg'), state.entity);
      renderAll();
    });
    $('fromSel').addEventListener('change', function (e) { state.from = Number(e.target.value); renderAll(); });
    $('toSel').addEventListener('change', function (e) { state.to = Number(e.target.value); renderAll(); });
    $('groupSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      state.group = b.getAttribute('data-v'); setSeg($('groupSeg'), state.group); view.dirty.statement = true; renderTab('statement');
    });
    $('unitSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      state.unit = b.getAttribute('data-v'); setSeg($('unitSeg'), state.unit); view.dirty.statement = true; renderTab('statement');
    });

    document.querySelector('.tabs').addEventListener('click', function (e) {
      var t = e.target.closest('.tab'); if (t) setTab(t.getAttribute('data-tab'));
    });
    document.querySelector('.tabs').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var tabs = [].slice.call(document.querySelectorAll('.tab'));
      var i = tabs.findIndex(function (t) { return t.getAttribute('data-tab') === state.tab; });
      var next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      setTab(next.getAttribute('data-tab'));
      next.focus();
    });
    $('miniInsights').addEventListener('click', function (e) {
      var b = e.target.closest('[data-goto]'); if (b) setTab(b.getAttribute('data-goto'));
    });

    $('checkBtn').addEventListener('click', function () { renderCheck(); $('checkDialog').showModal(); });
    $('checkClose').addEventListener('click', function () { $('checkDialog').close(); });
    $('checkDialog').addEventListener('click', function (e) { if (e.target === $('checkDialog')) $('checkDialog').close(); });

    // 끌어다 놓기: 화면 어디에 놓아도 된다
    var depth = 0;
    document.addEventListener('dragenter', function (e) { e.preventDefault(); depth++; document.body.classList.add('dragging'); });
    document.addEventListener('dragleave', function () { depth = Math.max(0, depth - 1); if (!depth) document.body.classList.remove('dragging'); });
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', function (e) {
      e.preventDefault(); depth = 0; document.body.classList.remove('dragging');
      if (e.dataTransfer && e.dataTransfer.files.length) readFile(e.dataTransfer.files[0]);
    });

    // 창 크기가 바뀌면 라벨 표시 여부가 달라지므로 현재 탭만 다시 그린다
    var timer = null, lastW = window.innerWidth;
    window.addEventListener('resize', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (!state.index || Math.abs(window.innerWidth - lastW) < 40) return;
        lastW = window.innerWidth;
        view.dirty[state.tab] = true;
        renderTab(state.tab);
      }, 250);
    });
  }

  bind();
  // 주소 끝에 #sample 을 붙이면 샘플이 바로 열린다 (시연용)
  if (/sample/.test(location.hash)) loadSample();
})();
