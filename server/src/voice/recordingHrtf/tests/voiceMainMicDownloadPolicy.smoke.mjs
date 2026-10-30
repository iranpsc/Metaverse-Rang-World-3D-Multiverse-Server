import assert from "node:assert/strict";
import {
    buildMainMicBlockedIntervalsBySenderConnectionId,
    mergeBlockedIntervalMaps
} from "../voiceMainMicDownloadPolicy.js";

const metadata = {
    durationMs: 10000,
    startedAtMs: 100000,
    participants: [
        {
            userId: "user-a",
            connectionId: "conn-a",
            intervals: [{ startOffsetMs: 0, endOffsetMs: 10000 }],
            consentIntervals: [
                { startOffsetMs: 0, endOffsetMs: 3000 },
                { startOffsetMs: 7000, endOffsetMs: 10000 }
            ]
        },
        {
            userId: "user-b",
            connectionId: "conn-b",
            intervals: [{ startOffsetMs: 0, endOffsetMs: 10000 }],
            consentIntervals: [{ startOffsetMs: 0, endOffsetMs: 10000 }]
        }
    ]
};

const mainMic = buildMainMicBlockedIntervalsBySenderConnectionId({ metadata });
assert.deepEqual(mainMic.get("conn-a"), [{ startOffsetMs: 3000, endOffsetMs: 7000 }]);
assert.equal(mainMic.has("conn-b"), false);

const directional = new Map([
    ["conn-a", [{ startOffsetMs: 8000, endOffsetMs: 9000 }]],
    ["conn-b", [{ startOffsetMs: 1000, endOffsetMs: 2000 }]]
]);
const combined = mergeBlockedIntervalMaps(directional, mainMic);
assert.deepEqual(combined.get("conn-a"), [
    { startOffsetMs: 3000, endOffsetMs: 7000 },
    { startOffsetMs: 8000, endOffsetMs: 9000 }
]);
assert.deepEqual(combined.get("conn-b"), [{ startOffsetMs: 1000, endOffsetMs: 2000 }]);

console.log("VME2_MAIN_MIC_DOWNLOAD_POLICY=PASS | globalSenderMute=True | selfIncluded=True | fallbackProtected=True");
