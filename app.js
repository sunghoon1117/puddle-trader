'use strict';
/* 디벨롭 v2 — 모바일 우선 · 자동 갱신 · 통합 점수(추세+가치) · 자동 검증/보정 */
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const E = Engine;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const num = v => { const t = String(v ?? '').normalize('NFKC').trim().replace(/\s/g, ''); if (!t) return null; const ok = /^[+-]?\d{1,3}(,\d{3})+(\.\d*)?$/.test(t) ? t.replace(/,/g, '') : (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t) ? t : null); if (ok == null) return null; const n = parseFloat(ok); return isFinite(n) && Math.abs(n) <= 1e12 ? (n === 0 ? 0 : n) : null; };   // '0,5'·'12abc'·1e300 같은 모호하거나 비정상 입력은 null
const cleanSym = x => String(x || '').toUpperCase().replace(/[^A-Z0-9.^=-]/g, '').slice(0, 15);
const okProxy = p => { p = String(p || '').trim().replace(/\/$/, ''); return /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.workers\.dev$/i.test(p) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(p) ? p : ''; };   // 시세·AI 요청이 갈 수 있는 곳은 우리 워커나 로컬뿐
const safeUrl = u => /^https:\/\//i.test(String(u || '')) ? String(u) : '#';
const F = {
  usd: n => n == null || !isFinite(n) ? '–' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 2 }),
  usd2: n => n == null || !isFinite(n) ? '–' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  pct: (n, d = 1) => n == null || !isFinite(n) ? '–' : (n > 0 ? '+' : '') + (n * 100).toFixed(d) + '%',
  p0: n => n == null || !isFinite(n) ? '–' : (n * 100).toFixed(0) + '%', n1: n => n == null || !isFinite(n) ? '–' : n.toFixed(1)
};
const cls = n => n > 0 ? 'pos' : n < 0 ? 'neg' : '';
const LN = { P: '추세', D: '가치', C: '통합' };
const LC = { P: 'var(--lp)', D: 'var(--ld)', C: 'var(--lc)' };
const DEFAULT_WATCH = [['SOXL', 3, 'etf', 1.3], ['USD', 2, 'etf', 1.3], ['TQQQ', 3, 'etf', 1], ['QLD', 2, 'etf', 1], ['QQQ', 1, 'etf', 1], ['SPY', 1, 'etf', .8], ['SOXX', 1, 'etf', 1.3], ['NVDA', 1, 'stock', 1.5], ['TSLA', 1, 'stock', 1.8], ['AMZN', 1, 'stock', 1.2], ['MSFT', 1, 'stock', 1], ['META', 1, 'stock', 1.3], ['GOOGL', 1, 'stock', 1.1], ['005930.KS', 1, 'stock', 1.1, '삼성전자'], ['000660.KS', 1, 'stock', 1.4, 'SK하이닉스'], ['069500.KS', 1, 'etf', 1, 'KODEX 200']].map(([sym, lev, type, beta, name]) => (name ? { sym, lev, type, beta, name } : { sym, lev, type, beta }));

/* ───────── 저장소 ───────── */
const IDB = (() => {
  let p, mem = {}; const open = () => p || (p = new Promise((res, rej) => { try { const r = indexedDB.open('pt2', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); } }));
  const tx = async (m, f, key) => { try { const db = await open(); return await new Promise((res, rej) => { const t = db.transaction('kv', m), o = f(t.objectStore('kv')); t.oncomplete = () => res(o && o.result); t.onerror = () => rej(t.error); }); } catch (e) { return m === 'readonly' ? mem[key] : undefined; } };
  return { get: k => tx('readonly', s => s.get(k), k), set: (k, v) => { mem[k] = v; return tx('readwrite', s => s.put(v, k)); }, keys: () => tx('readonly', s => s.getAllKeys()) };
})();
const KEY = 'pt.v2';
const DEF = () => ({ settings: { cashTarget: 20, reserve: 10, tranche: [20, 30, 50], maxPos: 30, maxLev: 40, tp: [30, 60, 100], proxy: '', theme: 'auto', lens: 'C', notify: false, auto: true, fearSrc: 'cnn', ai: 'cf', geminiKey: '', geminiModel: 'gemini-2.5-flash' }, watch: DEFAULT_WATCH.map(w => ({ ...w })), holdings: [], cash: 0, journal: [], episodes: {}, tkr: {}, ledger: [], alerts: [], alertLog: [], snapPrev: null, snapCur: null });
function restoreBackup(j) {   // 백업 복원: 부팅과 같은 깊은 병합 + 형식·범위 검증(조작·구버전 백업 방어)
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('형식');
  const D0 = DEF(), o = Object.assign(DEF(), j, { settings: Object.assign(DEF().settings, j.settings && typeof j.settings === 'object' ? j.settings : {}) }), st = o.settings, num0 = (v, d, a, b) => (isFinite(+v) && v !== '' && v !== null && +v >= a && +v <= b ? +v : d);
  for (const k of ['holdings', 'journal', 'alerts', 'alertLog', 'ledger']) if (!Array.isArray(o[k])) o[k] = [];
  if (!Array.isArray(o.watch)) o.watch = D0.watch;
  for (const k of ['episodes', 'tkr']) if (!o[k] || typeof o[k] !== 'object' || Array.isArray(o[k])) o[k] = {};
  st.proxy = okProxy(st.proxy); st.geminiKey = ''; st.lens = 'C';
  for (const k of ['cashTarget', 'reserve', 'maxPos', 'maxLev']) st[k] = num0(st[k], D0.settings[k], 0, 100);
  st.tranche = Array.isArray(st.tranche) && st.tranche.length === 3 ? st.tranche.map((v, i) => num0(v, D0.settings.tranche[i], 0, 100)) : D0.settings.tranche;
  st.tp = Array.isArray(st.tp) && st.tp.length ? st.tp.map(v => num0(v, 30, 0, 1000)) : D0.settings.tp;
  o.holdings = o.holdings.filter(h => h && cleanSym(h.sym) && +h.qty > 0 && +h.qty < 1e9 && +h.avg >= 0 && +h.avg < 1e9).map(h => ({ sym: cleanSym(h.sym), qty: +h.qty, avg: +h.avg }));
  o.journal = o.journal.filter(x => x && cleanSym(x.sym) && /^\d{4}-\d{2}-\d{2}$/.test(String(x.date || '').slice(0, 10))).map((x, i) => ({ id: +x.id || Date.now() + i, date: String(x.date).slice(0, 10), sym: cleanSym(x.sym), side: x.side === 'sell' ? 'sell' : 'buy', qty: num0(x.qty, 0, 0, 1e9), px: num0(x.px, 0, 0, 1e9), avg: x.avg == null ? null : num0(x.avg, null, 0, 1e9), pl: x.pl == null || !isFinite(+x.pl) ? null : +x.pl, fx: num0(x.fx, 1, 0.0001, 1e6) }));
  o.watch = o.watch.filter(w => w && cleanSym(w.sym)).map(w => ({ ...w, sym: cleanSym(w.sym), lev: [1, 2, 3].includes(+w.lev) ? +w.lev : 1, beta: num0(w.beta, 1, 0, 5), type: w.type === 'etf' ? 'etf' : 'stock' }));
  o.cash = num0(o.cash, 0, 0, 1e12); curSym = null; for (const k in LIVE) delete LIVE[k]; for (const k in FEAT) delete FEAT[k];
  return o;
}
let S = (() => { try { const j = JSON.parse(localStorage.getItem(KEY)); if (j) return Object.assign(DEF(), j, { settings: Object.assign(DEF().settings, j.settings) }); const o = JSON.parse(localStorage.getItem('pt.v1')); if (o) { const d = DEF(); ['holdings', 'cash', 'journal', 'tkr'].forEach(k => { if (o[k]) d[k] = o[k]; }); return d; } } catch (e) { } return DEF(); })();
(function migrate() { try { S.settings.lens = 'C'; S.settings.proxy = okProxy(S.settings.proxy); if (!S.mig) S.mig = {}; if (!S.mig.kr) { for (const w of DEFAULT_WATCH.filter(x => x.name)) if (!S.watch.find(y => y.sym === w.sym)) S.watch.push({ ...w }); S.mig.kr = 1; } S.watch.forEach(w => { if (!w.name) { const d = DEFAULT_WATCH.find(x => x.sym === w.sym && x.name); if (d) w.name = d.name; } }); } catch (e) { } })();
let saveT; const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { if (!window.__saveWarn) { window.__saveWarn = 1; setStatus('저장 공간을 쓸 수 없어 입력한 기록이 사라질 수 있습니다(시크릿 모드 등).'); } } }, 250); };

/* ───────── 전역 데이터 ───────── */
let PX = {}, MAN = null, FUND = {}, RES = null, MK = null; const FEAT = {}, LIVE = {};
let view = 'today', curSym = null, range = '1Y', busy = false, btBusy = false, btProg = 0, btMsg = '';
const safe = s => s.replace('^', '_');
const watchSyms = () => [...new Set([...S.watch.map(w => w.sym), ...S.holdings.map(h => h.sym)])];
const needSyms = () => [...new Set([...E.MARKET_SYMS, ...E.MACRO_SYMS, ...watchSyms()])];
const priceOf = sym => { const s = PX[sym]; return s && s.c.length ? s.c.at(-1) : null; };
const isKR = sym => /\.(KS|KQ)$/.test(sym || '');
const fxKRW = () => priceOf('KRW=X') || 1400;                      // 원/달러
const toUSD = (sym, v) => isKR(sym) ? v / fxKRW() : v;           // 한국 종목은 합계 계산용으로 달러 환산
const fmtPx = (sym, v) => isKR(sym) ? (v == null || !isFinite(v) ? '–' : '₩' + Math.round(v).toLocaleString('ko-KR')) : F.usd2(v);
const fmtAmt = (sym, usd) => isKR(sym) ? '₩' + Math.round(usd * fxKRW()).toLocaleString('ko-KR') : F.usd(usd);
const dispName = w => w && w.name ? w.name : w ? w.sym : '';
const params = () => (RES && RES.params) || E.DEFAULTS();

/* ───────── 시장 시간·신선도 ───────── */
function etNow() { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(x => [x.type, x.value])); const h = +p.hour % 24, m = +p.minute, wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday); return { wd, mins: h * 60 + m, date: `${p.year}-${p.month}-${p.day}` }; }
const krOpen = () => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()).map(x => [x.type, x.value])), m = (+p.hour % 24) * 60 + +p.minute; return !['Sat', 'Sun'].includes(p.weekday) && m >= 540 && m < 935; };
const marketOpen = () => { const t = etNow(); return t.wd >= 1 && t.wd <= 5 && !US_HOL.has(t.date) && t.mins >= 570 && t.mins < (US_EARLY.has(t.date) ? 780 : 960); };
function expectedBar() { const t = etNow(); let d = new Date(t.date + 'T00:00:00Z'); const before = t.mins < 570; if (before || t.wd === 0 || t.wd === 6 || US_HOL.has(t.date)) { do { d = new Date(d.getTime() - 864e5); } while ([0, 6].includes(d.getUTCDay()) || US_HOL.has(d.toISOString().slice(0, 10))); } else if (t.wd >= 1 && t.wd <= 5) { /* 오늘 */ } return d.toISOString().slice(0, 10); }
function freshness() {
  const spy = PX.SPY; if (!spy) return { k: 'bad', t: '데이터 없음', d: '시세 데이터를 아직 받지 못했습니다.' };
  const last = spy.d.at(-1), exp = expectedBar(), upd = Math.max(MAN?.updated ? MAN.updated * 1000 : 0, ...Object.values(PX).map(x => x.t ? x.t * (x.t < 1e12 ? 1000 : 1) : 0)), age = Date.now() - upd, open = marketOpen();
  const lagDays = Math.round((Date.parse(exp) - Date.parse(last)) / 864e5), mins = Math.round(age / 6e4), ageTxt = mins < 60 ? mins + '분 전' : mins < 2880 ? Math.round(mins / 60) + '시간 전' : Math.round(mins / 1440) + '일 전';
  let k = 'ok', t = (open ? '장중 ' : '종가 ') + ageTxt; if (open && liveAt && Date.now() - liveAt < 75e3) t = '실시간 ' + Math.max(1, Math.round((Date.now() - liveAt) / 1e3)) + '초 전';
  const lagSyms = MAN && MAN.symbols ? S.watch.filter(w => !isKR(w.sym) && MAN.symbols[w.sym] && MAN.symbols[w.sym].last && MAN.symbols[w.sym].last < exp).length : 0;
  if (lagDays >= 3 || age > 3 * 864e5) k = 'bad'; else if (lagSyms >= 3 && lagDays >= 1) k = 'warn'; else if ((lagDays >= 1 && age > 3 * 36e5) || (open && age > 40 * 6e4) || age > 30 * 36e5) k = 'warn';
  return { k, t, d: `마지막 봉 ${last} · 기대 ${exp} · 갱신 ${ageTxt}${open ? ' · 장중(마지막 봉은 잠정치)' : ''}`, open };
}

/* ───────── 시세 수집(다중 경로 · 점진 갱신 · 마지막 정상값 유지) ───────── */
let LIVE_URL = '';   // 배포 시 data/live.json 에서 읽는 공개 워커 주소(비밀 아님)
const proxyBase = () => (S.settings.proxy || LIVE_URL || '').replace(/\/$/, '');
async function jget(url, ms = 12000, opt) { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); try { const r = await fetch(url, Object.assign({ signal: c.signal }, opt)); if (!r.ok) throw new Error(r.status); return await r.json(); } finally { clearTimeout(t); } }
async function putPX(sym, o) { PX[sym] = o; IDB.set('px:' + sym, o); }
function parseYahoo(j) { const r = j.chart.result[0], ts = r.timestamp, q = r.indicators.quote[0].close, d = [], c = []; for (let i = 0; i < ts.length; i++) if (q[i] != null) { d.push(new Date(ts[i] * 1000).toISOString().slice(0, 10)); c.push(+q[i].toFixed(4)); } if (c.length < 5) throw new Error('데이터 부족'); return { d, c, mt: r.meta.regularMarketTime }; }
function merge(old, nw) { if (!old || old.c.length < 100) return nw; const m = new Map(old.d.map((d, i) => [d, old.c[i]])); nw.d.forEach((d, i) => m.set(d, nw.c[i])); const d = [...m.keys()].sort(); return { d, c: d.map(x => m.get(x)), t: Date.now(), mt: nw.mt }; }
async function fetchLive(sym, rng) {
  const e = encodeURIComponent(sym), q = rng === 'max' ? 'period1=0&period2=' + (Math.floor(Date.now() / 1e3) + 86400) + '&interval=1d' : `range=${rng}&interval=1d`, y = `https://query1.finance.yahoo.com/v8/finance/chart/${e}?${q}`, routes = [];
  if (proxyBase()) routes.push(proxyBase() + `/api/chart?s=${e}&range=${rng}`);
  if (/^https?:/.test(location.protocol)) routes.push(`/api/chart?s=${e}&range=${rng}`);
  routes.push(y);   // 제3자 CORS 프록시는 쓰지 않는다(보유 종목 티커가 외부로 새지 않게)
  let err; for (const u of routes) { try { const o = parseYahoo(await jget(u, 10000)); o.t = Date.now(); return o; } catch (x) { err = x; } } throw err || new Error('실패');
}
async function syncStatic() {   // 1순위: 같은 출처의 data/ (GitHub Actions·PC 서버가 자동 갱신) — CORS·차단 없음
  try {
    const man = await jget('data/manifest.json?t=' + Date.now(), 8000, { cache: 'no-store' }), local = (await IDB.get('man')) || { symbols: {} }, todo = [];
    for (const s of Object.keys(man.symbols)) if (!PX[s] || (man.symbols[s].t || 0) > ((local.symbols[s] || {}).t || 0)) todo.push(s);
    let n = 0; const q = [...todo]; const w = async () => { while (q.length) { const s = q.shift(); try { const j = await jget('data/px/' + safe(s) + '.json?v=' + (man.symbols[s].t || 0), 20000); await putPX(s, { d: j.d, c: j.c, t: (j.t || 0) * 1000, mt: j.mt }); local.symbols[s] = man.symbols[s]; n++; } catch (e) { } } };
    await Promise.all([w(), w(), w(), w()]);
    MAN = man; await IDB.set('man', Object.assign(local, { updated: man.updated })); try { FUND = await jget('data/fund.json?t=' + man.updated, 8000); IDB.set('fund', FUND); } catch (e) { }
    return { ok: true, n, stale: man.updated ? (Date.now() / 1e3 - man.updated) : 1e9 };
  } catch (e) { return { ok: false, n: 0, stale: 1e9 }; }
}
async function syncLive(only) {    // 2순위: 실시간 경로(프록시/직접) — 최근 1개월만 받아 병합. 처음 보는 종목은 전체 이력
  const syms = only || needSyms(), fails = []; let n = 0; const q = [...syms];
  const w = async () => { while (q.length) { const s = q.shift(); try { const full = !PX[s] || PX[s].c.length < 300; const o = await fetchLive(s, full ? 'max' : '1mo'); await putPX(s, full ? o : merge(PX[s], o)); n++; } catch (e) { fails.push(s); } } };
  await Promise.all([w(), w(), w()]); return { n, fails };
}
async function refresh(manual) {
  if (busy) return; busy = true; $('#btnRefresh').classList.add('spin');
  try {
    loadCal(); loadMac(); 
    syncCNN().then(ok => { if (ok) { recompute(); softRender(); } });   // CNN 공포탐욕(브라우저 직접 읽기, 5분 간격)
    let st = await syncStatic(), msg = ''; syncTracker().then(() => { if (view === 'whales') softRender(); });
    const f0 = freshness(), needLive = manual || !st.ok || f0.k !== 'ok' || watchSyms().some(s => !PX[s]);
    if (needLive) {
      if (manual) await fetch('/api/refresh').catch(() => { });   // PC 서버 사용 시 즉시 갱신 요청
      const miss = watchSyms().filter(s => !PX[s]), r = await syncLive(manual || !st.ok ? undefined : [...new Set([...miss, 'SPY', 'QQQ', '^VIX'])]);
      if (manual && /^https?:/.test(location.protocol)) { await new Promise(r => setTimeout(r, 1500)); st = await syncStatic(); }
      if (r.fails.length && r.n === 0 && !st.ok) msg = '⚠ 시세 서버에 연결하지 못했습니다. 저장된 마지막 정상 데이터로 표시 중이며, 연결되면 자동으로 따라잡습니다.';
      else if (r.fails.length) msg = `일부 종목(${r.fails.slice(0, 5).join(', ')}) 갱신 실패 — 마지막 정상값 사용`;
    }
    setStatus(msg);
  } catch (e) { setStatus('갱신 오류: ' + e.message); }
  busy = false; $('#btnRefresh').classList.remove('spin');
  recompute(); softRender(); maybeBacktest();
}
// 입력 중이거나 모달이 열려 있으면 화면을 통째로 다시 그리지 않아(입력 손실 방지) 상태 표시만 갱신
function softRender() { const a = document.activeElement, typing = a && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName) && a.id !== 'kq'; if (typing || !$('#modal').hidden) { renderFresh(); return; } render(); }
function setStatus(t) { $('#status').textContent = t || ''; }
let tickN = 0;
function tick() {   // 1분마다 가벼운 확인(manifest) — 앱을 켜 두거나 화면을 다시 볼 때 자동으로 최신화
  if (document.hidden || !S.settings.auto) return; tickN++;
  const every = marketOpen() ? 2 : 10; if (tickN % every === 0 || tickN === 1) refresh(false); else refreshLight();
}
/* 앱 자동 업데이트: 배포 때 코드가 바뀐 경우에만 version.json 값이 바뀜 → 열려 있는 앱이 감지해 스스로 새로고침(입력 중이면 끝난 뒤) */
let APP_V = null;
async function checkUpdate() {
  try {
    const j = await jget('version.json?t=' + Date.now(), 6000, { cache: 'no-store' }); if (APP_V == null) { APP_V = j.v; return; } if (j.v === APP_V) return;
    const a = document.activeElement; if ((a && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName)) || !$('#modal').hidden) { setStatus('새 버전이 있습니다. 입력을 마치면 자동으로 적용됩니다.'); return; }
    setStatus('새 버전으로 업데이트 중…'); try { (await navigator.serviceWorker?.getRegistration())?.update(); } catch (e) { } setTimeout(() => location.reload(), 600);
  } catch (e) { /* 개발 서버 등 version.json 없음 */ }
}
/* 실시간 계층: 장중 20초마다 '배치 API'(PC 서버 또는 내 프록시)로 최근 일봉을 받아 마지막 봉을 갱신. 없으면 조용히 건너뜀(5분 주기 data/ 가 기본) */
let liveAt = 0, liveBusy = false;
async function liveTick() {
  if (document.hidden || !S.settings.auto || !(marketOpen() || krOpen()) || busy || liveBusy) return;
  const bases = []; if (proxyBase()) bases.push(proxyBase()); if (/^https?:/.test(location.protocol) && !/github\.io$/.test(location.hostname)) bases.push('');
  if (!bases.length) return; liveBusy = true;
  const syms = [...new Set([...watchSyms(), 'SPY', 'QQQ', '^VIX', '^VIX3M'])].slice(0, 30);
  try {
    for (const b of bases) {
      try {
        const j = await jget(`${b}/api/batch?s=${encodeURIComponent(syms.join(','))}&range=5d`, 8000, { cache: 'no-store' }); let n = 0;
        let chg = 0; for (const s in j) { const o = j[s]; if (o && o.c && o.c.length && PX[s]) { const sig0 = PX[s].c.at(-1) + '|' + PX[s].d.at(-1) + '|' + (PX[s].mt || 0); PX[s] = merge(PX[s], { d: o.d, c: o.c, mt: o.mt }); PX[s].t = Date.now(); if (PX[s].c.at(-1) + '|' + PX[s].d.at(-1) + '|' + (PX[s].mt || 0) !== sig0) { IDB.set('px:' + s, PX[s]); chg++; } n++; } }
        if (n) { liveAt = Date.now(); if (chg) { recompute(); softRender(); } else renderFresh(); break; }
      } catch (e) { /* 다음 경로 */ }
    }
  } finally { liveBusy = false; }
}
async function refreshLight() { const before = MAN?.updated; try { const m = await jget('data/manifest.json?t=' + Date.now(), 6000, { cache: 'no-store' }); if (m.updated !== before) refresh(false); else renderFresh(); } catch (e) { renderFresh(); } }

/* ───────── CNN 공포탐욕 지수 ─────────
   CNN 서버는 스크립트·서버(GitHub 등)의 요청을 봇으로 차단하므로, 일반 웹페이지처럼 '사용자 휴대폰 브라우저가 직접' 읽는다(헤더 위장 없음).
   읽지 못하면 자체 공포지수(가격 기반, 과거 검증됨)로 자동 대체. */
let CNN = null, cnnTry = 0;
const CNN_KO = { 'extreme fear': '극단적 공포', fear: '공포', neutral: '중립', greed: '탐욕', 'extreme greed': '극단적 탐욕' };
const CNN_PARTS = { market_momentum_sp500: '시장 모멘텀(S&P500 vs 125일선)', stock_price_strength: '주가 강도(신고가·신저가)', stock_price_breadth: '주가 폭(거래량)', put_call_options: '풋/콜 옵션', market_volatility_vix: '변동성(VIX)', junk_bond_demand: '정크본드 수요', safe_haven_demand: '안전자산 수요' };
const cnnLive = () => CNN && S.settings.fearSrc !== 'own' && Date.now() - Date.parse(CNN.t) < 48 * 36e5 ? CNN : null;
async function syncCNN(force) {
  if (!force && Date.now() - cnnTry < 5 * 6e4) return; cnnTry = Date.now();
  try {
    const j = await jget('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', 12000, { cache: 'no-store' }), fg = j.fear_and_greed; if (!fg || fg.score == null) throw new Error('형식');
    const parts = {}; for (const k in CNN_PARTS) if (j[k]) parts[k] = { score: j[k].score, rating: j[k].rating };
    const hist = ((j.fear_and_greed_historical || {}).data || []).map(p => ({ d: new Date(p.x).toISOString().slice(0, 10), v: p.y })).slice(-400);
    CNN = { score: fg.score, rating: fg.rating, prev: fg.previous_close, w1: fg.previous_1_week, m1: fg.previous_1_month, y1: fg.previous_1_year, t: fg.timestamp, parts, hist }; IDB.set('cnn', CNN); return true;
  } catch (e) { return false; }
}

/* ───────── 분석 ───────── */
function recompute() {
  try { MK = E.buildMarket(PX); } catch (e) { MK = null; }
  if (!MK) return;
  const qd = PX.QQQ ? (() => { const m = new Map(PX.QQQ.d.map((d, i) => [d, i])); return { byDate: (d, h) => { const j = m.get(d); return j != null && j >= h ? PX.QQQ.c[j] / PX.QQQ.c[j - h] - 1 : null; } }; })() : null;
  const p = params(), cn = cnnLive(), fearOv = cn ? 100 - cn.score : null;
  for (const w of S.watch) {
    const s = PX[w.sym]; if (!s || s.c.length < E.START + 10) { delete LIVE[w.sym]; continue; }
    const key = w.sym + '|' + s.c.length + '|' + s.d.at(-1) + '|' + s.c.at(-1) + '|' + MK.n + '|' + (MK.vix.at(-1)) + '|' + w.lev + '|' + (params().fearV || 1) + '|' + (fearOv == null ? '-' : Math.round(fearOv));
    let ent = FEAT[w.sym]; if (!ent || ent.key !== key) { const f = E.features(w, s, MK, { qqq: qd, fearV: p.fearV || 1 }); if (!f) { delete LIVE[w.sym]; continue; } ent = FEAT[w.sym] = { key, F: f }; }
    const tk = S.tkr[w.sym] || {}, auto = FUND[w.sym] && FUND[w.sym].fair, man = tk.fv && tk.fv.cf > 0 ? fairManual(tk.fv) : null;
    ent.fair = man || auto || null; ent.fairSrc = man ? '수동' : auto ? '자동(재무)' : null;
    E.applyLive(ent.F, { fair: ent.fair, resolve: tk.resolve, bad: tk.bad, fear: fearOv });
    LIVE[w.sym] = E.live(ent.F, p);
    for (const L of ['P', 'D', 'C']) if (LIVE[w.sym].lens[L].score < 20) delete S.episodes[w.sym + '|' + L];
  }
  trackSignals(); checkAlerts();
}
const fairManual = fv => { const r = fv.r ?? .1; return fv.cf * Math.pow(1 + fv.g, 3) * fv.mult / Math.pow(1 + r, 3); };
/* 실전 추적: 앱이 낸 매수 신호를 기록하고, 시간이 지나면 실제 수익률로 평가 */
function trackSignals() {
  const today = etNow().date; let ch = false;
  for (const s in LIVE) for (const L of ['C']) {
    const x = LIVE[s].lens[L]; if (x.k < 1 || x.over || !x.fresh) continue;
    const last = [...S.ledger].reverse().find(e => e.sym === s && e.L === L);
    if (last && (Date.parse(today) - Date.parse(last.date)) / 864e5 < 7 && last.k >= x.k) continue;
    S.ledger.push({ id: today + s + L + x.k, sym: s, L, k: x.k, date: LIVE[s].date, px: LIVE[s].price, score: x.score, ver: RES ? RES.asof : 'default' }); ch = true;
    if (S.settings.notify && !S.ledger.some(e => e.id === today + s + L + x.k && e !== S.ledger.at(-1))) notify(`${s} ${x.k}차 신호`, `점수 ${x.score} · ${fmtPx(s, LIVE[s].price)}`);
  }
  if (ch) { S.ledger = S.ledger.slice(-600); save(); }
}
async function notify(t, b) { try { if (Notification.permission !== 'granted') return; const reg = await navigator.serviceWorker?.getRegistration(); reg ? reg.showNotification(t, { body: b, icon: 'icon-192.png', tag: t }) : new Notification(t, { body: b }); } catch (e) { } }

/* ───────── 검증·자동 보정(Web Worker) ───────── */
function maybeBacktest(force) {
  if (btBusy || !MK) return; const have = S.watch.filter(w => PX[w.sym]).length; if (have < 3) return;
  const age = RES ? Date.now() - (RES.at || 0) : 1e18;
  if (force || !RES || RES.ver !== E.VERSION || (S.settings.auto && age > 24 * 36e5 && !document.hidden)) runBacktest();
}
function runBacktest() {
  if (btBusy) return; btBusy = true; btProg = .01; btMsg = '준비 중'; if (view === 'set') render();
  const px = {}; for (const s of [...E.MARKET_SYMS, ...E.MACRO_SYMS, ...watchSyms()]) if (PX[s]) px[s] = { d: PX[s].d, c: PX[s].c };
  let w; try { w = new Worker('bt-worker.js'); } catch (e) { btBusy = false; setStatus('이 브라우저는 백그라운드 검증을 지원하지 않습니다.'); return; }
  w.onmessage = async ev => {
    const m = ev.data;
    if (m.type === 'progress') { btProg = m.p; btMsg = m.t; if (view === 'set') updProg(); }
    else if (m.type === 'done') { RES = m.result; RES.at = Date.now(); await IDB.set('bt', RES); btBusy = false; w.terminate(); for (const k in FEAT) delete FEAT[k]; recompute(); softRender(); }
    else if (m.type === 'error') { btBusy = false; w.terminate(); setStatus('검증 오류: ' + m.msg); render(); }
  };
  w.onerror = e => { btBusy = false; setStatus('검증 워커 오류: ' + (e.message || '')); render(); };
  w.postMessage({ px, watch: S.watch.filter(x => PX[x.sym] && !isKR(x.sym)), krWatch: S.watch.filter(x => PX[x.sym] && isKR(x.sym)) });
}
function updProg() { const b = $('#btBar'); if (b) b.style.width = (btProg * 100) + '%'; const t = $('#btMsg'); if (t) t.textContent = btMsg; }

/* ───────── 포트폴리오·추천 ───────── */
function portfolio() {
  let stocks = 0, lev = 0; const rows = S.holdings.map(h => { const p = priceOf(h.sym) ?? h.avg, val = toUSD(h.sym, h.qty * p), w = S.watch.find(x => x.sym === h.sym), L = w?.lev || 1; stocks += val; if (L > 1) lev += val; return { ...h, p, np: priceOf(h.sym) == null, val, pl: h.avg ? p / h.avg - 1 : 0, L, beta: w?.beta || 1 }; });
  const eq = stocks + (S.cash || 0); rows.forEach(r => r.wt = eq ? r.val / eq : 0); return { rows, stocks, lev, eq, cashPct: eq ? (S.cash || 0) / eq : null, levPct: eq ? lev / eq : 0 };
}
function confLine(L, k) {
  if (!RES) return '';
  const nb = RES.neutral?.lens[L]?.byK[k], ob = RES.lens[L].oos.byK[k], base = RES.neutral?.lens[L]?.h[60]?.baseWin, a = [];
  if (nb && nb.n >= 5) a.push(`지수·섹터 ETF ${RES.neutral.from}~ ${k}차 신호 후 60일 상승 ${F.p0(nb.win60)} (n=${nb.n}, 아무 날 매수 ${F.p0(base)})`);
  if (ob && ob.n >= 5) a.push(`내 종목군 표본외 ${F.p0(ob.win60)} (n=${ob.n})`);
  return a.join(' · ');
}
function planFor(sym, L) {
  const lv = LIVE[sym], ent = FEAT[sym]; if (!lv) return null; const x = lv.lens[L], st = S.settings, P = portfolio(), hold = P.rows.find(r => r.sym === sym), trimOn = params().trim !== false;
  const r = { kind: 'wait', label: '', lines: [], amount: null, shares: null, k: x.k, L };
  if (x.over) {
    r.kind = 'trim'; r.label = '과열 — 신규 매수 중단'; r.lines.push('주봉 RSI 70↑ 또는 고점권 과도한 이격: 추격 매수하지 않습니다.');
    r.lines.push(trimOn ? '검증상 분할 익절이 도움이 되는 구간 — 수익 중이면 1/3씩 나눠 일부 차익을 실현하는 것도 선택지입니다.' : '과거 검증에서 익절·감량은 성과를 깎아(꾸준히 보유가 우세) 신규 매수만 멈추고 보유는 유지하는 쪽이 더 나았습니다(미래를 보장하지 않습니다).');
    if (hold && hold.pl > 0 && trimOn) { const t = st.tp.filter(v => hold.pl * 100 >= v).length; if (t) r.lines.push(`보유 수익률 ${F.pct(hold.pl, 0)} — 익절 기준(${st.tp.slice(0, t).join('/')}%) 도달.`); }
    return r;
  }
  if (x.k === 0) { r.kind = x.score >= 25 ? 'hold' : 'wait'; r.label = x.score >= 25 ? '관찰 — 신호가 아직 덜 겹침' : '관망 — 현금 유지'; r.lines.push(x.score >= 25 ? '신호가 더 깊어지거나 추가될 때까지 대기.' : '켜진 신호가 부족합니다. 아무 때나 사지 않습니다.'); return r; }
  const names = ['', '1차(소액 탐색)', '2차(비중 확대)', '3차(점수 구간이 가장 높음 · 확률 아님)'];
  if (!x.fresh) {   // 과거 검증: 점수대별 상승 확률은 거의 차이 없고, '신호가 처음 켜진 구간'에서만 우위가 있었음
    r.kind = 'hold'; r.label = `신호 지속 중 — 신규 진입 우위 낮음 (${x.k}차 신호 후 ${x.since ?? '?'}일)`;
    r.lines.push('점수가 높아도 이미 켜진 지 오래된 구간입니다. 과거 검증에서 의미 있는 구간은 신호가 처음 켜진 뒤 약 10거래일 이내였습니다.'); if (x.note) r.lines.push(x.note); return r;
  }
  r.kind = 'buy'; r.label = `신규 신호 · 분할 검토 ${names[x.k]}`; r.lines.push(`점수 ${x.score}/100 · 신호 후 ${x.since}일째`); if (x.note) r.lines.push(x.note);
  const cl = confLine(L, x.k); if (cl) r.lines.push('과거 검증: ' + cl);
  if ((S.episodes[sym + '|' + L] || []).includes(x.k)) { r.kind = 'hold'; r.label = `이번 하락 구간에서 ${x.k}차 이미 집행 — 대기`; r.lines.push('같은 차수는 반복하지 않고 더 강한 신호를 기다립니다.'); return r; }
  if (hold && hold.pl < -.3 && hold.wt > st.maxPos / 100 * .8) { r.kind = 'hold'; r.label = '이미 비중·손실이 큼 — 추가 보류'; r.lines.push('비중이 크고 손실이 크면 늘리지 않습니다.'); return r; }
  if (!P.eq) { r.lines.push(`가용 현금의 ${st.tranche[x.k - 1]}% 사용 (내 계좌 탭에 현금·보유를 입력하면 금액 계산)`); return r; }
  const dep = Math.max(0, S.cash - P.eq * st.reserve / 100); let amt = dep * st.tranche[x.k - 1] / 100; const cur = hold ? hold.val : 0;
  amt = Math.min(amt, Math.max(0, P.eq * st.maxPos / 100 - cur)); if (lv.lev > 1) amt = Math.min(amt, Math.max(0, P.eq * st.maxLev / 100 - P.lev));
  r.amount = Math.max(0, amt); r.shares = Math.floor(r.amount / toUSD(sym, lv.price));
  if (r.amount > 0 && r.shares < 1) { r.lines.push('권장 금액으로는 1주(' + fmtPx(sym, lv.price) + ')도 살 수 없습니다 — 이번 차수는 건너뜁니다.'); r.amount = 0; r.shares = 0; return r; }
  if (r.shares > 0) r.amount = r.shares * toUSD(sym, lv.price);
  r.lines.push(r.amount > 0 ? `내 기준 계산 예시 ${fmtAmt(sym, r.amount)} ≈ ${r.shares}주 (가용 ${F.usd(dep)}의 ${st.tranche[x.k - 1]}%, 한도 적용)` : '비중·레버리지 한도 도달 — 추가 불가');
  if (P.cashPct != null && P.cashPct * 100 < st.cashTarget * .6) r.lines.push('현금 비중이 목표보다 크게 낮음 — 매수보다 현금 확보 우선.');
  return r;
}

/* ───────── 공통 UI ───────── */
const VIEWS = [['today', '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>', '오늘'], ['stock', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17l5-6 4 3 7-9"/><path d="M4 21h16"/></svg>', '종목'], ['market', '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>', '시장'], ['whales', '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.5 3-5.5 6-5.5s6 2 6 5.5M16 5.2a3 3 0 010 5.6M18 20c0-2.5-1.2-4-3-4.8"/></svg>', '거물'], ['acct', '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 14.5h2"/></svg>', '내 계좌'], ['set', '⚙', '설정']];
function navHTML() { return VIEWS.filter(v => v[0] !== 'set').map(([k, i, t]) => `<button class="nb" role="tab" data-v="${k}" aria-selected="${k === view}"><span class="ic">${i}</span><span>${t}</span></button>`).join(''); }
function go(v, sym) { view = v; if (sym) curSym = sym; try { history.replaceState(null, '', '#' + v + (sym ? '/' + sym : '')); } catch (e) { } render(); window.scrollTo(0, 0); }
let modalPushed = false, modalRet = null;   // 팝업이 열린 동안 기록 항목을 하나 쌓아, 뒤로 가기가 앱 종료 대신 팝업 닫기가 되게 한다
function openModal(h) {
  const m = $('#modal'); if (m.hidden) modalRet = document.activeElement;
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="상세 보기" tabindex="-1">${h}</div>`; m.hidden = false; const app = $('.app'); if (app) app.inert = true;
  const f = $('input,select', m) || $('.sheet', m); f && f.focus({ preventScroll: true });
  if (!modalPushed) { try { history.pushState({ modal: 1 }, ''); modalPushed = true; } catch (e) { } }
}
function hideModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; const app = $('.app'); if (app) app.inert = false; try { modalRet && modalRet.isConnected && modalRet.focus({ preventScroll: true }); } catch (e) { } modalRet = null; }
const closeModal = nav => {
  hideModal();
  if (modalPushed) { modalPushed = false; if (!nav) { try { if (history.state && history.state.modal) history.back(); } catch (e) { } } }   // nav=true: 곧 다른 화면으로 이동하므로 쌓은 항목을 그대로 둠
};
window.addEventListener('popstate', () => { const m = $('#modal'); if (m && !m.hidden) { modalPushed = false; hideModal(); } });
const pill = (t, k = '') => `<span class="pill ${k}">${esc(t)}</span>`;
const ring = (score, L) => `<div class="ring" style="--p:${score};--rc:${LC[L]}"><b>${score}</b></div>`;
const actPill = (x, p) => p.kind === 'buy' ? pill(x.k + '차 신호', 'good') : p.kind === 'trim' ? pill('과열', 'warn') : (p.kind === 'hold' && x.k > 0 && !x.fresh) ? pill('지속', 'mut') : p.kind === 'hold' ? pill('관찰') : pill('관망', 'mut');
function renderFresh() { const f = freshness(), b = $('#fresh'); b.className = 'fresh ' + f.k; b.innerHTML = `<i></i><span>${esc(f.t)}</span>`; b.title = f.d; }

/* ───────── 오늘 ───────── */
function marketNow() {
  if (!MK) return null; const i = MK.n - 1, q = PX.QQQ, o = { vix: MK.vix[i], fear: MK.fear[i], breadth: MK.breadth[i], inv: MK.vix[i] && MK.v3[i] ? MK.vix[i] / MK.v3[i] : null };
  if (q && q.c.length > 252) o.qdd = q.c.at(-1) / maxOf(q.c.slice(-252)) - 1; return o;
}
function vToday() {
  const L = 'C', m = marketNow(), items = S.watch.map(w => ({ w, lv: LIVE[w.sym] })).filter(x => x.lv);
  const cn = cnnLive(), fearV = cn ? 100 - cn.score : m?.fear;   // 공포 정도(높을수록 공포)
  const mood = !m ? ['데이터 대기', ''] : fearV >= 75 ? ['극단적 공포 — 시장 심리 지표일 뿐 바닥 신호가 아닙니다', 'bad'] : fearV >= 55 ? ['공포 — 조정 진행', 'warn'] : fearV <= 25 ? ['극단적 탐욕 — 과열 주의', 'warn'] : fearV <= 45 ? ['탐욕 우세', 'good'] : ['중립', 'good'];
  const [mHead, mSub] = mood[0].split(' — '), dtk = cn ? 'cnn' : 'fear';
  let h = `<div class="hero ${mood[1]}"><button class="hero-main" data-dt="${dtk}"><span class="l">시장 온도 ›</span><b class="verdict">${esc(mHead)}</b>${mSub ? `<span class="sub">${esc(mSub)}</span>` : ''}</button><div class="hero-stats"><button data-dt="${dtk}"><span class="l">${cn ? '공포탐욕' : '공포지수'}</span><b>${cn ? cn.score.toFixed(0) : F.n1(m?.fear)}</b><span class="sub">${cn ? esc(CNN_KO[cn.rating] || cn.rating) + ' · CNN' : '자체 계산'}</span></button><button data-dt="px:^VIX"><span class="l">VIX</span><b>${F.n1(m?.vix)}</b><span class="sub">${m?.inv ? (m.inv >= 1 ? '기간구조 역전' : '기간구조 정상') : '–'}</span></button><button data-dt="qdd"><span class="l">QQQ 낙폭</span><b>${F.pct(m?.qdd, 0)}</b><span class="sub">약세 섹터 ${F.p0(m?.breadth)}</span></button></div></div>`;
  if (!marketOpen()) h += wkCard();
  h += earnScheduleCard(7);
  const lv = x => x.lv.lens[L], buys = items.filter(x => lv(x).k > 0 && !lv(x).over && lv(x).fresh).sort((a, b) => lv(b).score - lv(a).score), trims = items.filter(x => lv(x).over), watch = items.filter(x => !lv(x).over && !(lv(x).k > 0 && lv(x).fresh) && (lv(x).k > 0 || lv(x).score >= 25)).sort((a, b) => lv(b).score - lv(a).score).slice(0, 6);
  const card = x => { const p = planFor(x.w.sym, L), l = x.lv.lens[L]; return `<button class="act ${p.kind}" data-go="${esc(x.w.sym)}">${ring(l.score, L)}<div><div class="row"><span class="t">${esc(dispName(x.w))}</span>${x.w.lev > 1 ? pill(x.w.lev + 'x', 'warn') : ''}${isKR(x.w.sym) ? pill('미국 지표 기준', 'mut') : ''}${actPill(l, p)}<span class="sp"></span><span class="b">${fmtPx(x.w.sym, x.lv.price)}</span></div><div class="s">${esc(p.label)}${p.amount ? ' · ' + fmtAmt(x.w.sym, p.amount) + ' (' + p.shares + '주)' : ''}</div></div></button>`; };
  h += `<div class="card full" style="margin-top:12px"><h2>오늘의 신호</h2>`;
  if (!items.length) h += `<div class="empty">시세를 받는 중이거나 데이터가 없습니다. 우측 상단 ↻ 를 눌러보세요.</div>`;
  else {
    const P0 = portfolio(), dep0 = P0.eq ? Math.max(0, S.cash - P0.eq * S.settings.reserve / 100) : 0, tot0 = buys.reduce((a, x) => a + (planFor(x.w.sym, L)?.amount || 0), 0);
    const dupNote = buys.length > 1 && P0.eq && tot0 > dep0 * 1.01 ? `<div class="note small" style="margin:0 0 8px">카드마다 같은 현금으로 계산해 예시 금액 합계(${F.usd(tot0)})가 투자 가능 현금(${F.usd(dep0)})을 넘습니다.</div>` : '';
    h += buys.length ? `<p class="small muted" style="margin:0 0 8px">새로 켜진 매수 신호 ${buys.length}개 · 차수별로 나눠서</p>` + dupNote + buys.slice(0, 5).map(card).join('') + (buys.length > 5 ? `<details style="margin-bottom:10px"><summary class="b" style="cursor:pointer;padding:6px 0">나머지 ${buys.length - 5}개 보기</summary><div style="margin-top:8px">${buys.slice(5).map(card).join('')}</div></details>` : '') : `<div class="empty" style="padding:12px">지금은 <b>새로 켜진 매수 신호</b>가 없습니다.</div>`;
    if (trims.length) h += `<h3 style="margin:10px 0 8px">과열 — 신규 매수 중단</h3>` + trims.map(card).join('');
    if (watch.length) h += `<details style="margin-top:10px"><summary class="b" style="cursor:pointer;padding:6px 0">관찰·지속 중 (${watch.length})</summary><div style="margin-top:8px">` + watch.map(card).join('') + `</div></details>`;
  }
  h += `</div>`;
  const al = (S.alertLog || []).filter(a => Date.now() - a.t < 48 * 36e5).slice(0, 3); if (al.length) h += `<div class="card"><h2>가격 알림</h2>${al.map(a => `<div class="small" style="padding:3px 0">${esc(a.msg)} <span class="muted">${new Date(a.t).toLocaleString('ko-KR', { hour12: false })}</span></div>`).join('')}</div>`;
  $('#v-today').innerHTML = h;
}

/* ───────── 종목 ───────── */
let hover = null, watchEdit = false;
function removeWatch(sym) {
  const w = S.watch.find(x => x.sym === sym); if (!w) return; const held = S.holdings.some(x => x.sym === sym);
  if (!confirm(dispName(w) + ' 을(를) 관심종목에서 삭제할까요?' + (held ? ' (내 계좌의 보유 기록은 남아 있고 시세는 계속 받습니다.)' : ''))) return;
  S.watch = S.watch.filter(x => x.sym !== sym); delete LIVE[sym]; delete FEAT[sym]; if (curSym === sym) curSym = null; if (!S.watch.length) watchEdit = false; save(); recompute(); render();
}
function vStock() {
  if (!curSym || !S.watch.find(w => w.sym === curSym)) curSym = S.watch[0]?.sym; const w = S.watch.find(x => x.sym === curSym), L = S.settings.lens, el = $('#v-stock');
  let h = `<div class="chips" style="margin-bottom:10px">${S.watch.map(x => watchEdit ? `<span class="chipx"><button class="chip" data-sym="${esc(x.sym)}" aria-pressed="${x.sym === curSym}">${esc(dispName(x))}</button><button class="chip del" data-delsym="${esc(x.sym)}" aria-label="${esc(dispName(x))} 삭제">✕</button></span>` : `<button class="chip" data-sym="${esc(x.sym)}" aria-pressed="${x.sym === curSym}">${esc(dispName(x))}</button>`).join('')}<button class="chip" id="addSym">＋ 추가</button><button class="chip" id="editWatch" aria-pressed="${watchEdit}">${watchEdit ? '완료' : '편집·삭제'}</button></div>${watchEdit ? '<p class="small muted" style="margin:-4px 0 10px">✕ 를 누르면 관심종목에서 삭제됩니다. 내 계좌의 보유 기록은 그대로 남습니다.</p>' : ''}`;
  if (!w) { el.innerHTML = h + '<div class="empty">종목을 추가하세요.</div>'; return; }
  const lv = LIVE[w.sym], ent = FEAT[w.sym];
  if (!lv) { el.innerHTML = h + `<div class="card"><h2>${esc(w.sym)} 시세 없음</h2><p class="muted">아직 데이터를 받지 못했습니다(신규 종목은 전체 이력 수집에 몇 초 걸립니다).</p><div class="row"><button class="btn pri" id="fetchOne">이 종목 시세 받기</button><button class="btn danger" id="delSym">삭제</button></div><label class="f" style="margin-top:12px">CSV 붙여넣기(날짜,종가)<textarea id="csvIn"></textarea></label><button class="btn" id="csvGo" style="margin-top:8px">CSV 적용</button></div>`; return; }
  const Fx = ent.F, p = planFor(w.sym, L), hold = portfolio().rows.find(r => r.sym === w.sym), i = Fx.n - 1, prm = params();
  ensureFundRaw(w.sym);
  const levNote = w.lev > 1 ? `<div class="note small" style="margin-top:10px"><b>${w.lev}배 레버리지 상품</b>: 하루 단위로 지수의 ${w.lev}배를 따라가도록 설계되어 있어, 변동성이 큰 장세에서는 장기 보유 시 지수보다 크게 못 따라갈 수 있고 하락장에서는 원금 대부분을 잃을 수 있습니다. 단기 참고용입니다.</div>` : '';
  const krNote = isKR(w.sym) ? `<div class="note small" style="margin-top:10px">한국 종목은 <b>미국 시장 지표(VIX·공포지수·섹터)</b>로 계산한 점수이며, 한국 시장 기준의 과거 검증은 아직 없습니다. 시세는 원화(₩)이고 장중에는 약 10초~5분 간격으로 갱신됩니다.</div>` : '';
  const ev = E.events(Fx, lv.sc[L], L, prm.thr[L], {}), sm = ev.length ? E.summarize(ev, { [w.sym]: Fx }) : null;
  h += `<div class="card"><div class="row"><div><h2 style="margin:0">${esc(dispName(w))} ${w.lev > 1 ? pill(w.lev + '배 레버리지', 'warn') : ''}</h2><div class="small muted">${lv.date} 기준${freshness().open ? ' · 장중 잠정' : ''}</div></div><span class="sp"></span><div class="right"><div style="font-size:1.55rem;font-weight:800">${fmtPx(w.sym, lv.price)}</div><div class="small ${cls(Fx.B.dd[i])}">52주 고점 대비 ${F.pct(Fx.B.dd[i])}</div><div class="small muted">전고점(역대) 대비 ${F.pct(lv.price / maxOf(Fx.c) - 1)}</div></div></div>
  <div class="rec ${p.kind}"><div class="t">${esc(p.label)}</div>${p.lines.map(l => `<div class="small">• ${esc(l)}</div>`).join('')}</div>${krNote}${levNote}</div>
  ${signalCard(w.sym)}
  ${ddCard(w.sym)}
  ${posCard(w.sym)}
  <div class="card full"><h2>가격 · 200일선 · 과거 신호(●)<div class="chips">${['6M', '1Y', '3Y', '전체'].map(r => `<button class="chip" style="padding:3px 10px;min-height:30px" data-rng="${r}" aria-pressed="${r === range}">${r}</button>`).join('')}</div></h2><canvas id="cv" role="img" aria-label="${esc(w.sym)} 가격 차트"></canvas><div class="small muted" id="cvInfo">차트를 누르면 값이 표시됩니다 · ●는 과거 매수 신호일(1·2·3차)</div></div>`;
  if (sm) h += `<div class="card"><h2>이 종목의 과거 신호 성과</h2><dl class="kv"><dt>신호 횟수</dt><dd>${sm.n}회 (${Fx.d[E.START]} ~)</dd><dt>60일 후 상승 확률</dt><dd>${F.p0(sm.h[60].win)} <span class="muted small">(아무 날 ${F.p0(sm.h[60].baseWin)})</span></dd><dt>60일 평균 수익</dt><dd>${F.pct(sm.h[60].mean)} <span class="muted small">(아무 날 ${F.pct(sm.h[60].baseMean)})</span></dd><dt>120일 후 상승 확률</dt><dd>${F.p0(sm.h[120].win)}</dd><dt>신호 후 60일 내 최대 낙폭(중앙값)</dt><dd class="neg">${F.pct(sm.mae)}</dd></dl><p class="small muted">상승 종목 위주의 과거 구간이라 실제보다 좋게 나올 수 있습니다. 전체 검증은 ‘검증’ 탭.</p></div>`;
  h += `
  ${valCard(w.sym)}
  ${alertCard(w.sym)}
  ${whaleCardFor(w.sym)}
  <details class="card">
  <summary class="b sumh">종목 설정</summary><div class="form"><label class="f">레버리지 배율<select id="sLev">${[1, 2, 3].map(x => `<option ${x === w.lev ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label class="f">시장 베타<input id="sBeta" inputmode="decimal" value="${w.beta ?? 1}"></label><label class="f">유형<select id="sType"><option value="etf" ${w.type === 'etf' ? 'selected' : ''}>ETF</option><option value="stock" ${w.type === 'stock' ? 'selected' : ''}>개별주</option></select></label></div><div class="row" style="margin-top:10px"><button class="btn sm" id="sSave">저장</button><span class="sp"></span><button class="btn sm danger" id="delSym">삭제</button></div></details>`;
  el.innerHTML = h;
  reorderCards(el, ['신호 근거', '가격 · 200일선', '고점 대비 하락', '실적 발표', '만기별 예상 범위', '옵션 포지션', '공매도·기관', '투자자별 순매매', '포지션·수급', '투자지표', '이 종목의 과거', '가격 알림', '거물·내부자', '종목 설정']);
  drawChart(Fx, ev);
}
function drawChart(Fx, ev) {
  const cv = $('#cv'); if (!cv) return; const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const c = Fx.c, d = Fx.d, n = c.length, take = Math.min(n, { '6M': 126, '1Y': 252, '3Y': 756, '전체': n }[range]), s0 = n - take, m200 = E.sma(c, 200), cs = getComputedStyle(document.documentElement), col = v => cs.getPropertyValue(v).trim();
  const vals = []; for (let i = s0; i < n; i++) { vals.push(c[i]); if (m200[i]) vals.push(m200[i]); } const hi52 = maxOf(c.slice(-252));
  const lo = Math.log(minOf(vals) * .97), hi = Math.log(Math.max(...vals, hi52) * 1.03), pl = 6, pr = 48, pt = 8, pb = 18;
  const X = i => pl + (i - s0) / (take - 1) * (W - pl - pr), Y = v => pt + (1 - (Math.log(v) - lo) / (hi - lo)) * (H - pt - pb);
  g.font = '11px system-ui'; g.fillStyle = col('--mut'); g.lineWidth = 1; g.strokeStyle = col('--line');
  for (let k = 0; k <= 4; k++) { const v = Math.exp(lo + (hi - lo) * k / 4), y = Y(v); g.beginPath(); g.moveTo(pl, y); g.lineTo(W - pr, y); g.stroke(); g.fillText(v >= 100 ? v.toFixed(0) : v.toFixed(1), W - pr + 4, y + 4); }
  const line = (a, color, wd, dash) => { g.beginPath(); let st = false; g.setLineDash(dash || []); g.strokeStyle = color; g.lineWidth = wd; for (let i = s0; i < n; i++) { if (a[i] == null) continue; const x = X(i), y = Y(a[i]); st ? g.lineTo(x, y) : (g.moveTo(x, y), st = true); } g.stroke(); g.setLineDash([]); };
  line(m200, '#f59e0b', 1.6); line(c, col('--ink'), 1.6);
  g.strokeStyle = col('--bad'); g.setLineDash([2, 4]); g.beginPath(); g.moveTo(pl, Y(hi52)); g.lineTo(W - pr, Y(hi52)); g.stroke(); g.setLineDash([]);
  const L = S.settings.lens, colk = { 1: '#60a5fa', 2: '#34d399', 3: '#f59e0b' }; ev.forEach(e => { if (e.i + 1 >= s0 && e.i + 1 < n) { g.fillStyle = colk[e.k]; g.beginPath(); g.arc(X(e.i + 1), Y(c[e.i + 1]), 4 + e.k, 0, 7); g.fill(); } });
  g.fillStyle = col('--mut'); g.fillText(d[s0], pl, H - 4); g.textAlign = 'right'; g.fillText(d[n - 1], W - pr, H - 4); g.textAlign = 'left';
  if (hover != null && hover >= s0 && hover < n) { const x = X(hover); g.strokeStyle = col('--mut'); g.beginPath(); g.moveTo(x, pt); g.lineTo(x, H - pb); g.stroke(); }
  const mv = e => { const r = cv.getBoundingClientRect(), x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left; hover = clamp(Math.round(s0 + (x - pl) / (W - pl - pr) * (take - 1)), s0, n - 1); const e2 = ev.find(z => z.i + 1 === hover); $('#cvInfo').textContent = `${d[hover]} · ${fmtPx(curSym, c[hover])}` + (m200[hover] ? ` · 200일 ${fmtPx(curSym, m200[hover])}` : '') + (e2 ? ` · ${e2.k}차 신호일` : ''); drawChart(Fx, ev); };
  cv.onpointermove = mv; cv.onpointerdown = mv;
}

/* ───────── 검증 ───────── */
const pc = (v, d = 0) => v == null || !isFinite(v) ? '–' : (v * 100).toFixed(d) + '%';
/* ───────── 내 계좌 ───────── */
function vAcct() {
  const P = portfolio(), st = S.settings, L = S.settings.lens; let h = '';
  const dep = P.eq ? Math.max(0, S.cash - P.eq * st.reserve / 100) : 0;
  h += `<div class="mk"><div><div class="l">총자산(USD)</div><div class="v">${F.usd(P.eq)}</div></div><div><div class="l">현금 · 비중/목표</div><div class="v">${F.usd(S.cash)} <span class="small muted">${P.cashPct == null ? '' : F.p0(P.cashPct) + '/' + st.cashTarget + '%'}</span></div></div><div><div class="l">투자 가능 현금</div><div class="v">${F.usd(dep)}</div></div><div><div class="l">레버리지 비중</div><div class="v ${P.levPct * 100 > st.maxLev ? 'neg' : ''}">${F.p0(P.levPct)} <span class="small muted">/${st.maxLev}%</span></div></div></div>`;
  h += `<div class="card" style="margin-top:12px"><h2>보유 종목 <span class="row"><button class="btn sm" id="editCash">현금</button><button class="btn sm pri" id="addHold">＋ 추가</button></span></h2>`;
  if (!P.rows.length) h += `<div class="empty">보유 종목이 없습니다. 추가하면 추천이 내 비중·현금에 맞춰 계산됩니다.</div>`;
  else h += `<div class="holds">${P.rows.map(r => { const pl = planFor(r.sym, L), lv = LIVE[r.sym], w = S.watch.find(x => x.sym === r.sym), gain = (r.p - r.avg) * r.qty; return `<div class="hold"><div class="hold-h"><div class="hold-t"><b>${esc(r.sym)}</b>${w && w.name ? ` <span class="small muted">${esc(w.name)}</span>` : ''}</div><div class="hold-pl ${cls(r.pl)}">${F.pct(r.pl)}<span class="small">${gain >= 0 ? '+' : '-'}${fmtPx(r.sym, Math.abs(gain))}</span></div></div><div class="hold-g"><div><span class="l">수량</span><b>${esc(r.qty)}</b></div><div><span class="l">평균단가</span><b>${fmtPx(r.sym, r.avg)}</b></div><div><span class="l">현재가</span><b>${fmtPx(r.sym, r.p)}</b>${r.np ? '<span class="small muted">시세 없음(매수가 기준)</span>' : ''}</div><div><span class="l">평가금액</span><b>${fmtAmt(r.sym, r.val)}</b></div><div><span class="l">비중</span><b>${F.p0(r.wt)}</b></div><div><span class="l">오늘 판단</span><span>${lv && pl ? actPill(lv.lens[L], pl) : '–'}</span></div></div><div class="row hold-b"><button class="btn sm pri" data-mytrade="${esc(r.sym)}|buy">매수·매도 기록</button><button class="btn sm" data-edith="${esc(r.sym)}">수정</button></div></div>`; }).join('')}</div>`;
  h += `</div><div class="grid g2" style="margin-top:12px"><div class="card"><h2>리스크 점검</h2>`;
  const mk = marketNow(), notes = [];
  if (P.eq) {
    notes.push(P.cashPct * 100 < st.cashTarget ? ['bad', `현금 ${F.p0(P.cashPct)} < 목표 ${st.cashTarget}% — 부족분 약 ${F.usd(P.eq * st.cashTarget / 100 - S.cash)}`] : ['good', `현금 ${F.p0(P.cashPct)} ≥ 목표 ${st.cashTarget}%`]);
    if (P.levPct * 100 > st.maxLev) notes.push(['bad', `레버리지 ${F.p0(P.levPct)} > 한도 ${st.maxLev}%`]);
    P.rows.filter(r => r.wt * 100 > st.maxPos).forEach(r => notes.push(['warn', `${r.sym} 비중 ${F.p0(r.wt)} > 단일 한도 ${st.maxPos}%`]));
    const semi = P.rows.filter(r => /SOX|^USD$|SMH|NVDA|AMD|MU/.test(r.sym)).reduce((a, r) => a + r.wt, 0); if (semi > .4) notes.push(['warn', `반도체 쏠림 ${F.p0(semi)}`]);
    if (mk && mk.fear >= 70) notes.push(['warn', '공포 구간: 현금을 차수별로 나눠 쓰고 한 번에 소진하지 않기']);
  } else notes.push(['', '현금과 보유를 입력하면 점검 결과가 표시됩니다.']);
  h += notes.map(([k, t]) => `<div class="row small" style="padding:5px 0"><span class="pill ${k || 'mut'}">${k === 'bad' ? '위험' : k === 'warn' ? '주의' : k === 'good' ? '양호' : '안내'}</span><span style="flex:1">${esc(t)}</span></div>`).join('');
  h += `</div></div>`;
  h += tradeLog();
  $('#v-acct').innerHTML = h;
}
function holdForm(sym) { const h = S.holdings.find(x => x.sym === sym); openModal(`<h2>${h ? esc(sym) + ' 보유 수정(직접 입력)' : '보유 종목 추가'}</h2>${h ? `<div class="row"><button class="btn sm pri" data-mytrade="${esc(sym)}|buy">매수 기록</button><button class="btn sm" data-mytrade="${esc(sym)}|sell">매도 기록</button></div><p class="small muted" style="margin:0">수량·평단을 합산/평균으로 반영하려면 ‘매수 기록’을 쓰세요. 이 화면은 값을 <b>덮어씁니다</b>(잘못 입력한 값 정정용).</p>` : ''}<div class="form"><label class="f">티커<input id="hSym" value="${esc(h?.sym || '')}" ${h ? 'readonly' : ''} autocapitalize="characters"></label><label class="f">수량<input id="hQty" inputmode="decimal" value="${h?.qty ?? ''}"></label><label class="f">평균단가(${h && isKR(h.sym) ? '원' : h ? 'USD' : '해당 통화'})<input id="hAvg" inputmode="decimal" value="${h?.avg ?? ''}"></label></div><div class="row"><button class="btn pri" id="hSave">저장</button><button class="btn" data-close>취소</button><span class="sp"></span>${h ? '<button class="btn danger" id="hDel">삭제</button>' : ''}</div>`); }
function tradeForm(sym, side) {
  const h = S.holdings.find(x => x.sym === sym), today = new Date().toLocaleDateString('sv-SE'), px = sym ? priceOf(sym) : null;
  openModal(`<h2>거래 기록 <button class="btn sm" data-close>닫기</button></h2><div class="form"><label class="f">구분<select id="tSide"><option value="buy" ${side !== 'sell' ? 'selected' : ''}>매수</option><option value="sell" ${side === 'sell' ? 'selected' : ''}>매도</option></select></label><label class="f">티커<input id="tSym" value="${esc(sym || '')}" autocapitalize="characters" placeholder="예: NVDA"></label><label class="f">거래 날짜<input type="date" id="tDate" value="${today}"></label><label class="f">수량<input id="tQty" inputmode="decimal"></label><label class="f">체결 단가 (해당 통화)<input id="tPx" inputmode="decimal" value="${px ? +px.toFixed(2) : ''}"></label></div>${h ? `<p class="small muted" style="margin:0">현재 보유 ${h.qty}주 · 평단 ${fmtPx(h.sym, h.avg)}</p>` : ''}<label class="chk"><input type="checkbox" id="tCash" ${S.cash > 0 ? 'checked' : ''}><span>현금(USD)에 반영 — 매수는 차감, 매도는 증가</span></label><p class="small muted" style="margin:0">매수는 수량을 더하고 <b>평균 단가를 가중평균</b>으로 다시 계산합니다. 매도는 수량을 줄이고 <b>실현손익</b>을 기록합니다(평단은 그대로).</p><div class="row"><button class="btn pri" id="tSave">저장</button><button class="btn" data-close>취소</button></div>`);
}
function saveTrade() {
  const sym = cleanSym($('#tSym').value), side = $('#tSide').value, date = $('#tDate').value, q = num($('#tQty').value), px = num($('#tPx').value), cash = $('#tCash').checked;
  if (!sym || !(q > 0) || !(px > 0) || !date) return alert('티커·날짜·수량·단가를 확인하세요. (숫자만, 소수점은 . 으로 입력)');
  if (q > 1e9 || px > 1e9 || !isFinite(q * px)) return alert('수량·단가가 너무 큽니다.');
  if (date > new Date().toLocaleDateString('sv-SE')) return alert('미래 날짜는 기록할 수 없습니다.');
  let ncash = null; if (cash) { ncash = (S.cash || 0) + (side === 'buy' ? -1 : 1) * toUSD(sym, q * px); if (ncash < 0 && !confirm('보유 현금이 부족합니다(부족분 약 ' + F.usd(-ncash) + '). 현금을 0 으로 맞추고 저장할까요?')) return; }   // 보유를 바꾸기 전에 확인
  let h = S.holdings.find(x => x.sym === sym), avgBefore = h ? h.avg : null, pl = null; const qty = Math.round(q * 1e6) / 1e6;
  if (side === 'buy') { const nv = ((h ? h.avg * h.qty : 0) + px * qty) / ((h ? h.qty : 0) + qty); if (!isFinite(nv)) return alert('값이 너무 커서 평균 단가를 계산할 수 없습니다.'); if (!h) { h = { sym, qty: 0, avg: 0 }; S.holdings.push(h); } h.avg = (h.avg * h.qty + px * qty) / (h.qty + qty); h.qty = Math.round((h.qty + qty) * 1e6) / 1e6; }
  else { if (!h || qty > h.qty + 1e-9) return alert(`보유 수량(${h ? h.qty : 0}주)보다 많이 매도할 수 없습니다.`); pl = (px - h.avg) * qty; h.qty = Math.round((h.qty - qty) * 1e6) / 1e6; if (h.qty <= 1e-9) S.holdings = S.holdings.filter(x => x !== h); }
  if (cash) S.cash = Math.max(0, ncash);
  S.journal.push({ id: Date.now(), date, sym, side, qty, px, avg: avgBefore, pl, fx: isKR(sym) ? fxKRW() : 1 });
  if (!S.watch.find(w => w.sym === sym)) S.watch.push({ sym, lev: 1, type: 'stock', beta: 1 });
  save(); closeModal(); recompute(); render(); refresh(false);
}
function tradeLog() {
  const J = [...S.journal].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id), real = S.journal.filter(j => j.side === 'sell' && j.pl != null).reduce((a, j) => a + (isKR(j.sym) ? j.pl / (j.fx || fxKRW()) : j.pl), 0);
  const item = j => `<div class="trl"><div class="trl-h"><span class="small muted">${esc((j.date || '').slice(2))}</span>${pill(j.side === 'buy' ? '매수' : '매도', j.side === 'buy' ? 'good' : 'warn')}<b>${esc(j.sym)}</b><span class="sp"></span><button class="btn sm danger" data-jdel="${j.id}" aria-label="기록 삭제">✕</button></div><div class="trl-b"><span>${esc(j.qty)}주 × ${fmtPx(j.sym, j.px)}</span>${j.side === 'sell' && j.pl != null ? `<span class="${cls(j.pl)}">실현 ${j.pl >= 0 ? '+' : '-'}${fmtPx(j.sym, Math.abs(j.pl))}${j.avg ? ' (' + F.pct(j.px / j.avg - 1) + ')' : ''}</span>` : '<span class="muted small">평단에 합산</span>'}</div></div>`;
  return `<div class="card"><h2>거래 내역 <span class="muted small">${J.length}건</span></h2>${J.length ? `<dl class="kv" style="margin-bottom:6px"><dt>실현 손익 합계(USD 환산)</dt><dd class="${cls(real)}">${real >= 0 ? '+' : '-'}${F.usd(Math.abs(real))}</dd></dl><div class="trls">${J.slice(0, 40).map(item).join('')}</div>${J.length > 40 ? `<p class="small muted" style="margin:6px 0 0">최근 40건만 표시합니다.</p>` : ''}<p class="small muted" style="margin:8px 0 0">✕ 는 기록만 지우며 보유 수량·평단은 되돌리지 않습니다(보유는 ‘수정’에서 정정).</p>` : '<div class="empty" style="padding:12px">아직 거래 기록이 없습니다. 보유 종목의 ‘매수·매도 기록’ 버튼으로 남기세요.</div>'}</div>`;
}

/* ───────── 거물 거래(내부자·기관·의원) — 공식 공시만 사용 ───────── */
let wShow = 15; let TR = { trades: [], f13: {}, co: {}, status: null }, wTab = 'feed', wFilter = 'all', wPerson = null, wFund = null;
const CODE_KO = { P: '공개시장 매수', S: '공개시장 매도', A: '주식 보상(Grant)', M: '옵션 행사', F: '세금용 원천징수', G: '증여', C: '전환', D: '발행사에 처분', X: '옵션 행사', J: '기타', W: '상속/유증', I: '재량 거래', K: '지분스왑', L: '소액 거래', V: '자발적 보고' };
const F13_KO = { NEW: '신규 편입', ADD: '비중 확대', REDUCE: '비중 축소', SOLD: '전량 매도' };
async function syncTracker() {
  try {
    const st = await jget('data/tracker/status.json?t=' + Date.now(), 8000, { cache: 'no-store' });
    if (TR.status && TR.status.updated === st.updated && TR.trades.length) return;
    const [trades, f13, co] = await Promise.all(['trades', 'f13', 'co'].map(n => jget(`data/tracker/${n}.json?v=${st.updated}`, 25000)));
    TR = { trades, f13, co, status: st }; IDB.set('tr', TR);
  } catch (e) { /* 마지막 저장본 유지 */ }
}
const money = v => v == null || !isFinite(v) ? '-' : Math.abs(v) >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B' : Math.abs(v) >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : Math.abs(v) >= 1e3 ? '$' + (v / 1e3).toFixed(1) + 'K' : '$' + Math.round(v);
const tAct = t => t.source === 'form4' ? (CODE_KO[t.code] || t.code) : t.source === '13f' ? (F13_KO[t.code] || t.code) : t.source === 'ptr' ? 'PTR 제출' : (t.code || '의원 거래');
const tSign = t => t.side === 'BUY' ? 1 : t.side === 'SELL' ? -1 : 0;
function roleW(r) { r = (r || '').toLowerCase(); return /ceo|chief executive|chair|president|founder|창업|회장/.test(r) ? 1.3 : /cfo|chief financial|coo|cto/.test(r) ? 1.15 : r.includes('10%') ? 1.1 : 1; }
function mktSnap(sym) {
  const s = sym && PX[sym]; if (!s || s.c.length < 60) return null; const c = s.c, n = c.length, last = c[n - 1], w = c.slice(-252), hi = maxOf(w), lo = minOf(w), ret = k => n > k ? last / c[n - 1 - k] - 1 : null;
  const r = []; for (let i = Math.max(1, n - 60); i < n; i++) r.push(c[i] / c[i - 1] - 1); const vol = r.length ? Math.sqrt(r.reduce((a, b) => a + b * b, 0) / r.length) * Math.sqrt(252) : null;
  return { sym, price: last, hi52: hi, lo52: lo, pos52: hi > lo ? (last - lo) / (hi - lo) : null, r1m: ret(21), r3m: ret(63), r6m: ret(126), vol, d: s.d, c };
}
function priceOn(m, date) { let b = null; for (let i = 0; i < m.d.length; i++) { if (m.d[i] <= date) b = m.c[i]; else break; } return b; }
function analyzeTrade(t, withMkt) {
  const f = [], notes = [], sign = tSign(t), value = t.value || 0, src = t.source; let score = 0;
  const mkt = withMkt && t.ticker ? mktSnap(t.ticker) : null, td = Date.parse(t.trade_date || '1970-01-01');
  const sibs = t.ticker ? TR.trades.filter(x => x.ticker === t.ticker && x.id !== t.id && (x.side === 'BUY' || x.side === 'SELL') && Math.abs(Date.parse(x.trade_date || '1970-01-01') - td) <= 45 * 864e5).slice(0, 30) : [];
  if (src === 'form4') {
    if (t.code === 'P') { score += 50; f.push(['공개시장 매수', 50, '내부자가 자기 돈으로 시장에서 직접 매수(참고용 · 효과는 검증하지 못함)']); }
    else if (t.code === 'S') { score -= 25; f.push(['공개시장 매도', -25, '매도는 세금·분산·생활자금 등 비투자적 이유가 많아 신호가 매수보다 약함']); }
    else f.push([CODE_KO[t.code] || t.code, 0, '보상 수령·세금 처리·증여·옵션 행사 등은 투자 판단이 담긴 거래가 아닐 가능성이 큼']);
    if (sign) {
      const m = roleW(t.role); if (m !== 1) { const d = Math.round(score * (m - 1)); score += d; f.push(['직책 가중', d, t.role + ' — 경영 정보 접근도가 높음']); }
      const d = value >= 1e7 ? 15 : value >= 1e6 ? 10 : value >= 2.5e5 ? 5 : (value && value < 5e4) ? -5 : 0; if (d) { score += sign * d; f.push(['거래 규모 ' + money(value), sign * d, '금액이 클수록 확신의 크기를 반영']); }
      if (t.owned_after != null && t.shares) { const before = sign > 0 ? t.owned_after - t.shares : t.owned_after + t.shares; if (before > 0) { const chg = t.shares / before, d2 = chg >= .2 ? 10 : chg >= .05 ? 5 : chg < .01 ? -5 : 0; if (d2) score += sign * d2; f.push([`보유분 대비 ${(chg * 100).toFixed(1)}%`, sign * d2, '거래 직전 보유 주식 대비 변동 비율(직접·간접 구분 주의)']); } }
      if (t.planned) { const d3 = -Math.round(score * .6); score += d3; f.push(['10b5-1 사전 매매계획', d3, '미리 정해진 일정의 기계적 거래라 시점 정보 가치가 낮음']); }
    }
    if (t.direct === 'I') notes.push('간접 보유(신탁·법인 등) 명의의 거래입니다.');
  } else if (src === '13f') {
    const ex = Object.fromEntries((t.extra || '').split(';').map(p => p.split('='))), w = +ex.weight || 0, base = { NEW: 35, ADD: 20, REDUCE: -15, SOLD: -30 }[t.code] || 0; score += base; f.push([F13_KO[t.code] || t.code, base, '직전 분기 대비 보유 수량 변화 기준']);
    if (w >= .05 && sign > 0) { score += 15; f.push([`포트폴리오 비중 ${(w * 100).toFixed(1)}%`, 15, '상위 비중 종목 — 확신 매수로 해석 가능']); } else if (w >= .01 && sign > 0) { score += 5; f.push([`포트폴리오 비중 ${(w * 100).toFixed(1)}%`, 5, '의미 있는 규모의 포지션']); }
    notes.push('13F는 분기말 스냅샷이며 최대 45일 지연 공시됩니다. 공시 시점에 이미 포지션이 바뀌었을 수 있고 공매도·해외 주식은 포함되지 않습니다. 티커는 CUSIP→OpenFIGI 매핑입니다.');
  } else if (src === 'ptr') { f.push(['PTR 제출 공시', 0, '하원 사무처 공식 색인에 등록된 제출 사실입니다. 종목·금액·매수/매도 여부는 원문 PDF에서 확인해야 하며 앱은 추측하지 않습니다.']); notes.push('STOCK Act상 거래 후 최대 45일 내 제출됩니다.'); }
  else { score += 15 * sign; f.push(['의원 거래', 15 * sign, '금액은 범위로만 공시되어 중간값 추정치이며 공시 지연(최대 45일)이 큽니다.']); if (value >= 1e5) { score += 5 * sign; f.push(['규모 ' + money(value) + ' (추정)', 5 * sign, '고액 구간']); } notes.push('의원 거래는 배우자·자녀 명의가 포함될 수 있습니다.'); }
  let post = null;
  if (mkt) {
    const px = t.trade_date ? priceOn(mkt, t.trade_date) : null; if (px) post = mkt.price / px - 1;
    if (sign && mkt.pos52 != null) {
      if (sign > 0 && mkt.pos52 <= .3) { score += 6; f.push(['52주 저점권 매수', 6, `52주 범위 하단 ${(mkt.pos52 * 100).toFixed(0)}% 지점 — 역발상 매수 성격`]); }
      else if (sign < 0 && mkt.pos52 >= .85) { score -= 3; f.push(['52주 고점권 매도', -3, '고점 부근 차익실현 가능성']); }
      else if (sign > 0 && mkt.pos52 >= .9) notes.push('52주 고점 부근에서의 매수라 추격 매수 성격일 수 있습니다.');
    }
    if (post != null && sign) notes.push(`거래일 종가(${F.usd2(px)}) 대비 현재 ${F.pct(post)} — ${(post > 0) === (sign > 0) ? '신호 방향과 일치' : '신호와 반대로 움직임'}`);
  }
  const same = sibs.filter(s => s.side === t.side && s.person !== t.person), opp = sibs.filter(s => s.side !== t.side);
  if (sign && same.length) { const d = Math.min(16, 8 * same.length); score += sign * d; f.push([`동일 종목 동조 거래 ${same.length}건`, sign * d, [...new Set(same.map(s => s.person))].join(', ').slice(0, 80) + ' (±45일)']); }
  if (sign && opp.length) notes.push(`±45일 내 반대 방향 거래 ${opp.length}건이 있어 신호가 엇갈립니다.`);
  score = clamp(Math.round(score), -100, 100);
  const verdict = (!sign && !(f[0] && f[0][1])) ? '중립 (정보 가치 낮음)' : score >= 50 ? '매수 규모가 큼(미검증)' : score >= 20 ? '낙관 우세' : score > -20 ? '중립' : score > -50 ? '경계 (매도 우세)' : '강한 비관/차익실현 신호';
  return { score, verdict, factors: f, notes, post, mkt, sibs };
}
const scPill = s => pill((s > 0 ? '+' : '') + s, s >= 20 ? 'good' : s <= -20 ? 'bad' : 'mut');
const whalesFor = sym => TR.trades.filter(t => t.ticker === sym && t.source !== 'ptr').slice(0, 40);
function tradeCard(t) {
  const a = analyzeTrade(t, false), isPtr = t.source === 'ptr';
  return `<button class="act ${t.side === 'BUY' ? 'buy' : t.side === 'SELL' ? 'trim' : 'hold'}" style="grid-template-columns:1fr" data-trade="${esc(t.id)}"><div><div class="row"><span class="t">${esc(t.person)}</span>${t.ticker ? pill(t.ticker) : ''}<span class="sp"></span>${isPtr ? pill('PTR', 'mut') : scPill(a.score)}</div><div class="s">${esc(tAct(t))}${t.value ? ' · ' + money(t.value) : ''}${t.price ? ' · $' + t.price.toFixed(2) : ''}</div><div class="s">${esc(t.role || '')} · 공시 ${esc((t.filed_at || '').slice(0, 10))}${t.trade_date ? ' (거래 ' + esc(t.trade_date) + ')' : ''}</div></div></button>`;
}
function tradeSheet(id) {
  const t = TR.trades.find(x => x.id === id); if (!t) return; const sym = t.ticker;
  const go2 = async () => { };
  const render2 = a => openModal(`<h2>${esc(t.person)} · ${esc(tAct(t))}</h2><div class="small muted">${esc(t.role || '')} · ${esc(t.issuer || '')} ${sym ? pill(sym) : ''}</div>
    <div class="rec ${a.score >= 20 ? 'buy' : a.score <= -20 ? 'trim' : 'hold'}"><div class="t">${esc(a.verdict)} (${a.score > 0 ? '+' : ''}${a.score})</div><div class="small">공시 ${esc((t.filed_at || '').slice(0, 10))} · 거래 ${esc(t.trade_date || '-')}${t.shares ? ' · ' + Math.round(t.shares).toLocaleString() + '주' : ''}${t.value ? ' · ' + money(t.value) : ''}</div></div>
    ${a.factors.map(x => `<div class="sig" style="grid-template-columns:1fr auto"><div><div>${esc(x[0])}</div><div class="small muted">${esc(x[2])}</div></div>${pill((x[1] > 0 ? '+' : '') + x[1], x[1] > 0 ? 'good' : x[1] < 0 ? 'bad' : 'mut')}</div>`).join('')}
    ${a.mkt ? `<div class="small">현재 ${esc(sym)} ${F.usd2(a.mkt.price)} · 52주 ${F.usd2(a.mkt.lo52)}~${F.usd2(a.mkt.hi52)} (위치 ${F.p0(a.mkt.pos52)}) · 1개월 ${F.pct(a.mkt.r1m)} · 3개월 ${F.pct(a.mkt.r3m)} · 변동성 ${F.p0(a.mkt.vol)}</div>` : ''}
    ${a.notes.map(n => `<div class="note small">${esc(n)}</div>`).join('')}
    <div class="row">${t.url ? `<a class="btn sm" href="${esc(safeUrl(t.url))}" target="_blank" rel="noopener">SEC/원문 보기</a>` : ''}${sym ? `<button class="btn sm pri" data-opensym="${esc(sym)}">종목 상세</button>` : ''}<button class="btn sm" data-close>닫기</button></div>
    <p class="small muted">공개 공시에 기반한 참고용 분석이며 투자 자문이 아닙니다. 내부자·기관의 거래가 미래 수익을 보장하지 않습니다. 이 점수는 규칙 기반이며 과거 수익으로 검증되지 않았습니다(공시 이력이 짧아 검증 불가).</p>`);
  render2(analyzeTrade(t, true));
  if (sym && !mktSnap(sym)) fetchLive(sym, '1y').then(o => { PX[sym] = PX[sym] || o; if (!$('#modal').hidden) render2(analyzeTrade(t, true)); }).catch(() => { });
}
const secLast = st => st.sec_ok_at ? '마지막 정상 수집 ' + new Date(st.sec_ok_at * 1000).toLocaleDateString('ko-KR') : '마지막 정상 데이터';
function vWhales() {
  const st = TR.status, el = $('#v-whales'); let h = '';
  const tabs = [['feed', '피드'], ['people', '인물'], ['f13', '13F 펀드'], ['cong', '의원']];
  h += `<div class="chips" style="margin-bottom:10px">${tabs.map(([k, n]) => `<button class="chip" data-wt="${k}" aria-pressed="${wTab === k}">${n}</button>`).join('')}</div>`;
  if (!TR.trades.length) { el.innerHTML = h + '<div class="empty">거물 거래 데이터를 불러오는 중이거나 아직 없습니다.</div>'; return; }
  const secFresh = st && st.sec !== 'ok' && st.sec_ok_at && Date.now() - st.sec_ok_at * 1000 < 36 * 36e5;
  const secTxt = !st ? '' : st.sec === 'ok' ? pill('SEC 정상', 'good') : secFresh ? pill('SEC 정상 · PC 수집 ' + new Date(st.sec_ok_at * 1000).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: false }), 'good') : st.sec === 'cooldown' ? pill('SEC 제한 후 휴지 중 — ' + secLast(st), 'warn') : st.sec === 'blocked' ? pill('SEC 서버 접근 제한 — ' + secLast(st), 'warn') : pill('SEC ' + st.sec, 'warn');
  h += `<p class="small muted" style="margin:0 0 8px">${secTxt} ${st ? '· 수집 ' + new Date(st.updated * 1000).toLocaleString('ko-KR', { hour12: false }) : ''} · 공시 자체가 지연됩니다(Form 4: 거래 후 2영업일, 13F: 분기말+45일, 의원: 최대 45일).</p>`;
  const L = TR.trades;
  if (wTab === 'feed') {
    const fl = [['all', '전체'], ['form4', '내부자'], ['13f', '13F'], ['buy', '매수만'], ['mine', '내 종목']];
    h += `<div class="chips" style="margin-bottom:10px">${fl.map(([k, n]) => `<button class="chip" data-wf="${k}" aria-pressed="${wFilter === k}">${n}</button>`).join('')}</div>`;
    if (wPerson) h += `<p class="small">인물 필터: <b>${esc(wPerson)}</b> <button class="btn sm" data-wt="feed">해제</button></p>`;
    const mine = new Set(watchSyms());
    const rows = L.filter(t => (wFilter === 'all' || (wFilter === 'form4' && t.source === 'form4') || (wFilter === '13f' && t.source === '13f') || (wFilter === 'buy' && t.side === 'BUY') || (wFilter === 'mine' && mine.has(t.ticker))) && (!wPerson || t.person === wPerson) && !(t.source === 'ptr' && wFilter !== 'all'));
    h += rows.slice(0, wShow).map(tradeCard).join('') || '<div class="empty">조건에 맞는 거래가 없습니다.</div>';
    if (rows.length > wShow) h += `<button class="btn block" id="wMore">더 보기 (${Math.min(20, rows.length - wShow)}건 추가 · 남은 ${rows.length - wShow}건)</button>`; else if (rows.length > 15) h += `<p class="small muted" style="text-align:center">전체 ${rows.length}건을 모두 표시했습니다.</p>`;
  } else if (wTab === 'people') {
    const by = {}; const cut = Date.now() - 90 * 864e5; L.filter(t => t.source !== 'ptr' && Date.parse(t.filed_at) >= cut).forEach(t => { const p = by[t.person] ||= { n: 0, buy: 0, sell: 0, role: t.role }; p.n++; if (t.side === 'BUY') p.buy += t.value || 0; if (t.side === 'SELL') p.sell += t.value || 0; });
    h += `<div class="card"><h2>최근 90일 인물별 <span class="muted small">탭하면 거래 보기</span></h2><div class="tw"><table><thead><tr><th>인물</th><th class="n">건수</th><th class="n">매수</th><th class="n">매도</th></tr></thead><tbody>${Object.entries(by).sort((a, b) => b[1].n - a[1].n).map(([n, p]) => `<tr class="click"><td><button class="chip" data-wp="${esc(n)}">${esc(n)}</button><div class="small muted">${esc(p.role || '')}</div></td><td class="n">${p.n}</td><td class="n pos">${money(p.buy)}</td><td class="n neg">${money(p.sell)}</td></tr>`).join('')}</tbody></table></div></div>`;
  } else if (wTab === 'f13') {
    const keys = Object.keys(TR.f13); if (!wFund || !TR.f13[wFund]) wFund = keys[0]; const f = TR.f13[wFund], nm = { berkshire: '버핏(Berkshire)', bridgewater: '달리오(Bridgewater)', pershing: '애크먼(Pershing)', scion: '버리(Scion)', soros: '소로스', renaissance: '사이먼스(Renaissance)', thirdpoint: '로엡(Third Point)', duquesne: '드러켄밀러', appaloosa: '테퍼(Appaloosa)', icahn: '아이칸' };
    h += `<div class="chips" style="margin-bottom:10px">${keys.map(k => `<button class="chip" data-wfund="${k}" aria-pressed="${wFund === k}">${nm[k] || k}</button>`).join('')}</div>`;
    if (f) h += `<div class="card"><h2>${nm[wFund] || wFund} <span class="muted small">${esc(f.period)} 기준 · 공시 ${esc(f.filed)}</span></h2><dl class="kv"><dt>총 평가액(13F)</dt><dd>${money(f.total)}</dd><dt>보유 종목 수</dt><dd>${f.count}</dd></dl><h3 style="margin-top:10px">직전 분기 대비 변화 상위</h3><div class="tw"><table><thead><tr><th>종목</th><th>변화</th><th class="n">금액</th><th class="n">비중</th></tr></thead><tbody>${f.rows.filter(r => r.status !== 'HOLD').slice(0, 15).map(r => `<tr class="click" ${r.ticker ? `data-go="${esc(r.ticker)}"` : ''}><td><b>${esc(r.ticker || '–')}</b><div class="small muted">${esc(r.name)}${r.putCall ? ' ' + r.putCall : ''}</div></td><td>${pill(F13_KO[r.status] || r.status, r.status === 'NEW' || r.status === 'ADD' ? 'good' : 'bad')}</td><td class="n">${money(Math.abs(r.d_value))}</td><td class="n">${(r.weight * 100).toFixed(1)}%</td></tr>`).join('')}</tbody></table></div><h3 style="margin-top:10px">상위 보유</h3><div class="tw"><table><tbody>${f.top_holdings.slice(0, 10).map(p => `<tr><td><b>${esc(p.ticker || '–')}</b> <span class="small muted">${esc(p.name)}</span></td><td class="n">${money(p.value)}</td><td class="n">${(p.value / f.total * 100).toFixed(1)}%</td></tr>`).join('')}</tbody></table></div><p class="small muted">13F는 분기말 스냅샷(45일 지연)입니다. 티커는 CUSIP→OpenFIGI 매핑이며 매핑 실패 시 '–'로 표시됩니다.</p></div>`;
  } else {
    const rows = L.filter(t => t.source === 'ptr' || t.source === 'congress');
    h += `<div class="card"><h2>의원 공시 <span class="muted small">하원 PTR 색인(공식) · FMP(선택)</span></h2><p class="small muted" style="margin:0 0 8px">PTR 은 제출 사실과 원문 PDF 링크만 제공합니다(종목·금액은 PDF 안에 있어 추측하지 않습니다).</p>${rows.slice(0, wShow).map(tradeCard).join('') || '<div class="empty">없음</div>'}${rows.length > wShow ? `<button class="btn block" id="wMore">더 보기 (남은 ${rows.length - wShow}건)</button>` : ''}</div>`;
  }
  el.innerHTML = h;
}
function whaleCardFor(sym) {
  const rows = whalesFor(sym), co = TR.co[sym]; if (!rows.length && !co) return '';
  const cut = Date.now() - 90 * 864e5, rec = rows.filter(t => Date.parse(t.filed_at) >= cut), buys = rec.filter(t => t.side === 'BUY'), sells = rec.filter(t => t.side === 'SELL');
  const net = rec.reduce((a, t) => a + (t.side === 'BUY' ? 1 : t.side === 'SELL' ? -1 : 0) * (t.value || 0), 0);
  return `<div class="card"><h2>거물·내부자 거래 <span class="muted small">참고(점수 미반영)</span></h2>${rec.length ? `<p style="margin:0 0 8px">최근 90일 매수 ${buys.length}건 · 매도 ${sells.length}건 · 순액 <b class="${cls(net)}">${net >= 0 ? '+' : '-'}${money(Math.abs(net))}</b></p>` : '<p class="muted small" style="margin:0 0 8px">최근 90일 거래 없음</p>'}${rows.slice(0, 5).map(tradeCard).join('')}${co && co.filings ? `<h3 style="margin:10px 0 6px">SEC 최근 공시</h3>${co.filings.slice(0, 5).map(f => `<div class="row small" style="padding:3px 0"><span class="muted">${esc(f.date)}</span><a href="${esc(f.url)}" target="_blank" rel="noopener" style="color:var(--info)">${esc(f.label)}</a></div>`).join('')}` : ''}<p class="small muted">내부자·기관 거래는 과거 이력이 짧아 앱의 매수 점수에는 넣지 않았습니다(검증 불가). 판단 보조 정보로만 쓰세요.</p></div>`;
}

/* ───────── 시장 탭 ───────── */
const MKT_ROWS = [['KOSPI', '^KS11'], ['KOSDAQ', '^KQ11'], ['S&P500(SPY)', 'SPY'], ['나스닥(QQQ)', 'QQQ'], ['러셀2000(IWM)', 'IWM'], ['필라델피아 반도체(SOX)', '^SOX'], ['VIX', '^VIX'], ['미 10년물 금리', '^TNX', 'y'], ['미 5년물 금리', '^FVX', 'y'], ['미 3개월물 금리', '^IRX', 'y'], ['달러인덱스(DXY)', 'DX-Y.NYB'], ['원/달러', 'KRW=X'], ['WTI 원유', 'CL=F'], ['금', 'GC=F'], ['구리', 'HG=F']];
function mktTable() {
  return MKT_ROWS.map(([nm, s, kind]) => { const a = PX[s]; if (!a || a.c.length < 70) return [nm, s, null]; const c = a.c, n = c.length, last = c[n - 1], ch = k => kind === 'y' ? last - c[n - 1 - k] : last / c[n - 1 - k] - 1; return [nm, s, { last, d1: ch(1), m1: ch(21), m3: ch(63), date: a.d[n - 1], y: kind === 'y' }]; });
}
function vMarket() {
  const el = $('#v-market'), cn = cnnLive() || CNN; let h = '';
  if (!PX.SPY) { el.innerHTML = '<div class="empty">시장 데이터를 불러오는 중입니다. 잠시 후 다시 확인하세요.</div>'; return; }
  h += wkCard();
  h += `<div class="card"><h2>CNN 공포탐욕 지수 ${cn ? pill(CNN_KO[cn.rating] || cn.rating, cn.score >= 55 ? 'good' : cn.score <= 45 ? 'bad' : 'mut') : ''}</h2><div class="row" style="margin-bottom:8px"><button class="btn sm" data-dt="cnn">CNN 추이</button><button class="btn sm" data-dt="fear">자체 공포지수</button><button class="btn sm" data-dt="px:^VIX">VIX</button><button class="btn sm" data-dt="vixts">VIX 기간구조</button><button class="btn sm" data-dt="breadth">섹터 약세 비율</button></div>`;
  if (cn) h += `<div class="row"><div style="font-size:2rem;font-weight:800">${cn.score.toFixed(0)}</div><div class="small muted">0=극단적 공포 · 100=극단적 탐욕</div></div><dl class="kv"><dt>전일</dt><dd>${F.n1(cn.prev)}</dd><dt>1주 전</dt><dd>${F.n1(cn.w1)}</dd><dt>1개월 전</dt><dd>${F.n1(cn.m1)}</dd><dt>1년 전</dt><dd>${F.n1(cn.y1)}</dd></dl><details style="margin-top:8px"><summary class="small b" style="cursor:pointer">구성 7요소</summary>${Object.keys(CNN_PARTS).map(k => cn.parts[k] ? `<div class="row small click" data-dt="cnnp:${k}" role="button" tabindex="0" style="padding:6px 0"><span style="flex:1">${esc(CNN_PARTS[k])}</span><b>${cn.parts[k].score.toFixed(0)}</b>${pill(CNN_KO[cn.parts[k].rating] || cn.parts[k].rating, cn.parts[k].score >= 55 ? 'good' : cn.parts[k].score <= 45 ? 'bad' : 'mut')}</div>` : '').join('')}</details>`;
  else h += `<p class="muted small">CNN 지수를 지금은 읽지 못해 자체 공포지수를 씁니다.</p>`;
  h += `</div>`;
  h += `<div class="card full"><h2>주요 시장 데이터 <span class="muted small">Yahoo Finance(지연 가능) · 눌러서 추이</span></h2><div class="tw"><table><thead><tr><th>지표</th><th class="n">현재</th><th class="n">1일</th><th class="n">1개월</th><th class="n">3개월</th></tr></thead><tbody>${mktTable().map(([nm, s, v]) => v ? `<tr class="click" data-dt="px:${esc(s)}"><td>${esc(nm)} <span class="muted small">›</span></td><td class="n">${v.last >= 1000 ? v.last.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.last.toFixed(2)}</td>${[v.d1, v.m1, v.m3].map(x => `<td class="n ${cls(x)}">${v.y ? (x >= 0 ? '+' : '') + x.toFixed(2) + '%p' : F.pct(x)}</td>`).join('')}</tr>` : '').join('')}${macroRows()}</tbody></table></div></div>`;
  h += cotCard() + idxOptCard();
  h += earnScheduleCard() + calCard();
  el.innerHTML = h;
}

/* ───────── 경제 일정(공식 자료) ───────── */
let CAL = null, calAt = 0, MAC = null, macAt = 0;
async function loadMac(force) { if (!force && MAC && Date.now() - macAt < 3 * 36e5) return; try { MAC = await jget('data/macro.json?t=' + Math.floor(Date.now() / 18e5), 15000, { cache: 'no-store' }); macAt = Date.now(); IDB.set('mac', MAC); if (view === 'market') softRender(); } catch (e) { } }
function macroRows() {
  const rows = [['미 2년물 금리(재무부)', 'T2Y', '%p'], ['미 3개월물 금리(재무부)', 'T3M', '%p'], ['하이일드 스프레드 OAS(FRED)', 'BAMLH0A0HYM2', '%p'], ['10년 실질금리(FRED)', 'DFII10', '%p'], ['금융여건 NFCI(FRED)', 'NFCI', ''], ['신규 실업수당 청구(FRED)', 'ICSA', 'k'], ['실업률(FRED)', 'UNRATE', '%p']];
  const last = (s, back) => { const cut = new Date(Date.parse(s.d.at(-1)) - back * 864e5).toISOString().slice(0, 10); for (let i = s.d.length - 1; i >= 0; i--) if (s.d[i] <= cut) return s.v[i]; return null; };
  const out = rows.map(([nm, id, u]) => {
    const s = MAC && MAC.series && MAC.series[id]; if (!s) return `<tr><td>${esc(nm)}</td><td class="n muted" colspan="4">확인 불가</td></tr>`;
    const v = s.v.at(-1), b = last(s, 91), d = b == null ? null : v - b, fm = x => u === 'k' ? Math.round(x / 1000) + '천' : x.toFixed(2);
    return `<tr class="click" data-dt="mac:${id}"><td>${esc(nm)} <span class="muted small">›</span></td><td class="n">${fm(v)}</td><td class="n muted" colspan="2">${esc(s.d.at(-1).slice(5))} 기준</td><td class="n ${cls(d)}">${d == null ? '–' : (d >= 0 ? '+' : '') + (u === 'k' ? Math.round(d / 1000) + '천' : d.toFixed(2))}</td></tr>`;
  }).join('');
  return out;
}
async function loadCal(force) { if (!force && CAL && Date.now() - calAt < 6 * 36e5) return; try { CAL = await jget('data/calendar.json?t=' + Math.floor(Date.now() / 6e5), 8000, { cache: 'no-store' }); calAt = Date.now(); IDB.set('cal', CAL); if (view === 'market') softRender(); } catch (e) { } }
function calCard() {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }), end = new Date(Date.now() + 14 * 864e5).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const ev = (CAL && CAL.events || []).filter(e => e.d >= today && e.d <= end);
  return `<div class="card"><h2>경제 일정 <span class="muted small">향후 2주 · 한국시간 · 공식 자료</span></h2>${ev.length ? ev.map(e => `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)"><div style="min-width:78px"><b>${esc(e.d.slice(5))}</b><div class="small muted">${esc(e.t)}</div></div><div style="flex:1"><div>${esc(e.title)}</div><div class="small muted">${esc(e.src)} · ${esc(e.tag)} · ${esc(e.et)}</div></div>${pill(e.imp, e.imp === '높음' ? 'warn' : 'mut')}</div>`).join('') : '<p class="muted small" style="margin:0">2주 내 확정된 주요 일정이 없거나 일정을 불러오지 못했습니다.</p>'}<p class="small muted" style="margin:8px 0 0">연준(FOMC)·노동통계국(CPI·PPI·고용·JOLTS)의 공식 일정만 표시합니다. 시장 컨센서스·한국 일정(한국은행 금통위 등)·GDP/PCE는 자동 수집이 불가해 포함하지 않았습니다.</p></div>`;
}

/* ───────── 가격 알림 (앱이 열려 있거나 백그라운드일 때 확인 — 브라우저 정책상 완전히 종료되면 불가) ───────── */
function checkAlerts() {
  if (!S.alerts || !S.alerts.length) return; let ch = false;
  for (const a of S.alerts) {
    if (!a.on) continue; const p = priceOf(a.sym); if (p == null) continue;
    if (a.dir === 'above' ? p >= a.price : p <= a.price) {
      a.on = false; a.hit = { t: Date.now(), p }; ch = true; const w = S.watch.find(x => x.sym === a.sym), msg = `${dispName(w) || a.sym} ${fmtPx(a.sym, p)} — 목표 ${fmtPx(a.sym, a.price)} ${a.dir === 'above' ? '이상' : '이하'} 도달`;
      (S.alertLog ||= []).unshift({ t: Date.now(), msg }); S.alertLog = S.alertLog.slice(0, 30); notify('가격 알림', msg); setStatus('알림: ' + msg);
    }
  }
  if (ch) save();
}
function alertCard(sym) {
  const list = (S.alerts || []).filter(a => a.sym === sym), p = priceOf(sym);
  return `<div class="card"><h2>가격 알림</h2>${list.length ? list.map(a => `<div class="row small" style="padding:4px 0"><span style="flex:1">${a.dir === 'above' ? '≥' : '≤'} <b>${fmtPx(sym, a.price)}</b> ${a.on ? pill('감시 중', 'good') : pill('도달 ' + new Date(a.hit.t).toLocaleDateString('ko-KR'), 'mut')}</span><button class="btn sm danger" data-aldel="${a.id}" aria-label="삭제">✕</button></div>`).join('') : '<p class="muted small" style="margin:0 0 6px">목표가를 정해 두면 도달 시 알려줍니다.</p>'}
  <div class="form" style="margin-top:8px"><label class="f">조건<select id="alDir"><option value="above">이상(상승 돌파)</option><option value="below">이하(하락 도달)</option></select></label><label class="f">목표가 (${isKR(sym) ? '₩' : '$'})<input id="alPx" inputmode="decimal" placeholder="${p != null ? (isKR(sym) ? Math.round(p) : p.toFixed(2)) : ''}"></label></div><button class="btn sm pri" id="alAdd" style="margin-top:8px">알림 추가</button>
  <p class="small muted" style="margin:8px 0 0">앱을 열어 두었거나 백그라운드에 있을 때 장중 10초~수 분 간격으로 확인합니다. 앱을 완전히 종료하면 알림을 받을 수 없습니다(브라우저 정책).</p></div>`;
}

/* ───────── 설정 ───────── */
function verifyCard() {
  let h = `<div class="card"><h2>신호 검증 요약 <span class="muted small">과거에 이 규칙대로였다면</span></h2>`;
  if (btBusy) h += `<div class="progress"><i id="btBar" style="width:${btProg * 100}%"></i></div><div class="small muted" id="btMsg">${esc(btMsg)}</div>`;
  else if (RES) {
    const n = RES.neutral?.lens?.C?.h?.[60], o = RES.lens?.C?.oos?.h?.[60], s = RES.lens?.C?.sim?.avg;
    h += `<dl class="kv">${n ? `<dt>신호 후 60일 상승 비율(지수·섹터 ETF)</dt><dd><b>${F.p0(n.win)}</b> <span class="muted small">아무 날 ${F.p0(n.baseWin)}</span></dd>` : ''}${o ? `<dt>내 종목군(보정에 안 쓴 기간)</dt><dd><b>${F.p0(o.win)}</b> <span class="muted small">아무 날 ${F.p0(o.baseWin)}</span></dd>` : ''}${s ? `<dt>규칙 매매 연수익 / 최대낙폭</dt><dd>${F.pct(s.cagr, 0)} / ${F.pct(s.mdd, 0)}</dd><dt>그냥 보유 연수익 / 최대낙폭</dt><dd>${F.pct(s.bhCagr, 0)} / ${F.pct(s.bhMdd, 0)}</dd>` : ''}<dt>매도(익절) 규칙</dt><dd>${params().trim === false ? '성과가 낮아 쓰지 않음' : '사용'}</dd></dl><p class="small muted" style="margin:8px 0 0">${new Date(RES.at).toLocaleDateString('ko-KR')} 계산. 상승한 종목 위주라 실제보다 좋아 보일 수 있고, 과거 성과는 미래를 보장하지 않습니다.</p>`;
  } else h += '<p class="muted small" style="margin:0">시세가 모이면 자동으로 계산합니다.</p>';
  return h + `<div class="row" style="margin-top:8px"><button class="btn sm" id="btRun" ${btBusy ? 'disabled' : ''}>${btBusy ? '계산 중…' : '다시 계산'}</button></div></div>`;
}
function vSet() {
  const st = S.settings, f = freshness(); let h = '';
  h += `<div class="card"><h2>데이터 상태 <span class="pill ${f.k === 'ok' ? 'good' : f.k === 'warn' ? 'warn' : 'bad'}">${f.k === 'ok' ? '정상' : f.k === 'warn' ? '지연' : '오래됨'}</span></h2><p class="small muted" style="margin:0 0 8px">${esc(f.d)}</p><div class="row"><button class="btn pri" id="btnNow">지금 새로고침</button><label class="chk" style="padding:0"><input type="checkbox" id="oAuto" ${st.auto ? 'checked' : ''}><span>자동 갱신</span></label></div></div>`;
  h += `<div class="card"><h2>내 매매 기준</h2><div class="form"><label class="f">목표 현금 비중 %<input id="cCash" inputmode="decimal" value="${st.cashTarget}"></label><label class="f">최소 유지 현금 %<input id="cRes" inputmode="decimal" value="${st.reserve}"></label><label class="f">1차 사용 %<input id="cT1" inputmode="decimal" value="${st.tranche[0]}"></label><label class="f">2차 %<input id="cT2" inputmode="decimal" value="${st.tranche[1]}"></label><label class="f">3차 %<input id="cT3" inputmode="decimal" value="${st.tranche[2]}"></label><label class="f">단일 종목 최대 %<input id="cMaxP" inputmode="decimal" value="${st.maxPos}"></label><label class="f">레버리지 합계 한도 %<input id="cMaxL" inputmode="decimal" value="${st.maxLev}"></label><label class="f">테마<select id="cTheme">${[['auto', '자동'], ['light', '라이트'], ['dark', '다크']].map(([v, t]) => `<option value="${v}" ${st.theme === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
  <label class="chk"><input type="checkbox" id="oNotify" ${st.notify ? 'checked' : ''}><span>새 매수 신호 알림 (앱을 열어 둔 동안)</span></label><div class="row"><button class="btn pri" id="cSave">저장</button><button class="btn" id="cReset">기본값</button></div></div>`;
  h += verifyCard();
  h += `<div class="card"><h2>앱 · 백업</h2><dl class="kv"><dt>현재 버전</dt><dd>${esc(APP_V || '확인 중')}</dd></dl><div class="row" style="margin-top:8px"><button class="btn sm pri" id="btnUpd">업데이트 확인</button><button class="btn sm" id="btnHard">캐시 비우고 새로고침</button><button class="btn sm" id="bkExp">백업 내보내기</button><button class="btn sm" id="bkImp">백업 불러오기</button>${window.__pwa ? '<button class="btn sm pri" id="pwaInstall">홈 화면에 설치</button>' : ''}<a class="btn sm" href="guide.html" style="text-decoration:none">사용 설명서</a></div><input type="file" id="bkFile" accept=".json" hidden><p class="small muted">보유·기록은 이 기기에만 저장됩니다.</p></div>`;
  $('#v-set').innerHTML = h;
}

/* ───────── 렌더·이벤트 ───────── */
function applyTheme() { const t = S.settings.theme; t === 'auto' ? document.documentElement.removeAttribute('data-theme') : document.documentElement.setAttribute('data-theme', t); }
function render() {
  const nav = navHTML(); $('#botNav').innerHTML = nav; $('#sideNav').innerHTML = nav; renderFresh();
  $$('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + view)); $('#pageTitle').textContent = VIEWS.find(v => v[0] === view)[2];
  ({ today: vToday, stock: vStock, market: vMarket, whales: vWhales, acct: vAcct, set: vSet })[view]();
}
const dl = (name, txt, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
document.addEventListener('click', async e => {
  const t = e.target.closest('button,[data-go],[data-dt],tr[data-lens],a'); if (!t) { if (e.target.id === 'modal') closeModal(); return; }
  if (t.dataset.dt) return openDetail(t.dataset.dt);
  if (t.dataset.drng) { DT.rng = t.dataset.drng; DT.hover = null; if (DT_CUR) { $('#modal .sheet').innerHTML = dtHTML(DT_CUR); dtAfter(); } return; }
  if (t.dataset.padd) { const [s, nm] = t.dataset.padd.split('|'); return addWatch(s, null, nm); } if (t.dataset.psr) { const x = SR[+t.dataset.psr]; return x && addWatch(x.sym, x.type, x.name); }
  if (t.dataset.v) return go(t.dataset.v);
  if (t.dataset.go) return go('stock', t.dataset.go);
  if (t.dataset.sym) { curSym = t.dataset.sym; return render(); } if (t.dataset.rng) { range = t.dataset.rng; return render(); }
  if ('close' in t.dataset) return closeModal(); if (t.dataset.edith) return holdForm(t.dataset.edith);
  if (t.id === 'fresh' || t.id === 'btnSet') { go('set'); return; }
  if (t.dataset.delsym) return removeWatch(t.dataset.delsym);
  if (t.dataset.pexp) { const [k, d] = t.dataset.pexp.split('|'); POS_SEL[k] = d; return render(); } if (t.dataset.pcot) { COT_SEL = t.dataset.pcot; return render(); } if (t.dataset.pidx) { IDX_SEL = t.dataset.pidx; return render(); }
  if (t.dataset.aldel) { S.alerts = (S.alerts || []).filter(a => String(a.id) !== t.dataset.aldel); save(); return render(); }
  if (t.id === 'alAdd') {
    const px = num($('#alPx').value); if (!(px > 0)) return alert('목표가를 입력하세요.'); (S.alerts ||= []).push({ id: Date.now(), sym: curSym, dir: $('#alDir').value, price: px, on: true }); save();
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission(); return render();
  }
  if (t.id === 'btnUpd' || t.id === 'btnHard') {   // 앱 업데이트 확인/강제 새로고침
    const hard = t.id === 'btnHard'; setStatus('업데이트 확인 중…');
    try { if (hard) { for (const k of await caches.keys()) await caches.delete(k); for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); setStatus('캐시를 비우고 새로 불러옵니다…'); setTimeout(() => location.reload(), 500); return; }
      const j = await jget('version.json?t=' + Date.now(), 6000, { cache: 'no-store' }); if (APP_V && j.v !== APP_V) { setStatus('새 버전으로 업데이트 중…'); setTimeout(() => location.reload(), 500); } else { setStatus('이미 최신 버전입니다 (' + j.v + ')'); setTimeout(() => setStatus(''), 3000); } }
    catch (e) { setStatus('업데이트 확인 실패: 네트워크를 확인하세요'); } return;
  }
  if (t.dataset.wt) { wTab = t.dataset.wt; wPerson = null; wShow = 15; return render(); } if (t.dataset.wf) { wFilter = t.dataset.wf; wShow = 15; return render(); }
  if (t.dataset.wp) { wPerson = t.dataset.wp; wTab = 'feed'; wShow = 15; return render(); } if (t.dataset.wfund) { wFund = t.dataset.wfund; return render(); }
  if (t.dataset.trade) return tradeSheet(t.dataset.trade); if (t.dataset.mytrade) { const [ts, sd] = t.dataset.mytrade.split('|'); return tradeForm(ts, sd); } if (t.dataset.jdel) { if (!confirm('이 거래 기록을 삭제할까요? (보유 수량·평단은 되돌려지지 않습니다)')) return; S.journal = S.journal.filter(j => j.id != t.dataset.jdel); save(); return render(); } if (t.dataset.opensym) { closeModal(true); return go('stock', t.dataset.opensym); }
  const id = t.id; if (!id) return; const w = S.watch.find(x => x.sym === curSym);
  const A = {
    btnRefresh: () => refresh(true), btnNow: () => refresh(true), btRun: () => runBacktest(),
    fetchOne: async () => { setStatus('수집 중…'); const r = await syncLive([curSym]); setStatus(r.fails.length ? '수집 실패: 프록시/네트워크 확인 또는 CSV 사용' : ''); recompute(); render(); },
    csvGo: () => { const d = [], c = []; for (const ln of $('#csvIn').value.split(/\r?\n/)) { const m = ln.trim().split(/[,\t;]/); if (m.length < 2) continue; const v = num(m[m.length > 5 ? 4 : 1]), dt = m[0].replace(/[./]/g, '-'); if (/^\d{4}-\d{1,2}-\d{1,2}/.test(dt) && v != null) { const [y, mo, da] = dt.slice(0, 10).split('-'); d.push(`${y}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`); c.push(v); } } if (d.length > 1 && d[0] > d.at(-1)) { d.reverse(); c.reverse(); } if (d.length < 300) return alert('유효한 행이 300개 이상 필요합니다(날짜,종가).'); putPX(curSym, { d, c, t: Date.now() }); recompute(); render(); },
    addSym: () => openAddModal(),
    delSym: () => removeWatch(curSym), editWatch: () => { watchEdit = !watchEdit; render(); },
    sSave: () => { w.lev = +$('#sLev').value; w.beta = num($('#sBeta').value) ?? 1; w.type = $('#sType').value; save(); recompute(); render(); },
    wkRetry: () => { WKat = 0; loadWK(true); }, wMore: () => { wShow += 20; render(); }, addHold: () => tradeForm(null, 'buy'), tSave: saveTrade,
    hSave: () => { const s = $('#hSym').value.trim().toUpperCase(), q = num($('#hQty').value), a = num($('#hAvg').value); if (!s || !(q > 0) || !(a > 0)) return alert('티커·수량·평단 확인'); const h = S.holdings.find(x => x.sym === s); h ? (h.qty = q, h.avg = a) : S.holdings.push({ sym: s, qty: q, avg: a }); if (!S.watch.find(x => x.sym === s)) S.watch.push({ sym: s, lev: 1, type: 'stock', beta: 1 }); save(); closeModal(); recompute(); render(); refresh(false); },
    hDel: () => { if (!confirm('이 보유 기록을 삭제할까요?')) return; S.holdings = S.holdings.filter(x => x.sym !== $('#hSym').value); save(); closeModal(); render(); },
    editCash: () => openModal(`<h2>현금(USD)</h2><label class="f">보유 현금<input id="cashIn" inputmode="decimal" value="${S.cash || ''}"></label><div class="row"><button class="btn pri" id="cashSave">저장</button><button class="btn" data-close>취소</button></div>`),
    cashSave: () => { S.cash = num($('#cashIn').value) || 0; save(); closeModal(); render(); },
    cSave: async () => { const s = S.settings; s.cashTarget = num($('#cCash').value) ?? 20; s.reserve = num($('#cRes').value) ?? 10; s.tranche = [num($('#cT1').value) ?? 20, num($('#cT2').value) ?? 30, num($('#cT3').value) ?? 50]; s.maxPos = num($('#cMaxP').value) ?? 30; s.maxLev = num($('#cMaxL').value) ?? 40; s.theme = $('#cTheme').value; s.notify = $('#oNotify').checked; if (s.notify && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission(); applyTheme(); save(); recompute(); setStatus('저장되었습니다'); setTimeout(() => setStatus(''), 1500); render(); },
    cReset: () => { if (confirm('기준을 기본값으로 되돌릴까요?')) { S.settings = DEF().settings; applyTheme(); save(); render(); } },
    bkExp: () => dl('puddle-trader-backup.json', JSON.stringify({ ...S, settings: { ...S.settings, geminiKey: '' } }, null, 1), 'application/json'), bkImp: () => $('#bkFile').click(),
    clrPx: async () => { PX = {}; for (const k of (await IDB.keys()) || []) if (String(k).startsWith('px:') || k === 'man') await IDB.set(k, null); MAN = null; render(); refresh(true); },
    pwaInstall: async () => { const p = window.__pwa; if (p) { p.prompt(); await p.userChoice; window.__pwa = null; render(); } }
  }; A[id]?.();
});
document.addEventListener('change', e => {
  const i = e.target.id;
  if (i === 'oAuto') { S.settings.auto = e.target.checked; save(); render(); }
  else if (i === 'bkFile') { const f = e.target.files[0]; if (!f) return; f.text().then(x => { try { const j = JSON.parse(x); if (!j.settings || !j.watch) throw 0; if (!confirm('현재 기록을 이 백업으로 교체할까요?')) return; S = restoreBackup(j); save(); applyTheme(); recompute(); render(); refresh(false); } catch (er) { alert('올바른 백업 파일이 아닙니다.'); } }); }
});
document.addEventListener('input', e => { if (e.target.id === 'qSym') qSearch(e.target.value); });
document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-dt]:not(button):not(a)')) { e.preventDefault(); return openDetail(e.target.dataset.dt); } if (e.key === 'Escape' && !e.isComposing && !$('#modal').hidden) closeModal(); if (e.key === 'Enter' && !e.isComposing && e.target.closest('#modal') && e.target.tagName === 'INPUT') $('#modal .btn.pri')?.click(); });
window.addEventListener('hashchange', () => { const h = location.hash.slice(1).split('/'); if (VIEWS.some(v => v[0] === h[0]) && (h[0] !== view || (h[1] && h[1] !== curSym))) { view = h[0]; if (h[1]) curSym = h[1]; render(); } });
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.__pwa = e; if (view === 'set') render(); });
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { const a = document.activeElement; if (view === 'stock' && !(a && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName)) && $('#modal').hidden) render(); }, 150); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { tickN = 0; tick(); checkUpdate(); } });
window.addEventListener('online', () => refresh(false)); window.addEventListener('focus', () => { if (freshness().k !== 'ok') refreshLight(); });
// 당겨서 새로고침(모바일)
(() => { let y0 = null, d = 0; const ptr = $('#ptr'); addEventListener('touchstart', e => { y0 = scrollY <= 0 && $('#modal').hidden && !e.target.closest('canvas,input,textarea,select') ? e.touches[0].clientY : null; d = 0; }, { passive: true }); addEventListener('touchmove', e => { if (y0 == null) return; d = e.touches[0].clientY - y0; ptr.classList.toggle('on', d > 60); ptr.textContent = d > 110 ? '↑ 놓으면 새로고침' : '↓ 당겨서 새로고침'; }, { passive: true }); addEventListener('touchend', () => { if (y0 != null && d > 110) refresh(true); ptr.classList.remove('on'); y0 = null; }); })();

/* ───────── 시작 ───────── */
(async function init() {
  applyTheme();
  const h = location.hash.slice(1).split('/'); if (VIEWS.some(v => v[0] === h[0])) { view = h[0]; if (h[1]) curSym = h[1]; }
  render();
  try { const keys = (await IDB.keys()) || []; await Promise.all(keys.map(async k => { const v = await IDB.get(k); if (!v) return; if (String(k).startsWith('px:')) PX[k.slice(3)] = v; else if (k === 'man') MAN = v; else if (k === 'fund') FUND = v; else if (k === 'bt') RES = v; else if (k === 'tr') TR = v; else if (k === 'cnn') CNN = v; else if (k === 'cal') CAL = v; else if (k === 'mac') MAC = v; })); } catch (e) { }
  try { LIVE_URL = (await jget('data/live.json?t=' + Date.now(), 4000, { cache: 'no-store' })).live || ''; } catch (e) { }
  recompute(); render();                         // 저장된 마지막 데이터로 즉시 표시(오프라인에서도 동작)
  await refresh(false);                           // 이어서 최신화
  checkUpdate(); setInterval(checkUpdate, 5 * 6e4); setInterval(tick, 60000); setInterval(liveTick, 10000); setInterval(renderFresh, 15000);
  if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => { });
})();
