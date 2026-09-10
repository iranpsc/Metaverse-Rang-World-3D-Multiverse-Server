// مسیر فایل: src/voice/tests/voiceDedicatedSessionDeltaRuntime.test.js

import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import {
    createGameSessionRegistry
} from "../../gameServerControl/sessions/gameSessionRegistry.js";

import {
    VoiceConnectionRegistry
} from "../core/voiceConnectionRegistry.js";

import {
    VoiceDedicatedSessionDeltaService
} from "../dedicated/voiceDedicatedSessionDeltaService.js";

import {
    createVoiceDedicatedSessionDeltaHttpHandler
} from "../dedicated/createVoiceDedicatedSessionDeltaHttpHandler.js";

import {
    createVoiceDedicatedSessionDeltaRuntime
} from "../dedicated/createVoiceDedicatedSessionDeltaRuntime.js";

import {
    VoiceAuthoritativeSessionService
} from "../session/voiceAuthoritativeSessionService.js";

import {
    VoiceSessionRegistry
} from "../session/voiceSessionRegistry.js";

const SERVER_ID =
    "server_voice_delta_test";

const ROOM_ID =
    "room_voice_delta_test";

const FIRST_USER_ID =
    "70c686cf-d8ca-4c15-9f85-5f503a14f21a";

const SECOND_USER_ID =
    "fd8bbb9f-c3aa-438f-a7ac-cd3a2f985e8b";

const FIRST_CONNECTION_ID =
    "aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa";

const SECOND_CONNECTION_ID =
    "bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb";

const AUTHORITY_EPOCH_ID =
    "11111111-1111-4111-8111-111111111111";

const SESSION_ID =
    "22222222-2222-4222-8222-222222222222";

//* این تابع هندلر آزمایشی توکن سرویس سرور اختصاصی را می‌سازد.
function createFakeDedicatedServerHandler() {
    return {
        verifyDedicatedServerToken(
            _ctx,
            request,
            expected
        ) {
            if (
                request?.serviceToken !==
                "valid_service_token"
            ) {
                return {
                    success:
                        false,

                    reason:
                        "service_token_invalid",

                    message:
                        "Dedicated service token is invalid.",

                    data:
                        {},

                    ts:
                        Date.now()
                };
            }

            if (
                expected?.serverId !==
                request?.serverId
            ) {
                return {
                    success:
                        false,

                    reason:
                        "service_token_server_mismatch",

                    message:
                        "Dedicated service token serverId mismatch.",

                    data:
                        {},

                    ts:
                        Date.now()
                };
            }

            return {
                success:
                    true,

                reason:
                    "service_token_valid",

                message:
                    "Dedicated service token is valid.",

                data: {
                    payload: {
                        serverId:
                            expected.serverId
                    }
                },

                ts:
                    Date.now()
            };
        }
    };
}

//* این تابع یک اتصال صوتی فعال و معتبر را داخل رجیستری ثبت می‌کند.
function registerActiveVoiceConnection(
    registry,
    {
        connectionId,
        userId,
        clientInstanceId,
        transportConnectionKey
    }
) {
    const connection =
        registry.registerAuthenticatedConnection({
            connectionId,
            userId,

            avatarId:
                userId,

            roomId:
                ROOM_ID,

            platform:
                1,

            clientInstanceId,

            transportName:
                "websocket",

            transportConnectionKey,

            createdAtMs:
                1785500000000
        });

    connection.activate(
        1785500000100
    );

    return connection;
}

//* این تابع همه وابستگی‌های زنده لازم برای تست دریافت رویداد را آماده می‌کند.
function createRuntimeFixture() {
    const gameSessionRegistry =
        createGameSessionRegistry();

    const gameSession =
        gameSessionRegistry
            .createSession({
                sessionId:
                    "game_session_voice_delta_test",

                roomId:
                    ROOM_ID,

                serverId:
                    SERVER_ID,

                status:
                    "active",

                maxPlayers:
                    20
            });

    assert.equal(
        gameSessionRegistry
            .addPlayer(
                gameSession.sessionId,
                {
                    userId:
                        FIRST_USER_ID,

                    connectionId:
                        FIRST_CONNECTION_ID,

                    playerId:
                        FIRST_USER_ID,

                    userName:
                        "First User",

                    isReady:
                        true
                }
            ).success,
        true
    );

    assert.equal(
        gameSessionRegistry
            .addPlayer(
                gameSession.sessionId,
                {
                    userId:
                        SECOND_USER_ID,

                    connectionId:
                        SECOND_CONNECTION_ID,

                    playerId:
                        SECOND_USER_ID,

                    userName:
                        "Second User",

                    isReady:
                        true
                }
            ).success,
        true
    );

    const voiceConnectionRegistry =
        new VoiceConnectionRegistry();

    registerActiveVoiceConnection(
        voiceConnectionRegistry,
        {
            connectionId:
                "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",

            userId:
                FIRST_USER_ID,

            clientInstanceId:
                "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",

            transportConnectionKey:
                "voice_first_connection"
        }
    );

    registerActiveVoiceConnection(
        voiceConnectionRegistry,
        {
            connectionId:
                "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",

            userId:
                SECOND_USER_ID,

            clientInstanceId:
                "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",

            transportConnectionKey:
                "voice_second_connection"
        }
    );

    const voiceSessionRegistry =
        new VoiceSessionRegistry();

    const voiceAuthoritativeSessionService =
        new VoiceAuthoritativeSessionService({
            sessionRegistry:
                voiceSessionRegistry
        });

    const service =
        new VoiceDedicatedSessionDeltaService({
            dedicatedServerHandler:
                createFakeDedicatedServerHandler(),

            gameServerRegistry: {
                hasServer:
                    (serverId) =>
                        serverId ===
                        SERVER_ID
            },

            gameSessionRegistry,
            voiceConnectionRegistry,
            voiceAuthoritativeSessionService
        });

    return {
        service,
        gameSessionRegistry,
        voiceConnectionRegistry,
        voiceSessionRegistry,
        voiceAuthoritativeSessionService
    };
}

//* این تابع یک رویداد پایه با هویت شناسه کاربر و ترتیب تعیین‌شده می‌سازد.
function createEvent({
    type,
    sourceSequence,
    distanceMeters,
    reason,
    effectiveAtMs,
    firstConnectionId = FIRST_CONNECTION_ID,
    secondConnectionId = SECOND_CONNECTION_ID,
    memberUserId = ""
}) {
    return {
        type,

        authority:
            "dedicated_server",

        authorityEpochId:
            AUTHORITY_EPOCH_ID,

        sourceSequence,

        serverId:
            SERVER_ID,

        roomId:
            ROOM_ID,

        sessionId:
            SESSION_ID,

        firstUserId:
            FIRST_USER_ID,

        firstConnectionId,

        secondUserId:
            SECOND_USER_ID,

        secondConnectionId,

        memberUserId,
        distanceMeters,
        reason,
        effectiveAtMs
    };
}

//* این تابع دسته معتبر آزمایشی را می‌سازد.
function createBatch(
    events
) {
    return {
        serviceToken:
            "valid_service_token",

        serverId:
            SERVER_ID,

        authorityEpochId:
            AUTHORITY_EPOCH_ID,

        events
    };
}

//* این تست ایجاد، تغییر فاصله، بسته‌شدن و اجرای تکرارپذیر دسته را بررسی می‌کند.
test(
    "dedicated Voice delta batch applies pair session events",
    async () => {
        const fixture =
            createRuntimeFixture();

        const createResult =
            await fixture.service
                .acceptBatch(
                    {},
                    createBatch([
                        createEvent({
                            type:
                                "session_created",

                            sourceSequence:
                                1,

                            distanceMeters:
                                2.5,

                            reason:
                                1,

                            effectiveAtMs:
                                1785500001000
                        })
                    ])
                );

        assert.equal(
            createResult.success,
            true
        );

        assert.equal(
            createResult
                .data
                .appliedCount,
            1
        );

        const createdSession =
            fixture.voiceSessionRegistry
                .getBySessionId(
                    SESSION_ID
                );

        assert.ok(
            createdSession
        );

        const createdParticipantIdentityByUserId =
            new Map(
                createdSession
                    .participants
                    .map(
                        (participant) =>
                            [
                                participant.userId,
                                String(
                                    participant.connectionId ??
                                    ""
                                )
                                    .toLowerCase()
                                    .replaceAll("-", "")
                            ]
                    )
            );

        assert.equal(
            createdParticipantIdentityByUserId
                .get(FIRST_USER_ID),
            FIRST_CONNECTION_ID
        );

        assert.equal(
            createdParticipantIdentityByUserId
                .get(SECOND_USER_ID),
            SECOND_CONNECTION_ID
        );

        const duplicateResult =
            await fixture.service
                .acceptBatch(
                    {},
                    createBatch([
                        createEvent({
                            type:
                                "session_created",

                            sourceSequence:
                                1,

                            distanceMeters:
                                2.5,

                            reason:
                                1,

                            effectiveAtMs:
                                1785500001000
                        })
                    ])
                );

        assert.equal(
            duplicateResult.success,
            true
        );

        assert.equal(
            duplicateResult
                .data
                .duplicateCount,
            1
        );

        const updateResult =
            await fixture.service
                .acceptBatch(
                    {},
                    createBatch([
                        createEvent({
                            type:
                                "distance_updated",

                            sourceSequence:
                                2,

                            distanceMeters:
                                2.8,

                            reason:
                                0,

                            effectiveAtMs:
                                1785500002000
                        })
                    ])
                );

        assert.equal(
            updateResult.success,
            true
        );

        assert.equal(
            fixture
                .voiceSessionRegistry
                .getBySessionId(
                    SESSION_ID
                )
                .distanceMeters,
            2.8
        );

        const closeResult =
            await fixture.service
                .acceptBatch(
                    {},
                    createBatch([
                        createEvent({
                            type:
                                "session_closed",

                            sourceSequence:
                                3,

                            distanceMeters:
                                3.6,

                            reason:
                                2,

                            effectiveAtMs:
                                1785500003000
                        })
                    ])
                );

        assert.equal(
            closeResult.success,
            true
        );

        assert.equal(
            fixture
                .voiceSessionRegistry
                .getBySessionId(
                    SESSION_ID
                )
                .state,
            6
        );
    }
);

//* این تست رد توکن نامعتبر، مرجع نامعتبر و شکاف ترتیب رویداد را بررسی می‌کند.
test(
    "dedicated Voice delta batch rejects invalid authority input",
    async () => {
        const fixture =
            createRuntimeFixture();

        const invalidAuthorityResult =
            await fixture.service
                .acceptBatch(
                    {},
                    createBatch([
                        {
                            ...createEvent({
                                type:
                                    "session_created",

                                sourceSequence:
                                    1,

                                distanceMeters:
                                    2.5,

                                reason:
                                    1,

                                effectiveAtMs:
                                    1785500001000
                            }),

                            authority:
                                "client"
                        }
                    ])
                );

        assert.equal(
            invalidAuthorityResult
                .success,
            false
        );

        assert.equal(
            invalidAuthorityResult
                .reason,
            "voice_delta_batch_invalid"
        );

        const invalidTokenResult =
            await fixture.service
                .acceptBatch(
                    {},
                    {
                        ...createBatch([
                            createEvent({
                                type:
                                    "session_created",

                                sourceSequence:
                                    1,

                                distanceMeters:
                                    2.5,

                                reason:
                                    1,

                                effectiveAtMs:
                                    1785500001000
                            })
                        ]),

                        serviceToken:
                            "invalid_service_token"
                    }
                );

        assert.equal(
            invalidTokenResult
                .success,
            false
        );

        assert.equal(
            invalidTokenResult
                .httpStatusCode,
            401
        );

        const firstResult =
            await fixture.service
                .acceptBatch(
                    {},
                    createBatch([
                        createEvent({
                            type:
                                "session_created",

                            sourceSequence:
                                1,

                            distanceMeters:
                                2.5,

                            reason:
                                1,

                            effectiveAtMs:
                                1785500001000
                        })
                    ])
                );

        assert.equal(
            firstResult.success,
            true
        );

        const gapResult =
            await fixture.service
                .acceptBatch(
                    {},
                    createBatch([
                        createEvent({
                            type:
                                "distance_updated",

                            sourceSequence:
                                3,

                            distanceMeters:
                                2.7,

                            reason:
                                0,

                            effectiveAtMs:
                                1785500003000
                        })
                    ])
                );

        assert.equal(
            gapResult.success,
            false
        );

        assert.equal(
            gapResult.reason,
            "voice_delta_sequence_gap"
        );
    }
);

//* این تابع درخواست اچ‌تی‌تی‌پی محلی را اجرا و پاسخ جیسون آن را برمی‌گرداند.
function sendLocalJsonRequest(
    port,
    payload
) {
    return new Promise(
        (
            resolve,
            reject
        ) => {
            const body =
                JSON.stringify(
                    payload
                );

            const request =
                http.request(
                    {
                        host:
                            "127.0.0.1",

                        port,

                        method:
                            "POST",

                        path:
                            "/game-server-control/dedicated/voice-session-delta",

                        headers: {
                            "Content-Type":
                                "application/json",

                            "Content-Length":
                                Buffer.byteLength(
                                    body
                                )
                        }
                    },
                    (response) => {
                        const chunks =
                            [];

                        response.on(
                            "data",
                            (chunk) =>
                                chunks.push(
                                    chunk
                                )
                        );

                        response.on(
                            "end",
                            () => {
                                try {
                                    resolve({
                                        statusCode:
                                            response.statusCode,

                                        body:
                                            JSON.parse(
                                                Buffer.concat(
                                                    chunks
                                                ).toString(
                                                    "utf8"
                                                )
                                            )
                                    });
                                } catch (error) {
                                    reject(
                                        error
                                    );
                                }
                            }
                        );
                    }
                );

            request.on(
                "error",
                reject
            );

            request.end(
                body
            );
        }
    );
}

//* این تست اتصال مسیر اچ‌تی‌تی‌پی اصلی به سرویس دریافت دسته را بررسی می‌کند.
test(
    "dedicated Voice delta HTTP handler accepts a valid batch",
    async () => {
        const fixture =
            createRuntimeFixture();

        const handler =
            createVoiceDedicatedSessionDeltaHttpHandler({
                getService:
                    () =>
                        fixture.service
            });

        const server =
            http.createServer(
                async (
                    req,
                    res
                ) => {
                    const handled =
                        await handler(
                            req,
                            res
                        );

                    if (
                        !handled
                    ) {
                        res.writeHead(
                            404
                        );

                        res.end();
                    }
                }
            );

        await new Promise(
            (resolve) =>
                server.listen(
                    0,
                    "127.0.0.1",
                    resolve
                )
        );

        try {
            const response =
                await sendLocalJsonRequest(
                    server.address()
                        .port,
                    createBatch([
                        createEvent({
                            type:
                                "session_created",

                            sourceSequence:
                                1,

                            distanceMeters:
                                2.4,

                            reason:
                                1,

                            effectiveAtMs:
                                1785500001000
                        })
                    ])
                );

            assert.equal(
                response.statusCode,
                200
            );

            assert.equal(
                response.body.success,
                true
            );

            assert.equal(
                response.body.reason,
                "voice_delta_batch_accepted"
            );
        } finally {
            await new Promise(
                (
                    resolve,
                    reject
                ) =>
                    server.close(
                        (error) =>
                            error
                                ? reject(error)
                                : resolve()
                    )
            );
        }
    }
);

//* این تست اتصال رانتایم دریافت رویداد به رجیستری زنده اتصال صوتی و کنترل گیم‌سرور را بررسی می‌کند.
test(
    "dedicated Voice delta runtime attaches to live dependencies",
    () => {
        const fixture =
            createRuntimeFixture();

        const runtime =
            createVoiceDedicatedSessionDeltaRuntime();

        const attachedService =
            runtime.attach({
                gameServerControlRuntime: {
                    dedicatedServerHandler:
                        createFakeDedicatedServerHandler(),

                    registry: {
                        hasServer:
                            (serverId) =>
                                serverId ===
                                SERVER_ID
                    },

                    sessionRegistry:
                        fixture
                            .gameSessionRegistry
                },

                voiceConnectionRegistry:
                    fixture
                        .voiceConnectionRegistry
            });

        assert.equal(
            typeof attachedService
                .acceptBatch,
            "function"
        );

        assert.equal(
            runtime
                .getStats()
                .attached,
            true
        );

        runtime.stop();

        assert.equal(
            runtime
                .getStats()
                .stopped,
            true
        );
    }
);

//* این تست مرتب‌سازی رویدادهای یک دسته و الزام شروع هر اجرای تازه از شماره یک را بررسی می‌کند.
test(
    "dedicated Voice delta orders a batch and requires sequence one for a new epoch",
    async () => {
        const fixture =
            createRuntimeFixture();

        const orderedResult =
            await fixture.service
                .acceptBatch(
                    {},
                    createBatch([
                        createEvent({
                            type:
                                "distance_updated",
                            sourceSequence:
                                2,
                            distanceMeters:
                                2.8,
                            reason:
                                0,
                            effectiveAtMs:
                                1785500002000
                        }),
                        createEvent({
                            type:
                                "session_created",
                            sourceSequence:
                                1,
                            distanceMeters:
                                2.5,
                            reason:
                                1,
                            effectiveAtMs:
                                1785500001000
                        })
                    ])
                );

        assert.equal(
            orderedResult.success,
            true
        );

        assert.equal(
            orderedResult.data.lastAcceptedSequence,
            2
        );

        const freshFixture =
            createRuntimeFixture();

        const invalidFirstSequenceResult =
            await freshFixture.service
                .acceptBatch(
                    {},
                    createBatch([
                        createEvent({
                            type:
                                "session_created",
                            sourceSequence:
                                2,
                            distanceMeters:
                                2.5,
                            reason:
                                1,
                            effectiveAtMs:
                                1785500001000
                        })
                    ])
                );

        assert.equal(
            invalidFirstSequenceResult.success,
            false
        );

        assert.equal(
            invalidFirstSequenceResult.reason,
            "voice_delta_sequence_must_start_at_one"
        );
    }
);

//* این تست رد اتصال صوتی قدیمی را پس از تغییر شناسه اتصال همان بازیکن در سرور اختصاصی بررسی می‌کند.
test(
    "dedicated Voice delta rejects a stale Voice connection identity",
    async () => {
        const fixture =
            createRuntimeFixture();

        const gameSession =
            fixture.gameSessionRegistry
                .findSessionByRoom(
                    ROOM_ID
                );

        const replacePlayerResult =
            fixture.gameSessionRegistry
                .addPlayer(
                    gameSession.sessionId,
                    {
                        userId:
                            FIRST_USER_ID,
                        connectionId:
                            "cccccccccccc4ccc8ccccccccccccccc",
                        playerId:
                            FIRST_USER_ID,
                        userName:
                            "First User Reconnected",
                        isReady:
                            true
                    }
                );

        assert.equal(
            replacePlayerResult.success,
            true
        );

        const staleConnectionResult =
            await fixture.service
                .acceptBatch(
                    {},
                    createBatch([
                        createEvent({
                            type:
                                "session_created",
                            sourceSequence:
                                1,
                            firstConnectionId:
                                "cccccccccccc4ccc8ccccccccccccccc",
                            distanceMeters:
                                2.5,
                            reason:
                                1,
                            effectiveAtMs:
                                1785500001000
                        })
                    ])
                );

        assert.equal(
            staleConnectionResult.success,
            false
        );

        assert.equal(
            staleConnectionResult.reason,
            "voice_delta_pair_voice_connection_not_ready"
        );
    }
);

//* این تست رد شناسه اتصال رویداد را وقتی با بازیکن جاری همان روم و سرور تطبیق ندارد بررسی می‌کند.
test(
    "dedicated Voice delta rejects a mismatched dedicated connection identity",
    async () => {
        const fixture =
            createRuntimeFixture();

        const mismatchedConnectionResult =
            await fixture.service
                .acceptBatch(
                    {},
                    createBatch([
                        createEvent({
                            type:
                                "session_created",
                            sourceSequence:
                                1,
                            firstConnectionId:
                                "cccccccccccc4ccc8ccccccccccccccc",
                            distanceMeters:
                                2.5,
                            reason:
                                1,
                            effectiveAtMs:
                                1785500001000
                        })
                    ])
                );

        assert.equal(
            mismatchedConnectionResult.success,
            false
        );

        assert.equal(
            mismatchedConnectionResult.reason,
            "voice_delta_pair_not_in_game_session"
        );
    }
);

//* این تست کنترل سقف بدنه و پاسخ ۴۱۳ بدون تخریب سوکت را بررسی می‌کند.
test(
    "dedicated Voice delta HTTP handler returns 413 for an oversized body",
    async () => {
        const fixture =
            createRuntimeFixture();

        const handler =
            createVoiceDedicatedSessionDeltaHttpHandler({
                getService:
                    () =>
                        fixture.service,
                maximumBodyBytes:
                    64
            });

        const server =
            http.createServer(
                async (
                    req,
                    res
                ) => {
                    const handled =
                        await handler(
                            req,
                            res
                        );

                    if (!handled) {
                        res.writeHead(404);
                        res.end();
                    }
                }
            );

        await new Promise(
            (resolve) =>
                server.listen(
                    0,
                    "127.0.0.1",
                    resolve
                )
        );

        try {
            const response =
                await sendLocalJsonRequest(
                    server.address().port,
                    {
                        oversized:
                            "x".repeat(256)
                    }
                );

            assert.equal(
                response.statusCode,
                413
            );

            assert.equal(
                response.body.reason,
                "voice_delta_request_body_too_large"
            );
        } finally {
            await new Promise(
                (
                    resolve,
                    reject
                ) =>
                    server.close(
                        (error) =>
                            error
                                ? reject(error)
                                : resolve()
                    )
            );
        }
    }
);

console.log(
    "VOICE_V3_DEDICATED_SESSION_DELTA_SERVICE=PASS"
);

console.log(
    "VOICE_V3_DEDICATED_SESSION_DELTA_AUTHORITY=PASS"
);

console.log(
    "VOICE_V3_DEDICATED_SESSION_DELTA_SEQUENCE=PASS"
);

console.log(
    "VOICE_V3_DEDICATED_SESSION_DELTA_HTTP=PASS"
);

console.log(
    "VOICE_V3_DEDICATED_SESSION_DELTA_USER_CONNECTION_ID=PASS"
);

/*
توضیح فایل:
این فایل دریافت دسته رویداد، احراز سرویس توکن، ترتیب رویداد، ایجاد و تغییر و بسته‌شدن سشن زوجی، اجرای تکرارپذیر و مسیر اچ‌تی‌تی‌پی اصلی را با ترکیب شناسه کاربر و اتصال واقعی آزمایش می‌کند.
*/
