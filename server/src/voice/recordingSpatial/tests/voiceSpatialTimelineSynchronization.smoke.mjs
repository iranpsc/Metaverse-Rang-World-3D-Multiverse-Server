import assert from "node:assert/strict";

import {
    VoiceSpatialTimelineReader
} from "../voiceSpatialTimelineReader.js";

import {
    VoiceSpatialTimelineSampler
} from "../voiceSpatialTimelineSampler.js";

const timelineText = [
    JSON.stringify({
        type:
            "spatial_timeline_start",
        version:
            1,
        sessionId:
            "session-test",
        roomId:
            "room-test",
        serverId:
            "server-test",
        startedAtMs:
            100000
    }),
    JSON.stringify({
        type:
            "spatial_state",
        sessionId:
            "session-test",
        atMs:
            100000,
        relativeMs:
            0,
        seed:
            true,
        userId:
            "user-a",
        sequence:
            1,
        position: {
            x: 0,
            y: 0,
            z: 0
        },
        rotation: {
            x: 0,
            y: 0,
            z: 0,
            w: 1
        }
    }),
    JSON.stringify({
        type:
            "spatial_state",
        sessionId:
            "session-test",
        atMs:
            100100,
        relativeMs:
            100,
        seed:
            false,
        userId:
            "user-a",
        sequence:
            2,
        position: {
            x: 10,
            y: 0,
            z: 0
        },
        rotation: {
            x: 0,
            y: 0.7071067811865475,
            z: 0,
            w: 0.7071067811865476
        }
    }),
    JSON.stringify({
        type:
            "spatial_state",
        sessionId:
            "session-test",
        atMs:
            100000,
        relativeMs:
            0,
        seed:
            true,
        userId:
            "user-b",
        sequence:
            1,
        position: {
            x: 0,
            y: 0,
            z: 5
        },
        rotation: {
            x: 0,
            y: 0,
            z: 0,
            w: 1
        }
    }),
    JSON.stringify({
        type:
            "spatial_timeline_end",
        endedAtMs:
            101000
    })
].join("\n");

const reader =
    new VoiceSpatialTimelineReader();

const timeline =
    reader.parseText(
        timelineText
    );

assert.equal(
    timeline.stateLines,
    3
);

assert.equal(
    timeline.statesByUserId.size,
    2
);

const sampler =
    new VoiceSpatialTimelineSampler(
        timeline,
        {
            maximumInterpolationGapMs:
                500,
            maximumHoldMs:
                1000
        }
    );

const a0 =
    sampler.sampleUser(
        "user-a",
        0
    );

assert.ok(a0);
assert.equal(
    a0.position.x,
    0
);
assert.equal(
    a0.forward.z,
    1
);

const a50 =
    sampler.sampleUser(
        "user-a",
        50
    );

assert.ok(a50);
assert.equal(
    a50.mode,
    "interpolated"
);

assert.ok(
    Math.abs(
        a50.position.x -
        5
    ) <
    1e-6
);

assert.ok(
    Math.abs(
        a50.forward.x -
        Math.SQRT1_2
    ) <
    1e-5
);

assert.ok(
    Math.abs(
        a50.forward.z -
        Math.SQRT1_2
    ) <
    1e-5
);

const b500 =
    sampler.sampleUser(
        "user-b",
        500
    );

assert.ok(b500);
assert.equal(
    b500.mode,
    "hold_last"
);
assert.equal(
    b500.position.z,
    5
);

assert.equal(
    sampler.audioCapturedAtToRelativeMs(
        100420,
        100000
    ),
    420
);

assert.equal(
    sampler.audioFrameIndexToRelativeMs(
        21
    ),
    420
);

const all50 =
    sampler.sampleAll(
        50
    );

assert.equal(
    all50.size,
    2
);

console.log(
    "VOICE_SPATIAL_TIMELINE_S2_SYNTHETIC=PASS" +
    " | users=" + all50.size +
    " | interpolation=user-a@50ms" +
    " | audioAlignment=420ms" +
    " | quaternionSlerp=True"
);
