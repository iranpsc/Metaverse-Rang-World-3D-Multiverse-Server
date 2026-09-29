import {
    VoiceMediaV2Connection,
    VoiceMediaV2Registry
} from "../mediaV2/voiceMediaV2Runtime.js";
import {
    VoiceMediaV2Codec,
    VoiceMediaV2Constants,
    VoiceMediaV2PacketKind,
    decodeVoiceMediaV2BindRequest,
    decodeVoiceMediaV2Packet,
    encodeVoiceMediaV2BindResult
} from "../mediaV2/voiceMediaV2Protocol.js";
import { authorizeVoiceMediaV2BindPacket } from "../security/voiceMediaBindAuthorizationPolicy.js";

//* این تابع شماره بسته دریافتی را برای تایید و برآورد افت به روز می کند.
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

//* این تابع تاییدهای دریافت شده را برای اندازه گیری زمان رفت و برگشت اعمال می کند.
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

//* این تابع شناسه اتصال را برای نمایه رسانه یکدست می کند.
function normalizeConnectionId(value) {
    return String(value ?? "").trim().toLowerCase();
}

//* این تابع رانتایم مستقل نود رسانه را روی قرارداد قفل شده فاز نه می سازد.
function createVoiceMediaNodeRuntime({ bridgeClient, logger = null, now = () => Date.now() } = {}) {
    if (!bridgeClient || typeof bridgeClient.authorizeBind !== "function" || typeof bridgeClient.routeFrame !== "function") throw new TypeError("Bridge client is invalid.");
    const mediaRegistry = new VoiceMediaV2Registry();
    let stopped = false;

    //* این تابع یک اتصال تازه رسانه را ثبت و پردازشگر بسته های همان اتصال را برمی گرداند.
    function acceptConnection({ transportConnectionKey, sendPacket, closeTransport } = {}) {
        if (stopped) throw new Error("Media node runtime is stopped.");
        const connection = mediaRegistry.add(new VoiceMediaV2Connection({ transportConnectionKey, sendPacket, closeTransport, now }));

        //* این تابع هر بسته را با قرارداد فاز نه اعتبارسنجی و در نود مستقل پردازش می کند.
        async function receive(input) {
            if (connection.closed) return;
            const packet = decodeVoiceMediaV2Packet(input);

            if (!connection.active && packet.kind !== VoiceMediaV2PacketKind.BIND_REQUEST) {
                logger?.warn?.("VME2_MEDIA_NODE_PREBIND_REJECTED", { transportConnectionKey, packetKind: packet.kind });
                await connection.close("media_bind_required");
                mediaRegistry.remove(connection);
                return;
            }
            if (connection.active && packet.kind === VoiceMediaV2PacketKind.BIND_REQUEST) {
                logger?.warn?.("VME2_MEDIA_NODE_REBIND_REJECTED", { transportConnectionKey, connectionId: connection.controlConnectionId });
                await connection.close("media_rebind_rejected");
                mediaRegistry.remove(connection);
                return;
            }

            observeTransportSequence(connection, packet.transportSequence);
            observeRemoteAcknowledgement(connection, packet.ackTransportSequence, packet.ackMask, now());

            if (packet.kind === VoiceMediaV2PacketKind.BIND_REQUEST) {
                const packetAuthorization = authorizeVoiceMediaV2BindPacket(packet);
                if (!packetAuthorization.allowed) {
                    logger?.warn?.("VME2_MEDIA_NODE_BIND_REJECTED", { transportConnectionKey, reason: packetAuthorization.reason });
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
                const request = decodeVoiceMediaV2BindRequest(packet.payload);
                const authorization = await bridgeClient.authorizeBind({
                    accessToken: request.accessToken,
                    roomId: request.roomId,
                    controlConnectionId: request.controlConnectionId
                });
                if (authorization?.success !== true) {
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
                connection.controlConnectionId = normalizeConnectionId(authorization.controlConnectionId);
                connection.userId = String(authorization.userId ?? "").trim();
                connection.roomId = String(authorization.roomId ?? "").trim();
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
                logger?.info?.("VME2_PHASE10_MEDIA_BIND=PASS", { connectionId: connection.controlConnectionId, transportConnectionKey });
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

            const routeResult = await bridgeClient.routeFrame({
                controlConnectionId: connection.controlConnectionId,
                flags: packet.flags,
                mediaSequence: packet.mediaSequence,
                mediaTimestamp100Ns: packet.mediaTimestamp100Ns,
                streamId: packet.streamId,
                payload: packet.payload
            });
            if (routeResult?.success !== true && routeResult?.error === "media_authorization_revoked") {
                await connection.close("media_authorization_revoked");
                mediaRegistry.remove(connection);
            }
        }

        //* این تابع بسته شدن راه انتقال را از رجیستری نود رسانه پاک می کند.
        async function closed(reason = "media_transport_closed") {
            mediaRegistry.remove(connection);
            await connection.close(reason);
        }

        return Object.freeze({ connection, receive, closed });
    }

    //* این تابع یک فریم تایید شده را از بک اند به اتصال رسانه شنونده ارسال می کند.
    async function deliverMedia({ listenerConnectionId, flags = 0, mediaSequence = 0, mediaTimestamp100Ns = "0", sessionId, streamId, senderId, payload } = {}) {
        const mediaConnection = mediaRegistry.getByControlConnectionId(listenerConnectionId);
        if (!mediaConnection || !mediaConnection.active || mediaConnection.closed) throw new Error("Voice media plane is not bound for the listener.");
        await mediaConnection.send({
            kind: VoiceMediaV2PacketKind.MEDIA,
            codec: VoiceMediaV2Codec.OPUS,
            flags: Number(flags) & 0xff,
            mediaSequence: Number(mediaSequence) >>> 0,
            mediaTimestamp100Ns: BigInt(String(mediaTimestamp100Ns)),
            sessionId,
            streamId,
            senderId,
            payload
        });
    }

    //* این تابع فقط اتصال رسانه یک شنونده را بدون دست زدن به کنترل می بندد.
    async function closeMedia(listenerConnectionId, reason = "media_route_failure") {
        const mediaConnection = mediaRegistry.getByControlConnectionId(listenerConnectionId);
        if (!mediaConnection) return false;
        mediaRegistry.remove(mediaConnection);
        await mediaConnection.close(String(reason ?? "media_route_failure"));
        return true;
    }

    //* این تابع همه اتصال های رسانه را برای خاموش شدن امن نود می بندد.
    async function stop() {
        if (stopped) return;
        stopped = true;
        const connections = Array.from(mediaRegistry.byTransportKey.values());
        await Promise.allSettled(connections.map((connection) => connection.close("media_node_stopped")));
        for (const connection of connections) mediaRegistry.remove(connection);
    }

    //* این تابع آمار محدود نود رسانه را برمی گرداند.
    function getStats() {
        return Object.freeze({ ...mediaRegistry.getStats(), stopped });
    }

    return Object.freeze({ mediaRegistry, acceptConnection, deliverMedia, closeMedia, stop, getStats });
}

export {
    createVoiceMediaNodeRuntime
};
