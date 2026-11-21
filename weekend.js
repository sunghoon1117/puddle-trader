'use strict';
/* 디벨롭 — 주말·24시간 시장: 미국 증시가 닫힌 동안 볼 수 있는 시세(참고용)
   'Weekend US Tech 100' 은 증권사가 파는 CFD 상품이라 무료 공식 시세가 없다. 대신 나스닥100 선물(일요일 저녁 개장)과
   주말에도 거래되는 비트코인·이더리움을 보여 준다. 매수 점수에는 반영하지 않는다.
   app.js·detail.js 보다 먼저 로드되며 전역(view, PX, F, esc, cls, jget, proxyBase, marketOpen, softRender)은 호출 시점에 참조한다. */
const WK_LIST = [['NQ=F', '나스닥100 선물', '미국 선물 · 일요일 저녁(미 동부 18시)에 개장'], ['ES=F', 'S&P500 선물', '미국 선물 · 일요일 저녁에 개장'], ['BTC-USD', '비트코인', '24시간 거래 · 주말에도 움직임'], ['ETH-USD', '이더리움', '24시간 거래 · 주말에도 움직임']];
let WK = {}, WKat = 0;
const etParts = ms => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
function lastUsClose(now) {   // 가장 최근 평일 16:00(미 동부) 시각(UTC ms)
  for (let back = 0; back <= 6; back++) {
    const p = etParts(now - back * 864e5); if (p.weekday === 'Sat' || p.weekday === 'Sun') continue;
    for (const off of [20, 21]) { const t = Date.parse(`${p.year}-${p.month}-${p.day}T${off}:00:00Z`), q = etParts(t); if ((+q.hour % 24) === 16 && q.day === p.day && t <= now) return t; }
  }
  return null;
}
function nextFutOpen(now) {   // 다음 일요일 18:00(미 동부) — 선물 주간 개장
  for (let f = 0; f <= 8; f++) {
    const p = etParts(now + f * 864e5); if (p.weekday !== 'Sun') continue;
    for (const off of [22, 23]) { const t = Date.parse(`${p.year}-${p.month}-${p.day}T${off}:00:00Z`), q = etParts(t); if ((+q.hour % 24) === 18 && q.day === p.day && t > now) return t; }
  }
  return null;
}
const futClosedWeekend = now => { const p = etParts(now), m = (+p.hour % 24) * 60 + +p.minute; return p.weekday === 'Sat' || (p.weekday === 'Fri' && m >= 1020) || (p.weekday === 'Sun' && m < 1080); };
async function wkFetch(sym) {
  const e = encodeURIComponent(sym), b = proxyBase(), y = `https://query1.finance.yahoo.com/v8/finance/chart/${e}?range=5d&interval=1h`, routes = [];
  if (b) routes.push(`${b}/api/chart?s=${e}&range=5d&interval=1h`); routes.push('https://corsproxy.io/?' + encodeURIComponent(y));
  let err;
  for (const u of routes) {
    try {
      const r = (await jget(u, 10000)).chart.result[0], q = r.indicators.quote[0].close, t = [], c = [];
      r.timestamp.forEach((x, i) => { if (q[i] != null) { t.push(x * 1000); c.push(q[i]); } });
      if (c.length < 5) throw new Error('데이터 부족');
      return { t, c, price: (r.meta && r.meta.regularMarketPrice) || c.at(-1), mt: ((r.meta && r.meta.regularMarketTime) || 0) * 1000 };
    } catch (x) { err = x; }
  }
  throw err;
}
function wkCalc(o, now) {
  const live = now - Math.max(o.mt || 0, o.t.at(-1)) < 3 * 36e5, cl = lastUsClose(now); let ref = null, ago = null;
  if (cl) for (let i = o.t.length - 1; i >= 0; i--) if (o.t[i] < cl) { ref = o.c[i]; break; }
  for (let i = o.t.length - 1; i >= 0; i--) if (o.t[i] <= now - 864e5) { ago = o.c[i]; break; }
  return { raw: o, price: o.price, live, chgClose: ref ? o.price / ref - 1 : null, chg24: ago ? o.price / ago - 1 : null, spark: o.c.slice(-72) };
}
async function loadWK(force) {
  const now = Date.now(); if (!force && now - WKat < 45e3) return; if (!proxyBase()) return;   // 워커 주소를 읽기 전이면 다음 렌더에서 다시 시도
  WKat = now;
  const res = await Promise.allSettled(WK_LIST.map(x => wkFetch(x[0]))); let any = false;
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
  const fc = futClosedWeekend(now), nx = fc ? nextFutOpen(now) : null, cl = lastUsClose(now), left = nx ? Math.max(0, nx - now) : 0;
  const kst = ms => new Date(ms + 9 * 36e5).toISOString().slice(5, 16).replace('T', ' ').replace('-', '/');
  const status = (marketOpen() ? '미국 정규장 거래 중' : '미국 정규장 휴장') + (nx ? ` · 나스닥 선물 개장까지 ${Math.floor(left / 36e5)}시간 ${Math.round(left % 36e5 / 6e4)}분 (한국시간 ${kst(nx)})` : '');
  const row = ([sym, nm, desc]) => {
    const v = WK[sym];
    if (!v) return `<div class="wkrow"><div class="wkn"><b>${esc(nm)}</b><span class="small muted">${proxyBase() ? '불러오는 중…' : esc(desc)}</span></div></div>`;
    const px = v.price >= 1000 ? F.usd(v.price) : F.usd2(v.price), up = (v.chgClose ?? v.chg24 ?? 0) >= 0, closed = sym.endsWith('=F') && !v.live;
    return `<button class="wkrow" data-dt="wk:${esc(sym)}"><div class="wkn"><b>${esc(nm)}</b><span class="small muted">${closed ? '휴장 · 직전 마감가' : v.live ? '거래 중' : esc(desc)}</span></div>${wkSpark(v.spark, up)}<div class="wkv"><b>${px}</b><span class="small ${closed ? '' : cls(v.chgClose)}">${closed ? '–' : F.pct(v.chgClose)} <span class="muted">미 정규장 마감 대비</span></span><span class="small ${cls(v.chg24)}">${F.pct(v.chg24)} <span class="muted">24시간</span></span></div></button>`;
  };
  return `<div class="card"><h2>${weekend ? '주말' : '장외'}·24시간 시장 <span class="muted small">${esc(status)}</span></h2>${WK_LIST.map(row).join('')}<details style="margin-top:8px"><summary class="small b" style="cursor:pointer">이 시세는 무엇인가요?</summary><p class="small muted" style="margin:6px 0 0">증권사가 파는 <b>‘Weekend US Tech 100’</b>은 CFD 상품이라 무료로 볼 수 있는 공식 시세가 없습니다. 대신 ① <b>나스닥100 선물</b>(일요일 저녁 개장 — 월요일 갭을 가늠) ② 주말에도 거래되는 <b>비트코인·이더리움</b>(위험선호 참고, 나스닥과 항상 같이 움직이진 않음)을 보여 줍니다. ‘미 정규장 마감 대비’는 직전 평일 16시(미 동부) 이후의 변화이며 시각은 한국시간입니다. 항목을 누르면 5일 추이를 볼 수 있습니다. 참고 정보이며 매수 점수에는 반영되지 않습니다.${cl ? ' (기준 마감: 한국시간 ' + kst(cl) + ')' : ''}</p></details></div>`;
}
setInterval(() => { if (!document.hidden && (view === 'today' || view === 'market')) loadWK(); }, 60e3);
