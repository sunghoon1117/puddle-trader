"""배포 전 data/ 아래 모든 JSON 이 읽히는지 확인한다(수집 도중 끊겨 잘린 파일이 배포되는 것을 막음). 실패 시 exit 1."""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bad = []
for base, _, files in os.walk(os.path.join(ROOT, "data")):
    for f in files:
        if f.endswith(".json"):
            p = os.path.join(base, f)
            try:
                json.load(open(p, encoding="utf8"))
            except Exception as e:
                bad.append(f"{os.path.relpath(p, ROOT)}: {str(e)[:60]}")
if bad:
    print("읽을 수 없는 JSON:", *bad, sep="\n  ")
    sys.exit(1)
print("데이터 JSON 점검 통과")
