# 웅덩이 트레이더 — 제작 가이드 (작업 순서 포함)

> 대상: 이 앱을 처음부터 다시 만들거나 이어서 유지보수할 팀원
> 한 줄 요약: **두 유튜브 채널의 매매 관점을 숫자 규칙으로 만들고, 과거 데이터로 검증·자동 보정하며, 모바일 PWA로 GitHub Pages(무료)에 배포해 PC 없이 운영**하는 앱.
> 이 문서에는 개인정보·계정명·키가 없습니다. 필요한 값은 `<...>` 자리표시자로 표기했습니다.

---

## 1. 결과물 한눈에 보기

| 구성 | 설명 |
|---|---|
| 3관점 | 웅덩이(채널A: 하락 구간 분할매수), 도키(채널B: 적정가·저점 매집), 통합(두 관점 합의) |
| 오늘 탭 | 시장 온도, 오늘의 행동 카드(차수·권장 금액), 신호 변화, 새 영상, 종목 언급 |
| 종목 탭 | 차트(과거 신호 마커), 신호 체크리스트, 이 종목 과거 성과, 자동 적정가, 거물 거래 |
| 거물 탭 | 내부자(Form 4)·13F 펀드·의원 공시 + 규칙 기반 신호 점수 |
| 검증 탭 | 기준선 대비 승률, 단계별 승률, 표본 외, 중립 ETF, 시뮬레이션, 자동 보정 현황, 실전 추적 |
| 내 계좌 | 현금·보유 입력(기기 내 저장), 한도·스트레스 테스트, 매매 기록 |
| 자동 운영 | 시세 5분/ 거물·영상 30분 / 하루 1회 전체, 장중 10초 실시간(선택), 자동 재검증·보정 |

---

## 2. 아키텍처

```
[휴대폰 PWA]  ──(읽기)──►  GitHub Pages (정적 사이트: 앱 + data/*.json)
   │  ▲                         ▲
   │  │ 실시간(선택, 10초)       │ 배포(5분/30분 주기)
   │  └──► Cloudflare Worker ──► 야후 차트(시세)
   │            (종목 코드만 전달, 개인정보 없음)
   │
   └─ 개인 데이터(보유·현금·기록)는 기기 안(localStorage/IndexedDB)에만 저장

GitHub Actions (서버 역할, 무료)
  ├─ tools/update_data.py       시세·재무 → data/px, fund.json, manifest.json
  ├─ tools/tracker_collect.py   SEC·13F·하원 → data/tracker/*.json
  ├─ tools/youtube_update.py    새 영상(RSS) → data/knowledge.json
  └─ tools/privacy_check.py     배포 전 개인정보·비밀 검사(실패 시 배포 중단)
비밀 값(SEC 연락처 UA, 선택: FMP 키)은 저장소 Secrets 에만 존재
```

설계 원칙
1. **정적 + 자동 수집**: 서버/DB 없이 JSON 파일을 주기적으로 다시 만들어 배포 → PC·Claude 없이 유지.
2. **라이브 = 백테스트**: 점수 계산 코드(`engine.js`)를 하나로 공유 → 추천과 검증이 어긋나지 않음.
3. **마지막 정상값 유지**: 어떤 경로가 막혀도 화면은 비지 않고 상태 칩으로 신선도 표시.
4. **정직한 검증**: 기준선 비교·표본 외·중립 유니버스. 결과가 나쁘면 앱 동작에 반영.

---

## 3. 준비물 (모두 무료)

| 항목 | 용도 | 비고 |
|---|---|---|
| Claude Code | 개발 도구 | 팀 계정 사용 |
| GitHub 계정 | 저장소·Pages·Actions | **공개 저장소**(무료 한도 넉넉) |
| Cloudflare 계정 | 실시간 시세 워커 | 무료 플랜(요청 하루 10만) · 카드 불필요 |
| Python 3.11+ | 수집·검증 스크립트 | 표준 라이브러리 + `yt-dlp` |
| Git, GitHub CLI(gh), Node.js | 배포 도구 | `winget install Git.Git GitHub.cli OpenJS.NodeJS.LTS` |
| (선택) FMP 무료 키 | 의원 거래 상세 | 없어도 하원 공식 색인으로 동작 |

> 계정 가입·로그인·승인은 **사람이** 합니다(자동화 불가). Claude Code는 승인 코드/링크를 안내하고 기다립니다.

---

## 4. 작업 순서 (Phase별)

각 단계의 상세 프롬프트는 `01_PROMPTS.md`의 같은 번호를 사용하세요.

### Phase 0 — 환경 준비 (0.5시간)
1. 폴더 생성(동기화 폴더 안 권장 X: 자막 원본은 용량 큼 → 별도 데이터 폴더).
2. Python 설치 확인, `pip install yt-dlp`.
3. 공통 규칙(프롬프트 0번)을 Claude Code 첫 메시지로.

### Phase 1 — 조사: 영상 목록·자막 수집 (1~3시간, 대부분 대기)
- `tools/collect_subs.py <저장폴더> 4`: 영상·라이브·쇼츠 목록 → 자막(ko) → 텍스트 정리 → 메타 저장.
- 이어받기(이미 받은 것 건너뜀) + 제한 감지 시 5분 대기 후 자동 재개.
- 약 2,600개 영상 기준: 한 번에 1,000개 전후 받고 제한 → 대기 반복, **총 1~2시간**.
- 확인: `meta` 파일 수 = 전체 영상 수, `txt` 파일 수 = 자막 확보 수.
- 팁: 자막은 **정독하지 말고** 키워드·문장 추출로 원칙을 뽑고, 근거 영상 ID를 같이 저장.

### Phase 2 — 엔진(`engine.js`) (반나절)
1. 지표: SMA/EMA/RSI(와일더)/MACD, 주봉(진행 중 주는 현재가로 갱신, 완료 주만 확정) RSI·200주선, 52주 낙폭(롤링 최대).
2. 시장 컨텍스트(`buildMarket`): VIX, VIX3M, 자체 공포지수(VIX 백분위+SPY 낙폭+RSI+125일선), 시장 폭(섹터 ETF 11개 중 -10%↓ 비율), (v2) CNN식 6요소.
3. 신호 강도 0~1: 낙폭(환산 -10/-20/-30% → .48/.8/1), 200일 이격, 주봉 RSI(30/35/45), 일봉 RSI, MACD(10거래일 내), 200주선 근접, 추세 돌파, VIX(25/30/40), 공포지수, 시장 폭, VIX 역전, 계절성, 상승 추세, 200일선 지지.
4. 점수: 렌즈별 가중 합산(웅덩이는 최대 만점 합 초과 시 100 상한, 도키는 가용 항목 기준 정규화), 감점(과열/고점 근처/과도 이격/구조적 약세/고평가).
5. 차수: 점수 ≥ 임계값(기본 웅덩이 40/55/70, 도키 35/50/65, 통합 45/60/75)로 1·2·3차, 제약(3배 레버리지 2차, 약세·고평가 1차).
6. 확인: 임의 과거 날짜로 점수를 계산해 라이브 계산과 같은 코드 경로인지 확인.

### Phase 3 — 검증·자동 보정(`bt-worker.js`, `engine.js`) (반나절~1일)
- 이벤트 연구(`events`/`summarize`): 차수별 최초 신호일, 20/60/120/250일 수익, MAE, 기준선(같은 종목 구성 가중).
- 시뮬레이션(`simulate`): 다음 거래일 종가 체결, 초기 50% + 추가 매수, `trim` on/off 비교.
- 신호별 효과(`signalEdge`): 켜짐 vs 꺼짐의 60일(기초환산) 수익, z값.
- 보정(`calibrate`): 70/30 분할, 가중치 0.4~1.6, 임계값 격자(1차 30~65, 2차 +5~+30, 3차 +5~+30), 채택 조건(학습 외 구간에서 기본값 이상), 채택 시 기본값 쪽 50% 수축.
- 후보 자동 선택: 공포지수 v1/v2(z 비교), 익절 규칙 유무(칼마 비교, 5% 이상 우수할 때만 변경).
- 중립 유니버스: 지수·섹터 ETF 13개, 기본 파라미터, 보정 없음.
- 엔진 버전(`E.VERSION`)을 올리면 앱이 저장된 검증 결과를 자동 재생성.
- **여기서 나온 결과를 반드시 읽고 보고**(§8 참고).

### Phase 4 — 데이터 파이프라인 (반나절)
- `tools/update_data.py`: 전체 이력(`period1=0&interval=1d`) 또는 최근 1개월 병합, 실패 종목은 기존 유지, `manifest.json`·`fund.json`.
  - 주의: `range=max` 는 월봉으로 내려오므로 일봉이 필요하면 `period1=0` 사용.
- `server.py`(개발용): 정적 서버 + 백그라운드 갱신 + `/api/chart`, `/api/batch`, `/api/refresh`, `/api/status`.
- `worker/proxy.js`: 같은 API(`/api/batch`)를 Cloudflare Worker로.
- 앱의 수집 우선순위: data/ → 프록시 → 직접 → IndexedDB 저장본. 신선도 규칙(장중/종가, 기대 봉 날짜 대비 지연).

### Phase 5 — 모바일 UI (1일)
- 파일: `index.html`, `styles.css`, `app.js`, `sw.js`, `manifest.webmanifest`, 아이콘 3종.
- 구현 순서: 저장소(IndexedDB 래퍼) → 수집/갱신 루프 → 오늘 → 종목(차트) → 검증 → 내 계좌 → 설정.
- 체크: 375px에서 가로 스크롤 0, 입력 중 재렌더로 입력이 사라지지 않음, 다크모드, 오프라인 열림.

### Phase 6 — 거물 거래 통합 (반나절~1일)
- `tools/tracker_collect.py`: 인물/펀드 목록(공개 인물·기관 CIK) → Form 4 파싱(공개시장 매수/매도, 10b5-1 계획, 직책, 보유 변화), 13F 포지션 diff, 하원 색인, FMP(선택), 회사 공시, OpenFIGI.
- 비밀은 `SEC_USER_AGENT`(연락처 포함 식별 문자열)·`FMP_API_KEY` 환경변수.
- SEC 접근 제한이면 즉시 중단·이전 데이터 유지(§9).
- 앱: 거물 탭 4개 서브탭, 거래 상세 시트(점수 근거), 종목 상세 카드. 점수는 참고용(검증 불가) 명시.
- 시작 데이터: 기존 도구의 수집 결과를 JSON으로 옮겨 오되 **키·설정 파일은 옮기지 않는다**.

### Phase 7 — 영상 지식 자동 반영 (반나절)
- `tools/build_knowledge.py <자막폴더>`: 신호 강조도, 종목 언급, 최근 120일 영상별 분석, 영상 목록.
- `tools/youtube_update.py`: RSS(채널 ID 필요) → 새 영상 → 자막/제목 분석 → 병합(배포본·저장소 중 최신 기준).
- 수동 입력: 워크플로 `video` 입력칸(주소/ID).

### Phase 8 — 배포 (1~2시간, 로그인 대기 포함)
1. `git init -b main`, 로컬 커밋 사용자는 **noreply 주소**로 설정(개인 이메일 노출 방지).
2. `tools/privacy_check.py` 통과 확인 → 커밋.
3. `gh auth login` (사람이 브라우저에서 코드 승인) → `gh repo create <저장소> --public --source . --push`.
4. Secrets: `SEC_USER_AGENT`(연락처 문자열)만 필수. 값은 파이프로 입력해 터미널/채팅에 출력하지 않는다.
5. Pages 활성화: `gh api -X POST repos/<계정>/<저장소>/pages -f build_type=workflow`.
6. 워크플로 실행: `gh workflow run update-data.yml`, 성공 확인.
7. Cloudflare: `npx wrangler login`(사람 승인) → workers.dev 서브도메인 등록(무작위 이름 권장, 개인 식별 이름 금지) → `npx wrangler deploy` → 주소를 `data/live.json` 에 기록 → 재배포.
8. 새 workers.dev 주소는 TLS 인증서가 몇 분 뒤 활성화된다(초기 handshake 실패는 정상).

### Phase 9 — 문서화 (2시간)
- `guide.html`(앱에 포함), `README.md`. 한계·면책 명시.

### Phase 10 — 최종 점검 (1시간)
- 프롬프트 10번 체크리스트. 모바일 에뮬레이션 + 실제 휴대폰에서 홈 화면 설치.

**총 예상: 집중 작업 약 3~4일(수집 대기시간 제외 시), 팀 2명이면 1.5~2일**

---

## 5. 파일 구조

```
index.html  styles.css  app.js  engine.js  bt-worker.js  sw.js  guide.html
manifest.webmanifest  icon.svg  icon-192.png  icon-512.png  knowledge.js
data/        universe.json  live.json  manifest.json  fund.json  knowledge.json
             px/<심볼>.json   tracker/{trades,f13,co,cusip,state,status}.json
tools/       update_data.py  tracker_collect.py  youtube_update.py  build_knowledge.py
             collect_subs.py  privacy_check.py  update_knowledge.bat  sync_knowledge.bat  install_auto_task.bat
worker/      proxy.js  wrangler.toml
.github/workflows/update-data.yml
server.py  run.bat  README.md  .gitignore
```

---

## 6. 데이터 스키마(요약)

- `data/px/<SYM>.json`: `{s, d:[YYYY-MM-DD], c:[종가], t:갱신초, mt:시장시각}`
- `data/manifest.json`: `{updated, symbols:{SYM:{n,last,t}}, fails:[]}`
- `data/fund.json`: `{SYM:{cfps,g,cagr,mult,r,years,fair,asof,t}}`
- `data/tracker/trades.json`: 거래 `{id,source(form4|13f|ptr|congress),person,role,ticker,issuer,trade_date,filed_at,code,side,shares,price,value,owned_after,planned,url,extra}`
- `data/tracker/f13.json`: `{fundKey:{period,filed,total,count,rows[],top_holdings[]}}`
- `data/knowledge.json`: `{built,channels,signals,stance,videos:[[id,ch,date,title]],recent:[{id,ch,date,title,sub,t:{SYM:[언급,우호,경계]}}]}`

---

## 7. 핵심 설계 결정과 이유

| 결정 | 이유 |
|---|---|
| 정적 사이트 + Actions | 무료·PC 불필요·유지 단순. 서버/DB 불필요 |
| 점수 엔진 공유 | 검증과 실전 일치, 코드 중복 제거 |
| 룩어헤드 금지(주봉 진행 주 처리 등) | 백테스트 과대평가 방지 |
| 다음 거래일 종가 체결 | 같은 봉 체결 편향 제거 |
| 기준선 + 표본 외 + 중립 ETF | 상승 종목 위주 표본의 착시 보정 |
| 자체 공포지수 | 원본 지수 사이트가 봇 차단 → 가격으로 재현하고 효과 비교 후 선택 |
| 수동 입력 제거 | 검증 불가·영향 미미 → 자동 지표로 대체 |
| 거물 거래는 점수 미반영 | 공시 이력이 짧아 검증 불가 → 참고 정보로만 |
| 개인 데이터는 기기 내 저장 | 개인정보 서버 전송 없음 |

---

## 8. 검증에서 나온 결과(재현 시 비슷하게 나와야 정상)

> 수치는 데이터 시점에 따라 달라질 수 있습니다. 경향이 같은지를 확인하세요.

- 신호 후 **60일 상승 확률**: 신호 약 70% vs 아무 날 매수 약 64~65% (+5%p 안팎). 신호가 겹칠수록(1→3차) 상승 확률 증가(예: 웅덩이 66→72→77%).
- **120일 이상**: 신호 효과 거의 없음(기준선과 동급 또는 낮음) → 1~3개월 단기 신호.
- 내 종목군(상승 종목 위주) 표본 외: 신호 70~72% vs 기준선 65%.
- **매매 시뮬레이션**: 단순 보유와 연수익률 동급(약 24%), 최대낙폭만 소폭 개선 → 수익을 키우는 마법은 없음.
- **익절·감량 규칙은 손해**(칼마 0.17 vs 0.31) → 앱은 과열 시 "신규 매수만 중단".
- 신호별: VIX·공포지수·시장 폭·계절성·낙폭이 유의, 200일 이격·RSI·MACD는 약함. 과열(과도 이격) 감점은 오히려 모멘텀과 겹쳐 가중치가 낮아짐.
- 공포지수: 단순 4요소(v1)가 CNN식 6요소 재현(v2)보다 예측력이 높아 v1 채택(자동 선택).
- 거래 신호(거물 거래)는 검증 불가.

---

## 9. 접근 제한·정책 이슈와 대응 (중요)

| 이슈 | 증상 | 대응 |
|---|---|---|
| SEC 403/429 | 내부자·13F 수집 실패 | 우회 금지. 즉시 중단, 마지막 데이터 유지, 상태 표시, 30분 후 재시도. 연락처 UA 형식 확인. 계속되면 대체 수단 논의 |
| 데이터센터 IP 차단 | GitHub 서버에서만 실패 | 로컬 PC에서 수집 후 push 하는 보조 경로를 *사용자가 직접* 실행 |
| 유튜브 요청 제한 | 자막 수집 중단 | 5분 대기 자동 재개, 서버는 제목 분석 대체 |
| 봇 차단 사이트(예: 공포탐욕 지수) | HTTP 418 | 사용 금지 → 가격 기반 자체 지표 |
| 상시 실행 예약 작업 | 자동 승인 정책 거부 | 설치 파일만 제공(`install_auto_task.bat`), 사용자가 직접 실행 |
| Pages 배포 충돌 | "in progress deployment" 실패 | 다시 실행(concurrency 설정 유지) |
| 새 workers.dev 주소 | TLS handshake 실패 | 몇 분 후 재시도 |

---

## 10. 개인정보·보안 체크리스트 (배포 전·팀 공유 전 필수)

- [ ] 코드·문서·데이터에 이메일, API 키, 토큰, 로컬 경로(`C:\Users\...`), 계정명이 없다 → `python tools/privacy_check.py` 통과
- [ ] 커밋 작성자 이메일은 noreply 주소
- [ ] `.gitignore`에 `config.json`, `.env`, `*.db`, `.wrangler/`, `node_modules/`
- [ ] 비밀은 GitHub Secrets에만(예: `SEC_USER_AGENT`). 채팅·스크린샷에 키가 노출됐으면 **재발급**
- [ ] 사용자 보유·현금·기록은 서버/저장소에 올라가지 않는다(기기 내 저장)
- [ ] Cloudflare 워커는 종목 코드만 받는다(개인정보 없음). workers.dev 이름은 개인 식별 이름 금지
- [ ] 자막 원본·개인 폴더는 저장소 밖에 둔다
- [ ] 팀 문서에는 자리표시자(`<계정>`, `<저장소>`)만 사용

---

## 11. 유지보수·운영

- **일상**: 아무것도 안 해도 자동. 상단 칩이 초록이면 정상.
- **60일 규칙**: 저장소 활동이 60일 없으면 예약 실행이 멈출 수 있음 → Actions 탭에서 다시 켜기.
- **엔진 수정 후**: `E.VERSION` 올리기 → 앱이 자동 재검증.
- **종목 추가**: `data/universe.json`의 `watch`에 추가(기본 목록), 개인 추가는 앱의 ＋추가(최초 이력 수집).
- **새 영상 수동 분석**: GitHub 모바일 → Actions → Run workflow → 영상 주소 입력.
- **장애 확인 순서**: ① 상단 칩 ② 설정의 데이터 상태 ③ Actions 최근 실행 로그 ④ 거물 탭 SEC 상태.

---

## 12. 팀 역할 분담 제안

| 역할 | 담당 |
|---|---|
| 데이터/수집 | Phase 1·4·6·7 (스크립트, 접근 제한 대응) |
| 엔진/검증 | Phase 2·3 (신호·시뮬레이션·보정, 검증 리포트) |
| 프론트(모바일) | Phase 5·9 (UI·PWA·문서) |
| 배포/보안 | Phase 8·10 (GitHub/Cloudflare, 개인정보 점검) |

리뷰 포인트: 룩어헤드 여부, 기준선 비교 여부, 접근 제한 처리(우회 없음), 비밀 노출 여부.

---

## 13. 자주 하는 실수 (실제로 겪은 것)

1. Windows 기본 인코딩(cp949)으로 파일 저장 → 이모지 제목에서 크래시 → 모든 파일 입출력에 `encoding="utf8"`.
2. 장중 시세가 바뀌어도 캐시 키에 마지막 종가가 없어 신호가 안 바뀜 → 키에 종가·VIX 포함.
3. CSS grid 자식 `min-width:0` 누락 → 모바일 가로 넘침.
4. 폼 입력 중 백그라운드 갱신이 전체 재렌더 → 입력 손실 → 입력 중엔 상태 칩만 갱신.
5. 이전 배포본만 이어받아 최신 저장소 데이터를 덮어씀 → 두 소스 중 최신 기준 병합.
6. 개인 정보가 담긴 도구 캐시(`.wrangler/`)가 점검에 걸림 → `.gitignore` + 점검에서 제외 디렉터리 지정.
7. 야후 `range=max`가 월봉으로 내려옴 → `period1=0`.
8. 검증 함수 시그니처(인자 순서) 실수로 표본 외 결과가 0건 → 단위 테스트(작은 샘플)로 먼저 확인.
