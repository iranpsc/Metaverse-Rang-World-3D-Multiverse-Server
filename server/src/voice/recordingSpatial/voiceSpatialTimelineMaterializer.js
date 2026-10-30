import {
    createReadStream
} from "node:fs";

import {
    access,
    mkdir,
    rename,
    stat,
    writeFile
} from "node:fs/promises";

import {
    createInterface
} from "node:readline";

import {
    dirname,
    join
} from "node:path";

import {
    createScopeHash
} from "./voiceSpatialSpoolStore.js";

function cleanText(value) {
    return String(value ?? "").trim();
}

async function pathExists(
    path
) {
    try {
        await access(
            path
        );
        return true;
    } catch {
        return false;
    }
}

function normalizeParticipantUserIds(
    metadata
) {
    return new Set(
        (
            Array.isArray(
                metadata?.participants
            )
                ? metadata.participants
                : []
        )
            .map(
                (participant) =>
                    cleanText(
                        participant
                            ?.userId
                    )
            )
            .filter(
                Boolean
            )
    );
}

function normalizeSpoolEvent(
    value
) {
    if (
        !value ||
        typeof value !==
            "object"
    ) {
        return null;
    }

    const event = {
        serverId:
            cleanText(
                value.serverId
            ),
        roomId:
            cleanText(
                value.roomId
            ),
        gameSessionId:
            cleanText(
                value.gameSessionId
            ),
        userId:
            cleanText(
                value.userId
            ),
        playerId:
            cleanText(
                value.playerId
            ),
        connectionId:
            cleanText(
                value.connectionId
            ).toLowerCase(),
        sequence:
            Number(
                value.sequence
            ),
        clientTimestampUnixMs:
            Number(
                value.clientTimestampUnixMs
            ),
        serverTimestampUnixMs:
            Number(
                value.serverTimestampUnixMs
            ),
        position:
            value.position,
        rotation:
            value.rotation
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
        event.serverTimestampUnixMs <= 0
    ) {
        return null;
    }

    return event;
}

async function ensureSessionSpatialTimeline({
    storageRoot,
    sessionDirectory,
    metadata
} = {}) {
    const normalizedStorageRoot =
        cleanText(
            storageRoot
        );

    const normalizedSessionDirectory =
        cleanText(
            sessionDirectory
        );

    const sessionId =
        cleanText(
            metadata?.sessionId
        ).toLowerCase();

    const serverId =
        cleanText(
            metadata?.serverId
        );

    const roomId =
        cleanText(
            metadata?.roomId
        );

    const startedAtMs =
        Number(
            metadata?.startedAtMs
        );

    const endedAtMs =
        Number(
            metadata?.endedAtMs
        );

    if (
        !normalizedStorageRoot ||
        !normalizedSessionDirectory ||
        !sessionId ||
        !serverId ||
        !roomId ||
        !Number.isFinite(
            startedAtMs
        ) ||
        !Number.isFinite(
            endedAtMs
        ) ||
        endedAtMs <
            startedAtMs
    ) {
        throw new Error(
            "Spatial timeline materializer metadata is invalid."
        );
    }

    const targetPath =
        join(
            normalizedSessionDirectory,
            "spatial-timeline.jsonl"
        );

    if (
        await pathExists(
            targetPath
        )
    ) {
        const existing =
            await stat(
                targetPath
            );

        if (
            existing.isFile() &&
            existing.size >
                0
        ) {
            return Object.freeze({
                path:
                    targetPath,
                reused:
                    true
            });
        }
    }

    const participantUserIds =
        normalizeParticipantUserIds(
            metadata
        );

    if (
        participantUserIds.size ===
        0
    ) {
        throw new Error(
            "Spatial timeline materializer has no session participants."
        );
    }

    const spoolPath =
        join(
            normalizedStorageRoot,
            ".spatial-spool",
            `${createScopeHash(serverId, roomId)}.jsonl`
        );

    if (
        !await pathExists(
            spoolPath
        )
    ) {
        throw new Error(
            "Spatial spool file is missing for this recording."
        );
    }

    const latestBeforeStart =
        new Map();

    const selected =
        [];

    const lines =
        createInterface({
            input:
                createReadStream(
                    spoolPath,
                    {
                        encoding:
                            "utf8"
                    }
                ),
            crlfDelay:
                Infinity
        });

    for await (
        const rawLine of lines
    ) {
        const line =
            String(
                rawLine ??
                ""
            ).trim();

        if (!line) {
            continue;
        }

        let parsed;

        try {
            parsed =
                JSON.parse(
                    line
                );
        } catch {
            continue;
        }

        const event =
            normalizeSpoolEvent(
                parsed
            );

        if (
            !event ||
            event.serverId !==
                serverId ||
            event.roomId !==
                roomId ||
            !participantUserIds
                .has(
                    event.userId
                )
        ) {
            continue;
        }

        if (
            event
                .serverTimestampUnixMs <
            startedAtMs
        ) {
            const previous =
                latestBeforeStart
                    .get(
                        event.userId
                    );

            if (
                !previous ||
                previous
                    .serverTimestampUnixMs <
                    event
                        .serverTimestampUnixMs
            ) {
                latestBeforeStart
                    .set(
                        event.userId,
                        event
                    );
            }

            continue;
        }

        if (
            event
                .serverTimestampUnixMs >
            endedAtMs
        ) {
            continue;
        }

        selected.push(
            event
        );
    }

    const output = [];

    output.push({
        type:
            "spatial_timeline_start",
        version:
            2,
        sessionId,
        roomId,
        serverId,
        startedAtMs,
        participantUserIds:
            Array.from(
                participantUserIds
            ),
        source:
            "passive_spool"
    });

    for (
        const userId of
        participantUserIds
    ) {
        const seed =
            latestBeforeStart
                .get(
                    userId
                );

        if (!seed) {
            continue;
        }

        output.push(
            toTimelineState({
                sessionId,
                event:
                    seed,
                atMs:
                    startedAtMs,
                startedAtMs,
                seed:
                    true
            })
        );
    }

    selected.sort(
        (
            left,
            right
        ) =>
            left
                .serverTimestampUnixMs -
                right
                    .serverTimestampUnixMs ||
            left.sequence -
                right.sequence
    );

    for (
        const event of
        selected
    ) {
        output.push(
            toTimelineState({
                sessionId,
                event,
                atMs:
                    event
                        .serverTimestampUnixMs,
                startedAtMs,
                seed:
                    false
            })
        );
    }

    if (
        output.length ===
        1
    ) {
        throw new Error(
            "Spatial spool has no usable state for this recording."
        );
    }

    output.push({
        type:
            "spatial_timeline_end",
        endedAtMs,
        relativeMs:
            Math.max(
                0,
                endedAtMs -
                    startedAtMs
            ),
        source:
            "passive_spool"
    });

    await mkdir(
        dirname(
            targetPath
        ),
        {
            recursive:
                true
        }
    );

    const tempPath =
        `${targetPath}.tmp-${process.pid}-${Date.now()}`;

    await writeFile(
        tempPath,
        output.map(
            (entry) =>
                JSON.stringify(
                    entry
                )
        ).join(
            "\n"
        ) +
        "\n",
        {
            encoding:
                "utf8",
            mode:
                0o640
        }
    );

    await rename(
        tempPath,
        targetPath
    );

    return Object.freeze({
        path:
            targetPath,
        reused:
            false,
        records:
            output.length
    });
}

function toTimelineState({
    sessionId,
    event,
    atMs,
    startedAtMs,
    seed
}) {
    return {
        type:
            "spatial_state",
        sessionId,
        atMs,
        relativeMs:
            Math.max(
                0,
                atMs -
                    startedAtMs
            ),
        sourceServerTimestampUnixMs:
            event
                .serverTimestampUnixMs,
        sourceClientTimestampUnixMs:
            event
                .clientTimestampUnixMs,
        seed:
            seed ===
            true,
        userId:
            event.userId,
        playerId:
            event.playerId,
        connectionId:
            event.connectionId,
        gameSessionId:
            event
                .gameSessionId,
        sequence:
            event.sequence,
        position:
            event.position,
        rotation:
            event.rotation
    };
}

export {
    ensureSessionSpatialTimeline
};
