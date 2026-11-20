'use strict';
/* 디벨롭 — 상세 보기(모든 지표 클릭) · 3관점 비교 · 투자지표(PER 등) · 종목 검색
   app.js 보다 먼저 로드되며, app.js 의 전역(S, PX, MK, MAC, CNN, FUND, E, F, esc, pill …)은 호출 시점에 참조한다. */

/* ───────── 지표 설명 ───────── */
const DT_DESC = {
  '^VIX': ['VIX(변동성 지수)', 'S&P500 옵션 가격으로 계산한 "앞으로 30일 시장이 얼마나 흔들릴 것으로 보는가"입니다. 보통 15 이하는 안정, 20~25는 경계, 30 이상은 공포 구간입니다. 급등 뒤 꺾이는 시점이 과거에 저점 부근이었던 적이 많지만 보장은 아닙니다.', '지수'],
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
  if (!MK && ['fear', 'vixts', 'breadth', 'qdd'].includes(k)) return null;
  if (k === 'fear') { const ix = MK.d.map((_, i) => i).filter(i => MK.fear[i] != null); const m = DT_DESC.fear; return mk(m[0], ix.map(i => MK.d[i]), ix.map(i => MK.fear[i]), { desc: m[1], unit: m[2], mode: 'abs', dec: 0, src: '앱 자체 계산(가격 기반)', band: [[0, 25, '탐욕'], [25, 45, '탐욕 우세'], [45, 55, '중립'], [55, 75, '공포'], [75, 100, '극단적 공포']] }); }
  if (k === 'vixts') { const ix = MK.d.map((_, i) => i).filter(i => MK.vix[i] != null && MK.v3[i]); const m = DT_DESC.vixts; return mk(m[0], ix.map(i => MK.d[i]), ix.map(i => MK.vix[i] / MK.v3[i]), { desc: m[1], unit: '', mode: 'abs', dec: 2, src: 'Yahoo Finance' }); }
  if (k === 'breadth') { const ix = MK.d.map((_, i) => i).filter(i => MK.breadth[i] != null); const m = DT_DESC.breadth; return mk(m[0], ix.map(i => MK.d[i]), ix.map(i => MK.breadth[i] * 100), { desc: m[1], unit: '%', mode: 'abs', dec: 0, src: '앱 자체 계산(섹터 ETF 11개)' }); }
  if (k === 'qdd') { const q = PX.QQQ; if (!q || q.c.length < 260) return null; const d = [], v = []; for (let i = 251; i < q.c.length; i++) { d.push(q.d[i]); v.push((q.c[i] / Math.max(...q.c.slice(i - 251, i + 1)) - 1) * 100); } const m = DT_DESC.qdd; return mk(m[0], d, v, { desc: m[1], unit: '%', mode: 'abs', dec: 1, src: 'Yahoo Finance(QQQ)' }); }
  if (k === 'cnn') { if (!CNN || !CNN.hist || !CNN.hist.length) return null; const m = DT_DESC.cnn, byD = new Map(CNN.hist.map(p => [p.d, p.v])), ds = [...byD.keys()].sort(); return mk(m[0], ds, ds.map(x => byD.get(x)), { desc: m[1], unit: '점', mode: 'abs', dec: 0, src: 'CNN(브라우저가 직접 조회) · 공개 이력 약 1년', band: [[0, 25, '극단적 공포'], [25, 45, '공포'], [45, 55, '중립'], [55, 75, '탐욕'], [75, 100, '극단적 탐욕']], cnnx: true }); }
  if (k === 'val') { const raw = valRaw(a); const t = raw && raw.t && raw.t[b]; if (!t || t.length < 2) return null; const nm = VAL_NAMES[b] || [b, '']; return mk(nm[0] + ' · ' + a, t.map(x => x[0]), t.map(x => x[1]), { desc: nm[1], unit: '', mode: 'pct', dec: b === 'MarketCap' ? 0 : 2, src: '야후 재무 시계열(분기 단위 갱신)' }); }
  return null;
}
const dtFmt = (s, x) => x == null || !isFinite(x) ? '–' : (s.unit === '$' ? '$' : '') + Number(x).toLocaleString('en-US', { maximumFractionDigits: s.dec, minimumFractionDigits: Math.min(s.dec, 2) }) + (s.unit === '%' ? '%' : '');
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
  if (key.startsWith('ind:')) return openModal(dtIndicator(key));
  if (key.startsWith('dom:')) return openModal(dtDomain(key));
  const s = dtSeries(key); if (!s) return openModal(`<h2>상세 보기</h2><div class="empty">이 항목의 이력 데이터가 아직 없습니다.</div><button class="btn" data-close>닫기</button>`);
  DT_CUR = s; openModal(dtHTML(s)); dtAfter();
}
function dtRange() { const r = DT_RNG.find(x => x[0] === DT.rng); return r ? r[1] : 365; }
function dtAfter() { const cv = $('#dtCv'); if (cv && DT_CUR) dtDraw(cv, DT_CUR, dtRange()); }
function dtHTML(s) {
  const n = s.d.length, last = s.v[n - 1], prev = n > 1 ? s.v[n - 2] : null, y1 = dtAgo(s, 365), win = y1 ? s.v.slice(s.d.findIndex(d => d >= y1[0])) : s.v, hi = Math.max(...win), lo = Math.min(...win), avg = win.reduce((a, b) => a + b, 0) / win.length, rank = win.filter(x => x <= last).length / win.length;
  let h = `<h2>${esc(s.title)} <button class="btn sm" data-close>닫기</button></h2>
  <div class="row" style="align-items:flex-end"><div style="font-size:2rem;font-weight:800;line-height:1">${dtFmt(s, last)}</div><div class="small muted">${esc(s.d[n - 1])} 기준${prev != null ? ' · 직전 ' + dtFmt(s, prev) + ' (' + esc(s.d[n - 2]) + ') <span class="' + dtCls(s, last, prev) + '">' + dtDiff(s, last, prev) + '</span>' : ''}</div></div>`;
  if (s.band) { const bn = s.band.find(b => last >= b[0] && last < b[1]) || s.band.at(-1); h += `<div>${pill(bn[2], '')}</div>`; }
  if (s.desc) h += `<p class="small" style="margin:0">${esc(s.desc)}</p>`;
  h += `<div class="chips">${DT_RNG.map(r => `<button class="chip" style="padding:3px 10px;min-height:30px" data-drng="${r[0]}" aria-pressed="${r[0] === DT.rng}">${r[0]}</button>`).join('')}</div><canvas id="dtCv" style="height:210px" role="img" aria-label="${esc(s.title)} 추이"></canvas><div class="small muted" id="dtInfo">차트를 누르면 날짜별 값이 표시됩니다</div>`;
  h += `<h3>기간별 변화</h3><div class="tw"><table><thead><tr><th>기간</th><th class="n">당시 값</th><th class="n">변화</th></tr></thead><tbody>${LOOKS.map(([nm, dd]) => { const a = dtAgo(s, dd); return a ? `<tr><td>${nm} 전 <span class="muted small">${esc(a[0].slice(2))}</span></td><td class="n">${dtFmt(s, a[1])}</td><td class="n ${dtCls(s, last, a[1])}">${dtDiff(s, last, a[1])}</td></tr>` : ''; }).join('')}</tbody></table></div>`;
  h += `<h3>최근 1년 위치</h3><dl class="kv"><dt>최고</dt><dd>${dtFmt(s, hi)}</dd><dt>평균</dt><dd>${dtFmt(s, avg)}</dd><dt>최저</dt><dd>${dtFmt(s, lo)}</dd><dt>현재 위치(낮음 0 ~ 높음 100)</dt><dd>${(rank * 100).toFixed(0)}</dd><dt>전체 기간 최고 / 최저</dt><dd>${dtFmt(s, Math.max(...s.v))} / ${dtFmt(s, Math.min(...s.v))}</dd><dt>데이터 기간</dt><dd>${esc(s.d[0])} ~ ${esc(s.d[n - 1])} (${n.toLocaleString()}개)</dd></dl>`;
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
function dtIndicator(key) {
  const [, reg, id] = key.split(':'), R = calcRegime(); if (!R) return `<h2>상세</h2><div class="empty">데이터 없음</div><button class="btn" data-close>닫기</button>`;
  const x = (R.regions[reg].ind || []).find(i => i.id === id); if (!x) return `<h2>상세</h2><div class="empty">항목을 찾지 못했습니다.</div><button class="btn" data-close>닫기</button>`;
  const link = { r10: 'px:^TNX', r5: 'px:^FVX', dxy: 'px:DX-Y.NYB', kdxy: 'px:DX-Y.NYB', kr10: 'px:^TNX', krw: 'px:KRW=X', k3: 'px:^KS11', kd200: 'px:^KS11', kd50: 'px:^KS11', sox: 'px:^SOX', vix: 'px:^VIX', kvix: 'px:^VIX', inv: 'vixts', greed: 'cnn', kgreed: 'cnn', t2: 'mac:T2Y', real10: 'mac:DFII10', bs: 'mac:WALCL', nfci: 'mac:NFCI', oas: 'mac:BAMLH0A0HYM2', oasd: 'mac:BAMLH0A0HYM2', claims: 'mac:ICSA', unrate: 'mac:UNRATE', d200: 'px:SPY', cg: 'px:HG=F', sm: 'px:IWM' }[id];
  return `<h2>${esc(x.label)} <button class="btn sm" data-close>닫기</button></h2><div class="row"><div style="font-size:1.8rem;font-weight:800">${esc(x.fmt)}</div>${x.score == null ? pill('확인 불가', 'mut') : pill('점수 ' + (x.score > 0 ? '+' : '') + x.score, x.score > 0 ? 'good' : x.score < 0 ? 'bad' : 'mut')}</div><p class="small" style="margin:0">${esc(x.note || '')}</p><p class="small muted" style="margin:0">${esc(x.tag)} · 점수는 -2(부정) ~ +2(긍정). 영역 점수는 이 점수들의 평균이며 시장 국면 판단의 근거로만 쓰입니다(매수 점수에는 반영되지 않음).</p>${link ? `<button class="btn pri" data-dt="${link}">관련 지표 추이 보기</button>` : ''}`;
}
function dtDomain(key) {
  const [, reg, dom] = key.split(':'), R = calcRegime(), nm = { liq: '유동성', econ: '경기', breadth: '시장 내부 건강도', credit: '신용·금융 스트레스', pos: '투자자 포지셔닝' }[dom];
  if (!R) return `<h2>상세</h2><div class="empty">데이터 없음</div><button class="btn" data-close>닫기</button>`; const r = R.regions[reg === 'global' ? 'us' : reg], list = (r.ind || []).filter(i => i.dom === dom), v = r.dom[dom], g = gradeOf(v);
  return `<h2>${nm} <button class="btn sm" data-close>닫기</button></h2><div class="row"><div style="font-size:1.8rem;font-weight:800">${v == null ? '–' : (v > 0 ? '+' : '') + v.toFixed(2)}</div>${pill(g[0], g[1])}</div><p class="small muted" style="margin:0">${reg === 'global' ? '글로벌 영역은 미국 70%·한국 30%로 합성하며, 아래는 미국 기준 세부 지표입니다. ' : ''}이 영역을 구성하는 지표 ${list.length}개의 평균입니다(‘확인 불가’는 평균에서 제외). 눌러서 지표별 설명·추이를 볼 수 있습니다.</p>${list.map(x => `<button class="sig" data-dt="ind:${reg === 'global' ? 'us' : reg}:${x.id}" style="grid-template-columns:1fr auto;width:100%;background:none;border:0;border-bottom:1px solid var(--line);font:inherit;color:inherit;text-align:left;cursor:pointer"><div><div>${esc(x.label)}</div><div class="small muted">${esc(x.note)}</div></div><div class="right"><b>${esc(x.fmt)}</b><div>${x.score == null ? pill('확인 불가', 'mut') : pill((x.score > 0 ? '+' : '') + x.score, x.score > 0 ? 'good' : x.score < 0 ? 'bad' : 'mut')}</div></div></button>`).join('')}`;
}

/* ───────── 종목: 투자지표(PER 등) ───────── */
const VAL_NAMES = { PeRatio: ['PER(주가수익비율)', '주가 ÷ 주당순이익(최근 12개월). 낮을수록 이익 대비 싸지만 업종·성장성에 따라 기준이 다릅니다.'], ForwardPeRatio: ['선행 PER', '야후가 제공하는 예상 이익 기준 PER. 추정치 오류가 있을 수 있어 참고만 하세요.'], PbRatio: ['PBR(주가순자산비율)', '주가 ÷ 주당순자산. 1 미만이면 장부가보다 싼 상태(자산형 업종에서 의미).'], PsRatio: ['PSR(주가매출비율)', '시가총액 ÷ 매출. 적자 성장주 비교에 쓰입니다.'], PegRatio: ['PEG', 'PER ÷ 이익성장률. 추정치 기반이라 참고만 하세요.'], EnterprisesValueEBITDARatio: ['EV/EBITDA', '기업가치(시총+순부채) ÷ 영업이익+감가상각. 부채 구조가 다른 기업 비교용.'], MarketCap: ['시가총액', '', ''], DilutedEPS: ['주당순이익(EPS, 12개월)', '', ''] };
const FUNDX = {}; let fundxLoaded = false, fundxBusy = {};
const valRaw = sym => (FUND[sym] && FUND[sym].raw) || (FUNDX[sym] && FUNDX[sym].raw) || null;
async function ensureFundRaw(sym) {
  const w = S.watch.find(x => x.sym === sym); if (!w || w.type === 'etf' || valRaw(sym) || fundxBusy[sym]) return;
  if (!fundxLoaded) { fundxLoaded = true; try { Object.assign(FUNDX, (await IDB.get('fundx')) || {}); } catch (e) { } if (valRaw(sym)) return; }
  const b = proxyBase(); if (!b) return; fundxBusy[sym] = 1;
  try { const j = await jget(b + '/api/fund?s=' + encodeURIComponent(sym), 12000); if (j && j.a) { FUNDX[sym] = { raw: j, t: Date.now() }; IDB.set('fundx', FUNDX); } else FUNDX[sym] = { raw: { a: {}, t: {} }, t: Date.now() }; } catch (e) { fundxBusy[sym] = 0; return; }
  if (view === 'stock' && curSym === sym) softRender();
}
const lastOf = (o) => { if (!o) return null; const k = Object.keys(o).sort(); return k.length ? o[k.at(-1)] : null; };
const prevOf = (o, back = 1) => { if (!o) return null; const k = Object.keys(o).sort(); return k.length > back ? o[k[k.length - 1 - back]] : null; };
function valCalc(sym) {
  const raw = valRaw(sym), a = raw && raw.a || {}, t = raw && raw.t || {}, f = FUND[sym] || {}, px = priceOf(sym), o = {};
  const tl = k => t[k] && t[k].length ? t[k].at(-1) : null, eps = tl('DilutedEPS'), mc = tl('MarketCap'), ni = lastOf(a.NetIncome), rev = lastOf(a.TotalRevenue), oi = lastOf(a.OperatingIncome), eq = lastOf(a.StockholdersEquity), debt = lastOf(a.TotalDebt), cash = lastOf(a.CashAndCashEquivalents), fcf = lastOf(a.FreeCashFlow), ocf = lastOf(a.OperatingCashFlow), div = lastOf(a.CashDividendsPaid);
  o.eps = eps ? eps[1] : null; o.per = px && o.eps > 0 ? px / o.eps : (o.eps != null ? 'neg' : null); o.perAsof = eps ? eps[0] : null;
  const perH = (t.PeRatio || []).map(x => x[1]).filter(x => x > 0); o.perMed = perH.length >= 4 ? perH.slice().sort((x, y) => x - y)[Math.floor(perH.length / 2)] : null;
  o.fper = tl('ForwardPeRatio'); o.pbr = tl('PbRatio'); o.psr = tl('PsRatio'); o.evebitda = tl('EnterprisesValueEBITDARatio'); o.peg = tl('PegRatio'); o.mc = mc ? mc[1] : null; o.mcAsof = mc ? mc[0] : null;
  o.pcf = px && f.cfps > 0 ? px / f.cfps : null; o.cfy = px && f.cfps > 0 ? f.cfps / px : null; o.fcfy = fcf && o.mc ? fcf / o.mc : null; o.cagr = f.cagr ?? null;
  o.roe = ni != null && eq > 0 ? ni / eq : null; o.opm = oi != null && rev > 0 ? oi / rev : null; o.npm = ni != null && rev > 0 ? ni / rev : null; o.de = debt != null && eq > 0 ? debt / eq : null; o.netcash = debt != null && cash != null ? cash - debt : null;
  const rp = prevOf(a.TotalRevenue), np = prevOf(a.NetIncome); o.revg = rev != null && rp > 0 ? rev / rp - 1 : null; o.nig = ni != null && np > 0 ? ni / np - 1 : null; o.divy = div != null && o.mc ? -div / o.mc : null;
  o.year = a.TotalRevenue ? Object.keys(a.TotalRevenue).sort().at(-1) : null; o.has = !!(raw && (Object.keys(a).length || Object.keys(t).length)); return o;
}
function valCard(sym) {
  const w = S.watch.find(x => x.sym === sym), ent = FEAT[sym], lv = LIVE[sym]; if (!w || !ent) return '';
  const Fx = ent.F, B = Fx.B, i = Fx.n - 1, fm = (x, d = 1) => x == null || !isFinite(x) ? '–' : x.toFixed(d), pc = (x, d = 1) => x == null || !isFinite(x) ? '–' : (x * 100).toFixed(d) + '%';
  const row = (name, val, tone, note, dtk) => `<${dtk ? 'button data-dt="' + dtk + '"' : 'div'} class="sig" style="grid-template-columns:1fr auto;width:100%;${dtk ? 'background:none;border:0;border-bottom:1px solid var(--line);font:inherit;color:inherit;text-align:left;cursor:pointer' : ''}"><div><div>${name}${dtk ? ' <span class="muted small">›</span>' : ''}</div><div class="small muted">${note}</div></div><div class="right"><b>${val}</b>${tone ? '<div>' + pill(tone[0], tone[1]) + '</div>' : ''}</div></${dtk ? 'button' : 'div'}>`;
  const T = (v, good, bad, lowGood) => v == null || !isFinite(v) ? null : lowGood ? (v <= good ? ['양호', 'good'] : v >= bad ? ['부담', 'warn'] : ['보통', 'mut']) : (v >= good ? ['양호', 'good'] : v <= bad ? ['약함', 'warn'] : ['보통', 'mut']);
  let h = `<div class="card"><h2>투자지표 <span class="muted small">두 채널 관점별 · 점수에는 반영하지 않는 참고 정보</span></h2>`;
  h += `<h3 style="margin-top:4px">디벨롭 관점 — 추세·타이밍 <span class="muted small">(가격 기반)</span></h3>${row('고점(52주) 대비', pc(B.dd[i]), B.dd[i] <= -.2 ? ['눌림', 'good'] : null, '많이 빠질수록 분할 매수 구간(레버리지는 기초지수 환산)')}${row('200일선 이격', pc(B.dev200[i]), B.dev200[i] >= .25 ? ['과열', 'warn'] : B.dev200[i] <= -.1 ? ['아래', 'good'] : null, '200일 이동평균 대비 현재가 위치')}${row('주봉 RSI', fm(B.rW[i]), B.rW[i] >= 70 ? ['과열', 'warn'] : B.rW[i] <= 40 ? ['침체', 'good'] : null, '70↑ 과열 · 40↓ 침체(디벨롭 기준)')}${row('일봉 RSI', fm(B.rD[i]), B.rD[i] >= 70 ? ['과열', 'warn'] : B.rD[i] <= 30 ? ['과매도', 'good'] : null, '30↓ 과매도 · 70↑ 과매수')}`;
  const v = valCalc(sym);
  if (w.type === 'etf' && !v.has) { h += `<p class="small muted" style="margin:10px 0 0">ETF는 개별 기업의 재무지표(PER·ROE 등)가 없어 가격 기반 지표만 표시합니다.</p></div>`; return h; }
  if (!v.has) { h += `<p class="small muted" style="margin:10px 0 0">${proxyBase() ? '재무 데이터를 불러오는 중이거나, 이 종목은 야후에 재무 자료가 없습니다.' : '재무 데이터를 받을 실시간 워커 주소가 없어 표시하지 못했습니다.'}</p></div>`; return h; }
  const cur = isKR(sym) ? '₩' : '$', big = x => x == null ? '–' : (Math.abs(x) >= 1e12 ? (x / 1e12).toFixed(2) + '조' : Math.abs(x) >= 1e8 ? (x / 1e8).toFixed(0) + '억' : x.toFixed(0));
  const bigU = x => x == null ? '–' : Math.abs(x) >= 1e12 ? cur + (x / 1e12).toFixed(2) + 'T' : Math.abs(x) >= 1e9 ? cur + (x / 1e9).toFixed(1) + 'B' : cur + (x / 1e6).toFixed(0) + 'M';
  const fair = ent.fair, pf = fair ? lv.price / fair : null;
  h += `<h3 style="margin-top:14px">도키 관점 — 현금흐름·가치 <span class="muted small">(영업현금흐름 중심)</span></h3>`;
  h += row('주가 ÷ 영업현금흐름(P/CF)', v.pcf != null ? fm(v.pcf) + '배' : '–', T(v.pcf, 18, 30, true), '도키는 영업현금흐름 기반 18배를 적정 멀티플로 사용 (' + (FUND[sym] ? '기준 ' + FUND[sym].asof : '') + ')');
  h += row('영업현금흐름 수익률', pc(v.cfy), T(v.cfy, .055, .02), '주당 영업현금흐름 ÷ 주가 (높을수록 싸다)');
  h += row('잉여현금흐름(FCF) 수익률', pc(v.fcfy), T(v.fcfy, .04, 0), '설비투자까지 뺀 현금 ÷ 시가총액. 도키는 설비투자 부담도 확인', null);
  h += row('영업현금흐름 연평균 성장(CAGR)', pc(v.cagr, 0), T(v.cagr, .15, 0), '적정가 계산에 5~20% 범위로 보수 반영');
  h += row('적정가 대비 현재가', pf != null ? (pf * 100).toFixed(0) + '%' : '–', pf == null ? null : pf <= .85 ? ['저평가', 'good'] : pf >= 1.2 ? ['고평가', 'warn'] : ['적정권', 'mut'], fair ? '적정가 ' + fmtPx(sym, fair) + ' (' + ent.fairSrc + ')' : '적정가 계산 불가(현금흐름 부족)');
  h += `<h3 style="margin-top:14px">밸류에이션 <span class="muted small">(일반 지표 — 두 채널이 핵심으로 쓰진 않음)</span></h3>`;
  const perTxt = v.per === 'neg' ? '적자' : v.per != null ? fm(v.per) + '배' : '–', perNote = (v.per > 0 && v.perMed ? `과거 중앙값 ${fm(v.perMed)}배 대비 ${(v.per / v.perMed * 100).toFixed(0)}%` : '주가 ÷ 12개월 주당순이익') + (v.perAsof ? ` · EPS ${v.eps != null ? v.eps.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '–'} (${v.perAsof})` : '');
  h += row('PER', perTxt, typeof v.per === 'number' && v.perMed ? (v.per <= v.perMed * .85 ? ['과거보다 낮음', 'good'] : v.per >= v.perMed * 1.2 ? ['과거보다 높음', 'warn'] : ['과거 수준', 'mut']) : null, perNote, 'val:' + sym + ':PeRatio');
  h += row('선행 PER (야후 추정)', v.fper != null ? fm(v.fper) + '배' : '–', null, '추정치라 틀릴 수 있음 — 참고만', 'val:' + sym + ':ForwardPeRatio');
  h += row('PBR', v.pbr != null ? fm(v.pbr, 2) + '배' : '–', null, '주가 ÷ 주당순자산', 'val:' + sym + ':PbRatio');
  h += row('PSR', v.psr != null ? fm(v.psr, 2) + '배' : '–', null, '시가총액 ÷ 매출', 'val:' + sym + ':PsRatio');
  h += row('EV/EBITDA', v.evebitda != null ? fm(v.evebitda) + '배' : '–', null, '부채까지 포함한 기업가치 ÷ 영업이익+감가상각', 'val:' + sym + ':EnterprisesValueEBITDARatio');
  h += row('시가총액', bigU(v.mc), null, v.mcAsof ? '기준 ' + v.mcAsof : '', 'val:' + sym + ':MarketCap');
  h += row('배당수익률', pc(v.divy), null, '연간 배당 지급액 ÷ 시가총액');
  h += `<h3 style="margin-top:14px">재무 건전성 <span class="muted small">(${esc(v.year || '')} 사업연도 기준)</span></h3>`;
  h += row('ROE (자기자본이익률)', pc(v.roe), T(v.roe, .15, .05), '순이익 ÷ 자기자본 — 15%↑ 양호');
  h += row('영업이익률', pc(v.opm), T(v.opm, .2, .05), '영업이익 ÷ 매출');
  h += row('순이익률', pc(v.npm), T(v.npm, .15, .03), '순이익 ÷ 매출');
  h += row('매출 증가율 (전년 대비)', pc(v.revg), T(v.revg, .1, 0), '');
  h += row('순이익 증가율 (전년 대비)', pc(v.nig), T(v.nig, .1, 0), '');
  h += row('부채 ÷ 자기자본', v.de != null ? (v.de * 100).toFixed(0) + '%' : '–', T(v.de, 1, 2, true), v.netcash != null ? (v.netcash >= 0 ? '순현금 ' : '순부채 ') + bigU(Math.abs(v.netcash)) : '100% 이하 양호 · 200%↑ 부담');
  h += `<p class="small muted" style="margin:10px 0 0">두 채널은 영상에서 <b>영업현금흐름 기반 적정주가·설비투자·추세(200일선)·RSI</b>를 핵심으로 다룹니다. PER·PBR 등은 일반 참고 지표이며, ‘양호·부담’ 표시는 통용되는 대략적 기준이라 <b>업종마다 다릅니다</b>. 야후 파이낸스 재무 자료(분기 갱신·지연·오류 가능) 기반이고 매수 점수에는 반영되지 않습니다.</p></div>`;
  return h;
}

/* ───────── 종목: 3관점 비교 ───────── */
function lensCompare(sym) {
  const ent = FEAT[sym], lv = LIVE[sym]; if (!ent || !lv) return '';
  const Fx = ent.F, prm = params(), cur = S.settings.lens, R = { P: E.explain(Fx, 'P', prm), D: E.explain(Fx, 'D', prm) };
  const sg = rows => { const on = rows.filter(r => r.on && r.type !== 'warn' && !r.na), off = rows.filter(r => !r.on && r.type !== 'warn' && !r.na), warn = rows.filter(r => r.on && r.type === 'warn'); return { on, off, warn }; };
  const li = r => `<div class="small" style="padding:2px 0"><span class="${r.type === 'warn' ? 'neg' : 'pos'}">●</span> ${esc(r.label)} <span class="muted">— ${esc(r.detail)}${r.pts ? ' (' + (r.pts > 0 ? '+' : '') + r.pts + ')' : ''}</span></div>`, lo = r => `<div class="small muted" style="padding:2px 0">○ ${esc(r.label)} — ${esc(r.detail)}</div>`;
  const blocks = ['P', 'D', 'C'].map(L => {
    const p = planFor(sym, L), x = lv.lens[L]; let body = '';
    if (L === 'C') {
      const a = sg(R.P), b = sg(R.D); body = `<div class="small" style="margin:6px 0">통합 = (디벨롭 ${lv.lens.P.score} + 도키 ${lv.lens.D.score}) ÷ 2, 두 관점이 모두 기준 이상이면 +8, 한쪽이 매우 낮으면 -8. <b>두 관점이 동시에 켜져야 신호가 강한</b> 보수적 기준입니다.</div>
      <div class="small b">두 관점 공통으로 켜진 신호</div>${a.on.filter(r => b.on.some(q => q.id === r.id)).map(li).join('') || '<div class="small muted">공통 신호 없음</div>'}`;
    } else { const g = sg(R[L]); body = `<div class="small b" style="margin-top:6px">켜진 신호 (${g.on.length}개)</div>${g.on.map(li).join('') || '<div class="small muted">켜진 신호 없음</div>'}${g.warn.length ? '<div class="small b" style="margin-top:6px">경고</div>' + g.warn.map(li).join('') : ''}<div class="small b" style="margin-top:6px">아직 안 켜진 신호 (${g.off.length}개)</div>${g.off.map(lo).join('') || '<div class="small muted">모두 켜짐</div>'}`; }
    const why = L === 'P' ? '디벨롭: 낙폭·200일선·RSI·MACD·VIX 등 <b>시장 타이밍(기술적) 신호</b>를 겹쳐 분할 매수.' : L === 'D' ? '도키: <b>적정주가·추세·지지선</b> 등 가치/구조 신호 + 비중 관리를 중시.' : '두 관점의 합의.';
    return `<details class="rule" ${L === cur ? 'open' : ''}><summary style="cursor:pointer;list-style:none"><div class="row">${ring(x.score, L)}<div style="flex:1;min-width:0"><div><b style="color:${LC[L]}">${LN[L]}</b> ${actPill(x, p)}</div><div class="small">${esc(p.label)}</div></div></div></summary>
      <div class="small muted" style="margin:6px 0">${why}</div>${p.lines.map(l => `<div class="small">• ${esc(l)}</div>`).join('')}${p.amount ? `<div class="small b" style="margin-top:4px">권장 ${fmtAmt(sym, p.amount)} (${p.shares}주)</div>` : ''}${body}</details>`;
  }).join('');
  const ks = typeof stanceOf === 'function' && typeof KN !== 'undefined' && KN && !KN.none ? ['dm', 'doki'].map(c => { const v = stanceOf(c)[sym]; return v && v.m30 ? `<span class="small">${c === 'dm' ? '디벨롭' : '도키'} 최근 30일 ${v.m30}회 언급${v.bull > v.bear ? ' · 우호' : v.bear > v.bull ? ' · 경계' : ''}</span>` : ''; }).filter(Boolean).join(' · ') : '';
  return `<div class="card"><h2>세 관점 한눈에 <span class="muted small">눌러서 펼치기</span></h2>${blocks}${ks ? `<p class="small muted" style="margin:8px 0 0">채널 언급: ${ks}</p>` : ''}<p class="small muted" style="margin:6px 0 0">점수는 확률이 아닙니다. 과거 검증에서 의미가 있었던 건 <b>신호가 처음 켜진 구간</b>뿐이라 앱은 ‘신규 신호’만 매수로 안내합니다.</p></div>`;
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
function stackTables() {
  document.querySelectorAll('.tw > table:not([data-stk])').forEach(t => {
    const ths = [...t.querySelectorAll('thead th')]; if (ths.length < 6 || t.querySelectorAll('tbody tr').length > 5) { t.dataset.stk = '0'; return; }
    const lab = ths.map(x => x.innerHTML.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
    t.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => { if (i && lab[i]) { td.dataset.lab = lab[i]; td.innerHTML = '<span class="v">' + td.innerHTML + '</span>'; } }));
    t.classList.add('stk'); t.dataset.stk = '1';
  });
}
try { new MutationObserver(stackTables).observe(document.querySelector('main'), { childList: true, subtree: true }); } catch (e) { }
