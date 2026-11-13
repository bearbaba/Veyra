const base = 'http://localhost:5173';
const seen = new Set<string>();
const queue: string[] = ['/src/main.tsx'];
const failures: string[] = [];
let ok = 0;
const spec = /(?:from|import)\s*\(?\s*["'](\/[^"']+)["']/g;
async function visit(path: string) {
  try {
    const res = await fetch(base + path, { headers: { Accept: '*/*' }, signal: AbortSignal.timeout(60000) });
    const body = await res.text();
    if (res.status >= 400 || body.includes('The service is no longer running')) {
      failures.push(`${res.status} ${path} ${body.slice(0, 120).replace(/\s+/g, ' ')}`);
      return;
    }
    ok++;
    if (!/javascript|typescript|text\/html/.test(res.headers.get('content-type') ?? '')) return;
    for (const m of body.matchAll(spec)) {
      const p = m[1].split('?')[0];
      if (/^\/(@vite|@react-refresh|@id|@fs)\//.test(p) || /\.(css|svg|png|woff2?)$/.test(p) && false) continue;
      if (!seen.has(p) && p.length < 300) { seen.add(p); queue.push(p); }
    }
  } catch (e) { failures.push('ERR ' + path + ' ' + String(e).slice(0, 100)); }
}
seen.add('/src/main.tsx');
while (queue.length && seen.size < 3000) {
  const batch = queue.splice(0, 6);
  await Promise.all(batch.map(visit));
}
console.log(JSON.stringify({ visited: seen.size, ok, failed: failures.length }));
for (const f of failures.slice(0, 15)) console.log(f);
console.log('CRAWL_DONE');
