'use strict';
/* 디벨롭 — 포지션·수급 화면: 옵션 미결제약정(OCC), 선물 포지션(CFTC), 공매도(FINRA·Nasdaq), 기관 보유(Nasdaq), 한국 투자자별 순매매(네이버)
   데이터는 tools/position_collect.py 가 만든 data/pos/*.json. 모두 참고 정보이며 매수 점수에는 반영하지 않는다.
   app.js 보다 먼저 로드되며 전역(S, PX, view, esc, F, pill, jget, IDB, softRender, wkSpark, fmtPx, isKR)은 호출 시점에 참조한다. */
const POS = {}, POS_AT = {}, POS_SEL = {}; let COT_SEL = 'NQ', IDX_SEL = 'SPX';
const posFile = s => s.replace('^', '_');
async function loadPos(name) {
  if (POS_AT[name] && Date.now() - POS_AT[name] < 36e5) return;
  POS_AT[name] = Date.now();
  let got = null;
  try { got = await jget(`data/pos/${name}.json?t=${Math.floor(Date.now() / 36e5)}`, 10000, { cache: 'no-store' }); IDB.set('pos:' + name, got); }
  catch (e) { try { got = await IDB.get('pos:' + name); } catch (x) { } if (!got) POS_AT[name] = Date.now() - 36e5 + 6e4; }
  POS[name] = got || { missing: true };
  if (view === 'stock' || view === 'market') softRender();
}
const qty = v => v == null || !isFinite(v) ? '–' : Math.abs(v) >= 1e8 ? (v / 1e8).toFixed(1) + '억' : Math.abs(v) >= 1e4 ? (v / 1e4).toFixed(Math.abs(v) >= 1e6 ? 0 : 1) + '만' : Math.round(v).toLocaleString('ko-KR');
const sgn = v => v == null || !isFinite(v) ? '–' : (v > 0 ? '+' : '') + qty(v);
const daysLeft = d => Math.max(0, Math.round((Date.parse(d) - Date.parse(new Date().toISOString().slice(0, 10))) / 864e5));
const niceStep = x => { const p = Math.pow(10, Math.floor(Math.log10(x))), m = x / p; return (m < 1.5 ? 1 : m < 3.5 ? 2.5 : m < 7.5 ? 5 : 10) * p; };

const staleNote = t => { if (!t) return ''; const h = (Date.now() / 1000 - t) / 3600, when = new Date(t * 1000).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', hour12: false }); return h > 48 ? `<div class="note small" style="margin-bottom:8px">자료 갱신이 ${Math.floor(h / 24)}일 지연되고 있습니다(마지막 수집 ${esc(when)}).</div>` : `<p class="small muted" style="margin:0 0 8px">마지막 수집 ${esc(when)}</p>`; };

/* ───────── 옵션 미결제약정 ───────── */
function optChart(rows, spot, wide) {
  if (!rows.length || !spot) return '<p class="muted small">표시할 행사가 자료가 없습니다.</p>';
  const lo = spot * (wide ? 0.6 : 0.8), hi = spot * (wide ? 2 : 1.2), step = niceStep((hi - lo) / 18), bins = new Map();
  rows.forEach(([k, c, p]) => { if (k < lo || k > hi) return; const b = Math.round(k / step) * step, v = bins.get(b) || [0, 0]; v[0] += c; v[1] += p; bins.set(b, v); });
  const list = [...bins.entries()].sort((a, b) => b[0] - a[0]); if (!list.length) return '<p class="muted small">현재가 근처에 쌓인 계약이 없습니다.</p>';
  const mx = list.reduce((m, [, v]) => Math.max(m, v[0], v[1]), 1), spotBin = list.reduce((a, [k]) => (Math.abs(k - spot) < Math.abs(a - spot) ? k : a), list[0][0]);
  const dec = step < 1 ? 2 : step < 5 && step % 1 ? 1 : 0;
  return `<div class="oc" role="img" aria-label="행사가별 미결제약정 막대 그래프"><div class="oc-h"><span>풋(하락 대비)</span><span>행사가</span><span>콜(상승 대비)</span></div>${list.map(([k, [c, p]]) => `<div class="oc-r${k === spotBin ? ' now' : ''}"><div class="oc-p"><em>${p ? qty(p) : ''}</em><i style="width:${(p / mx * 100).toFixed(1)}%"></i></div><b>${k.toLocaleString('en-US', { maximumFractionDigits: dec })}</b><div class="oc-c"><i style="width:${(c / mx * 100).toFixed(1)}%"></i><em>${c ? qty(c) : ''}</em></div></div>`).join('')}</div><p class="small muted" style="margin:4px 0 0">강조된 줄이 현재가(${spot.toLocaleString('en-US', { maximumFractionDigits: 2 })}) 근처입니다. 행사가를 ${step.toLocaleString('en-US')} 단위로 묶어 현재가 ${wide ? '60%~200%' : '±20%'} 범위만 표시합니다.</p>`;
}
function optBlock(key, o, opts) {
  opts = opts || {}; const exps = o.expiries || [], today = new Date().toISOString().slice(0, 10), live = exps.filter(e => e.d >= today);
  let sel = POS_SEL[key]; if (!sel || (sel !== 'all' && !live.some(e => e.d === sel))) sel = (live.find(e => e.monthly && daysLeft(e.d) >= 7) || live[0] || {}).d || 'all';
  const e = sel === 'all' ? null : live.find(x => x.d === sel), rows = e ? e.strikes : o.all.strikes, c = e ? e.c : o.all.c, p = e ? e.p : o.all.p, spot = o.spot;
  const above = spot ? rows.filter(r => r[0] >= spot && r[1]).sort((a, b) => b[1] - a[1])[0] : null, below = spot ? rows.filter(r => r[0] <= spot && r[2]).sort((a, b) => b[2] - a[2])[0] : null;
  const dist = k => spot ? F.pct(k / spot - 1) : '–', share = c + p ? c / (c + p) * 100 : 50;
  let h = `<div class="chips" style="margin-bottom:8px">${live.map(x => `<button class="chip" data-pexp="${esc(key)}|${x.d}" aria-pressed="${sel === x.d}">${x.d.slice(5).replace('-', '/')}${x.monthly ? '·월' : ''} <span class="small muted">${daysLeft(x.d)}일</span></button>`).join('')}<button class="chip" data-pexp="${esc(key)}|all" aria-pressed="${sel === 'all'}">전체 만기</button></div>`;
  h += `<div class="pc"><i class="pc-c" style="width:${share.toFixed(1)}%"></i></div><div class="row small" style="justify-content:space-between;margin:4px 0 10px"><span>콜 <b>${qty(c)}</b>계약</span><span>풋/콜 <b>${c ? (p / c).toFixed(2) : '–'}</b></span><span>풋 <b>${qty(p)}</b>계약</span></div>`;
  h += `<dl class="kv" style="margin-bottom:10px"><dt>선택 만기</dt><dd>${e ? esc(e.d) + ' (' + daysLeft(e.d) + '일 남음)' : '전체 합산'}</dd><dt>위쪽에 가장 많이 쌓인 콜</dt><dd>${above ? above[0].toLocaleString('en-US') + ' <span class="muted small">(' + dist(above[0]) + ', ' + qty(above[1]) + ')</span>' : '–'}</dd><dt>아래쪽에 가장 많이 쌓인 풋</dt><dd>${below ? below[0].toLocaleString('en-US') + ' <span class="muted small">(' + dist(below[0]) + ', ' + qty(below[2]) + ')</span>' : '–'}</dd>${e && e.pain != null ? `<dt>맥스페인(만기 참고가)</dt><dd>${e.pain.toLocaleString('en-US')} <span class="muted small">(${dist(e.pain)})</span></dd>` : ''}</dl>`;
  h += optChart(rows, spot, opts.wide);
  h += `<details style="margin-top:8px"><summary class="small b" style="cursor:pointer">만기별 계약 수 보기</summary><div class="tw"><table><thead><tr><th>만기</th><th class="n">남은 일</th><th class="n">콜</th><th class="n">풋</th><th class="n">풋/콜</th></tr></thead><tbody>${(o.byExpiry || []).filter(r => r[0] >= today).slice(0, 14).map(r => `<tr><td>${esc(r[0])}</td><td class="n">${daysLeft(r[0])}</td><td class="n">${qty(r[1])}</td><td class="n">${qty(r[2])}</td><td class="n">${r[1] ? (r[2] / r[1]).toFixed(2) : '–'}</td></tr>`).join('')}</tbody></table></div></details>`;
  h += `<p class="small muted" style="margin:8px 0 0"><b>롱/숏으로 단정할 수 없습니다.</b> 옵션 계약에는 항상 산 사람과 판 사람이 함께 있어, 미결제약정만으로는 누가 어느 방향인지 알 수 없습니다(풋은 하락 베팅뿐 아니라 보험·매도 전략에도 쓰입니다). 계약이 많이 쌓인 행사가는 흔히 지지·저항 후보로 보지만 보장은 없고, 만기가 지나면 사라집니다. 자료: 옵션청산회사(OCC), 수집일 ${esc(o.asof)} (전 영업일 기준)${o.approxSpot ? ' · 지수 현재가는 ETF로 추정한 근사값' : ''}. 점수에는 반영하지 않습니다.</p>`;
  return h;
}

/* ───────── 종목 탭 카드 ───────── */
function posCard(sym) {
  const name = posFile(sym), d = POS[name]; loadPos(name);
  if (!d) return `<div class="card"><h2>포지션·수급 <span class="muted small">불러오는 중</span></h2><p class="muted small">자료를 불러오는 중입니다…</p></div>`;
  if (d.missing) return `<div class="card"><h2>포지션·수급 <span class="muted small">자료 없음</span></h2><p class="muted small" style="margin:0">이 종목은 수집 목록(data/universe.json) 밖이거나 아직 수집 전입니다. 목록 밖 종목은 자료를 받지 않습니다.</p></div>`;
  return isKR(sym) ? krCard(sym, d) : (d.opt ? `<div class="card"><h2>옵션 포지션 <span class="muted small">행사가·만기별 미결제약정 · 참고</span></h2>${staleNote(d.t)}${optBlock('s:' + sym, d.opt)}</div>` : '') + flowCard(sym, d);
}
function flowCard(sym, d) {
  const sv = (d.shortVol || []).filter(r => r[2] > 0), si = d.shortInt || [], ins = d.inst; if (!sv.length && !si.length && !ins) return '';
  let h = `<div class="card"><h2>공매도·기관 수급 <span class="muted small">참고 · 점수 미반영</span></h2>`;
  if (sv.length) {
    const ser = sv.map(r => r[1] / r[2] * 100), last = ser.at(-1), n = Math.min(20, ser.length), avg = ser.slice(-n).reduce((a, b) => a + b, 0) / n;
    h += `<h3 style="margin-top:0">일별 공매도 거래 비중</h3><button class="sig" data-dt="sv:${esc(sym)}" style="grid-template-columns:1fr auto;width:100%;background:none;border:0;border-bottom:1px solid var(--line);font:inherit;color:inherit;text-align:left;cursor:pointer"><div><div>${esc(sv.at(-1)[0])} <span class="muted small">›</span></div><div class="small muted">최근 ${n}일 평균 ${avg.toFixed(1)}%</div>${wkSpark(ser.slice(-40), true, true)}</div><div class="right"><b>${last.toFixed(1)}%</b></div></button><p class="small muted" style="margin:4px 0 8px">하루 거래 중 공매도로 체결된 비율입니다(FINRA 장외 보고 기준). 시장조성자의 거래도 포함돼 <b>이 비율이 곧 숏 포지션 규모는 아닙니다</b>.</p>`;
  }
  if (si.length) {
    const a = si[0], b = si[1], chg = b && b[1] ? a[1] / b[1] - 1 : null;
    h += `<h3>공매도 잔고(숏 포지션 규모) <span class="muted small">격주 발표</span></h3><dl class="kv"><dt>기준 결제일</dt><dd>${esc(a[0])}</dd><dt>공매도 잔고</dt><dd>${qty(a[1])}주 ${chg != null ? `<span class="small muted">(${F.pct(chg)})</span>` : ''}</dd><dt>갚는 데 걸리는 날(거래량 기준)</dt><dd>${a[3] != null ? (+a[3]).toFixed(1) + '일' : '–'}</dd></dl><details style="margin-top:6px"><summary class="small b" style="cursor:pointer">지난 기록</summary><div class="tw"><table><thead><tr><th>결제일</th><th class="n">잔고</th><th class="n">일수</th></tr></thead><tbody>${si.slice(0, 8).map(r => `<tr><td>${esc(r[0])}</td><td class="n">${qty(r[1])}</td><td class="n">${r[3] != null ? (+r[3]).toFixed(1) : '–'}</td></tr>`).join('')}</tbody></table></div></details>`;
  }
  if (ins) {
    const H = ins.holders || {}, g = k => (H[k] ? H[k][0] : null), inc = g('Increased Positions'), dec = g('Decreased Positions'), tot = (inc || 0) + (dec || 0);
    h += `<h3>기관 보유 <span class="muted small">13F 기반 · 분기 지연</span></h3><dl class="kv"><dt>기관 보유 비율</dt><dd>${ins.pct != null ? ins.pct.toFixed(1) + '%' : '–'}</dd><dt>지분을 늘린 / 줄인 기관</dt><dd>${inc != null ? inc.toLocaleString() : '–'} / ${dec != null ? dec.toLocaleString() : '–'}</dd><dt>새로 산 / 전부 판 기관</dt><dd>${g('New Positions') != null ? g('New Positions').toLocaleString() : '–'} / ${g('Sold Out Positions') != null ? g('Sold Out Positions').toLocaleString() : '–'}</dd></dl>${tot ? `<div class="pc" style="margin-top:6px"><i class="pc-c" style="width:${(inc / tot * 100).toFixed(1)}%"></i></div><div class="row small" style="justify-content:space-between"><span>늘림</span><span>줄임</span></div>` : ''}<details style="margin-top:6px"><summary class="small b" style="cursor:pointer">상위 보유 기관</summary><div class="tw"><table><thead><tr><th>기관</th><th class="n">보유 주식</th><th class="n">변화</th></tr></thead><tbody>${(ins.top || []).map(t => `<tr><td>${esc(t.name)}<div class="small muted">${esc(t.date)}</div></td><td class="n">${qty(t.shares)}</td><td class="n ${cls(t.chg)}">${sgn(t.chg)}</td></tr>`).join('')}</tbody></table></div></details><p class="small muted" style="margin:6px 0 0">보유 공시는 분기말 기준이라 최대 몇 달 늦습니다. 출처: Nasdaq 공개 자료.</p>`;
  }
  h += `<p class="small muted" style="margin:8px 0 0">개인 투자자의 미국 주식 보유·매매는 무료 공개 자료가 없어 선물의 ‘소규모 참여자’(시장 탭)로만 간접 확인합니다.</p></div>`;
  return h;
}
function krCard(sym, d) {
  const r = d.kr || []; if (!r.length) return '';
  const G = [['개인', 1, 'ind'], ['기관', 2, 'inst'], ['외국인', 3, 'frgn']], sum = (i, n) => r.slice(-n).reduce((a, x) => a + (x[i] || 0), 0);
  const cum = i => { let s = 0; return r.map(x => (s += x[i] || 0)); };
  return `<div class="card"><h2>투자자별 순매매 <span class="muted small">개인·기관·외국인 · 일별 · 참고</span></h2>${staleNote(d.t)}
  <div class="tw"><table><thead><tr><th>구분</th><th class="n">최근일</th><th class="n">5일</th><th class="n">20일</th></tr></thead><tbody>${G.map(([nm, i]) => `<tr><td><b>${nm}</b></td><td class="n ${cls(r.at(-1)[i])}">${sgn(r.at(-1)[i])}</td><td class="n ${cls(sum(i, 5))}">${sgn(sum(i, 5))}</td><td class="n ${cls(sum(i, 20))}">${sgn(sum(i, 20))}</td></tr>`).join('')}</tbody></table></div>
  <h3>누적 순매수 흐름 <span class="muted small">최근 ${r.length}거래일 · 눌러서 상세</span></h3>${G.map(([nm, i, k]) => { const c = cum(i); return `<button class="sig" data-dt="kr:${esc(sym)}:${k}" style="grid-template-columns:1fr auto;width:100%;background:none;border:0;border-bottom:1px solid var(--line);font:inherit;color:inherit;text-align:left;cursor:pointer"><div><div>${nm} <span class="muted small">›</span></div>${wkSpark(c, true, true)}</div><div class="right"><b class="${cls(c.at(-1))}">${sgn(c.at(-1))}</b><div class="small muted">누적(주)</div></div></button>`; }).join('')}
  <p class="small muted" style="margin:8px 0 0">외국인 보유율 ${r.at(-1)[5] != null ? r.at(-1)[5].toFixed(2) + '%' : '–'} · 기준일 ${esc(r.at(-1)[0])} · 수량은 주(株) 기준, +는 순매수입니다. 매수 주체가 사고판 사실일 뿐 앞으로의 방향을 뜻하지 않습니다. 출처: 네이버 금융.</p></div>`;
}

/* ───────── 시장 탭: 선물 포지션(CFTC) · 지수 옵션 ───────── */
const COT_GROUPS = [['am', '자산운용사', '연기금·펀드 등 기관'], ['lev', '레버리지 펀드', '헤지펀드 등'], ['dealer', '딜러', '은행·증권사(고객의 반대편에 서는 경우가 많음)'], ['small', '소규모 참여자', '보고 의무가 없는 작은 거래자(개인 추정)']];
function cotCard() {
  const d = POS.cot; loadPos('cot');
  if (!d || !d.markets) return `<div class="card"><h2>선물 포지션 <span class="muted small">${d ? '자료 없음' : '불러오는 중'}</span></h2></div>`;
  const keys = Object.keys(d.markets); if (!keys.includes(COT_SEL)) COT_SEL = keys[0]; const m = d.markets[COT_SEL], h = m.hist, a = h.at(-1), b = h.at(-2);
  const rows = COT_GROUPS.map(([k, nm, desc]) => {
    const [l, s] = a[k], net = l - s, prev = b ? b[k][0] - b[k][1] : null, tot = l + s || 1, ser = h.map(x => x[k][0] - x[k][1]);
    return `<button class="cot" data-dt="cot:${COT_SEL}:${k}"><div class="row" style="justify-content:space-between"><b>${nm}</b><span class="${cls(net)}">순 ${sgn(net)} <span class="small muted">${prev != null ? '(주간 ' + sgn(net - prev) + ')' : ''}</span></span></div><div class="small muted">${desc}</div><div class="pc"><i class="pc-c" style="width:${(l / tot * 100).toFixed(1)}%"></i></div><div class="row small" style="justify-content:space-between"><span>롱 ${qty(l)} (${(l / tot * 100).toFixed(0)}%)</span><span>숏 ${qty(s)} (${(s / tot * 100).toFixed(0)}%)</span></div>${wkSpark(ser.slice(-52), true, true)}<span class="small muted"> 순포지션 1년 추이 ›</span></button>`;
  }).join('');
  return `<div class="card"><h2>선물 포지션(롱·숏) <span class="muted small">CFTC 주간 · ${esc(a.d)} 화요일 기준</span></h2><div class="chips" style="margin-bottom:8px">${keys.map(k => `<button class="chip" data-pcot="${esc(k)}" aria-pressed="${k === COT_SEL}">${esc(d.markets[k].name)}</button>`).join('')}</div>${staleNote(d.t)}<dl class="kv" style="margin-bottom:6px"><dt>미결제약정(전체 계약)</dt><dd>${qty(a.oi)}</dd></dl>${rows}<p class="small muted" style="margin:8px 0 0">금요일에 발표되어 약 3일 늦습니다. 각 그룹의 롱·숏은 선물 계약 수이며, 현물 보유를 헤지하는 숏도 있어 숏이 많다고 하락을 예상한다는 뜻은 아닙니다. 점수에는 반영하지 않습니다.</p></div>`;
}
function idxOptCard() {
  const name = 'IDX_' + IDX_SEL, d = POS[name]; loadPos(name);
  const body = !d ? '<p class="muted small">불러오는 중…</p>' : (d.opt ? optBlock('i:' + IDX_SEL, d.opt, { wide: IDX_SEL === 'VIX' }) : '<p class="muted small">자료가 아직 없습니다.</p>');
  return `<div class="card"><h2>지수 옵션 포지션 <span class="muted small">S&P500 · 나스닥100 · VIX</span></h2><div class="chips" style="margin-bottom:8px">${[['SPX', 'S&P500'], ['NDX', '나스닥100'], ['VIX', 'VIX']].map(([k, n]) => `<button class="chip" data-pidx="${k}" aria-pressed="${k === IDX_SEL}">${n}</button>`).join('')}</div>${d && d.opt ? staleNote(d.t) : ''}${body}</div>`;
}
