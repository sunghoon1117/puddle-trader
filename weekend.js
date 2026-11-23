'use strict';
/* 디벨롭 — 주말·장외 시장: 미국 증시가 닫힌 동안 확인할 수 있는 참고 시세
   · 나스닥100·나스닥 종합 지수: 직전 정규장 종가(주말에는 금요일 종가)
   · 비트코인·이더리움: 주말에도 거래되는 24시간 시장(위험선호 참고)
   · IG 'Weekend US Tech 100' 은 증권사 CFD 상품이라 무료 공식 시세가 없어 외부 링크로만 연결한다.
   매수 점수에는 반영하지 않는다.
   app.js·detail.js 보다 먼저 로드되며 전역(view, F, esc, cls, jget, proxyBase, marketOpen, softRender)은 호출 시점에 참조한다. */
const IG_WEEKEND_URL = 'https://www.ig.com/en/indices/markets-indices/weekend-us-tech-100-e1';
// [심볼, 이름, 설명, 종류] — idx: 일봉(종가 기준) / h24: 1시간봉(24시간 거래)
const WK_LIST = [['^NDX', '나스닥100 지수', '미국 정규장 종가 기준', 'idx'], ['^IXIC', '나스닥 종합 지수', '미국 정규장 종가 기준', 'idx'], ['BTC-USD', '비트코인', '24시간 거래 · 주말에도 움직임', 'h24'], ['ETH-USD', '이더리움', '24시간 거래 · 주말에도 움직임', 'h24']];
let WK = {}, WKat = 0;
const etParts = ms => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
function lastUsClose(now) {   // 가장 최근 평일 16:00(미 동부) 시각(UTC ms)
  for (let back = 0; back <= 6; back++) {
    const p = etParts(now - back * 864e5); if (p.weekday === 'Sat' || p.weekday === 'Sun') continue;
    for (const off of [20, 21]) { const t = Date.parse(`${p.year}-${p.month}-${p.day}T${off}:00:00Z`), q = etParts(t); if ((+q.hour % 24) === 16 && q.day === p.day && t <= now) return t; }
  }
  return null;
}
function nextUsOpen(now) {   // 다음 평일 09:30(미 동부) 정규장 개장(공휴일은 반영하지 않음)
  for (let f = 0; f <= 8; f++) {
    const p = etParts(now + f * 864e5); if (p.weekday === 'Sat' || p.weekday === 'Sun') continue;
    for (const [h, m] of [[13, 30], [14, 30]]) { const t = Date.parse(`${p.year}-${p.month}-${p.day}T${h}:${m}:00Z`), q = etParts(t); if ((+q.hour % 24) === 9 && +q.minute === 30 && q.day === p.day && t > now) return t; }
  }
  return null;
}
async function wkFetch(sym, kind) {
  const e = encodeURIComponent(sym), qs = kind === 'idx' ? 'range=1mo&interval=1d' : 'range=5d&interval=1h', y = `https://query1.finance.yahoo.com/v8/finance/chart/${e}?${qs}`, routes = [], b = proxyBase();
  if (b) routes.push(`${b}/api/chart?s=${e}&${qs}`); routes.push('https://corsproxy.io/?' + encodeURIComponent(y));
  let err;
  for (const u of routes) {
    try {
      const r = (await jget(u, 10000)).chart.result[0], q = r.indicators.quote[0].close, t = [], c = [];
      r.timestamp.forEach((x, i) => { if (q[i] != null) { t.push(x * 1000); c.push(q[i]); } });
      if (c.length < 5) throw new Error('데이터 부족');
      return { t, c, price: (r.meta && r.meta.regularMarketPrice) || c.at(-1), mt: ((r.meta && r.meta.regularMarketTime) || 0) * 1000, kind };
    } catch (x) { err = x; }
  }
  throw err;
}
function wkCalc(o, now) {
  if (o.kind === 'idx') {   // 일봉: 전일 대비·5거래일 대비
    const c = o.c, n = c.length;
    return { raw: o, kind: 'idx', price: c[n - 1], date: new Date(o.t[n - 1] + 9 * 36e5).toISOString().slice(5, 10).replace('-', '/'), chgDay: n > 1 ? c[n - 1] / c[n - 2] - 1 : null, chg5: n > 5 ? c[n - 1] / c[n - 6] - 1 : null, spark: c.slice(-22) };
  }
  const live = now - Math.max(o.mt || 0, o.t.at(-1)) < 3 * 36e5, cl = lastUsClose(now); let ref = null, ago = null;
  if (cl) for (let i = o.t.length - 1; i >= 0; i--) if (o.t[i] < cl) { ref = o.c[i]; break; }
  for (let i = o.t.length - 1; i >= 0; i--) if (o.t[i] <= now - 864e5) { ago = o.c[i]; break; }
  return { raw: o, kind: 'h24', price: o.price, live, chgClose: ref ? o.price / ref - 1 : null, chg24: ago ? o.price / ago - 1 : null, spark: o.c.slice(-72) };
}
async function loadWK(force) {
  const now = Date.now(); if (!force && now - WKat < 45e3) return; if (!proxyBase()) return;   // 워커 주소를 읽기 전이면 다음 렌더에서 다시 시도
  WKat = now;
  const res = await Promise.allSettled(WK_LIST.map(x => wkFetch(x[0], x[3]))); let any = false;
  res.forEach((r, i) => { if (r.status === 'fulfilled') { WK[WK_LIST[i][0]] = wkCalc(r.value, Date.now()); any = true; } });
  if (!any) WKat = Date.now() - 37e3;   // 전부 실패하면 약 8초 뒤 재시도
  if (any && (view === 'today' || view === 'market')) softRender();
}
const wkSpark = (a, up) => {
  if (!a || a.length < 3) return ''; const lo = Math.min(...a), hi = Math.max(...a), W = 64, H = 26;
  const pts = a.map((v, i) => (i / (a.length - 1) * W).toFixed(1) + ',' + (H - 2 - (hi === lo ? .5 : (v - lo) / (hi - lo)) * (H - 4)).toFixed(1)).join(' ');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${up ? 'var(--good)' : 'var(--bad)'}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
};
function wkCard() {
  loadWK(); const now = Date.now(), p = etParts(now), min = (+p.hour % 24) * 60 + +p.minute, weekend = p.weekday === 'Sat' || p.weekday === 'Sun' || (p.weekday === 'Fri' && min >= 960);
  const nx = marketOpen() ? null : nextUsOpen(now), left = nx ? Math.max(0, nx - now) : 0, cl = lastUsClose(now);
  const kst = ms => new Date(ms + 9 * 36e5).toISOString().slice(5, 16).replace('T', ' ').replace('-', '/');
  const status = marketOpen() ? '미국 정규장 거래 중' : `미국 정규장 휴장 · 개장까지 ${Math.floor(left / 36e5)}시간 ${Math.round(left % 36e5 / 6e4)}분 (한국시간 ${kst(nx)})`;
  const row = ([sym, nm, desc, kind]) => {
    const v = WK[sym];
    if (!v) return `<div class="wkrow"><div class="wkn"><b>${esc(nm)}</b><span class="small muted">${proxyBase() ? '불러오는 중…' : esc(desc)}</span></div></div>`;
    if (kind === 'idx') {
      const up = (v.chgDay ?? 0) >= 0;
      return `<button class="wkrow" data-dt="wk:${esc(sym)}"><div class="wkn"><b>${esc(nm)}</b><span class="small muted">${marketOpen() ? '장중(잠정)' : v.date + ' 종가'}</span></div>${wkSpark(v.spark, up)}<div class="wkv"><b>${v.price.toLocaleString('en-US', { maximumFractionDigits: 0 })}</b><span class="small ${cls(v.chgDay)}">${F.pct(v.chgDay)} <span class="muted">전일 대비</span></span><span class="small ${cls(v.chg5)}">${F.pct(v.chg5)} <span class="muted">5거래일</span></span></div></button>`;
    }
    const px = v.price >= 1000 ? F.usd(v.price) : F.usd2(v.price), up = (v.chgClose ?? v.chg24 ?? 0) >= 0;
    return `<button class="wkrow" data-dt="wk:${esc(sym)}"><div class="wkn"><b>${esc(nm)}</b><span class="small muted">${v.live ? '거래 중' : esc(desc)}</span></div>${wkSpark(v.spark, up)}<div class="wkv"><b>${px}</b><span class="small ${cls(v.chgClose)}">${F.pct(v.chgClose)} <span class="muted">미 정규장 마감 대비</span></span><span class="small ${cls(v.chg24)}">${F.pct(v.chg24)} <span class="muted">24시간</span></span></div></button>`;
  };
  return `<div class="card"><h2>${weekend ? '주말 시장' : '장외 시장'} <span class="muted small">${esc(status)}</span></h2>${WK_LIST.map(row).join('')}
  <div class="row" style="margin-top:10px"><a class="btn sm" href="${IG_WEEKEND_URL}" target="_blank" rel="noopener noreferrer">IG ‘Weekend US Tech 100’ 보기 ↗</a></div>
  <details style="margin-top:8px"><summary class="small b" style="cursor:pointer">이 시세는 무엇인가요?</summary><p class="small muted" style="margin:6px 0 0">나스닥 지수는 미국 정규장이 닫혀 있는 동안 <b>직전 종가</b>(주말에는 금요일 종가)를 보여 줍니다. 비트코인·이더리움은 주말에도 거래되어 위험선호를 가늠하는 참고용이며 나스닥과 항상 같이 움직이진 않습니다(‘미 정규장 마감 대비’는 직전 평일 16시, 미 동부 기준). <b>‘Weekend US Tech 100’</b>은 IG가 주말에 파는 CFD 상품이라 무료 공식 시세를 앱에 가져올 수 없어 <b>외부 링크</b>로만 연결합니다(증권사 서비스이며 투자 권유가 아닙니다. 레버리지 CFD는 원금을 크게 잃을 수 있습니다). 시각은 한국시간이고, 모두 참고 정보로 매수 점수에는 반영되지 않습니다.${cl ? ' (직전 정규장 마감: 한국시간 ' + kst(cl) + ')' : ''}</p></details></div>`;
}
setInterval(() => { if (!document.hidden && (view === 'today' || view === 'market')) loadWK(); }, 60e3);
