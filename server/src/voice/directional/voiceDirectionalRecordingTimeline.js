import {
    appendFile,
    mkdir,
    readFile
} from "node:fs/promises";

import {
    join
} from "node:path";

import {
    VoiceRecordingService
} from "../recording/voiceRecordingService.js";

const RECORDING_TIMELINE_EXTENSION_APPLIED = Symbol.for(
    "network_a.voice.directional.recording_timeline_extension.applied"
);

const DIRECTIONAL_TIMELINE_FILE_NAME = "directional-events.ndjson";

const activeRecordingSessions = new Map();
const routeStateByKey = new Map();
const writeTailByPath = new Map();

function applyVoiceDirectionalRecordingTimelineExtension() {
    const prototype = VoiceRecordingService.prototype;
    if (prototype[RECORDING_TIMELINE_EXTENSION_APPLIED] === true) return;

    const originalStartRecording = prototype.startRecording;
    const originalApplySessionMembershipSnapshot = prototype.applySessionMembershipSnapshot;
    const originalFinalizeSession = prototype.finalizeSession;

    prototype.startRecording = async function startRecordingWithDirectionalTimeline(record) {
        const result = await originalStartRecording.call(this, record);

        registerActiveRecordingSession({
            storageRoot: this.storageRoot,
            record
        });

        return result;
    };

    prototype.applySessionMembershipSnapshot = function applySessionMembershipSnapshotWithDirectionalTimeline(
        record,
        session,
        effectiveAtMs
    ) {
        const result = originalApplySessionMembershipSnapshot.call(
            this,
            record,
            session,
            effectiveAtMs
        );

        updateActiveRecordingSessionMembership(result);
        return result;
    };

    prototype.finalizeSession = async function finalizeSessionWithDirectionalTimeline(
        sessionId,
        stopReason
    ) {
        try {
            return await originalFinalizeSession.call(
                this,
                sessionId,
                stopReason
            );
        } finally {
            await closeActiveRecordingSession(sessionId);
        }
    };

    Object.defineProperty(prototype, RECORDING_TIMELINE_EXTENSION_APPLIED, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: true
    });

    console.log("VOICE_DIRECTIONAL_RECORDING_TIMELINE=READY");
}

function registerActiveRecordingSession({
    storageRoot,
    record
} = {}) {
    const sessionId = normalizeId(record?.session?.sessionId);
    const startedAtMs = normalizeTimestamp(record?.startedAtMs);
    const normalizedStorageRoot = String(storageRoot ?? "").trim();

    if (!sessionId || !startedAtMs || !normalizedStorageRoot) {
        return false;
    }

    const participants = createParticipantSet(
        record?.session?.participants
    );

    const existing = activeRecordingSessions.get(sessionId);
    const entry = existing ?? {
        sessionId,
        storageRoot: normalizedStorageRoot,
        startedAtMs,
        participants,
        timelinePath: join(
            normalizedStorageRoot,
            sessionId,
            DIRECTIONAL_TIMELINE_FILE_NAME
        )
    };

    entry.storageRoot = normalizedStorageRoot;
    entry.startedAtMs = startedAtMs;
    entry.participants = participants;
    entry.timelinePath = join(
        normalizedStorageRoot,
        sessionId,
        DIRECTIONAL_TIMELINE_FILE_NAME
    );

    activeRecordingSessions.set(sessionId, entry);

    if (!existing) {
        void writeInitialBlockedState(entry);
        console.log(
            `VOICE_DIRECTIONAL_RECORDING_SESSION_TRACKED | sessionId=${sessionId}` +
            ` | participantCount=${participants.size}` +
            ` | startedAtMs=${startedAtMs}`
        );
    }

    return true;
}

function updateActiveRecordingSessionMembership(record) {
    const sessionId = normalizeId(record?.session?.sessionId);
    if (!sessionId) return false;

    const entry = activeRecordingSessions.get(sessionId);
    if (!entry) return false;

    entry.participants = createParticipantSet(
        record?.session?.participants
    );

    return true;
}

async function closeActiveRecordingSession(sessionId) {
    const normalizedSessionId = normalizeId(sessionId);
    if (!normalizedSessionId) return;

    const entry = activeRecordingSessions.get(normalizedSessionId);
    activeRecordingSessions.delete(normalizedSessionId);

    if (!entry) return;

    await flushVoiceDirectionalTimelineWrites(entry.timelinePath);

    console.log(
        `VOICE_DIRECTIONAL_RECORDING_SESSION_RELEASED | sessionId=${normalizedSessionId}`
    );
}

function recordVoiceDirectionalButtonState({
    source,
    senderConnectionId,
    receiverConnectionId,
    blocked,
    changedAtMs = Date.now()
} = {}) {
    const normalizedSource = normalizeSource(source);
    const senderId = normalizeId(senderConnectionId);
    const receiverId = normalizeId(receiverConnectionId);
    const timestamp = normalizeTimestamp(changedAtMs);

    if (
        !normalizedSource ||
        !senderId ||
        !receiverId ||
        senderId === receiverId ||
        typeof blocked !== "boolean" ||
        !timestamp
    ) {
        return false;
    }

    updateRouteState({
        source: normalizedSource,
        senderConnectionId: senderId,
        receiverConnectionId: receiverId,
        blocked,
        changedAtMs: timestamp
    });

    let matchedSessionCount = 0;

    for (const entry of activeRecordingSessions.values()) {
        if (
            timestamp < entry.startedAtMs ||
            !entry.participants.has(senderId) ||
            !entry.participants.has(receiverId)
        ) {
            continue;
        }

        matchedSessionCount += 1;

        const offsetMs = Math.max(
            0,
            timestamp - entry.startedAtMs
        );

        queueTimelineEvent(entry, {
            version: 1,
            sessionId: entry.sessionId,
            source: normalizedSource,
            senderConnectionId: senderId,
            receiverConnectionId: receiverId,
            blocked,
            changedAtMs: timestamp,
            offsetMs
        });

        console.log(
            `VOICE_DIRECTIONAL_RECORDING_EVENT_STORED | sessionId=${entry.sessionId}` +
            ` | source=${normalizedSource}` +
            ` | senderConnectionId=${senderId}` +
            ` | receiverConnectionId=${receiverId}` +
            ` | requested=${blocked ? "OFF" : "ON"}` +
            ` | changedAtMs=${timestamp}` +
            ` | offsetMs=${offsetMs}`
        );
    }

    console.log(
        `VOICE_DIRECTIONAL_RECORDING_EVENT | source=${normalizedSource}` +
        ` | senderConnectionId=${senderId}` +
        ` | receiverConnectionId=${receiverId}` +
        ` | requested=${blocked ? "OFF" : "ON"}` +
        ` | changedAtMs=${timestamp}` +
        ` | sessionCount=${matchedSessionCount}`
    );

    return true;
}

async function writeInitialBlockedState(entry) {
    const participants = Array.from(entry.participants);

    for (const senderConnectionId of participants) {
        for (const receiverConnectionId of participants) {
            if (senderConnectionId === receiverConnectionId) continue;

            const state = routeStateByKey.get(
                createRouteKey(
                    senderConnectionId,
                    receiverConnectionId
                )
            );

            if (!state) continue;

            if (state.senderMicBlocked === true) {
                queueTimelineEvent(entry, {
                    version: 1,
                    sessionId: entry.sessionId,
                    source: "sender_mic",
                    senderConnectionId,
                    receiverConnectionId,
                    blocked: true,
                    changedAtMs: entry.startedAtMs,
                    offsetMs: 0,
                    initialState: true
                });
            }

            if (state.receiverSpeakerBlocked === true) {
                queueTimelineEvent(entry, {
                    version: 1,
                    sessionId: entry.sessionId,
                    source: "receiver_speaker",
                    senderConnectionId,
                    receiverConnectionId,
                    blocked: true,
                    changedAtMs: entry.startedAtMs,
                    offsetMs: 0,
                    initialState: true
                });
            }
        }
    }
}

function updateRouteState({
    source,
    senderConnectionId,
    receiverConnectionId,
    blocked,
    changedAtMs
}) {
    const key = createRouteKey(
        senderConnectionId,
        receiverConnectionId
    );

    const state = routeStateByKey.get(key) ?? {
        senderConnectionId,
        receiverConnectionId,
        senderMicBlocked: false,
        receiverSpeakerBlocked: false,
        changedAtMs: 0
    };

    if (source === "sender_mic") {
        state.senderMicBlocked = blocked;
    } else {
        state.receiverSpeakerBlocked = blocked;
    }

    state.changedAtMs = changedAtMs;
    routeStateByKey.set(key, state);
}

function queueTimelineEvent(entry, event) {
    const timelinePath = entry.timelinePath;
    const previousTail = writeTailByPath.get(timelinePath) ?? Promise.resolve();

    const nextTail = previousTail
        .catch(() => {})
        .then(async () => {
            await mkdir(
                join(entry.storageRoot, entry.sessionId),
                {
                    recursive: true,
                    mode: 0o750
                }
            );

            await appendFile(
                timelinePath,
                `${JSON.stringify(event)}\n`,
                {
                    encoding: "utf8",
                    mode: 0o640
                }
            );
        })
        .catch((error) => {
            console.error(
                "VOICE_DIRECTIONAL_RECORDING_EVENT_WRITE_FAILED",
                error
            );
            throw error;
        });

    writeTailByPath.set(timelinePath, nextTail);
    return nextTail;
}

async function flushVoiceDirectionalTimelineWrites(pathOrSessionId = null) {
    if (!pathOrSessionId) {
        await Promise.allSettled(
            Array.from(writeTailByPath.values())
        );
        return;
    }

    const directPath = String(pathOrSessionId);
    const directTail = writeTailByPath.get(directPath);
    if (directTail) {
        await directTail.catch(() => {});
        return;
    }

    const sessionId = normalizeId(pathOrSessionId);
    if (!sessionId) return;

    const matchingTails = [];
    for (const [timelinePath, tail] of writeTailByPath) {
        if (timelinePath.includes(`/${sessionId}/`) || timelinePath.includes(`\\${sessionId}\\`)) {
            matchingTails.push(tail);
        }
    }

    await Promise.allSettled(matchingTails);
}

async function readVoiceDirectionalTimeline({
    sessionDirectory,
    sessionId
} = {}) {
    const normalizedSessionId = normalizeId(sessionId);
    const normalizedDirectory = String(sessionDirectory ?? "").trim();

    if (!normalizedSessionId || !normalizedDirectory) {
        return Object.freeze([]);
    }

    const timelinePath = join(
        normalizedDirectory,
        DIRECTIONAL_TIMELINE_FILE_NAME
    );

    await flushVoiceDirectionalTimelineWrites(timelinePath);

    let text;
    try {
        text = await readFile(timelinePath, "utf8");
    } catch (error) {
        if (error?.code === "ENOENT") {
            return Object.freeze([]);
        }
        throw error;
    }

    const events = [];

    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;

        try {
            const event = JSON.parse(line);
            if (
                normalizeId(event?.sessionId) !== normalizedSessionId ||
                !normalizeSource(event?.source) ||
                !normalizeId(event?.senderConnectionId) ||
                !normalizeId(event?.receiverConnectionId) ||
                typeof event?.blocked !== "boolean" ||
                !normalizeTimestamp(event?.changedAtMs)
            ) {
                continue;
            }

            events.push(
                Object.freeze({
                    version: 1,
                    sessionId: normalizedSessionId,
                    source: normalizeSource(event.source),
                    senderConnectionId: normalizeId(event.senderConnectionId),
                    receiverConnectionId: normalizeId(event.receiverConnectionId),
                    blocked: event.blocked,
                    changedAtMs: normalizeTimestamp(event.changedAtMs),
                    offsetMs: Math.max(0, Number(event.offsetMs) || 0),
                    initialState: event.initialState === true
                })
            );
        } catch {
        }
    }

    events.sort(
        (left, right) =>
            left.changedAtMs - right.changedAtMs
    );

    return Object.freeze(events);
}

function createParticipantSet(participants) {
    const set = new Set();

    if (!Array.isArray(participants)) {
        return set;
    }

    for (const participant of participants) {
        const connectionId = normalizeId(
            participant?.connectionId
        );
        if (connectionId) set.add(connectionId);
    }

    return set;
}

function normalizeSource(value) {
    const source = String(value ?? "").trim();
    if (source === "sender_mic") return source;
    if (source === "receiver_speaker") return source;
    return "";
}

function normalizeId(value) {
    return String(value ?? "")
        .trim()
        .toLowerCase();
}

function normalizeTimestamp(value) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) return 0;
    return number;
}

function createRouteKey(senderConnectionId, receiverConnectionId) {
    return `${senderConnectionId}>${receiverConnectionId}`;
}

export {
    DIRECTIONAL_TIMELINE_FILE_NAME,
    applyVoiceDirectionalRecordingTimelineExtension,
    flushVoiceDirectionalTimelineWrites,
    readVoiceDirectionalTimeline,
    recordVoiceDirectionalButtonState
};
