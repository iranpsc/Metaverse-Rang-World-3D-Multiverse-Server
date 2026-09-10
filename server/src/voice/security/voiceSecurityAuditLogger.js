const ALLOWED_AUDIT_FIELDS = Object.freeze(new Set([
    "event", "success", "reason", "userId", "connectionId", "sessionId", "roomId", "serverId",
    "platform", "transportName", "messageType", "dropReason", "count", "durationMs", "timestampMs"
]));

class VoiceSecurityAuditLogger {
    //* این سازنده Logger موجود و محدودکننده طول رویداد را دریافت می‌کند.
    constructor({ logger = null, maximumTextBytes = 256 } = {}) {
        if (!Number.isSafeInteger(maximumTextBytes) || maximumTextBytes <= 0) throw new RangeError("maximumTextBytes is invalid.");
        this.logger = logger;
        this.maximumTextBytes = maximumTextBytes;
        this.writtenEvents = 0;
        this.rejectedFields = 0;
    }

    //* این تابع فقط فیلدهای Whitelist را پاک‌سازی و به Audit Logger می‌فرستد.
    write(input = {}) {
        if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Voice audit input is invalid.");
        const safe = {};

        for (const [key, value] of Object.entries(input)) {
            if (!ALLOWED_AUDIT_FIELDS.has(key)) {
                this.rejectedFields += 1;
                continue;
            }

            if (typeof value === "string") {
                const text = value.trim();
                safe[key] = Buffer.byteLength(text, "utf8") <= this.maximumTextBytes
                    ? text
                    : Buffer.from(text, "utf8").subarray(0, this.maximumTextBytes).toString("utf8");
            } else if (typeof value === "number" || typeof value === "boolean") {
                safe[key] = value;
            }
        }

        safe.timestampMs = Number.isSafeInteger(safe.timestampMs) ? safe.timestampMs : Date.now();
        this.logger?.info?.("[VoiceSecurityAudit]", safe);
        this.writtenEvents += 1;
        return Object.freeze(safe);
    }

    getStats() {
        return Object.freeze({ writtenEvents: this.writtenEvents, rejectedFields: this.rejectedFields });
    }
}

export { ALLOWED_AUDIT_FIELDS, VoiceSecurityAuditLogger };

/*
توضیح فایل:
این فایل رویداد امنیتی Voice را فقط با Whitelist می‌نویسد و هر فیلد ناشناخته مانند accessToken، refreshToken یا داده صوتی را حذف می‌کند.
*/
