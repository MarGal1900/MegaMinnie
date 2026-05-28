# MegaMinnie

Webapp voor B2B-sales: ruwe bezoekinput (foto, audio, tekst, interview) omzetten naar een gestructureerd Salesforce-verslag met notitie, taken en agenda-items.

## Vereisten

- Node.js 20+
- Docker (optioneel, voor lokaal Whisper)
- API-sleutel: Anthropic Claude (aanbevolen) of OpenAI
- Salesforce Connected App (optioneel, voor upload)

## Snel starten

```bash
cp .env.example .env
# Vul ANTHROPIC_API_KEY en eventueel Salesforce-gegevens in

npm install
npm run avatar        # genereert header-avatar (public/images/)
npm run dev           # http://127.0.0.1:3000
```

### Lokaal Whisper (aanbevolen met Claude)

```bash
npm run whisper:up    # Docker, poort 8000 — eerste start duurt enkele minuten
npm run whisper:logs  # voortgang volgen
```

Zet in `.env`:

```
WHISPER_BASE_URL=http://127.0.0.1:8000/v1
WHISPER_API_KEY=local
WHISPER_LOCAL_MODEL=Systran/faster-whisper-medium
```

Cloud (zonder `WHISPER_BASE_URL`), standaard `WHISPER_PROFILE=quality` → `gpt-4o-mini-transcribe`. Zet `WHISPER_PROFILE=diarize` voor gesprekken met meerdere sprekers (alleen cloud).

## Scripts

| Script | Beschrijving |
|--------|--------------|
| `npm run dev` | Ontwikkelserver met hot reload |
| `npm run dev:clean` | Vrij poort 3000 (Windows) en start dev |
| `npm run build` | TypeScript → `dist/` |
| `npm start` | Productie (`node dist/index.js`, vereist `build`) |
| `npm test` | Vitest unit tests |
| `npm run typecheck` | Alleen typecontrole |
| `npm run lint` | ESLint |
| `npm run avatar` | Genereert header-avatar (`public/images/`) |
| `npm run gif` | Genereert verwerkings-GIF uit `public/images/megaminnie-side.png` (zijaanzicht) |
| `npm run sf:check` | Test Salesforce-login en configuratie |
| `npm run whisper:up` | Start lokaal Whisper via Docker |
| `npm run whisper:down` | Stop Whisper-container |

## Preview vs live

Standaard staat **preview-modus** aan (`MEGAMINNIE_DRY_RUN=true`): MegaMinnie werkt verslagen uit, maar er wordt **niets** naar Salesforce geüpload.

Zet `MEGAMINNIE_DRY_RUN=false` pas als Salesforce-credentials kloppen en je live wilt syncen.

**Salesforce setup:** zie [docs/SALESFORCE.md](docs/SALESFORCE.md) en test met `npm run sf:check`.

Met `SF_DEFAULT_WHAT_ID` kan automatisch gesynchroniseerd worden bij verwerking (Account/Contact/Opportunity Id).

## Beveiliging

- Standaard luistert de server alleen op `127.0.0.1`.
- Optioneel: zet `MEGAMINNIE_API_KEY` in `.env` — dan vereisen alle `/api/*`-routes een header `X-API-Key: <key>`.
- Rate limiting op uploads: max. 30 requests per minuut per IP (instelbaar via `MEGAMINNIE_RATE_LIMIT`).

Voor productie: achter een reverse proxy met HTTPS (microfoon in de browser vereist HTTPS buiten localhost).

Zorg dat `public/images/megaminnie-animated-web.gif` aanwezig is (genereer met `npm run gif` vóór deploy). Prod én testmodus gebruiken dezelfde asset.

## Productie

```bash
npm run build
MEGAMINNIE_DRY_RUN=false npm start
```

Of via Docker:

```bash
docker compose up -d
```

Zie `Dockerfile` en `docker-compose.yml`.

## Workflow

1. **Invoer** — foto, audio, tekst, Word/PDF of gesproken interview
2. **Uitwerken** — MegaMinnie genereert notitie, taken en agenda
3. **Controle** — bewerk titel, body, taken en events; koppel Salesforce-record
4. **Upload** — sync naar Salesforce (ContentNote + Task + Event)

## Mapstructuur

```
src/
  agent/          LLM-prompts en -agent
  routes/         Express API-endpoints
  services/       Pipeline, Salesforce, Whisper, vision
  lib/            Config, helpers
public/
  js/             Frontend (ES modules)
  css/            Styling
```
