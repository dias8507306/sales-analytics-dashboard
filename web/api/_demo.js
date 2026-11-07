// Демо-режим: дашборд работает без Google Таблицы, CRM и ключа ИИ.
// Включается сам, когда не заданы SHEET_API_URL и SHEET_API_KEY (выключить: DEMO_MODE=0).
// Данные — api/sample-data.json и api/amo-history.json, их делает scripts/generate-demo-data.js (всё случайное).
// Даты сдвигаются на целое число недель, чтобы последняя неделя данных была текущей (дни недели сохраняются).

const DEMO_FILE = './sample-data.json';

const isDemo = () => process.env.DEMO_MODE !== '0' && !(process.env.SHEET_API_URL && process.env.SHEET_API_KEY);

const DATE = /^(\d{4}-\d{2}-\d{2})(T.*)?$/;
function shiftDates(value, days) {
  if (!days) return value;
  if (Array.isArray(value)) return value.map((v) => shiftDates(v, days));
  if (value && typeof value === 'object') {
    // ключи тоже бывают датами? нет — но имена баз и шаблонов не трогаем, только значения
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shiftDates(v, days)]));
  }
  if (typeof value === 'string') {
    const m = value.match(DATE);
    if (!m) return value;
    const d = new Date(`${m[1]}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    const day = d.toISOString().slice(0, 10);
    return m[2] ? new Date(`${day}${m[2]}`).toISOString() : day;
  }
  return value;
}

// Сколько дней прибавить: от дня выгрузки демо до сегодня (UTC+5), округлено вниз до недель.
function shiftDays(updatedAt) {
  const today = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
  const diff = Math.round((Date.parse(today) - Date.parse(String(updatedAt).slice(0, 10))) / 864e5);
  return diff > 0 ? Math.floor(diff / 7) * 7 : 0;
}

let cached = null;
// withAmo — из data.js: к данным «таблицы» добавляется история amoCRM, как в боевом режиме.
function demoBody(withAmo) {
  if (!cached) {
    const raw = require(DEMO_FILE);
    cached = shiftDates(Object.assign({}, withAmo(raw), {demo: true}), shiftDays(raw.updatedAt));
  }
  return cached;
}

// Заметки к базам в демо живут в памяти процесса.
let notes = null;
function demoNotes(withAmo) {
  if (!notes) notes = Object.assign({}, demoBody(withAmo).notes || {});
  return notes;
}

// Пример ответа ИИ — только чтобы посмотреть вид блока «Выводы ИИ». Цифры не настоящие.
function mockInsights(body) {
  const names = ((body && body.templates) || []).map((t) => t.name);
  return {
    provider: 'mock', model: 'демо', createdAt: new Date().toISOString(),
    summary: `Пример: за период ${(body && body.period && body.period.label) || ''} лучше всего сработали поздравления с этапом олимпиады и короткие вопросы; общие рассылки с описанием курса дали мало лидов.`,
    repeat: [
      {title: 'Начинать с новости о ребёнке', evidence: 'Пример: отклик в 2–3 раза выше, чем у описания курса в той же базе.', templates: names.slice(0, 2)},
      {title: 'Мягкие кнопки «узнать»', evidence: 'Пример: больше нажатий, чем у «записаться».', templates: names.slice(2, 3)},
    ],
    avoid: [{title: 'Цена в тексте', evidence: 'Пример: отклик ниже, отказов больше.', templates: names.slice(3, 4)}],
    comparisons: names.length >= 2
      ? [{title: 'Пример: поздравление против описания курса', better: names[0], worse: names[1], evidence: 'Пример: цифры обоих шаблонов.'}] : [],
    experiments: ['Пример: разделить базу пополам и отправить два текста в один день.'],
    caveats: ['Демо-режим: выводы — заготовка, ИИ не вызывался.'],
  };
}

module.exports = {isDemo, demoBody, demoNotes, mockInsights, shiftDates};
