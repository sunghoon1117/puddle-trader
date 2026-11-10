"""거물 거래 수집(정적 모드) — SEC Form 4(내부자) · 13F(기관 분기 보유) · 하원 PTR 색인 · (선택) FMP 의원 거래.
결과는 data/tracker/*.json 으로 저장되고, 앱이 정적 파일로 읽는다. 서버/DB 없이 GitHub Actions 에서 돈다.

환경변수(모두 '비밀'로 보관, 저장소·결과물에 포함되지 않음)
  SEC_USER_AGENT  SEC 가 요구하는 연락처 포함 식별자. 예) "MyApp 홍길동 me@example.com"
  FMP_API_KEY     (선택) 의원 거래. 없으면 하원 공식 PTR 색인만 사용
  SITE_URL        (선택) 이전에 배포된 사이트 주소 — 이전 수집 상태를 이어받아 증분 수집
SEC 가 403/429 를 주면 즉시 중단하고(우회하지 않음) 이전 데이터를 그대로 유지한다.
"""
import datetime as dt, hashlib, io, json, os, re, sys, time, urllib.error, urllib.request, urllib.parse, zipfile
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "tracker")
SEC_UA = os.environ.get("SEC_USER_AGENT", "").strip()
FMP = os.environ.get("FMP_API_KEY", "").strip()
SITE = os.environ.get("SITE_URL", "").strip().rstrip("/")
BACKFILL = 90
CODE_KO = {"P": "공개시장 매수", "S": "공개시장 매도", "A": "주식 보상(Grant)", "M": "옵션 행사", "F": "세금용 주식 원천징수", "G": "증여", "C": "전환",
           "D": "발행사에 처분", "X": "옵션 행사", "J": "기타", "W": "상속/유증", "I": "재량 거래", "K": "지분스왑", "L": "소액 거래", "V": "자발적 보고"}
ITEM_KO = {"1.01": "중요 계약 체결", "1.02": "중요 계약 해지", "1.03": "파산·법정관리", "2.01": "자산 인수·처분 완료", "2.02": "실적 발표", "2.03": "채무 발생",
           "2.05": "구조조정 비용", "2.06": "자산 손상", "3.01": "상장 요건 미달 통보", "4.01": "감사인 변경", "4.02": "재무제표 재작성 필요", "5.01": "경영권 변경",
           "5.02": "임원·이사 변동", "5.03": "정관 변경", "5.07": "주총 결과", "7.01": "Reg FD 공개", "8.01": "기타 주요 사항"}
FORM_KO = {"10-K": "연간 보고서", "10-Q": "분기 보고서", "8-K": "수시 공시", "DEF 14A": "주총 소집·임원 보수", "SC 13D": "5% 이상 지분(경영참여)", "SC 13G": "5% 이상 지분(단순투자)", "S-1": "상장 신고서"}

WATCH = [
    {"key": "musk", "name": "일론 머스크", "desc": "Tesla · SpaceX CEO", "cik": 1494730}, {"key": "bezos", "name": "제프 베이조스", "desc": "Amazon 창업자", "cik": 1043298},
    {"key": "zuckerberg", "name": "마크 저커버그", "desc": "Meta CEO", "cik": 1548760}, {"key": "buffett", "name": "워런 버핏", "desc": "Berkshire Hathaway", "cik": 1067983},
    {"key": "icahn", "name": "칼 아이칸", "desc": "Icahn Enterprises", "cik": 921669}, {"key": "ackman", "name": "빌 애크먼", "desc": "Pershing Square", "cik": 1336528},
    {"key": "huang", "name": "젠슨 황", "desc": "NVIDIA CEO", "issuer": "NVDA", "match": "huang"}, {"key": "ellison", "name": "래리 엘리슨", "desc": "Oracle 창업자", "issuer": "ORCL", "match": "ellison lawrence"},
    {"key": "cook", "name": "팀 쿡", "desc": "Apple CEO", "issuer": "AAPL", "match": "cook timothy"}, {"key": "nadella", "name": "사티아 나델라", "desc": "Microsoft CEO", "issuer": "MSFT", "match": "nadella satya"},
    {"key": "dimon", "name": "제이미 다이먼", "desc": "JPMorgan CEO", "issuer": "JPM", "match": "dimon james"}, {"key": "su", "name": "리사 수", "desc": "AMD CEO", "issuer": "AMD", "match": "su lisa"},
    {"key": "dell", "name": "마이클 델", "desc": "Dell 창업자", "issuer": "DELL", "match": "dell michael"}, {"key": "saylor", "name": "마이클 세일러", "desc": "Strategy(MSTR) 회장", "issuer": "MSTR", "match": "saylor michael"},
    {"key": "brin", "name": "세르게이 브린", "desc": "Alphabet 공동창업자", "issuer": "GOOGL", "match": "brin sergey"}, {"key": "page", "name": "래리 페이지", "desc": "Alphabet 공동창업자", "issuer": "GOOGL", "match": "page lawrence"},
]
FUNDS = [
    {"key": "berkshire", "name": "워런 버핏", "desc": "Berkshire Hathaway", "cik": 1067983}, {"key": "bridgewater", "name": "레이 달리오", "desc": "Bridgewater Associates", "cik": 1350694},
    {"key": "pershing", "name": "빌 애크먼", "desc": "Pershing Square", "cik": 1336528}, {"key": "scion", "name": "마이클 버리", "desc": "Scion Asset Management", "cik": 1649339},
    {"key": "soros", "name": "조지 소로스", "desc": "Soros Fund Management", "cik": 1029160}, {"key": "renaissance", "name": "제임스 사이먼스", "desc": "Renaissance Technologies", "cik": 1037389},
    {"key": "thirdpoint", "name": "댄 로엡", "desc": "Third Point", "cik": 1040273}, {"key": "duquesne", "name": "스탠리 드러켄밀러", "desc": "Duquesne Family Office", "cik": 1536411},
    {"key": "appaloosa", "name": "데이비드 테퍼", "desc": "Appaloosa", "cik": 1656456}, {"key": "icahn", "name": "칼 아이칸", "desc": "Icahn Enterprises", "cik": 921669},
]


class SecBlocked(Exception):
    pass


_last = [0.0]


def sec_get(url):
    if not SEC_UA:
        raise SecBlocked("SEC_USER_AGENT 미설정")
    w = 0.15 - (time.time() - _last[0])
    if w > 0:
        time.sleep(w)
    _last[0] = time.time()
    for i in range(2):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": SEC_UA, "Accept-Encoding": "identity"}), timeout=30) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (403, 429):
                raise SecBlocked("HTTP %d" % e.code)       # 우회하지 않고 즉시 중단
            if e.code >= 500 and i == 0:
                time.sleep(2); continue
            raise
        except Exception:
            if i == 0:
                time.sleep(1.5); continue
            raise


def sec_json(url):
    return json.loads(sec_get(url))


def web(url, data=None, headers=None, timeout=30):
    h = {"User-Agent": "puddle-trader/1.0 (personal research)"}
    h.update(headers or {})
    with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=h), timeout=timeout) as r:
        return r.read()


def load(name, default):
    p = os.path.join(OUT, name)
    try:
        return json.load(open(p, encoding="utf8"))
    except Exception:
        return default


def prev_from_site(name, default):
    if SITE:
        try:
            return json.loads(web(f"{SITE}/data/tracker/{name}", timeout=20))
        except Exception:
            pass
    return load(name, default)


def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def parse_form4(xml_text):
    root = ET.fromstring(xml_text)
    iss = root.find("issuer")
    info = {"issuer": (iss.findtext("issuerName") or "").strip() if iss is not None else "", "ticker": (iss.findtext("issuerTradingSymbol") or "").strip().upper() if iss is not None else "", "owners": [], "trades": []}
    for o in root.findall("reportingOwner"):
        rel = o.find("reportingOwnerRelationship"); roles = []
        if rel is not None:
            if rel.findtext("isOfficer") in ("1", "true"):
                roles.append((rel.findtext("officerTitle") or "임원").strip())
            if rel.findtext("isDirector") in ("1", "true"):
                roles.append("이사")
            if rel.findtext("isTenPercentOwner") in ("1", "true"):
                roles.append("10% 이상 주주")
        info["owners"].append({"name": (o.findtext("reportingOwnerId/rptOwnerName") or "").strip(), "role": ", ".join(roles) or "내부자"})
    fn = {f.get("id"): (f.text or "") for f in root.findall("footnotes/footnote")}
    flag = root.findtext("aff10b5One") in ("1", "true")
    for idx, t in enumerate(root.findall("nonDerivativeTable/nonDerivativeTransaction")):
        ids = [e.get("id") for e in t.iter("footnoteId")]
        planned = flag or any("10b5" in fn.get(i, "") for i in ids)
        info["trades"].append({"idx": idx, "security": (t.findtext("securityTitle/value") or "").strip(), "date": t.findtext("transactionDate/value"), "code": t.findtext("transactionCoding/transactionCode"),
                               "ad": t.findtext("transactionAmounts/transactionAcquiredDisposedCode/value"), "shares": _f(t.findtext("transactionAmounts/transactionShares/value")),
                               "price": _f(t.findtext("transactionAmounts/transactionPricePerShare/value")), "after": _f(t.findtext("postTransactionAmounts/sharesOwnedFollowingTransaction/value")),
                               "direct": t.findtext("ownershipNature/directOrIndirectOwnership/value"), "planned": bool(planned), "note": " ".join(fn.get(i, "") for i in ids).strip()[:400]})
    return info


def name_match(owner, match):
    toks = set(re.findall(r"[a-z]+", owner.lower()))
    return all(w in toks for w in match.lower().split())


def submissions(cik):
    return sec_json("https://data.sec.gov/submissions/CIK%010d.json" % int(cik))


def recent(sub):
    r = sub["filings"]["recent"]
    return [{k: r[k][i] for k in ("accessionNumber", "filingDate", "acceptanceDateTime", "form", "primaryDocument", "reportDate", "items") if k in r} for i in range(len(r["accessionNumber"]))]


_tmap = {}


def ticker_cik(t):
    if not _tmap:
        raw = sec_json("https://www.sec.gov/files/company_tickers.json")
        _tmap.update({v["ticker"].upper(): v["cik_str"] for v in raw.values()})
    return _tmap.get(t.upper())


def poll_person(e, seen, trades, log):
    cik = e.get("cik") or ticker_cik(e["issuer"])
    if not cik:
        log("CIK 없음 " + e["issuer"]); return 0
    cutoff = (dt.date.today() - dt.timedelta(days=BACKFILL)).isoformat()
    fl = [f for f in recent(submissions(cik)) if f["form"] in ("4", "4/A") and f["filingDate"] >= cutoff][: 40 if e.get("issuer") else 25]
    new = 0
    for f in fl:
        acc = f["accessionNumber"]; key = "f4|%s|%s" % (acc, e["key"])
        if key in seen:
            continue
        url = "https://www.sec.gov/Archives/edgar/data/%d/%s/%s" % (int(cik), acc.replace("-", ""), os.path.basename(f["primaryDocument"]))
        try:
            info = parse_form4(sec_get(url))
        except SecBlocked:
            raise
        except Exception as ex:
            log("Form4 파싱 실패 %s: %s" % (acc, str(ex)[:60])); continue
        owner = info["owners"][0] if info["owners"] else {"name": "", "role": "내부자"}
        if e.get("match"):
            hit = [o for o in info["owners"] if name_match(o["name"], e["match"])]
            if not hit:
                seen.add(key); continue
            owner = hit[0]
        filed = f.get("acceptanceDateTime") or f["filingDate"]
        for t in info["trades"]:
            code = t["code"] or "?"
            if not t["shares"]:
                continue
            tk = "" if info["ticker"] in ("N/A", "NONE") else info["ticker"]
            tid = "f4|%s|%d|%s" % (acc, t["idx"], e["key"])
            trades[tid] = {"id": tid, "source": "form4", "person_key": e["key"], "person": e["name"], "role": owner["role"], "ticker": tk, "issuer": info["issuer"], "security": t["security"],
                           "trade_date": t["date"], "filed_at": filed, "code": code, "side": "BUY" if code == "P" else "SELL" if code == "S" else "OTHER", "shares": t["shares"], "price": t["price"],
                           "value": (t["shares"] or 0) * (t["price"] or 0) or None, "owned_after": t["after"], "direct": t["direct"], "planned": int(t["planned"]), "acc": acc,
                           "url": "https://www.sec.gov/Archives/edgar/data/%d/%s/" % (int(cik), acc.replace("-", "")), "extra": t["note"]}
            new += 1
        seen.add(key)
    return new


def _tag(e):
    return e.tag.split("}")[-1]


def _txt(e, n):
    for c in e.iter():
        if _tag(c) == n and c.text:
            return c.text.strip()


def positions(cik, acc, period):
    base = "https://www.sec.gov/Archives/edgar/data/%d/%s/" % (int(cik), acc.replace("-", ""))
    files = sec_json(base + "index.json")["directory"]["item"]
    cand = [f for f in files if f["name"].lower().endswith(".xml") and f["name"] != "primary_doc.xml"]
    pick = [f for f in cand if "info" in f["name"].lower()] or sorted(cand, key=lambda f: -int(f.get("size") or 0))
    if not pick:
        raise RuntimeError("infotable 없음")
    root = ET.fromstring(sec_get(base + pick[0]["name"]))
    mult = 1000 if period < "2023-01-01" else 1
    pos = {}
    for it in root.iter():
        if _tag(it) != "infoTable":
            continue
        cusip, pc = _txt(it, "cusip"), _txt(it, "putCall") or ""
        p = pos.setdefault(cusip + pc, {"cusip": cusip, "name": _txt(it, "nameOfIssuer"), "putCall": pc, "value": 0.0, "shares": 0.0})
        p["value"] += float(_txt(it, "value") or 0) * mult; p["shares"] += float(_txt(it, "sshPrnamt") or 0)
    return list(pos.values())


def diff(cur, prev):
    total = sum(p["value"] for p in cur) or 1
    pm = {p["cusip"] + p["putCall"]: p for p in prev}; cm = {p["cusip"] + p["putCall"]: p for p in cur}; rows = []
    for k, p in cm.items():
        o = pm.get(k); px = p["value"] / p["shares"] if p["shares"] else 0
        if not o:
            st, d = "NEW", p["shares"]
        elif abs(p["shares"] - o["shares"]) / (o["shares"] or 1) < 0.005:
            st, d = "HOLD", 0
        else:
            d = p["shares"] - o["shares"]; st = "ADD" if d > 0 else "REDUCE"
        rows.append({**p, "status": st, "prev_shares": o["shares"] if o else 0, "d_shares": d, "d_value": d * px, "weight": p["value"] / total, "chg_pct": (d / o["shares"]) if o and o["shares"] else None})
    for k, o in pm.items():
        if k not in cm:
            rows.append({**o, "status": "SOLD", "prev_shares": o["shares"], "value": 0, "shares": 0, "d_shares": -o["shares"], "d_value": -o["value"], "weight": 0, "chg_pct": -1.0})
    rows.sort(key=lambda r: -abs(r["d_value"]))
    return rows, total


def figi(cusips, cache, log):
    """CUSIP → 티커: OpenFIGI(공개 매핑 API, 키 불필요·분당 25회). 이전 결과는 data/tracker/cusip.json 에 캐시."""
    todo = [c for c in dict.fromkeys(cusips) if c and c not in cache]
    for i in range(0, len(todo), 10):
        chunk = todo[i:i + 10]
        try:
            body = json.dumps([{"idType": "ID_CUSIP", "idValue": c} for c in chunk]).encode()
            res = json.loads(web("https://api.openfigi.com/v3/mapping", data=body, headers={"Content-Type": "application/json"}))
            for c, r in zip(chunk, res):
                t = ""
                for d in r.get("data", []) or []:
                    if d.get("securityType") in ("Common Stock", "ETP", "ADR", "REIT") and d.get("exchCode") in ("US", "UN", "UQ", "UA", "UR", "UW", "UP", "UV") and "/" not in d.get("ticker", ""):
                        t = d["ticker"]; break
                cache[c] = t
        except Exception as e:
            log("OpenFIGI 실패: %s" % str(e)[:60]); break
        time.sleep(2.6)


def poll_fund(fd, st, trades, cache, log):
    sub = submissions(fd["cik"]); fl = [f for f in recent(sub) if f["form"] == "13F-HR"]
    if not fl:
        return 0
    cur_f = fl[0]; acc = cur_f["accessionNumber"]
    if st["f13seen"].get(fd["key"]) == acc and fd["key"] in st["f13"]:
        return 0
    cur_p = cur_f.get("reportDate") or cur_f["filingDate"]
    cur = positions(fd["cik"], acc, cur_p); prev, prev_acc = [], None
    if len(fl) > 1:
        prev_acc = fl[1]["accessionNumber"]; prev = positions(fd["cik"], prev_acc, fl[1].get("reportDate") or fl[1]["filingDate"])
    rows, total = diff(cur, prev)
    top = sorted(cur, key=lambda p: -p["value"])[:15]
    figi([r["cusip"] for r in [x for x in rows if x["status"] != "HOLD"][:12]] + [r["cusip"] for r in rows[:60]] + [p["cusip"] for p in top], cache, log)
    for r in rows[:60]:
        r["ticker"] = cache.get(r["cusip"], "")
    for p in top:
        p["ticker"] = cache.get(p["cusip"], "")
    new = 0
    for r in [x for x in rows if x["status"] != "HOLD"][:12]:
        tid = "13f|%s|%s" % (acc, r["cusip"] + r["putCall"])
        trades[tid] = {"id": tid, "source": "13f", "person_key": fd["key"], "person": fd["name"], "role": fd["desc"], "ticker": cache.get(r["cusip"], ""), "issuer": r["name"],
                       "security": "PUT" if r["putCall"] == "Put" else "CALL" if r["putCall"] == "Call" else "주식", "trade_date": cur_p, "filed_at": cur_f["filingDate"], "code": r["status"],
                       "side": "BUY" if r["status"] in ("NEW", "ADD") else "SELL", "shares": abs(r["d_shares"]), "price": (r["value"] / r["shares"]) if r["shares"] else None, "value": abs(r["d_value"]),
                       "owned_after": r["shares"], "acc": acc, "url": "https://www.sec.gov/Archives/edgar/data/%d/%s/" % (int(fd["cik"]), acc.replace("-", "")),
                       "extra": "weight=%.4f;chg=%s;total=%.0f" % (r["weight"], r["chg_pct"], total), "ticker_src": "OpenFIGI(CUSIP)"}
        new += 1
    st["f13"][fd["key"]] = {"period": cur_p, "filed": cur_f["filingDate"], "prev_acc": prev_acc, "acc": acc, "total": total, "count": len(cur), "rows": rows[:60], "top_holdings": top}
    st["f13seen"][fd["key"]] = acc
    return new


def poll_house(trades, log):
    y = dt.date.today().year
    z = zipfile.ZipFile(io.BytesIO(web("https://disclosures-clerk.house.gov/public_disc/financial-pdfs/%dFD.zip" % y, timeout=60)))
    root = ET.fromstring(z.read("%dFD.xml" % y)); cutoff = dt.date.today() - dt.timedelta(days=90); n = 0
    for m in root.iter("Member"):
        if m.findtext("FilingType") != "P":
            continue
        try:
            mo, d, yy = [int(x) for x in m.findtext("FilingDate").split("/")]; fd = dt.date(yy, mo, d)
        except Exception:
            continue
        if fd < cutoff:
            continue
        name = ("%s %s" % (m.findtext("First") or "", m.findtext("Last") or "")).strip(); doc = m.findtext("DocID")
        trades["ptr|" + doc] = {"id": "ptr|" + doc, "source": "ptr", "person_key": "cg-" + name.lower().replace(" ", "-"), "person": name, "role": "하원 %s" % (m.findtext("StateDst") or ""),
                                "issuer": "정기거래보고서(PTR) 제출 — 종목·금액은 원문 PDF 확인", "trade_date": fd.isoformat(), "filed_at": fd.isoformat(), "code": "PTR", "side": "OTHER", "acc": doc,
                                "url": "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/%d/%s.pdf" % (yy, doc)}
        n += 1
    return n


def poll_fmp(trades, log):
    n = 0
    for chamber, ep in (("상원", "senate-latest"), ("하원", "house-latest")):
        rows = None
        for limit in (100, 50, 25, 10):
            try:
                rows = json.loads(web("https://financialmodelingprep.com/stable/%s?page=0&limit=%d&apikey=%s" % (ep, limit, urllib.parse.quote(FMP)))); break
            except Exception:
                continue
        if not isinstance(rows, list):
            log("FMP %s 조회 실패" % ep); continue
        for r in rows:
            sym = (r.get("symbol") or "").upper(); name = ("%s %s" % (r.get("firstName", ""), r.get("lastName", ""))).strip(); typ = (r.get("type") or "").lower()
            amt = [float(x.replace(",", "")) for x in re.findall(r"\$?([\d,]{4,})", r.get("amount") or "")][:2]
            raw = "|".join(str(r.get(k)) for k in ("symbol", "transactionDate", "firstName", "lastName", "type", "amount", "owner"))
            tid = "cg|" + hashlib.md5(raw.encode()).hexdigest()
            trades[tid] = {"id": tid, "source": "congress", "person_key": "cg-" + name.lower().replace(" ", "-"), "person": name, "role": "%s 의원%s" % (chamber, (" · " + r["district"]) if r.get("district") else ""),
                           "ticker": sym, "issuer": r.get("assetDescription") or sym, "security": r.get("assetType") or "", "trade_date": r.get("transactionDate"), "filed_at": r.get("disclosureDate") or r.get("transactionDate"),
                           "code": r.get("type"), "side": "BUY" if "purchase" in typ else "SELL" if "sale" in typ else "OTHER", "value": sum(amt) / len(amt) if amt else None, "direct": r.get("owner"),
                           "url": r.get("link"), "extra": "범위: " + (r.get("amount") or "")}
            n += 1
    return n


def company(tk):
    cik = ticker_cik(tk)
    if not cik:
        return None
    sub = submissions(cik); r = sub["filings"]["recent"]; out = []
    for i in range(len(r["accessionNumber"])):
        f = r["form"][i]
        if f not in ("10-K", "10-Q", "8-K", "DEF 14A", "SC 13D", "SC 13G", "SC 13D/A", "SC 13G/A", "S-1"):
            continue
        label = FORM_KO.get(f.split("/")[0], f)
        if f == "8-K" and r.get("items") and r["items"][i]:
            its = [ITEM_KO.get(x.strip(), x.strip()) for x in r["items"][i].split(",") if x.strip() != "9.01"]
            if its:
                label = "수시 공시 · " + ", ".join(its[:3])
        out.append({"form": f, "label": label, "date": r["filingDate"][i], "url": "https://www.sec.gov/Archives/edgar/data/%d/%s/%s" % (int(cik), r["accessionNumber"][i].replace("-", ""), r["primaryDocument"][i])})
        if len(out) >= 8:
            break
    return {"name": sub.get("name"), "sic": sub.get("sicDescription"), "filings": out, "t": int(time.time()),
            "edgar": "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=%d&type=&dateb=&owner=include&count=40" % int(cik)}


def main():
    log = lambda s: print(s, flush=True)
    os.makedirs(OUT, exist_ok=True)
    trades = {t["id"]: t for t in prev_from_site("trades.json", [])}
    state = prev_from_site("state.json", {})
    st = {"seen": set(state.get("seen", [])), "f13": prev_from_site("f13.json", {}), "f13seen": state.get("f13seen", {})}
    co = prev_from_site("co.json", {}); cache = prev_from_site("cusip.json", {})
    status = {"updated": int(time.time()), "sec": "skipped", "house": "skip", "fmp": "off", "new": 0, "notes": []}
    try:
        status["new"] += poll_house(trades, log); status["house"] = "ok"
    except Exception as e:
        status["house"] = "error"; status["notes"].append("하원 색인 실패: " + str(e)[:60])
    if FMP:
        try:
            status["new"] += poll_fmp(trades, log); status["fmp"] = "ok"
        except Exception as e:
            status["fmp"] = "error"
    try:
        for e in WATCH:
            status["new"] += poll_person(e, st["seen"], trades, log)
        for fd in FUNDS:
            status["new"] += poll_fund(fd, st, trades, cache, log)
        tks = [t for t, _ in sorted(((t["ticker"], t["filed_at"]) for t in trades.values() if t.get("ticker") and t["source"] in ("form4", "13f", "congress")), key=lambda x: x[1], reverse=True)]
        seq = [k for k in dict.fromkeys(tks)][:30]
        for tk in seq:
            if time.time() - co.get(tk, {}).get("t", 0) > 12 * 3600:
                c = company(tk)
                if c:
                    co[tk] = c
        status["sec"] = "ok"
    except SecBlocked as e:
        status["sec"] = "blocked"; status["notes"].append("SEC 접근 제한(%s) — 이전 데이터 유지, 다음 실행에서 재시도" % e)
    except Exception as e:
        status["sec"] = "error"; status["notes"].append("SEC 수집 오류: " + str(e)[:80])
    rows = sorted(trades.values(), key=lambda t: (t.get("filed_at") or "", t.get("trade_date") or ""), reverse=True)[:1500]
    dump = lambda n, o: json.dump(o, open(os.path.join(OUT, n), "w", encoding="utf8"), ensure_ascii=False, separators=(",", ":"))
    dump("trades.json", rows); dump("f13.json", st["f13"]); dump("co.json", co); dump("cusip.json", cache)
    dump("state.json", {"seen": sorted(st["seen"])[-4000:], "f13seen": st["f13seen"]}); dump("status.json", status)
    log("거물 거래: %d건 저장, 신규 %d, SEC=%s, 하원=%s, FMP=%s %s" % (len(rows), status["new"], status["sec"], status["house"], status["fmp"], status["notes"]))


if __name__ == "__main__":
    main()
