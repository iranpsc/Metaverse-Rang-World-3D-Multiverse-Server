function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number)
        ? number
        : fallback;
}

function normalizeQuaternion(value = {}) {
    const x = finite(value.x);
    const y = finite(value.y);
    const z = finite(value.z);
    const w = finite(value.w, 1);

    const magnitude =
        Math.sqrt(
            x * x +
            y * y +
            z * z +
            w * w
        );

    if (
        !Number.isFinite(magnitude) ||
        magnitude <= 1e-9
    ) {
        return Object.freeze({
            x: 0,
            y: 0,
            z: 0,
            w: 1
        });
    }

    return Object.freeze({
        x: x / magnitude,
        y: y / magnitude,
        z: z / magnitude,
        w: w / magnitude
    });
}

function inverseQuaternion(value = {}) {
    const q =
        normalizeQuaternion(value);

    return Object.freeze({
        x: -q.x,
        y: -q.y,
        z: -q.z,
        w: q.w
    });
}

function rotateVectorByQuaternion(
    vector = {},
    quaternion = {}
) {
    const q =
        normalizeQuaternion(
            quaternion
        );

    const vx = finite(vector.x);
    const vy = finite(vector.y);
    const vz = finite(vector.z);

    const tx =
        2 *
        (
            q.y * vz -
            q.z * vy
        );

    const ty =
        2 *
        (
            q.z * vx -
            q.x * vz
        );

    const tz =
        2 *
        (
            q.x * vy -
            q.y * vx
        );

    return Object.freeze({
        x:
            vx +
            q.w * tx +
            (
                q.y * tz -
                q.z * ty
            ),
        y:
            vy +
            q.w * ty +
            (
                q.z * tx -
                q.x * tz
            ),
        z:
            vz +
            q.w * tz +
            (
                q.x * ty -
                q.y * tx
            )
    });
}

function subtractVector3(
    first = {},
    second = {}
) {
    return Object.freeze({
        x:
            finite(first.x) -
            finite(second.x),
        y:
            finite(first.y) -
            finite(second.y),
        z:
            finite(first.z) -
            finite(second.z)
    });
}

function vectorMagnitude(
    value = {}
) {
    const x = finite(value.x);
    const y = finite(value.y);
    const z = finite(value.z);

    return Math.sqrt(
        x * x +
        y * y +
        z * z
    );
}

function horizontalMagnitude(
    value = {}
) {
    const x = finite(value.x);
    const z = finite(value.z);

    return Math.sqrt(
        x * x +
        z * z
    );
}

function radiansToDegrees(
    radians
) {
    return (
        radians *
        180 /
        Math.PI
    );
}

function classifySector(
    azimuthDegrees
) {
    const angle =
        finite(
            azimuthDegrees
        );

    if (
        angle >= -45 &&
        angle <= 45
    ) {
        return "front";
    }

    if (
        angle > 45 &&
        angle < 135
    ) {
        return "right";
    }

    if (
        angle < -45 &&
        angle > -135
    ) {
        return "left";
    }

    return "back";
}

function resolveSpatialPerspective({
    listenerPosition,
    listenerRotation,
    speakerPosition
}) {
    if (
        !listenerPosition ||
        !listenerRotation ||
        !speakerPosition
    ) {
        return null;
    }

    const worldRelative =
        subtractVector3(
            speakerPosition,
            listenerPosition
        );

    const distance =
        vectorMagnitude(
            worldRelative
        );

    const listenerInverse =
        inverseQuaternion(
            listenerRotation
        );

    const localRelative =
        rotateVectorByQuaternion(
            worldRelative,
            listenerInverse
        );

    const horizontalDistance =
        horizontalMagnitude(
            localRelative
        );

    const azimuthRadians =
        horizontalDistance <=
            1e-9
            ? 0
            : Math.atan2(
                localRelative.x,
                localRelative.z
            );

    const azimuthDegrees =
        radiansToDegrees(
            azimuthRadians
        );

    const elevationDegrees =
        distance <=
            1e-9
            ? 0
            : radiansToDegrees(
                Math.atan2(
                    localRelative.y,
                    Math.max(
                        1e-9,
                        horizontalDistance
                    )
                )
            );

    const pan =
        horizontalDistance <=
            1e-9
            ? 0
            : Math.max(
                -1,
                Math.min(
                    1,
                    localRelative.x /
                        horizontalDistance
                )
            );

    const frontness =
        horizontalDistance <=
            1e-9
            ? 1
            : Math.max(
                -1,
                Math.min(
                    1,
                    localRelative.z /
                        horizontalDistance
                )
            );

    return Object.freeze({
        distance,
        horizontalDistance,
        azimuthDegrees,
        elevationDegrees,
        pan,
        frontness,
        isBehind:
            frontness < 0,
        sector:
            classifySector(
                azimuthDegrees
            ),
        worldRelative,
        localRelative
    });
}

export {
    normalizeQuaternion,
    inverseQuaternion,
    rotateVectorByQuaternion,
    subtractVector3,
    vectorMagnitude,
    horizontalMagnitude,
    classifySector,
    resolveSpatialPerspective
};
