// (선택) Cloudflare Worker 시세 프록시 — 장중에 "지금 이 순간" 시세가 필요할 때 앱 설정의 '프록시 주소'에 넣어 사용.
// 배포: dash.cloudflare.com → Workers & Pages → Create → Hello World → 이 코드를 붙여넣고 Deploy → 주소(https://xxx.workers.dev)를 앱 설정에 입력.
// 엔드포인트는 server.py 와 동일: /api/chart?s=SOXL&range=1mo|10y|max
const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET', 'content-type': 'application/json; charset=utf-8' };
export default {
  async fetch(req) {
    const u = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (u.pathname === '/api/batch') {   // 여러 종목 최근 일봉(장중 잠정 포함)을 한 번에 — 앱이 20초마다 호출
      const syms = (u.searchParams.get('s') || '').toUpperCase().split(',').map(s => s.trim()).filter(Boolean).slice(0, 30), rng = u.searchParams.get('range') || '5d';
      if (!syms.length || !syms.every(s => /^[A-Z0-9.^=-]{1,15}$/.test(s)) || !/^[0-9a-z]{2,4}$/.test(rng)) return new Response('{"error":"bad request"}', { status: 400, headers: CORS });
      const one = async s => {
        for (const h of HOSTS) {
          try {
            const r = await fetch(`https://${h}/v8/finance/chart/${encodeURIComponent(s)}?range=${rng}&interval=1d`, { headers: { 'user-agent': 'puddle-trader/1.0 (personal research)' }, cf: { cacheTtl: 10, cacheEverything: true } });
            if (!r.ok) continue; const res = (await r.json()).chart.result[0], d = [], c = [];
            res.timestamp.forEach((t, i) => { const v = res.indicators.quote[0].close[i]; if (v != null) { d.push(new Date(t * 1000).toISOString().slice(0, 10)); c.push(+v.toFixed(4)); } });
            return [s, { d, c, mt: res.meta && res.meta.regularMarketTime }];
          } catch (e) { /* 다음 호스트 */ }
        }
        return [s, null];
      };
      const out = Object.fromEntries((await Promise.all(syms.map(one))).filter(x => x[1]));
      return new Response(JSON.stringify(out), { headers: { ...CORS, 'cache-control': 'public, max-age=10' } });
    }
    if (u.pathname !== '/api/chart') return new Response('{"ok":true}', { headers: CORS });
    const sym = (u.searchParams.get('s') || '').toUpperCase(), rng = u.searchParams.get('range') || '1mo';
    if (!/^[A-Z0-9.^=-]{1,15}$/.test(sym) || !/^[0-9a-z]{2,4}$/.test(rng)) return new Response('{"error":"bad request"}', { status: 400, headers: CORS });
    const q = rng === 'max' ? `period1=0&period2=${Math.floor(Date.now() / 1000) + 86400}&interval=1d` : `range=${rng}&interval=1d`;
    for (const h of HOSTS) {
      try {
        const r = await fetch(`https://${h}/v8/finance/chart/${encodeURIComponent(sym)}?${q}`, { headers: { 'user-agent': 'puddle-trader/1.0 (personal research)' }, cf: { cacheTtl: 60, cacheEverything: true } });
        if (r.ok) return new Response(r.body, { headers: { ...CORS, 'cache-control': 'public, max-age=60' } });
      } catch (e) { /* 다음 호스트 */ }
    }
    return new Response('{"error":"upstream"}', { status: 502, headers: CORS });
  }
};
