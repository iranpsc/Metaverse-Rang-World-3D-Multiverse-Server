// مسیر فایل: src/voice/dedicated/voiceDedicatedSessionDeltaService.js

import {
    VoiceConnectionState
} from "../core/voiceConnectionConstants.js";

import {
    VoiceSessionReason,
    VoiceSessionState,
    assertVoiceSessionReason
} from "../session/voiceSessionConstants.js";

const VOICE_UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const VOICE_CONNECTION_ID_PATTERN =
    /^[0-9a-f]{32}$/;

const VoiceDedicatedSessionDeltaEventType =
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

const MAX_BATCH_EVENT_COUNT =
    1024;

const MAX_TEXT_BYTES =
    512;

//* این تابع پاسخ موفق استاندارد دریافت رویدادهای سرور اختصاصی را می‌سازد.
function createVoiceDedicatedDeltaSuccess(
    reason,
    message,
    data = {}
) {
    return Object.freeze({
        success:
            true,

        reason,
        message,
        data,

        ts:
            Date.now(),

        httpStatusCode:
            200
    });
}

//* این تابع پاسخ خطای استاندارد را همراه کد وضعیت اچ‌تی‌تی‌پی می‌سازد.
function createVoiceDedicatedDeltaFailure(
    reason,
    message,
    data = {},
    httpStatusCode = 400
) {
    return Object.freeze({
        success:
            false,

        reason,
        message,
        data,

        ts:
            Date.now(),

        httpStatusCode
    });
}

//* این تابع متن ضروری را پاک‌سازی و اندازه آن را کنترل می‌کند.
function normalizeRequiredVoiceDedicatedText(
    value,
    fieldName
) {
    if (
        typeof value !==
        "string"
    ) {
        throw new TypeError(
            `${fieldName} must be a string.`
        );
    }

    const normalizedValue =
        value.trim();

    if (!normalizedValue) {
        throw new Error(
            `${fieldName} is required.`
        );
    }

    if (
        Buffer.byteLength(
            normalizedValue,
            "utf8"
        ) >
        MAX_TEXT_BYTES
    ) {
        throw new RangeError(
            `${fieldName} exceeds ${MAX_TEXT_BYTES} UTF-8 bytes.`
        );
    }

    return normalizedValue;
}

//* این تابع شناسه یکتا را پاک‌سازی و اعتبارسنجی می‌کند.
function normalizeVoiceDedicatedUuid(
    value,
    fieldName
) {
    const normalizedValue =
        normalizeRequiredVoiceDedicatedText(
            value,
            fieldName
        ).toLowerCase();

    if (
        !VOICE_UUID_PATTERN.test(
            normalizedValue
        )
    ) {
        throw new TypeError(
            `${fieldName} must be a valid UUID.`
        );
    }

    return normalizedValue;
}

//* این تابع شناسه اتصال را بدون خط تیره و با حروف کوچک برای مقایسه قطعی آماده می‌کند.
function canonicalizeVoiceDedicatedConnectionId(
    value
) {
    const normalizedValue =
        String(value ?? "")
            .trim()
            .toLowerCase()
            .replaceAll("-", "");

    return VOICE_CONNECTION_ID_PATTERN
        .test(normalizedValue)
        ? normalizedValue
        : "";
}

//* این تابع وجود و قالب معتبر شناسه اتصال را برای ورودی قطعی الزامی می‌کند.
function normalizeVoiceDedicatedConnectionId(
    value,
    fieldName
) {
    const normalizedValue =
        canonicalizeVoiceDedicatedConnectionId(
            value
        );

    if (!normalizedValue) {
        throw new TypeError(
            `${fieldName} must contain 32 hexadecimal characters.`
        );
    }

    return normalizedValue;
}

//* این تابع شماره ترتیب رویداد را به عدد صحیح مثبت امن تبدیل می‌کند.
function normalizeVoiceDedicatedSourceSequence(
    value
) {
    if (
        !Number.isSafeInteger(value) ||
        value <= 0
    ) {
        throw new RangeError(
            "sourceSequence must be a positive safe integer."
        );
    }

    return value;
}

//* این تابع زمان رویداد را به عدد صحیح نامنفی امن تبدیل می‌کند.
function normalizeVoiceDedicatedEventTime(
    value
) {
    if (
        !Number.isSafeInteger(value) ||
        value < 0
    ) {
        throw new RangeError(
            "effectiveAtMs must be a non-negative safe integer."
        );
    }

    return value;
}

//* این تابع فاصله قطعی زوج را به عدد نامنفی محدود تبدیل می‌کند.
function normalizeVoiceDedicatedDistance(
    value
) {
    if (
        typeof value !==
            "number" ||
        !Number.isFinite(value) ||
        value < 0
    ) {
        throw new RangeError(
            "distanceMeters must be a finite non-negative number."
        );
    }

    return value;
}

//* این تابع یک رویداد سشن صوتی را با هویت ترکیبی شناسه کاربر و اتصال استاندارد می‌کند.
function normalizeVoiceDedicatedSessionDeltaEvent(
    event
) {
    if (
        !event ||
        typeof event !==
            "object" ||
        Array.isArray(event)
    ) {
        throw new TypeError(
            "Dedicated Voice session delta event must be an object."
        );
    }

    const type =
        normalizeRequiredVoiceDedicatedText(
            event.type,
            "event.type"
        );

    if (
        !Object.values(
            VoiceDedicatedSessionDeltaEventType
        ).includes(type)
    ) {
        throw new RangeError(
            `Unknown dedicated Voice session delta type: ${type}.`
        );
    }

    if (
        event.authority !==
        "dedicated_server"
    ) {
        throw new Error(
            "Dedicated Voice session delta authority must be dedicated_server."
        );
    }

    const firstUserId =
        normalizeRequiredVoiceDedicatedText(
            event.firstUserId,
            "event.firstUserId"
        );

    const secondUserId =
        normalizeRequiredVoiceDedicatedText(
            event.secondUserId,
            "event.secondUserId"
        );

    const firstConnectionId =
        normalizeVoiceDedicatedConnectionId(
            event.firstConnectionId,
            "event.firstConnectionId"
        );

    const secondConnectionId =
        normalizeVoiceDedicatedConnectionId(
            event.secondConnectionId,
            "event.secondConnectionId"
        );

    if (
        firstUserId ===
        secondUserId
    ) {
        throw new Error(
            "A dedicated Voice session delta requires two different userId values."
        );
    }

    if (
        firstConnectionId ===
        secondConnectionId
    ) {
        throw new Error(
            "A dedicated Voice session delta requires two different connectionId values."
        );
    }

    const reason =
        assertVoiceSessionReason(
            event.reason
        );

    const isMemberEvent =
        type ===
            VoiceDedicatedSessionDeltaEventType
                .MEMBER_JOINED ||
        type ===
            VoiceDedicatedSessionDeltaEventType
                .MEMBER_LEFT;

    const memberUserId =
        isMemberEvent
            ? normalizeRequiredVoiceDedicatedText(
                event.memberUserId,
                "event.memberUserId"
            )
            : "";

    const fallbackMemberConnectionId =
        memberUserId === firstUserId
            ? firstConnectionId
            : memberUserId === secondUserId
                ? secondConnectionId
                : "";

    const memberConnectionId =
        isMemberEvent
            ? normalizeVoiceDedicatedConnectionId(
                event.memberConnectionId ??
                    fallbackMemberConnectionId,
                "event.memberConnectionId"
            )
            : "";

    if (
        type ===
            VoiceDedicatedSessionDeltaEventType
                .MEMBER_LEFT &&
        memberUserId !== firstUserId &&
        memberUserId !== secondUserId
    ) {
        throw new Error(
            "memberUserId must belong to the dedicated Voice pair."
        );
    }

    if (
        type ===
            VoiceDedicatedSessionDeltaEventType
                .MEMBER_LEFT &&
        memberConnectionId !==
            (
                memberUserId === firstUserId
                    ? firstConnectionId
                    : secondConnectionId
            )
    ) {
        throw new Error(
            "memberConnectionId must match memberUserId."
        );
    }

    if (
        type ===
            VoiceDedicatedSessionDeltaEventType
                .MEMBER_JOINED &&
        (
            memberUserId === firstUserId ||
            memberUserId === secondUserId ||
            memberConnectionId === firstConnectionId ||
            memberConnectionId === secondConnectionId
        )
    ) {
        throw new Error(
            "member_joined requires a participant outside the anchor pair."
        );
    }

    if (
        type ===
            VoiceDedicatedSessionDeltaEventType
                .SESSION_CREATED &&
        reason !==
            VoiceSessionReason
                .PROXIMITY_ENTER
    ) {
        throw new Error(
            "session_created requires PROXIMITY_ENTER reason."
        );
    }

    if (
        type ===
            VoiceDedicatedSessionDeltaEventType
                .MEMBER_JOINED &&
        reason !==
            VoiceSessionReason
                .PROXIMITY_ENTER
    ) {
        throw new Error(
            "member_joined requires PROXIMITY_ENTER reason."
        );
    }

    if (
        type ===
            VoiceDedicatedSessionDeltaEventType
                .DISTANCE_UPDATED &&
        reason !==
            VoiceSessionReason.NONE
    ) {
        throw new Error(
            "distance_updated requires NONE reason."
        );
    }

    if (
        (
            type ===
                VoiceDedicatedSessionDeltaEventType
                    .MEMBER_LEFT ||
            type ===
                VoiceDedicatedSessionDeltaEventType
                    .SESSION_CLOSED
        ) &&
        reason ===
            VoiceSessionReason.NONE
    ) {
        throw new Error(
            "Closing a dedicated Voice session requires a close reason."
        );
    }

    return Object.freeze({
        type,

        authority:
            "dedicated_server",

        authorityEpochId:
            normalizeVoiceDedicatedUuid(
                event.authorityEpochId,
                "event.authorityEpochId"
            ),

        sourceSequence:
            normalizeVoiceDedicatedSourceSequence(
                event.sourceSequence
            ),

        serverId:
            normalizeRequiredVoiceDedicatedText(
                event.serverId,
                "event.serverId"
            ),

        roomId:
            normalizeRequiredVoiceDedicatedText(
                event.roomId,
                "event.roomId"
            ),

        sessionId:
            normalizeVoiceDedicatedUuid(
                event.sessionId,
                "event.sessionId"
            ),

        firstUserId,
        firstConnectionId,
        secondUserId,
        secondConnectionId,
        memberUserId,
        memberConnectionId,

        distanceMeters:
            normalizeVoiceDedicatedDistance(
                event.distanceMeters
            ),

        reason,

        effectiveAtMs:
            normalizeVoiceDedicatedEventTime(
                event.effectiveAtMs
            )
    });
}

//* این تابع درخواست دسته‌ای را پاک‌سازی و تمام رویدادهای آن را قفل می‌کند.
function normalizeVoiceDedicatedSessionDeltaBatch(
    request
) {
    if (
        !request ||
        typeof request !==
            "object" ||
        Array.isArray(request)
    ) {
        throw new TypeError(
            "Dedicated Voice session delta batch must be an object."
        );
    }

    const serverId =
        normalizeRequiredVoiceDedicatedText(
            request.serverId,
            "serverId"
        );

    const authorityEpochId =
        normalizeVoiceDedicatedUuid(
            request.authorityEpochId,
            "authorityEpochId"
        );

    if (
        !Array.isArray(
            request.events
        ) ||
        request.events.length === 0 ||
        request.events.length >
            MAX_BATCH_EVENT_COUNT
    ) {
        throw new RangeError(
            `events must contain between 1 and ${MAX_BATCH_EVENT_COUNT} items.`
        );
    }

    const events =
        request.events.map(
            normalizeVoiceDedicatedSessionDeltaEvent
        ).sort(
            (
                firstEvent,
                secondEvent
            ) =>
                firstEvent.sourceSequence -
                secondEvent.sourceSequence
        );

    for (
        const event
        of events
    ) {
        if (
            event.serverId !==
            serverId
        ) {
            throw new Error(
                "Every dedicated Voice delta must match the batch serverId."
            );
        }

        if (
            event.authorityEpochId !==
            authorityEpochId
        ) {
            throw new Error(
                "Every dedicated Voice delta must match the batch authorityEpochId."
            );
        }
    }

    return Object.freeze({
        serverId,
        authorityEpochId,

        events:
            Object.freeze(
                events
            )
    });
}

class VoiceDedicatedSessionDeltaService {
    //* این سازنده وابستگی‌های زنده احراز سرور، حضور بازیکن، اتصال صوتی و هسته سشن را دریافت می‌کند.
    constructor({
        dedicatedServerHandler,
        gameServerRegistry,
        gameSessionRegistry,
        voiceConnectionRegistry,
        voiceAuthoritativeSessionService,
        eventObserver = null,
        logger = null
    } = {}) {
        if (
            !dedicatedServerHandler ||
            typeof dedicatedServerHandler
                .verifyDedicatedServerToken !==
                "function"
        ) {
            throw new TypeError(
                "dedicatedServerHandler must provide verifyDedicatedServerToken."
            );
        }

        if (
            !gameSessionRegistry ||
            typeof gameSessionRegistry
                .findSessionByRoom !==
                "function" ||
            typeof gameSessionRegistry
                .isPublicSessionOpen !==
                "function"
        ) {
            throw new TypeError(
                "gameSessionRegistry does not provide the required interface."
            );
        }

        if (
            !gameServerRegistry ||
            typeof gameServerRegistry
                .hasServer !==
                "function"
        ) {
            throw new TypeError(
                "gameServerRegistry must provide hasServer."
            );
        }

        if (
            !voiceConnectionRegistry ||
            typeof voiceConnectionRegistry
                .listByUserId !==
                "function"
        ) {
            throw new TypeError(
                "voiceConnectionRegistry must provide listByUserId."
            );
        }

        if (
            !voiceAuthoritativeSessionService ||
            typeof voiceAuthoritativeSessionService
                .applyEvent !==
                "function" ||
            typeof voiceAuthoritativeSessionService
                .cleanupDedicatedServer !==
                "function"
        ) {
            throw new TypeError(
                "voiceAuthoritativeSessionService does not provide the required interface."
            );
        }

        this.dedicatedServerHandler =
            dedicatedServerHandler;

        this.gameServerRegistry =
            gameServerRegistry;

        this.gameSessionRegistry =
            gameSessionRegistry;

        this.voiceConnectionRegistry =
            voiceConnectionRegistry;

        this.voiceAuthoritativeSessionService =
            voiceAuthoritativeSessionService;

        if (
            eventObserver !== null &&
            typeof eventObserver !== "function"
        ) {
            throw new TypeError(
                "eventObserver must be null or a function."
            );
        }

        this.eventObserver =
            eventObserver;

        this.logger =
            logger;

        this.sequenceStateByServerId =
            new Map();

        this.stopped =
            false;
    }

    //* این تابع یک دسته رویداد را احراز، مرتب و به‌صورت تکرارپذیر روی هسته سشن اعمال می‌کند.
    async acceptBatch(
        ctx = {},
        request = {}
    ) {
        if (
            this.stopped
        ) {
            return createVoiceDedicatedDeltaFailure(
                "voice_delta_service_stopped",
                "Voice dedicated session delta service is stopped.",
                {},
                503
            );
        }

        let batch;

        try {
            batch =
                normalizeVoiceDedicatedSessionDeltaBatch(
                    request
                );
        } catch (error) {
            return createVoiceDedicatedDeltaFailure(
                "voice_delta_batch_invalid",
                error?.message ??
                    String(error),
                {
                    errorName:
                        error?.name ??
                        "Error"
                },
                400
            );
        }

        const authResult =
            this.dedicatedServerHandler
                .verifyDedicatedServerToken(
                    ctx,
                    request,
                    {
                        serverId:
                            batch.serverId
                    }
                );

        if (
            authResult?.success !==
            true
        ) {
            return Object.freeze({
                ...authResult,

                httpStatusCode:
                    401
            });
        }

        if (
            !this.gameServerRegistry
                .hasServer(
                    batch.serverId
                )
        ) {
            return createVoiceDedicatedDeltaFailure(
                "voice_delta_server_not_registered",
                "Dedicated server is not registered.",
                {
                    serverId:
                        batch.serverId
                },
                409
            );
        }

        const sequenceStateResult =
            this.resolveSequenceState(
                batch.serverId,
                batch.authorityEpochId,
                batch.events[0]
                    .sourceSequence
            );

        if (
            !sequenceStateResult
                .success
        ) {
            return sequenceStateResult
                .result;
        }

        const sequenceState =
            sequenceStateResult.state;

        let acceptedCount =
            0;

        let duplicateCount =
            0;

        let appliedCount =
            0;

        let ignoredCount =
            0;

        for (
            const event
            of batch.events
        ) {
            if (
                event.sourceSequence <=
                sequenceState
                    .lastAcceptedSequence
            ) {
                acceptedCount +=
                    1;

                duplicateCount +=
                    1;

                continue;
            }

            const expectedSequence =
                sequenceState
                    .lastAcceptedSequence +
                1;

            if (
                sequenceState
                    .lastAcceptedSequence >
                    0 &&
                event.sourceSequence !==
                    expectedSequence
            ) {
                return createVoiceDedicatedDeltaFailure(
                    "voice_delta_sequence_gap",
                    "Dedicated Voice source sequence is not contiguous.",
                    {
                        serverId:
                            batch.serverId,

                        authorityEpochId:
                            batch.authorityEpochId,

                        expectedSequence,

                        receivedSequence:
                            event.sourceSequence,

                        acceptedCount,
                        duplicateCount,
                        appliedCount,
                        ignoredCount
                    },
                    409
                );
            }

            const applyResult =
                this.applyEvent(
                    event
                );

            if (
                !applyResult.success
            ) {
                return createVoiceDedicatedDeltaFailure(
                    applyResult.reason,
                    applyResult.message,
                    {
                        ...applyResult.data,

                        serverId:
                            batch.serverId,

                        authorityEpochId:
                            batch.authorityEpochId,

                        failedSequence:
                            event.sourceSequence,

                        acceptedCount,
                        duplicateCount,
                        appliedCount,
                        ignoredCount
                    },
                    applyResult
                        .httpStatusCode
                );
            }

            if (applyResult.applied) {
                await this.notifyEventApplied(
                    event,
                    applyResult
                );
            }

            sequenceState
                .lastAcceptedSequence =
                event.sourceSequence;

            acceptedCount +=
                1;

            if (
                applyResult.applied
            ) {
                appliedCount +=
                    1;
            } else {
                ignoredCount +=
                    1;
            }
        }

        return createVoiceDedicatedDeltaSuccess(
            "voice_delta_batch_accepted",
            "Dedicated Voice session delta batch accepted.",
            {
                serverId:
                    batch.serverId,

                authorityEpochId:
                    batch.authorityEpochId,

                acceptedCount,
                duplicateCount,
                appliedCount,
                ignoredCount,

                lastAcceptedSequence:
                    sequenceState
                        .lastAcceptedSequence,

                sessionStats:
                    this.voiceAuthoritativeSessionService
                        .getStats()
            }
        );
    }

    //* این تابع Observer اختیاری مراحل بعدی را بدون تغییر قرارداد Delta تنظیم می‌کند.
    setEventObserver(observer) {
        if (
            observer !== null &&
            typeof observer !== "function"
        ) {
            throw new TypeError(
                "eventObserver must be null or a function."
            );
        }

        this.eventObserver = observer;
    }

    //* این تابع رویداد اعمال‌شده را به مراحل جانبی اعلام می‌کند و شکست آن‌ها را از Authority جدا نگه می‌دارد.
    async notifyEventApplied(event, applyResult) {
        if (!this.eventObserver) return;

        try {
            await this.eventObserver({
                event,
                applyResult
            });
        } catch (error) {
            this.logger?.error?.(
                "[VoiceDedicatedSessionDelta] Event observer failed.",
                {
                    eventType: event.type,
                    sessionId: event.sessionId,
                    error:
                        error?.message ?? String(error)
                }
            );
        }
    }

    //* این تابع وضعیت ترتیب یک سرور را برای اجرای جاری یا اجرای تازه سرور اختصاصی آماده می‌کند.
    resolveSequenceState(
        serverId,
        authorityEpochId,
        firstSourceSequence
    ) {
        let state =
            this.sequenceStateByServerId
                .get(
                    serverId
                );

        if (!state) {
            if (
                firstSourceSequence !==
                1
            ) {
                return {
                    success:
                        false,

                    result:
                        createVoiceDedicatedDeltaFailure(
                            "voice_delta_sequence_must_start_at_one",
                            "A dedicated Voice authority epoch must start at source sequence one.",
                            {
                                serverId,
                                authorityEpochId,
                                receivedSequence:
                                    firstSourceSequence
                            },
                            409
                        )
                };
            }

            state = {
                currentEpochId:
                    authorityEpochId,

                lastAcceptedSequence:
                    0,

                burnedEpochIds:
                    new Set()
            };

            this.sequenceStateByServerId
                .set(
                    serverId,
                    state
                );

            return {
                success:
                    true,

                state
            };
        }

        if (
            state.currentEpochId ===
            authorityEpochId
        ) {
            return {
                success:
                    true,

                state
            };
        }

        if (
            state.burnedEpochIds
                .has(
                    authorityEpochId
                )
        ) {
            return {
                success:
                    false,

                result:
                    createVoiceDedicatedDeltaFailure(
                        "voice_delta_authority_epoch_stale",
                        "Dedicated Voice authority epoch is stale.",
                        {
                            serverId,
                            authorityEpochId,

                            currentEpochId:
                                state
                                    .currentEpochId
                        },
                        409
                    )
            };
        }

        if (
            firstSourceSequence !==
            1
        ) {
            return {
                success:
                    false,

                result:
                    createVoiceDedicatedDeltaFailure(
                        "voice_delta_sequence_must_start_at_one",
                        "A new dedicated Voice authority epoch must start at source sequence one.",
                        {
                            serverId,
                            authorityEpochId,
                            receivedSequence:
                                firstSourceSequence
                        },
                        409
                    )
            };
        }

        this.voiceAuthoritativeSessionService
            .cleanupDedicatedServer(
                serverId,
                {
                    effectiveAtMs:
                        Date.now()
                }
            );

        state.burnedEpochIds
            .add(
                state.currentEpochId
            );

        state.currentEpochId =
            authorityEpochId;

        state.lastAcceptedSequence =
            0;

        return {
            success:
                true,

            state
        };
    }

    //* این تابع رویداد استاندارد را به عملیات ایجاد، تغییر فاصله یا بسته‌شدن هدایت می‌کند.
    applyEvent(
        event
    ) {
        if (
            event.type ===
            VoiceDedicatedSessionDeltaEventType
                .SESSION_CREATED
        ) {
            return this.applySessionCreated(
                event
            );
        }

        const session =
            this.voiceAuthoritativeSessionService
                .sessionRegistry
                .getBySessionId(
                    event.sessionId
                );

        if (!session) {
            return {
                success:
                    true,

                applied:
                    false,

                reason:
                    "voice_delta_session_already_absent",

                message:
                    "Voice session is already absent.",

                data:
                    {},

                httpStatusCode:
                    200
            };
        }

        const validation =
            this.validateEventAgainstSession(
                event,
                session
            );

        if (
            !validation.success
        ) {
            return validation;
        }

        if (
            event.type ===
            VoiceDedicatedSessionDeltaEventType
                .MEMBER_JOINED
        ) {
            return this.applyMemberJoined(
                event
            );
        }

        try {
            let eventForApply = event;

            if (
                event.type ===
                VoiceDedicatedSessionDeltaEventType
                    .MEMBER_LEFT
            ) {
                const storedMember =
                    session.participants.find(
                        (participant) =>
                            participant.userId ===
                                event.memberUserId &&
                            canonicalizeVoiceDedicatedConnectionId(
                                participant.connectionId
                            ) ===
                                event.memberConnectionId
                    ) ??
                    null;

                if (storedMember) {
                    eventForApply = {
                        ...event,
                        memberConnectionId:
                            storedMember.connectionId
                    };
                }
            }

            const result =
                this.voiceAuthoritativeSessionService
                    .applyEvent(
                        eventForApply
                    );

            const applied =
                event.type ===
                    VoiceDedicatedSessionDeltaEventType
                        .MEMBER_LEFT
                    ? result?.left === true ||
                        result?.closed === true
                    : event.type ===
                        VoiceDedicatedSessionDeltaEventType
                            .SESSION_CLOSED
                        ? result?.closed === true
                        : event.type ===
                            VoiceDedicatedSessionDeltaEventType
                                .DISTANCE_UPDATED
                            ? result?.updated === true
                            : result !== null;

            return {
                success:
                    true,

                applied,

                reason:
                    "voice_delta_event_applied",

                message:
                    "Dedicated Voice session delta applied.",

                data: {
                    result,
                    resolvedMemberConnectionId:
                        event.type ===
                            VoiceDedicatedSessionDeltaEventType
                                .MEMBER_LEFT
                            ? eventForApply.memberConnectionId
                            : ""
                },

                httpStatusCode:
                    200
            };
        } catch (error) {
            return {
                success:
                    false,

                applied:
                    false,

                reason:
                    "voice_delta_event_apply_failed",

                message:
                    error?.message ??
                    String(error),

                data: {
                    errorName:
                        error?.name ??
                        "Error"
                },

                httpStatusCode:
                    409
            };
        }
    }

    //* این تابع عضو تازه را در نشست بازی و اتصال صوتی فعال تأیید و سپس به SessionId پایدار اضافه می‌کند.
    applyMemberJoined(
        event
    ) {
        const memberVerification =
            this.resolveVerifiedPairParticipants({
                ...event,

                secondUserId:
                    event.memberUserId,

                secondConnectionId:
                    event.memberConnectionId
            });

        if (
            !memberVerification.success
        ) {
            return memberVerification;
        }

        try {
            const result =
                this.voiceAuthoritativeSessionService
                    .applyEvent({
                        ...event,

                        memberParticipant:
                            memberVerification
                                .secondParticipant
                    });

            return {
                success:
                    true,

                applied:
                    result?.joined ===
                    true,

                reason:
                    result?.idempotent ===
                    true
                        ? "voice_delta_member_joined_idempotent"
                        : "voice_delta_member_joined",

                message:
                    "Dedicated Voice group member accepted.",

                data: {
                    result
                },

                httpStatusCode:
                    200
            };
        } catch (error) {
            return {
                success:
                    false,

                applied:
                    false,

                reason:
                    "voice_delta_member_join_failed",

                message:
                    error?.message ??
                    String(error),

                data: {
                    errorName:
                        error?.name ??
                        "Error"
                },

                httpStatusCode:
                    409
            };
        }
    }

    //* این تابع ایجاد سشن را با حضور هر دو کاربر و اتصال صوتی فعال همان روم اعمال می‌کند.
    applySessionCreated(
        event
    ) {
        const membershipResult =
            this.resolveVerifiedPairParticipants(
                event
            );

        if (
            !membershipResult.success
        ) {
            return membershipResult;
        }

        try {
            const result =
                this.voiceAuthoritativeSessionService
                    .applyEvent({
                        ...event,

                        firstParticipant:
                            membershipResult
                                .firstParticipant,

                        secondParticipant:
                            membershipResult
                                .secondParticipant
                    });

            return {
                success:
                    true,

                applied:
                    result?.created ===
                    true,

                reason:
                    result?.idempotent ===
                    true
                        ? "voice_delta_session_created_idempotent"
                        : "voice_delta_session_created",

                message:
                    "Dedicated Voice pair session accepted.",

                data: {
                    result
                },

                httpStatusCode:
                    200
            };
        } catch (error) {
            return {
                success:
                    false,

                applied:
                    false,

                reason:
                    "voice_delta_session_create_failed",

                message:
                    error?.message ??
                    String(error),

                data: {
                    errorName:
                        error?.name ??
                        "Error"
                },

                httpStatusCode:
                    409
            };
        }
    }

    //* این تابع حضور دو ترکیب شناسه کاربر و اتصال را در نشست همان روم و اتصال صوتی فعال تأیید می‌کند.
    resolveVerifiedPairParticipants(
        event
    ) {
        const gameSession =
            this.gameSessionRegistry
                .findSessionByRoom(
                    event.roomId
                );

        if (
            !gameSession ||
            this.gameSessionRegistry
                .isPublicSessionOpen(
                    gameSession
                ) !==
                true ||
            String(
                gameSession.serverId ??
                ""
            ).trim() !==
                event.serverId
        ) {
            return {
                success:
                    false,

                applied:
                    false,

                reason:
                    "voice_delta_game_session_not_ready",

                message:
                    "The matching dedicated game session is not ready.",

                data: {
                    roomId:
                        event.roomId,

                    serverId:
                        event.serverId
                },

                httpStatusCode:
                    409
            };
        }

        const players =
            Array.isArray(
                gameSession.players
            )
                ? gameSession.players
                : [];

        const firstPlayer =
            players.find(
                (candidate) =>
                    String(
                        candidate?.userId ??
                        ""
                    ).trim() ===
                        event.firstUserId &&
                    canonicalizeVoiceDedicatedConnectionId(
                        candidate?.connectionId
                    ) ===
                        event.firstConnectionId &&
                    candidate?.isReady ===
                        true
            ) ??
            null;

        const secondPlayer =
            players.find(
                (candidate) =>
                    String(
                        candidate?.userId ??
                        ""
                    ).trim() ===
                        event.secondUserId &&
                    canonicalizeVoiceDedicatedConnectionId(
                        candidate?.connectionId
                    ) ===
                        event.secondConnectionId &&
                    candidate?.isReady ===
                        true
            ) ??
            null;

        if (
            !firstPlayer ||
            !secondPlayer
        ) {
            return {
                success:
                    false,

                applied:
                    false,

                reason:
                    "voice_delta_pair_not_in_game_session",

                message:
                    "Both userId and connectionId pairs must be ready in the same dedicated game session.",

                data: {
                    roomId:
                        event.roomId,

                    firstUserId:
                        event.firstUserId,

                    firstConnectionId:
                        event.firstConnectionId,

                    secondUserId:
                        event.secondUserId,

                    secondConnectionId:
                        event.secondConnectionId
                },

                httpStatusCode:
                    409
            };
        }

        const firstConnection =
            this.resolveActiveVoiceConnection(
                event.firstUserId,
                event.roomId,
                event.firstConnectionId
            );

        const secondConnection =
            this.resolveActiveVoiceConnection(
                event.secondUserId,
                event.roomId,
                event.secondConnectionId
            );

        if (
            !firstConnection.success ||
            !secondConnection.success
        ) {
            return {
                success:
                    false,

                applied:
                    false,

                reason:
                    "voice_delta_pair_voice_connection_not_ready",

                message:
                    "Both userId values must have one active Voice connection in the same room.",

                data: {
                    roomId:
                        event.roomId,

                    firstUserId:
                        event.firstUserId,

                    firstConnectionId:
                        event.firstConnectionId,

                    secondUserId:
                        event.secondUserId,

                    secondConnectionId:
                        event.secondConnectionId,

                    firstConnectionCount:
                        firstConnection.count,

                    secondConnectionCount:
                        secondConnection.count
                },

                httpStatusCode:
                    409
            };
        }

        return {
            success:
                true,

            applied:
                false,

            firstParticipant:
                Object.freeze({
                    connectionId:
                        firstConnection
                            .connection
                            .connectionId,

                    userId:
                        event.firstUserId,

                    avatarId:
                        event.firstUserId
                }),

            secondParticipant:
                Object.freeze({
                    connectionId:
                        secondConnection
                            .connection
                            .connectionId,

                    userId:
                        event.secondUserId,

                    avatarId:
                        event.secondUserId
                }),

            reason:
                "voice_delta_pair_verified",

            message:
                "Dedicated Voice pair verified.",

            data:
                {},

            httpStatusCode:
                200
        };
    }

    //* این تابع اتصال صوتی فعال همان شناسه کاربر و همان روم را به‌صورت یکتا پیدا می‌کند.
    resolveActiveVoiceConnection(
        userId,
        roomId,
        dedicatedConnectionId
    ) {
        const normalizedDedicatedConnectionId =
            canonicalizeVoiceDedicatedConnectionId(
                dedicatedConnectionId
            );

        if (
            !normalizedDedicatedConnectionId
        ) {
            return {
                success:
                    false,

                count:
                    0,

                connection:
                    null
            };
        }

        const matches =
            this.voiceConnectionRegistry
                .listByUserId(
                    userId
                )
                .filter(
                    (connection) =>
                        connection.roomId ===
                            roomId &&
                        connection.state ===
                            VoiceConnectionState
                                .ACTIVE &&
                        canonicalizeVoiceDedicatedConnectionId(
                            connection.connectionId
                        ) ===
                            normalizedDedicatedConnectionId
                );

        return {
            success:
                matches.length ===
                1,

            count:
                matches.length,

            connection:
                matches.length ===
                    1
                    ? matches[0]
                    : null
        };
    }

    //* این تابع سرور، روم و دو ترکیب شناسه کاربر و اتصال رویداد را با سشن ثبت‌شده تطبیق می‌دهد.
    validateEventAgainstSession(
        event,
        session
    ) {
        if (
            session.serverId !==
                event.serverId ||
            session.roomId !==
                event.roomId
        ) {
            return {
                success:
                    false,

                applied:
                    false,

                reason:
                    "voice_delta_session_scope_mismatch",

                message:
                    "Dedicated Voice delta does not match the stored session scope.",

                data:
                    {},

                httpStatusCode:
                    409
            };
        }

        const firstStoredParticipant =
            session.participants.find(
                (participant) =>
                    participant.userId ===
                    event.firstUserId
            ) ??
            null;

        const secondStoredParticipant =
            session.participants.find(
                (participant) =>
                    participant.userId ===
                    event.secondUserId
            ) ??
            null;

        if (
            !firstStoredParticipant ||
            !secondStoredParticipant ||
            canonicalizeVoiceDedicatedConnectionId(
                firstStoredParticipant.connectionId
            ) !==
                event.firstConnectionId ||
            canonicalizeVoiceDedicatedConnectionId(
                secondStoredParticipant.connectionId
            ) !==
                event.secondConnectionId
        ) {
            return {
                success:
                    false,

                applied:
                    false,

                reason:
                    "voice_delta_session_participant_pair_mismatch",

                message:
                    "Dedicated Voice delta anchor pair does not belong to the stored session.",

                data:
                    {},

                httpStatusCode:
                    409
            };
        }

        if (
            event.type ===
                VoiceDedicatedSessionDeltaEventType
                    .DISTANCE_UPDATED &&
            session.state !==
                VoiceSessionState.ACTIVE
        ) {
            return {
                success:
                    false,

                applied:
                    false,

                reason:
                    "voice_delta_session_not_active",

                message:
                    "Distance update requires an active Voice session.",

                data:
                    {},

                httpStatusCode:
                    409
            };
        }

        return {
            success:
                true,

            applied:
                false,

            reason:
                "voice_delta_session_verified",

            message:
                "Dedicated Voice session delta scope verified.",

            data:
                {},

            httpStatusCode:
                200
        };
    }

    //* این تابع سرویس را متوقف و وضعیت ترتیب اجرای سرورها را پاک می‌کند.
    stop() {
        if (
            this.stopped
        ) {
            return;
        }

        this.stopped =
            true;

        this.sequenceStateByServerId
            .clear();
    }

    //* این تابع آمار دریافت رویدادها و سشن‌های فعال را برمی‌گرداند.
    getStats() {
        return Object.freeze({
            stopped:
                this.stopped,

            trackedServers:
                this.sequenceStateByServerId
                    .size,

            sessions:
                this.voiceAuthoritativeSessionService
                    .getStats()
        });
    }
}

export {
    MAX_BATCH_EVENT_COUNT,
    VoiceDedicatedSessionDeltaEventType,
    VoiceDedicatedSessionDeltaService,
    normalizeVoiceDedicatedSessionDeltaBatch,
    normalizeVoiceDedicatedSessionDeltaEvent
};

/*
توضیح فایل:
این فایل دسته رویدادهای سشن صوتی صادرشده از سرور اختصاصی را با سرویس توکن همان سرور احراز می‌کند، ترتیب اجرای هر سرور را نگه می‌دارد، حضور دو شناسه کاربر را در نشست همان روم و اتصال صوتی فعال بررسی می‌کند و نتیجه را روی هسته سشن زوجی اعمال می‌کند.
*/
