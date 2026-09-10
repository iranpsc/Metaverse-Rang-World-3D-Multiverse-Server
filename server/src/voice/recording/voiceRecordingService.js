import {
    access,
    mkdir,
    readdir,
    rename
} from "node:fs/promises";

import {
    isAbsolute,
    join,
    resolve
} from "node:path";

import {
    Worker
} from "node:worker_threads";

import {
    VoiceRecordingState,
    VoiceRecordingStopReason,
    createVoiceRecordingPolicy
} from "./voiceRecordingConstants.js";

const VOICE_RECORDING_SESSION_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const VOICE_RECORDING_TRACE_FRAME_SAMPLE_LIMIT = 5;
const VOICE_RECORDING_TRACE_FRAME_SAMPLE_INTERVAL = 50;

function formatVoiceRecordingTraceValue(value) {
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

function writeVoiceRecordingTrace(marker, fields = {}) {
    try {
        const details = Object.entries(fields)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => `${key}=${formatVoiceRecordingTraceValue(value)}`)
            .join(" | ");

        console.log(
            `[G4_VOICE_RECORDING_TRACE] ${marker}${details ? ` | ${details}` : ""}`
        );
    } catch {
        console.log(`[G4_VOICE_RECORDING_TRACE] ${marker} | trace_format_failed=true`);
    }
}

function shouldLogVoiceRecordingFrameTrace(count) {
    return (
        count <= VOICE_RECORDING_TRACE_FRAME_SAMPLE_LIMIT ||
        count % VOICE_RECORDING_TRACE_FRAME_SAMPLE_INTERVAL === 0
    );
}

//* این تابع مسیر مطلق و محدود ریشه Bucket محلی ضبط را آماده می‌کند.
function normalizeVoiceRecordingRoot(value) {
    if (typeof value !== "string" || !value.trim()) {
        throw new TypeError(
            "Voice recording storage root is required."
        );
    }

    const normalized = resolve(value.trim());

    if (!isAbsolute(normalized)) {
        throw new Error(
            "Voice recording storage root must be absolute."
        );
    }

    return normalized;
}

//* این تابع Snapshot سشن را از نظر شناسه و حداقل دو عضو متفاوت بررسی می‌کند.
function normalizeRecordingSession(session) {
    if (
        !session ||
        !VOICE_RECORDING_SESSION_ID_PATTERN.test(
            String(session.sessionId ?? "")
        ) ||
        !Array.isArray(session.participants) ||
        session.participants.length < 2
    ) {
        throw new TypeError(
            "Voice recording requires a valid session snapshot with at least two members."
        );
    }

    const participants = session.participants.map(
        (participant) => Object.freeze({
            userId: String(participant.userId ?? "").trim(),
            connectionId:
                String(participant.connectionId ?? "")
                    .trim()
                    .toLowerCase()
        })
    );

    if (
        participants.some(
            (participant) =>
                !participant.userId ||
                !participant.connectionId
        ) ||
        new Set(
            participants.map(
                (participant) => participant.userId
            )
        ).size !== participants.length ||
        new Set(
            participants.map(
                (participant) => participant.connectionId
            )
        ).size !== participants.length
    ) {
        throw new Error(
            "Voice recording session participants are invalid."
        );
    }

    return Object.freeze({
        sessionId:
            String(session.sessionId).toLowerCase(),
        roomId:
            String(session.roomId ?? "").trim(),
        serverId:
            String(session.serverId ?? "").trim(),
        participants:
            Object.freeze(participants)
    });
}

class VoiceRecordingWorkerClient {
    //* این سازنده Worker ضبط یک Session و شمارنده فشار صف آن را آماده می‌کند.
    constructor({
        session,
        outputDirectory,
        policy,
        startedAtMs
    }) {
        this.session = session;
        this.outputDirectory = outputDirectory;
        this.policy = policy;
        this.startedAtMs = startedAtMs;
        this.pendingFrames = 0;
        this.started = false;
        this.stopped = false;
        this.failed = null;
        this.readyResult = null;
        this.waitersByType = new Map();
        this.queuedFrames = 0;
        this.frameWrittenMessages = 0;

        writeVoiceRecordingTrace("WORKER_CLIENT_CREATED", {
            sessionId: session.sessionId,
            outputDirectory,
            startedAtMs
        });

        this.worker = new Worker(
            new URL(
                "./voiceRecordingWorker.js",
                import.meta.url
            ),
            {
                type: "module"
            }
        );

        this.worker.on("message", (message) => {
            this.handleMessage(message);
        });

        this.worker.on("error", (error) => {
            writeVoiceRecordingTrace("WORKER_CLIENT_ERROR", {
                sessionId: this.session.sessionId,
                error: error?.message ?? String(error)
            });
            this.fail(error);
        });

        this.worker.on("exit", (code) => {
            writeVoiceRecordingTrace("WORKER_CLIENT_EXIT", {
                sessionId: this.session.sessionId,
                code,
                failed: Boolean(this.failed),
                ready: Boolean(this.readyResult)
            });
            if (
                code !== 0 &&
                !this.failed &&
                !this.readyResult
            ) {
                this.fail(
                    new Error(
                        `Voice recording worker exited with code ${code}.`
                    )
                );
            }
        });
    }

    //* این تابع پیام Worker را به شمارنده یا Promise منتظر مربوط متصل می‌کند.
    handleMessage(message) {
        if (message.type === "frame_written") {
            this.pendingFrames = Math.max(
                0,
                this.pendingFrames - 1
            );
            this.frameWrittenMessages += 1;
            if (shouldLogVoiceRecordingFrameTrace(this.frameWrittenMessages)) {
                writeVoiceRecordingTrace("WORKER_FRAME_WRITTEN", {
                    sessionId: this.session.sessionId,
                    frameWrittenMessages: this.frameWrittenMessages,
                    pendingFrames: this.pendingFrames
                });
            }
            return;
        }

        if (message.type === "failed") {
            writeVoiceRecordingTrace("WORKER_MESSAGE_FAILED", {
                sessionId: message.sessionId ?? this.session.sessionId,
                message: message.message ?? "",
                errorName: message.errorName ?? ""
            });
            this.fail(
                new Error(message.message)
            );
            return;
        }

        if (message.type === "started") {
            this.started = true;
            writeVoiceRecordingTrace("WORKER_STARTED", {
                sessionId: this.session.sessionId,
                outputDirectory: this.outputDirectory
            });
        }

        if (message.type === "ready") {
            this.readyResult =
                Object.freeze({ ...message });
            writeVoiceRecordingTrace("WORKER_READY", {
                sessionId: this.session.sessionId,
                recordingPath: message.recordingPath,
                metadataPath: message.metadataPath,
                frameCount: message.frameCount,
                opusBytes: message.opusBytes
            });
        }

        const waiter =
            this.waitersByType.get(message.type);

        if (waiter) {
            this.waitersByType.delete(message.type);
            waiter.resolve(message);
        }
    }

    //* این تابع خطای Worker را روی تمام انتظارهای جاری منتشر می‌کند.
    fail(error) {
        if (this.failed) return;
        this.failed = error;

        writeVoiceRecordingTrace("WORKER_CLIENT_FAILED", {
            sessionId: this.session.sessionId,
            error: error?.message ?? String(error)
        });

        for (const waiter of this.waitersByType.values()) {
            waiter.reject(error);
        }

        this.waitersByType.clear();
    }

    //* این تابع برای یک نوع پیام نهایی Worker یک Promise می‌سازد.
    waitFor(type) {
        if (this.failed) {
            return Promise.reject(this.failed);
        }

        return new Promise((resolvePromise, rejectPromise) => {
            this.waitersByType.set(type, {
                resolve: resolvePromise,
                reject: rejectPromise
            });
        });
    }

    //* این تابع Worker را با اعضای رضایت‌داده‌شده آغاز می‌کند.
    async start(participants) {
        const started = this.waitFor("started");

        writeVoiceRecordingTrace("WORKER_START_POSTED", {
            sessionId: this.session.sessionId,
            participantCount: participants.length,
            outputDirectory: this.outputDirectory
        });

        this.worker.postMessage({
            type: "start",
            sessionId: this.session.sessionId,
            roomId: this.session.roomId,
            serverId: this.session.serverId,
            outputDirectory: this.outputDirectory,
            startedAtMs: this.startedAtMs,
            participants
        });

        await started;

        writeVoiceRecordingTrace("WORKER_START_CONFIRMED", {
            sessionId: this.session.sessionId
        });
    }

    //* این تابع تغییر عضویت را بدون بستن Worker به صف ترتیبی آن می‌فرستد.
    updateMembership({
        participant,
        active,
        effectiveAtMs
    }) {
        if (!this.started || this.stopped || this.failed) {
            return false;
        }

        this.worker.postMessage({
            type: "membership_updated",
            sessionId: this.session.sessionId,
            participant,
            active,
            effectiveAtMs
        });

        return true;
    }

    //* این تابع تغییر رضایت همان Sender را بدون توقف ضبط Session به Worker می‌رساند.
    updateParticipantConsent({
        connectionId,
        consented,
        changedAtMs
    }) {
        if (!this.started || this.stopped || this.failed) {
            return false;
        }

        this.worker.postMessage({
            type: "consent_updated",
            sessionId: this.session.sessionId,
            connectionId,
            consented,
            changedAtMs
        });

        return true;
    }

    //* این تابع یک کپی محدود از فریم اوپوس را همراه زمان Capture به Worker ارسال می‌کند.
    writeFrame(connectionId, payload, capturedAtMs) {
        if (!this.started || this.stopped || this.failed) {
            writeVoiceRecordingTrace("WORKER_WRITE_REJECTED", {
                sessionId: this.session.sessionId,
                connectionId,
                reason: "worker_not_writable",
                started: this.started,
                stopped: this.stopped,
                failed: Boolean(this.failed)
            });
            return false;
        }

        if (
            this.pendingFrames >=
            this.policy.maximumPendingFrames
        ) {
            writeVoiceRecordingTrace("WORKER_WRITE_REJECTED", {
                sessionId: this.session.sessionId,
                connectionId,
                reason: "pending_frame_limit",
                pendingFrames: this.pendingFrames,
                maximumPendingFrames: this.policy.maximumPendingFrames
            });
            throw new Error(
                "Voice recording worker queue exceeded its frame limit."
            );
        }

        if (
            !Buffer.isBuffer(payload) ||
            payload.length === 0 ||
            payload.length >
                this.policy.maximumOpusFrameBytes
        ) {
            writeVoiceRecordingTrace("WORKER_WRITE_REJECTED", {
                sessionId: this.session.sessionId,
                connectionId,
                reason: "invalid_opus_frame_size",
                payloadBytes: Buffer.isBuffer(payload) ? payload.length : -1,
                maximumOpusFrameBytes: this.policy.maximumOpusFrameBytes
            });
            throw new RangeError(
                "Voice recording Opus frame size is invalid."
            );
        }

        this.pendingFrames += 1;
        this.queuedFrames += 1;

        if (shouldLogVoiceRecordingFrameTrace(this.queuedFrames)) {
            writeVoiceRecordingTrace("WORKER_FRAME_QUEUED", {
                sessionId: this.session.sessionId,
                connectionId,
                queuedFrames: this.queuedFrames,
                pendingFrames: this.pendingFrames,
                payloadBytes: payload.length
            });
        }

        this.worker.postMessage({
            type: "frame",
            sessionId: this.session.sessionId,
            connectionId,
            capturedAtMs,
            payload: Buffer.from(payload)
        });

        return true;
    }

    //* این تابع ضبط را نهایی و نتیجه Metadata/Checksum را دریافت می‌کند.
    async stop({ endedAtMs, stopReason }) {
        if (this.readyResult) return this.readyResult;
        if (this.stopped) return this.waitFor("ready");

        this.stopped = true;
        const ready = this.waitFor("ready");

        writeVoiceRecordingTrace("WORKER_STOP_POSTED", {
            sessionId: this.session.sessionId,
            endedAtMs,
            stopReason
        });

        this.worker.postMessage({
            type: "stop",
            sessionId: this.session.sessionId,
            roomId: this.session.roomId,
            serverId: this.session.serverId,
            endedAtMs,
            stopReason
        });

        const result = await ready;
        await this.worker.terminate();
        writeVoiceRecordingTrace("WORKER_STOP_CONFIRMED", {
            sessionId: this.session.sessionId,
            recordingPath: result.recordingPath,
            frameCount: result.frameCount,
            opusBytes: result.opusBytes
        });
        return Object.freeze({ ...result });
    }
}

class VoiceRecordingService {
    //* این سازنده Bucket محلی محدود و وضعیت رضایت/Worker هر Session را آماده می‌کند.
    constructor({
        storageRoot,
        policy = {},
        now = () => Date.now()
    } = {}) {
        if (typeof now !== "function") {
            throw new TypeError("now must be a function.");
        }

        this.storageRoot =
            normalizeVoiceRecordingRoot(storageRoot);
        this.policy =
            createVoiceRecordingPolicy(policy);
        this.now = now;
        this.recordsBySessionId = new Map();
        this.completedBySessionId = new Map();
        this.recordedFrames = 0;
        this.recordedBytes = 0;
        this.failedRecordings = 0;
        this.recoveredCompletedRecordings = 0;
        this.quarantinedInterruptedRecordings = 0;
        this.initializationPromise = null;

        writeVoiceRecordingTrace("SERVICE_CREATED", {
            storageRoot: this.storageRoot
        });
    }

    //* این تابع Bucket را می‌سازد و پوشه‌های ناقص باقی‌مانده از Crash را بدون حذف قرنطینه می‌کند.
    async initializeStorage() {
        if (this.initializationPromise) return this.initializationPromise;

        this.initializationPromise = (async () => {
            writeVoiceRecordingTrace("STORAGE_INITIALIZE_START", {
                storageRoot: this.storageRoot
            });

            await mkdir(this.storageRoot, { recursive: true });
            const entries = await readdir(this.storageRoot, { withFileTypes: true });

            for (const entry of entries) {
                if (!entry.isDirectory() || !VOICE_RECORDING_SESSION_ID_PATTERN.test(entry.name)) continue;

                const sessionDirectory = join(this.storageRoot, entry.name);
                const hasFinalRecording = await this.pathExists(join(sessionDirectory, "session.ogg"));
                const hasFinalMetadata = await this.pathExists(join(sessionDirectory, "session.json"));

                if (hasFinalRecording && hasFinalMetadata) {
                    this.recoveredCompletedRecordings += 1;
                    continue;
                }

                const quarantineName = `${entry.name}.interrupted.${this.now()}`;
                writeVoiceRecordingTrace("STORAGE_INTERRUPTED_QUARANTINE", {
                    sessionId: entry.name,
                    quarantineName
                });
                await rename(sessionDirectory, join(this.storageRoot, quarantineName));
                this.quarantinedInterruptedRecordings += 1;
            }

            const result = Object.freeze({
                storageRoot: this.storageRoot,
                recoveredCompletedRecordings: this.recoveredCompletedRecordings,
                quarantinedInterruptedRecordings: this.quarantinedInterruptedRecordings
            });

            writeVoiceRecordingTrace("STORAGE_INITIALIZE_DONE", result);

            return result;
        })();

        return this.initializationPromise;
    }

    //* این تابع وجود فایل را بدون افشای جزئیات خطای فایل‌سیستم بررسی می‌کند.
    async pathExists(path) {
        try {
            await access(path);
            return true;
        } catch {
            return false;
        }
    }

    //* این تابع Session را برای جمع‌آوری رضایت ثبت یا همان وضعیت موجود را برمی‌گرداند.
    registerSession(inputSession) {
        const session =
            normalizeRecordingSession(inputSession);

        let record =
            this.recordsBySessionId.get(
                session.sessionId
            );

        if (record) {
            this.applySessionMembershipSnapshot(
                record,
                session,
                this.now()
            );

            writeVoiceRecordingTrace("REGISTER_SESSION_EXISTING", {
                sessionId: session.sessionId,
                state: record.state,
                participantCount: session.participants.length
            });
            return record;
        }

        record = {
            session,
            state:
                VoiceRecordingState.WAITING_CONSENT,
            consentsByConnectionId:
                new Map(
                    session.participants.map(
                        (participant) => [
                            participant.connectionId,
                            {
                                consented: false,
                                changedAtMs: null
                            }
                        ]
                    )
                ),
            workerClient: null,
            startPromise: null,
            finalizePromise: null,
            startedAtMs: null,
            endedAtMs: null,
            result: null,
            captureTraceFrames: 0
        };

        writeVoiceRecordingTrace("REGISTER_SESSION_NEW", {
            sessionId: session.sessionId,
            roomId: session.roomId,
            serverId: session.serverId,
            participantCount: session.participants.length
        });

        this.recordsBySessionId.set(
            session.sessionId,
            record
        );

        return record;
    }

    //* این تابع Snapshot تازه را روی اعضای فعال ضبط اعمال می‌کند و Worker را باز نگه می‌دارد.
    applySessionMembershipSnapshot(
        record,
        session,
        effectiveAtMs
    ) {
        if (
            record.session.roomId !== session.roomId ||
            record.session.serverId !== session.serverId
        ) {
            throw new Error(
                "Voice recording session room and server cannot change."
            );
        }

        const previousByConnectionId =
            new Map(
                record.session.participants.map(
                    (participant) => [
                        participant.connectionId,
                        participant
                    ]
                )
            );

        const nextByConnectionId =
            new Map(
                session.participants.map(
                    (participant) => [
                        participant.connectionId,
                        participant
                    ]
                )
            );

        const leftParticipants = [];
        const joinedParticipants = [];

        for (const previousParticipant of previousByConnectionId.values()) {
            const nextParticipant =
                nextByConnectionId.get(
                    previousParticipant.connectionId
                );

            if (!nextParticipant) {
                leftParticipants.push(previousParticipant);
                continue;
            }

            if (
                nextParticipant.userId !==
                previousParticipant.userId
            ) {
                throw new Error(
                    "Voice recording connection ownership cannot change inside a session."
                );
            }
        }

        for (const nextParticipant of nextByConnectionId.values()) {
            if (
                !previousByConnectionId.has(
                    nextParticipant.connectionId
                )
            ) {
                joinedParticipants.push(nextParticipant);
            }
        }

        for (const participant of leftParticipants) {
            record.consentsByConnectionId.delete(
                participant.connectionId
            );

            record.workerClient?.updateMembership({
                participant,
                active: false,
                effectiveAtMs
            });
        }

        for (const participant of joinedParticipants) {
            record.consentsByConnectionId.set(
                participant.connectionId,
                {
                    consented: false,
                    changedAtMs: null
                }
            );

            record.workerClient?.updateMembership({
                participant: {
                    ...participant,
                    consentedAtMs: null
                },
                active: true,
                effectiveAtMs
            });
        }

        record.session = session;

        if (
            leftParticipants.length > 0 ||
            joinedParticipants.length > 0
        ) {
            writeVoiceRecordingTrace("SESSION_MEMBERSHIP_SYNCHRONIZED", {
                sessionId: session.sessionId,
                effectiveAtMs,
                joinedCount: joinedParticipants.length,
                leftCount: leftParticipants.length,
                activeParticipantCount: session.participants.length,
                state: record.state
            });
        }

        return record;
    }

    //* این تابع عمومی تغییر عضویت Group را بدون ساخت فایل یا SessionId تازه همگام می‌کند.
    synchronizeSessionMembership(
        inputSession,
        {
            effectiveAtMs = this.now()
        } = {}
    ) {
        const session =
            normalizeRecordingSession(inputSession);

        const record =
            this.recordsBySessionId.get(
                session.sessionId
            );

        if (!record) {
            this.registerSession(session);
            return this.getSnapshot(session.sessionId);
        }

        this.applySessionMembershipSnapshot(
            record,
            session,
            effectiveAtMs
        );

        return this.getSnapshot(session.sessionId);
    }

    //* این تابع رضایت همان Sender را اعمال می‌کند؛ ضبط Session با اولین Sender رضایت‌داده‌شده شروع و با لغو یک Sender متوقف نمی‌شود.
    async updateConsent({
        session,
        connectionId,
        consented,
        changedAtMs = this.now()
    } = {}) {
        writeVoiceRecordingTrace("UPDATE_CONSENT_RECEIVED", {
            sessionId: session?.sessionId ?? "",
            connectionId,
            consented,
            changedAtMs
        });

        if (typeof consented !== "boolean") {
            writeVoiceRecordingTrace("UPDATE_CONSENT_REJECTED", {
                sessionId: session?.sessionId ?? "",
                connectionId,
                reason: "consented_not_boolean"
            });
            throw new TypeError("consented must be a boolean.");
        }

        const record = this.registerSession(session);
        const normalizedConnectionId =
            String(connectionId ?? "")
                .trim()
                .toLowerCase();
        const participantConsent =
            record.consentsByConnectionId.get(
                normalizedConnectionId
            );

        if (!participantConsent) {
            writeVoiceRecordingTrace("UPDATE_CONSENT_REJECTED", {
                sessionId: record.session.sessionId,
                connectionId,
                reason: "connection_not_session_member"
            });
            throw new Error(
                "Voice recording consent connection is not a session member."
            );
        }

        participantConsent.consented = consented;
        participantConsent.changedAtMs = changedAtMs;

        writeVoiceRecordingTrace("UPDATE_CONSENT_APPLIED", {
            sessionId: record.session.sessionId,
            connectionId: normalizedConnectionId,
            consented,
            state: record.state
        });

        if (
            consented === true &&
            record.state ===
                VoiceRecordingState.WAITING_CONSENT
        ) {
            if (!record.startPromise) {
                writeVoiceRecordingTrace("FIRST_CONSENT_STARTING_RECORDING", {
                    sessionId: record.session.sessionId,
                    connectionId: normalizedConnectionId
                });

                record.startPromise =
                    this.startRecording(record)
                        .finally(() => {
                            record.startPromise = null;
                        });
            } else {
                writeVoiceRecordingTrace("START_RECORDING_JOIN_EXISTING", {
                    sessionId: record.session.sessionId,
                    connectionId: normalizedConnectionId
                });
            }

            await record.startPromise;

            if (
                record.state ===
                    VoiceRecordingState.RECORDING
            ) {
                record.workerClient?.updateParticipantConsent({
                    connectionId: normalizedConnectionId,
                    consented: participantConsent.consented,
                    changedAtMs: participantConsent.changedAtMs
                });
            }
        } else if (
            record.state ===
                VoiceRecordingState.RECORDING
        ) {
            record.workerClient?.updateParticipantConsent({
                connectionId: normalizedConnectionId,
                consented,
                changedAtMs
            });

            if (consented === false) {
                writeVoiceRecordingTrace("SENDER_CONSENT_REVOKED_CAPTURE_DISABLED", {
                    sessionId: record.session.sessionId,
                    connectionId: normalizedConnectionId
                });
            } else {
                writeVoiceRecordingTrace("SENDER_CONSENT_GRANTED_CAPTURE_ENABLED", {
                    sessionId: record.session.sessionId,
                    connectionId: normalizedConnectionId
                });
            }
        }

        const consentValues =
            Array.from(
                record.consentsByConnectionId.values()
            );
        const consentedCount =
            consentValues.filter(
                (consent) => consent.consented
            ).length;

        writeVoiceRecordingTrace("UPDATE_CONSENT_STATE", {
            sessionId: record.session.sessionId,
            connectionId: normalizedConnectionId,
            consentedCount,
            participantCount: record.consentsByConnectionId.size,
            state: record.state
        });

        const snapshot = this.getSnapshot(
            record.session.sessionId
        );

        writeVoiceRecordingTrace("UPDATE_CONSENT_DONE", {
            sessionId: record.session.sessionId,
            state: snapshot?.state ?? "null",
            startedAtMs: snapshot?.startedAtMs ?? null
        });

        return snapshot;
    }

    //* این تابع Worker ضبط را با مسیر یکتای Session و زمان رضایت اعضای فعال آغاز می‌کند.
    async startRecording(record) {
        const startedAtMs = this.now();
        const outputDirectory = join(
            this.storageRoot,
            record.session.sessionId
        );

        writeVoiceRecordingTrace("START_RECORDING_BEGIN", {
            sessionId: record.session.sessionId,
            outputDirectory,
            startedAtMs
        });

        const workerClient =
            new VoiceRecordingWorkerClient({
                session: record.session,
                outputDirectory,
                policy: this.policy,
                startedAtMs
            });

        const participants =
            record.session.participants.map(
                (participant) => {
                    const consent =
                        record.consentsByConnectionId
                            .get(participant.connectionId);

                    return {
                        ...participant,
                        consented:
                            consent?.consented === true,
                        consentedAtMs:
                            consent?.consented === true
                                ? consent.changedAtMs
                                : null,
                        joinedAtMs:
                            startedAtMs
                    };
                }
            );

        await workerClient.start(participants);

        record.workerClient = workerClient;
        record.startedAtMs = startedAtMs;
        record.state = VoiceRecordingState.RECORDING;

        writeVoiceRecordingTrace("START_RECORDING_DONE", {
            sessionId: record.session.sessionId,
            state: record.state,
            participantCount: participants.length
        });
    }

    //* این تابع فریم همان عضو را فقط برای Session در حال ضبط به Worker می‌فرستد.
    captureFrame({
        session,
        publisherConnectionId,
        payload
    } = {}) {
        const record =
            this.recordsBySessionId.get(
                String(session?.sessionId ?? "")
                    .trim()
                    .toLowerCase()
            );

        if (!record) {
            writeVoiceRecordingTrace("CAPTURE_FRAME_REJECTED", {
                sessionId: session?.sessionId ?? "",
                publisherConnectionId,
                reason: "record_not_found",
                payloadBytes: Buffer.isBuffer(payload) ? payload.length : -1
            });
            return false;
        }

        if (
            record.state !==
                VoiceRecordingState.RECORDING
        ) {
            writeVoiceRecordingTrace("CAPTURE_FRAME_REJECTED", {
                sessionId: record.session.sessionId,
                publisherConnectionId,
                reason: "record_not_recording",
                state: record.state,
                payloadBytes: Buffer.isBuffer(payload) ? payload.length : -1
            });
            return false;
        }

        const normalizedPublisherConnectionId =
            String(publisherConnectionId ?? "")
                .trim()
                .toLowerCase();

        const publisherConsent =
            record.consentsByConnectionId.get(
                normalizedPublisherConnectionId
            );

        if (!publisherConsent) {
            writeVoiceRecordingTrace("CAPTURE_FRAME_REJECTED", {
                sessionId: record.session.sessionId,
                publisherConnectionId:
                    normalizedPublisherConnectionId,
                reason: "publisher_not_active_session_member"
            });
            return false;
        }

        if (!publisherConsent.consented) {
            writeVoiceRecordingTrace("CAPTURE_FRAME_REJECTED", {
                sessionId: record.session.sessionId,
                publisherConnectionId:
                    normalizedPublisherConnectionId,
                reason: "publisher_consent_revoked"
            });
            return false;
        }

        if (
            this.now() - record.startedAtMs >
            this.policy.maximumSessionDurationMs
        ) {
            writeVoiceRecordingTrace("CAPTURE_FRAME_REJECTED", {
                sessionId: record.session.sessionId,
                publisherConnectionId,
                reason: "maximum_session_duration",
                startedAtMs: record.startedAtMs,
                maximumSessionDurationMs: this.policy.maximumSessionDurationMs
            });
            void this.finalizeSession(
                record.session.sessionId,
                VoiceRecordingStopReason.SESSION_CLOSED
            );
            return false;
        }

        try {
            const accepted =
                record.workerClient.writeFrame(
                    normalizedPublisherConnectionId,
                    payload,
                    this.now()
                );

            if (accepted) {
                this.recordedFrames += 1;
                this.recordedBytes += payload.length;
                record.captureTraceFrames += 1;

                if (shouldLogVoiceRecordingFrameTrace(record.captureTraceFrames)) {
                    writeVoiceRecordingTrace("CAPTURE_FRAME_ACCEPTED", {
                        sessionId: record.session.sessionId,
                        publisherConnectionId: normalizedPublisherConnectionId,
                        captureTraceFrames: record.captureTraceFrames,
                        recordedFrames: this.recordedFrames,
                        payloadBytes: payload.length
                    });
                }
            } else {
                writeVoiceRecordingTrace("CAPTURE_FRAME_REJECTED", {
                    sessionId: record.session.sessionId,
                    publisherConnectionId: normalizedPublisherConnectionId,
                    reason: "worker_write_false",
                    payloadBytes: Buffer.isBuffer(payload) ? payload.length : -1
                });
            }

            return accepted;
        } catch (error) {
            writeVoiceRecordingTrace("CAPTURE_FRAME_FAILED", {
                sessionId: record.session.sessionId,
                publisherConnectionId,
                error: error?.message ?? String(error)
            });
            record.state = VoiceRecordingState.FAILED;
            this.failedRecordings += 1;
            void record.workerClient.worker.terminate();
            throw error;
        }
    }

    //* این تابع ضبط Session را اتمیک نهایی و نتیجه آماده دانلود را نگه می‌دارد.
    async finalizeSession(
        sessionId,
        stopReason =
            VoiceRecordingStopReason.SESSION_CLOSED
    ) {
        const normalizedSessionId =
            String(sessionId ?? "")
                .trim()
                .toLowerCase();

        writeVoiceRecordingTrace("FINALIZE_SESSION_REQUESTED", {
            sessionId: normalizedSessionId,
            stopReason
        });

        const record =
            this.recordsBySessionId.get(
                normalizedSessionId
            );

        if (!record) {
            writeVoiceRecordingTrace("FINALIZE_SESSION_SKIPPED", {
                sessionId: normalizedSessionId,
                reason: "record_not_found"
            });
            return null;
        }

        if (record.startPromise) {
            writeVoiceRecordingTrace("FINALIZE_SESSION_WAITING_FOR_START", {
                sessionId: normalizedSessionId
            });
            await record.startPromise;
        }

        if (record.state === VoiceRecordingState.READY) {
            writeVoiceRecordingTrace("FINALIZE_SESSION_SKIPPED", {
                sessionId: normalizedSessionId,
                reason: "already_ready"
            });
            return record.result;
        }

        if (
            record.state ===
            VoiceRecordingState.FINALIZING
        ) {
            writeVoiceRecordingTrace("FINALIZE_SESSION_WAITING_EXISTING", {
                sessionId: normalizedSessionId
            });
            return record.finalizePromise;
        }

        if (
            record.state !==
            VoiceRecordingState.RECORDING
        ) {
            writeVoiceRecordingTrace("FINALIZE_SESSION_DECLINED", {
                sessionId: normalizedSessionId,
                previousState: record.state
            });
            record.state = VoiceRecordingState.DECLINED;
            record.endedAtMs = this.now();
            return this.getSnapshot(normalizedSessionId);
        }

        record.state = VoiceRecordingState.FINALIZING;
        record.endedAtMs = this.now();

        writeVoiceRecordingTrace("FINALIZE_SESSION_STARTED", {
            sessionId: normalizedSessionId,
            endedAtMs: record.endedAtMs,
            stopReason
        });

        record.finalizePromise =
            record.workerClient.stop({
                    endedAtMs: record.endedAtMs,
                    stopReason
                })
                .then((result) => {
                    record.result = result;
                    record.state =
                        VoiceRecordingState.READY;
                    this.completedBySessionId.set(
                        normalizedSessionId,
                        result
                    );
                    writeVoiceRecordingTrace("FINALIZE_SESSION_READY", {
                        sessionId: normalizedSessionId,
                        recordingPath: result.recordingPath,
                        metadataPath: result.metadataPath,
                        frameCount: result.frameCount,
                        opusBytes: result.opusBytes
                    });
                    return result;
                })
                .catch((error) => {
                    record.state =
                        VoiceRecordingState.FAILED;
                    this.failedRecordings += 1;
                    writeVoiceRecordingTrace("FINALIZE_SESSION_FAILED", {
                        sessionId: normalizedSessionId,
                        error: error?.message ?? String(error)
                    });
                    throw error;
                });

        return record.finalizePromise;
    }

    //* این تابع تمام Sessionهای یک Dedicated Server را هنگام پاک‌سازی نهایی می‌کند.
    async finalizeByServerId(
        serverId,
        stopReason =
            VoiceRecordingStopReason.SERVER_SHUTDOWN
    ) {
        const results = [];

        for (const record of this.recordsBySessionId.values()) {
            if (
                record.session.serverId === serverId &&
                record.state === VoiceRecordingState.RECORDING
            ) {
                results.push(
                    await this.finalizeSession(
                        record.session.sessionId,
                        stopReason
                    )
                );
            }
        }

        return Object.freeze(results);
    }

    //* این تابع همه ضبط‌های فعال را هنگام خاموش‌شدن امن نهایی می‌کند.
    async finalizeAll(
        stopReason = VoiceRecordingStopReason.SERVER_SHUTDOWN
    ) {
        const results = [];
        for (const record of this.recordsBySessionId.values()) {
            if (record.state === VoiceRecordingState.RECORDING) {
                results.push(await this.finalizeSession(record.session.sessionId, stopReason));
            }
        }
        return Object.freeze(results);
    }

    //* این تابع اطلاعات خواندنی رضایت و وضعیت یک Session را برمی‌گرداند.
    getSnapshot(sessionId) {
        const record =
            this.recordsBySessionId.get(
                String(sessionId ?? "")
                    .trim()
                    .toLowerCase()
            );

        if (!record) return null;

        return Object.freeze({
            sessionId: record.session.sessionId,
            state: record.state,
            startedAtMs: record.startedAtMs,
            endedAtMs: record.endedAtMs,
            consents:
                Object.freeze(
                    Object.fromEntries(
                        Array.from(
                            record.consentsByConnectionId,
                            ([connectionId, value]) => [
                                connectionId,
                                Object.freeze({ ...value })
                            ]
                        )
                    )
                ),
            result: record.result
        });
    }

    //* این تابع آمار ضبط را بدون داده صوتی یا شناسه توکن برمی‌گرداند.
    getStats() {
        const byState = {};

        for (const state of Object.values(VoiceRecordingState)) {
            byState[state] = 0;
        }

        for (const record of this.recordsBySessionId.values()) {
            byState[record.state] += 1;
        }

        return Object.freeze({
            trackedSessions: this.recordsBySessionId.size,
            completedRecordings: this.completedBySessionId.size,
            recordedFrames: this.recordedFrames,
            recordedBytes: this.recordedBytes,
            failedRecordings: this.failedRecordings,
            recoveredCompletedRecordings: this.recoveredCompletedRecordings,
            quarantinedInterruptedRecordings: this.quarantinedInterruptedRecordings,
            byState: Object.freeze(byState)
        });
    }
}

export {
    VoiceRecordingService,
    normalizeRecordingSession,
    normalizeVoiceRecordingRoot
};

/*
توضیح فایل:
این فایل رضایت ضبط را به‌صورت مستقل برای هر Sender مدیریت می‌کند، Worker را با اولین رضایت آغاز می‌کند، فقط فریم Sender رضایت‌داده‌شده را ثبت و فایل نهایی قابل دانلود را نگه می‌دارد.
*/
