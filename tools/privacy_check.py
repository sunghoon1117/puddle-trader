"""배포 전 개인정보·비밀 점검. 이메일, API 키 형태, 로컬 경로·사용자명, config/db 파일이 배포물에 있으면 실패(exit 1).
  python tools/privacy_check.py
"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEPLOY = ["index.html", "guide.html", "styles.css", "app.js", "engine.js", "bt-worker.js", "knowledge.js", "sw.js", "manifest.webmanifest", "icon.svg", "data", "worker", "README.md"]
BAD_FILES = re.compile(r"(config\.json|\.env|tracker\.db|\.pem|\.key)$", re.I)
PATTERNS = {
    "이메일": re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"),
    "Anthropic/OpenAI 키": re.compile(r"sk-[A-Za-z0-9_-]{20,}"),
    "apikey 쿼리": re.compile(r"apikey=[A-Za-z0-9]{8,}", re.I),
    "로컬 경로/사용자명": re.compile(r"C:\\Users\\|/Users/[a-z]|jshoo", re.I),
    "GitHub 토큰": re.compile(r"gh[pousr]_[A-Za-z0-9]{30,}"),
}
ALLOW_EMAIL = re.compile(r"(me@example\.com|noreply@|@users\.noreply\.github\.com)")


def files():
    for p in DEPLOY:
        full = os.path.join(ROOT, p)
        if os.path.isfile(full):
            yield full
        elif os.path.isdir(full):
            for d, _, fs in os.walk(full):
                for f in fs:
                    yield os.path.join(d, f)


bad = []
for f in files():
    rel = os.path.relpath(f, ROOT)
    if BAD_FILES.search(f):
        bad.append((rel, "비밀/DB 파일")); continue
    if os.path.getsize(f) > 8_000_000 or not re.search(r"\.(js|json|html|css|md|py|svg|webmanifest|txt)$", f):
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
