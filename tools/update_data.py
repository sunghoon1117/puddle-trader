"""시세·재무 데이터를 data/ 폴더에 갱신한다 (PC 서버·GitHub Actions 공용).
  python tools/update_data.py [--full] [--only SYM,SYM]
- 기존 파일이 있으면 최근 1개월만 받아 병합(빠르고 끊겨도 안전), 없으면 전체 일봉(period1=0).
- 한 종목이 실패해도 기존 데이터를 유지하고 manifest.json 에 실패 목록을 남긴다.
- 앱은 manifest.json(수 KB)만 주기적으로 확인하고 바뀐 종목만 내려받는다.
"""
import json, os, sys, time, math, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
PXD = os.path.join(DATA, "px")
UA = {"User-Agent": "puddle-trader/1.0 (personal research)"}
HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]


def safe(sym):
    return sym.replace("^", "_").replace("/", "_")


def http(url, timeout=25):
    last = None
    for host in HOSTS:
        try:
            u = url.replace("{H}", host)
            with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=timeout) as r:
                return json.loads(r.read().decode("utf8"))
        except Exception as e:  # 다음 호스트로 재시도
            last = e
            time.sleep(0.6)
    raise last


def fetch_chart(sym, full):
    q = f"period1=0&period2={int(time.time()) + 86400}&interval=1d" if full else "range=1mo&interval=1d"
    j = http(f"https://{{H}}/v8/finance/chart/{urllib.parse.quote(sym)}?{q}")
    r = j["chart"]["result"][0]
    ts, cl = r["timestamp"], r["indicators"]["quote"][0]["close"]
    d, c = [], []
    for t, v in zip(ts, cl):
        if v is not None and math.isfinite(v):
            d.append(time.strftime("%Y-%m-%d", time.gmtime(t)))
            c.append(round(v, 4))
    meta = r.get("meta", {})
    return d, c, {"mt": meta.get("regularMarketTime"), "p": meta.get("regularMarketPrice")}


def update_symbol(sym, force_full):
    path = os.path.join(PXD, safe(sym) + ".json")
    old = None
    if os.path.exists(path) and not force_full:
        try:
            old = json.load(open(path, encoding="utf8"))
        except Exception:
            old = None
    full = old is None or len(old.get("c", [])) < 300
    d, c, meta = fetch_chart(sym, full)
    if len(c) < 20:
        raise RuntimeError("데이터 부족")
    if old and not full:
        m = dict(zip(old["d"], old["c"]))
        m.update(dict(zip(d, c)))           # 최근 봉(장중 잠정치 포함)은 새 값으로 덮어씀
        d = sorted(m)
        c = [m[x] for x in d]
    out = {"s": sym, "d": d, "c": c, "t": int(time.time()), "mt": meta["mt"]}
    os.makedirs(PXD, exist_ok=True)
    json.dump(out, open(path + ".tmp", "w", encoding="utf8"), separators=(",", ":"))
    os.replace(path + ".tmp", path)
    return len(c), d[-1]


def fetch_fund(sym):
    types = "annualOperatingCashFlow,annualDilutedAverageShares,annualFreeCashFlow,annualCapitalExpenditure"
    j = http(f"https://{{H}}/ws/fundamentals-timeseries/v1/finance/timeseries/{sym}?symbol={sym}&type={types}&period1=1400000000&period2={int(time.time())}")
    ser = {}
    for it in j["timeseries"]["result"]:
        k = it["meta"]["type"][0]
        ser[k] = {x["asOfDate"][:4]: x["reportedValue"]["raw"] for x in it.get(k, []) if x and x.get("reportedValue")}
    ocf, sh = ser.get("annualOperatingCashFlow", {}), ser.get("annualDilutedAverageShares", {})
    yrs = sorted(y for y in ocf if y in sh and sh[y])
    if len(yrs) < 2:
        raise RuntimeError("재무 데이터 부족")
    cfps = {y: ocf[y] / sh[y] for y in yrs}
    first, last = cfps[yrs[0]], cfps[yrs[-1]]
    n = len(yrs) - 1
    cagr = (last / first) ** (1 / n) - 1 if first > 0 and last > 0 else None
    # 도키 방식: 보수적 성장률(상한 20%, 하한 5%)·보수적 멀티플 18배·요구수익률 10%로 3년 후 가치를 현재가로 할인
    g = min(.20, max(.05, cagr)) if cagr is not None else .05
    fair = last * (1 + g) ** 3 * 18 / 1.10 ** 3 if last > 0 else None
    return {"cfps": round(last, 4), "g": round(g, 4), "cagr": None if cagr is None else round(cagr, 4), "mult": 18, "r": .10,
            "years": yrs, "fair": None if fair is None else round(fair, 2), "asof": yrs[-1]}


def main():
    args = sys.argv[1:]
    force = "--full" in args
    uni = json.load(open(os.path.join(DATA, "universe.json"), encoding="utf8"))
    syms = uni["market"] + [w["sym"] for w in uni["watch"]]
    if "--only" in args:
        syms = args[args.index("--only") + 1].split(",")
    os.makedirs(PXD, exist_ok=True)
    mpath = os.path.join(DATA, "manifest.json")
    man = json.load(open(mpath, encoding="utf8")) if os.path.exists(mpath) else {"symbols": {}}
    man.setdefault("symbols", {})
    fails = []

    def job(s):
        try:
            n, last = update_symbol(s, force)
            return s, n, last, None
        except Exception as e:
            return s, 0, None, str(e)[:80]

    with ThreadPoolExecutor(6) as ex:
        for s, n, last, err in ex.map(job, syms):
            if err:
                fails.append(s)
                print("실패", s, err)
            else:
                man["symbols"][s] = {"n": n, "last": last, "t": int(time.time())}
    # 재무(적정가 자동 계산): 개별주만, 하루 1회 이상 갱신하지 않음
    fpath = os.path.join(DATA, "fund.json")
    fund = json.load(open(fpath, encoding="utf8")) if os.path.exists(fpath) else {}
    for w in uni["watch"]:
        if w.get("type") == "stock" and (force or time.time() - fund.get(w["sym"], {}).get("t", 0) > 20 * 3600):
            try:
                f = fetch_fund(w["sym"]); f["t"] = int(time.time()); fund[w["sym"]] = f
            except Exception as e:
                print("재무 실패", w["sym"], str(e)[:60])
    json.dump(fund, open(fpath, "w", encoding="utf8"), separators=(",", ":"), ensure_ascii=False)
    man["updated"] = int(time.time())
    man["fails"] = fails
    man["v"] = 1
    json.dump(man, open(mpath + ".tmp", "w", encoding="utf8"), separators=(",", ":"))
    os.replace(mpath + ".tmp", mpath)
    print(f"완료: {len(syms) - len(fails)}/{len(syms)} 종목, 실패 {fails}")


if __name__ == "__main__":
    main()
