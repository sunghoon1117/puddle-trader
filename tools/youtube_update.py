"""두 채널의 '새 영상'을 자동으로 찾아 분석해 data/knowledge.json 에 반영한다 (GitHub Actions 에서 30분마다 실행).
  1) 공식 RSS(채널 피드)로 새 영상 발견 — 어디서나 동작
  2) 자막 분석 시도(yt-dlp). 유튜브가 데이터센터 IP 를 봇으로 막으면 우회하지 않고 '제목 분석'으로 먼저 반영,
     다음 실행(또는 PC 의 tools/sync_knowledge.bat)에서 자막으로 보강
SITE_URL 이 있으면 이전에 배포된 knowledge.json 을 이어받아 증분 처리한다.
"""
import json, os, re, sys, tempfile, time, glob, urllib.request
import xml.etree.ElementTree as ET

sys.argv = sys.argv[:1]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import build_knowledge as bk  # noqa: E402

PATH = os.path.join(ROOT, "data", "knowledge.json")
CH = {"dm": "UCvrOll07bwpNzGhBHRB5_yw", "doki": "UCvGvjYJAr6ByOocCboX-c_w"}
SITE = os.environ.get("SITE_URL", "").rstrip("/")
UA = {"User-Agent": "puddle-trader/1.0 (personal research)"}
MAX_SUB = 12


def web(url, timeout=30):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


def feed_fallback(cid):
    """RSS 가 일시적으로 404/오류일 때: 채널 영상 탭에서 최근 10개를 목록으로만 읽음(우회 아님, 공개 페이지)."""
    import yt_dlp
    with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "extract_flat": True, "playlistend": 10}) as y:
        info = y.extract_info(f"https://www.youtube.com/channel/{cid}/videos", download=False)
    today = time.strftime("%Y-%m-%d")
    return [{"id": e["id"], "title": e.get("title") or "", "date": today} for e in (info.get("entries") or []) if e.get("id")]


def feed(cid):
    ns = {"a": "http://www.w3.org/2005/Atom", "y": "http://www.youtube.com/xml/schemas/2015"}
    root = None
    for i in range(3):                                        # 일시 오류 대비 재시도(점점 길게 대기)
        try:
            root = ET.fromstring(web(f"https://www.youtube.com/feeds/videos.xml?channel_id={cid}"))
            break
        except Exception:
            time.sleep(3 * (i + 1))
    if root is None:
        return feed_fallback(cid)
    return [{"id": e.findtext("y:videoId", namespaces=ns), "title": e.findtext("a:title", namespaces=ns) or "", "date": (e.findtext("a:published", namespaces=ns) or "")[:10]} for e in root.findall("a:entry", ns)]


def subtitle_text(vid):
    """자막(한국어 자동자막) 텍스트. 실패하면 None — 우회 시도 없음."""
    try:
        import yt_dlp
    except Exception:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        opts = dict(quiet=True, no_warnings=True, skip_download=True, writeautomaticsub=True, writesubtitles=True, subtitleslangs=["ko-orig", "ko"], subtitlesformat="vtt",
                    outtmpl=os.path.join(tmp, "%(id)s"), retries=1, extractor_retries=1)
        try:
            with yt_dlp.YoutubeDL(opts) as y:
                y.extract_info(f"https://www.youtube.com/watch?v={vid}", download=True)
        except Exception:
            return None
        fs = glob.glob(os.path.join(tmp, vid + ".ko-orig.vtt")) or glob.glob(os.path.join(tmp, vid + ".ko*.vtt"))
        return bk.vtt_text(fs[0]) if fs else None


AI_TOKEN = os.environ.get("AI_TOKEN", "").strip()
GV_PROMPT = ('이 영상은 한국어 주식 투자 유튜브 영상이다. 영상에서 실제로 말한 내용만 근거로, 설명 없이 JSON 한 개만 출력하라. '
             '형식: {"summary":"핵심 내용 2문장(150자 이내, 숫자는 영상에서 말한 것만)","tickers":{"티커":{"mentions":언급횟수,"bull":우호표현수,"bear":경계표현수}}}. '
             '티커는 영상에서 언급된 미국 종목·ETF의 대문자 티커만(예: SOXL, TSLA, QQQ), 없으면 빈 객체.')


def worker_url():
    try:
        return json.load(open(os.path.join(ROOT, "data", "live.json"), encoding="utf8")).get("live", "").rstrip("/")
    except Exception:
        return ""


def gemini_video(vid, text=None):
    """워커의 Gemini 로 영상을 직접 분석(자막이 막혀도 가능). 토큰이 없으면 None. 반환: (summary, tickers) 또는 None"""
    base = worker_url()
    if not AI_TOKEN or not base:
        return None
    body = {"system": "당신은 한국어 주식 유튜브 영상 분석가다. 영상(또는 자막)에서 실제로 말한 내용만 쓰고 지어내지 않는다.", "prompt": GV_PROMPT if not text else GV_PROMPT + "\n\n[자막]\n" + text[:14000]}
    if not text:
        body["video"] = vid
    try:
        req = urllib.request.Request(base + "/api/ai", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-ai-token": AI_TOKEN, "User-Agent": "puddle-trader/1.0"})
        j = json.loads(urllib.request.urlopen(req, timeout=150).read())
        if j.get("engine") != "gemini":
            return None                                   # 무료 대체 AI 는 영상을 못 보므로 사용하지 않음
        m = re.search(r"\{.*\}", j.get("text", ""), re.S)
        d = json.loads(m.group(0)) if m else {}
        tk = {k.upper(): [int(v.get("mentions", 0)), int(v.get("bull", 0)), int(v.get("bear", 0))] for k, v in (d.get("tickers") or {}).items() if re.fullmatch(r"[A-Z]{1,6}", k.upper()) and isinstance(v, dict)}
        return (str(d.get("summary", ""))[:220], tk)
    except Exception:
        return None


def main():
    cands = []
    for src in ([f"{SITE}/data/knowledge.json"] if SITE else []) + [PATH]:   # 배포본(Actions 가 앞서 반영한 것)과 저장소 파일(PC 가 push 한 것)을 모두 읽어 병합
        try:
            cands.append(json.loads(web(src, 30)) if src.startswith("http") else json.load(open(src, encoding="utf8")))
        except Exception:
            continue
    if not cands:
        print("knowledge.json 없음 — 건너뜀"); return
    kn = max(cands, key=lambda k: k.get("built", ""))
    vids = {v[0]: v for c in cands for v in c.get("videos", [])}
    kn["videos"] = list(vids.values())
    have = set(vids); rec = {}
    for c in cands:                                           # 같은 영상이면 자막 분석(sub=1)본을 우선
        for r in c.get("recent", []):
            if r["id"] not in rec or (r.get("sub") and not rec[r["id"]].get("sub")):
                rec[r["id"]] = r
    new, notes = [], []
    for ch, cid in CH.items():
        try:
            for e in feed(cid):
                if e["id"] not in have:
                    new.append({**e, "ch": ch})
        except Exception as ex:
            notes.append(f"RSS {ch} 실패: {str(ex)[:50]}")
    # 휴대폰에서 지정한 영상(Actions 수동 실행 입력칸의 URL/ID) 즉시 분석
    m = re.search(r"(?:v=|youtu\.be/|shorts/|^)([\w-]{11})(?:[?&#]|$)", os.environ.get("VIDEO", "").strip())
    if m and m.group(1) not in have:
        vid = m.group(1); title, date, ch = "", time.strftime("%Y-%m-%d"), "etc"
        try:
            import yt_dlp
            with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True}) as y:
                inf = y.extract_info(f"https://www.youtube.com/watch?v={vid}", download=False)
            title = inf.get("title") or ""; d = inf.get("upload_date") or ""; date = f"{d[:4]}-{d[4:6]}-{d[6:]}" if d else date
            ch = next((k for k, v in CH.items() if v == inf.get("channel_id")), "etc")
        except Exception as ex:
            notes.append("지정 영상 메타 조회 실패: " + str(ex)[:50])
        new.append({"id": vid, "title": title or vid, "date": date, "ch": ch})
    # 제목만 반영돼 있던 영상(sub=0)도 자막으로 보강 재시도
    retry = [r for r in rec.values() if not r.get("sub")][:MAX_SUB]
    todo = (new + [{"id": r["id"], "title": r["title"], "date": r["date"], "ch": r["ch"], "retry": True} for r in retry])[:MAX_SUB + len(new)]
    blocked = 0; gcalls = 0
    for e in todo:
        txt = subtitle_text(e["id"]) if blocked < 2 else None
        if txt is None:
            blocked += 1
        t = bk.analyze_video(txt or "", e["title"]); summ = (rec.get(e["id"]) or {}).get("sum", ""); level = 1 if txt else 0
        if gcalls < 8 and (not txt or not summ):          # 자막이 없으면 영상을 직접 분석, 자막이 있으면 요약만(무료 한도 보호: 실행당 8회)
            g = gemini_video(e["id"], txt)
            gcalls += 1
            if g:
                summ = g[0] or summ
                if not txt and g[1]:
                    t = g[1]; level = 2                 # 2 = Gemini 영상 분석
        row = {"id": e["id"], "ch": e["ch"], "date": e["date"], "title": e["title"], "sub": level, "t": t, "sum": summ}
        rec[e["id"]] = row
        if not e.get("retry"):
            kn["videos"].insert(0, [e["id"], e["ch"], e["date"], e["title"]]); have.add(e["id"])
        time.sleep(1.0)
    kn["recent"] = sorted(rec.values(), key=lambda r: r["date"], reverse=True)[:400]
    kn["videos"].sort(key=lambda v: v[2], reverse=True)
    for ch in kn["channels"]:
        kn["channels"][ch]["total"] = sum(1 for v in kn["videos"] if v[1] == ch)
    kn["built"] = time.strftime("%Y-%m-%d %H:%M"); kn["auto"] = {"new": len(new), "sub": sum(1 for e in todo if rec[e["id"]]["sub"]), "title_only": sum(1 for e in todo if not rec[e["id"]]["sub"]), "notes": notes}
    json.dump(kn, open(PATH, "w", encoding="utf8"), ensure_ascii=False, separators=(",", ":"))
    print(f"새 영상 {len(new)}개 처리(자막 {kn['auto']['sub']}, 제목만 {kn['auto']['title_only']}) {notes}")


if __name__ == "__main__":
    main()
