import http from "node:http";

import {
    createReadStream
} from "node:fs";

import {
    createHash
} from "node:crypto";

import {
    readFile,
    stat
} from "node:fs/promises";

import {
    dirname,
    join
} from "node:path";

import {
    tokenService
} from "../../core/auth/auth.instance.js";

import {
    createGameServerControlAuthResolver
} from "../../gameServerControl/auth/gameServerControlAuthResolver.js";

import {
    VoiceRecordingDownloadService,
    calculateRecordingFileChecksum
} from "../recording/voiceRecordingDownloadService.js";

import {
    readVoiceDirectionalTimeline
} from "../directional/voiceDirectionalRecordingTimeline.js";

import {
    buildDirectionalDownloadPlan
} from "../directional/voiceDirectionalDownloadExtension.js";

import {
    VoicePersonalSpatialRecordingRenderer
} from "./voicePersonalSpatialRecordingRenderer.js";

import {
    ensureSessionSpatialTimeline
} from "./voiceSpatialTimelineMaterializer.js";

const PERSONAL_SPATIAL_PATH_PATTERN =
    /^\/voice\/recordings\/([0-9a-f-]{36})\/download\/personal-spatial\/?$/i;

const defaultHost =
    "127.0.0.1";

const defaultPort =
    51014;

const enabled =
    ["1", "true", "yes", "on"].includes(
        String(
            process.env
                .VOICE_PERSONAL_SPATIAL_DOWNLOAD_ENABLED ??
                ""
        ).trim().toLowerCase()
    );

const runtimeKey =
    Symbol.for(
        "network_a.voice.personal_spatial_download.s6.isolated"
    );

const creationByPath =
    new Map();

function cleanText(
    value
) {
    return String(
        value ??
        ""
    ).trim();
}

function readPort(
    value,
    fallback = defaultPort
) {
    const parsed =
        Number.parseInt(
            String(
                value ?? ""
            ),
            10
        );

    return Number.isInteger(
        parsed
    ) &&
        parsed >= 1024 &&
        parsed <= 65535
        ? parsed
        : fallback;
}

function hashUserId(
    value
) {
    return createHash(
        "sha256"
    )
        .update(
            cleanText(
                value
            )
        )
        .digest(
            "hex"
        )
        .slice(
            0,
            16
        );
}

function stableDirectionalSignature(
    directionalPlan
) {
    if (
        !directionalPlan
    ) {
        return [];
    }

    return Array.from(
        directionalPlan
            .blockedIntervalsBySenderConnectionId
            ?.entries?.() ??
            []
    )
        .map(
            ([
                connectionId,
                intervals
            ]) => ({
                connectionId,
                intervals
            })
        )
        .sort(
            (
                left,
                right
            ) =>
                left.connectionId
                    .localeCompare(
                        right.connectionId
                    )
        );
}

function buildSpatialSignature({
    metadata,
    listenerUserId,
    timelineStat,
    directionalPlan,
    authorizedIntervals
}) {
    return createHash(
        "sha256"
    )
        .update(
            JSON.stringify({
                version:
                    2,
                sessionId:
                    metadata
                        ?.sessionId,
                listenerUserId:
                    cleanText(
                        listenerUserId
                    ),
                sourceChecksumSha256:
                    metadata
                        ?.checksumSha256 ??
                    "",
                spatialTimelineSize:
                    timelineStat
                        ?.size ??
                    0,
                spatialTimelineMtimeMs:
                    Math.floor(
                        timelineStat
                            ?.mtimeMs ??
                        0
                    ),
                authorizedIntervals:
                    authorizedIntervals ??
                    [],
                directional:
                    stableDirectionalSignature(
                        directionalPlan
                    )
            })
        )
        .digest(
            "hex"
        );
}

async function createPersonalSpatialDownload({
    downloadService,
    baseDownload,
    sessionId,
    userId
}) {
    const sessionDirectory =
        dirname(
            baseDownload
                .metadataPath
        );

    const metadata =
        JSON.parse(
            await readFile(
                baseDownload
                    .metadataPath,
                "utf8"
            )
        );

    const normalizedUserId =
        cleanText(
            userId
        );

    const receiverMemberships =
        (
            Array.isArray(
                metadata
                    ?.participants
            )
                ? metadata
                    .participants
                : []
        ).filter(
            (participant) =>
                cleanText(
                    participant
                        ?.userId
                ) ===
                normalizedUserId
        );

    if (
        receiverMemberships
            .length ===
        0
    ) {
        const error =
            new Error(
                "Authenticated user is not a member of this Voice recording."
            );

        error.code =
            "VOICE_RECORDING_FORBIDDEN";

        throw error;
    }

    const events =
        await readVoiceDirectionalTimeline({
            sessionDirectory,
            sessionId
        });

    const directionalPlan =
        buildDirectionalDownloadPlan({
            metadata,
            receiverMemberships,
            events
        });

    const materializedTimeline =
        await ensureSessionSpatialTimeline({
            storageRoot:
                downloadService
                    .storageRoot,
            sessionDirectory,
            metadata
        });

    const spatialTimelinePath =
        materializedTimeline
            .path;

    const timelineStat =
        await stat(
            spatialTimelinePath
        );

    if (
        !timelineStat
            .isFile()
    ) {
        throw new Error(
            "Spatial timeline path is not a file."
        );
    }

    const signature =
        buildSpatialSignature({
            metadata,
            listenerUserId:
                normalizedUserId,
            timelineStat,
            directionalPlan,
            authorizedIntervals:
                baseDownload
                    .authorizedIntervals
        });

    const outputPath =
        join(
            sessionDirectory,
            "personal-spatial",
            `${hashUserId(normalizedUserId)}-${signature.slice(0, 16)}.ogg`
        );

    let outputStat =
        null;

    try {
        outputStat =
            await stat(
                outputPath
            );
    } catch {
    }

    if (
        !outputStat
            ?.isFile?.()
    ) {
        let creation =
            creationByPath
                .get(
                    outputPath
                );

        if (
            !creation
        ) {
            const renderer =
                new VoicePersonalSpatialRecordingRenderer({
                    storageRoot:
                        downloadService
                            .storageRoot
                });

            creation =
                renderer.render({
                    sessionId,
                    listenerUserId:
                        normalizedUserId,
                    outputPath,
                    speakerBlockedIntervalsByConnectionId:
                        directionalPlan
                            .blockedIntervalsBySenderConnectionId,
                    authorizedIntervals:
                        baseDownload
                            .authorizedIntervals
                });

            creationByPath
                .set(
                    outputPath,
                    creation
                );
        }

        try {
            await creation;
        } finally {
            if (
                creationByPath
                    .get(
                        outputPath
                    ) ===
                creation
            ) {
                creationByPath
                    .delete(
                        outputPath
                    );
            }
        }

        outputStat =
            await stat(
                outputPath
            );
    }

    const checksumSha256 =
        await calculateRecordingFileChecksum(
            outputPath
        );

    return Object.freeze({
        ...baseDownload,
        recordingPath:
            outputPath,
        fileName:
            `voice-session-${sessionId}-personal-spatial.ogg`,
        contentType:
            "audio/ogg",
        contentLength:
            outputStat.size,
        checksumSha256,
        downloadMode:
            "personal_spatial_stereo",
        sourceChecksumSha256:
            baseDownload
                .sourceChecksumSha256 ??
            metadata
                ?.checksumSha256 ??
            null
    });
}

function writeJson(
    response,
    statusCode,
    body
) {
    const payload =
        Buffer.from(
            JSON.stringify(
                body
            ),
            "utf8"
        );

    response.writeHead(
        statusCode,
        {
            "Content-Type":
                "application/json; charset=utf-8",
            "Content-Length":
                payload.length,
            "Cache-Control":
                "no-store"
        }
    );

    response.end(
        payload
    );
}

function createPersonalSpatialHttpHandler({
    downloadService,
    resolveUserFromRequest
} = {}) {
    if (
        !downloadService ||
        typeof downloadService
                .resolveDownload !==
            "function"
    ) {
        throw new TypeError(
            "Personal Spatial downloadService is invalid."
        );
    }

    if (
        typeof resolveUserFromRequest !==
        "function"
    ) {
        throw new TypeError(
            "Personal Spatial auth resolver is invalid."
        );
    }

    return async function handlePersonalSpatialHttp(
        request,
        response
    ) {
        const parsed =
            new URL(
                String(
                    request?.url ??
                    "/"
                ),
                "http://127.0.0.1"
            );

        const match =
            PERSONAL_SPATIAL_PATH_PATTERN
                .exec(
                    parsed.pathname
                );

        if (
            !match
        ) {
            writeJson(
                response,
                404,
                {
                    success:
                        false,
                    reason:
                        "personal_spatial_route_not_found"
                }
            );

            return;
        }

        if (
            String(
                request.method ??
                "GET"
            ).toUpperCase() !==
            "GET"
        ) {
            writeJson(
                response,
                405,
                {
                    success:
                        false,
                    reason:
                        "voice_recording_method_not_allowed"
                }
            );

            return;
        }

        const user =
            await resolveUserFromRequest(
                request
            );

        if (
            !user?.userId
        ) {
            writeJson(
                response,
                401,
                {
                    success:
                        false,
                    reason:
                        "voice_recording_auth_required"
                }
            );

            return;
        }

        try {
            const baseDownload =
                await downloadService
                    .resolveDownload({
                        sessionId:
                            match[1],
                        userId:
                            user.userId
                    });

            const download =
                await createPersonalSpatialDownload({
                    downloadService,
                    baseDownload,
                    sessionId:
                        baseDownload
                            .sessionId,
                    userId:
                        user.userId
                });

            response.writeHead(
                200,
                {
                    "Content-Type":
                        download
                            .contentType,
                    "Content-Length":
                        download
                            .contentLength,
                    "Content-Disposition":
                        `attachment; filename="${download.fileName}"`,
                    "X-Content-Type-Options":
                        "nosniff",
                    "Cache-Control":
                        "private, no-store",
                    "X-Voice-Recording-SHA256":
                        download
                            .checksumSha256,
                    "X-Voice-Recording-Download-Mode":
                        download
                            .downloadMode
                }
            );

            const stream =
                createReadStream(
                    download
                        .recordingPath
                );

            stream.on(
                "error",
                (error) => {
                    response.destroy(
                        error
                    );
                }
            );

            stream.pipe(
                response
            );

            console.log(
                "VOICE_PERSONAL_SPATIAL_DOWNLOAD=PASS" +
                " | sessionId=" +
                baseDownload
                    .sessionId +
                " | listenerHash=" +
                hashUserId(
                    user.userId
                ) +
                " | bytes=" +
                download
                    .contentLength
            );
        } catch (error) {
            const forbidden =
                error?.code ===
                "VOICE_RECORDING_FORBIDDEN";

            writeJson(
                response,
                forbidden
                    ? 403
                    : 404,
                {
                    success:
                        false,
                    reason:
                        forbidden
                            ? "voice_recording_forbidden"
                            : "voice_personal_spatial_not_available"
                }
            );
        }
    };
}

async function startIsolatedPersonalSpatialDownloadRuntime({
    host =
        String(
            process.env
                .VOICE_PERSONAL_SPATIAL_DOWNLOAD_HOST ??
            defaultHost
        ).trim() ||
        defaultHost,
    port =
        readPort(
            process.env
                .VOICE_PERSONAL_SPATIAL_DOWNLOAD_PORT
        ),
    storageRoot =
        String(
            process.env
                .METAVERSE_VOICE_RECORDING_STORAGE_ROOT ??
            ""
        ).trim(),
    downloadService =
        null,
    resolveUserFromRequest =
        null
} = {}) {
    if (
        !storageRoot &&
        !downloadService
    ) {
        throw new Error(
            "METAVERSE_VOICE_RECORDING_STORAGE_ROOT is required."
        );
    }

    const service =
        downloadService ??
        new VoiceRecordingDownloadService({
            storageRoot
        });

    const authResolver =
        resolveUserFromRequest ??
        createGameServerControlAuthResolver({
            tokenService,
            logger:
                console
        });

    const handler =
        createPersonalSpatialHttpHandler({
            downloadService:
                service,
            resolveUserFromRequest:
                authResolver
        });

    const server =
        http.createServer(
            (
                request,
                response
            ) => {
                void handler(
                    request,
                    response
                ).catch(
                    (error) => {
                        console.error(
                            "VOICE_PERSONAL_SPATIAL_DOWNLOAD_HTTP=FAIL",
                            error
                        );

                        if (
                            !response.headersSent &&
                            !response.writableEnded
                        ) {
                            writeJson(
                                response,
                                500,
                                {
                                    success:
                                        false,
                                    reason:
                                        "voice_personal_spatial_internal_error"
                                }
                            );
                        }
                    }
                );
            }
        );

    await new Promise(
        (
            resolve,
            reject
        ) => {
            const onError =
                (error) => {
                    server.off(
                        "listening",
                        onListening
                    );

                    reject(
                        error
                    );
                };

            const onListening =
                () => {
                    server.off(
                        "error",
                        onError
                    );

                    resolve();
                };

            server.once(
                "error",
                onError
            );

            server.once(
                "listening",
                onListening
            );

            server.listen(
                port,
                host
            );
        }
    );

    console.log(
        "VOICE_PERSONAL_SPATIAL_DOWNLOAD_EXTENSION=READY" +
        " | transport=isolated_loopback_http" +
        " | host=" +
        host +
        " | port=" +
        port +
        " | route=/voice/recordings/{sessionId}/download/personal-spatial" +
        " | mainHttpPatched=False" +
        " | existingDownloadChanged=False" +
        " | liveVoiceChanged=False" +
        " | voiceRecordingPrototypePatched=False"
    );

    return Object.freeze({
        host,
        port,
        server,
        async stop() {
            if (
                !server.listening
            ) {
                return;
            }

            await new Promise(
                (resolve) =>
                    server.close(
                        () =>
                            resolve()
                    )
            );
        }
    });
}

if (
    enabled &&
    !globalThis[
        runtimeKey
    ]
) {
    const runtimePromise =
        startIsolatedPersonalSpatialDownloadRuntime()
            .then(
                (runtime) => {
                    globalThis[
                        runtimeKey
                    ] =
                        runtime;

                    return runtime;
                }
            )
            .catch(
                (error) => {
                    console.error(
                        "VOICE_PERSONAL_SPATIAL_DOWNLOAD_EXTENSION=FAIL" +
                        " | mainVoiceUnaffected=True" +
                        " | error=" +
                        String(
                            error?.message ??
                            error
                        )
                    );

                    return null;
                }
            );

    globalThis[
        runtimeKey
    ] =
        runtimePromise;
}

export {
    PERSONAL_SPATIAL_PATH_PATTERN,
    buildSpatialSignature,
    createPersonalSpatialDownload,
    createPersonalSpatialHttpHandler,
    startIsolatedPersonalSpatialDownloadRuntime
};
