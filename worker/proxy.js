// (선택) Cloudflare Worker 시세 프록시 — 장중에 "지금 이 순간" 시세가 필요할 때 앱 설정의 '프록시 주소'에 넣어 사용.
// 배포: dash.cloudflare.com → Workers & Pages → Create → Hello World → 이 코드를 붙여넣고 Deploy → 주소(https://xxx.workers.dev)를 앱 설정에 입력.
// 엔드포인트는 server.py 와 동일: /api/chart?s=SOXL&range=1mo|10y|max
const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET', 'content-type': 'application/json; charset=utf-8' };
/* ── AI 해설(무료): Cloudflare Workers AI. 키 불필요, 무료 한도 내에서만 동작(초과 시 오류만 날 뿐 과금 없음).
   남용 방지: 허용 출처(github.io · localhost)만, 요청 길이·빈도 제한. 보유종목 등 개인정보는 앱이 보내지 않음. ── */
const AI_MODELS = ['@cf/google/gemma-4-26b-a4b-it', '@cf/qwen/qwen3-30b-a3b-fp8', '@cf/meta/llama-3.1-8b-instruct-fp8'];
const hits = new Map();
const okOrigin = o => !!o && (/^https:\/\/[a-z0-9-]+\.github\.io$/i.test(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o));
async function handleAI(req, env) {
  const origin = req.headers.get('origin') || '', H = { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'content-type': 'application/json; charset=utf-8', vary: 'origin' };
  if (req.method === 'OPTIONS') return new Response(null, { headers: H });
  if (req.method !== 'POST' || !okOrigin(origin)) return new Response('{"error":"forbidden"}', { status: 403, headers: H });
  const ip = req.headers.get('cf-connecting-ip') || 'x', now = Date.now(), arr = (hits.get(ip) || []).filter(t => now - t < 10 * 60e3);
  if (arr.length >= 20) return new Response('{"error":"요청이 너무 많습니다. 잠시 후 다시 시도하세요."}', { status: 429, headers: H });
  arr.push(now); hits.set(ip, arr); if (hits.size > 500) hits.clear();
  let b; try { b = await req.json(); } catch (e) { return new Response('{"error":"bad json"}', { status: 400, headers: H }); }
  const prompt = String(b.prompt || '').slice(0, 14000), system = String(b.system || '').slice(0, 2500);
  if (!prompt) return new Response('{"error":"empty"}', { status: 400, headers: H });
  if (!env || !env.AI) return new Response('{"error":"AI 바인딩이 없습니다"}', { status: 501, headers: H });
  let err = '';
  for (const m of AI_MODELS) {
    try {
      const r = await env.AI.run(m, { messages: [{ role: 'system', content: system || '한국어로 간결하게 답하세요.' }, { role: 'user', content: prompt }], max_tokens: 900, temperature: 0.3 });
      const text = (r && (r.response || (r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content))) || (typeof r === 'string' ? r : '');
      if (text) return new Response(JSON.stringify({ text: String(text).replace(/<think>[\s\S]*?<\/think>/g, '').trim(), model: m }), { headers: H });
    } catch (e) { err = String(e && e.message || e).slice(0, 160); }
  }
  return new Response(JSON.stringify({ error: 'AI 호출 실패(무료 한도 초과일 수 있음)', detail: err }), { status: 502, headers: H });
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname === '/api/ai') return handleAI(req, env);
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
