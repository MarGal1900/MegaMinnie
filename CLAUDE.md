# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This App Does

MegaMinnie is a B2B sales visit report generator. It converts raw input (photos, audio recordings, typed notes, Word/PDF documents, or a live AI interview) into structured Salesforce notes, tasks, and calendar events.

The UI language and prompt system are Dutch. All LLM prompts and generated output target Dutch text.

## Commands

```bash
# Development
npm run dev           # TypeScript hot reload (tsx watch)
npm run dev:clean     # Kill port 3000 then start dev (Windows)

# Build & production
npm run build         # Compile TypeScript → dist/, bundles DOCX template
npm start             # Run compiled dist/index.js

# Testing
npm test              # Vitest (one-shot)
npm run test:watch    # Vitest interactive watch
# Run a single test file:
npx vitest run tests/interview-commands.test.ts

# Code quality
npm run lint          # ESLint on public/js/ only (frontend)
npm run typecheck     # tsc --noEmit

# Utilities
npm run sf:check      # Test Salesforce connection & credentials
npm run whisper:up    # Start local Whisper via Docker Compose
npm run whisper:down  # Stop local Whisper
```

`bundle:docx` (bundles the Word template into `public/js/`) runs automatically as a pre-hook before `dev`, `test`, and `build`.

## Architecture

### Processing Pipeline

Input arrives via one of six routes (`/api/visit-report/{voice|photo|text|document|conversation|interview}`), all defined in `src/routes/visit-report.ts`. Each route calls the shared pipeline in `src/services/visit-report-pipeline.ts`, which:

1. Preprocesses input (transcription via Whisper, OCR via vision, or direct text)
2. Calls the MegaMinnie LLM agent (`src/agent/megaminnie-agent.ts`) to produce structured JSON
3. Normalizes and validates the JSON schema (`src/lib/normalize-megaminnie-output.ts`)
4. Optionally syncs to Salesforce (`src/services/salesforce.ts`)

The **photo fast-path** (`src/agent/megaminnie-from-photos.ts`) skips text extraction and calls the vision model directly with a structured prompt.

The **Realtime Interview** path (`src/routes/realtime.ts`) upgrades the HTTP connection to a WebSocket and relays OpenAI Realtime API events.

### LLM Provider Abstraction

`src/lib/llm-config.ts` selects between Anthropic and OpenAI based on environment variables. `src/lib/llm.ts` provides provider-agnostic completion helpers used throughout `src/agent/`. The default provider is Anthropic when `ANTHROPIC_API_KEY` is set.

Vision calls use a separate configurable model (`ANTHROPIC_VISION_MODEL` or `OPENAI_VISION_MODEL`).

### Frontend

`public/js/app.js` is the single main controller — it manages all UI state and orchestrates calls to backend API wrappers in `public/js/api.js`. Feature modules are plain ES modules (no bundler):

- `conversation-recording.js` — Web Audio API recording
- `realtime-interview.js` — OpenAI Realtime WebSocket + UI
- `interview-commands.js` — Voice command parser ("done", "review", etc.)
- `tasks-events.js` — Editable task/event tables
- `gespreksverslag-docx.js` — Export report to Word (loaded on demand)

### Salesforce Integration

`src/lib/salesforce-connection.ts` manages jsforce OAuth. Salesforce config and credentials live in `src/lib/salesforce-config.ts`. The main sync logic (ContentNote + Task + Event creation) is in `src/services/salesforce.ts`. SOQL search is in `src/services/salesforce-search.ts`.

Set `MEGAMINNIE_DRY_RUN=true` to run the full pipeline and preview output without writing to Salesforce.

### Key Environment Variables

See `.env.example` for the full list with descriptions. The most important:

| Variable | Purpose |
|---|---|
| `LLM_PROVIDER` | `anthropic` (default) or `openai` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | LLM credentials |
| `WHISPER_BASE_URL` | Local Whisper endpoint (Docker, port 8000) |
| `WHISPER_PROFILE` | Cloud transcription quality: `quality`, `diarize`, `fast` |
| `SF_CLIENT_ID`, `SF_CLIENT_SECRET`, etc. | Salesforce OAuth |
| `MEGAMINNIE_DRY_RUN` | Preview mode — no Salesforce writes |
| `MEGAMINNIE_KEEP_INPUT` | Keep uploaded files instead of auto-deleting |

## Project Layout

```
src/
  index.ts              # Express app entry point
  routes/               # HTTP route handlers
  services/             # Business logic (pipeline, SF sync, transcription)
  agent/                # LLM prompt + execution logic
  lib/                  # Config loaders, SDK wrappers, utilities
  types/                # Shared TypeScript interfaces
public/
  index.html            # Single-page app
  js/                   # Frontend ES modules (no framework)
  css/styles.css
  templates/            # Word template (bundled at build time)
tests/                  # Vitest test files
docs/
  SALESFORCE.md         # Salesforce Connected App setup & troubleshooting
```

## Deployment

- **Docker:** `Dockerfile` (multi-stage Alpine, Node 22), `docker-compose.yml`
- **Vercel:** `vercel.json` configures the build; Express runs as a serverless function
- **Local Whisper:** `docker-compose.whisper.yml` runs faster-whisper on port 8000

## Testing Notes

Tests live in `tests/` and use Vitest. There is no test database — tests mock external services (LLM, Salesforce, Whisper). The `pretest` hook auto-runs `bundle:docx` before each test run.
