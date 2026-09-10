import {
    VoiceConnectionCloseReason,
    VoiceConnectionState
} from "../core/voiceConnectionConstants.js";

import {
    VoiceBinaryProtocolConstants
} from "../protocol/voiceBinaryProtocolConstants.js";

import {
    VoiceMessageFlag
} from "../protocol/voiceMessageFlags.js";

import {
    VoiceMessageType
} from "../protocol/voiceMessageTypes.js";

import {
    VoiceReconnectResultCode
} from "../reconnect/voiceReconnectConstants.js";

import {
    VoiceRecordingState
} from "../recording/voiceRecordingConstants.js";

import {
    decodeVoiceRecordingConsentPayload,
    encodeVoiceRecordingStatePayload
} from "../recording/voiceRecordingPayload.js";

import {
    decodeVoiceReconnectRequest,
    encodeVoiceReconnectResult
} from "../reconnect/voiceReconnectPayload.js";

import {
    evaluateVoiceReconnectWindow
} from "../reconnect/voiceReconnectPolicy.js";

import {
    encodeVoiceSessionDescriptor,
    encodeVoiceSessionSnapshot
} from "../session/voiceSessionPayload.js";

import {
    VoiceControlAckCode,
    VoiceListenerMuteKind,
    decodeVoiceListenerMuteChangedPayload,
    decodeVoicePublishStartPayload,
    decodeVoicePublishStopPayload,
    encodeVoiceControlAckPayload
} from "./voiceRoutingControlPayload.js";

import {
    VoiceRoutingDropReason,
    createVoiceRoutingPolicy
} from "./voiceRoutingConstants.js";

const VOICE_TRACE_FRAME_SAMPLE_LIMIT = 5;
const VOICE_TRACE_FRAME_SAMPLE_INTERVAL = 50;

function formatVoiceTraceValue(value) {
    if (value === undefined) return "undefined";
    if (value === null) return "null";
    if (typeof value === "string") {
        return value.replace(/\s+/g, "_").slice(0, 240);
    }
    if (
        typeof value === "number" ||
        typeof value === "boolean" ||
        typeof value === "bigint"
    ) {
        return String(value);
    }
    if (Array.isArray(value)) {
        return `array:${value.length}`;
    }
    try {
        return JSON.stringify(value).replace(/\s+/g, "_").slice(0, 240);
    } catch {
        return String(value).replace(/\s+/g, "_").slice(0, 240);
    }
}

function writeVoiceTrace(marker, fields = {}) {
    try {
        const details = Object.entries(fields)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => `${key}=${formatVoiceTraceValue(value)}`)
            .join(" | ");

        console.log(
            `[G4_VOICE_TRACE] ${marker}${details ? ` | ${details}` : ""}`
        );
    } catch {
        console.log(`[G4_VOICE_TRACE] ${marker} | trace_format_failed=true`);
    }
}

function shouldLogVoiceFrameTrace(count) {
    return (
        count <= VOICE_TRACE_FRAME_SAMPLE_LIMIT ||
        count % VOICE_TRACE_FRAME_SAMPLE_INTERVAL === 0
    );
}

class VoiceRoutingApplication {
    //* این سازنده سرویس‌های قطعی Session، Mute، کنترل جریان و Reconnect را برای مسیر زنده دریافت می‌کند.
    constructor({
        voiceConnectionRegistry,
        voiceSessionRegistry,
        muteRegistry,
        packetFlowGuard,
        reconnectCoordinator,
        recordingService = null,
        operationalMetrics = null,
        auditLogger = null,
        policy = {},
        now = () => Date.now()
    } = {}) {
        if (
            !voiceConnectionRegistry ||
            typeof voiceConnectionRegistry.getByConnectionId !== "function"
        ) {
            throw new TypeError(
                "voiceConnectionRegistry must provide getByConnectionId."
            );
        }

        if (
            !voiceSessionRegistry ||
            typeof voiceSessionRegistry.listActiveByConnectionId !== "function"
        ) {
            throw new TypeError(
                "voiceSessionRegistry must provide listActiveByConnectionId."
            );
        }

        if (
            !muteRegistry ||
            typeof muteRegistry.applyChange !== "function" ||
            typeof muteRegistry.isRouteAllowed !== "function"
        ) {
            throw new TypeError(
                "muteRegistry does not provide the required interface."
            );
        }

        if (
            !packetFlowGuard ||
            typeof packetFlowGuard.inspect !== "function"
        ) {
            throw new TypeError(
                "packetFlowGuard must provide inspect."
            );
        }

        if (
            !reconnectCoordinator ||
            typeof reconnectCoordinator.handleTransportClosed !== "function" ||
            typeof reconnectCoordinator.handleConnectionAuthenticated !== "function"
        ) {
            throw new TypeError(
                "reconnectCoordinator does not provide the required interface."
            );
        }

        if (typeof now !== "function") {
            throw new TypeError("now must be a function.");
        }

        if (
            recordingService !== null &&
            (
                typeof recordingService.updateConsent !== "function" ||
                typeof recordingService.captureFrame !== "function"
            )
        ) {
            throw new TypeError(
                "recordingService does not provide the required interface."
            );
        }

        this.voiceConnectionRegistry = voiceConnectionRegistry;
        this.voiceSessionRegistry = voiceSessionRegistry;
        this.muteRegistry = muteRegistry;
        this.packetFlowGuard = packetFlowGuard;
        this.reconnectCoordinator = reconnectCoordinator;
        this.recordingService = recordingService;
        this.operationalMetrics = operationalMetrics;
        this.auditLogger = auditLogger;
        this.policy = createVoiceRoutingPolicy(policy);
        this.now = now;
        this.gateway = null;
        this.externalSessionProvider = null;
        this.publisherSettingsByConnectionId = new Map();
        this.routedFrames = 0;
        this.routedBytes = 0;
        this.droppedRoutesByReason = new Map();
        this.voiceFrameTraceByConnectionId = new Map();
    }

    //* این تابع درگاه انتقال مالک اتصال‌های فعال را پس از ساخت دریافت می‌کند.
    setGateway(gateway) {
        if (
            !gateway ||
            typeof gateway.getConnectionByConnectionId !== "function"
        ) {
            throw new TypeError(
                "gateway must provide getConnectionByConnectionId."
            );
        }

        this.gateway = gateway;
    }

    //* این تابع Sessionهای مجاز خارجی مانند NPC را بدون افزودن آن‌ها به Authority فاصله V3 معرفی می‌کند.
    setExternalSessionProvider(provider) {
        if (provider !== null && typeof provider !== "function") {
            throw new TypeError("external Voice session provider must be null or a function.");
        }
        this.externalSessionProvider = provider;
    }

    //* این تابع فقط از Stateهای موجود Mic و Speaker نتیجه شرط مستقل عضویت Voice Session را به رجیستری می‌نویسد.
    synchronizeSessionEligibilityFromLocalControls(
        connectionId,
        source
    ) {
        const normalizedConnectionId =
            String(
                connectionId ??
                ""
            )
                .trim()
                .toLowerCase();

        if (!normalizedConnectionId) {
            return null;
        }

        if (
            typeof this.voiceConnectionRegistry
                .setSessionEligibility !==
                "function"
        ) {
            throw new TypeError(
                "voiceConnectionRegistry must provide setSessionEligibility for Voice session eligibility synchronization."
            );
        }

        const micOn =
            this.publisherSettingsByConnectionId
                .has(
                    normalizedConnectionId
                );

        const speakerOff =
            this.muteRegistry
                .getSnapshot(
                    normalizedConnectionId
                )
                .speakerOff ===
            true;

        const eligible =
            micOn ||
            !speakerOff;

        const result =
            this.voiceConnectionRegistry
                .setSessionEligibility(
                    normalizedConnectionId,
                    eligible,
                    this.now()
                );

        if (result?.changed === true) {
            writeVoiceTrace(
                "SESSION_ELIGIBILITY_CHANGED",
                {
                    connectionId:
                        normalizedConnectionId,

                    source:
                        String(
                            source ??
                            "local_control"
                        ),

                    micOn,
                    speakerOff,
                    eligible
                }
            );
        }

        return result;
    }

    //* این تابع پایان احراز هویت را به هماهنگ‌کننده بازیابی اعلام و شمارنده جریان اتصال بازیابی‌شده را تازه می‌کند.
    async handleAuthenticated({
        transportConnection,
        registrationResult
    } = {}) {
        const connectionId =
            String(transportConnection?.connectionId ?? "")
                .trim()
                .toLowerCase();

        if (!connectionId) {
            throw new Error(
                "Authenticated Voice transport is missing its connection id."
            );
        }

        const resumed =
            registrationResult?.resumed === true;

        this.reconnectCoordinator
            .handleConnectionAuthenticated(
                connectionId,
                resumed
            );

        if (resumed) {
            this.packetFlowGuard.removeConnection(
                connectionId
            );
        }

        this.operationalMetrics?.increment?.(resumed ? "connections_resumed" : "connections_authenticated");
        this.auditLogger?.write?.({
            event: resumed ? "voice_reconnect" : "voice_auth",
            success: true,
            connectionId,
            userId: registrationResult?.userId ?? "",
            roomId: registrationResult?.roomId ?? ""
        });

        const snapshotSessionCount =
            await this.sendSessionSnapshotToConnection(
                transportConnection,
                connectionId
            );

        writeVoiceTrace("AUTH_SESSION_SNAPSHOT_SENT", {
            connectionId,
            userId: registrationResult?.userId ?? "",
            roomId: registrationResult?.roomId ?? "",
            resumed,
            snapshotSessionCount
        });

        return Object.freeze({
            handled: true,
            resumed,
            snapshotSessionCount
        });
    }

    async sendSessionSnapshotToConnection(
        transportConnection,
        connectionId
    ) {
        const sessions =
            this.voiceSessionRegistry
                .listActiveByConnectionId(
                    connectionId
                );

        writeVoiceTrace("SESSION_SNAPSHOT_SEND_START", {
            connectionId,
            sessionCount: sessions.length
        });

        await transportConnection.sendEnvelope({
            messageType:
                VoiceMessageType.SESSION_SNAPSHOT,
            payload:
                encodeVoiceSessionSnapshot({
                    sessions:
                        sessions.flatMap((session) =>
                            this.createSessionDescriptors(
                                session,
                                connectionId
                            )
                        )
                })
        });

        this.operationalMetrics?.increment?.(
            "session_snapshots_sent"
        );

        writeVoiceTrace("SESSION_SNAPSHOT_SEND_DONE", {
            connectionId,
            sessionCount: sessions.length
        });

        return sessions.length;
    }

    //* این تابع بسته‌شدن راه انتقال را بدون بستن فوری Sessionهای قابل بازیابی ثبت می‌کند.
    handleTransportClosed(input = {}) {
        return this.reconnectCoordinator
            .handleTransportClosed(input);
    }

    //* این تابع رویداد قطعی V3 را به پیام عضویت یا خروج V4 برای هر دو عضو تبدیل می‌کند.
    async handleDedicatedSessionEvent({
        event,
        applyResult
    } = {}) {
        const eventType =
            String(event?.type ?? "").trim();

        if (
            eventType !== "session_created" &&
            eventType !== "member_joined" &&
            eventType !== "member_left" &&
            eventType !== "session_closed"
        ) {
            writeVoiceTrace("DEDICATED_SESSION_EVENT_NOTIFICATION_SKIPPED", {
                eventType,
                reason: "non_membership_delta"
            });
            return;
        }

        const result =
            applyResult?.data?.result;

        const resolvedMemberConnectionId =
            String(
                applyResult?.data?.resolvedMemberConnectionId ??
                event?.memberConnectionId ??
                ""
            ).trim().toLowerCase();

        const session =
            result?.session ??
            result?.updated?.session ??
            result;

        if (
            !session ||
            !Array.isArray(session.participants)
        ) {
            return;
        }

        const pairClosedByMemberLeave =
            event?.type === "member_left" &&
            result?.closed === true;

        const sessionClosed =
            event?.type === "session_closed" ||
            pairClosedByMemberLeave;

        const groupMemberLeft =
            event?.type === "member_left" &&
            !sessionClosed;

        const messageType = sessionClosed
            ? VoiceMessageType.SESSION_CLOSED
            : groupMemberLeft
                ? VoiceMessageType.SESSION_LEFT
                : VoiceMessageType.SESSION_JOINED;

        writeVoiceTrace("DEDICATED_SESSION_EVENT_RECEIVED", {
            eventType: event?.type ?? "",
            sessionId: session.sessionId ?? "",
            participantCount: session.participants.length,
            messageType,
            memberConnectionId:
                resolvedMemberConnectionId,
            sessionClosed
        });

        const deliveries = [];

        for (const participant of session.participants) {
            const target =
                this.gateway
                    ?.getConnectionByConnectionId(
                        participant.connectionId
                    );

            if (!target) {
                writeVoiceTrace("DEDICATED_SESSION_EVENT_TARGET_MISSING", {
                    sessionId: session.sessionId ?? "",
                    targetConnectionId: participant.connectionId
                });
                continue;
            }

            const descriptors =
                this.createSessionDescriptors(
                    session,
                    participant.connectionId
                );

            if (groupMemberLeft) {
                deliveries.push(
                    target.sendEnvelope({
                        messageType:
                            VoiceMessageType.SESSION_LEFT,
                        sessionId:
                            session.sessionId,
                        senderId:
                            resolvedMemberConnectionId,
                        payload:
                            encodeVoiceSessionDescriptor(
                                descriptors[0]
                            )
                    })
                );
                continue;
            }

            if (sessionClosed) {
                deliveries.push(
                    target.sendEnvelope({
                        messageType:
                            VoiceMessageType.SESSION_CLOSED,
                        sessionId:
                            session.sessionId,
                        payload:
                            encodeVoiceSessionDescriptor(
                                descriptors[0]
                            )
                    })
                );
                continue;
            }

            for (const descriptor of descriptors) {
                deliveries.push(
                    target.sendEnvelope({
                        messageType:
                            VoiceMessageType.SESSION_JOINED,
                        sessionId:
                            session.sessionId,
                        senderId:
                            descriptor.peerConnectionId,
                        payload:
                            encodeVoiceSessionDescriptor(
                                descriptor
                            )
                    })
                );
            }
        }

        if (groupMemberLeft) {
            const leavingTarget =
                this.gateway
                    ?.getConnectionByConnectionId(
                        resolvedMemberConnectionId
                    );

            if (leavingTarget && session.participants.length >= 2) {
                const referenceDescriptor =
                    this.createSessionDescriptor(
                        session,
                        session.participants[0].connectionId
                    );

                deliveries.push(
                    leavingTarget.sendEnvelope({
                        messageType:
                            VoiceMessageType.SESSION_LEFT,
                        sessionId:
                            session.sessionId,
                        senderId:
                            VoiceBinaryProtocolConstants.emptyUuid,
                        payload:
                            encodeVoiceSessionDescriptor(
                                referenceDescriptor
                            )
                    })
                );
            }
        }

        const deliveryResults =
            await Promise.allSettled(deliveries);

        writeVoiceTrace("DEDICATED_SESSION_EVENT_SEND_DONE", {
            eventType: event?.type ?? "",
            sessionId: session.sessionId ?? "",
            deliveryAttempts: deliveries.length,
            fulfilled: deliveryResults.filter((result) => result.status === "fulfilled").length,
            rejected: deliveryResults.filter((result) => result.status === "rejected").length
        });
    }

    //* این تابع پیام‌های کاربردی V4 را پس از احراز هویت به پردازش تخصصی آن‌ها هدایت می‌کند.
    async handleEnvelope({
        envelope,
        transportConnection
    } = {}) {
        if (!envelope || !transportConnection) {
            throw new TypeError(
                "Voice routing envelope and transport connection are required."
            );
        }

        if (
            envelope.messageType ===
            VoiceMessageType.PUBLISH_START
        ) {
            await this.handlePublishStart(
                envelope,
                transportConnection
            );
            return Object.freeze({ handled: true });
        }

        if (
            envelope.messageType ===
            VoiceMessageType.VOICE_FRAME
        ) {
            await this.handleVoiceFrame(
                envelope,
                transportConnection
            );
            return Object.freeze({ handled: true });
        }

        if (
            envelope.messageType ===
            VoiceMessageType.PUBLISH_STOP
        ) {
            await this.handlePublishStop(
                envelope,
                transportConnection
            );
            return Object.freeze({ handled: true });
        }

        if (
            envelope.messageType ===
            VoiceMessageType.LISTENER_MUTE_CHANGED
        ) {
            await this.handleListenerMuteChanged(
                envelope,
                transportConnection
            );
            return Object.freeze({ handled: true });
        }

        if (
            envelope.messageType ===
            VoiceMessageType.RECONNECT_REQUEST
        ) {
            await this.handleReconnectRequest(
                envelope,
                transportConnection
            );
            return Object.freeze({ handled: true });
        }

        if (
            envelope.messageType ===
            VoiceMessageType.RECORDING_CONSENT_CHANGED
        ) {
            await this.handleRecordingConsentChanged(
                envelope,
                transportConnection
            );
            return Object.freeze({ handled: true });
        }

        return Object.freeze({ handled: false });
    }

    //* این تابع انتشار یک استریم مرجع اوپوس را برای اتصال فعال ثبت و فرمان را تأیید می‌کند.
    async handlePublishStart(
        envelope,
        transportConnection
    ) {
        this.assertControlEnvelopeUsesNoSession(envelope);

        const settings =
            decodeVoicePublishStartPayload(
                envelope.payload
            );

        writeVoiceTrace("PUBLISH_START_RECEIVED", {
            connectionId: transportConnection.connectionId,
            sequence: envelope.sequence,
            payloadBytes: envelope.payloadLength,
            settings
        });

        const existing =
            this.publisherSettingsByConnectionId.get(
                transportConnection.connectionId
            );

        const idempotent =
            existing &&
            JSON.stringify(existing) ===
                JSON.stringify(settings);

        this.publisherSettingsByConnectionId.set(
            transportConnection.connectionId,
            settings
        );

        this.synchronizeSessionEligibilityFromLocalControls(
            transportConnection.connectionId,
            "publish_start"
        );

        await this.sendControlAck(
            transportConnection,
            envelope.sequence,
            idempotent
                ? VoiceControlAckCode.IDEMPOTENT
                : VoiceControlAckCode.ACCEPTED
        );

        writeVoiceTrace("PUBLISH_START_ACK_SENT", {
            connectionId: transportConnection.connectionId,
            sequence: envelope.sequence,
            idempotent
        });
    }

    //* این تابع توقف انتشار را ثبت، به شنونده‌های Sessionهای فعال اعلام و فرمان را تأیید می‌کند.
    async handlePublishStop(
        envelope,
        transportConnection
    ) {
        this.assertControlEnvelopeUsesNoSession(envelope);
        decodeVoicePublishStopPayload(envelope.payload);

        const removed =
            this.publisherSettingsByConnectionId.delete(
                transportConnection.connectionId
            );

        writeVoiceTrace("PUBLISH_STOP_RECEIVED", {
            connectionId: transportConnection.connectionId,
            sequence: envelope.sequence,
            removed
        });

        this.synchronizeSessionEligibilityFromLocalControls(
            transportConnection.connectionId,
            "publish_stop"
        );

        const sessions =
            this.voiceSessionRegistry
                .listActiveByConnectionId(
                    transportConnection.connectionId
                );

        await Promise.allSettled(
            sessions.map((session) =>
                this.forwardPublishStop(
                    session,
                    envelope,
                    transportConnection.connectionId
                )
            )
        );

        await this.sendControlAck(
            transportConnection,
            envelope.sequence,
            removed
                ? VoiceControlAckCode.ACCEPTED
                : VoiceControlAckCode.IDEMPOTENT
        );
    }

    //* این تابع Speaker Off، Mute All یا Mute یک فرستنده را فقط در جهت شنونده اعمال می‌کند.
    async handleListenerMuteChanged(
        envelope,
        transportConnection
    ) {
        this.assertControlEnvelopeUsesNoSession(envelope);

        const change =
            decodeVoiceListenerMuteChangedPayload(
                envelope.payload
            );

        if (
            change.kind ===
            VoiceListenerMuteKind.PER_USER &&
            !this.hasActivePeer(
                transportConnection.connectionId,
                change.targetConnectionId
            )
        ) {
            throw new Error(
                "Per-user mute target is not an active Voice session peer."
            );
        }

        this.muteRegistry.applyChange({
            listenerConnectionId:
                transportConnection.connectionId,
            kind: change.kind,
            muted: change.muted,
            targetConnectionId:
                change.targetConnectionId
        });

        if (
            change.kind ===
            VoiceListenerMuteKind.SPEAKER_OFF
        ) {
            this.synchronizeSessionEligibilityFromLocalControls(
                transportConnection.connectionId,
                "speaker_off"
            );
        }

        this.operationalMetrics?.increment?.("mute_changes");

        await this.sendControlAck(
            transportConnection,
            envelope.sequence,
            VoiceControlAckCode.ACCEPTED
        );
    }

    //* این تابع یک فریم اوپوس را بدون رمزگشایی و رمزگذاری فقط به همتایان Sessionهای قطعی می‌فرستد.
    async handleVoiceFrame(
        envelope,
        transportConnection
    ) {
        if (
            envelope.sessionId !==
            VoiceBinaryProtocolConstants.emptyUuid
        ) {
            throw new Error(
                "A published reference Voice frame must not select a session."
            );
        }

        const connectionId =
            transportConnection.connectionId;

        const traceFrameCount =
            (this.voiceFrameTraceByConnectionId.get(connectionId) ?? 0) + 1;
        this.voiceFrameTraceByConnectionId.set(
            connectionId,
            traceFrameCount
        );
        const shouldTraceFrame =
            shouldLogVoiceFrameTrace(traceFrameCount);

        if (shouldTraceFrame) {
            writeVoiceTrace("VOICE_FRAME_INGRESS", {
                connectionId,
                sequence: envelope.sequence,
                payloadBytes: envelope.payloadLength,
                frameCountForConnection: traceFrameCount,
                hasPublisherStart: this.publisherSettingsByConnectionId.has(connectionId)
            });
        }

        if (
            !this.publisherSettingsByConnectionId.has(
                connectionId
            )
        ) {
            writeVoiceTrace("VOICE_FRAME_REJECTED", {
                connectionId,
                sequence: envelope.sequence,
                reason: "publish_start_missing"
            });
            throw new Error(
                "PUBLISH_START is required before VOICE_FRAME."
            );
        }

        const publisher =
            this.voiceConnectionRegistry
                .getByConnectionId(connectionId);

        if (
            !publisher ||
            publisher.state !== VoiceConnectionState.ACTIVE
        ) {
            throw new Error(
                "Voice publisher connection is not active."
            );
        }

        const inspection =
            this.packetFlowGuard.inspect({
                connectionId,
                sequence: envelope.sequence,
                timestampMs: envelope.timestampMs,
                payloadBytes: envelope.payloadLength
            });

        if (!inspection.accepted) {
            writeVoiceTrace("VOICE_FRAME_FLOW_GUARD_REJECTED", {
                connectionId,
                sequence: envelope.sequence,
                reason: inspection.reason ?? inspection.dropReason ?? "unknown"
            });
            return inspection;
        }

        const logicalReceivedSequence =
            envelope.sequence > publisher.lastReceivedSequence
                ? envelope.sequence
                : publisher.lastReceivedSequence + 1;

        const logicalPublishedSequence =
            envelope.sequence > publisher.lastPublishedSequence
                ? envelope.sequence
                : publisher.lastPublishedSequence + 1;

        publisher.updateSequences({
            lastReceivedSequence:
                logicalReceivedSequence,
            lastPublishedSequence:
                logicalPublishedSequence
        });

        const sessions =
            this.voiceSessionRegistry
                .listActiveByConnectionId(
                    connectionId
                );

        if (shouldTraceFrame || sessions.length === 0) {
            writeVoiceTrace("VOICE_FRAME_ACTIVE_SESSIONS_RESOLVED", {
                connectionId,
                sequence: envelope.sequence,
                sessionCount: sessions.length
            });
        }

        if (this.recordingService) {
            for (const session of sessions) {
                try {
                    const captureAccepted =
                        this.recordingService.captureFrame({
                            session,
                            publisherConnectionId:
                                connectionId,
                            payload:
                                envelope.payload
                        });

                    if (shouldTraceFrame || !captureAccepted) {
                        writeVoiceTrace("RECORDING_CAPTURE_FRAME_RESULT", {
                            connectionId,
                            sequence: envelope.sequence,
                            sessionId: session.sessionId,
                            accepted: captureAccepted,
                            payloadBytes: envelope.payloadLength
                        });
                    }
                } catch (error) {
                    writeVoiceTrace("RECORDING_CAPTURE_FRAME_ERROR", {
                        connectionId,
                        sequence: envelope.sequence,
                        sessionId: session.sessionId,
                        error: error?.message ?? String(error)
                    });
                    // شکست ضبط نباید مسیر زنده صوت را قطع کند.
                }
            }
        } else if (shouldTraceFrame) {
            writeVoiceTrace("RECORDING_CAPTURE_FRAME_SKIPPED", {
                connectionId,
                sequence: envelope.sequence,
                reason: "recording_service_missing"
            });
        }

        const routeCandidates = [];
        const routedListenerConnectionIds = new Set();

        for (const session of sessions) {
            let peerCount = 0;

            for (const peer of session.participants) {
                if (peer.connectionId === connectionId) continue;
                peerCount += 1;

                if (
                    routedListenerConnectionIds.has(
                        peer.connectionId
                    )
                ) {
                    writeVoiceTrace("VOICE_FRAME_ROUTE_DUPLICATE_SKIPPED", {
                        connectionId,
                        listenerConnectionId:
                            peer.connectionId,
                        sequence:
                            envelope.sequence,
                        sessionId:
                            session.sessionId
                    });
                    continue;
                }

                routedListenerConnectionIds.add(
                    peer.connectionId
                );
                routeCandidates.push({
                    session,
                    peer
                });
            }

            if (peerCount === 0) {
                writeVoiceTrace("VOICE_FRAME_ROUTE_DROPPED", {
                    connectionId,
                    sequence: envelope.sequence,
                    sessionId: session.sessionId,
                    reason: "peer_missing"
                });
            }
        }

        if (
            routeCandidates.length >
            this.policy.maxFanOutPerFrame
        ) {
            writeVoiceTrace("VOICE_FRAME_ROUTE_DROPPED", {
                connectionId,
                sequence: envelope.sequence,
                reason: VoiceRoutingDropReason.FAN_OUT_LIMIT,
                sessionCount: sessions.length,
                routeCandidateCount:
                    routeCandidates.length
            });
            this.recordRouteDrop(
                VoiceRoutingDropReason.FAN_OUT_LIMIT
            );
            return Object.freeze({
                accepted: false,
                dropReason:
                    VoiceRoutingDropReason.FAN_OUT_LIMIT
            });
        }

        const deliveries = [];

        for (const candidate of routeCandidates) {
            const session = candidate.session;
            const peer = candidate.peer;

            if (
                !this.muteRegistry.isRouteAllowed(
                    peer.connectionId,
                    connectionId
                )
            ) {
                writeVoiceTrace("VOICE_FRAME_ROUTE_DROPPED", {
                    connectionId,
                    listenerConnectionId: peer.connectionId,
                    sequence: envelope.sequence,
                    sessionId: session.sessionId,
                    reason: VoiceRoutingDropReason.LISTENER_MUTED
                });
                this.recordRouteDrop(
                    VoiceRoutingDropReason.LISTENER_MUTED
                );
                continue;
            }

            const listenerRecord =
                this.voiceConnectionRegistry
                    .getByConnectionId(
                        peer.connectionId
                    );

            const listenerTransport =
                this.gateway
                    ?.getConnectionByConnectionId(
                        peer.connectionId
                    );

            if (
                !listenerRecord ||
                listenerRecord.state !==
                    VoiceConnectionState.ACTIVE ||
                !listenerTransport
            ) {
                writeVoiceTrace("VOICE_FRAME_ROUTE_DROPPED", {
                    connectionId,
                    listenerConnectionId: peer.connectionId,
                    sequence: envelope.sequence,
                    sessionId: session.sessionId,
                    reason: VoiceRoutingDropReason.LISTENER_OFFLINE,
                    listenerRecordExists: Boolean(listenerRecord),
                    listenerTransportExists: Boolean(listenerTransport)
                });
                this.recordRouteDrop(
                    VoiceRoutingDropReason.LISTENER_OFFLINE
                );
                continue;
            }

            deliveries.push(
                this.forwardVoiceFrame({
                    listenerTransport,
                    sessionId: session.sessionId,
                    publisherConnectionId:
                        connectionId,
                    envelope
                })
            );
        }

        const deliveryResults =
            await Promise.allSettled(deliveries);

        for (const result of deliveryResults) {
            if (result.status === "fulfilled") {
                this.routedFrames += 1;
                this.routedBytes +=
                    envelope.payloadLength;
            } else {
                writeVoiceTrace("VOICE_FRAME_ROUTE_DROPPED", {
                    connectionId,
                    sequence: envelope.sequence,
                    reason: VoiceRoutingDropReason.LISTENER_BACKPRESSURE,
                    error: result.reason?.message ?? String(result.reason ?? "")
                });
                this.recordRouteDrop(
                    VoiceRoutingDropReason
                        .LISTENER_BACKPRESSURE
                );
            }
        }

        if (shouldTraceFrame || deliveryResults.length === 0) {
            writeVoiceTrace("VOICE_FRAME_ROUTE_RESULT", {
                connectionId,
                sequence: envelope.sequence,
                sessionCount: sessions.length,
                deliveryAttempts: deliveryResults.length,
                delivered: deliveryResults.filter(
                    (result) => result.status === "fulfilled"
                ).length,
                payloadBytes: envelope.payloadLength
            });
        }

        this.operationalMetrics?.increment?.("routed_frames", deliveryResults.filter(
            (result) => result.status === "fulfilled"
        ).length);
        this.operationalMetrics?.increment?.("routed_bytes", envelope.payloadLength * deliveryResults.filter(
            (result) => result.status === "fulfilled"
        ).length);

        return Object.freeze({
            accepted: true,
            delivered: deliveryResults.filter(
                (result) => result.status === "fulfilled"
            ).length
        });
    }

    //* این تابع رضایت ضبط را فقط برای Session فعال عضو احراز‌شده اعمال و وضعیت را برای هر دو عضو ارسال می‌کند.
    async handleRecordingConsentChanged(
        envelope,
        transportConnection
    ) {
        writeVoiceTrace("RECORDING_CONSENT_RECEIVED", {
            connectionId: transportConnection.connectionId,
            sessionId: envelope.sessionId,
            sequence: envelope.sequence,
            payloadBytes: envelope.payloadLength
        });

        if (!this.recordingService) {
            writeVoiceTrace("RECORDING_CONSENT_REJECTED", {
                connectionId: transportConnection.connectionId,
                sessionId: envelope.sessionId,
                reason: "recording_service_missing"
            });
            throw new Error(
                "Voice recording is not enabled."
            );
        }

        if (
            envelope.sessionId ===
            VoiceBinaryProtocolConstants.emptyUuid
        ) {
            writeVoiceTrace("RECORDING_CONSENT_REJECTED", {
                connectionId: transportConnection.connectionId,
                reason: "empty_session_id"
            });
            throw new Error(
                "Voice recording consent requires a session id."
            );
        }

        const activeSessions =
            this.voiceSessionRegistry
                .listActiveByConnectionId(
                    transportConnection.connectionId
                );

        const session =
            activeSessions
                .find(
                    (item) =>
                        item.sessionId ===
                        envelope.sessionId
                ) ??
            this.externalSessionProvider?.({
                sessionId: envelope.sessionId,
                connectionId: transportConnection.connectionId
            }) ??
            null;

        writeVoiceTrace("RECORDING_CONSENT_SESSION_LOOKUP", {
            connectionId: transportConnection.connectionId,
            sessionId: envelope.sessionId,
            activeSessionCount: activeSessions.length,
            found: Boolean(session)
        });

        if (!session) {
            writeVoiceTrace("RECORDING_CONSENT_DROPPED", {
                connectionId: transportConnection.connectionId,
                sessionId: envelope.sessionId,
                reason: "session_not_active_for_connection",
                activeSessionCount: activeSessions.length
            });

            await this.sendControlAck(
                transportConnection,
                envelope.sequence,
                VoiceControlAckCode.DROPPED
            );

            return Object.freeze({
                accepted: false,
                dropped: true,
                reason: "session_not_active_for_connection"
            });
        }

        const consent =
            decodeVoiceRecordingConsentPayload(
                envelope.payload
            );

        writeVoiceTrace("RECORDING_CONSENT_DECODED", {
            connectionId: transportConnection.connectionId,
            sessionId: envelope.sessionId,
            consented: consent.consented
        });

        const snapshot =
            await this.recordingService.updateConsent({
                session,
                connectionId:
                    transportConnection.connectionId,
                consented:
                    consent.consented,
                changedAtMs:
                    this.now()
            });

        writeVoiceTrace("RECORDING_CONSENT_UPDATE_ACCEPTED", {
            connectionId: transportConnection.connectionId,
            sessionId: envelope.sessionId,
            state: snapshot?.state ?? "null",
            consentCount: snapshot?.consents ? Object.keys(snapshot.consents).length : 0,
            recordingStarted: snapshot?.state === VoiceRecordingState.RECORDING
        });

        await this.sendControlAck(
            transportConnection,
            envelope.sequence,
            VoiceControlAckCode.ACCEPTED
        );

        writeVoiceTrace("RECORDING_CONSENT_ACK_SENT", {
            connectionId: transportConnection.connectionId,
            sessionId: envelope.sessionId,
            sequence: envelope.sequence
        });

        const stateDeliveryResults =
            await Promise.allSettled(
                session.participants.map((participant) => {
                const target =
                    this.gateway
                        ?.getConnectionByConnectionId(
                            participant.connectionId
                        );

                if (!target) {
                    writeVoiceTrace("RECORDING_STATE_TARGET_MISSING", {
                        sessionId: session.sessionId,
                        targetConnectionId: participant.connectionId
                    });
                    return Promise.resolve(false);
                }

                return target.sendEnvelope({
                    messageType:
                        VoiceMessageType
                            .RECORDING_STATE_CHANGED,
                    sessionId:
                        session.sessionId,
                    payload:
                        encodeVoiceRecordingStatePayload({
                            state:
                                snapshot?.state ??
                                VoiceRecordingState
                                    .WAITING_CONSENT
                        })
                });
                })
            );

        writeVoiceTrace("RECORDING_STATE_BROADCAST_DONE", {
            sessionId: session.sessionId,
            fulfilled: stateDeliveryResults.filter((result) => result.status === "fulfilled").length,
            rejected: stateDeliveryResults.filter((result) => result.status === "rejected").length
        });
    }

    //* این تابع درخواست Snapshot پس از بازیابی را با هویت احراز‌شده تطبیق و پاسخ می‌دهد.
    async handleReconnectRequest(
        envelope,
        transportConnection
    ) {
        this.assertControlEnvelopeUsesNoSession(envelope);

        const request =
            decodeVoiceReconnectRequest(
                envelope.payload
            );

        const connection =
            this.voiceConnectionRegistry
                .getByConnectionId(
                    transportConnection.connectionId
                );

        if (!connection) {
            throw new Error(
                "Authenticated reconnect connection is missing."
            );
        }

        const matchesIdentity =
            request.previousVoiceConnectionId ===
                connection.connectionId &&
            request.clientInstanceId ===
                connection.clientInstanceId &&
            request.roomId ===
                connection.roomId &&
            request.avatarId ===
                connection.userId;

        if (!matchesIdentity) {
            await transportConnection.sendEnvelope({
                messageType:
                    VoiceMessageType.RECONNECT_RESULT,
                payload:
                    encodeVoiceReconnectResult({
                        success: false,
                        retryable: false,
                        code:
                            VoiceReconnectResultCode
                                .INVALID_PAYLOAD,
                        serverTimeMs:
                            this.now(),
                        message:
                            "Reconnect identity does not match the authenticated connection."
                    })
            });
            return;
        }

        const reconnectServerNowMs =
            this.now();

        const serverAlreadyResumed =
            connection.state ===
                VoiceConnectionState.ACTIVE &&
            connection.resumedAtMs !== null;

        if (serverAlreadyResumed) {
            const clientDisconnectedAtMs =
                BigInt(request.disconnectedAtMs);

            const serverNowBigInt =
                BigInt(reconnectServerNowMs);

            writeVoiceTrace(
                "RECONNECT_SERVER_RESUME_CONFIRMED",
                {
                    connectionId:
                        connection.connectionId,
                    resumedAtMs:
                        connection.resumedAtMs,
                    clientDisconnectedAtMs,
                    serverNowMs:
                        reconnectServerNowMs,
                    clientClockAheadMs:
                        clientDisconnectedAtMs >
                            serverNowBigInt
                            ? clientDisconnectedAtMs -
                                serverNowBigInt
                            : 0n
                }
            );
        } else {
            const window =
                evaluateVoiceReconnectWindow({
                    disconnectedAtMs:
                        request.disconnectedAtMs,
                    nowMs:
                        reconnectServerNowMs
                });

            if (!window.automaticRetryAllowed) {
                await transportConnection.sendEnvelope({
                    messageType:
                        VoiceMessageType.RECONNECT_RESULT,
                    payload:
                        encodeVoiceReconnectResult({
                            success: false,
                            retryable: false,
                            code:
                                window.connectionRetainedByServer
                                    ? VoiceReconnectResultCode
                                        .CLIENT_DEADLINE_EXPIRED
                                    : VoiceReconnectResultCode
                                        .SERVER_RETENTION_EXPIRED,
                            serverTimeMs:
                                reconnectServerNowMs,
                            message:
                                "Reconnect deadline expired."
                        })
                });
                return;
            }
        }

        const sessions =
            this.voiceSessionRegistry
                .listActiveByConnectionId(
                    connection.connectionId
                );

        await transportConnection.sendEnvelope({
            messageType:
                VoiceMessageType.RECONNECT_RESULT,
            payload:
                encodeVoiceReconnectResult({
                    success: true,
                    retryable: false,
                    code:
                        VoiceReconnectResultCode.RESUMED,
                    voiceConnectionId:
                        connection.connectionId,
                    resumeFromSequence:
                        connection.lastPublishedSequence,
                    serverTimeMs:
                        this.now(),
                    retainedSessionCount:
                        sessions.length,
                    message:
                        "Voice connection and sessions resumed."
                })
        });

        await transportConnection.sendEnvelope({
            messageType:
                VoiceMessageType.SESSION_SNAPSHOT,
            payload:
                encodeVoiceSessionSnapshot({
                    sessions:
                        sessions.flatMap((session) =>
                            this.createSessionDescriptors(
                                session,
                                connection.connectionId
                            )
                        )
                })
        });
    }

    //* این تابع فریم زنده را در صف کوتاه رسانه شنونده قرار می‌دهد تا پردازش ورودی منتظر شبکه خروجی نماند.
    async forwardVoiceFrame({
        listenerTransport,
        sessionId,
        publisherConnectionId,
        envelope
    }) {
        const routedAtMs = this.now();
        const mediaEnvelope = {
            messageType:
                VoiceMessageType.VOICE_FRAME,
            flags:
                envelope.flags,
            timestampMs:
                routedAtMs,
            sessionId,
            senderId:
                publisherConnectionId,
            payload:
                envelope.payload
        };

        if (
            typeof listenerTransport
                .enqueueMediaEnvelope ===
                "function"
        ) {
            const accepted =
                listenerTransport
                    .enqueueMediaEnvelope(
                        mediaEnvelope
                    );

            if (!accepted) {
                throw new Error(
                    "Voice listener media queue is not accepting frames."
                );
            }

            return true;
        }

        try {
            await listenerTransport
                .sendEnvelope(
                    mediaEnvelope
                );

            return true;
        } catch (error) {
            await listenerTransport.close({
                closeMessage:
                    error?.message ?? String(error),
                registryReason:
                    VoiceConnectionCloseReason
                        .TRANSPORT_CLOSED
            });
            throw error;
        }
    }

    //* این تابع توقف انتشار را به همه همتایان همان Session می‌فرستد.
    async forwardPublishStop(
        session,
        envelope,
        publisherConnectionId
    ) {
        const peers =
            session.participants.filter(
                (participant) =>
                    participant.connectionId !==
                    publisherConnectionId
            );

        if (peers.length === 0) return false;

        const deliveries = [];

        for (const peer of peers) {
            const listener =
                this.gateway
                    ?.getConnectionByConnectionId(
                        peer.connectionId
                    );

            if (!listener) continue;

            deliveries.push(
                listener.sendEnvelope({
                    messageType:
                        VoiceMessageType.PUBLISH_STOP,
                    flags:
                        VoiceMessageFlag.END_OF_STREAM,
                    sessionId:
                        session.sessionId,
                    senderId:
                        publisherConnectionId,
                    payload:
                        envelope.payload
                })
            );
        }

        const results =
            await Promise.allSettled(deliveries);

        return results.some(
            (result) =>
                result.status === "fulfilled"
        );
    }

    //* این تابع تأیید فرمان کنترل را با شماره پیام دریافتی برمی‌گرداند.
    sendControlAck(
        transportConnection,
        sequence,
        code
    ) {
        return transportConnection.sendEnvelope({
            messageType:
                VoiceMessageType.ACK,
            payload:
                encodeVoiceControlAckPayload({
                    sequence,
                    code
                })
        });
    }

    //* این تابع اجباری می‌کند فرمان کنترلی مستقل از Session انتخاب‌شده باشد.
    assertControlEnvelopeUsesNoSession(envelope) {
        if (
            envelope.sessionId !==
            VoiceBinaryProtocolConstants.emptyUuid
        ) {
            throw new Error(
                "Voice routing control message must not select a session."
            );
        }
    }

    //* این تابع وجود یک Session فعال مستقیم میان شنونده و هدف را بررسی می‌کند.
    hasActivePeer(
        listenerConnectionId,
        targetConnectionId
    ) {
        const authoritativeMatch = this.voiceSessionRegistry
            .listActiveByConnectionId(
                listenerConnectionId
            )
            .some((session) =>
                session.participants.some(
                    (participant) =>
                        participant.connectionId ===
                        targetConnectionId
                )
            );

        if (authoritativeMatch) return true;

        const externalMatch = this.externalSessionProvider?.({
            connectionId: listenerConnectionId,
            targetConnectionId
        });
        return externalMatch !== null && externalMatch !== undefined;
    }

    //* این تابع Snapshot داخلی Session را به Descriptor قابل ارسال برای همان اتصال تبدیل می‌کند.
    createSessionDescriptor(
        session,
        connectionId
    ) {
        const descriptors =
            this.createSessionDescriptors(
                session,
                connectionId
            );

        if (descriptors.length === 0) {
            throw new Error(
                "Voice session snapshot does not contain the authenticated connection."
            );
        }

        return descriptors[0];
    }

    //* این تابع برای هر Peer یک Descriptor شامل userId و connectionId می‌سازد تا Group Mapping قطعی باشد.
    createSessionDescriptors(
        session,
        connectionId
    ) {
        if (
            !session ||
            !Array.isArray(session.participants) ||
            !session.participants.some(
                (participant) =>
                    participant.connectionId ===
                    connectionId
            )
        ) {
            throw new Error(
                "Voice session snapshot does not contain the authenticated connection."
            );
        }

        return Object.freeze(
            session.participants
                .filter(
                    (participant) =>
                        participant.connectionId !==
                        connectionId
                )
                .map(
                    (peer) => Object.freeze({
                        sessionId: session.sessionId,
                        state: session.state,
                        reason: session.reason,
                        distanceMeters: session.distanceMeters,
                        effectiveAtMs: session.effectiveAtMs,
                        peerUserId: peer.userId,
                        peerAvatarId: peer.userId,
                        peerConnectionId:
                            peer.connectionId
                    })
                )
        );
    }

    //* این تابع علت رد یک مسیر خروجی را در آمار محدود ثبت می‌کند.
    recordRouteDrop(reason) {
        this.droppedRoutesByReason.set(
            reason,
            (this.droppedRoutesByReason.get(reason) ?? 0) + 1
        );
        this.operationalMetrics?.increment?.("dropped_routes");
    }

    //* این تابع وضعیت مسیر زنده را بدون نگهداری داده صوتی برمی‌گرداند.
    getStats() {
        return Object.freeze({
            activePublishers:
                this.publisherSettingsByConnectionId.size,
            routedFrames:
                this.routedFrames,
            routedBytes:
                this.routedBytes,
            droppedRoutesByReason:
                Object.freeze(
                    Object.fromEntries(
                        this.droppedRoutesByReason
                    )
                ),
            mute:
                this.muteRegistry.getStats(),
            packetFlow:
                this.packetFlowGuard.getStats(),
            reconnect:
                this.reconnectCoordinator.getStats()
        });
    }
}

export {
    VoiceRoutingApplication
};

/*
توضیح فایل:
این فایل پیام‌های V4 را پس از احراز هویت پردازش می‌کند، یک فریم مرجع اوپوس را بدون Decode/Encode فقط روی Sessionهای قطعی V3 توزیع می‌کند و Mute، فشار مسیر و Reconnect را به سرویس‌های مستقل واگذار می‌کند.
*/
