import assert from "node:assert/strict";

import {
    PERSONAL_SPATIAL_PATH_PATTERN,
    buildSpatialSignature
} from "../voicePersonalSpatialDownloadStartupHook.js";

const valid =
    "/voice/recordings/11111111-1111-4111-8111-111111111111/download/personal-spatial";

const match =
    PERSONAL_SPATIAL_PATH_PATTERN.exec(
        valid
    );

assert.ok(match);
assert.equal(
    match[1],
    "11111111-1111-4111-8111-111111111111"
);

assert.equal(
    PERSONAL_SPATIAL_PATH_PATTERN.test(
        "/voice/recordings/11111111-1111-4111-8111-111111111111/download"
    ),
    false
);

const signatureA =
    buildSpatialSignature({
        metadata: {
            sessionId:
                "11111111-1111-4111-8111-111111111111",
            checksumSha256:
                "abc"
        },
        listenerUserId:
            "user-a",
        timelineStat: {
            size:
                1234,
            mtimeMs:
                1000
        },
        directionalPlan: {
            blockedIntervalsBySenderConnectionId:
                new Map([
                    [
                        "conn-b",
                        [
                            {
                                startOffsetMs:
                                    100,
                                endOffsetMs:
                                    200
                            }
                        ]
                    ]
                ])
        },
        authorizedIntervals: [
            {
                startOffsetMs:
                    0,
                endOffsetMs:
                    1000
            }
        ]
    });

const signatureB =
    buildSpatialSignature({
        metadata: {
            sessionId:
                "11111111-1111-4111-8111-111111111111",
            checksumSha256:
                "abc"
        },
        listenerUserId:
            "user-b",
        timelineStat: {
            size:
                1234,
            mtimeMs:
                1000
        },
        directionalPlan: {
            blockedIntervalsBySenderConnectionId:
                new Map()
        },
        authorizedIntervals: [
            {
                startOffsetMs:
                    0,
                endOffsetMs:
                    1000
            }
        ]
    });

assert.notEqual(
    signatureA,
    signatureB
);

console.log(
    "VOICE_PERSONAL_SPATIAL_DOWNLOAD_S6_SYNTHETIC=PASS" +
    " | routeMatch=True" +
    " | normalDownloadUntouched=True" +
    " | cacheSignaturePerListener=True"
);
