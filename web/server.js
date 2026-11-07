// Запуск дашборда на своём сервере (вместо Vercel): node server.js  или  npm start
// Отдаёт статические файлы (index.html, app.js, styles.css, favicon.svg) и те же функции из api/, что и Vercel.
//
// Переменные окружения (можно положить в файл .env рядом с этим файлом, см. .env.example):
//   SHEET_API_URL, SHEET_API_KEY  — обязательно: ссылка …/exec веб-приложения таблицы и ключ
//   DASHBOARD_PASSWORD            — пароль входа (без него дашборд открыт всем)
//   AI_API_KEY, AI_MODEL          — для кнопки «Сделать отчёт» (необязательно)
//   PORT (по умолчанию 3000), HOST (по умолчанию 127.0.0.1 — ставьте за nginx; 0.0.0.0 — слушать все адреса)
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
loadEnv(path.join(root, '.env'));

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const MAX_BODY = 2 * 1024 * 1024; // запрос отчёта ИИ ≈ 30 КБ
const API = {
  '/api/data': './api/data.js',
  '/api/notes': './api/notes.js',
  '/api/insights': './api/insights.js',
  '/api/crm': './api/crm.js',
};
// Отдаются только эти файлы: исходники сервера, api/ и .env наружу не попадают.
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
};

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

// Помощники ответа, как у Vercel Functions: res.status().json(), req.query, req.body.
function asVercel(req, res, url, raw) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => {
    if (!res.headersSent) res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  };
  req.query = Object.fromEntries(url.searchParams);
  const type = String(req.headers['content-type'] || '');
  if (raw && type.includes('application/json')) {
    try { req.body = JSON.parse(raw); } catch (e) { req.body = null; }
  } else {
    req.body = raw;
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const handler = API[url.pathname];
  if (handler) {
    let raw = '';
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { res.writeHead(413); res.end('Too large'); req.destroy(); return; }
      raw += c;
    });
    req.on('end', async () => {
      if (res.writableEnded) return;
      asVercel(req, res, url, raw);
      try {
        await require(handler)(req, res);
      } catch (e) {
        console.error(new Date().toISOString(), url.pathname, e);
        if (!res.headersSent) res.status(500).json({error: 'server', message: 'Ошибка сервера.'});
      }
    });
    return;
  }
  const file = STATIC[url.pathname];
  if (!file || req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(404, {'content-type': 'text/plain; charset=utf-8'});
    res.end('Not found');
    return;
  }
  res.writeHead(200, {'content-type': file[1], 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff'});
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(path.join(root, file[0])).pipe(res);
});
// Отчёт ИИ может идти до 5 минут (на Vercel maxDuration 300).
server.requestTimeout = 330 * 1000;
server.headersTimeout = 60 * 1000;
server.listen(port, host, () => {
  console.log(`Дашборд: http://${host}:${port}`);
  if (require('./api/_demo').isDemo()) console.warn('Демо-режим: SHEET_API_URL и SHEET_API_KEY не заданы — показываю случайные данные из api/sample-data.json.');
  if (!process.env.DASHBOARD_PASSWORD) console.warn('Внимание: не задан DASHBOARD_PASSWORD — дашборд открыт без пароля.');
});
