"""공식 거시 데이터 수집 → data/macro.json
  - 미 재무부 일일 국채금리(2년·10년·3개월 등): home.treasury.gov 공개 CSV  (미 2년물은 야후에 없음)
  - 미 연준 FRED 공개 CSV(키 불필요, 느릴 수 있어 시간 제한·재시도·개별 실패 허용):
      하이일드 스프레드(BAMLH0A0HYM2), 10년 실질금리(DFII10), 금융여건(NFCI), 연준 대차대조표(WALCL),
      신규 실업수당(ICSA), 실업률(UNRATE)
일부만 성공해도 저장하고, 전부 실패하면 이전 값을 유지한다. 신원을 밝힌 User-Agent 로 하루 몇 번만 호출.
"""
import csv, io, json, os, sys, time, urllib.request, datetime as dt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "macro.json")
UA = {"User-Agent": "DevelopApp personal-research (public macro data fetch)"}
FRED = {"BAMLH0A0HYM2": 1, "DFII10": 1, "NFCI": 6, "WALCL": 6, "ICSA": 6, "UNRATE": 35}   # id: 발표 지연(일) — 과거 값 사용 시 미래 참조 방지용


def get(url, timeout):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read().decode("utf8", "ignore")


def treasury(years):
    ser = {"T3M": ([], []), "T2Y": ([], []), "T5Y": ([], []), "T10Y": ([], []), "T30Y": ([], [])}
    cols = {"T3M": "3 Mo", "T2Y": "2 Yr", "T5Y": "5 Yr", "T10Y": "10 Yr", "T30Y": "30 Yr"}
    for y in years:
        url = f"https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/{y}/all?type=daily_treasury_yield_curve&field_tdr_date_value={y}&page&_format=csv"
        rows = list(csv.DictReader(io.StringIO(get(url, 60))))
        for r in sorted(rows, key=lambda r: dt.datetime.strptime(r["Date"], "%m/%d/%Y")):
            d = dt.datetime.strptime(r["Date"], "%m/%d/%Y").strftime("%Y-%m-%d")
            for k, c in cols.items():
                try:
                    v = float(r[c])
                except (KeyError, ValueError):
                    continue
                ser[k][0].append(d); ser[k][1].append(v)
    return {k: {"d": a, "v": b, "lag": 1} for k, (a, b) in ser.items() if a}


def fred(sid, lag):
    last = None
    for i in range(2):
        try:
            txt = get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd={(dt.date.today() - dt.timedelta(days=1100)).isoformat()}", 70)
            rows = list(csv.reader(io.StringIO(txt)))[1:]
            d = [r[0] for r in rows if len(r) > 1 and r[1] not in ("", ".")]; v = [float(r[1]) for r in rows if len(r) > 1 and r[1] not in ("", ".")]
            if len(d) > 5:
                return {"d": d, "v": v, "lag": lag}
        except Exception as e:
            last = e; time.sleep(3)
    raise last or RuntimeError("no data")


def main():
    prev = {}
    try:
        prev = json.load(open(OUT, encoding="utf8"))
    except Exception:
        pass
    series, notes = dict(prev.get("series", {})), []
    y = dt.date.today().year
    try:
        series.update(treasury([y - 1, y]))
    except Exception as e:
        notes.append("재무부 수집 실패: " + str(e)[:50])
    for sid, lag in FRED.items():
        try:
            series[sid] = fred(sid, lag)
        except Exception as e:
            notes.append(f"FRED {sid} 실패: {str(e)[:40]}")
    json.dump({"updated": int(time.time()), "series": series, "notes": notes}, open(OUT, "w", encoding="utf8"), separators=(",", ":"), ensure_ascii=False)
    print("거시:", {k: (v["d"][-1], v["v"][-1]) for k, v in series.items()}, notes)


if __name__ == "__main__":
    main()
