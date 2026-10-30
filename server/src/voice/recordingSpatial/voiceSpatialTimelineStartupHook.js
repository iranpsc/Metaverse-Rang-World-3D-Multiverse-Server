import http from "node:http";

import {
    createGameServerServiceToken,
    resolveGameServerControlConfig
} from "../../gameServerControl/index.js";

import {
    VoiceSpatialSpoolStore
} from "./voiceSpatialSpoolStore.js";

const enabled =
    ["1", "true", "yes", "on"].includes(
        String(
            process.env
                .VOICE_SPATIAL_TIMELINE_ENABLED ??
                ""
        ).trim().toLowerCase()
    );

const isolatedHttpEnabled =
    enabled &&
    ["1", "true", "yes", "on"].includes(
        String(
            process.env
                .VOICE_SPATIAL_TIMELINE_ISOLATED_HTTP_ENABLED ??
                ""
        ).trim().toLowerCase()
    );

const route =
    "/game-server-control/dedicated/voice-spatial-timeline";

const maximumBodyBytes =
    1024 * 1024;

const defaultHost =
    "127.0.0.1";

const defaultPort =
    51013;

const runtimeKey =
    Symbol.for(
        "network_a.voice.spatial_timeline.s1.passive"
    );

function readPort(
    value,
    fallback =
        defaultPort
) {
    const parsed =
        Number.parseInt(
            String(
                value ??
                ""
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

function cleanHost(
    value
) {
    const host =
        String(
            value ??
            defaultHost
        ).trim();

    return host ||
        defaultHost;
}

function readPath(
    req
) {
    const host =
        req?.headers?.host ??
        "127.0.0.1";

    try {
        return new URL(
            req?.url ??
                "/",
            `http://${host}`
        ).pathname;
    } catch {
        return String(
            req?.url ??
                "/"
        ).split(
            "?"
        )[0];
    }
}

function sendJson(
    res,
    statusCode,
    payload
) {
    const body =
        Buffer.from(
            JSON.stringify(
                payload
            ),
            "utf8"
        );

    res.writeHead(
        statusCode,
        {
            "Content-Type":
                "application/json; charset=utf-8",
            "Content-Length":
                body.length,
            "Cache-Control":
                "no-store"
        }
    );

    res.end(
        body
    );
}

function readJsonBody(
    req
) {
    return new Promise(
        (
            resolve,
            reject
        ) => {
            const chunks = [];
            let total = 0;

            req.on(
                "data",
                (chunk) => {
                    const buffer =
                        Buffer.isBuffer(
                            chunk
                        )
                            ? chunk
                            : Buffer.from(
                                String(
                                    chunk
                                )
                            );

                    total +=
                        buffer.length;

                    if (
                        total >
                        maximumBodyBytes
                    ) {
                        reject(
                            new Error(
                                "body_too_large"
                            )
                        );

                        req.destroy();
                        return;
                    }

                    chunks.push(
                        buffer
                    );
                }
            );

            req.once(
                "error",
                reject
            );

            req.once(
                "end",
                () => {
                    try {
                        resolve(
                            JSON.parse(
                                Buffer.concat(
                                    chunks
                                ).toString(
                                    "utf8"
                                ) ||
                                "{}"
                            )
                        );
                    } catch {
                        reject(
                            new Error(
                                "invalid_json"
                            )
                        );
                    }
                }
            );
        }
    );
}

function createSpatialTimelineHttpHandler({
    store,
    serviceTokenService
} = {}) {
    if (
        !store ||
        typeof store.observeBatch !==
            "function"
    ) {
        throw new TypeError(
            "Spatial spool store is invalid."
        );
    }

    if (
        !serviceTokenService ||
        typeof serviceTokenService
                .verifyToken !==
            "function"
    ) {
        throw new TypeError(
            "Service token verifier is invalid."
        );
    }

    return async function handleSpatialTimelineRequest(
        req,
        res
    ) {
        if (
            readPath(
                req
            ) !==
            route
        ) {
            sendJson(
                res,
                404,
                {
                    success:
                        false,
                    reason:
                        "spatial_timeline_route_not_found"
                }
            );

            return;
        }

        if (
            String(
                req.method ??
                    "GET"
            ).toUpperCase() !==
            "POST"
        ) {
            sendJson(
                res,
                405,
                {
                    success:
                        false,
                    reason:
                        "method_not_allowed"
                }
            );

            return;
        }

        let body;

        try {
            body =
                await readJsonBody(
                    req
                );
        } catch (error) {
            sendJson(
                res,
                400,
                {
                    success:
                        false,
                    reason:
                        String(
                            error?.message ??
                                "invalid_request"
                        )
                }
            );

            return;
        }

        const serverId =
            String(
                body?.serverId ??
                    ""
            ).trim();

        const serviceToken =
            String(
                body?.serviceToken ??
                    ""
            ).trim();

        if (
            !serverId ||
            !serviceToken
        ) {
            sendJson(
                res,
                400,
                {
                    success:
                        false,
                    reason:
                        "spatial_timeline_identity_missing"
                }
            );

            return;
        }

        let verification;

        try {
            verification =
                serviceTokenService
                    .verifyToken(
                        serviceToken,
                        {
                            serverId,
                            purpose:
                                "game_server_control"
                        }
                    );
        } catch {
            verification =
                null;
        }

        if (
            verification?.success !==
            true
        ) {
            sendJson(
                res,
                403,
                {
                    success:
                        false,
                    reason:
                        verification
                            ?.reason ??
                        "service_token_invalid"
                }
            );

            return;
        }

        const result =
            store.observeBatch(
                serverId,
                body?.events
            );

        sendJson(
            res,
            200,
            {
                success:
                    true,
                reason:
                    "voice_spatial_spool_batch_accepted",
                data:
                    result,
                stats:
                    store.getStats(),
                ts:
                    Date.now()
            }
        );
    };
}

async function startPassiveSpatialTimelineRuntime({
    host =
        cleanHost(
            process.env
                .VOICE_SPATIAL_TIMELINE_HOST
        ),
    port =
        readPort(
            process.env
                .VOICE_SPATIAL_TIMELINE_PORT
        ),
    storageRoot =
        String(
            process.env
                .METAVERSE_VOICE_RECORDING_STORAGE_ROOT ??
                ""
        ).trim(),
    store =
        null,
    serviceTokenService =
        null
} = {}) {
    if (
        !storageRoot
    ) {
        throw new Error(
            "METAVERSE_VOICE_RECORDING_STORAGE_ROOT is required."
        );
    }

    const config =
        resolveGameServerControlConfig();

    const verifier =
        serviceTokenService ??
        createGameServerServiceToken({
            serviceSecret:
                config.serviceSecret,
            defaultTtlSeconds:
                config.ticketTtlSeconds
        });

    const spoolStore =
        store ??
        new VoiceSpatialSpoolStore({
            storageRoot
        });

    const handler =
        createSpatialTimelineHttpHandler({
            store:
                spoolStore,
            serviceTokenService:
                verifier
        });

    const server =
        http.createServer(
            (
                req,
                res
            ) => {
                void handler(
                    req,
                    res
                ).catch(
                    (error) => {
                        console.error(
                            "VOICE_SPATIAL_TIMELINE_HTTP=FAIL",
                            error
                        );

                        if (
                            !res.headersSent &&
                            !res.writableEnded
                        ) {
                            sendJson(
                                res,
                                500,
                                {
                                    success:
                                        false,
                                    reason:
                                        "spatial_timeline_internal_error"
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
        "VOICE_SPATIAL_TIMELINE_S1=READY" +
        " | mode=passive_spool" +
        " | host=" +
        host +
        " | port=" +
        port +
        " | route=" +
        route +
        " | voiceRecordingPrototypePatched=False" +
        " | gameServerControlPrototypePatched=False" +
        " | liveVoiceChanged=False" +
        " | sharedTokenRenewal=False"
    );

    return Object.freeze({
        host,
        port,
        route,
        server,
        store:
            spoolStore,
        async stop() {
            await spoolStore.flush();

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
    isolatedHttpEnabled &&
    !globalThis[
        runtimeKey
    ]
) {
    const runtimePromise =
        startPassiveSpatialTimelineRuntime();

    globalThis[
        runtimeKey
    ] =
        runtimePromise;

    runtimePromise.catch(
        (error) => {
            console.error(
                "VOICE_SPATIAL_TIMELINE_S1=FAIL",
                error
            );
        }
    );
}

export {
    createSpatialTimelineHttpHandler,
    startPassiveSpatialTimelineRuntime
};
