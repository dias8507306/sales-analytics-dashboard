'use strict';

// ===== Настройки =====

// Цена одного доставленного сообщения, ₸, по категории шаблона в Meta.
const PRICE_KZT = {MARKETING: 53, UTILITY: 63};
const DEFAULT_CATEGORY = 'MARKETING';
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WEEKDAYS_FULL = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const WEEKDAYS_IN = ['в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу', 'в воскресенье'];
// Вид кнопки из таблицы: интерес и ссылка считаются откликом, отказ — отказом.
const BUTTON_COLOR = {Интерес: 'var(--yellow)', Ссылка: 'var(--yellow)', Отказ: 'var(--red)'};
// Те же кнопки отказа, что в скрипте таблицы (NEGATIVE_BUTTON в Code.gs).
const NEGATIVE_BUTTON = /емес|беспокоить|не надо|келмейді|отпис/i;
const BUTTONS_TOP = 8;
// Сравнение с прошлым периодом той же длины (n дней); показываем, только если в нём было достаточно доставок.
const prevLabel = (n) => ({day: 'к предыдущему дню', week: 'к прошлой неделе', month: 'к прошлому месяцу'}[state.unit]
  || (n === 1 ? 'к предыдущему дню' : n === 7 ? 'к прошлой неделе' : `к прошлым ${n} ${plural(n, 'дню', 'дням', 'дням')}`));
const UNITS = [['day', 'День'], ['week', 'Неделя'], ['month', 'Месяц']];
const prevMinDelivered = (n) => (n <= 1 ? 30 : Math.min(300, Math.max(50, n * 5)));
// Статус номера из Meta.
const QUALITY = {GREEN: ['Высокое', 'var(--green)'], YELLOW: ['Среднее', 'var(--yellow)'], RED: ['Низкое', 'var(--red)']};
const LIMIT = {TIER_250: '250', TIER_1K: '1 000', TIER_2K: '2 000', TIER_10K: '10 000', TIER_100K: '100 000', TIER_UNLIMITED: 'без ограничений'};
const CAN_SEND = {AVAILABLE: ['доступна', 'var(--green)'], LIMITED: ['ограничена', 'var(--yellow)'], BLOCKED: ['заблокирована', 'var(--red)']};
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_FULL = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

// unit — 'day' | 'week' | 'month' (anchor — любой день внутри периода) или 'custom' (даты из календаря в range).
// tpl — выбранный в таблице шаблон: весь дашборд показывает только его.
// view — раздел: 'dash' (дашборд) или 'bases' (вкладка «Базы», ссылка …/#bases).
const state = {unit: 'week', anchor: null, range: null, tpl: null, sort: {key: 'resp', dir: -1}, q: '',
  view: location.hash === '#bases' ? 'bases' : 'dash'};
let M = null;   // статистика шаблонов из Google Таблицы
let VIEW = null; // данные последней отрисовки (период, строки, итоги) — для развёрнутого графика
let CRM = null; // лиды и продажи по шаблонам: amoCRM до 19.10.2026, дальше Битрикс24; null — CRM нет
let REPORT = null; // открытый отчёт: {w, payload, ai, error, loading}
let NOTES = {};    // заметки к базам {база: {note, updatedAt}} из таблицы
const BASES = {q: '', edit: null, saving: false, error: null}; // вкладка «Базы»: поиск, база с открытым редактором

// ===== Форматы и даты =====

const nf0 = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 0});
const nf1 = new Intl.NumberFormat('ru-RU', {minimumFractionDigits: 1, maximumFractionDigits: 1});
const ok = (v) => v != null && Number.isFinite(+v);
const fmt = {
  int: (v) => (ok(v) ? nf0.format(v) : '—'),
  pct: (v) => (ok(v) ? `${nf1.format(v * 100)}%` : '—'),
  kzt: (v) => (ok(v) ? `${nf0.format(v)} ₸` : '—'),
  day: (s) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '—'),
  short: (s) => { const d = toDate(s); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; },
};
const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
};
const toDate = (s) => new Date(`${s}T00:00:00Z`);
const addDays = (s, n) => new Date(toDate(s).getTime() + n * 864e5).toISOString().slice(0, 10);
const weekday = (s) => (toDate(s).getUTCDay() + 6) % 7;
const dayList = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };

// ===== Загрузка =====

async function load(refresh = false) {
  const pw = readPassword();
  const headers = pw ? {'x-dashboard-password': pw} : {};
  const q = refresh ? '?refresh=1' : '';
  const [res, crmRes] = await Promise.all([
    fetch(`/api/data${q}`, {headers}),
    fetch(`/api/crm${q}`, {headers}).catch(() => null),
  ]);
  if (res.status === 401) { showGate(Boolean(pw)); return; }
  const body = await res.json().catch(() => ({error: 'upstream', message: 'Сервер вернул не JSON.'}));
  if (!res.ok || body.error) { showNotice(body.message || 'Не удалось загрузить данные.'); return; }
  M = buildModel(body);
  // По умолчанию — неделя с последним днём, где были отправки.
  if (!state.anchor) state.anchor = M.lastDay;
  // Битрикс приходит вместе с данными таблицы; /api/crm отдаёт только пример для проверки вида (CRM_MOCK=1).
  CRM = buildCrm(body.crm) || (crmRes && crmRes.ok ? buildCrm(await crmRes.json().catch(() => null)) : null);
  NOTES = body.notes || NOTES;
  byId('gate').hidden = true;
  byId('notice').hidden = true;
  byId('views').hidden = !CRM;
  if (!CRM && state.view === 'bases') state.view = 'dash';
  showView();
  render();
}

function readPassword() { try { return localStorage.getItem('wa-pw') || ''; } catch (e) { return ''; } }
function savePassword(v) { try { localStorage.setItem('wa-pw', v); } catch (e) { /* без localStorage пароль спросим снова */ } }

function showGate(wrong) {
  byId('app').hidden = true;
  byId('gate').hidden = false;
  byId('gate-err').hidden = !wrong;
  byId('sub').textContent = 'Нужен пароль';
}

function showNotice(text) {
  byId('notice').textContent = text;
  byId('notice').hidden = false;
  byId('sub').textContent = 'Данные не загрузились';
}

function table(t) {
  return ((t && t.rows) || []).map((r) => Object.fromEntries(t.columns.map((c, i) => [c, r[i]])));
}

// Шаблон для превью. Старый скрипт таблицы не отдаёт полный текст и типы кнопок — тогда есть только начало текста.
function templateInfo(t) {
  let buttons = null;
  try { buttons = t.buttons_json ? JSON.parse(t.buttons_json) : null; } catch (e) { buttons = null; }
  if (!Array.isArray(buttons)) buttons = String(t.buttons || '').split(' · ').filter(Boolean).map((text) => ({text, type: ''}));
  return {
    name: t.name, lang: t.lang, status: t.status, category: String(t.category || DEFAULT_CATEGORY).toUpperCase(),
    header: t.header || '', headerText: t.header_text || '', footer: t.footer || '',
    text: t.text || '', preview: t.preview || '', full: Boolean(t.text), buttons,
    // Разметка текста из скрипта таблицы — для раздела отчёта «Что в тексте влияет на отклик».
    traits: {opener: t.opener, price: t.price, urgency: t.urgency, length: t.length, segment: t.segment, family: t.family},
  };
}

function buildModel(raw) {
  const num = (v) => +v || 0;
  const templates = new Map(table(raw.templates).filter((t) => t.name).map((t) => [t.name, templateInfo(t)]));
  const priceOf = (name) => PRICE_KZT[(templates.get(name) || {}).category] || PRICE_KZT[DEFAULT_CATEGORY];
  const daily = table(raw.daily).filter((r) => r.day && r.name).map((r) => {
    const delivered = num(r.delivered);
    return {
      day: String(r.day).slice(0, 10), name: r.name, sent: num(r.sent), delivered, read: num(r.read),
      resp: num(r.interest) + num(r.link), neg: num(r.refusal), cost: delivered * priceOf(r.name),
    };
  });
  const buttons = table(raw.buttons).filter((b) => b.day && b.button && num(b.clicks) > 0)
    .map((b) => ({day: String(b.day).slice(0, 10), name: b.name, button: String(b.button), kind: b.kind, clicks: num(b.clicks)}));
  const sentDays = daily.filter((r) => r.sent > 0).map((r) => r.day).sort();
  return {daily, buttons, templates, firstDay: sentDays[0], lastDay: sentDays[sentDays.length - 1], updatedAt: raw.updatedAt,
    phone: raw.phone || null, demo: Boolean(raw.demo)};
}

// Лиды и продажи: строки «день рассылки × шаблон» (crmSummary_ в скрипте таблицы, пример — в api/crm.js).
function buildCrm(raw) {
  if (!raw || !raw.enabled || !raw.rows) return null;
  const rows = table(raw.rows).filter((r) => r.day && r.template).map((r) => ({
    day: String(r.day).slice(0, 10), template: String(r.template), leads: +r.leads || 0, deals: +r.deals || 0,
    revenue: +r.revenue || 0, paid: r.paid == null ? +r.revenue || 0 : +r.paid || 0,
  }));
  // from — с какого дня в CRM есть данные: расходы для сравнения с продажами берутся только с него.
  // label — откуда лиды и продажи, для подписей и отчёта.
  const sources = Array.isArray(raw.sources) && raw.sources.length ? raw.sources : [{name: 'Битрикс24', from: raw.from}];
  const label = sources.map((s) => `${s.name} ${s.to ? `до ${fmt.day(s.to).slice(0, 5)}` : `с ${fmt.day(s.from).slice(0, 5)}`}`).join(', ');
  return {source: raw.source, from: raw.from || d3.min(rows, (r) => r.day) || '', rows, label, bases: raw.bases || [],
    // unconfirmed — шаблоны, чьи рассылки CRM не подтверждены отправками 1100: ROI по ним не показываем
    unconfirmed: new Set(raw.unconfirmedTemplates || []), rules: raw.rules || null};
}

// ===== Расчёты =====

// День, неделя (пн–вс) или месяц, в который попадает день a; будущие дни отрезаем.
function unitWin(unit, a) {
  const max = pickMax();
  const cap = (s) => (s > max ? max : s);
  if (unit === 'day') return {from: a, to: a};
  if (unit === 'week') { const from = addDays(a, -weekday(a)); return {from, to: cap(addDays(from, 6))}; }
  return {from: `${a.slice(0, 7)}-01`, to: cap(addDays(`${addMonths(a.slice(0, 7), 1)}-01`, -1))};
}
function win() {
  return state.unit === 'custom' ? state.range : unitWin(state.unit, state.anchor);
}
const spanDays = (w) => Math.round((toDate(w.to) - toDate(w.from)) / 864e5) + 1;
// С чем сравнивать: предыдущий день, те же дни прошлой недели или прошлого месяца;
// для своих дат из календаря — столько же дней перед началом.
function prevWin(w) {
  const n = spanDays(w);
  if (state.unit === 'week') return {from: addDays(w.from, -7), to: addDays(w.to, -7)};
  if (state.unit === 'month') {
    const from = `${addMonths(w.from.slice(0, 7), -1)}-01`, end = addDays(w.from, -1), to = addDays(from, n - 1);
    return {from, to: to > end ? end : to};
  }
  return {from: addDays(w.from, -n), to: addDays(w.from, -1)};
}

// Стрелки: период на k шагов назад (k < 0) или вперёд.
function stepped(k) {
  if (state.unit === 'custom') {
    const n = spanDays(state.range);
    return {range: {from: addDays(state.range.from, k * n), to: addDays(state.range.to, k * n)}};
  }
  const a = state.anchor;
  return {anchor: state.unit === 'day' ? addDays(a, k) : state.unit === 'week' ? addDays(a, 7 * k) : `${addMonths(a.slice(0, 7), k)}-01`};
}
function canStep(k) {
  const s = stepped(k);
  const w = s.range || unitWin(state.unit, s.anchor);
  // Свои даты сдвигаем только целиком в прошлое; день, неделя и месяц — до текущего включительно.
  if (k > 0) return s.range ? w.to <= pickMax() : w.from <= pickMax();
  return w.to >= M.firstDay;
}
function step(k) {
  if (!M || !canStep(k)) return;
  Object.assign(state, stepped(k));
  render();
}
// Смена единицы: новый период — тот, в который попадает конец текущего.
function setUnit(unit) {
  if (!M) return;
  Object.assign(state, {unit, anchor: win().to, range: null});
  render();
}

// «2–8 ноя», «27 окт – 2 ноя», «28 окт, Ср», «Октябрь 2026»; год — только если не текущий.
function rangeLabel(w) {
  const d = (s) => +s.slice(8, 10), mon = (s) => MONTHS[+s.slice(5, 7) - 1], year = todayStr().slice(0, 4);
  const yr = (s) => (s.slice(0, 4) === year ? '' : ` ${s.slice(0, 4)}`);
  if (state.unit === 'month') return `${MONTHS_FULL[+w.from.slice(5, 7) - 1]} ${w.from.slice(0, 4)}`;
  // Текущую неделю подписываем целиком («2–8 ноя»), хотя данные есть только по сегодня.
  if (state.unit === 'week') w = {from: w.from, to: addDays(w.from, 6)};
  if (w.from === w.to) return `${d(w.from)} ${mon(w.from)}${yr(w.from)}, ${WEEKDAYS[weekday(w.from)]}`;
  if (w.from.slice(0, 7) === w.to.slice(0, 7)) return `${d(w.from)}–${d(w.to)} ${mon(w.to)}${yr(w.to)}`;
  return `${d(w.from)} ${mon(w.from)}${w.from.slice(0, 4) !== w.to.slice(0, 4) ? ` ${w.from.slice(0, 4)}` : ''} – ${d(w.to)} ${mon(w.to)}${yr(w.to)}`;
}
const inWin = (r, w) => r.day >= w.from && r.day <= w.to;
const ofTpl = (name) => !state.tpl || name === state.tpl;
const rowsIn = (w) => M.daily.filter((r) => inWin(r, w) && ofTpl(r.name));
const crmSums = (rows) => ({leads: d3.sum(rows, (r) => r.leads), deals: d3.sum(rows, (r) => r.deals),
  revenue: d3.sum(rows, (r) => r.revenue), paid: d3.sum(rows, (r) => r.paid)});
// cost — расходы только за дни, где уже есть данные CRM, чтобы цена продажи и окупаемость не занижались.
const crmIn = (w) => (CRM ? Object.assign(crmSums(CRM.rows.filter((r) => inWin(r, w) && ofTpl(r.template))),
  {cost: d3.sum(rowsIn(w).filter((r) => r.day >= CRM.from), (r) => r.cost)}) : null);

function sums(rows) {
  const a = {sent: 0, delivered: 0, read: 0, resp: 0, neg: 0, cost: 0};
  for (const r of rows) { a.sent += r.sent; a.delivered += r.delivered; a.read += r.read; a.resp += r.resp; a.neg += r.neg; a.cost += r.cost; }
  return Object.assign(a, {
    undelivered: Math.max(0, a.sent - a.delivered),
    undeliv_rate: a.sent ? Math.max(0, a.sent - a.delivered) / a.sent : null,
    read_rate: a.delivered ? a.read / a.delivered : null,
    resp_rate: a.delivered ? a.resp / a.delivered : null,
    neg_rate: a.delivered ? a.neg / a.delivered : null,
    cpr: a.resp ? a.cost / a.resp : null,
  });
}

function byTemplate(rows, crmRows) {
  const acc = new Map();
  for (const r of rows) {
    if (!acc.has(r.name)) acc.set(r.name, []);
    acc.get(r.name).push(r);
  }
  const crmBy = d3.rollup(crmRows || [], crmSums, (r) => r.template);
  return [...acc].map(([name, list]) => {
    const t = {name, ...sums(list), ...(crmBy.get(name) || {leads: 0, deals: 0, revenue: 0, paid: 0})};
    if (CRM) t.crmCost = d3.sum(list.filter((r) => r.day >= CRM.from), (r) => r.cost);
    t.unconfirmed = Boolean(CRM && CRM.unconfirmed.has(name));
    return Object.assign(t, {roi: t.unconfirmed ? null : roiOf(t.revenue, t.crmCost)});
  }).filter((t) => t.sent > 0);
}

// ROI = (выручка − расходы) / расходы. Расходы — только за дни с данными CRM; без расходов ROI не считаем.
const roiOf = (revenue, cost) => (CRM && cost ? (revenue - cost) / cost : null);
const fmtRoi = (v) => (ok(v) ? `${v > 0 ? '+' : ''}${fmt.pct(v)}` : '—');

// ===== Отрисовка =====

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'style') e.style.cssText = v;
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) e.append(c);
  return e;
}
const byId = (id) => document.getElementById(id);
const emptyIn = (node, text) => node.replaceChildren(el('div', {class: 'empty', text}));

function render() {
  for (const b of document.querySelectorAll('[data-unit]')) b.setAttribute('aria-pressed', String(state.unit === b.dataset.unit));
  for (const b of document.querySelectorAll('#app [data-step]')) b.disabled = !canStep(+b.dataset.step);
  byId('crm-chip').hidden = !(CRM && CRM.source === 'mock');
  // Режим шаблона: вместо списка шаблонов — карточка выбранного, остальное считается только по нему.
  const detail = Boolean(state.tpl);
  for (const id of ['phone', 'top-card', 'buttons-card']) byId(id).hidden = detail;
  byId('detail').hidden = !detail;
  const upd = M.updatedAt ? new Date(M.updatedAt).toLocaleString('ru-RU', {dateStyle: 'short', timeStyle: 'short'}) : '—';
  byId('sub').textContent = `${M.demo ? 'Демо: все данные случайные · ' : ''}Данные с ${fmt.day(M.firstDay)} по ${fmt.day(M.lastDay)} · обновлено ${upd}`;

  const w = win();
  const rows = rowsIn(w);
  const total = sums(rows);
  const sales = crmIn(w);
  const pw = prevWin(w);
  const prevAll = pw ? sums(rowsIn(pw)) : null;
  const n = spanDays(w);
  // Не сравниваем, если в текущем периоде ещё нет отправок (например, утро понедельника) или в прошлом их было мало.
  const prev = total.sent && prevAll && prevAll.delivered >= prevMinDelivered(n) ? Object.assign(prevAll, {label: prevLabel(n)}) : null;
  byId('range-text').textContent = rangeLabel(w);
  byId('range').title = `${fmt.day(w.from)} – ${fmt.day(w.to)}`;
  // Пояснение к процентам изменений в карточках — один раз здесь, а не в каждой карточке.
  byId('cmp').textContent = prev ? `изменения ${prev.label}` : '';
  renderPhone(M.phone);
  renderKpis(total, sales, prev);
  drawDays(byId('ch-days'), w, rows);
  drawFunnel(byId('ch-funnel'), total, sales);
  const clicks = M.buttons.filter((b) => inWin(b, w) && ofTpl(b.name));
  drawButtons(byId('ch-buttons'), clicks);
  drawWeekly(byId('ch-weekly'), w);
  drawWeekday(byId('ch-weekday'), w);
  drawCost(byId('ch-cost'), w, rows);
  drawCpr(byId('ch-cpr'), w);
  // Таблица показывает все шаблоны периода, чтобы можно было переключаться между ними.
  const periodCrm = CRM ? CRM.rows.filter((r) => inWin(r, w)) : null;
  const list = byTemplate(M.daily.filter((r) => inWin(r, w)), periodCrm);
  renderTable(list);
  if (detail) renderDetail(state.tpl, total, list, clicks);
  VIEW = {w, rows, total, sales, clicks};
}

// Изменение к прошлому периоду: «+12%», полный текст «к прошлой неделе» — в подсказке.
// upIsGood — рост это хорошо (зелёный) или плохо (красный).
function delta(cur, prev, key, upIsGood) {
  if (!prev || !prev[key]) return null;
  const v = cur[key] / prev[key] - 1;
  if (!Number.isFinite(v)) return null;
  const sign = v > 0.0005 ? '+' : v < -0.0005 ? '−' : '±';
  const cls = sign === '±' ? '' : (v > 0) === upIsGood ? 'good' : 'bad';
  const text = `${sign}${nf1.format(Math.abs(v) * 100)}%`;
  return el('span', {class: `delta ${cls}`, text, title: `${text} ${prev.label}`});
}

function renderKpis(s, sales, prev) {
  const kpi = (accent, label, value, extra, note, title, change) => el('div', {class: 'kpi glass', style: `--accent:${accent}`, title: title || ''},
    el('span', {class: 'label'}, el('i'), label),
    el('span', {class: 'value'}, value, extra ? el('small', {text: extra}) : null),
    change || null,
    note ? el('span', {class: 'note', text: note}) : null);
  // Что считается и от чего процент — в подсказке при наведении, чтобы не загромождать карточки.
  const cards = [
    kpi('var(--blue)', 'Отправлено', fmt.int(s.sent), null, '', '', delta(s, prev, 'sent', true)),
    kpi('var(--green)', 'Прочитано', fmt.int(s.read), fmt.pct(s.read_rate), '', 'Процент — от доставленных',
      delta(s, prev, 'read', true)),
    kpi('var(--yellow)', 'Отклик', fmt.int(s.resp), fmt.pct(s.resp_rate), '',
      'Нажатия на кнопки интереса и переходы по ссылке. Процент — от доставленных', delta(s, prev, 'resp', true)),
    kpi('var(--red)', 'Отказы', fmt.int(s.neg), fmt.pct(s.neg_rate), '',
      'Нажатия «не нужно», «не беспокоить». Процент — от доставленных', delta(s, prev, 'neg', false)),
    kpi('var(--grey)', 'Не доставлено', fmt.int(s.undelivered), fmt.pct(s.undeliv_rate), '', 'Процент — от отправленных',
      delta(s, prev, 'undelivered', false)),
    kpi('var(--violet)', 'Расходы', fmt.kzt(s.cost), null, s.cpr ? `${fmt.kzt(s.cpr)} за один отклик` : '', '',
      delta(s, prev, 'cost', false)),
  ];
  if (sales) {
    const {leads, deals, revenue, paid, cost} = sales;
    const byDay = 'Считается по дню рассылки: сделки, которым шаблон отправили в этом периоде';
    const since = CRM.from > win().from ? ` Расходы для сравнения — с ${fmt.day(CRM.from)}: раньше данных CRM нет.` : '';
    const roi = roiOf(revenue, cost);
    cards.push(
      kpi('var(--blue)', 'Лиды', fmt.int(leads), null, 'перешли в ОП',
        `Сделки CRM (${CRM.label}), которые после рассылки перевели в отдел продаж. ${byDay}`),
      kpi('var(--green)', 'Продажи', fmt.int(deals), leads ? fmt.pct(deals / leads) : null, deals && cost ? `${fmt.kzt(cost / deals)} за одну продажу` : '',
        `Сделки в стадии «Сделка успешна». Процент — от лидов. ${byDay}.${since}`),
      kpi('var(--green)', 'Выручка', fmt.kzt(revenue), null, `из них оплачено ${fmt.kzt(paid)}`,
        `Полная цена договоров: оплачено («Сумма» сделки) + долг («Қарыз»). ${byDay}.`),
      kpi(roi == null || roi >= 0 ? 'var(--green)' : 'var(--red)', 'ROI', fmtRoi(roi), null,
        cost ? `${revenue >= cost ? 'прибыль' : 'убыток'} ${fmt.kzt(Math.abs(revenue - cost))} при расходах ${fmt.kzt(cost)}` : '',
        `(выручка − расходы) / расходы. Выручка — полная цена договоров. ${byDay}.${since}`));
  }
  byId('kpis').replaceChildren(...cards);
}

// ----- качество номера и лимит рассылок -----

function renderPhone(p) {
  const node = byId('phone');
  if (!p) {
    node.className = 'status glass';
    node.replaceChildren(el('span', {class: 'muted', text: 'Качество номера появится после обновления скрипта таблицы.'}));
    return;
  }
  const [qText, qColor] = QUALITY[p.quality] || ['Нет оценки', 'var(--grey)'];
  const [sText, sColor] = CAN_SEND[p.canSend] || [p.canSend ? p.canSend.toLowerCase() : '—', 'var(--grey)'];
  const limit = LIMIT[p.limit] || (p.limit ? p.limit.replace('TIER_', '') : '—');
  const risk = p.quality === 'YELLOW' || p.quality === 'RED' || p.canSend === 'LIMITED' || p.canSend === 'BLOCKED';
  const item = (label, ...value) => el('span', {class: 'st'}, el('span', {class: 'muted', text: label}), ...value);
  const dot = (color) => el('i', {class: 'dot', style: `background:${color}`});
  const checked = p.checkedAt ? new Date(p.checkedAt).toLocaleString('ru-RU', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) : '—';
  const was = p.prevQuality && QUALITY[p.prevQuality] ? ` (было: ${QUALITY[p.prevQuality][0].toLowerCase()})` : '';
  node.className = `status glass${risk ? ' risk' : ''}`;
  node.replaceChildren(
    item('Качество номера', dot(qColor), el('b', {text: qText}), el('span', {class: 'muted', text: `с ${fmt.day(p.qualitySince).slice(0, 5)}${was}`})),
    item('Лимит', el('b', {text: limit}), el('span', {class: 'muted', text: limit === 'без ограничений' ? '' : 'получателей в сутки'})),
    item('Отправка', dot(sColor), el('b', {text: sText})),
    el('span', {class: 'muted st-time', text: `проверено ${checked}`}),
    ...(risk ? [el('span', {class: 'st-warn', text: 'Риск ограничений: снизьте частоту рассылок и уберите шаблоны с высокими отказами.'})] : []));
}

// ----- общие куски графиков -----

// Высоту можно переопределить data-h у контейнера: в развёрнутом виде графики выше.
function frame(node, H) {
  H = +node.dataset.h || H;
  node.replaceChildren();
  const W = Math.max(280, node.clientWidth);
  const svg = d3.select(node).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`);
  svg.append('rect').attr('width', W).attr('height', H).attr('fill', 'transparent');
  const tip = el('div', {class: 'tip'});
  tip.hidden = true;
  node.append(tip);
  const show = (head, lines, x, y) => {
    tip.replaceChildren(el('div', {class: 't', text: head}), ...lines.map(([color, text]) =>
      el('div', {class: 'row'}, color ? el('i', {class: 'sw', style: `background:${color}`}) : null, text)));
    tip.hidden = false;
    const k = node.clientWidth / W, tw = tip.offsetWidth, px = x * k;
    tip.style.left = `${Math.max(0, Math.min(node.clientWidth - tw, px + 14 + tw > node.clientWidth ? px - tw - 14 : px + 14))}px`;
    tip.style.top = `${Math.max(0, y * k - 12)}px`;
  };
  return {svg, W, H, show, hide: () => { tip.hidden = true; }};
}
function leftMargin(svg, labels) {
  const probe = svg.append('g').selectAll('text').data(labels).join('text').text((s) => s);
  const w = d3.max(probe.nodes(), (n) => n.getComputedTextLength()) || 0;
  probe.remove();
  return Math.ceil(w) + 10;
}
function yGrid(svg, y, ticks, left, right, tf) {
  svg.append('g').selectAll('line').data(ticks).join('line').attr('x1', left).attr('x2', right)
    .attr('y1', (v) => y(v)).attr('y2', (v) => y(v)).attr('stroke', 'var(--grid)');
  svg.append('g').selectAll('text').data(ticks).join('text').attr('x', left - 8).attr('y', (v) => y(v))
    .attr('dy', '0.32em').attr('text-anchor', 'end').text(tf);
}
// Подписи дат под осью: не чаще чем через ~54 px, крайняя прижата к краю.
function xLabels(svg, items, xFn, textFn, W, left, H) {
  const step = Math.max(1, Math.ceil(items.length / Math.max(1, Math.floor((W - left) / 54))));
  svg.append('g').selectAll('text').data(items.filter((d, i) => (items.length - 1 - i) % step === 0)).join('text')
    .attr('x', xFn).attr('y', H - 6).attr('text-anchor', 'middle').text(textFn)
    .each(function () {
      const b = this.getBBox();
      if (b.x + b.width > W) { this.setAttribute('text-anchor', 'end'); this.setAttribute('x', W - 1); }
    });
}
// Номер столбца под курсором: столбцы идут подряд с шагом step от left.
const hitIndex = (ev, left, step, n) => Math.max(0, Math.min(n - 1, Math.floor((d3.pointer(ev)[0] - left) / step)));

function perDay(w, rows, keys) {
  const by = new Map(dayList(w.from, w.to).map((day) => [day, Object.fromEntries([['day', day], ...keys.map((k) => [k, 0])])]));
  for (const r of rows) {
    const a = by.get(r.day);
    if (a) for (const k of keys) a[k] += r[k];
  }
  return [...by.values()];
}

// ----- динамика по дням: вложенные столбцы -----

function drawDays(node, w, rows) {
  const days = perDay(w, rows, ['sent', 'read', 'resp', 'neg', 'cost']);
  if (!d3.max(days, (d) => d.sent)) { emptyIn(node, 'За этот период отправок нет'); return; }
  const {svg, W, H, show, hide} = frame(node, 320);
  const top = 8, bottom = 24;
  const y = d3.scaleLinear([0, d3.max(days, (d) => d.sent)], [H - bottom, top]).nice();
  const ticks = y.ticks(5);
  const left = leftMargin(svg, ticks.map(fmt.int));
  const x = d3.scaleBand(days.map((d) => d.day), [left, W - 4]).paddingInner(days.length > 60 ? 0.12 : 0.22);
  yGrid(svg, y, ticks, left, W - 4, fmt.int);
  const bw = x.bandwidth();
  const inner = (k) => (d) => x(d.day) + (bw * (1 - k)) / 2;
  const bar = (cls, xFn, wd, y0, y1) => svg.append('g').selectAll('rect').data(days).join('rect').attr('class', cls)
    .attr('x', xFn).attr('width', wd).attr('rx', Math.min(2, wd / 2))
    .attr('y', (d) => y(y1(d))).attr('height', (d) => Math.max(0, y(y0(d)) - y(y1(d))));
  const groups = [
    bar('b-sent', (d) => x(d.day), bw, () => 0, (d) => d.sent),
    bar('b-read', inner(0.62), bw * 0.62, () => 0, (d) => d.read),
    bar('b-resp', inner(0.34), bw * 0.34, () => 0, (d) => d.resp),
    bar('b-neg', inner(0.34), bw * 0.34, (d) => d.resp, (d) => d.resp + d.neg),
  ];
  xLabels(svg, days, (d) => x(d.day) + bw / 2, (d) => fmt.short(d.day), W, left, H);
  svg.on('pointermove', (ev) => {
    const [mx, my] = d3.pointer(ev);
    const d = days[Math.max(0, Math.min(days.length - 1, Math.floor((mx - left) / x.step())))];
    for (const g of groups) g.attr('opacity', (r) => (r === d ? 1 : 0.4));
    const share = (v) => (d.sent ? ` · ${fmt.pct(v / d.sent)}` : '');
    show(`${fmt.day(d.day)}, ${WEEKDAYS[weekday(d.day)]}`, [
      ['var(--blue)', `Отправлено: ${fmt.int(d.sent)}`],
      ['var(--green)', `Прочитано: ${fmt.int(d.read)}${share(d.read)}`],
      ['var(--yellow)', `Отклик: ${fmt.int(d.resp)}${share(d.resp)}`],
      ['var(--red)', `Отказы: ${fmt.int(d.neg)}${share(d.neg)}`],
      ['var(--violet)', `Расходы: ${fmt.kzt(d.cost)}`],
    ], x(d.day) + bw / 2, my);
  }).on('pointerleave', () => { hide(); for (const g of groups) g.attr('opacity', 1); })
    .on('click', (ev) => pickItem(ev, node, 'days', days[hitIndex(ev, left, x.step(), days.length)].day));
}

// ----- воронка: от отправки до отклика -----

function drawFunnel(node, s, sales) {
  if (!s.sent) { emptyIn(node, 'За этот период отправок нет'); return; }
  // Прочитавшие делятся на три части: отклик, отказ и «не ответили» (не нажали ни одной кнопки).
  // Нажатия — не люди, поэтому остаток может уйти в минус; тогда показываем ноль.
  const silent = Math.max(0, s.read - s.resp - s.neg);
  const ofDelivered = (v) => `${fmt.pct(s.delivered ? v / s.delivered : null)} от доставленных`;
  const steps = [
    ['Отправлено', s.sent, 'rgba(79, 140, 255, 0.45)', ''],
    ['Доставлено', s.delivered, 'var(--blue)', `${fmt.pct(s.delivered / s.sent)} от отправленных`],
    ['Прочитано', s.read, 'var(--green)', ofDelivered(s.read)],
    ['Отклик', s.resp, 'var(--yellow)', ofDelivered(s.resp)],
    // Лиды и покупки — из CRM (amoCRM, Битрикс), когда данные есть.
    ...(sales ? [['Перешли в ОП', sales.leads, 'var(--blue)', ofDelivered(sales.leads)],
      ['Покупки', sales.deals, 'var(--violet)', `${fmt.pct(sales.leads ? sales.deals / sales.leads : null)} от лидов`]] : []),
    ['Отказы', s.neg, 'var(--red)', ofDelivered(s.neg)],
    ['Не ответили', silent, 'var(--grey)', ofDelivered(silent)],
  ];
  node.replaceChildren(...steps.map(([label, v, color, note]) => el('div', {class: 'hb-row'},
    el('span', {class: 'hb-label'}, label, note ? el('small', {text: note}) : null),
    el('span', {class: 'hb-track'}, el('i', {style: `width:${Math.min(100, Math.max(0.5, (100 * v) / s.sent))}%;background:${color}`})),
    el('b', {class: 'hb-val', text: fmt.int(v)}))),
  ...(s.read ? [el('p', {class: 'hint', text: `Не ответили — прочитали, но не нажали ни одной кнопки. ` +
    `Из прочитавших ответили ${fmt.pct(s.resp / s.read)}.`})] : []));
}

// ----- какие кнопки нажимают -----

function drawButtons(node, list) {
  const all = d3.rollups(list, (v) => ({clicks: d3.sum(v, (b) => b.clicks), kind: v[0].kind}), (b) => b.button)
    .map(([button, a]) => ({button: a.kind === 'Ссылка' ? 'Переход по ссылке' : button, ...a}))
    .sort((a, b) => b.clicks - a.clicks);
  if (!all.length) { emptyIn(node, 'За этот период нажатий нет'); return; }
  const top = all.slice(0, BUTTONS_TOP), max = top[0].clicks, total = d3.sum(all, (b) => b.clicks);
  const rest = all.length - top.length, restClicks = total - d3.sum(top, (b) => b.clicks);
  node.replaceChildren(...top.map((b) => el('div', {class: 'hb-row', title: `${b.button}: ${fmt.pct(b.clicks / total)} всех нажатий`},
    el('span', {class: 'hb-label', text: b.button}),
    el('span', {class: 'hb-track'}, el('i', {style: `width:${Math.max(0.5, (100 * b.clicks) / max)}%;background:${BUTTON_COLOR[b.kind] || 'var(--grey)'}`})),
    el('b', {class: 'hb-val', text: fmt.int(b.clicks)}))),
  ...(rest > 0 ? [el('p', {class: 'hint', text: `Ещё ${rest} ${plural(rest, 'кнопка', 'кнопки', 'кнопок')}: ` +
    `${fmt.int(restClicks)} ${plural(restClicks, 'нажатие', 'нажатия', 'нажатий')}.`})] : []));
}

// Недели с понедельника по всей истории; недели с малым числом доставок шумные и не показываются.
function weeklyRows() {
  const minDelivered = state.tpl ? 30 : 200;
  const acc = new Map();
  for (const r of M.daily) {
    if (!ofTpl(r.name)) continue;
    const wk = addDays(r.day, -weekday(r.day));
    const a = acc.get(wk) || {week: wk, delivered: 0, resp: 0, neg: 0, cost: 0};
    a.delivered += r.delivered; a.resp += r.resp; a.neg += r.neg; a.cost += r.cost;
    acc.set(wk, a);
  }
  return [...acc.values()].filter((a) => a.delivered >= minDelivered).sort((a, b) => (a.week < b.week ? -1 : 1));
}

// ----- отклик и отказы по неделям: линии + пунктир среднего (вся история) -----

function drawWeekly(node, w) {
  const rows = weeklyRows().map((a) => ({...a, date: toDate(a.week), pos: a.resp / a.delivered, negr: a.neg / a.delivered}));
  if (rows.length < 2) { emptyIn(node, 'Мало недель с отправками'); return; }
  // Среднее — за все показанные недели, по сумме: недели с большими рассылками весят больше.
  const del = d3.sum(rows, (r) => r.delivered);
  const avg = {pos: d3.sum(rows, (r) => r.resp) / del, negr: d3.sum(rows, (r) => r.neg) / del};
  const {svg, W, H, show, hide} = frame(node, 260);
  const top = 10, bottom = 24, right = 64;
  const y = d3.scaleLinear([0, d3.max(rows, (r) => Math.max(r.pos, r.negr)) || 0.1], [H - bottom, top]).nice();
  const ticks = y.ticks(4), tf = y.tickFormat(4, '%');
  const left = leftMargin(svg, ticks.map(tf));
  const x = d3.scaleUtc(d3.extent(rows, (r) => r.date), [left + 6, W - right]);
  // Выбранный период подсвечен фоном.
  const x0 = Math.max(left, x(toDate(w.from)) - 3), x1 = Math.min(W - right, x(toDate(w.to)) + 3);
  if (x1 > x0) {
    svg.append('rect').attr('x', x0).attr('width', Math.max(4, x1 - x0)).attr('y', top).attr('height', H - bottom - top)
      .attr('fill', 'rgba(79,140,255,0.08)');
  }
  yGrid(svg, y, ticks, left, W - right, tf);
  xLabels(svg, rows, (r) => x(r.date), (r) => fmt.short(r.week), W - right, left, H);
  const series = [['pos', 'var(--yellow)'], ['negr', 'var(--red)']];
  // Пунктир среднего и подпись справа; близкие подписи разводим, чтобы не наезжали.
  const labelY = {pos: y(avg.pos), negr: y(avg.negr)};
  if (Math.abs(labelY.pos - labelY.negr) < 13) labelY.negr = labelY.pos + 13;
  for (const [f, c] of series) {
    svg.append('line').attr('x1', left).attr('x2', W - right + 4).attr('y1', y(avg[f])).attr('y2', y(avg[f]))
      .attr('stroke', c).attr('stroke-width', 1.5).attr('stroke-dasharray', '5 4');
    svg.append('text').attr('x', W - right + 8).attr('y', labelY[f]).attr('dy', '0.32em')
      .style('fill', c).style('font-weight', 600).text(`ср. ${fmt.pct(avg[f])}`);
  }
  for (const [f, c] of series) {
    svg.append('path').datum(rows).attr('d', d3.line((r) => x(r.date), (r) => y(r[f])))
      .attr('fill', 'none').attr('stroke', c).attr('stroke-width', 2.25).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round');
  }
  const dots = series.map(([, c]) => svg.append('circle').attr('r', 4).attr('fill', c).attr('opacity', 0));
  const near = d3.bisector((r) => r.date).center;
  const at = (ev) => rows[near(rows, x.invert(d3.pointer(ev)[0]))];
  svg.on('pointermove', (ev) => {
    const r = at(ev);
    series.forEach(([f], i) => dots[i].attr('cx', x(r.date)).attr('cy', y(r[f])).attr('opacity', 1));
    const vs = (v, a) => (v > a ? 'выше среднего' : v < a ? 'ниже среднего' : 'как в среднем');
    show(`Неделя с ${fmt.day(r.week)}`, [
      ['var(--yellow)', `Отклик: ${fmt.pct(r.pos)} — ${vs(r.pos, avg.pos)}`],
      ['var(--red)', `Отказы: ${fmt.pct(r.negr)} — ${vs(r.negr, avg.negr)}`],
      [null, `Доставлено: ${fmt.int(r.delivered)}`],
    ], x(r.date), y(r.pos));
  }).on('pointerleave', () => { hide(); dots.forEach((d) => d.attr('opacity', 0)); })
    .on('click', (ev) => pickItem(ev, node, 'weekly', at(ev).week));
}

// ----- расходы по дням -----

function drawCost(node, w, rows) {
  const days = perDay(w, rows, ['cost', 'delivered', 'resp']);
  if (!d3.max(days, (d) => d.cost)) { emptyIn(node, 'За этот период расходов нет'); return; }
  const {svg, W, H, show, hide} = frame(node, 260);
  const top = 8, bottom = 24;
  const y = d3.scaleLinear([0, d3.max(days, (d) => d.cost)], [H - bottom, top]).nice();
  const ticks = y.ticks(4), tf = (v) => nf0.format(v);
  const left = leftMargin(svg, ticks.map(tf));
  const x = d3.scaleBand(days.map((d) => d.day), [left, W - 4]).paddingInner(days.length > 60 ? 0.12 : 0.22);
  yGrid(svg, y, ticks, left, W - 4, tf);
  const bars = svg.append('g').selectAll('rect').data(days).join('rect').attr('class', 'b-cost')
    .attr('x', (d) => x(d.day)).attr('width', x.bandwidth()).attr('y', (d) => y(d.cost))
    .attr('height', (d) => Math.max(0, y(0) - y(d.cost))).attr('rx', Math.min(3, x.bandwidth() / 2));
  xLabels(svg, days, (d) => x(d.day) + x.bandwidth() / 2, (d) => fmt.short(d.day), W, left, H);
  svg.on('pointermove', (ev) => {
    const [mx, my] = d3.pointer(ev);
    const d = days[Math.max(0, Math.min(days.length - 1, Math.floor((mx - left) / x.step())))];
    bars.attr('opacity', (b) => (b === d ? 1 : 0.45));
    show(`${fmt.day(d.day)}, ${WEEKDAYS[weekday(d.day)]}`, [['var(--violet)', `Расходы: ${fmt.kzt(d.cost)}`],
      [null, `Доставлено: ${fmt.int(d.delivered)}`], [null, `За один отклик: ${d.resp ? fmt.kzt(d.cost / d.resp) : '—'}`]],
    x(d.day) + x.bandwidth() / 2, my);
  }).on('pointerleave', () => { hide(); bars.attr('opacity', 1); })
    .on('click', (ev) => pickItem(ev, node, 'cost', days[hitIndex(ev, left, x.step(), days.length)].day));
}

// ----- лучший день для рассылки: отклик по дням недели -----

// Отклик по дням недели. В коротком периоде на каждый день недели приходится одна-две рассылки,
// поэтому берём 90 дней до его конца. День, на который пришлось меньше 3% доставок, помечен few: его процент случаен.
function weekdayStats(w) {
  const short = spanDays(w) < 28;
  const range = short ? {from: addDays(w.to, -89), to: w.to} : w;
  const days = WEEKDAYS.map((name, i) => ({name, i, sent: 0, delivered: 0, resp: 0, neg: 0}));
  for (const r of M.daily) {
    if (!inWin(r, range) || !ofTpl(r.name)) continue;
    const d = days[weekday(r.day)];
    d.sent += r.sent; d.delivered += r.delivered; d.resp += r.resp; d.neg += r.neg;
  }
  const total = d3.sum(days, (d) => d.delivered);
  const minDelivered = Math.max(30, total * 0.03);
  for (const d of days) {
    Object.assign(d, {rate: d.delivered ? d.resp / d.delivered : null, neg_rate: d.delivered ? d.neg / d.delivered : null,
      few: d.delivered < minDelivered});
  }
  const valid = days.filter((d) => !d.few && d.rate != null);
  return {days, total, short, range, minDelivered, best: d3.greatest(valid, (d) => d.rate), worst: d3.least(valid, (d) => d.rate)};
}

function drawWeekday(node, w) {
  const hint = byId('weekday-hint');
  const {days, total, short, best} = weekdayStats(w);
  if (!total) { emptyIn(node, 'За этот период отправок нет'); hint.textContent = ''; return; }
  const few = days.some((d) => d.few);
  hint.textContent = (best ? `${short ? 'За 90 дней л' : 'Л'}учше всего отвечают ${WEEKDAYS_IN[best.i]}: ${fmt.pct(best.rate)}.` : '') +
    (few ? ' «Мало» — в этот день почти не отправляли, процент был бы случайным.' : '');

  const {svg, W, H, show, hide} = frame(node, 260);
  const top = 22, bottom = 24;
  // Шкалу задают только дни с нормальным числом отправок. Meta считает нажатие в день нажатия, а не отправки,
  // поэтому у почти пустого дня процент бывает и больше 100. Такой день рисуется низкой серой меткой «мало».
  const rateMax = d3.max(days, (d) => (d.few ? 0 : d.rate || 0)) || 0.1;
  const y = d3.scaleLinear([0, rateMax], [H - bottom, top]).nice();
  const ticks = y.ticks(4), tf = y.tickFormat(4, '%');
  const left = leftMargin(svg, ticks.map(tf));
  const x = d3.scaleBand(WEEKDAYS, [left, W - 4]).paddingInner(0.3);
  yGrid(svg, y, ticks, left, W - 4, tf);
  const barTop = (d) => (d.few ? y(0) - 4 : y(d.rate || 0));
  const bars = svg.append('g').selectAll('rect').data(days).join('rect')
    .attr('x', (d) => x(d.name)).attr('width', x.bandwidth()).attr('rx', Math.min(2, x.bandwidth() / 2))
    .attr('y', barTop).attr('height', (d) => Math.max(0, y(0) - barTop(d)))
    .attr('fill', (d) => (d.few ? 'var(--grey)' : 'var(--yellow)'))
    .attr('fill-opacity', (d) => (d === best ? 1 : d.few ? 0.5 : 0.55));
  svg.append('g').selectAll('text').data(days.filter((d) => d.rate != null)).join('text')
    .attr('x', (d) => x(d.name) + x.bandwidth() / 2).attr('y', (d) => barTop(d) - 6).attr('text-anchor', 'middle')
    .attr('class', (d) => (d === best ? 'best' : null)).text((d) => (d.few ? 'мало' : nf1.format(d.rate * 100)));
  svg.append('g').selectAll('text').data(days).join('text')
    .attr('x', (d) => x(d.name) + x.bandwidth() / 2).attr('y', H - 6).attr('text-anchor', 'middle').text((d) => d.name);
  svg.on('pointermove', (ev) => {
    const [mx, my] = d3.pointer(ev);
    const d = days[Math.max(0, Math.min(6, Math.floor((mx - left) / x.step())))];
    bars.attr('opacity', (b) => (b === d ? 1 : 0.5));
    show(`${WEEKDAYS_FULL[d.i]}${d === best ? ' — лучший день' : ''}`, [
      ['var(--yellow)', `Отклик: ${fmt.pct(d.rate)}`],
      ['var(--red)', `Отказы: ${d.delivered ? fmt.pct(d.neg / d.delivered) : '—'}`],
      [null, `Отправлено: ${fmt.int(d.sent)}`],
      ...(d.few ? [[null, 'Мало отправок — процент случаен']] : []),
    ], x(d.name) + x.bandwidth() / 2, my);
  }).on('pointerleave', () => { hide(); bars.attr('opacity', 1); })
    .on('click', (ev) => pickItem(ev, node, 'weekday', days[hitIndex(ev, left, x.step(), 7)].i));
}

// ----- цена одного отклика по неделям (вся история) -----

function drawCpr(node, w) {
  const rows = weeklyRows().filter((a) => a.resp > 0).map((a) => ({...a, cpr: a.cost / a.resp}));
  if (rows.length < 2) { emptyIn(node, 'Мало недель с откликами'); return; }
  const {svg, W, H, show, hide} = frame(node, 260);
  const top = 8, bottom = 24;
  const y = d3.scaleLinear([0, d3.max(rows, (r) => r.cpr)], [H - bottom, top]).nice();
  const ticks = y.ticks(4), tf = (v) => nf0.format(v);
  const left = leftMargin(svg, ticks.map(tf));
  const x = d3.scaleBand(rows.map((r) => r.week), [left, W - 4]).paddingInner(0.25);
  yGrid(svg, y, ticks, left, W - 4, tf);
  // Недели выбранного периода яркие, остальные приглушены.
  const inPeriod = (r) => addDays(r.week, 6) >= w.from && r.week <= w.to;
  const bw = Math.min(x.bandwidth(), 40); // при двух-трёх неделях не растягиваем столбцы на всю ширину
  const bars = svg.append('g').selectAll('rect').data(rows).join('rect').attr('class', 'b-cost')
    .attr('x', (r) => x(r.week) + (x.bandwidth() - bw) / 2).attr('width', bw).attr('y', (r) => y(r.cpr))
    .attr('height', (r) => Math.max(0, y(0) - y(r.cpr))).attr('rx', Math.min(3, bw / 2))
    .attr('fill-opacity', (r) => (inPeriod(r) ? 1 : 0.35));
  xLabels(svg, rows, (r) => x(r.week) + x.bandwidth() / 2, (r) => fmt.short(r.week), W, left, H);
  svg.on('pointermove', (ev) => {
    const [mx, my] = d3.pointer(ev);
    const r = rows[Math.max(0, Math.min(rows.length - 1, Math.floor((mx - left) / x.step())))];
    bars.attr('opacity', (b) => (b === r ? 1 : 0.5));
    show(`Неделя с ${fmt.day(r.week)}`, [['var(--violet)', `За один отклик: ${fmt.kzt(r.cpr)}`],
      [null, `Расходы: ${fmt.kzt(r.cost)}`], [null, `Откликов: ${fmt.int(r.resp)}`]], x(r.week) + x.bandwidth() / 2, my);
  }).on('pointerleave', () => { hide(); bars.attr('opacity', 1); })
    .on('click', (ev) => pickItem(ev, node, 'cpr', rows[hitIndex(ev, left, x.step(), rows.length)].week));
}

// ----- таблица «Больше всего откликов» -----

function renderTable(list) {
  const q = state.q.trim().toLowerCase();
  const {key, dir} = state.sort;
  const rank = new Map(list.slice().sort((a, b) => b.resp - a.resp).map((r, i) => [r.name, i + 1]));
  const rows = list.filter((r) => !q || r.name.toLowerCase().includes(q))
    .sort((a, b) => dir * (key === 'name' ? a.name.localeCompare(b.name) : (a[key] ?? -1) - (b[key] ?? -1)));
  exportRows = rows;
  const maxResp = d3.max(list, (r) => r.resp) || 1;
  const cols = [
    {key: 'rank', label: '#', cls: 'rank', v: (r) => String(rank.get(r.name)), noSort: true},
    {key: 'name', label: 'Шаблон', cls: 'name'},
    {key: 'sent', label: 'Отправлено', n: true, v: (r) => fmt.int(r.sent), hideSm: true},
    {key: 'read', label: 'Прочитано', n: true, v: (r) => fmt.int(r.read), hideSm: true},
    {key: 'resp', label: 'Отклик', n: true, v: (r) => el('span', {class: 'resp-cell'}, el('span', {text: fmt.int(r.resp)}),
      el('i', {style: `width:${Math.max(4, (100 * r.resp) / maxResp)}%`}))},
    {key: 'resp_rate', label: 'Отклик, %', n: true, v: (r) => el('span', {class: 'pct', text: fmt.pct(r.resp_rate)})},
    {key: 'neg', label: 'Отказы', n: true, v: (r) => el('span', {class: 'neg', text: fmt.int(r.neg)}), hideSm: true},
    {key: 'cost', label: 'Расходы', n: true, v: (r) => fmt.kzt(r.cost), hideSm: true},
  ];
  if (CRM) {
    cols.push({key: 'leads', label: 'Лиды', n: true, v: (r) => fmt.int(r.leads)},
      {key: 'deals', label: 'Продажи', n: true, v: (r) => fmt.int(r.deals)},
      {key: 'revenue', label: 'Выручка', n: true, v: (r) => fmt.kzt(r.revenue), hideSm: true},
      {key: 'roi', label: 'ROI', n: true, hideSm: true, v: (r) => (r.unconfirmed
        ? el('span', {class: 'muted', text: 'не подтв.', title: 'Рассылки этого шаблона в CRM не подтверждены отправками номера 1100 по Meta — лиды и ROI не считаются. Подробнее во вкладке «Базы».'})
        : el('span', {class: ok(r.roi) && r.roi < 0 ? 'neg' : 'pct', text: fmtRoi(r.roi)}))});
  }
  const cls = (c) => [c.cls, c.n ? 'n' : '', c.hideSm ? 'hide-sm' : ''].filter(Boolean).join(' ');
  const head = el('tr', {}, cols.map((c) => {
    const th = el('th', {class: cls(c), 'aria-sort': key === c.key ? (dir > 0 ? 'ascending' : 'descending') : 'none'});
    if (c.noSort) { th.textContent = c.label; return th; }
    const b = el('button', {type: 'button', text: c.label});
    b.addEventListener('click', () => {
      state.sort = key === c.key ? {key, dir: -dir} : {key: c.key, dir: c.n ? -1 : 1};
      renderTable(list);
    });
    th.append(b);
    return th;
  }));
  const body = rows.length
    ? rows.map((r) => {
      const tr = el('tr', {'data-name': r.name, tabindex: '0', title: 'Открыть шаблон'}, cols.map((c) => {
        const td = el('td', {class: cls(c)});
        const v = c.v ? c.v(r) : r[c.key];
        if (v instanceof Node) td.append(v); else td.textContent = v;
        return td;
      }));
      tr.addEventListener('click', () => selectTemplate(r.name));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') selectTemplate(r.name); });
      return tr;
    })
    : [el('tr', {}, el('td', {colspan: String(cols.length), class: 'hint', text: 'Нет шаблонов с отправками за этот период'}))];
  byId('t-top').replaceChildren(el('thead', {}, head), el('tbody', {}, body));
}

// ----- выгрузка таблицы шаблонов в Excel -----

let exportRows = [];
const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

function loadXlsx() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = XLSX_URL;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Не удалось загрузить модуль Excel'));
    document.head.append(s);
  });
}

async function exportExcel() {
  const btn = byId('export');
  btn.disabled = true;
  btn.textContent = 'Готовлю файл…';
  try {
    await loadXlsx();
    const w = win();
    const p1 = (v) => (ok(v) ? Math.round(v * 1000) / 10 : null);
    const head = ['Шаблон', 'Отправлено', 'Доставлено', 'Не доставлено', 'Прочитано', 'Прочитано, %', 'Отклик', 'Отклик, %',
      'Отказы', 'Отказы, %', 'Расходы, ₸', 'За один отклик, ₸'].concat(CRM ? ['Лиды', 'Продажи', 'Выручка, ₸', 'Оплачено, ₸', 'ROI, %'] : []);
    const line = (name, r) => [name, r.sent, r.delivered, r.undelivered, r.read, p1(r.read_rate), r.resp, p1(r.resp_rate),
      r.neg, p1(r.neg_rate), Math.round(r.cost), r.cpr ? Math.round(r.cpr) : null]
      .concat(CRM ? [r.leads || 0, r.deals || 0, r.revenue || 0, r.paid || 0, p1(r.roi)] : []);
    const total = sums(M.daily.filter((r) => inWin(r, w) && exportRows.some((t) => t.name === r.name)));
    if (CRM) {
      Object.assign(total, crmSums(exportRows));
      total.roi = roiOf(total.revenue, d3.sum(exportRows, (r) => r.crmCost));
    }
    const aoa = [
      [`WhatsApp +7 700 000 11 00 · шаблоны за ${fmt.day(w.from)} – ${fmt.day(w.to)}`], [],
      head, ...exportRows.map((r) => line(r.name, r)), line('Итого', total),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = head.map((h, i) => ({wch: i === 0 ? 34 : Math.max(11, h.length + 2)}));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Шаблоны');
    XLSX.writeFile(wb, `WhatsApp_1100_шаблоны_${w.from}_${w.to}.xlsx`);
  } catch (e) {
    alert(e.message || 'Не удалось сохранить файл');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Скачать Excel';
  }
}

// ----- отчёт по рассылкам: цифры дашборда + выводы ИИ (api/insights.js), «Скачать PDF» — печать браузера -----

const AI_TEMPLATES = 40;  // самые крупные шаблоны периода; остальные — мелочь, которая только шумит
const AI_TEXT = 900;      // начала текстов хватает, чтобы понять приём, и запрос остаётся небольшим
const AI_MIN_DELIVERED = 50;
const REPORT_TABLE = 30;
const TRAIT_MIN = 200;    // шаблоны с меньшей доставкой в разделе «что в тексте влияет» не учитываем
const TRAITS = [
  ['opener', 'Первая строка'], ['urgency', 'Срок или дефицит мест'], ['price', 'Цена в тексте'], ['length', 'Длина текста'], ['header', 'Заголовок'],
];

// Цифры периода по шаблонам и их тексты. Номеров и имён клиентов здесь нет.
function reportData(w) {
  const periodCrm = CRM ? CRM.rows.filter((r) => inWin(r, w)) : null;
  const rows = M.daily.filter((r) => inWin(r, w));
  const list = byTemplate(rows, periodCrm).sort((a, b) => b.delivered - a.delivered);
  const days = d3.rollup(rows.filter((r) => r.sent > 0), (v) => ({first: d3.min(v, (r) => r.day), last: d3.max(v, (r) => r.day)}), (r) => r.name);
  const fresh = addDays(w.to, -1); // отправленные в последние 2 дня периода ещё досчитываются
  for (const t of list) Object.assign(t, days.get(t.name) || {}, {recent: (days.get(t.name) || {}).last >= fresh});
  const total = sums(rows);
  const crm = CRM ? Object.assign(crmSums(periodCrm), {cost: d3.sum(rows.filter((r) => r.day >= CRM.from), (r) => r.cost)}) : null;
  return {list, total, crm};
}

function aiPayload(w, data) {
  const r1 = (v) => (ok(v) ? Math.round(v * 1000) / 10 : null);
  const templates = data.list.filter((r) => r.delivered >= AI_MIN_DELIVERED).slice(0, AI_TEMPLATES).map((r) => {
    const t = M.templates.get(r.name) || {};
    const row = {
      name: r.name, lang: t.lang, segment: (t.traits || {}).segment, theme: (t.traits || {}).family, header: t.header || '',
      buttons: (t.buttons || []).map((b) => b.text), text: String(t.text || t.preview || '').slice(0, AI_TEXT),
      first_day: r.first, last_day: r.last, recent: Boolean(r.recent),
      sent: r.sent, delivered: r.delivered, read_pct: r1(r.read_rate), response: r.resp, response_pct: r1(r.resp_rate),
      refusals: r.neg, refusal_pct: r1(r.neg_rate), cost_kzt: Math.round(r.cost), cost_per_response_kzt: r.cpr ? Math.round(r.cpr) : null,
    };
    if (CRM) {
      Object.assign(row, {leads: r.leads, sales: r.deals, revenue_kzt: r.revenue, paid_kzt: r.paid,
        lead_pct: r.delivered ? r1(r.leads / r.delivered) : null, roi_pct: r1(r.roi)});
    }
    return row;
  });
  return {
    period: {from: w.from, to: w.to, label: rangeLabel(w)},
    crm: CRM ? {source: CRM.label, data_from: CRM.from, note: 'лиды, продажи и ROI — только по рассылкам с этого дня; ' +
      'базы «повторная», «ОП базасы» — прошлые клиенты, их продажи частично повторные'} : null,
    total: data.total, templates,
  };
}

function openReport() {
  const w = win();
  const data = reportData(w);
  REPORT = {w, data, payload: aiPayload(w, data), ai: null, error: null, loading: false};
  byId('report').hidden = false;
  byId('report').scrollTop = 0;
  document.body.classList.add('noscroll', 'report-open');
  renderReport();
  askReportAi();
}

function closeReport() {
  byId('report').hidden = true;
  document.body.classList.remove('noscroll', 'report-open');
  REPORT = null;
}

async function askReportAi() {
  const rep = REPORT;
  if (!rep.payload.templates.length) { rep.error = 'За этот период нет шаблонов с отправками.'; renderReport(); return; }
  rep.loading = true;
  rep.error = null;
  renderReport();
  try {
    const pw = readPassword();
    const res = await fetch('/api/insights', {
      method: 'POST',
      headers: Object.assign({'content-type': 'application/json'}, pw ? {'x-dashboard-password': pw} : {}),
      body: JSON.stringify(rep.payload),
    });
    const body = await res.json().catch(() => ({message: 'Сервер вернул не JSON.'}));
    if (!res.ok) throw new Error(body.message || `Ошибка ${res.status}`);
    rep.ai = body;
  } catch (e) {
    rep.error = e.message || String(e);
  } finally {
    rep.loading = false;
    if (REPORT === rep) renderReport(); // отчёт могли закрыть, пока ИИ думал
  }
}

function renderReport() {
  const {w, data, ai, error, loading} = REPORT;
  const {list, total, crm} = data;
  const providers = {anthropic: 'Claude', openai: 'OpenAI', openrouter: 'OpenRouter', mock: 'пример'};
  const today = new Date().toLocaleDateString('ru-RU', {day: 'numeric', month: 'long', year: 'numeric'});

  const toolbar = el('div', {class: 'r-toolbar'},
    el('button', {type: 'button', class: 'btn r-back', text: '← Назад к дашборду'}),
    el('span', {class: 'r-grow'}),
    el('button', {type: 'button', class: 'btn r-again', text: loading ? 'ИИ пишет выводы…' : 'Переписать выводы'}),
    el('button', {type: 'button', class: 'btn primary r-pdf', text: 'Скачать PDF'}));
  toolbar.querySelector('.r-back').addEventListener('click', closeReport);
  toolbar.querySelector('.r-again').disabled = loading;
  toolbar.querySelector('.r-again').addEventListener('click', askReportAi);
  // Печать браузера: «Сохранить как PDF». Всё, кроме отчёта, при печати скрыто (styles.css, @media print).
  toolbar.querySelector('.r-pdf').addEventListener('click', () => window.print());

  const stat = (value, label, cls) => el('div', {class: `r-stat ${cls || ''}`}, el('b', {text: value}), el('span', {text: label}));
  const stats = crm
    ? [stat(fmt.int(total.delivered), 'доставлено'), stat(`${fmt.int(total.resp)} · ${fmt.pct(total.resp_rate)}`, 'отклик'),
      stat(fmt.int(crm.leads), 'лидов перешли в ОП'), stat(fmt.int(crm.deals), 'продаж'),
      stat(fmt.kzt(crm.revenue), `выручка, оплачено ${fmt.kzt(crm.paid)}`),
      stat(fmtRoi(roiOf(crm.revenue, crm.cost)), `ROI при расходах ${fmt.kzt(crm.cost)}`, (roiOf(crm.revenue, crm.cost) ?? 0) >= 0 ? 'good' : 'bad')]
    : [stat(fmt.int(total.delivered), 'доставлено'), stat(fmt.pct(total.read_rate), 'прочитано'), stat(`${fmt.int(total.resp)} · ${fmt.pct(total.resp_rate)}`, 'отклик'),
      stat(fmt.pct(total.neg_rate), 'отказы'), stat(fmt.kzt(total.cost), 'расходы'), stat(total.cpr ? fmt.kzt(total.cpr) : '—', 'за один отклик')];

  const waiting = (text) => el('p', {class: 'r-wait', text});
  const aiBlock = (make) => (ai ? make() : error ? el('p', {class: 'r-error', text: `Выводы ИИ не получились: ${error}`})
    : waiting('ИИ разбирает цифры и тексты шаблонов. Обычно это 1–2 минуты…'));
  const tplChips = (names) => (names && names.length ? el('div', {class: 'r-chips'}, names.map((n) => el('span', {text: n}))) : null);
  const points = (items) => el('ol', {}, (items || []).map((p) => el('li', {}, el('b', {text: p.title}), el('p', {text: p.evidence}), tplChips(p.templates))));

  const sections = [
    el('header', {class: 'r-head'},
      el('span', {class: 'r-eyebrow', text: `WhatsApp +7 700 000 11 00 · ${rangeLabel(w)}`}),
      el('h1', {text: 'Отчёт по рассылкам'}),
      el('p', {class: 'r-lead', text: `Подготовлен ${today.replace(/\.$/, '')}. Цифры — из дашборда (статистика Meta${crm ? `, сделки ${CRM.label}` : ''}), выводы о текстах — ИИ` +
        `${ai ? ` (${providers[ai.provider] || ai.provider}, ${ai.model})` : ''}.`})),
    el('section', {class: 'r-stats'}, stats),
    crm && crm.revenue != null && CRM.from > w.from
      ? el('p', {class: 'r-note', text: `Лиды, продажи и ROI — по рассылкам с ${fmt.day(CRM.from)}: раньше данных CRM нет. Выручка — полная цена договоров (оплачено + долг).`})
      : null,
    el('section', {class: 'r-sec'}, el('h2', {text: 'Главное'}), aiBlock(() => el('p', {class: 'r-summary', text: ai.summary}))),
    el('section', {class: 'r-verdicts'},
      el('div', {class: 'r-col keep'}, el('h2', {text: 'Повторять'}), aiBlock(() => points(ai.repeat))),
      el('div', {class: 'r-col stop'}, el('h2', {text: 'Не повторять'}), aiBlock(() => points(ai.avoid)))),
    ai && ai.comparisons && ai.comparisons.length ? reportPairs(ai.comparisons, list) : null,
    reportTraits(list),
    reportTable(list, w),
    ai && ai.experiments.length ? el('section', {class: 'r-sec'}, el('h2', {text: 'Что проверить в следующих рассылках'}),
      el('ol', {class: 'r-list'}, ai.experiments.map((t) => el('li', {text: t})))) : null,
    el('section', {class: 'r-sec'}, el('h2', {text: 'Насколько этому верить'}), el('ul', {class: 'r-list'},
      ...(ai ? ai.caveats.map((t) => el('li', {text: t})) : []),
      el('li', {text: 'Шаблоны, отправленные в последние 2 дня периода, помечены «свежая»: отклик, лиды и продажи по ним ещё досчитываются.'}),
      ...(crm ? [el('li', {text: 'Расходы — оценка: доставленные сообщения × цена категории Meta (53 ₸ маркетинговые, 63 ₸ сервисные).'})] : []))),
    el('p', {class: 'r-foot', text: `Источники: статистика шаблонов Meta${crm ? `, ${CRM.label} (рассылки по базам, переходы в отдел продаж, успешные сделки)` : ''}. ` +
      `Выводы ИИ проверяйте по таблице выше перед решением.`}),
  ];
  byId('report').replaceChildren(toolbar, el('article', {class: 'r-paper'}, sections));
}

// Пары «текст лучше / текст хуже»: имена — от ИИ, цифры и начала текстов — из дашборда.
function reportPairs(pairs, list) {
  const byName = new Map(list.map((r) => [r.name, r]));
  const clean = (s) => String(s || '').replace(/[*_~]/g, '').replace(/\n{3,}/g, '\n\n').trim();
  const side = (name, good) => {
    const r = byName.get(name);
    if (!r) return null;
    const t = M.templates.get(name) || {};
    const text = clean(t.text || t.preview);
    return el('div', {class: `r-msg ${good ? 'good' : 'bad'}`},
      el('div', {class: 'r-msg-head'}, el('h3', {text: name}), el('span', {class: 'r-tag', text: good ? 'сработал лучше' : 'сработал хуже'})),
      el('blockquote', {text: text.length > 320 ? `${text.slice(0, 320)}…` : text || 'Текст появится после обновления скрипта таблицы.'}),
      el('dl', {class: 'r-kv'},
        el('dt', {text: 'Доставлено'}), el('dd', {text: fmt.int(r.delivered)}),
        el('dt', {text: 'Отклик'}), el('dd', {text: fmt.pct(r.resp_rate)}),
        ...(CRM ? [el('dt', {text: 'Лиды'}), el('dd', {text: `${fmt.int(r.leads)} · ${fmt.pct(r.delivered ? r.leads / r.delivered : null)}`}),
          el('dt', {text: 'Продажи'}), el('dd', {text: r.deals ? `${r.deals} · ${fmt.kzt(r.revenue)}` : '0'}),
          el('dt', {text: 'ROI'}), el('dd', {text: fmtRoi(r.roi)})] : [])));
  };
  const cards = pairs.map((p) => {
    const a = side(p.better, true), b = side(p.worse, false);
    return a && b ? el('div', {class: 'r-pair-block'}, el('h3', {class: 'r-pair-title', text: p.title}), el('div', {class: 'r-pair'}, a, b),
      el('p', {class: 'r-note', text: p.evidence})) : null;
  }).filter(Boolean);
  return cards.length ? el('section', {class: 'r-sec'}, el('h2', {text: 'Два текста рядом'}), ...cards) : null;
}

// Отклик по признакам текста (разметка скрипта таблицы) за период.
function reportTraits(list) {
  const base = list.filter((r) => r.delivered >= TRAIT_MIN);
  const groups = TRAITS.map(([key, title]) => {
    const g = d3.rollups(base, (v) => ({n: v.length, delivered: d3.sum(v, (r) => r.delivered), resp: d3.sum(v, (r) => r.resp)}),
      (r) => (key === 'header' ? (M.templates.get(r.name) || {}).header : ((M.templates.get(r.name) || {}).traits || {})[key]))
      .filter(([k, a]) => k && a.n >= 2) // вариант с одним шаблоном — это про шаблон, а не про приём
      .map(([k, a]) => ({k, ...a, rate: a.delivered ? a.resp / a.delivered : 0})).sort((a, b) => b.rate - a.rate);
    return {title, g};
  }).filter((x) => x.g.length >= 2);
  if (!groups.length) return null;
  const max = d3.max(groups.flatMap((x) => x.g), (o) => o.rate) || 1;
  return el('section', {class: 'r-sec'},
    el('h2', {text: 'Что в тексте влияет на отклик'}),
    el('p', {class: 'r-note', text: `Шаблоны периода с доставкой от ${TRAIT_MIN}: ${base.length}. Отклик — нажатия кнопок интереса и ссылки, от доставленных.`}),
    el('div', {class: 'r-bars'}, groups.map(({title, g}) => el('div', {class: 'r-bargroup'}, el('h3', {text: title}),
      g.map((o, i) => el('div', {class: `r-row ${i === 0 ? 'up' : i === g.length - 1 ? 'down' : ''}`},
        el('span', {}, o.k, el('small', {text: `${o.n} ${plural(o.n, 'шаблон', 'шаблона', 'шаблонов')}`})),
        el('span', {class: 'r-track'}, el('i', {style: `width:${Math.max(2, (100 * o.rate) / max)}%`})),
        el('b', {text: fmt.pct(o.rate)})))))));
}

function reportTable(list, w) {
  const rows = list.slice(0, REPORT_TABLE);
  const head = ['Шаблон', 'Даты', 'Доставлено', 'Отклик', 'Отказы'].concat(CRM ? ['Лиды', 'Продажи', 'Выручка', 'ROI'] : []);
  const dm = (s) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}` : '');
  return el('section', {class: 'r-sec'},
    el('h2', {text: `Шаблоны за ${rangeLabel(w)}`}),
    el('div', {class: 'r-tablewrap'}, el('table', {class: 'r-table'},
      el('thead', {}, el('tr', {}, head.map((h) => el('th', {text: h})))),
      el('tbody', {}, rows.map((r) => el('tr', {class: r.recent ? 'recent' : ''},
        el('td', {}, r.name, r.recent ? el('small', {text: 'свежая — ещё досчитывается'}) : null),
        el('td', {text: r.first === r.last ? dm(r.first) : `${dm(r.first)}–${dm(r.last)}`}),
        el('td', {text: fmt.int(r.delivered)}), el('td', {text: fmt.pct(r.resp_rate)}), el('td', {text: fmt.pct(r.neg_rate)}),
        ...(CRM ? [el('td', {text: fmt.int(r.leads)}), el('td', {text: fmt.int(r.deals)}), el('td', {text: r.revenue ? fmt.kzt(r.revenue) : '—'}),
          el('td', {class: ok(r.roi) ? (r.roi >= 0 ? 'pos' : 'neg') : '', text: fmtRoi(r.roi)})] : [])))))),
    list.length > REPORT_TABLE ? el('p', {class: 'r-note', text: `Показаны ${REPORT_TABLE} шаблонов с наибольшей доставкой из ${list.length}.`}) : null);
}

// ----- вкладка «Базы»: какая рассылка в какую базу ушла, когда, что принесла; заметки к базам -----

function showView() {
  const bases = state.view === 'bases';
  byId('app').hidden = bases;
  byId('bases-view').hidden = !bases;
  for (const b of document.querySelectorAll('#views [data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === state.view));
  if (bases) renderBases();
}

function setView(view) {
  state.view = view;
  try { history.replaceState(null, '', view === 'bases' ? '#bases' : location.pathname); } catch (e) { /* не страшно */ }
  showView();
  window.scrollTo({top: 0});
  if (view === 'bases') refreshNotes();
  else render();
}

// Заметки перечитываются из таблицы при открытии вкладки: данные дашборда кэшируются на 10 минут.
async function refreshNotes() {
  try {
    const pw = readPassword();
    const res = await fetch('/api/notes', {headers: pw ? {'x-dashboard-password': pw} : {}});
    if (!res.ok) return;
    const body = await res.json();
    NOTES = body.notes || NOTES;
    if (state.view === 'bases' && !BASES.edit) renderBases();
  } catch (e) { /* остаются заметки из общих данных */ }
}

async function saveNote(base, note) {
  BASES.saving = true;
  BASES.error = null;
  renderBases();
  try {
    const pw = readPassword();
    const res = await fetch('/api/notes', {
      method: 'POST', headers: Object.assign({'content-type': 'application/json'}, pw ? {'x-dashboard-password': pw} : {}),
      body: JSON.stringify({base, note}),
    });
    const body = await res.json().catch(() => ({message: 'Сервер вернул не JSON.'}));
    if (!res.ok) throw new Error(body.message || `Ошибка ${res.status}`);
    NOTES = body.notes || NOTES;
    BASES.edit = null;
  } catch (e) {
    BASES.error = e.message || String(e);
  } finally {
    BASES.saving = false;
    renderBases();
  }
}

function renderBases() {
  const node = byId('bases-view');
  const all = (CRM && CRM.bases) || [];
  const q = BASES.q.trim().toLowerCase();
  const price = PRICE_KZT[DEFAULT_CATEGORY];
  const rows = all.filter((b) => (b.entered || b.sends) > 0)
    .filter((b) => !q || [b.base, (NOTES[b.base] || {}).note || '', ...(b.templates || []).map((t) => t.name)].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (a.to < b.to ? 1 : a.to > b.to ? -1 : b.sends - a.sends));
  const dm = (s) => (s && s !== '9999' && s !== '0000' ? `${s.slice(8, 10)}.${s.slice(5, 7)}` : '');
  const days = (b) => Math.round((toDate(b.to) - toDate(b.from)) / 864e5) + 1;

  const search = el('input', {type: 'search', id: 'bases-search', placeholder: 'Найти базу, шаблон или заметку', 'aria-label': 'Найти базу'});
  search.value = BASES.q;
  search.addEventListener('input', (e) => { BASES.q = e.target.value; renderBases(); const s = byId('bases-search'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); });

  const noteCell = (b) => {
    const cur = (NOTES[b.base] || {}).note || '';
    if (BASES.edit === b.base) {
      const area = el('textarea', {id: 'note-edit', rows: '3', maxlength: '2000', placeholder: 'Например: родители 3–4 классов, участники «Алтын сақа» 2025, Алматинская область'});
      area.value = cur;
      const save = el('button', {type: 'button', class: 'btn primary', text: BASES.saving ? 'Сохраняю…' : 'Сохранить'});
      const cancel = el('button', {type: 'button', class: 'btn', text: 'Отмена'});
      save.disabled = BASES.saving;
      save.addEventListener('click', () => saveNote(b.base, byId('note-edit').value));
      cancel.addEventListener('click', () => { BASES.edit = null; BASES.error = null; renderBases(); });
      return el('div', {class: 'note-edit'}, area, el('div', {class: 'note-btns'}, save, cancel),
        BASES.error ? el('p', {class: 'note-err', text: BASES.error}) : null);
    }
    const btn = el('button', {type: 'button', class: 'note-btn', text: cur ? 'Изменить' : '+ Подписать базу'});
    btn.addEventListener('click', () => { BASES.edit = b.base; BASES.error = null; renderBases(); const a = byId('note-edit'); if (a) a.focus(); });
    return el('div', {class: 'note-view'}, cur ? el('p', {text: cur}) : null, btn);
  };
  const tplChips = (b) => el('div', {class: 'b-tpls'}, (b.templates || []).filter((t) => !t.name.startsWith('база: ')).slice(0, 4).map((t) => {
    const chip = el('button', {type: 'button', text: t.name, title: `${fmt.int(t.n)} отправок — открыть шаблон на дашборде`});
    chip.addEventListener('click', () => { if (M.templates.has(t.name)) { state.tpl = t.name; setView('dash'); } });
    return chip;
  }));

  const table = el('table', {class: 'bases-table'},
    el('thead', {}, el('tr', {},
      el('th', {text: 'База'}), el('th', {text: 'Когда ушла'}), el('th', {class: 'n', text: 'Отправлено'}), el('th', {class: 'hide-sm', text: 'Шаблоны'}),
      el('th', {class: 'n', text: 'Лиды'}), el('th', {class: 'n', text: 'Продажи'}), el('th', {class: 'n hide-sm', text: 'Выручка'}),
      el('th', {class: 'n hide-sm', text: 'ROI ≈', title: `Расход оценён как отправлено × ${price} ₸`}), el('th', {text: 'Заметка'}))),
    el('tbody', {}, rows.length ? rows.map((b) => {
      const cost = b.sends * price, roi = cost ? (b.revenue - cost) / cost : null;
      // Сколько сделок базы засчитано рассылкой 1100 и почему остальные исключены (строгая проверка).
      const entered = b.entered || b.sends, pending = (b.templates || []).some((t) => t.pending);
      const failedNote = b.failed ? ` Ошибка отправки у ${fmt.int(b.failed)} — они не считаются.` : '';
      const status = !b.sends ? ['bad', 'не с 1100', 'Шаблоны этой базы номер 1100 почти не отправлял по данным Meta — база ушла с другого номера или не ушла. Лиды не считаются.']
        : b.unconfirmed ? ['part', 'часть не с 1100', `Засчитано ${fmt.int(b.sends)} из ${fmt.int(entered)}: у ${fmt.int(b.unconfirmed)} шаблон не подтверждён отправками 1100.${failedNote}`]
          : pending ? ['wait', 'Meta догружает', `Отправки последних дней Meta ещё не догрузила — проверка пройдёт позже.${failedNote}`]
            : ['ok', 'подтверждено Meta', `Отправки базы совпадают со статистикой номера 1100 в Meta.${failedNote}`];
      return el('tr', {class: BASES.edit === b.base ? 'editing' : ''},
        el('td', {class: 'b-name'}, el('b', {text: b.base}), el('small', {text: b.source || ''}),
          el('span', {class: `b-status ${status[0]}`, text: status[1], title: status[2]})),
        el('td', {class: 'b-when'}, b.from === b.to ? dm(b.from) : `${dm(b.from)}–${dm(b.to)}`, el('small', {text: `${days(b)} ${plural(days(b), 'день', 'дня', 'дней')}`})),
        el('td', {class: 'n', title: status[2]}, fmt.int(b.sends), entered > b.sends ? el('small', {text: `из ${fmt.int(entered)} в CRM`}) : null),
        el('td', {class: 'hide-sm'}, tplChips(b)),
        el('td', {class: 'n'}, fmt.int(b.leads), el('small', {text: fmt.pct(b.sends ? b.leads / b.sends : null)})),
        el('td', {class: 'n', text: fmt.int(b.deals)}),
        el('td', {class: 'n hide-sm', text: b.revenue ? fmt.kzt(b.revenue) : '—'}),
        el('td', {class: `n hide-sm ${ok(roi) ? (roi >= 0 ? 'pos' : 'neg') : ''}`, text: b.deals ? fmtRoi(roi) : '—'}),
        el('td', {class: 'b-note'}, noteCell(b)));
    }) : [el('tr', {}, el('td', {colspan: '9', class: 'hint', text: 'Баз не найдено'}))]));

  node.replaceChildren(el('section', {class: 'card glass'},
    el('div', {class: 'card-head'}, el('h2', {text: 'Базы рассылок'}), el('div', {class: 'tools'}, search)),
    el('p', {class: 'hint', text: `Какая рассылка в какую базу ушла и что принесла: ${CRM.label}. Лиды — сделки, перешедшие после рассылки в отдел продаж; ` +
      `процент — от отправленных. Нажмите на шаблон, чтобы открыть его на дашборде. Заметки видят все, кто открывает дашборд.`}),
    el('div', {class: 'tablebox bases-box'}, table)));
}

function selectTemplate(name) {
  state.tpl = state.tpl === name ? null : name;
  render();
  if (state.tpl) window.scrollTo({top: 0, behavior: 'smooth'});
}

function backToList() {
  const name = state.tpl;
  state.tpl = null;
  render();
  byId('top-card').scrollIntoView({behavior: 'smooth', block: 'start'});
  // Вернуть фокус на строку шаблона, с которого пришли.
  const row = [...byId('t-top').querySelectorAll('tbody tr')].find((tr) => tr.dataset.name === name);
  if (row) row.focus({preventScroll: true});
}

// ----- режим шаблона: превью в WhatsApp и нажатия по кнопкам -----

const CATEGORY_LABEL = {MARKETING: 'Маркетинг', UTILITY: 'Сервисный', AUTHENTICATION: 'Авторизация'};
const STATUS_LABEL = {APPROVED: 'Одобрен', PAUSED: 'Приостановлен', REJECTED: 'Отклонён', DISABLED: 'Отключён', PENDING: 'На проверке'};
const LANG_LABEL = {KZ: 'Казахский', RU: 'Русский'};
const LINK_BUTTON = 'Ссылка в тексте'; // так таблица называет переходы по ссылке из текста
const svgIcon = (d) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = d; // только наши константы ниже
  return s;
};
const ICON = {
  reply: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v5"/>',
  url: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>',
  expand: '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/>',
  video: '<rect x="3" y="5" width="14" height="14" rx="2"/><path d="m17 10 4-2v8l-4-2"/>',
  doc: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/>',
  ticks: '<path d="m2 13 4 4L15 7"/><path d="m10 16 1 1 9-10"/>',
};
const BUTTON_ICON = {QUICK_REPLY: 'reply', URL: 'url', PHONE_NUMBER: 'phone', COPY_CODE: 'copy', OTP: 'copy'};
const MEDIA = {Картинка: ['image', 'Картинка'], Видео: ['video', 'Видео'], Документ: ['doc', 'Документ']};

// Разметка WhatsApp: *жирный*, _курсив_, ~зачёркнутый~, переменные {{1}} и ссылки. Только текстовые узлы, без innerHTML.
const WA_TOKEN = /(\{\{\s*[\w.]+\s*\}\}|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|https?:\/\/[^\s]+)/g;
function waText(s) {
  return String(s).split(WA_TOKEN).filter((p) => p !== '').map((p) => {
    if (p.startsWith('{{')) return el('span', {class: 'wa-var', title: 'Подставляется при отправке', text: p.replace(/\s/g, '')});
    if (/^https?:/.test(p)) return el('span', {class: 'wa-link', text: p});
    const m = /^([*_~])([^]+)\1$/.exec(p);
    if (m) return el(m[1] === '*' ? 'b' : m[1] === '_' ? 'i' : 's', {}, waText(m[2]));
    return p;
  });
}

function renderDetail(name, s, list, clicks) {
  const t = M.templates.get(name) || templateInfo({name});
  // Нажатия за период по тексту кнопки; кнопки шаблона идут в его порядке, остальное (ссылка в тексте) — после.
  const byButton = d3.rollup(clicks, (v) => d3.sum(v, (b) => b.clicks), (b) => b.button);
  const known = new Set(t.buttons.map((b) => b.text));
  const stats = t.buttons.map((b) => ({...b, clicks: byButton.get(b.text) || 0, inMessage: true}))
    .concat([...byButton].filter(([text]) => !known.has(text))
      .map(([text, n]) => ({text: text === LINK_BUTTON ? 'Переход по ссылке в тексте' : text, type: 'LINK', clicks: n})));
  stats.forEach((b, i) => { b.i = i; b.neg = NEGATIVE_BUTTON.test(b.text); });
  const ofDelivered = (n) => (s.delivered ? n / s.delivered : null);
  const maxClicks = d3.max(stats, (b) => b.clicks) || 1;

  // Превью сообщения.
  const media = MEDIA[t.header];
  const bubble = el('div', {class: 'wa-bubble'},
    media ? el('div', {class: 'wa-media'}, svgIcon(ICON[media[0]]), el('span', {text: media[1]})) : null,
    t.headerText ? el('div', {class: 'wa-head'}, waText(t.headerText)) : null,
    el('div', {class: 'wa-text'}, t.full ? waText(t.text) : [t.preview, t.preview ? '…' : 'Текст шаблона не найден']),
    t.footer ? el('div', {class: 'wa-foot', text: t.footer}) : null,
    el('span', {class: 'wa-time'}, '10:24', svgIcon(ICON.ticks)));
  const waButtons = stats.filter((b) => b.inMessage).map((b) => el('button', {type: 'button', class: 'wa-btn', 'data-btn': String(b.i),
    title: `${b.text}: ${fmt.int(b.clicks)} нажатий, ${fmt.pct(ofDelivered(b.clicks))} от доставленных`},
  svgIcon(ICON[BUTTON_ICON[b.type] || 'reply']), el('span', {text: b.text}),
  el('span', {class: `wa-stat${b.neg ? ' neg' : ''}`, text: fmt.int(b.clicks)})));
  const phone = el('div', {class: 'wa', role: 'img', 'aria-label': `Как сообщение ${name} выглядит в WhatsApp`},
    el('div', {class: 'wa-top'}, el('i', {class: 'wa-ava', text: 'Z'}),
      el('div', {}, el('b', {text: 'EduApp Online'}), el('small', {text: 'бизнес-аккаунт'}))),
    el('div', {class: 'wa-chat'}, el('span', {class: 'wa-date', text: 'Сегодня'}),
      el('div', {class: 'wa-msg'}, bubble, waButtons.length ? el('div', {class: 'wa-btns'}, waButtons) : null)));

  // Нажатия по кнопкам.
  const statRows = stats.map((b) => el('div', {class: 'hb-row', 'data-btn': String(b.i)},
    el('span', {class: 'hb-label', title: b.text}, b.text,
      el('small', {text: `${b.type === 'LINK' ? 'ссылка' : b.neg ? 'отказ' : 'интерес'} · ${fmt.pct(ofDelivered(b.clicks))} от доставленных`})),
    el('span', {class: 'hb-track'}, el('i', {style: `width:${Math.max(0.5, (100 * b.clicks) / maxClicks)}%;background:${b.neg ? 'var(--red)' : 'var(--yellow)'}`})),
    el('b', {class: 'hb-val', text: fmt.int(b.clicks)})));

  const days = M.daily.filter((r) => r.name === name && r.sent > 0).map((r) => r.day).sort();
  const rank = list.slice().sort((a, b) => b.resp - a.resp).findIndex((r) => r.name === name) + 1;
  const fact = (k, v) => [el('dt', {text: k}), el('dd', {text: v})];
  const back = el('button', {type: 'button', class: 'btn', text: '← Назад к списку шаблонов'});
  back.addEventListener('click', backToList);

  byId('detail').replaceChildren(
    el('div', {class: 'dt-head'}, back, el('h2', {class: 'dt-name', text: name}),
      el('span', {class: 'tag', text: CATEGORY_LABEL[t.category] || t.category}),
      t.lang ? el('span', {class: 'tag', text: LANG_LABEL[t.lang] || t.lang}) : null),
    el('div', {class: 'dt-body'},
      el('div', {class: 'dt-phone'}, phone,
        t.full ? null : el('p', {class: 'dt-note', text: 'Показано начало текста. Полный текст и типы кнопок появятся после обновления скрипта таблицы.'})),
      el('div', {class: 'dt-side'},
        el('div', {}, el('h3', {text: 'Нажатия по кнопкам за период'}),
          stats.length ? el('div', {class: 'hbars btn-stats'}, statRows) : el('p', {class: 'hint', text: 'У шаблона нет кнопок и ссылок.'})),
        el('dl', {class: 'facts'},
          fact('Статус в Meta', STATUS_LABEL[t.status] || t.status || '—'),
          fact('Отправляли', days.length ? `${fmt.day(days[0])} – ${fmt.day(days[days.length - 1])}` : '—'),
          fact('Место по откликам', rank ? `${rank} из ${list.length} за период` : 'за период не отправляли')))));
}

// Подсветка одной кнопки и в превью, и в списке нажатий.
function highlightButton(i) {
  for (const n of byId('detail').querySelectorAll('[data-btn]')) n.classList.toggle('hl', n.dataset.btn === i);
}

// ----- развёрнутый график: на весь экран с метриками, выводами и таблицей -----

// key — какой график открыт, focus — выбранный на графике день / неделя / день недели.
const X = {key: null, focus: null};
const ratio = (a, b) => (b ? a / b : null);
const dayLabel = (s) => `${fmt.day(s)}, ${WEEKDAYS[weekday(s)]}`;
const weekLabel = (s) => `с ${fmt.day(s)}`;
const pp = (v) => (v == null ? '—' : `${v > 0.05 ? '+' : v < -0.05 ? '−' : '±'}${nf1.format(Math.abs(v))} п.п.`);
const COL = {
  day: {key: 'day', label: 'Дата', f: dayLabel},
  week: {key: 'week', label: 'Неделя', f: weekLabel},
  sent: {key: 'sent', label: 'Отправлено', n: true, f: fmt.int},
  delivered: {key: 'delivered', label: 'Доставлено', n: true, f: fmt.int},
  read: {key: 'read', label: 'Прочитано', n: true, f: fmt.int},
  read_rate: {key: 'read_rate', label: 'Прочитано, %', n: true, f: fmt.pct},
  resp: {key: 'resp', label: 'Отклик', n: true, f: fmt.int},
  resp_rate: {key: 'resp_rate', label: 'Отклик, %', n: true, f: fmt.pct},
  neg: {key: 'neg', label: 'Отказы', n: true, f: fmt.int},
  neg_rate: {key: 'neg_rate', label: 'Отказы, %', n: true, f: fmt.pct},
  cost: {key: 'cost', label: 'Расходы', n: true, f: fmt.kzt},
  cpr: {key: 'cpr', label: 'За один отклик', n: true, f: fmt.kzt},
};
// Дни с малым числом доставок не берём в «лучший / худший»: там процент случаен.
const solidDays = (list) => {
  const active = list.filter((d) => d.delivered > 0);
  const min = Math.max(30, (d3.mean(active, (d) => d.delivered) || 0) * 0.3);
  return {min, list: active.filter((d) => d.delivered >= min)};
};

// Для каждого графика: как нарисовать большую версию и что показать рядом.
const EXPAND = {
  days: {
    draw: (n) => drawDays(n, VIEW.w, VIEW.rows), h: 440,
    detail() {
      const {w, rows, total} = VIEW;
      const days = perDay(w, rows, ['sent', 'delivered', 'read', 'resp', 'neg', 'cost']).map((d) => ({...d, key: d.day,
        read_rate: ratio(d.read, d.delivered), resp_rate: ratio(d.resp, d.delivered), neg_rate: ratio(d.neg, d.delivered)}));
      const active = days.filter((d) => d.sent > 0);
      const solid = solidDays(active);
      const peak = d3.greatest(active, (d) => d.sent);
      const best = d3.greatest(solid.list, (d) => d.resp_rate), worst = d3.least(solid.list, (d) => d.resp_rate);
      const negPeak = d3.greatest(active, (d) => d.neg);
      return {
        metrics: [
          ['Дней с рассылками', `${active.length} из ${days.length}`],
          ['В среднем в день', fmt.int(ratio(total.sent, active.length)), 'отправлено'],
          ['Пик отправок', peak ? fmt.int(peak.sent) : '—', peak ? dayLabel(peak.day) : ''],
          ['Лучший отклик', best ? fmt.pct(best.resp_rate) : '—', best ? dayLabel(best.day) : ''],
        ],
        insights: [
          peak && `Больше всего отправили ${dayLabel(peak.day)}: ${fmt.int(peak.sent)}.`,
          best && `Лучший отклик — ${dayLabel(best.day)}: ${fmt.pct(best.resp_rate)} при среднем ${fmt.pct(total.resp_rate)} за период.`,
          worst && worst !== best && `Худший отклик — ${dayLabel(worst.day)}: ${fmt.pct(worst.resp_rate)}.`,
          negPeak && negPeak.neg > 0 && `Больше всего отказов — ${dayLabel(negPeak.day)}: ${fmt.int(negPeak.neg)} (${fmt.pct(negPeak.neg_rate)} доставленных).`,
          days.length > active.length && `Дней без рассылок: ${days.length - active.length}.`,
          solid.list.length < active.length && `Дни, где доставлено меньше ${fmt.int(solid.min)}, в лучший и худший отклик не берутся.`,
        ],
        cols: [COL.day, COL.sent, COL.delivered, COL.read, COL.read_rate, COL.resp, COL.resp_rate, COL.neg, COL.neg_rate, COL.cost],
        rows: days,
      };
    },
  },
  funnel: {
    draw: (n) => drawFunnel(n, VIEW.total, VIEW.sales), html: 'hbars funnel',
    detail() {
      const s = VIEW.total, sales = VIEW.sales;
      const silent = Math.max(0, s.read - s.resp - s.neg);
      const step = (label, v, base, baseLabel, lost) => ({key: label, label, v, share: base == null ? null : ratio(v, base), baseLabel,
        ofSent: ratio(v, s.sent), lost});
      const losses = [['не доставлено', s.sent - s.delivered], ['доставлено, но не прочитано', Math.max(0, s.delivered - s.read)],
        ['прочитали, но не ответили', silent]];
      const worst = d3.greatest(losses, (l) => l[1]);
      return {
        metrics: [
          ['Доставлено', fmt.pct(ratio(s.delivered, s.sent)), 'от отправленных'],
          ['Прочитано', fmt.pct(s.read_rate), 'от доставленных'],
          ['Ответили', fmt.pct(ratio(s.resp, s.read)), 'от прочитавших'],
          ['Не ответили', fmt.pct(ratio(silent, s.read)), 'от прочитавших'],
        ],
        insights: [
          s.sent && worst[1] > 0 && `Больше всего людей теряется на этапе «${worst[0]}»: ${fmt.int(worst[1])}.`,
          s.resp > 0 && `Откликается примерно каждый ${fmt.int(s.read / s.resp)}-й прочитавший.`,
          s.neg > 0 && `Откликов в ${nf1.format(s.resp / s.neg)} раза больше, чем отказов.`,
          sales && sales.leads > 0 && `Из лидов, перешедших в ОП, купили ${fmt.pct(sales.deals / sales.leads)}.`,
        ],
        cols: [{key: 'label', label: 'Этап'}, {key: 'v', label: 'Количество', n: true, f: fmt.int},
          {key: 'share', label: 'Доля', n: true, f: (v, r) => (v == null ? '—' : `${fmt.pct(v)} ${r.baseLabel}`)},
          {key: 'ofSent', label: 'От отправленных', n: true, f: fmt.pct}, {key: 'lost', label: 'Потеряно на этапе', n: true, f: fmt.int}],
        rows: [
          step('Отправлено', s.sent, null, '', null),
          step('Доставлено', s.delivered, s.sent, 'от отправленных', s.sent - s.delivered),
          step('Прочитано', s.read, s.delivered, 'от доставленных', Math.max(0, s.delivered - s.read)),
          step('Отклик', s.resp, s.read, 'от прочитавших', null),
          ...(sales ? [step('Перешли в ОП', sales.leads, s.delivered, 'от доставленных', null),
            step('Покупки', sales.deals, sales.leads, 'от лидов', null)] : []),
          step('Отказы', s.neg, s.read, 'от прочитавших', null),
          step('Не ответили', silent, s.read, 'от прочитавших', silent),
        ],
      };
    },
  },
  buttons: {
    draw: (n) => drawButtons(n, VIEW.clicks), html: 'hbars',
    detail() {
      const {clicks, total} = VIEW;
      const all = d3.rollups(clicks, (v) => ({clicks: d3.sum(v, (b) => b.clicks), kind: v[0].kind, templates: new Set(v.map((b) => b.name)).size}),
        (b) => b.button).map(([button, a]) => ({key: button, button: a.kind === 'Ссылка' ? 'Переход по ссылке' : button, ...a}))
        .sort((a, b) => b.clicks - a.clicks);
      const sum = d3.sum(all, (b) => b.clicks);
      for (const b of all) {
        Object.assign(b, {share: ratio(b.clicks, sum), ofDel: ratio(b.clicks, total.delivered),
          kindLabel: b.kind === 'Отказ' ? 'отказ' : b.kind === 'Ссылка' ? 'ссылка' : 'интерес'});
      }
      const neg = all.filter((b) => b.kind === 'Отказ'), pos = all.filter((b) => b.kind !== 'Отказ');
      const negSum = d3.sum(neg, (b) => b.clicks);
      return {
        metrics: [
          ['Всего нажатий', fmt.int(sum)],
          ['Интерес и ссылка', fmt.int(sum - negSum)],
          ['Отказы', fmt.int(negSum)],
          ['Доля отказов', fmt.pct(ratio(negSum, sum)), 'среди нажатий'],
        ],
        insights: [
          pos[0] && `Чаще всего нажимают «${pos[0].button}»: ${fmt.int(pos[0].clicks)} (${fmt.pct(pos[0].share)} всех нажатий).`,
          neg[0] && `Главная кнопка отказа — «${neg[0].button}»: ${fmt.int(neg[0].clicks)}.`,
          all.length > 3 && `На три самые популярные кнопки приходится ${fmt.pct(ratio(d3.sum(all.slice(0, 3), (b) => b.clicks), sum))} нажатий.`,
          all.length && `Разных кнопок за период: ${all.length}.`,
        ],
        cols: [{key: 'button', label: 'Кнопка'}, {key: 'kindLabel', label: 'Вид'}, {key: 'clicks', label: 'Нажатия', n: true, f: fmt.int},
          {key: 'share', label: 'Доля нажатий', n: true, f: fmt.pct}, {key: 'ofDel', label: 'От доставленных', n: true, f: fmt.pct},
          {key: 'templates', label: 'Шаблонов', n: true, f: fmt.int}],
        rows: all,
      };
    },
  },
  weekly: {
    draw: (n) => drawWeekly(n, VIEW.w), h: 400,
    detail() {
      const rows = weeklyRows().map((a) => ({...a, key: a.week, resp_rate: a.resp / a.delivered, neg_rate: a.neg / a.delivered}));
      const del = d3.sum(rows, (r) => r.delivered);
      const avg = ratio(d3.sum(rows, (r) => r.resp), del), avgNeg = ratio(d3.sum(rows, (r) => r.neg), del);
      for (const r of rows) r.vsAvg = avg == null ? null : (r.resp_rate - avg) * 100;
      const best = d3.greatest(rows, (r) => r.resp_rate), worst = d3.least(rows, (r) => r.resp_rate);
      const rate = (list) => ratio(d3.sum(list, (r) => r.resp), d3.sum(list, (r) => r.delivered));
      const last4 = rows.slice(-4), prev4 = rows.slice(-8, -4);
      return {
        metrics: [
          ['Средний отклик', fmt.pct(avg), 'за все недели'],
          ['Средние отказы', fmt.pct(avgNeg), 'за все недели'],
          ['Лучшая неделя', best ? fmt.pct(best.resp_rate) : '—', best ? weekLabel(best.week) : ''],
          ['Худшая неделя', worst ? fmt.pct(worst.resp_rate) : '—', worst ? weekLabel(worst.week) : ''],
        ],
        insights: [
          best && `Лучшая неделя — ${weekLabel(best.week)}: отклик ${fmt.pct(best.resp_rate)}, это ${pp(best.vsAvg)} к среднему.`,
          worst && worst !== best && `Худшая — ${weekLabel(worst.week)}: ${fmt.pct(worst.resp_rate)}.`,
          prev4.length && `За последние 4 недели отклик ${fmt.pct(rate(last4))} против ${fmt.pct(rate(prev4))} за 4 недели до этого.`,
          rows.length && `Выше среднего — ${rows.filter((r) => r.vsAvg > 0).length} из ${rows.length} недель.`,
          `Недели, где доставлено меньше ${state.tpl ? 30 : 200}, не показаны.`,
        ],
        cols: [COL.week, COL.delivered, COL.resp, COL.resp_rate, {key: 'vsAvg', label: 'К среднему', n: true, f: pp}, COL.neg, COL.neg_rate],
        rows,
      };
    },
  },
  weekday: {
    draw: (n) => drawWeekday(n, VIEW.w), h: 400,
    detail() {
      const {days, short, best, worst, minDelivered} = weekdayStats(VIEW.w);
      const busiest = d3.greatest(days, (d) => d.sent);
      return {
        metrics: [
          ['Лучший день', best ? WEEKDAYS_FULL[best.i] : '—', best ? `отклик ${fmt.pct(best.rate)}` : ''],
          ['Худший день', worst ? WEEKDAYS_FULL[worst.i] : '—', worst ? `отклик ${fmt.pct(worst.rate)}` : ''],
          ['Разница', best && worst ? pp((best.rate - worst.rate) * 100) : '—', 'между лучшим и худшим'],
          ['Считается за', short ? '90 дней' : 'выбранный период', short ? 'период короче 4 недель' : ''],
        ],
        insights: [
          best && `Лучше всего отвечают ${WEEKDAYS_IN[best.i]}: ${fmt.pct(best.rate)}.`,
          worst && worst !== best && `Хуже всего — ${WEEKDAYS_IN[worst.i]}: ${fmt.pct(worst.rate)}.`,
          busiest && busiest.sent > 0 && best && busiest !== best &&
            `Чаще всего отправляют ${WEEKDAYS_IN[busiest.i]} (${fmt.int(busiest.sent)}), хотя лучший отклик ${WEEKDAYS_IN[best.i]}.`,
          days.some((d) => d.few) && `Дни, где доставлено меньше ${fmt.int(minDelivered)}, помечены «мало данных».`,
        ],
        cols: [{key: 'i', label: 'День', f: (v) => WEEKDAYS_FULL[v]}, COL.sent, COL.delivered, COL.resp,
          {key: 'rate', label: 'Отклик, %', n: true, f: fmt.pct}, COL.neg_rate,
          {key: 'few', label: 'Примечание', f: (v) => (v ? 'мало данных' : '')}],
        rows: days.map((d) => ({...d, key: d.i})),
      };
    },
  },
  cost: {
    draw: (n) => drawCost(n, VIEW.w, VIEW.rows), h: 400,
    detail() {
      const {w, rows, total} = VIEW;
      const days = perDay(w, rows, ['cost', 'delivered', 'resp']).map((d) => ({...d, key: d.day, cpr: d.resp ? d.cost / d.resp : null}));
      const active = days.filter((d) => d.cost > 0);
      const priced = active.filter((d) => d.resp >= 5);
      const peak = d3.greatest(active, (d) => d.cost);
      const cheap = d3.least(priced, (d) => d.cpr), dear = d3.greatest(priced, (d) => d.cpr);
      return {
        metrics: [
          ['Всего', fmt.kzt(total.cost)],
          ['В среднем в день', fmt.kzt(ratio(total.cost, active.length)), 'в дни с рассылками'],
          ['Самый дорогой день', peak ? fmt.kzt(peak.cost) : '—', peak ? dayLabel(peak.day) : ''],
          ['За один отклик', fmt.kzt(total.cpr), 'в среднем'],
        ],
        insights: [
          peak && `Больше всего потратили ${dayLabel(peak.day)}: ${fmt.kzt(peak.cost)}.`,
          cheap && `Самый дешёвый отклик — ${dayLabel(cheap.day)}: ${fmt.kzt(cheap.cpr)}.`,
          dear && dear !== cheap && `Самый дорогой отклик — ${dayLabel(dear.day)}: ${fmt.kzt(dear.cpr)}.`,
          priced.length < active.length && 'Дни меньше чем с 5 откликами в самый дешёвый и дорогой отклик не берутся.',
        ],
        cols: [COL.day, COL.delivered, COL.cost, COL.resp, COL.cpr],
        rows: days,
      };
    },
  },
  cpr: {
    draw: (n) => drawCpr(n, VIEW.w), h: 400,
    detail() {
      const rows = weeklyRows().filter((a) => a.resp > 0).map((a) => ({...a, key: a.week, cpr: a.cost / a.resp}));
      const avg = ratio(d3.sum(rows, (r) => r.cost), d3.sum(rows, (r) => r.resp));
      const cheap = d3.least(rows, (r) => r.cpr), dear = d3.greatest(rows, (r) => r.cpr), last = rows[rows.length - 1];
      return {
        metrics: [
          ['Средняя цена отклика', fmt.kzt(avg), 'за все недели'],
          ['Самая дешёвая неделя', cheap ? fmt.kzt(cheap.cpr) : '—', cheap ? weekLabel(cheap.week) : ''],
          ['Самая дорогая неделя', dear ? fmt.kzt(dear.cpr) : '—', dear ? weekLabel(dear.week) : ''],
          ['Последняя неделя', last ? fmt.kzt(last.cpr) : '—', last ? weekLabel(last.week) : ''],
        ],
        insights: [
          cheap && `Дешевле всего отклик стоил на неделе ${weekLabel(cheap.week)}: ${fmt.kzt(cheap.cpr)}.`,
          dear && dear !== cheap && `Дороже всего — ${weekLabel(dear.week)}: ${fmt.kzt(dear.cpr)}.`,
          last && avg && `Последняя неделя ${last.cpr <= avg ? 'дешевле' : 'дороже'} среднего на ${fmt.pct(Math.abs(last.cpr / avg - 1))}.`,
        ],
        cols: [COL.week, COL.delivered, COL.cost, COL.resp, COL.cpr],
        rows,
      };
    },
  },
};

// Таблица с сортировкой по клику на заголовок. data-key строки связывает её со столбцом графика.
// onPaint — после каждой перерисовки, onRow — клик по строке (тогда строки кликабельные).
function sortTable(cols, rows, {onPaint = null, onRow = null} = {}) {
  const t = el('table', {class: onRow ? 'xt clickable' : 'xt'});
  let sort = {key: null, dir: 1};
  const val = (r, k) => (r[k] == null ? -Infinity : r[k]);
  const paint = () => {
    const data = sort.key == null ? rows
      : rows.slice().sort((a, b) => sort.dir * (val(a, sort.key) > val(b, sort.key) ? 1 : val(a, sort.key) < val(b, sort.key) ? -1 : 0));
    const head = el('tr', {}, cols.map((c) => {
      const b = el('button', {type: 'button', text: c.label});
      b.addEventListener('click', () => { sort = sort.key === c.key ? {key: c.key, dir: -sort.dir} : {key: c.key, dir: c.n ? -1 : 1}; paint(); });
      return el('th', {class: c.n ? 'n' : '', 'aria-sort': sort.key === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}, b);
    }));
    const body = data.length ? data.map((r) => {
      const tr = el('tr', {'data-key': String(r.key)},
        cols.map((c) => el('td', {class: c.n ? 'n' : '', text: c.f ? c.f(r[c.key], r) : r[c.key] ?? '—'})));
      if (onRow) {
        tr.tabIndex = 0;
        tr.addEventListener('click', () => onRow(r));
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') onRow(r); });
      }
      return tr;
    }) : [el('tr', {}, el('td', {colspan: String(cols.length), class: 'hint', text: 'Нет данных за этот период'}))];
    t.replaceChildren(el('thead', {}, head), el('tbody', {}, body));
    if (onPaint) onPaint();
  };
  paint();
  return t;
}

function openExpand(key, focus = null) {
  if (!M || !VIEW) return;
  Object.assign(X, {key, focus});
  byId('expand').hidden = false;
  byId('expand').scrollTop = 0;
  document.body.classList.add('noscroll');
  renderExpand(); // если открыли кликом по столбцу, сама прокрутит к срезу
  byId('expand').querySelector('.x-back').focus({preventScroll: true});
}

function closeExpand() {
  const key = X.key;
  byId('expand').hidden = true;
  document.body.classList.remove('noscroll');
  X.key = null;
  const btn = document.querySelector(`[data-chart="${key}"] .xbtn`);
  if (btn) btn.focus({preventScroll: true});
}

function renderExpand() {
  const cfg = EXPAND[X.key];
  const card = document.querySelector(`[data-chart="${X.key}"]`);
  const d = cfg.detail();
  const back = el('button', {type: 'button', class: 'btn x-back', text: '← Назад к дашборду'});
  back.addEventListener('click', closeExpand);
  // Переключатель периода как на дашборде: день / неделя / месяц и стрелки.
  const seg = el('div', {class: 'seg glass', role: 'group', 'aria-label': 'Период'}, UNITS.map(([u, label]) => {
    const b = el('button', {type: 'button', 'data-unit': u, text: label, 'aria-pressed': String(state.unit === u)});
    b.addEventListener('click', () => { setUnit(u); renderExpand(); });
    return b;
  }));
  const arrow = (k) => {
    const b = el('button', {type: 'button', class: 'nav-arrow', text: k < 0 ? '‹' : '›', 'aria-label': k < 0 ? 'Предыдущий период' : 'Следующий период'});
    b.disabled = !canStep(k);
    b.addEventListener('click', () => { step(k); renderExpand(); });
    return b;
  };
  const nav = el('div', {class: 'nav glass'}, arrow(-1), el('span', {class: 'nav-label', text: rangeLabel(win())}), arrow(1));
  const legend = card.querySelector('.legend');
  const chart = el('div', {class: cfg.html || 'chart', 'data-h': String(cfg.h || 0)});
  byId('expand').replaceChildren(el('div', {class: 'wrap x-wrap'},
    el('div', {class: 'x-top'}, back, el('h2', {id: 'x-title', text: card.querySelector('h2').textContent}), seg, nav,
      state.tpl ? el('span', {class: 'range', text: `шаблон ${state.tpl}`}) : null),
    el('div', {class: 'x-metrics'}, d.metrics.map(([label, value, note]) => el('div', {class: 'xm glass'},
      el('span', {text: label}), el('b', {text: value}), note ? el('small', {text: note}) : null))),
    el('section', {class: 'card glass'}, legend ? el('div', {class: 'card-head'}, legend.cloneNode(true)) : null, chart,
      cfg.html ? null : el('p', {class: 'hint',
        text: 'Нажмите на точку или столбец — ниже появятся его цифры и шаблоны, из-за которых он такой.'})),
    el('section', {class: 'card glass x-slice', id: 'x-slice', hidden: ''}),
    el('section', {class: 'card glass'}, el('h3', {text: 'Выводы'}),
      el('ul', {class: 'insights'}, d.insights.filter(Boolean).map((s) => el('li', {text: s})))),
    el('section', {class: 'card glass'}, el('h3', {text: 'Точные цифры'}),
      el('div', {class: 'tablebox'}, X.table = sortTable(d.cols, d.rows, {onPaint: () => paintFocus(false)})))));
  X.detail = d;
  cfg.draw(chart); // после вставки в страницу: графику нужна ширина контейнера
  paintFocus(true);
}

// Выбранный элемент: подсветка строки таблицы и карточка «Выбранный срез» с его цифрами.
function paintFocus(scroll) {
  const box = byId('x-slice');
  if (!box || !X.detail) return;
  const key = X.focus == null ? null : String(X.focus);
  let hit = null;
  for (const tr of X.table ? X.table.querySelectorAll('tbody tr') : []) {
    const on = tr.dataset.key === key;
    tr.classList.toggle('on', on);
    if (on) hit = tr;
  }
  const row = key == null ? null : X.detail.rows.find((r) => String(r.key) === key);
  box.hidden = !row;
  if (!row) return;
  const [first, ...rest] = X.detail.cols;
  const weekly = X.key === 'weekly' || X.key === 'cpr';
  const why = SLICED.has(X.key) ? explainSlice(X.key, X.focus) : null;
  box.replaceChildren(
    el('h3', {text: `Выбранный срез: ${weekly ? 'неделя ' : ''}${first.f ? first.f(row[first.key], row) : row[first.key]}`}),
    el('dl', {class: 'x-kv'}, rest.map((c) => el('div', {}, el('dt', {text: c.label}),
      el('dd', {text: c.f ? c.f(row[c.key], row) || '—' : row[c.key] ?? '—'})))),
    ...(why ? [
      el('h3', {class: 'x-why', text: 'Почему так'}),
      el('ul', {class: 'insights'}, why.lines.map((s) => el('li', {text: s}))),
      el('p', {class: 'hint', text: 'Шаблоны в этом срезе. Нажмите на шаблон, чтобы открыть его.'}),
      el('div', {class: 'tablebox'}, sortTable(SLICE_COLS, why.list, {onRow: (t) => openTemplate(t.name)})),
    ] : []));
  if (hit && scroll) {
    const tb = hit.closest('.tablebox');
    tb.scrollTop = hit.offsetTop - tb.clientHeight / 2;
  }
  // Срез под графиком: прокрутить так, чтобы были видны и низ графика, и срез.
  if (scroll) byId('expand').scrollTop = Math.max(0, box.offsetTop - 160);
}

// ----- «Почему так»: из каких шаблонов сложился выбранный день / неделя -----

const SLICED = new Set(['days', 'weekly', 'weekday', 'cost', 'cpr']);
// Meta считает нажатие в день нажатия, поэтому в коротком срезе у шаблона откликов бывает больше, чем доставок:
// люди нажимают на рассылку прошлых дней. Такой процент не показываем.
const sliceRate = (v) => (v > 1 ? 'по прошлой рассылке' : fmt.pct(v));
const SLICE_COLS = [
  {key: 'name', label: 'Шаблон'}, COL.delivered,
  {key: 'share', label: 'Доля доставок', n: true, f: fmt.pct}, COL.resp, {...COL.resp_rate, f: sliceRate},
  {key: 'usual', label: 'Обычно, %', n: true, f: fmt.pct}, COL.neg_rate, COL.cost,
];

function sliceRows(key, item) {
  if (key === 'weekday') {
    const {range} = weekdayStats(VIEW.w);
    return M.daily.filter((r) => inWin(r, range) && ofTpl(r.name) && weekday(r.day) === +item);
  }
  const range = key === 'weekly' || key === 'cpr' ? {from: item, to: addDays(item, 6)} : {from: item, to: item};
  return M.daily.filter((r) => inWin(r, range) && ofTpl(r.name));
}

// С чем сравниваем срез: средняя неделя за всю историю, средний день периода или средний день недели.
function sliceBase(key) {
  if (key === 'weekly' || key === 'cpr') {
    const wr = weeklyRows();
    const t = {resp: d3.sum(wr, (r) => r.resp), delivered: d3.sum(wr, (r) => r.delivered), cost: d3.sum(wr, (r) => r.cost)};
    return {rate: ratio(t.resp, t.delivered), cpr: ratio(t.cost, t.resp), delivered: ratio(t.delivered, wr.length),
      cost: ratio(t.cost, wr.length), label: 'в средней неделе'};
  }
  if (key === 'weekday') {
    const {days} = weekdayStats(VIEW.w);
    const delivered = d3.sum(days, (d) => d.delivered);
    return {rate: ratio(d3.sum(days, (d) => d.resp), delivered), delivered: ratio(delivered, days.filter((d) => d.delivered).length),
      label: 'в среднем по дням недели'};
  }
  const s = VIEW.total, active = new Set(VIEW.rows.filter((r) => r.sent > 0).map((r) => r.day)).size;
  return {rate: s.resp_rate, cpr: s.cpr, delivered: ratio(s.delivered, active), cost: ratio(s.cost, active), label: 'в средний день периода'};
}

function explainSlice(key, item) {
  const rows = sliceRows(key, item);
  const s = sums(rows);
  if (!s.sent) return null;
  const money = key === 'cost' || key === 'cpr';
  const metric = money ? 'cost' : 'resp';
  const usual = new Map(byTemplate(M.daily.filter((r) => ofTpl(r.name))).map((t) => [t.name, t.resp_rate]));
  const list = byTemplate(rows).map((t) => ({...t, key: t.name, share: ratio(t.delivered, s.delivered), usual: usual.get(t.name)}))
    .sort((a, b) => b[metric] - a[metric]);
  const base = sliceBase(key);
  // «в 2,1 раза больше, чем в средней неделе» / «примерно столько же, сколько в средней неделе».
  const times = (a, b) => {
    const k = ratio(a, b);
    if (k == null) return null;
    return k >= 1.3 ? `в ${nf1.format(k)} раза больше, чем ${base.label}` : k <= 0.77 ? `в ${nf1.format(1 / k)} раза меньше, чем ${base.label}`
      : `примерно столько же, сколько ${base.label}`;
  };
  const lines = [];
  if (key === 'cpr') lines.push(`Один отклик стоил ${fmt.kzt(s.cpr)} при среднем ${fmt.kzt(base.cpr)}.`);
  if (key === 'cost') lines.push(`Расходы ${fmt.kzt(s.cost)} — ${times(s.cost, base.cost)}.`);
  lines.push(`Отклик ${fmt.pct(s.resp_rate)} — это ${pp((s.resp_rate - base.rate) * 100)} к среднему (${fmt.pct(base.rate)}).`);
  const volume = times(s.delivered, base.delivered);
  if (volume) lines.push(`Доставлено ${fmt.int(s.delivered)} — ${volume}.`);
  // Главные шаблоны: те, что вместе дали больше половины откликов (или расходов), но не больше трёх.
  const top = [];
  for (const t of list) {
    if (top.length === 3 || (top.length && d3.sum(top, (x) => x[metric]) >= s[metric] * 0.6)) break;
    top.push(t);
  }
  if (s[metric] > 0) {
    lines.push(money
      ? `Больше всего расходов: ${top.map((t) => `${t.name} — ${fmt.kzt(t.cost)} (${fmt.pct(ratio(t.cost, s.cost))}, отклик ${fmt.pct(t.resp_rate)})`).join('; ')}.`
      : `Больше всего откликов дали: ${top.map((t) => `${t.name} — ${fmt.int(t.resp)} (${fmt.pct(ratio(t.resp, s.resp))} всех откликов, ` +
        (t.resp_rate > 1 ? 'нажимали на прошлую рассылку' : `отклик ${fmt.pct(t.resp_rate)}, обычно ${fmt.pct(t.usual)}`) + ')').join('; ')}.`);
  }
  // Провал: показать шаблон, который занял больше всего доставок при низком отклике.
  const big = d3.greatest(list, (t) => t.delivered);
  if (!money && s.resp_rate < base.rate && big && big.resp_rate < base.rate) {
    lines.push(`Больше всего доставок у ${big.name}: ${fmt.pct(big.share)}, а отклик у него ${fmt.pct(big.resp_rate)} — это тянет вниз.`);
  }
  const from = d3.min(rows, (r) => r.day), to = d3.max(rows, (r) => r.day);
  const firstSend = d3.rollup(M.daily.filter((r) => r.sent > 0), (v) => d3.min(v, (r) => r.day), (r) => r.name);
  const fresh = key === 'weekday' ? [] : list.filter((t) => firstSend.get(t.name) >= from && firstSend.get(t.name) <= to).map((t) => t.name);
  if (fresh.length) lines.push(`Впервые отправлялись: ${fresh.slice(0, 5).join(', ')}${fresh.length > 5 ? ` и ещё ${fresh.length - 5}` : ''}.`);
  return {lines, list};
}

function openTemplate(name) {
  closeExpand();
  state.tpl = name;
  render();
  window.scrollTo({top: 0, behavior: 'smooth'});
}

// Клик по столбцу: на дашборде открывает развёрнутый вид с этим срезом, в развёрнутом — выбирает срез.
function pickItem(ev, node, key, item) {
  ev.preventDefault();
  if (node.closest('#expand')) { X.focus = item; paintFocus(true); return; }
  openExpand(key, item);
}

// ----- календарь выбора периода -----

// Черновик выбора до нажатия «Применить»: from/to — дни (to пуст, пока выбран только первый),
// hover — день под курсором для подсветки, view — правый из показанных месяцев, 'YYYY-MM'.
const pick = {from: null, to: null, hover: null, view: null};
const pad2 = (v) => String(v).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const addMonths = (ym, k) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + k, 1)).toISOString().slice(0, 7); };
const pickMax = () => (M.lastDay > todayStr() ? M.lastDay : todayStr());
const pickMonths = () => (window.innerWidth >= 860 ? 2 : 1);

// «Последние N дней» считаются до последнего дня с отправками: сегодняшних данных утром ещё нет.
function presets() {
  const t = todayStr(), y = addDays(t, -1), month = t.slice(0, 7);
  const last = (n) => ({from: addDays(M.lastDay, -(n - 1)), to: M.lastDay});
  return [
    ['Сегодня', {from: t, to: t}],
    ['Вчера', {from: y, to: y}],
    ['Последние 7 дней', last(7)],
    ['Последние 30 дней', last(30)],
    ['Последние 90 дней', last(90)],
    ['Этот месяц', {from: `${month}-01`, to: t}],
    ['Прошлый месяц', {from: `${addMonths(month, -1)}-01`, to: addDays(`${month}-01`, -1)}],
    ['Всё время', {from: M.firstDay, to: M.lastDay}],
  ];
}

function openPicker() {
  const w = win();
  Object.assign(pick, {from: w.from, to: w.to, hover: null, view: w.to.slice(0, 7)});
  byId('picker').hidden = false;
  byId('range').setAttribute('aria-expanded', 'true');
  renderPicker();
}

function closePicker() {
  byId('picker').hidden = true;
  byId('range').setAttribute('aria-expanded', 'false');
}

function renderPicker() {
  const max = pickMax(), months = pickMonths(), today = todayStr();
  if (pick.view > max.slice(0, 7)) pick.view = max.slice(0, 7);
  const first = addMonths(pick.view, 1 - months);
  const navBtn = (dir, enabled) => {
    const b = el('button', {type: 'button', 'data-nav': String(dir), 'aria-label': dir < 0 ? 'Предыдущий месяц' : 'Следующий месяц',
      text: dir < 0 ? '‹' : '›'});
    b.disabled = !enabled;
    return b;
  };
  const month = (ym, i) => {
    const [y, m] = ym.split('-').map(Number);
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cells = Array.from({length: weekday(`${ym}-01`)}, () => el('span'));
    for (let d = 1; d <= days; d++) {
      const day = `${ym}-${pad2(d)}`;
      const b = el('button', {type: 'button', class: `pk-day${day === today ? ' today' : ''}`, 'data-day': day,
        'aria-label': fmt.day(day)}, el('span', {text: String(d)}));
      b.disabled = day > max || day < M.firstDay;
      cells.push(b);
    }
    return el('div', {class: 'pk-month'},
      el('div', {class: 'pk-head'},
        i === 0 ? navBtn(-1, first > M.firstDay.slice(0, 7)) : el('span'),
        el('span', {text: `${MONTHS_FULL[m - 1]} ${y}`}),
        i === months - 1 ? navBtn(1, pick.view < max.slice(0, 7)) : el('span')),
      el('div', {class: 'pk-grid'}, WEEKDAYS.map((wd) => el('span', {class: 'pk-wd', text: wd})), cells));
  };
  byId('picker').replaceChildren(
    el('div', {class: 'pk-presets'}, presets().map(([label], i) => el('button', {type: 'button', 'data-preset': String(i), text: label}))),
    el('div', {class: 'pk-main'},
      el('div', {class: 'pk-months'}, Array.from({length: months}, (_, i) => month(addMonths(first, i), i))),
      el('div', {class: 'pk-foot'},
        el('span', {class: 'pk-sum', id: 'pk-sum'}),
        el('button', {type: 'button', class: 'btn', 'data-act': 'cancel', text: 'Отмена'}),
        el('button', {type: 'button', class: 'btn primary', id: 'pk-apply', 'data-act': 'apply', text: 'Применить'}))));
  paintRange();
}

// Подсветка выбранных дней, итог внизу и активный быстрый вариант — без перерисовки календаря.
function paintRange() {
  const a = pick.from, b = pick.to || pick.hover || pick.from;
  const [lo, hi] = a && b < a ? [b, a] : [a, b];
  for (const d of byId('picker').querySelectorAll('[data-day]')) {
    const v = d.dataset.day;
    d.classList.toggle('start', v === lo);
    d.classList.toggle('end', v === hi);
    d.classList.toggle('in', Boolean(lo) && v > lo && v < hi);
  }
  const n = lo ? spanDays({from: lo, to: hi}) : 0;
  byId('pk-sum').textContent = !lo ? 'Выберите первый день'
    : !pick.to ? `${fmt.short(lo)} — выберите последний день`
    : `${lo === hi ? fmt.short(lo) : `${fmt.short(lo)} – ${fmt.short(hi)}`} · ${n} ${plural(n, 'день', 'дня', 'дней')}`;
  presets().forEach(([, r], i) => byId('picker').querySelector(`[data-preset="${i}"]`)
    .classList.toggle('on', Boolean(pick.to) && r.from === lo && r.to === hi));
  byId('pk-apply').disabled = !lo;
}

function pickDay(day) {
  if (!pick.from || pick.to) Object.assign(pick, {from: day, to: null});
  else if (day < pick.from) Object.assign(pick, {from: day, to: pick.from});
  else pick.to = day;
  pick.hover = null;
  paintRange();
}

function applyPick() {
  if (!pick.from) return;
  const r = {from: pick.from, to: pick.to || pick.from};
  // Если выбран ровно день, неделя (пн–вс) или месяц — включаем эту единицу, чтобы стрелки шагали по ней.
  const unit = r.from === r.to ? 'day'
    : ['week', 'month'].find((u) => { const w = unitWin(u, r.from); return w.from === r.from && w.to === r.to; });
  Object.assign(state, unit ? {unit, anchor: r.from, range: null} : {unit: 'custom', range: r});
  closePicker();
  render();
}

// ===== События =====

for (const b of document.querySelectorAll('#app [data-unit]')) {
  b.addEventListener('click', () => { closePicker(); setUnit(b.dataset.unit); });
}
for (const b of document.querySelectorAll('#app [data-step]')) {
  b.addEventListener('click', () => { closePicker(); step(+b.dataset.step); });
}
byId('range').addEventListener('click', () => { if (!M) return; if (byId('picker').hidden) openPicker(); else closePicker(); });
byId('picker').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  if (b.dataset.day) pickDay(b.dataset.day);
  else if (b.dataset.preset) {
    const r = presets()[+b.dataset.preset][1];
    Object.assign(pick, {from: r.from, to: r.to, hover: null, view: r.to.slice(0, 7)});
    renderPicker();
  } else if (b.dataset.nav) { pick.view = addMonths(pick.view, +b.dataset.nav); renderPicker(); }
  else if (b.dataset.act === 'apply') applyPick();
  else if (b.dataset.act === 'cancel') closePicker();
});
byId('picker').addEventListener('mouseover', (e) => {
  const d = e.target.closest('[data-day]');
  if (pick.from && !pick.to && d && !d.disabled && d.dataset.day !== pick.hover) { pick.hover = d.dataset.day; paintRange(); }
});
document.addEventListener('pointerdown', (e) => {
  if (!byId('picker').hidden && !e.target.closest('#picker, #range')) closePicker();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!byId('picker').hidden) { closePicker(); byId('range').focus(); }
  else if (!byId('report').hidden) closeReport();
  else if (!byId('expand').hidden) closeExpand();
  else if (state.tpl && M) backToList();
});
// У каждого графика — кнопка «Развернуть»; клик по самому графику тоже разворачивает его.
for (const sec of document.querySelectorAll('[data-chart]')) {
  const head = sec.querySelector('.card-head');
  const title = head.querySelector('h2').textContent;
  const btn = el('button', {type: 'button', class: 'xbtn', title: 'Развернуть', 'aria-label': `Развернуть: ${title}`}, svgIcon(ICON.expand));
  btn.addEventListener('click', () => openExpand(sec.dataset.chart));
  head.append(el('div', {class: 'head-r'}, [...head.children].slice(1), btn));
  sec.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.target.closest('button, a, input, .card-head')) return;
    openExpand(sec.dataset.chart);
  });
}
byId('detail').addEventListener('pointerover', (e) => {
  const b = e.target.closest('[data-btn]');
  highlightButton(b ? b.dataset.btn : null);
});
byId('detail').addEventListener('pointerleave', () => highlightButton(null));
// Нажатие на кнопку в превью показывает её строку в списке нажатий (на телефоне список ниже превью).
byId('detail').addEventListener('click', (e) => {
  const b = e.target.closest('.wa-btn');
  if (!b) return;
  highlightButton(b.dataset.btn);
  const row = byId('detail').querySelector(`.hb-row[data-btn="${b.dataset.btn}"]`);
  if (row) row.scrollIntoView({behavior: 'smooth', block: 'nearest'});
});
byId('search').addEventListener('input', (e) => { state.q = e.target.value; if (M) render(); });
byId('refresh').addEventListener('click', () => load(true));
byId('export').addEventListener('click', exportExcel);
byId('report-btn').addEventListener('click', openReport);
for (const b of document.querySelectorAll('#views [data-view]')) b.addEventListener('click', () => setView(b.dataset.view));
window.addEventListener('hashchange', () => { if (M && CRM) setView(location.hash === '#bases' ? 'bases' : 'dash'); });
byId('gate').addEventListener('submit', (e) => {
  e.preventDefault();
  savePassword(byId('pw').value);
  load();
});
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!M) return;
    render();
    if (!byId('picker').hidden) renderPicker(); // на узком экране один месяц вместо двух
    if (!byId('expand').hidden) renderExpand();
  }, 150);
});

load().catch(() => showNotice('Не удалось загрузить данные. Проверьте подключение и обновите страницу.'));
