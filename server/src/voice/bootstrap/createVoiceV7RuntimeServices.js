import {
    VoiceCapacityController
} from "../capacity/voiceCapacityController.js";

import {
    createVoiceOperationalHttpHandler
} from "../observability/createVoiceOperationalHttpHandler.js";

import {
    VoiceOperationalMetrics
} from "../observability/voiceOperationalMetrics.js";

import {
    VoiceSecurityAuditLogger
} from "../security/voiceSecurityAuditLogger.js";

//* این تابع Metrics، Audit، Capacity و HTTP Health محافظت‌شده V7 را می‌سازد.
function createVoiceV7RuntimeServices({
    getRuntimeStats,
    authorizeMetricsRequest = async () => false,
    capacityPolicy = {},
    logger = null,
    now = () => Date.now()
} = {}) {
    if (typeof getRuntimeStats !== "function") throw new TypeError("getRuntimeStats is required.");

    const metrics = new VoiceOperationalMetrics({ now });
    const auditLogger = new VoiceSecurityAuditLogger({ logger });
    const capacityController = new VoiceCapacityController({ policy: capacityPolicy });

    const operationalHttpHandler = createVoiceOperationalHttpHandler({
        authorizeMetricsRequest,
        getHealthSnapshot: async () => {
            const runtime = await getRuntimeStats();
            return Object.freeze({
                healthy: runtime?.stopped !== true,
                transportStarted: runtime?.transportStarted === true,
                connections: runtime?.connections ?? 0,
                sessions: runtime?.sessions ?? 0,
                recordings: runtime?.recordings ?? 0
            });
        },
        getMetricsSnapshot: async () => Object.freeze({
            operational: metrics.getSnapshot(),
            audit: auditLogger.getStats(),
            runtime: await getRuntimeStats()
        })
    });

    return Object.freeze({
        metrics,
        auditLogger,
        capacityController,
        operationalHttpHandler,
        getStats: () => Object.freeze({
            operational: metrics.getSnapshot(),
            audit: auditLogger.getStats()
        })
    });
}

export { createVoiceV7RuntimeServices };

/*
توضیح فایل:
این فایل اجزای V7 را بدون پورت جدید می‌سازد و Handler آن‌ها را برای نصب روی HTTP اصلی برمی‌گرداند.
*/
