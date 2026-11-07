// Vercel Function: пример лидов и продаж, чтобы посмотреть вид дашборда без Битрикса.
// Настоящие данные Битрикс24 приходят вместе с данными таблицы (поле crm в /api/data, crmSummary_ в Code.gs),
// поэтому без CRM_MOCK=1 функция отвечает {enabled: false}.
//
// Контракт (тот же, что у crmSummary_; app.js → buildCrm):
//   {
//     enabled: true,
//     source: 'bitrix' | 'mock',
//     updatedAt: '2026-11-02T07:00:00.000Z',
//     currency: 'KZT',
//     from: '2026-10-20',
//     rows: {columns: ['day', 'template', 'leads', 'deals', 'revenue', 'paid'], rows: [['2026-10-29', 'kaz_rassylka_zhalpy_2', 12, 1, 392700, 112200], ...]}
//   }
//   from — с какого дня в CRM есть данные; day — день рассылки; leads — сделки, перешедшие после неё в воронку ОП;
//   deals — успешные сделки; revenue — полная цена договоров (оплачено + долг), paid — уже оплаченное, ₸.
//
// Переменные окружения: CRM_MOCK=1 — отдавать пример (для коллег не включать).

const {passwordOk} = require('./_auth');

module.exports = async (req, res) => {
  if (!passwordOk(req)) { res.status(401).json({error: 'password'}); return; }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(process.env.CRM_MOCK === '1' ? mockCrm() : {enabled: false});
};

// Пример данных по именам демо-шаблонов. Только для проверки вида дашборда.
function mockCrm() {
  const rows = [
    ['2026-10-08', 'altyn_saka_kuttyktau_1', 9, 1, 120000], ['2026-10-10', 'as_baza_nish_1', 14, 1, 120000],
    ['2026-10-13', 'as_baza_nish_1', 11, 1, 120000], ['2026-10-15', 'as_baza_nish_1', 8, 1, 95000],
    ['2026-10-20', 'altyn_saka_kuttyktau_1', 7, 1, 120000], ['2026-10-11', 'as_kuttyktau_rus_1', 6, 1, 95000],
    ['2026-10-12', 'rus_rassylka_obshaya_2', 5, 1, 120000], ['2026-10-21', 'chto_reshili_kaz_1', 4, 1, 95000],
    ['2026-10-24', 'nedozvon_kaz_1', 3, 1, 120000], ['2026-10-09', 'povt_kasanie_kaz_2', 5, 1, 95000],
    ['2026-10-25', 'kaz_rassylka_zhalpy_2', 18, 1, 120000], ['2026-10-26', 'kaz_rassylka_zhalpy_2', 6, 0, 0],
  ];
  return {
    enabled: true, source: 'mock', updatedAt: new Date().toISOString(), currency: 'KZT',
    rows: {columns: ['day', 'template', 'leads', 'deals', 'revenue', 'paid'], rows: rows.map((r) => r.concat(Math.round(r[4] * 0.6)))},
  };
}
