# Tech Publishing Assistant

Node/Express SPA for tech news aggregation, WeChat/WeRead pulls, word cloud, books insights, and topic planning.

## Requirements

- Node.js 18+
- DeepSeek API key (for AI features)

## Setup

```bash
cp .env.example .env
# edit .env
npm install
node server.js
```

Default port: `3001` (override with `PORT`).

## Notes

- Runtime data under `data/` is not committed.
- Do not commit secrets or deploy credentials.
