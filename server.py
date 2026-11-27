"""디벨롭 로컬 서버: 앱 파일 + 시세 자동 갱신(백그라운드) + 프록시.
- 앱에 필요한 파일(아래 APP_FILES 와 data/*.json)만 내준다. .git·worker·tools 등은 404.
- 이 PC(또는 --lan 이면 이 PC 의 LAN 주소)를 Host 로 부른 요청만 받는다(다른 웹페이지의 DNS 우회 방지).
  python server.py [포트=8777]
- 시작 시 및 5분마다(미국 장중 2분마다) data/ 를 자동 갱신 → 앱은 data/manifest.json 변화만 보고 따라간다.
- 같은 와이파이의 휴대폰은 출력되는 LAN 주소로 접속.
"""
import http.server, socketserver, urllib.request, urllib.parse, json, os, re, socket, sys, time, threading, subprocess

PORT = int(next((a for a in sys.argv[1:] if a.isdigit()), 8777))
LAN = "--lan" in sys.argv   # 기본은 이 PC 에서만 열림(휴대폰 테스트는 --lan)
ROOT = os.path.dirname(os.path.abspath(__file__))
UA = {"User-Agent": "puddle-trader/1.0 (personal research)"}
CACHE = {}
TTL = 120
STATE = {"last": 0, "running": False, "msg": ""}
# 화면 파일을 새로 만들면 여기·sw.js·배포 워크플로에 함께 추가한다
APP_FILES = {"index.html", "guide.html", "styles.css", "app.js", "detail.js", "weekend.js", "positions.js", "engine.js", "bt-worker.js", "sw.js",
             "manifest.webmanifest", "version.json", "icon.svg", "icon-180.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png"}
DATA_FILE = re.compile(r"data/(?:(?:px|pos|tracker)/)?[A-Za-z0-9_=-][A-Za-z0-9_.=-]*\.json")
RANGES = {"1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "max"}
ALLOWED_HOSTS = set()   # 시작할 때 채움


def allowed_path(url_path):
    p = urllib.parse.unquote(url_path).lstrip("/") or "index.html"
    return p in APP_FILES or bool(DATA_FILE.fullmatch(p))


def allowed_hosts(port, lan=None):
    return {f"{h}:{port}" for h in ["localhost", "127.0.0.1", "[::1]"] + ([lan] if lan else [])}


def market_open_utc():
    t = time.gmtime()
    mins = t.tm_hour * 60 + t.tm_min
    return t.tm_wday < 5 and 13 * 60 + 25 <= mins <= 21 * 60 + 10   # 대략 미국 장중(서머타임 무관 넉넉히)


def updater():
    while True:
        interval = 120 if market_open_utc() else 600
        if time.time() - STATE["last"] >= interval and not STATE["running"]:
            STATE["running"] = True
            try:
                r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "update_data.py")], capture_output=True, text=True, timeout=600)
                STATE["msg"] = (r.stdout or r.stderr).strip().splitlines()[-1:] or [""]
            except Exception as e:
                STATE["msg"] = [str(e)]
            STATE["last"] = time.time()
            STATE["running"] = False
        time.sleep(15)


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def host_ok(self):
        if (self.headers.get("Host") or "").lower() in ALLOWED_HOSTS:
            return True
        self.send_error(403)
        return False

    def send_head(self):   # 정적 파일(GET·HEAD)은 허용 목록만
        if not allowed_path(urllib.parse.urlparse(self.path).path):
            self.send_error(404)
            return None
        return super().send_head()

    def do_HEAD(self):
        if self.host_ok():
            super().do_HEAD()

    def do_GET(self):
        if not self.host_ok():
            return
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        if u.path == "/api/chart":
            return self.chart(q)
        if u.path == "/api/batch":        # 여러 종목의 최근 일봉(장중 잠정 포함)을 한 번에 — 앱이 20초마다 호출
            return self.batch(q)
        if u.path == "/api/refresh":      # 앱의 '지금 갱신' 버튼
            if not STATE["running"]:
                STATE["last"] = 0
            return self.send_json(200, {"started": True, "running": STATE["running"], "last": STATE["last"]})
        if u.path == "/api/status":
            return self.send_json(200, {"running": STATE["running"], "last": STATE["last"], "msg": STATE["msg"]})
        return super().do_GET()

    def chart(self, q):
        sym = (q.get("s", [""])[0] or "").strip().upper()
        rng = q.get("range", ["10y"])[0]
        if not sym or len(sym) > 15 or not all(c.isalnum() or c in "^.-=" for c in sym) or rng not in RANGES:
            return self.send_json(400, {"error": "bad request"})
        key = (sym, rng)
        hit = CACHE.get(key)
        if hit and time.time() - hit[0] < TTL:
            return self.send_bytes(200, hit[1])
        qs = f"period1=0&period2={int(time.time()) + 86400}&interval=1d" if rng == "max" else f"range={urllib.parse.quote(rng)}&interval=1d"
        for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
            try:
                with urllib.request.urlopen(urllib.request.Request(f"https://{host}/v8/finance/chart/{urllib.parse.quote(sym)}?{qs}", headers=UA), timeout=15) as r:
                    data = r.read()
                if len(CACHE) > 500:
                    CACHE.clear()
                CACHE[key] = (time.time(), data)
                return self.send_bytes(200, data)
            except Exception as e:
                err = str(e)
        self.send_json(502, {"error": err})

    def batch(self, q):
        from concurrent.futures import ThreadPoolExecutor
        syms = [s.strip().upper() for s in (q.get("s", [""])[0]).split(",") if s.strip()][:30]
        rng = q.get("range", ["5d"])[0]
        if not syms or not all(all(c.isalnum() or c in "^.-=" for c in s) and len(s) <= 15 for s in syms) or rng not in RANGES:
            return self.send_json(400, {"error": "bad request"})

        def one(sym):
            key = ("b", sym, rng)
            hit = CACHE.get(key)
            if hit and time.time() - hit[0] < 10:
                return sym, hit[1]
            for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
                try:
                    with urllib.request.urlopen(urllib.request.Request(f"https://{host}/v8/finance/chart/{urllib.parse.quote(sym)}?range={rng}&interval=1d", headers=UA), timeout=10) as r:
                        res = json.loads(r.read())["chart"]["result"][0]
                    d, c = [], []
                    for t, v in zip(res["timestamp"], res["indicators"]["quote"][0]["close"]):
                        if v is not None:
                            d.append(time.strftime("%Y-%m-%d", time.gmtime(t))); c.append(round(v, 4))
                    out = {"d": d, "c": c, "mt": res.get("meta", {}).get("regularMarketTime")}
                    CACHE[key] = (time.time(), out)
                    return sym, out
                except Exception:
                    continue
            return sym, None
        with ThreadPoolExecutor(8) as ex:
            res = dict(ex.map(one, syms))
        self.send_json(200, {k: v for k, v in res.items() if v})

    def send_bytes(self, code, data):
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, code, obj):
        self.send_bytes(code, json.dumps(obj).encode())

    def log_message(self, *a):
        pass


class S(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


if __name__ == "__main__":
    ALLOWED_HOSTS.update(allowed_hosts(PORT, lan_ip() if LAN else None))
    threading.Thread(target=updater, daemon=True).start()
    print(f"PC     : http://localhost:{PORT}")
    if LAN:
        print(f"모바일 : http://{lan_ip()}:{PORT}   (같은 와이파이)")
    print("시세는 백그라운드에서 자동 갱신됩니다. 종료: Ctrl+C")
    S(("0.0.0.0" if LAN else "127.0.0.1", PORT), H).serve_forever()
