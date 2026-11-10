"""수집된 자막(collect_subs.py 결과)에서 앱이 쓰는 지식 파일 data/knowledge.json 을 만든다.
  python tools/build_knowledge.py <SUBS_DIR>
- 채널별 '어떤 신호를 얼마나 강조하는지'(1,000자당 언급 수)
- 최근 30일 종목별 언급 빈도·우호/경계 표현 수(참고용, 점수에는 반영하지 않음)
- 전체 영상 목록(제목·날짜) → 앱의 영상 검색
새 영상이 수집될 때마다 다시 실행하면 자동으로 반영된다.
"""
import sys, os, re, json, time, glob
from collections import defaultdict

SUBS = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "puddle-data")
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "knowledge.json")

SIG = {
    "낙폭·웅덩이": r"웅덩이|고점 대비|낙폭|하락률",
    "200일/200주선": r"200일|200주|이평선|이동평균",
    "RSI·과매도/과매수": r"RSI|과매도|과매수",
    "MACD·골든크로스": r"MACD|맥디|골든 ?크로스",
    "VIX·공포": r"VIX|변동성 지수|공포",
    "현금 비중": r"현금 ?비중|현금",
    "분할 매수": r"분할 ?매수|분할",
    "적정주가·밸류에이션": r"적정 ?주가|밸류에이션|멀티플|저평가|고평가",
    "영업현금흐름": r"영업 ?현금|현금 ?흐름",
    "레버리지": r"레버리지|두 ?배|세 ?배|3배",
    "손절": r"손절",
    "익절·분할매도": r"익절|분할 ?매도",
    "금리·매크로": r"금리|FOMC|인플레이션|연준",
    "계절성": r"계절성|중간 ?선거",
    "옵션·콜월": r"옵션|콜월|만기",
    "구루·13F": r"13F|버핏|구루",
    "내부자 매수": r"내부자",
}
TICK = {
    "SOXL": r"SOXL|SXL|속슬|쏙슬|소슬|반도체 ?3배|세 ?배 ?반도체", "USD": r"반도체 ?두 ?배|두 ?배 ?USD|\bUSD\b", "TQQQ": r"TQQQ|티큐|나스닥 ?3배", "QLD": r"QLD|큐엘디",
    "QQQ": r"QQQ|나스닥", "SPY": r"S&P|SMP|에스앤피|SPY", "SOXX": r"SOXX|반도체", "NVDA": r"엔비디아|NVDA", "TSLA": r"테슬라|TSLA", "AMZN": r"아마존|AMZN",
    "MSFT": r"마이크로소프트|MSFT", "META": r"메타|META", "GOOGL": r"구글|알파벳|GOOGL",
}
BULL = re.compile(r"매수|비중 ?확대|기회|저점|반등|상승|담|모아")
BEAR = re.compile(r"매도|익절|위험|조심|폭락|하락 ?가능|과열|고점|정리")


def main():
    metas = {}
    for f in glob.glob(f"{SUBS}/meta/*.json"):
        try:
            m = json.load(open(f, encoding="utf8"))
        except Exception:
            continue
        if m.get("error"):
            continue
        metas[m["id"]] = m
    chans = {"dm": {"name": "웅덩이 매매법 (developmong)", "total": 0, "withSub": 0, "dates": [], "chars": 0, "cnt": defaultdict(int)},
             "doki": {"name": "도키 투자 (doki_investing)", "total": 0, "withSub": 0, "dates": [], "chars": 0, "cnt": defaultdict(int)}}
    sigre = {k: re.compile(v) for k, v in SIG.items()}
    tkre = {k: re.compile(v) for k, v in TICK.items()}
    dates = [m.get("date") for m in metas.values() if m.get("date")]
    newest = max(dates) if dates else time.strftime("%Y%m%d")
    cutoff = time.strftime("%Y%m%d", time.localtime(time.mktime(time.strptime(newest, "%Y%m%d")) - 30 * 86400))
    stance = {"dm": defaultdict(lambda: {"m30": 0, "bull": 0, "bear": 0}), "doki": defaultdict(lambda: {"m30": 0, "bull": 0, "bear": 0})}
    videos = []
    for vid, m in metas.items():
        ch = m["ch"]; c = chans[ch]; c["total"] += 1
        d = m.get("date") or ""
        if d:
            c["dates"].append(d)
        videos.append([vid, ch, f"{d[:4]}-{d[4:6]}-{d[6:]}" if d else "", m.get("title") or ""])
        p = f"{SUBS}/txt/{vid}.txt"
        if not os.path.exists(p):
            continue
        txt = open(p, encoding="utf8").read()
        c["withSub"] += 1; c["chars"] += len(txt)
        for k, rx in sigre.items():
            c["cnt"][k] += len(rx.findall(txt))
        if d >= cutoff:
            sents = re.split(r"(?<=[.?!])\s+", txt)
            for t, rx in tkre.items():
                hit = [s for s in sents if rx.search(s)]
                if len(hit) >= 3:
                    st = stance[ch][t]; st["m30"] += 1
                    st["bull"] += sum(len(BULL.findall(s)) for s in hit); st["bear"] += sum(len(BEAR.findall(s)) for s in hit)
    out = {"built": time.strftime("%Y-%m-%d %H:%M"), "channels": {}, "signals": {"dm": {}, "doki": {}}, "stance": {"dm": {}, "doki": {}}}
    for ch, c in chans.items():
        ds = sorted(x for x in c["dates"] if x)
        out["channels"][ch] = {"name": c["name"], "total": c["total"], "withSub": c["withSub"],
                               "from": f"{ds[0][:4]}-{ds[0][4:6]}" if ds else "", "to": f"{ds[-1][:4]}-{ds[-1][4:6]}" if ds else ""}
        for k in SIG:
            out["signals"][ch][k] = round(c["cnt"][k] / max(1, c["chars"]) * 1000, 2)
        out["stance"][ch] = {t: dict(v) for t, v in stance[ch].items()}
    videos.sort(key=lambda v: v[2], reverse=True)
    out["videos"] = videos
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w", encoding="utf8"), ensure_ascii=False, separators=(",", ":"))
    print("영상", len(videos), "자막", {k: v["withSub"] for k, v in out["channels"].items()}, "->", OUT)


if __name__ == "__main__":
    main()
