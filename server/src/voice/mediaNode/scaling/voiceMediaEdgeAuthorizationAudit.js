import { VoiceAuthResultCodeNameByValue } from "../../auth/voiceAuthConstants.js";
import { VoiceConnectionStateNameByValue } from "../../core/voiceConnectionConstants.js";
import { VoiceMediaAuthorizationReason } from "../../security/voiceMediaBindAuthorizationPolicy.js";

const ALLOWED_REASONS = new Set(Object.values(VoiceMediaAuthorizationReason));
const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const DEFAULT_INTERVAL_MS = 10_000;
const MAX_TRACKED_KEYS = 512;

//* این تابع فقط علت رد مجوز مسیر رسانه مرورگر را در لاگ خصوصی ثبت می کند.
function createVoiceMediaEdgeAuthorizationAudit({
    write = (line) => console.warn(line),
    now = () => Date.now(),
    intervalMs = DEFAULT_INTERVAL_MS
} = {}) {
    const recent = new Map();

    //* این تابع فقط مقادیر شناخته شده را برای لاگ انتخاب می کند.
    function codeName(map, number) {
        return Number.isInteger(number) && Object.hasOwn(map, number) ? map[number] : "unknown";
    }

    //* این تابع رخدادهای تکراری را محدود می کند و هیچ داده محرمانه ای نمی نویسد.
    function recordDenied({ transport, reason, verifyCode, controlStateCode, controlConnectionId } = {}) {
        if (transport !== "ws") return false;
        try {
            const safeReason = ALLOWED_REASONS.has(reason) ? reason : "unknown";
            const safeVerifyCode = codeName(VoiceAuthResultCodeNameByValue, verifyCode);
            const safeControlState = codeName(VoiceConnectionStateNameByValue, controlStateCode);
            const rawId = String(controlConnectionId ?? "").trim().toLowerCase();
            const safeId = UUID_PATTERN.test(rawId) ? rawId : "invalid";
            const current = Number(now());
            if (!Number.isFinite(current)) return false;
            const key = `${safeId}|${safeReason}|${safeVerifyCode}|${safeControlState}`;
            const previous = recent.get(key);
            const minimumInterval = Number.isFinite(intervalMs) && intervalMs >= 0 ? intervalMs : DEFAULT_INTERVAL_MS;
            if (previous && current - previous.at < minimumInterval && current >= previous.at) {
                previous.suppressed += 1;
                return false;
            }
            const suppressedPrevious = previous?.suppressed ?? 0;
            recent.delete(key);
            recent.set(key, { at: current, suppressed: 0 });
            while (recent.size > MAX_TRACKED_KEYS) recent.delete(recent.keys().next().value);
            const line =
                "VME2_PHASE11_MEDIA_EDGE_AUTH_DIAG=DENIED" +
                " | transport=ws" +
                ` | connectionId=${safeId}` +
                ` | reason=${safeReason}` +
                ` | code=${safeVerifyCode}` +
                ` | controlState=${safeControlState}` +
                ` | suppressedPrevious=${suppressedPrevious}` +
                " | media_edge_authorization_failed";
            write(line);
            return true;
        } catch {
            // خطای گزارش گیری نباید نتیجه اعتبارسنجی را تغییر دهد.
            return false;
        }
    }

    return Object.freeze({ recordDenied });
}

export { createVoiceMediaEdgeAuthorizationAudit };
