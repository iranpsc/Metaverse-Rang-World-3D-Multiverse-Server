import {
    VoiceDedicatedSessionDeltaEventType,
    normalizeVoiceDedicatedSessionDeltaBatch
} from "./voiceDedicatedSessionDeltaService.js";

import {
    VoiceSessionReason
} from "../session/voiceSessionConstants.js";

class VoiceAuthorityEpochSessionCleanupAdapter {
    constructor({
        service,
        baseAcceptBatch,
        now = () => Date.now(),
        logger = null
    } = {}) {
        if (
            !service ||
            typeof baseAcceptBatch !== "function" ||
            !(service.sequenceStateByServerId instanceof Map) ||
            typeof service.dedicatedServerHandler?.verifyDedicatedServerToken !== "function" ||
            typeof service.gameServerRegistry?.hasServer !== "function" ||
            typeof service.voiceAuthoritativeSessionService?.cleanupDedicatedServer !== "function" ||
            typeof service.notifyEventApplied !== "function" ||
            typeof now !== "function"
        ) {
            throw new TypeError(
                "Voice authority epoch cleanup adapter dependencies are incomplete."
            );
        }

        this.service = service;
        this.baseAcceptBatch = baseAcceptBatch;
        this.now = now;
        this.logger = logger;
        this.queueTailByServerId = new Map();
        Object.seal(this);
    }

    //* این تابع دسته معتبر هر سرور را به صورت ترتیبی پردازش می‌کند تا دو تغییر همزمان Epoch هم‌پوشانی نسازند.
    async acceptBatch(
        ctx = {},
        request = {}
    ) {
        let batch;

        try {
            batch =
                normalizeVoiceDedicatedSessionDeltaBatch(
                    request
                );
        } catch {
            return this.baseAcceptBatch.call(
                this.service,
                ctx,
                request
            );
        }

        const previousTail =
            this.queueTailByServerId.get(
                batch.serverId
            ) ?? Promise.resolve();

        const currentTask =
            previousTail
                .catch(() => undefined)
                .then(() =>
                    this.acceptSerializedBatch(
                        ctx,
                        request,
                        batch
                    )
                );

        this.queueTailByServerId.set(
            batch.serverId,
            currentTask
        );

        try {
            return await currentTask;
        } finally {
            if (
                this.queueTailByServerId.get(
                    batch.serverId
                ) === currentTask
            ) {
                this.queueTailByServerId.delete(
                    batch.serverId
                );
            }
        }
    }

    //* این تابع فقط پس از اعتبارسنجی هویت سرور، نشست‌های Epoch قبلی را می‌بندد و اعلان قطعی آن‌ها را کامل می‌کند.
    async acceptSerializedBatch(
        ctx,
        request,
        batch
    ) {
        const authResult =
            this.service.dedicatedServerHandler
                .verifyDedicatedServerToken(
                    ctx,
                    request,
                    {
                        serverId:
                            batch.serverId
                    }
                );

        if (authResult?.success !== true) {
            return Object.freeze({
                ...authResult,
                httpStatusCode:
                    401
            });
        }

        if (
            !this.service.gameServerRegistry
                .hasServer(
                    batch.serverId
                )
        ) {
            return this.baseAcceptBatch.call(
                this.service,
                ctx,
                request
            );
        }

        const sequenceState =
            this.service.sequenceStateByServerId
                .get(
                    batch.serverId
                );

        const firstSourceSequence =
            batch.events[0]
                .sourceSequence;

        const isFreshEpoch =
            sequenceState &&
            sequenceState.currentEpochId !==
                batch.authorityEpochId &&
            !sequenceState.burnedEpochIds.has(
                batch.authorityEpochId
            ) &&
            firstSourceSequence === 1;

        if (isFreshEpoch) {
            await this.closePreviousEpochSessions({
                serverId:
                    batch.serverId,

                previousAuthorityEpochId:
                    sequenceState.currentEpochId,

                currentAuthorityEpochId:
                    batch.authorityEpochId
            });
        }

        return this.baseAcceptBatch.call(
            this.service,
            ctx,
            request
        );
    }

    //* این تابع خروجی Cleanup موجود را به رویداد بسته‌شدن قابل مصرف برای مسیریابی و ضبط تبدیل می‌کند.
    async closePreviousEpochSessions({
        serverId,
        previousAuthorityEpochId,
        currentAuthorityEpochId
    }) {
        const effectiveAtMs =
            this.now();

        const closedSessions =
            this.service.voiceAuthoritativeSessionService
                .cleanupDedicatedServer(
                    serverId,
                    {
                        effectiveAtMs
                    }
                );

        let notificationAttemptCount = 0;

        for (
            const session
            of closedSessions
        ) {
            const participants =
                Array.isArray(session?.participants)
                    ? session.participants
                    : [];

            const firstParticipant =
                participants[0] ?? {};

            const secondParticipant =
                participants[1] ?? {};

            await this.service.notifyEventApplied(
                Object.freeze({
                    type:
                        VoiceDedicatedSessionDeltaEventType
                            .SESSION_CLOSED,

                    authority:
                        "dedicated_server",

                    authorityEpochId:
                        previousAuthorityEpochId,

                    sourceSequence:
                        0,

                    serverId,

                    roomId:
                        session.roomId,

                    sessionId:
                        session.sessionId,

                    firstUserId:
                        firstParticipant.userId ?? "",

                    firstConnectionId:
                        firstParticipant.connectionId ?? "",

                    secondUserId:
                        secondParticipant.userId ?? "",

                    secondConnectionId:
                        secondParticipant.connectionId ?? "",

                    memberUserId:
                        "",

                    memberConnectionId:
                        "",

                    distanceMeters:
                        Number(session.distanceMeters ?? 0),

                    reason:
                        VoiceSessionReason
                            .DEDICATED_DISCONNECTED,

                    effectiveAtMs
                }),
                Object.freeze({
                    success:
                        true,

                    applied:
                        true,

                    reason:
                        "voice_delta_authority_epoch_session_closed",

                    message:
                        "Voice session closed during dedicated authority epoch handoff.",

                    data: Object.freeze({
                        result: Object.freeze({
                            closed:
                                true,

                            idempotent:
                                false,

                            session
                        })
                    }),

                    httpStatusCode:
                        200
                })
            );

            notificationAttemptCount += 1;
        }

        const summary =
            "VOICE_AUTHORITY_EPOCH_SESSION_HANDOFF=APPLIED" +
            " | serverId=" + serverId +
            " | previousAuthorityEpochId=" + previousAuthorityEpochId +
            " | currentAuthorityEpochId=" + currentAuthorityEpochId +
            " | closedSessions=" + closedSessions.length +
            " | notificationAttempts=" + notificationAttemptCount;

        if (typeof this.logger?.info === "function") {
            this.logger.info(summary);
        } else {
            console.log(summary);
        }

        return Object.freeze({
            closedSessions:
                closedSessions.length,

            notificationAttempts:
                notificationAttemptCount
        });
    }
}

export {
    VoiceAuthorityEpochSessionCleanupAdapter
};

/*
توضیح فایل:
این آداپتر هنگام تغییر اجرای مرجع سرور اختصاصی، نشست‌های اجرای قبلی را از همان مسیر رسمی می‌بندد و پیش از پذیرش نشست تازه، اعلان بسته‌شدن را به مسیریابی و ضبط تحویل می‌دهد.
*/
