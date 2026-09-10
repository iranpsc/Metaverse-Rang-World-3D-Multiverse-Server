// مسیر فایل: src/voice/session/voiceAuthoritativeSessionService.js

import {
    VoiceSessionReason,
    VoiceSessionState,
    assertVoiceSessionReason
} from "./voiceSessionConstants.js";

import {
    VoiceSessionRegistry
} from "./voiceSessionRegistry.js";

const VoiceAuthoritativeSessionEventType =
    Object.freeze({
        SESSION_CREATED:
            "session_created",

        DISTANCE_UPDATED:
            "distance_updated",

        MEMBER_JOINED:
            "member_joined",

        MEMBER_LEFT:
            "member_left",

        SESSION_CLOSED:
            "session_closed"
    });

//* این تابع رویداد قطعی سرور اختصاصی را از نظر ساختار پایه بررسی می‌کند.
function normalizeVoiceAuthoritativeSessionEvent(
    event
) {
    if (
        !event ||
        typeof event !== "object" ||
        Array.isArray(event)
    ) {
        throw new TypeError(
            "Authoritative Voice session event must be an object."
        );
    }

    const type =
        String(
            event.type ?? ""
        ).trim();

    if (
        !Object.values(
            VoiceAuthoritativeSessionEventType
        ).includes(type)
    ) {
        throw new RangeError(
            `Unknown authoritative Voice session event type: ${type}.`
        );
    }

    if (
        event.authority !==
        "dedicated_server"
    ) {
        throw new Error(
            "Voice session event authority must be dedicated_server."
        );
    }

    return Object.freeze({
        ...event,
        type,
        authority:
            "dedicated_server"
    });
}

class VoiceAuthoritativeSessionService {
    //* این سازنده رجیستری سشن را برای اعمال رویدادهای قطعی سرور اختصاصی دریافت می‌کند.
    constructor({
        sessionRegistry =
            new VoiceSessionRegistry()
    } = {}) {
        if (
            !sessionRegistry ||
            typeof sessionRegistry
                .createPairSession !==
                "function" ||
            typeof sessionRegistry
                .addParticipant !==
                "function" ||
            typeof sessionRegistry
                .removeParticipant !==
                "function" ||
            typeof sessionRegistry
                .closeSession !==
                "function" ||
            typeof sessionRegistry
                .getStats !==
                "function"
        ) {
            throw new TypeError(
                "sessionRegistry does not provide the required Voice session interface."
            );
        }

        this.sessionRegistry =
            sessionRegistry;
    }

    //* این تابع یک رویداد قطعی را بر اساس نوع آن به عملیات مناسب سشن هدایت می‌کند.
    applyEvent(
        inputEvent
    ) {
        const event =
            normalizeVoiceAuthoritativeSessionEvent(
                inputEvent
            );

        if (
            event.type ===
            VoiceAuthoritativeSessionEventType
                .SESSION_CREATED
        ) {
            return this.applySessionCreated(
                event
            );
        }

        if (
            event.type ===
            VoiceAuthoritativeSessionEventType
                .DISTANCE_UPDATED
        ) {
            return this.applyDistanceUpdated(
                event
            );
        }

        if (
            event.type ===
            VoiceAuthoritativeSessionEventType
                .MEMBER_JOINED
        ) {
            return this.applyMemberJoined(
                event
            );
        }

        if (
            event.type ===
            VoiceAuthoritativeSessionEventType
                .MEMBER_LEFT
        ) {
            return this.applyMemberLeft(
                event
            );
        }

        return this.applySessionClosed(
            event
        );
    }

    //* این تابع رویداد ایجاد سشن زوجی را داخل رجیستری ثبت می‌کند.
    applySessionCreated(
        event
    ) {
        return this.sessionRegistry
            .createPairSession({
                sessionId:
                    event.sessionId,

                roomId:
                    event.roomId,

                serverId:
                    event.serverId,

                firstParticipant:
                    event.firstParticipant,

                secondParticipant:
                    event.secondParticipant,

                distanceMeters:
                    event.distanceMeters,

                reason:
                    VoiceSessionReason
                        .PROXIMITY_ENTER,

                effectiveAtMs:
                    event.effectiveAtMs
            });
    }

    //* این تابع فاصله قطعی تازه را فقط برای سشن فعال ثبت می‌کند.
    applyDistanceUpdated(
        event
    ) {
        const session =
            this.sessionRegistry
                .getBySessionId(
                    event.sessionId
                );

        if (!session) {
            throw new Error(
                "Voice session was not found for distance update."
            );
        }

        if (
            session.state !==
            VoiceSessionState.ACTIVE
        ) {
            throw new Error(
                "Only an active Voice session can receive a distance update."
            );
        }

        return Object.freeze({
            updated: true,

            session:
                session.updateDistance({
                    distanceMeters:
                        event.distanceMeters,

                    effectiveAtMs:
                        event.effectiveAtMs
                })
        });
    }

    //* این تابع عضو تأییدشده را بدون تغییر SessionId به سشن فعال اضافه می‌کند.
    applyMemberJoined(
        event
    ) {
        return this.sessionRegistry
            .addParticipant(
                event.sessionId,
                {
                    participant:
                        event.memberParticipant,

                    effectiveAtMs:
                        event.effectiveAtMs
                }
            );
    }

    //* این تابع عضو تعیین‌شده را از Group حذف می‌کند و برای Pair همان رفتار بسته‌شدن کامل را نگه می‌دارد.
    applyMemberLeft(
        event
    ) {
        const reason =
            assertVoiceSessionReason(
                event.reason
            );

        const memberUserId =
            String(
                event.memberUserId ??
                ""
            ).trim();

        const memberConnectionId =
            String(
                event.memberConnectionId ??
                ""
            ).trim();

        if (
            memberUserId.length === 0 ||
            memberConnectionId.length === 0
        ) {
            const session =
                this.sessionRegistry
                    .getBySessionId(
                        event.sessionId
                    );

            if (
                session?.state ===
                    VoiceSessionState.ACTIVE &&
                session.participants.length === 2
            ) {
                return this.sessionRegistry
                    .closeSession(
                        event.sessionId,
                        {
                            reason,

                            effectiveAtMs:
                                event.effectiveAtMs
                        }
                    );
            }

            throw new Error(
                "A Voice group member leave requires memberUserId and memberConnectionId."
            );
        }

        return this.sessionRegistry
            .removeParticipant(
                event.sessionId,
                {
                    participant: {
                        userId:
                            memberUserId,

                        avatarId:
                            memberUserId,

                        connectionId:
                            memberConnectionId
                    },

                    reason,

                    effectiveAtMs:
                        event.effectiveAtMs
                }
            );
    }

    //* این تابع بسته‌شدن قطعی سشن را به‌صورت تکرارپذیر داخل رجیستری اعمال می‌کند.
    applySessionClosed(
        event
    ) {
        const reason =
            assertVoiceSessionReason(
                event.reason ??
                VoiceSessionReason
                    .SESSION_CLOSED
            );

        return this.sessionRegistry
            .closeSession(
                event.sessionId,
                {
                    reason,

                    effectiveAtMs:
                        event.effectiveAtMs
                }
            );
    }

    //* این تابع قطع یک اتصال صوتی را به پاک‌سازی تمام سشن‌های همان اتصال تبدیل می‌کند.
    cleanupConnection(
        connectionId,
        {
            reason =
                VoiceSessionReason
                    .VOICE_DISCONNECTED,

            effectiveAtMs = Date.now()
        } = {}
    ) {
        return this.sessionRegistry
            .closeByConnectionId(
                connectionId,
                {
                    reason,
                    effectiveAtMs
                }
            );
    }

    //* این تابع خروج یا بسته‌شدن یک روم را به پاک‌سازی تمام سشن‌های فعال آن تبدیل می‌کند.
    cleanupRoom(
        roomId,
        {
            reason =
                VoiceSessionReason
                    .ROOM_LEFT,

            effectiveAtMs = Date.now()
        } = {}
    ) {
        return this.sessionRegistry
            .closeByRoomId(
                roomId,
                {
                    reason,
                    effectiveAtMs
                }
            );
    }

    //* این تابع قطع سرور اختصاصی را به پاک‌سازی تمام سشن‌های فعال آن تبدیل می‌کند.
    cleanupDedicatedServer(
        serverId,
        {
            effectiveAtMs = Date.now()
        } = {}
    ) {
        return this.sessionRegistry
            .closeByServerId(
                serverId,
                {
                    reason:
                        VoiceSessionReason
                            .DEDICATED_DISCONNECTED,

                    effectiveAtMs
                }
            );
    }

    //* این تابع آمار رجیستری سشن‌های قطعی را برمی‌گرداند.
    getStats() {
        return this.sessionRegistry
            .getStats();
    }
}

export {
    VoiceAuthoritativeSessionEventType,
    VoiceAuthoritativeSessionService,
    normalizeVoiceAuthoritativeSessionEvent
};

/*
توضیح فایل:
این فایل فقط رویدادهای عضویت صادرشده از سرور اختصاصی را می‌پذیرد. موقعیت گزارش‌شده مستقیم کلاینت پذیرفته نمی‌شود؛ خروج از Group عضو را حذف می‌کند و خروج از Pair همچنان همان سشن را می‌بندد.
*/
