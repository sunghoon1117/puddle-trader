"""이 PC 에서 SEC(내부자 Form 4·13F)를 수집해 저장소에 올린다.
GitHub 서버는 SEC 가 IP 단위로 막지만 가정·사무실 PC 는 되는 경우가 있다(tools/sec_check.bat 로 확인).
사전 준비: tools/sec_setup.bat 로 SEC_USER_AGENT(앱이름 + 연락처)를 한 번 등록.
동작: git pull → 수집(하원·FMP 포함 병합) → 결과가 정상(SEC=ok)일 때만 data/tracker 를 커밋·푸시.
SEC 가 막히면 아무것도 올리지 않고 끝난다(우회·재시도 폭주 없음)."""
import json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
if not os.environ.get("SEC_USER_AGENT", "").strip():
    sys.exit("SEC_USER_AGENT 가 없습니다. 먼저 tools/sec_setup.bat 를 실행하세요.")


def run(*a, check=True):
    r = subprocess.run(a, capture_output=True, text=True, encoding="utf8", errors="replace")
    if check and r.returncode:
        sys.exit("실패: " + " ".join(a[:3]) + "\n" + (r.stderr or r.stdout)[-400:])
    return r


print("사용 중인 연락처 도메인:", os.environ["SEC_USER_AGENT"].split("@")[-1].strip() if "@" in os.environ["SEC_USER_AGENT"] else "(이메일 형식 아님!)")
run("git", "pull", "--rebase", "--autostash", "-q")
remote = run("git", "remote", "get-url", "origin").stdout.strip()
m = re.search(r"github\.com[:/]([^/]+)/([^/.]+)", remote)
env = dict(os.environ, SEC_LOCAL="1", PYTHONIOENCODING="utf8", PYTHONUTF8="1")
if m:
    env["SITE_URL"] = f"https://{m.group(1)}.github.io/{m.group(2)}"
r = subprocess.run([sys.executable, os.path.join("tools", "tracker_collect.py")], env=env, capture_output=True, text=True, encoding="utf8", errors="replace")
print((r.stdout or "").strip().splitlines()[-1] if r.stdout.strip() else r.stderr[-300:])
st = json.load(open(os.path.join("data", "tracker", "status.json"), encoding="utf8"))
if st.get("sec") != "ok":
    run("git", "checkout", "--", "data/tracker", check=False)
    sys.exit("SEC 수집이 정상이 아니라 올리지 않았습니다: " + str(st.get("notes")))
run("git", "add", "data/tracker")
if run("git", "diff", "--cached", "--quiet", check=False).returncode == 0:
    sys.exit("바뀐 내용이 없습니다.")
run("git", "commit", "-q", "-m", "SEC 거물 거래 수집(PC)")
run("git", "push", "-q")
print("SEC 수집분을 올렸습니다. 곧 사이트에 반영됩니다.")
