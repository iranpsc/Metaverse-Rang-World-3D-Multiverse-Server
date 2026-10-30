import {
    readFile
} from "node:fs/promises";

function cleanText(value) {
    return String(value ?? "").trim();
}

function finiteNumber(value, fallback = null) {
    const numeric = Number(value);
    return Number.isFinite(numeric)
        ? numeric
        : fallback;
}

function normalizeVector3(value = {}) {
    const x = finiteNumber(value.x);
    const y = finiteNumber(value.y);
    const z = finiteNumber(value.z);

    if (
        x === null ||
        y === null ||
        z === null
    ) {
        return null;
    }

    return Object.freeze({
        x,
        y,
        z
    });
}

function normalizeQuaternion(value = {}) {
    const x = finiteNumber(value.x);
    const y = finiteNumber(value.y);
    const z = finiteNumber(value.z);
    const w = finiteNumber(value.w);

    if (
        x === null ||
        y === null ||
        z === null ||
        w === null
    ) {
        return null;
    }

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
        return null;
    }

    return Object.freeze({
        x: x / magnitude,
        y: y / magnitude,
        z: z / magnitude,
        w: w / magnitude
    });
}

function normalizeSpatialState(entry = {}) {
    if (
        entry?.type !==
        "spatial_state"
    ) {
        return null;
    }

    const userId =
        cleanText(
            entry.userId
        );

    const relativeMs =
        finiteNumber(
            entry.relativeMs
        );

    const atMs =
        finiteNumber(
            entry.atMs
        );

    const position =
        normalizeVector3(
            entry.position
        );

    const rotation =
        normalizeQuaternion(
            entry.rotation
        );

    const sequence =
        finiteNumber(
            entry.sequence,
            0
        );

    if (
        !userId ||
        relativeMs === null ||
        relativeMs < 0 ||
        atMs === null ||
        !position ||
        !rotation
    ) {
        return null;
    }

    return Object.freeze({
        userId,
        playerId:
            cleanText(
                entry.playerId
            ),
        connectionId:
            cleanText(
                entry.connectionId
            ).toLowerCase(),
        gameSessionId:
            cleanText(
                entry.gameSessionId
            ),
        sequence,
        atMs,
        relativeMs,
        sourceServerTimestampUnixMs:
            finiteNumber(
                entry.sourceServerTimestampUnixMs,
                atMs
            ),
        sourceClientTimestampUnixMs:
            finiteNumber(
                entry.sourceClientTimestampUnixMs,
                0
            ),
        seed:
            entry.seed === true,
        position,
        rotation
    });
}

class VoiceSpatialTimelineReader {
    constructor({
        maximumInvalidLines = 64
    } = {}) {
        this.maximumInvalidLines =
            Math.max(
                0,
                Number(
                    maximumInvalidLines
                ) || 0
            );
    }

    async readFile(
        filePath
    ) {
        const text =
            await readFile(
                filePath,
                "utf8"
            );

        return this.parseText(
            text,
            {
                filePath
            }
        );
    }

    parseText(
        text,
        {
            filePath = ""
        } = {}
    ) {
        const lines =
            String(
                text ?? ""
            ).split(/\r?\n/u);

        const statesByUserId =
            new Map();

        const invalidLines = [];

        let header = null;
        let footer = null;
        let parsedLines = 0;
        let stateLines = 0;

        for (
            let index = 0;
            index < lines.length;
            index += 1
        ) {
            const rawLine =
                lines[index].trim();

            if (!rawLine) {
                continue;
            }

            let entry;

            try {
                entry =
                    JSON.parse(
                        rawLine
                    );
            } catch {
                if (
                    invalidLines.length <
                    this.maximumInvalidLines
                ) {
                    invalidLines.push({
                        lineNumber:
                            index + 1,
                        reason:
                            "invalid_json"
                    });
                }

                continue;
            }

            parsedLines += 1;

            if (
                entry?.type ===
                "spatial_timeline_start"
            ) {
                header =
                    Object.freeze({
                        ...entry
                    });

                continue;
            }

            if (
                entry?.type ===
                "spatial_timeline_end"
            ) {
                footer =
                    Object.freeze({
                        ...entry
                    });

                continue;
            }

            if (
                entry?.type !==
                "spatial_state"
            ) {
                continue;
            }

            const state =
                normalizeSpatialState(
                    entry
                );

            if (!state) {
                if (
                    invalidLines.length <
                    this.maximumInvalidLines
                ) {
                    invalidLines.push({
                        lineNumber:
                            index + 1,
                        reason:
                            "invalid_spatial_state"
                    });
                }

                continue;
            }

            let userStates =
                statesByUserId.get(
                    state.userId
                );

            if (!userStates) {
                userStates = [];
                statesByUserId.set(
                    state.userId,
                    userStates
                );
            }

            userStates.push(
                state
            );

            stateLines += 1;
        }

        for (
            const userStates of
            statesByUserId.values()
        ) {
            userStates.sort(
                (first, second) => {
                    if (
                        first.relativeMs !==
                        second.relativeMs
                    ) {
                        return (
                            first.relativeMs -
                            second.relativeMs
                        );
                    }

                    return (
                        first.sequence -
                        second.sequence
                    );
                }
            );
        }

        return Object.freeze({
            filePath:
                cleanText(
                    filePath
                ),
            header,
            footer,
            parsedLines,
            stateLines,
            invalidLines:
                Object.freeze(
                    invalidLines
                ),
            statesByUserId
        });
    }
}

export {
    VoiceSpatialTimelineReader,
    normalizeSpatialState,
    normalizeVector3,
    normalizeQuaternion
};
