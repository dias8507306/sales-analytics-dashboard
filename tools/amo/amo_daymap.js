// Шаблон для пары «этап + день»: в один этап в разные дни могли уходить разные шаблоны одной темы.
// Для каждого дня жадно раздаём отправки Meta (ёмкость = «отправлено» шаблона в этот день) этапам:
// сначала основной шаблон этапа, потом шаблоны той же темы. Не нашлось — основной шаблон этапа.
const fs = require('fs');
module.exports = function dayMapper(stageDays, mainOf, sampleFile) {
  const d = require(sampleFile);
  const tab = (t) => t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c, r[i]])));
  const SERVICE = /chto_reshili|nedozvon|koshtasu|somnenie|posle_z|ne_dozvon|proverka|insta|eduapp_app|tirkelu|oshibka/;
  const FAM = [
    [/алтын сақа|^ас |ас база|элит база ас/i, /^(as_|altyn_saka|elit_baza_as|pu_as_)/],
    [/ниш|элит/i, /nish|elit/], [/(^|\s)пу(\s|$)/i, /(^|_)pu_/], [/гибрид/i, /gibrid|kitap|natizhe/], [/академия/i, /akademiya/],
    [/англ|тілде|кеш емес|математ|матем/i, /angl|matem/], [/олимп|7-8-9|таңғы топ/i, /olimp|7_8_9|utro/], [/пробный/i, /probnyy/],
    [/скидка|жеңілдік|жеңілдик/i, /skidka|zhenildik|sikdka/], [/рассылка|базасы|оп база|повторная/i, /rassylka|baza|zakryt|oryssha/],
    [/вебинар/i, /vebinar/], [/офф/i, /of_ketip|off_ketken/], [/повт/i, /povt/], [/мұғалім/i, /mugalim/], [/фото/i, /foto/],
  ];
  const related = (stage, tpl) => FAM.some(([s, t]) => s.test(stage) && t.test(tpl));
  const meta = {}; // день → шаблон → отправлено
  for (const r of tab(d.daily)) {
    if (!(+r.sent) || SERVICE.test(r.name)) continue;
    const day = String(r.day).slice(0, 10);
    (meta[day] = meta[day] || {})[r.name] = (meta[day][r.name] || 0) + (+r.sent);
  }
  const chosen = {}; // `${stage}|${day}` → шаблон
  const days = new Set(Object.values(stageDays).flatMap((s) => Object.keys(s)));
  for (const day of days) {
    const cap = Object.assign({}, meta[day] || {});
    const pairs = [];
    for (const [stage, byDay] of Object.entries(stageDays)) {
      const n = byDay[day];
      if (!n) continue;
      for (const tpl of Object.keys(cap)) {
        const isMain = tpl === mainOf[stage];
        if (!isMain && !related(stage, tpl)) continue;
        pairs.push({stage, tpl, n, score: (isMain ? 2 : 1) + Math.min(cap[tpl], n) / Math.max(cap[tpl], n)});
      }
    }
    pairs.sort((a, b) => b.score - a.score);
    for (const p of pairs) {
      const k = `${p.stage}|${day}`;
      if (chosen[k] || cap[p.tpl] < p.n * 0.3) continue; // шаблону в этот день должно хватить отправок
      chosen[k] = p.tpl;
      cap[p.tpl] -= p.n;
    }
  }
  return (stage, day) => chosen[`${stage}|${day}`] || mainOf[stage] || null;
};
