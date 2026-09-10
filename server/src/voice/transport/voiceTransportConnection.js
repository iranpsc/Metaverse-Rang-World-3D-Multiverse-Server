// مسیر فایل: src/voice/transport/voiceTransportConnection.js

import {
    decodeVoiceAuthRequest,
    encodeVoiceAuthResult
} from "../auth/voiceAuthPayload.js";

import {
    VoiceAuthResultCode
} from "../auth/voiceAuthConstants.js";

import {
    VoiceConnectionCloseReason,
    VoiceConnectionCloseReasonNameByValue
} from "../core/voiceConnectionConstants.js";

import {
    decodeVoiceBinaryEnvelope,
    encodeVoiceBinaryEnvelope
} from "../protocol/voiceBinaryEnvelope.js";

import {
    VoiceBinaryProtocolConstants
} from "../protocol/voiceBinaryProtocolConstants.js";

import {
    VoiceMessageFlag
} from "../protocol/voiceMessageFlags.js";

import {
    validateVoiceMessageContract
} from "../protocol/voiceMessageRules.js";

import {
    VoiceMessageType
} from "../protocol/voiceMessageTypes.js";

import {
    decodeVoiceHeartbeatAckPayload,
    encodeVoiceHeartbeatAckPayload
} from "./voiceHeartbeatPayload.js";

import {
    VoiceTransportCloseCode,
    VoiceTransportConnectionState,
    createVoiceTransportPolicy
} from "./voiceTransportConstants.js";

const VoiceRealtimeMediaPolicy = Object.freeze({
    queueCapacity: 24,
    maxQueueAgeMs: 120
});

function formatVoiceTransportTraceValue(value) {
    if (value === undefined) return "undefined";
    if (value === null) return "null";

    if (typeof value === "string") {
        return value
            .replace(/\s+/g, "_")
            .slice(0, 320);
    }

    if (
        typeof value === "number" ||
        typeof value === "boolean" ||
        typeof value === "bigint"
    ) {
        return String(value);
    }

    try {
        return JSON.stringify(value)
            .replace(/\s+/g, "_")
            .slice(0, 320);
    } catch {
        return String(value)
            .replace(/\s+/g, "_")
            .slice(0, 320);
    }
}

function writeVoiceTransportTrace(marker, fields = {}) {
    try {
        const details = Object.entries(fields)
            .filter(([, value]) => value !== undefined)
            .map(
                ([key, value]) =>
                    `${key}=${formatVoiceTransportTraceValue(value)}`
            )
            .join(" | ");

        console.log(
            `[G4_VOICE_TRANSPORT_TRACE] ${marker}${details ? ` | ${details}` : ""}`
        );
    } catch {
        console.log(
            `[G4_VOICE_TRANSPORT_TRACE] ${marker} | trace_format_failed=true`
        );
    }
}

class VoiceTransportFailure extends Error {
    //* این سازنده خطای داخلی انتقال را همراه کد بستن و علت پاک‌سازی نگه می‌دارد.
    constructor(
        message,
        {
            closeCode =
                VoiceTransportCloseCode
                    .PROTOCOL_ERROR,

            registryReason =
                VoiceConnectionCloseReason
                    .TRANSPORT_CLOSED
        } = {}
    ) {
        super(message);

        this.name =
            "VoiceTransportFailure";

        this.closeCode = closeCode;
        this.registryReason =
            registryReason;
    }
}

class VoiceTransportConnection {
    //* این سازنده وابستگی‌های مشترک و زمان‌سنج احراز هویت یک اتصال انتقال را آماده می‌کند.
    constructor({
        connectionRegistrationService,
        voiceConnectionRegistry,
        transportName,
        transportConnectionKey,
        sendBinary,
        closeTransport,
        getBufferedAmount = () => 0,
        application = null,
        policy = {},
        onClosed = null,
        now = () => Date.now()
    } = {}) {
        if (
            !connectionRegistrationService ||
            typeof connectionRegistrationService
                .registerAndActivate !==
                "function"
        ) {
            throw new TypeError(
                "connectionRegistrationService must provide registerAndActivate."
            );
        }

        if (
            !voiceConnectionRegistry ||
            typeof voiceConnectionRegistry
                .getByConnectionId !==
                "function" ||
            typeof voiceConnectionRegistry
                .removeConnection !==
                "function"
        ) {
            throw new TypeError(
                "voiceConnectionRegistry does not provide the required interface."
            );
        }

        if (
            typeof transportName !== "string" ||
            !transportName.trim()
        ) {
            throw new TypeError(
                "transportName must be a non-empty string."
            );
        }

        if (
            typeof transportConnectionKey !==
                "string" ||
            !transportConnectionKey.trim()
        ) {
            throw new TypeError(
                "transportConnectionKey must be a non-empty string."
            );
        }

        if (typeof sendBinary !== "function") {
            throw new TypeError(
                "sendBinary must be a function."
            );
        }

        if (typeof closeTransport !== "function") {
            throw new TypeError(
                "closeTransport must be a function."
            );
        }

        if (
            typeof getBufferedAmount !==
                "function"
        ) {
            throw new TypeError(
                "getBufferedAmount must be a function."
            );
        }

        if (
            onClosed !== null &&
            typeof onClosed !== "function"
        ) {
            throw new TypeError(
                "onClosed must be null or a function."
            );
        }

        if (typeof now !== "function") {
            throw new TypeError(
                "now must be a function."
            );
        }

        if (
            application !== null &&
            (
                typeof application !== "object" ||
                Array.isArray(application)
            )
        ) {
            throw new TypeError(
                "application must be null or an object."
            );
        }

        this.connectionRegistrationService =
            connectionRegistrationService;

        this.voiceConnectionRegistry =
            voiceConnectionRegistry;

        this.transportName =
            transportName.trim();

        this.transportConnectionKey =
            transportConnectionKey.trim();

        this.sendBinary = sendBinary;
        this.closeTransport =
            closeTransport;
        this.getBufferedAmount =
            getBufferedAmount;
        this.application = application;
        this.policy =
            createVoiceTransportPolicy(
                policy
            );
        this.onClosed = onClosed;
        this.now = now;

        this.state =
            VoiceTransportConnectionState
                .WAITING_AUTH;

        this.connectionId = "";
        this.userId = "";
        this.lastReceivedSequence = 0;
        this.lastSentSequence = 0;
        this.pendingHeartbeatSequence =
            null;
        this.pendingHeartbeatSentAtMs =
            null;
        this.processingTail =
            Promise.resolve();
        this.sendingTail =
            Promise.resolve();
        this.mediaQueue = [];
        this.mediaDrainPromise = null;
        this.mediaDroppedCount = 0;
        this.mediaSentCount = 0;
        this.heartbeatSendInFlight = false;
        this.authTimer = null;
        this.heartbeatTimer = null;
        this.closePromise = null;
        this.lastCloseCode = null;
        this.lastCloseReason = "";

        this.authTimer = setTimeout(
            () => {
                void this.close({
                    closeCode:
                        VoiceTransportCloseCode
                            .AUTH_TIMEOUT,
                    closeMessage:
                        "Voice authentication timeout.",
                    registryReason:
                        VoiceConnectionCloseReason
                            .TRANSPORT_CLOSED
                });
            },
            this.policy.authTimeoutMs
        );

        this.authTimer.unref?.();
    }

    //* این تابع بسته باینری ورودی را در صف ترتیبی قرار می‌دهد تا پیام‌های هم‌زمان با یکدیگر تداخل نکنند.
    receiveBinary(input) {
        let packet = null;

        if (Buffer.isBuffer(input)) {
            packet = input;
        } else if (input instanceof Uint8Array) {
            packet = Buffer.from(
                input.buffer,
                input.byteOffset,
                input.byteLength
            );
        } else if (input instanceof ArrayBuffer) {
            packet = Buffer.from(input);
        } else {
            packet = null;
        }

        const operation =
            this.processingTail.then(
                async () => {
                    if (
                        this.state ===
                        VoiceTransportConnectionState
                            .CLOSING ||
                        this.state ===
                        VoiceTransportConnectionState
                            .CLOSED
                    ) {
                        return this.getSnapshot();
                    }

                    if (!packet) {
                        throw new VoiceTransportFailure(
                            "Voice transport input must be binary."
                        );
                    }

                    if (
                        packet.length >
                        this.policy.maxPacketBytes
                    ) {
                        throw new VoiceTransportFailure(
                            "Voice transport packet exceeds the configured size limit.",
                            {
                                closeCode:
                                    VoiceTransportCloseCode
                                        .PACKET_TOO_LARGE
                            }
                        );
                    }

                    return this.processPacket(
                        packet
                    );
                }
            ).catch(
                async (error) => {
                    const failure =
                        error instanceof
                            VoiceTransportFailure
                            ? error
                            : new VoiceTransportFailure(
                                error?.message ??
                                String(error),
                                {
                                    closeCode:
                                        VoiceTransportCloseCode
                                            .INTERNAL_ERROR
                                }
                            );

                    await this.close({
                        closeCode:
                            failure.closeCode,
                        closeMessage:
                            failure.message,
                        registryReason:
                            failure.registryReason
                    });

                    throw failure;
                }
            );

        this.processingTail =
            operation.catch(() => undefined);

        return operation;
    }

    //* این تابع یک بسته معتبر را باز می‌کند و بر اساس وضعیت اتصال به پردازش احراز هویت یا کنترل هدایت می‌کند.
    async processPacket(packet) {
        const envelope =
            decodeVoiceBinaryEnvelope(
                packet
            );

        validateVoiceMessageContract({
            messageType:
                envelope.messageType,
            flags:
                envelope.flags
        });

        const expectedSequence =
            this.lastReceivedSequence === 0
                ? this.policy
                    .firstIncomingSequence
                : this.lastReceivedSequence + 1;

        if (
            expectedSequence >
            this.policy.maximumSequence ||
            envelope.sequence !==
                expectedSequence
        ) {
            throw new VoiceTransportFailure(
                `Invalid Voice incoming sequence. Expected ${expectedSequence}, received ${envelope.sequence}.`
            );
        }

        this.lastReceivedSequence =
            envelope.sequence;

        if (
            this.state ===
            VoiceTransportConnectionState
                .WAITING_AUTH
        ) {
            if (
                envelope.messageType !==
                VoiceMessageType.AUTH_REQUEST
            ) {
                await this.sendAuthFailure({
                    code:
                        VoiceAuthResultCode
                            .INVALID_PAYLOAD,
                    message:
                        "AUTH_REQUEST must be the first Voice message."
                });

                throw new VoiceTransportFailure(
                    "AUTH_REQUEST must be the first Voice message.",
                    {
                        closeCode:
                            VoiceTransportCloseCode
                                .AUTH_FAILED
                    }
                );
            }

            if (
                envelope.senderId !==
                    VoiceBinaryProtocolConstants
                        .emptyUuid ||
                envelope.sessionId !==
                    VoiceBinaryProtocolConstants
                        .emptyUuid
            ) {
                await this.sendAuthFailure({
                    code:
                        VoiceAuthResultCode
                            .INVALID_PAYLOAD,
                    message:
                        "Authentication envelope identifiers must be empty."
                });

                throw new VoiceTransportFailure(
                    "Authentication envelope identifiers must be empty.",
                    {
                        closeCode:
                            VoiceTransportCloseCode
                                .AUTH_FAILED
                    }
                );
            }

            return this.handleAuthRequest(
                envelope
            );
        }

        if (
            envelope.senderId !==
            this.connectionId
        ) {
            throw new VoiceTransportFailure(
                "Voice message sender does not match the authenticated connection."
            );
        }

        if (
            envelope.messageType ===
            VoiceMessageType.AUTH_REQUEST
        ) {
            throw new VoiceTransportFailure(
                "AUTH_REQUEST cannot be repeated after authentication."
            );
        }

        if (
            envelope.messageType ===
            VoiceMessageType.HEARTBEAT
        ) {
            if (envelope.payloadLength !== 0) {
                throw new VoiceTransportFailure(
                    "Voice HEARTBEAT payload must be empty."
                );
            }

            await this.sendEnvelope({
                messageType:
                    VoiceMessageType
                        .HEARTBEAT_ACK,
                payload:
                    encodeVoiceHeartbeatAckPayload(
                        envelope.sequence
                    )
            });

            return this.getSnapshot();
        }

        if (
            envelope.messageType ===
            VoiceMessageType.HEARTBEAT_ACK
        ) {
            const acknowledgedSequence =
                decodeVoiceHeartbeatAckPayload(
                    envelope.payload
                );

            if (
                this.pendingHeartbeatSequence ===
                    null ||
                acknowledgedSequence !==
                    this.pendingHeartbeatSequence
            ) {
                throw new VoiceTransportFailure(
                    "Voice HEARTBEAT_ACK does not match the pending server heartbeat."
                );
            }

            this.pendingHeartbeatSequence =
                null;
            this.pendingHeartbeatSentAtMs =
                null;

            return this.getSnapshot();
        }

        if (
            envelope.messageType ===
            VoiceMessageType.DISCONNECT
        ) {
            await this.close({
                closeCode:
                    VoiceTransportCloseCode
                        .NORMAL,
                closeMessage:
                    "Voice client disconnected.",
                registryReason:
                    VoiceConnectionCloseReason
                        .CLIENT_DISCONNECTED
            });

            return this.getSnapshot();
        }

        if (
            this.application &&
            typeof this.application.handleEnvelope ===
                "function"
        ) {
            const applicationResult =
                await this.application.handleEnvelope({
                    envelope,
                    transportConnection: this
                });

            if (applicationResult?.handled === true) {
                return this.getSnapshot();
            }
        }

        if (
            envelope.messageType ===
            VoiceMessageType.VOICE_FRAME
        ) {
            throw new VoiceTransportFailure(
                "VOICE_FRAME is not enabled by the active Voice application."
            );
        }

        throw new VoiceTransportFailure(
            `Voice message type ${envelope.messageType} is not enabled in the transport foundation stage.`
        );
    }

    //* این تابع درخواست احراز هویت را رمزگشایی، به سرویس ثبت اتصال ارسال و نتیجه را برای کلاینت می‌فرستد.
    async handleAuthRequest(envelope) {
        let request = null;

        try {
            request =
                decodeVoiceAuthRequest(
                    envelope.payload
                );
        } catch (error) {
            await this.sendAuthFailure({
                code:
                    VoiceAuthResultCode
                        .INVALID_PAYLOAD,
                message:
                    error?.message ??
                    String(error)
            });

            throw new VoiceTransportFailure(
                error?.message ?? String(error),
                {
                    closeCode:
                        VoiceTransportCloseCode
                            .AUTH_FAILED
                }
            );
        }

        const nowMs = this.now();

        const result =
            await Promise.resolve(
                this.connectionRegistrationService
                    .registerAndActivate({
                        ...request,
                        transportName:
                            this.transportName,
                        transportConnectionKey:
                            this.transportConnectionKey,
                        createdAtMs: nowMs,
                        activatedAtMs: nowMs
                    })
            );

        if (
            !result ||
            typeof result !== "object"
        ) {
            throw new VoiceTransportFailure(
                "Voice connection registration returned an invalid result.",
                {
                    closeCode:
                        VoiceTransportCloseCode
                            .INTERNAL_ERROR
                }
            );
        }

        if (result.success === true) {
            this.connectionId =
                String(
                    result.connectionId ?? ""
                )
                    .trim()
                    .toLowerCase();

            this.userId =
                String(result.userId ?? "")
                    .trim();
        }

        const authPayload =
            encodeVoiceAuthResult({
                success:
                    result.success === true,
                retryable:
                    result.retryable === true,
                code:
                    result.code ??
                    VoiceAuthResultCode
                        .INTERNAL_ERROR,
                voiceConnectionId:
                    result.success === true
                        ? this.connectionId
                        : VoiceBinaryProtocolConstants
                            .emptyUuid,
                userId:
                    result.success === true
                        ? this.userId
                        : "",
                message:
                    String(
                        result.message ?? ""
                    )
            });

        try {
            await this.sendEnvelope({
                messageType:
                    VoiceMessageType
                        .AUTH_RESULT,
                payload:
                    authPayload
            });
        } catch (error) {
            if (this.connectionId) {
                const closedAtMs =
                    this.now();

                if (
                    this.application &&
                    typeof this.application
                        .handleTransportClosed ===
                        "function"
                ) {
                    await this.application
                        .handleTransportClosed({
                            connectionId:
                                this.connectionId,
                            registryReason:
                                VoiceConnectionCloseReason
                                    .TRANSPORT_CLOSED,
                            closedAtMs,
                            transportConnection: this
                        });
                } else {
                    this.voiceConnectionRegistry
                        .removeConnection(
                            this.connectionId,
                            {
                                reason:
                                    VoiceConnectionCloseReason
                                        .TRANSPORT_CLOSED,
                                closedAtMs
                            }
                        );
                }
            }

            this.connectionId = "";
            this.userId = "";

            throw error;
        }

        if (result.success !== true) {
            throw new VoiceTransportFailure(
                result.message ||
                "Voice authentication failed.",
                {
                    closeCode:
                        VoiceTransportCloseCode
                            .AUTH_FAILED
                }
            );
        }

        if (this.authTimer) {
            clearTimeout(this.authTimer);
            this.authTimer = null;
        }

        this.state =
            VoiceTransportConnectionState
                .ACTIVE;

        this.startHeartbeat();

        if (
            this.application &&
            typeof this.application
                .handleAuthenticated ===
                "function"
        ) {
            await this.application.handleAuthenticated({
                transportConnection: this,
                registrationResult: result
            });
        }

        return this.getSnapshot();
    }

    //* این تابع نتیجه شکست احراز هویت را بدون ثبت اتصال در رجیستری برای کلاینت ارسال می‌کند.
    async sendAuthFailure({
        code,
        message,
        retryable = false
    } = {}) {
        const payload =
            encodeVoiceAuthResult({
                success: false,
                retryable,
                code,
                voiceConnectionId:
                    VoiceBinaryProtocolConstants
                        .emptyUuid,
                userId: "",
                message:
                    String(message ?? "")
            });

        await this.sendEnvelope({
            messageType:
                VoiceMessageType.AUTH_RESULT,
            payload
        });
    }

    //* این تابع فریم صوتی زنده را بدون منتظر نگه‌داشتن مسیر ورودی در صف بسیار کوتاه و محدود قرار می‌دهد.
    enqueueMediaEnvelope(input = {}) {
        if (
            this.state ===
                VoiceTransportConnectionState
                    .CLOSING ||
            this.state ===
                VoiceTransportConnectionState
                    .CLOSED
        ) {
            return false;
        }

        if (
            input?.messageType !==
            VoiceMessageType.VOICE_FRAME
        ) {
            throw new TypeError(
                "enqueueMediaEnvelope only accepts VOICE_FRAME."
            );
        }

        const queuedAtMs =
            this.now();

        while (
            this.mediaQueue.length >=
            VoiceRealtimeMediaPolicy
                .queueCapacity
        ) {
            this.mediaQueue.shift();
            this.recordMediaDrop(
                "queue_capacity",
                queuedAtMs
            );
        }

        this.mediaQueue.push({
            input,
            queuedAtMs
        });

        this.ensureMediaDrainRunning();

        return true;
    }

    //* این تابع فقط یک مصرف‌کننده برای صف زنده صوت نگه می‌دارد تا فریم‌های قدیمی پشت کنترل‌ها جمع نشوند.
    ensureMediaDrainRunning() {
        if (this.mediaDrainPromise) {
            return;
        }

        this.mediaDrainPromise =
            this.drainMediaQueue()
                .catch(
                    (error) => {
                        writeVoiceTransportTrace(
                            "VOICE_MEDIA_DRAIN_FAILED",
                            {
                                connectionId:
                                    this.connectionId ||
                                    "unassigned",
                                error:
                                    error?.message ??
                                    String(error)
                            }
                        );
                    }
                )
                .finally(
                    () => {
                        this.mediaDrainPromise =
                            null;

                        if (
                            this.mediaQueue.length > 0 &&
                            this.state !==
                                VoiceTransportConnectionState
                                    .CLOSING &&
                            this.state !==
                                VoiceTransportConnectionState
                                    .CLOSED
                        ) {
                            this.ensureMediaDrainRunning();
                        }
                    }
                );
    }

    //* این تابع در هر دور فقط یک فریم تازه را وارد Writer ترتیبی می‌کند تا کنترل بین فریم‌های صوتی حق تقدم داشته باشد.
    async drainMediaQueue() {
        while (
            this.mediaQueue.length > 0 &&
            this.state !==
                VoiceTransportConnectionState
                    .CLOSING &&
            this.state !==
                VoiceTransportConnectionState
                    .CLOSED
        ) {
            const queued =
                this.mediaQueue.shift();

            const nowMs =
                this.now();

            const queueAgeMs =
                Math.max(
                    0,
                    nowMs -
                        queued.queuedAtMs
                );

            if (
                queueAgeMs >
                VoiceRealtimeMediaPolicy
                    .maxQueueAgeMs
            ) {
                this.recordMediaDrop(
                    "stale",
                    nowMs,
                    queueAgeMs
                );
                continue;
            }

            try {
                await this.sendEnvelope(
                    queued.input
                );

                this.mediaSentCount += 1;
            } catch (error) {
                writeVoiceTransportTrace(
                    "VOICE_MEDIA_SEND_FAILED",
                    {
                        transportName:
                            this.transportName,
                        transportConnectionKey:
                            this.transportConnectionKey,
                        connectionId:
                            this.connectionId ||
                            "unassigned",
                        error:
                            error?.message ??
                            String(error),
                        queueAgeMs,
                        pendingMedia:
                            this.mediaQueue
                                .length,
                        mediaSentCount:
                            this.mediaSentCount,
                        mediaDroppedCount:
                            this.mediaDroppedCount
                    }
                );

                const droppedAfterFailure =
                    this.mediaQueue.length;

                if (droppedAfterFailure > 0) {
                    this.mediaQueue.length = 0;
                    this.mediaDroppedCount +=
                        droppedAfterFailure;

                    writeVoiceTransportTrace(
                        "VOICE_MEDIA_QUEUE_DROP",
                        {
                            reason:
                                "send_failure_flush",
                            dropped:
                                droppedAfterFailure,
                            totalDropped:
                                this.mediaDroppedCount,
                            pendingMedia: 0,
                            connectionId:
                                this.connectionId ||
                                "unassigned"
                        }
                    );
                }

                return;
            }
        }
    }

    //* این تابع Drop رسانه زنده را با شمارنده محدود ثبت می‌کند تا Backlog پنهان نماند.
    recordMediaDrop(
        reason,
        nowMs,
        queueAgeMs = null
    ) {
        this.mediaDroppedCount += 1;

        if (
            this.mediaDroppedCount !== 1 &&
            this.mediaDroppedCount % 50 !==
                0
        ) {
            return;
        }

        writeVoiceTransportTrace(
            "VOICE_MEDIA_QUEUE_DROP",
            {
                reason,
                nowMs,
                queueAgeMs,
                totalDropped:
                    this.mediaDroppedCount,
                pendingMedia:
                    this.mediaQueue.length,
                queueCapacity:
                    VoiceRealtimeMediaPolicy
                        .queueCapacity,
                maxQueueAgeMs:
                    VoiceRealtimeMediaPolicy
                        .maxQueueAgeMs,
                connectionId:
                    this.connectionId ||
                    "unassigned"
            }
        );
    }

    //* این تابع یک پیام خروجی را با شماره ترتیبی جدید می‌سازد و با محدودیت فشار بافر و زمان ارسال می‌کند.
    sendEnvelope(input = {}) {
        const operation =
            this.sendingTail.then(
                () => this.sendEnvelopeNow(input)
            );

        this.sendingTail =
            operation.catch(() => undefined);

        return operation;
    }

    //* این تابع عملیات واقعی یک ارسال ترتیبی را با شناسه‌های اختیاری سشن و فرستنده انجام می‌دهد.
    async sendEnvelopeNow({
        messageType,
        flags = VoiceMessageFlag.NONE,
        payload = Buffer.alloc(0),
        timestampMs = this.now(),
        sessionId =
            VoiceBinaryProtocolConstants.emptyUuid,
        senderId =
            VoiceBinaryProtocolConstants.emptyUuid
    } = {}) {
        if (
            this.state ===
                VoiceTransportConnectionState
                    .CLOSING ||
            this.state ===
                VoiceTransportConnectionState
                    .CLOSED
        ) {
            throw new VoiceTransportFailure(
                "Cannot send a Voice message after the transport starts closing."
            );
        }

        validateVoiceMessageContract({
            messageType,
            flags
        });

        const nextSequence =
            this.lastSentSequence + 1;

        if (
            nextSequence >
            this.policy.maximumSequence
        ) {
            throw new VoiceTransportFailure(
                "Voice outgoing sequence reached its configured limit."
            );
        }

        const packet =
            encodeVoiceBinaryEnvelope({
                messageType,
                flags,
                sequence:
                    nextSequence,
                timestampMs:
                    timestampMs,
                sessionId,
                senderId,
                payload
            });

        if (
            packet.length >
            this.policy.maxPacketBytes
        ) {
            throw new VoiceTransportFailure(
                "Voice outgoing packet exceeds the configured size limit.",
                {
                    closeCode:
                        VoiceTransportCloseCode
                            .PACKET_TOO_LARGE
                }
            );
        }

        const bufferedAmount =
            Number(
                this.getBufferedAmount()
            );

        if (
            !Number.isFinite(bufferedAmount) ||
            bufferedAmount < 0
        ) {
            throw new VoiceTransportFailure(
                "Voice transport returned an invalid buffered amount.",
                {
                    closeCode:
                        VoiceTransportCloseCode
                            .BACKPRESSURE
                }
            );
        }

        if (
            bufferedAmount >
            this.policy.maxBufferedBytes
        ) {
            throw new VoiceTransportFailure(
                "Voice transport backpressure limit was exceeded.",
                {
                    closeCode:
                        VoiceTransportCloseCode
                            .BACKPRESSURE
                }
            );
        }

        let timeoutHandle = null;

        try {
            await Promise.race([
                Promise.resolve(
                    this.sendBinary(packet)
                ),
                new Promise((_, reject) => {
                    timeoutHandle = setTimeout(
                        () => {
                            reject(
                                new VoiceTransportFailure(
                                    "Voice transport send timeout.",
                                    {
                                        closeCode:
                                            VoiceTransportCloseCode
                                                .BACKPRESSURE
                                    }
                                )
                            );
                        },
                        this.policy.sendTimeoutMs
                    );

                    timeoutHandle.unref?.();
                })
            ]);
        } finally {
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
            }
        }

        this.lastSentSequence =
            nextSequence;

        return nextSequence;
    }

    //* این تابع پس از موفقیت احراز هویت ارسال دوره‌ای ضربان سرور را آغاز می‌کند.
    startHeartbeat() {
        if (this.heartbeatTimer) return;

        this.heartbeatTimer = setInterval(
            () => {
                void this.runHeartbeatTick();
            },
            this.policy.heartbeatIntervalMs
        );

        this.heartbeatTimer.unref?.();
    }

    //* این تابع مهلت پاسخ ضربان قبلی را بررسی و فقط یک ارسال ضربان هم‌زمان را اجازه می‌دهد.
    async runHeartbeatTick() {
        if (
            this.state !==
            VoiceTransportConnectionState.ACTIVE
        ) {
            return;
        }

        const nowMs = this.now();

        if (
            this.pendingHeartbeatSequence !==
                null
        ) {
            if (
                nowMs -
                    this.pendingHeartbeatSentAtMs >=
                this.policy.heartbeatTimeoutMs
            ) {
                await this.close({
                    closeCode:
                        VoiceTransportCloseCode
                            .HEARTBEAT_TIMEOUT,
                    closeMessage:
                        "Voice heartbeat acknowledgement timeout.",
                    registryReason:
                        VoiceConnectionCloseReason
                            .TRANSPORT_CLOSED
                });
            }

            return;
        }

        if (this.heartbeatSendInFlight) {
            return;
        }

        this.heartbeatSendInFlight = true;

        try {
            const sequence =
                await this.sendEnvelope({
                    messageType:
                        VoiceMessageType
                            .HEARTBEAT,
                    flags:
                        VoiceMessageFlag
                            .ACK_REQUIRED,
                    payload:
                        Buffer.alloc(0)
                });

            if (
                this.state !==
                VoiceTransportConnectionState
                    .ACTIVE
            ) {
                return;
            }

            this.pendingHeartbeatSequence =
                sequence;

            this.pendingHeartbeatSentAtMs =
                this.now();
        } catch (error) {
            await this.close({
                closeCode:
                    error?.closeCode ??
                    VoiceTransportCloseCode
                        .BACKPRESSURE,
                closeMessage:
                    error?.message ??
                    String(error),
                registryReason:
                    VoiceConnectionCloseReason
                        .TRANSPORT_CLOSED
            });
        } finally {
            this.heartbeatSendInFlight =
                false;
        }
    }

    //* این تابع بسته‌شدن راه انتقال را به هسته اعلام و اتصال ثبت‌شده را پاک‌سازی می‌کند.
    notifyTransportClosed(
        message =
            "Voice transport closed."
    ) {
        return this.close({
            closeCode:
                VoiceTransportCloseCode.NORMAL,
            closeMessage:
                String(message),
            registryReason:
                VoiceConnectionCloseReason
                    .TRANSPORT_CLOSED,
            closeUnderlyingTransport:
                false
        });
    }

    //* این تابع تمام زمان‌سنج‌ها و رجیستری اتصال را یک‌بار پاک می‌کند و سپس راه انتقال را می‌بندد.
    close({
        closeCode =
            VoiceTransportCloseCode.NORMAL,
        closeMessage =
            "Voice transport closed.",
        registryReason =
            VoiceConnectionCloseReason
                .TRANSPORT_CLOSED,
        closeUnderlyingTransport = true
    } = {}) {
        const requestedCloseMessage =
            String(closeMessage ?? "");

        if (this.closePromise) {
            writeVoiceTransportTrace(
                "VOICE_TRANSPORT_CLOSE_DUPLICATE_IGNORED",
                {
                    transportName:
                        this.transportName,
                    transportConnectionKey:
                        this.transportConnectionKey,
                    connectionId:
                        this.connectionId || "unassigned",
                    state:
                        this.state,
                    requestedCloseCode:
                        closeCode,
                    requestedCloseMessage,
                    firstCloseCode:
                        this.lastCloseCode,
                    firstCloseMessage:
                        this.lastCloseReason
                }
            );

            return this.closePromise;
        }

        const closeStartedAtMs =
            this.now();

        const pendingHeartbeatAgeMs =
            this.pendingHeartbeatSequence === null ||
            this.pendingHeartbeatSentAtMs === null
                ? null
                : Math.max(
                    0,
                    closeStartedAtMs -
                        this.pendingHeartbeatSentAtMs
                );

        let bufferedAmount = null;

        try {
            bufferedAmount =
                this.getBufferedAmount();
        } catch {
            bufferedAmount =
                "unavailable";
        }

        writeVoiceTransportTrace(
            "VOICE_TRANSPORT_CLOSE",
            {
                closeStartedAtMs,
                transportName:
                    this.transportName,
                transportConnectionKey:
                    this.transportConnectionKey,
                connectionId:
                    this.connectionId || "unassigned",
                userId:
                    this.userId || "unassigned",
                stateBeforeClose:
                    this.state,
                closeCode,
                closeMessage:
                    requestedCloseMessage,
                registryReason,
                registryReasonName:
                    VoiceConnectionCloseReasonNameByValue[
                        registryReason
                    ] ?? "UNKNOWN",
                closeUnderlyingTransport,
                lastReceivedSequence:
                    this.lastReceivedSequence,
                lastSentSequence:
                    this.lastSentSequence,
                pendingHeartbeatSequence:
                    this.pendingHeartbeatSequence,
                pendingHeartbeatAgeMs,
                bufferedAmount,
                sendTimeoutMs:
                    this.policy.sendTimeoutMs,
                heartbeatIntervalMs:
                    this.policy.heartbeatIntervalMs,
                heartbeatTimeoutMs:
                    this.policy.heartbeatTimeoutMs
            }
        );

        this.state =
            VoiceTransportConnectionState
                .CLOSING;

        this.mediaQueue.length = 0;
        this.heartbeatSendInFlight = false;

        this.lastCloseCode = closeCode;
        this.lastCloseReason =
            requestedCloseMessage;

        this.closePromise =
            Promise.resolve().then(
                async () => {
                    if (this.authTimer) {
                        clearTimeout(
                            this.authTimer
                        );
                        this.authTimer = null;
                    }

                    if (this.heartbeatTimer) {
                        clearInterval(
                            this.heartbeatTimer
                        );
                        this.heartbeatTimer = null;
                    }

                    if (this.connectionId) {
                        const closedAtMs =
                            this.now();

                        if (
                            this.application &&
                            typeof this.application
                                .handleTransportClosed ===
                                "function"
                        ) {
                            await this.application
                                .handleTransportClosed({
                                    connectionId:
                                        this.connectionId,
                                    registryReason,
                                    closedAtMs,
                                    transportConnection: this
                                });
                        } else {
                            this.voiceConnectionRegistry
                                .removeConnection(
                                    this.connectionId,
                                    {
                                        reason:
                                            registryReason,
                                        closedAtMs
                                    }
                                );
                        }
                    }

                    this.connectionId = "";
                    this.userId = "";
                    this.pendingHeartbeatSequence =
                        null;
                    this.pendingHeartbeatSentAtMs =
                        null;

                    if (closeUnderlyingTransport) {
                        try {
                            await Promise.resolve(
                                this.closeTransport(
                                    closeCode,
                                    this.lastCloseReason
                                )
                            );
                        } catch {
                            // بسته‌شدن راه انتقال نباید پاک‌سازی رجیستری را متوقف کند.
                        }
                    }

                    this.state =
                        VoiceTransportConnectionState
                            .CLOSED;

                    if (this.onClosed) {
                        this.onClosed(this);
                    }

                    return this.getSnapshot();
                }
            );

        return this.closePromise;
    }

    //* این تابع یک نسخه خواندنی از وضعیت فعلی هسته انتقال را برمی‌گرداند.
    getSnapshot() {
        return Object.freeze({
            transportName:
                this.transportName,
            transportConnectionKey:
                this.transportConnectionKey,
            state: this.state,
            connectionId:
                this.connectionId,
            userId: this.userId,
            lastReceivedSequence:
                this.lastReceivedSequence,
            lastSentSequence:
                this.lastSentSequence,
            pendingHeartbeatSequence:
                this.pendingHeartbeatSequence,
            heartbeatSendInFlight:
                this.heartbeatSendInFlight,
            pendingMedia:
                this.mediaQueue.length,
            mediaSentCount:
                this.mediaSentCount,
            mediaDroppedCount:
                this.mediaDroppedCount,
            lastCloseCode:
                this.lastCloseCode,
            lastCloseReason:
                this.lastCloseReason
        });
    }
}

export {
    VoiceTransportConnection,
    VoiceTransportFailure
};

/*
توضیح فایل:
این فایل هسته مشترک هر اتصال انتقال صوتی را پیاده‌سازی می‌کند. اولین پیام را به احراز هویت محدود می‌کند، پیام‌ها را ترتیبی پردازش می‌کند، شماره ترتیب و ضربان را کنترل می‌کند، محدودیت اندازه و فشار بافر را اعمال می‌کند و در تمام مسیرهای قطع یا شکست ارسال نتیجه احراز هویت، رجیستری را پاک‌سازی می‌کند. ارسال فریم صوتی در این مرحله غیرفعال است.
*/
