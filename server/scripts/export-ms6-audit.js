import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const basePath = "/home/world3d/data/metaverse-voice-recordings";
const sessionId = process.argv[2];

if (!sessionId) {
    console.error("Usage: node scripts/export-ms6-audit.js <sessionId>");
    process.exit(1);
}

const sessionPath = path.join(basePath, sessionId);
const outputPath = path.join(basePath, `${sessionId}_MS6_Audit.zip`);

function fail(message) {
    console.error(message);
    process.exit(1);
}

function sleep(delayMs) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
}

function getOggState(dir) {
    if (!fs.existsSync(dir)) {
        return "";
    }

    return fs.readdirSync(dir)
        .filter(file => file.endsWith(".ogg"))
        .map(file => {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            return `${file}:${stat.size}:${stat.mtimeMs}`;
        })
        .sort()
        .join("|");
}

function waitForDownloadsStable(sessionPath, attempts = 15, delayMs = 1000) {
    const dir = path.join(sessionPath, "directional-downloads");
    let previousState = "";
    let stableMatches = 0;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        const state = getOggState(dir);

        if (state && state === previousState) {
            stableMatches += 1;
            if (stableMatches >= 2) {
                return;
            }
        } else {
            stableMatches = 0;
        }

        previousState = state;

        if (attempt < attempts) {
            sleep(delayMs);
        }
    }

    fail(`Directional downloads did not become stable: ${dir}`);
}

if (!fs.existsSync(sessionPath) || !fs.statSync(sessionPath).isDirectory()) {
    fail(`Session not found: ${sessionPath}`);
}

const sessionJsonPath = path.join(sessionPath, "session.json");

if (!fs.existsSync(sessionJsonPath)) {
    fail(`Missing session.json: ${sessionJsonPath}`);
}

const session = JSON.parse(fs.readFileSync(sessionJsonPath, "utf8"));

if (!Number.isFinite(session.endedAtMs) || session.endedAtMs <= 0) {
    fail(`Session is not finalized: ${sessionId}`);
}

waitForDownloadsStable(sessionPath);

execFileSync("node", ["scripts/run-ms6-audit.js", sessionPath], {
    stdio: "inherit"
});

const requiredFiles = [
    "MS6_Audit_Report.json",
    "MS6_Audit_Report.txt",
    "session.json",
    "directional-events.ndjson",
    "session.ogg"
];

for (const relativePath of requiredFiles) {
    const fullPath = path.join(sessionPath, relativePath);
    if (!fs.existsSync(fullPath)) {
        fail(`Missing required audit file: ${fullPath}`);
    }
}

const directionalDir = path.join(sessionPath, "directional-downloads");
const directionalOggFiles = fs.existsSync(directionalDir)
    ? fs.readdirSync(directionalDir).filter(file => file.endsWith(".ogg"))
    : [];

if (directionalOggFiles.length === 0) {
    fail(`No personalized OGG files found: ${directionalDir}`);
}

const archiveEntries = [...requiredFiles];

for (const dirName of ["participants", "directional-downloads", "clips"]) {
    const fullPath = path.join(sessionPath, dirName);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
        archiveEntries.push(dirName);
    }
}

if (fs.existsSync(outputPath)) {
    fs.unlinkSync(outputPath);
}

execFileSync("zip", ["-r", outputPath, ...archiveEntries], {
    cwd: sessionPath,
    stdio: "inherit"
});

const outputStat = fs.statSync(outputPath);

console.log(JSON.stringify({
    sessionId,
    outputPath,
    zipBytes: outputStat.size,
    personalizedOggCount: directionalOggFiles.length,
    includedEntries: archiveEntries
}, null, 2));
