# Aero'ed

Software platform for operating drone relay corridors — enabling year-round medicine delivery to remote Northern Quebec communities through chains of charging stations.

Built for McGill AeroHacks 2026.

## Setup

```bash
npm install
cp .env.example .env   # add your API keys
npm run dev
```

## Environment Variables

```
VITE_GEMINI_API_KEY=...
VITE_ELEVENLABS_API_KEY=...
MONGODB_URI=...
```

## Integrations

- **Gemini 3.1 Flash** — AI dispatch and route optimization
- **ElevenLabs v3** — Voice alerts for delivery arrivals
- **MongoDB Atlas** — Real-time operational database
- **Solana Devnet** — Chain-of-custody ledger
- **Snowflake** — Corridor analytics
- **Leaflet** — Interactive corridor map
