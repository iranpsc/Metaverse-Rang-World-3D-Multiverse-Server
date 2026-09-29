import {
    VoiceMediaV2PacketKind,
    decodeVoiceMediaV2BindRequest,
    decodeVoiceMediaV2BindResult,
    decodeVoiceMediaV2Packet,
    encodeVoiceMediaV2BindResult,
    encodeVoiceMediaV2Packet
} from "../mediaV2/voiceMediaV2Protocol.js";
import { createVoiceMediaPacketIntegrityPolicy } from "./voiceMediaPacketIntegrityPolicy.js";
import { createVoiceMediaPayloadCipher } from "./voiceMediaPayloadCipher.js";
import { createVoiceMediaKeyRotationPolicy } from "./voiceMediaKeyRotationPolicy.js";
import { createVoiceMediaSecurityHandshake } from "./voiceMediaSecurityHandshake.js";

const MEDIA_PACKET_SECURITY_CAPABILITY = "vme2s1";
const MAX_RECENT_SECURITY_CONTEXTS = 65536;

function requestsPacketSecurity(clientBuild) {
    return String(clientBuild ?? "").split(";").map((value) => value.trim().toLowerCase()).includes(MEDIA_PACKET_SECURITY_CAPABILITY);
}

function encodeLegacyPacket(packet, payload = packet.payload) {
    return encodeVoiceMediaV2Packet({
        kind: packet.kind,
        codec: packet.codec,
        flags: packet.flags,
        transportSequence: packet.transportSequence,
        mediaSequence: packet.mediaSequence,
        mediaTimestamp100Ns: packet.mediaTimestamp100Ns,
        ackTransportSequence: packet.ackTransportSequence,
        ackMask: packet.ackMask,
        sessionId: packet.sessionId,
        streamId: packet.streamId,
        senderId: packet.senderId,
        securityContextId: 0,
        payload
    });
}

function isProtectedKind(kind) {
    return kind === VoiceMediaV2PacketKind.MEDIA || kind === VoiceMediaV2PacketKind.PING || kind === VoiceMediaV2PacketKind.PONG;
}

function createVoiceMediaPacketSecurityRuntimeAdapter({ runtime, logger = null, createHandshake = createVoiceMediaSecurityHandshake, createKeyRotationPolicy = createVoiceMediaKeyRotationPolicy } = {}) {
    if (!runtime || typeof runtime.acceptConnection !== "function" || typeof runtime.deliverMedia !== "function" || typeof runtime.closeMedia !== "function" || typeof runtime.stop !== "function" || typeof runtime.getStats !== "function") throw new TypeError("Media node runtime is invalid.");
    if (typeof createHandshake !== "function") throw new TypeError("createHandshake is invalid.");
    if (typeof createKeyRotationPolicy !== "function") throw new TypeError("createKeyRotationPolicy is invalid.");
    const states = new Map();
    const recentSecurityContexts = new Set();
    const recentSecurityContextQueue = [];
    let acceptedProtectedPackets = 0;
    let rejectedProtectedPackets = 0;
    let negotiatedContexts = 0;
    let encryptedPackets = 0;
    let decryptedPackets = 0;
    let rotationRequiredConnections = 0;
    let rotationsByAge = 0;
    let rotationsByPacketCount = 0;

    function disposeState(state) {
        if (!state || state.disposed) return;
        state.disposed = true;
        state.inboundPolicy?.dispose();
        state.outboundPolicy?.dispose();
        state.inboundCipher?.dispose();
        state.outboundCipher?.dispose();
        state.keyRotationPolicy?.reset();
        state.inboundPolicy = null;
        state.outboundPolicy = null;
        state.inboundCipher = null;
        state.outboundCipher = null;
        state.keyRotationPolicy = null;
        state.pendingBind = null;
        states.delete(state.transportConnectionKey);
    }

    async function requireKeyRotation(state, decision) {
        if (!state || state.disposed) return false;
        rotationRequiredConnections += 1;
        if (decision?.reason === "max_key_age") rotationsByAge += 1;
        if (decision?.reason === "max_packet_count") rotationsByPacketCount += 1;
        logger?.warn?.("VME2_MEDIA_KEY_ROTATION_REQUIRED", { transportConnectionKey: state.transportConnectionKey, reason: decision?.reason ?? "policy" });
        const closeTransport = state.originalCloseTransport;
        disposeState(state);
        await Promise.resolve(closeTransport("media_security_key_rotation_required"));
        return false;
    }

    function createUniqueHandshake(input) {
        for (let attempt = 0; attempt < 32; attempt += 1) {
            const handshake = createHandshake(input);
            if (!recentSecurityContexts.has(handshake.securityContextId)) {
                recentSecurityContexts.add(handshake.securityContextId);
                recentSecurityContextQueue.push(handshake.securityContextId);
                if (recentSecurityContextQueue.length > MAX_RECENT_SECURITY_CONTEXTS) recentSecurityContexts.delete(recentSecurityContextQueue.shift());
                return handshake;
            }
            handshake.clientToServerKey?.fill(0);
            handshake.serverToClientKey?.fill(0);
            handshake.clientToServerEncryptionKey?.fill(0);
            handshake.serverToClientEncryptionKey?.fill(0);
        }
        throw new Error("A unique media security context could not be created.");
    }

    function acceptConnection(input = {}) {
        if (typeof input.sendPacket !== "function" || typeof input.closeTransport !== "function") throw new TypeError("Media transport callbacks are invalid.");
        const transportConnectionKey = String(input.transportConnectionKey ?? "").trim();
        if (!transportConnectionKey) throw new TypeError("transportConnectionKey is invalid.");
        const originalSendPacket = input.sendPacket;
        const originalCloseTransport = input.closeTransport;
        const state = { transportConnectionKey, pendingBind: null, controlConnectionId: "", inboundPolicy: null, outboundPolicy: null, inboundCipher: null, outboundCipher: null, keyRotationPolicy: null, originalCloseTransport, disposed: false };
        states.set(transportConnectionKey, state);

        const accepted = runtime.acceptConnection({
            ...input,
            async sendPacket(inputPacket) {
                if (state.disposed) return false;
                const packet = decodeVoiceMediaV2Packet(inputPacket);
                if (packet.kind === VoiceMediaV2PacketKind.BIND_RESULT) {
                    const result = decodeVoiceMediaV2BindResult(packet.payload);
                    if (!result.success) {
                        state.pendingBind = null;
                        return await Promise.resolve(originalSendPacket(inputPacket));
                    }
                    if (!state.pendingBind) throw new Error("Media security bind context is missing.");
                    if (!state.pendingBind.securityRequested) {
                        state.controlConnectionId = result.controlConnectionId;
                        state.pendingBind = null;
                        return await Promise.resolve(originalSendPacket(inputPacket));
                    }
                    const handshake = createUniqueHandshake({
                        accessToken: state.pendingBind.accessToken,
                        roomId: state.pendingBind.roomId,
                        controlConnectionId: result.controlConnectionId,
                        streamId: state.pendingBind.streamId
                    });
                    state.inboundPolicy = createVoiceMediaPacketIntegrityPolicy({ securityContextId: handshake.securityContextId, key: handshake.clientToServerKey });
                    state.outboundPolicy = createVoiceMediaPacketIntegrityPolicy({ securityContextId: handshake.securityContextId, key: handshake.serverToClientKey });
                    state.inboundCipher = createVoiceMediaPayloadCipher({ securityContextId: handshake.securityContextId, key: handshake.clientToServerEncryptionKey });
                    state.outboundCipher = createVoiceMediaPayloadCipher({ securityContextId: handshake.securityContextId, key: handshake.serverToClientEncryptionKey });
                    state.keyRotationPolicy = createKeyRotationPolicy();
                    state.keyRotationPolicy.begin(handshake.securityContextId);
                    state.controlConnectionId = result.controlConnectionId;
                    state.pendingBind = null;
                    handshake.clientToServerKey.fill(0);
                    handshake.serverToClientKey.fill(0);
                    handshake.clientToServerEncryptionKey.fill(0);
                    handshake.serverToClientEncryptionKey.fill(0);
                    negotiatedContexts += 1;
                    const securedPayload = encodeVoiceMediaV2BindResult({ ...result, message: handshake.message });
                    return await Promise.resolve(originalSendPacket(encodeLegacyPacket(packet, securedPayload)));
                }
                if (state.outboundPolicy && state.outboundCipher && isProtectedKind(packet.kind)) {
                    const rotation = state.keyRotationPolicy?.evaluate();
                    if (rotation?.required) return await requireKeyRotation(state, rotation);
                    encryptedPackets += 1;
                    const result = await Promise.resolve(originalSendPacket(state.outboundPolicy.protect(state.outboundCipher.encrypt(packet))));
                    state.keyRotationPolicy?.recordOutbound();
                    return result;
                }
                return await Promise.resolve(originalSendPacket(inputPacket));
            },
            async closeTransport(reason) {
                disposeState(state);
                return await Promise.resolve(originalCloseTransport(reason));
            }
        });

        async function receive(inputPacket) {
            if (state.disposed) return;
            const packet = decodeVoiceMediaV2Packet(inputPacket);
            if (!state.inboundPolicy) {
                if (packet.kind === VoiceMediaV2PacketKind.BIND_REQUEST) {
                    const request = decodeVoiceMediaV2BindRequest(packet.payload);
                    state.pendingBind = Object.freeze({ accessToken: request.accessToken, roomId: request.roomId, controlConnectionId: request.controlConnectionId, streamId: packet.streamId, securityRequested: requestsPacketSecurity(request.clientBuild) });
                }
                return await accepted.receive(inputPacket);
            }
            if (packet.kind === VoiceMediaV2PacketKind.BIND_REQUEST) return await accepted.receive(inputPacket);
            const rotation = state.keyRotationPolicy?.evaluate();
            if (rotation?.required) return await requireKeyRotation(state, rotation);
            const verified = state.inboundPolicy.verifyAndUnwrap(inputPacket);
            if (!verified.accepted) {
                rejectedProtectedPackets += 1;
                logger?.warn?.("VME2_MEDIA_PACKET_SECURITY_REJECTED", { transportConnectionKey, reason: verified.reason, replayReason: verified.replayReason ?? "" });
                return;
            }
            acceptedProtectedPackets += 1;
            if (!state.inboundCipher) throw new Error("Media payload cipher is missing.");
            decryptedPackets += 1;
            const decrypted = state.inboundCipher.decrypt(verified.packet);
            state.keyRotationPolicy?.recordInbound();
            return await accepted.receive(encodeLegacyPacket(decrypted));
        }

        async function closed(reason) {
            disposeState(state);
            return await accepted.closed(reason);
        }

        return Object.freeze({ connection: accepted.connection, receive, closed });
    }

    async function closeMedia(listenerConnectionId, reason) {
        const normalized = String(listenerConnectionId ?? "").trim().toLowerCase();
        for (const state of states.values()) if (String(state.controlConnectionId).trim().toLowerCase() === normalized) disposeState(state);
        return await runtime.closeMedia(listenerConnectionId, reason);
    }

    async function stop() {
        for (const state of Array.from(states.values())) disposeState(state);
        return await runtime.stop();
    }

    function getStats() {
        let activeContexts = 0;
        for (const state of states.values()) if (state.inboundPolicy && state.outboundPolicy && state.inboundCipher && state.outboundCipher) activeContexts += 1;
        return Object.freeze({ ...runtime.getStats(), packetSecurity: Object.freeze({ enabled: true, encryption: "aes-256-ctr+hmac-sha256-128", activeContexts, negotiatedContexts, recentSecurityContexts: recentSecurityContexts.size, acceptedProtectedPackets, rejectedProtectedPackets, encryptedPackets, decryptedPackets, rotationRequiredConnections, rotationsByAge, rotationsByPacketCount }) });
    }

    return Object.freeze({
        mediaRegistry: runtime.mediaRegistry,
        acceptConnection,
        deliverMedia: runtime.deliverMedia,
        closeMedia,
        stop,
        getStats,
        sampleTelemetry: typeof runtime.sampleTelemetry === "function" ? runtime.sampleTelemetry : undefined
    });
}

export {
    MEDIA_PACKET_SECURITY_CAPABILITY,
    createVoiceMediaPacketSecurityRuntimeAdapter,
    encodeLegacyPacket,
    requestsPacketSecurity
};
