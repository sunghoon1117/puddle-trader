# 디벨롭 (puddle-trader) — Claude Code 작업 지침

두 유튜브 채널(developmong / doki_investing)의 매매 관점을 숫자 규칙으로 만든 **모바일 우선 PWA**. 정적 사이트(GitHub Pages) + 자동 수집(GitHub Actions) + 실시간·AI 프록시(Cloudflare Worker). 서버·DB 없음. 사용자 개인 데이터(보유·현금·기록)는 **기기 안에만** 저장된다.
상세 인수인계 문서는 저장소 밖 `puddle-trader-handoff/` 에 있을 수 있다(없으면 이 파일과 README.md 를 기준으로 한다).

## 파일 지도
| 경로 | 역할 |
|---|---|
| `engine.js` | **공용 엔진**: 지표·신호·3관점 점수·차수·이벤트연구·시뮬레이션·자동 보정·시장 국면(`E.regime`). 브라우저와 Web Worker 양쪽에서 실행. 라이브 추천과 백테스트가 같은 코드를 쓴다 |
| `bt-worker.js` | 백그라운드 검증·자동 보정(기준선 비교, 표본 외, 중립 ETF, 점수 신뢰도 곡선, 한국 종목, 국면 과거 검증) |
| `app.js`, `styles.css`, `index.html`, `sw.js`, `manifest.webmanifest`, `guide.html` | 모바일 우선 UI(오늘·종목·시장·거물·내 계좌, 헤더의 ✓검증 ⚙설정), 서비스 워커, 사용 설명서 |
| `worker/proxy.js`, `worker/wrangler.toml` | Cloudflare Worker: `/api/batch`(실시간 시세), `/api/chart`, `/api/ai`(Gemini 우선·무료 Workers AI 대체) |
| `tools/update_data.py` | 야후 시세·재무 → `data/px/*.json`, `fund.json`, `manifest.json` |
| `tools/tracker_collect.py` | SEC Form4·13F·하원 PTR·FMP 의원 거래 → `data/tracker/*.json` |
| `tools/macro_collect.py`, `calendar_collect.py` | 재무부·FRED 거시, 연준·BLS 공식 일정 |
| `tools/youtube_update.py`, `build_knowledge.py`, `collect_subs.py` | 채널 새 영상 분석(RSS→자막→Gemini 영상 분석) / 영상 지식 생성 |
| `tools/privacy_check.py` | 배포 전 이메일·키·경로 검사(실패 시 배포 중단) |
| `.github/workflows/update-data.yml` | 5분(시세)·30분(거물/일정/거시/영상)·일 1회 전체 수집 후 Pages 배포 |
| `data/universe.json`, `data/live.json` | 관심종목·시장 심볼 / 공개 워커 주소(비밀 아님) |

## 자주 쓰는 명령
```bash
python server.py 8777                      # 로컬 개발 서버(+백그라운드 시세 갱신) → http://localhost:8777
node --check app.js && node --check engine.js && node --check bt-worker.js && node --check worker/proxy.js   # 문법 검사(수정 후 필수)
python tools/privacy_check.py              # 개인정보·비밀 점검(배포 전 필수)
python tools/update_data.py --full         # 시세 전체 재수집
cd worker && npx wrangler deploy           # 워커 배포
gh workflow run update-data.yml            # 서버 갱신·배포 수동 실행
```
엔진 로직을 바꾸면 `engine.js`의 `E.VERSION` 을 올린다(앱이 저장된 검증 결과를 자동 재생성).

## 지켜야 할 규칙 (사용자와 합의된 것)
1. **정직한 검증**: 모든 규칙은 과거 데이터로 검증하고 '아무 날 매수' 기준선과 비교한다. 결과가 나쁘면 나쁘다고 보고하고 앱 동작에 반영한다(예: 익절 규칙은 손해 → 제외, 점수는 확률이 아님 → 신규 신호만 매수). 생존편향을 숨기지 않는다.
2. **룩어헤드 금지**: 지표는 해당 시점까지의 데이터만 사용(주봉 진행 주, 거시 데이터 발표 지연 반영).
3. **접근 제한 우회 금지**: 403/429/봇 차단/CAPTCHA 는 헤더 위장·IP 우회로 뚫지 않는다. 이전 데이터 유지 + 상태 표시 + 백오프(SEC 는 6시간 휴지).
4. **비밀·개인정보 비노출**: 키·토큰·이메일·로컬 경로를 코드·문서·채팅·공개 저장소에 쓰지 않는다. 비밀은 GitHub Secrets / Cloudflare 비밀 값에만. 계정 가입·로그인·결제는 사용자가 직접 한다. 자동 승인 정책이 비밀 저장소 쓰기·상시 예약 작업을 거부하면 우회하지 말고 사용자가 실행할 스크립트로 제공한다.
5. **무료만 사용**: 유료 API·유료 플랜 금지.
6. **모바일 우선**: 375px 기준, 가로 스크롤 없음, 입력 중 전체 재렌더 금지, 오프라인에서도 열림. 투자 권유·수익 보장 표현 금지.
7. 신호가 검증되지 않은 정보(거물 거래, 영상 분석, 시장 국면)는 **참고 정보**로만 표시하고 매수 점수에 넣지 않는다.

## 알려진 함정
- Windows 기본 인코딩(cp949): 파이썬 파일 입출력에 항상 `encoding="utf8"`.
- PowerShell 큰따옴표 문자열 안의 JS 템플릿(`` ` ``, `${}`)은 깨진다 → 코드 수정은 Edit/Write 도구 또는 파이썬 스크립트로. PowerShell 의 `R` 은 `Invoke-History` 별칭이다.
- 야후 `range=max` 는 월봉 → 일봉 전체는 `period1=0&interval=1d`.
- Gemini: 무료 키는 구글 검색 연동 불가(검색 없이 답하면 **옛 수치를 사실처럼** 말함) → 외부 최신 수치를 AI 에게 채우게 하지 않는다. 모델 이름은 목록에서 자동 선택. 워커는 `placement` 로 미국 실행(그렇지 않으면 "User location is not supported").
- 설치된 홈 화면 앱의 아이콘·이름은 설치 시점에 고정(삭제 후 재설치해야 변경).
- GitHub Pages 배포가 겹치면 "in progress deployment" 로 한 번 실패할 수 있음(재실행).

## 미해결 과제 (다음 개선 후보)
SEC 403(IP 제한, 우회 불가) · PMI/기업이익/한국 금통위 일정(무료 공식 데이터 없음) · 앱 종료 상태 푸시 알림(Web Push 서버 필요) · 한국 시장 고유 지표 기반 검증 · `tools/setup_ai_token.ps1` 실행(영상 직접 분석 활성화) 여부 확인.
