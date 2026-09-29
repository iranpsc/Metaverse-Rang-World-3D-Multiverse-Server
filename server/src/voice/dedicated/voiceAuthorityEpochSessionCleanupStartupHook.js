import {
    VoiceDedicatedSessionDeltaService
} from "./voiceDedicatedSessionDeltaService.js";

import {
    VoiceAuthorityEpochSessionCleanupAdapter
} from "./voiceAuthorityEpochSessionCleanupAdapter.js";

const enabled =
    ["1", "true", "yes", "on"].includes(
        String(
            process.env.VOICE_AUTHORITY_EPOCH_SESSION_CLEANUP_ENABLED ?? ""
        ).trim().toLowerCase()
    );

const installationKey =
    Symbol.for(
        "network_a.voice.authority_epoch_session_cleanup_hook"
    );

if (
    enabled &&
    globalThis[installationKey] !== true
) {
    const originalAcceptBatch =
        VoiceDedicatedSessionDeltaService
            .prototype
            .acceptBatch;

    const adapters =
        new WeakMap();

    VoiceDedicatedSessionDeltaService
        .prototype
        .acceptBatch =
        function acceptBatchWithAuthorityEpochSessionCleanup(
            ctx = {},
            request = {}
        ) {
            let adapter =
                adapters.get(this);

            if (!adapter) {
                adapter =
                    new VoiceAuthorityEpochSessionCleanupAdapter({
                        service:
                            this,

                        baseAcceptBatch:
                            originalAcceptBatch,

                        logger:
                            this.logger
                    });

                adapters.set(
                    this,
                    adapter
                );
            }

            return adapter.acceptBatch(
                ctx,
                request
            );
        };

    globalThis[installationKey] =
        true;

    console.log(
        "VOICE_AUTHORITY_EPOCH_SESSION_CLEANUP_HOOK=READY | platformScope=all | stableFilesChanged=false"
    );
}

/*
توضیح فایل:
این راه‌انداز بدون تغییر فایل‌های پایدار، آداپتر پاک‌سازی تغییر اجرای مرجع را روی سرویس رویدادهای سرور اختصاصی نصب می‌کند و برای همه پلتفرم‌ها یک رفتار مشترک نگه می‌دارد.
*/
