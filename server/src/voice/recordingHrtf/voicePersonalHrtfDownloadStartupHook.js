import http from "node:http";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tokenService } from "../../core/auth/auth.instance.js";
import { createGameServerControlAuthResolver } from "../../gameServerControl/auth/gameServerControlAuthResolver.js";
import { VoiceRecordingDownloadService, calculateRecordingFileChecksum } from "../recording/voiceRecordingDownloadService.js";
import { readVoiceDirectionalTimeline } from "../directional/voiceDirectionalRecordingTimeline.js";
import { buildDirectionalDownloadPlan } from "../directional/voiceDirectionalDownloadExtension.js";
import { ensureSessionSpatialTimeline } from "../recordingSpatial/voiceSpatialTimelineMaterializer.js";
import { VoicePersonalHrtfRecordingRenderer } from "./voicePersonalHrtfRecordingRenderer.js";

const PERSONAL_HRTF_PATH_PATTERN = /^\/voice\/recordings\/([0-9a-f-]{36})\/download\/personal-hrtf\/?$/i;
const defaultHost = "127.0.0.1";
const defaultPort = 51015;
const isolatedHttpEnabled = ["1", "true", "yes", "on"].includes(String(process.env.VOICE_PERSONAL_HRTF_ISOLATED_HTTP_ENABLED ?? "").trim().toLowerCase());
const runtimeKey = Symbol.for("network_a.voice.personal_hrtf_download.h6.isolated");
const creationByPath = new Map();

function cleanText(value) { return String(value ?? "").trim(); }
function readPort(value, fallback = defaultPort) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    return Number.isInteger(parsed) && parsed >= 1024 && parsed <= 65535 ? parsed : fallback;
}
function hashUserId(value) { return createHash("sha256").update(cleanText(value)).digest("hex").slice(0, 16); }
function stableDirectionalSignature(plan) {
    if (!plan) return [];
    return Array.from(plan.blockedIntervalsBySenderConnectionId?.entries?.() ?? [])
        .map(([connectionId, intervals]) => ({ connectionId, intervals }))
        .sort((a, b) => a.connectionId.localeCompare(b.connectionId));
}

function buildHrtfSignature({ metadata, listenerUserId, timelineStat, datasetStat, datasetPath, directionalPlan, authorizedIntervals }) {
    return createHash("sha256").update(JSON.stringify({
        version: directionalPlan?.hasBlockedIntervals ? 4 : 3, // Preserve unaffected cache; refresh blocked-route renders
        sessionId: metadata?.sessionId,
        listenerUserId: cleanText(listenerUserId),
        sourceChecksumSha256: metadata?.checksumSha256 ?? "",
        spatialTimelineSize: timelineStat?.size ?? 0,
        spatialTimelineMtimeMs: Math.floor(timelineStat?.mtimeMs ?? 0),
        hrtfDatasetPath: cleanText(datasetPath),
        hrtfDatasetSize: datasetStat?.size ?? 0,
        hrtfDatasetMtimeMs: Math.floor(datasetStat?.mtimeMs ?? 0),
        authorizedIntervals: authorizedIntervals ?? [],
        directional: stableDirectionalSignature(directionalPlan)
    })).digest("hex");
}

async function createPersonalHrtfDownload({ downloadService, baseDownload, sessionId, userId, datasetPath = process.env.VOICE_HRTF_DATASET_PATH || "" }) {
    const resolvedDatasetPath = cleanText(datasetPath);
    if (!resolvedDatasetPath) throw new Error("VOICE_HRTF_DATASET_PATH is required.");

    const sessionDirectory = dirname(baseDownload.metadataPath);
    const metadata = JSON.parse(await readFile(baseDownload.metadataPath, "utf8"));
    const normalizedUserId = cleanText(userId);
    const receiverMemberships = (Array.isArray(metadata?.participants) ? metadata.participants : [])
        .filter((participant) => cleanText(participant?.userId) === normalizedUserId);
    if (receiverMemberships.length === 0) {
        const error = new Error("Authenticated user is not a member of this Voice recording.");
        error.code = "VOICE_RECORDING_FORBIDDEN";
        throw error;
    }

    const events = await readVoiceDirectionalTimeline({ sessionDirectory, sessionId });
    const directionalPlan = buildDirectionalDownloadPlan({ metadata, receiverMemberships, events });

    // Preserve listener membership; mute denied sender tracks in place.
    const effectiveAuthorizedIntervals = baseDownload.authorizedIntervals;

    if (directionalPlan.hasBlockedIntervals) {
        console.log(
            `VOICE_PERSONAL_HRTF_DIRECTIONAL_SILENCE | sessionId=${sessionId}` +
            ` | listenerHash=${hashUserId(normalizedUserId)}` +
            ` | blockedIntervalsMs=${directionalPlan.blockedIntervalsForReceiver.map((interval) => `${interval.startOffsetMs}-${interval.endOffsetMs}`).join(",")}` +
            ` | timelineCutMs=0 | senderTrackIsolation=true`
        );
    }

    const materializedTimeline = await ensureSessionSpatialTimeline({
        storageRoot: downloadService.storageRoot,
        sessionDirectory,
        metadata
    });
    const timelineStat = await stat(materializedTimeline.path);
    const datasetStat = await stat(resolvedDatasetPath);
    if (!timelineStat.isFile() || !datasetStat.isFile()) throw new Error("HRTF input file is missing.");

    const signature = buildHrtfSignature({
        metadata,
        listenerUserId: normalizedUserId,
        timelineStat,
        datasetStat,
        datasetPath: resolvedDatasetPath,
        directionalPlan,
        authorizedIntervals: effectiveAuthorizedIntervals
    });
    const outputPath = join(sessionDirectory, "personal-hrtf", `${hashUserId(normalizedUserId)}-${signature.slice(0, 16)}.ogg`);

    let outputStat = null;
    let renderResult = null;
    try { outputStat = await stat(outputPath); } catch {}
    if (!outputStat?.isFile?.()) {
        let creation = creationByPath.get(outputPath);
        if (!creation) {
            const renderer = new VoicePersonalHrtfRecordingRenderer({
                storageRoot: downloadService.storageRoot,
                datasetPath: resolvedDatasetPath
            });
            creation = renderer.render({
                sessionId,
                listenerUserId: normalizedUserId,
                outputPath,
                speakerBlockedIntervalsByConnectionId: directionalPlan.blockedIntervalsBySenderConnectionId,
                authorizedIntervals: effectiveAuthorizedIntervals
            }).finally(() => creationByPath.delete(outputPath));
            creationByPath.set(outputPath, creation);
        }
        renderResult = await creation;
        outputStat = await stat(outputPath);
    }

    const checksumSha256 = await calculateRecordingFileChecksum(outputPath);
    return Object.freeze({
        ...baseDownload,
        recordingPath: outputPath,
        fileName: `voice-session-${sessionId}-personal-hrtf.ogg`,
        contentType: "audio/ogg",
        contentLength: outputStat.size,
        checksumSha256,
        downloadMode: "personal_hrtf_binaural",
        authorizedIntervals: effectiveAuthorizedIntervals,
        directionalBlockedIntervals: directionalPlan.blockedIntervalsForReceiver,
        renderResult
    });
}

function writeJson(response, statusCode, body) {
    const payload = Buffer.from(JSON.stringify(body));
    response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": payload.length,
        "Cache-Control": "no-store"
    });
    response.end(payload);
}

function createPersonalHrtfHttpHandler({ downloadService, resolveUserFromRequest, datasetPath = process.env.VOICE_HRTF_DATASET_PATH || "" }) {
    if (!downloadService?.resolveDownload) throw new TypeError("HRTF HTTP handler requires VoiceRecordingDownloadService.");
    if (typeof resolveUserFromRequest !== "function") throw new TypeError("HRTF HTTP handler requires auth resolver.");

    return async function personalHrtfHttpHandler(request, response) {
        const url = new URL(request.url ?? "/", "http://localhost");
        const match = PERSONAL_HRTF_PATH_PATTERN.exec(url.pathname);
        if (!match) return false;
        if (request.method !== "GET") {
            writeJson(response, 405, { success: false, reason: "method_not_allowed" });
            return true;
        }

        const user = await resolveUserFromRequest(request);
        if (!user?.userId) {
            writeJson(response, 401, { success: false, reason: "voice_recording_auth_required" });
            return true;
        }

        const sessionId = match[1].toLowerCase();
        try {
            const baseDownload = await downloadService.resolveDownload({ sessionId, userId: user.userId });
            const download = await createPersonalHrtfDownload({
                downloadService,
                baseDownload,
                sessionId,
                userId: user.userId,
                datasetPath
            });
            response.writeHead(200, {
                "Content-Type": download.contentType,
                "Content-Length": download.contentLength,
                "Content-Disposition": `attachment; filename="${download.fileName}"`,
                "X-Voice-Recording-SHA256": download.checksumSha256,
                "X-Voice-Recording-Download-Mode": download.downloadMode,
                "Cache-Control": "private, no-store"
            });
            createReadStream(download.recordingPath).pipe(response);
            console.log(`VOICE_PERSONAL_HRTF_DOWNLOAD=PASS | sessionId=${sessionId} | listenerHash=${hashUserId(user.userId)} | bytes=${download.contentLength}`);
        } catch (error) {
            const forbidden = error?.code === "VOICE_RECORDING_FORBIDDEN";
            writeJson(response, forbidden ? 403 : 404, {
                success: false,
                reason: forbidden ? "voice_recording_forbidden" : "voice_personal_hrtf_not_available"
            });
        }
        return true;
    };
}

async function startIsolatedPersonalHrtfDownloadRuntime({
    host = cleanText(process.env.VOICE_PERSONAL_HRTF_DOWNLOAD_HOST) || defaultHost,
    port = readPort(process.env.VOICE_PERSONAL_HRTF_DOWNLOAD_PORT),
    storageRoot = cleanText(process.env.METAVERSE_VOICE_RECORDING_STORAGE_ROOT),
    downloadService = null,
    resolveUserFromRequest = null,
    datasetPath = cleanText(process.env.VOICE_HRTF_DATASET_PATH)
} = {}) {
    if (!storageRoot && !downloadService) throw new Error("METAVERSE_VOICE_RECORDING_STORAGE_ROOT is required.");
    if (!datasetPath) throw new Error("VOICE_HRTF_DATASET_PATH is required.");
    const service = downloadService ?? new VoiceRecordingDownloadService({ storageRoot });
    const authResolver = resolveUserFromRequest ?? createGameServerControlAuthResolver({ tokenService, logger: console });
    const handler = createPersonalHrtfHttpHandler({ downloadService: service, resolveUserFromRequest: authResolver, datasetPath });
    const server = http.createServer((request, response) => {
        void handler(request, response).then((handled) => {
            if (!handled && !response.writableEnded) writeJson(response, 404, { success: false, reason: "not_found" });
        }).catch((error) => {
            console.error("VOICE_PERSONAL_HRTF_DOWNLOAD_HTTP=FAIL", error);
            if (!response.headersSent && !response.writableEnded) writeJson(response, 500, { success: false, reason: "voice_personal_hrtf_internal_error" });
        });
    });
    await new Promise((resolve, reject) => {
        const onError = (error) => { server.off("listening", onListening); reject(error); };
        const onListening = () => { server.off("error", onError); resolve(); };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, host);
    });
    console.log(`VOICE_PERSONAL_HRTF_DOWNLOAD_EXTENSION=READY | transport=isolated_loopback_http | host=${host} | port=${port} | route=/voice/recordings/{sessionId}/download/personal-hrtf | mainHttpPatched=False | existingSpatialDownloadChanged=False`);
    return Object.freeze({ host, port, server, async stop() { if (!server.listening) return; await new Promise((resolve) => server.close(resolve)); } });
}

if (isolatedHttpEnabled && !globalThis[runtimeKey]) {
    const runtimePromise = startIsolatedPersonalHrtfDownloadRuntime().then((runtime) => {
        globalThis[runtimeKey] = runtime;
        return runtime;
    }).catch((error) => {
        console.error(`VOICE_PERSONAL_HRTF_DOWNLOAD_EXTENSION=FAIL | existingVoiceUnaffected=True | error=${String(error?.message ?? error)}`);
        return null;
    });
    globalThis[runtimeKey] = runtimePromise;
}

export {
    PERSONAL_HRTF_PATH_PATTERN,
    buildHrtfSignature,
    createPersonalHrtfDownload,
    createPersonalHrtfHttpHandler,
    startIsolatedPersonalHrtfDownloadRuntime
};
