// amoCRM, только чтение: история смены этапов 31.07–19.10.2026 (+ переходы в ОП до 03.11).
// 1) вход сделки в этап рассылки воронки «8. База Онлайн» = рассылка ушла;
// 2) переход сделки в воронку «3. ОП 3-9» (любой этап) = лид.
// Печатаются только количества; события сохраняются в scratchpad.
const fs = require('fs');
// Токен — из AMO_TOKEN или из файла AMO_TOKEN_FILE (держите его вне репозитория).
const TOKEN = (process.env.AMO_TOKEN || fs.readFileSync(process.env.AMO_TOKEN_FILE || 'amo-token.txt', 'utf8')).replace(/^\uFEFF/, '').trim();
const BASE = process.env.AMO_BASE || 'https://YOUR_AMO_SUBDOMAIN.amocrm.ru';
const OUT = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(path) {
  for (let i = 0; i < 8; i++) {
    await sleep(160);
    let r;
    try {
      r = await fetch(BASE + path, {headers: {Authorization: `Bearer ${TOKEN}`}});
    } catch (e) { // обрыв сети — подождать и повторить
      await sleep(3000 * (i + 1));
      continue;
    }
    if (r.status === 204) return {};
    if (r.status === 429 || r.status >= 500) { await sleep(1500 * (i + 1)); continue; }
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }
  throw new Error('retries');
}
const ts = (s) => Math.floor(Date.parse(s) / 1000);
const BASE_PIPE = 1000001, OP_PIPE = 1000002;
async function events(statusPairs, from, to, label) {
  const out = [];
  for (let i = 0; i < statusPairs.length; i += 10) {
    const chunk = statusPairs.slice(i, i + 10);
    const f = chunk.map(([p, s], k) => `filter[value_after][leads_statuses][${k}][pipeline_id]=${p}&filter[value_after][leads_statuses][${k}][status_id]=${s}`).join('&');
    for (let page = 1; page <= 2000; page++) {
      const b = await get(`/api/v4/events?limit=100&page=${page}&filter[type]=lead_status_changed&filter[created_at][from]=${from}&filter[created_at][to]=${to}&${f}`);
      const ev = (b._embedded && b._embedded.events) || [];
      for (const e of ev) {
        const a = e.value_after && e.value_after[0] && e.value_after[0].lead_status;
        const bf = e.value_before && e.value_before[0] && e.value_before[0].lead_status;
        out.push({lead: e.entity_id, at: e.created_at, to_p: a && a.pipeline_id, to_s: a && a.id, from_p: bf && bf.pipeline_id, from_s: bf && bf.id});
      }
      if (!b._links || !b._links.next) break;
    }
    process.stdout.write(`${label} ${Math.min(i + 10, statusPairs.length)}/${statusPairs.length} -> ${out.length}\n`);
  }
  return out;
}
(async () => {
  const p = await get('/api/v4/leads/pipelines');
  const pipes = Object.fromEntries(p._embedded.pipelines.map((pl) => [pl.id, pl]));
  const baseStages = pipes[BASE_PIPE]._embedded.statuses.filter((s) => ![142, 143].includes(s.id) && !/Неразобранное/.test(s.name));
  const opStages = pipes[OP_PIPE]._embedded.statuses.filter((s) => !/Неразобранное/.test(s.name));
  const names = Object.fromEntries(baseStages.map((s) => [s.id, s.name]));
  const sends = await events(baseStages.map((s) => [BASE_PIPE, s.id]), ts('2026-07-31T00:00:00+05:00'), ts('2026-10-20T00:00:00+05:00'), 'рассылки');
  const toOp = await events(opStages.map((s) => [OP_PIPE, s.id]).concat([[BASE_PIPE, 142]]), ts('2026-07-31T00:00:00+05:00'), ts('2026-11-04T00:00:00+05:00'), 'в ОП');
  fs.writeFileSync(OUT, JSON.stringify({names, sends, toOp}));
  const by = {};
  for (const e of sends) { const k = names[e.to_s] || e.to_s; by[k] = by[k] || {n: 0, leads: new Set(), days: new Set()}; by[k].n++; by[k].leads.add(e.lead); by[k].days.add(new Date((e.at + 5 * 3600) * 1000).toISOString().slice(5, 10)); }
  console.log('\nЭТАПЫ РАССЫЛОК (вход в этап, 31.07–19.10):');
  for (const [k, v] of Object.entries(by).sort((a, b) => b[1].n - a[1].n)) {
    const d = [...v.days].sort();
    console.log(`  ${k}: ${v.leads.size} сделок, дни ${d[0]}..${d[d.length - 1]} (${d.length} дн.)`);
  }
  const opLeads = new Set(toOp.map((e) => e.lead));
  const sentLeads = new Set(sends.map((e) => e.lead));
  console.log(`\nсделок с рассылкой: ${sentLeads.size}; переходов в ОП (событий): ${toOp.length}; из них сделок, получивших рассылку: ${[...sentLeads].filter((l) => opLeads.has(l)).length}`);
})().catch((e) => console.log('FAIL', String(e)));
