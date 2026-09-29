/*
 * charts.js — Chart.js 래퍼
 *
 * 디자인 규칙 ([SKILL]_KPMG_HTML_디자인 §4.7 + 시각화 가이드)
 *   - 회색 + 블루 스케일만 쓴다. 블루는 짚어야 할 지점에만
 *   - 이중 축을 쓰지 않는다. 금액과 비율은 위아래 두 차트로 나눈다
 *   - 값 축은 숨기고 필요한 곳에만 직접 라벨을 단다. 나머지 값은 마우스를 올리면 보인다
 *   - 계열이 2개 이상이면 범례를 켠다
 */
(function (root) {
  'use strict';
  var F = root.PnLFormat;

  var C = {
    blue: '#062F87', b900: '#092453', b500: '#516DAB', b300: '#A8B6D5', b100: '#EBEEF5',
    grayD: '#7F7F7F', grayM: '#AFABAB', grayL: '#D9D9D9', ink: '#404040', white: '#FFFFFF'
  };
  // 법인 색은 순서를 고정한다 (필터가 바뀌어도 같은 법인은 같은 색)
  var ENTITY_COLORS = [C.b500, C.grayM, C.b300, C.grayD, C.b900];
  var instances = {};
  var ready = false;

  function setup() {
    if (ready || !root.Chart) return;
    ready = true;
    if (root.ChartDataLabels) root.Chart.register(root.ChartDataLabels);
    var d = root.Chart.defaults;
    d.font.family = "'Pretendard Variable',Pretendard,-apple-system,'Malgun Gothic',sans-serif";
    d.font.size = 12;
    d.color = C.grayD;
    d.maintainAspectRatio = false;
    d.responsive = true;
    d.animation.duration = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 350;
    d.plugins.legend.display = false;
    d.plugins.legend.labels.boxWidth = 10;
    d.plugins.legend.labels.boxHeight = 10;
    d.plugins.legend.labels.color = C.ink;
    d.plugins.tooltip.backgroundColor = C.b900;
    d.plugins.tooltip.titleFont = { weight: '700' };
    d.plugins.tooltip.padding = 10;
    d.plugins.tooltip.cornerRadius = 4;
    d.plugins.tooltip.boxPadding = 4;
    if (d.plugins.datalabels) {
      d.plugins.datalabels.display = false;
      d.plugins.datalabels.color = C.ink;
      d.plugins.datalabels.font = { weight: '700', size: 11 };
    }
  }

  function entityColor(index, name) {
    var i = index.companies.indexOf(name);
    return ENTITY_COLORS[(i < 0 ? 0 : i) % ENTITY_COLORS.length];
  }

  /** 차트용 짧은 금액: 2.7억 · 5,481만 · -267만 */
  function compact(n) {
    if (n == null || isNaN(n)) return '';
    var a = Math.abs(n), s = n < 0 ? '-' : '';
    if (a >= 1e8) return s + F.comma(a / 1e8, a >= 1e10 ? 0 : 1) + '억';
    if (a >= 1e4) return s + F.comma(Math.round(a / 1e4)) + '만';
    return s + F.comma(Math.round(a));
  }

  function draw(id, config) {
    setup();
    var el = document.getElementById(id);
    if (!el) return null;
    if (instances[id]) instances[id].destroy();
    instances[id] = new root.Chart(el, config);
    return instances[id];
  }

  function destroyAll() {
    Object.keys(instances).forEach(function (k) { instances[k].destroy(); delete instances[k]; });
  }

  var xAxis = function (extra) {
    return Object.assign({ grid: { display: false }, border: { color: C.grayD }, ticks: { color: C.grayD, maxRotation: 0, autoSkip: true } }, extra || {});
  };
  var hiddenY = function (extra) { return Object.assign({ display: false, grace: '14%' }, extra || {}); };
  var moneyTip = function (ctx) { return ' ' + (ctx.dataset.label ? ctx.dataset.label + ': ' : '') + F.won(ctx.parsed.y != null ? ctx.parsed.y : ctx.parsed.x) + '원'; };
  var pctTip = function (ctx) { var v = ctx.parsed.y != null ? ctx.parsed.y : ctx.parsed.x; return ' ' + (ctx.dataset.label ? ctx.dataset.label + ': ' : '') + F.pct(v); };

  function extremes(values) {
    var min = -1, max = -1;
    values.forEach(function (v, i) {
      if (v == null) return;
      if (min < 0 || v < values[min]) min = i;
      if (max < 0 || v > values[max]) max = i;
    });
    return { min: min, max: max };
  }

  /* ───────── 요약 ───────── */

  /** 월별 매출액 막대. 전사는 법인별 누적, 법인은 단일 막대. focusIdx 달은 블루 */
  function revenueBars(id, ctx) {
    var labels = ctx.series.map(function (c) { return c.label; });
    var datasets;
    if (ctx.stackBy && ctx.stackBy.length > 1) {
      datasets = ctx.stackBy.map(function (name, i) {
        return {
          label: name, data: ctx.stackSeries[name].map(function (c) { return c.sums.revenue; }),
          backgroundColor: entityColor(ctx.index, name), borderColor: C.white, borderWidth: { top: 2 }, borderSkipped: false,
          barPercentage: .6, stack: 'rev',
          datalabels: i === ctx.stackBy.length - 1 ? {
            display: ctx.showLabels, anchor: 'end', align: 'top', offset: 2,
            formatter: function (v, c) { return compact(ctx.series[c.dataIndex].sums.revenue); }
          } : { display: false }
        };
      });
    } else {
      datasets = [{
        label: '매출액', data: ctx.series.map(function (c) { return c.sums.revenue; }),
        backgroundColor: ctx.series.map(function (c, i) { return i === ctx.focusIdx ? C.blue : C.grayM; }),
        borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', barPercentage: .6,
        datalabels: { display: ctx.showLabels, anchor: 'end', align: 'top', offset: 2, formatter: compact }
      }];
    }
    return draw(id, {
      type: 'bar',
      data: { labels: labels, datasets: datasets },
      options: {
        layout: { padding: { top: 4 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: datasets.length > 1, position: 'top', align: 'end' },
          tooltip: { callbacks: { label: moneyTip, footer: function (items) {
            if (items.length < 2) return '';
            var t = 0; items.forEach(function (i) { t += i.parsed.y; }); return '합계: ' + F.won(t) + '원';
          } } }
        },
        scales: { x: xAxis({ stacked: true, ticks: { display: false } }), y: hiddenY({ stacked: true }) }
      }
    });
  }

  /** 월별 영업이익률 선. 최저·최고·마지막 점에만 라벨 */
  function marginLine(id, ctx) {
    var values = ctx.series.map(function (c) { return c.sums.opm; });
    var ex = extremes(values);
    var last = values.length - 1;
    return draw(id, {
      type: 'line',
      data: {
        labels: ctx.series.map(function (c) { return c.label; }),
        datasets: [{
          label: '영업이익률', data: values, borderColor: C.blue, borderWidth: 2, tension: 0,
          pointRadius: values.map(function (v, i) { return i === ex.min || i === ex.max || i === last ? 4 : 2.5; }),
          pointBackgroundColor: values.map(function (v, i) { return i === ex.min ? C.blue : C.white; }),
          pointBorderColor: C.blue, pointBorderWidth: 2, pointHoverRadius: 6,
          datalabels: {
            display: function (c) { return c.dataIndex === ex.min || c.dataIndex === ex.max || c.dataIndex === last; },
            align: function (c) { return c.dataIndex === ex.min ? 'bottom' : 'top'; }, clamp: true,
            color: function (c) { return c.dataIndex === ex.min ? C.blue : C.ink; },
            formatter: function (v, c) { return (c.dataIndex === ex.min ? '최저 ' : c.dataIndex === ex.max ? '최고 ' : '') + F.pct(v); }
          }
        }]
      },
      options: {
        layout: { padding: { top: 18, bottom: 6, left: 28, right: 28 } },
        interaction: { mode: 'index', intersect: false },
        plugins: { tooltip: { callbacks: { label: pctTip } } },
        scales: { x: xAxis(), y: hiddenY({ grace: '25%' }) }
      }
    });
  }

  /** 매출액 → 세전이익 폭포 차트 */
  function waterfall(id, s, narrow) {
    var steps = [
      { label: '매출액', from: 0, to: s.revenue, kind: 'total' },
      { label: '매출원가', from: s.revenue, to: s.grossProfit, kind: 'down' },
      { label: '매출이익', from: 0, to: s.grossProfit, kind: 'total' },
      { label: '판관비', from: s.grossProfit, to: s.operatingProfit, kind: 'down' },
      { label: '영업이익', from: 0, to: s.operatingProfit, kind: 'focus' },
      { label: '영외수지', from: s.operatingProfit, to: s.pretax, kind: s.nonop < 0 ? 'down' : 'up' },
      { label: '세전이익', from: 0, to: s.pretax, kind: 'total' }
    ];
    var color = { total: C.grayM, down: C.b300, up: C.grayL, focus: C.blue };
    return draw(id, {
      type: 'bar',
      data: {
        labels: steps.map(function (x) { return x.label; }),
        datasets: [{
          label: '금액', data: steps.map(function (x) { return [x.from, x.to]; }),
          backgroundColor: steps.map(function (x) { return color[x.kind]; }),
          borderRadius: 2, borderSkipped: false, barPercentage: .62,
          datalabels: {
            display: function (c) {
              var st = steps[c.dataIndex];
              return !narrow || st.kind === 'total' || st.kind === 'focus' || Math.abs(st.to - st.from) >= Math.abs(s.revenue) * 0.02;
            },
            anchor: 'end', align: 'top', offset: 2,
            color: function (c) { return steps[c.dataIndex].kind === 'focus' ? C.blue : C.ink; },
            formatter: function (v, c) {
              var st = steps[c.dataIndex], delta = st.to - st.from;
              if (st.kind === 'focus') return compact(st.to) + (narrow ? '' : ' (' + F.pct(s.opm) + ')');
              return compact(st.kind === 'total' ? st.to : delta);
            }
          }
        }]
      },
      options: {
        layout: { padding: { top: 20 } },
        plugins: { tooltip: { callbacks: { label: function (c) {
          var st = steps[c.dataIndex];
          return ' ' + F.won(st.kind === 'total' || st.kind === 'focus' ? st.to : st.to - st.from) + '원';
        } } } },
        scales: { x: xAxis(), y: hiddenY({ beginAtZero: true, grace: '8%' }) }
      }
    });
  }

  /* ───────── 수익성 ───────── */

  /** 법인별 이익률 3종 가로 막대 */
  function marginCompare(id, ctx) {
    var metrics = [{ k: 'gpm', l: '매출이익률' }, { k: 'opm', l: '영업이익률' }, { k: 'ptm', l: '세전이익률' }];
    var datasets = ctx.companies.map(function (name) {
      return {
        label: name, data: metrics.map(function (m) { return ctx.byCompany[name][m.k]; }),
        backgroundColor: entityColor(ctx.index, name), borderRadius: { topRight: 4, bottomRight: 4 }, borderSkipped: 'left',
        borderColor: C.white, borderWidth: { top: 1, bottom: 1 }, barPercentage: .8, categoryPercentage: .7,
        datalabels: { display: true, anchor: 'end', align: 'right', offset: 4, formatter: function (v) { return F.pct(v); } }
      };
    });
    return draw(id, {
      type: 'bar',
      data: { labels: metrics.map(function (m) { return m.l; }), datasets: datasets },
      options: {
        indexAxis: 'y',
        layout: { padding: { right: 48 } },
        plugins: { legend: { display: datasets.length > 1, position: 'top', align: 'end' }, tooltip: { callbacks: { label: pctTip } } },
        scales: {
          x: { display: false, beginAtZero: true, grace: '10%' },
          y: { grid: { display: false }, border: { color: C.grayD }, ticks: { color: C.ink, font: { weight: '700' } } }
        }
      }
    });
  }

  /** 매출 100원의 쓰임새: 원가 항목 · 판관비 · 영업이익을 매출 대비 비율로 쌓는다 */
  function use100(id, ctx) {
    var grays = [C.grayD, C.grayM, C.grayL, '#C6C3C3', '#BDBDBD'];
    var parts = ctx.cogsItems.map(function (it, i) {
      return { label: it, color: grays[i % grays.length], get: function (s) { return s.items.cogs[it] || 0; } };
    }).concat([
      { label: '판관비', color: C.b300, get: function (s) { return s.sga; } },
      { label: '영업이익', color: C.blue, get: function (s) { return Math.max(s.operatingProfit, 0); } }
    ]);
    var rows = ctx.rows; // [{name, sums}]
    var datasets = parts.map(function (p) {
      return {
        label: p.label, backgroundColor: p.color, borderColor: C.white, borderWidth: { left: 2 }, borderSkipped: false, barPercentage: .62,
        data: rows.map(function (r) { return r.sums.revenue ? p.get(r.sums) / r.sums.revenue * 100 : 0; }),
        datalabels: {
          display: function (c) { return c.dataset.data[c.dataIndex] >= 7; },
          color: p.color === C.blue || p.color === C.grayD ? C.white : C.ink,
          formatter: function (v) { return F.comma(v, 0); }
        }
      };
    });
    return draw(id, {
      type: 'bar',
      data: { labels: rows.map(function (r) { return r.name; }), datasets: datasets },
      options: {
        indexAxis: 'y',
        plugins: {
          legend: { display: true, position: 'top', align: 'start' },
          tooltip: { callbacks: { label: function (c) { return ' ' + c.dataset.label + ': ' + F.comma(c.parsed.x, 1) + '원'; } } }
        },
        scales: {
          x: { display: false, stacked: true, max: 100 },
          y: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { color: C.ink, font: { weight: '700' } } }
        }
      }
    });
  }

  /** 분기별 영업이익 막대 */
  function quarterBars(id, ctx) {
    var values = ctx.series.map(function (c) { return c.sums.operatingProfit; });
    var ex = extremes(values);
    return draw(id, {
      type: 'bar',
      data: {
        labels: ctx.series.map(function (c) { return c.label; }),
        datasets: [{
          label: '영업이익', data: values,
          backgroundColor: values.map(function (v, i) { return i === ex.min && values.length > 1 ? C.blue : C.grayM; }),
          borderRadius: 4, borderSkipped: 'bottom', barPercentage: .5,
          datalabels: { display: true, anchor: 'end', align: function (c) { return values[c.dataIndex] < 0 ? 'bottom' : 'top'; }, formatter: compact }
        }]
      },
      options: {
        layout: { padding: { top: 18 } },
        plugins: { tooltip: { callbacks: { label: moneyTip } } },
        scales: { x: xAxis({ ticks: { display: false } }), y: hiddenY({ beginAtZero: true }) }
      }
    });
  }

  /** 분기별 영업이익률 선 (점 4개 모두 라벨) */
  function quarterMargin(id, ctx) {
    var values = ctx.series.map(function (c) { return c.sums.opm; });
    return draw(id, {
      type: 'line',
      data: {
        labels: ctx.series.map(function (c) { return c.label; }),
        datasets: [{
          label: '영업이익률', data: values, borderColor: C.blue, borderWidth: 2, tension: 0,
          pointRadius: 4, pointBackgroundColor: C.white, pointBorderColor: C.blue, pointBorderWidth: 2,
          datalabels: { display: true, align: 'top', clamp: true, formatter: function (v) { return F.pct(v); } }
        }]
      },
      options: {
        layout: { padding: { top: 20, left: 28, right: 28 } },
        plugins: { tooltip: { callbacks: { label: pctTip } } },
        scales: { x: xAxis(), y: hiddenY({ grace: '30%' }) }
      }
    });
  }

  /** 여러 항목의 월별 비율 선. focus 항목만 블루, 끝점에 이름과 값 */
  function ratioLines(id, ctx) {
    var others = [C.grayM, C.grayD, C.b300, C.grayL];
    var n = 0;
    var datasets = ctx.lines.map(function (line) {
      var isFocus = line.name === ctx.focus;
      var color = isFocus ? C.blue : others[n++ % others.length];
      var lastIdx = line.values.length - 1;
      return {
        label: line.name, data: line.values, borderColor: color, backgroundColor: color, borderWidth: isFocus ? 2.5 : 2, tension: 0,
        pointRadius: isFocus ? 3 : 0, pointHoverRadius: 5, pointBackgroundColor: color, order: isFocus ? 0 : 1,
        datalabels: {
          display: function (c) { return isFocus && c.dataIndex === lastIdx; },
          align: 'right', anchor: 'center', offset: 6, clamp: true,
          color: isFocus ? C.blue : C.grayD,
          formatter: function (v) { return line.name + ' ' + F.pct(v); }
        }
      };
    });
    return draw(id, {
      type: 'line',
      data: { labels: ctx.labels, datasets: datasets },
      options: {
        layout: { padding: { right: 96, top: 12, bottom: 4, left: 4 } },
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: datasets.length > 1, position: 'top', align: 'start' }, tooltip: { callbacks: { label: pctTip } } },
        scales: { x: xAxis(), y: hiddenY({ beginAtZero: true, grace: '10%' }) }
      }
    });
  }

  /* ───────── 판관비 ───────── */

  var SGA_COLORS = [C.b900, C.blue, C.b500, C.b300, C.grayM, C.grayD, C.grayL];

  /** 판관비 항목 구성: 큰 순서의 가로 막대, focus 항목만 블루 */
  function sgaMix(id, ctx) {
    var rows = ctx.items.map(function (it) { return { item: it, v: ctx.sums.items.sga[it] || 0 }; })
      .sort(function (x, y) { return y.v - x.v; });
    var total = ctx.sums.sga || 1;
    return draw(id, {
      type: 'bar',
      data: {
        labels: rows.map(function (r) { return r.item; }),
        datasets: [{
          label: '판관비', data: rows.map(function (r) { return r.v; }),
          backgroundColor: rows.map(function (r) { return r.item === ctx.focus ? C.blue : C.grayM; }),
          borderRadius: { topRight: 4, bottomRight: 4 }, borderSkipped: 'left', barPercentage: .6,
          datalabels: {
            display: true, anchor: 'end', align: 'right', offset: 4,
            color: function (c) { return rows[c.dataIndex].item === ctx.focus ? C.blue : C.ink; },
            formatter: function (v) { return compact(v) + ' · ' + F.pct(v / total, 0); }
          }
        }]
      },
      options: {
        indexAxis: 'y',
        layout: { padding: { right: 90 } },
        plugins: { tooltip: { callbacks: { label: function (c) { return ' ' + F.won(c.parsed.x) + '원 (판관비의 ' + F.pct(c.parsed.x / total) + ')'; } } } },
        scales: {
          x: { display: false, beginAtZero: true },
          y: { grid: { display: false }, border: { color: C.grayD }, ticks: { color: C.ink, font: { weight: '700' } } }
        }
      }
    });
  }

  /** 월별 판관비 항목 누적 막대 */
  function sgaStack(id, ctx) {
    var datasets = ctx.items.map(function (it, i) {
      return {
        label: it, data: ctx.series.map(function (c) { return c.sums.items.sga[it] || 0; }),
        backgroundColor: SGA_COLORS[i % SGA_COLORS.length], borderColor: C.white, borderWidth: { top: 2 }, borderSkipped: false,
        stack: 'sga', barPercentage: .62,
        datalabels: i === ctx.items.length - 1 ? {
          display: ctx.showLabels, anchor: 'end', align: 'top', offset: 2,
          formatter: function (v, c) { return compact(ctx.series[c.dataIndex].sums.sga); }
        } : { display: false }
      };
    });
    return draw(id, {
      type: 'bar',
      data: { labels: ctx.series.map(function (c) { return c.label; }), datasets: datasets },
      options: {
        layout: { padding: { top: 6 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'top', align: 'start' },
          tooltip: { callbacks: { label: moneyTip, footer: function (items) {
            var t = 0; items.forEach(function (i) { t += i.parsed.y; }); return '판관비 합계: ' + F.won(t) + '원';
          } } }
        },
        scales: { x: xAxis({ stacked: true }), y: hiddenY({ stacked: true }) }
      }
    });
  }

  /** 월별 판관비율 선 */
  function sgaRatioLine(id, ctx) {
    var values = ctx.series.map(function (c) { return c.sums.sgaRatio; });
    var ex = extremes(values), last = values.length - 1;
    return draw(id, {
      type: 'line',
      data: {
        labels: ctx.series.map(function (c) { return c.label; }),
        datasets: [{
          label: '판관비율', data: values, borderColor: C.blue, borderWidth: 2, tension: 0,
          pointRadius: 3, pointBackgroundColor: C.white, pointBorderColor: C.blue, pointBorderWidth: 2,
          datalabels: {
            display: function (c) { return c.dataIndex === 0 || c.dataIndex === last || c.dataIndex === ex.max || c.dataIndex === ex.min; },
            align: function (c) { return c.dataIndex === ex.min ? 'bottom' : 'top'; }, clamp: true,
            formatter: function (v) { return F.pct(v); }
          }
        }]
      },
      options: {
        layout: { padding: { top: 18, bottom: 6, left: 28, right: 28 } },
        interaction: { mode: 'index', intersect: false },
        plugins: { tooltip: { callbacks: { label: pctTip } } },
        scales: { x: xAxis(), y: hiddenY({ grace: '25%' }) }
      }
    });
  }

  root.PnLCharts = {
    COLORS: C, ENTITY_COLORS: ENTITY_COLORS, entityColor: entityColor, compact: compact,
    destroyAll: destroyAll,
    revenueBars: revenueBars, marginLine: marginLine, waterfall: waterfall,
    marginCompare: marginCompare, use100: use100, quarterBars: quarterBars, quarterMargin: quarterMargin, ratioLines: ratioLines,
    sgaMix: sgaMix, sgaStack: sgaStack, sgaRatioLine: sgaRatioLine
  };
})(typeof self !== 'undefined' ? self : this);
