// Vercel Function: забирает данные из Google Таблицы (веб-приложение Apps Script),
// добавляет историю amoCRM (amo-history.json) и отдаёт дашборду. Ключ таблицы остаётся на сервере.
//
// Переменные окружения (Vercel → Project → Settings → Environment Variables):
//   SHEET_API_URL      — ссылка веб-приложения из меню таблицы «WhatsApp → Ссылка для сайта»
//   SHEET_API_KEY      — ключ из того же окна
//   DASHBOARD_PASSWORD — необязательно: пароль для входа на дашборд
// Без SHEET_API_URL и SHEET_API_KEY включается демо-режим (api/_demo.js): случайные данные из api/sample-data.json.

const {passwordOk} = require('./_auth');
const demo = require('./_demo');
// Лиды и продажи по рассылкам до 20.10.2026 из amoCRM — разовая выгрузка (суммы по дню и шаблону, без клиентов).
// С 20.10 то же самое приходит из Битрикса через таблицу (поле crm).
const AMO = require('./amo-history.json');

const CACHE_MS = 10 * 60 * 1000;
let cache = null;

function unconfirmedOf(crm) {
  const ok = new Set((AMO.confirmedTemplates || []).concat(crm && crm.confirmedTemplates ? crm.confirmedTemplates : []));
  const bad = (AMO.unconfirmedTemplates || []).concat(crm && crm.unconfirmedTemplates ? crm.unconfirmedTemplates : []);
  return [...new Set(bad)].filter((t) => !ok.has(t));
}

// Строки Битрикса дописываются к строкам amoCRM; столбцы сводятся по названиям (у старой версии скрипта нет paid).
function withAmo(body) {
  const crm = body.crm && body.crm.enabled ? body.crm : null;
  const columns = AMO.rows.columns;
  const bitrixRows = crm ? crm.rows.rows.map((r) => {
    const o = Object.fromEntries(crm.rows.columns.map((c, i) => [c, r[i]]));
    return columns.map((c) => (c in o ? o[c] : null));
  }) : [];
  return Object.assign({}, body, {
    crm: Object.assign({currency: 'KZT'}, crm, {
      enabled: true,
      source: crm ? 'amocrm+bitrix' : 'amocrm',
      from: AMO.from, // с этого дня есть лиды и продажи: amoCRM до 19.10, дальше Битрикс
      sources: [{name: 'amoCRM', from: AMO.from, to: AMO.to}].concat(crm ? [{name: 'Битрикс24', from: crm.from || '2026-10-20'}] : []),
      rows: {columns, rows: AMO.rows.rows.concat(bitrixRows)},
      bases: AMO.bases.map((b) => Object.assign({source: 'amoCRM'}, b)).concat(crm && Array.isArray(crm.bases) ? crm.bases : []),
      // Шаблоны, чьи рассылки не подтверждены отправками 1100 по Meta ни в одной CRM: лиды и ROI по ним не считаются.
      unconfirmedTemplates: unconfirmedOf(crm),
      rules: AMO.rules,
    }),
  });
}

module.exports = async (req, res) => {
  if (!passwordOk(req)) {
    res.status(401).json({error: 'password'});
    return;
  }
  const url = process.env.SHEET_API_URL;
  const key = process.env.SHEET_API_KEY;
  if (demo.isDemo()) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(demo.demoBody(withAmo));
    return;
  }
  if (!url || !key) {
    res.status(500).json({error: 'config', message: 'В настройках Vercel не заданы SHEET_API_URL и SHEET_API_KEY.'});
    return;
  }

  const refresh = req.query && req.query.refresh === '1';
  if (!cache || refresh || Date.now() - cache.at > CACHE_MS) {
    let body;
    try {
      const upstream = await fetch(`${url}?key=${encodeURIComponent(key)}`, {redirect: 'follow'});
      body = JSON.parse(await upstream.text());
    } catch (e) {
      res.status(502).json({error: 'upstream', message: 'Таблица не ответила или вернула не JSON. Проверьте SHEET_API_URL и что веб-приложение опубликовано с доступом «Все».'});
      return;
    }
    if (body.error) {
      const message = body.error === 'unauthorized' ? 'Таблица не приняла ключ: проверьте SHEET_API_KEY.' : String(body.error);
      res.status(502).json({error: 'upstream', message});
      return;
    }
    cache = {at: Date.now(), body: withAmo(body)};
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(cache.body);
};
module.exports.withAmo = withAmo; // для dev-server.js с --sample
