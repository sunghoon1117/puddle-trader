"""배포·푸시 전 개인정보·비밀 점검. 배포물과 git 에 올라갈 파일에 이메일, 키 형태, 로컬 경로·사용자명, 키·설정 파일이 있으면 실패(exit 1).
  python tools/privacy_check.py
"""
import os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEPLOY = ["index.html", "guide.html", "styles.css", "app.js", "detail.js", "weekend.js", "positions.js", "engine.js", "bt-worker.js", "sw.js", "manifest.webmanifest", "icon.svg", "data", "worker", "README.md"]
BAD_FILES = re.compile(r"((^|[\\/])(config\.json|\.env(\.[^\\/]*)?|\.dev\.vars|tracker\.db|credentials[^\\/]*\.json|[^\\/]*service[-_]account[^\\/]*\.json)|\.(pem|key|p12|pfx|bak))$", re.I)
# 로컬 경로 + 이 PC 의 사용자명(고정 문자열 대신 실행 시점에 읽어 저장소에 개인 식별 문자열이 남지 않게 함). 배포 서버의 계정 이름은 흔한 낱말이라 제외
USER = "" if os.environ.get("GITHUB_ACTIONS") else (os.environ.get("USERNAME") or os.environ.get("USER") or "")
PATTERNS = {
    "이메일": re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"),
    "Anthropic/OpenAI 키": re.compile(r"sk-[A-Za-z0-9_-]{20,}"),
    "apikey 쿼리": re.compile(r"apikey=[A-Za-z0-9]{8,}", re.I),
    "로컬 경로/사용자명": re.compile(r"C:\\Users\\|/Users/[a-z]" + ("|" + re.escape(USER) if len(USER) >= 3 else ""), re.I),
    "Google API 키": re.compile(r"AIza[0-9A-Za-z_-]{30,}|\bAQ\.[0-9A-Za-z_-]{30,}"),
    "GitHub 토큰": re.compile(r"gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}"),
    "AWS 키": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "개인 키": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
}
ALLOW_EMAIL = re.compile(r"(@example\.(com|org|net)$|^noreply@|@users\.noreply\.github\.com)")


SKIP_DIRS = {".wrangler", "node_modules", "__pycache__", ".git"}   # 로컬 전용(git 제외) 캐시


def tracked():
    """git 이 이미 추적하거나 `git add -A` 로 올라갈 파일(무시 목록 제외)"""
    try:
        r = subprocess.run(["git", "-C", ROOT, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], capture_output=True, timeout=60)
        return [os.path.join(ROOT, p) for p in r.stdout.decode("utf8", "replace").split("\0") if p] if r.returncode == 0 else []
    except Exception:
        return []


def deployed():
    for p in DEPLOY:
        full = os.path.join(ROOT, p)
        if os.path.isfile(full):
            yield full
        elif os.path.isdir(full):
            for d, dirs, fs in os.walk(full):
                dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
                for f in fs:
                    yield os.path.join(d, f)


def files():
    seen = set()
    for f in list(deployed()) + tracked():
        k = os.path.normcase(os.path.normpath(f))
        if k not in seen and os.path.isfile(f):
            seen.add(k)
            yield f


bad = []
for f in files():
    rel = os.path.relpath(f, ROOT)
    if BAD_FILES.search(f):
        bad.append((rel, "비밀/DB 파일")); continue
    if os.path.getsize(f) > 8_000_000 or not re.search(r"(\.(js|json|html|css|md|py|svg|webmanifest|txt|toml|yml|yaml|bat|ps1|sh)|\.gitignore)$", f):
        continue
    txt = open(f, encoding="utf8", errors="ignore").read()
    for name, rx in PATTERNS.items():
        for m in rx.findall(txt):
            if name == "이메일" and ALLOW_EMAIL.search(m):
                continue
            if name == "로컬 경로/사용자명" and rel.startswith("tools") :
                continue
            bad.append((rel, f"{name}: {m[:30]}"))
if bad:
    print("개인정보/비밀 의심 항목 — 배포 중단")
    for r, w in bad[:30]:
        print(" -", r, w)
    sys.exit(1)
print("개인정보 점검 통과: 이메일·키·로컬 경로·비밀 파일 없음")
