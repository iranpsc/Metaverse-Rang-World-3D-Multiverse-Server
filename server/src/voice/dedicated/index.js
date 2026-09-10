// مسیر فایل: src/voice/dedicated/index.js

export {
    MAX_BATCH_EVENT_COUNT,
    VoiceDedicatedSessionDeltaEventType,
    VoiceDedicatedSessionDeltaService,
    normalizeVoiceDedicatedSessionDeltaBatch,
    normalizeVoiceDedicatedSessionDeltaEvent
} from "./voiceDedicatedSessionDeltaService.js";

export {
    VOICE_DEDICATED_SESSION_DELTA_MAX_BODY_BYTES,
    VOICE_DEDICATED_SESSION_DELTA_PATH,
    createVoiceDedicatedSessionDeltaHttpHandler,
    readVoiceDedicatedJsonBody,
    readVoiceDedicatedRequestPath
} from "./createVoiceDedicatedSessionDeltaHttpHandler.js";

export {
    createVoiceDedicatedSessionDeltaRuntime
} from "./createVoiceDedicatedSessionDeltaRuntime.js";

/*
توضیح فایل:
این فایل سرویس دریافت رویدادهای سشن صوتی و هندلر اچ‌تی‌تی‌پی آن را از یک مسیر واحد صادر می‌کند.
*/
