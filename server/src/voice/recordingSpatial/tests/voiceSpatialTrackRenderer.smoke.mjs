import assert from "node:assert/strict";

import {
    mkdtemp,
    rm,
    stat
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
    VoiceSpatialTimelineReader
} from "../voiceSpatialTimelineReader.js";

import {
    VoiceSpatialTimelineSampler
} from "../voiceSpatialTimelineSampler.js";

import {
    VoiceSpatialTrackRenderer
} from "../voiceSpatialTrackRenderer.js";

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
            "vme2-s4-"
        )
    );

try {
    const inputPath =
        join(
            root,
            "speaker.ogg"
        );

    const outputPath =
        join(
            root,
            "speaker-for-listener.ogg"
        );

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
            "sine=frequency=700:sample_rate=48000:duration=2",
            "-ac", "1",
            "-ar", "48000",
            "-c:a", "libopus",
            "-b:a", "32000",
            inputPath
        ]
    );

    const events = [
        {
            t: 0,
            userId:
                "listener",
            p:
                [0, 0, 0],
            q:
                [0, 0, 0, 1]
        },
        {
            t: 2000,
            userId:
                "listener",
            p:
                [0, 0, 0],
            q:
                [0, 0, 0, 1]
        },
        {
            t: 0,
            userId:
                "speaker",
            p:
                [0, 0, 2],
            q:
                [0, 0, 0, 1]
        },
        {
            t: 500,
            userId:
                "speaker",
            p:
                [2, 0, 0],
            q:
                [0, 0, 0, 1]
        },
        {
            t: 1000,
            userId:
                "speaker",
            p:
                [0, 0, -2],
            q:
                [0, 0, 0, 1]
        },
        {
            t: 1500,
            userId:
                "speaker",
            p:
                [-2, 0, 0],
            q:
                [0, 0, 0, 1]
        },
        {
            t: 2000,
            userId:
                "speaker",
            p:
                [0, 0, 2],
            q:
                [0, 0, 0, 1]
        }
    ];

    const lines = [
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
        ...events.map(
            (
                event,
                index
            ) =>
                JSON.stringify({
                    type:
                        "spatial_state",
                    sessionId:
                        "session-test",
                    atMs:
                        100000 +
                        event.t,
                    relativeMs:
                        event.t,
                    seed:
                        event.t ===
                            0,
                    userId:
                        event.userId,
                    sequence:
                        index + 1,
                    position: {
                        x:
                            event.p[0],
                        y:
                            event.p[1],
                        z:
                            event.p[2]
                    },
                    rotation: {
                        x:
                            event.q[0],
                        y:
                            event.q[1],
                        z:
                            event.q[2],
                        w:
                            event.q[3]
                    }
                })
        ),
        JSON.stringify({
            type:
                "spatial_timeline_end",
            endedAtMs:
                102000
        })
    ];

    const reader =
        new VoiceSpatialTimelineReader();

    const timeline =
        reader.parseText(
            lines.join(
                "\n"
            )
        );

    const sampler =
        new VoiceSpatialTimelineSampler(
            timeline,
            {
                maximumInterpolationGapMs:
                    1000,
                maximumHoldMs:
                    1000
            }
        );

    const renderer =
        new VoiceSpatialTrackRenderer({
            sampler
        });

    const result =
        await renderer.render({
            inputPath,
            outputPath,
            listenerUserId:
                "listener",
            speakerUserId:
                "speaker",
            durationMs:
                2000
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
                    outputPath
                ]
            )
        );

    const outputStat =
        await stat(
            outputPath
        );

    assert.ok(
        outputStat.size >
        1000
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
        result.frontFrames >
        0
    );

    assert.ok(
        result.rightFrames >
        0
    );

    assert.ok(
        result.backFrames >
        0
    );

    assert.ok(
        result.leftFrames >
        0
    );

    console.log(
        "VOICE_SPATIAL_TRACK_RENDERER_S4_SYNTHETIC=PASS" +
        " | sampleRate=" +
        info.streams[0].sample_rate +
        " | channels=" +
        info.streams[0].channels +
        " | frontFrames=" +
        result.frontFrames +
        " | rightFrames=" +
        result.rightFrames +
        " | backFrames=" +
        result.backFrames +
        " | leftFrames=" +
        result.leftFrames +
        " | outputBytes=" +
        outputStat.size
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
