'use strict';
/* 디벨롭 — 상세 보기(모든 지표 클릭) · 3관점 비교 · 투자지표(PER 등) · 종목 검색
   app.js 보다 먼저 로드되며, app.js 의 전역(S, PX, MK, MAC, CNN, FUND, E, F, esc, pill …)은 호출 시점에 참조한다. */

/* ───────── 지표 설명 ───────── */
const DT_DESC = {
  '^VIX': ['VIX(변동성 지수)', 'S&P500 옵션 가격으로 계산한 "앞으로 30일 시장이 얼마나 흔들릴 것으로 보는가"입니다. 보통 15 이하는 안정, 20~25는 경계, 30 이상은 공포 구간입니다. 변동성 지표일 뿐 바닥·천장을 알려 주지 않습니다.', '지수'],
  '^VIX3M': ['VIX 3개월물', '3개월 뒤까지의 기대 변동성입니다. VIX(단기)가 이 값보다 높아지면(비율 1 이상) 단기 패닉 — "기간구조 역전" 신호입니다.', '지수'],
  '^TNX': ['미 10년물 국채금리', '장기 금리의 기준입니다. 급등하면 성장주·레버리지 ETF의 밸류에이션 부담이 커지고, 하락하면 유동성에 우호적입니다.', '%'],
  '^FVX': ['미 5년물 국채금리', '정책금리 기대(향후 몇 년 평균 금리)를 반영합니다.', '%'],
  '^IRX': ['미 3개월물 국채금리', '현재 정책금리에 가장 가까운 금리입니다. 10년물과의 차이(장단기 금리차)가 마이너스면 침체 신호로 봅니다.', '%'],
  'DX-Y.NYB': ['달러인덱스(DXY)', '주요 통화 대비 달러 가치. 달러 강세는 글로벌 유동성·신흥국·원화에 부담, 약세는 우호적입니다.', '지수'],
  'KRW=X': ['원/달러 환율', '오르면 원화 약세 — 외국인 자금 유출 압력, 한국 수입물가 부담. 내리면 원화 강세.', '원'],
  '^KS11': ['KOSPI', '한국 대형주 지수입니다.', '지수'], '^KQ11': ['KOSDAQ', '한국 중소형·기술주 지수입니다.', '지수'],
  'SPY': ['S&P500 (SPY ETF)', '미국 대형주 500개. 지수 값이 아니라 ETF 가격입니다.', '$'], 'QQQ': ['나스닥100 (QQQ ETF)', '미국 대형 기술주 중심. 이 앱 점수의 시장 기준입니다.', '$'],
  'IWM': ['러셀2000 (IWM ETF)', '미국 소형주. SPY보다 강하면 경기 낙관 신호로 봅니다.', '$'], '^SOX': ['필라델피아 반도체지수(SOX)', '반도체 사이클 지표. 한국 수출·이익과 연관이 큽니다.', '지수'],
  'CL=F': ['WTI 원유', '유가 급등은 물가·스태그플레이션 위험, 급락은 수요 둔화 신호일 수 있습니다.', '$'], 'GC=F': ['금', '안전자산 수요·실질금리와 반대로 움직이는 경향이 있습니다.', '$'], 'HG=F': ['구리', '산업 수요(경기) 선행 지표로 쓰입니다. 구리/금 비율이 오르면 경기 낙관.', '$'],
  fear: ['자체 공포지수', '이 앱이 가격만으로 계산한 공포 정도(0=탐욕, 100=공포)입니다. VIX 1년 백분위·고점 대비 낙폭·RSI·125일선 이격의 평균이며, 과거 검증에 쓰인 값입니다(CNN 지수는 이력이 1년뿐).', '점'],
  vixts: ['VIX 기간구조 (VIX ÷ VIX3M)', '1 이상이면 단기 변동성이 장기보다 높은 "역전" — 패닉 구간. 0.85 이하면 매우 안정.', '비'],
  breadth: ['섹터 -10%↓ 비율', '11개 섹터 ETF 중 52주 고점 대비 -10% 이상 빠진 섹터의 비율입니다. 높으면 시장 전반의 약세(조정 폭이 넓음)입니다.', '%'],
  qdd: ['QQQ 52주 고점 대비', '나스닥100이 최근 1년 고점에서 얼마나 내려와 있는지입니다. 깊을수록 "많이 빠진" 상태입니다.', '%'],
  cnn: ['CNN 공포탐욕 지수', '0=극단적 공포, 100=극단적 탐욕. CNN이 7개 요소(모멘텀·주가강도·주가폭·풋콜·VIX·정크본드·안전자산)를 합성해 매일 계산합니다. 브라우저가 직접 읽어 옵니다.', '점']
};
const MAC_DESC = {
  T3M: ['미 3개월물 금리(재무부)', '현재 정책금리에 가까운 단기 금리.', '%'], T2Y: ['미 2년물 금리(재무부)', '향후 2년 정책금리 기대. 급락하면 금리 인하 기대 확대.', '%'], T5Y: ['미 5년물 금리(재무부)', '', '%'], T10Y: ['미 10년물 금리(재무부)', '', '%'], T30Y: ['미 30년물 금리(재무부)', '', '%'],
  BAMLH0A0HYM2: ['하이일드 스프레드 OAS(FRED)', '위험한 회사채가 국채보다 얼마나 더 이자를 주는지. 낮으면(3~4%) 신용 안정, 급등하면 금융 스트레스입니다.', '%'],
  DFII10: ['10년 실질금리(FRED)', '물가를 뺀 장기 금리. 오르면 성장주·금에 부담입니다.', '%'], NFCI: ['시카고연은 금융여건지수 NFCI(FRED)', '0보다 낮으면 평균보다 금융여건이 느슨(완화), 높으면 긴축입니다.', ''],
  WALCL: ['연준 대차대조표(FRED)', '연준이 보유한 자산 총액(백만 달러). 늘면 유동성 공급, 줄면 회수(QT)입니다.', ''], ICSA: ['신규 실업수당 청구(FRED)', '주간 신규 청구 건수. 지속 증가하면 고용 악화 신호입니다.', '건'], UNRATE: ['실업률(FRED)', '월간. 3개월간 0.3%p 이상 오르면 침체 경고로 봅니다(샴의 법칙 유사).', '%']
};
const LOOKS = [['전일', 1], ['1주', 7], ['1개월', 30], ['3개월', 91], ['6개월', 182], ['1년', 365], ['3년', 1095]];
let DT = { key: null, rng: '1Y', hover: null }, DT_CUR = null;

/* ───────── 시리즈 만들기 ───────── */
function dtSeries(key) {
  const [k, a, b] = key.split(':');
  const mk = (title, d, v, o) => ({ title, d, v, desc: '', unit: '', mode: 'pct', dec: 2, ...o });
  if (k === 'px') { const s = PX[a]; if (!s || s.c.length < 5) return null; const meta = DT_DESC[a] || [(MKT_ROWS.find(r => r[1] === a) || [a])[0], '', ''], y = ['^TNX', '^FVX', '^IRX'].includes(a); return mk(meta[0], s.d, s.c, { desc: meta[1], unit: meta[2], mode: y ? 'abs' : 'pct', dec: s.c.at(-1) >= 1000 ? 0 : 2, src: 'Yahoo Finance(지연·잠정 가능)' }); }
  if (k === 'mac') { const s = MAC && MAC.series && MAC.series[a]; if (!s) return null; const m = MAC_DESC[a] || [a, '', '']; return mk(m[0], s.d, s.v, { desc: m[1], unit: m[2], mode: 'abs', src: '미 재무부·FRED 공식 자료(발표 지연 ' + (s.lag || 0) + '일)', dec: a === 'ICSA' || a === 'WALCL' ? 0 : 2 }); }
  if (k === 'wk') { const o = WK[a] && WK[a].raw; if (!o) return null; const m = WK_LIST.find(x => x[0] === a) || [a, a, '', 'h24'], idx = o.kind === 'idx'; return mk(m[1] + (idx ? ' · 최근 1개월(일봉)' : ' · 1시간봉(한국시간)'), o.t.map(x => new Date(x + 9 * 36e5).toISOString().slice(0, idx ? 10 : 16)), o.c, { desc: m[2] + (idx ? '. 최근 1개월 일봉 종가입니다.' : '. 최근 5일 1시간 간격 시세입니다.') + ' 참고 정보이며 매수 점수에는 반영되지 않습니다.', unit: idx ? '' : '$', mode: 'pct', dec: o.c.at(-1) >= 1000 ? 0 : 2, src: 'Yahoo Finance(지연·잠정 가능)' }); }
  if (k === 'dd') { const s = PX[a]; if (!s || s.c.length < 30) return null; let m = -Infinity; const d = [], v = []; for (let i = 0; i < s.c.length; i++) { if (!(isFinite(s.c[i]) && s.c[i] > 0)) continue; m = Math.max(m, s.c[i]); d.push(s.d[i]); v.push((s.c[i] / m - 1) * 100); } const w = S.watch.find(x => x.sym === a); return mk((w ? dispName(w) : a) + ' · 전고점 대비 하락률', d, v, { desc: '그 시점까지의 최고가(전고점)보다 얼마나 내려와 있었는지입니다. 0%면 신고가이고, 깊을수록 많이 빠진 상태입니다.', unit: '%', mode: 'abs', dec: 1, src: 'Yahoo Finance 일봉(수정주가 기준 아님·분할 반영)' }); }
  if (k === 'per') {   // 일별 PER 추이: 종가 ÷ (발표 지연 45일을 반영한 최근 12개월 EPS)
    const raw = valRaw(a), eps = raw && raw.t && raw.t.DilutedEPS, s = PX[a], vc = valCalc(a); if (!eps || eps.length < 3 || !s || vc.curMismatch) return dtSeries('val:' + a + ':PeRatio');
    const ev = eps.map(x => [Date.parse(x[0]) + 45 * 864e5, x[1]]).sort((p, q) => p[0] - q[0]), d = [], v = []; let j = -1;
    for (let i = 0; i < s.d.length; i++) { const t = Date.parse(s.d[i]); while (j + 1 < ev.length && ev[j + 1][0] <= t) j++; if (j >= 0 && ev[j][1] > 0) { const p = s.c[i] / ev[j][1]; if (p > 0 && p < 500) { d.push(s.d[i]); v.push(p); } } }
    if (v.length < 20) return dtSeries('val:' + a + ':PeRatio'); const nm = VAL_NAMES.PeRatio;
    return mk(nm[0] + ' · ' + a + ' (일별)', d, v, { desc: nm[1] + ' 매일의 종가를 최근 12개월 EPS(분기말+45일 뒤부터 반영 — 발표 지연)로 나눈 값입니다. 적자 구간은 건너뜁니다. 종목 화면의 현재 PER 은 가장 최근 분기 EPS 를 바로 쓰므로 몇 % 다를 수 있습니다.', unit: '배', mode: 'pct', dec: 1, src: '야후 EPS 시계열 + 일봉(앱 계산)' });
  }
  if (k === 'va') {   // 연간 재무 추이(ROE·이익률·성장률·부채비율·금액)
    const raw = valRaw(a), A = raw && raw.a; if (!A) return null; const g = (n, y) => (A[n] && A[n][y] != null ? A[n][y] : null), yrs = [...new Set(Object.values(A).flatMap(o => Object.keys(o)))].sort();
    const ratio = (n, m) => y => { const x = g(n, y), z = g(m, y); return x != null && z > 0 ? x / z * 100 : null; }, grow = n => y => { const x = g(n, y), z = g(n, String(+y - 1)); return x != null && z > 0 ? (x / z - 1) * 100 : null; }, amt = n => y => { const x = g(n, y); return x != null ? x / 1e9 : null; };
    const D = { ROE: ['ROE(순이익÷자기자본)', '%', ratio('NetIncome', 'StockholdersEquity'), '자기자본으로 얼마나 벌었는지. 15% 이상이면 높은 편으로 봅니다.'], OPM: ['영업이익률', '%', ratio('OperatingIncome', 'TotalRevenue'), '매출에서 영업이익이 차지하는 비율.'], NPM: ['순이익률', '%', ratio('NetIncome', 'TotalRevenue'), '매출에서 순이익이 차지하는 비율.'], DE: ['부채÷자기자본', '%', ratio('TotalDebt', 'StockholdersEquity'), '100% 이하면 낮은 편, 200% 이상이면 높은 편으로 봅니다.'], REVG: ['매출 증가율(전년 대비)', '%', grow('TotalRevenue'), '바로 직전 연도가 있을 때만 계산합니다.'], NIG: ['순이익 증가율(전년 대비)', '%', grow('NetIncome'), '이전 순이익이 0 이하이면 계산하지 않습니다.'], REV: ['매출(십억 단위)', '', amt('TotalRevenue'), '재무제표 통화 기준입니다.'], NI: ['순이익(십억 단위)', '', amt('NetIncome'), '재무제표 통화 기준입니다.'], FCF: ['잉여현금흐름(십억 단위)', '', amt('FreeCashFlow'), '영업현금흐름에서 설비투자를 뺀 현금입니다.'], OCF: ['영업현금흐름(십억 단위)', '', amt('OperatingCashFlow'), '적정가 계산의 출발점입니다.'] };
    const def = D[b]; if (!def) return null; const d = [], v = []; yrs.forEach(y => { const x = def[2](y); if (x != null && isFinite(x)) { d.push(y); v.push(x); } }); if (v.length < 2) return null;
    return mk(def[0] + ' · ' + a + ' (연간)', d, v, { desc: def[3] + ' 연간 결산 기준이라 점이 몇 개뿐입니다.', unit: def[1], mode: def[1] === '%' ? 'abs' : 'pct', dec: 1, src: '야후 재무 시계열(연간)' });
  }
  if (k === 'sv') { const d0 = POS[posFile(a)], r = (d0 && d0.shortVol || []).filter(x => x[2] > 0); if (r.length < 2) return null; return mk(a + ' · 일별 공매도 거래 비중', r.map(x => x[0]), r.map(x => x[1] / x[2] * 100), { desc: '하루 거래 중 공매도로 체결된 비율입니다(FINRA 장외 보고 기준). 시장조성자 거래도 포함되어 숏 포지션 규모와는 다릅니다.', unit: '%', mode: 'abs', dec: 1, src: 'FINRA 일별 공매도 거래량' }); }
  if (k === 'kr') { const d0 = POS[posFile(a)], r = d0 && d0.kr; if (!r || r.length < 2) return null; const i = { ind: 1, inst: 2, frgn: 3 }[b], nm = { ind: '개인', inst: '기관', frgn: '외국인' }[b]; if (!i) return null; let s = 0; return mk(a + ' · ' + nm + ' 누적 순매수(주)', r.map(x => x[0]), r.map(x => (s += x[i] || 0)), { desc: '수집 기간 첫날부터 더한 순매수 수량입니다. 올라가면 계속 사는 중, 내려가면 파는 중입니다.', unit: '', mode: 'abs', dec: 0, src: '네이버 금융' }); }
  if (k === 'cot') { const m = POS.cot && POS.cot.markets && POS.cot.markets[a]; if (!m) return null; const g = COT_GROUPS.find(x => x[0] === b); if (!g) return null; return mk(m.name + ' · ' + g[1] + ' 순포지션(롱−숏)', m.hist.map(x => x.d), m.hist.map(x => x[b][0] - x[b][1]), { desc: g[2] + '. 롱 계약에서 숏 계약을 뺀 값입니다(화요일 기준, 금요일 발표). 헤지 목적의 숏도 포함됩니다.', unit: '', mode: 'abs', dec: 0, src: 'CFTC TFF 주간 보고서' }); }
  if (!MK && ['fear', 'vixts', 'breadth', 'qdd'].includes(k)) return null;
  if (k === 'fear') { const ix = MK.d.map((_, i) => i).filter(i => MK.fear[i] != null); const m = DT_DESC.fear; return mk(m[0], ix.map(i => MK.d[i]), ix.map(i => MK.fear[i]), { desc: m[1], unit: m[2], mode: 'abs', dec: 0, src: '앱 자체 계산(가격 기반)', band: [[0, 25, '탐욕'], [25, 45, '탐욕 우세'], [45, 55, '중립'], [55, 75, '공포'], [75, 100, '극단적 공포']] }); }
  if (k === 'vixts') { const ix = MK.d.map((_, i) => i).filter(i => MK.vix[i] != null && MK.v3[i]); const m = DT_DESC.vixts; return mk(m[0], ix.map(i => MK.d[i]), ix.map(i => MK.vix[i] / MK.v3[i]), { desc: m[1], unit: '', mode: 'abs', dec: 2, src: 'Yahoo Finance' }); }
  if (k === 'breadth') { const ix = MK.d.map((_, i) => i).filter(i => MK.breadth[i] != null); const m = DT_DESC.breadth; return mk(m[0], ix.map(i => MK.d[i]), ix.map(i => MK.breadth[i] * 100), { desc: m[1], unit: '%', mode: 'abs', dec: 0, src: '앱 자체 계산(섹터 ETF 11개)' }); }
  if (k === 'qdd') { const q = PX.QQQ; if (!q || q.c.length < 260) return null; const dd = [], v = []; for (let i = 251; i < q.c.length; i++) { let mx = 0; for (let t = i - 251; t <= i; t++) if (q.c[t] > mx) mx = q.c[t]; if (!(mx > 0)) continue; dd.push(q.d[i]); v.push((q.c[i] / mx - 1) * 100); } const m = DT_DESC.qdd; return mk(m[0], dd, v, { desc: m[1], unit: '%', mode: 'abs', dec: 1, src: 'Yahoo Finance(QQQ)' }); }
  if (k === 'cnn') { if (!CNN || !CNN.hist || !CNN.hist.length) return null; const m = DT_DESC.cnn, byD = new Map(CNN.hist.map(p => [p.d, p.v])), ds = [...byD.keys()].sort(); return mk(m[0], ds, ds.map(x => byD.get(x)), { desc: m[1], unit: '점', mode: 'abs', dec: 0, src: 'CNN(브라우저가 직접 조회) · 공개 이력 약 1년', band: [[0, 25, '극단적 공포'], [25, 45, '공포'], [45, 55, '중립'], [55, 75, '탐욕'], [75, 100, '극단적 탐욕']], cnnx: true }); }
  if (k === 'val') { const raw = valRaw(a); const t = raw && raw.t && raw.t[b]; if (!t || t.length < 2) return null; const nm = VAL_NAMES[b] || [b, '']; return mk(nm[0] + ' · ' + a, t.map(x => x[0]), t.map(x => x[1]), { desc: nm[1], unit: '', mode: 'pct', dec: b === 'MarketCap' ? 0 : 2, src: '야후 재무 시계열(분기 단위 갱신)' }); }
  return null;
}
const dtFmt = (s, x) => x == null || !isFinite(x) ? '–' : (s.unit === '$' ? '$' : '') + Number(x).toLocaleString('en-US', { maximumFractionDigits: s.dec, minimumFractionDigits: Math.min(s.dec, 2) }) + (s.unit === '%' ? '%' : s.unit === '배' ? '배' : '');
const dtDiff = (s, a, b) => s.mode === 'abs' ? (s.unit === '%' ? (a - b >= 0 ? '+' : '') + (a - b).toFixed(2) + '%p' : (a - b >= 0 ? '+' : '') + (a - b).toFixed(s.dec > 1 ? 2 : Math.max(s.dec, 1))) : (b ? F.pct(a / b - 1) : '–');
const dtCls = (s, a, b) => s.mode === 'abs' ? '' : a - b > 0 ? 'pos' : a - b < 0 ? 'neg' : '';   // 금리·공포지수 등은 오름=좋음이 아니므로 색을 칠하지 않음
function dtAgo(s, days) { const cut = new Date(Date.parse(s.d.at(-1)) - days * 864e5).toISOString().slice(0, 10); for (let i = s.d.length - 1; i >= 0; i--) if (s.d[i] <= cut) return [s.d[i], s.v[i]]; return null; }

/* ───────── 차트 ───────── */
function dtDraw(cv, s, days) {
  const n = s.d.length, cut = days ? new Date(Date.parse(s.d.at(-1)) - days * 864e5).toISOString().slice(0, 10) : '0000'; let s0 = 0; while (s0 < n - 2 && s.d[s0] < cut) s0++;
  const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const cs = getComputedStyle(document.documentElement), col = v => cs.getPropertyValue(v).trim(); let lo = Infinity, hi = -Infinity; for (let i = s0; i < n; i++) { lo = Math.min(lo, s.v[i]); hi = Math.max(hi, s.v[i]); } if (hi === lo) { hi += 1; lo -= 1; } const pad = (hi - lo) * .06; lo -= pad; hi += pad;
  const pl = 6, pr = 52, pt = 8, pb = 18, X = i => pl + (i - s0) / Math.max(1, n - 1 - s0) * (W - pl - pr), Y = v => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);
  g.font = '11px system-ui'; g.fillStyle = col('--mut'); g.strokeStyle = col('--line'); g.lineWidth = 1;
  for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4, y = Y(v); g.beginPath(); g.moveTo(pl, y); g.lineTo(W - pr, y); g.stroke(); g.fillText(Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(Math.abs(v) < 10 ? 2 : 1), W - pr + 4, y + 4); }
  g.strokeStyle = col('--acc'); g.lineWidth = 1.8; g.beginPath(); let st = false; const step = Math.max(1, Math.floor((n - s0) / 900)); for (let i = s0; i < n; i += step) { const x = X(i), y = Y(s.v[i]); st ? g.lineTo(x, y) : (g.moveTo(x, y), st = true); } g.lineTo(X(n - 1), Y(s.v[n - 1])); g.stroke();
  g.fillStyle = col('--mut'); g.fillText(s.d[s0], pl, H - 4); g.textAlign = 'right'; g.fillText(s.d[n - 1], W - pr, H - 4); g.textAlign = 'left';
  g.fillStyle = col('--acc'); g.beginPath(); g.arc(X(n - 1), Y(s.v[n - 1]), 3.5, 0, 7); g.fill();
  if (DT.hover != null && DT.hover >= s0 && DT.hover < n) { const x = X(DT.hover); g.strokeStyle = col('--mut'); g.beginPath(); g.moveTo(x, pt); g.lineTo(x, H - pb); g.stroke(); g.beginPath(); g.arc(x, Y(s.v[DT.hover]), 3.5, 0, 7); g.fill(); }
  const mv = e => { const r = cv.getBoundingClientRect(), x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left; DT.hover = Math.min(n - 1, Math.max(s0, Math.round(s0 + (x - pl) / (W - pl - pr) * (n - 1 - s0)))); const i = DT.hover, el = document.getElementById('dtInfo'); if (el) el.textContent = `${s.d[i]} · ${dtFmt(s, s.v[i])}` + (i > 0 ? ` (전일비 ${dtDiff(s, s.v[i], s.v[i - 1])})` : ''); dtDraw(cv, s, days); };
  cv.onpointermove = mv; cv.onpointerdown = mv;
}
const DT_RNG = [['1개월', 30], ['3개월', 91], ['6개월', 182], ['1년', 365], ['3년', 1095], ['전체', 0]];

/* ───────── 상세 시트 ───────── */
function openDetail(key) {
  DT = { key, rng: '1년', hover: null };
  if (key.startsWith('cnnp:')) return openModal(dtCnnPart(key.slice(5)));
  const s = dtSeries(key); if (!s) return openModal(`<h2>상세 보기</h2><div class="empty">이 항목의 이력 데이터가 아직 없습니다.</div><button class="btn" data-close>닫기</button>`);
  DT_CUR = s; openModal(dtHTML(s)); dtAfter();
}
function dtRange() { const r = DT_RNG.find(x => x[0] === DT.rng); return r ? r[1] : 365; }
function dtAfter() { const cv = $('#dtCv'); if (cv && DT_CUR) dtDraw(cv, DT_CUR, dtRange()); }
function dtHTML(s) {
  const n = s.d.length, last = s.v[n - 1], prev = n > 1 ? s.v[n - 2] : null, y1 = dtAgo(s, 365), win = y1 ? s.v.slice(s.d.findIndex(d => d >= y1[0])) : s.v, hi = maxOf(win), lo = minOf(win), avg = win.reduce((a, b) => a + b, 0) / win.length, rank = win.filter(x => x <= last).length / win.length;
  let h = `<h2>${esc(s.title)} <button class="btn sm" data-close>닫기</button></h2>
  <div class="row" style="align-items:flex-end"><div style="font-size:2rem;font-weight:800;line-height:1">${dtFmt(s, last)}</div><div class="small muted">${esc(s.d[n - 1])} 기준${prev != null ? ' · 직전 ' + dtFmt(s, prev) + ' (' + esc(s.d[n - 2]) + ') <span class="' + dtCls(s, last, prev) + '">' + dtDiff(s, last, prev) + '</span>' : ''}</div></div>`;
  if (s.band) { const bn = s.band.find(b => last >= b[0] && last < b[1]) || s.band.at(-1); h += `<div>${pill(bn[2], '')}</div>`; }
  if (s.desc) h += `<p class="small" style="margin:0">${esc(s.desc)}</p>`;
  h += `<div class="chips">${DT_RNG.map(r => `<button class="chip" style="padding:3px 10px;min-height:30px" data-drng="${r[0]}" aria-pressed="${r[0] === DT.rng}">${r[0]}</button>`).join('')}</div><canvas id="dtCv" style="height:210px" role="img" aria-label="${esc(s.title)} 추이"></canvas><div class="small muted" id="dtInfo">차트를 누르면 날짜별 값이 표시됩니다</div>`;
  h += `<h3>기간별 변화</h3><div class="tw"><table><thead><tr><th>기간</th><th class="n">당시 값</th><th class="n">변화</th></tr></thead><tbody>${LOOKS.map(([nm, dd]) => { const a = dtAgo(s, dd); return a ? `<tr><td>${nm} 전 <span class="muted small">${esc(a[0].slice(2))}</span></td><td class="n">${dtFmt(s, a[1])}</td><td class="n ${dtCls(s, last, a[1])}">${dtDiff(s, last, a[1])}</td></tr>` : ''; }).join('')}</tbody></table></div>`;
  h += `<h3>최근 1년 위치</h3><dl class="kv"><dt>최고</dt><dd>${dtFmt(s, hi)}</dd><dt>평균</dt><dd>${dtFmt(s, avg)}</dd><dt>최저</dt><dd>${dtFmt(s, lo)}</dd><dt>현재 위치(낮음 0 ~ 높음 100)</dt><dd>${(rank * 100).toFixed(0)}</dd><dt>전체 기간 최고 / 최저</dt><dd>${dtFmt(s, maxOf(s.v))} / ${dtFmt(s, minOf(s.v))}</dd><dt>데이터 기간</dt><dd>${esc(s.d[0])} ~ ${esc(s.d[n - 1])} (${n.toLocaleString()}개)</dd></dl>`;
  if (s.cnnx && CNN) h += `<h3>CNN 제공 비교값</h3><dl class="kv"><dt>전일</dt><dd>${F.n1(CNN.prev)}</dd><dt>1주 전</dt><dd>${F.n1(CNN.w1)}</dd><dt>1개월 전</dt><dd>${F.n1(CNN.m1)}</dd><dt>1년 전</dt><dd>${F.n1(CNN.y1)}</dd></dl><h3>구성 7요소 <span class="muted small">눌러서 설명 보기</span></h3>${Object.keys(CNN_PARTS).map(k => CNN.parts[k] ? `<button class="row small" data-dt="cnnp:${k}" style="padding:6px 0;width:100%;background:none;border:0;border-bottom:1px solid var(--line);font:inherit;color:inherit;text-align:left;cursor:pointer"><span style="flex:1">${esc(CNN_PARTS[k])}</span><b>${CNN.parts[k].score.toFixed(0)}</b>${pill(CNN_KO[CNN.parts[k].rating] || CNN.parts[k].rating, CNN.parts[k].score >= 55 ? 'good' : CNN.parts[k].score <= 45 ? 'bad' : 'mut')}</button>` : '').join('')}`;
  const rows = Math.min(10, n); h += `<h3>최근 ${rows}개 값</h3><div class="tw"><table><thead><tr><th>날짜</th><th class="n">값</th><th class="n">직전 대비</th></tr></thead><tbody>${Array.from({ length: rows }, (_, k) => n - 1 - k).map(i => `<tr><td>${esc(s.d[i])}</td><td class="n">${dtFmt(s, s.v[i])}</td><td class="n ${i > 0 ? dtCls(s, s.v[i], s.v[i - 1]) : ''}">${i > 0 ? dtDiff(s, s.v[i], s.v[i - 1]) : '–'}</td></tr>`).join('')}</tbody></table></div>`;
  if (s.src) h += `<p class="small muted" style="margin:0">출처: ${esc(s.src)} · 과거 흐름은 미래를 보장하지 않습니다.</p>`;
  return h;
}
const CNN_PART_DESC = {
  market_momentum_sp500: 'S&P500이 125일 이동평균보다 얼마나 위에 있는지. 평균보다 많이 높으면 탐욕.', stock_price_strength: '뉴욕거래소에서 52주 신고가 종목 수 대비 신저가 종목 수. 신고가가 많으면 탐욕.',
  stock_price_breadth: '상승 종목 거래량 대비 하락 종목 거래량(맥클렐런 거래량 지수). 상승 쪽 거래량이 크면 탐욕.', put_call_options: '풋옵션(하락 베팅) 대비 콜옵션(상승 베팅) 비율. 풋이 많으면 공포.',
  market_volatility_vix: 'VIX가 50일 평균보다 얼마나 높은지. 높으면 공포.', junk_bond_demand: '정크본드와 국채의 금리 차이. 차이가 벌어지면 위험 회피(공포).', safe_haven_demand: '최근 20일 주식 수익률과 국채 수익률의 차이. 채권이 더 좋으면 공포.'
};
function dtCnnPart(k) {
  const p = CNN && CNN.parts[k]; if (!p) return `<h2>상세</h2><div class="empty">값이 없습니다.</div><button class="btn" data-close>닫기</button>`;
  return `<h2>${esc(CNN_PARTS[k])} <button class="btn sm" data-close>닫기</button></h2><div style="font-size:2rem;font-weight:800">${p.score.toFixed(0)} ${pill(CNN_KO[p.rating] || p.rating, p.score >= 55 ? 'good' : p.score <= 45 ? 'bad' : 'mut')}</div><p class="small" style="margin:0">${esc(CNN_PART_DESC[k] || '')}</p><p class="small muted" style="margin:0">0=극단적 공포 · 100=극단적 탐욕. CNN은 요소별 과거 이력을 공개하지 않아 현재 값만 표시합니다.</p><button class="btn" data-dt="cnn">CNN 종합 지수 추이 보기</button>`;
}
/* ───────── 종목: 투자지표(PER 등) ───────── */
const VAL_NAMES = { PeRatio: ['PER(주가수익비율)', '주가 ÷ 주당순이익(최근 12개월). 낮을수록 이익 대비 싸지만 업종·성장성에 따라 기준이 다릅니다.'], ForwardPeRatio: ['선행 PER', '야후가 제공하는 예상 이익 기준 PER. 추정치 오류가 있을 수 있어 참고만 하세요.'], PbRatio: ['PBR(주가순자산비율)', '주가 ÷ 주당순자산. 1 미만이면 장부가보다 싼 상태(자산형 업종에서 의미).'], PsRatio: ['PSR(주가매출비율)', '시가총액 ÷ 매출. 적자 성장주 비교에 쓰입니다.'], PegRatio: ['PEG', 'PER ÷ 이익성장률. 추정치 기반이라 참고만 하세요.'], EnterprisesValueEBITDARatio: ['EV/EBITDA', '기업가치(시총+순부채) ÷ 영업이익+감가상각. 부채 구조가 다른 기업 비교용.'], MarketCap: ['시가총액', '', ''], DilutedEPS: ['주당순이익(EPS, 12개월)', '', ''] };
const FUNDX = {}; let fundxLoaded = false, fundxBusy = {}, fundxFail = {};
const valRaw = sym => (FUND[sym] && FUND[sym].raw) || (FUNDX[sym] && FUNDX[sym].raw) || null;
async function ensureFundRaw(sym) {
  const w = S.watch.find(x => x.sym === sym); if (!w || w.type === 'etf' || valRaw(sym) || fundxBusy[sym] || Date.now() - (fundxFail[sym] || 0) < 6e5) return;
  if (!fundxLoaded) { fundxLoaded = true; try { Object.assign(FUNDX, (await IDB.get('fundx')) || {}); } catch (e) { } if (valRaw(sym)) return; }
  const b = proxyBase(); if (!b) return; fundxBusy[sym] = 1;
  try { const j = await jget(b + '/api/fund?s=' + encodeURIComponent(sym), 12000); if (j && j.a) { FUNDX[sym] = { raw: j, t: Date.now() }; IDB.set('fundx', FUNDX); } else FUNDX[sym] = { raw: { a: {}, t: {} }, t: Date.now() }; } catch (e) { fundxBusy[sym] = 0; fundxFail[sym] = Date.now(); return; }
  if (view === 'stock' && curSym === sym) softRender();
}
const lastOf = (o) => { if (!o) return null; const k = Object.keys(o).sort(); return k.length ? o[k.at(-1)] : null; };
const prevYr = o => { if (!o) return null; const k = Object.keys(o).sort(), y = x => parseInt(String(x).slice(0, 4), 10); return k.length > 1 && isFinite(y(k.at(-1))) && y(k.at(-1)) - y(k.at(-2)) === 1 ? o[k.at(-2)] : null; };   // 바로 직전 연도가 있을 때만
const prevOf = (o, back = 1) => { if (!o) return null; const k = Object.keys(o).sort(); return k.length > back ? o[k[k.length - 1 - back]] : null; };
function valCalc(sym) {
  const raw = valRaw(sym), a = raw && raw.a || {}, t = raw && raw.t || {}, f = FUND[sym] || {}, px = priceOf(sym), o = {};
  const tl = k => t[k] && t[k].length ? t[k].at(-1) : null, eps = tl('DilutedEPS'), mc = tl('MarketCap'), ni = lastOf(a.NetIncome), rev = lastOf(a.TotalRevenue), oi = lastOf(a.OperatingIncome), eq = lastOf(a.StockholdersEquity), debt = lastOf(a.TotalDebt), cash = lastOf(a.CashAndCashEquivalents), fcf = lastOf(a.FreeCashFlow), ocf = lastOf(a.OperatingCashFlow), div = lastOf(a.CashDividendsPaid);
  o.eps = eps ? eps[1] : null; o.per = px && o.eps > 0 ? px / o.eps : (o.eps != null ? 'neg' : null); o.perAsof = eps ? eps[0] : null;
  const perH = (t.PeRatio || []).map(x => x[1]).filter(x => x > 0); o.perMed = perH.length >= 4 ? perH.slice().sort((x, y) => x - y)[Math.floor(perH.length / 2)] : null;
  const ype = tl('PeRatio'), ypev = ype ? ype[1] : null; o.curMismatch = !!(typeof o.per === 'number' && ypev > 0 && (o.per / ypev > 3 || o.per / ypev < 1 / 3)); if (o.curMismatch) o.per = ypev;   // 재무 통화와 주가 통화가 다르면 야후 값을 쓰고 통화가 섞이는 비율은 숨긴다
  const shs = lastOf(a.BasicAverageShares), mcNow = shs && px ? shs * px : null;
  const tv = k => { const x = tl(k); return x ? x[1] : null; };
  o.fper = tv('ForwardPeRatio'); o.pbr = tv('PbRatio'); o.psr = tv('PsRatio'); o.evebitda = tv('EnterprisesValueEBITDARatio'); o.peg = tv('PegRatio'); o.mc = mc ? mc[1] : null; o.mcAsof = mc ? mc[0] : null;
  o.pcf = px && f.cfps > 0 && !o.curMismatch ? px / f.cfps : null; o.cfy = px && f.cfps > 0 && !o.curMismatch ? f.cfps / px : null; o.fcfy = fcf && (mcNow || o.mc) && !o.curMismatch ? fcf / (mcNow || o.mc) : null; o.cagr = f.cagr ?? null;
  o.roe = ni != null && eq > 0 ? ni / eq : null; o.opm = oi != null && rev > 0 ? oi / rev : null; o.npm = ni != null && rev > 0 ? ni / rev : null; o.de = debt != null && eq > 0 ? debt / eq : null; o.netcash = debt != null && cash != null && !o.curMismatch ? cash - debt : null;
  const rp = prevYr(a.TotalRevenue), np = prevYr(a.NetIncome); o.revg = rev != null && rp > 0 ? rev / rp - 1 : null; o.nig = ni != null && np > 0 ? ni / np - 1 : null; o.divy = div != null && (mcNow || o.mc) && !o.curMismatch ? -div / (mcNow || o.mc) : null;
  o.year = a.TotalRevenue ? Object.keys(a.TotalRevenue).sort().at(-1) : null; o.has = !!(raw && (Object.keys(a).length || Object.keys(t).length)); return o;
}
function valCard(sym) {
  const w = S.watch.find(x => x.sym === sym), ent = FEAT[sym], lv = LIVE[sym]; if (!w || !ent) return '';
  const Fx = ent.F, B = Fx.B, i = Fx.n - 1, fm = (x, d = 1) => x == null || !isFinite(x) ? '–' : x.toFixed(d), pc = (x, d = 1) => x == null || !isFinite(x) ? '–' : (x * 100).toFixed(d) + '%';
  const sp = key => { try { const s = dtSeries(key); return s && s.v.length >= 3 ? s.v.slice(-48) : null; } catch (e) { return null; } };
  const row = (name, val, tone, note, dtk, spark) => `<${dtk ? 'button data-dt="' + dtk + '"' : 'div'} class="sig" style="grid-template-columns:1fr auto;width:100%;${dtk ? 'background:none;border:0;border-bottom:1px solid var(--line);font:inherit;color:inherit;text-align:left;cursor:pointer' : ''}"><div><div>${name}${dtk ? ' <span class="muted small">›</span>' : ''}</div><div class="small muted">${note}</div>${spark ? '<div style="margin-top:4px">' + wkSpark(spark, true, true) + '</div>' : ''}</div><div class="right"><b>${val}</b>${tone ? '<div>' + pill(tone[0], tone[1]) + '</div>' : ''}</div></${dtk ? 'button' : 'div'}>`;
  const T = (v, good, bad, lowGood) => v == null || !isFinite(v) ? null : lowGood ? (v <= good ? ['기준 이하', 'mut'] : v >= bad ? ['기준 이상', 'mut'] : ['중간', 'mut']) : (v >= good ? ['기준 이상', 'mut'] : v <= bad ? ['기준 이하', 'mut'] : ['중간', 'mut']);   // 일반적 기준과의 위치일 뿐 좋고 나쁨의 판정이 아님(업종마다 다름)
  let h = `<div class="card"><h2>투자지표 <span class="muted small">업종마다 기준이 다름 · 점수에는 반영하지 않는 참고 정보</span></h2>`;
  h += `<h3 style="margin-top:4px">추세·타이밍 <span class="muted small">(가격 기반)</span></h3>${row('고점(52주) 대비', pc(B.dd[i]), B.dd[i] <= -.2 ? ['눌림', 'good'] : null, '많이 빠질수록 분할 매수 구간(레버리지는 기초지수 환산)')}${row('200일선 이격', pc(B.dev200[i]), B.dev200[i] >= .25 ? ['과열', 'warn'] : B.dev200[i] <= -.1 ? ['아래', 'good'] : null, '200일 이동평균 대비 현재가 위치')}${row('주봉 RSI', fm(B.rW[i]), B.rW[i] >= 70 ? ['과열', 'warn'] : B.rW[i] <= 40 ? ['침체', 'good'] : null, '70↑ 과열 · 40↓ 침체')}${row('일봉 RSI', fm(B.rD[i]), B.rD[i] >= 70 ? ['과열', 'warn'] : B.rD[i] <= 30 ? ['과매도', 'good'] : null, '30↓ 과매도 · 70↑ 과매수')}`;
  const v = valCalc(sym);
  if (w.type === 'etf' && !v.has) { h += `<p class="small muted" style="margin:10px 0 0">ETF는 개별 기업의 재무지표(PER·ROE 등)가 없어 가격 기반 지표만 표시합니다.</p></div>`; return h; }
  if (!v.has) { h += `<p class="small muted" style="margin:10px 0 0">${proxyBase() ? '재무 데이터를 불러오는 중이거나, 이 종목은 야후에 재무 자료가 없습니다.' : '재무 데이터를 받을 실시간 워커 주소가 없어 표시하지 못했습니다.'}</p></div>`; return h; }
  const cur = isKR(sym) ? '₩' : '$', big = x => x == null ? '–' : (Math.abs(x) >= 1e12 ? (x / 1e12).toFixed(2) + '조' : Math.abs(x) >= 1e8 ? (x / 1e8).toFixed(0) + '억' : x.toFixed(0));
  const bigU = x => x == null ? '–' : Math.abs(x) >= 1e12 ? cur + (x / 1e12).toFixed(2) + 'T' : Math.abs(x) >= 1e9 ? cur + (x / 1e9).toFixed(1) + 'B' : cur + (x / 1e6).toFixed(0) + 'M';
  const fair = ent.fair, pf = fair ? lv.price / fair : null;
  h += `<h3 style="margin-top:14px">현금흐름·가치 <span class="muted small">(영업현금흐름 중심)</span></h3>`;
  h += row('주가 ÷ 영업현금흐름(P/CF)', v.pcf != null ? fm(v.pcf) + '배' : '–', T(v.pcf, 18, 30, true), '영업현금흐름 18배를 적정 멀티플로 사용 (' + (FUND[sym] ? '기준 ' + FUND[sym].asof : '') + ')');
  h += row('영업현금흐름 수익률', pc(v.cfy), T(v.cfy, .055, .02), '주당 영업현금흐름 ÷ 주가 (높을수록 주가 대비 현금 창출이 큼)');
  h += row('잉여현금흐름(FCF) 수익률', pc(v.fcfy), T(v.fcfy, .04, 0), '설비투자까지 뺀 현금 ÷ 시가총액. 설비투자 부담도 확인 (추세는 FCF 금액)', 'va:' + sym + ':FCF', sp('va:' + sym + ':FCF'));
  h += row('영업현금흐름 연평균 성장(CAGR)', pc(v.cagr, 0), T(v.cagr, .15, 0), '적정가 계산에 5~20% 범위로 보수 반영', 'va:' + sym + ':OCF', sp('va:' + sym + ':OCF'));
  h += row('적정가 대비 현재가', pf != null ? (pf * 100).toFixed(0) + '%' : '–', pf == null ? null : pf <= .85 ? ['추정 적정가보다 낮음', 'mut'] : pf >= 1.2 ? ['추정 적정가보다 높음', 'mut'] : ['추정 적정가 부근', 'mut'], fair ? '적정가 ' + fmtPx(sym, fair) + ' (' + ent.fairSrc + ')' : '적정가 계산 불가(현금흐름 부족)');
  h += `<h3 style="margin-top:14px">밸류에이션 <span class="muted small">(일반 지표)</span></h3>`;
  const perTxt = v.per === 'neg' ? '적자' : v.per != null ? fm(v.per) + '배' : '–', perNote = (v.per > 0 && v.perMed ? `과거 중앙값 ${fm(v.perMed)}배 대비 ${(v.per / v.perMed * 100).toFixed(0)}%` : '주가 ÷ 12개월 주당순이익') + (v.curMismatch ? ' · 재무 통화 차이로 야후 제공 PER 사용' : '') + (v.perAsof ? ` · EPS ${v.eps != null ? v.eps.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '–'} (${v.perAsof})` : '');
  h += row('PER', perTxt, typeof v.per === 'number' && v.perMed ? (v.per <= v.perMed * .85 ? ['자기 과거 중앙값보다 낮음(싸다는 뜻 아님)', 'mut'] : v.per >= v.perMed * 1.2 ? ['자기 과거 중앙값보다 높음', 'mut'] : ['자기 과거 중앙값 수준', 'mut']) : null, perNote, 'per:' + sym, sp('per:' + sym));
  h += row('선행 PER (야후 추정)', v.fper != null ? fm(v.fper) + '배' : '–', null, '추정치라 틀릴 수 있음 — 참고만', 'val:' + sym + ':ForwardPeRatio');
  h += row('PBR', v.pbr != null ? fm(v.pbr, 2) + '배' : '–', null, '주가 ÷ 주당순자산', 'val:' + sym + ':PbRatio', sp('val:' + sym + ':PbRatio'));
  h += row('PSR', v.psr != null ? fm(v.psr, 2) + '배' : '–', null, '시가총액 ÷ 매출', 'val:' + sym + ':PsRatio', sp('val:' + sym + ':PsRatio'));
  h += row('EV/EBITDA', v.evebitda != null ? fm(v.evebitda) + '배' : '–', null, '부채까지 포함한 기업가치 ÷ 영업이익+감가상각', 'val:' + sym + ':EnterprisesValueEBITDARatio', sp('val:' + sym + ':EnterprisesValueEBITDARatio'));
  h += row('시가총액', bigU(v.mc), null, v.mcAsof ? '기준 ' + v.mcAsof : '', 'val:' + sym + ':MarketCap');
  h += row('배당수익률', pc(v.divy), null, '연간 배당 지급액 ÷ 시가총액');
  h += `<h3 style="margin-top:14px">재무 건전성 <span class="muted small">(${esc(v.year || '')} 사업연도 기준)</span></h3>`;
  h += row('ROE (자기자본이익률)', pc(v.roe), T(v.roe, .15, .05), '순이익 ÷ 자기자본 — 15%↑이면 높은 편', 'va:' + sym + ':ROE', sp('va:' + sym + ':ROE'));
  h += row('영업이익률', pc(v.opm), T(v.opm, .2, .05), '영업이익 ÷ 매출', 'va:' + sym + ':OPM', sp('va:' + sym + ':OPM'));
  h += row('순이익률', pc(v.npm), T(v.npm, .15, .03), '순이익 ÷ 매출', 'va:' + sym + ':NPM', sp('va:' + sym + ':NPM'));
  h += row('매출 증가율 (전년 대비)', pc(v.revg), T(v.revg, .1, 0), '', 'va:' + sym + ':REVG', sp('va:' + sym + ':REVG'));
  h += row('순이익 증가율 (전년 대비)', pc(v.nig), T(v.nig, .1, 0), '', 'va:' + sym + ':NIG', sp('va:' + sym + ':NIG'));
  h += row('부채 ÷ 자기자본', v.de != null ? (v.de * 100).toFixed(0) + '%' : '–', T(v.de, 1, 2, true), v.netcash != null ? (v.netcash >= 0 ? '순현금 ' : '순부채 ') + bigU(Math.abs(v.netcash)) : '100% 이하 낮은 편 · 200%↑ 높은 편', 'va:' + sym + ':DE', sp('va:' + sym + ':DE'));
  h += `<p class="small muted" style="margin:10px 0 0">앱의 핵심 판단은 <b>영업현금흐름 기반 적정가·추세(200일선)·RSI</b>를 씁니다. PER·PBR 등은 일반 참고 지표이며, ‘양호·부담’ 표시는 통용되는 대략적 기준이라 <b>업종마다 다릅니다</b>. 야후 파이낸스 재무 자료(분기 갱신·지연·오류 가능) 기반이고 매수 점수에는 반영되지 않습니다.</p></div>`;
  return h;
}

/* ───────── 종목: 신호 근거(추세 + 가치 신호를 합쳐 보여 줌) ───────── */
function signalCard(sym) {
  const ent = FEAT[sym], lv = LIVE[sym]; if (!ent || !lv) return '';
  const Fx = ent.F, prm = params(), by = new Map();
  for (const L of ['P', 'D']) for (const r of E.explain(Fx, L, prm)) { if (r.na) continue; const o = by.get(r.id); if (!o || (r.on && !o.on)) by.set(r.id, r); }
  const all = [...by.values()], on = all.filter(r => r.on && r.type !== 'warn'), warn = all.filter(r => r.on && r.type === 'warn'), off = all.filter(r => !r.on && r.type !== 'warn');
  const li = r => `<div class="small" style="padding:3px 0"><span class="${r.type === 'warn' ? 'neg' : 'pos'}">●</span> ${esc(r.label)} <span class="muted">— ${esc(r.detail)}</span></div>`;
  return `<div class="card"><h2>신호 근거 <span class="muted small">통합 ${lv.lens.C.score}점 · 추세 ${lv.lens.P.score} · 가치 ${lv.lens.D.score}</span></h2><div class="small b">켜진 신호 ${on.length}개</div>${on.map(li).join('') || '<div class="small muted">켜진 신호 없음</div>'}${warn.length ? '<div class="small b" style="margin-top:8px">주의</div>' + warn.map(li).join('') : ''}<details style="margin-top:8px"><summary class="small b" style="cursor:pointer">아직 안 켜진 신호 ${off.length}개</summary>${off.map(r => `<div class="small muted" style="padding:2px 0">○ ${esc(r.label)} — ${esc(r.detail)}</div>`).join('')}</details><p class="small muted" style="margin:8px 0 0">점수는 확률이 아닙니다. 과거 검증에서 의미가 있었던 것은 신호가 처음 켜진 구간뿐입니다.</p></div>`;
}

/* ───────── 종목 추가(검색) ───────── */
const LEV_GUESS = { SOXL: 3, TQQQ: 3, UPRO: 3, TECL: 3, FNGU: 3, UDOW: 3, TNA: 3, QLD: 2, SSO: 2, USD: 2, ROM: 2, UWM: 2 };
const POPULAR = [['AAPL', '애플'], ['AVGO', '브로드컴'], ['AMD', 'AMD'], ['NFLX', '넷플릭스'], ['PLTR', '팔란티어'], ['COIN', '코인베이스'], ['MSTR', '스트래티지'], ['SMH', '반도체 ETF'], ['VOO', 'S&P500 ETF'], ['SCHD', '배당 ETF'], ['TSM', 'TSMC'], ['035420.KS', 'NAVER'], ['005380.KS', '현대차']];
let SR = [];
function openAddModal() {
  openModal(`<h2>종목 추가 <button class="btn sm" data-close>닫기</button></h2><label class="f">이름이나 티커 검색<input id="qSym" autocomplete="off" placeholder="예: 엔비디아, NVDA, 삼성전자, SOXL"></label><div id="qRes" class="small muted">검색어를 입력하세요 (미국·한국 주식/ETF). 한국 종목은 <b>005930.KS</b>(코스피) · <b>.KQ</b>(코스닥) 형식입니다.</div><h3>자주 찾는 종목</h3><div class="chips" style="flex-wrap:wrap">${POPULAR.map(p => `<button class="chip" data-padd="${p[0]}|${p[1]}">${esc(p[1])}</button>`).join('')}</div>`);
}
let qT; function qSearch(q) {
  clearTimeout(qT); const el = $('#qRes'); if (!el) return; q = q.trim(); if (!q) { el.innerHTML = '검색어를 입력하세요.'; return; }
  qT = setTimeout(async () => {
    const b = proxyBase(); const direct = /^[A-Za-z0-9.^=-]{1,12}$/.test(q) ? `<button class="btn sm" data-padd="${esc(q.toUpperCase())}|">‘${esc(q.toUpperCase())}’ 티커로 바로 추가</button>` : '';
    if (!b) { el.innerHTML = '검색 서버 주소가 없어 티커 직접 입력만 가능합니다.<div style="margin-top:6px">' + direct + '</div>'; return; }
    el.innerHTML = '검색 중…';
    try { const j = await jget(b + '/api/search?q=' + encodeURIComponent(q), 8000); SR = j.items || []; el.innerHTML = (SR.length ? SR.map((x, i) => `<button class="act" style="grid-template-columns:1fr auto;padding:9px 12px;margin-bottom:6px" data-psr="${i}"><div><b>${esc(x.sym)}</b> <span class="muted small">${esc(x.ex)}</span><div class="small muted">${esc(x.name)}</div></div>${pill(x.type === 'etf' ? 'ETF' : '주식')}</button>`).join('') : '<div class="muted">검색 결과가 없습니다.</div>') + (direct ? '<div style="margin-top:6px">' + direct + '</div>' : ''); }
    catch (e) { el.innerHTML = '검색에 실패했습니다. 티커를 직접 추가할 수 있습니다.<div style="margin-top:6px">' + direct + '</div>'; }
  }, 350);
}
async function addWatch(sym, type, name) {
  sym = String(sym || '').trim().toUpperCase(); if (!/^[A-Z0-9.^=-]{1,12}$/.test(sym)) return;
  if (!S.watch.find(x => x.sym === sym)) { const lev = LEV_GUESS[sym] || 1, w = { sym, lev, type: type || (lev > 1 ? 'etf' : 'stock'), beta: 1 }; if (isKR(sym) || /[가-힣]/.test(name || '')) w.name = name || sym; S.watch.push(w); }
  curSym = sym; save(); closeModal(); view = 'stock'; render(); setStatus(sym + ' 이력 수집 중…'); await syncLive([sym]); setStatus(''); recompute(); render(); maybeBacktest(true); ensureFundRaw(sym);
}

/* ───────── 넓은 표(6열↑)는 좁은 화면에서 카드형으로 보이게 라벨을 붙인다 ───────── */
function a11yDt() { document.querySelectorAll('[data-dt]:not(button):not(a):not([tabindex])').forEach(e => { e.tabIndex = 0; if (e.tagName !== 'TR' && !e.getAttribute('role')) e.setAttribute('role', 'button'); }); }
function stackTables() {
  a11yDt();
  document.querySelectorAll('.tw > table:not([data-stk])').forEach(t => {
    const ths = [...t.querySelectorAll('thead th')]; if (ths.length < 6 || t.querySelectorAll('tbody tr').length > 5) { t.dataset.stk = '0'; return; }
    const lab = ths.map(x => x.innerHTML.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
    t.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => { if (i && lab[i]) { td.dataset.lab = lab[i]; td.innerHTML = '<span class="v">' + td.innerHTML + '</span>'; } }));
    t.classList.add('stk'); t.dataset.stk = '1';
  });
}
try { new MutationObserver(stackTables).observe(document.querySelector('main'), { childList: true, subtree: true }); } catch (e) { }

/* ───────── 화면 구성 도우미: 제목으로 카드를 찾아 원하는 순서로 재배치(카드가 있던 자리를 그대로 채움) ───────── */
function reorderCards(el, keys) {
  const kids = [...el.children], head = k => { const h = k.querySelector(':scope > h2, :scope > summary'); return h ? h.textContent : ''; };
  const slots = [], picked = [];
  kids.forEach((k, i) => { const t = head(k), idx = keys.findIndex(x => t.includes(x)); if (idx >= 0) { slots.push(i); picked.push([idx, k]); } });
  if (picked.length < 2) return;
  picked.sort((a, b) => a[0] - b[0]);
  const out = kids.slice(); slots.forEach((slot, n) => { out[slot] = picked[n][1]; });
  out.forEach(k => el.appendChild(k));
}
/* 첫 제목(h2) 전체를 접이식 카드로 바꾼다(요약 줄만 보이고 눌러서 펼침) */
function collapseCard(html, open) {
  if (!html) return '';
  return html.replace('<div class="card"><h2>', `<details class="card"${open ? ' open' : ''}><summary class="b sumh">`).replace('</h2>', '</summary>').replace(/<\/div>\s*$/, '</details>');
}

/* ───────── 종목: 고점 대비 하락 카드(52주 고점·전고점·역대 낙폭) ───────── */
function ddEpisodes(c, thr) {   // 가격은 유한한 양수만 들어온다고 가정(호출 전에 정리)   // 고점→바닥→회복 구간 중 낙폭이 thr 이상인 것
  const eps = []; let pk = 0, tr = 0, inDD = false;
  for (let i = 1; i < c.length; i++) {
    if (c[i] >= c[pk]) { if (inDD) { eps.push({ pk, tr, rec: i }); inDD = false; } pk = i; tr = i; }
    else { if (!inDD) { inDD = true; tr = i; } if (c[i] < c[tr]) tr = i; }
  }
  if (inDD) eps.push({ pk, tr, rec: null });
  return eps.map(e => ({ ...e, depth: c[e.tr] / c[e.pk] - 1 })).filter(e => e.depth <= -thr + 1e-9);
}
function ddCard(sym) {
  const s0 = PX[sym], w = S.watch.find(x => x.sym === sym); if (!s0 || s0.c.length < 60) return '';
  const ok = s0.c.map((v, i) => isFinite(v) && v > 0 ? i : -1).filter(i => i >= 0), c = ok.map(i => s0.c[i]), d = ok.map(i => s0.d[i]); if (c.length < 60) return '';
  const n = c.length, last = c[n - 1], i52 = Math.max(0, n - 252), hi52 = maxOf(c.slice(i52)), lo52 = minOf(c.slice(i52));
  const ia = c.indexOf(maxOf(c)), ath = c[ia], i52h = i52 + c.slice(i52).indexOf(hi52), days = (a, b) => Math.round((Date.parse(d[b]) - Date.parse(d[a])) / 864e5);
  const eps = ddEpisodes(c, w && w.lev > 1 ? .3 : .15), mdd = ddEpisodes(c, 0).reduce((m, e) => (e.depth < m.depth ? e : m), { depth: 0 }), top = [...eps].sort((x, y) => x.depth - y.depth).slice(0, 5), pos = hi52 > lo52 ? (last - lo52) / (hi52 - lo52) : 1;
  const dd52 = last / hi52 - 1, ddA = last / ath - 1;
  return `<div class="card"><h2>고점 대비 하락 <span class="muted small">전고점·52주 고점·역대 낙폭</span></h2>
  <dl class="kv"><dt>현재가</dt><dd>${fmtPx(sym, last)}</dd><dt>52주 고점 (${esc(d[i52h])})</dt><dd>${fmtPx(sym, hi52)} · <b class="${cls(dd52)}">${F.pct(dd52)}</b></dd><dt>전고점 = 역대 최고 (${esc(d[ia])})</dt><dd>${fmtPx(sym, ath)} · <b class="${cls(ddA)}">${F.pct(ddA)}</b></dd><dt>전고점 이후</dt><dd>${ia === n - 1 ? '오늘이 신고가' : days(ia, n - 1).toLocaleString() + '일 경과'}</dd><dt>52주 저점 대비</dt><dd class="${cls(last / lo52 - 1)}">${F.pct(last / lo52 - 1)}</dd><dt>역대 최대 낙폭</dt><dd><b class="neg">${F.pct(mdd.depth)}</b>${mdd.pk != null && mdd.depth ? ` <span class="muted small">(${esc(d[mdd.pk])} → ${esc(d[mdd.tr])})</span>` : ''}</dd></dl>
  <div style="margin:10px 0 4px"><div class="small muted" style="display:flex;justify-content:space-between"><span>52주 저점 ${fmtPx(sym, lo52)}</span><span>52주 고점 ${fmtPx(sym, hi52)}</span></div><div class="bar"><i style="width:${Math.round(Math.min(1, Math.max(0, pos)) * 100)}%"></i></div><div class="small muted" style="margin-top:2px">52주 범위 안에서 ${Math.round(Math.min(1, Math.max(0, pos)) * 100)}% 위치</div></div>
  <div class="row" style="margin:8px 0"><button class="btn sm" data-dt="dd:${esc(sym)}">하락률 추이 보기</button></div>
  ${top.length ? `<h3>과거 큰 하락 구간 (${w && w.lev > 1 ? '-30%' : '-15%'} 이상, 깊은 순)</h3><div class="tw"><table><thead><tr><th>고점일</th><th>바닥일</th><th class="n">하락</th><th class="n">회복</th></tr></thead><tbody>${top.map(e => `<tr><td>${esc(d[e.pk])}</td><td>${esc(d[e.tr])}</td><td class="n neg">${F.pct(e.depth, 0)}</td><td class="n">${e.rec == null ? '<span class="muted">진행 중</span>' : days(e.pk, e.rec).toLocaleString() + '일'}</td></tr>`).join('')}</tbody></table></div><p class="small muted" style="margin:6px 0 0">회복 = 고점에서 다시 그 가격으로 돌아오기까지 걸린 기간. 낙폭이 크다고 싸다는 뜻이 아닙니다. 회복하지 못한 종목·상장폐지 종목은 이 앱에 남아 있지 않아(생존편향) 실제보다 낙관적으로 보일 수 있습니다. 점수에는 반영하지 않는 참고 정보입니다.</p>` : '<p class="small muted" style="margin:0">기준 이상의 큰 하락 구간이 없었습니다.</p>'}</div>`;
}
