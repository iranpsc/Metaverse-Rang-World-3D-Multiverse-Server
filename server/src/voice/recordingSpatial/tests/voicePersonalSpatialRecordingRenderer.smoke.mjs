import assert from "node:assert/strict";

import {
    mkdtemp,
    mkdir,
    rm,
    writeFile
} from "node:fs/promises";

import {
    spawn
} from "node:child_process";

import {
    once
} from "node:events";

import {
    join
} from "node:path";

import {
    tmpdir
} from "node:os";

import {
    VoicePersonalSpatialRecordingRenderer
} from "../voicePersonalSpatialRecordingRenderer.js";

async function run(
    command,
    args
) {
    const child =
        spawn(
            command,
            args,
            {
                stdio:
                    [
                        "ignore",
                        "pipe",
                        "pipe"
                    ]
            }
        );

    let stdout = "";
    let stderr = "";

    child.stdout.on(
        "data",
        (chunk) => {
            stdout += chunk;
        }
    );

    child.stderr.on(
        "data",
        (chunk) => {
            stderr += chunk;
        }
    );

    const [code] =
        await once(
            child,
            "exit"
        );

    if (
        code !== 0
    ) {
        throw new Error(
            command +
            " failed: " +
            stderr
        );
    }

    return stdout;
}

const root =
    await mkdtemp(
        join(
            tmpdir(),
            "vme2-s5-"
        )
    );

try {
    const sessionId =
        "11111111-1111-4111-8111-111111111111";

    const sessionDirectory =
        join(
            root,
            sessionId
        );

    const participantDirectory =
        join(
            sessionDirectory,
            "participants"
        );

    await mkdir(
        participantDirectory,
        {
            recursive: true
        }
    );

    const participants = [
        {
            userId:
                "listener",
            connectionId:
                "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            frequency:
                440
        },
        {
            userId:
                "speaker",
            connectionId:
                "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            frequency:
                700
        }
    ];

    for (
        const participant of
        participants
    ) {
        await run(
            process.env
                .VOICE_RECORDING_FFMPEG_PATH ||
                "ffmpeg",
            [
                "-hide_banner",
                "-nostdin",
                "-loglevel", "error",
                "-y",
                "-f", "lavfi",
                "-i",
                `sine=frequency=${participant.frequency}:sample_rate=48000:duration=2`,
                "-ac", "1",
                "-ar", "48000",
                "-c:a", "libopus",
                "-b:a", "32000",
                join(
                    participantDirectory,
                    participant.connectionId +
                        ".ogg"
                )
            ]
        );
    }

    await writeFile(
        join(
            sessionDirectory,
            "session.json"
        ),
        JSON.stringify(
            {
                version:
                    2,
                recordingContract:
                    "G4.RD1",
                sessionId,
                startedAtMs:
                    100000,
                endedAtMs:
                    102000,
                durationMs:
                    2000,
                participants:
                    participants.map(
                        (participant) => ({
                            userId:
                                participant.userId,
                            connectionId:
                                participant.connectionId
                        })
                    )
            },
            null,
            2
        )
    );

    const timelineLines = [
        {
            type:
                "spatial_timeline_start",
            version:
                1,
            sessionId,
            roomId:
                "room-test",
            serverId:
                "server-test",
            startedAtMs:
                100000
        },
        {
            type:
                "spatial_state",
            sessionId,
            atMs:
                100000,
            relativeMs:
                0,
            userId:
                "listener",
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
        },
        {
            type:
                "spatial_state",
            sessionId,
            atMs:
                102000,
            relativeMs:
                2000,
            userId:
                "listener",
            sequence:
                2,
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
        },
        {
            type:
                "spatial_state",
            sessionId,
            atMs:
                100000,
            relativeMs:
                0,
            userId:
                "speaker",
            sequence:
                1,
            position: {
                x: 2,
                y: 0,
                z: 0
            },
            rotation: {
                x: 0,
                y: 0,
                z: 0,
                w: 1
            }
        },
        {
            type:
                "spatial_state",
            sessionId,
            atMs:
                102000,
            relativeMs:
                2000,
            userId:
                "speaker",
            sequence:
                2,
            position: {
                x: -2,
                y: 0,
                z: 0
            },
            rotation: {
                x: 0,
                y: 0,
                z: 0,
                w: 1
            }
        },
        {
            type:
                "spatial_timeline_end",
            endedAtMs:
                102000
        }
    ];

    await writeFile(
        join(
            sessionDirectory,
            "spatial-timeline.jsonl"
        ),
        timelineLines.map(
            (entry) =>
                JSON.stringify(
                    entry
                )
        ).join(
            "\n"
        ) +
        "\n"
    );

    const renderer =
        new VoicePersonalSpatialRecordingRenderer({
            storageRoot:
                root
        });

    const result =
        await renderer.render({
            sessionId,
            listenerUserId:
                "listener"
        });

    const info =
        JSON.parse(
            await run(
                "ffprobe",
                [
                    "-v", "error",
                    "-select_streams",
                    "a:0",
                    "-show_entries",
                    "stream=sample_rate,channels",
                    "-show_entries",
                    "format=duration",
                    "-of", "json",
                    result.outputPath
                ]
            )
        );

    assert.equal(
        result.participantTrackCount,
        2
    );

    assert.equal(
        Number(
            info.streams[0]
                .sample_rate
        ),
        48000
    );

    assert.equal(
        Number(
            info.streams[0]
                .channels
        ),
        2
    );

    assert.ok(
        Number(
            info.format.duration
        ) >
        1.8
    );

    assert.ok(
        result.outputBytes >
        1000
    );

    console.log(
        "VOICE_PERSONAL_SPATIAL_OGG_S5_SYNTHETIC=PASS" +
        " | participantTracks=" +
        result.participantTrackCount +
        " | channels=" +
        info.streams[0].channels +
        " | sampleRate=" +
        info.streams[0].sample_rate +
        " | outputBytes=" +
        result.outputBytes
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
