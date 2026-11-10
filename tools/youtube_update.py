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


def feed(cid):
    ns = {"a": "http://www.w3.org/2005/Atom", "y": "http://www.youtube.com/xml/schemas/2015"}
    root = ET.fromstring(web(f"https://www.youtube.com/feeds/videos.xml?channel_id={cid}"))
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
    # 제목만 반영돼 있던 영상(sub=0)도 자막으로 보강 재시도
    retry = [r for r in rec.values() if not r.get("sub")][:MAX_SUB]
    todo = (new + [{"id": r["id"], "title": r["title"], "date": r["date"], "ch": r["ch"], "retry": True} for r in retry])[:MAX_SUB + len(new)]
    blocked = 0
    for e in todo:
        txt = subtitle_text(e["id"]) if blocked < 2 else None
        if txt is None:
            blocked += 1
        t = bk.analyze_video(txt or "", e["title"])
        row = {"id": e["id"], "ch": e["ch"], "date": e["date"], "title": e["title"], "sub": 1 if txt else 0, "t": t}
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
