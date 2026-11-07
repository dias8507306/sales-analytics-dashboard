// Vercel Function: заметки к базам рассылок (вкладка «Базы»).
// GET  — все заметки {база: {note, updatedAt}} прямо из таблицы, без кэша.
// POST {base, note} — сохранить заметку (пустая — удалить). Пишет скрипт таблицы (doPost в Code.gs).
// Переменные окружения те же, что у data.js: SHEET_API_URL, SHEET_API_KEY.

const {passwordOk} = require('./_auth');
const demo = require('./_demo');
const {withAmo} = require('./data');

module.exports = async (req, res) => {
  if (!passwordOk(req)) { res.status(401).json({error: 'password'}); return; }
  res.setHeader('Cache-Control', 'no-store');
  if (demo.isDemo()) { // демо: заметки в памяти процесса
    const notes = demo.demoNotes(withAmo);
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const base = String(body.base || '').trim(), note = String(body.note || '').trim();
      if (!base || base.length > 200 || note.length > 2000) { res.status(400).json({error: 'input', message: 'Заметка до 2000 знаков.'}); return; }
      if (note) notes[base] = {note, updatedAt: new Date().toISOString()};
      else delete notes[base];
    }
    res.status(200).json({notes});
    return;
  }
  const url = process.env.SHEET_API_URL, key = process.env.SHEET_API_KEY;
  if (!url || !key) { res.status(500).json({error: 'config', message: 'В настройках Vercel не заданы SHEET_API_URL и SHEET_API_KEY.'}); return; }

  let upstream;
  try {
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const base = String(body.base || '').trim(), note = String(body.note || '').trim();
      if (!base || base.length > 200 || note.length > 2000) { res.status(400).json({error: 'input', message: 'Заметка до 2000 знаков.'}); return; }
      // Apps Script отвечает на POST переадресацией на страницу с результатом — fetch проходит по ней сам.
      upstream = await fetch(url, {method: 'POST', redirect: 'follow', headers: {'content-type': 'text/plain'},
        body: JSON.stringify({key, action: 'note', base, note})});
    } else {
      upstream = await fetch(`${url}?key=${encodeURIComponent(key)}&part=notes`, {redirect: 'follow'});
    }
  } catch (e) {
    res.status(502).json({error: 'upstream', message: 'Таблица не ответила.'});
    return;
  }
  const data = await upstream.json().catch(() => null);
  if (!data || data.error) {
    const old = data && data.error === 'unknown action' || !data;
    res.status(502).json({error: 'upstream', message: old
      ? 'Таблица пока не умеет сохранять заметки: вставьте новый Code.gs и опубликуйте новую версию развертывания.'
      : `Таблица: ${data.error}`});
    return;
  }
  res.status(200).json({notes: data.notes || {}});
};
