/**
 * Microfoon/camera-hulp voor mobiel en desktop (Vercel/https).
 * iOS en Android: getUserMedia zo vroeg mogelijk na een tik (niet na lange await-ketens).
 */

/** @typedef {MediaTrackConstraints | boolean | { echoCancellation?: boolean; noiseSuppression?: boolean; autoGainControl?: boolean }} AudioConstraintInput */

const DEFAULT_AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/**
 * @param {AudioConstraintInput} [audio]
 * @returns {MediaStreamConstraints}
 */
export function buildMicrophoneConstraints(audio = true) {
  if (audio === true) {
    return { audio: { ...DEFAULT_AUDIO_CONSTRAINTS } };
  }
  if (audio === false) {
    return { audio: true };
  }
  return { audio };
}

/** @param {string} [userAgent] */
export function getMobilePlatform(userAgent = globalThis.navigator?.userAgent ?? "") {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  return "other";
}

/**
 * In-app browsers (Teams, LinkedIn, Facebook, …) blokkeren microfoon vaak op Android én iOS.
 * @param {string} [userAgent]
 */
export function isLikelyInAppBrowser(userAgent = globalThis.navigator?.userAgent ?? "") {
  if (/FBAN|FBAV|Instagram|LinkedInApp|Line\/|MicroMessenger|Twitter/i.test(userAgent)) {
    return true;
  }
  if (/Android/i.test(userAgent) && /; wv\)|WebView/i.test(userAgent)) {
    return true;
  }
  return false;
}

/** @returns {boolean} */
export function isMicrophoneApiAvailable() {
  return Boolean(
    typeof window !== "undefined" &&
      window.isSecureContext &&
      navigator.mediaDevices?.getUserMedia,
  );
}

/** @returns {string} */
export function getMicrophoneUnavailableMessage() {
  if (typeof window === "undefined") {
    return "Microfoon is niet beschikbaar in deze omgeving.";
  }
  if (!window.isSecureContext) {
    return (
      "Microfoon werkt alleen via een beveiligde verbinding (https). " +
      "Open MegaMinnie via je Vercel-URL (https://…), niet via http of een tussenliggende proxy."
    );
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    const inApp = isLikelyInAppBrowser();
    const platform = getMobilePlatform();
    if (inApp) {
      return (
        "Microfoon werkt hier waarschijnlijk niet (ingebouwde app-browser). " +
        "Open MegaMinnie in Chrome of Safari: menu → 'Openen in browser' / kopieer de https-URL."
      );
    }
    if (platform === "android") {
      return (
        "Deze browser ondersteunt geen microfoon-opname. " +
        "Gebruik Chrome op Android, of kies een audiobestand."
      );
    }
    return (
      "Deze browser ondersteunt geen microfoon-opname in de webapp. " +
      "Probeer Chrome of Safari op je telefoon, of kies een audiobestand."
    );
  }
  return "Microfoon niet beschikbaar.";
}

/** @returns {string} */
function microphonePermissionHint() {
  const platform = getMobilePlatform();
  if (platform === "android") {
    return (
      "Tik opnieuw op de knop en kies Toestaan. " +
      "Android: Instellingen → Apps → Chrome → Machtigingen → Microfoon, " +
      "of Site-instellingen (slot-icoon in de adresbalk) → Microfoon toestaan. " +
      "Sluit andere apps die de microfoon gebruiken."
    );
  }
  if (platform === "ios") {
    return (
      "Tik opnieuw op de knop en kies Toestaan. " +
      "iPhone: Instellingen → Safari (of Chrome) → Microfoon voor deze site. " +
      "Sluit andere apps die de microfoon gebruiken."
    );
  }
  return (
    "Tik opnieuw op de knop, kies Toestaan, en controleer de microfoon-instellingen van je browser voor deze site."
  );
}

/**
 * @param {DOMException | Error | unknown} err
 * @param {{ feature?: string }} [opts]
 * @returns {string}
 */
export function formatMicrophoneError(err, opts = {}) {
  const feature = opts.feature ?? "Opnemen";
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      const inApp = isLikelyInAppBrowser();
      const base = `${feature}: microfoon geweigerd. ${microphonePermissionHint()}`;
      if (inApp) {
        return `${base} Tip: open de pagina in Chrome/Safari, niet in een ingebouwde app-browser.`;
      }
      return base;
    }
    if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
      return `${feature}: geen microfoon gevonden op dit apparaat.`;
    }
    if (err.name === "NotReadableError" || err.name === "TrackStartError") {
      return (
        `${feature}: microfoon is in gebruik door een andere app. ` +
        "Sluit telefoon/gespreksapps en probeer opnieuw."
      );
    }
    if (err.name === "SecurityError") {
      return getMicrophoneUnavailableMessage();
    }
  }
  const raw = err instanceof Error ? err.message : String(err ?? "");
  if (/secure|https|insecure/i.test(raw)) {
    return getMicrophoneUnavailableMessage();
  }
  return `${feature}: microfoon niet beschikbaar. ${raw}`.trim();
}

/**
 * @param {DOMException | Error | unknown} err
 * @param {{ feature?: string }} [opts]
 */
export function alertMicrophoneError(err, opts = {}) {
  alert(formatMicrophoneError(err, opts));
}

/**
 * @param {MediaStreamConstraints} [constraints]
 * @returns {Promise<MediaStream>}
 */
export async function requestMicrophoneStream(constraints = buildMicrophoneConstraints()) {
  if (!isMicrophoneApiAvailable()) {
    throw new DOMException(getMicrophoneUnavailableMessage(), "SecurityError");
  }
  return navigator.mediaDevices.getUserMedia(constraints);
}

/** iOS: vaak audio/mp4; Android Chrome: meestal webm; desktop: webm. */
export function pickSupportedAudioMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const platform = getMobilePlatform();
  const candidates =
    platform === "ios"
      ? ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"]
      : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return "";
}

/**
 * @param {AudioContext} ctx
 */
export async function resumeAudioContext(ctx) {
  if (ctx?.state === "suspended") {
    await ctx.resume();
  }
}

/** @param {MediaStream | null | undefined} stream */
export function stopMediaStream(stream) {
  stream?.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      /* noop */
    }
  });
}
