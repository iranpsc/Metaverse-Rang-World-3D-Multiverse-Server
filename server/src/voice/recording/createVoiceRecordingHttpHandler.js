import {
    createReadStream
} from "node:fs";

const LIST_PATH_PATTERN =
    /^\/voice\/recordings\/?$/i;

const DOWNLOAD_PATH_PATTERN =
    /^\/voice\/recordings\/([0-9a-f-]{36})\/download\/?$/i;

function writeVoiceRecordingJson(
    response,
    statusCode,
    body
) {
    const payload = Buffer.from(
        JSON.stringify(body),
        "utf8"
    );

    response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": payload.length,
        "Cache-Control": "no-store"
    });
    response.end(payload);
}

function createVoiceRecordingHttpHandler({
    downloadService,
    resolveUserFromRequest,
    logger = null
} = {}) {
    if (
        !downloadService ||
        typeof downloadService.resolveDownload !== "function" ||
        typeof downloadService.listRecordings !== "function"
    ) {
        throw new TypeError(
            "downloadService must provide resolveDownload and listRecordings."
        );
    }

    if (typeof resolveUserFromRequest !== "function") {
        throw new TypeError(
            "resolveUserFromRequest must be a function."
        );
    }

    return async function handleVoiceRecordingHttp(
        request,
        response
    ) {
        const parsedUrl = new URL(
            String(request?.url ?? "/"),
            "http://127.0.0.1"
        );

        const isListPath =
            LIST_PATH_PATTERN.test(
                parsedUrl.pathname
            );

        const match =
            DOWNLOAD_PATH_PATTERN.exec(
                parsedUrl.pathname
            );

        if (!isListPath && !match) return false;

        if (request.method !== "GET") {
            writeVoiceRecordingJson(
                response,
                405,
                {
                    success: false,
                    reason:
                        "voice_recording_method_not_allowed"
                }
            );
            return true;
        }

        const user =
            await resolveUserFromRequest(request);

        if (!user?.userId) {
            writeVoiceRecordingJson(
                response,
                401,
                {
                    success: false,
                    reason:
                        "voice_recording_auth_required"
                }
            );
            return true;
        }

        if (isListPath) {
            try {
                const recordings =
                    await downloadService.listRecordings({
                        userId: user.userId
                    });

                writeVoiceRecordingJson(
                    response,
                    200,
                    {
                        success: true,
                        count: recordings.length,
                        recordings
                    }
                );
                return true;
            } catch (error) {
                logger?.error?.(
                    "[VoiceRecording] List failed.",
                    {
                        userId: user.userId,
                        error:
                            error?.message ??
                            String(error)
                    }
                );

                writeVoiceRecordingJson(
                    response,
                    500,
                    {
                        success: false,
                        reason:
                            "voice_recording_list_failed"
                    }
                );
                return true;
            }
        }

        try {
            const download =
                await downloadService.resolveDownload({
                    sessionId: match[1],
                    userId: user.userId
                });

            response.writeHead(200, {
                "Content-Type":
                    download.contentType,
                "Content-Length":
                    download.contentLength,
                "Content-Disposition":
                    `attachment; filename="${download.fileName}"`,
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "private, no-store",
                "X-Voice-Recording-SHA256":
                    download.checksumSha256,
                "X-Voice-Recording-Download-Mode":
                    download.downloadMode,
                "X-Voice-Recording-Interval-Count":
                    String(
                        download.authorizedIntervals
                            ?.length ?? 0
                    )
            });

            const stream =
                createReadStream(
                    download.recordingPath
                );

            stream.on("error", (error) => {
                logger?.error?.(
                    "[VoiceRecording] Download stream failed.",
                    {
                        sessionId:
                            download.sessionId,
                        error:
                            error?.message ?? String(error)
                    }
                );

                response.destroy(error);
            });

            stream.pipe(response);
            return true;
        } catch (error) {
            const forbidden =
                error?.code ===
                "VOICE_RECORDING_FORBIDDEN";

            const clipRequired =
                error?.code ===
                "VOICE_RECORDING_CLIP_REQUIRED";

            const clipFailed =
                error?.code ===
                    "VOICE_RECORDING_CLIP_FAILED" ||
                error?.code ===
                    "VOICE_RECORDING_PROCESS_FAILED" ||
                error?.code ===
                    "VOICE_RECORDING_PROCESS_TIMEOUT";

            logger?.warn?.(
                "[VoiceRecording] Download rejected.",
                {
                    sessionId: match[1],
                    userId: user.userId,
                    error:
                        error?.message ?? String(error)
                }
            );

            writeVoiceRecordingJson(
                response,
                forbidden
                    ? 403
                    : clipRequired
                        ? 409
                        : clipFailed
                            ? 500
                            : 404,
                {
                    success: false,
                    reason:
                        forbidden
                            ? "voice_recording_forbidden"
                            : clipRequired
                                ? "voice_recording_clip_required"
                                : clipFailed
                                    ? "voice_recording_clip_failed"
                                    : "voice_recording_not_found"
                }
            );
            return true;
        }
    };
}

export {
    LIST_PATH_PATTERN,
    DOWNLOAD_PATH_PATTERN,
    createVoiceRecordingHttpHandler
};
