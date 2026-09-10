import { VoiceMessageType } from "../protocol/voiceMessageTypes.js";
import { VoiceConnectionState } from "../core/voiceConnectionConstants.js";
import { encodeVoiceSessionDescriptor } from "../session/voiceSessionPayload.js";
import { VoiceSessionReason, VoiceSessionState } from "../session/voiceSessionConstants.js";

class VoiceNpcPublisherService {
    //* این سازنده Authorizer، Session Registry و Gateway مشترک را دریافت می‌کند.
    constructor({ authorizationService, sessionRegistry, gateway, recordingService = null, muteRegistry = null } = {}) {
        if (!authorizationService || typeof authorizationService.authorize !== "function") throw new TypeError("authorizationService is required.");
        if (!sessionRegistry || typeof sessionRegistry.get !== "function") throw new TypeError("sessionRegistry is required.");
        if (!gateway || typeof gateway.getConnectionByConnectionId !== "function") throw new TypeError("gateway is required.");
        this.authorizationService = authorizationService;
        this.sessionRegistry = sessionRegistry;
        this.gateway = gateway;
        this.recordingService = recordingService;
        this.muteRegistry = muteRegistry;
        this.lastSequenceBySessionId = new Map();
        this.acceptedFrames = 0;
        this.acceptedBytes = 0;
        this.rejectedFrames = 0;
    }

    //* این تابع Session NPC را فقط پس از Service Token و عضویت زنده Listenerها ایجاد و به Clientها اعلام می‌کند.
    async authorizeSession({ token, ...input } = {}) {
        const auth = await this.authorizationService.authorize({
            token,
            npcId: input.npcId,
            serverId: input.serverId
        });
        if (!auth.authorized) return Object.freeze({ authorized: false, reason: auth.reason, session: null });

        for (const listener of input.listeners ?? []) {
            const record = this.gateway.voiceConnectionRegistry?.getByConnectionId?.(listener.connectionId);
            if (!record || record.state !== VoiceConnectionState.ACTIVE ||
                record.userId !== String(listener.userId ?? "").trim() ||
                record.roomId !== String(input.roomId ?? "").trim()) {
                return Object.freeze({ authorized: false, reason: "npc_listener_not_active_in_room", session: null });
            }
        }

        const session = this.sessionRegistry.authorizeSession(input);

        if (this.recordingService && session.listeners.length === 1) {
            this.recordingService.registerSession(this.toRecordingSession(session));
        }

        await Promise.allSettled(session.listeners.map((listener) => {
            const transport = this.gateway.getConnectionByConnectionId(listener.connectionId);
            if (!transport) return Promise.resolve(false);
            return transport.sendEnvelope({
                messageType: VoiceMessageType.SESSION_JOINED,
                sessionId: session.sessionId,
                payload: encodeVoiceSessionDescriptor({
                    sessionId: session.sessionId,
                    state: VoiceSessionState.ACTIVE,
                    reason: VoiceSessionReason.NONE,
                    distanceMeters: null,
                    effectiveAtMs: session.createdAtMs,
                    peerUserId: session.npcUserId,
                    peerAvatarId: session.npcUserId
                })
            });
        }));

        return Object.freeze({ authorized: true, reason: "npc_session_authorized", session });
    }

    //* این تابع رضایت ضبط سمت Publisher NPC را روی همان Session دوعضوی اعمال می‌کند.
    async setRecordingConsent({ token, sessionId, npcId, serverId, consented } = {}) {
        if (!this.recordingService) return Object.freeze({ accepted: false, reason: "npc_recording_disabled" });
        const session = this.sessionRegistry.get(sessionId);
        if (!session || session.npcId !== String(npcId ?? "").trim() || session.serverId !== String(serverId ?? "").trim())
            return Object.freeze({ accepted: false, reason: "npc_session_not_authorized" });

        const auth = await this.authorizationService.authorize({ token, npcId, serverId });
        if (!auth.authorized) return Object.freeze({ accepted: false, reason: auth.reason });
        if (session.listeners.length !== 1) return Object.freeze({ accepted: false, reason: "npc_recording_requires_one_listener" });

        const snapshot = await this.recordingService.updateConsent({
            session: this.toRecordingSession(session),
            connectionId: session.publisherConnectionId,
            consented: consented === true
        });
        return Object.freeze({ accepted: true, reason: "npc_recording_consent_updated", snapshot });
    }

    //* این تابع Session NPC را با مجوز همان Token می‌بندد، Clientها را آگاه و ضبط را نهایی می‌کند.
    async closeSession({ token, sessionId, npcId, serverId } = {}) {
        const existing = this.sessionRegistry.get(sessionId);
        if (!existing || existing.npcId !== String(npcId ?? "").trim() || existing.serverId !== String(serverId ?? "").trim())
            return Object.freeze({ closed: false, reason: "npc_session_not_authorized" });
        const auth = await this.authorizationService.authorize({ token, npcId, serverId });
        if (!auth.authorized) return Object.freeze({ closed: false, reason: auth.reason });

        const session = this.sessionRegistry.close(sessionId);
        await Promise.allSettled(session.listeners.map((listener) => {
            const transport = this.gateway.getConnectionByConnectionId(listener.connectionId);
            if (!transport) return Promise.resolve(false);
            return transport.sendEnvelope({
                messageType: VoiceMessageType.SESSION_CLOSED,
                sessionId: session.sessionId,
                senderId: session.publisherConnectionId,
                payload: encodeVoiceSessionDescriptor({
                    sessionId: session.sessionId,
                    state: VoiceSessionState.CLOSED,
                    reason: VoiceSessionReason.SESSION_CLOSED,
                    distanceMeters: null,
                    effectiveAtMs: Date.now(),
                    peerUserId: session.npcUserId,
                    peerAvatarId: session.npcUserId
                })
            });
        }));
        if (this.recordingService) await this.recordingService.finalizeSession(session.sessionId);
        this.lastSequenceBySessionId.delete(session.sessionId);
        return Object.freeze({ closed: true, reason: "npc_session_closed" });
    }

    //* این تابع یک فریم Opus داخلی را پس از Auth و تطبیق Session فقط به Listenerهای مجاز می‌فرستد.
    async publishFrame({ token, sessionId, npcId, serverId, sequence, timestampMs, opusFrame } = {}) {
        const session = this.sessionRegistry.get(sessionId);
        if (!session || session.npcId !== String(npcId ?? "").trim() || session.serverId !== String(serverId ?? "").trim()) {
            this.rejectedFrames += 1;
            return Object.freeze({ accepted: false, reason: "npc_session_not_authorized", delivered: 0 });
        }

        const auth = await this.authorizationService.authorize({ token, npcId, serverId });
        if (!auth.authorized) {
            this.rejectedFrames += 1;
            return Object.freeze({ accepted: false, reason: auth.reason, delivered: 0 });
        }

        if (!Number.isSafeInteger(sequence) || sequence <= 0 || sequence > 0xffffffff)
            throw new RangeError("NPC Voice sequence is invalid.");
        const previous = this.lastSequenceBySessionId.get(session.sessionId) ?? 0;
        if (sequence !== previous + 1) {
            this.rejectedFrames += 1;
            return Object.freeze({ accepted: false, reason: "npc_sequence_invalid", delivered: 0 });
        }
        if (!Buffer.isBuffer(opusFrame) || opusFrame.length === 0 || opusFrame.length > 4096)
            throw new RangeError("NPC Voice Opus frame is invalid.");
        if (!Number.isSafeInteger(timestampMs) || Math.abs(Date.now() - timestampMs) > 1000)
            return Object.freeze({ accepted: false, reason: "npc_timestamp_invalid", delivered: 0 });

        this.lastSequenceBySessionId.set(session.sessionId, sequence);

        if (this.recordingService) {
            try {
                this.recordingService.captureFrame({
                    session,
                    publisherConnectionId: session.publisherConnectionId,
                    payload: opusFrame
                });
            } catch {
                // شکست ضبط نباید انتشار زنده NPC را متوقف کند.
            }
        }

        const deliveries = [];

        for (const listener of session.listeners) {
            if (this.muteRegistry && !this.muteRegistry.isRouteAllowed(
                listener.connectionId,
                session.publisherConnectionId
            )) continue;
            const transport = this.gateway.getConnectionByConnectionId(listener.connectionId);
            if (!transport) continue;
            deliveries.push(transport.sendEnvelope({
                messageType: VoiceMessageType.VOICE_FRAME,
                timestampMs,
                sessionId: session.sessionId,
                senderId: session.publisherConnectionId,
                payload: opusFrame
            }));
        }

        const results = await Promise.allSettled(deliveries);
        const delivered = results.filter((result) => result.status === "fulfilled").length;
        this.acceptedFrames += 1;
        this.acceptedBytes += opusFrame.length;
        return Object.freeze({ accepted: true, reason: "npc_frame_routed", delivered });
    }

    toRecordingSession(session) {
        return Object.freeze({
            sessionId: session.sessionId,
            roomId: session.roomId,
            serverId: session.serverId,
            participants: Object.freeze([
                Object.freeze({ userId: session.npcUserId, connectionId: session.publisherConnectionId }),
                session.listeners[0]
            ])
        });
    }

    getStats() {
        return Object.freeze({
            acceptedFrames: this.acceptedFrames,
            acceptedBytes: this.acceptedBytes,
            rejectedFrames: this.rejectedFrames,
            sessions: this.sessionRegistry.getStats()
        });
    }
}

export { VoiceNpcPublisherService };

/*
توضیح فایل:
این فایل فریم Opus NPC را فقط پس از Service Token معتبر، Session مجاز، ترتیب پیوسته و Timestamp تازه روی Gateway مشترک توزیع می‌کند.
*/
