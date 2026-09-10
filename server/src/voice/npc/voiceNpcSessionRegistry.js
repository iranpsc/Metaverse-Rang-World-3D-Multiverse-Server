const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class VoiceNpcSessionRegistry {
    //* این سازنده Sessionهای NPC از پیش مجاز را نگه می‌دارد.
    constructor() {
        this.sessionsById = new Map();
        this.burnedSessionIds = new Set();
    }

    //* این تابع یک Session NPC را با Publisher UUID و شنونده‌های مشخص ثبت می‌کند.
    authorizeSession({
        sessionId,
        npcId,
        npcUserId,
        publisherConnectionId,
        serverId,
        roomId,
        listeners
    } = {}) {
        const id = String(sessionId ?? "").trim().toLowerCase();
        if (!UUID_PATTERN.test(id) || this.burnedSessionIds.has(id)) throw new Error("NPC Voice sessionId is invalid or burned.");
        if (this.sessionsById.has(id)) throw new Error("NPC Voice session already exists.");
        if (!UUID_PATTERN.test(String(npcUserId ?? "")) || !UUID_PATTERN.test(String(publisherConnectionId ?? "")))
            throw new Error("NPC Voice user and publisher identifiers must be UUID values.");
        if (!Array.isArray(listeners) || listeners.length === 0 || listeners.length > 32)
            throw new Error("NPC Voice session requires one to thirty-two listeners.");

        const normalizedListeners = listeners.map((listener) => {
            if (!UUID_PATTERN.test(String(listener.connectionId ?? "")) || !UUID_PATTERN.test(String(listener.userId ?? "")))
                throw new Error("NPC Voice listener identifiers must be UUID values.");
            return Object.freeze({
                connectionId: String(listener.connectionId).toLowerCase(),
                userId: String(listener.userId).toLowerCase()
            });
        });

        const record = Object.freeze({
            sessionId: id,
            npcId: String(npcId ?? "").trim(),
            npcUserId: String(npcUserId).toLowerCase(),
            publisherConnectionId: String(publisherConnectionId).toLowerCase(),
            serverId: String(serverId ?? "").trim(),
            roomId: String(roomId ?? "").trim(),
            listeners: Object.freeze(normalizedListeners),
            createdAtMs: Date.now()
        });

        if (!record.npcId || !record.serverId || !record.roomId) throw new Error("NPC Voice session scope is required.");
        this.sessionsById.set(id, record);
        return record;
    }

    get(sessionId) {
        return this.sessionsById.get(String(sessionId ?? "").trim().toLowerCase()) ?? null;
    }

    //* این تابع Snapshot مشترک Session را فقط برای Publisher یا Listener عضو همان Session می‌سازد.
    findVoiceSession({ sessionId = "", connectionId, targetConnectionId = "" } = {}) {
        const normalizedConnectionId = String(connectionId ?? "").trim().toLowerCase();
        const normalizedTargetConnectionId = String(targetConnectionId ?? "").trim().toLowerCase();
        if (!normalizedConnectionId) return null;

        const requestedId = String(sessionId ?? "").trim().toLowerCase();
        const candidates = requestedId
            ? [this.sessionsById.get(requestedId)].filter(Boolean)
            : Array.from(this.sessionsById.values());

        for (const session of candidates) {
            const participants = [
                Object.freeze({
                    userId: session.npcUserId,
                    connectionId: session.publisherConnectionId
                }),
                ...session.listeners
            ];
            const isMember = participants.some(
                (participant) => participant.connectionId === normalizedConnectionId
            );
            const hasTarget = !normalizedTargetConnectionId || participants.some(
                (participant) => participant.connectionId === normalizedTargetConnectionId
            );
            if (!isMember || !hasTarget) continue;

            return Object.freeze({
                sessionId: session.sessionId,
                roomId: session.roomId,
                serverId: session.serverId,
                participants: Object.freeze(participants)
            });
        }

        return null;
    }

    close(sessionId) {
        const id = String(sessionId ?? "").trim().toLowerCase();
        const record = this.sessionsById.get(id);
        if (!record) return null;
        this.sessionsById.delete(id);
        this.burnedSessionIds.add(id);
        return record;
    }

    getStats() {
        return Object.freeze({ activeSessions: this.sessionsById.size, burnedSessions: this.burnedSessionIds.size });
    }
}

export { VoiceNpcSessionRegistry };

/*
توضیح فایل:
این فایل Sessionهای انتشار NPC را جدا از Session کاربر نگه می‌دارد، شناسه بسته‌شده را می‌سوزاند و Listenerهای مجاز هر Session را صریح ثبت می‌کند.
*/
