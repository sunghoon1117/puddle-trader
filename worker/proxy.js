// Cloudflare Worker 시세 프록시 — 앱이 장중 시세·종목 검색·재무 원자료를 받는 곳.
// 배포: cd worker && npx wrangler deploy  (주소는 data/live.json 과 index.html 의 CSP connect-src 에 같이 적는다)
// 엔드포인트: /api/batch · /api/chart · /api/search · /api/fund  (모두 GET, 야후 공개 시세만 중계, 비밀 키 없음)
// Origin 확인은 다른 웹페이지가 가져다 쓰는 것을 막을 뿐 인증이 아니다(직접 요청은 헤더를 흉내 낼 수 있음) → 접속 IP 당 속도 제한을 함께 둔다.
const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const UA = { 'user-agent': 'puddle-trader/1.0 (personal research)' };
const SYM = /^[A-Z0-9.^=-]{1,15}$/;
const RANGES = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'max'];
const INTERVALS = ['1d', '1h', '30m', '15m'];
const okOrigin = (o, env) => !!o && (o === (env && env.APP_ORIGIN) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o));

export default {
  async fetch(req, env) {
    const u = new URL(req.url), origin = req.headers.get('origin') || '', allowed = okOrigin(origin, env);
    const H = { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', vary: 'origin', ...(allowed ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET' } : {}) };
    const reply = (body, status = 200, maxAge = 0) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { ...H, 'cache-control': maxAge ? 'public, max-age=' + maxAge : 'no-store' } });
    if (!['/api/batch', '/api/chart', '/api/search', '/api/fund'].includes(u.pathname)) return u.pathname === '/' ? reply({ ok: true }) : reply({ error: 'not found' }, 404);
    if (!allowed) return reply({ error: 'forbidden' }, 403);   // 앱 주소·로컬 개발만 허용
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: H });
    if (req.method !== 'GET') return reply({ error: 'method not allowed' }, 405);
    if (env.RL) {   // 접속 IP 당 1분 요청 수 제한(Cloudflare 위치별 근사치). 앱의 정상 사용(장중 분당 약 10회, 전체 새로고침 약 50회)보다 넉넉하게
      const { success } = await env.RL.limit({ key: req.headers.get('cf-connecting-ip') || 'x' });
      if (!success) return reply({ error: 'too many requests' }, 429);
    }
    if (u.pathname === '/api/batch') {   // 여러 종목 최근 일봉(장중 잠정 포함)을 한 번에 — 앱이 장중에 주기적으로 호출
      const syms = (u.searchParams.get('s') || '').toUpperCase().split(',').map(s => s.trim()).filter(Boolean).slice(0, 30), rng = u.searchParams.get('range') || '5d';
      if (!syms.length || !syms.every(s => SYM.test(s)) || !RANGES.includes(rng)) return reply({ error: 'bad request' }, 400);
      const one = async s => {
        for (const h of HOSTS) {
          try {
            const r = await fetch(`https://${h}/v8/finance/chart/${encodeURIComponent(s)}?range=${rng}&interval=1d`, { headers: UA, cf: { cacheTtl: 10, cacheEverything: true } });
            if (!r.ok) continue; const res = (await r.json()).chart.result[0], d = [], c = [];
            res.timestamp.forEach((t, i) => { const v = res.indicators.quote[0].close[i]; if (v != null) { d.push(new Date(t * 1000).toISOString().slice(0, 10)); c.push(+v.toFixed(4)); } });
            return [s, { d, c, mt: res.meta && res.meta.regularMarketTime }];
          } catch (e) { /* 다음 호스트 */ }
        }
        return [s, null];
      };
      return reply(Object.fromEntries((await Promise.all(syms.map(one))).filter(x => x[1])), 200, 10);
    }
    if (u.pathname === '/api/search') {   // 종목 검색(이름·티커) — 야후 검색 결과에서 주식·ETF만
      const q = (u.searchParams.get('q') || '').trim().slice(0, 40);
      if (!q) return reply({ items: [] });
      for (const h of HOSTS) {
        try {
          const r = await fetch(`https://${h}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&lang=ko-KR`, { headers: UA, cf: { cacheTtl: 300, cacheEverything: true } });
          if (!r.ok) continue;
          const items = ((await r.json()).quotes || []).filter(x => x.symbol && ['EQUITY', 'ETF'].includes(x.quoteType)).slice(0, 8).map(x => ({ sym: x.symbol, name: x.shortname || x.longname || '', type: x.quoteType === 'ETF' ? 'etf' : 'stock', ex: x.exchDisp || '' }));
          return reply({ items }, 200, 300);
        } catch (e) { /* 다음 호스트 */ }
      }
      return reply({ items: [], error: 'upstream' }, 502);
    }
    if (u.pathname === '/api/fund') {   // 투자지표 원자료(앱 목록 밖 종목용) — data/fund.json 의 raw 와 같은 형식
      const sym = (u.searchParams.get('s') || '').toUpperCase();
      if (!SYM.test(sym)) return reply({ error: 'bad request' }, 400);
      const A = ['TotalRevenue', 'GrossProfit', 'OperatingIncome', 'NetIncome', 'EBITDA', 'StockholdersEquity', 'TotalDebt', 'CashAndCashEquivalents', 'OperatingCashFlow', 'FreeCashFlow', 'CashDividendsPaid', 'BasicAverageShares'].map(x => 'annual' + x),
        T = ['PeRatio', 'ForwardPeRatio', 'PbRatio', 'PsRatio', 'PegRatio', 'EnterprisesValueEBITDARatio', 'MarketCap', 'DilutedEPS'].map(x => 'trailing' + x);
      for (const h of HOSTS) {
        try {
          const r = await fetch(`https://${h}/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(sym)}?symbol=${encodeURIComponent(sym)}&type=${A.concat(T).join(',')}&period1=1400000000&period2=${Math.floor(Date.now() / 1000)}`, { headers: UA, cf: { cacheTtl: 3600, cacheEverything: true } });
          if (!r.ok) continue;
          const a = {}, t = {};
          for (const it of (await r.json()).timeseries.result || []) {
            const k = it.meta.type[0], rows = (it[k] || []).filter(x => x && x.reportedValue && x.reportedValue.raw != null); if (!rows.length) continue;
            if (k.startsWith('annual')) { a[k.slice(6)] = Object.fromEntries(rows.slice(-6).map(x => [x.asOfDate.slice(0, 4), x.reportedValue.raw])); } else t[k.slice(8)] = rows.slice(-24).map(x => [x.asOfDate, +x.reportedValue.raw.toFixed(4)]);
          }
          return reply({ a, t }, 200, 3600);
        } catch (e) { /* 다음 호스트 */ }
      }
      return reply({ error: 'upstream' }, 502);
    }
    const sym = (u.searchParams.get('s') || '').toUpperCase(), rng = u.searchParams.get('range') || '1mo', itv = u.searchParams.get('interval') || '1d';   // /api/chart
    if (!SYM.test(sym) || !RANGES.includes(rng) || !INTERVALS.includes(itv)) return reply({ error: 'bad request' }, 400);
    const q = rng === 'max' ? `period1=0&period2=${Math.floor(Date.now() / 1000) + 86400}&interval=1d` : `range=${rng}&interval=${itv}`;
    for (const h of HOSTS) {
      try {
        const r = await fetch(`https://${h}/v8/finance/chart/${encodeURIComponent(sym)}?${q}`, { headers: UA, cf: { cacheTtl: 60, cacheEverything: true } });
        if (r.ok) return new Response(r.body, { headers: { ...H, 'cache-control': 'public, max-age=60' } });
      } catch (e) { /* 다음 호스트 */ }
    }
    return reply({ error: 'upstream' }, 502);
  }
};
