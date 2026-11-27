# 디벨롭 (모바일 우선 PWA)

추세·가치 신호를 숫자 규칙으로 만든 매매 참고 도구입니다. 과거 데이터로 검증하며, 거물 공시와 포지션·수급 자료를 참고 정보로 보여 줍니다.
**사용 설명서: `guide.html`** (앱 설정에서도 열림). 개발 지침은 `CLAUDE.md`.

## 운영 (무료)
- GitHub Pages + GitHub Actions(자동 수집·배포) + Cloudflare Worker(실시간 시세). 개인 보유·기록은 휴대폰에만 저장.
- GitHub Secrets: `SEC_USER_AGENT`, (선택) `FMP_API_KEY`
- PC 예약 수집(선택): `tools/sec_setup.bat` 로 연락처 등록 → `tools/install_sec_task.bat`

## PC에서
`run.bat` (http://localhost:8777). 휴대폰 테스트는 `python server.py 8777 --lan`. 로컬 서버는 앱 파일과 `data/*.json` 만 내줍니다.
