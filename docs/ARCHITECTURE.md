# Architecture

```
Meta WhatsApp Business API ──(template_analytics, message_templates, phone health)──┐
                                                                                     ▼
Bitrix24 (incoming webhook: mailings, moves to sales, deals) ──► Google Sheet + Apps Script (apps-script/Code.gs)
                                                                   │  sheets: templates, daily stats, button clicks,
                                                                   │  phone status, Bitrix raw data, base notes
                                                                   │  doGet(key) → one JSON;  doPost(key) → save note
                                                                   ▼
amoCRM history (tools/amo, one-off ETL) ──► web/api/amo-history.json
                                                                   ▼
                             web/api/data.js  (Vercel Function / server.js)
                             merges sheet JSON + amoCRM history, 10-min cache, password check
                                                                   ▼
                             web/app.js (static SPA, d3)  ──►  web/api/insights.js  ──► Claude / OpenAI / OpenRouter
```

## Data flow

1. **Apps Script** (time-driven trigger, every morning) pulls template definitions and per-day analytics
   (sent / delivered / read / button clicks / spend) from the Graph API, classifies each template by name and
   text (segment, theme, opener, price, urgency, length, emoji, link) and rewrites the last 7 days, because Meta
   back-fills reads and clicks. An hourly trigger syncs Bitrix24: which deal got which template, when the deal
   moved to the sales pipeline, deal stage and money.
2. **`crmSummary_`** attributes leads and sales to mailings with strict rules: a template counts only if Meta
   confirms ≥ 80% of the CRM sends; a lead is a move to the sales pipeline ≤ 7 days after the last confirmed
   mailing; a sale is a won deal of such a lead; revenue = paid + remaining debt.
3. **`doGet`** returns everything as one JSON (key-protected). The site never sees the sheet key — the
   serverless function adds it.
4. **`web/api/data.js`** merges the sheet payload with the amoCRM history (same row schema, the CRM switched
   from amoCRM to Bitrix24 mid-period) and caches it.
5. **`web/app.js`** renders KPIs (sent, read, response, refusals, cost, leads, sales, revenue, ROI), period
   comparison, daily dynamics, funnel, button ranking, weekly trends, best weekday, cost per response, template
   table with message preview, Excel export, a "Bases" tab with per-base attribution and editable notes, and a
   printable report whose "AI insights" section comes from `api/insights.js` (structured JSON output).

## Demo mode

Without `SHEET_API_URL` / `SHEET_API_KEY`, `api/_demo.js` serves `api/sample-data.json` (+ the generated
`amo-history.json`), keeps notes in memory and returns a canned AI answer when no `AI_API_KEY` is set.
Dates are shifted by whole weeks so the latest data is always "this week". Both files are produced by
`scripts/generate-demo-data.js` with the same schema and classification rules as the Apps Script.

## Deployment options

- **Vercel**: project root `web/`, functions in `web/api/`, `vercel.json` raises `insights.js` timeout to 300 s.
- **Own server**: `node server.js` (or the Dockerfile) serves the same static files and functions.
