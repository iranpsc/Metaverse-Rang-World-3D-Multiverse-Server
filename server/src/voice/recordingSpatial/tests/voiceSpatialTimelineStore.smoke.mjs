import {
    mkdtemp,
    readFile,
    rm
} from "node:fs/promises";

import {
    tmpdir
} from "node:os";

import {
    join
} from "node:path";

import {
    VoiceSpatialTimelineStore
} from "../voiceSpatialTimelineStore.js";

const root =
    await mkdtemp(
        join(
            tmpdir(),
            "vme2-spatial-timeline-"
        )
    );

try {
    const store =
        new VoiceSpatialTimelineStore();

    const serverId =
        "ds_test";

    const roomId =
        "room_test";

    const userA =
        "user-a";

    const userB =
        "user-b";

    store.observeBatch(
        serverId,
        [
            {
                roomId,
                gameSessionId:
                    "game-session-test",
                userId:
                    userA,
                playerId:
                    userA,
                connectionId:
                    "conn-a",
                sequence:
                    1,
                clientTimestampUnixMs:
                    1000,
                serverTimestampUnixMs:
                    2000,
                px: 0,
                py: 1,
                pz: 0,
                rx: 0,
                ry: 0,
                rz: 0,
                rw: 1
            },
            {
                roomId,
                gameSessionId:
                    "game-session-test",
                userId:
                    userB,
                playerId:
                    userB,
                connectionId:
                    "conn-b",
                sequence:
                    1,
                clientTimestampUnixMs:
                    1001,
                serverTimestampUnixMs:
                    2001,
                px: 2,
                py: 1,
                pz: 3,
                rx: 0,
                ry: 0.7071067,
                rz: 0,
                rw: 0.7071067
            }
        ]
    );

    const sessionId =
        "11111111-1111-4111-8111-111111111111";

    await store.startRecording({
        storageRoot:
            root,
        sessionId,
        roomId,
        serverId,
        startedAtMs:
            2500,
        participantUserIds:
            new Set(
                [
                    userA,
                    userB
                ]
            )
    });

    store.observeBatch(
        serverId,
        [
            {
                roomId,
                gameSessionId:
                    "game-session-test",
                userId:
                    userB,
                playerId:
                    userB,
                connectionId:
                    "conn-b",
                sequence:
                    2,
                clientTimestampUnixMs:
                    2600,
                serverTimestampUnixMs:
                    2605,
                px: 4,
                py: 1,
                pz: 3,
                rx: 0,
                ry: 1,
                rz: 0,
                rw: 0
            }
        ]
    );

    const stopped =
        await store.stopRecording(
            sessionId,
            "smoke"
        );

    const text =
        await readFile(
            stopped.filePath,
            "utf8"
        );

    const lines =
        text
            .trim()
            .split("\n")
            .map(
                (line) =>
                    JSON.parse(line)
            );

    const states =
        lines.filter(
            (entry) =>
                entry.type ===
                "spatial_state"
        );

    if (
        states.length !==
        3
    ) {
        throw new Error(
            "Expected exactly 3 spatial_state lines."
        );
    }

    if (
        states[0].seed !==
            true ||
        states[0].relativeMs !==
            0 ||
        states[1].seed !==
            true ||
        states[1].relativeMs !==
            0
    ) {
        throw new Error(
            "Seed state alignment failed."
        );
    }

    if (
        states[2].userId !==
            userB ||
        states[2].relativeMs !==
            105
    ) {
        throw new Error(
            "Runtime state alignment failed."
        );
    }

    console.log(
        "VOICE_SPATIAL_TIMELINE_S1_SYNTHETIC=PASS" +
        " | states=" + states.length +
        " | file=" + stopped.filePath
    );
} finally {
    await rm(
        root,
        {
            recursive: true,
            force: true
        }
    );
}
