"""두 유튜브 채널의 '모든' 영상 자막을 이어받기 방식으로 수집한다.
  python collect_subs.py <OUT_DIR> [workers=4]
- 이미 받은 영상은 건너뛰므로 중단/재실행해도 이어서 진행(유튜브가 제한하면 대기 후 재시도).
- 새 영상이 올라오면 다시 실행하기만 하면 추가분만 받는다.
- OUT_DIR/txt/<id>.txt (정리된 자막), OUT_DIR/meta/<id>.json (제목·날짜·조회수)
"""
import sys, os, re, json, time, glob, subprocess, multiprocessing as mp

CHANNELS = {"dm": "developmong", "doki": "doki_investing"}
TABS = ["videos", "streams", "shorts"]


def list_ids(out):
    os.makedirs(out + "/lists", exist_ok=True)
    res = {}
    for key, handle in CHANNELS.items():
        ids = []
        for tab in TABS:
            f = f"{out}/lists/{key}_{tab}.txt"
            if not os.path.exists(f) or time.time() - os.path.getmtime(f) > 3600:
                r = subprocess.run([sys.executable, "-m", "yt_dlp", "--flat-playlist", "--print", "id",
                                    f"https://www.youtube.com/@{handle}/{tab}"], capture_output=True, text=True)
                if r.stdout.strip():
                    open(f, "w").write(r.stdout)
            if os.path.exists(f):
                ids += [x.strip() for x in open(f) if x.strip()]
        res[key] = list(dict.fromkeys(ids))
    return res


def vtt_to_text(path):
    seen, out = set(), []
    for ln in open(path, encoding="utf8", errors="ignore"):
        ln = re.sub(r"<[^>]+>", "", ln).strip()
        if not ln or ln.startswith(("WEBVTT", "Kind", "Language")) or "-->" in ln or ln in seen:
            continue
        seen.add(ln)
        out.append(ln)
    return " ".join(out)


def rebuild(out):
    try:
        subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "build_knowledge.py"), out], timeout=600, capture_output=True)
    except Exception:
        pass


def work(args):
    out, ch, vid = args
    import yt_dlp
    tmp = f"{out}/tmp"
    os.makedirs(tmp, exist_ok=True)
    opts = dict(quiet=True, no_warnings=True, skip_download=True, writeautomaticsub=True, writesubtitles=True,
                subtitleslangs=["ko-orig", "ko"], subtitlesformat="vtt", outtmpl=f"{tmp}/%(id)s", retries=3,
                extractor_retries=3, sleep_interval_requests=0.4)
    try:
        with yt_dlp.YoutubeDL(opts) as y:
            info = y.extract_info(f"https://www.youtube.com/watch?v={vid}", download=True)
    except Exception as e:
        msg = str(e)
        if "429" in msg or "Too Many" in msg or "Sign in" in msg or "bot" in msg.lower():
            return (vid, "limited")
        if "Private" in msg or "unavailable" in msg or "removed" in msg or "members-only" in msg.lower():
            json.dump({"id": vid, "ch": ch, "error": "unavailable"}, open(f"{out}/meta/{vid}.json", "w", encoding="utf8"))
            return (vid, "skip")
        return (vid, "error")
    files = glob.glob(f"{tmp}/{vid}.ko-orig.vtt") or glob.glob(f"{tmp}/{vid}.ko*.vtt")
    txt = ""
    if files:
        txt = vtt_to_text(files[0])
        open(f"{out}/txt/{vid}.txt", "w", encoding="utf8").write(txt)
    for f in glob.glob(f"{tmp}/{vid}.*"):
        try:
            os.remove(f)
        except OSError:
            pass
    json.dump({"id": vid, "ch": ch, "title": info.get("title"), "date": info.get("upload_date"),
               "dur": info.get("duration"), "views": info.get("view_count"), "chars": len(txt),
               "live": bool(info.get("was_live"))}, open(f"{out}/meta/{vid}.json", "w", encoding="utf8"), ensure_ascii=False)
    return (vid, "ok" if txt else "nosub")


def main():
    out = os.path.abspath(sys.argv[1])
    workers = int(sys.argv[2]) if len(sys.argv) > 2 else 4
    for d in ("txt", "meta", "tmp"):
        os.makedirs(f"{out}/{d}", exist_ok=True)
    log = open(f"{out}/log.txt", "a", encoding="utf8")
    fails = {}
    while True:
        lists = list_ids(out)
        todo = [(out, ch, v) for ch, ids in lists.items() for v in ids
                if not os.path.exists(f"{out}/meta/{v}.json") and fails.get(v, 0) < 4]
        total = sum(len(v) for v in lists.values())
        if not todo:
            rebuild(out)
            log.write(f"{time.ctime()} 완료: {total}개 목록 처리됨\n"); log.flush(); break
        log.write(f"{time.ctime()} 남음 {len(todo)}/{total}\n"); log.flush()
        limited = 0; done = 0
        with mp.Pool(workers) as p:
            for vid, st in p.imap_unordered(work, todo, chunksize=1):
                done += 1
                if done % 150 == 0:
                    rebuild(out)            # 진행 중에도 앱 지식(data/knowledge.json)을 주기적으로 갱신
                if st in ("limited", "error"):
                    fails[vid] = fails.get(vid, 0) + 1
                if st == "limited":
                    limited += 1
                    if limited >= 3:
                        p.terminate(); break
        rebuild(out)
        if limited >= 3:
            log.write(f"{time.ctime()} 유튜브 제한 감지 → 5분 대기 후 재개\n"); log.flush()
            time.sleep(300)


if __name__ == "__main__":
    mp.freeze_support()
    main()
