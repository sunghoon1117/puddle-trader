"""공식 경제 일정 수집 → data/calendar.json (한국시간 환산, [확정] 표기).
  - 연준(FOMC 회의 일정): federalreserve.gov 공개 페이지
  - 미 노동통계국(BLS): CPI·PPI·고용보고서·JOLTS — 공식 달력 파일(ICS)
  (경제분석국 GDP·PCE 일정은 페이지가 스크립트로 렌더링되어 자동 수집이 불가 → 제외)
요청은 신원을 밝힌 User-Agent 로 하루 몇 번만 호출한다.
"""
import datetime as dt, json, os, re, sys, time, urllib.request
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "calendar.json")
UA = {"User-Agent": "DevelopApp personal-research (official calendar fetch)"}
ET, KST = ZoneInfo("America/New_York"), ZoneInfo("Asia/Seoul")
MONTHS = {m: i + 1 for i, m in enumerate(["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"])}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return r.read().decode("utf8", "ignore")


def ev(d_et, title, src, imp, label):
    k = d_et.astimezone(KST)
    return {"d": k.strftime("%Y-%m-%d"), "t": k.strftime("%H:%M"), "et": d_et.strftime("%Y-%m-%d %H:%M") + " ET", "title": title, "src": src, "imp": imp, "tag": "[확정]", "ev": label}


def fomc():
    html = get("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"); out = []
    for m in re.finditer(r'<a id="\d+">(\d{4}) FOMC Meetings</a>(.*?)(?=<a id="\d+">\d{4} FOMC Meetings</a>|$)', html, re.S):
        year = int(m.group(1))
        for mm in re.finditer(r'fomc-meeting__month[^>]*><strong>([^<]+)</strong>.*?fomc-meeting__date[^>]*>([^<]+)<', m.group(2), re.S):
            names, days = mm.group(1).strip(), re.sub(r"[^0-9\-]", "", mm.group(2))
            mon = [MONTHS[x] for x in re.split(r"[/\s]+", names) if x in MONTHS]
            if not mon or not days:
                continue
            end = int(days.split("-")[-1]); month = mon[-1]
            out.append(ev(dt.datetime(year, month, end, 14, 0, tzinfo=ET), "미 FOMC 금리 결정·성명(14:00 ET)", "연준", "높음", "FOMC"))
    return out


NAMES = [(r"Consumer Price Index", "미국 소비자물가지수(CPI)", "높음"), (r"Employment Situation", "미국 고용보고서(비농업 고용·실업률)", "높음"),
         (r"Producer Price Index", "미국 생산자물가(PPI)", "보통"), (r"Job Openings and Labor Turnover", "미국 구인·이직(JOLTS)", "보통")]


def bls():
    txt = get("https://www.bls.gov/schedule/news_release/bls.ics").replace("\r", ""); txt = re.sub(r"\n[ \t]", "", txt); out = []
    for blk in re.findall(r"BEGIN:VEVENT(.*?)END:VEVENT", txt, re.S):
        s = re.search(r"SUMMARY:(.*)", blk); d = re.search(r"DTSTART[^:]*:(\d{8})(?:T(\d{6}))?", blk)
        if not s or not d:
            continue
        for rx, ko, imp in NAMES:
            if re.search(rx, s.group(1), re.I):
                ymd, hms = d.group(1), d.group(2) or "083000"
                out.append(ev(dt.datetime(int(ymd[:4]), int(ymd[4:6]), int(ymd[6:]), int(hms[:2]), int(hms[2:4]), tzinfo=ET), ko, "미 노동통계국", imp, ko[:6]))
                break
    return out


def main():
    events, notes = [], []
    for name, fn in (("FOMC", fomc), ("BLS", bls)):
        try:
            events += fn()
        except Exception as e:
            notes.append(f"{name} 수집 실패: {str(e)[:60]}")
    now = dt.datetime.now(KST).date()
    lo, hi = (now - dt.timedelta(days=3)).isoformat(), (now + dt.timedelta(days=75)).isoformat()
    events = sorted([e for e in events if lo <= e["d"] <= hi], key=lambda e: (e["d"], e["t"]))
    prev = []
    try:
        prev = json.load(open(OUT, encoding="utf8")).get("events", [])
    except Exception:
        pass
    if not events and prev:                      # 수집이 전부 실패하면 이전 값 유지
        events = prev
    json.dump({"updated": int(time.time()), "events": events, "notes": notes}, open(OUT, "w", encoding="utf8"), ensure_ascii=False, separators=(",", ":"))
    print(f"캘린더 {len(events)}건 {notes}")


if __name__ == "__main__":
    main()
