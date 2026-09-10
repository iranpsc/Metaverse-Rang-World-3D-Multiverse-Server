import {
    createHash
} from "node:crypto";

import {
    spawn
} from "node:child_process";

import {
    createReadStream,
    createWriteStream
} from "node:fs";

import {
    mkdir,
    rename,
    rm,
    writeFile
} from "node:fs/promises";

import {
    once
} from "node:events";

import {
    parentPort
} from "node:worker_threads";

import {
    VoiceOggOpusStreamState
} from "./voiceOggOpusMuxer.js";

if (!parentPort) {
    throw new Error(
        "Voice recording worker requires a parent port."
    );
}


const VOICE_RECORDING_WORKER_TRACE_FRAME_SAMPLE_LIMIT = 5;
const VOICE_RECORDING_WORKER_TRACE_FRAME_SAMPLE_INTERVAL = 50;
const VOICE_RECORDING_TIMELINE_GAP_SPLIT_MS = 120;

function formatVoiceRecordingWorkerTraceValue(value) {
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

function writeVoiceRecordingWorkerTrace(marker, fields = {}) {
    try {
        const details = Object.entries(fields)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => `${key}=${formatVoiceRecordingWorkerTraceValue(value)}`)
            .join(" | ");

        console.log(
            `[G4_VOICE_RECORDING_WORKER_TRACE] ${marker}${details ? ` | ${details}` : ""}`
        );
    } catch {
        console.log(`[G4_VOICE_RECORDING_WORKER_TRACE] ${marker} | trace_format_failed=true`);
    }
}

function shouldLogVoiceRecordingWorkerFrameTrace(count) {
    return (
        count <= VOICE_RECORDING_WORKER_TRACE_FRAME_SAMPLE_LIMIT ||
        count % VOICE_RECORDING_WORKER_TRACE_FRAME_SAMPLE_INTERVAL === 0
    );
}

let session = null;
let operationTail = Promise.resolve();

//* این تابع داده را با رعایت Backpressure روی فایل خروجی می‌نویسد.
async function writeChunk(stream, chunk) {
    if (!stream.write(chunk)) {
        await once(stream, "drain");
    }
}

//* این تابع یک WriteStream را کامل و خطای احتمالی آن را آشکار می‌کند.
async function finishStream(stream) {
    stream.end();
    await once(stream, "finish");
}

//* این تابع هش SHA-256 فایل نهایی را بدون بارگذاری کامل آن محاسبه می‌کند.
async function hashFile(filePath) {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);

    for await (const chunk of stream) {
        hash.update(chunk);
    }

    return hash.digest("hex");
}

function resolveVoiceRecordingFfmpegPath() {
    return process.env.VOICE_RECORDING_FFMPEG_PATH || "ffmpeg";
}

async function runVoiceRecordingProcess(command, args, timeoutMs = 120000) {
    return await new Promise((resolve, reject) => {
        let settled = false;
        let stdout = "";
        let stderr = "";

        const child = spawn(command, args, {
            stdio: ["ignore", "pipe", "pipe"]
        });

        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            callback(value);
        };

        const timer = setTimeout(() => {
            child.kill("SIGKILL");
            const error = new Error(`${command} timed out.`);
            error.code = "VOICE_RECORDING_PROCESS_TIMEOUT";
            finish(reject, error);
        }, timeoutMs);

        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString("utf8");
            if (stdout.length > 8000) stdout = stdout.slice(-8000);
        });

        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString("utf8");
            if (stderr.length > 8000) stderr = stderr.slice(-8000);
        });

        child.on("error", (error) => {
            finish(reject, error);
        });

        child.on("close", (code) => {
            if (code === 0) {
                finish(resolve, { stdout, stderr });
                return;
            }

            const error = new Error(`${command} failed with exit code ${code}: ${stderr}`);
            error.code = "VOICE_RECORDING_PROCESS_FAILED";
            finish(reject, error);
        });
    });
}

async function createMixedSessionRecording({
    inputPaths,
    outputPath
} = {}) {
    if (!Array.isArray(inputPaths) || inputPaths.length === 0) {
        throw new Error("Voice recording mix requires at least one input file.");
    }

    const args = [
        "-hide_banner",
        "-nostdin",
        "-y"
    ];

    for (const inputPath of inputPaths) {
        args.push("-i", inputPath);
    }

    if (inputPaths.length === 1) {
        args.push(
            "-vn",
            "-ac", "1",
            "-ar", "48000",
            "-c:a", "libopus",
            "-b:a", "32000",
            "-application", "voip",
            "-f", "ogg",
            outputPath
        );
    } else {
        const inputLabels =
            inputPaths.map((_, index) => `[${index}:a]`).join("");

        args.push(
            "-filter_complex",
            `${inputLabels}amix=inputs=${inputPaths.length}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95,aresample=48000[aout]`,
            "-map", "[aout]",
            "-vn",
            "-ac", "1",
            "-ar", "48000",
            "-c:a", "libopus",
            "-b:a", "32000",
            "-application", "voip",
            "-f", "ogg",
            outputPath
        );
    }

    await runVoiceRecordingProcess(
        resolveVoiceRecordingFfmpegPath(),
        args
    );
}

async function createAlignedParticipantRecording({
    segments,
    outputPath,
    sessionStartedAtMs,
    durationMs
} = {}) {
    const normalizedDurationMs =
        Math.max(20, Number(durationMs) || 0);
    const durationSeconds =
        (normalizedDurationMs / 1000).toFixed(3);
    const inputSegments =
        Array.isArray(segments)
            ? segments.filter(
                (segment) =>
                    segment &&
                    typeof segment.finalPath === "string"
            )
            : [];

    if (inputSegments.length === 0) {
        await runVoiceRecordingProcess(
            resolveVoiceRecordingFfmpegPath(),
            [
                "-hide_banner", "-nostdin", "-y",
                "-f", "lavfi",
                "-i", "anullsrc=r=48000:cl=mono",
                "-t", durationSeconds,
                "-vn", "-ac", "1", "-ar", "48000",
                "-c:a", "libopus",
                "-b:a", "32000",
                "-application", "voip",
                "-f", "ogg",
                outputPath
            ]
        );
        return;
    }

    const args = ["-hide_banner", "-nostdin", "-y"];
    for (const segment of inputSegments) {
        args.push("-i", segment.finalPath);
    }

    const filterParts = [];
    const delayedLabels = [];
    inputSegments.forEach((segment, index) => {
        const delayMs = Math.max(
            0,
            Math.round(
                Number(segment.startedAtMs) -
                Number(sessionStartedAtMs)
            )
        );
        const label = `seg${index}`;
        filterParts.push(
            `[${index}:a]adelay=${delayMs}:all=1[${label}]`
        );
        delayedLabels.push(`[${label}]`);
    });

    filterParts.push(
        `${delayedLabels.join("")}amix=inputs=${inputSegments.length}:duration=longest:dropout_transition=0:normalize=0,apad,atrim=duration=${durationSeconds},alimiter=limit=0.95,aresample=48000[aout]`
    );

    args.push(
        "-filter_complex", filterParts.join(";"),
        "-map", "[aout]",
        "-vn", "-ac", "1", "-ar", "48000",
        "-c:a", "libopus",
        "-b:a", "32000",
        "-application", "voip",
        "-f", "ogg",
        outputPath
    );

    await runVoiceRecordingProcess(
        resolveVoiceRecordingFfmpegPath(),
        args
    );
}

async function openParticipantSegment(
    activeSession,
    participant,
    startedAtMs
) {
    if (participant.activeSegment) {
        return participant.activeSegment;
    }

    const segmentIndex = participant.segments.length;
    const normalizedStartedAtMs = Math.max(
        Number(activeSession.startedAtMs),
        Number(startedAtMs)
    );
    const segmentBaseName =
        `${participant.connectionId}.segment-${String(segmentIndex).padStart(4, "0")}.ogg`;
    const partialPath =
        `${activeSession.segmentDirectory}/${segmentBaseName}.partial`;
    const finalPath =
        `${activeSession.segmentDirectory}/${segmentBaseName}`;
    const stream = createWriteStream(partialPath, {
        flags: "wx",
        mode: 0o640
    });

    await once(stream, "open");

    const streamState = new VoiceOggOpusStreamState(
        activeSession.nextSerialNumber++
    );
    for (const header of streamState.createHeaders()) {
        await writeChunk(stream, header);
    }

    const segment = {
        index: segmentIndex,
        startedAtMs: normalizedStartedAtMs,
        endedAtMs: null,
        partialPath,
        finalPath,
        stream,
        streamState,
        frameCount: 0,
        opusBytes: 0
    };

    participant.segments.push(segment);
    participant.activeSegment = segment;

    writeVoiceRecordingWorkerTrace("PARTICIPANT_SEGMENT_STARTED", {
        sessionId: activeSession.sessionId,
        connectionId: participant.connectionId,
        segmentIndex,
        startedAtMs: normalizedStartedAtMs
    });

    return segment;
}

async function closeParticipantSegment(
    activeSession,
    participant,
    endedAtMs
) {
    const segment = participant.activeSegment;
    if (!segment) return false;

    segment.endedAtMs = Math.max(
        segment.startedAtMs,
        Number(endedAtMs)
    );
    await writeChunk(
        segment.stream,
        segment.streamState.createEnd()
    );
    await finishStream(segment.stream);
    await rename(segment.partialPath, segment.finalPath);
    participant.activeSegment = null;

    writeVoiceRecordingWorkerTrace("PARTICIPANT_SEGMENT_CLOSED", {
        sessionId: activeSession.sessionId,
        connectionId: participant.connectionId,
        segmentIndex: segment.index,
        startedAtMs: segment.startedAtMs,
        endedAtMs: segment.endedAtMs,
        frameCount: segment.frameCount,
        opusBytes: segment.opusBytes
    });
    return true;
}

function closeParticipantConsentInterval(participant, endedAtMs) {
    const interval = participant.consentIntervals[
        participant.consentIntervals.length - 1
    ];
    if (!interval || interval.revokedAtMs !== null) return;
    interval.revokedAtMs = Math.max(
        interval.consentedAtMs,
        Number(endedAtMs)
    );
}

async function applyParticipantConsent(
    activeSession,
    participant,
    consented,
    changedAtMs
) {
    const normalizedChangedAtMs = Math.max(
        Number(activeSession.startedAtMs),
        Number(changedAtMs)
    );

    if (consented === true) {
        if (!participant.consented) {
            participant.consented = true;
            if (!Number.isFinite(Number(participant.consentedAtMs))) {
                participant.consentedAtMs = normalizedChangedAtMs;
            }
            participant.consentIntervals.push({
                consentedAtMs: normalizedChangedAtMs,
                revokedAtMs: null
            });
        }
        return;
    }

    if (participant.consented) {
        participant.consented = false;
        closeParticipantConsentInterval(
            participant,
            normalizedChangedAtMs
        );
        await closeParticipantSegment(
            activeSession,
            participant,
            normalizedChangedAtMs
        );
        participant.lastCapturedAtMs = null;
    }
}

//* این تابع Stream مستقل عضو را می‌سازد یا بازه تازه عضویت همان اتصال را باز می‌کند.
async function activateParticipant(
    activeSession,
    participant,
    effectiveAtMs
) {
    const existingParticipant =
        activeSession.participantsByConnectionId.get(
            participant.connectionId
        );
    const joinedAtMs = Math.max(
        Number(activeSession.startedAtMs),
        Number(effectiveAtMs)
    );

    if (existingParticipant) {
        if (existingParticipant.userId !== participant.userId) {
            throw new Error(
                "Voice recording connection ownership cannot change inside a session."
            );
        }
        if (!existingParticipant.active) {
            existingParticipant.active = true;
            existingParticipant.intervals.push({
                joinedAtMs,
                leftAtMs: null
            });
        }
        await applyParticipantConsent(
            activeSession,
            existingParticipant,
            participant.consented === true,
            participant.consented === true &&
            Number.isFinite(Number(participant.consentedAtMs))
                ? Number(participant.consentedAtMs)
                : joinedAtMs
        );
        return existingParticipant;
    }

    const finalPath =
        `${activeSession.participantDirectory}/${participant.connectionId}.ogg`;
    const initialConsented = participant.consented === true;
    const initialConsentedAtMs =
        initialConsented &&
        Number.isFinite(Number(participant.consentedAtMs))
            ? Math.max(
                Number(activeSession.startedAtMs),
                Number(participant.consentedAtMs)
            )
            : null;

    const participantRecord = {
        ...participant,
        active: true,
        consented: initialConsented,
        consentedAtMs: initialConsentedAtMs,
        finalPath,
        frameCount: 0,
        opusBytes: 0,
        segments: [],
        activeSegment: null,
        lastCapturedAtMs: null,
        consentIntervals: initialConsented
            ? [{
                consentedAtMs: initialConsentedAtMs,
                revokedAtMs: null
            }]
            : [],
        intervals: [{ joinedAtMs, leftAtMs: null }]
    };

    activeSession.participantsByConnectionId.set(
        participant.connectionId,
        participantRecord
    );
    writeVoiceRecordingWorkerTrace("PARTICIPANT_READY", {
        sessionId: activeSession.sessionId,
        connectionId: participant.connectionId,
        joinedAtMs,
        consented: initialConsented,
        finalPath
    });
    return participantRecord;
}

//* این تابع ضبط یک Session را همراه Logical Stream مستقل هر عضو آغاز می‌کند.
async function startSession(message) {
    writeVoiceRecordingWorkerTrace("START_SESSION_BEGIN", {
        sessionId: message.sessionId,
        outputDirectory: message.outputDirectory,
        participantCount: Array.isArray(message.participants) ? message.participants.length : -1
    });

    if (session) {
        writeVoiceRecordingWorkerTrace("START_SESSION_REJECTED", {
            sessionId: message.sessionId,
            activeSessionId: session.sessionId,
            reason: "worker_already_active"
        });
        throw new Error("Voice recording worker is already active.");
    }

    await mkdir(message.outputDirectory, {
        recursive: true,
        mode: 0o750
    });

    const participantDirectory =
        `${message.outputDirectory}/participants`;
    const segmentDirectory =
        `${message.outputDirectory}/segments`;

    await mkdir(participantDirectory, {
        recursive: true,
        mode: 0o750
    });
    await mkdir(segmentDirectory, {
        recursive: true,
        mode: 0o750
    });

    writeVoiceRecordingWorkerTrace("START_SESSION_DIRECTORIES_READY", {
        sessionId: message.sessionId,
        outputDirectory: message.outputDirectory,
        participantDirectory,
        segmentDirectory
    });

    const combinedPartialPath =
        `${message.outputDirectory}/session.ogg.partial`;

    const combinedFinalPath =
        `${message.outputDirectory}/session.ogg`;

    session = {
        sessionId: message.sessionId,
        outputDirectory: message.outputDirectory,
        participantDirectory,
        segmentDirectory,
        combinedPartialPath,
        combinedFinalPath,
        participantsByConnectionId: new Map(),
        nextSerialNumber: 0x4d560001,
        startedAtMs: message.startedAtMs,
        frameCount: 0,
        opusBytes: 0
    };

    for (const participant of message.participants) {
        await activateParticipant(
            session,
            participant,
            participant.joinedAtMs ??
                message.startedAtMs
        );
    }

    writeVoiceRecordingWorkerTrace("START_SESSION_DONE", {
        sessionId: session.sessionId,
        participantCount:
            session.participantsByConnectionId.size,
        combinedPartialPath,
        combinedFinalPath
    });

    parentPort.postMessage({
        type: "started",
        sessionId: session.sessionId
    });
}

//* این تابع Join/Leave یک عضو را روی همان Worker و همان فایل Session اعمال می‌کند.
async function updateMembership(message) {
    if (!session || session.sessionId !== message.sessionId) {
        throw new Error(
            "Voice recording session is not active for membership update."
        );
    }

    if (message.active === true) {
        await activateParticipant(
            session,
            message.participant,
            message.effectiveAtMs
        );
    } else {
        const participant = session.participantsByConnectionId.get(
            message.participant.connectionId
        );
        if (participant?.active) {
            await closeParticipantSegment(
                session,
                participant,
                message.effectiveAtMs
            );
            closeParticipantConsentInterval(
                participant,
                message.effectiveAtMs
            );
            participant.consented = false;
            participant.lastCapturedAtMs = null;
            participant.active = false;
            const interval = participant.intervals[
                participant.intervals.length - 1
            ];
            interval.leftAtMs = Math.max(
                interval.joinedAtMs,
                Number(message.effectiveAtMs)
            );
        }
    }

    writeVoiceRecordingWorkerTrace("MEMBERSHIP_UPDATED", {
        sessionId: session.sessionId,
        connectionId: message.participant.connectionId,
        active: message.active,
        effectiveAtMs: message.effectiveAtMs
    });
}

//* این تابع زمان رضایت عضو را بدون تغییر بازه عضویت در Metadata نگه می‌دارد.
async function updateConsent(message) {
    if (!session || session.sessionId !== message.sessionId) {
        throw new Error(
            "Voice recording session is not active for consent update."
        );
    }
    const participant = session.participantsByConnectionId.get(
        message.connectionId
    );
    if (!participant) {
        throw new Error(
            "Voice recording consent participant was not found."
        );
    }
    await applyParticipantConsent(
        session,
        participant,
        message.consented === true,
        message.changedAtMs
    );
    writeVoiceRecordingWorkerTrace("CONSENT_UPDATED", {
        sessionId: session.sessionId,
        connectionId: message.connectionId,
        consented: participant.consented,
        changedAtMs: message.changedAtMs
    });
}

//* این تابع یک فریم را هم در فایل چندمسیره Session و هم فایل مستقل عضو می‌نویسد.
async function writeFrame(message) {
    if (!session || session.sessionId !== message.sessionId) {
        writeVoiceRecordingWorkerTrace("WRITE_FRAME_REJECTED", {
            sessionId: message.sessionId,
            activeSessionId: session?.sessionId ?? "",
            connectionId: message.connectionId,
            reason: "session_not_active"
        });
        throw new Error("Voice recording session is not active.");
    }

    const participant = session.participantsByConnectionId.get(
        message.connectionId
    );
    if (!participant) {
        throw new Error(
            "Voice recording frame publisher is not a session member."
        );
    }
    if (!participant.active) {
        throw new Error(
            "Voice recording frame publisher membership is inactive."
        );
    }
    if (!participant.consented) {
        throw new Error(
            "Voice recording frame publisher consent is revoked."
        );
    }

    const payload = Buffer.from(message.payload);
    const capturedAtMs = Number.isFinite(Number(message.capturedAtMs))
        ? Math.max(
            Number(session.startedAtMs),
            Number(message.capturedAtMs)
        )
        : Number(session.startedAtMs) +
            participant.frameCount * 20;

    if (
        participant.activeSegment &&
        Number.isFinite(Number(participant.lastCapturedAtMs)) &&
        capturedAtMs - participant.lastCapturedAtMs >
            VOICE_RECORDING_TIMELINE_GAP_SPLIT_MS
    ) {
        await closeParticipantSegment(
            session,
            participant,
            participant.lastCapturedAtMs + 20
        );
    }

    const segment = await openParticipantSegment(
        session,
        participant,
        capturedAtMs
    );
    await writeChunk(
        segment.stream,
        segment.streamState.createFrame(payload)
    );

    segment.frameCount += 1;
    segment.opusBytes += payload.length;
    participant.frameCount += 1;
    participant.opusBytes += payload.length;
    participant.lastCapturedAtMs = capturedAtMs;
    session.frameCount += 1;
    session.opusBytes += payload.length;

    if (shouldLogVoiceRecordingWorkerFrameTrace(session.frameCount)) {
        writeVoiceRecordingWorkerTrace("WRITE_FRAME_DONE", {
            sessionId: session.sessionId,
            connectionId: message.connectionId,
            sessionFrameCount: session.frameCount,
            participantFrameCount: participant.frameCount,
            segmentIndex: segment.index,
            payloadBytes: payload.length,
            sessionOpusBytes: session.opusBytes
        });
    }

    parentPort.postMessage({
        type: "frame_written",
        sessionId: session.sessionId,
        connectionId: participant.connectionId
    });
}

//* این تابع تمام Streamها را می‌بندد، فایل‌ها را اتمیک نهایی و Metadata و Checksum را ثبت می‌کند.
async function stopSession(message) {
    writeVoiceRecordingWorkerTrace("STOP_SESSION_BEGIN", {
        sessionId: message.sessionId,
        activeSessionId: session?.sessionId ?? "",
        endedAtMs: message.endedAtMs,
        stopReason: message.stopReason
    });

    if (!session || session.sessionId !== message.sessionId) {
        writeVoiceRecordingWorkerTrace("STOP_SESSION_REJECTED", {
            sessionId: message.sessionId,
            activeSessionId: session?.sessionId ?? "",
            reason: "session_not_active"
        });
        throw new Error("Voice recording session is not active.");
    }

    const durationMs = Math.max(
        0,
        Number(message.endedAtMs) - Number(session.startedAtMs)
    );

    for (const participant of session.participantsByConnectionId.values()) {
        if (participant.active) {
            const interval = participant.intervals[
                participant.intervals.length - 1
            ];
            interval.leftAtMs = Math.max(
                interval.joinedAtMs,
                Number(message.endedAtMs)
            );
            participant.active = false;
        }

        closeParticipantConsentInterval(
            participant,
            message.endedAtMs
        );
        participant.consented = false;
        await closeParticipantSegment(
            session,
            participant,
            message.endedAtMs
        );
        await createAlignedParticipantRecording({
            segments: participant.segments,
            outputPath: participant.finalPath,
            sessionStartedAtMs: session.startedAtMs,
            durationMs
        });

        writeVoiceRecordingWorkerTrace("STOP_SESSION_PARTICIPANT_READY", {
            sessionId: session.sessionId,
            connectionId: participant.connectionId,
            finalPath: participant.finalPath,
            segmentCount: participant.segments.length,
            frameCount: participant.frameCount,
            opusBytes: participant.opusBytes
        });
    }

    await createMixedSessionRecording({
        inputPaths: Array.from(
            session.participantsByConnectionId.values(),
            (participant) => participant.finalPath
        ),
        outputPath: session.combinedPartialPath
    });
    await rename(
        session.combinedPartialPath,
        session.combinedFinalPath
    );

    try {
        await rm(session.segmentDirectory, {
            recursive: true,
            force: true
        });
    } catch (error) {
        writeVoiceRecordingWorkerTrace("SEGMENT_CLEANUP_FAILED", {
            sessionId: session.sessionId,
            segmentDirectory: session.segmentDirectory,
            error: error?.message ?? String(error)
        });
    }

    const checksumSha256 =
        await hashFile(session.combinedFinalPath);

    const metadata = {
        version: 2,
        recordingContract: "G4.RD1",
        membershipModel:
            "dynamic_session_membership_v1",
        sessionId: session.sessionId,
        roomId: message.roomId,
        serverId: message.serverId,
        startedAtMs: session.startedAtMs,
        endedAtMs: message.endedAtMs,
        durationMs,
        stopReason: message.stopReason,
        codec: "opus",
        container: "ogg",
        sampleRate: 48000,
        channels: 1,
        frameDurationMs: 20,
        frameCount: session.frameCount,
        opusBytes: session.opusBytes,
        checksumAlgorithm: "sha256",
        checksumSha256,
        authorizationModel:
            "user_intervals_from_session_json",
        participants: Array.from(
            session.participantsByConnectionId.values(),
            (participant) => {
                const intervals =
                    participant.intervals.map(
                        (interval) => {
                            const joinedAtMs =
                                Math.max(
                                    session.startedAtMs,
                                    Number(interval.joinedAtMs)
                                );

                            const leftAtMs =
                                Math.min(
                                    Number(message.endedAtMs),
                                    Math.max(
                                        joinedAtMs,
                                        Number(
                                            interval.leftAtMs ??
                                            message.endedAtMs
                                        )
                                    )
                                );

                            return {
                                joinedAtMs,
                                leftAtMs,
                                startOffsetMs:
                                    Math.max(
                                        0,
                                        joinedAtMs -
                                            session.startedAtMs
                                    ),
                                endOffsetMs:
                                    Math.min(
                                        durationMs,
                                        Math.max(
                                            0,
                                            leftAtMs -
                                                session.startedAtMs
                                        )
                                    )
                            };
                        }
                    )
                    .filter(
                        (interval) =>
                            interval.endOffsetMs >
                            interval.startOffsetMs
                    );

                return {
                    userId: participant.userId,
                    connectionId: participant.connectionId,
                    consentedAtMs: participant.consentedAtMs,
                    joinedAtMs:
                        intervals[0]?.joinedAtMs ??
                        session.startedAtMs,
                    leftAtMs:
                        intervals[
                            intervals.length - 1
                        ]?.leftAtMs ??
                        message.endedAtMs,
                    consentIntervals:
                        participant.consentIntervals.map(
                            (interval) => {
                                const consentedAtMs = Math.max(
                                    session.startedAtMs,
                                    Number(interval.consentedAtMs)
                                );
                                const revokedAtMs = Math.min(
                                    Number(message.endedAtMs),
                                    Math.max(
                                        consentedAtMs,
                                        Number(
                                            interval.revokedAtMs ??
                                            message.endedAtMs
                                        )
                                    )
                                );
                                return {
                                    consentedAtMs,
                                    revokedAtMs,
                                    startOffsetMs: Math.max(
                                        0,
                                        consentedAtMs - session.startedAtMs
                                    ),
                                    endOffsetMs: Math.min(
                                        durationMs,
                                        Math.max(
                                            0,
                                            revokedAtMs - session.startedAtMs
                                        )
                                    )
                                };
                            }
                        ),
                    frameCount: participant.frameCount,
                    opusBytes: participant.opusBytes,
                    intervals
                };
            }
        )
    };

    const metadataPartialPath =
        `${session.outputDirectory}/session.json.partial`;

    const metadataFinalPath =
        `${session.outputDirectory}/session.json`;

    writeVoiceRecordingWorkerTrace("STOP_SESSION_METADATA_READY", {
        sessionId: session.sessionId,
        frameCount: session.frameCount,
        opusBytes: session.opusBytes,
        checksumSha256
    });

    await writeFile(
        metadataPartialPath,
        `${JSON.stringify(metadata, null, 2)}\n`,
        {
            encoding: "utf8",
            mode: 0o640,
            flag: "wx"
        }
    );

    await rename(
        metadataPartialPath,
        metadataFinalPath
    );

    writeVoiceRecordingWorkerTrace("STOP_SESSION_DONE", {
        sessionId: session.sessionId,
        outputDirectory: session.outputDirectory,
        recordingPath: session.combinedFinalPath,
        metadataPath: metadataFinalPath,
        frameCount: session.frameCount,
        opusBytes: session.opusBytes
    });

    parentPort.postMessage({
        type: "ready",
        sessionId: session.sessionId,
        outputDirectory: session.outputDirectory,
        recordingPath: session.combinedFinalPath,
        metadataPath: metadataFinalPath,
        checksumSha256,
        frameCount: session.frameCount,
        opusBytes: session.opusBytes
    });

    session = null;
}

//* این تابع پیام‌های Worker را ترتیبی اجرا و خطا را به پردازش اصلی برمی‌گرداند.
function queueMessage(message) {
    if (message.type !== "frame") {
        writeVoiceRecordingWorkerTrace("QUEUE_MESSAGE_RECEIVED", {
            type: message.type,
            sessionId: message.sessionId ?? ""
        });
    }

    operationTail = operationTail.then(async () => {
        if (message.type === "start") {
            await startSession(message);
            return;
        }

        if (message.type === "frame") {
            await writeFrame(message);
            return;
        }

        if (message.type === "membership_updated") {
            await updateMembership(message);
            return;
        }

        if (message.type === "consent_updated") {
            await updateConsent(message);
            return;
        }

        if (message.type === "stop") {
            await stopSession(message);
            return;
        }

        throw new Error("Unknown Voice recording worker message.");
    }).catch((error) => {
        writeVoiceRecordingWorkerTrace("QUEUE_MESSAGE_FAILED", {
            type: message.type,
            sessionId: message.sessionId ?? session?.sessionId ?? "",
            error: error?.message ?? String(error),
            errorName: error?.name ?? "Error"
        });

        parentPort.postMessage({
            type: "failed",
            sessionId: message.sessionId ?? session?.sessionId ?? "",
            message: error?.message ?? String(error),
            errorName: error?.name ?? "Error"
        });
    });
}

parentPort.on("message", queueMessage);

/*
توضیح فایل:
این Worker تمام نوشتن‌های Ogg Opus، فایل مستقل هر عضو، نهایی‌سازی اتمیک Metadata و محاسبه SHA-256 را خارج از حلقه اصلی سرور انجام می‌دهد.
*/
