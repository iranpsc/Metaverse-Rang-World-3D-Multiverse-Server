import "dotenv/config";

import {
    createHash
} from "node:crypto";

import {
    readFile,
    readdir,
    writeFile
} from "node:fs/promises";

import {
    join
} from "node:path";

import {
    tokenService
} from "../../../core/auth/auth.instance.js";

const storageRoot =
    String(
        process.env.METAVERSE_VOICE_RECORDING_STORAGE_ROOT ??
        "/home/world3d/data/metaverse-voice-recordings"
    ).trim();

const requestedSessionId =
    String(process.env.SID ?? "")
        .trim()
        .toLowerCase();

const baseUrl =
    String(
        process.env.VOICE_PRIMARY_DOWNLOAD_TEST_BASE_URL ??
        "http://127.0.0.1:8080"
    ).replace(/\/+$/, "");

async function selectSession() {
    if (requestedSessionId) {
        const metadata = JSON.parse(
            await readFile(
                join(
                    storageRoot,
                    requestedSessionId,
                    "session.json"
                ),
                "utf8"
            )
        );

        return metadata;
    }

    const entries =
        await readdir(
            storageRoot,
            {
                withFileTypes: true
            }
        );

    const sessions = [];

    for (const entry of entries) {
        if (
            !entry.isDirectory() ||
            entry.name.startsWith(".")
        ) {
            continue;
        }

        try {
            const metadata = JSON.parse(
                await readFile(
                    join(
                        storageRoot,
                        entry.name,
                        "session.json"
                    ),
                    "utf8"
                )
            );

            if (
                metadata?.sessionId &&
                Number.isFinite(
                    Number(metadata?.endedAtMs)
                )
            ) {
                sessions.push(metadata);
            }
        } catch {
        }
    }

    sessions.sort(
        (left, right) =>
            Number(right.endedAtMs) -
            Number(left.endedAtMs)
    );

    if (!sessions.length) {
        throw new Error(
            "No completed Voice recording session found."
        );
    }

    return sessions[0];
}

const metadata =
    await selectSession();

const participant =
    metadata?.participants?.find?.(
        (item) =>
            String(item?.userId ?? "").trim()
    );

if (!participant?.userId) {
    throw new Error(
        "Selected session has no participant userId."
    );
}

const token =
    tokenService.createAccessToken({
        id: participant.userId
    });

const url =
    `${baseUrl}/voice/recordings/${metadata.sessionId}/download`;

const response =
    await fetch(
        url,
        {
            headers: {
                Authorization:
                    `Bearer ${token}`,
                Accept:
                    "audio/ogg"
            }
        }
    );

const bytes =
    Buffer.from(
        await response.arrayBuffer()
    );

const sha256 =
    createHash("sha256")
        .update(bytes)
        .digest("hex");

const headerSha =
    String(
        response.headers.get(
            "x-voice-recording-sha256"
        ) ?? ""
    );

const mode =
    String(
        response.headers.get(
            "x-voice-recording-download-mode"
        ) ?? ""
    );

const renderer =
    String(
        response.headers.get(
            "x-voice-recording-primary-renderer"
        ) ?? ""
    );

console.log(
    "VOICE_HRTF_PRIMARY_ROUTE" +
    ` | status=${response.status}` +
    ` | sessionId=${metadata.sessionId}` +
    ` | userId=${participant.userId}` +
    ` | mode=${mode}` +
    ` | renderer=${renderer}` +
    ` | bytes=${bytes.length}` +
    ` | shaMatch=${Boolean(headerSha) && headerSha === sha256}`
);

if (
    response.status !== 200 ||
    mode !== "personal_hrtf_binaural" ||
    renderer !== "hrtf" ||
    !headerSha ||
    headerSha !== sha256 ||
    bytes.length < 4 ||
    bytes.subarray(0, 4).toString("ascii") !== "OggS"
) {
    throw new Error(
        "Primary recording download did not return authenticated HRTF OGG."
    );
}

const outputPath =
    `/tmp/vme2-primary-hrtf-${metadata.sessionId}-${participant.userId}.ogg`;

await writeFile(
    outputPath,
    bytes
);

console.log(
    "VME2_HRTF_PRIMARY_ROUTE_E2E=PASS" +
    ` | output=${outputPath}`
);
