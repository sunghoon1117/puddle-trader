# 웅덩이 트레이더 (모바일 우선 PWA) — 통합판

3관점(웅덩이·도키·통합) 매매 기준 + 자동 검증·보정 + 거물 거래(내부자·13F·의원) 공시 추적.
**사용 설명서: `guide.html`** (앱 설정 탭에서도 열림).

## 휴대폰만으로 운영 (무료, 개인정보 비노출)
1. GitHub 무료 계정 → 새 **공개** 저장소 → 이 폴더 전체(`.github` 포함) 업로드 (최초 1회, PC 권장)
2. Settings → Pages → Source: **GitHub Actions**
3. Settings → Secrets → `SEC_USER_AGENT`(예: `MyApp 이름 이메일`), (선택) `FMP_API_KEY`
4. Actions → “자동 갱신 + 배포” → Run workflow → `https://계정.github.io/저장소/` 를 휴대폰에서 열고 홈 화면에 추가

자동 실행: 시세 5분마다(미국 장중), 거물 거래 30분마다. 개인 보유·기록은 휴대폰에만 저장. 배포 때마다 `tools/privacy_check.py` 가 비밀/개인정보 혼입을 검사합니다.

## 더 실시간 (선택, 무료): `worker/proxy.js` 를 Cloudflare Workers 에 배포 → 앱 설정의 프록시 주소에 입력 → 장중 20초 갱신.

## PC에서: `run.bat` (http://localhost:8777). 서버가 시세를 자동 갱신.

## 영상 지식: `tools\update_knowledge.bat` (이어받기·제한 시 자동 재개).

## 구조
`engine.js` 공용 엔진(라이브=백테스트) · `bt-worker.js` 검증/자동 보정 · `app.js` UI · `tools/update_data.py` 시세·재무 · `tools/tracker_collect.py` 거물 거래 · `tools/collect_subs.py`,`build_knowledge.py` 영상 지식
