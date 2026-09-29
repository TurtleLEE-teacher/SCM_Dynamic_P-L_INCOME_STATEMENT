/*
 * insights.js — 규칙 기반 인사이트
 *
 * 숫자에서 바로 문장을 만든다. API 키가 필요 없고 같은 파일이면 항상 같은 결과가 나온다.
 * 규칙마다 점수를 매겨 상위 카드만 보여주고, 1위 문장을 헤드메시지로 쓴다.
 * 문장 안의 **굵게** 표시는 화면에서 강조색으로 바뀐다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./pnl.js'), require('./format.js'));
  } else {
    root.PnLInsights = factory(root.PnL, root.PnLFormat);
  }
})(typeof self !== 'undefined' ? self : this, function (PnL, F) {
  'use strict';

  var ALL = PnL.ALL;
  var b = function (s) { return '**' + s + '**'; };
  var abs = Math.abs;
  // 금액 문자열은 항상 '원'으로 끝나므로 조사는 '으로'
  var moneyTo = function (n) { return F.money(n) + '으로'; };

  /** 비교 구간: 6개월 이상이면 앞 3개월 대 뒤 3개월, 그보다 짧으면 첫 달 대 마지막 달 */
  function compareWindow(index, periodKeys) {
    var n = periodKeys.length;
    if (n < 2) return null;
    var size = n >= 6 ? 3 : 1;
    var head = periodKeys.slice(0, size), tail = periodKeys.slice(n - size);
    var label = function (keys) {
      if (keys.length === 1) return PnL.periodLabel(index, keys[0]);
      var q0 = PnL.quarterKey(keys[0]);
      var aligned = keys[0] % 100 % 3 === 1 && keys.every(function (k) { return PnL.quarterKey(k) === q0; });
      if (aligned) return PnL.quarterLabel(index, q0);
      return PnL.periodLabel(index, keys[0]) + '~' + PnL.periodLabel(index, keys[keys.length - 1]);
    };
    return { head: head, tail: tail, headLabel: label(head), tailLabel: label(tail) };
  }

  function growth(a, z) { return a ? (z - a) / abs(a) : null; }

  function costItems(index) {
    var list = [];
    ['cogs', 'sga'].forEach(function (sec) {
      index.items[sec].forEach(function (it) { list.push({ section: sec, item: it }); });
    });
    return list;
  }

  function itemRatio(s, c) { return s.revenue ? s.items[c.section][c.item] / s.revenue : null; }

  /** 카드 1장. subject 는 짧은 문장의 주어 부분으로, 법인 관점 헤드메시지에서는 뺀다 */
  function card(o) {
    o.short = (o.subject || '') + o.shortBody;
    return o;
  }

  /* ───────── 규칙 ───────── */

  // 1. 이익 기여도: 매출 비중과 영업이익 비중의 차이
  function ruleContribution(ctx) {
    var cs = ctx.index.companies;
    if (cs.length < 2 || ctx.all.operatingProfit <= 0) return [];
    var rows = cs.map(function (c) {
      var s = ctx.byCompany[c];
      var op = s.operatingProfit / ctx.all.operatingProfit, rev = ctx.all.revenue ? s.revenue / ctx.all.revenue : 0;
      return { c: c, op: op, rev: rev, gap: op - rev };
    });
    // 전사 관점에서는 이익을 가장 많이 끌고 가는 법인 1곳만 본다 (두 법인이면 서로 거울상이다)
    var targets = ctx.entity === ALL
      ? [rows.slice().sort(function (x, y) { return y.op - x.op; })[0]]
      : rows.filter(function (r) { return r.c === ctx.entity; });
    return targets.filter(function (r) { return abs(r.gap) >= 0.15 || r.op >= 0.6; }).map(function (r) {
      var carries = r.gap >= 0;
      return card({
        id: 'contribution', company: r.c, tone: carries ? 'info' : 'risk',
        score: 60 + Math.min(abs(r.gap), 0.45) * 90,
        title: carries ? '전사 이익을 끌고 가는 법인' : '매출만큼 이익을 내지 못하는 법인',
        subject: F.josa(r.c, '이/가') + ' ',
        shortBody: '전사 영업이익의 ' + b(F.pct(r.op, 0)) + '를 냈습니다',
        text: F.josa(r.c, '은/는') + ' 전사 매출의 ' + F.pct(r.rev) + '를 차지하고 영업이익은 ' + b(F.pct(r.op)) + '를 냈습니다. ' +
          (carries ? '이익 비중이 매출 비중보다 ' + F.pp(r.gap) + ' 높아 전사 이익을 사실상 이 법인이 책임집니다.'
                   : '이익 비중이 매출 비중보다 ' + F.pp(-r.gap) + ' 낮아 매출이 이익으로 이어지지 않습니다.'),
        evidence: [{ label: '매출 비중', value: F.pct(r.rev) }, { label: '영업이익 비중', value: F.pct(r.op) }],
        action: carries ? null : F.josa(r.c, '은/는') + ' 매출 규모에 맞는 이익률 목표를 다시 세워야 합니다.'
      });
    });
  }

  // 2. 이익률 격차: 법인 간 (전사 관점) 또는 법인 대 전사 평균 (법인 관점)
  function ruleMarginGap(ctx) {
    var cs = ctx.index.companies;
    if (cs.length < 2) return [];
    if (ctx.entity === ALL) {
      var sorted = cs.slice().sort(function (x, y) { return (ctx.byCompany[y].opm || 0) - (ctx.byCompany[x].opm || 0); });
      var hi = sorted[0], lo = sorted[sorted.length - 1];
      var gap = (ctx.byCompany[hi].opm || 0) - (ctx.byCompany[lo].opm || 0);
      if (gap < 0.1) return [];
      return [card({
        id: 'marginGap', company: lo, tone: 'risk', score: 60 + Math.min(gap, 0.35) * 100,
        title: '법인 간 수익성 격차',
        subject: '',
        shortBody: '법인 간 영업이익률 격차가 ' + b(F.pp(gap)) + '입니다',
        text: '영업이익률은 ' + F.josa(hi, '이/가') + ' ' + b(F.pct(ctx.byCompany[hi].opm)) + ', ' + F.josa(lo, '이/가') + ' ' + b(F.pct(ctx.byCompany[lo].opm)) +
          '로 ' + F.pp(gap) + ' 차이 납니다. 같은 매출에서 법인마다 남기는 이익이 크게 다릅니다.',
        evidence: [{ label: hi, value: F.pct(ctx.byCompany[hi].opm) }, { label: lo, value: F.pct(ctx.byCompany[lo].opm) }],
        action: null
      })];
    }
    var own = ctx.own.opm, avg = ctx.all.opm;
    if (own == null || avg == null || abs(own - avg) < 0.05) return [];
    var above = own > avg;
    return [card({
      id: 'marginGap', company: ctx.entity, tone: above ? 'info' : 'risk', score: 55 + Math.min(abs(own - avg), 0.35) * 100,
      title: above ? '전사 평균보다 높은 수익성' : '전사 평균보다 낮은 수익성',
      subject: ctx.entity + ' ',
      shortBody: '영업이익률은 전사 평균(' + F.pct(avg) + ')보다 ' + b(F.pp(abs(own - avg))) + (above ? ' 높습니다' : ' 낮습니다'),
      text: ctx.entity + ' 영업이익률은 ' + b(F.pct(own)) + '로 전사 평균 ' + F.pct(avg) + '보다 ' + F.pp(abs(own - avg)) + (above ? ' 높습니다.' : ' 낮습니다.'),
      evidence: [{ label: ctx.entity, value: F.pct(own) }, { label: '전사', value: F.pct(avg) }],
      action: null
    })];
  }

  // 3. 원가 구조 차이: 매출 대비 비율이 법인 간에 가장 크게 벌어진 비용 항목
  function ruleCostStructure(ctx) {
    var cs = ctx.index.companies;
    if (cs.length < 2) return [];
    var pairs = [];
    var focus = ctx.entity === ALL ? cs : [ctx.entity];
    costItems(ctx.index).forEach(function (c) {
      focus.forEach(function (a) {
        cs.forEach(function (o) {
          if (o === a) return;
          var ra = itemRatio(ctx.byCompany[a], c), ro = itemRatio(ctx.byCompany[o], c);
          if (ra == null || ro == null) return;
          pairs.push({ c: c, high: a, low: o, ra: ra, ro: ro, gap: ra - ro });
        });
      });
    });
    pairs.sort(function (x, y) { return y.gap - x.gap; });
    var top = pairs[0];
    if (!top || top.gap < 0.05) return [];
    var marginGap = (ctx.byCompany[top.low].opm || 0) - (ctx.byCompany[top.high].opm || 0);
    var explains = marginGap > 0 && top.gap / marginGap >= 0.5;
    return [card({
      id: 'costStructure', company: top.high, tone: 'risk', score: 55 + Math.min(top.gap, 0.35) * 100,
      title: '수익성 격차의 원인: ' + top.c.item,
      subject: top.high + ' ',
      shortBody: F.josa(top.c.item, '은/는') + ' 매출의 ' + b(F.pct(top.ra)) + '로 ' + top.low + '(' + F.pct(top.ro) + ')보다 ' + F.pp(top.gap) + ' 높습니다',
      text: top.high + ' ' + F.josa(top.c.item, '이/가') + ' 매출의 ' + b(F.pct(top.ra)) + '를 차지해 ' + top.low + '(' + F.pct(top.ro) + ')보다 ' + b(F.pp(top.gap)) + ' 높습니다. ' +
        (explains ? '영업이익률 격차(' + F.pp(marginGap) + ')의 대부분을 이 항목 하나가 설명합니다.' : '비용 항목 가운데 두 법인 차이가 가장 큰 항목입니다.'),
      evidence: [{ label: top.high, value: F.pct(top.ra) }, { label: top.low, value: F.pct(top.ro) }, { label: '차이', value: F.pp(top.gap) }],
      topic: top.c.item,
      action: F.josa(top.high, '은/는') + ' ' + top.c.item + ' 단가와 구매 조건을 점검해 매출 대비 ' + top.c.item + ' 비율을 낮춰야 합니다.'
    })];
  }

  // 4. 성장의 질: 매출과 영업이익률이 반대로 움직이는지
  function ruleGrowthQuality(ctx) {
    var w = ctx.window;
    if (!w) return [];
    var out = [];
    ctx.targets.forEach(function (c) {
      var h = PnL.sum(ctx.index, c, w.head), t = PnL.sum(ctx.index, c, w.tail);
      var g = growth(h.revenue, t.revenue);
      if (g == null || h.opm == null || t.opm == null) return;
      var dm = t.opm - h.opm;
      var ev = [{ label: '매출 증감', value: F.signedPct(g) }, { label: w.headLabel + ' 이익률', value: F.pct(h.opm) }, { label: w.tailLabel + ' 이익률', value: F.pct(t.opm) }];
      if (g > 0.05 && dm < -0.03) {
        out.push(card({
          id: 'growthQuality', company: c, tone: 'risk', score: 70 + Math.min(-dm, 0.3) * 60,
          title: '팔수록 남는 것이 줄어드는 성장',
          subject: c + ' ',
          shortBody: '매출은 ' + b(F.pct(g)) + ' 늘었지만 영업이익률은 ' + b(F.pct(t.opm)) + '로 떨어졌습니다',
          text: c + ' 매출은 ' + w.headLabel + ' 대비 ' + w.tailLabel + '에 ' + b(F.pct(g)) + ' 늘었지만, 영업이익률은 ' + F.pct(h.opm) + '에서 ' + b(F.pct(t.opm)) +
            '로 ' + F.pp(-dm) + ' 떨어졌습니다. 매출보다 비용이 더 빠르게 늘고 있습니다.',
          evidence: ev, action: null
        }));
      } else if (g < -0.05 && dm > 0.03) {
        out.push(card({
          id: 'growthQuality', company: c, tone: 'warn', score: 68 + Math.min(dm, 0.3) * 60,
          title: '매출이 줄었는데 이익률이 오른 법인',
          subject: c + ' ',
          shortBody: '매출은 ' + b(F.pct(-g)) + ' 줄었는데 영업이익률은 ' + b(F.pct(t.opm)) + '로 올랐습니다',
          text: c + ' 매출은 ' + w.headLabel + ' 대비 ' + w.tailLabel + '에 ' + b(F.pct(-g)) + ' 줄었는데 영업이익률은 ' + F.pct(h.opm) + '에서 ' + b(F.pct(t.opm)) +
            '로 ' + F.pp(dm) + ' 올랐습니다. 매출이 아니라 비용을 줄여 만든 이익입니다.',
          evidence: ev, action: null
        }));
      }
    });
    return out;
  }

  // 5. 비용으로 지킨 이익: 매출이 줄 때 50% 이상 줄어든 판관비 항목
  function ruleCostCut(ctx) {
    var w = ctx.window;
    if (!w) return [];
    var out = [];
    ctx.targets.forEach(function (c) {
      var h = PnL.sum(ctx.index, c, w.head), t = PnL.sum(ctx.index, c, w.tail);
      var g = growth(h.revenue, t.revenue);
      if (g == null || g >= 0) return;
      var cuts = ctx.index.items.sga.map(function (it) {
        return { item: it, from: h.items.sga[it], to: t.items.sga[it], g: growth(h.items.sga[it], t.items.sga[it]) };
      }).filter(function (x) { return x.g != null && x.g <= -0.5; }).sort(function (x, y) { return x.g - y.g; });
      if (!cuts.length) return;
      var names = cuts.slice(0, 2).map(function (x) { return x.item; }).join('·');
      var first = cuts[0];
      out.push(card({
        id: 'costCut', company: c, tone: 'warn', score: 72 + Math.min(-first.g, 1) * 10,
        title: '비용 삭감으로 지킨 이익',
        subject: c + ' ',
        shortBody: F.josa(first.item, '은/는') + ' ' + w.headLabel + ' 대비 ' + b(F.pct(-first.g, 0)) + ' 줄었습니다',
        text: c + ' ' + F.josa(first.item, '은/는') + ' ' + w.headLabel + ' ' + F.money(first.from) + '에서 ' + w.tailLabel + ' ' + b(moneyTo(first.to)) + ' ' + b(F.pct(-first.g, 0)) + ' 줄었습니다' +
          (cuts[1] ? '. ' + cuts[1].item + '도' + ' ' + F.pct(-cuts[1].g, 0) + ' 줄었습니다.' : '.') +
          ' 같은 기간 매출은 ' + F.pct(-g) + ' 줄었으므로, 삭감 여력이 끝나면 이익도 함께 줄어듭니다.',
        evidence: cuts.slice(0, 3).map(function (x) { return { label: x.item, value: F.signedPct(x.g, 0) }; }).concat([{ label: '매출', value: F.signedPct(g) }]),
        action: F.josa(c, '은/는') + ' ' + names + ' 삭감 효과가 끝나기 전에 매출 회복 계획을 세워야 합니다.'
      }));
    });
    return out;
  }

  // 6. 빠르게 오르는 비용: 매출 대비 비율이 가장 많이 오른 항목
  function ruleRisingCost(ctx) {
    var w = ctx.window;
    if (!w) return [];
    var out = [];
    var scope = ctx.entity === ALL ? [ALL].concat(ctx.index.companies.length > 1 ? ctx.index.companies : []) : [ctx.entity];
    scope.forEach(function (c) {
      var h = PnL.sum(ctx.index, c, w.head), t = PnL.sum(ctx.index, c, w.tail);
      var best = null;
      costItems(ctx.index).forEach(function (ci) {
        var a = itemRatio(h, ci), z = itemRatio(t, ci);
        if (a == null || z == null) return;
        if (!best || z - a > best.d) best = { ci: ci, a: a, z: z, d: z - a };
      });
      if (!best || best.d < 0.05) return;
      var marginFell = h.opm != null && t.opm != null && t.opm < h.opm;
      out.push(card({
        id: 'risingCost', company: c, tone: 'risk',
        score: 60 + Math.min(best.d, 0.35) * 80 - (c === ALL && ctx.index.companies.length > 1 ? 8 : 0),
        title: '매출보다 빠르게 오르는 ' + best.ci.item,
        subject: c + ' ',
        shortBody: F.josa(best.ci.item, '이/가') + ' 매출의 ' + F.pct(best.a) + '에서 ' + b(F.pct(best.z)) + '로 올랐습니다',
        text: c + ' ' + F.josa(best.ci.item, '은/는') + ' ' + w.headLabel + ' 매출의 ' + F.pct(best.a) + '였으나 ' + w.tailLabel + '에는 ' + b(F.pct(best.z)) + '로 ' + b(F.pp(best.d)) + ' 올랐습니다. ' +
          (marginFell ? '영업이익률 하락(' + F.pct(h.opm) + ' → ' + F.pct(t.opm) + ')을 가장 많이 설명하는 비용 항목입니다.' : '비용 항목 가운데 매출 대비 비율이 가장 많이 오른 항목입니다.'),
        evidence: [{ label: w.headLabel, value: F.pct(best.a) }, { label: w.tailLabel, value: F.pct(best.z) }, { label: '변화', value: '+' + F.pp(best.d) }],
        topic: best.ci.item,
        action: (c === ALL ? '전사' : F.josa(c, '은/는')) + ' ' + best.ci.item + '를 단가와 사용량으로 나눠 보고 ' + w.headLabel + ' 수준(' + F.pct(best.a) + ')으로 되돌릴 목표를 세워야 합니다.'
      }));
    });
    return out;
  }

  // 7. 적자월: 영업이익이 음수인 달과 그 달에 튄 비용
  function ruleLossMonths(ctx) {
    var out = [];
    ctx.targets.forEach(function (c) {
      var monthly = PnL.series(ctx.index, c, ctx.periodKeys, 'month');
      var losses = monthly.filter(function (m) { return m.sums.operatingProfit < 0; });
      if (!losses.length) return;
      var worst = losses.slice().sort(function (x, y) { return x.sums.operatingProfit - y.sums.operatingProfit; })[0];
      // 그 달에 갑자기 튄 비용: 앞뒤 2개월 평균 비율과 비교한다 (꾸준히 오르는 항목보다 급증한 항목을 잡는다)
      var wi = monthly.indexOf(worst);
      var nearKeys = [];
      monthly.forEach(function (m, i) { if (i !== wi && Math.abs(i - wi) <= 2) nearKeys = nearKeys.concat(m.periods); });
      var near = nearKeys.length ? PnL.sum(ctx.index, c, nearKeys) : PnL.sum(ctx.index, c, ctx.periodKeys);
      var driver = null;
      costItems(ctx.index).forEach(function (ci) {
        var r = itemRatio(worst.sums, ci), ra = itemRatio(near, ci);
        if (r == null || ra == null) return;
        if (!driver || r - ra > driver.d) driver = { ci: ci, r: r, ra: ra, d: r - ra };
      });
      var hasDriver = driver && driver.d > 0;
      out.push(card({
        id: 'lossMonth', company: c, tone: 'risk', score: 85,
        title: '영업적자가 난 달: ' + losses.map(function (m) { return m.label; }).join(', '),
        subject: c + ' ',
        shortBody: worst.label + ' 영업이익이 ' + b(moneyTo(worst.sums.operatingProfit)) + ' 적자였습니다',
        text: c + ' ' + worst.label + ' 영업이익은 ' + b(F.won(worst.sums.operatingProfit) + '원') + '으로 적자였습니다.' +
          (hasDriver ? ' 같은 달 ' + F.josa(driver.ci.item, '이/가') + ' 매출의 ' + F.pct(driver.r) + '로 앞뒤 달 평균(' + F.pct(driver.ra) + ')보다 ' + b(F.pp(driver.d)) + ' 높았습니다.' : '') +
          (losses.length > 1 ? ' 적자월은 모두 ' + losses.length + '개월입니다.' : ''),
        evidence: [{ label: worst.label + ' 영업이익', value: F.won(worst.sums.operatingProfit) + '원' }]
          .concat(hasDriver ? [{ label: worst.label + ' ' + driver.ci.item + ' 비율', value: F.pct(driver.r) }] : []),
        action: F.josa(c, '은/는') + ' 적자월이 다시 나오지 않도록 월 마감 때 영업이익률 경보 기준을 걸어야 합니다.'
      }));
    });
    return out;
  }

  // 8. 영외수지: 세전이익을 얼마나 깎는지
  function ruleNonOperating(ctx) {
    var s = ctx.own;
    if (!s.operatingProfit || s.nonop === 0) return [];
    var share = s.nonop / abs(s.operatingProfit);
    if (abs(share) < 0.002) return [];
    var hurts = s.nonop < 0;
    return [card({
      id: 'nonop', company: ctx.entity, tone: hurts ? 'warn' : 'info', score: 25 + Math.min(abs(share), 0.3) * 150,
      title: hurts ? '세전이익을 깎는 영외수지' : '세전이익을 보태는 영외수지',
      subject: ctx.entity + ' ',
      shortBody: '영외수지 ' + b(F.money(s.nonop)) + (hurts ? '가 세전이익을 깎았습니다' : '가 세전이익을 보탰습니다'),
      text: ctx.entity + ' 영외수지는 ' + b(F.money(s.nonop)) + '입니다(영업외수익 ' + F.money(s.nonopIncome) + ', 영업외손실 ' + F.money(s.nonopLoss) + '). ' +
        '영업이익의 ' + F.pct(abs(share)) + ' 규모라 ' + (abs(share) < 0.05 ? '본업 이익에 주는 영향은 작습니다.' : '본업 밖 손익도 함께 관리해야 합니다.'),
      evidence: [{ label: '영외수지', value: F.money(s.nonop) }, { label: '영업이익 대비', value: F.pct(share) }],
      action: null
    })];
  }

  // 9. 판관비율 추세: 분기마다 한 방향으로 움직이는지
  function ruleSgaTrend(ctx) {
    var q = PnL.series(ctx.index, ctx.entity, ctx.periodKeys, 'quarter').filter(function (c) { return c.periods.length === 3; });
    if (q.length < 3) return [];
    var r = q.map(function (c) { return c.sums.sgaRatio; });
    if (r.some(function (x) { return x == null; })) return [];
    var up = true, down = true;
    for (var i = 1; i < r.length; i++) { if (r[i] <= r[i - 1]) up = false; if (r[i] >= r[i - 1]) down = false; }
    var d = r[r.length - 1] - r[0];
    if ((!up && !down) || abs(d) < 0.03) return [];
    return [card({
      id: 'sgaTrend', company: ctx.entity, tone: up ? 'risk' : 'info', score: 45 + Math.min(abs(d), 0.2) * 50,
      title: up ? '분기마다 오르는 판관비율' : '분기마다 내려가는 판관비율',
      subject: ctx.entity + ' ',
      shortBody: '판관비율이 ' + F.pct(r[0]) + '에서 ' + b(F.pct(r[r.length - 1])) + (up ? '로 계속 올랐습니다' : '로 계속 내려갔습니다'),
      text: ctx.entity + ' 판관비율은 ' + q[0].label + ' ' + F.pct(r[0]) + '에서 ' + q[q.length - 1].label + ' ' + b(F.pct(r[r.length - 1])) + '로 ' + F.pp(abs(d)) +
        (up ? ' 올랐습니다. 매출보다 판관비가 빠르게 늘고 있습니다.' : ' 내려갔습니다. 판관비 효율은 좋아졌지만 이익률이 함께 오르는지 원가 쪽도 봐야 합니다.'),
      evidence: q.map(function (c, i) { return { label: c.label, value: F.pct(r[i]) }; }),
      action: null
    })];
  }

  var RULES = [ruleContribution, ruleMarginGap, ruleCostStructure, ruleGrowthQuality, ruleCostCut, ruleRisingCost, ruleLossMonths, ruleNonOperating, ruleSgaTrend];

  /** 점수순으로 고르되, 같은 규칙은 1장만 뽑는다. 전사 관점에서는 한 법인을 3장까지로 묶어 한쪽으로 쏠리지 않게 한다 */
  function pick(all, limit, perCompany) {
    var picked = [], byRule = {}, byCompany = {};
    all.forEach(function (i) {
      if (picked.length >= limit) return;
      if (byRule[i.id]) return;
      if ((byCompany[i.company] || 0) >= perCompany) return;
      picked.push(i);
      byRule[i.id] = true;
      byCompany[i.company] = (byCompany[i.company] || 0) + 1;
    });
    return picked;
  }

  /**
   * @param index PnL.buildIndex 결과
   * @param opts {entity, periodKeys, limit}
   * @returns {{headline, insights, all, takeaway, window}}
   */
  function generate(index, opts) {
    var entity = opts.entity || ALL;
    var periodKeys = opts.periodKeys || index.periods;
    var ctx = {
      index: index, entity: entity, periodKeys: periodKeys,
      all: PnL.sum(index, ALL, periodKeys),
      own: PnL.sum(index, entity, periodKeys),
      byCompany: {},
      targets: entity === ALL ? index.companies : [entity],
      window: compareWindow(index, periodKeys)
    };
    index.companies.forEach(function (c) { ctx.byCompany[c] = PnL.sum(index, c, periodKeys); });

    var all = [];
    RULES.forEach(function (rule) { all = all.concat(rule(ctx)); });
    all.sort(function (x, y) { return y.score - x.score; });
    var picked = pick(all, opts.limit || 6, entity === ALL ? 3 : Infinity);

    var lead = entity + ' 영업이익률 ' + b(F.pct(ctx.own.opm));
    var top = picked[0];
    var headline = top
      ? lead + ', ' + (top.company === entity && entity !== ALL ? top.shortBody : top.short) + '.'
      : lead + '입니다.';

    // 종합 시사점: 구체적인 처방부터 최대 2개. 전사 관점에서는 법인마다 1개씩 고른다
    var actionOrder = ['risingCost', 'costStructure', 'costCut', 'lossMonth', 'contribution'];
    var withAction = all.filter(function (i) { return i.action; }).sort(function (x, y) {
      return actionOrder.indexOf(x.id) - actionOrder.indexOf(y.id) || y.score - x.score;
    });
    var actions = [];
    withAction.forEach(function (i) {
      if (actions.length >= 2) return;
      if (entity === ALL && i.company === ALL && index.companies.length > 1) return;
      if (entity === ALL && actions.some(function (a) { return a.company === i.company; })) return;
      var topic = i.topic || i.id;
      if (actions.some(function (a) { return a.company === i.company && a.topic === topic; })) return;
      actions.push({ company: i.company, topic: topic, text: i.action });
    });
    var takeaway = actions.length ? actions.map(function (a) { return a.text; }).join(' ') : null;

    return { headline: headline, insights: picked, all: all, takeaway: takeaway, window: ctx.window };
  }

  return { generate: generate, compareWindow: compareWindow, pick: pick, RULES: RULES };
});
