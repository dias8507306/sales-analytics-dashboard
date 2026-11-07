// Локальный просмотр дашборда без Vercel.
//   node dev-server.js                      — данные через api/data.js; без SHEET_API_URL и SHEET_API_KEY —
//                                             демо-режим (случайные данные из api/sample-data.json, ИИ — заготовка)
//   node dev-server.js --sample data.json   — данные из файла
//   --mock-crm                              — лиды и продажи из примера в api/crm.js
//   --mock-ai                               — «Выводы ИИ» из примера ниже, без запроса к ИИ
//   без --mock-ai выводы идут через api/insights.js (нужен AI_API_KEY в окружении)
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const args = process.argv.slice(2);
const sample = args.includes('--sample') ? path.resolve(args[args.indexOf('--sample') + 1]) : null;
if (args.includes('--mock-crm')) process.env.CRM_MOCK = '1';
const port = Number(args.includes('--port') ? args[args.indexOf('--port') + 1] : process.env.PORT || 5173);
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png'};
const localNotes = {};

// Помощники ответа, как у Vercel Functions.
function asVercel(req, res, url) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); };
  req.query = Object.fromEntries(url.searchParams);
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/data') {
    if (sample) {
      // Как на Vercel: к данным таблицы добавляется история amoCRM.
      const body = require('./api/data.js').withAmo(JSON.parse(fs.readFileSync(sample, 'utf8')));
      res.writeHead(200, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
      res.end(JSON.stringify(body));
      return;
    }
    asVercel(req, res, url);
    require('./api/data.js')(req, res);
    return;
  }
  if (url.pathname === '/api/crm') {
    asVercel(req, res, url);
    require('./api/crm.js')(req, res);
    return;
  }
  if (url.pathname === '/api/notes' && sample) {
    // С --sample заметки живут в памяти сервера — чтобы проверить вкладку «Базы» без таблицы.
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      asVercel(req, res, url);
      if (req.method === 'POST') {
        const {base, note} = JSON.parse(raw || '{}');
        if (note && note.trim()) localNotes[base] = {note: note.trim(), updatedAt: new Date().toISOString()};
        else delete localNotes[base];
      }
      res.status(200).json({notes: localNotes});
    });
    return;
  }
  if (url.pathname === '/api/notes') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { asVercel(req, res, url); req.body = raw; require('./api/notes.js')(req, res); });
    return;
  }
  if (url.pathname === '/api/insights') {
    // Vercel сам разбирает JSON-тело запроса; здесь — вручную.
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      asVercel(req, res, url);
      try { req.body = JSON.parse(raw || '{}'); } catch (e) { req.body = null; }
      if (args.includes('--mock-ai')) { setTimeout(() => res.status(200).json(mockInsights(req.body)), 1200); return; }
      require('./api/insights.js')(req, res);
    });
    return;
  }
  const file = path.join(root, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  if (!file.startsWith(root) || path.basename(file).startsWith('_') || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  res.writeHead(200, {'content-type': types[path.extname(file)] || 'application/octet-stream'});
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`Дашборд: http://localhost:${port}`));

// Пример ответа ИИ — только чтобы посмотреть вид блока. Цифры не настоящие.
function mockInsights(body) {
  const names = ((body && body.templates) || []).map((t) => t.name);
  return {
    provider: 'mock', model: 'пример', createdAt: new Date().toISOString(),
    summary: `Пример: за период ${(body && body.period && body.period.label) || ''} лучше всего сработали поздравления с этапом олимпиады; общие рассылки с пробным уроком почти не дали лидов.`,
    repeat: [
      {title: 'Начинать с новости о ребёнке', evidence: 'Пример: отклик 40–58% против 4–15% у описания курса в той же базе.', templates: names.slice(0, 2)},
      {title: 'Мягкие кнопки «узнать»', evidence: 'Пример: +20–70% нажатий против «записаться».', templates: names.slice(2, 3)},
    ],
    avoid: [{title: 'Цена в тексте', evidence: 'Пример: 4,9% отклика против 10,8%.', templates: names.slice(3, 4)}],
    comparisons: names.length >= 2
      ? [{title: 'Пример: поздравление против описания курса', better: names[0], worse: names[1], evidence: 'Пример: цифры обоих шаблонов.'}] : [],
    experiments: ['Пример: разделить базу пополам и отправить два текста в один день.'],
    caveats: ['Пример: продаж мало, ROI отдельного шаблона — ориентир.'],
  };
}
