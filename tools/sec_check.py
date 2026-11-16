"""SEC EDGAR 접근 점검 — 이 PC(또는 이 네트워크)에서 SEC 가 요청을 받아주는지만 확인한다.
  set SEC_USER_AGENT=앱이름 연락처이메일      (예: puddle-trader 내이메일@example.com)
  python tools/sec_check.py
- 상태 코드와 SEC 가 돌려준 안내문 첫 줄만 출력한다(연락처 값은 출력하지 않는다).
- 요청은 3번뿐이며 SEC 의 초당 10회 한도보다 훨씬 느리게 보낸다. 우회·위장 없음.
"""
import os, sys, time, urllib.request, urllib.error

UA = os.environ.get("SEC_USER_AGENT", "").strip()
if not UA or "@" not in UA:
    sys.exit("SEC_USER_AGENT 가 비어 있거나 연락처(이메일)가 없습니다. SEC 는 '앱이름 연락처' 형식을 요구합니다.")

TESTS = [("data.sec.gov (제출 목록)", "https://data.sec.gov/submissions/CIK0001067983.json"),
         ("www.sec.gov (종목-CIK 표)", "https://www.sec.gov/files/company_tickers.json"),
         ("www.sec.gov (문서 보관소)", "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&count=1&output=atom")]
ok = 0
for name, url in TESTS:
    time.sleep(1)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "identity"}), timeout=30) as r:
            body = r.read(200)
            print(f"[성공] {name}: HTTP {r.status}, {len(body)}바이트 이상 수신")
            ok += 1
    except urllib.error.HTTPError as e:
        snippet = ""
        try:
            snippet = " ".join(e.read(600).decode("utf8", "ignore").split())[:160]
        except Exception:
            pass
        print(f"[실패] {name}: HTTP {e.code} {snippet}")
    except Exception as e:
        print(f"[오류] {name}: {str(e)[:80]}")
print()
if ok == len(TESTS):
    print("이 네트워크에서는 SEC 접근이 됩니다. → 알려주시면 이 PC 에서 수집해 올리는 방식을 마저 연결합니다.")
elif ok:
    print("일부만 됩니다. 위 실패 항목의 HTTP 코드/안내문을 알려주세요.")
else:
    print("이 네트워크도 막혀 있습니다. 다른 네트워크(휴대폰 핫스팟 등)에서 한 번 더 실행해 보세요. 우회 시도는 하지 않습니다.")
