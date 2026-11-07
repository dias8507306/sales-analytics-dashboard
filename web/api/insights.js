// Vercel Function: выводы ИИ для отчёта по рассылкам за выбранный период.
// Дашборд присылает цифры по шаблонам (Meta + Битрикс) и тексты; функция просит модель найти,
// какие приёмы в тексте повторять, каких избегать, и возвращает JSON для отчёта («Сделать отчёт»).
// Номеров телефонов и имён клиентов в запросе нет — только суммы по шаблонам и тексты шаблонов.
//
// Переменные окружения (Vercel → Settings → Environment Variables):
//   AI_API_KEY — ключ ИИ. Сервис определяется по началу ключа:
//                sk-ant-… → Claude (Anthropic), sk-or-… → OpenRouter, остальные sk-… → OpenAI.
//   AI_MODEL   — необязательно: другая модель (по умолчанию см. MODELS).

const {passwordOk} = require('./_auth');
const demo = require('./_demo');

// SDK Claude грузится только при запросе к Claude: демо и OpenAI/OpenRouter работают и без npm install.
let sdkClass = null;
function loadAnthropic() {
  if (!sdkClass) { const sdk = require('@anthropic-ai/sdk'); sdkClass = sdk.default || sdk; }
  return sdkClass;
}

const MODELS = {anthropic: 'claude-opus-5-5', openai: 'gpt-4.1', openrouter: 'anthropic/claude-opus-5.5'};
const MAX_BODY = 200 * 1024; // дашборд шлёт ~30–60 КБ; больше — значит что-то не так

// Ответ модели: те же разделы, что в отчёте «Какие тексты продают».
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'repeat', 'avoid', 'comparisons', 'experiments', 'caveats'],
  properties: {
    summary: {type: 'string'},
    repeat: {type: 'array', items: {$ref: '#/$defs/point'}},
    avoid: {type: 'array', items: {$ref: '#/$defs/point'}},
    comparisons: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'better', 'worse', 'evidence'],
        properties: {title: {type: 'string'}, better: {type: 'string'}, worse: {type: 'string'}, evidence: {type: 'string'}},
      },
    },
    experiments: {type: 'array', items: {type: 'string'}},
    caveats: {type: 'array', items: {type: 'string'}},
  },
  $defs: {
    point: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'evidence', 'templates'],
      properties: {
        title: {type: 'string'},
        evidence: {type: 'string'},
        templates: {type: 'array', items: {type: 'string'}},
      },
    },
  },
};

const SYSTEM = `Ты аналитик маркетинга онлайн-школы EduApp Online (Казахстан). Школа делает WhatsApp-рассылки шаблонами
родителям школьников. Тебе дают статистику шаблонов за период: доставлено, прочитано, отклик (нажатия кнопок интереса
и ссылки), отказы, расходы; если подключён Битрикс — лиды (сделка перешла в отдел продаж), продажи, выручка (полная цена
договора) и ROI. Плюс тексты шаблонов и их кнопки.

Задача: найти, какие приёмы в ТЕКСТЕ дают больше отклика, лидов и денег, а какие — меньше, чтобы следующие рассылки
повторяли удачные подходы и избегали неудачных. Смотри на первую строку, обещание, дефицит и срок, цену в тексте,
длину, кнопки (мягкие «узнать» против «записаться»), обращение, язык, тему и базу.

Правила:
- Каждый вывод подтверждай цифрами из данных (проценты, количество, названия шаблонов). Ничего не выдумывай.
- Малые выборки не доказывают ничего: шаблоны с доставкой меньше 200 не используй как доказательство и не ставь
  в пример (ни хороший, ни плохой). Проценты вроде «75% (3/4)» или «0% (0/30)» не приводи.
- Шаблоны с recent: true отправлены в последние 2 дня периода: отклик, лиды и продажи по ним ещё досчитываются.
  Не называй их неудачными и не делай по ним выводов.
- Если у шаблона лидов больше, чем откликов, сделки в отдел продаж переводили вручную, не по ответу на рассылку —
  не ставь такой шаблон в пример по лидам.
- Учитывай размер выборки: 1–2 продажи — это шум, а не закономерность; так и пиши. Лиды и отклик надёжнее.
- Различай влияние текста и влияние базы: разные базы сравнивай осторожно, лучшие доказательства — одна база, разные тексты.
- Расходы и ROI считаются только за дни, где есть данные CRM; если CRM нет, опирайся на отклик и отказы.
- Пиши по-русски, коротко и конкретно, без общих слов. Названия шаблонов пиши как в данных.
- summary — 3–4 предложения с главным итогом периода: что сработало, что нет, сколько денег принесли рассылки.
- repeat и avoid — по 3–5 пунктов: title — сам приём, evidence — цифры и шаблоны, templates — имена шаблонов-примеров.
- comparisons — 1–3 пары шаблонов из этого периода, которые лучше всего показывают разницу приёмов: желательно одна
  база или тема, у обоих доставка от 200. better и worse — точные имена шаблонов, title — в чём разница текстов,
  evidence — цифры обоих. Если честных пар нет, верни пустой список.
- experiments — 2–4 конкретных теста для следующих рассылок. caveats — 1–3 ограничения данных.`;

module.exports = async (req, res) => {
  if (!passwordOk(req)) { res.status(401).json({error: 'password'}); return; }
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({error: 'method', message: 'Нужен POST.'}); return; }

  const key = (process.env.AI_API_KEY || '').trim();
  if (!key && demo.isDemo()) { // демо без ключа ИИ: заготовка ответа
    const body = typeof req.body === 'string' ? safeJson(req.body) : req.body;
    setTimeout(() => res.status(200).json(demo.mockInsights(body)), 800);
    return;
  }
  if (!key) {
    res.status(500).json({error: 'config', message: 'В настройках Vercel не задан AI_API_KEY.'});
    return;
  }
  const payload = typeof req.body === 'string' ? safeJson(req.body) : req.body;
  const text = payload ? JSON.stringify(payload) : '';
  if (!payload || !Array.isArray(payload.templates) || !payload.templates.length) {
    res.status(400).json({error: 'input', message: 'За этот период нет шаблонов с отправками.'});
    return;
  }
  if (text.length > MAX_BODY) { res.status(413).json({error: 'input', message: 'Слишком много данных за период.'}); return; }

  const provider = key.startsWith('sk-ant-') ? 'anthropic' : key.startsWith('sk-or-') ? 'openrouter' : 'openai';
  const model = (process.env.AI_MODEL || '').trim() || MODELS[provider];
  const prompt = `Данные за период (JSON):\n${text}\n\nСделай выводы по правилам. Ответ — только JSON по схеме.`;
  try {
    const result = provider === 'anthropic' ? await askClaude(key, model, prompt) : await askOpenAiCompatible(provider, key, model, prompt);
    res.status(200).json({provider, model, createdAt: new Date().toISOString(), ...result});
  } catch (e) {
    res.status(502).json({error: 'ai', provider, model, message: e.message || String(e)});
  }
};

async function askClaude(apiKey, model, prompt) {
  const Anthropic = loadAnthropic();
  const client = new Anthropic({apiKey});
  let response;
  try {
    // fallbacks: если основная модель откажет по своим правилам безопасности, API само повторит запрос на другой.
    response = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      output_config: {effort: 'medium', format: {type: 'json_schema', schema: inlineDefs(SCHEMA)}},
      messages: [{role: 'user', content: prompt}],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Claude не принял ключ AI_API_KEY: проверьте его в Vercel.');
    if (e instanceof Anthropic.PermissionDeniedError) throw new Error('У ключа нет доступа к этой модели.');
    if (e instanceof Anthropic.NotFoundError) throw new Error(`Модель ${model} не найдена: проверьте AI_MODEL.`);
    if (e instanceof Anthropic.RateLimitError) throw new Error('Лимит запросов Claude: попробуйте через минуту.');
    if (e instanceof Anthropic.APIError) throw new Error(`Claude, код ${e.status}: ${e.message}`);
    throw e;
  }
  if (response.stop_reason === 'refusal') throw new Error('Модель отказалась отвечать на этот запрос.');
  if (response.stop_reason === 'max_tokens') throw new Error('Ответ модели оборвался: попробуйте период покороче.');
  const out = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return parseResult(out);
}

// OpenAI и OpenRouter: один и тот же формат chat/completions.
async function askOpenAiCompatible(provider, key, model, prompt) {
  const url = provider === 'openrouter' ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
  const send = (strict) => fetch(url, {
    method: 'POST',
    headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({
      model,
      messages: [{role: 'system', content: SYSTEM}, {role: 'user', content: prompt}],
      ...(strict ? {response_format: {type: 'json_schema', json_schema: {name: 'insights', strict: true, schema: inlineDefs(SCHEMA)}}} : {}),
    }),
  });
  let r = await send(true);
  let body = await r.json().catch(() => ({}));
  // Не каждая модель на OpenRouter принимает строгую схему — тогда один повтор без неё (промпт и так просит JSON).
  if (r.status === 400 && /response_format|json_schema|structured/i.test(JSON.stringify(body.error || ''))) {
    r = await send(false);
    body = await r.json().catch(() => ({}));
  }
  if (!r.ok) {
    const msg = (body.error && body.error.message) || `код ${r.status}`;
    if (r.status === 401) throw new Error(`${provider === 'openrouter' ? 'OpenRouter' : 'OpenAI'} не принял ключ AI_API_KEY: проверьте его в Vercel.`);
    if (r.status === 404) throw new Error(`Модель ${model} не найдена: проверьте AI_MODEL.`);
    throw new Error(`${provider === 'openrouter' ? 'OpenRouter' : 'OpenAI'}: ${msg}`);
  }
  const choice = body.choices && body.choices[0];
  if (!choice || !choice.message) throw new Error('ИИ вернул пустой ответ.');
  if (choice.message.refusal) throw new Error('Модель отказалась отвечать на этот запрос.');
  return parseResult(choice.message.content || '');
}

// Не все сервисы понимают $ref на $defs в строгой схеме — подставляем определение на место ссылки.
function inlineDefs(schema) {
  const {$defs, ...rest} = schema;
  return JSON.parse(JSON.stringify(rest).replace(/\{"\$ref":"#\/\$defs\/point"\}/g, JSON.stringify($defs.point)));
}

function parseResult(text) {
  const data = safeJson(text);
  if (!data || typeof data.summary !== 'string') throw new Error('ИИ вернул ответ не в том формате. Попробуйте ещё раз.');
  const list = (v) => (Array.isArray(v) ? v : []);
  return {
    summary: data.summary,
    repeat: list(data.repeat), avoid: list(data.avoid), comparisons: list(data.comparisons),
    experiments: list(data.experiments).map(String), caveats: list(data.caveats).map(String),
  };
}

// Некоторые модели оборачивают JSON в ```json … ``` — снимаем обёртку.
function safeJson(s) {
  const text = String(s || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); } catch (e) { return null; }
}
