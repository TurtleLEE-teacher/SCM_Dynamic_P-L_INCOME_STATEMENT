/*
 * format.js — 숫자·단위·조사 표기
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PnLFormat = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MINUS = '-';

  function comma(n, digits) {
    if (n == null || isNaN(n)) return '–';
    var d = digits || 0;
    var fixed = Math.abs(n).toFixed(d);
    var parts = fixed.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    var s = parts.join('.');
    return (n < 0 && Number(fixed) !== 0 ? MINUS : '') + s;
  }

  /** 원 단위 정수 표기: 1,234,567 */
  function won(n) { return comma(Math.round(n)); }

  /** 문장용 금액: 35.1억 원 · 1,247만 원 · 3,000원 */
  function money(n) {
    if (n == null || isNaN(n)) return '–';
    var a = Math.abs(n), sign = n < 0 ? MINUS : '';
    if (a >= 1e8) return sign + comma(a / 1e8, a >= 1e10 ? 0 : 1) + '억 원';
    if (a >= 1e4) return sign + comma(Math.round(a / 1e4)) + '만 원';
    return sign + comma(Math.round(a)) + '원';
  }

  /** KPI 타일용: 값과 단위를 나눠 돌려준다 */
  function moneyParts(n) {
    var a = Math.abs(n), sign = n < 0 ? MINUS : '';
    if (a >= 1e8) return { value: sign + comma(a / 1e8, 1), unit: '억 원' };
    if (a >= 1e4) return { value: sign + comma(Math.round(a / 1e4)), unit: '만 원' };
    return { value: sign + comma(Math.round(a)), unit: '원' };
  }

  function pct(r, digits) {
    if (r == null || isNaN(r) || !isFinite(r)) return '–';
    return comma(r * 100, digits == null ? 1 : digits) + '%';
  }

  function pp(d, digits) {
    if (d == null || isNaN(d)) return '–';
    return comma(d * 100, digits == null ? 1 : digits) + '%p';
  }

  function signedPct(r, digits) {
    if (r == null || isNaN(r) || !isFinite(r)) return '–';
    return (r > 0 ? '+' : '') + pct(r, digits);
  }

  var UNITS = {
    '원': { div: 1, digits: 0 },
    '천원': { div: 1e3, digits: 0 },
    '백만원': { div: 1e6, digits: 1 }
  };

  /** 표 셀용: 선택한 단위로 나눠 쉼표를 찍는다 */
  function inUnit(n, unit) {
    var u = UNITS[unit] || UNITS['원'];
    return comma(n / u.div, u.digits);
  }

  // 받침 판별: 한글은 유니코드로, 숫자·영문은 읽는 소리로 판단한다
  var DIGIT_BATCHIM = { '0': 'ㅇ', '1': 'ㄹ', '2': '', '3': 'ㅁ', '4': '', '5': '', '6': 'ㄱ', '7': 'ㄹ', '8': 'ㄹ', '9': '' };

  function lastSound(word) {
    var s = String(word).replace(/[\s)\]'"」』]+$/, '');
    var ch = s.charAt(s.length - 1);
    var code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      var jong = (code - 0xac00) % 28;
      return jong === 0 ? '' : (jong === 8 ? 'ㄹ' : 'x');
    }
    if (ch in DIGIT_BATCHIM) return DIGIT_BATCHIM[ch];
    if (ch === '%') return '';
    return '';
  }

  /** 조사 붙이기: josa('본사', '은/는') → '본사는' */
  function josa(word, pair) {
    var p = pair.split('/');
    var sound = lastSound(word);
    var hasBatchim = sound !== '';
    if (pair === '으로/로') return word + (hasBatchim && sound !== 'ㄹ' ? p[0] : p[1]);
    return word + (hasBatchim ? p[0] : p[1]);
  }

  return {
    comma: comma, won: won, money: money, moneyParts: moneyParts,
    pct: pct, pp: pp, signedPct: signedPct,
    UNITS: UNITS, inUnit: inUnit, josa: josa
  };
});
