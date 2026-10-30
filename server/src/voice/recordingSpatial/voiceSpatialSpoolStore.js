import {
    createHash
} from "node:crypto";

import {
    appendFile,
    mkdir
} from "node:fs/promises";

import {
    join
} from "node:path";

function cleanText(value) {
    return String(value ?? "").trim();
}

function isFiniteNumber(value) {
    return Number.isFinite(
        Number(value)
    );
}

function normalizeSpatialEvent(
    raw = {},
    serverId = ""
) {
    const event = {
        serverId:
            cleanText(
                serverId
            ),
        roomId:
            cleanText(
                raw.roomId
            ),
        gameSessionId:
            cleanText(
                raw.gameSessionId
            ),
        userId:
            cleanText(
                raw.userId
            ),
        playerId:
            cleanText(
                raw.playerId
            ),
        connectionId:
            cleanText(
                raw.connectionId
            ).toLowerCase(),
        sequence:
            Number(
                raw.sequence
            ),
        clientTimestampUnixMs:
            Number(
                raw.clientTimestampUnixMs
            ),
        serverTimestampUnixMs:
            Number(
                raw.serverTimestampUnixMs
            ),
        position: {
            x:
                Number(
                    raw.px
                ),
            y:
                Number(
                    raw.py
                ),
            z:
                Number(
                    raw.pz
                )
        },
        rotation: {
            x:
                Number(
                    raw.rx
                ),
            y:
                Number(
                    raw.ry
                ),
            z:
                Number(
                    raw.rz
                ),
            w:
                Number(
                    raw.rw
                )
        }
    };

    if (
        !event.serverId ||
        !event.roomId ||
        !event.userId ||
        !Number.isSafeInteger(
            event.sequence
        ) ||
        event.sequence <= 0 ||
        !Number.isFinite(
            event.serverTimestampUnixMs
        ) ||
        event.serverTimestampUnixMs <= 0 ||
        !isFiniteNumber(
            event.position.x
        ) ||
        !isFiniteNumber(
            event.position.y
        ) ||
        !isFiniteNumber(
            event.position.z
        ) ||
        !isFiniteNumber(
            event.rotation.x
        ) ||
        !isFiniteNumber(
            event.rotation.y
        ) ||
        !isFiniteNumber(
            event.rotation.z
        ) ||
        !isFiniteNumber(
            event.rotation.w
        )
    ) {
        return null;
    }

    return Object.freeze(
        event
    );
}

function createScopeHash(
    serverId,
    roomId
) {
    return createHash(
        "sha256"
    )
        .update(
            `${cleanText(serverId)}\n${cleanText(roomId)}`
        )
        .digest(
            "hex"
        )
        .slice(
            0,
            32
        );
}

class VoiceSpatialSpoolStore {
    constructor({
        storageRoot
    } = {}) {
        const normalizedRoot =
            cleanText(
                storageRoot
            );

        if (
            !normalizedRoot
        ) {
            throw new Error(
                "Spatial spool storageRoot is required."
            );
        }

        this.storageRoot =
            normalizedRoot;

        this.spoolRoot =
            join(
                normalizedRoot,
                ".spatial-spool"
            );

        this.writeTailByPath =
            new Map();

        this.latestByScopeUser =
            new Map();

        this.acceptedStates = 0;
        this.writtenStates = 0;
    }

    buildSpoolPath(
        serverId,
        roomId
    ) {
        return join(
            this.spoolRoot,
            `${createScopeHash(serverId, roomId)}.jsonl`
        );
    }

    buildLatestKey(
        event
    ) {
        return [
            event.serverId,
            event.roomId,
            event.userId
        ].join(
            "::"
        );
    }

    observeBatch(
        serverId,
        rawEvents = []
    ) {
        const acceptedEvents = [];

        for (
            const raw of
            Array.isArray(
                rawEvents
            )
                ? rawEvents
                : []
        ) {
            const event =
                normalizeSpatialEvent(
                    raw,
                    serverId
                );

            if (!event) {
                continue;
            }

            const key =
                this.buildLatestKey(
                    event
                );

            const previous =
                this.latestByScopeUser
                    .get(
                        key
                    );

            if (
                previous &&
                Number(
                    previous.sequence
                ) >=
                    event.sequence &&
                Number(
                    previous
                        .serverTimestampUnixMs
                ) >=
                    event
                        .serverTimestampUnixMs
            ) {
                continue;
            }

            this.latestByScopeUser
                .set(
                    key,
                    event
                );

            acceptedEvents.push(
                event
            );

            this.acceptedStates += 1;
        }

        if (
            acceptedEvents.length >
            0
        ) {
            this.queueAppend(
                acceptedEvents
            );
        }

        return Object.freeze({
            accepted:
                acceptedEvents.length,
            written:
                acceptedEvents.length
        });
    }

    queueAppend(
        events
    ) {
        const grouped =
            new Map();

        for (
            const event of events
        ) {
            const path =
                this.buildSpoolPath(
                    event.serverId,
                    event.roomId
                );

            let list =
                grouped.get(
                    path
                );

            if (!list) {
                list = [];
                grouped.set(
                    path,
                    list
                );
            }

            list.push(
                event
            );
        }

        for (
            const [
                path,
                list
            ] of grouped
        ) {
            const previous =
                this.writeTailByPath
                    .get(
                        path
                    ) ??
                Promise.resolve();

            const next =
                previous
                    .catch(
                        () => {}
                    )
                    .then(
                        async () => {
                            await mkdir(
                                this.spoolRoot,
                                {
                                    recursive:
                                        true,
                                    mode:
                                        0o750
                                }
                            );

                            const text =
                                list.map(
                                    (event) =>
                                        JSON.stringify(
                                            event
                                        )
                                ).join(
                                    "\n"
                                ) +
                                "\n";

                            await appendFile(
                                path,
                                text,
                                {
                                    encoding:
                                        "utf8",
                                    mode:
                                        0o640
                                }
                            );

                            this.writtenStates +=
                                list.length;
                        }
                    )
                    .catch(
                        (error) => {
                            console.error(
                                "VOICE_SPATIAL_SPOOL_WRITE=FAIL",
                                error
                            );

                            throw error;
                        }
                    );

            this.writeTailByPath
                .set(
                    path,
                    next
                );
        }
    }

    async flush() {
        await Promise.allSettled(
            Array.from(
                this.writeTailByPath
                    .values()
            )
        );
    }

    getStats() {
        return Object.freeze({
            acceptedStates:
                this.acceptedStates,
            writtenStates:
                this.writtenStates,
            trackedUsers:
                this.latestByScopeUser
                    .size,
            pendingFiles:
                this.writeTailByPath
                    .size
        });
    }
}

export {
    VoiceSpatialSpoolStore,
    normalizeSpatialEvent,
    createScopeHash
};
