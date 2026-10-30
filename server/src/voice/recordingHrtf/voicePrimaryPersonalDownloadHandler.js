import {
    createReadStream
} from "node:fs";

const PRIMARY_DOWNLOAD_PATH_PATTERN =
    /^\/voice\/recordings\/([0-9a-f-]{36})\/download\/?$/i;

function cleanText(value) {
    return String(value ?? "").trim();
}

function writeDownloadResponse(
    response,
    download,
    renderer
) {
    response.writeHead(200, {
        "Content-Type":
            download.contentType,
        "Content-Length":
            download.contentLength,
        "Content-Disposition":
            `attachment; filename="${download.fileName}"`,
        "X-Content-Type-Options":
            "nosniff",
        "Cache-Control":
            "private, no-store",
        "X-Voice-Recording-SHA256":
            download.checksumSha256,
        "X-Voice-Recording-Download-Mode":
            download.downloadMode,
        "X-Voice-Recording-Interval-Count":
            String(
                download.authorizedIntervals
                    ?.length ?? 0
            ),
        "X-Voice-Recording-Primary-Renderer":
            renderer
    });

    const stream =
        createReadStream(
            download.recordingPath
        );

    stream.on(
        "error",
        (error) => {
            response.destroy(error);
        }
    );

    stream.pipe(response);
}

function createVoicePrimaryPersonalDownloadHandler({
    downloadService,
    resolveUserFromRequest,
    datasetPath = "",
    spatialFallbackEnabled = true,
    logger = null,
    createHrtfDownload,
    createSpatialDownload
} = {}) {
    if (
        !downloadService ||
        typeof downloadService.resolveDownload !== "function"
    ) {
        throw new TypeError(
            "Primary HRTF download handler requires VoiceRecordingDownloadService."
        );
    }

    if (
        typeof resolveUserFromRequest !== "function"
    ) {
        throw new TypeError(
            "Primary HRTF download handler requires auth resolver."
        );
    }

    if (
        typeof createHrtfDownload !== "function"
    ) {
        throw new TypeError(
            "Primary HRTF download handler requires createHrtfDownload."
        );
    }

    if (
        spatialFallbackEnabled &&
        typeof createSpatialDownload !== "function"
    ) {
        throw new TypeError(
            "Spatial fallback requires createSpatialDownload."
        );
    }

    const resolvedDatasetPath =
        cleanText(datasetPath);

    return async function handlePrimaryPersonalDownload(
        request,
        response
    ) {
        if (request?.method !== "GET") {
            return false;
        }

        const parsedUrl =
            new URL(
                String(request?.url ?? "/"),
                "http://127.0.0.1"
            );

        const match =
            PRIMARY_DOWNLOAD_PATH_PATTERN.exec(
                parsedUrl.pathname
            );

        if (!match) {
            return false;
        }

        const user =
            await resolveUserFromRequest(request);

        if (!user?.userId) {
            return false;
        }

        const sessionId =
            match[1].toLowerCase();

        let baseDownload;

        try {
            baseDownload =
                await downloadService.resolveDownload({
                    sessionId,
                    userId: user.userId
                });
        } catch {
            return false;
        }

        try {
            const hrtfDownload =
                await createHrtfDownload({
                    downloadService,
                    baseDownload,
                    sessionId,
                    userId: user.userId,
                    datasetPath:
                        resolvedDatasetPath
                });

            writeDownloadResponse(
                response,
                hrtfDownload,
                "hrtf"
            );

            logger?.info?.(
                "VOICE_PRIMARY_RECORDING_DOWNLOAD_HRTF=PASS",
                {
                    sessionId,
                    userId: user.userId,
                    bytes:
                        hrtfDownload.contentLength
                }
            );

            return true;
        } catch (hrtfError) {
            logger?.warn?.(
                "VOICE_PRIMARY_RECORDING_DOWNLOAD_HRTF=FALLBACK",
                {
                    sessionId,
                    userId: user.userId,
                    error:
                        hrtfError?.message ??
                        String(hrtfError)
                }
            );
        }

        if (!spatialFallbackEnabled) {
            return false;
        }

        try {
            const spatialDownload =
                await createSpatialDownload({
                    downloadService,
                    baseDownload,
                    sessionId,
                    userId: user.userId
                });

            writeDownloadResponse(
                response,
                spatialDownload,
                "spatial_fallback"
            );

            logger?.warn?.(
                "VOICE_PRIMARY_RECORDING_DOWNLOAD_SPATIAL_FALLBACK=PASS",
                {
                    sessionId,
                    userId: user.userId,
                    bytes:
                        spatialDownload.contentLength
                }
            );

            return true;
        } catch (spatialError) {
            logger?.warn?.(
                "VOICE_PRIMARY_RECORDING_DOWNLOAD_SPATIAL_FALLBACK=FAILED",
                {
                    sessionId,
                    userId: user.userId,
                    error:
                        spatialError?.message ??
                        String(spatialError)
                }
            );
        }

        return false;
    };
}

export {
    PRIMARY_DOWNLOAD_PATH_PATTERN,
    createVoicePrimaryPersonalDownloadHandler
};
