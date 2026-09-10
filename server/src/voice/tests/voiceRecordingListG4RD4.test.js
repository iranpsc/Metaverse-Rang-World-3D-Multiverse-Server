import assert from "node:assert/strict";

import {
    mkdir,
    mkdtemp,
    writeFile
} from "node:fs/promises";

import {
    tmpdir
} from "node:os";

import {
    join
} from "node:path";

import {
    createVoiceRecordingHttpHandler
} from "../recording/createVoiceRecordingHttpHandler.js";

import {
    VoiceRecordingDownloadService
} from "../recording/voiceRecordingDownloadService.js";

const authorizedUserId =
    "11111111-1111-4111-8111-111111111111";

const otherUserId =
    "22222222-2222-4222-8222-222222222222";

const storageRoot =
    await mkdtemp(
        join(tmpdir(), "voice-rd4-list-")
    );

async function createFinalizedRecording({
    sessionId,
    startedAtMs,
    endedAtMs,
    participants
}) {
    const directory =
        join(storageRoot, sessionId);

    await mkdir(directory, {
        recursive: true
    });

    await writeFile(
        join(directory, "session.ogg"),
        Buffer.from("OggS-RD4")
    );

    await writeFile(
        join(directory, "session.json"),
        `${JSON.stringify({
            version: 2,
            recordingContract: "G4.RD1",
            membershipModel:
                "dynamic_session_membership_v1",
            sessionId,
            startedAtMs,
            endedAtMs,
            durationMs:
                endedAtMs - startedAtMs,
            checksumAlgorithm: "sha256",
            checksumSha256: "test-only",
            authorizationModel:
                "user_intervals_from_session_json",
            participants
        }, null, 2)}\n`
    );
}

const fullSessionId =
    "660e8400-e29b-41d4-a716-446655440010";

await createFinalizedRecording({
    sessionId: fullSessionId,
    startedAtMs: 1_000,
    endedAtMs: 11_000,
    participants: [
        {
            userId: authorizedUserId,
            connectionId:
                "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            intervals: [
                {
                    joinedAtMs: 1_000,
                    leftAtMs: 11_000,
                    startOffsetMs: 0,
                    endOffsetMs: 10_000
                }
            ]
        }
    ]
});

const partialSessionId =
    "660e8400-e29b-41d4-a716-446655440011";

await createFinalizedRecording({
    sessionId: partialSessionId,
    startedAtMs: 20_000,
    endedAtMs: 30_000,
    participants: [
        {
            userId: authorizedUserId,
            connectionId:
                "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            intervals: [
                {
                    joinedAtMs: 21_000,
                    leftAtMs: 23_000,
                    startOffsetMs: 1_000,
                    endOffsetMs: 3_000
                },
                {
                    joinedAtMs: 26_000,
                    leftAtMs: 28_000,
                    startOffsetMs: 6_000,
                    endOffsetMs: 8_000
                }
            ]
        }
    ]
});

await createFinalizedRecording({
    sessionId:
        "660e8400-e29b-41d4-a716-446655440012",
    startedAtMs: 40_000,
    endedAtMs: 50_000,
    participants: [
        {
            userId: otherUserId,
            connectionId:
                "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            intervals: [
                {
                    joinedAtMs: 40_000,
                    leftAtMs: 50_000,
                    startOffsetMs: 0,
                    endOffsetMs: 10_000
                }
            ]
        }
    ]
});

const noIntervalSessionId =
    "660e8400-e29b-41d4-a716-446655440013";

await createFinalizedRecording({
    sessionId: noIntervalSessionId,
    startedAtMs: 60_000,
    endedAtMs: 70_000,
    participants: [
        {
            userId: authorizedUserId,
            connectionId:
                "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            intervals: []
        }
    ]
});

const invalidContractSessionId =
    "660e8400-e29b-41d4-a716-446655440015";

const invalidContractDirectory =
    join(storageRoot, invalidContractSessionId);

await mkdir(invalidContractDirectory, {
    recursive: true
});

await writeFile(
    join(invalidContractDirectory, "session.ogg"),
    Buffer.from("OggS-INVALID-CONTRACT")
);

await writeFile(
    join(invalidContractDirectory, "session.json"),
    `${JSON.stringify({
        version: 2,
        recordingContract: "OLD.CONTRACT",
        authorizationModel:
            "user_intervals_from_session_json",
        sessionId: invalidContractSessionId,
        startedAtMs: 80_000,
        endedAtMs: 90_000,
        durationMs: 10_000,
        participants: [
            {
                userId: authorizedUserId,
                connectionId:
                    "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                intervals: [
                    {
                        joinedAtMs: 80_000,
                        leftAtMs: 90_000,
                        startOffsetMs: 0,
                        endOffsetMs: 10_000
                    }
                ]
            }
        ]
    }, null, 2)}\n`
);

const partialOnlySessionId =
    "660e8400-e29b-41d4-a716-446655440014";

const partialOnlyDirectory =
    join(storageRoot, partialOnlySessionId);

await mkdir(partialOnlyDirectory, {
    recursive: true
});

await writeFile(
    join(partialOnlyDirectory, "session.ogg.partial"),
    Buffer.from("OggS-PARTIAL")
);

await writeFile(
    join(partialOnlyDirectory, "session.json.partial"),
    "{}\n"
);

const listService =
    new VoiceRecordingDownloadService({
        storageRoot
    });

const recordings =
    await listService.listRecordings({
        userId: authorizedUserId
    });

assert.equal(recordings.length, 2);
assert.equal(
    recordings[0].sessionId,
    partialSessionId
);
assert.equal(
    recordings[0].authorizedIntervalCount,
    2
);
assert.equal(
    recordings[0].downloadMode,
    "authorized_clip"
);
assert.equal(
    recordings[1].sessionId,
    fullSessionId
);
assert.equal(
    recordings[1].authorizedIntervalCount,
    1
);
assert.equal(
    recordings[1].downloadMode,
    "full_session_passthrough"
);

assert.equal(
    recordings.some(
        (item) =>
            item.sessionId ===
            noIntervalSessionId
    ),
    false
);

assert.equal(
    recordings.some(
        (item) =>
            item.sessionId ===
            partialOnlySessionId
    ),
    false
);

assert.equal(
    recordings.some(
        (item) =>
            item.sessionId ===
            invalidContractSessionId
    ),
    false
);

function createResponseCapture() {
    return {
        statusCode: null,
        headers: null,
        body: Buffer.alloc(0),
        writeHead(statusCode, headers) {
            this.statusCode = statusCode;
            this.headers = headers;
        },
        end(payload = Buffer.alloc(0)) {
            this.body = Buffer.isBuffer(payload)
                ? payload
                : Buffer.from(String(payload));
        }
    };
}

const handler =
    createVoiceRecordingHttpHandler({
        downloadService: listService,
        resolveUserFromRequest:
            async (request) =>
                request.headers?.authorization ===
                "Bearer valid-user-token"
                    ? {
                        userId:
                            authorizedUserId
                    }
                    : null
    });

const authorizedResponse =
    createResponseCapture();

assert.equal(
    await handler(
        {
            method: "GET",
            url: "/voice/recordings",
            headers: {
                authorization:
                    "Bearer valid-user-token"
            }
        },
        authorizedResponse
    ),
    true
);

assert.equal(
    authorizedResponse.statusCode,
    200
);

const authorizedBody =
    JSON.parse(
        authorizedResponse.body.toString("utf8")
    );

assert.equal(authorizedBody.success, true);
assert.equal(authorizedBody.count, 2);
assert.equal(
    authorizedBody.recordings[0].sessionId,
    partialSessionId
);

const unauthorizedResponse =
    createResponseCapture();

assert.equal(
    await handler(
        {
            method: "GET",
            url: "/voice/recordings",
            headers: {}
        },
        unauthorizedResponse
    ),
    true
);

assert.equal(
    unauthorizedResponse.statusCode,
    401
);

const unrelatedResponse =
    createResponseCapture();

assert.equal(
    await handler(
        {
            method: "GET",
            url: "/voice/not-recordings",
            headers: {}
        },
        unrelatedResponse
    ),
    false
);

console.log("VOICE_G4_RD4_AUTHORIZED_LIST=PASS");
console.log("VOICE_G4_RD4_PARTIAL_EXCLUDED=PASS");
console.log("VOICE_G4_RD4_NO_INTERVAL_EXCLUDED=PASS");
console.log("VOICE_G4_RD4_INVALID_CONTRACT_EXCLUDED=PASS");
console.log("VOICE_G4_RD4_HTTP_AUTH=PASS");
console.log("VOICE_G4_RD4_RECORDING_LIST_TESTS=PASS");
