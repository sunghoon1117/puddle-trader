"""이 PC 의 매일 수집(예약 작업): (1) 포지션·수급 (2) SEC(내부자 Form 4·13F) 를 받아 저장소에 올린다.
GitHub 서버도 수집하지만 일부 출처는 서버 IP 를 막을 수 있어, 이 PC 가 두 번째 수집원이 된다(SEC 는 PC 에서만 열림 — tools/sec_check.bat).
SEC 는 tools/sec_setup.bat 로 SEC_USER_AGENT(앱이름 + 연락처)를 한 번 등록해야 한다(없으면 SEC 만 건너뜀).
동작: git pull → 수집 → 정상일 때만 해당 폴더(data/pos, data/tracker)를 커밋·푸시. 막히면 우회·재시도 없이 이전 데이터를 유지한다.
실패 사유는 임시 폴더의 puddle_sec.log 에 남는다."""
import datetime, json, os, re, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
LOG = os.path.join(tempfile.gettempdir(), "puddle_sec.log")
for stream in (sys.stdout, sys.stderr):                 # 예약 작업의 출력 인코딩(cp949)에서 한글·기호 때문에 멈추지 않게
    try:
        stream.reconfigure(encoding="utf8", errors="replace")
    except Exception:
        pass


def note(msg):
    """화면과 로그에 함께 남긴다(예약 작업 창이 닫혀도 확인할 수 있게)."""
    print(msg, flush=True)
    try:
        with open(LOG, "a", encoding="utf8") as f:
            f.write(f"{datetime.datetime.now():%Y-%m-%d %H:%M:%S} {msg.splitlines()[0] if msg else ''}\n")
    except Exception:
        pass


def fail(msg):
    note(msg)
    sys.exit(1)


def run(*a, check=True):
    r = subprocess.run(a, capture_output=True, text=True, encoding="utf8", errors="replace")
    if check and r.returncode:
        fail("실패: " + " ".join(a[:3]) + " " + (r.stderr or r.stdout)[-300:].strip())
    return r


def publish(path, message):
    """해당 폴더만 커밋·푸시. 올린 것이 있으면 True. 공개 저장소에 올라가기 전에 개인정보·비밀을 점검한다."""
    chk = run(sys.executable, os.path.join("tools", "privacy_check.py"), check=False)
    if chk.returncode:
        run("git", "checkout", "--", path, check=False)
        fail("개인정보·비밀 점검 실패로 올리지 않았습니다: " + (chk.stdout or chk.stderr)[-300:].strip().replace("\n", " / "))
    run("git", "add", path)
    if run("git", "diff", "--cached", "--quiet", "--", path, check=False).returncode == 0:
        return False
    run("git", "commit", "-q", "-m", message, "--", path)
    run("git", "pull", "--rebase", "--autostash", "-q")     # 수집하는 동안 원격이 바뀌었을 수 있음
    run("git", "push", "-q", "origin", "HEAD:main")
    return True


def collect(script, env, *args):
    r = subprocess.run([sys.executable, os.path.join("tools", script), *args], env=env, capture_output=True, text=True, encoding="utf8", errors="replace")
    lines = (r.stdout or "").strip().splitlines()
    return r.returncode, (lines[-1] if lines else (r.stderr or "")[-300:])


br = run("git", "rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
if br != "main":
    fail("현재 브랜치가 main 이 아니라 중단합니다: " + br)
run("git", "fetch", "-q")
if run("git", "rev-list", "--count", "origin/main..HEAD").stdout.strip() not in ("0", ""):
    fail("아직 푸시하지 않은 로컬 커밋이 있어 중단합니다(함께 올라가는 것을 막기 위해).")
dirty = [l for l in run("git", "status", "--porcelain", "--untracked-files=no").stdout.splitlines() if not l[3:].startswith("data/")]   # 개발 서버가 쓰는 data/ 변경은 무시
if dirty:
    fail("커밋하지 않은 변경이 있어 중단합니다(충돌 방지): " + ", ".join(l[3:] for l in dirty[:3]))
run("git", "checkout", "--", "data/tracker", "data/pos", check=False)   # 이전에 중단된 수집의 찌꺼기 정리
run("git", "pull", "--rebase", "--autostash", "-q")
remote = run("git", "remote", "get-url", "origin").stdout.strip()
m = re.search(r"github\.com[:/]([^/]+)/([^/.]+)", remote)
env = dict(os.environ, PYTHONIOENCODING="utf8", PYTHONUTF8="1")
if m:
    env["SITE_URL"] = f"https://{m.group(1)}.github.io/{m.group(2)}"
problems = 0

# (1) 포지션·수급 (SEC 와 무관하게 진행)
code, last = collect("position_collect.py", env, "--force")
note(last)
if code == 0 and run(sys.executable, os.path.join("tools", "validate_data.py"), check=False).returncode == 0:
    note("포지션·수급 수집분을 올렸습니다." if publish("data/pos", "포지션·수급 수집(PC)") else "포지션·수급: 바뀐 내용이 없습니다.")
else:
    run("git", "checkout", "--", "data/pos", check=False)
    note("포지션·수급 수집 실패 — 올리지 않았습니다(코드 %d)." % code)
    problems += 1

# (2) SEC
ua = os.environ.get("SEC_USER_AGENT", "").strip()
if not ua:
    note("SEC_USER_AGENT 가 없어 SEC 수집은 건너뜁니다(tools/sec_setup.bat).")
else:
    print("사용 중인 연락처 도메인:", ua.split("@")[-1].strip() if "@" in ua else "(이메일 형식 아님!)")
    code, last = collect("tracker_collect.py", dict(env, SEC_LOCAL="1"))
    note(last)
    st = json.load(open(os.path.join("data", "tracker", "status.json"), encoding="utf8")) if code == 0 else {}
    if code == 0 and st.get("sec") == "ok":
        note("SEC 수집분을 올렸습니다." if publish("data/tracker", "SEC 거물 거래 수집(PC)") else "SEC: 바뀐 내용이 없습니다.")
    else:
        run("git", "checkout", "--", "data/tracker", check=False)
        note("SEC 수집이 정상이 아니라 올리지 않았습니다: " + str(st.get("notes", "수집기 오류 코드 %d" % code)))
        problems += 1
sys.exit(1 if problems else 0)
