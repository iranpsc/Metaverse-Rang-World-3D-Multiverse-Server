import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
    createVoicePrimaryPersonalDownloadHandler
} from "../voicePrimaryPersonalDownloadHandler.js";

class FakeResponse extends PassThrough {
    constructor() {
        super();
        this.statusCode = null;
        this.headers = null;
    }

    writeHead(statusCode, headers) {
        this.statusCode = statusCode;
        this.headers = headers;
        return this;
    }
}

const root = await mkdtemp(join(tmpdir(), "vme2-hrtf-primary-"));
const source = join(root, "source.ogg");
const hrtf = join(root, "hrtf.ogg");
const spatial = join(root, "spatial.ogg");
await writeFile(source, Buffer.from("OggS-source"));
await writeFile(hrtf, Buffer.from("OggS-hrtf"));
await writeFile(spatial, Buffer.from("OggS-spatial"));

const sessionId = "11111111-1111-4111-8111-111111111111";
const baseDownload = Object.freeze({
    sessionId,
    metadataPath: join(root, "session.json"),
    recordingPath: source,
    fileName: "source.ogg",
    contentType: "audio/ogg",
    contentLength: 11,
    checksumSha256: "source",
    downloadMode: "full_session_passthrough",
    authorizedIntervals: [{ startOffsetMs: 0, endOffsetMs: 1000 }]
});

const downloadService = {
    storageRoot: root,
    async resolveDownload() {
        return baseDownload;
    }
};

const resolveUserFromRequest = async () => ({ userId: "user-a" });

async function runCase({ hrtfFails, spatialFails }) {
    const request = new EventEmitter();
    request.method = "GET";
    request.url = `/voice/recordings/${sessionId}/download`;
    const response = new FakeResponse();

    const handler = createVoicePrimaryPersonalDownloadHandler({
        downloadService,
        resolveUserFromRequest,
        datasetPath: "/tmp/fake.vmehrtf",
        createHrtfDownload: async () => {
            if (hrtfFails) throw new Error("HRTF_FAIL");
            return {
                ...baseDownload,
                recordingPath: hrtf,
                fileName: "personal-hrtf.ogg",
                contentLength: 9,
                checksumSha256: "hrtf",
                downloadMode: "personal_hrtf_binaural"
            };
        },
        createSpatialDownload: async () => {
            if (spatialFails) throw new Error("SPATIAL_FAIL");
            return {
                ...baseDownload,
                recordingPath: spatial,
                fileName: "personal-spatial.ogg",
                contentLength: 12,
                checksumSha256: "spatial",
                downloadMode: "personal_spatial_stereo"
            };
        }
    });

    const handled = await handler(request, response);
    return { handled, response };
}

const primary = await runCase({ hrtfFails: false, spatialFails: false });
assert.equal(primary.handled, true);
assert.equal(primary.response.statusCode, 200);
assert.equal(primary.response.headers["X-Voice-Recording-Download-Mode"], "personal_hrtf_binaural");
assert.equal(primary.response.headers["X-Voice-Recording-Primary-Renderer"], "hrtf");

const fallback = await runCase({ hrtfFails: true, spatialFails: false });
assert.equal(fallback.handled, true);
assert.equal(fallback.response.statusCode, 200);
assert.equal(fallback.response.headers["X-Voice-Recording-Download-Mode"], "personal_spatial_stereo");
assert.equal(fallback.response.headers["X-Voice-Recording-Primary-Renderer"], "spatial_fallback");

const legacy = await runCase({ hrtfFails: true, spatialFails: true });
assert.equal(legacy.handled, false);

console.log("VOICE_HRTF_PRIMARY_DOWNLOAD_INTEGRATION=PASS | primary=hrtf | fallback=personal_spatial | legacyFallback=true");
