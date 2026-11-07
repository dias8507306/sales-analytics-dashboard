// История amoCRM (31.07–19.10.2026) → строки для дашборда: день рассылки × шаблон → лиды, продажи, выручка.
// Строгие правила (проверка 04.11.2026), те же, что у Битрикса (crmSummary_ в Code.gs):
//  - рассылка засчитана, только если её шаблон подтверждён отправками номера 1100 по Meta: отправлено Meta
//    ≥ 80% от сделок, вошедших в этапы с этим шаблоном (COVERAGE_MIN). Иначе база ушла с другого номера
//    или не ушла — её сделки не считаются рассылкой 1100 (видны в «Базах» как неподтверждённые);
//  - сделка, попавшая в «ОШИБКА ОТПРАВКИ» в течение 3 суток после входа в этап, рассылку не получила;
//  - лид — переход в ОП не позже 7 дней (LEAD_WINDOW_DAYS) после подтверждённой рассылки; засчитывается
//    последней подтверждённой рассылке перед переходом;
//  - продажа — только у такого лида: «Успешно реализовано» (142) в любой воронке, кроме «8. База Онлайн»
//    (там 142 — «передан в оп»); выручка = Бюджет (оплачено) + Сумма задолженности (если > 0).
// В файл идут только суммы — без номеров сделок, имён и телефонов.
const COVERAGE_MIN = 0.8;
const LEAD_WINDOW_DAYS = 7;
const FAIL_WITHIN_S = 3 * 86400;
const fs = require('fs');
const [evFile, dealsFile, mapFile, OUT, sampleFile] = process.argv.slice(2);
const {names, sends, toOp} = JSON.parse(fs.readFileSync(evFile, 'utf8'));
const deals = JSON.parse(fs.readFileSync(dealsFile, 'utf8'));
const auto = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
const BASE_PIPE = 1000001;
const SKIP = /^(ОШИБКА ОТПРАВКИ|БАЗА|БАЗА 2)$/;

// Проверено по дням отправки (03.11.2026); null — в этап в разные дни шли разные шаблоны.
const FIX = {
  // этап (база) в amoCRM → шаблон Meta; null — в разные дни в этап уходили разные шаблоны. Пример:
  'КАЗ ЖАЛПЫ РАССЫЛКА': 'kaz_rassylka_zhalpy_2', 'ПРОБНЫЙ САБАҚ': 'probnyy_urok_kaz_1', 'СМЕШАННАЯ БАЗА': null,
};
const mainOf = (stage) => (stage in FIX ? FIX[stage] : (auto[stage] && auto[stage].template)) || null;
let dayTpl = null; // задаётся ниже, когда известны дни этапов
const tplOf = (stage, d) => dayTpl(stage, d) || `база: ${stage}`;
const conf = (stage) => (stage in FIX ? (FIX[stage] ? 'проверено по дням' : 'разные шаблоны') : (auto[stage] && auto[stage].conf) || 'нет');
const day = (sec) => new Date((sec + 5 * 3600) * 1000).toISOString().slice(0, 10);

const sendsBy = new Map(), errAt = new Map();
for (const e of sends) {
  const stage = names[e.to_s] || String(e.to_s);
  if (stage === 'ОШИБКА ОТПРАВКИ') {
    if (!errAt.has(e.lead)) errAt.set(e.lead, []);
    errAt.get(e.lead).push(e.at);
  }
  if (SKIP.test(stage)) continue;
  if (!sendsBy.has(e.lead)) sendsBy.set(e.lead, []);
  sendsBy.get(e.lead).push({t: e.at, stage});
}
const opBy = new Map();
for (const e of toOp) {
  if (!opBy.has(e.lead)) opBy.set(e.lead, []);
  opBy.get(e.lead).push(e.at);
}
// дни этапов: сколько сделок вошло в этап в каждый день (по одной на сделку и этап)
const stageDays = {};
for (const [, list] of sendsBy) {
  const seen = new Set();
  for (const x of list.sort((a, b) => a.t - b.t)) {
    if (seen.has(x.stage)) continue;
    seen.add(x.stage);
    const dd = day(x.t);
    (stageDays[x.stage] = stageDays[x.stage] || {})[dd] = (stageDays[x.stage][dd] || 0) + 1;
  }
}
dayTpl = require("./amo_daymap.js")(stageDays, Object.fromEntries(Object.keys(stageDays).map((k) => [k, mainOf(k)])), sampleFile);
// Рассылки сделок: один раз на этап; отметка «ошибка отправки» и шаблон дня.
const uniqBy = new Map();
for (const [lead, list] of sendsBy) {
  const seen = new Set();
  uniqBy.set(lead, list.sort((a, b) => a.t - b.t).filter((s) => (seen.has(s.stage) ? false : seen.add(s.stage))).map((s) => {
    const tpl = tplOf(s.stage, day(s.t));
    const failed = (errAt.get(lead) || []).some((t) => t >= s.t && t - s.t <= FAIL_WITHIN_S);
    return Object.assign(s, {tpl, failed});
  }));
}
// Покрытие шаблона: отправлено с 1100 по Meta / дошедшие (без ошибки) сделки amoCRM с этим шаблоном.
const tab = (t) => t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c, r[i]])));
const metaSent = {};
for (const r of tab(require(sampleFile).daily)) {
  const dd = String(r.day).slice(0, 10);
  if (dd >= '2026-07-31' && dd <= '2026-10-19') metaSent[r.name] = (metaSent[r.name] || 0) + (+r.sent || 0);
}
const amoSent = {};
for (const list of uniqBy.values()) for (const s of list) if (!s.failed) amoSent[s.tpl] = (amoSent[s.tpl] || 0) + 1;
const coverage = Object.fromEntries(Object.keys(amoSent).map((t) => [t, (metaSent[t] || 0) / amoSent[t]]));
const confirmed = (tpl) => !tpl.startsWith('база: ') && coverage[tpl] >= COVERAGE_MIN;

const rows = new Map(), bases = new Map();
const base = (stage) => {
  if (!bases.has(stage)) bases.set(stage, {base: stage, templates: {}, match: conf(stage),
    from: '9999', to: '0000', entered: 0, failed: 0, unconfirmed: 0, sends: 0, leads: 0, deals: 0, revenue: 0, paid: 0});
  return bases.get(stage);
};
for (const [lead, uniq] of uniqBy) {
  for (const s of uniq) {
    const b = base(s.stage);
    b.entered++;
    const d = day(s.t);
    if (d < b.from) b.from = d;
    if (d > b.to) b.to = d;
    if (s.failed) { b.failed++; continue; }
    if (!confirmed(s.tpl)) { b.unconfirmed++; continue; }
    b.sends++;
    b.templates[s.tpl] = (b.templates[s.tpl] || 0) + 1;
  }
  const valid = uniq.filter((s) => !s.failed && confirmed(s.tpl));
  if (!valid.length) continue;
  // лид: первый переход в ОП, у которого последняя подтверждённая рассылка перед ним — не раньше 7 дней
  let leadAt = null, s = null;
  for (const t of (opBy.get(lead) || []).filter((x) => x > valid[0].t).sort((a, b) => a - b)) {
    const before = valid.filter((x) => x.t < t).pop();
    if (before && t - before.t <= LEAD_WINDOW_DAYS * 86400) { leadAt = t; s = before; break; }
  }
  if (!leadAt) continue;
  const d = deals[lead];
  const sale = Boolean(d && d.status === 142 && d.pipeline !== BASE_PIPE);
  const key = `${day(s.t)}|${s.tpl}`;
  if (!rows.has(key)) rows.set(key, {leads: 0, deals: 0, revenue: 0, paid: 0});
  const r = rows.get(key), b = base(s.stage);
  r.leads++; b.leads++;
  if (sale) {
    const paid = d.price || 0, rev = paid + Math.max(0, d.debt || 0);
    r.deals++; r.revenue += rev; r.paid += paid;
    b.deals++; b.revenue += rev; b.paid += paid;
  }
}
const out = {
  source: 'amoCRM', from: '2026-07-31', to: '2026-10-19', builtAt: new Date().toISOString(),
  rules: {coverageMin: COVERAGE_MIN, leadWindowDays: LEAD_WINDOW_DAYS, failWithinDays: FAIL_WITHIN_S / 86400},
  confirmedTemplates: Object.keys(coverage).filter((t) => confirmed(t)),
  unconfirmedTemplates: Object.keys(coverage).filter((t) => !confirmed(t) && !t.startsWith('база: ')),
  rows: {columns: ['day', 'template', 'leads', 'deals', 'revenue', 'paid'],
    rows: [...rows].map(([k, a]) => k.split('|').concat([a.leads, a.deals, Math.round(a.revenue), Math.round(a.paid)])).sort((a, b) => (a[0] < b[0] ? -1 : 1))},
  // coverage — по шаблонам базы: сколько их ушло с 1100 по Meta к числу сделок (для пометки в «Базах»)
  bases: [...bases.values()].map((b) => Object.assign(b, {
    templates: Object.entries(b.templates).sort((x, y) => y[1] - x[1]).map(([name, n]) => ({name, n, coverage: Math.round((coverage[name] || 0) * 100) / 100})),
    revenue: Math.round(b.revenue), paid: Math.round(b.paid),
  })).sort((a, b) => b.entered - a.entered),
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
const tot = out.bases.reduce((a, b) => ({entered: a.entered + b.entered, failed: a.failed + b.failed, unconfirmed: a.unconfirmed + b.unconfirmed,
  sends: a.sends + b.sends, leads: a.leads + b.leads, deals: a.deals + b.deals, revenue: a.revenue + b.revenue, paid: a.paid + b.paid}),
{entered: 0, failed: 0, unconfirmed: 0, sends: 0, leads: 0, deals: 0, revenue: 0, paid: 0});
console.log('ИТОГО', JSON.stringify(tot), '| строк', out.rows.rows.length, '| баз', out.bases.length);
console.log('неподтверждённые шаблоны:', Object.entries(coverage).filter(([t, c]) => !confirmed(t)).map(([t, c]) => `${t} ${Math.round(c * 100)}%`).join(', '));
console.log('без шаблона:', out.bases.filter((b) => b.templates.every((t) => t.name.startsWith('база: '))).map((b) => `${b.base} (${b.sends}, лидов ${b.leads}, продаж ${b.deals})`).join('; '));
console.log('\nТОП баз по выручке:');
for (const b of [...out.bases].sort((a, b) => b.revenue - a.revenue).slice(0, 15)) {
  console.log(`  ${b.base} → ${b.templates.slice(0, 3).map((t) => t.name + ' ' + t.n).join(', ')}: рассылок ${b.sends}, лидов ${b.leads}, продаж ${b.deals}, выручка ${b.revenue}, оплачено ${b.paid}`);
}
