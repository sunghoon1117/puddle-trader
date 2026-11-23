"""이 PC 에서 SEC(내부자 Form 4·13F)를 수집해 저장소에 올린다.
GitHub 서버는 SEC 가 IP 단위로 막지만 가정·사무실 PC 는 되는 경우가 있다(tools/sec_check.bat 로 확인).
사전 준비: tools/sec_setup.bat 로 SEC_USER_AGENT(앱이름 + 연락처)를 한 번 등록.
동작: git pull → 수집(하원·FMP 포함 병합) → 결과가 정상(SEC=ok)일 때만 data/tracker 를 커밋·푸시.
SEC 가 막히면 아무것도 올리지 않고 끝난다(우회·재시도 폭주 없음)."""
import json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
if not os.environ.get("SEC_USER_AGENT", "").strip():
    fail("SEC_USER_AGENT 가 없습니다. 먼저 tools/sec_setup.bat 를 실행하세요.")


import datetime, tempfile


def fail(msg):
    """실패 사유를 임시 폴더의 로그에도 남긴다(예약 작업 창이 닫혀도 확인할 수 있게)."""
    try:
        with open(os.path.join(tempfile.gettempdir(), "puddle_sec.log"), "a", encoding="utf8") as f:
            f.write(f"{datetime.datetime.now():%Y-%m-%d %H:%M:%S} {msg.splitlines()[0]}\n")
    except Exception:
        pass
    sys.exit(msg)


def run(*a, check=True):
    r = subprocess.run(a, capture_output=True, text=True, encoding="utf8", errors="replace")
    if check and r.returncode:
        fail("실패: " + " ".join(a[:3]) + "\n" + (r.stderr or r.stdout)[-400:])
    return r


print("사용 중인 연락처 도메인:", os.environ["SEC_USER_AGENT"].split("@")[-1].strip() if "@" in os.environ["SEC_USER_AGENT"] else "(이메일 형식 아님!)")
br = run("git", "rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
if br != "main":
    fail("현재 브랜치가 main 이 아니라 중단합니다: " + br)
run("git", "fetch", "-q")
if run("git", "rev-list", "--count", "origin/main..HEAD").stdout.strip() not in ("0", ""):
    fail("아직 푸시하지 않은 로컬 커밋이 있어 중단합니다(함께 올라가는 것을 막기 위해).")
dirty = [l for l in run("git", "status", "--porcelain", "--untracked-files=no").stdout.splitlines() if not l[3:].startswith("data/")]   # 개발 서버가 쓰는 data/ 변경은 무시
if dirty:
    fail("커밋하지 않은 변경이 있어 중단합니다(충돌 방지): " + ", ".join(l[3:] for l in dirty[:3]))
run("git", "checkout", "--", "data/tracker", check=False)   # 이전에 중단된 수집의 찌꺼기 정리
run("git", "pull", "--rebase", "--autostash", "-q")
remote = run("git", "remote", "get-url", "origin").stdout.strip()
m = re.search(r"github\.com[:/]([^/]+)/([^/.]+)", remote)
env = dict(os.environ, SEC_LOCAL="1", PYTHONIOENCODING="utf8", PYTHONUTF8="1")
if m:
    env["SITE_URL"] = f"https://{m.group(1)}.github.io/{m.group(2)}"
r = subprocess.run([sys.executable, os.path.join("tools", "tracker_collect.py")], env=env, capture_output=True, text=True, encoding="utf8", errors="replace")
print((r.stdout or "").strip().splitlines()[-1] if r.stdout.strip() else r.stderr[-300:])
if r.returncode:
    run("git", "checkout", "--", "data/tracker", check=False)
    fail("수집기가 오류로 끝나 올리지 않았습니다(코드 %d)." % r.returncode)
st = json.load(open(os.path.join("data", "tracker", "status.json"), encoding="utf8"))
if st.get("sec") != "ok":
    run("git", "checkout", "--", "data/tracker", check=False)
    fail("SEC 수집이 정상이 아니라 올리지 않았습니다: " + str(st.get("notes")))
run("git", "add", "data/tracker")
if run("git", "diff", "--cached", "--quiet", check=False).returncode == 0:
    fail("바뀐 내용이 없습니다.")
run("git", "commit", "-q", "-m", "SEC 거물 거래 수집(PC)", "--", "data/tracker")
run("git", "push", "-q", "origin", "HEAD:main")
print("SEC 수집분을 올렸습니다. 곧 사이트에 반영됩니다.")
