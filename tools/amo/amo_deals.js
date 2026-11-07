// amoCRM, только чтение: текущий этап и деньги сделок, которые после рассылки перешли в ОП.
// Сохраняет {id: {pipeline, status, price, debt, priceField, cost, paidCount}} — без имён и телефонов.
const fs = require('fs');
// Токен — из AMO_TOKEN или из файла AMO_TOKEN_FILE (держите его вне репозитория).
const TOKEN = (process.env.AMO_TOKEN || fs.readFileSync(process.env.AMO_TOKEN_FILE || 'amo-token.txt', 'utf8')).replace(/^\uFEFF/, '').trim();
const BASE = process.env.AMO_BASE || 'https://YOUR_AMO_SUBDOMAIN.amocrm.ru';
const [evFile, OUT] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(path) {
  for (let i = 0; i < 8; i++) {
    await sleep(170);
    let r;
    try { r = await fetch(BASE + path, {headers: {Authorization: `Bearer ${TOKEN}`}}); } catch (e) { await sleep(3000 * (i + 1)); continue; }
    if (r.status === 204) return {};
    if (r.status === 429 || r.status >= 500) { await sleep(1500 * (i + 1)); continue; }
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }
  throw new Error('retries');
}
(async () => {
  const {sends, toOp} = JSON.parse(fs.readFileSync(evFile, 'utf8'));
  const sent = new Set(sends.map((e) => e.lead));
  const ids = [...new Set(toOp.map((e) => e.lead))].filter((id) => sent.has(id));
  const out = {};
  for (let i = 0; i < ids.length; i += 250) {
    const q = ids.slice(i, i + 250).map((id, k) => `filter[id][${k}]=${id}`).join('&');
    const b = await get(`/api/v4/leads?limit=250&${q}`);
    for (const l of (b._embedded && b._embedded.leads) || []) {
      const f = Object.fromEntries((l.custom_fields_values || []).map((c) => [c.field_id, c.values[0] && c.values[0].value]));
      out[l.id] = {pipeline: l.pipeline_id, status: l.status_id, price: l.price || 0, debt: +f[900001] || 0, priceField: +f[900002] || 0,
        cost: +f[900003] || 0, firstPay: +f[900004] || 0, closed: l.closed_at};
    }
    process.stdout.write(`${Math.min(i + 250, ids.length)}/${ids.length}\n`);
  }
  fs.writeFileSync(OUT, JSON.stringify(out));
  const won = Object.values(out).filter((d) => d.status === 142 && d.pipeline !== 1000001);
  const by = {};
  for (const d of won) by[d.pipeline] = (by[d.pipeline] || 0) + 1;
  console.log('сделок:', Object.keys(out).length, '| успешных (не в базе):', won.length, JSON.stringify(by));
  const s = (k) => won.reduce((a, d) => a + d[k], 0);
  console.log('бюджет', s('price'), '| задолженность', s('debt'), '| PRICE', s('priceField'), '| Стоимость', s('cost'));
  console.log('пример (бюджет, долг, PRICE, Стоимость):', won.slice(0, 12).map((d) => [d.price, d.debt, d.priceField, d.cost].join('/')).join('  '));
})().catch((e) => console.log('FAIL', String(e)));
