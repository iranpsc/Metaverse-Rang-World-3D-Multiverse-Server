import {
    createVoiceRecordingHttpHandler
} from "../recording/createVoiceRecordingHttpHandler.js";

import { createVoiceWebRtcRecordingBridgeServer } from "../recording/voiceWebRtcRecordingBridgeServer.js";

import {
    VoiceRecordingDownloadService
} from "../recording/voiceRecordingDownloadService.js";

import {
    VoiceRecordingService
} from "../recording/voiceRecordingService.js";

import {
    VoiceRecordingStopReason
} from "../recording/voiceRecordingConstants.js";

import {
    VoiceSpatialSpoolStore
} from "../recordingSpatial/voiceSpatialSpoolStore.js";

import {
    createSpatialTimelineHttpHandler
} from "../recordingSpatial/voiceSpatialTimelineStartupHook.js";

import {
    PERSONAL_SPATIAL_PATH_PATTERN,
    createPersonalSpatialDownload,
    createPersonalSpatialHttpHandler
} from "../recordingSpatial/voicePersonalSpatialDownloadStartupHook.js";

import {
    createPersonalHrtfDownload
} from "../recordingHrtf/voicePersonalHrtfDownloadStartupHook.js";

import {
    createVoicePrimaryPersonalDownloadHandler
} from "../recordingHrtf/voicePrimaryPersonalDownloadHandler.js";

const SPATIAL_TIMELINE_PATH =
    "/game-server-control/dedicated/voice-spatial-timeline";

function readEnabledEnvironmentFlag(name) {
    return ["1", "true", "yes", "on"].includes(
        String(process.env[name] ?? "").trim().toLowerCase()
    );
}

//* این تابع سرویس ضبط، دانلود و Handler HTTP را روی Bucket محلی تعیین‌شده می‌سازد.
function createVoiceV5RuntimeServices({
    storageRoot,
    resolveUserFromRequest,
    recordingPolicy = {},
    serviceTokenService = null,
    logger = null,
    now = () => Date.now()
} = {}) {
    const recordingService =
        new VoiceRecordingService({
            storageRoot,
            policy: recordingPolicy,
            now
        });

    const recordingBridgeEnabled = readEnabledEnvironmentFlag("VME2_WEBRTC_RECORDING_BRIDGE_ENABLED");
    const recordingBridge = recordingBridgeEnabled
        ? createVoiceWebRtcRecordingBridgeServer({
            recordingService,
            secretBase64: process.env.VME2_WEBRTC_AUTH_SECRET,
            port: Number(process.env.VME2_WEBRTC_RECORDING_BRIDGE_PORT ?? 8768),
            logger
        }) : null;

    const recordingDownloadService =
        new VoiceRecordingDownloadService({
            storageRoot
        });

    const baseRecordingHttpHandler =
        createVoiceRecordingHttpHandler({
            downloadService:
                recordingDownloadService,
            resolveUserFromRequest,
            logger
        });

    const spatialTimelineEnabled =
        readEnabledEnvironmentFlag(
            "VOICE_SPATIAL_TIMELINE_ENABLED"
        );

    const personalSpatialDownloadEnabled =
        readEnabledEnvironmentFlag(
            "VOICE_PERSONAL_SPATIAL_DOWNLOAD_ENABLED"
        );

    const personalHrtfPrimaryDownloadEnabled =
        readEnabledEnvironmentFlag(
            "VOICE_PERSONAL_HRTF_PRIMARY_DOWNLOAD_ENABLED"
        );

    if (
        spatialTimelineEnabled &&
        (!serviceTokenService ||
            typeof serviceTokenService.verifyToken !== "function")
    ) {
        throw new TypeError(
            "serviceTokenService with verifyToken is required when Spatial Timeline is enabled."
        );
    }

    const spatialSpoolStore =
        spatialTimelineEnabled
            ? new VoiceSpatialSpoolStore({
                storageRoot
            })
            : null;

    const spatialTimelineHttpHandler =
        spatialTimelineEnabled
            ? createSpatialTimelineHttpHandler({
                store: spatialSpoolStore,
                serviceTokenService
            })
            : null;

    const personalSpatialHttpHandler =
        personalSpatialDownloadEnabled
            ? createPersonalSpatialHttpHandler({
                downloadService:
                    recordingDownloadService,
                resolveUserFromRequest
            })
            : null;

    const personalHrtfPrimaryDownloadHandler =
        personalHrtfPrimaryDownloadEnabled
            ? createVoicePrimaryPersonalDownloadHandler({
                downloadService:
                    recordingDownloadService,
                resolveUserFromRequest,
                datasetPath:
                    process.env.VOICE_HRTF_DATASET_PATH,
                spatialFallbackEnabled:
                    true,
                logger,
                createHrtfDownload:
                    createPersonalHrtfDownload,
                createSpatialDownload:
                    createPersonalSpatialDownload
            })
            : null;

    async function recordingHttpHandler(
        request,
        response
    ) {
        const parsedUrl = new URL(
            String(request?.url ?? "/"),
            "http://127.0.0.1"
        );

        if (
            spatialTimelineHttpHandler &&
            parsedUrl.pathname === SPATIAL_TIMELINE_PATH
        ) {
            await spatialTimelineHttpHandler(
                request,
                response
            );
            return true;
        }

        if (
            personalSpatialHttpHandler &&
            PERSONAL_SPATIAL_PATH_PATTERN.test(
                parsedUrl.pathname
            )
        ) {
            await personalSpatialHttpHandler(
                request,
                response
            );
            return true;
        }

        if (
            personalHrtfPrimaryDownloadHandler
        ) {
            const handled =
                await personalHrtfPrimaryDownloadHandler(
                    request,
                    response
                );

            if (handled) {
                return true;
            }
        }

        return baseRecordingHttpHandler(
            request,
            response
        );
    }

    //* این تابع Bucket را پیش از پذیرش ترافیک می‌سازد و بازیابی Crash را اجرا می‌کند.
    async function initializeStorage() {
        const result = await recordingService.initializeStorage();
        await recordingBridge?.start();
        return result;
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
        await recordingBridge?.stop();
        await spatialSpoolStore?.flush?.();

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
