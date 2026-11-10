'use strict';
/* 웅덩이 트레이더 v2 — 모바일 우선 · 자동 갱신 · 3관점(웅덩이/도키/통합) · 자동 검증/보정 */
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const E = Engine;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const num = v => { const n = parseFloat(String(v).replace(/,/g, '')); return isFinite(n) ? n : null; };
const F = {
  usd: n => n == null || !isFinite(n) ? '–' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 2 }),
  usd2: n => n == null || !isFinite(n) ? '–' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  pct: (n, d = 1) => n == null || !isFinite(n) ? '–' : (n > 0 ? '+' : '') + (n * 100).toFixed(d) + '%',
  p0: n => n == null || !isFinite(n) ? '–' : (n * 100).toFixed(0) + '%', n1: n => n == null || !isFinite(n) ? '–' : n.toFixed(1)
};
const cls = n => n > 0 ? 'pos' : n < 0 ? 'neg' : '';
const LN = { P: '웅덩이', D: '도키', C: '통합' }, LS = { P: 'developmong', D: 'doki', C: 'P+D 합의' };
const LC = { P: 'var(--lp)', D: 'var(--ld)', C: 'var(--lc)' };
const DEFAULT_WATCH = [['SOXL', 3, 'etf', 1.3], ['USD', 2, 'etf', 1.3], ['TQQQ', 3, 'etf', 1], ['QLD', 2, 'etf', 1], ['QQQ', 1, 'etf', 1], ['SPY', 1, 'etf', .8], ['SOXX', 1, 'etf', 1.3], ['NVDA', 1, 'stock', 1.5], ['TSLA', 1, 'stock', 1.8], ['AMZN', 1, 'stock', 1.2], ['MSFT', 1, 'stock', 1], ['META', 1, 'stock', 1.3], ['GOOGL', 1, 'stock', 1.1]].map(([sym, lev, type, beta]) => ({ sym, lev, type, beta }));

/* ───────── 저장소 ───────── */
const IDB = (() => {
  let p, mem = {}; const open = () => p || (p = new Promise((res, rej) => { try { const r = indexedDB.open('pt2', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); } }));
  const tx = async (m, f) => { try { const db = await open(); return await new Promise((res, rej) => { const t = db.transaction('kv', m), o = f(t.objectStore('kv')); t.oncomplete = () => res(o && o.result); t.onerror = () => rej(t.error); }); } catch (e) { return m === 'readonly' ? mem[arguments[1]] : undefined; } };
  return { get: k => tx('readonly', s => s.get(k)), set: (k, v) => { mem[k] = v; return tx('readwrite', s => s.put(v, k)); }, keys: () => tx('readonly', s => s.getAllKeys()) };
})();
const KEY = 'pt.v2';
const DEF = () => ({ settings: { cashTarget: 20, reserve: 10, tranche: [20, 30, 50], maxPos: 30, maxLev: 40, tp: [30, 60, 100], proxy: '', theme: 'auto', lens: 'C', notify: false, auto: true }, watch: DEFAULT_WATCH.map(w => ({ ...w })), holdings: [], cash: 0, journal: [], episodes: {}, tkr: {}, ledger: [], snapPrev: null, snapCur: null });
let S = (() => { try { const j = JSON.parse(localStorage.getItem(KEY)); if (j) return Object.assign(DEF(), j, { settings: Object.assign(DEF().settings, j.settings) }); const o = JSON.parse(localStorage.getItem('pt.v1')); if (o) { const d = DEF(); ['holdings', 'cash', 'journal', 'tkr'].forEach(k => { if (o[k]) d[k] = o[k]; }); return d; } } catch (e) { } return DEF(); })();
let saveT; const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { } }, 250); };

/* ───────── 전역 데이터 ───────── */
let PX = {}, MAN = null, FUND = {}, RES = null, KN = null, MK = null; const FEAT = {}, LIVE = {};
let view = 'today', curSym = null, range = '1Y', busy = false, btBusy = false, btProg = 0, btMsg = '', lastChanges = [];
const safe = s => s.replace('^', '_');
const watchSyms = () => [...new Set([...S.watch.map(w => w.sym), ...S.holdings.map(h => h.sym)])];
const needSyms = () => [...new Set([...E.MARKET_SYMS, ...watchSyms()])];
const priceOf = sym => { const s = PX[sym]; return s && s.c.length ? s.c.at(-1) : null; };
const params = () => (RES && RES.params) || E.DEFAULTS();

/* ───────── 시장 시간·신선도 ───────── */
function etNow() { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(x => [x.type, x.value])); const h = +p.hour % 24, m = +p.minute, wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday); return { wd, mins: h * 60 + m, date: `${p.year}-${p.month}-${p.day}` }; }
const marketOpen = () => { const t = etNow(); return t.wd >= 1 && t.wd <= 5 && t.mins >= 570 && t.mins < 960; };
function expectedBar() { const t = etNow(); let d = new Date(t.date + 'T00:00:00Z'); const before = t.mins < 570; if (before || t.wd === 0 || t.wd === 6) { do { d = new Date(d.getTime() - 864e5); } while ([0, 6].includes(d.getUTCDay())); } else if (t.wd >= 1 && t.wd <= 5) { /* 오늘 */ } return d.toISOString().slice(0, 10); }
function freshness() {
  const spy = PX.SPY; if (!spy) return { k: 'bad', t: '데이터 없음', d: '시세 데이터를 아직 받지 못했습니다.' };
  const last = spy.d.at(-1), exp = expectedBar(), upd = Math.max(MAN?.updated ? MAN.updated * 1000 : 0, ...Object.values(PX).map(x => x.t ? x.t * (x.t < 1e12 ? 1000 : 1) : 0)), age = Date.now() - upd, open = marketOpen();
  const lagDays = Math.round((Date.parse(exp) - Date.parse(last)) / 864e5), mins = Math.round(age / 6e4), ageTxt = mins < 60 ? mins + '분 전' : mins < 2880 ? Math.round(mins / 60) + '시간 전' : Math.round(mins / 1440) + '일 전';
  let k = 'ok', t = (open ? '장중 ' : '종가 ') + ageTxt; if (open && liveAt && Date.now() - liveAt < 75e3) t = '실시간 ' + Math.max(1, Math.round((Date.now() - liveAt) / 1e3)) + '초 전';
  if (lagDays >= 3 || age > 3 * 864e5) k = 'bad'; else if ((lagDays >= 1 && age > 3 * 36e5) || (open && age > 40 * 6e4) || age > 30 * 36e5) k = 'warn';
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
  routes.push(y, 'https://corsproxy.io/?' + encodeURIComponent(y), 'https://api.allorigins.win/raw?url=' + encodeURIComponent(y));
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
    if (Date.now() - knAt > 20 * 6e4) loadKN(true);   // 새 영상 분석 결과를 20분마다 확인
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
/* 실시간 계층: 장중 20초마다 '배치 API'(PC 서버 또는 내 프록시)로 최근 일봉을 받아 마지막 봉을 갱신. 없으면 조용히 건너뜀(5분 주기 data/ 가 기본) */
let liveAt = 0, liveBusy = false;
async function liveTick() {
  if (document.hidden || !S.settings.auto || !marketOpen() || busy || liveBusy) return;
  const bases = []; if (proxyBase()) bases.push(proxyBase()); if (/^https?:/.test(location.protocol) && !/github\.io$/.test(location.hostname)) bases.push('');
  if (!bases.length) return; liveBusy = true;
  const syms = [...new Set([...watchSyms(), 'SPY', 'QQQ', '^VIX', '^VIX3M'])].slice(0, 30);
  try {
    for (const b of bases) {
      try {
        const j = await jget(`${b}/api/batch?s=${encodeURIComponent(syms.join(','))}&range=5d`, 8000, { cache: 'no-store' }); let n = 0;
        for (const s in j) { const o = j[s]; if (o && o.c && o.c.length && PX[s]) { PX[s] = merge(PX[s], { d: o.d, c: o.c, mt: o.mt }); PX[s].t = Date.now(); IDB.set('px:' + s, PX[s]); n++; } }
        if (n) { liveAt = Date.now(); recompute(); softRender(); break; }
      } catch (e) { /* 다음 경로 */ }
    }
  } finally { liveBusy = false; }
}
async function refreshLight() { const before = MAN?.updated; try { const m = await jget('data/manifest.json?t=' + Date.now(), 6000, { cache: 'no-store' }); if (m.updated !== before) refresh(false); else renderFresh(); } catch (e) { renderFresh(); } }

/* ───────── 분석 ───────── */
function recompute() {
  try { MK = E.buildMarket(PX); } catch (e) { MK = null; }
  if (!MK) return;
  const qd = PX.QQQ ? (() => { const m = new Map(PX.QQQ.d.map((d, i) => [d, i])); return { byDate: (d, h) => { const j = m.get(d); return j != null && j >= h ? PX.QQQ.c[j] / PX.QQQ.c[j - h] - 1 : null; } }; })() : null;
  const p = params();
  for (const w of S.watch) {
    const s = PX[w.sym]; if (!s || s.c.length < E.START + 10) { delete LIVE[w.sym]; continue; }
    const key = w.sym + '|' + s.c.length + '|' + s.d.at(-1) + '|' + s.c.at(-1) + '|' + MK.n + '|' + (MK.vix.at(-1)) + '|' + w.lev + '|' + (params().fearV || 1);
    let ent = FEAT[w.sym]; if (!ent || ent.key !== key) { const f = E.features(w, s, MK, { qqq: qd, fearV: p.fearV || 1 }); if (!f) { delete LIVE[w.sym]; continue; } ent = FEAT[w.sym] = { key, F: f }; }
    const tk = S.tkr[w.sym] || {}, auto = FUND[w.sym] && FUND[w.sym].fair, man = tk.fv && tk.fv.cf > 0 ? fairManual(tk.fv) : null;
    ent.fair = man || auto || null; ent.fairSrc = man ? '수동' : auto ? '자동(재무)' : null;
    E.applyLive(ent.F, { fair: ent.fair, resolve: tk.resolve, bad: tk.bad });
    LIVE[w.sym] = E.live(ent.F, p);
    for (const L of ['P', 'D', 'C']) if (LIVE[w.sym].lens[L].score < 20) delete S.episodes[w.sym + '|' + L];
  }
  trackSignals(); diffSnap();
}
const fairManual = fv => { const r = fv.r ?? .1; return fv.cf * Math.pow(1 + fv.g, 3) * fv.mult / Math.pow(1 + r, 3); };
function diffSnap() {
  const cur = {}; for (const s in LIVE) cur[s] = { P: LIVE[s].lens.P.k, D: LIVE[s].lens.D.k, C: LIVE[s].lens.C.k };
  const now = Date.now(); if (!S.snapCur) S.snapCur = { at: now, v: cur }; else if (now - S.snapCur.at > 8 * 36e5) { S.snapPrev = S.snapCur; S.snapCur = { at: now, v: cur }; }
  lastChanges = []; const prev = S.snapPrev?.v || S.snapCur.v;
  for (const s in cur) for (const L of ['P', 'D', 'C']) { const a = prev[s]?.[L] ?? 0, b = cur[s][L]; if (a !== b) lastChanges.push({ s, L, a, b }); }
  save();
}
/* 실전 추적: 앱이 낸 매수 신호를 기록하고, 시간이 지나면 실제 수익률로 평가 */
function trackSignals() {
  const today = etNow().date; let ch = false;
  for (const s in LIVE) for (const L of ['P', 'D', 'C']) {
    const x = LIVE[s].lens[L]; if (x.k < 1 || x.over) continue;
    const last = [...S.ledger].reverse().find(e => e.sym === s && e.L === L);
    if (last && (Date.parse(today) - Date.parse(last.date)) / 864e5 < 7 && last.k >= x.k) continue;
    S.ledger.push({ id: today + s + L + x.k, sym: s, L, k: x.k, date: LIVE[s].date, px: LIVE[s].price, score: x.score, ver: RES ? RES.asof : 'default' }); ch = true;
    if (S.settings.notify && !S.ledger.some(e => e.id === today + s + L + x.k && e !== S.ledger.at(-1))) notify(`${s} ${LN[L]} ${x.k}차 신호`, `점수 ${x.score} · ${F.usd2(LIVE[s].price)}`);
  }
  if (ch) { S.ledger = S.ledger.slice(-600); save(); }
}
function ledgerStats() {
  const out = { P: [], D: [], C: [] };
  for (const e of S.ledger) { const s = PX[e.sym]; if (!s) continue; const i = s.d.indexOf(e.date); if (i < 0) continue; const r = h => i + 1 + h < s.c.length ? s.c[i + 1 + h] / s.c[i + 1] - 1 : null; out[e.L].push({ ...e, r20: r(20), r60: r(60) }); }
  const sum = a => { const v = a.filter(x => x != null); return { n: v.length, win: v.length ? v.filter(x => x > 0).length / v.length : null, mean: v.length ? v.reduce((p, q) => p + q, 0) / v.length : null }; };
  const o = {}; for (const L in out) o[L] = { total: out[L].length, h20: sum(out[L].map(x => x.r20)), h60: sum(out[L].map(x => x.r60)), items: out[L] }; return o;
}
async function notify(t, b) { try { if (Notification.permission !== 'granted') return; const reg = await navigator.serviceWorker?.getRegistration(); reg ? reg.showNotification(t, { body: b, icon: 'icon-192.png', tag: t }) : new Notification(t, { body: b }); } catch (e) { } }

/* ───────── 검증·자동 보정(Web Worker) ───────── */
function maybeBacktest(force) {
  if (btBusy || !MK) return; const have = S.watch.filter(w => PX[w.sym]).length; if (have < 3) return;
  const age = RES ? Date.now() - (RES.at || 0) : 1e18;
  if (force || !RES || RES.ver !== E.VERSION || (S.settings.auto && age > 24 * 36e5 && !document.hidden)) runBacktest();
}
function runBacktest() {
  if (btBusy) return; btBusy = true; btProg = .01; btMsg = '준비 중'; if (view === 'verify') render();
  const px = {}; for (const s of needSyms()) if (PX[s]) px[s] = { d: PX[s].d, c: PX[s].c };
  let w; try { w = new Worker('bt-worker.js'); } catch (e) { btBusy = false; setStatus('이 브라우저는 백그라운드 검증을 지원하지 않습니다.'); return; }
  w.onmessage = async ev => {
    const m = ev.data;
    if (m.type === 'progress') { btProg = m.p; btMsg = m.t; if (view === 'verify') updProg(); }
    else if (m.type === 'done') { RES = m.result; RES.at = Date.now(); await IDB.set('bt', RES); btBusy = false; w.terminate(); for (const k in FEAT) delete FEAT[k]; recompute(); softRender(); }
    else if (m.type === 'error') { btBusy = false; w.terminate(); setStatus('검증 오류: ' + m.msg); render(); }
  };
  w.onerror = e => { btBusy = false; setStatus('검증 워커 오류: ' + (e.message || '')); render(); };
  w.postMessage({ px, watch: S.watch.filter(x => PX[x.sym]) });
}
function updProg() { const b = $('#btBar'); if (b) b.style.width = (btProg * 100) + '%'; const t = $('#btMsg'); if (t) t.textContent = btMsg; }

/* ───────── 포트폴리오·추천 ───────── */
function portfolio() {
  let stocks = 0, lev = 0; const rows = S.holdings.map(h => { const p = priceOf(h.sym) ?? h.avg, val = h.qty * p, w = S.watch.find(x => x.sym === h.sym), L = w?.lev || 1; stocks += val; if (L > 1) lev += val; return { ...h, p, val, pl: h.avg ? p / h.avg - 1 : 0, L, beta: w?.beta || 1 }; });
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
    r.lines.push(trimOn ? '검증상 분할 익절이 도움이 되는 구간 — 수익 중이면 1/3씩 분할 매도를 검토하세요.' : '과거 검증에서 익절·감량은 성과를 깎아(꾸준히 보유가 우세) 신규 매수만 멈추고 보유는 유지하는 쪽을 권장합니다.');
    if (hold && hold.pl > 0 && trimOn) { const t = st.tp.filter(v => hold.pl * 100 >= v).length; if (t) r.lines.push(`보유 수익률 ${F.pct(hold.pl, 0)} — 익절 기준(${st.tp.slice(0, t).join('/')}%) 도달.`); }
    return r;
  }
  if (x.k === 0) { r.kind = x.score >= 25 ? 'hold' : 'wait'; r.label = x.score >= 25 ? '관찰 — 신호가 아직 덜 겹침' : '관망 — 현금 유지'; r.lines.push(x.score >= 25 ? '웅덩이가 더 깊어지거나 신호가 추가될 때까지 대기.' : '웅덩이 신호가 부족합니다. 아무 때나 사지 않습니다.'); return r; }
  const names = ['', '1차(소액 탐색)', '2차(비중 확대)', '3차(핵심 — 신호 최강)'];
  r.kind = 'buy'; r.label = `분할 매수 ${names[x.k]}`; r.lines.push(`겹친 신호 점수 ${x.score}/100`); if (x.note) r.lines.push(x.note);
  const cl = confLine(L, x.k); if (cl) r.lines.push('과거 검증: ' + cl);
  if ((S.episodes[sym + '|' + L] || []).includes(x.k)) { r.kind = 'hold'; r.label = `이번 웅덩이에서 ${x.k}차 이미 집행 — 대기`; r.lines.push('같은 차수는 반복하지 않고 더 강한 신호를 기다립니다.'); return r; }
  if (hold && hold.pl < -.3 && hold.wt > st.maxPos / 100 * .8) { r.kind = 'hold'; r.label = '이미 비중·손실이 큼 — 추가 보류'; r.lines.push('비중이 크고 손실이 크면 늘리지 않습니다(도키 원칙).'); return r; }
  if (!P.eq) { r.lines.push(`가용 현금의 ${st.tranche[x.k - 1]}% 사용 (내 계좌 탭에 현금·보유를 입력하면 금액 계산)`); return r; }
  const dep = Math.max(0, S.cash - P.eq * st.reserve / 100); let amt = dep * st.tranche[x.k - 1] / 100; const cur = hold ? hold.val : 0;
  amt = Math.min(amt, Math.max(0, P.eq * st.maxPos / 100 - cur)); if (lv.lev > 1) amt = Math.min(amt, Math.max(0, P.eq * st.maxLev / 100 - P.lev));
  r.amount = Math.max(0, amt); r.shares = Math.floor(r.amount / lv.price);
  r.lines.push(r.amount > 0 ? `권장 ${F.usd(r.amount)} ≈ ${r.shares}주 (가용 ${F.usd(dep)}의 ${st.tranche[x.k - 1]}%, 한도 적용)` : '비중·레버리지 한도 도달 — 추가 불가');
  if (P.cashPct != null && P.cashPct * 100 < st.cashTarget * .6) r.lines.push('현금 비중이 목표보다 크게 낮음 — 매수보다 현금 확보 우선.');
  return r;
}

/* ───────── 공통 UI ───────── */
const VIEWS = [['today', '◎', '오늘'], ['stock', '⌕', '종목'], ['whales', '◈', '거물'], ['verify', '✓', '검증'], ['acct', '▤', '내 계좌'], ['set', '⚙', '설정']];
function navHTML() { return VIEWS.filter(v => v[0] !== 'set').map(([k, i, t]) => `<button class="nb" role="tab" data-v="${k}" aria-selected="${k === view}"><span class="ic">${i}</span><span>${t}</span></button>`).join(''); }
function go(v, sym) { view = v; if (sym) curSym = sym; try { history.replaceState(null, '', '#' + v + (sym ? '/' + sym : '')); } catch (e) { } render(); window.scrollTo(0, 0); }
function openModal(h) { const m = $('#modal'); m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${h}</div>`; m.hidden = false; $('input,select', m)?.focus(); }
const closeModal = () => { $('#modal').hidden = true; $('#modal').innerHTML = ''; };
const pill = (t, k = '') => `<span class="pill ${k}">${esc(t)}</span>`;
const ring = (score, L) => `<div class="ring" style="--p:${score};--rc:${LC[L]}"><b>${score}</b></div>`;
const actPill = (x, p) => p.kind === 'buy' ? pill(x.k + '차 매수', 'good') : p.kind === 'trim' ? pill('과열', 'warn') : p.kind === 'hold' ? pill('관찰') : pill('관망', 'mut');
function renderFresh() { const f = freshness(), b = $('#fresh'); b.className = 'fresh ' + f.k; b.innerHTML = `<i></i><span>${esc(f.t)}</span>`; b.title = f.d; }
function renderSeg() { const L = S.settings.lens; $('#lensSeg').innerHTML = ['P', 'D', 'C'].map(l => `<button data-l="${l}" aria-pressed="${l === L}">${LN[l]}<small>${LS[l]}</small></button>`).join(''); }

/* ───────── 오늘 ───────── */
function marketNow() {
  if (!MK) return null; const i = MK.n - 1, q = PX.QQQ, o = { vix: MK.vix[i], fear: MK.fear[i], breadth: MK.breadth[i], inv: MK.vix[i] && MK.v3[i] ? MK.vix[i] / MK.v3[i] : null };
  if (q && q.c.length > 252) o.qdd = q.c.at(-1) / Math.max(...q.c.slice(-252)) - 1; return o;
}
function vToday() {
  const L = S.settings.lens, m = marketNow(), items = S.watch.map(w => ({ w, lv: LIVE[w.sym] })).filter(x => x.lv);
  const mood = !m ? ['데이터 대기', ''] : m.fear >= 70 ? ['공포 — 웅덩이 가능성', 'bad'] : m.fear >= 55 ? ['경계 — 조정 진행', 'warn'] : m.fear <= 25 ? ['탐욕 — 과열 주의', 'warn'] : ['보통', 'good'];
  let h = `<div class="mk"><div><div class="l">시장 온도</div><div class="v" style="font-size:.95rem">${pill(mood[0], mood[1])}</div></div><div><div class="l">공포지수(자체) 0~100</div><div class="v">${F.n1(m?.fear)}</div></div><div><div class="l">VIX · 기간구조</div><div class="v">${F.n1(m?.vix)} <span class="small muted">${m?.inv ? (m.inv >= 1 ? '역전' : '정상') : ''}</span></div></div><div><div class="l">QQQ 고점대비 · 섹터 -10%↓</div><div class="v">${F.pct(m?.qdd, 0)} <span class="small muted">${F.p0(m?.breadth)}</span></div></div></div>`;
  const buys = items.filter(x => x.lv.lens[L].k > 0 && !x.lv.lens[L].over).sort((a, b) => b.lv.lens[L].score - a.lv.lens[L].score), trims = items.filter(x => x.lv.lens[L].over), watch = items.filter(x => x.lv.lens[L].k === 0 && !x.lv.lens[L].over && x.lv.lens[L].score >= 25).sort((a, b) => b.lv.lens[L].score - a.lv.lens[L].score);
  const card = x => { const p = planFor(x.w.sym, L), l = x.lv.lens[L]; return `<button class="act ${p.kind}" data-go="${esc(x.w.sym)}">${ring(l.score, L)}<div><div class="row"><span class="t">${esc(x.w.sym)}</span>${x.w.lev > 1 ? pill(x.w.lev + 'x', 'warn') : ''}${actPill(l, p)}<span class="sp"></span><span class="b">${F.usd2(x.lv.price)}</span></div><div class="s">${esc(p.label)}${p.amount ? ' · ' + F.usd(p.amount) + ' (' + p.shares + '주)' : ''}</div><div class="three">${['P', 'D', 'C'].map(k => `<span class="${k === L ? 'on' : ''}">${LN[k]} ${x.lv.lens[k].score}${x.lv.lens[k].k ? '·' + x.lv.lens[k].k + '차' : ''}</span>`).join('')}</div></div></button>`; };
  h += `<div class="card" style="margin-top:12px"><h2>오늘의 행동 <span class="pill" style="background:none;color:${LC[L]}">${LN[L]} 관점</span></h2>`;
  if (!items.length) h += `<div class="empty">시세를 받는 중이거나 데이터가 없습니다. 우측 상단 ↻ 를 눌러보세요.</div>`;
  else {
    h += buys.length ? `<p class="small muted" style="margin:0 0 8px">매수 신호 ${buys.length}개 — 신호가 겹친 구간에서만, 차수별로 나눠서.</p>` + buys.map(card).join('') : `<div class="empty" style="padding:12px">지금은 <b>${LN[L]}</b> 관점에서 신호가 겹친 웅덩이가 없습니다.<br>아무 때나 사지 않고 현금을 지키는 구간입니다.</div>`;
    if (trims.length) h += `<h3 style="margin:10px 0 8px">과열 — 신규 매수 중단</h3>` + trims.map(card).join('');
    if (watch.length) h += `<h3 style="margin:10px 0 8px">관찰 대상</h3>` + watch.map(card).join('');
  }
  h += `</div>`;
  const wr = TR.trades.filter(t => t.source !== 'ptr' && t.side === 'BUY' && Date.now() - Date.parse(t.filed_at) < 21 * 864e5).map(t => ({ t, a: analyzeTrade(t, false).score })).sort((x, y) => y.a - x.a).slice(0, 3);
  if (wr.length) h += `<div class="card"><h2>최근 거물 매수 <button class="btn sm" data-v="whales">더 보기</button></h2>${wr.map(x => tradeCard(x.t)).join('')}</div>`;
  if (lastChanges.length) h += `<div class="card"><h2>신호 변화 <span class="muted small">직전 대비</span></h2>` + lastChanges.slice(0, 12).map(c => `<div class="row small" style="padding:3px 0"><b>${esc(c.s)}</b> ${pill(LN[c.L])} ${c.a}차 → <b>${c.b}차</b></div>`).join('') + `</div>`;
  h += `<div class="card"><h2>3관점 한눈에</h2><div class="tw"><table><thead><tr><th>종목</th><th class="n">현재가</th><th class="n">낙폭</th><th class="n" style="color:var(--lp)">웅덩이</th><th class="n" style="color:var(--ld)">도키</th><th class="n" style="color:var(--lc)">통합</th></tr></thead><tbody>${[...items].sort((a, b) => b.lv.lens[L].score - a.lv.lens[L].score).map(x => `<tr class="click" data-go="${esc(x.w.sym)}"><td><b>${esc(x.w.sym)}</b></td><td class="n">${F.usd2(x.lv.price)}</td><td class="n ${cls(FEAT[x.w.sym].F.B.dd.at(-1))}">${F.pct(FEAT[x.w.sym].F.B.dd.at(-1), 0)}</td>${['P', 'D', 'C'].map(k => `<td class="n">${x.lv.lens[k].over ? '<span class="pos" style="color:var(--warn)">과열</span>' : x.lv.lens[k].score + (x.lv.lens[k].k ? '·' + x.lv.lens[k].k + '차' : '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="small muted">점수 0~100. 단계는 검증·자동 보정된 임계값 기준(설정·검증 탭 참고). 오늘 신호는 마지막 봉 기준이며 장중에는 잠정치입니다.</p></div>`;
  if (KN && !KN.none) h += newVideosCard() + stanceCard(items);
  $('#v-today').innerHTML = h;
}
function stanceOf(ch) {   // 최근 30일 영상(자동 수집분 포함)에서 종목별 언급·우호/경계 표현 집계
  const rec = (KN.recent || []).filter(r => r.ch === ch); if (!rec.length) return (KN.stance && KN.stance[ch]) || {};
  const o = {}, now = Date.now(); rec.filter(r => now - Date.parse(r.date) <= 30 * 864e5).forEach(r => { for (const s in r.t) { const v = o[s] ||= { m30: 0, bull: 0, bear: 0 }; v.m30++; v.bull += r.t[s][1]; v.bear += r.t[s][2]; } }); return o;
}
function newVideosCard() {
  const r = (KN && KN.recent || []).slice(0, 5); if (!r.length) return '';
  return `<div class="card"><h2>두 채널 새 영상 <span class="muted small">자동 수집·분석${KN.built ? ' · ' + esc(KN.built) : ''}</span></h2>${r.map(v => `<div class="rule"><a href="https://youtu.be/${v.id}" target="_blank" rel="noopener" style="font-size:.9rem">▶ ${esc(v.title)}</a><div class="small muted">${v.ch === 'dm' ? '웅덩이' : '도키'} · ${esc(v.date)} · ${v.sub ? '자막 분석' : '제목 분석'}${Object.keys(v.t).length ? ' · ' + Object.keys(v.t).slice(0, 5).map(s => pill(s)).join(' ') : ''}</div></div>`).join('')}</div>`;
}
function stanceCard(items) {
  const SM = { dm: stanceOf('dm'), doki: stanceOf('doki') };
  const rows = items.map(x => { const a = ks(SM.dm, x.w.sym), b = ks(SM.doki, x.w.sym); return (a || b) ? `<tr><td><b>${esc(x.w.sym)}</b></td><td>${a || '–'}</td><td>${b || '–'}</td></tr>` : ''; }).filter(Boolean).join('');
  function ks(o, s) { const v = o && o[s]; if (!v || !v.m30) return ''; return `${v.m30}회${v.bull > v.bear ? ' · <span class="pos">우호</span>' : v.bear > v.bull ? ' · <span class="neg">경계</span>' : ''}`; }
  return rows ? `<div class="card"><h2>두 채널 최근 30일 언급 <span class="muted small">자막 자동 분석</span></h2><div class="tw"><table><thead><tr><th>종목</th><th>웅덩이(dm)</th><th>도키</th></tr></thead><tbody>${rows}</tbody></table></div><p class="small muted">영상 자막에서 종목 언급 빈도와 매수·매도 표현을 센 참고 정보입니다(점수에는 반영하지 않음).</p></div>` : '';
}

/* ───────── 종목 ───────── */
let hover = null;
function vStock() {
  if (!curSym || !S.watch.find(w => w.sym === curSym)) curSym = S.watch[0]?.sym; const w = S.watch.find(x => x.sym === curSym), L = S.settings.lens, el = $('#v-stock');
  let h = `<div class="chips" style="margin-bottom:10px">${S.watch.map(x => `<button class="chip" data-sym="${esc(x.sym)}" aria-pressed="${x.sym === curSym}">${esc(x.sym)}</button>`).join('')}<button class="chip" id="addSym">＋ 추가</button></div>`;
  if (!w) { el.innerHTML = h + '<div class="empty">종목을 추가하세요.</div>'; return; }
  const lv = LIVE[w.sym], ent = FEAT[w.sym];
  if (!lv) { el.innerHTML = h + `<div class="card"><h2>${esc(w.sym)} 시세 없음</h2><p class="muted">아직 데이터를 받지 못했습니다(신규 종목은 전체 이력 수집에 몇 초 걸립니다).</p><div class="row"><button class="btn pri" id="fetchOne">이 종목 시세 받기</button><button class="btn danger" id="delSym">삭제</button></div><label class="f" style="margin-top:12px">CSV 붙여넣기(날짜,종가)<textarea id="csvIn"></textarea></label><button class="btn" id="csvGo" style="margin-top:8px">CSV 적용</button></div>`; return; }
  const Fx = ent.F, p = planFor(w.sym, L), hold = portfolio().rows.find(r => r.sym === w.sym), i = Fx.n - 1, prm = params();
  const rows = E.explain(Fx, L, prm), lt = lv.lens[L], tk = S.tkr[w.sym] || {};
  const ev = E.events(Fx, lv.sc[L], L, prm.thr[L], {}), sm = ev.length ? E.summarize(ev, { [w.sym]: Fx }) : null;
  h += `<div class="card"><div class="row"><div><h2 style="margin:0">${esc(w.sym)} ${w.lev > 1 ? pill(w.lev + '배 레버리지', 'warn') : ''}</h2><div class="small muted">${lv.date} 기준${freshness().open ? ' · 장중 잠정' : ''}</div></div><span class="sp"></span><div class="right"><div style="font-size:1.55rem;font-weight:800">${F.usd2(lv.price)}</div><div class="small ${cls(Fx.B.dd[i])}">고점 대비 ${F.pct(Fx.B.dd[i])}</div></div></div>
  <div class="three" style="margin:10px 0">${['P', 'D', 'C'].map(k => `<span class="${k === L ? 'on' : ''}" style="font-size:.78rem;padding:3px 10px">${LN[k]} ${lv.lens[k].over ? '과열' : lv.lens[k].score + (lv.lens[k].k ? ' · ' + lv.lens[k].k + '차' : '')}</span>`).join('')}</div>
  <div class="rec ${p.kind}"><div class="t">${esc(p.label)}</div>${p.lines.map(l => `<div class="small">• ${esc(l)}</div>`).join('')}${p.kind === 'buy' && p.amount ? `<div style="margin-top:6px"><button class="btn pri sm" id="logBuy">이 매수를 기록</button></div>` : ''}</div></div>
  <div class="card"><h2>가격 · 200일선 · 과거 신호(●)<div class="chips">${['6M', '1Y', '3Y', '전체'].map(r => `<button class="chip" style="padding:3px 10px;min-height:30px" data-rng="${r}" aria-pressed="${r === range}">${r}</button>`).join('')}</div></h2><canvas id="cv" role="img" aria-label="${esc(w.sym)} 가격 차트"></canvas><div class="small muted" id="cvInfo">차트를 누르면 값이 표시됩니다 · ●는 이 관점의 과거 매수 신호일(1·2·3차)</div></div>`;
  if (sm) h += `<div class="card"><h2>이 종목에서 ${LN[L]} 관점의 과거 성과</h2><dl class="kv"><dt>신호 횟수</dt><dd>${sm.n}회 (${Fx.d[E.START]} ~)</dd><dt>60일 후 상승 확률</dt><dd>${F.p0(sm.h[60].win)} <span class="muted small">(아무 날 ${F.p0(sm.h[60].baseWin)})</span></dd><dt>60일 평균 수익</dt><dd>${F.pct(sm.h[60].mean)} <span class="muted small">(아무 날 ${F.pct(sm.h[60].baseMean)})</span></dd><dt>120일 후 상승 확률</dt><dd>${F.p0(sm.h[120].win)}</dd><dt>신호 후 60일 내 최대 낙폭(중앙값)</dt><dd class="neg">${F.pct(sm.mae)}</dd></dl><p class="small muted">상승 종목 위주의 과거 구간이라 실제보다 좋게 나올 수 있습니다. 전체 검증은 ‘검증’ 탭.</p></div>`;
  h += `<div class="card"><h2>${LN[L]} 신호 체크리스트 ${ring(lt.score, L)}</h2>${rows.map(s => `<div class="sig"><span class="dot ${s.type === 'warn' ? 'warn' : ''} ${s.on ? 'on' : ''}"></span><div><div>${esc(s.label)}</div><div class="small muted">${esc(s.detail)}</div></div><span class="pill ${s.on ? (s.type === 'warn' ? 'bad' : 'good') : 'mut'}">${s.na ? '없음' : s.on ? (s.pts > 0 ? '+' : '') + s.pts : '0'}</span></div>`).join('')}${L === 'C' ? '<p class="small muted">통합 = (웅덩이+도키)/2, 두 관점이 모두 기준 이상이면 +8, 한쪽이 매우 낮으면 -8. 위 목록은 웅덩이 관점 기준.</p>' : ''}</div>`;
  const fund = FUND[w.sym];
  h += `<div class="card"><h2>적정주가 <span class="muted small">도키: 영업현금흐름 × 성장 × 18배</span></h2>${ent.fair ? `<p style="margin:0 0 8px">적정가 <b>${F.usd2(ent.fair)}</b> (${ent.fairSrc}) · 현재 ${(lv.price / ent.fair * 100).toFixed(0)}%</p>` : '<p class="muted small" style="margin:0 0 8px">자동 재무 데이터가 없는 종목(ETF 등)은 적정가 없이 계산합니다.</p>'}${fund ? `<dl class="kv"><dt>주당 영업현금흐름(${fund.asof})</dt><dd>${F.usd2(fund.cfps)}</dd><dt>과거 연평균 성장(CAGR)</dt><dd>${F.pct(fund.cagr)}</dd><dt>적용 성장률(보수적 5~20%)</dt><dd>${F.pct(fund.g, 0)}</dd><dt>멀티플 · 요구수익률</dt><dd>${fund.mult}배 · ${F.p0(fund.r)}</dd></dl>` : ''}</div>
  ${whaleCardFor(w.sym)}
  <div class="card">
  <h2 style="margin-top:14px">종목 설정</h2><div class="form"><label class="f">레버리지 배율<select id="sLev">${[1, 2, 3].map(x => `<option ${x === w.lev ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label class="f">시장 베타<input id="sBeta" inputmode="decimal" value="${w.beta ?? 1}"></label><label class="f">유형<select id="sType"><option value="etf" ${w.type === 'etf' ? 'selected' : ''}>ETF</option><option value="stock" ${w.type === 'stock' ? 'selected' : ''}>개별주</option></select></label></div><div class="row" style="margin-top:10px"><button class="btn sm" id="sSave">저장</button><button class="btn sm" id="resetEp">차수 기록 초기화</button><span class="sp"></span><button class="btn sm danger" id="delSym">삭제</button></div><p class="small muted">이번 웅덩이 집행 차수(${LN[L]}): ${(S.episodes[w.sym + '|' + L] || []).join(', ') || '없음'}</p></div>`;
  el.innerHTML = h; drawChart(Fx, ev);
}
function drawChart(Fx, ev) {
  const cv = $('#cv'); if (!cv) return; const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const c = Fx.c, d = Fx.d, n = c.length, take = Math.min(n, { '6M': 126, '1Y': 252, '3Y': 756, '전체': n }[range]), s0 = n - take, m200 = E.sma(c, 200), cs = getComputedStyle(document.documentElement), col = v => cs.getPropertyValue(v).trim();
  const vals = []; for (let i = s0; i < n; i++) { vals.push(c[i]); if (m200[i]) vals.push(m200[i]); } const hi52 = Math.max(...c.slice(-252));
  const lo = Math.log(Math.min(...vals) * .97), hi = Math.log(Math.max(...vals, hi52) * 1.03), pl = 6, pr = 48, pt = 8, pb = 18;
  const X = i => pl + (i - s0) / (take - 1) * (W - pl - pr), Y = v => pt + (1 - (Math.log(v) - lo) / (hi - lo)) * (H - pt - pb);
  g.font = '11px system-ui'; g.fillStyle = col('--mut'); g.lineWidth = 1; g.strokeStyle = col('--line');
  for (let k = 0; k <= 4; k++) { const v = Math.exp(lo + (hi - lo) * k / 4), y = Y(v); g.beginPath(); g.moveTo(pl, y); g.lineTo(W - pr, y); g.stroke(); g.fillText(v >= 100 ? v.toFixed(0) : v.toFixed(1), W - pr + 4, y + 4); }
  const line = (a, color, wd, dash) => { g.beginPath(); let st = false; g.setLineDash(dash || []); g.strokeStyle = color; g.lineWidth = wd; for (let i = s0; i < n; i++) { if (a[i] == null) continue; const x = X(i), y = Y(a[i]); st ? g.lineTo(x, y) : (g.moveTo(x, y), st = true); } g.stroke(); g.setLineDash([]); };
  line(m200, '#f59e0b', 1.6); line(c, col('--ink'), 1.6);
  g.strokeStyle = col('--bad'); g.setLineDash([2, 4]); g.beginPath(); g.moveTo(pl, Y(hi52)); g.lineTo(W - pr, Y(hi52)); g.stroke(); g.setLineDash([]);
  const L = S.settings.lens, colk = { 1: '#60a5fa', 2: '#34d399', 3: '#f59e0b' }; ev.forEach(e => { if (e.i + 1 >= s0 && e.i + 1 < n) { g.fillStyle = colk[e.k]; g.beginPath(); g.arc(X(e.i + 1), Y(c[e.i + 1]), 4 + e.k, 0, 7); g.fill(); } });
  g.fillStyle = col('--mut'); g.fillText(d[s0], pl, H - 4); g.textAlign = 'right'; g.fillText(d[n - 1], W - pr, H - 4); g.textAlign = 'left';
  if (hover != null && hover >= s0 && hover < n) { const x = X(hover); g.strokeStyle = col('--mut'); g.beginPath(); g.moveTo(x, pt); g.lineTo(x, H - pb); g.stroke(); }
  const mv = e => { const r = cv.getBoundingClientRect(), x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left; hover = clamp(Math.round(s0 + (x - pl) / (W - pl - pr) * (take - 1)), s0, n - 1); const e2 = ev.find(z => z.i + 1 === hover); $('#cvInfo').textContent = `${d[hover]} · ${F.usd2(c[hover])}` + (m200[hover] ? ` · 200일 ${F.usd2(m200[hover])}` : '') + (e2 ? ` · ${e2.k}차 신호일` : ''); drawChart(Fx, ev); };
  cv.onpointermove = mv; cv.onpointerdown = mv;
}

/* ───────── 검증 ───────── */
const pc = (v, d = 0) => v == null || !isFinite(v) ? '–' : (v * 100).toFixed(d) + '%';
function vVerify() {
  const L = S.settings.lens; let h = '';
  h += `<div class="card"><h2>자동 검증·보정 <button class="btn sm pri" id="btRun" ${btBusy ? 'disabled' : ''}>${btBusy ? '실행 중…' : '지금 다시 검증'}</button></h2>`;
  if (btBusy) h += `<div class="progress"><i id="btBar" style="width:${btProg * 100}%"></i></div><div class="small muted" id="btMsg">${esc(btMsg)}</div>`;
  else if (RES) h += `<p class="small muted" style="margin:0">마지막 검증 ${new Date(RES.at).toLocaleString('ko-KR', { hour12: false })} · 종목 ${RES.symbols.length}개 · 보정 학습 ~${RES.split} / 표본 외 검증 ${RES.split}~ · 데이터가 갱신되면 하루 한 번 자동으로 다시 검증·보정합니다.</p>`;
  else h += `<p class="muted">아직 검증 전입니다. 시세 데이터가 모이면 자동으로 시작합니다.</p>`;
  h += `</div>`;
  if (!RES) { $('#v-verify').innerHTML = h; return; }
  const nu = RES.neutral;
  h += `<div class="note"><b>먼저 읽어주세요.</b> ① 내 종목군(SOXL·NVDA 등)은 2010년대 이후 크게 오른 <b>생존·상승 종목 위주</b>라 어떤 전략이든 좋아 보이기 쉽습니다. 그래서 같은 종목에서 <b>‘아무 날이나 샀을 때(기준선)’</b>와 비교하고, 지수·섹터 ETF ${nu.n}개(${nu.from}~, 닷컴 붕괴·2008 포함)로 <b>보정 없이 한 번 더</b> 검증했습니다. ② 과거 성과는 미래를 보장하지 않습니다. ③ 영상 속 DB증권 HTS 신호·텔레그램 유료 신호·종목별 재무 이력은 과거 데이터를 구할 수 없어 검증에서 제외했습니다.</div>`;
  h += `<div class="card"><h2>3관점 요약 <span class="muted small">신호 후 60일 상승 확률</span></h2><div class="tw"><table><thead><tr><th>관점</th><th class="n">내 종목군<br>표본외</th><th class="n">기준선</th><th class="n">중립ETF</th><th class="n">기준선</th><th class="n">3차 신호<br>(중립ETF)</th></tr></thead><tbody>${['P', 'D', 'C'].map(k => { const r = RES.lens[k], o = r.oos.h[60], n = nu.lens[k].h[60], k3 = nu.lens[k].byK[3]; return `<tr class="click" data-lens="${k}"><td><b style="color:${LC[k]}">${LN[k]}</b>${r.adopted ? ' <span class="pill good">보정됨</span>' : ''}</td><td class="n">${pc(o.win)}<br><span class="small muted">n=${o.n}</span></td><td class="n muted">${pc(o.baseWin)}</td><td class="n"><b>${pc(n.win)}</b><br><span class="small muted">n=${n.n}</span></td><td class="n muted">${pc(n.baseWin)}</td><td class="n"><b>${pc(k3.win60)}</b><br><span class="small muted">n=${k3.n}</span></td></tr>`; }).join('')}</tbody></table></div><p class="small muted">행을 누르면 그 관점이 선택됩니다. 기준선보다 높아야 ‘신호의 의미’가 있습니다.</p></div>`;
  const r = RES.lens[L], hz = [20, 60, 120, 250], nl = nu.lens[L];
  h += `<div class="card"><h2 style="color:${LC[L]}">${LN[L]} 관점 상세</h2><h3>보유 기간별 ‘이익 날 확률’ (신호 vs 아무 날 매수)</h3><div class="tw"><table><thead><tr><th>기간</th><th class="n">중립ETF 신호</th><th class="n">기준선</th><th class="n">내 종목군 표본외</th><th class="n">기준선</th><th class="n">평균수익(중립)</th></tr></thead><tbody>${hz.map(z => `<tr><td>${z}일</td><td class="n"><b>${pc(nl.h[z].win)}</b></td><td class="n muted">${pc(nl.h[z].baseWin)}</td><td class="n"><b>${pc(r.oos.h[z].win)}</b></td><td class="n muted">${pc(r.oos.h[z].baseWin)}</td><td class="n">${F.pct(nl.h[z].mean)} <span class="muted small">(${F.pct(nl.h[z].baseMean)})</span></td></tr>`).join('')}</tbody></table></div>
  <h3 style="margin-top:14px">단계별(1·2·3차) 60일 상승 확률 — 신호가 겹칠수록?</h3><div class="tw"><table><thead><tr><th>단계</th><th class="n">중립ETF</th><th class="n">내 종목군(표본외)</th></tr></thead><tbody>${[1, 2, 3].map(k => `<tr><td>${k}차 (임계 ${RES.params.thr[L][k - 1]}점)</td><td class="n"><b>${pc(nl.byK[k].win60)}</b> <span class="small muted">n=${nl.byK[k].n}</span></td><td class="n"><b>${pc(r.oos.byK[k].win60)}</b> <span class="small muted">n=${r.oos.byK[k].n}</span></td></tr>`).join('')}</tbody></table></div>
  <p class="small muted">신호 후 60일 내 최대 낙폭(중앙값): 중립 ${F.pct(nl.mae, 0)} · 내 종목군 ${F.pct(r.oos.mae, 0)} — 신호 직후에도 더 빠질 수 있다는 뜻이라 ‘분할’이 필요합니다.</p></div>`;
  const sm = r.sim, a = sm.avg;
  h += `<div class="card"><h2>실제로 이 규칙대로 매매했다면 <span class="muted small">종목별 평균</span></h2><div class="tw"><table><thead><tr><th>전략</th><th class="n">연수익률</th><th class="n">최대낙폭</th></tr></thead><tbody><tr><td><b>${LN[L]} 규칙 매매</b></td><td class="n">${F.pct(a.cagr, 0)}</td><td class="n neg">${F.pct(a.mdd, 0)}</td></tr><tr><td>단순 보유(100%)</td><td class="n">${F.pct(a.bhCagr, 0)}</td><td class="n neg">${F.pct(a.bhMdd, 0)}</td></tr><tr><td>50% 보유 후 방치</td><td class="n">${F.pct(a.stCagr, 0)}</td><td class="n neg">${F.pct(a.stMdd, 0)}</td></tr></tbody></table></div><p class="small muted">초기 50% 보유 + 신호 단계별 추가 매수(가용현금의 ${S.settings.tranche.join('/')}%), 다음 거래일 종가 체결, 수수료·세금 제외. 평균 투자비중 ${F.p0(a.exp)}. 위험조정수익(연수익/최대낙폭)이 단순 보유보다 나은 종목 ${sm.beatCalmarBH}/${sm.n}개.</p>
  <div class="note" style="margin-top:8px">매도 규칙 검증: 과열 익절·수익률 익절을 넣으면 위험조정수익 ${(RES.params.trimReport.withTrim).toFixed(2)}, 넣지 않으면 ${(RES.params.trimReport.noTrim).toFixed(2)} → <b>${RES.params.trim === false ? '익절·감량은 성과를 깎아 앱이 “신규 매수만 중단” 으로 안내합니다' : '익절 규칙을 유지합니다'}</b>.</div></div>`;
  const ed = r.edge && Object.keys(r.edge).length ? r.edge : null;
  if (ed) { const rowsE = Object.entries(ed).map(([id, v]) => ({ id, ...v })).sort((x, y) => Math.abs(y.z) - Math.abs(x.z)); h += `<div class="card"><h2>신호별 효과 <span class="muted small">60일 후 수익(기초환산) 켜짐 vs 꺼짐</span></h2><div class="tw"><table><thead><tr><th>신호</th><th class="n">켜짐</th><th class="n">꺼짐</th><th class="n">통계적 유의(z)</th><th class="n">가중치</th></tr></thead><tbody>${rowsE.map(v => { const m = (RES.params.m[L] || {})[v.id]; return `<tr><td>${esc(E.LABEL[v.id])}</td><td class="n">${F.pct(v.meanOn)}</td><td class="n muted">${F.pct(v.meanOff)}</td><td class="n ${Math.abs(v.z) >= 2 ? 'b' : 'muted'}">${v.z.toFixed(1)}</td><td class="n">${m ? '×' + m.toFixed(2) : '×1'}</td></tr>`; }).join('')}</tbody></table></div><p class="small muted">|z|≥2면 우연이 아닐 가능성이 큰 신호입니다. 효과가 약한 신호는 가중치가 낮아지고(최대 -40%), 강한 신호는 높아집니다(최대 +40%). 과열(감점) 신호가 오히려 상승과 함께 나타난다면 감점이 약해집니다.</p></div>`; }
  const c = RES.lens[L];
  h += `<div class="card"><h2>자동 보정 현황</h2><dl class="kv"><dt>기본 임계값(1·2·3차)</dt><dd>${c.defThr.join(' / ')}</dd><dt>현재 적용 임계값</dt><dd><b>${c.thr.join(' / ')}</b> ${c.adopted ? pill('보정 채택', 'good') : pill('기본값 유지', 'mut')}</dd><dt>공포지수 버전(자동 선택)</dt><dd>${RES.fearReport ? 'v' + RES.fearReport.chosen + ' · 효과 z: v1 ' + RES.fearReport.z1.toFixed(1) + ' / v2(CNN식) ' + RES.fearReport.z2.toFixed(1) : '–'}</dd><dt>표본외 점수(기본→보정)</dt><dd>${c.calib.default.j.toFixed(3)} → ${c.calib.tuned.j.toFixed(3)}</dd><dt>표본외 신호 수(기본→보정)</dt><dd>${c.calib.default.n} → ${c.calib.tuned.n}</dd></dl><p class="small muted">학습 구간(~${RES.split})에서 임계값·신호 가중치를 맞추고, 학습에 쓰지 않은 뒤 구간에서 기본값보다 나을 때만 채택합니다(과최적화 방지). 채택 시 전체 데이터로 재적합하되 기본값 쪽으로 절반 되돌려 안정성을 높입니다. 새 데이터가 쌓이면 이 과정이 자동 반복됩니다.</p></div>`;
  const ls = ledgerStats(), lt = ls[L];
  h += `<div class="card"><h2>실전 추적 <span class="muted small">앱이 낸 추천의 이후 결과</span></h2>${lt.total ? `<dl class="kv"><dt>기록된 ${LN[L]} 매수 신호</dt><dd>${lt.total}건</dd><dt>20일 경과(승률 · 평균)</dt><dd>${lt.h20.n ? pc(lt.h20.win) + ' · ' + F.pct(lt.h20.mean) + ' (n=' + lt.h20.n + ')' : '대기 중'}</dd><dt>60일 경과(승률 · 평균)</dt><dd>${lt.h60.n ? pc(lt.h60.win) + ' · ' + F.pct(lt.h60.mean) + ' (n=' + lt.h60.n + ')' : '대기 중'}</dd></dl><div class="tw" style="margin-top:8px"><table><thead><tr><th>날짜</th><th>종목</th><th>단계</th><th class="n">신호가</th><th class="n">20일</th><th class="n">60일</th></tr></thead><tbody>${[...lt.items].reverse().slice(0, 12).map(e => `<tr><td>${e.date.slice(5)}</td><td><b>${esc(e.sym)}</b></td><td>${e.k}차</td><td class="n">${F.usd2(e.px)}</td><td class="n ${cls(e.r20)}">${e.r20 == null ? '–' : F.pct(e.r20)}</td><td class="n ${cls(e.r60)}">${e.r60 == null ? '–' : F.pct(e.r60)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">이 앱이 신호를 내면 자동 기록되고, 20·60일 뒤 실제 수익률로 채점됩니다. 과거 검증이 실전에서도 맞는지 확인하는 용도입니다.</p>'}</div>`;
  $('#v-verify').innerHTML = h;
}

/* ───────── 내 계좌 ───────── */
function vAcct() {
  const P = portfolio(), st = S.settings, L = S.settings.lens; let h = '';
  const dep = P.eq ? Math.max(0, S.cash - P.eq * st.reserve / 100) : 0;
  h += `<div class="mk"><div><div class="l">총자산(USD)</div><div class="v">${F.usd(P.eq)}</div></div><div><div class="l">현금 · 비중/목표</div><div class="v">${F.usd(S.cash)} <span class="small muted">${P.cashPct == null ? '' : F.p0(P.cashPct) + '/' + st.cashTarget + '%'}</span></div></div><div><div class="l">웅덩이 가용 현금</div><div class="v">${F.usd(dep)}</div></div><div><div class="l">레버리지 비중/한도</div><div class="v ${P.levPct * 100 > st.maxLev ? 'neg' : ''}">${F.p0(P.levPct)} <span class="small muted">/${st.maxLev}%</span></div></div></div>`;
  h += `<div class="card" style="margin-top:12px"><h2>보유 종목 <span class="row"><button class="btn sm" id="editCash">현금</button><button class="btn sm pri" id="addHold">＋ 추가</button></span></h2>`;
  if (!P.rows.length) h += `<div class="empty">보유 종목이 없습니다. 추가하면 추천이 내 비중·현금에 맞춰 계산됩니다.</div>`;
  else h += `<div class="tw"><table><thead><tr><th>종목</th><th class="n">수량</th><th class="n">평단</th><th class="n">현재</th><th class="n">손익</th><th class="n">비중</th><th>${LN[L]}</th><th></th></tr></thead><tbody>${P.rows.map(r => { const pl = planFor(r.sym, L), lv = LIVE[r.sym]; return `<tr><td><b>${esc(r.sym)}</b></td><td class="n">${r.qty}</td><td class="n">${F.usd2(r.avg)}</td><td class="n">${F.usd2(r.p)}</td><td class="n ${cls(r.pl)}">${F.pct(r.pl)}</td><td class="n">${F.p0(r.wt)}</td><td>${lv && pl ? actPill(lv.lens[L], pl) : '–'}</td><td><button class="btn sm" data-edith="${esc(r.sym)}">수정</button></td></tr>`; }).join('')}</tbody></table></div>`;
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
  h += `</div><div class="card"><h2>스트레스 테스트</h2>`;
  if (!P.eq) h += `<div class="empty" style="padding:8px">보유 입력 후 표시</div>`; else h += `<div class="tw"><table><thead><tr><th>시장 낙폭</th><th class="n">예상 총자산</th><th class="n">변화</th><th class="n">현금비중</th></tr></thead><tbody>${[-.2, -.35, -.5].map(dr => { let loss = 0; for (const r of P.rows) loss += r.val * Math.min(.97, r.beta * r.L * -dr); const af = P.eq - loss; return `<tr><td>${F.pct(dr, 0)}</td><td class="n">${F.usd(af)}</td><td class="n neg">${F.pct(af / P.eq - 1)}</td><td class="n">${F.p0(S.cash / af)}</td></tr>`; }).join('')}</tbody></table></div>`;
  h += `</div></div>`;
  const today = new Date().toISOString().slice(0, 10);
  h += `<div class="card"><h2>매매 기록</h2><div class="form"><label class="f">날짜<input type="date" id="jDate" value="${today}"></label><label class="f">구분<select id="jSide"><option value="buy">매수</option><option value="sell">매도</option></select></label><label class="f">티커<input id="jSym" value="${esc(curSym || '')}" autocapitalize="characters"></label><label class="f">수량<input id="jQty" inputmode="decimal"></label><label class="f">체결가<input id="jPx" inputmode="decimal"></label><label class="f">차수(매수)<select id="jTr"><option value="0">해당 없음</option>${[1, 2, 3].map(x => `<option value="${x}">${x}차</option>`).join('')}</select></label></div><label class="f" style="margin-top:8px">메모<input id="jNote"></label><label class="chk"><input type="checkbox" id="jApply" checked><span>보유·현금에 자동 반영</span></label><button class="btn pri block" id="jAdd">기록</button>
  ${S.journal.length ? `<div class="tw" style="margin-top:10px"><table><thead><tr><th>날짜</th><th>구분</th><th>종목</th><th class="n">수량</th><th class="n">가격</th><th>차수</th><th></th></tr></thead><tbody>${[...S.journal].reverse().slice(0, 30).map(j => `<tr><td>${esc(j.date.slice(2))}</td><td>${pill(j.side === 'buy' ? '매수' : '매도', j.side === 'buy' ? 'good' : 'warn')}</td><td><b>${esc(j.sym)}</b></td><td class="n">${j.qty}</td><td class="n">${F.usd2(j.px)}</td><td>${j.tr ? j.tr + '차' : '–'}</td><td><button class="btn sm danger" data-jdel="${j.id}" aria-label="삭제">✕</button></td></tr>`).join('')}</tbody></table></div><button class="btn sm" id="jCsv" style="margin-top:8px">CSV 내보내기</button>` : ''}</div>`;
  $('#v-acct').innerHTML = h;
}
function holdForm(sym) { const h = S.holdings.find(x => x.sym === sym); openModal(`<h2>${h ? esc(sym) + ' 수정' : '보유 종목 추가'}</h2><div class="form"><label class="f">티커<input id="hSym" value="${esc(h?.sym || '')}" ${h ? 'readonly' : ''} autocapitalize="characters"></label><label class="f">수량<input id="hQty" inputmode="decimal" value="${h?.qty ?? ''}"></label><label class="f">평균단가(USD)<input id="hAvg" inputmode="decimal" value="${h?.avg ?? ''}"></label></div><div class="row"><button class="btn pri" id="hSave">저장</button><button class="btn" data-close>취소</button><span class="sp"></span>${h ? '<button class="btn danger" id="hDel">삭제</button>' : ''}</div>`); }
function addJournal() {
  const sym = $('#jSym').value.trim().toUpperCase(), qty = num($('#jQty').value), px = num($('#jPx').value), side = $('#jSide').value, tr = +$('#jTr').value;
  if (!sym || !(qty > 0) || !(px > 0)) return alert('티커·수량·체결가를 확인하세요.');
  S.journal.push({ id: Date.now(), date: $('#jDate').value, sym, side, qty, px, tr, note: $('#jNote').value.trim() });
  if (tr && side === 'buy') { const k = sym + '|' + S.settings.lens; (S.episodes[k] ||= []); if (!S.episodes[k].includes(tr)) S.episodes[k].push(tr); }
  if ($('#jApply').checked) { let h = S.holdings.find(x => x.sym === sym); if (side === 'buy') { if (!h) { h = { sym, qty: 0, avg: 0 }; S.holdings.push(h); } h.avg = (h.avg * h.qty + px * qty) / (h.qty + qty); h.qty += qty; S.cash = Math.max(0, (S.cash || 0) - qty * px); } else if (h) { const q = Math.min(qty, h.qty); h.qty -= q; S.cash = (S.cash || 0) + q * px; if (h.qty <= 1e-9) S.holdings = S.holdings.filter(x => x !== h); } }
  if (!S.watch.find(w => w.sym === sym)) S.watch.push({ sym, lev: 1, type: 'stock', beta: 1 });
  save(); recompute(); render(); refresh(false);
}

/* ───────── 거물 거래(내부자·기관·의원) — 공식 공시만 사용 ───────── */
let TR = { trades: [], f13: {}, co: {}, status: null }, wTab = 'feed', wFilter = 'all', wPerson = null, wFund = null;
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
  const s = sym && PX[sym]; if (!s || s.c.length < 60) return null; const c = s.c, n = c.length, last = c[n - 1], w = c.slice(-252), hi = Math.max(...w), lo = Math.min(...w), ret = k => n > k ? last / c[n - 1 - k] - 1 : null;
  const r = []; for (let i = Math.max(1, n - 60); i < n; i++) r.push(c[i] / c[i - 1] - 1); const vol = r.length ? Math.sqrt(r.reduce((a, b) => a + b * b, 0) / r.length) * Math.sqrt(252) : null;
  return { sym, price: last, hi52: hi, lo52: lo, pos52: hi > lo ? (last - lo) / (hi - lo) : null, r1m: ret(21), r3m: ret(63), r6m: ret(126), vol, d: s.d, c };
}
function priceOn(m, date) { let b = null; for (let i = 0; i < m.d.length; i++) { if (m.d[i] <= date) b = m.c[i]; else break; } return b; }
function analyzeTrade(t, withMkt) {
  const f = [], notes = [], sign = tSign(t), value = t.value || 0, src = t.source; let score = 0;
  const mkt = withMkt && t.ticker ? mktSnap(t.ticker) : null, td = Date.parse(t.trade_date || '1970-01-01');
  const sibs = t.ticker ? TR.trades.filter(x => x.ticker === t.ticker && x.id !== t.id && (x.side === 'BUY' || x.side === 'SELL') && Math.abs(Date.parse(x.trade_date || '1970-01-01') - td) <= 45 * 864e5).slice(0, 30) : [];
  if (src === 'form4') {
    if (t.code === 'P') { score += 50; f.push(['공개시장 매수', 50, '내부자가 자기 돈으로 시장에서 직접 매수 — 가장 신뢰도 높은 낙관 신호']); }
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
  const verdict = (!sign && !(f[0] && f[0][1])) ? '중립 (정보 가치 낮음)' : score >= 50 ? '강한 낙관 신호' : score >= 20 ? '낙관 우세' : score > -20 ? '중립' : score > -50 ? '경계 (매도 우세)' : '강한 비관/차익실현 신호';
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
    <div class="row">${t.url ? `<a class="btn sm" href="${esc(t.url)}" target="_blank" rel="noopener">SEC/원문 보기</a>` : ''}${sym ? `<button class="btn sm pri" data-opensym="${esc(sym)}">종목 상세</button>` : ''}<button class="btn sm" data-close>닫기</button></div>
    <p class="small muted">공개 공시에 기반한 참고용 분석이며 투자 자문이 아닙니다. 내부자·기관의 거래가 미래 수익을 보장하지 않습니다. 이 점수는 규칙 기반이며 과거 수익으로 검증되지 않았습니다(공시 이력이 짧아 검증 불가).</p>`);
  render2(analyzeTrade(t, true));
  if (sym && !mktSnap(sym)) fetchLive(sym, '1y').then(o => { PX[sym] = PX[sym] || o; if (!$('#modal').hidden) render2(analyzeTrade(t, true)); }).catch(() => { });
}
function vWhales() {
  const st = TR.status, el = $('#v-whales'); let h = '';
  const tabs = [['feed', '피드'], ['people', '인물'], ['f13', '13F 펀드'], ['cong', '의원']];
  h += `<div class="chips" style="margin-bottom:10px">${tabs.map(([k, n]) => `<button class="chip" data-wt="${k}" aria-pressed="${wTab === k}">${n}</button>`).join('')}</div>`;
  if (!TR.trades.length) { el.innerHTML = h + '<div class="empty">거물 거래 데이터를 불러오는 중이거나 아직 없습니다.</div>'; return; }
  const secTxt = !st ? '' : st.sec === 'ok' ? pill('SEC 정상', 'good') : st.sec === 'blocked' ? pill('SEC 접근 제한 — 마지막 정상 데이터', 'warn') : pill('SEC ' + st.sec, 'warn');
  h += `<p class="small muted" style="margin:0 0 8px">${secTxt} ${st ? '· 수집 ' + new Date(st.updated * 1000).toLocaleString('ko-KR', { hour12: false }) : ''} · 공시 자체가 지연됩니다(Form 4: 거래 후 2영업일, 13F: 분기말+45일, 의원: 최대 45일).</p>`;
  const L = TR.trades;
  if (wTab === 'feed') {
    const fl = [['all', '전체'], ['form4', '내부자'], ['13f', '13F'], ['buy', '매수만'], ['mine', '내 종목']];
    h += `<div class="chips" style="margin-bottom:10px">${fl.map(([k, n]) => `<button class="chip" data-wf="${k}" aria-pressed="${wFilter === k}">${n}</button>`).join('')}</div>`;
    if (wPerson) h += `<p class="small">인물 필터: <b>${esc(wPerson)}</b> <button class="btn sm" data-wt="feed">해제</button></p>`;
    const mine = new Set(watchSyms());
    const rows = L.filter(t => (wFilter === 'all' || (wFilter === 'form4' && t.source === 'form4') || (wFilter === '13f' && t.source === '13f') || (wFilter === 'buy' && t.side === 'BUY') || (wFilter === 'mine' && mine.has(t.ticker))) && (!wPerson || t.person === wPerson) && !(t.source === 'ptr' && wFilter !== 'all'));
    h += rows.slice(0, 60).map(tradeCard).join('') || '<div class="empty">조건에 맞는 거래가 없습니다.</div>';
  } else if (wTab === 'people') {
    const by = {}; const cut = Date.now() - 90 * 864e5; L.filter(t => t.source !== 'ptr' && Date.parse(t.filed_at) >= cut).forEach(t => { const p = by[t.person] ||= { n: 0, buy: 0, sell: 0, role: t.role }; p.n++; if (t.side === 'BUY') p.buy += t.value || 0; if (t.side === 'SELL') p.sell += t.value || 0; });
    h += `<div class="card"><h2>최근 90일 인물별 <span class="muted small">탭하면 거래 보기</span></h2><div class="tw"><table><thead><tr><th>인물</th><th class="n">건수</th><th class="n">매수</th><th class="n">매도</th></tr></thead><tbody>${Object.entries(by).sort((a, b) => b[1].n - a[1].n).map(([n, p]) => `<tr class="click"><td><button class="chip" data-wp="${esc(n)}">${esc(n)}</button><div class="small muted">${esc(p.role || '')}</div></td><td class="n">${p.n}</td><td class="n pos">${money(p.buy)}</td><td class="n neg">${money(p.sell)}</td></tr>`).join('')}</tbody></table></div></div>`;
  } else if (wTab === 'f13') {
    const keys = Object.keys(TR.f13); if (!wFund || !TR.f13[wFund]) wFund = keys[0]; const f = TR.f13[wFund], nm = { berkshire: '버핏(Berkshire)', bridgewater: '달리오(Bridgewater)', pershing: '애크먼(Pershing)', scion: '버리(Scion)', soros: '소로스', renaissance: '사이먼스(Renaissance)', thirdpoint: '로엡(Third Point)', duquesne: '드러켄밀러', appaloosa: '테퍼(Appaloosa)', icahn: '아이칸' };
    h += `<div class="chips" style="margin-bottom:10px">${keys.map(k => `<button class="chip" data-wfund="${k}" aria-pressed="${wFund === k}">${nm[k] || k}</button>`).join('')}</div>`;
    if (f) h += `<div class="card"><h2>${nm[wFund] || wFund} <span class="muted small">${esc(f.period)} 기준 · 공시 ${esc(f.filed)}</span></h2><dl class="kv"><dt>총 평가액(13F)</dt><dd>${money(f.total)}</dd><dt>보유 종목 수</dt><dd>${f.count}</dd></dl><h3 style="margin-top:10px">직전 분기 대비 변화 상위</h3><div class="tw"><table><thead><tr><th>종목</th><th>변화</th><th class="n">금액</th><th class="n">비중</th></tr></thead><tbody>${f.rows.filter(r => r.status !== 'HOLD').slice(0, 15).map(r => `<tr class="click" ${r.ticker ? `data-go="${esc(r.ticker)}"` : ''}><td><b>${esc(r.ticker || '–')}</b><div class="small muted">${esc(r.name)}${r.putCall ? ' ' + r.putCall : ''}</div></td><td>${pill(F13_KO[r.status] || r.status, r.status === 'NEW' || r.status === 'ADD' ? 'good' : 'bad')}</td><td class="n">${money(Math.abs(r.d_value))}</td><td class="n">${(r.weight * 100).toFixed(1)}%</td></tr>`).join('')}</tbody></table></div><h3 style="margin-top:10px">상위 보유</h3><div class="tw"><table><tbody>${f.top_holdings.slice(0, 10).map(p => `<tr><td><b>${esc(p.ticker || '–')}</b> <span class="small muted">${esc(p.name)}</span></td><td class="n">${money(p.value)}</td><td class="n">${(p.value / f.total * 100).toFixed(1)}%</td></tr>`).join('')}</tbody></table></div><p class="small muted">13F는 분기말 스냅샷(45일 지연)입니다. 티커는 CUSIP→OpenFIGI 매핑이며 매핑 실패 시 '–'로 표시됩니다.</p></div>`;
  } else {
    const rows = L.filter(t => t.source === 'ptr' || t.source === 'congress');
    h += `<div class="card"><h2>의원 공시 <span class="muted small">하원 PTR 색인(공식) · FMP(선택)</span></h2><p class="small muted" style="margin:0 0 8px">PTR 은 제출 사실과 원문 PDF 링크만 제공합니다(종목·금액은 PDF 안에 있어 추측하지 않습니다).</p>${rows.slice(0, 50).map(tradeCard).join('') || '<div class="empty">없음</div>'}</div>`;
  }
  el.innerHTML = h;
}
function whaleCardFor(sym) {
  const rows = whalesFor(sym), co = TR.co[sym]; if (!rows.length && !co) return '';
  const cut = Date.now() - 90 * 864e5, rec = rows.filter(t => Date.parse(t.filed_at) >= cut), buys = rec.filter(t => t.side === 'BUY'), sells = rec.filter(t => t.side === 'SELL');
  const net = rec.reduce((a, t) => a + (t.side === 'BUY' ? 1 : t.side === 'SELL' ? -1 : 0) * (t.value || 0), 0);
  return `<div class="card"><h2>거물·내부자 거래 <span class="muted small">참고(점수 미반영)</span></h2>${rec.length ? `<p style="margin:0 0 8px">최근 90일 매수 ${buys.length}건 · 매도 ${sells.length}건 · 순액 <b class="${cls(net)}">${net >= 0 ? '+' : '-'}${money(Math.abs(net))}</b></p>` : '<p class="muted small" style="margin:0 0 8px">최근 90일 거래 없음</p>'}${rows.slice(0, 5).map(tradeCard).join('')}${co && co.filings ? `<h3 style="margin:10px 0 6px">SEC 최근 공시</h3>${co.filings.slice(0, 5).map(f => `<div class="row small" style="padding:3px 0"><span class="muted">${esc(f.date)}</span><a href="${esc(f.url)}" target="_blank" rel="noopener" style="color:var(--info)">${esc(f.label)}</a></div>`).join('')}` : ''}<p class="small muted">내부자·기관 거래는 과거 이력이 짧아 앱의 매수 점수에는 넣지 않았습니다(검증 불가). 판단 보조 정보로만 쓰세요.</p></div>`;
}

/* ───────── 설정·지식 ───────── */
let knAt = 0;
async function loadKN(force) { if (KN && !force) return; try { KN = await jget('data/knowledge.json?t=' + Date.now(), 12000, { cache: 'no-store' }); knAt = Date.now(); if (view === 'set' || view === 'today') softRender(); } catch (e) { if (!KN) KN = { none: true }; } }
function vSet() {
  const st = S.settings, f = freshness(); let h = '';
  h += `<div class="card"><h2>데이터 상태 <span class="pill ${f.k === 'ok' ? 'good' : f.k === 'warn' ? 'warn' : 'bad'}">${f.k === 'ok' ? '정상' : f.k === 'warn' ? '지연' : '오래됨'}</span></h2><p class="small muted" style="margin:0 0 8px">${esc(f.d)}</p><dl class="kv"><dt>자동 갱신</dt><dd>${st.auto ? '켜짐 (보는 동안 장중 2분·장외 10분)' : '꺼짐'}</dd><dt>마지막 서버 갱신</dt><dd>${MAN?.updated ? new Date(MAN.updated * 1000).toLocaleString('ko-KR', { hour12: false }) : '–'}</dd><dt>갱신 실패 종목</dt><dd>${(MAN?.fails || []).join(', ') || '없음'}</dd><dt>저장된 종목 수</dt><dd>${Object.keys(PX).length}</dd></dl>
  <div class="row" style="margin-top:10px"><button class="btn pri" id="btnNow">지금 새로고침</button><label class="chk" style="padding:0"><input type="checkbox" id="oAuto" ${st.auto ? 'checked' : ''}><span>자동 갱신</span></label></div>
  <p class="small muted">우선순위: ① 같은 서버의 data/(자동 갱신 파일) → ② 프록시/직접 → ③ 마지막 정상 저장본. 어느 경로가 막혀도 화면은 비지 않고 ‘지연/오래됨’으로 표시됩니다. 신호는 일봉 종가 기준이라 수 분 지연은 결과에 영향이 거의 없습니다.</p></div>`;
  h += `<div class="card"><h2>내 매매 기준</h2><div class="form"><label class="f">목표 현금 비중 %<input id="cCash" inputmode="decimal" value="${st.cashTarget}"></label><label class="f">최소 유지 현금 %<input id="cRes" inputmode="decimal" value="${st.reserve}"></label><label class="f">1차 사용 %<input id="cT1" inputmode="decimal" value="${st.tranche[0]}"></label><label class="f">2차 %<input id="cT2" inputmode="decimal" value="${st.tranche[1]}"></label><label class="f">3차 %<input id="cT3" inputmode="decimal" value="${st.tranche[2]}"></label><label class="f">단일 종목 최대 %<input id="cMaxP" inputmode="decimal" value="${st.maxPos}"></label><label class="f">레버리지 합계 한도 %<input id="cMaxL" inputmode="decimal" value="${st.maxLev}"></label><label class="f">익절 기준 % (쉼표)<input id="cTp" value="${st.tp.join(',')}"></label><label class="f">테마<select id="cTheme">${[['auto', '자동'], ['light', '라이트'], ['dark', '다크']].map(([v, t]) => `<option value="${v}" ${st.theme === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div><label class="f" style="margin-top:10px">프록시/서버 주소(선택, 예: https://xxx.workers.dev 또는 http://192.168.0.10:8777)<input id="cProxy" value="${esc(st.proxy)}" placeholder="비우면 자동"></label>
  <label class="chk"><input type="checkbox" id="oNotify" ${st.notify ? 'checked' : ''}><span>새 매수 신호 알림 (앱을 열어 둔 동안/백그라운드 탭)</span></label><div class="row"><button class="btn pri" id="cSave">저장</button><button class="btn" id="cReset">기본값</button></div></div>`;
  h += `<div class="card"><h2>사용 설명서</h2><p style="margin:0 0 8px" class="small muted">설치·매일 쓰는 법·점수/검증 읽는 법·문제 해결.</p><a class="btn pri" href="guide.html" style="display:inline-block;text-decoration:none">사용 설명서 열기</a><dl class="kv" style="margin-top:10px"><dt>거물 거래 수집</dt><dd>${TR.status ? new Date(TR.status.updated * 1000).toLocaleString('ko-KR', { hour12: false }) : '–'}</dd><dt>SEC · 하원 · FMP</dt><dd>${TR.status ? esc(TR.status.sec) + ' · ' + esc(TR.status.house) + ' · ' + esc(TR.status.fmp) : '–'}</dd><dt>공포지수 버전 · 매도 규칙</dt><dd>v${params().fearV || 1} · ${params().trim === false ? '신규매수만 중단' : '익절 사용'}</dd></dl></div>
  <div class="card"><h2>백업·설치</h2><div class="row"><button class="btn sm" id="bkExp">백업 내보내기</button><button class="btn sm" id="bkImp">백업 불러오기</button><button class="btn sm" id="clrPx">시세 캐시 삭제</button>${window.__pwa ? '<button class="btn sm pri" id="pwaInstall">홈 화면에 설치</button>' : ''}</div><input type="file" id="bkFile" accept=".json" hidden><p class="small muted">iPhone: Safari 공유 버튼 → 홈 화면에 추가. Android: 주소창 메뉴 → 앱 설치. 모든 개인 데이터(보유·기록)는 이 기기에만 저장됩니다.</p></div>`;
  h += `<div class="card"><h2>영상 지식 <span class="muted small">두 채널 전체 자막 자동 분석</span></h2>${knowledgeHTML()}</div>`;
  h += `<details class="card"><summary class="b">채널 매매 원칙 요약 (영상 근거)</summary>${KNOWLEDGE.groups.map(g => `<h3 style="margin-top:12px">${esc(g.name)}</h3><div class="small muted">${esc(g.sub)}</div>${g.rules.map(r => `<div class="rule"><b>${esc(r.t)}</b><div class="small">${esc(r.d)}</div><div>${r.v.map(v => `<a href="https://youtu.be/${v}" target="_blank" rel="noopener">▶ ${v}</a>`).join(' &nbsp; ')}</div></div>`).join('')}`).join('')}</details>`;
  $('#v-set').innerHTML = h;
}
function knowledgeHTML() {
  if (!KN) { loadKN(); return '<p class="muted small">불러오는 중…</p>'; } if (KN.none) return '<p class="muted small">data/knowledge.json 이 없습니다(tools/build_knowledge.py 로 생성).</p>';
  const ch = KN.channels, sig = KN.signals; let h = `<dl class="kv">${Object.entries(ch).map(([k, v]) => `<dt>${esc(v.name)}</dt><dd>${v.withSub}/${v.total}개 자막 분석 (${v.from}~${v.to})</dd>`).join('')}<dt>분석 시점</dt><dd>${esc(KN.built)}</dd></dl>`;
  if (sig) { h += `<h3 style="margin-top:12px">영상에서 강조한 신호 (1,000자당 언급)</h3><div class="tw"><table><thead><tr><th>신호</th><th class="n">웅덩이(dm)</th><th class="n">도키</th></tr></thead><tbody>${Object.keys(sig.dm).map(k => `<tr><td>${esc(k)}</td><td class="n">${sig.dm[k]}</td><td class="n">${sig.doki[k]}</td></tr>`).join('')}</tbody></table></div>`; }
  h += `<h3 style="margin-top:12px">영상 검색</h3><input id="kq" placeholder="제목·키워드 (예: SOXL, 200일선)" value="${esc(window.__kq || '')}"><div id="kres"></div>`; setTimeout(knSearch, 0); return h;
}
function knSearch() { const q = ($('#kq')?.value || '').trim().toLowerCase(), el = $('#kres'); if (!el || !KN?.videos) return; window.__kq = q; const r = KN.videos.filter(v => !q || (v[3] || '').toLowerCase().includes(q)).slice(0, 40); el.innerHTML = r.map(v => `<div class="rule"><a href="https://youtu.be/${v[0]}" target="_blank" rel="noopener">▶ ${esc(v[3] || v[0])}</a><div class="small muted">${v[1] === 'dm' ? '웅덩이' : '도키'} · ${esc(v[2] || '')}</div></div>`).join('') || '<div class="empty">결과 없음</div>'; }

/* ───────── 렌더·이벤트 ───────── */
function applyTheme() { const t = S.settings.theme; t === 'auto' ? document.documentElement.removeAttribute('data-theme') : document.documentElement.setAttribute('data-theme', t); }
function render() {
  const nav = navHTML(); $('#botNav').innerHTML = nav; $('#sideNav').innerHTML = nav; renderSeg(); renderFresh();
  $$('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + view)); $('#pageTitle').textContent = VIEWS.find(v => v[0] === view)[2];
  $('#lensSeg').style.display = ['acct', 'set', 'whales'].includes(view) ? 'none' : '';
  ({ today: vToday, stock: vStock, whales: vWhales, verify: vVerify, acct: vAcct, set: vSet })[view]();
}
const dl = (name, txt, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
document.addEventListener('click', async e => {
  const t = e.target.closest('button,[data-go],tr[data-lens],a'); if (!t) { if (e.target.id === 'modal') closeModal(); return; }
  if (t.dataset.v) return go(t.dataset.v); if (t.dataset.l) { S.settings.lens = t.dataset.l; save(); return render(); }
  if (t.dataset.go) return go('stock', t.dataset.go); if (t.dataset.lens) { S.settings.lens = t.dataset.lens; save(); return render(); }
  if (t.dataset.sym) { curSym = t.dataset.sym; return render(); } if (t.dataset.rng) { range = t.dataset.rng; return render(); }
  if ('close' in t.dataset) return closeModal(); if (t.dataset.jdel) { S.journal = S.journal.filter(j => j.id != t.dataset.jdel); save(); return render(); } if (t.dataset.edith) return holdForm(t.dataset.edith);
  if (t.id === 'fresh' || t.id === 'btnSet') { go('set'); return; }
  if (t.dataset.wt) { wTab = t.dataset.wt; wPerson = null; return render(); } if (t.dataset.wf) { wFilter = t.dataset.wf; return render(); }
  if (t.dataset.wp) { wPerson = t.dataset.wp; wTab = 'feed'; return render(); } if (t.dataset.wfund) { wFund = t.dataset.wfund; return render(); }
  if (t.dataset.trade) return tradeSheet(t.dataset.trade); if (t.dataset.opensym) { closeModal(); return go('stock', t.dataset.opensym); }
  const id = t.id; if (!id) return; const w = S.watch.find(x => x.sym === curSym);
  const A = {
    btnRefresh: () => refresh(true), btnNow: () => refresh(true), btRun: () => runBacktest(),
    fetchOne: async () => { setStatus('수집 중…'); const r = await syncLive([curSym]); setStatus(r.fails.length ? '수집 실패: 프록시/네트워크 확인 또는 CSV 사용' : ''); recompute(); render(); },
    csvGo: () => { const d = [], c = []; for (const ln of $('#csvIn').value.split(/\r?\n/)) { const m = ln.trim().split(/[,\t;]/); if (m.length < 2) continue; const v = num(m[m.length > 5 ? 4 : 1]), dt = m[0].replace(/[./]/g, '-'); if (/^\d{4}-\d{1,2}-\d{1,2}/.test(dt) && v != null) { const [y, mo, da] = dt.slice(0, 10).split('-'); d.push(`${y}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`); c.push(v); } } if (d.length > 1 && d[0] > d.at(-1)) { d.reverse(); c.reverse(); } if (d.length < 300) return alert('유효한 행이 300개 이상 필요합니다(날짜,종가).'); putPX(curSym, { d, c, t: Date.now() }); recompute(); render(); },
    addSym: () => openModal(`<h2>관심종목 추가</h2><div class="form"><label class="f">티커<input id="nSym" autocapitalize="characters" placeholder="예: SOXX"></label><label class="f">레버리지<select id="nLev"><option>1</option><option>2</option><option>3</option></select></label></div><div class="row"><button class="btn pri" id="nAdd">추가</button><button class="btn" data-close>취소</button></div>`),
    nAdd: async () => { const s = $('#nSym').value.trim().toUpperCase(); if (!/^[A-Z0-9.^=-]{1,12}$/.test(s)) return; const lv = +$('#nLev').value; if (!S.watch.find(x => x.sym === s)) S.watch.push({ sym: s, lev: lv, type: lv > 1 ? 'etf' : 'stock', beta: 1 }); curSym = s; save(); closeModal(); render(); setStatus(s + ' 이력 수집 중…'); await syncLive([s]); setStatus(''); recompute(); render(); maybeBacktest(true); },
    delSym: () => { if (confirm(curSym + ' 삭제?')) { S.watch = S.watch.filter(x => x.sym !== curSym); curSym = null; save(); recompute(); render(); } },
    sSave: () => { w.lev = +$('#sLev').value; w.beta = num($('#sBeta').value) ?? 1; w.type = $('#sType').value; save(); recompute(); render(); },
    resetEp: () => { delete S.episodes[curSym + '|' + S.settings.lens]; save(); render(); },
    logBuy: () => { const p = planFor(curSym, S.settings.lens); view = 'acct'; render(); $('#jSym').value = curSym; $('#jQty').value = p.shares || ''; $('#jPx').value = LIVE[curSym].price; $('#jTr').value = p.k; $('#jQty').scrollIntoView({ block: 'center' }); },
    addHold: () => holdForm(null),
    hSave: () => { const s = $('#hSym').value.trim().toUpperCase(), q = num($('#hQty').value), a = num($('#hAvg').value); if (!s || !(q > 0) || !(a > 0)) return alert('티커·수량·평단 확인'); const h = S.holdings.find(x => x.sym === s); h ? (h.qty = q, h.avg = a) : S.holdings.push({ sym: s, qty: q, avg: a }); if (!S.watch.find(x => x.sym === s)) S.watch.push({ sym: s, lev: 1, type: 'stock', beta: 1 }); save(); closeModal(); recompute(); render(); refresh(false); },
    hDel: () => { S.holdings = S.holdings.filter(x => x.sym !== $('#hSym').value); save(); closeModal(); render(); },
    editCash: () => openModal(`<h2>현금(USD)</h2><label class="f">보유 현금<input id="cashIn" inputmode="decimal" value="${S.cash || ''}"></label><div class="row"><button class="btn pri" id="cashSave">저장</button><button class="btn" data-close>취소</button></div>`),
    cashSave: () => { S.cash = num($('#cashIn').value) || 0; save(); closeModal(); render(); }, jAdd: addJournal,
    jCsv: () => dl('journal.csv', '﻿' + [['date', 'side', 'sym', 'qty', 'price', 'tranche', 'note'], ...S.journal.map(j => [j.date, j.side, j.sym, j.qty, j.px, j.tr, '"' + (j.note || '').replace(/"/g, '""') + '"'])].map(r => r.join(',')).join('\n'), 'text/csv'),
    cSave: async () => { const s = S.settings; s.cashTarget = num($('#cCash').value) ?? 20; s.reserve = num($('#cRes').value) ?? 10; s.tranche = [num($('#cT1').value) ?? 20, num($('#cT2').value) ?? 30, num($('#cT3').value) ?? 50]; s.maxPos = num($('#cMaxP').value) ?? 30; s.maxLev = num($('#cMaxL').value) ?? 40; s.tp = $('#cTp').value.split(',').map(num).filter(x => x > 0).sort((a, b) => a - b); if (!s.tp.length) s.tp = [30, 60, 100]; s.theme = $('#cTheme').value; s.proxy = $('#cProxy').value.trim(); s.notify = $('#oNotify').checked; if (s.notify && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission(); applyTheme(); save(); setStatus('저장되었습니다'); setTimeout(() => setStatus(''), 1500); render(); },
    cReset: () => { if (confirm('기준을 기본값으로 되돌릴까요?')) { S.settings = DEF().settings; applyTheme(); save(); render(); } },
    bkExp: () => dl('puddle-trader-backup.json', JSON.stringify(S, null, 1), 'application/json'), bkImp: () => $('#bkFile').click(),
    clrPx: async () => { PX = {}; for (const k of (await IDB.keys()) || []) if (String(k).startsWith('px:') || k === 'man') await IDB.set(k, null); MAN = null; render(); refresh(true); },
    pwaInstall: async () => { const p = window.__pwa; if (p) { p.prompt(); await p.userChoice; window.__pwa = null; render(); } }
  }; A[id]?.();
});
document.addEventListener('change', e => {
  const i = e.target.id;
  if (i === 'oAuto') { S.settings.auto = e.target.checked; save(); render(); }
  else if (i === 'bkFile') { const f = e.target.files[0]; if (!f) return; f.text().then(x => { try { const j = JSON.parse(x); if (!j.settings || !j.watch) throw 0; S = Object.assign(DEF(), j); save(); applyTheme(); recompute(); render(); refresh(false); } catch (er) { alert('올바른 백업 파일이 아닙니다.'); } }); }
});
document.addEventListener('input', e => { if (e.target.id === 'kq') knSearch(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); if (e.key === 'Enter' && e.target.closest('#modal') && e.target.tagName === 'INPUT') $('#modal .btn.pri')?.click(); });
window.addEventListener('hashchange', () => { const h = location.hash.slice(1).split('/'); if (VIEWS.some(v => v[0] === h[0]) && (h[0] !== view || (h[1] && h[1] !== curSym))) { view = h[0]; if (h[1]) curSym = h[1]; render(); } });
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.__pwa = e; if (view === 'set') render(); });
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => view === 'stock' && render(), 150); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { tickN = 0; tick(); } });
window.addEventListener('online', () => refresh(false)); window.addEventListener('focus', () => { if (freshness().k !== 'ok') refreshLight(); });
// 당겨서 새로고침(모바일)
(() => { let y0 = null, d = 0; const ptr = $('#ptr'); addEventListener('touchstart', e => { y0 = scrollY <= 0 ? e.touches[0].clientY : null; d = 0; }, { passive: true }); addEventListener('touchmove', e => { if (y0 == null) return; d = e.touches[0].clientY - y0; ptr.classList.toggle('on', d > 60); ptr.textContent = d > 110 ? '↑ 놓으면 새로고침' : '↓ 당겨서 새로고침'; }, { passive: true }); addEventListener('touchend', () => { if (y0 != null && d > 110) refresh(true); ptr.classList.remove('on'); y0 = null; }); })();

/* ───────── 시작 ───────── */
(async function init() {
  applyTheme();
  const h = location.hash.slice(1).split('/'); if (VIEWS.some(v => v[0] === h[0])) { view = h[0]; if (h[1]) curSym = h[1]; }
  render();
  try { const keys = (await IDB.keys()) || []; await Promise.all(keys.map(async k => { const v = await IDB.get(k); if (!v) return; if (String(k).startsWith('px:')) PX[k.slice(3)] = v; else if (k === 'man') MAN = v; else if (k === 'fund') FUND = v; else if (k === 'bt') RES = v; else if (k === 'tr') TR = v; })); } catch (e) { }
  try { LIVE_URL = (await jget('data/live.json?t=' + Date.now(), 4000, { cache: 'no-store' })).live || ''; } catch (e) { }
  recompute(); render();                         // 저장된 마지막 데이터로 즉시 표시(오프라인에서도 동작)
  await refresh(false);                           // 이어서 최신화
  setInterval(tick, 60000); setInterval(liveTick, 10000); setInterval(renderFresh, 15000); loadKN();
  if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => { });
})();
