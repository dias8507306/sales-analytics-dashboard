// Этап amoCRM → шаблон Meta: дни отправки (±1 день) + объём + похожесть названий (транслит).
// Выводит лучший вариант, уверенность и запасной вариант; пишет предложение в JSON.
const fs = require('fs');
const [evFile, sampleFile, OUT] = process.argv.slice(2);
const {names, sends} = JSON.parse(fs.readFileSync(evFile, 'utf8'));
const d = require(sampleFile);
const tab = (t) => t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c, r[i]])));
const day = (sec) => new Date((sec + 5 * 3600) * 1000).toISOString().slice(0, 10);
const SKIP = /^(ОШИБКА ОТПРАВКИ|БАЗА|БАЗА 2)$/; // служебные этапы, не рассылки
const SERVICE = /chto_reshili|nedozvon|koshtasu|somnenie|posle_z|ne_dozvon/; // ответы после звонка — не рассылки по базе

const MAP = {а: 'a', ә: 'a', б: 'b', в: 'v', г: 'g', ғ: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', і: 'i', й: 'y', к: 'k', қ: 'k', л: 'l',
  м: 'm', н: 'n', ң: 'n', о: 'o', ө: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ұ: 'u', ү: 'u', ф: 'f', х: 'h', һ: 'h', ц: 'ts', ч: 'ch',
  ш: 'sh', щ: 'sh', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'};
const translit = (s) => s.toLowerCase().split('').map((c) => MAP[c] ?? c).join('');
const words = (s) => translit(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
const ALIAS = {kaz: ['kaz', 'kazakh'], rus: ['rus', 'russ', 'oryssha'], foto: ['foto', 'fotomen'], skidka: ['skidka', 'zhenildik', 'sikdka'], as: ['as', 'altyn', 'saka']};
function nameSim(stageName, tplName) {
  const a = words(stageName), b = tplName.split('_');
  if (!a.length) return 0;
  let hit = 0;
  for (const w of a) {
    const al = ALIAS[w] || [w];
    if (b.some((x) => al.some((y) => x.startsWith(y.slice(0, 4)) || y.startsWith(x.slice(0, 4))))) hit++;
  }
  return hit / a.length;
}

const stage = {};
for (const e of sends) {
  const k = names[e.to_s] || String(e.to_s);
  if (SKIP.test(k)) continue;
  const s = stage[k] || (stage[k] = {days: {}, leads: new Set()});
  if (s.leads.has(e.lead)) continue;
  s.leads.add(e.lead);
  const dd = day(e.at); s.days[dd] = (s.days[dd] || 0) + 1;
}
const tpl = {};
for (const r of tab(d.daily)) {
  if (!(+r.sent) || SERVICE.test(r.name)) continue;
  const t = tpl[r.name] || (tpl[r.name] = {});
  const dd = String(r.day).slice(0, 10); t[dd] = (t[dd] || 0) + (+r.sent);
}
const result = {};
for (const [k, s] of Object.entries(stage).sort((a, b) => b[1].leads.size - a[1].leads.size)) {
  const total = s.leads.size;
  const near = (dd) => [0, -1, 1].map((o) => new Date(Date.parse(dd) + o * 864e5).toISOString().slice(0, 10));
  const scored = Object.entries(tpl).map(([name, t]) => {
    let hit = 0, sent = 0;
    for (const [dd, n] of Object.entries(s.days)) if (near(dd).some((x) => t[x])) hit += n;
    for (const dd of Object.keys(s.days)) sent += t[dd] || 0;
    const overlap = hit / total, ratio = sent / total;
    const vol = Math.max(0, 1 - Math.abs(Math.log(Math.max(ratio, 0.01))) / 2);
    const nm = nameSim(k, name);
    return {name, overlap, ratio, nm, score: overlap * 0.4 + vol * 0.3 + nm * 0.3};
  }).filter((x) => x.overlap >= 0.6).sort((a, b) => b.score - a.score);
  const best = scored[0], second = scored[1];
  const conf = !best ? 'нет' : best.score >= 0.75 && (!second || best.score - second.score >= 0.1) ? 'точно' : best.score >= 0.55 ? 'похоже' : 'неясно';
  result[k] = {template: best ? best.name : null, conf, alt: second ? second.name : null, sends: total};
  const days = Object.keys(s.days).sort();
  console.log(`${conf.padEnd(6)} ${k} [${total}, ${days[0].slice(5)}..${days[days.length - 1].slice(5)}] -> ${best ? `${best.name} (дни ${Math.round(best.overlap * 100)}%, объём ${Math.round(best.ratio * 100)}%, имя ${Math.round(best.nm * 100)}%)` : '—'}${second ? ` | 2-й: ${second.name}` : ''}`);
}
fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
