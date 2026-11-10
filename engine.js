/* 웅덩이 트레이더 엔진 — 라이브 추천·과거 검증·자동 보정이 "같은 코드"를 쓰도록 공용으로 분리.
   브라우저(window)와 Web Worker(self) 양쪽에서 동작. 모든 지표는 '그날까지의 데이터'만 사용(미래 참조 없음). */
(function (root) {
  'use strict';
  const E = {};
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const START = 260;           // 지표 워밍업(52주 창 + 여유)
  const HZ = [20, 60, 120, 250];
  const SECT = ['XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLB', 'XLU', 'XLRE', 'XLC'];
  E.START = START; E.HZ = HZ; E.SECT = SECT; E.VERSION = 3;   // 엔진 로직이 바뀌면 올려서 저장된 검증 결과를 자동 재생성
  E.MARKET_SYMS = ['^VIX', '^VIX3M', 'SPY', 'QQQ', 'HYG', 'IEF', 'TLT'].concat(SECT);

  /* ── 기본 지표 ── */
  E.sma = function (a, n) { const o = new Array(a.length).fill(null); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; } return o; };
  E.ema = function (a, n) { const k = 2 / (n + 1), o = []; let p = a[0]; for (let i = 0; i < a.length; i++) { p = i ? a[i] * k + p * (1 - k) : a[0]; o.push(p); } return o; };
  E.rsi = function (a, n) {
    n = n || 14; const o = new Array(a.length).fill(null); if (a.length <= n) return o; let g = 0, l = 0;
    for (let i = 1; i <= n; i++) { const d = a[i] - a[i - 1]; d > 0 ? g += d : l -= d; } g /= n; l /= n; o[n] = 100 - 100 / (1 + (l ? g / l : 1e9));
    for (let i = n + 1; i < a.length; i++) { const d = a[i] - a[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; o[i] = 100 - 100 / (1 + (l ? g / l : 1e9)); }
    return o;
  };
  function rollMax(a, w) { const o = new Array(a.length), q = []; for (let i = 0; i < a.length; i++) { while (q.length && a[q[q.length - 1]] <= a[i]) q.pop(); q.push(i); if (q[0] <= i - w) q.shift(); o[i] = a[q[0]]; } return o; }
  function wilson(win, n) { if (!n) return 0; const z = 1.96, p = win / n, d = 1 + z * z / n; return (p + z * z / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d; }
  E.wilson = wilson;
  const median = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;

  /* ── 시장 컨텍스트(VIX·VIX3M·자체 공포지수·시장 폭) — 모두 가격에서 계산: 과거 검증과 실시간이 동일 기준 ── */
  E.buildMarket = function (px) {
    const spy = px.SPY; if (!spy || spy.c.length < 300) return null;
    const d = spy.d, n = d.length;
    const align = s => { const o = new Array(n).fill(null); const x = px[s]; if (!x) return o; let j = 0, last = null; for (let i = 0; i < n; i++) { while (j < x.d.length && x.d[j] <= d[i]) { last = x.c[j]; j++; } o[i] = last; } return o; };
    const vix = align('^VIX'), v3 = align('^VIX3M');
    const sc = spy.c, hi = rollMax(sc, 252), rs = E.rsi(sc), m125 = E.sma(sc, 125);
    const fear = new Array(n).fill(null);
    for (let i = 130; i < n; i++) {
      const parts = [];
      if (vix[i] != null && i >= 252) { let cnt = 0, tot = 0; for (let k = i - 251; k <= i; k++) if (vix[k] != null) { tot++; if (vix[k] <= vix[i]) cnt++; } if (tot > 100) parts.push(100 * cnt / tot); }
      parts.push(clamp(-(sc[i] / hi[i] - 1) / 0.2, 0, 1) * 100);
      if (rs[i] != null) parts.push(100 - rs[i]);
      if (m125[i] != null) parts.push(clamp(-(sc[i] / m125[i] - 1) / 0.1, 0, 1) * 100);
      fear[i] = parts.reduce((a, b) => a + b, 0) / parts.length;
    }
    const secRaw = SECT.filter(s => px[s] && px[s].c.length > 300).map(s => align(s));
    const sec = secRaw.map(a => { const h = rollMax(a.map(v => v == null ? 0 : v), 252); return a.map((v, i) => v == null || !h[i] ? null : v / h[i] - 1); });
    const breadth = new Array(n).fill(null);
    if (sec.length >= 5) for (let i = 0; i < n; i++) { let c = 0, t = 0; for (const s of sec) if (s[i] != null) { t++; if (s[i] <= -0.10) c++; } breadth[i] = t >= 5 ? c / t : null; }
    /* 공포지수 v2 — CNN 공포탐욕 지수의 7요소 중 '공개 가격으로 재현 가능한' 6요소를 같은 방식(최근 1년 대비 백분위)으로 합성.
       (CNN 원본은 풋/콜 비율과 거래소 신고가·신저가 거래량 등 유료·비공개 데이터를 써서 동일하지 않음) */
    const hyg = align('HYG'), ief = align('IEF'), vsm = E.sma(vix.map(v => v == null ? 0 : v), 50), hsm = E.sma(sc, 1);
    const ratio = hyg.map((v, i) => v != null && ief[i] ? v / ief[i] : null), rsm = E.sma(ratio.map(v => v == null ? 0 : v), 50);
    const s50 = secRaw.map(a => E.sma(a.map(v => v == null ? 0 : v), 50)), sMax = secRaw.map(a => rollMax(a.map(v => v == null ? 0 : v), 252)), sMin = secRaw.map(a => { const o = []; for (let i = 0; i < a.length; i++) { let m = Infinity; for (let k = Math.max(0, i - 251); k <= i; k++) if (a[k] != null && a[k] < m) m = a[k]; o.push(m); } return o; });
    const pr = (arr, i) => { let c = 0, t = 0; for (let k = i - 251; k < i; k++) if (arr[k] != null) { t++; if (arr[k] <= arr[i]) c++; } return t > 100 ? 100 * c / t : null; };
    const mom = new Array(n).fill(null), str = new Array(n).fill(null), brd = new Array(n).fill(null), vol = new Array(n).fill(null), safe = new Array(n).fill(null), junk = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      if (m125[i] != null) mom[i] = sc[i] / m125[i] - 1;
      if (vix[i] != null && vsm[i]) vol[i] = vix[i] / vsm[i] - 1;
      if (i >= 20 && ief[i] != null && ief[i - 20]) safe[i] = (sc[i] / sc[i - 20] - 1) - (ief[i] / ief[i - 20] - 1);
      if (ratio[i] != null && rsm[i]) junk[i] = ratio[i] / rsm[i] - 1;
      if (secRaw.length >= 5 && i >= 252) { let hi = 0, lo = 0, ab = 0, t = 0; for (let j = 0; j < secRaw.length; j++) { const v = secRaw[j][i]; if (v == null) continue; t++; if (v >= .97 * sMax[j][i]) hi++; if (v <= 1.03 * sMin[j][i]) lo++; if (s50[j][i] && v > s50[j][i]) ab++; } if (t >= 5) { str[i] = (hi - lo) / t; brd[i] = ab / t; } }
    }
    const fear2 = new Array(n).fill(null);
    for (let i = 260; i < n; i++) {
      const g = []; const add = (arr, inv) => { if (arr[i] == null) return; const p = pr(arr, i); if (p != null) g.push(inv ? 100 - p : p); };
      add(mom, false); add(str, false); add(brd, false); add(vol, true); add(safe, false); add(junk, false);
      if (g.length >= 4) fear2[i] = 100 - g.reduce((a, b) => a + b, 0) / g.length;
    }
    return { d, n, vix, v3, fear, fear2, breadth };
  };

  /* ── 종목별 신호 계산(전 기간) ──
     신호 강도 s∈[0,1]; 렌즈별 가중치를 곱해 점수화. */
  E.features = function (w, ser, mk, live) {
    const c = ser.c, d = ser.d, n = c.length; if (n < START + 5) return null;
    const lev = w.lev || 1, isStock = (w.type || 'etf') === 'stock';
    const hi = rollMax(c, 252), s20 = E.sma(c, 20), s50 = E.sma(c, 50), s200 = E.sma(c, 200), rD = E.rsi(c);
    // 주봉(현재 주는 '진행 중' 종가로 갱신, 완료 주만 확정 — 미래 참조 없음)
    const wi = new Int32Array(n), wc = []; let key = null, j = -1;
    for (let i = 0; i < n; i++) { const t = Date.parse(d[i] + 'T00:00:00Z'), dow = (new Date(t).getUTCDay() + 6) % 7, mon = t - dow * 864e5; if (mon !== key) { j++; key = mon; wc.push(c[i]); } else wc[j] = c[i]; wi[i] = j; }
    const W = wc.length, gA = new Array(W).fill(null), lA = new Array(W).fill(null), P = new Array(W + 1).fill(0);
    for (let k = 0; k < W; k++) P[k + 1] = P[k] + wc[k];
    if (W > 14) { let g = 0, l = 0; for (let k = 1; k <= 14; k++) { const x = wc[k] - wc[k - 1]; x > 0 ? g += x : l -= x; } g /= 14; l /= 14; gA[14] = g; lA[14] = l; for (let k = 15; k < W; k++) { const x = wc[k] - wc[k - 1]; g = (g * 13 + Math.max(x, 0)) / 14; l = (l * 13 + Math.max(-x, 0)) / 14; gA[k] = g; lA[k] = l; } }
    const e12 = E.ema(c, 12), e26 = E.ema(c, 26), ml = e12.map((v, i) => v - e26[i]), sg = E.ema(ml, 9);
    const lastX = new Int32Array(n).fill(-999); for (let i = 1; i < n; i++) lastX[i] = (ml[i - 1] <= sg[i - 1] && ml[i] > sg[i]) ? i : lastX[i - 1];
    // 시장 매핑(날짜 → 시장 배열 인덱스, 직전 거래일 기준)
    const mi = new Int32Array(n).fill(-1); if (mk) { let p = 0; for (let i = 0; i < n; i++) { while (p + 1 < mk.n && mk.d[p + 1] <= d[i]) p++; mi[i] = mk.d[p] <= d[i] ? p : -1; } }
    const qqq = live && live.qqq, fz = live && live.fearV === 2 && mk ? mk.fear2 : null;
    const F = { sym: w.sym, n, d, c, lev, isStock, wi, S: {}, B: {}, fwd: {} };
    const mkS = ['dd', 'ma200', 'rsiW', 'rsiD', 'macd', 'ma200w', 'brk', 'vix', 'fear', 'breadth', 'inv', 'season', 'sup', 'trend', 'val', 'man_res', 'over', 'hi', 'ext', 'weak', 'pval', 'man_bad'];
    for (const k of mkS) F.S[k] = new Float32Array(n);
    for (const k of ['dd', 'dev200', 'rW', 'rD', 'ma200w', 'vix', 'fear', 'breadth', 'inv', 'fair']) F.B[k] = new Float32Array(n).fill(NaN);
    F.S.val.fill(-1);
    for (let i = 0; i < n; i++) {
      const dd = c[i] / hi[i] - 1, ddU = dd / lev; F.B.dd[i] = dd;
      const dev = s200[i] ? c[i] / s200[i] - 1 : NaN, devU = dev / lev; F.B.dev200[i] = dev;
      F.S.dd[i] = ddU <= -.30 ? 1 : ddU <= -.20 ? .8 : ddU <= -.10 ? .48 : 0;
      F.S.ma200[i] = isNaN(devU) ? 0 : devU <= -.15 ? 1 : devU <= -.08 ? .53 : 0;
      const jw = wi[i]; let rW = NaN;
      if (jw >= 15 && gA[jw - 1] != null) { const x = c[i] - wc[jw - 1], g = (gA[jw - 1] * 13 + Math.max(x, 0)) / 14, l = (lA[jw - 1] * 13 + Math.max(-x, 0)) / 14; rW = 100 - 100 / (1 + (l ? g / l : 1e9)); }
      F.B.rW[i] = rW; F.B.rD[i] = rD[i] == null ? NaN : rD[i];
      F.S.rsiW[i] = isNaN(rW) ? 0 : rW <= 30 ? 1 : rW <= 35 ? .75 : rW <= 45 ? .4 : 0;
      F.S.rsiD[i] = rD[i] != null && rD[i] <= 30 ? 1 : 0;
      F.S.macd[i] = (i - lastX[i] <= 10 && (ml[i] < 0 || dd < -.05)) ? 1 : 0;
      let m200w = NaN; if (jw >= 199) m200w = (P[jw] - P[jw - 199] + c[i]) / 200; F.B.ma200w[i] = m200w;
      F.S.ma200w[i] = !isNaN(m200w) && c[i] <= m200w * 1.15 ? 1 : 0;
      if (i >= 16) { let mx = 0; for (let k = i - 15; k < i; k++) if (c[k] > mx) mx = c[k]; F.S.brk[i] = (ddU <= -.05 && c[i] > mx) ? 1 : 0; }
      F.S.trend[i] = (s200[i] && i >= 20 && s200[i - 20] && s200[i] > s200[i - 20] && dev > 0) ? 1 : 0;
      F.S.sup[i] = (s200[i] && i >= 20 && s200[i - 20] && s200[i] > s200[i - 20] && dev >= -.05 && dev <= .03) ? 1 : 0;
      F.S.over[i] = !isNaN(rW) && rW >= 70 ? 1 : 0; F.S.hi[i] = dd > -.03 ? 1 : 0; F.S.ext[i] = !isNaN(devU) && devU >= .25 ? 1 : 0;
      if (isStock && i >= 60 && dd <= -.35) { const r60 = c[i] / c[i - 60] - 1; let rq = 0; if (qqq && qqq.byDate) { const q = qqq.byDate(d[i], 60); if (q != null) rq = q; } F.S.weak[i] = (r60 - rq) <= -.25 ? 1 : 0; }
      // 시장
      const m = mi[i];
      if (m >= 0) {
        const vx = mk.vix[m], f = (fz && fz[m] != null) ? fz[m] : mk.fear[m], b = mk.breadth[m], v3 = mk.v3[m];
        if (vx != null) { F.B.vix[i] = vx; F.S.vix[i] = vx >= 40 ? 1 : vx >= 30 ? .67 : vx >= 25 ? .33 : 0; }
        if (f != null) { F.B.fear[i] = f; F.S.fear[i] = clamp((f - 50) / 25, 0, 1); }
        if (b != null) { F.B.breadth[i] = b; F.S.breadth[i] = b >= .7 ? 1 : b >= .5 ? .5 : 0; }
        if (vx != null && v3 != null) { const r = vx / v3; F.B.inv[i] = r; F.S.inv[i] = r >= 1.02 ? 1 : r >= .97 ? .5 : 0; }
      }
      const y = +d[i].slice(0, 4), mo = +d[i].slice(5, 7);
      F.S.season[i] = ((y % 4 === 2 && mo >= 10) || (y % 4 === 3 && mo <= 4)) ? 1 : 0;   // 중간선거 해 4분기~이듬해 상반기
    }
    for (const h of HZ) { const a = new Float32Array(n).fill(NaN); for (let i = 0; i + 1 + h < n; i++) a[i] = c[i + 1 + h] / c[i + 1] - 1; F.fwd[h] = a; }
    const m60 = new Float32Array(n).fill(NaN); for (let i = 0; i + 61 < n; i++) { let mn = 0; for (let k = 2; k <= 61; k++) { const r = c[i + k] / c[i + 1] - 1; if (r < mn) mn = r; } m60[i] = mn; } F.mae60 = m60;
    return F;
  };
  // 라이브(마지막 봉)에만 채우는 값: 밸류에이션(자동/수동 적정가), 수동 보정
  E.applyLive = function (F, ex) {
    const i = F.n - 1; ex = ex || {};
    F.B.fair[i] = NaN; F.S.val[i] = -1; F.S.pval[i] = 0;     // 매번 초기화(캐시된 특징 재사용 시 잔여값 방지)
    if (ex.fair > 0) { const r = F.c[i] / ex.fair; F.B.fair[i] = ex.fair; F.S.val[i] = r <= .8 ? 1 : r <= 1 ? .4 : 0; F.S.pval[i] = r >= 1.2 ? 1 : r > 1 ? .4 : 0; }
    F.S.man_res[i] = ex.resolve ? 1 : 0; F.S.man_bad[i] = ex.bad ? 1 : 0;
  };

  /* ── 3관점 정의 ──
     P=웅덩이 매매법(developmong): 시장·기술적 극단에서 분할매수. D=도키(doki_investing): 적정가·저점 위치·과매수 회피.
     C=통합: 두 관점의 합의. buy/pen 값은 '만점 기준 점수'. */
  E.LENS = {
    P: { name: '웅덩이', ch: 'developmong', norm: false, buy: { dd: 25, ma200: 15, rsiW: 20, rsiD: 5, macd: 8, ma200w: 10, brk: 6, vix: 12, fear: 8, breadth: 8, inv: 5, season: 3, trend: 6, man_res: 5 }, pen: { over: 15, hi: 8, ext: 10, weak: 15, man_bad: 15 } },
    D: { name: '도키', ch: 'doki_investing', norm: true, buy: { val: 40, dd: 15, rsiW: 20, ma200w: 10, sup: 10, fear: 5, rsiD: 5, trend: 8, man_res: 5 }, pen: { over: 20, pval: 25, hi: 5, weak: 15, man_bad: 15 } },
    C: { name: '통합', ch: 'both' }
  };
  E.LABEL = { dd: '고점 대비 낙폭(웅덩이 깊이)', ma200: '200일선 아래 이격', rsiW: '주봉 RSI 과매도', rsiD: '일봉 RSI 과매도', macd: 'MACD 골든크로스(반등 확인)', ma200w: '200주선 근접(최악 지지선)', brk: '하락 추세 돌파(반등 확인)', vix: 'VIX 공포', fear: '공포지수(자체 계산) 높음', breadth: '시장 폭(섹터 -10%↓ 비율)', inv: 'VIX 기간구조 역전(패닉·강제청산)', season: '계절성(중간선거 4Q~이듬해 상반기)', sup: '200일선 지지 구간(상승 추세 유지)', trend: '상승 추세 유지(가격>200일선·200일선 상승)', val: '적정주가 대비 저평가', man_res: '악재 해소 재료(수동 보정)', over: '주봉 RSI 70↑ 과매수', hi: '신고가 근처(웅덩이 아님)', ext: '200일선 대비 과도한 이격', weak: '구조적 약세 의심(시장 대비 -25%p·고점 -35%)', pval: '적정주가 대비 고평가', man_bad: '악재 미해결(수동 보정)' };
  E.DEFAULTS = () => ({ thr: { P: [40, 55, 70], D: [35, 50, 65], C: [45, 60, 75] }, m: { P: {}, D: {} }, trim: true, fearV: 1 });

  function lensScore(L, S, i, m) {
    let b = 0, den = 0, p = 0;
    for (const id in L.buy) {
      const s = S[id][i], w = L.buy[id] * (m[id] || 1);
      if (id === 'val' && s < 0) continue;          // 적정가 없으면 해당 항목 제외(정규화 시 분모에서도 제외)
      b += w * s; if (id !== 'man_res') den += w;
    }
    if (L.norm) { const man = L.buy.man_res * (m.man_res || 1) * S.man_res[i]; b = (den ? 100 * (b - man) / den : 0) + man; }
    for (const id in L.pen) p += L.pen[id] * (m[id] || 1) * S[id][i];
    return clamp(b - p, 0, 100);
  }
  E.scores = function (F, params) {
    const n = F.n, o = { P: new Float32Array(n), D: new Float32Array(n), C: new Float32Array(n) };
    const th = params.thr;
    for (let i = 0; i < n; i++) {
      const p = lensScore(E.LENS.P, F.S, i, params.m.P), d = lensScore(E.LENS.D, F.S, i, params.m.D);
      o.P[i] = p; o.D[i] = d;
      let c = .5 * p + .5 * d; if (p >= th.P[0] && d >= th.D[0]) c += 8; else if (p < 20 || d < 15) c -= 8; o.C[i] = clamp(c, 0, 100);
    }
    return o;
  };
  E.overheated = (F, i) => F.S.over[i] > 0 || (F.S.ext[i] > 0 && F.S.hi[i] > 0);
  E.kOf = function (lens, score, thr, F, i) {
    let k = score >= thr[2] ? 3 : score >= thr[1] ? 2 : score >= thr[0] ? 1 : 0, note = '';
    if (F.lev >= 3 && k > 2) { k = 2; note = '3배 레버리지 → 2차까지'; }
    if (lens === 'D' && F.lev >= 3 && k > 1) { k = 1; note = '도키 관점: 3배 레버리지는 소액·단기만'; }
    if (F.S.weak[i] > 0 && k > 1) { k = 1; note = '구조적 약세 의심 → 1차 소액'; }
    if (F.S.man_bad[i] > 0 && k > 1) { k = 1; note = '악재 미해결 → 1차 소액'; }
    if (F.S.pval[i] >= 1 && k > 1) { k = 1; note = '고평가 → 추가 매수 최소화'; }
    return { k, note };
  };

  /* ── 이벤트 연구: 신호가 처음 켜진 날(차수별 1회/웅덩이)의 이후 수익률 ── */
  E.events = function (F, sc, lens, thr, opt) {
    opt = opt || {}; const out = [], used = new Set(); let last = -99;
    for (let i = START; i < F.n - 2; i++) {
      const s = sc[i]; if (s < 20) used.clear();
      if (E.overheated(F, i)) continue;
      const { k } = E.kOf(lens, s, thr, F, i); if (!k || used.has(k) || i - last < 5) continue;
      for (let q = 1; q <= k; q++) used.add(q); last = i;
      out.push({ sym: F.sym, i, date: F.d[i], k, score: s, px: F.c[i + 1], r: HZ.map(h => F.fwd[h][i]), mae: F.mae60[i], lev: F.lev });
    }
    return out;
  };
  function stat(arr) { const a = arr.filter(x => isFinite(x)); const w = a.filter(x => x > 0).length; return { n: a.length, win: a.length ? w / a.length : NaN, lb: wilson(w, a.length), mean: mean(a), med: median(a) }; }
  E.summarize = function (events, P, scAll, opts) {
    const res = { n: events.length, h: {}, byK: {}, mae: median(events.map(e => e.mae).filter(isFinite)), syms: {} };
    HZ.forEach((h, hi) => {
      const a = events.map(e => e.r[hi]); const s = stat(a);
      // 기준선: 같은 종목 구성(이벤트 수 가중)에서 '아무 날이나' 샀을 때
      const cnt = {}; events.forEach(e => cnt[e.sym] = (cnt[e.sym] || 0) + 1); let bw = 0, bm = 0, tot = 0;
      for (const sym in cnt) { const F = P[sym]; const b = []; for (let i = START; i < F.n - 2; i++) { const v = F.fwd[h][i]; if (isFinite(v)) b.push(v); } const bs = stat(b); bw += cnt[sym] * bs.win; bm += cnt[sym] * bs.mean; tot += cnt[sym]; }
      s.baseWin = tot ? bw / tot : NaN; s.baseMean = tot ? bm / tot : NaN; s.edge = s.win - s.baseWin; res.h[h] = s;
    });
    for (let k = 1; k <= 3; k++) { const ev = events.filter(e => e.k === k); res.byK[k] = { n: ev.length, win60: stat(ev.map(e => e.r[1])).win, mean60: stat(ev.map(e => e.r[1])).mean, win120: stat(ev.map(e => e.r[2])).win }; }
    const bs = {}; events.forEach(e => (bs[e.sym] ||= []).push(e)); for (const s in bs) { const st = stat(bs[s].map(e => e.r[1])); res.syms[s] = { n: bs[s].length, win60: st.win, mean60: st.mean }; }
    return res;
  };

  /* ── 매매 시뮬레이션(다음 거래일 종가 체결) ── */
  E.simulate = function (F, sc, lens, thr, cfg) {
    cfg = Object.assign({ tr: [20, 30, 50], tp: [30, 60, 100], base: .5, trim: true }, cfg || {});
    const n = F.n, c = F.c; let cash = 100 * (1 - cfg.base), sh = 100 * cfg.base / c[START], cost = 100 * cfg.base, last = -99, trades = 0;
    const used = new Set(), tpDone = new Set(), eq = [], ex = []; let pend = null;
    for (let i = START; i < n; i++) {
      if (pend) { if (pend.sell > 0 && sh > 0) { const q = Math.min(pend.sell, sh); cost *= (sh - q) / sh; sh -= q; cash += q * c[i]; trades++; } if (pend.buy > 0 && cash > .5) { const a = Math.min(pend.buy, cash); sh += a / c[i]; cost += a; cash -= a; trades++; } pend = null; }
      const v = cash + sh * c[i]; eq.push(v); ex.push(v ? sh * c[i] / v : 0);
      const s = sc[i]; if (s < 20) { used.clear(); tpDone.clear(); }
      const over = E.overheated(F, i), { k } = E.kOf(lens, s, thr, F, i), avg = sh ? cost / sh : 0, gain = sh && avg ? c[i] / avg - 1 : 0; let p = { buy: 0, sell: 0 };
      if (over) { if (cfg.trim && sh > 0 && gain > 0 && i - last >= 20) { p.sell = sh / 3; last = i; } }
      else if (k > 0 && !used.has(k)) { p.buy = cash * cfg.tr[k - 1] / 100; for (let q = 1; q <= k; q++) used.add(q); }
      if (cfg.trim) cfg.tp.forEach((t, j) => { if (!tpDone.has(j) && gain >= t / 100 && sh > 0) { tpDone.add(j); if (!p.sell) p.sell = sh / 3; } });
      if (p.buy > 0 || p.sell > 0) pend = p;
    }
    const yrs = (n - START) / 252, st = arr => { let pk = arr[0], mdd = 0; for (const x of arr) { pk = Math.max(pk, x); mdd = Math.min(mdd, x / pk - 1); } const tot = arr[arr.length - 1] / arr[0] - 1, cagr = Math.pow(1 + tot, 1 / yrs) - 1; return { tot, cagr, mdd, calmar: mdd ? cagr / Math.abs(mdd) : 0 }; };
    const bh = [], st50 = []; for (let i = START; i < n; i++) { bh.push(100 * c[i] / c[START]); st50.push(100 * (1 - cfg.base) + 100 * cfg.base * c[i] / c[START]); }
    return { strat: st(eq), bh: st(bh), stat: st(st50), exposure: mean(ex), trades, years: yrs, eqEnd: eq[eq.length - 1] };
  };

  /* ── 신호별 효과(60일 후 기초지수 환산 수익률: 켜짐 vs 꺼짐) ── */
  E.signalEdge = function (P, lensKey, maxDate) {
    const L = E.LENS[lensKey]; const out = {}; const ids = Object.keys(L.buy).concat(Object.keys(L.pen)).filter(x => !x.startsWith('man_') && x !== 'val' && x !== 'pval');
    for (const id of ids) {
      const on = [], off = [];
      for (const sym in P) { const F = P[sym], a = F.S[id], f = F.fwd[60]; for (let i = START; i < F.n - 62; i += 3) { if (maxDate && F.d[i] >= maxDate) break; const v = f[i]; if (!isFinite(v)) continue; const r = v / F.lev; (a[i] >= .5 ? on : off).push(r); } }
      const mo = mean(on), mf = mean(off), sd = Math.sqrt(mean(on.concat(off).map(x => x * x)) - Math.pow(mean(on.concat(off)), 2)) || .1;
      out[id] = { nOn: on.length, nOff: off.length, meanOn: mo, meanOff: mf, winOn: on.filter(x => x > 0).length / (on.length || 1), winOff: off.filter(x => x > 0).length / (off.length || 1), edge: mo - mf, z: on.length > 10 ? (mo - mf) / (sd / Math.sqrt(on.length / 4)) : 0 };
    }
    return out;
  };

  /* ── 자동 보정(워크포워드): 앞 70%로 학습 → 뒤 30%로 검증 → 개선될 때만 채택 ── */
  function J(events, hIdx) { const s = stat(events.map(e => e.r[hIdx])); return { n: s.n, j: s.n ? s.lb + .25 * clamp(isFinite(s.med) ? s.med : 0, -.2, .2) : -1, win: s.win, lb: s.lb }; }
  function evAll(P, scs, lens, thr, filt) { let ev = []; for (const sym in P) ev = ev.concat(E.events(P[sym], scs[sym][lens], lens, thr, {})); return filt ? ev.filter(filt) : ev; }
  E.splitDate = function (P, frac) { const all = []; for (const s in P) for (let i = START; i < P[s].n; i++) all.push(P[s].d[i]); all.sort(); return all[Math.floor(all.length * (frac || .7))]; };
  E.calibrate = function (P, base, splitDate, progress) {
    const res = { splitDate, lens: {} }; const fin = E.DEFAULTS(); fin.thr = JSON.parse(JSON.stringify(base.thr)); fin.m = JSON.parse(JSON.stringify(base.m));
    const mkScs = params => { const o = {}; for (const s in P) o[s] = E.scores(P[s], params); return o; };
    const tuneLens = (lens, params, maxDate) => {
      // 1) 신호 가중치 조정(학습 구간 데이터만)
      const edge = lens === 'C' ? {} : E.signalEdge(P, lens, maxDate), m = {};
      for (const id in edge) { const e = edge[id]; if (e.nOn < 40) continue; const isPen = !!E.LENS[lens].pen[id]; const t = Math.tanh((isPen ? -e.z : e.z) / 3); m[id] = +(1 + .6 * t).toFixed(3); }   // 0.4~1.6배(효과 없는 신호는 크게 낮추고 강한 신호는 높임, 과적합 방지 상·하한)
      return { edge, m };
    };
    // 학습: 분할일 이전만 사용해 가중치·임계값 적합
    const trainParams = JSON.parse(JSON.stringify(base));
    const tp = {}; for (const L of ['P', 'D']) { tp[L] = tuneLens(L, trainParams, splitDate); trainParams.m[L] = tp[L].m; }
    let scsTrain = mkScs(trainParams);
    const fitThr = (lens, params, scs, maxDate) => {
      const dflt = base.thr[lens], before = d => d < maxDate; let best = { t: dflt[0], j: -9 };
      for (let t = 30; t <= 65; t += 5) { const ev = evAll(P, scs, lens, [t, 999, 999], e => before(e.date) && e.k === 1); const r = J(ev, 1); if (r.n >= 25 && r.j > best.j) best = { t, j: r.j }; }
      const t1 = best.t; let b2 = { t: Math.max(dflt[1], t1 + 5), j: -9 };
      for (let t = t1 + 5; t <= t1 + 30; t += 5) { const ev = evAll(P, scs, lens, [t1, t, 999], e => before(e.date) && e.k === 2); const r = J(ev, 1); if (r.n >= 12 && r.j > b2.j) b2 = { t, j: r.j }; }
      let b3 = { t: Math.max(dflt[2], b2.t + 5), j: -9 };
      for (let t = b2.t + 5; t <= b2.t + 30; t += 5) { const ev = evAll(P, scs, lens, [t1, b2.t, t], e => before(e.date) && e.k === 3); const r = J(ev, 1); if (r.n >= 8 && r.j > b3.j) b3 = { t, j: r.j }; }
      return [t1, b2.t, b3.t];
    };
    const far = '9999-12-31'; progress && progress(.3);
    const fitted = { P: fitThr('P', trainParams, scsTrain, splitDate), D: fitThr('D', trainParams, scsTrain, splitDate) }; progress && progress(.55);
    // 통합 임계값은 P·D 확정 임계값으로 점수를 다시 계산한 뒤 맞춤
    const trainP2 = JSON.parse(JSON.stringify(trainParams)); trainP2.thr.P = fitted.P; trainP2.thr.D = fitted.D;
    scsTrain = mkScs(trainP2); fitted.C = fitThr('C', trainP2, scsTrain, splitDate); trainP2.thr.C = fitted.C; progress && progress(.7);
    // 검증: 분할일 이후(학습에 쓰지 않은 구간)에서 기본값 vs 보정값 비교
    const scsDef = mkScs(base), scsTun = mkScs(trainP2), after = e => e.date >= splitDate;
    for (const L of ['P', 'D', 'C']) {
      const d = J(evAll(P, scsDef, L, base.thr[L], after), 1), t = J(evAll(P, scsTun, L, trainP2.thr[L], after), 1);
      const adopt = t.n >= 10 && t.j >= d.j - .005 && (t.j > d.j + .005 || t.n >= d.n * .6);
      res.lens[L] = { default: d, tuned: t, adopt, thr: trainP2.thr[L], m: L === 'C' ? {} : trainParams.m[L], edge: tp[L] ? tp[L].edge : {} };
    }
    // 채택된 관점만 '전체 데이터'로 재적합하되 기본값 쪽으로 50% 축소(안정성)
    const fullParams = JSON.parse(JSON.stringify(base));
    for (const L of ['P', 'D']) if (res.lens[L].adopt) { const t = tuneLens(L, fullParams, far); fullParams.m[L] = t.m; res.lens[L].edge = t.edge; }
    let scsFull = mkScs(fullParams);
    for (const L of ['P', 'D']) if (res.lens[L].adopt) { const f = fitThr(L, fullParams, scsFull, far); fullParams.thr[L] = f.map((x, k) => Math.round((x + base.thr[L][k]) / 2 / 5) * 5); }
    scsFull = mkScs(fullParams);
    if (res.lens.C.adopt) { const f = fitThr('C', fullParams, scsFull, far); fullParams.thr.C = f.map((x, k) => Math.round((x + base.thr.C[k]) / 2 / 5) * 5); }
    progress && progress(.9);
    res.params = fullParams; res.trainParams = trainP2; return res;
  };

  /* ── 라이브 판단(마지막 봉) ── */
  E.live = function (F, params) {
    const i = F.n - 1, sc = E.scores(F, params), out = { sym: F.sym, i, price: F.c[i], date: F.d[i], lev: F.lev, lens: {} };
    for (const L of ['P', 'D', 'C']) { const s = sc[L][i], { k, note } = E.kOf(L, s, params.thr[L], F, i); out.lens[L] = { score: Math.round(s), k, note, over: E.overheated(F, i) }; }
    out.over = E.overheated(F, i); out.sc = sc; return out;
  };
  E.explain = function (F, lensKey, params) {
    const i = F.n - 1, B = F.B, f = (v, d) => isFinite(v) ? v.toFixed(d == null ? 1 : d) : '–', pc = v => isFinite(v) ? (v > 0 ? '+' : '') + (v * 100).toFixed(1) + '%' : '–';
    const det = {
      dd: `52주 고점 대비 ${pc(B.dd[i])}` + (F.lev > 1 ? ` (기초지수 환산 ${pc(B.dd[i] / F.lev)})` : ''), ma200: `200일선 대비 ${pc(B.dev200[i])}`, rsiW: `주봉 RSI ${f(B.rW[i])}`, rsiD: `일봉 RSI ${f(B.rD[i])}`,
      macd: '최근 10거래일 내 골든크로스', ma200w: isFinite(B.ma200w[i]) ? `200주선 ${f(B.ma200w[i], 2)}` : '데이터 부족', brk: '15일 고점 상향 돌파', vix: `VIX ${f(B.vix[i])}`, fear: `자체 공포지수 ${f(B.fear[i], 0)}/100`, breadth: `섹터 중 -10%↓ ${isFinite(B.breadth[i]) ? (B.breadth[i] * 100).toFixed(0) + '%' : '–'}`, inv: `VIX/VIX3M ${f(B.inv[i], 2)}`,
      season: '중간선거 해 4분기 ~ 이듬해 상반기', sup: '200일선 상승 중 & -5%~+3% 구간', trend: '가격이 200일선 위 · 200일선 상승 중', val: isFinite(B.fair[i]) ? `적정가 ${f(B.fair[i], 2)} · 현재가/적정가 ${(F.c[i] / B.fair[i] * 100).toFixed(0)}%` : '적정가 없음(자동/수동 입력)',
      over: `주봉 RSI ${f(B.rW[i])}`, hi: `고점 대비 ${pc(B.dd[i])}`, ext: `200일선 이격 ${pc(B.dev200[i])}`, weak: '시장 대비 60일 -25%p 이하 & 고점 -35%↓', pval: '현재가가 적정가의 120%↑', man_res: '종목 화면에서 수동 체크', man_bad: '종목 화면에서 수동 체크'
    };
    const L = E.LENS[lensKey === 'C' ? 'P' : lensKey], m = params.m[lensKey === 'C' ? 'P' : lensKey] || {}, rows = [];
    for (const [grp, type] of [['buy', 'buy'], ['pen', 'warn']]) for (const id in L[grp]) {
      const s = F.S[id][i]; if (id === 'val' && s < 0) { rows.push({ id, label: E.LABEL[id], max: L[grp][id], pts: 0, on: false, detail: det[id], type, na: true }); continue; }
      const max = Math.round(L[grp][id] * (m[id] || 1)); rows.push({ id, label: E.LABEL[id], max, pts: Math.round(max * s) * (type === 'warn' ? -1 : 1), on: s > 0, strength: s, detail: det[id], type });
    }
    return rows;
  };

  E.prepAll = function (px, watch, mk, opts) {
    opts = opts || {}; const P = {}; const qd = px.QQQ ? (() => { const m = new Map(px.QQQ.d.map((d, i) => [d, i])); return { byDate: (d, h) => { const j = m.get(d); return j != null && j >= h ? px.QQQ.c[j] / px.QQQ.c[j - h] - 1 : null; } }; })() : null;
    for (const w of watch) { const s = px[w.sym]; if (!s) continue; const F = E.features(w, s, mk, { qqq: qd, fearV: opts.fearV || 1 }); if (F) P[w.sym] = F; }
    return P;
  };
  root.Engine = E;
})(typeof self !== 'undefined' ? self : this);
