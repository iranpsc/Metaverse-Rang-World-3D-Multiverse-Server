import {
    createVoiceRecordingHttpHandler
} from "../recording/createVoiceRecordingHttpHandler.js";

import {
    VoiceRecordingDownloadService
} from "../recording/voiceRecordingDownloadService.js";

import {
    VoiceRecordingService
} from "../recording/voiceRecordingService.js";

import {
    VoiceRecordingStopReason
} from "../recording/voiceRecordingConstants.js";

//* این تابع سرویس ضبط، دانلود و Handler HTTP را روی Bucket محلی تعیین‌شده می‌سازد.
function createVoiceV5RuntimeServices({
    storageRoot,
    resolveUserFromRequest,
    recordingPolicy = {},
    logger = null,
    now = () => Date.now()
} = {}) {
    const recordingService =
        new VoiceRecordingService({
            storageRoot,
            policy: recordingPolicy,
            now
        });

    const recordingDownloadService =
        new VoiceRecordingDownloadService({
            storageRoot
        });

    const recordingHttpHandler =
        createVoiceRecordingHttpHandler({
            downloadService:
                recordingDownloadService,
            resolveUserFromRequest,
            logger
        });

    //* این تابع Bucket را پیش از پذیرش ترافیک می‌سازد و بازیابی Crash را اجرا می‌کند.
    async function initializeStorage() {
        return recordingService.initializeStorage();
    }

    //* این تابع ایجاد، تغییر عضویت و بسته‌شدن Session قطعی را به چرخه ضبط متصل می‌کند.
    async function handleDedicatedSessionEvent({
        event,
        applyResult
    } = {}) {
        const result =
            applyResult?.data?.result;

        if (event?.type === "session_created") {
            const session =
                result?.session;

            if (session) {
                recordingService.registerSession(session);
            }

            return;
        }

        if (event?.type === "member_joined") {
            if (result?.session) {
                recordingService.synchronizeSessionMembership(
                    result.session,
                    {
                        effectiveAtMs:
                            event.effectiveAtMs
                    }
                );
            }

            return;
        }

        if (event?.type === "member_left") {
            if (
                result?.closed !== true &&
                result?.session
            ) {
                recordingService.synchronizeSessionMembership(
                    result.session,
                    {
                        effectiveAtMs:
                            event.effectiveAtMs
                    }
                );
                return;
            }

            await recordingService.finalizeSession(
                event.sessionId,
                VoiceRecordingStopReason
                    .SESSION_CLOSED
            );
            return;
        }

        if (
            event?.type === "session_closed"
        ) {
            await recordingService.finalizeSession(
                event.sessionId,
                VoiceRecordingStopReason
                    .SESSION_CLOSED
            );
        }
    }

    //* این تابع آمار محدود ضبط را برای Health برمی‌گرداند.
    function getStats() {
        return recordingService.getStats();
    }

    async function stop() {
        return recordingService.finalizeAll(
            VoiceRecordingStopReason.SERVER_SHUTDOWN
        );
    }

    return Object.freeze({
        recordingService,
        recordingDownloadService,
        recordingHttpHandler,
        initializeStorage,
        handleDedicatedSessionEvent,
        stop,
        getStats
    });
}

export {
    createVoiceV5RuntimeServices
};

/*
توضیح فایل:
این فایل سرویس‌های V5 را بدون بازکردن پورت جدید می‌سازد و Handler دانلود را برای نصب روی HTTP اصلی برمی‌گرداند.
*/
