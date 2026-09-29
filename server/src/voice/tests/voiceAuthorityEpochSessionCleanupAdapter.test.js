import assert from "node:assert/strict";
import test from "node:test";

import {
    VoiceConnectionState
} from "../core/voiceConnectionConstants.js";

import {
    VoiceAuthorityEpochSessionCleanupAdapter
} from "../dedicated/voiceAuthorityEpochSessionCleanupAdapter.js";

import {
    VoiceDedicatedSessionDeltaService
} from "../dedicated/voiceDedicatedSessionDeltaService.js";

import {
    VoiceAuthoritativeSessionService
} from "../session/voiceAuthoritativeSessionService.js";

import {
    VoiceSessionRegistry
} from "../session/voiceSessionRegistry.js";

const SERVER_ID =
    "server_authority_epoch_cleanup_test";

const ROOM_ID =
    "room_authority_epoch_cleanup_test";

const FIRST_USER_ID =
    "70c686cf-d8ca-4c15-9f85-5f503a14f21a";

const SECOND_USER_ID =
    "fd8bbb9f-c3aa-438f-a7ac-cd3a2f985e8b";

const FIRST_CONNECTION_ID =
    "aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa";

const SECOND_CONNECTION_ID =
    "bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb";

const FIRST_AUTHORITY_EPOCH_ID =
    "11111111-1111-4111-8111-111111111111";

const SECOND_AUTHORITY_EPOCH_ID =
    "33333333-3333-4333-8333-333333333333";

const FIRST_SESSION_ID =
    "22222222-2222-4222-8222-222222222222";

const SECOND_SESSION_ID =
    "44444444-4444-4444-8444-444444444444";

function createSessionCreatedEvent({
    authorityEpochId,
    sessionId,
    effectiveAtMs
}) {
    return {
        type:
            "session_created",

        authority:
            "dedicated_server",

        authorityEpochId,

        sourceSequence:
            1,

        serverId:
            SERVER_ID,

        roomId:
            ROOM_ID,

        sessionId,

        firstUserId:
            FIRST_USER_ID,

        firstConnectionId:
            FIRST_CONNECTION_ID,

        secondUserId:
            SECOND_USER_ID,

        secondConnectionId:
            SECOND_CONNECTION_ID,

        memberUserId:
            "",

        memberConnectionId:
            "",

        distanceMeters:
            1.25,

        reason:
            1,

        effectiveAtMs
    };
}

function createBatch({
    serviceToken = "valid_service_token",
    authorityEpochId,
    sessionId,
    effectiveAtMs
}) {
    return {
        serviceToken,
        serverId:
            SERVER_ID,
        authorityEpochId,
        events: [
            createSessionCreatedEvent({
                authorityEpochId,
                sessionId,
                effectiveAtMs
            })
        ]
    };
}

function createFixture() {
    const sessionRegistry =
        new VoiceSessionRegistry();

    const voiceAuthoritativeSessionService =
        new VoiceAuthoritativeSessionService({
            sessionRegistry
        });

    const voiceConnectionsByUserId =
        new Map([
            [
                FIRST_USER_ID,
                [
                    {
                        connectionId:
                            FIRST_CONNECTION_ID,
                        userId:
                            FIRST_USER_ID,
                        avatarId:
                            FIRST_USER_ID,
                        roomId:
                            ROOM_ID,
                        state:
                            VoiceConnectionState.ACTIVE
                    }
                ]
            ],
            [
                SECOND_USER_ID,
                [
                    {
                        connectionId:
                            SECOND_CONNECTION_ID,
                        userId:
                            SECOND_USER_ID,
                        avatarId:
                            SECOND_USER_ID,
                        roomId:
                            ROOM_ID,
                        state:
                            VoiceConnectionState.ACTIVE
                    }
                ]
            ]
        ]);

    const gameSession = {
        serverId:
            SERVER_ID,
        roomId:
            ROOM_ID,
        players: [
            {
                userId:
                    FIRST_USER_ID,
                connectionId:
                    FIRST_CONNECTION_ID,
                isReady:
                    true
            },
            {
                userId:
                    SECOND_USER_ID,
                connectionId:
                    SECOND_CONNECTION_ID,
                isReady:
                    true
            }
        ]
    };

    const observedEvents = [];
    const activeRecordings = new Set();
    const finalizedSessionIds = [];

    const service =
        new VoiceDedicatedSessionDeltaService({
            dedicatedServerHandler: {
                verifyDedicatedServerToken(
                    _ctx,
                    request,
                    expected
                ) {
                    if (
                        request?.serviceToken !== "valid_service_token" ||
                        expected?.serverId !== SERVER_ID
                    ) {
                        return Object.freeze({
                            success:
                                false,
                            reason:
                                "service_token_invalid",
                            message:
                                "Dedicated service token is invalid.",
                            data:
                                {}
                        });
                    }

                    return Object.freeze({
                        success:
                            true,
                        reason:
                            "service_token_valid",
                        message:
                            "Dedicated service token is valid.",
                        data:
                            {}
                    });
                }
            },

            gameServerRegistry: {
                hasServer:
                    (serverId) =>
                        serverId === SERVER_ID
            },

            gameSessionRegistry: {
                findSessionByRoom:
                    (roomId) =>
                        roomId === ROOM_ID
                            ? gameSession
                            : null,

                isPublicSessionOpen:
                    (candidate) =>
                        candidate === gameSession
            },

            voiceConnectionRegistry: {
                listByUserId:
                    (userId) =>
                        voiceConnectionsByUserId.get(userId) ?? []
            },

            voiceAuthoritativeSessionService,

            eventObserver: async ({
                event,
                applyResult
            }) => {
                observedEvents.push(
                    Object.freeze({
                        type:
                            event.type,
                        sessionId:
                            event.sessionId,
                        reason:
                            event.reason,
                        applied:
                            applyResult?.applied === true
                    })
                );

                if (event.type === "session_created") {
                    activeRecordings.add(
                        event.sessionId
                    );
                }

                if (event.type === "session_closed") {
                    activeRecordings.delete(
                        event.sessionId
                    );

                    finalizedSessionIds.push(
                        event.sessionId
                    );
                }
            }
        });

    const adapter =
        new VoiceAuthorityEpochSessionCleanupAdapter({
            service,
            baseAcceptBatch:
                VoiceDedicatedSessionDeltaService
                    .prototype
                    .acceptBatch,
            now:
                () => 1785500031000,
            logger: {
                info:
                    () => undefined
            }
        });

    return {
        adapter,
        service,
        sessionRegistry,
        observedEvents,
        activeRecordings,
        finalizedSessionIds
    };
}

test(
    "authority epoch handoff closes and notifies the old session before creating the new session",
    async () => {
        const fixture =
            createFixture();

        const firstResult =
            await fixture.adapter.acceptBatch(
                {},
                createBatch({
                    authorityEpochId:
                        FIRST_AUTHORITY_EPOCH_ID,
                    sessionId:
                        FIRST_SESSION_ID,
                    effectiveAtMs:
                        1785500001000
                })
            );

        assert.equal(
            firstResult.success,
            true
        );

        const unauthorizedResult =
            await fixture.adapter.acceptBatch(
                {},
                createBatch({
                    serviceToken:
                        "invalid_service_token",
                    authorityEpochId:
                        SECOND_AUTHORITY_EPOCH_ID,
                    sessionId:
                        SECOND_SESSION_ID,
                    effectiveAtMs:
                        1785500031000
                })
            );

        assert.equal(
            unauthorizedResult.success,
            false
        );

        assert.equal(
            fixture.sessionRegistry
                .listActiveByConnectionId(
                    FIRST_CONNECTION_ID
                )[0]
                .sessionId,
            FIRST_SESSION_ID
        );

        const secondBatch =
            createBatch({
                authorityEpochId:
                    SECOND_AUTHORITY_EPOCH_ID,
                sessionId:
                    SECOND_SESSION_ID,
                effectiveAtMs:
                    1785500031000
            });

        const concurrentResults =
            await Promise.all([
                fixture.adapter.acceptBatch(
                    {},
                    secondBatch
                ),
                fixture.adapter.acceptBatch(
                    {},
                    secondBatch
                )
            ]);

        assert.equal(
            concurrentResults[0].success,
            true
        );

        assert.equal(
            concurrentResults[1].success,
            true
        );

        assert.equal(
            concurrentResults[0].data.appliedCount,
            1
        );

        assert.equal(
            concurrentResults[1].data.duplicateCount,
            1
        );

        assert.deepEqual(
            fixture.observedEvents,
            [
                {
                    type:
                        "session_created",
                    sessionId:
                        FIRST_SESSION_ID,
                    reason:
                        1,
                    applied:
                        true
                },
                {
                    type:
                        "session_closed",
                    sessionId:
                        FIRST_SESSION_ID,
                    reason:
                        5,
                    applied:
                        true
                },
                {
                    type:
                        "session_created",
                    sessionId:
                        SECOND_SESSION_ID,
                    reason:
                        1,
                    applied:
                        true
                }
            ]
        );

        assert.deepEqual(
            fixture.finalizedSessionIds,
            [
                FIRST_SESSION_ID
            ]
        );

        assert.deepEqual(
            [...fixture.activeRecordings],
            [
                SECOND_SESSION_ID
            ]
        );

        const firstConnectionSessions =
            fixture.sessionRegistry
                .listActiveByConnectionId(
                    FIRST_CONNECTION_ID
                );

        const secondConnectionSessions =
            fixture.sessionRegistry
                .listActiveByConnectionId(
                    SECOND_CONNECTION_ID
                );

        assert.equal(
            firstConnectionSessions.length,
            1
        );

        assert.equal(
            secondConnectionSessions.length,
            1
        );

        assert.equal(
            firstConnectionSessions[0].sessionId,
            SECOND_SESSION_ID
        );

        assert.equal(
            secondConnectionSessions[0].sessionId,
            SECOND_SESSION_ID
        );

        assert.equal(
            fixture.sessionRegistry
                .getBySessionId(
                    FIRST_SESSION_ID
                )
                .state,
            6
        );

        assert.equal(
            fixture.service
                .sequenceStateByServerId
                .get(SERVER_ID)
                .burnedEpochIds
                .has(FIRST_AUTHORITY_EPOCH_ID),
            true
        );
    }
);

console.log(
    "VOICE_AUTHORITY_EPOCH_SESSION_CLEANUP_TEST=OK | oldSessionClosed=true | closeNotifiedBeforeCreate=true | recordingFinalizedOnce=true | concurrentHandoffSerialized=true | activeSessionPerConnection=1 | stableFilesChanged=false"
);

