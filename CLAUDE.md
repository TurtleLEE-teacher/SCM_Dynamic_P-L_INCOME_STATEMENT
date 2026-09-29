# SCM_Dynamic_P-L_INCOME_STATEMENT

SCM 부트캠프 3차 과제의 Raw data(엑셀·CSV)를 올리면 손익계산서·대시보드·인사이트를 만드는 정적 웹사이트다.
빌드 도구가 없다. `index.html` 과 `js/` 의 classic script 가 전부이고, 계산 모듈은 UMD 라 node 테스트와 코드를 같이 쓴다.

## 반드시 지킬 것

1. **과제 원본 데이터와 그 집계값(정답)을 커밋하지 않는다.** 이 저장소는 공개이고 다음 기수도 같은 과제를 받는다.
   - 원본으로 검증할 때는 scratchpad 같은 저장소 밖 경로에서만 다룬다
   - 문서·테스트·커밋 메시지·PR 본문에도 원본의 합계·이익률 숫자를 적지 않는다
   - 샘플이 필요하면 `node scripts/make-sample.js` 의 가상 데이터를 쓴다
2. **PR 을 열기 전에 게이트를 로컬에서 돌린다.** 자동 병합 워크플로가 같은 검사를 한다.
   ```bash
   node --test tests/*.test.js
   node scripts/make-sample.js && git diff --exit-code -- sample js/sample-data.js
   ```
3. **샘플을 바꾸면 생성기를 고친다.** `sample/` 과 `js/sample-data.js` 를 손으로 고치지 않는다.

## 자동 병합

- 디렉터 지시(2026-09-29): 이 저장소의 PR 은 사람 클릭 없이 병합한다.
- `.github/workflows/auto-merge.yml` 이 같은 저장소의 `claude/` 브랜치 PR 을 게이트 통과 뒤 병합하고 Pages 배포를 띄운다.
- `.github/workflows/` 를 고치는 PR 은 워크플로 토큰으로 병합할 수 없다. CI 통과를 확인한 뒤 PR 을 만든 세션이 병합한다.
- 막고 싶은 PR 에는 `hold` 라벨을 붙인다.

## 배포

- `.github/workflows/pages.yml` 이 저장소 루트를 GitHub Pages 에 올린다.
- 주소: `https://turtlelee-teacher.github.io/SCM_Dynamic_P-L_INCOME_STATEMENT/`
- 저장소 Settings → Pages → Source 가 **GitHub Actions** 여야 한다. 이 설정은 디렉터가 한다.

## 구조

| 파일 | 역할 |
|---|---|
| `js/parser.js` | 파일 읽기 · 헤더 자동 탐지 · Raw data 정비 · 점검 리포트 |
| `js/pnl.js` | 손익 계산 엔진 (SUMIFS 대체), 과제 양식 20행 |
| `js/insights.js` | 규칙 기반 인사이트 9개 |
| `js/export.js` | SUMIFS 수식이 살아 있는 엑셀 내보내기 |
| `js/charts.js` · `js/app.js` · `css/style.css` | 화면 (KPMG 톤: 무채색 + #062F87 강조, Pretendard) |
| `vendor/` | SheetJS 0.20.3 · Chart.js 4.5.1 · datalabels 2.2.0 (오프라인 동작용으로 커밋) |

화면을 바꿨으면 브라우저로 5개 탭 × 관점 × 1440px·390px 을 찍어 라벨 잘림·겹침·가로 넘침을 확인한다.
