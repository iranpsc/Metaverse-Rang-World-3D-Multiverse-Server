import { AsyncLocalStorage } from "node:async_hooks";
import { VoiceBinaryProtocolConstants } from "../protocol/voiceBinaryProtocolConstants.js";
import { VoiceMessageType } from "../protocol/voiceMessageTypes.js";
import {
    VoiceMediaV2Codec,
    VoiceMediaV2Constants,
    VoiceMediaV2PacketKind,
    decodeVoiceMediaV2BindRequest,
    decodeVoiceMediaV2Packet,
    encodeVoiceMediaV2BindResult,
    encodeVoiceMediaV2Packet
} from "./voiceMediaV2Protocol.js";
import {
    authorizeVoiceMediaBoundControl,
    authorizeVoiceMediaV2Bind
} from "../security/voiceMediaBindAuthorizationPolicy.js";

const routeContext = new AsyncLocalStorage();

//* این تابع یک شناسه اتصال را برای جست و جوی یکنواخت پاک سازی می کند.
function normalizeConnectionId(value) {
    return String(value ?? "").trim().toLowerCase();
}

//* این تابع وضعیت دریافت شماره بسته را به روز می کند و ماسک تایید بسته های قبلی را می سازد.
function observeTransportSequence(state, sequence) {
    const current = Number(sequence) >>> 0;
    if (state.lastReceivedTransportSequence === null) {
        state.lastReceivedTransportSequence = current;
        state.receivedAckMask = 0;
        return;
    }
    const last = state.lastReceivedTransportSequence >>> 0;
    if (current > last) {
        const delta = current - last;
        state.receivedAckMask = delta >= 32 ? 0 : ((state.receivedAckMask << delta) | (1 << (delta - 1))) >>> 0;
        if (delta > 1) state.estimatedLostTransportPackets += delta - 1;
        state.lastReceivedTransportSequence = current;
        return;
    }
    const distance = last - current;
    if (distance > 0 && distance <= 32) state.receivedAckMask = (state.receivedAckMask | (1 << (distance - 1))) >>> 0;
}

//* این تابع تایید دریافتی طرف مقابل را برای محاسبه زمان رفت و برگشت بررسی می کند.
function observeRemoteAcknowledgement(state, ackSequence, ackMask, nowMs) {
    const candidates = [];
    if (ackSequence > 0) candidates.push(ackSequence >>> 0);
    for (let bit = 0; bit < 32; bit += 1) {
        if ((ackMask & (1 << bit)) !== 0 && ackSequence > bit + 1) candidates.push((ackSequence - bit - 1) >>> 0);
    }
    for (const sequence of candidates) {
        const sentAtMs = state.sentAtByTransportSequence.get(sequence);
        if (sentAtMs == null) continue;
        state.lastRttMs = Math.max(0, nowMs - sentAtMs);
        state.sentAtByTransportSequence.delete(sequence);
    }
    if (state.sentAtByTransportSequence.size > 256) {
        const keys = Array.from(state.sentAtByTransportSequence.keys()).sort((a, b) => a - b);
        for (const key of keys.slice(0, keys.length - 256)) state.sentAtByTransportSequence.delete(key);
    }
}

class VoiceMediaV2Connection {
    //* این سازنده یک اتصال مستقل مسیر رسانه را بدون دست زدن به اتصال مسیر کنترل ایجاد می کند.
    constructor({ transportConnectionKey, sendPacket, closeTransport, now = () => Date.now() } = {}) {
        if (!String(transportConnectionKey ?? "").trim()) throw new TypeError("transportConnectionKey is required.");
        if (typeof sendPacket !== "function" || typeof closeTransport !== "function" || typeof now !== "function") throw new TypeError("Media transport callbacks are invalid.");
        this.transportConnectionKey = String(transportConnectionKey).trim();
        this.sendPacket = sendPacket;
        this.closeTransport = closeTransport;
        this.now = now;
        this.active = false;
        this.closed = false;
        this.controlConnectionId = "";
        this.userId = "";
        this.roomId = "";
        this.streamId = VoiceMediaV2Constants.emptyUuid;
        this.nextTransportSequence = 1;
        this.lastReceivedTransportSequence = null;
        this.receivedAckMask = 0;
        this.estimatedLostTransportPackets = 0;
        this.lastRttMs = 0;
        this.sentAtByTransportSequence = new Map();
        this.receivedMediaFrames = 0;
        this.sentMediaFrames = 0;
    }

    //* این تابع شماره بعدی بسته مسیر رسانه را به صورت افزایشی تولید می کند.
    allocateTransportSequence() {
        const value = this.nextTransportSequence >>> 0;
        this.nextTransportSequence = value === 0xffffffff ? 1 : value + 1;
        return value;
    }

    //* این تابع یک بسته را همراه اطلاعات تایید دریافت و اندازه گیری زمان رفت و برگشت ارسال می کند.
    async send({ kind, codec, flags = 0, mediaSequence = 0, mediaTimestamp100Ns = 0n, sessionId, streamId, senderId, payload = null } = {}) {
        if (this.closed) throw new Error("Media connection is closed.");
        const transportSequence = this.allocateTransportSequence();
        const packet = encodeVoiceMediaV2Packet({
            kind,
            codec,
            flags,
            transportSequence,
            mediaSequence,
            mediaTimestamp100Ns,
            ackTransportSequence: this.lastReceivedTransportSequence ?? 0,
            ackMask: this.receivedAckMask,
            sessionId,
            streamId,
            senderId,
            securityContextId: 0,
            payload
        });
        this.sentAtByTransportSequence.set(transportSequence, this.now());
        await Promise.resolve(this.sendPacket(packet));
        if (kind === VoiceMediaV2PacketKind.MEDIA) this.sentMediaFrames += 1;
        return transportSequence;
    }

    //* این تابع اتصال مسیر رسانه را بدون بستن اتصال مسیر کنترل خاتمه می دهد.
    async close(reason = "media_closed") {
        if (this.closed) return;
        this.closed = true;
        this.active = false;
        await Promise.resolve(this.closeTransport(String(reason ?? "media_closed")));
    }

    //* این تابع آمار محدود اتصال مسیر رسانه را برای آزمون و پایش برمی گرداند.
    snapshot() {
        return Object.freeze({
            transportConnectionKey: this.transportConnectionKey,
            active: this.active,
            closed: this.closed,
            controlConnectionId: this.controlConnectionId,
            streamId: this.streamId,
            receivedMediaFrames: this.receivedMediaFrames,
            sentMediaFrames: this.sentMediaFrames,
            estimatedLostTransportPackets: this.estimatedLostTransportPackets,
            lastRttMs: this.lastRttMs
        });
    }
}

class VoiceMediaV2Registry {
    //* این سازنده نگهداری اتصال های مسیر رسانه را بر اساس راه انتقال و اتصال مسیر کنترل آماده می کند.
    constructor() {
        this.byTransportKey = new Map();
        this.byControlConnectionId = new Map();
    }

    //* این تابع اتصال تازه مسیر رسانه را ثبت می کند.
    add(connection) {
        if (this.byTransportKey.has(connection.transportConnectionKey)) throw new Error("Media transport key already exists.");
        this.byTransportKey.set(connection.transportConnectionKey, connection);
        return connection;
    }

    //* این تابع اتصال احراز شده مسیر رسانه را به اتصال مسیر کنترل متصل می کند و اتصال قبلی همان کاربر را برمی گرداند.
    bind(connection, controlConnectionId) {
        const key = normalizeConnectionId(controlConnectionId);
        const previous = this.byControlConnectionId.get(key) ?? null;
        this.byControlConnectionId.set(key, connection);
        return previous;
    }

    //* این تابع اتصال فعال مسیر رسانه را با شناسه اتصال مسیر کنترل پیدا می کند.
    getByControlConnectionId(controlConnectionId) {
        return this.byControlConnectionId.get(normalizeConnectionId(controlConnectionId)) ?? null;
    }

    //* این تابع اتصال بسته شده را از همه نمایه ها پاک می کند.
    remove(connection) {
        this.byTransportKey.delete(connection.transportConnectionKey);
        if (connection.controlConnectionId) {
            const current = this.byControlConnectionId.get(connection.controlConnectionId);
            if (current === connection) this.byControlConnectionId.delete(connection.controlConnectionId);
        }
    }

    //* این تابع تعداد اتصال های مسیر رسانه را برمی گرداند.
    getStats() {
        return Object.freeze({ total: this.byTransportKey.size, bound: this.byControlConnectionId.size });
    }
}

//* این تابع درگاه ترکیبی را می سازد تا پیام های کنترل روی مسیر قدیمی و فقط فریم های رسانه روی مسیر جدید ارسال شوند.
function createVoiceMediaV2CompositeGateway({ controlGateway, mediaRegistry, voiceConnectionRegistry } = {}) {
    if (!controlGateway || typeof controlGateway.getConnectionByConnectionId !== "function") throw new TypeError("controlGateway is invalid.");
    return Object.freeze({
        __voiceMediaV2Composite: true,
        getConnectionByConnectionId(connectionId) {
            const controlTransport = controlGateway.getConnectionByConnectionId(connectionId);
            if (!controlTransport) return null;
            return Object.freeze({
                connectionId: normalizeConnectionId(connectionId),
                async sendEnvelope(input = {}) {
                    if (input.messageType !== VoiceMessageType.VOICE_FRAME) return controlTransport.sendEnvelope(input);
                    const mediaConnection = mediaRegistry.getByControlConnectionId(connectionId);
                    if (!mediaConnection || !mediaConnection.active || mediaConnection.closed) throw new Error("Voice media plane is not bound for the listener.");
                    const context = routeContext.getStore();
                    if (!context) throw new Error("Voice media route context is missing.");
                    const publisher = voiceConnectionRegistry.getByConnectionId(input.senderId);
                    if (!publisher) throw new Error("Voice publisher record is missing.");
                    await mediaConnection.send({
                        kind: VoiceMediaV2PacketKind.MEDIA,
                        codec: VoiceMediaV2Codec.OPUS,
                        flags: Number(input.flags ?? 0) & 0xff,
                        mediaSequence: context.mediaSequence,
                        mediaTimestamp100Ns: context.mediaTimestamp100Ns,
                        sessionId: input.sessionId,
                        streamId: context.streamId,
                        senderId: input.senderId,
                        payload: input.payload
                    });
                },
                async close() {
                    const mediaConnection = mediaRegistry.getByControlConnectionId(connectionId);
                    if (mediaConnection) await mediaConnection.close("media_route_failure");
                }
            });
        }
    });
}

//* این تابع رانتایم مسیر رسانه نسل دوم را روی سرویس های زنده صوت می سازد و مسیر کنترل را دست نخورده نگه می دارد.
function createVoiceMediaV2Runtime({
    voiceConnectionRegistry,
    accessTokenVerifier,
    routingApplication,
    controlGateway,
    logger = null,
    now = () => Date.now()
} = {}) {
    if (!voiceConnectionRegistry || typeof voiceConnectionRegistry.getByConnectionId !== "function") throw new TypeError("voiceConnectionRegistry is invalid.");
    if (!accessTokenVerifier || typeof accessTokenVerifier.verify !== "function") throw new TypeError("accessTokenVerifier is invalid.");
    if (!routingApplication || typeof routingApplication.handleVoiceFrame !== "function" || typeof routingApplication.setGateway !== "function") throw new TypeError("routingApplication is invalid.");
    if (!controlGateway || typeof controlGateway.getConnectionByConnectionId !== "function") throw new TypeError("controlGateway is invalid.");

    const mediaRegistry = new VoiceMediaV2Registry();
    const compositeGateway = createVoiceMediaV2CompositeGateway({ controlGateway, mediaRegistry, voiceConnectionRegistry });
    routingApplication.setGateway(compositeGateway);
    let stopped = false;

    //* این تابع یک راه انتقال تازه برای مسیر رسانه ثبت می کند و پردازش بسته های آن را برمی گرداند.
    function acceptConnection({ transportConnectionKey, sendPacket, closeTransport } = {}) {
        if (stopped) throw new Error("Media runtime is stopped.");
        const connection = mediaRegistry.add(new VoiceMediaV2Connection({ transportConnectionKey, sendPacket, closeTransport, now }));

        //* این تابع یک بسته ورودی را احراز، اندازه گیری و در صورت رسانه بودن به مسیریاب صوت تحویل می دهد.
        async function receive(input) {
            if (connection.closed) return;
            const packet = decodeVoiceMediaV2Packet(input);

            if (!connection.active && packet.kind !== VoiceMediaV2PacketKind.BIND_REQUEST) {
                logger?.warn?.("VME2_MEDIA_PREBIND_REJECTED", { transportConnectionKey, packetKind: packet.kind });
                await connection.close("media_bind_required");
                mediaRegistry.remove(connection);
                return;
            }
            if (connection.active && packet.kind === VoiceMediaV2PacketKind.BIND_REQUEST) {
                logger?.warn?.("VME2_MEDIA_REBIND_REJECTED", { transportConnectionKey, connectionId: connection.controlConnectionId });
                await connection.close("media_rebind_rejected");
                mediaRegistry.remove(connection);
                return;
            }

            observeTransportSequence(connection, packet.transportSequence);
            observeRemoteAcknowledgement(connection, packet.ackTransportSequence, packet.ackMask, now());

            if (packet.kind === VoiceMediaV2PacketKind.BIND_REQUEST) {
                const request = decodeVoiceMediaV2BindRequest(packet.payload);
                const tokenResult = await Promise.resolve(accessTokenVerifier.verify(request.accessToken));
                const controlRecord = voiceConnectionRegistry.getByConnectionId(request.controlConnectionId);
                const authorization = authorizeVoiceMediaV2Bind({ packet, request, tokenResult, controlRecord });
                if (!authorization.allowed) {
                    logger?.warn?.("VME2_MEDIA_BIND_REJECTED", { transportConnectionKey, reason: authorization.reason });
                    await connection.send({
                        kind: VoiceMediaV2PacketKind.BIND_RESULT,
                        codec: VoiceMediaV2Codec.NONE,
                        streamId: packet.streamId,
                        payload: encodeVoiceMediaV2BindResult({ success: false, retryable: false, code: 1, message: "media_bind_rejected" })
                    });
                    await connection.close("media_bind_rejected");
                    mediaRegistry.remove(connection);
                    return;
                }
                connection.active = true;
                connection.controlConnectionId = authorization.controlConnectionId;
                connection.userId = authorization.userId;
                connection.roomId = authorization.roomId;
                connection.streamId = packet.streamId;
                const previous = mediaRegistry.bind(connection, connection.controlConnectionId);
                if (previous && previous !== connection) {
                    await previous.close("media_replaced");
                    mediaRegistry.remove(previous);
                }
                await connection.send({
                    kind: VoiceMediaV2PacketKind.BIND_RESULT,
                    codec: VoiceMediaV2Codec.NONE,
                    streamId: packet.streamId,
                    senderId: connection.controlConnectionId,
                    payload: encodeVoiceMediaV2BindResult({ success: true, code: 0, controlConnectionId: connection.controlConnectionId, message: "media_bind_ok" })
                });
                logger?.info?.("VME2_PHASE9_MEDIA_BIND=PASS", { connectionId: connection.controlConnectionId, transportConnectionKey });
                return;
            }

            const boundControlRecord = voiceConnectionRegistry.getByConnectionId(connection.controlConnectionId);
            const boundAuthorization = authorizeVoiceMediaBoundControl({
                controlConnectionId: connection.controlConnectionId,
                userId: connection.userId,
                roomId: connection.roomId,
                controlRecord: boundControlRecord
            });
            if (!boundAuthorization.allowed) {
                logger?.warn?.("VME2_MEDIA_AUTHORIZATION_REVOKED", { connectionId: connection.controlConnectionId, reason: boundAuthorization.reason });
                await connection.close("media_authorization_revoked");
                mediaRegistry.remove(connection);
                return;
            }

            if (packet.kind === VoiceMediaV2PacketKind.PING) {
                await connection.send({ kind: VoiceMediaV2PacketKind.PONG, codec: VoiceMediaV2Codec.NONE, streamId: connection.streamId, senderId: connection.controlConnectionId, payload: packet.payload });
                return;
            }

            if (packet.kind !== VoiceMediaV2PacketKind.MEDIA) return;
            if (!connection.active) throw new Error("Media frame arrived before bind.");
            if (packet.codec !== VoiceMediaV2Codec.OPUS || packet.payload.length === 0) throw new Error("Media frame codec or payload is invalid.");
            if (packet.sessionId !== VoiceMediaV2Constants.emptyUuid || packet.senderId !== VoiceMediaV2Constants.emptyUuid) throw new Error("Published media frame must not select session or sender.");
            if (packet.streamId !== connection.streamId) throw new Error("Media stream id changed after bind.");
            connection.receivedMediaFrames += 1;

            const envelope = Object.freeze({
                messageType: VoiceMessageType.VOICE_FRAME,
                flags: packet.flags,
                sequence: packet.mediaSequence,
                timestampMs: Number(packet.mediaTimestamp100Ns / 10000n),
                sessionId: VoiceBinaryProtocolConstants.emptyUuid,
                senderId: VoiceBinaryProtocolConstants.emptyUuid,
                payloadLength: packet.payload.length,
                payload: packet.payload
            });

            await routeContext.run(
                Object.freeze({ mediaSequence: packet.mediaSequence, mediaTimestamp100Ns: packet.mediaTimestamp100Ns, streamId: packet.streamId }),
                () => routingApplication.handleVoiceFrame(envelope, Object.freeze({ connectionId: connection.controlConnectionId }))
            );
        }

        //* این تابع بسته شدن راه انتقال را فقط از رجیستری مسیر رسانه پاک می کند.
        async function closed(reason = "media_transport_closed") {
            mediaRegistry.remove(connection);
            await connection.close(reason);
        }

        return Object.freeze({ connection, receive, closed });
    }

    //* این تابع مسیر رسانه را متوقف و درگاه مسیریابی قبلی مسیر کنترل را دوباره فعال می کند.
    async function stop() {
        if (stopped) return;
        stopped = true;
        const connections = Array.from(mediaRegistry.byTransportKey.values());
        await Promise.allSettled(connections.map((connection) => connection.close("media_runtime_stopped")));
        for (const connection of connections) mediaRegistry.remove(connection);
        routingApplication.setGateway(controlGateway);
    }

    //* این تابع آمار مسیر رسانه نسل دوم را برمی گرداند.
    function getStats() {
        return Object.freeze({ ...mediaRegistry.getStats(), stopped });
    }

    return Object.freeze({
        mediaRegistry,
        compositeGateway,
        acceptConnection,
        stop,
        getStats
    });
}

export {
    VoiceMediaV2Connection,
    VoiceMediaV2Registry,
    createVoiceMediaV2CompositeGateway,
    createVoiceMediaV2Runtime
};
