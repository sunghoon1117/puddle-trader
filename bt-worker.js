/* 백그라운드 검증·자동 보정 (UI가 멈추지 않도록 Web Worker에서 실행) */
importScripts('engine.js');
const E = self.Engine;
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const med = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
self.onmessage = ev => {
  try {
    const { px, watch } = ev.data, prog = (p, t) => self.postMessage({ type: 'progress', p, t });
    prog(.02, '시장 지표 계산');
    const mk = E.buildMarket(px); if (!mk) throw new Error('SPY 데이터가 필요합니다');
    const P1 = E.prepAll(px, watch, mk, { fearV: 1 }), P2 = E.prepAll(px, watch, mk, { fearV: 2 }), syms = Object.keys(P1);
    if (!syms.length) throw new Error('검증할 종목 데이터가 없습니다');
    const base = E.DEFAULTS(), split = E.splitDate(P1, .7);
    // 공포지수 두 버전(v1 단순 4요소 / v2 CNN식 6요소) 중 학습 구간에서 효과(z)가 더 큰 쪽을 자동 선택
    const e1 = E.signalEdge(P1, 'P', split).fear, e2 = E.signalEdge(P2, 'P', split).fear;
    base.fearV = (e2.z > 0 && e2.z > e1.z * 1.1) ? 2 : 1; const P = base.fearV === 2 ? P2 : P1;
    prog(.1, '신호 계산 완료 · 자동 보정 시작');
    const cal = E.calibrate(P, base, split, p => prog(.1 + p * .6, '자동 보정(워크포워드)'));
    const fin = cal.params, out = { ver: E.VERSION, asof: new Date().toISOString(), split, symbols: syms, years: {}, lens: {}, cal: { split, lens: {} }, params: fin, base };
    syms.forEach(s => out.years[s] = { from: P[s].d[E.START], to: P[s].d[P[s].n - 1] });
    const scsF = {}, scsD = {}, scsT = {};
    for (const s of syms) { scsF[s] = E.scores(P[s], fin); scsD[s] = E.scores(P[s], base); scsT[s] = E.scores(P[s], cal.trainParams); }
    const evs = (scs, params, L, filt) => { let ev = []; for (const s of syms) ev = ev.concat(E.events(P[s], scs[s][L], L, params.thr[L], {})); return filt ? ev.filter(filt) : ev; };
    // 매도 규칙(과열 익절·수익률 익절)이 실제로 도움이 되는지 두 방식 비교 → 더 나은 쪽을 채택
    const avgCalmar = trim => { const v = []; for (const L of ['P', 'D', 'C']) for (const s of syms) v.push(E.simulate(P[s], scsF[s][L], L, fin.thr[L], { trim }).strat.calmar); return mean(v); };
    const cT = avgCalmar(true), cN = avgCalmar(false); fin.trim = !(cN > cT * 1.05); fin.trimReport = { withTrim: cT, noTrim: cN };
    const after = e => e.date >= split;
    let step = 0;
    for (const L of ['P', 'D', 'C']) {
      prog(.72 + .06 * step++, `${E.LENS[L].name} 관점 성과 집계`);
      const c = cal.lens[L], adopted = c.adopt;
      const oosParams = adopted ? cal.trainParams : base, oosScs = adopted ? scsT : scsD;
      const r = {
        adopted, thr: fin.thr[L], defThr: base.thr[L],
        all: E.summarize(evs(scsF, fin, L), P),                      // 최종 파라미터, 전체 기간(참고용 — 보정에 쓰인 구간 포함)
        defAll: E.summarize(evs(scsD, base, L), P),                  // 기본 파라미터, 전체 기간
        oos: E.summarize(evs(oosScs, oosParams, L, after), P),       // 표본 외(분할일 이후, 학습에 미사용)
        oosDefault: E.summarize(evs(scsD, base, L, after), P),
        calib: { default: c.default, tuned: c.tuned }, edge: c.edge
      };
      // 종목별 시뮬레이션
      const sims = {}; for (const s of syms) sims[s] = E.simulate(P[s], scsF[s][L], L, fin.thr[L], { trim: fin.trim });
      const arr = Object.values(sims), pick = f => arr.map(f);
      r.sim = {
        per: Object.fromEntries(Object.entries(sims).map(([s, x]) => [s, { cagr: x.strat.cagr, mdd: x.strat.mdd, bhCagr: x.bh.cagr, bhMdd: x.bh.mdd, stCagr: x.stat.cagr, stMdd: x.stat.mdd, exp: x.exposure, tr: x.trades, tot: x.strat.tot, bhTot: x.bh.tot, calmar: x.strat.calmar, bhCalmar: x.bh.calmar, stCalmar: x.stat.calmar }])),
        n: arr.length, beatCalmarBH: pick((x, i) => x.strat.calmar > x.bh.calmar).filter(Boolean).length, beatCalmarStatic: arr.filter(x => x.strat.calmar > x.stat.calmar).length,
        avg: { cagr: mean(pick(x => x.strat.cagr)), mdd: mean(pick(x => x.strat.mdd)), bhCagr: mean(pick(x => x.bh.cagr)), bhMdd: mean(pick(x => x.bh.mdd)), stCagr: mean(pick(x => x.stat.cagr)), stMdd: mean(pick(x => x.stat.mdd)), exp: mean(pick(x => x.exposure)) }
      };
      out.lens[L] = r;
      out.cal.lens[L] = { adopt: c.adopt, default: c.default, tuned: c.tuned };
    }
    // 강건성 점검: 보정 없이 '기본 파라미터'를 지수·섹터 ETF 13개(1999~, 닷컴·2008 포함, 생존편향 적음)에 적용
    prog(.93, '중립 유니버스 점검');
    const nw = ['SPY', 'QQQ'].concat(E.SECT).filter(s => px[s]).map(s => ({ sym: s, lev: 1, type: 'etf' })), PN = E.prepAll(px, nw, mk, { fearV: base.fearV });
    out.neutral = { n: Object.keys(PN).length, from: Math.min(...Object.values(PN).map(F => +F.d[E.START].slice(0, 4))), lens: {} };
    out.fearReport = { z1: e1.z, z2: e2.z, on1: e1.meanOn, on2: e2.meanOn, chosen: base.fearV };
    for (const L of ['P', 'D', 'C']) {
      let ev = []; for (const s in PN) ev = ev.concat(E.events(PN[s], E.scores(PN[s], base)[L], L, base.thr[L], {}));
      const sm = E.summarize(ev, PN); out.neutral.lens[L] = { n: sm.n, h: sm.h, byK: sm.byK, mae: sm.mae };
    }
    // 점수 신뢰도 곡선: 점수대별로 과거 60일 뒤 올랐던 비율(과열일 제외). 점수가 실제로 확률과 연결되는지 검증
    prog(.96, '점수 신뢰도 곡선');
    const B = [[0, 20], [20, 40], [40, 55], [55, 70], [70, 101]], scsN = {}; for (const s in PN) scsN[s] = E.scores(PN[s], base);
    const curveOf = (Pset, scs, L) => {
      const o = B.map(([a, b]) => ({ lo: a, hi: b, n: 0, w: 0, m: 0 })); let bn = 0, bw = 0;
      for (const s in Pset) { const F = Pset[s], sc = scs[s][L], f = F.fwd[60]; for (let i = E.START; i < F.n - 62; i++) { const v = f[i]; if (!isFinite(v) || E.overheated(F, i)) continue; bn++; if (v > 0) bw++; const x = sc[i], k = B.findIndex(([a, b]) => x >= a && x < b); if (k < 0) continue; o[k].n++; if (v > 0) o[k].w++; o[k].m += v; } }
      return { rows: o.map(q => ({ lo: q.lo, hi: q.hi, n: q.n, win: q.n ? q.w / q.n : null, mean: q.n ? q.m / q.n : null })), base: bn ? bw / bn : null };
    };
    out.curve = { watch: {}, neutral: {} };
    for (const L of ['P', 'D', 'C']) { out.curve.watch[L] = curveOf(P, scsF, L); out.curve.neutral[L] = curveOf(PN, scsN, L); }
    // 시장 국면 과거 검증: 약 월 1회(21거래일), 그 시점까지의 데이터만으로 국면을 계산 → 이후 S&P500(SPY) 3개월 수익률 비교
    prog(.98, '시장 국면 과거 검증');
    try {
      const spy = px.SPY, cut = (a, date) => { if (!a) return null; let lo = 0, hi = a.d.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (a.d[m] <= date) { r = m; lo = m + 1; } else hi = m - 1; } return r < 0 ? null : { d: a.d.slice(0, r + 1), c: a.c.slice(0, r + 1) }; };
      const startIdx = spy.d.findIndex(d => d >= '2008-06-01'), by = {}, byG = {}; let bn = 0, bw = 0, bm = 0;
      for (let i = Math.max(startIdx, 300); i + 64 < spy.d.length; i += 21) {
        const date = spy.d[i], tp = {}; for (const s in px) { const c = cut(px[s], date); if (c) tp[s] = c; }
        const R = E.regime(tp, null, false); if (!R) continue; const f = spy.c[i + 64] / spy.c[i + 1] - 1; bn++; if (f > 0) bw++; bm += f;
        for (const [m, key] of [[by, R.regions.us.phase], [byG, R.regions.global.phase]]) { const q = m[key] ||= { n: 0, w: 0, s: 0 }; q.n++; if (f > 0) q.w++; q.s += f; }
      }
      const fmt = m => Object.fromEntries(Object.entries(m).map(([k, q]) => [k, { n: q.n, win: q.w / q.n, mean: q.s / q.n }]));
      out.regimeBt = { n: bn, from: spy.d[Math.max(startIdx, 300)], base: { win: bw / bn, mean: bm / bn }, us: fmt(by), global: fmt(byG) };
    } catch (e) { out.regimeBt = null; }
    out.edgeP = out.lens.P.edge; out.edgeD = out.lens.D.edge;
    self.postMessage({ type: 'done', result: out });
  } catch (e) { self.postMessage({ type: 'error', msg: String(e && e.message || e) }); }
};
