"""배포 전 data/ 아래 JSON 점검 — 읽히는지뿐 아니라 시세 파일(px)의 구조(길이 일치·오름차순·유한한 수), manifest↔px 일치, SPY 존재를 확인한다.
수집 도중 끊기거나 오염된 파일이 배포되는 것을 막는다. 실패 시 exit 1."""
import json, math, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
bad = []


def safe(sym):
    return sym.replace("^", "_").replace("/", "_")


for base, _, files in os.walk(DATA):
    for f in files:
        p = os.path.join(base, f)
        if f.endswith(".tmp"):
            bad.append(f"{os.path.relpath(p, ROOT)}: 임시 파일이 남아 있음")
        elif f.endswith(".json"):
            try:
                v = json.load(open(p, encoding="utf8"))
            except Exception as e:
                bad.append(f"{os.path.relpath(p, ROOT)}: {str(e)[:60]}")
                continue
            if v is None or v == {} or v == []:
                if not f.endswith(("trades.json", "co.json", "cusip.json", "f13.json", "state.json")):
                    bad.append(f"{os.path.relpath(p, ROOT)}: 비어 있음")

pxd = os.path.join(DATA, "px")
if os.path.isdir(pxd):
    for f in os.listdir(pxd):
        if not f.endswith(".json"):
            continue
        try:
            v = json.load(open(os.path.join(pxd, f), encoding="utf8"))
            d, c = v["d"], v["c"]
            if len(d) != len(c) or len(d) < 20:
                bad.append(f"px/{f}: 길이 불일치 또는 20개 미만")
            elif d != sorted(set(d)):
                bad.append(f"px/{f}: 날짜가 오름차순이 아니거나 중복")
            elif not all(isinstance(x, (int, float)) and math.isfinite(x) for x in c):
                bad.append(f"px/{f}: 가격에 비정상 값")
        except Exception as e:
            bad.append(f"px/{f}: {str(e)[:60]}")
    mp = os.path.join(DATA, "manifest.json")
    if os.path.exists(mp):
        try:
            man = json.load(open(mp, encoding="utf8"))
            miss = [s for s in man.get("symbols", {}) if not os.path.exists(os.path.join(pxd, safe(s) + ".json"))]
            if miss:
                bad.append("manifest 에 있으나 px 파일이 없음: " + ", ".join(miss[:5]))
        except Exception as e:
            bad.append(f"manifest: {str(e)[:60]}")
    if not os.path.exists(os.path.join(pxd, "SPY.json")):
        bad.append("px/SPY.json 이 없음(시장 지표의 기준)")
if bad:
    print("데이터 점검 실패:", *bad, sep="\n  ")
    sys.exit(1)
print("데이터 JSON 점검 통과")
