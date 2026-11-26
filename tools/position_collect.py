"""포지션·수급 수집(정적 모드) → data/pos/*.json. 모두 무료 공개 자료이며 점수에는 반영하지 않는 참고 정보다.
  · 옵션 미결제약정(행사가·만기): OCC(옵션청산회사) 공개 series-search (전 영업일 기준)
  · 선물 포지션(기관·헤지펀드·딜러·소규모): CFTC 주간 TFF 보고서(화요일 기준·금요일 발표)
  · 공매도: FINRA 일별 공매도 거래량 파일, Nasdaq 상장 종목은 격주 공매도 잔고
  · 기관 보유 요약: Nasdaq 공개 API(13F 기반)
  · 한국 투자자별 순매매(개인·기관·외국인): 네이버 금융 공개 JSON
 접근을 막으면(403/429) 우회하지 않고 해당 출처만 12시간 쉬며 이전 데이터를 유지한다. 하루 약 1회만 새로 받는다(--force 로 강제).
 환경변수 SITE_URL: 직전 배포본을 이어받아 이력을 보존.
"""
import datetime as dt, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(DATA, "pos")
SITE = os.environ.get("SITE_URL", "").strip().rstrip("/")
UA = {"User-Agent": "puddle-trader/1.0 (personal research)"}
INDEX_OPT = ["SPX", "NDX", "VIX"]                       # 지수 옵션(OCC 루트 심볼)
COT = [("NQ", "209742", "나스닥100 선물(미니)"), ("ES", "13874A", "S&P500 선물(미니)"), ("VIX", "1170E1", "VIX 선물")]
SHORT_DAYS = 60
REFRESH_H = 10


class Blocked(Exception):
    pass


def safe(s):
    return s.replace("^", "_").replace("/", "_")


STATE = {"blocked": {}}


def get(url, source, timeout=60, raw=False):
    if STATE["blocked"].get(source, 0) > time.time():
        raise Blocked(source + " 휴지 중")
    time.sleep(0.5)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
            b = r.read()
            return b if raw else b.decode("utf8", "replace")
    except urllib.error.HTTPError as e:
        if e.code in (403, 429):
            STATE["blocked"][source] = time.time() + 12 * 3600
            raise Blocked("%s HTTP %d" % (source, e.code))
        raise


def load(path, default):
    try:
        with open(path, encoding="utf8") as f:
            return json.load(f)
    except Exception:
        return default


def site_or_local(rel, default):
    """배포본과 저장소 파일 중 갱신 시각(t)이 더 최신인 쪽을 사용"""
    loc = load(os.path.join(DATA, rel), None)
    rem = None
    if SITE:
        try:
            rem = json.loads(get(f"{SITE}/data/{urllib.parse.quote(rel)}", "site", 20))
        except Exception:
            rem = None
    if rem is None:
        return loc if loc is not None else default
    if loc is None:
        return rem
    return rem if rem.get("t", 0) >= loc.get("t", 0) else loc


def dump(rel, obj):
    p = os.path.join(DATA, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p + ".tmp", "w", encoding="utf8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(p + ".tmp", p)


def num(s):
    t = re.sub(r"[^0-9.\-]", "", str(s or ""))
    try:
        return float(t)
    except ValueError:
        return None


# ───────── 옵션 미결제약정 (OCC) ─────────
def parse_occ(text, root):
    """{만기: {행사가: [콜, 풋]}} — FLEX(숫자로 시작)·조정 계약은 제외하고 루트와 루트W(위클리)만"""
    out = {}
    for ln in text.splitlines():
        tk = ln.split()
        if len(tk) < 8 or tk[0] not in (root, root + "W"):
            continue
        try:
            y, m, d, i, dec = int(tk[1]), int(tk[2]), int(tk[3]), int(tk[4]), int(tk[5])
            c, p = int(tk[-3]), int(tk[-2])
        except ValueError:
            continue
        exp = "%04d-%02d-%02d" % (y, m, d)
        k = i + dec / 1000
        row = out.setdefault(exp, {}).setdefault(k, [0, 0])
        row[0] += c
        row[1] += p
    return out


def max_pain(strikes):
    """만기 시점 옵션 매수자의 총 가치가 가장 작은(=매도자에게 유리한) 가격 — 참고용 지표"""
    ks = sorted(strikes)
    best, bv = None, None
    for s in ks:
        v = sum(strikes[k][0] * max(0, s - k) + strikes[k][1] * max(0, k - s) for k in ks)
        if bv is None or v < bv:
            best, bv = s, v
    return best


def third_friday(d):
    x = dt.date.fromisoformat(d)
    return x.weekday() == 4 and 15 <= x.day <= 21


def options_summary(sym, spot, today):
    data = parse_occ(get("https://marketdata.theocc.com/series-search?symbolType=U&symbol=" + urllib.parse.quote(sym), "occ"), sym)
    data = {e: s for e, s in data.items() if e >= today}
    if not data:
        raise RuntimeError("옵션 자료 없음")
    exps = sorted(data)
    totals = {e: (sum(v[0] for v in data[e].values()), sum(v[1] for v in data[e].values())) for e in exps}
    pick = exps[:3] + [e for e in exps if third_friday(e)][:4]
    far = [e for e in exps if (dt.date.fromisoformat(e) - dt.date.fromisoformat(today)).days > 90]
    if far:
        pick.append(max(far, key=lambda e: sum(totals[e])))
    pick = sorted(set(pick))

    def near(strikes):
        if not spot:
            return strikes
        return {k: v for k, v in strikes.items() if spot * 0.6 <= k <= spot * 1.4}

    def rows(strikes):
        n = near(strikes)
        return [[k, n[k][0], n[k][1]] for k in sorted(n) if n[k][0] or n[k][1]]

    allk = {}
    for e in exps:
        for k, (c, p) in data[e].items():
            v = allk.setdefault(k, [0, 0])
            v[0] += c
            v[1] += p
    nk = near(allk)
    return {
        "asof": today, "spot": spot,
        "expiries": [{"d": e, "c": totals[e][0], "p": totals[e][1], "pain": max_pain(data[e]), "monthly": third_friday(e), "strikes": rows(data[e])} for e in pick],
        "all": {"c": sum(t[0] for t in totals.values()), "p": sum(t[1] for t in totals.values()), "strikes": rows(allk)},
        "byExpiry": [[e, totals[e][0], totals[e][1]] for e in exps],
        "walls": {"call": sorted(([k, v[0]] for k, v in nk.items() if v[0]), key=lambda x: -x[1])[:5], "put": sorted(([k, v[1]] for k, v in nk.items() if v[1]), key=lambda x: -x[1])[:5]},
    }


# ───────── 선물 포지션 (CFTC) ─────────
def cot_fetch():
    codes = ",".join("'%s'" % c for _, c, _ in COT)
    q = {"$where": f"cftc_contract_market_code in({codes})", "$order": "report_date_as_yyyy_mm_dd DESC", "$limit": str(len(COT) * 80)}
    rows = json.loads(get("https://publicreporting.cftc.gov/resource/gpe5-46if.json?" + urllib.parse.urlencode(q), "cftc"))
    out = {}
    for key, code, name in COT:
        hist = []
        for r in rows:
            if r.get("cftc_contract_market_code") != code:
                continue
            g = lambda f: int(num(r.get(f)) or 0)
            hist.append({"d": r["report_date_as_yyyy_mm_dd"][:10], "oi": g("open_interest_all"),
                         "am": [g("asset_mgr_positions_long"), g("asset_mgr_positions_short")],
                         "lev": [g("lev_money_positions_long"), g("lev_money_positions_short")],
                         "dealer": [g("dealer_positions_long_all"), g("dealer_positions_short_all")],
                         "other": [g("other_rept_positions_long"), g("other_rept_positions_short")],
                         "small": [g("nonrept_positions_long_all"), g("nonrept_positions_short_all")]})
        if hist:
            out[key] = {"name": name, "hist": sorted(hist, key=lambda x: x["d"])}
    return out


# ───────── 공매도 거래량 (FINRA) ─────────
def short_volume(prev, syms, today):
    have = prev.get("days", {})
    d = dt.date.fromisoformat(today) - dt.timedelta(days=1)   # 당일 파일은 아직 없으므로 전날부터
    wanted = []
    while len(wanted) < SHORT_DAYS and (dt.date.fromisoformat(today) - d).days < 100:
        if d.weekday() < 5:
            wanted.append(d.strftime("%Y%m%d"))
        d -= dt.timedelta(days=1)
    denied = 0
    for day in wanted:
        if day in have and all(s in have[day] for s in syms):
            continue
        try:
            txt = get(f"https://cdn.finra.org/equity/regsho/daily/CNMSshvol{day}.txt", "finra")
        except Blocked:
            # 휴장일처럼 파일이 없는 날짜에도 403 이 온다 → 연속 3회일 때만 실제 제한으로 보고 중단
            denied += 1
            if denied >= 3:
                break
            STATE["blocked"].pop("finra", None)
            continue
        except Exception:
            continue
        denied = 0
        row = {}
        for ln in txt.splitlines():
            p = ln.split("|")
            if len(p) >= 5 and p[1] in syms:
                row[p[1]] = [int(float(p[2])), int(float(p[4]))]
        if row:
            have[day] = row
    keep = set(wanted)
    return {"t": int(time.time()), "days": {k: v for k, v in have.items() if k in keep}}


def short_interest(sym):
    j = json.loads(get(f"https://api.nasdaq.com/api/quote/{sym}/short-interest?assetClass=stocks", "nasdaq", 30))
    rows = ((j.get("data") or {}).get("shortInterestTable") or {}).get("rows") or []
    out = []
    for r in rows[:12]:
        m, d, y = r["settlementDate"].split("/")
        out.append([f"{y}-{m}-{d}", num(r.get("interest")), num(r.get("avgDailyShareVolume")), r.get("daysToCover")])
    return out


def institutional(sym):
    j = json.loads(get(f"https://api.nasdaq.com/api/company/{sym}/institutional-holdings?limit=10&type=TOTAL&sortColumn=marketValue&sortOrder=DESC", "nasdaq", 30))
    d = j.get("data") or {}
    s = d.get("ownershipSummary") or {}
    if not s:
        return None
    cnt = {}
    for block in ("activePositions", "newSoldOutPositions"):
        for r in (d.get(block) or {}).get("rows") or []:
            cnt[r.get("positions", "")] = [num(r.get("holders")), num(r.get("shares"))]
    top = [{"name": r.get("ownerName"), "date": r.get("date"), "shares": num(r.get("sharesHeld")), "chg": num(r.get("sharesChange"))}
           for r in ((d.get("holdingsTransactions") or {}).get("table") or {}).get("rows") or []][:8]
    return {"pct": num((s.get("SharesOutstandingPCT") or {}).get("value")), "holders": cnt, "top": top}


# ───────── 한국: 투자자별 순매매 (네이버) ─────────
def kr_trend(sym, prev):
    code = sym.split(".")[0]
    rows = json.loads(get(f"https://m.stock.naver.com/api/stock/{code}/trend?pageSize=40", "naver", 30))
    m = {r[0]: r for r in prev}
    for r in rows:
        d = r["bizdate"]
        d = f"{d[:4]}-{d[4:6]}-{d[6:]}"
        m[d] = [d, num(r.get("individualPureBuyQuant")), num(r.get("organPureBuyQuant")), num(r.get("foreignerPureBuyQuant")), num(r.get("closePrice")), num(r.get("foreignerHoldRatio"))]
    return [m[k] for k in sorted(m)][-120:]


def last_close(sym):
    px = load(os.path.join(DATA, "px", safe(sym) + ".json"), None)
    return px["c"][-1] if px and px.get("c") else None


def main():
    os.makedirs(OUT, exist_ok=True)
    today = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")
    status = site_or_local("pos/status.json", {"t": 0, "notes": []})
    if "--force" not in sys.argv and time.time() - status.get("t", 0) < REFRESH_H * 3600:
        # 새로 받지 않아도 배포본의 파일은 이어받아야 하므로 저장소에 복사해 둔다
        for f in status.get("files", []):
            v = site_or_local("pos/" + f, None)
            if v is not None:
                dump("pos/" + f, v)
        dump("pos/status.json", status)
        print("포지션·수급: 최근에 받아 이전 데이터를 유지")
        return
    STATE["blocked"] = status.get("blocked", {})
    uni = load(os.path.join(DATA, "universe.json"), {"watch": []})
    us = [w for w in uni["watch"] if "." not in w["sym"]]
    kr = [w for w in uni["watch"] if w["sym"].endswith((".KS", ".KQ"))]
    notes, files = [], []

    def run(label, fn):
        try:
            return fn()
        except Blocked as e:
            notes.append(f"{label}: 접근 제한({e}) — 이전 데이터 유지")
        except Exception as e:
            notes.append(f"{label}: {str(e)[:60]}")
        return None

    shv_prev = site_or_local("pos/shortvol.json", {"t": 0, "days": {}})
    shv = run("공매도 거래량", lambda: short_volume(shv_prev, [w["sym"] for w in us], today)) or shv_prev
    dump("pos/shortvol.json", shv)
    files.append("shortvol.json")
    days = sorted(shv.get("days", {}))

    for w in us:
        s = w["sym"]
        rel = f"pos/{safe(s)}.json"
        cur = site_or_local(rel, {"s": s, "t": 0})
        o = run(f"{s} 옵션", lambda: options_summary(s, last_close(s), today))
        if o:
            cur["opt"] = o
        si = run(f"{s} 공매도 잔고", lambda: short_interest(s)) if w.get("type") == "stock" else None
        if si:
            cur["shortInt"] = si
        ins = run(f"{s} 기관 보유", lambda: institutional(s)) if w.get("type") == "stock" else None
        if ins:
            cur["inst"] = ins
        cur["shortVol"] = [[f"{d[:4]}-{d[4:6]}-{d[6:]}"] + shv["days"][d][s] for d in days if s in shv["days"][d]]
        cur["s"], cur["t"] = s, int(time.time())
        dump(rel, cur)
        files.append(f"{safe(s)}.json")

    spots = {"SPX": (last_close("SPY") or 0) * 10 or None, "NDX": None, "VIX": last_close("^VIX")}
    ndx = load(os.path.join(DATA, "px", "QQQ.json"), None)
    if ndx:
        spots["NDX"] = ndx["c"][-1] * 41            # QQQ×약 41 = 나스닥100 근사(행사가 범위 필터용)
    for s in INDEX_OPT:
        rel = f"pos/IDX_{s}.json"
        cur = site_or_local(rel, {"s": s, "t": 0})
        o = run(f"{s} 지수 옵션", lambda: options_summary(s, spots[s], today))
        if o:
            o["approxSpot"] = s != "VIX"
            cur["opt"] = o
        cur["s"], cur["t"] = s, int(time.time())
        dump(rel, cur)
        files.append(f"IDX_{s}.json")

    for w in kr:
        s = w["sym"]
        rel = f"pos/{safe(s)}.json"
        cur = site_or_local(rel, {"s": s, "t": 0})
        r = run(f"{s} 투자자별 순매매", lambda: kr_trend(s, cur.get("kr", [])))
        if r:
            cur["kr"] = r
        cur["s"], cur["t"] = s, int(time.time())
        dump(rel, cur)
        files.append(f"{safe(s)}.json")

    cot_prev = site_or_local("pos/cot.json", {"t": 0, "markets": {}})
    c = run("선물 포지션(CFTC)", cot_fetch)
    if c:
        cot_prev = {"t": int(time.time()), "markets": c}
    dump("pos/cot.json", cot_prev)
    files.append("cot.json")

    status = {"t": int(time.time()), "notes": notes[:40], "files": files, "blocked": {k: v for k, v in STATE["blocked"].items() if v > time.time()}}
    dump("pos/status.json", status)
    print(f"포지션·수급: {len(files)}개 파일, 문제 {len(notes)}건 {notes[:5]}")


if __name__ == "__main__":
    main()
