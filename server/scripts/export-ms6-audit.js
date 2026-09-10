import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";


function waitForDownloadsStable(sessionPath, attempts = 10, delayMs = 1000) {
    const dir = path.join(sessionPath, "directional-downloads");

    if (!fs.existsSync(dir)) {
        return;
    }

    let previous = "";

    for (let i = 0; i < attempts; i++) {
        const state = fs.readdirSync(dir)
            .filter(file => file.endsWith(".ogg"))
            .map(file => {
                const stat = fs.statSync(path.join(dir, file));
                return `${file}:${stat.size}`;
            })
            .sort()
            .join("|");

        if (state && state === previous) {
            return;
        }

        previous = state;

        Atomics.wait(
            new Int32Array(new SharedArrayBuffer(4)),
            0,
            0,
            delayMs
        );
    }
}

const sessionId = process.argv[2];

if (!sessionId) {
    console.error("Usage: node scripts/export-ms6-audit.js <sessionId>");
    process.exit(1);
}

const basePath = "/home/world3d/data/metaverse-voice-recordings";
const sessionPath = path.join(basePath, sessionId);
const outputPath = path.join(basePath, `${sessionId}_MS6_Audit.zip`);

if (!fs.existsSync(sessionPath)) {
    console.error(`Session not found: ${sessionPath}`);
    process.exit(1);
}

waitForDownloadsStable(sessionPath);

execFileSync("node", [
    "scripts/run-ms6-audit.js",
    sessionPath
], {
    stdio: "inherit"
});

const files = [
    "MS6_Audit_Report.json",
    "MS6_Audit_Report.txt",
    "session.json",
    "directional-events.ndjson"
]
.map(file => path.join(sessionPath, file))
.filter(fs.existsSync);

execFileSync("zip", [
    "-j",
    outputPath,
    ...files
], {
    stdio: "inherit"
});

console.log(outputPath);
