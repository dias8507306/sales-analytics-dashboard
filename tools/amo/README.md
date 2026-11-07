# amoCRM history → `web/api/amo-history.json`

One-off, read-only ETL that turns amoCRM stage history into "mailing day × template → leads, sales, revenue"
rows plus a per-base summary. Only aggregates go into the output file — no deal ids, names or phones.

In this portfolio repository `amo-history.json` is **generated** by `scripts/generate-demo-data.js`
(random data); these scripts show how the real file was built.

Credentials come from the environment: `AMO_BASE=https://YOUR_AMO_SUBDOMAIN.amocrm.ru`,
`AMO_TOKEN=...` (or `AMO_TOKEN_FILE=path/to/token.txt`, kept outside the repo). Pipeline / field ids in the
scripts are placeholders.

Order (`T` is any temp folder; `SAMPLE` is the Meta statistics JSON returned by the sheet web app):

```bash
node tools/amo/amo_events.js T/amo_events.json                              # stage entries + moves to the sales pipeline
node tools/amo/amo_deals.js  T/amo_events.json T/amo_deals.json             # stage and money of deals that became leads
node tools/amo/amo_match2.js T/amo_events.json SAMPLE T/amo_map.json        # stage → template suggestion (days, volume, name)
node tools/amo/amo_build.js  T/amo_events.json T/amo_deals.json T/amo_map.json web/api/amo-history.json SAMPLE
```

How it maps: a mailing = a deal entering a stage of the "base" pipeline (each base has its own stage);
a lead = the deal moves to the sales pipeline within 7 days; a sale = "won" status outside the base pipeline.
Revenue = paid budget + remaining debt. A stage can receive different templates on different days, so the
template is chosen per "stage + day" from Meta send volumes (`amo_daymap.js`); manual fixes go to `FIX` in
`amo_build.js`. A template counts only if Meta confirms ≥ 80% of the sends (otherwise the base left from
another number and is shown as unconfirmed).
