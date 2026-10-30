import assert from "node:assert/strict";

import {
    resolveSpatialPerspective
} from "../voiceSpatialPerspectiveMath.js";

function quatYawDegrees(
    degrees
) {
    const radians =
        degrees *
        Math.PI /
        180;

    const half =
        radians /
        2;

    return {
        x: 0,
        y:
            Math.sin(
                half
            ),
        z: 0,
        w:
            Math.cos(
                half
            )
    };
}

const origin = {
    x: 0,
    y: 0,
    z: 0
};

const identity = {
    x: 0,
    y: 0,
    z: 0,
    w: 1
};

function expectSector(
    speakerPosition,
    expectedSector,
    expectedAzimuth
) {
    const result =
        resolveSpatialPerspective({
            listenerPosition:
                origin,
            listenerRotation:
                identity,
            speakerPosition
        });

    assert.ok(result);
    assert.equal(
        result.sector,
        expectedSector
    );

    assert.ok(
        Math.abs(
            result.azimuthDegrees -
            expectedAzimuth
        ) <
        1e-6
    );

    return result;
}

const front =
    expectSector(
        {
            x: 0,
            y: 0,
            z: 5
        },
        "front",
        0
    );

const right =
    expectSector(
        {
            x: 5,
            y: 0,
            z: 0
        },
        "right",
        90
    );

const back =
    expectSector(
        {
            x: 0,
            y: 0,
            z: -5
        },
        "back",
        180
    );

const left =
    expectSector(
        {
            x: -5,
            y: 0,
            z: 0
        },
        "left",
        -90
    );

assert.equal(
    front.isBehind,
    false
);

assert.equal(
    back.isBehind,
    true
);

assert.ok(
    Math.abs(
        right.pan -
        1
    ) <
    1e-6
);

assert.ok(
    Math.abs(
        left.pan +
        1
    ) <
    1e-6
);

const rotatedListener =
    resolveSpatialPerspective({
        listenerPosition:
            origin,
        listenerRotation:
            quatYawDegrees(
                90
            ),
        speakerPosition: {
            x: 5,
            y: 0,
            z: 0
        }
    });

assert.ok(
    Math.abs(
        rotatedListener.azimuthDegrees
    ) <
    1e-5
);

assert.equal(
    rotatedListener.sector,
    "front"
);

const distance =
    resolveSpatialPerspective({
        listenerPosition:
            origin,
        listenerRotation:
            identity,
        speakerPosition: {
            x: 3,
            y: 4,
            z: 0
        }
    });

assert.ok(
    Math.abs(
        distance.distance -
        5
    ) <
    1e-6
);

console.log(
    "VOICE_SPATIAL_PERSPECTIVE_S3_SYNTHETIC=PASS" +
    " | front=" + front.azimuthDegrees.toFixed(1) +
    " | right=" + right.azimuthDegrees.toFixed(1) +
    " | back=" + back.azimuthDegrees.toFixed(1) +
    " | left=" + left.azimuthDegrees.toFixed(1) +
    " | rotatedListenerFront=True" +
    " | distance3_4_0=" + distance.distance.toFixed(1)
);
