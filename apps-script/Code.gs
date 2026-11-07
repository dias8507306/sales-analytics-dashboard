/**
 * Статистика шаблонов WhatsApp в Google Таблице — источник данных для дашборда на Vercel.
 * Каждое утро скрипт забирает статистику шаблонов из Meta (template_analytics)
 * и дописывает её в листы «Шаблоны», «Статистика по дням» и «Кнопки по дням».
 * Сайт забирает данные по защищённой ссылке (doGet с ключом).
 *
 * Настройка (один раз): обновите таблицу, в меню WhatsApp выберите
 * «Подключить и выгрузить данные» и вставьте постоянный токен Meta.
 * Токен хранится в личных свойствах скрипта того, кто подключал, — другие
 * пользователи таблицы его не видят.
 *
 * Ссылка и ключ для сайта: меню WhatsApp → «Ссылка для сайта».
 *
 * Каждое утро updateAll перезаписывает последние 7 дней: прочтения и нажатия
 * Meta досчитывает задним числом, поэтому свежие дни нужно обновлять повторно.
 *
 * Битрикс24 (лиды и продажи по шаблонам): меню WhatsApp → «Подключить Битрикс24», вставить адрес
 * входящего вебхука (права: CRM и Бизнес-процессы). Дальше updateBitrix раз в час дописывает листы «Битрикс: …».
 */

// ID аккаунта WhatsApp Business EduApp (номер +7 700 000 11 00).
const WABA_ID = '000000000000000';
const API_VERSION = 'v21.0';
const BACKFILL_DAYS = 90;
const REFRESH_DAYS = 7;
const UPDATE_HOUR = 7;
const PRODUCT_TYPES = ['MARKETING_MESSAGES_LITE_API', 'CLOUD_API'];
const CHANNEL_LABELS = {MARKETING_MESSAGES_LITE_API: 'Marketing Messages API', CLOUD_API: 'Cloud API'};

// Листы прошлой версии, которые скрипт удаляет.
const SHEET_DASHBOARD = 'Дашборд';
const SHEET_TEMPLATES = 'Шаблоны';
const SHEET_DAILY = 'Статистика по дням';
const SHEET_BUTTONS = 'Кнопки по дням';
const SHEET_CALC = 'Расчёты';
const SHEET_LOG = 'Журнал';
const SHEET_PHONE = 'Номер';
const PHONE_HEADER = ['Время', 'Номер', 'Качество', 'Лимит', 'Статус', 'Отправка'];
// Лимит рассылок Meta отдаёт только в новых версиях API.
const PHONE_API_VERSION = 'v23.0';

// Битрикс24. Рассылка — бизнес-процесс по сделке, в его действии Wazzup записано имя шаблона Meta.
// Лид — сделка, которую после рассылки перевели в воронку ОП; продажа — сделка в успешной стадии.
const BITRIX_FROM = '2026-10-20T00:00:00+03:00'; // раньше этой даты в Битриксе нет записей о рассылках
const BITRIX_OP_CATEGORY = 9;                    // воронка «ОП 2-9 онлайн»
// В «Сумме» сделки — уже оплаченное, остаток договора — в поле «Қарыз суммасы». Выручка = оплачено + долг.
const BITRIX_DEBT_FIELD = 'UF_CRM_0000000000000';
const BITRIX_REFRESH_DAYS = 120;                 // стадии и суммы обновляем у сделок с рассылкой за эти дни
const BITRIX_BUDGET_MS = 4.5 * 60 * 1000;        // запуск ограничен 6 минутами; что не успели, доделает следующий
const SHEET_BX_SENDS = 'Битрикс: рассылки';
const SHEET_BX_OP = 'Битрикс: переходы в ОП';
const SHEET_BX_DEALS = 'Битрикс: сделки';
const BX_SENDS_HEADER = ['Дело', 'Сделка', 'Время', 'Бизнес-процесс', 'Рассылка', 'Шаблон'];
const BX_OP_HEADER = ['Запись', 'Сделка', 'Время', 'Стадия'];
const BX_DEALS_HEADER = ['Сделка', 'Воронка', 'Стадия', 'Продажа', 'Оплачено', 'Долг'];
// Заметки к базам рассылок, которые пишут на дашборде (вкладка «Базы»); сайт сохраняет их через doPost.
const SHEET_NOTES = 'Базы: заметки';
const NOTES_HEADER = ['База', 'Заметка', 'Обновлено'];

// Последние четыре столбца — для превью сообщения на сайте: полный текст, заголовок, подпись и кнопки с типами (JSON).
const TEMPLATES_HEADER = ['Шаблон', 'ID', 'Язык', 'Тип', 'Тема', 'Заголовок', 'Первая_строка', 'Цена', 'Срок', 'Длина', 'Эмодзи', 'Ссылка_в_тексте', 'Кнопок', 'Кнопки', 'Переменные', 'Статус', 'Начало_текста', 'Категория',
  'Текст', 'Заголовок_текст', 'Подпись', 'Кнопки_JSON'];
// Порядок столбцов важен: на буквы A…S ссылаются формулы листа «Расчёты».
const DAILY_HEADER = ['Дата', 'Шаблон', 'Канал', 'Тип', 'Язык', 'Тема', 'Заголовок', 'Первая_строка', 'Цена', 'Срок', 'Отправлено', 'Доставлено', 'Прочитано', 'Интерес', 'Ссылка', 'Отказ', 'Расходы', 'Неделя', 'День_недели'];
const BUTTONS_HEADER = ['Дата', 'Шаблон', 'Тип', 'Язык', 'Тема', 'Кнопка', 'Вид', 'Нажатия', 'Доставлено_шаблона'];

// Кнопки, нажатие на которые считается отказом («не нужно», «не беспокоить»).
const NEGATIVE_BUTTON = /емес|беспокоить|не надо|келмейді|отпис/i;
const LINK_BUTTON = 'Ссылка в тексте';

// Тип рассылки по названию шаблона. Правила проверяются по порядку.
const SEGMENT_RULES = [
  {label: 'Массовые рассылки', test: /skidka|rus_1100_rassylka|eksp_1100|gibrid_1100/},
  {label: 'Воронка после звонка', test: /posle_z|nedozvon|ne_dozvon|chto_reshili|somnenie|koshtasu|as_proverka|oshibka|tirkelu|insta|eduapp_app|pdf|dokument|_1100_1$|1100_kaz|1100_rus|as_povt_kasanie/},
  {label: 'База «Алтын Сақа»', test: /(^|_)as(_|$)|altyn_saka/},
];
const SEGMENT_DEFAULT = 'Массовые рассылки';
const SEGMENTS = ['База «Алтын Сақа»', 'Воронка после звонка', 'Массовые рассылки'];

// Тема шаблона по названию. Правила проверяются по порядку.
const FAMILY_RULES = [
  ['После звонка', /chto_reshili|nedozvon|ne_dozvon|posle_z|koshtasu|somnenie|as_proverka|as_povt|oshibka|tirkelu|eduapp_app|insta|probnyy_sabak_kaz_1100|pdf/],
  ['Алтын Сақа: поздравление', /^(as_|altyn_saka|elit_baza_as|pu_as_)/],
  ['Английский', /^angl/],
  ['Гибрид', /gibrid/],
  ['Академия', /akademiya/],
  ['Учителя', /mugalim/],
  ['Олимпиадные курсы', /olimp|7_8_9|7_9/],
  ['Пробный урок / диагностика', /probnyy|diagnost/],
  ['Скидки', /skidka|sikdka|zhenildik|28_500|pp_/],
  ['НИШ / БИЛ / элит', /nish|elit|bil/],
  ['ПУ', /(^|_)pu(_|$)|^pu/],
  ['Общие рассылки по базе', /rassylka|povt|baza|zakryt|kaz_rus|of_ketip|off_ketken|oryssha_novyy|natizhe|vebinar|matem|matstart|zhyldyk|kyzylorda|eksp|kitap/],
];

const HEADER_LABELS = {TEXT: 'Текст', IMAGE: 'Картинка', VIDEO: 'Видео', DOCUMENT: 'Документ'};
const WEEKDAYS = ['1 Пн', '2 Вт', '3 Ср', '4 Чт', '5 Пт', '6 Сб', '7 Вс'];
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2705}\u{203C}\u{2049}\u{2122}\u{2139}\u{2194}-\u{21AA}\u{231A}-\u{23FF}\u{25AA}-\u{25FE}\u{2934}\u{2935}\u{3030}\u{303D}\u{3297}\u{3299}]/u;


function onOpen() {
  SpreadsheetApp.getUi().createMenu('WhatsApp')
    .addItem('Подключить и выгрузить данные', 'connect')
    .addItem('Обновить сейчас', 'updateAll')
    .addItem('Ссылка для сайта', 'siteLink')
    .addSeparator()
    .addItem('Подключить Битрикс24', 'connectBitrix')
    .addItem('Обновить Битрикс сейчас', 'updateBitrix')
    .addToUi();
}

function connect() {
  const ui = SpreadsheetApp.getUi();
  const answer = ui.prompt('Подключение WhatsApp',
    'Вставьте постоянный токен пользователя системы Meta (разрешение whatsapp_business_management):', ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return;
  const token = answer.getResponseText().trim();
  if (!token) {
    ui.alert('Токен пустой. Запустите подключение ещё раз и вставьте токен.');
    return;
  }
  PropertiesService.getUserProperties().setProperty('META_TOKEN', token);
  SpreadsheetApp.getActive().toast('Выгружаю статистику за 90 дней, это займёт 1–2 минуты…', 'WhatsApp', 120);
  try {
    setup();
    ui.alert('Готово', 'Данные выгружены. Дальше таблица обновляется сама каждое утро. Ссылку для сайта — меню WhatsApp → «Ссылка для сайта».', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Не получилось', String((e && e.message) || e), ui.ButtonSet.OK);
  }
}

function setup() {
  checkSettings_();
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === 'updateAll') ScriptApp.deleteTrigger(trigger);
  }
  ScriptApp.newTrigger('updateAll').timeBased().everyDays(1).atHour(UPDATE_HOUR).create();
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', SpreadsheetApp.getActive().getId());
  removeOldDashboard_();
  updateAll();
}

function updateAll() {
  const started = new Date();
  try {
    const {token, wabaId} = checkSettings_();
    const templates = fetchTemplates_(token, wabaId).map(describeTemplate_);
    writeSheet_(SHEET_TEMPLATES, TEMPLATES_HEADER, templates.map(templateRow_));

    const hasHistory = readRows_(SHEET_DAILY).length > 0;
    const days = hasHistory ? REFRESH_DAYS : BACKFILL_DAYS;
    const end = Math.floor(Date.now() / 1000);
    const start = Math.floor((end - (days - 1) * 86400) / 86400) * 86400;
    const points = fetchAnalytics_(token, wabaId, templates.map((t) => t.id), start, end);
    const {dailyRows, buttonRows} = buildRows_(points, templates);

    const fromKey = utcDayKey_(start);
    // Старые строки получают разметку по текущим правилам, чтобы правка правил применялась ко всей истории.
    const byName = {};
    for (const t of templates) byName[t.name] = t;
    const relabelDaily = (r) => {
      const t = byName[r[1]];
      return t ? r.slice(0, 3).concat([t.segment, t.lang, t.family, t.header, t.opener, t.price, t.urgency], r.slice(10)) : r;
    };
    const relabelButtons = (r) => {
      const t = byName[r[1]];
      return t ? r.slice(0, 2).concat([t.segment, t.lang, t.family], r.slice(5)) : r;
    };
    replaceFrom_(SHEET_DAILY, DAILY_HEADER, dailyRows, fromKey, [0, 17], relabelDaily);
    replaceFrom_(SHEET_BUTTONS, BUTTONS_HEADER, buttonRows, fromKey, [0], relabelButtons);
    // Качество номера проверяем отдельно: его сбой не должен ломать выгрузку статистики.
    let phoneNote = '';
    try {
      saveLatestPhone_(fetchPhone_(token, wabaId), started);
    } catch (e) {
      phoneNote = `; номер не проверен: ${(e && e.message) || e}`;
    }
    log_(started, 'ок', `шаблонов: ${templates.length}; обновлены дни с ${fromKey}; строк: ${dailyRows.length} статистики, ${buttonRows.length} кнопок${phoneNote}`);
  } catch (e) {
    log_(started, 'ошибка', String((e && e.message) || e));
    throw e;
  }
}


// ===== Meta API =====

function checkSettings_() {
  const script = PropertiesService.getScriptProperties();
  const token = (PropertiesService.getUserProperties().getProperty('META_TOKEN') || script.getProperty('META_TOKEN') || '').trim();
  const wabaId = (script.getProperty('WABA_ID') || WABA_ID).trim();
  if (!token) throw new Error('Токен не задан: меню WhatsApp → «Подключить и выгрузить данные».');
  return {token, wabaId};
}

function fetchJson_(url, token) {
  const response = UrlFetchApp.fetch(url, {headers: {Authorization: 'Bearer ' + token}, muteHttpExceptions: true});
  const code = response.getResponseCode();
  let body;
  try {
    body = JSON.parse(response.getContentText());
  } catch (e) {
    throw new Error(`Meta API вернул не JSON (код ${code}).`);
  }
  if (code !== 200 || body.error) {
    const err = body.error || {};
    const hint = err.code === 190 ? ' Токен недействителен или истёк: выпустите новый и обновите META_TOKEN.' : '';
    throw new Error(`Meta API, код ${code}: ${err.message || 'неизвестная ошибка'}.${hint}`);
  }
  return body;
}

function query_(params) {
  return Object.keys(params).map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
}

// Качество номера, лимит рассылок и возможность отправки. Номер — первый в аккаунте (в WABA EduApp он один).
function fetchPhone_(token, wabaId) {
  const base = `https://graph.facebook.com/${PHONE_API_VERSION}/${wabaId}`;
  const list = fetchJson_(`${base}/phone_numbers?` + query_({
    fields: 'id,display_phone_number,quality_rating,whatsapp_business_manager_messaging_limit,status',
  }), token).data || [];
  const phone = list[0];
  if (!phone) throw new Error('в аккаунте нет номеров');
  const health = fetchJson_(`${base}?` + query_({fields: 'health_status'}), token).health_status || {};
  return {
    number: phone.display_phone_number,
    quality: phone.quality_rating || 'UNKNOWN',
    limit: phone.whatsapp_business_manager_messaging_limit || '',
    status: phone.status || '',
    canSend: health.can_send_message || '',
  };
}

// Одна строка в день: сегодняшняя запись заменяется, история за прошлые дни остаётся.
function saveLatestPhone_(p, at) {
  const sheet = getSheet_(SHEET_PHONE);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(PHONE_HEADER);
    sheet.setFrozenRows(1);
  }
  // Апостроф: иначе «+7 700 …» таблица принимает за формулу и пишет #ERROR!
  const row = [at, p.number ? `'${p.number}` : '', p.quality, p.limit, p.status, p.canSend];
  const last = sheet.getLastRow();
  if (last > 1 && dayKey_(sheet.getRange(last, 1).getValue()) === dayKey_(at)) {
    sheet.getRange(last, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

function fetchTemplates_(token, wabaId) {
  const out = [];
  let url = `https://graph.facebook.com/${API_VERSION}/${wabaId}/message_templates?` +
    query_({fields: 'id,name,status,category,language,components', limit: 100});
  while (url) {
    const page = fetchJson_(url, token);
    out.push(...(page.data || []));
    url = page.paging && page.paging.next;
  }
  return out;
}

function fetchAnalytics_(token, wabaId, templateIds, start, end) {
  const points = [];
  for (const productType of PRODUCT_TYPES) {
    for (let i = 0; i < templateIds.length; i += 10) {
      let url = `https://graph.facebook.com/${API_VERSION}/${wabaId}/template_analytics?` + query_({
        start, end, granularity: 'DAILY', product_type: productType, limit: 1000,
        metric_types: JSON.stringify(['SENT', 'DELIVERED', 'READ', 'CLICKED', 'COST']),
        template_ids: JSON.stringify(templateIds.slice(i, i + 10)),
      });
      while (url) {
        const page = fetchJson_(url, token);
        for (const block of page.data || []) {
          for (const p of block.data_points || []) points.push(Object.assign({product_type: productType}, p));
        }
        url = page.paging && page.paging.next;
      }
    }
  }
  return points;
}


// ===== Разметка шаблонов =====

function describeTemplate_(t) {
  const comps = {};
  for (const c of t.components || []) comps[c.type] = c;
  const body = (comps.BODY && comps.BODY.text) || '';
  const lines = body.split('\n').map(cleanText_).filter(Boolean);
  const first = (lines[0] || '').toLowerCase();
  const lower = body.toLowerCase();
  const buttons = ((comps.BUTTONS && comps.BUTTONS.buttons) || []).map((b) => normalizeButton_(b.text)).filter(Boolean);
  const hasLink = /https?:\/\/|www\.|\.kz\b|wa\.me/.test(lower);
  const name = t.name;
  const lang = t.language === 'kk' ? 'KZ' : String(t.language || '').startsWith('ru') ? 'RU' : t.language;

  let opener = 'Описание курса';
  if (/құттықта|поздрав|прош[её]л|өтіп|өткен|дәлелдеді/.test(first)) opener = 'Новость о ребёнке';
  else if (/тг|₸|теңге|тенге|жеңілдік|скидк|%|тегін|бесплатн|акци/.test(first)) opener = 'Цена или скидка';
  else if (first.includes('?')) opener = 'Вопрос';
  else if (/құрметті|уважаем|сәлем|здравств|добрый|қайырлы|извиня|жазып отырмын/.test(first)) opener = 'Обращение к родителю';

  const len = body.length;
  const segmentRule = SEGMENT_RULES.find((r) => r.test.test(name));
  const familyRule = FAMILY_RULES.find((r) => r[1].test(name));
  return {
    id: t.id, name, lang, status: t.status, category: t.category || 'MARKETING',
    segment: segmentRule ? segmentRule.label : SEGMENT_DEFAULT,
    family: familyRule ? familyRule[0] : 'Прочее',
    header: comps.HEADER ? (HEADER_LABELS[comps.HEADER.format] || comps.HEADER.format) : 'Без заголовка',
    opener,
    price: /\d[\d\s.,]*\s?(тг|₸|теңге|тенге)/.test(lower) ? 'Есть цена' : 'Без цены',
    urgency: /дейін|только до|осталось|шектеулі|орын|успей|үлгер|бүгін ғана|до конца|соңғы|последн|тек .{0,20}(күн|апта)/.test(lower) ? 'Есть срок или дефицит' : 'Без срока',
    length: len < 300 ? 'до 300 знаков' : len < 450 ? '300–450 знаков' : len < 600 ? '450–600 знаков' : 'больше 600 знаков',
    emoji: EMOJI.test(body) ? 'С эмодзи' : 'Без эмодзи',
    link: hasLink ? 'Ссылка в тексте' : 'Без ссылки',
    buttons,
    hasLink,
    vars: new Set(body.match(/\{\{[^}]+\}\}/g) || []).size,
    preview: cleanText_(body).replace(/\s+/g, ' ').slice(0, 160),
    text: body,
    headerText: comps.HEADER && comps.HEADER.format === 'TEXT' ? comps.HEADER.text || '' : '',
    footer: (comps.FOOTER && comps.FOOTER.text) || '',
    buttonList: ((comps.BUTTONS && comps.BUTTONS.buttons) || [])
      .map((b) => ({text: normalizeButton_(b.text), type: b.type || ''})).filter((b) => b.text),
  };
}

// Текст, который начинается с = + - @, таблица приняла бы за формулу; апостроф оставляет его текстом.
function asText_(s) {
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function cleanText_(s) {
  return String(s || '').replace(/[*_~]/g, '').trim();
}

function normalizeButton_(s) {
  return String(s || '').replace(/[⁠​﻿]/g, '').trim();
}

function buttonKind_(button) {
  if (button === LINK_BUTTON) return 'Ссылка';
  return NEGATIVE_BUTTON.test(button) ? 'Отказ' : 'Интерес';
}

function templateRow_(t) {
  // Апостроф сохраняет ID текстом: 16-значные числа таблица иначе округляет.
  return [t.name, "'" + t.id, t.lang, t.segment, t.family, t.header, t.opener, t.price, t.urgency, t.length, t.emoji, t.link,
    t.buttons.length, t.buttons.join(' · '), t.vars, t.status, t.preview, t.category,
    asText_(t.text), asText_(t.headerText), asText_(t.footer), JSON.stringify(t.buttonList)];
}


// ===== Строки для таблицы =====

function buildRows_(points, templates) {
  const byId = {};
  for (const t of templates) byId[t.id] = t;
  const dailyRows = [];
  const perDay = {};

  for (const p of points) {
    const t = byId[p.template_id];
    if (!t) continue;
    const day = utcDayKey_(p.start);
    let interest = 0, link = 0, refusal = 0;
    const clicks = {};
    for (const c of p.clicked || []) {
      if (c.type === 'url_button') {
        link += c.count || 0;
        clicks[LINK_BUTTON] = (clicks[LINK_BUTTON] || 0) + (c.count || 0);
      } else if (c.type === 'quick_reply_button') {
        const button = normalizeButton_(c.button_content);
        if (buttonKind_(button) === 'Отказ') refusal += c.count || 0;
        else interest += c.count || 0;
        clicks[button] = (clicks[button] || 0) + (c.count || 0);
      }
    }
    const spentEntry = (p.cost || []).find((c) => c.type === 'amount_spent');
    const spent = (spentEntry && spentEntry.value) || 0;
    const sent = p.sent || 0, delivered = p.delivered || 0, read = p.read || 0;
    if (!(sent || delivered || read || interest || link || refusal || spent)) continue;

    const weekday = (new Date(p.start * 1000).getUTCDay() + 6) % 7;
    dailyRows.push([day, t.name, CHANNEL_LABELS[p.product_type] || p.product_type, t.segment, t.lang, t.family, t.header,
      t.opener, t.price, t.urgency, sent, delivered, read, interest, link, refusal, Math.round(spent * 100) / 100,
      utcDayKey_(p.start - weekday * 86400), WEEKDAYS[weekday]]);

    const key = `${day}|${t.id}`;
    const agg = perDay[key] || (perDay[key] = {day, t, delivered: 0, clicks: {}});
    agg.delivered += delivered;
    for (const b of Object.keys(clicks)) agg.clicks[b] = (agg.clicks[b] || 0) + clicks[b];
  }

  const buttonRows = [];
  for (const key of Object.keys(perDay)) {
    const {day, t, delivered, clicks} = perDay[key];
    if (!delivered && !Object.keys(clicks).length) continue;
    const buttons = new Set(t.buttons);
    if (t.hasLink) buttons.add(LINK_BUTTON);
    for (const b of Object.keys(clicks)) buttons.add(b);
    for (const b of buttons) {
      buttonRows.push([day, t.name, t.segment, t.lang, t.family, b, buttonKind_(b), clicks[b] || 0, delivered]);
    }
  }

  const byDay = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : String(a[1]).localeCompare(String(b[1])));
  return {dailyRows: dailyRows.sort(byDay), buttonRows: buttonRows.sort(byDay)};
}


// ===== Работа с листами =====

function getSheet_(name) {
  const ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function readRows_(name) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getDataRange().getValues().slice(1);
}

function sheetTimeZone_() {
  return SpreadsheetApp.getActive().getSpreadsheetTimeZone();
}

function dayKey_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') return Utilities.formatDate(value, sheetTimeZone_(), 'yyyy-MM-dd');
  return String(value).slice(0, 10);
}

// Полночь этого дня в часовом поясе таблицы, чтобы в ячейке была именно эта дата.
function dayDate_(key) {
  return Utilities.parseDate(key, sheetTimeZone_(), 'yyyy-MM-dd');
}

function utcDayKey_(unixSeconds) {
  return Utilities.formatDate(new Date(unixSeconds * 1000), 'UTC', 'yyyy-MM-dd');
}

function writeSheet_(name, header, rows) {
  const sheet = getSheet_(name);
  sheet.clearContents();
  const values = [header].concat(rows);
  sheet.getRange(1, 1, values.length, header.length).setValues(values);
  sheet.setFrozenRows(1);
  return sheet;
}

// Оставляет строки раньше fromKey, остальные заменяет свежими. dateCols — столбцы с датами.
function replaceFrom_(name, header, newRows, fromKey, dateCols, relabel) {
  const kept = readRows_(name)
    .filter((r) => dayKey_(r[0]) < fromKey)
    .map((r) => relabel(r.map((v, i) => (dateCols.includes(i) ? dayKey_(v) : v))));
  const rows = kept.concat(newRows).map((r) => r.map((v, i) => (dateCols.includes(i) ? dayDate_(v) : v)));
  const sheet = writeSheet_(name, header, rows);
  if (rows.length) {
    for (const i of dateCols) sheet.getRange(2, i + 1, rows.length, 1).setNumberFormat('yyyy-mm-dd');
  }
}

function log_(started, status, message) {
  const sheet = getSheet_(SHEET_LOG);
  if (sheet.getLastRow() === 0) sheet.appendRow(['Время', 'Статус', 'Сообщение', 'Секунд']);
  sheet.appendRow([started, status, message, Math.round((Date.now() - started.getTime()) / 1000)]);
}


// ===== Битрикс24 =====

function connectBitrix() {
  const ui = SpreadsheetApp.getUi();
  const answer = ui.prompt('Подключение Битрикс24',
    'Вставьте адрес входящего вебхука Битрикс24 (права: CRM и Бизнес-процессы). Он выглядит так: https://YOUR_PORTAL.bitrix24.kz/rest/1/код/',
    ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return;
  const match = answer.getResponseText().trim().match(/^https:\/\/[^/\s]+\/rest\/\d+\/[^/\s]+/);
  if (!match) {
    ui.alert('Адрес не похож на вебхук. Он должен начинаться так: https://YOUR_PORTAL.bitrix24.kz/rest/1/код/');
    return;
  }
  const hook = match[0] + '/';
  try {
    bxTemplates_(hook); // проверяем, что вебхук работает и у него есть права на бизнес-процессы
  } catch (e) {
    ui.alert('Не получилось', String((e && e.message) || e), ui.ButtonSet.OK);
    return;
  }
  PropertiesService.getUserProperties().setProperty('BITRIX_WEBHOOK', hook);
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', SpreadsheetApp.getActive().getId());
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === 'updateBitrix') ScriptApp.deleteTrigger(trigger);
  }
  ScriptApp.newTrigger('updateBitrix').timeBased().everyHours(1).create();
  SpreadsheetApp.getActive().toast('Выгружаю рассылки из Битрикса, это займёт 2–3 минуты…', 'Битрикс24', 200);
  // Время ввода адреса тоже входит в 6 минут запуска, поэтому здесь выгружаем меньше; остальное догрузит расписание.
  updateBitrix_(2.5 * 60 * 1000);
  ui.alert('Готово', 'Битрикс подключён. Таблица обновляется сама раз в час. Если первая выгрузка не уместилась в один запуск, ' +
    'остаток догрузится в следующие часы (смотрите лист «Журнал»).', ui.ButtonSet.OK);
}

// Раз в час: новые рассылки, переходы в ОП, свежие стадии и суммы сделок.
function updateBitrix() {
  updateBitrix_(BITRIX_BUDGET_MS);
}

function updateBitrix_(budgetMs) {
  const hook = (PropertiesService.getUserProperties().getProperty('BITRIX_WEBHOOK') || '').trim();
  if (!hook) throw new Error('Битрикс не подключён: меню WhatsApp → «Подключить Битрикс24».');
  // Ручной запуск из меню мог совпасть с запуском по расписанию: второй просто выходит.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  const started = new Date();
  const deadline = started.getTime() + budgetMs;
  try {
    // Переходам в ОП и сделкам оставляем свою долю времени, даже если рассылки ещё догружаются.
    const sends = bxSyncSends_(hook, deadline - budgetMs * 0.4);
    const op = bxSyncOp_(hook, deadline - budgetMs * 0.25);
    const deals = bxSyncDeals_(hook, deadline);
    const done = sends.done && op.done && deals.done;
    if (done) PropertiesService.getScriptProperties().setProperty('BITRIX_UPDATED_AT', started.toISOString());
    if (sends.added || op.added || !done) {
      log_(started, done ? 'битрикс' : 'битрикс: частично', `рассылок +${sends.added}, переходов в ОП +${op.added}, ` +
        `сделок обновлено ${deals.n}${done ? '' : '; остальное — в следующий запуск'}`);
    }
  } catch (e) {
    log_(started, 'битрикс: ошибка', String((e && e.message) || e));
    throw e;
  } finally {
    lock.releaseLock();
  }
}

// Дела «Бизнес-процесс завершён» по сделкам → лист «Битрикс: рассылки». Идём по суткам от места, где остановились.
function bxSyncSends_(hook, deadline) {
  const props = PropertiesService.getScriptProperties();
  const sheet = bxSheet_(SHEET_BX_SENDS, BX_SENDS_HEADER);
  const known = new Set(readRows_(SHEET_BX_SENDS).map((r) => String(r[0])));
  const templates = bxTemplates_(hook);
  const hour = 3600 * 1000;
  // Начинаем на час раньше прошлого конца: дела, записанные с задержкой, не теряются; повторы отсекаются по номеру дела.
  let from = Math.max(new Date(props.getProperty('BITRIX_SENDS_TO') || BITRIX_FROM).getTime() - hour, new Date(BITRIX_FROM).getTime());
  // Конец фиксируем один раз: иначе, догнав «сейчас», цикл бесконечно запрашивал бы окна в несколько миллисекунд.
  const end = Date.now();
  let added = 0;
  while (from < end) {
    if (Date.now() > deadline) return {added, done: false};
    const to = Math.min(from + 24 * hour, end);
    const rows = [];
    for (const a of bxActivities_(hook, from, to)) {
      const s = a.SETTINGS || {};
      const t = templates[s.WORKFLOW_TEMPLATE_ID];
      if (!t || known.has(String(a.ID))) continue; // бизнес-процесс без шаблона — не рассылка
      known.add(String(a.ID));
      rows.push([+a.ID, +a.OWNER_ID, new Date(a.CREATED), +s.WORKFLOW_TEMPLATE_ID, asText_(String(s.WORKFLOW_TEMPLATE_NAME || t.name)), t.template]);
    }
    if (rows.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
      added += rows.length;
    }
    props.setProperty('BITRIX_SENDS_TO', new Date(to).toISOString());
    from = to;
  }
  return {added, done: true};
}

// На больших окнах Битрикс иногда отвечает внутренней ошибкой — тогда окно делится пополам.
function bxActivities_(hook, from, to) {
  try {
    return bxList_(hook, 'crm.activity.list', {
      order: {ID: 'ASC'},
      filter: {PROVIDER_ID: 'CRM_BIZPROC_WORKFLOW', OWNER_TYPE_ID: 2, '>=CREATED': bxTime_(from), '<CREATED': bxTime_(to)},
      select: ['ID', 'OWNER_ID', 'CREATED', 'SETTINGS'],
    });
  } catch (e) {
    if (!e.retryable || to - from <= 10 * 60 * 1000) throw e;
    const mid = from + Math.floor((to - from) / 2);
    return bxActivities_(hook, from, mid).concat(bxActivities_(hook, mid, to));
  }
}

// Переходы сделок в воронку ОП (история стадий, тип 5 — смена воронки) → лист «Битрикс: переходы в ОП».
function bxSyncOp_(hook, deadline) {
  const props = PropertiesService.getScriptProperties();
  const sheet = bxSheet_(SHEET_BX_OP, BX_OP_HEADER);
  let lastId = +(props.getProperty('BITRIX_OP_LAST_ID') || 0);
  let added = 0;
  while (true) {
    if (Date.now() > deadline) return {added, done: false};
    const r = bxCall_(hook, 'crm.stagehistory.list', {
      entityTypeId: 2, order: {ID: 'ASC'},
      filter: {CATEGORY_ID: BITRIX_OP_CATEGORY, TYPE_ID: 5, '>ID': lastId, '>=CREATED_TIME': BITRIX_FROM},
      select: ['ID', 'OWNER_ID', 'CREATED_TIME', 'STAGE_ID'],
    });
    const items = (r.result && r.result.items) || [];
    if (!items.length) return {added, done: true};
    const rows = items.map((h) => [+h.ID, +h.OWNER_ID, new Date(h.CREATED_TIME), h.STAGE_ID]);
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    added += rows.length;
    lastId = +items[items.length - 1].ID;
    props.setProperty('BITRIX_OP_LAST_ID', String(lastId));
  }
}

// Стадия и сумма сделок с рассылкой за последние BITRIX_REFRESH_DAYS дней → лист «Битрикс: сделки».
// Один запрос batch — 50 запросов по 50 сделок.
function bxSyncDeals_(hook, deadline) {
  const since = Date.now() - BITRIX_REFRESH_DAYS * 86400 * 1000;
  const ids = [...new Set(readRows_(SHEET_BX_SENDS).filter((r) => new Date(r[2]).getTime() >= since).map((r) => String(r[1])))];
  const deals = new Map(readRows_(SHEET_BX_DEALS).map((r) => [String(r[0]), r]));
  let n = 0, done = true;
  for (let i = 0; i < ids.length; i += 2500) {
    if (Date.now() > deadline) { done = false; break; }
    const part = ids.slice(i, i + 2500);
    const cmd = {};
    for (let j = 0; j < part.length; j += 50) {
      cmd['d' + j] = 'crm.deal.list?' + bxQuery_({filter: {'@ID': part.slice(j, j + 50)},
        select: ['ID', 'CATEGORY_ID', 'STAGE_ID', 'STAGE_SEMANTIC_ID', 'OPPORTUNITY', BITRIX_DEBT_FIELD], start: -1});
    }
    const r = bxCall_(hook, 'batch', {halt: 0, cmd}).result || {};
    const errors = Object.keys(r.result_error || {});
    if (errors.length) throw new Error(`Битрикс24, сделки: ${JSON.stringify(r.result_error[errors[0]])}`);
    const found = new Set();
    for (const list of Object.values(r.result || {})) {
      for (const d of list || []) {
        found.add(String(d.ID));
        // Денежное поле приходит как «18000|KZT».
        deals.set(String(d.ID), [+d.ID, +d.CATEGORY_ID, d.STAGE_ID, d.STAGE_SEMANTIC_ID === 'S' ? 1 : 0, +d.OPPORTUNITY || 0,
          parseFloat(d[BITRIX_DEBT_FIELD]) || 0]);
      }
    }
    for (const id of part) if (!found.has(id)) deals.delete(id); // сделку удалили в Битриксе
    n += found.size;
  }
  writeSheet_(SHEET_BX_DEALS, BX_DEALS_HEADER, [...deals.values()]);
  return {n, done};
}

// Номер бизнес-процесса → имя шаблона Meta из его действия Wazzup. Бизнес-процессы без шаблона в список не попадают.
function bxTemplates_(hook) {
  const map = {};
  for (const t of bxList_(hook, 'bizproc.workflow.template.list', {select: ['ID', 'NAME', 'TEMPLATE']})) {
    const m = JSON.stringify(t.TEMPLATE || '').match(/template\\*"\s*:\s*\{\\*"name\\*"\s*:\s*\\*"([a-z0-9_]+)/);
    if (m) map[t.ID] = {name: String(t.NAME || ''), template: m[1]};
  }
  return map;
}

function bxList_(hook, method, params) {
  const out = [];
  for (let start = 0; ;) {
    const r = bxCall_(hook, method, Object.assign({}, params, {start}));
    out.push(...(r.result || []));
    if (r.next == null) return out;
    start = r.next;
  }
}

function bxCall_(hook, method, params) {
  for (let attempt = 1; ; attempt++) {
    const response = UrlFetchApp.fetch(hook + method + '.json', {
      method: 'post', contentType: 'application/x-www-form-urlencoded', payload: bxQuery_(params), muteHttpExceptions: true,
    });
    const code = response.getResponseCode();
    let body = null;
    try {
      body = JSON.parse(response.getContentText());
    } catch (e) {
      body = null;
    }
    if (body && !body.error && code === 200) return body;
    // Под нагрузкой Битрикс иногда отвечает внутренней ошибкой или просит реже обращаться — пробуем ещё раз.
    const retryable = !body || code >= 500 || /INTERNAL_SERVER_ERROR|QUERY_LIMIT_EXCEEDED|OPERATION_TIME_LIMIT/.test(body.error);
    if (retryable && attempt < 4) {
      Utilities.sleep(1500 * attempt);
      continue;
    }
    const reason = body ? `${body.error}${body.error_description ? ': ' + body.error_description : ''}` : `код ${code}`;
    const hint = body && /insufficient_scope|INVALID_CREDENTIALS|NO_AUTH_FOUND|ACCESS_DENIED/i.test(body.error)
      ? ' Проверьте адрес вебхука и его права (CRM, Бизнес-процессы).' : '';
    const err = new Error(`Битрикс24, ${method}: ${reason}.${hint}`);
    err.retryable = retryable;
    throw err;
  }
}

// Параметры в виде filter[>=CREATED]=… — так их понимает REST Битрикса.
function bxQuery_(params, prefix) {
  return Object.keys(params || {}).map((k) => {
    const key = prefix ? `${prefix}[${k}]` : k;
    const v = params[k];
    return v !== null && typeof v === 'object' ? bxQuery_(v, key) : `${encodeURIComponent(key)}=${encodeURIComponent(v)}`;
  }).filter(Boolean).join('&');
}

function bxTime_(ms) {
  return Utilities.formatDate(new Date(ms), 'UTC', "yyyy-MM-dd'T'HH:mm:ss'+00:00'");
}

function bxSheet_(name, header) {
  const sheet = getSheet_(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(header);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Лиды и продажи по шаблону и дню рассылки. Строгие правила (проверка 04.11.2026), те же, что для amoCRM:
//  - сделка в стадии «Ошибка отправки» рассылку не получила;
//  - шаблон засчитан, если по статистике Meta номер 1100 отправил его не меньше чем 80% дошедших сделок
//    (BX_COVERAGE_MIN); шаблоны, чьи отправки Meta ещё не догрузила (последние 2 дня), считаются условно;
//  - лид — переход в ОП не позже 7 дней (BX_LEAD_WINDOW_DAYS) после засчитанной рассылки, засчитывается
//    последней такой рассылке перед переходом; продажа — только у такого лида.
const BX_COVERAGE_MIN = 0.8;
const BX_LEAD_WINDOW_DAYS = 7;
const BX_ERROR_STAGE = 'C0:UC_SEND_ERROR'; // «Ошибка отправки» в воронке «Копирайтер рассылка»
function crmSummary_(ss) {
  const rowsOf = (name) => {
    const sheet = ss.getSheetByName(name);
    return sheet && sheet.getLastRow() > 1 ? sheet.getDataRange().getValues().slice(1) : [];
  };
  const sends = rowsOf(SHEET_BX_SENDS);
  if (!sends.length) return null;
  const time = (v) => new Date(v).getTime();
  const group = (rows, value) => {
    const out = new Map();
    for (const r of rows) {
      const k = String(r[1]);
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(value(r));
    }
    return out;
  };
  const sendsBy = group(sends, (r) => ({t: time(r[2]), template: String(r[5]), base: String(r[4])}));
  const opBy = group(rowsOf(SHEET_BX_OP), (r) => time(r[2]));
  const deals = new Map(rowsOf(SHEET_BX_DEALS).map((r) => [String(r[0]), r]));
  const failedDeal = (deal) => {
    const d = deals.get(deal);
    return Boolean(d && String(d[2]) === BX_ERROR_STAGE);
  };
  // Покрытие шаблона по статистике Meta (лист «Статистика по дням»: Дата, Шаблон, …, Отправлено в 11-м столбце).
  const fromDay = dayKey_(new Date(BITRIX_FROM));
  const metaSent = {};
  let metaLast = '';
  for (const r of rowsOf(SHEET_DAILY)) {
    const day = dayKey_(r[0]);
    if (day > metaLast) metaLast = day;
    if (day >= fromDay) metaSent[r[1]] = (metaSent[r[1]] || 0) + (+r[10] || 0);
  }
  const bxSent = {}, bxLast = {};
  for (const [deal, list] of sendsBy) {
    if (failedDeal(deal)) continue;
    for (const s of list) {
      bxSent[s.template] = (bxSent[s.template] || 0) + 1;
      const day = dayKey_(new Date(s.t));
      if (!bxLast[s.template] || day > bxLast[s.template]) bxLast[s.template] = day;
    }
  }
  const checkUntil = metaLast ? Utilities.formatDate(new Date(dayDate_(metaLast).getTime() - 2 * 86400 * 1000), sheetTimeZone_(), 'yyyy-MM-dd') : '';
  const coverage = {}, pending = {};
  for (const t of Object.keys(bxSent)) {
    coverage[t] = (metaSent[t] || 0) / bxSent[t];
    pending[t] = !metaLast || bxLast[t] > checkUntil; // Meta ещё не догрузила эти дни — проверим позже
  }
  const confirmed = (t) => pending[t] || coverage[t] >= BX_COVERAGE_MIN;

  // Базы (рассылки-бизнес-процессы) для вкладки «Базы»: когда ушла, какие шаблоны, сколько лидов и продаж.
  const bases = new Map();
  const baseOf = (name) => {
    if (!bases.has(name)) {
      bases.set(name, {base: name, source: 'Битрикс24', templates: {}, from: '9999', to: '0000',
        entered: 0, failed: 0, unconfirmed: 0, sends: 0, leads: 0, deals: 0, revenue: 0, paid: 0});
    }
    return bases.get(name);
  };
  for (const [deal, list] of sendsBy) {
    const failed = failedDeal(deal);
    for (const s of list) {
      const b = baseOf(s.base), day = dayKey_(new Date(s.t));
      b.entered++;
      if (day < b.from) b.from = day;
      if (day > b.to) b.to = day;
      if (failed) { b.failed++; continue; }
      if (!confirmed(s.template)) { b.unconfirmed++; continue; }
      b.sends++;
      b.templates[s.template] = (b.templates[s.template] || 0) + 1;
    }
  }
  const acc = new Map();
  const windowMs = BX_LEAD_WINDOW_DAYS * 86400 * 1000;
  for (const [deal, list] of sendsBy) {
    if (failedDeal(deal)) continue;
    const valid = list.filter((s) => confirmed(s.template)).sort((a, b) => a.t - b.t);
    if (!valid.length) continue;
    let lead = null, send = null;
    for (const t of (opBy.get(deal) || []).filter((x) => x > valid[0].t).sort((a, b) => a - b)) {
      const before = valid.filter((s) => s.t < t).pop();
      if (before && t - before.t <= windowMs) { lead = t; send = before; break; }
    }
    if (!lead) continue;
    const d = deals.get(deal);
    const sale = Boolean(d && +d[3] === 1);
    const key = `${dayKey_(new Date(send.t))}|${send.template}`;
    if (!acc.has(key)) acc.set(key, {leads: 0, deals: 0, revenue: 0, paid: 0});
    const a = acc.get(key), b = baseOf(send.base);
    a.leads++; b.leads++;
    if (sale) {
      const paid = +d[4] || 0, revenue = paid + (+d[5] || 0);
      a.deals++; a.paid += paid; a.revenue += revenue;
      b.deals++; b.paid += paid; b.revenue += revenue;
    }
  }
  return {
    enabled: true, source: 'bitrix', currency: 'KZT',
    from: dayKey_(new Date(BITRIX_FROM)), // раньше этого дня лидов и продаж нет: расходы для сравнения берутся с него
    updatedAt: PropertiesService.getScriptProperties().getProperty('BITRIX_UPDATED_AT'),
    rows: {
      columns: ['day', 'template', 'leads', 'deals', 'revenue', 'paid'],
      rows: [...acc].map(([k, a]) => k.split('|').concat([a.leads, a.deals, Math.round(a.revenue), Math.round(a.paid)])),
    },
    rules: {coverageMin: BX_COVERAGE_MIN, leadWindowDays: BX_LEAD_WINDOW_DAYS, metaLast},
    confirmedTemplates: Object.keys(bxSent).filter((t) => confirmed(t)),
    unconfirmedTemplates: Object.keys(bxSent).filter((t) => !confirmed(t)),
    bases: [...bases.values()].map((b) => Object.assign(b, {
      revenue: Math.round(b.revenue), paid: Math.round(b.paid),
      templates: Object.keys(b.templates).sort((x, y) => b.templates[y] - b.templates[x])
        .map((name) => ({name, n: b.templates[name], coverage: Math.round((coverage[name] || 0) * 100) / 100, pending: Boolean(pending[name])})),
    })),
  };
}


// ===== Данные для сайта =====

// Сайт на Vercel запрашивает эту ссылку с ключом и получает все данные одним JSON.
function doGet(e) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('API_KEY');
  if (!key || !e || !e.parameter || e.parameter.key !== key) return json_({error: 'unauthorized'});

  const ss = SpreadsheetApp.getActive() || SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID'));
  // Только заметки — сайт перечитывает их после сохранения, без всей статистики.
  if (e.parameter.part === 'notes') return json_({notes: notes_(ss)});
  const log = ss.getSheetByName(SHEET_LOG);
  const logRows = log && log.getLastRow() > 1 ? log.getDataRange().getValues().slice(1) : [];
  const lastOk = logRows.filter((r) => r[1] === 'ок').pop();
  return json_({
    updatedAt: lastOk ? new Date(lastOk[0]).toISOString() : null,
    phone: phoneStatus_(ss),
    templates: sheetTable_(ss, SHEET_TEMPLATES, {
      name: 'Шаблон', id: 'ID', lang: 'Язык', segment: 'Тип', family: 'Тема', header: 'Заголовок', opener: 'Первая_строка',
      price: 'Цена', urgency: 'Срок', length: 'Длина', emoji: 'Эмодзи', link: 'Ссылка_в_тексте', buttons_n: 'Кнопок',
      buttons: 'Кнопки', vars: 'Переменные', status: 'Статус', preview: 'Начало_текста', category: 'Категория',
      text: 'Текст', header_text: 'Заголовок_текст', footer: 'Подпись', buttons_json: 'Кнопки_JSON',
    }),
    daily: sheetTable_(ss, SHEET_DAILY, {
      day: 'Дата', name: 'Шаблон', segment: 'Тип', lang: 'Язык', sent: 'Отправлено', delivered: 'Доставлено', read: 'Прочитано',
      interest: 'Интерес', link: 'Ссылка', refusal: 'Отказ', spent: 'Расходы',
    }),
    buttons: sheetTable_(ss, SHEET_BUTTONS, {
      day: 'Дата', name: 'Шаблон', segment: 'Тип', lang: 'Язык', button: 'Кнопка', kind: 'Вид', clicks: 'Нажатия', delivered: 'Доставлено_шаблона',
    }),
    crm: crmSummary_(ss),
    notes: notes_(ss),
  });
}

// Сайт сохраняет заметку к базе: POST {key, action: 'note', base, note}. Пустая заметка удаляет строку.
function doPost(e) {
  const props = PropertiesService.getScriptProperties();
  let body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({error: 'bad json'});
  }
  const key = props.getProperty('API_KEY');
  if (!key || body.key !== key) return json_({error: 'unauthorized'});
  if (body.action !== 'note') return json_({error: 'unknown action'});
  const base = String(body.base || '').trim().slice(0, 200);
  const note = String(body.note || '').trim().slice(0, 2000);
  if (!base) return json_({error: 'no base'});
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActive() || SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID'));
    const sheet = ss.getSheetByName(SHEET_NOTES) || ss.insertSheet(SHEET_NOTES);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(NOTES_HEADER);
      sheet.setFrozenRows(1);
    }
    const names = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().map((r) => String(r[0])) : [];
    const i = names.indexOf(base);
    if (!note) {
      if (i >= 0) sheet.deleteRow(i + 2);
    } else if (i >= 0) {
      sheet.getRange(i + 2, 2, 1, 2).setValues([[asText_(note), new Date()]]);
    } else {
      sheet.appendRow([asText_(base), asText_(note), new Date()]);
    }
  } finally {
    lock.releaseLock();
  }
  return json_({ok: true, notes: notes_(SpreadsheetApp.getActive() || SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID')))});
}

// Заметки к базам: {база: {note, updatedAt}}.
function notes_(ss) {
  const sheet = ss.getSheetByName(SHEET_NOTES);
  if (!sheet || sheet.getLastRow() < 2) return {};
  const out = {};
  for (const r of sheet.getDataRange().getValues().slice(1)) {
    if (r[0] && r[1]) out[String(r[0])] = {note: String(r[1]), updatedAt: r[2] ? new Date(r[2]).toISOString() : null};
  }
  return out;
}

// Последняя проверка номера и с какого дня держится нынешнее качество.
function phoneStatus_(ss) {
  const sheet = ss.getSheetByName(SHEET_PHONE);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const rows = sheet.getDataRange().getValues().slice(1);
  const last = rows[rows.length - 1];
  let since = last[0];
  for (let i = rows.length - 2; i >= 0 && rows[i][2] === last[2]; i--) since = rows[i][0];
  const prev = rows.slice(0, -1).reverse().find((r) => r[2] !== last[2]);
  return {
    checkedAt: new Date(last[0]).toISOString(), number: last[1], quality: last[2], limit: last[3], status: last[4],
    canSend: last[5], qualitySince: dayKey_(since), prevQuality: prev ? prev[2] : null,
  };
}

// Столбцы листа по названиям в шапке; даты — строками yyyy-MM-dd.
function sheetTable_(ss, name, fields) {
  const sheet = ss.getSheetByName(name);
  const columns = Object.keys(fields);
  if (!sheet || sheet.getLastRow() < 2) return {columns, rows: []};
  const values = sheet.getDataRange().getValues();
  const header = values[0].map(String);
  const idx = columns.map((k) => header.indexOf(fields[k]));
  const rows = values.slice(1).map((r) => idx.map((i) => {
    const v = i < 0 ? null : r[i];
    return Object.prototype.toString.call(v) === '[object Date]' ? dayKey_(v) : v;
  }));
  return {columns, rows};
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// Показывает ключ и ссылку, которые нужно вписать в настройки сайта на Vercel.
function siteLink() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID', SpreadsheetApp.getActive().getId());
  removeOldDashboard_();
  let key = props.getProperty('API_KEY');
  if (!key) {
    key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('API_KEY', key);
  }
  // Рабочая ссылка веб-приложения заканчивается на /exec; /dev открывается только редакторам скрипта.
  const url = ScriptApp.getService().getUrl() || '';
  const html = HtmlService.createHtmlOutput(
    '<div style="font:14px Arial,sans-serif;line-height:1.5">' +
    '<p><b>SHEET_API_URL</b><br>' + (/\/exec$/.test(url)
      ? '<input style="width:100%" readonly onclick="this.select()" value="' + url + '">'
      : '<span style="color:#c62828">Скопируйте ссылку из Apps Script: «Начать развертывание» → «Управление развертываниями» → ' +
        '«URL веб-приложения» (заканчивается на /exec). Если развертывания ещё нет: «Новое развертывание» → тип «Веб-приложение», ' +
        'запуск от имени «Я», доступ «Все».</span>') + '</p>' +
    '<p><b>SHEET_API_KEY</b><br><input style="width:100%" readonly onclick="this.select()" value="' + key + '"></p>' +
    '<p style="color:#555">Впишите оба значения в Vercel: Project → Settings → Environment Variables. ' +
    'Ключ никому не пересылайте: по нему можно получить всю статистику шаблонов.</p></div>'
  ).setWidth(520).setHeight(300);
  ui.showModalDialog(html, 'Ссылка для сайта');
}

// Листы «Дашборд» и «Расчёты» от прошлой версии скрипта больше не нужны.
function removeOldDashboard_() {
  const ss = SpreadsheetApp.getActive();
  for (const name of [SHEET_DASHBOARD, SHEET_CALC]) {
    const sheet = ss.getSheetByName(name);
    if (sheet && ss.getSheets().length > 1) ss.deleteSheet(sheet);
  }
}
