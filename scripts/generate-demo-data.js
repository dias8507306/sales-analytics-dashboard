#!/usr/bin/env node
// Demo data generator: random but plausible WhatsApp template statistics, button clicks,
// CRM leads/sales (amoCRM history + Bitrix24) and mailing "bases" — in exactly the schema that
// the Google Apps Script (apps-script/Code.gs → doGet) and tools/amo/amo_build.js produce.
//
//   node scripts/generate-demo-data.js                 # 100 days ending today, random seed
//   node scripts/generate-demo-data.js --seed 42 --days 100 --end 2026-11-07
//
// Writes:
//   web/api/sample-data.json  — what the Google Sheet web app returns (templates, daily, buttons, phone, crm, notes)
//   web/api/amo-history.json  — one-off amoCRM history (rows day × template, bases)
//
// Every template text, name, number and amount here is made up. Brand: "EduApp Online".
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const arg = (name, def) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : def);
const SEED = Number(arg('seed', Math.floor(Math.random() * 1e9)));
const DAYS = Number(arg('days', 100));
const END = arg('end', new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10)); // Kazakhstan, UTC+5
const OUT_DIR = path.join(__dirname, '..', 'web', 'api');

// ---------- random helpers (seeded, reproducible) ----------
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const uni = (a, b) => a + (b - a) * rnd();
const int = (a, b) => Math.floor(uni(a, b + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const binom = (n, p) => {
  if (n <= 0 || p <= 0) return 0;
  if (n > 60) return Math.max(0, Math.min(n, Math.round(n * p + gauss() * Math.sqrt(n * p * (1 - p)))));
  let k = 0; for (let i = 0; i < n; i++) if (rnd() < p) k++; return k;
};

// ---------- dates ----------
const toDate = (s) => new Date(`${s}T00:00:00Z`);
const addDays = (s, n) => new Date(toDate(s).getTime() + n * 864e5).toISOString().slice(0, 10);
const weekday = (s) => (toDate(s).getUTCDay() + 6) % 7; // 0 = Mon
const START = addDays(END, -(DAYS - 1));
const DAY_LIST = Array.from({length: DAYS}, (_, i) => addDays(START, i));
const AMO_TO = addDays(END, -19);          // amoCRM history until this day…
const BITRIX_FROM = addDays(AMO_TO, 1);    // …then Bitrix24

// ---------- the same template classification rules as apps-script/Code.gs ----------
const SEGMENT_RULES = [
  {label: 'Массовые рассылки', test: /skidka|rus_1100_rassylka|eksp_1100|gibrid_1100/},
  {label: 'Воронка после звонка', test: /posle_z|nedozvon|ne_dozvon|chto_reshili|somnenie|koshtasu|as_proverka|oshibka|tirkelu|insta|eduapp_app|pdf|dokument|_1100_1$|1100_kaz|1100_rus|as_povt_kasanie/},
  {label: 'База «Алтын Сақа»', test: /(^|_)as(_|$)|altyn_saka/},
];
const FAMILY_RULES = [
  ['После звонка', /chto_reshili|nedozvon|ne_dozvon|posle_z|koshtasu|somnenie|as_proverka|as_povt|oshibka|tirkelu|eduapp_app|insta|pdf/],
  ['Алтын Сақа: поздравление', /^(as_|altyn_saka|elit_baza_as|pu_as_)/],
  ['Английский', /^angl/],
  ['Пробный урок / диагностика', /probnyy|diagnost/],
  ['Олимпиадные курсы', /olimp|7_8_9|7_9/],
  ['Скидки', /skidka|sikdka|zhenildik|pp_/],
  ['НИШ / БИЛ / элит', /nish|elit|bil/],
  ['Общие рассылки по базе', /rassylka|povt|baza|zakryt|vebinar|matem|eksp|kitap/],
];
const NEGATIVE_BUTTON = /емес|беспокоить|не надо|келмейді|отпис/i;
const LINK_BUTTON = 'Ссылка в тексте';
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2705}]/u;

function describe(t) {
  const lines = t.text.split('\n').map((s) => s.replace(/[*_~]/g, '').trim()).filter(Boolean);
  const first = (lines[0] || '').toLowerCase();
  const lower = t.text.toLowerCase();
  let opener = 'Описание курса';
  if (/құттықта|поздрав|прош[её]л|өтіп|өткен|дәлелдеді/.test(first)) opener = 'Новость о ребёнке';
  else if (/тг|₸|теңге|тенге|жеңілдік|скидк|%|тегін|бесплатн|акци/.test(first)) opener = 'Цена или скидка';
  else if (first.includes('?')) opener = 'Вопрос';
  else if (/құрметті|уважаем|сәлем|здравств|добрый|қайырлы|извиня/.test(first)) opener = 'Обращение к родителю';
  const len = t.text.length;
  const seg = SEGMENT_RULES.find((r) => r.test.test(t.name));
  const fam = FAMILY_RULES.find((r) => r[1].test(t.name));
  const hasLink = /https?:\/\/|www\.|\.kz\b|wa\.me/.test(lower);
  return Object.assign({}, t, {
    segment: seg ? seg.label : 'Массовые рассылки',
    family: fam ? fam[0] : 'Прочее',
    opener,
    price: /\d[\d\s.,]*\s?(тг|₸|теңге|тенге)/.test(lower) ? 'Есть цена' : 'Без цены',
    urgency: /дейін|только до|осталось|шектеулі|орын|успей|бүгін ғана|до конца|соңғы|последн/.test(lower) ? 'Есть срок или дефицит' : 'Без срока',
    length: len < 300 ? 'до 300 знаков' : len < 450 ? '300–450 знаков' : len < 600 ? '450–600 знаков' : 'больше 600 знаков',
    emoji: EMOJI.test(t.text) ? 'С эмодзи' : 'Без эмодзи',
    link: hasLink ? 'Ссылка в тексте' : 'Без ссылки',
    hasLink,
    preview: t.text.replace(/[*_~]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160),
  });
}

// ---------- templates (all texts are invented) ----------
// kind: 'call' — sent every day after a sales call; 'mass' — sent in bursts to a base.
// base: CRM stage / mailing base name for mass templates.
const SITE = 'https://eduapp.example.com';
const T = [
  {name: 'posle_zvonka_kaz_1', lang: 'KZ', kind: 'call', header: 'Без заголовка', win: [0, 1],
    text: 'Сәлеметсіз бе! EduApp Online-ға қоңырау шалғаныңызға рахмет 😊\nМенеджеріміз айтқан курс туралы толық ақпаратты осында жібереміз. Сұрақтарыңыз болса, төмендегі батырманы басыңыз.',
    buttons: ['Толық ақпарат керек', 'Сұрақтарым бар', 'Қажет емес']},
  {name: 'posle_zvonka_rus_1', lang: 'RU', kind: 'call', header: 'Без заголовка', win: [0, 1],
    text: 'Здравствуйте! Спасибо за разговор с EduApp Online 😊\nОтправляем подробности о курсе, который вы обсуждали с менеджером. Остались вопросы — нажмите кнопку ниже, и мы ответим в течение часа.',
    buttons: ['Подробнее о курсе', 'Есть вопросы', 'Не беспокоить']},
  {name: 'nedozvon_kaz_1', lang: 'KZ', kind: 'call', header: 'Без заголовка', win: [0, 0.55],
    text: 'Сәлеметсіз бе! Сізге қоңырау шала алмадық 🙏\nБалаңыздың оқуы туралы сұрағыңызға жауап беру үшін өзіңізге ыңғайлы уақытты таңдаңыз.',
    buttons: ['Қазір хабарласыңыз', 'Кешке хабарласыңыз', 'Қажет емес']},
  {name: 'nedozvon_kaz_2', lang: 'KZ', kind: 'call', header: 'Текст', headerText: 'Қоңырау шала алмадық', win: [0.55, 1],
    text: 'Балаңызға қай сабақ қиын: математика ма, әлде ағылшын тілі ме?\nЖауабыңызды батырмамен белгілеңіз — мұғалім сізге дәл сол пән бойынша кеңес береді.',
    buttons: ['Математика', 'Ағылшын тілі', 'Қажет емес']},
  {name: 'nedozvon_rus_1', lang: 'RU', kind: 'call', header: 'Без заголовка', win: [0, 1],
    text: 'Здравствуйте! Мы не смогли до вас дозвониться 🙏\nПодскажите, когда вам удобно поговорить о занятиях для ребёнка?',
    buttons: ['Позвоните сейчас', 'Позвоните вечером', 'Не надо']},
  {name: 'chto_reshili_kaz_1', lang: 'KZ', kind: 'call', header: 'Без заголовка', win: [0, 1],
    text: 'Не шештіңіз? 🤔\nКеше курс туралы сөйлестік. Балаңызға тегін сынақ сабақты бүгін-ақ ұйымдастыра аламыз — тек бір батырманы басыңыз.',
    buttons: ['Сынақ сабаққа жазылу', 'Тағы ойланамын', 'Қажет емес']},
  {name: 'somnenie_rus_1', lang: 'RU', kind: 'call', header: 'Видео', win: [0.3, 1],
    text: `Сомневаетесь, подойдёт ли курс? Это нормально.\nПосмотрите отзывы родителей и результаты учеников за прошлый год: ${SITE}/results\nЕсли останутся вопросы — менеджер ответит в течение часа.`,
    buttons: ['Хочу пробный урок', 'Не надо']},
  {name: 'tirkelu_anketasy_kaz_1', lang: 'KZ', kind: 'call', header: 'Без заголовка', category: 'UTILITY', win: [0, 1],
    text: `Құрметті ата-ана!\nТіркелуді аяқтау үшін қысқа анкетаны толтырыңыз: ${SITE}/form\nАнкета 2 минут алады.`, buttons: []},

  {name: 'nish_bil_kurs_kaz_1', lang: 'KZ', kind: 'mass', header: 'Текст', headerText: 'НИШ · БИЛ · РФМШ', base: 'НИШ БАЗА', win: [0, 0.6],
    text: `*НИШ, БИЛ, РФМШ* мектептеріне дайындық басталды! 🎯\nEduApp Online-да сабақ аптасына 3 рет, тәжірибелі мұғалімдермен онлайн өтеді. Әр айдың соңында сынақ тест және ата-анаға есеп беріледі.\nТолығырақ: ${SITE}/nish`,
    buttons: ['Толық ақпарат керек', 'Бағасы қанша?', 'Қажет емес']},
  {name: 'nish_bil_kurs_rus_1', lang: 'RU', kind: 'mass', header: 'Текст', headerText: 'НИШ · БИЛ · РФМШ', base: 'НИШ БАЗА ОРЫСША', win: [0, 0.6],
    text: `Началась подготовка к поступлению в *НИШ, БИЛ и РФМШ* 🎯\nЗанятия 3 раза в неделю онлайн с опытными учителями. В конце каждого месяца — пробный тест и отчёт для родителей.\nПодробнее: ${SITE}/nish`,
    buttons: ['Подробнее', 'Сколько стоит?', 'Не беспокоить']},
  {name: 'nish_grant_kaz_1', lang: 'KZ', kind: 'mass', header: 'Картинка', base: 'НИШ ГРАНТ', win: [0.3, 1],
    text: 'Грант — кездейсоқтық емес.\nӨткен оқу жылында EduApp оқушыларының 120-дан астамы НЗМ мен БИЛ-ге грантпен түсті. Келесі кезек — сіздің балаңыз ✨\nЖаңа топқа тек 15 орын қалды.',
    buttons: ['Іріктеуге жазылу', 'Толық ақпарат керек', 'Қажет емес']},
  {name: 'nish_elit_top_1', lang: 'KZ', kind: 'mass', header: 'Текст', headerText: 'ТЕК 12 ОРЫН', base: 'ЭЛИТ ТОП', win: [0.45, 1],
    text: 'Балаңыз «Алтын сақа» олимпиадасының облыстық кезеңіне қатысты ма? 🏆\n«НИШ ЭЛИТ» тобына іріктеу басталды: тек 12 орын. Іріктеу тесті тегін, айдың соңына дейін өтеді.',
    buttons: ['Іріктеуге жазылу', 'Толық ақпарат керек', 'Қажет емес']},
  {name: 'olimp_7_8_9_kaz_1', lang: 'KZ', kind: 'mass', header: 'Текст', headerText: 'Олимпиадалық математика', base: '7-8-9 СЫНЫП', win: [0, 0.7],
    text: '7–9 сынып оқушыларына олимпиадалық математика курсы 📐\nАптасына 2 сабақ, үй тапсырмасын мұғалім тексереді, әр тоқсан сайын облыстық олимпиадаға дейінгі сынақ тур.\nАлғашқы сабақ — тегін.',
    buttons: ['Толық ақпарат керек', 'Кесте қандай?', 'Қажет емес']},
  {name: 'olimp_7_8_9_rus_1', lang: 'RU', kind: 'mass', header: 'Текст', headerText: 'Олимпиадная математика', base: '7-8-9 КЛАСС ОРЫСША', win: [0, 0.7],
    text: 'Курс олимпиадной математики для 7–9 классов 📐\n2 занятия в неделю, домашние задания проверяет учитель, раз в четверть — пробный тур перед областной олимпиадой.\nПервое занятие бесплатно.',
    buttons: ['Подробнее', 'Какое расписание?', 'Не надо']},
  {name: 'altyn_saka_kuttyktau_1', lang: 'KZ', kind: 'mass', header: 'Картинка', base: 'АЛТЫН САҚА ҚАТЫСУШЫЛАРЫ', win: [0.15, 0.9],
    text: 'Құттықтаймыз! 🎉\nБалаңыз «Алтын сақа» олимпиадасының келесі кезеңіне өтті. Бұл — үлкен жетістік! Келесі кезеңге дайындалуға EduApp Online мұғалімдері көмектеседі: өткен жылдардың тапсырмалары және онлайн сынақ турлар.',
    buttons: ['Дайындық туралы білу', 'Рахмет, қажет емес']},
  {name: 'as_kuttyktau_rus_1', lang: 'RU', kind: 'mass', header: 'Картинка', base: 'АЛТЫН САҚА РУС', win: [0.15, 0.9],
    text: 'Поздравляем! 🎉\nВаш ребёнок прошёл в следующий этап олимпиады «Алтын сақа». Поможем подготовиться к следующему туру: разбор заданий прошлых лет и пробные туры онлайн.',
    buttons: ['Узнать о подготовке', 'Не надо']},
  {name: 'as_baza_nish_1', lang: 'KZ', kind: 'mass', header: 'Текст', headerText: 'Арнайы ұсыныс', base: 'АС БАЗА НИШ', win: [0.2, 1],
    text: 'Сәлеметсіз бе! «Алтын сақа» қатысушыларына арнайы ұсыныс:\nНИШ-ке дайындық курсына 20% жеңілдік айдың соңына дейін жарамды. Сабақтар онлайн, топта 10 оқушыдан аспайды.',
    buttons: ['Жеңілдікпен жазылу', 'Толық ақпарат керек', 'Қажет емес']},
  {name: 'angl_speaking_club_1', lang: 'KZ', kind: 'mass', header: 'Видео', base: 'АНГЛ КУРС', win: [0.1, 0.8], unconfirmed: true,
    text: 'Балаңыз ағылшынша еркін сөйлей ме? 🇬🇧\nSpeaking club: аптасына 2 рет, 6 адамдық топ, сабақтар тек ағылшын тілінде.',
    buttons: ['Толық ақпарат керек', 'Бағасы қанша?', 'Қажет емес']},
  {name: 'angl_kurs_rus_1', lang: 'RU', kind: 'mass', header: 'Текст', headerText: 'Английский онлайн', base: 'АНГЛ КУРС ОРЫСША', win: [0, 1],
    text: 'Английский для 5–11 классов онлайн.\nНебольшие группы, домашние задания с проверкой, отчёт родителям каждый месяц. Стоимость — от 24 900 тг в месяц.',
    buttons: ['Записаться на пробный', 'Подробнее', 'Не беспокоить']},
  {name: 'skidka_oktyabr_kaz_1', lang: 'KZ', kind: 'mass', header: 'Картинка', base: 'ЖЕҢІЛДІК БАЗАСЫ', win: [0.6, 1],
    text: 'Тек осы аптада — 30% жеңілдік! 🔥\nEduApp Online-ның барлық курстарына 30% жеңілдік апта соңына дейін жарамды. Орын саны шектеулі.',
    buttons: ['Жеңілдікпен жазылу', 'Толық ақпарат керек', 'Қажет емес']},
  {name: 'skidka_rus_oktyabr_1', lang: 'RU', kind: 'mass', header: 'Картинка', base: 'СКИДКА РУС', win: [0.6, 1],
    text: 'Скидка 30% до конца недели 🔥\nВсе онлайн-курсы EduApp Online: 3 месяца обучения за 59 900 тг вместо 85 500 тг. Количество мест ограничено.',
    buttons: ['Хочу скидку', 'Подробнее', 'Не беспокоить']},
  {name: 'probnyy_urok_kaz_1', lang: 'KZ', kind: 'mass', header: 'Текст', headerText: 'Тегін сынақ сабақ', base: 'ПРОБНЫЙ САБАҚ', win: [0, 1],
    text: 'Тегін сынақ сабаққа шақырамыз!\nБалаңыздың деңгейін анықтап, жеке оқу жоспарын құрамыз. Сабақ 40 минут, онлайн, өзіңізге ыңғайлы уақытта.',
    buttons: ['Сабаққа жазылу', 'Толық ақпарат керек', 'Қажет емес']},
  {name: 'probnyy_urok_rus_1', lang: 'RU', kind: 'mass', header: 'Текст', headerText: 'Бесплатный пробный урок', base: 'ПРОБНЫЙ УРОК ОРЫСША', win: [0, 1],
    text: 'Приглашаем на бесплатный пробный урок\nОпределим уровень ребёнка и составим план занятий. 40 минут онлайн, в удобное для вас время.',
    buttons: ['Записаться', 'Подробнее', 'Не надо']},
  {name: 'kaz_rassylka_zhalpy_2', lang: 'KZ', kind: 'mass', header: 'Текст', headerText: 'Жаңа тоқсан', base: 'КАЗ ЖАЛПЫ РАССЫЛКА', win: [0, 1],
    text: 'Жаңа оқу тоқсаны — жаңа мүмкіндіктер 📚\nEduApp Online: математика, ағылшын тілі, НИШ-ке дайындық. Сабақ кестесі ыңғайлы, барлық сабақ жазылып қалады, ата-анаға ай сайын есеп.',
    buttons: ['Толық ақпарат керек', 'Бағасы қанша?', 'Қажет емес']},
  {name: 'rus_rassylka_obshaya_2', lang: 'RU', kind: 'mass', header: 'Текст', headerText: 'Новая четверть', base: 'РУС ЖАЛПЫ РАССЫЛКА', win: [0, 1],
    text: `Новая четверть — новые возможности 📚\nEduApp Online: математика, английский, подготовка в НИШ. Удобное расписание, записи всех уроков в личном кабинете.\nПодробнее: ${SITE}`,
    buttons: ['Подробнее', 'Сколько стоит?', 'Не беспокоить']},
  {name: 'povt_kasanie_kaz_2', lang: 'KZ', kind: 'mass', header: 'Без заголовка', base: 'ПОВТОРНАЯ БАЗА', win: [0.25, 1],
    text: 'Сәлеметсіз бе! Біз сізге бір ай бұрын жазған едік.\nБалаңыздың үлгерімі туралы мұғаліммен тегін кеңес алғыңыз келе ме?',
    buttons: ['Иә, кеңес керек', 'Кейінірек', 'Қажет емес']},
  {name: 'matem_kurs_kaz_1', lang: 'KZ', kind: 'mass', header: 'Документ', base: 'МАТЕМ КУРС', win: [0.1, 0.9], unconfirmed: true,
    text: 'Математикадан үлгерім төмендеп кетті ме?\nБұл жиі кездеседі: 5–6 сыныпта тақырыптар күрделене түседі, ал сабақта әр оқушыға уақыт жетпейді. EduApp Online-ның математика курсында бала өз деңгейінен бастайды: алдымен диагностика, содан кейін жеке жоспар.\nАптасына 3 сабақ, әр сабақтан кейін қысқа тест, айына бір рет ата-анамен кездесу. Мұғалім үй тапсырмасын тексеріп, қателерді түсіндіреді.\nҚосымшада сабақ кестесі мен баға туралы толық ақпарат бар — PDF файлды ашыңыз.',
    buttons: ['Толық ақпарат керек', 'Қоңырау шалыңыз', 'Қажет емес']},
  {name: 'vebinar_ata_ana_1', lang: 'KZ', kind: 'mass', header: 'Видео', base: 'ВЕБИНАР', win: [0.35, 0.75], unconfirmed: true,
    text: `Ата-аналарға арналған тегін вебинар: «Баланы НИШ-ке қалай дайындау керек?»\nСейсенбі, 20:00. Тіркелу: ${SITE}/webinar`,
    buttons: ['Тіркелдім', 'Қажет емес']},
  {name: 'eksperiment_kaz_1', lang: 'KZ', kind: 'mass', header: 'Без заголовка', base: 'ЭКСПЕРИМЕНТ', win: [0.7, 1],
    text: 'Бір сұрақ: балаңыз қай сыныпта оқиды?\nЖауабыңызға қарай сізге лайықты курсты ұсынамыз.',
    buttons: ['1–4 сынып', '5–6 сынып', '7–9 сынып']},
];

// Response model: how text traits change the click rate (so the "what in the text works" report has a signal).
function responseRate(t) {
  let r = t.kind === 'call' ? 0.16 : 0.055;
  r *= {
    'Новость о ребёнке': 2.4, 'Вопрос': 1.35, 'Цена или скидка': 0.85, 'Обращение к родителю': 1.1, 'Описание курса': 1,
  }[t.opener];
  if (t.price === 'Есть цена') r *= 0.7;
  if (t.urgency === 'Есть срок или дефицит') r *= 1.15;
  if (t.emoji === 'С эмодзи') r *= 1.05;
  if (t.length === 'больше 600 знаков') r *= 0.7;
  if (t.length === 'до 300 знаков') r *= 1.1;
  return r * Math.exp(gauss() * 0.25);
}

const templates = T.map(describe).map((t, i) => Object.assign(t, {
  id: String(1000000000000000 + 7919 * (i + 11) * 1013),
  category: t.category || 'MARKETING',
  rate: 0,
  refusal: uni(0.006, 0.03) * (t.kind === 'call' ? 0.6 : 1),
  readRate: uni(0.58, 0.86),
  leadRate: t.kind === 'call' ? uni(0.45, 0.8) : uni(0.18, 0.45),
  saleRate: uni(0.04, 0.09),
}));
for (const t of templates) {
  t.rate = responseRate(t);
  if (t.price === 'Есть цена') t.refusal *= 1.6;
}

// ---------- sending schedule ----------
const WEEKDAY_CALLS = [1.15, 1.1, 1.05, 1.0, 0.95, 0.55, 0.3]; // calls happen on working days
const sends = []; // {day, t, sent}
for (const t of templates) {
  const [a, b] = t.win;
  const from = Math.floor(a * (DAYS - 1)), to = Math.floor(b * (DAYS - 1));
  if (t.kind === 'call') {
    const base = t.lang === 'KZ' ? uni(14, 34) : uni(6, 16);
    for (let i = from; i <= to; i++) {
      const day = DAY_LIST[i];
      const n = Math.round(base * WEEKDAY_CALLS[weekday(day)] * (0.85 + 0.3 * i / DAYS) * Math.exp(gauss() * 0.3));
      if (n > 0) sends.push({day, t, sent: n});
    }
  } else {
    // 1–3 mailing bursts inside the template's active window, mostly Tue–Thu, 1–3 days each
    const bursts = Math.max(1, Math.min(3, Math.round((to - from) / 30) + int(0, 1)));
    t.bursts = [];
    for (let k = 0; k < bursts; k++) {
      let s = from + Math.floor(((to - from) * (k + rnd() * 0.8)) / bursts);
      while (s < to && ![1, 2, 3].includes(weekday(DAY_LIST[s]))) s++;
      const len = int(1, 3), size = Math.round(uni(800, 3600) * (t.lang === 'RU' ? 0.45 : 1));
      const burst = {days: [], size};
      for (let d = 0; d < len && s + d <= to; d++) {
        const day = DAY_LIST[s + d];
        const sent = Math.round((size / len) * uni(0.7, 1.3));
        sends.push({day, t, sent, burst});
        burst.days.push(day);
      }
      t.bursts.push(burst);
    }
  }
}
// The last 3 days always have a mass mailing, so the default "this week" view is lively.
{
  const t = templates.find((x) => x.name === 'kaz_rassylka_zhalpy_2');
  const burst = {days: [], size: 2600};
  for (const day of [addDays(END, -2), addDays(END, -1)]) {
    sends.push({day, t, sent: int(1100, 1500), burst});
    burst.days.push(day);
  }
  t.bursts.push(burst);
}

// ---------- daily + buttons rows ----------
const daily = [], buttons = [], crmRows = [];
const r2 = (v) => Math.round(v * 100) / 100;
for (const s of sends.sort((x, y) => (x.day < y.day ? -1 : x.day > y.day ? 1 : x.t.name.localeCompare(y.t.name)))) {
  const {t, day, sent} = s;
  const delivered = binom(sent, uni(0.93, 0.99));
  const read = binom(delivered, t.readRate * uni(0.9, 1.05));
  const recent = day > addDays(END, -2) ? 0.6 : 1; // Meta counts clicks for the last days with a delay
  const resp = binom(read, Math.min(0.9, (t.rate / t.readRate) * uni(0.8, 1.2) * recent));
  const interestButtons = t.buttons.filter((b) => !NEGATIVE_BUTTON.test(b));
  const refusalButtons = t.buttons.filter((b) => NEGATIVE_BUTTON.test(b));
  const link = t.hasLink ? Math.round(resp * (interestButtons.length ? uni(0.15, 0.35) : 1)) : 0;
  const interest = interestButtons.length ? resp - link : 0;
  const refusal = refusalButtons.length ? binom(read, t.refusal) : 0;
  daily.push([day, t.name, t.segment, t.lang, sent, delivered, read, interest, link, refusal, r2(delivered * 4.42)]);

  // clicks per button: the first ("soft") button gets the most
  const clicks = {};
  let left = interest;
  interestButtons.forEach((b, i) => {
    const n = i === interestButtons.length - 1 ? left : Math.round(left * uni(0.5, 0.75));
    clicks[b] = n; left -= n;
  });
  refusalButtons.forEach((b) => { clicks[b] = refusal; });
  if (t.hasLink) clicks[LINK_BUTTON] = link;
  for (const b of Object.keys(clicks)) {
    const kind = b === LINK_BUTTON ? 'Ссылка' : NEGATIVE_BUTTON.test(b) ? 'Отказ' : 'Интерес';
    buttons.push([day, t.name, t.segment, t.lang, b, kind, clicks[b], delivered]);
  }

  // CRM: leads come from responses (calls also bring leads without a click), sales from leads
  if (!t.unconfirmed) {
    const leads = binom(interest + link, t.leadRate) + (t.kind === 'call' ? binom(delivered, 0.02) : 0);
    if (leads) {
      const deals = binom(leads, t.saleRate);
      let revenue = 0, paid = 0;
      for (let k = 0; k < deals; k++) {
        const price = pick([59000, 79000, 99000, 129000, 159000, 199000, 249000]);
        const p = rnd() < 0.55 ? price : Math.round(price * uni(0.3, 0.7) / 100) * 100; // the rest is in instalments
        revenue += price; paid += p;
      }
      crmRows.push({day, template: t.name, leads, deals, revenue, paid, sent: delivered, burst: s.burst || null});
    }
  }
}

// ---------- bases (CRM stages = mailing bases) ----------
function buildBases(rows, from, to, source) {
  const out = [];
  for (const t of templates.filter((x) => x.kind === 'mass')) {
    (t.bursts || []).forEach((b, k) => {
      if (!b.days.length || b.days[0] < from || b.days[0] > to) return;
      const sent = sends.filter((s) => s.burst === b).reduce((a, s) => a + s.sent, 0);
      const entered = Math.round(sent * uni(1.02, 1.12));
      const failed = Math.round(entered * uni(0.03, 0.12));
      const rs = rows.filter((r) => r.burst === b);
      const sum = (key) => rs.reduce((a, r) => a + r[key], 0);
      const name = t.bursts.length > 1 ? `${t.base} ${k + 1}` : t.base;
      const coverage = Math.round((sent / Math.max(1, entered - failed)) * (t.unconfirmed ? uni(0.1, 0.5) : 1) * 100) / 100;
      const base = {
        base: name, templates: [{name: t.name, n: t.unconfirmed ? 0 : entered - failed, coverage}],
        match: t.unconfirmed ? 'похоже' : pick(['точно', 'точно', 'точно', 'проверено по дням', 'похоже']),
        from: b.days[0], to: b.days[b.days.length - 1], entered, failed,
        unconfirmed: t.unconfirmed ? entered - failed : 0, sends: t.unconfirmed ? 0 : entered - failed,
        leads: sum('leads'), deals: sum('deals'), revenue: sum('revenue'), paid: sum('paid'),
      };
      if (t.unconfirmed) base.templates = [];
      if (source === 'Битрикс24') {
        base.source = source;
        base.templates.forEach((x) => { x.pending = b.days[b.days.length - 1] > addDays(END, -2); });
      }
      out.push(base);
    });
  }
  // a base that left from another number: entered the CRM stage, but Meta has no matching sends
  if (source === 'amoCRM') {
    const d = addDays(START, int(20, 50));
    out.push({base: 'НЕЙТРАЛЬНО ЖЕҢІЛДІК', templates: [], match: 'проверено по дням', from: d, to: addDays(d, 4),
      entered: int(2500, 5000), failed: int(80, 200), unconfirmed: 0, sends: 0, leads: 0, deals: 0, revenue: 0, paid: 0});
    out[out.length - 1].unconfirmed = out[out.length - 1].entered - out[out.length - 1].failed;
  }
  return out.sort((a, b) => b.entered - a.entered);
}

const rowsOut = (rows) => ({
  columns: ['day', 'template', 'leads', 'deals', 'revenue', 'paid'],
  rows: rows.map((r) => [r.day, r.template, r.leads, r.deals, r.revenue, r.paid]),
});
const usedIn = (rows) => [...new Set(rows.map((r) => r.template))];
const unconfirmedNames = templates.filter((t) => t.unconfirmed).map((t) => t.name);

const amoRows = crmRows.filter((r) => r.day <= AMO_TO);
const bxRows = crmRows.filter((r) => r.day >= BITRIX_FROM);
const amoHistory = {
  source: 'amoCRM', from: START, to: AMO_TO, builtAt: new Date(`${AMO_TO}T12:00:00Z`).toISOString(),
  rules: {coverageMin: 0.8, leadWindowDays: 7, failWithinDays: 3},
  confirmedTemplates: usedIn(amoRows),
  unconfirmedTemplates: unconfirmedNames,
  rows: rowsOut(amoRows),
  bases: buildBases(amoRows, START, AMO_TO, 'amoCRM'),
};
const bitrix = {
  enabled: true, source: 'bitrix', currency: 'KZT', from: BITRIX_FROM,
  updatedAt: new Date(`${END}T06:00:00Z`).toISOString(),
  rows: rowsOut(bxRows),
  rules: {coverageMin: 0.8, leadWindowDays: 7, metaLast: END},
  confirmedTemplates: usedIn(bxRows),
  unconfirmedTemplates: unconfirmedNames.filter((n) => sends.some((s) => s.t.name === n && s.day >= BITRIX_FROM)),
  bases: buildBases(bxRows, BITRIX_FROM, END, 'Битрикс24'),
};

// ---------- notes for the "Bases" tab ----------
const noteTexts = [
  'Родители 5–7 классов, Алматы и область. Повторять не раньше чем через месяц.',
  'Ата-аналар базасы, 3–4 сынып. Келесі жолы қысқа мәтінмен тексеру керек.',
  'Тест: две версии текста в один день, половина базы на каждую.',
];
const notes = {};
amoHistory.bases.filter((b) => b.sends).slice(0, 3).forEach((b, i) => {
  notes[b.base] = {note: noteTexts[i], updatedAt: new Date(`${b.to}T10:00:00Z`).toISOString()};
});

const TEMPLATE_COLUMNS = ['name', 'id', 'lang', 'segment', 'family', 'header', 'opener', 'price', 'urgency', 'length', 'emoji', 'link',
  'buttons_n', 'buttons', 'vars', 'status', 'preview', 'category', 'text', 'header_text', 'footer', 'buttons_json'];
const sample = {
  updatedAt: new Date(`${END}T04:30:00Z`).toISOString(),
  phone: {
    checkedAt: new Date(`${END}T04:30:00Z`).toISOString(), number: "'+7 700 000 11 00", quality: 'GREEN', limit: 'TIER_100K',
    status: 'CONNECTED', canSend: 'AVAILABLE', qualitySince: addDays(END, -int(10, 40)), prevQuality: 'YELLOW',
  },
  templates: {
    columns: TEMPLATE_COLUMNS,
    rows: templates.map((t) => [t.name, `'${t.id}`, t.lang, t.segment, t.family, t.header, t.opener, t.price, t.urgency, t.length,
      t.emoji, t.link, t.buttons.length, t.buttons.join(' · '), 0, 'APPROVED', t.preview, t.category, t.text, t.headerText || '', '',
      JSON.stringify(t.buttons.map((text) => ({text, type: 'QUICK_REPLY'})))]),
  },
  daily: {columns: ['day', 'name', 'segment', 'lang', 'sent', 'delivered', 'read', 'interest', 'link', 'refusal', 'spent'], rows: daily},
  buttons: {columns: ['day', 'name', 'segment', 'lang', 'button', 'kind', 'clicks', 'delivered'], rows: buttons},
  crm: bitrix,
  notes,
  demo: true,
};

fs.writeFileSync(path.join(OUT_DIR, 'sample-data.json'), JSON.stringify(sample));
fs.writeFileSync(path.join(OUT_DIR, 'amo-history.json'), JSON.stringify(amoHistory, null, 1));
const tot = (rows, i) => rows.reduce((a, r) => a + r[i], 0);
console.log(`seed ${SEED}: ${START} … ${END}, ${templates.length} templates, ${daily.length} daily rows, ${buttons.length} button rows`);
console.log(`sent ${tot(daily, 4)}, delivered ${tot(daily, 5)}, responses ${tot(daily, 7) + tot(daily, 8)}, refusals ${tot(daily, 9)}`);
console.log(`CRM: amoCRM ${amoRows.length} rows / ${amoHistory.bases.length} bases, Bitrix24 ${bxRows.length} rows / ${bitrix.bases.length} bases`);
