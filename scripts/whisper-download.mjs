/**
 * Download het STT-model naar de lokale Speaches-server.
 * Gebruik: npm run whisper:download
 */
const base = (process.env.WHISPER_BASE_URL || "http://127.0.0.1:8000/v1").replace(
  /\/v1\/?$/,
  "",
);
const model =
  process.env.WHISPER_MODEL?.trim() || "Systran/faster-whisper-medium";

async function main() {
  const health = await fetch(`${base}/health`);
  if (!health.ok) {
    console.error(
      `Speaches niet bereikbaar op ${base}. Start eerst: npm run whisper:up`,
    );
    process.exit(1);
  }

  const list = await fetch(`${base}/v1/models`).then((r) => r.json());
  if (list.data?.some((m) => m.id === model)) {
    console.log(`Model al aanwezig: ${model}`);
    return;
  }

  console.log(`Model downloaden: ${model} (kan enkele minuten duren)…`);
  const res = await fetch(`${base}/v1/models/${model}`, { method: "POST" });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Download mislukt (${res.status}): ${body}`);
    process.exit(1);
  }
  console.log(`Klaar: ${model}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
