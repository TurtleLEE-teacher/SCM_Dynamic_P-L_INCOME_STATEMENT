#!/usr/bin/env node
/*
 * make-sample.js — 가상 샘플 Raw data 생성기
 *
 * 과제 원본과 같은 11열 · 같은 행 배분(회사당 월 50행)으로 가상 데이터를 만든다.
 * 금액은 시드 고정 난수로 새로 만들고, 인사이트 규칙이 걸리도록 패턴만 설계한다.
 *   본사       : 매출이 매달 늘지만 재료비율이 빠르게 올라 이익률이 떨어진다. 11월 긴급 물류비로 적자
 *   폴란드법인 : 매출이 줄지만 판촉비를 크게 줄여 이익률이 오른다
 *
 * 실행: node scripts/make-sample.js
 * 결과: sample/sample_rawdata.csv · sample/sample_rawdata.xlsx · js/sample-data.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const XLSX = require('../vendor/xlsx.full.min.js');

const ROOT = path.join(__dirname, '..');
const YEAR = 2023;

// 시드 고정 난수 (mulberry32)
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20230101);
const jitter = (pct) => 1 + (rand() * 2 - 1) * pct;

/** 월 합계를 n개 전표로 나눈다 (합계는 원 단위까지 보존) */
function split(total, n) {
  const w = Array.from({ length: n }, () => 0.5 + rand());
  const sum = w.reduce((a, b) => a + b, 0);
  const parts = w.map((x) => Math.round((total * x) / sum));
  parts[n - 1] += Math.round(total) - parts.reduce((a, b) => a + b, 0);
  return parts;
}

function days(n) {
  const set = new Set();
  while (set.size < n) set.add(1 + Math.floor(rand() * 28));
  return [...set].sort((a, b) => a - b);
}

// 월별 계정 금액 설계 (m = 1..12)
const PLAN = {
  본사: (m) => {
    const revenue = 105e6 * Math.pow(1.035, m - 1) * jitter(0.03);
    return {
      매출액: { 매출액: revenue },
      매출원가: {
        제조인건비: revenue * 0.095 * jitter(0.05),
        재료비: revenue * (0.34 + 0.022 * (m - 1)) * jitter(0.02),
        제조경비: revenue * 0.085 * jitter(0.05)
      },
      판매관리비: {
        인건비: 8.0e6 * jitter(0.05),
        판촉비: 7.0e6 * jitter(0.08),
        감가상각비: 6.5e6 * jitter(0.02),
        물류비: (6.0e6 + (m === 11 ? 15.0e6 : 0)) * jitter(0.06), // 11월 긴급 항공 운송
        기타판관비: 5.5e6 * jitter(0.08)
      },
      영외수지: { 영업외수익: 3.6e6 * jitter(0.3), 영업외손실: 3.9e6 * jitter(0.3) }
    };
  },
  폴란드법인: (m) => {
    const revenue = 135e6 * Math.pow(0.985, m - 1) * jitter(0.03);
    return {
      매출액: { 매출액: revenue },
      매출원가: {
        제조인건비: revenue * 0.10 * jitter(0.05),
        재료비: revenue * (0.11 + 0.001 * (m - 1)) * jitter(0.04),
        제조경비: revenue * 0.10 * jitter(0.05)
      },
      판매관리비: {
        인건비: 6.5e6 * jitter(0.05),
        판촉비: Math.max(0.6e6, 11.0e6 - 0.95e6 * (m - 1)) * jitter(0.05),
        감가상각비: 7.0e6 * jitter(0.02),
        물류비: 7.5e6 * jitter(0.06),
        기타판관비: 6.0e6 * jitter(0.08)
      },
      영외수지: { 영업외수익: 3.3e6 * jitter(0.3), 영업외손실: 3.6e6 * jitter(0.3) }
    };
  }
};
// 한 계정의 월 전표 수: 매출 10 · 나머지 4 → 회사당 월 50행 (원본과 같다)
const ROWS = { 매출액: 10, 매출원가: 4, 판매관리비: 4, 영외수지: 4 };
const BLOCK = { 매출액: 1, 매출원가: 2, 판매관리비: 3, 영외수지: 4 };

const header = ['손익계산 ID', '거래일시', '년도', '월', '일', '전표번호', '대분류 코드', '중분류 코드', '소분류 코드', '회사명', '금액'];
const rows = [];
let id = 0;
for (const company of Object.keys(PLAN)) {
  for (let m = 1; m <= 12; m++) {
    const plan = PLAN[company](m);
    let seq = 0;
    for (const major of Object.keys(plan)) {
      for (const minor of Object.keys(plan[major])) {
        const n = ROWS[major];
        const amounts = split(plan[major][minor], n);
        const ds = days(n);
        for (let i = 0; i < n; i++) {
          id++; seq++;
          const d = ds[i];
          const date = YEAR * 10000 + m * 100 + d;
          const voucher = String(YEAR % 100) + String(m).padStart(2, '0') + BLOCK[major] + String(seq).padStart(3, '0');
          rows.push([id, date, YEAR, m + '월', d + '일', voucher, major, minor, minor, company, amounts[i]]);
        }
      }
    }
  }
}

// CSV (엑셀에서 한글이 깨지지 않도록 UTF-8 BOM)
const csvCell = (v) => (/[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
const csv = [header].concat(rows).map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
fs.mkdirSync(path.join(ROOT, 'sample'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'sample/sample_rawdata.csv'), '﻿' + csv);

// xlsx: 원본처럼 표로 두되, 맨 위에 제목 행을 넣어 헤더 자동 탐지를 시연한다
const aoa = [['손익계산서 Raw data · 가상 샘플 (교육용, 실제 과제 데이터가 아닙니다)'], []].concat([header], rows);
const ws = XLSX.utils.aoa_to_sheet(aoa);
for (let r = 4; r <= aoa.length; r++) { const c = ws['K' + r]; if (c) c.z = '#,##0'; }
ws['!cols'] = [8, 10, 6, 5, 5, 10, 11, 11, 11, 11, 13].map((w) => ({ wch: w + 2 }));
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, '손익계산서_Raw data');
fs.writeFileSync(path.join(ROOT, 'sample/sample_rawdata.xlsx'), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }));

// 브라우저용: file:// 로 열어도 fetch 없이 샘플을 읽도록 스크립트로 싣는다
const js = '/* 자동 생성 파일: node scripts/make-sample.js · 가상 샘플 데이터 (교육용) */\n' +
  'window.PNL_SAMPLE = ' + JSON.stringify({ fileName: 'sample_rawdata.csv', csv: csv }) + ';\n';
fs.writeFileSync(path.join(ROOT, 'js/sample-data.js'), js);

console.log('rows', rows.length, '→ sample/sample_rawdata.csv · sample/sample_rawdata.xlsx · js/sample-data.js');
