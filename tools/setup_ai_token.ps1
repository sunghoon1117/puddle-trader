# GitHub 서버(Actions)가 워커의 Gemini 영상 분석을 안전하게 호출할 수 있도록 '전용 토큰'을 만들어
# ① Cloudflare 워커 비밀 값(AI_TOKEN) ② GitHub 저장소 비밀 값(AI_TOKEN) 에 같은 값으로 등록합니다.
# 토큰 값은 화면에 출력되지 않습니다. 한 번만 실행하면 됩니다.
#   실행:  powershell -ExecutionPolicy Bypass -File tools\setup_ai_token.ps1
$ErrorActionPreference = 'Stop'
$env:Path += ';C:\Program Files\nodejs;C:\Program Files\GitHub CLI;C:\Program Files\Git\cmd'
$root = Split-Path -Parent $PSScriptRoot
$token = python -c "import secrets;print(secrets.token_urlsafe(32),end='')"
Push-Location "$root\worker"
try {
  # 워커 비밀 값 (표준입력으로 전달)
  $token | npx --yes wrangler@latest secret put AI_TOKEN
} finally { Pop-Location }
# GitHub 비밀 값
gh secret set AI_TOKEN --body $token
Write-Host "완료: AI_TOKEN 이 워커와 GitHub 에 등록되었습니다."
