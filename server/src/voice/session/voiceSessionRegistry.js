// مسیر فایل: src/voice/session/voiceSessionRegistry.js

import {
    VoiceSessionReason,
    VoiceSessionState
} from "./voiceSessionConstants.js";

import {
    createCanonicalVoiceParticipantPairKey
} from "./voiceSessionPolicy.js";

import {
    VoiceSessionRecord,
    normalizeVoiceSessionId,
    normalizeVoiceSessionParticipant
} from "./voiceSessionRecord.js";

class VoiceSessionRegistry {
    //* این سازنده محل‌های نگهداری سشن‌های فعال، اعضا و شناسه‌های سوخته را آماده می‌کند.
    constructor() {
        this.sessionsById =
            new Map();

        this.activeSessionIdByPairKey =
            new Map();

        this.sessionIdsByConnectionId =
            new Map();

        this.burnedSessionIds =
            new Set();
    }

    //* این تابع شناسه سشن را به فهرست سشن‌های یک اتصال اضافه می‌کند.
    addConnectionSessionIndex(
        connectionId,
        sessionId
    ) {
        let sessionIds =
            this.sessionIdsByConnectionId
                .get(connectionId);

        if (!sessionIds) {
            sessionIds =
                new Set();

            this.sessionIdsByConnectionId
                .set(
                    connectionId,
                    sessionIds
                );
        }

        sessionIds.add(
            sessionId
        );
    }

    //* این تابع شناسه سشن را از فهرست یک اتصال حذف و فهرست خالی را پاک می‌کند.
    removeConnectionSessionIndex(
        connectionId,
        sessionId
    ) {
        const sessionIds =
            this.sessionIdsByConnectionId
                .get(connectionId);

        if (!sessionIds) {
            return;
        }

        sessionIds.delete(
            sessionId
        );

        if (
            sessionIds.size === 0
        ) {
            this.sessionIdsByConnectionId
                .delete(
                    connectionId
                );
        }
    }

    //* این تابع سشن زوجی قطعی را ثبت می‌کند و جلوی هم‌پوشانی همان زوج یا استفاده دوباره از شناسه سوخته را می‌گیرد.
    createPairSession({
        sessionId,
        roomId,
        serverId,
        firstParticipant,
        secondParticipant,
        distanceMeters,
        reason =
            VoiceSessionReason
                .PROXIMITY_ENTER,
        effectiveAtMs = Date.now()
    } = {}) {
        const normalizedSessionId =
            normalizeVoiceSessionId(
                sessionId
            );

        const first =
            normalizeVoiceSessionParticipant(
                firstParticipant,
                "firstParticipant"
            );

        const second =
            normalizeVoiceSessionParticipant(
                secondParticipant,
                "secondParticipant"
            );

        const pairKey =
            createCanonicalVoiceParticipantPairKey(
                serverId,
                roomId,
                first.userId,
                first.connectionId,
                second.userId,
                second.connectionId
            );

        const existingById =
            this.sessionsById.get(
                normalizedSessionId
            );

        if (existingById) {
            if (
                existingById.state ===
                    VoiceSessionState.ACTIVE &&
                existingById.pairKey ===
                    pairKey &&
                existingById.roomId ===
                    String(roomId ?? "").trim() &&
                existingById.serverId ===
                    String(serverId ?? "").trim()
            ) {
                return Object.freeze({
                    created: false,
                    idempotent: true,
                    session:
                        existingById.snapshot()
                });
            }

            throw new Error(
                "The Voice session id is already registered with different data."
            );
        }

        if (
            this.burnedSessionIds.has(
                normalizedSessionId
            )
        ) {
            throw new Error(
                "The Voice session id is burned and cannot be reused."
            );
        }

        const activePairSessionId =
            this.activeSessionIdByPairKey
                .get(pairKey);

        if (activePairSessionId) {
            throw new Error(
                "An active Voice session already exists for this userId and connectionId pair."
            );
        }

        const session =
            new VoiceSessionRecord({
                sessionId:
                    normalizedSessionId,
                roomId,
                serverId,
                firstParticipant:
                    first,
                secondParticipant:
                    second,
                distanceMeters,
                reason,
                effectiveAtMs
            });

        this.sessionsById.set(
            session.sessionId,
            session
        );

        this.activeSessionIdByPairKey
            .set(
                session.pairKey,
                session.sessionId
            );

        for (
            const participant
            of session.participants
        ) {
            this.addConnectionSessionIndex(
                participant.connectionId,
                session.sessionId
            );
        }

        return Object.freeze({
            created: true,
            idempotent: false,
            session:
                session.snapshot()
        });
    }

    //* این تابع عضو تازه را به همان سشن فعال اضافه می‌کند و تمام Pairهای تازه را به SessionId پایدار نمایه می‌کند.
    addParticipant(
        sessionId,
        {
            participant,
            effectiveAtMs = Date.now()
        } = {}
    ) {
        const session =
            this.getBySessionId(
                sessionId
            );

        if (!session) {
            throw new Error(
                "Voice session was not found for member join."
            );
        }

        if (
            session.state !==
            VoiceSessionState.ACTIVE
        ) {
            throw new Error(
                "Only an active Voice session can add a participant."
            );
        }

        const normalizedParticipant =
            normalizeVoiceSessionParticipant(
                participant,
                "participant"
            );

        if (
            session.hasParticipant(
                normalizedParticipant
            )
        ) {
            return Object.freeze({
                joined: false,
                idempotent: true,
                session:
                    session.snapshot()
            });
        }

        const newPairKeys = [];

        for (
            const existingParticipant
            of session.participants
        ) {
            const pairKey =
                createCanonicalVoiceParticipantPairKey(
                    session.serverId,
                    session.roomId,
                    existingParticipant.userId,
                    existingParticipant.connectionId,
                    normalizedParticipant.userId,
                    normalizedParticipant.connectionId
                );

            const activeSessionId =
                this.activeSessionIdByPairKey
                    .get(pairKey);

            if (
                activeSessionId &&
                activeSessionId !==
                    session.sessionId
            ) {
                throw new Error(
                    "A Voice pair must leave its secondary session before joining the stable group session."
                );
            }

            newPairKeys.push(
                pairKey
            );
        }

        const snapshot =
            session.addParticipant({
                participant:
                    normalizedParticipant,
                effectiveAtMs
            });

        for (
            const pairKey
            of newPairKeys
        ) {
            this.activeSessionIdByPairKey
                .set(
                    pairKey,
                    session.sessionId
                );
        }

        this.addConnectionSessionIndex(
            normalizedParticipant.connectionId,
            session.sessionId
        );

        return Object.freeze({
            joined: true,
            idempotent: false,
            session:
                snapshot
        });
    }

    //* این تابع عضو تعیین‌شده را از Group حذف می‌کند و در حالت Pair رفتار قدیمی Close و Burn را حفظ می‌کند.
    removeParticipant(
        sessionId,
        {
            participant,
            reason,
            effectiveAtMs = Date.now()
        } = {}
    ) {
        const session =
            this.getBySessionId(
                sessionId
            );

        if (!session) {
            return null;
        }

        if (
            session.state ===
            VoiceSessionState.CLOSED
        ) {
            return Object.freeze({
                left: false,
                closed: false,
                idempotent: true,
                session:
                    session.snapshot()
            });
        }

        const normalizedParticipant =
            normalizeVoiceSessionParticipant(
                participant,
                "participant"
            );

        const storedParticipant =
            session.participants.find(
                (currentParticipant) =>
                    currentParticipant.userId ===
                        normalizedParticipant.userId &&
                    currentParticipant.connectionId ===
                        normalizedParticipant.connectionId
            ) ?? null;

        if (!storedParticipant) {
            return Object.freeze({
                left: false,
                closed: false,
                idempotent: true,
                session:
                    session.snapshot()
            });
        }

        if (
            session.participants.length === 2
        ) {
            const closeResult =
                this.closeSession(
                    session.sessionId,
                    {
                        reason,
                        effectiveAtMs
                    }
                );

            return Object.freeze({
                left:
                    closeResult?.closed === true,
                closed:
                    closeResult?.closed === true,
                idempotent:
                    closeResult?.idempotent === true,
                session:
                    closeResult?.session ??
                    session.snapshot()
            });
        }

        const removedPairKeys = [];

        for (
            const remainingParticipant
            of session.participants
        ) {
            if (
                remainingParticipant.userId ===
                    storedParticipant.userId &&
                remainingParticipant.connectionId ===
                    storedParticipant.connectionId
            ) {
                continue;
            }

            removedPairKeys.push(
                createCanonicalVoiceParticipantPairKey(
                    session.serverId,
                    session.roomId,
                    storedParticipant.userId,
                    storedParticipant.connectionId,
                    remainingParticipant.userId,
                    remainingParticipant.connectionId
                )
            );
        }

        const snapshot =
            session.removeParticipant({
                participant:
                    storedParticipant,
                reason,
                effectiveAtMs
            });

        for (
            const pairKey
            of removedPairKeys
        ) {
            if (
                this.activeSessionIdByPairKey
                    .get(pairKey) ===
                session.sessionId
            ) {
                this.activeSessionIdByPairKey
                    .delete(pairKey);
            }
        }

        this.removeConnectionSessionIndex(
            storedParticipant.connectionId,
            session.sessionId
        );

        return Object.freeze({
            left: true,
            closed: false,
            idempotent: false,
            session:
                snapshot
        });
    }

    //* این تابع سشن را با شناسه یکتای آن پیدا می‌کند.
    getBySessionId(
        sessionId
    ) {
        try {
            return this.sessionsById.get(
                normalizeVoiceSessionId(
                    sessionId
                )
            ) ?? null;
        } catch {
            return null;
        }
    }

    //* این تابع با حفظ نام قدیمی، سشن فعال دو اتصال کاربر را در همان سرور و روم پیدا می‌کند.
    getActiveByAvatarPair(
        serverId,
        roomId,
        firstUserId,
        firstConnectionId,
        secondUserId,
        secondConnectionId
    ) {
        const pairKey =
            createCanonicalVoiceParticipantPairKey(
                serverId,
                roomId,
                firstUserId,
                firstConnectionId,
                secondUserId,
                secondConnectionId
            );

        const sessionId =
            this.activeSessionIdByPairKey
                .get(pairKey);

        if (!sessionId) {
            return null;
        }

        const session =
            this.sessionsById.get(
                sessionId
            ) ?? null;

        if (
            !session ||
            session.state !==
                VoiceSessionState.ACTIVE
        ) {
            return null;
        }

        return session;
    }

    //* این تابع تمام سشن‌های فعال یک اتصال را به‌صورت نسخه‌های خواندنی برمی‌گرداند.
    listActiveByConnectionId(
        connectionId
    ) {
        const normalizedConnectionId =
            String(
                connectionId ?? ""
            ).trim();

        const sessionIds =
            this.sessionIdsByConnectionId
                .get(
                    normalizedConnectionId
                );

        if (!sessionIds) {
            return Object.freeze([]);
        }

        const sessions = [];

        for (
            const sessionId
            of sessionIds
        ) {
            const session =
                this.sessionsById.get(
                    sessionId
                );

            if (
                session?.state ===
                VoiceSessionState.ACTIVE
            ) {
                sessions.push(
                    session.snapshot()
                );
            }
        }

        return Object.freeze(
            sessions
        );
    }

    //* این تابع یک سشن را می‌بندد، از نمایه‌های فعال حذف می‌کند و شناسه آن را می‌سوزاند.
    closeSession(
        sessionId,
        {
            reason,
            effectiveAtMs = Date.now()
        } = {}
    ) {
        const session =
            this.getBySessionId(
                sessionId
            );

        if (!session) {
            return null;
        }

        if (
            session.state ===
            VoiceSessionState.CLOSED
        ) {
            return Object.freeze({
                closed: false,
                idempotent: true,
                session:
                    session.snapshot()
            });
        }

        const snapshot =
            session.close({
                reason,
                effectiveAtMs
            });

        for (
            let firstIndex = 0;
            firstIndex < session.participants.length;
            firstIndex += 1
        ) {
            const firstParticipant =
                session.participants[firstIndex];

            for (
                let secondIndex = firstIndex + 1;
                secondIndex < session.participants.length;
                secondIndex += 1
            ) {
                const secondParticipant =
                    session.participants[secondIndex];

                const pairKey =
                    createCanonicalVoiceParticipantPairKey(
                        session.serverId,
                        session.roomId,
                        firstParticipant.userId,
                        firstParticipant.connectionId,
                        secondParticipant.userId,
                        secondParticipant.connectionId
                    );

                if (
                    this.activeSessionIdByPairKey
                        .get(pairKey) ===
                    session.sessionId
                ) {
                    this.activeSessionIdByPairKey
                        .delete(pairKey);
                }
            }
        }

        for (
            const participant
            of session.participants
        ) {
            this.removeConnectionSessionIndex(
                participant.connectionId,
                session.sessionId
            );
        }

        this.burnedSessionIds.add(
            session.sessionId
        );

        return Object.freeze({
            closed: true,
            idempotent: false,
            session:
                snapshot
        });
    }

    //* این تابع اتصال را از Groupهای فعال حذف و Sessionهای Pair همان اتصال را با علت تعیین‌شده می‌بندد.
    closeByConnectionId(
        connectionId,
        {
            reason =
                VoiceSessionReason
                    .VOICE_DISCONNECTED,
            effectiveAtMs = Date.now()
        } = {}
    ) {
        const activeSessions =
            this.listActiveByConnectionId(
                connectionId
            );

        const affectedSessions = [];

        for (
            const sessionSnapshot
            of activeSessions
        ) {
            const participant =
                sessionSnapshot.participants.find(
                    (currentParticipant) =>
                        currentParticipant.connectionId ===
                        String(connectionId ?? "").trim()
                ) ?? null;

            if (!participant) {
                continue;
            }

            const result =
                this.removeParticipant(
                    sessionSnapshot.sessionId,
                    {
                        participant,
                        reason,
                        effectiveAtMs
                    }
                );

            if (result?.left) {
                affectedSessions.push(
                    result.session
                );
            }
        }

        return Object.freeze(
            affectedSessions
        );
    }

    //* این تابع تمام سشن‌های فعال یک روم را با علت خروج از روم می‌بندد.
    closeByRoomId(
        roomId,
        {
            reason =
                VoiceSessionReason
                    .ROOM_LEFT,
            effectiveAtMs = Date.now()
        } = {}
    ) {
        const normalizedRoomId =
            String(
                roomId ?? ""
            ).trim();

        const closedSessions = [];

        for (
            const session
            of this.sessionsById
                .values()
        ) {
            if (
                session.state ===
                    VoiceSessionState.ACTIVE &&
                session.roomId ===
                    normalizedRoomId
            ) {
                const result =
                    this.closeSession(
                        session.sessionId,
                        {
                            reason,
                            effectiveAtMs
                        }
                    );

                if (result?.closed) {
                    closedSessions.push(
                        result.session
                    );
                }
            }
        }

        return Object.freeze(
            closedSessions
        );
    }

    //* این تابع تمام سشن‌های فعال یک سرور اختصاصی را هنگام قطع آن می‌بندد.
    closeByServerId(
        serverId,
        {
            reason =
                VoiceSessionReason
                    .DEDICATED_DISCONNECTED,
            effectiveAtMs = Date.now()
        } = {}
    ) {
        const normalizedServerId =
            String(
                serverId ?? ""
            ).trim();

        const closedSessions = [];

        for (
            const session
            of this.sessionsById
                .values()
        ) {
            if (
                session.state ===
                    VoiceSessionState.ACTIVE &&
                session.serverId ===
                    normalizedServerId
            ) {
                const result =
                    this.closeSession(
                        session.sessionId,
                        {
                            reason,
                            effectiveAtMs
                        }
                    );

                if (result?.closed) {
                    closedSessions.push(
                        result.session
                    );
                }
            }
        }

        return Object.freeze(
            closedSessions
        );
    }

    //* این تابع آمار سشن‌های فعال، بسته و شناسه‌های سوخته را برمی‌گرداند.
    getStats() {
        let active = 0;
        let closed = 0;

        for (
            const session
            of this.sessionsById
                .values()
        ) {
            if (
                session.state ===
                VoiceSessionState.ACTIVE
            ) {
                active += 1;
            } else if (
                session.state ===
                VoiceSessionState.CLOSED
            ) {
                closed += 1;
            }
        }

        return Object.freeze({
            total:
                this.sessionsById.size,
            active,
            closed,
            activePairs:
                this.activeSessionIdByPairKey
                    .size,
            indexedConnections:
                this.sessionIdsByConnectionId
                    .size,
            burnedSessionIds:
                this.burnedSessionIds.size
        });
    }
}

export {
    VoiceSessionRegistry
};

/*
توضیح فایل:
این فایل سشن‌های شروع‌شده از Pair و عضویت پویای Group را ثبت می‌کند. یک کاربر می‌تواند عضو چند سشن معتبر باشد، اما هر Pair فقط در یک سشن فعال نمایه می‌شود و شناسه سشن بسته‌شده دوباره استفاده نمی‌شود.
*/
