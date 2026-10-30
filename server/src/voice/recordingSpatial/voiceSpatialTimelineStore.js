import {
    createWriteStream
} from "node:fs";

import {
    mkdir
} from "node:fs/promises";

import {
    join
} from "node:path";

const TIMELINE_FILE_NAME =
    "spatial-timeline.jsonl";

function cleanText(value) {
    return String(value ?? "").trim();
}

function isFiniteNumber(value) {
    return Number.isFinite(Number(value));
}

function normalizeEvent(raw = {}, serverId = "") {
    const event = {
        serverId: cleanText(serverId),
        roomId: cleanText(raw.roomId),
        gameSessionId: cleanText(raw.gameSessionId),
        userId: cleanText(raw.userId),
        playerId: cleanText(raw.playerId),
        connectionId: cleanText(raw.connectionId).toLowerCase(),
        sequence: Number(raw.sequence),
        clientTimestampUnixMs: Number(raw.clientTimestampUnixMs),
        serverTimestampUnixMs: Number(raw.serverTimestampUnixMs),
        position: {
            x: Number(raw.px),
            y: Number(raw.py),
            z: Number(raw.pz)
        },
        rotation: {
            x: Number(raw.rx),
            y: Number(raw.ry),
            z: Number(raw.rz),
            w: Number(raw.rw)
        }
    };

    if (
        !event.serverId ||
        !event.roomId ||
        !event.userId ||
        !Number.isSafeInteger(event.sequence) ||
        event.sequence <= 0 ||
        !Number.isFinite(event.serverTimestampUnixMs) ||
        event.serverTimestampUnixMs <= 0 ||
        !isFiniteNumber(event.position.x) ||
        !isFiniteNumber(event.position.y) ||
        !isFiniteNumber(event.position.z) ||
        !isFiniteNumber(event.rotation.x) ||
        !isFiniteNumber(event.rotation.y) ||
        !isFiniteNumber(event.rotation.z) ||
        !isFiniteNumber(event.rotation.w)
    ) {
        return null;
    }

    return Object.freeze(event);
}

class VoiceSpatialTimelineStore {
    constructor() {
        this.latestByScopeUser = new Map();
        this.activeBySessionId = new Map();
        this.activeSessionIdsByScope = new Map();
        this.acceptedStates = 0;
        this.writtenStates = 0;
        this.seededStates = 0;
    }

    buildScopeKey(serverId, roomId) {
        return `${cleanText(serverId)}::${cleanText(roomId)}`;
    }

    buildLatestKey(serverId, roomId, userId) {
        return `${this.buildScopeKey(serverId, roomId)}::${cleanText(userId)}`;
    }

    observeBatch(serverId, rawEvents = []) {
        let accepted = 0;
        let written = 0;

        for (const raw of Array.isArray(rawEvents) ? rawEvents : []) {
            const event = normalizeEvent(raw, serverId);
            if (!event) continue;

            const latestKey =
                this.buildLatestKey(
                    event.serverId,
                    event.roomId,
                    event.userId
                );

            const previous =
                this.latestByScopeUser.get(latestKey);

            if (
                previous &&
                Number(previous.sequence) >=
                    event.sequence &&
                Number(previous.serverTimestampUnixMs) >=
                    event.serverTimestampUnixMs
            ) {
                continue;
            }

            this.latestByScopeUser.set(
                latestKey,
                event
            );

            accepted += 1;
            this.acceptedStates += 1;

            const scopeKey =
                this.buildScopeKey(
                    event.serverId,
                    event.roomId
                );

            const sessionIds =
                this.activeSessionIdsByScope.get(
                    scopeKey
                );

            if (!sessionIds) continue;

            for (const sessionId of sessionIds) {
                const active =
                    this.activeBySessionId.get(
                        sessionId
                    );

                if (
                    !active ||
                    !active.participantUserIds.has(
                        event.userId
                    )
                ) {
                    continue;
                }

                this.writeState(
                    active,
                    event,
                    false
                );

                written += 1;
            }
        }

        return Object.freeze({
            accepted,
            written
        });
    }

    async startRecording({
        storageRoot,
        sessionId,
        roomId,
        serverId,
        startedAtMs,
        participantUserIds
    }) {
        const normalizedSessionId =
            cleanText(sessionId).toLowerCase();

        if (
            !storageRoot ||
            !normalizedSessionId ||
            !cleanText(roomId) ||
            !cleanText(serverId) ||
            !Number.isFinite(Number(startedAtMs))
        ) {
            throw new TypeError(
                "Spatial timeline recording identity is invalid."
            );
        }

        if (
            this.activeBySessionId.has(
                normalizedSessionId
            )
        ) {
            this.updateParticipants(
                normalizedSessionId,
                participantUserIds
            );

            return this.activeBySessionId.get(
                normalizedSessionId
            );
        }

        const sessionDirectory =
            join(
                storageRoot,
                normalizedSessionId
            );

        await mkdir(
            sessionDirectory,
            {
                recursive: true
            }
        );

        const filePath =
            join(
                sessionDirectory,
                TIMELINE_FILE_NAME
            );

        const stream =
            createWriteStream(
                filePath,
                {
                    flags: "a",
                    encoding: "utf8"
                }
            );

        const active = {
            sessionId:
                normalizedSessionId,
            roomId:
                cleanText(roomId),
            serverId:
                cleanText(serverId),
            startedAtMs:
                Number(startedAtMs),
            participantUserIds:
                new Set(
                    Array.from(
                        participantUserIds ?? [],
                        cleanText
                    ).filter(Boolean)
                ),
            filePath,
            stream,
            recordCount: 0
        };

        this.activeBySessionId.set(
            normalizedSessionId,
            active
        );

        const scopeKey =
            this.buildScopeKey(
                active.serverId,
                active.roomId
            );

        let sessionIds =
            this.activeSessionIdsByScope.get(
                scopeKey
            );

        if (!sessionIds) {
            sessionIds = new Set();
            this.activeSessionIdsByScope.set(
                scopeKey,
                sessionIds
            );
        }

        sessionIds.add(
            normalizedSessionId
        );

        this.writeLine(
            active,
            {
                type:
                    "spatial_timeline_start",
                version:
                    1,
                sessionId:
                    active.sessionId,
                roomId:
                    active.roomId,
                serverId:
                    active.serverId,
                startedAtMs:
                    active.startedAtMs,
                participantUserIds:
                    [...active.participantUserIds]
            }
        );

        for (
            const userId of
            active.participantUserIds
        ) {
            const latest =
                this.latestByScopeUser.get(
                    this.buildLatestKey(
                        active.serverId,
                        active.roomId,
                        userId
                    )
                );

            if (!latest) continue;

            this.writeState(
                active,
                latest,
                true
            );

            this.seededStates += 1;
        }

        return active;
    }

    updateParticipants(
        sessionId,
        participantUserIds
    ) {
        const active =
            this.activeBySessionId.get(
                cleanText(sessionId).toLowerCase()
            );

        if (!active) return false;

        active.participantUserIds =
            new Set(
                Array.from(
                    participantUserIds ?? [],
                    cleanText
                ).filter(Boolean)
            );

        this.writeLine(
            active,
            {
                type:
                    "spatial_timeline_participants",
                atMs:
                    Date.now(),
                relativeMs:
                    Math.max(
                        0,
                        Date.now() -
                        active.startedAtMs
                    ),
                participantUserIds:
                    [...active.participantUserIds]
            }
        );

        return true;
    }

    writeState(
        active,
        event,
        seed
    ) {
        const atMs =
            seed &&
            event.serverTimestampUnixMs <
                active.startedAtMs
                ? active.startedAtMs
                : event.serverTimestampUnixMs;

        this.writeLine(
            active,
            {
                type:
                    "spatial_state",
                sessionId:
                    active.sessionId,
                atMs,
                relativeMs:
                    Math.max(
                        0,
                        atMs -
                        active.startedAtMs
                    ),
                sourceServerTimestampUnixMs:
                    event.serverTimestampUnixMs,
                sourceClientTimestampUnixMs:
                    event.clientTimestampUnixMs,
                seed:
                    seed === true,
                userId:
                    event.userId,
                playerId:
                    event.playerId,
                connectionId:
                    event.connectionId,
                gameSessionId:
                    event.gameSessionId,
                sequence:
                    event.sequence,
                position:
                    event.position,
                rotation:
                    event.rotation
            }
        );

        this.writtenStates += 1;
    }

    writeLine(
        active,
        payload
    ) {
        if (
            !active ||
            !active.stream ||
            active.stream.destroyed
        ) {
            return false;
        }

        active.stream.write(
            JSON.stringify(
                payload
            ) + "\n"
        );

        active.recordCount += 1;
        return true;
    }

    async stopRecording(
        sessionId,
        reason =
            "session_finalized"
    ) {
        const normalizedSessionId =
            cleanText(sessionId).toLowerCase();

        const active =
            this.activeBySessionId.get(
                normalizedSessionId
            );

        if (!active) return null;

        this.writeLine(
            active,
            {
                type:
                    "spatial_timeline_end",
                endedAtMs:
                    Date.now(),
                relativeMs:
                    Math.max(
                        0,
                        Date.now() -
                        active.startedAtMs
                    ),
                reason:
                    cleanText(reason),
                recordCount:
                    active.recordCount
            }
        );

        await new Promise(
            (resolve, reject) => {
                active.stream.once(
                    "error",
                    reject
                );

                active.stream.end(
                    resolve
                );
            }
        );

        this.activeBySessionId.delete(
            normalizedSessionId
        );

        const scopeKey =
            this.buildScopeKey(
                active.serverId,
                active.roomId
            );

        const sessionIds =
            this.activeSessionIdsByScope.get(
                scopeKey
            );

        sessionIds?.delete(
            normalizedSessionId
        );

        if (
            sessionIds &&
            sessionIds.size === 0
        ) {
            this.activeSessionIdsByScope.delete(
                scopeKey
            );
        }

        return Object.freeze({
            sessionId:
                active.sessionId,
            filePath:
                active.filePath,
            recordCount:
                active.recordCount
        });
    }

    getStats() {
        return Object.freeze({
            activeRecordings:
                this.activeBySessionId.size,
            latestStateCount:
                this.latestByScopeUser.size,
            acceptedStates:
                this.acceptedStates,
            writtenStates:
                this.writtenStates,
            seededStates:
                this.seededStates
        });
    }
}

export {
    TIMELINE_FILE_NAME,
    VoiceSpatialTimelineStore,
    normalizeEvent
};
