import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readLines(filePath) {
    if (!fs.existsSync(filePath)) {
        return [];
    }

    return fs.readFileSync(filePath, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map(line => {
            try {
                return JSON.parse(line);
            } catch {
                return null;
            }
        })
        .filter(Boolean);
}

function normalizeEvent(event) {
    return {
        timeMs: event.offsetMs ?? event.changedAtMs ?? null,

        sourceConnectionId:
            event.senderConnectionId ?? null,

        receiverConnectionId:
            event.receiverConnectionId ?? null,

        type:
            event.source ?? "unknown",

        state:
            event.blocked === true
                ? "OFF"
                : event.blocked === false
                    ? "ON"
                    : "unknown"
    };
}


function buildCutIntervals(events) {
    const intervals = [];
    const pending = new Map();

    for (const event of events) {
        const key =
            `${event.type}:${event.sourceConnectionId}:${event.receiverConnectionId}`;

        if (event.state === "OFF") {
            pending.set(key, event);
            continue;
        }

        if (event.state === "ON" && pending.has(key)) {
            const start = pending.get(key);

            intervals.push({
                type: start.type,
                sourceConnectionId: start.sourceConnectionId,
                receiverConnectionId: start.receiverConnectionId,
                startMs: start.timeMs,
                endMs: event.timeMs,
                durationMs: event.timeMs - start.timeMs,
                result: "PASS"
            });

            pending.delete(key);
        }
    }

    return intervals;
}


function calculateSha256(filePath) {
    const hash = crypto.createHash("sha256");
    const buffer = fs.readFileSync(filePath);
    hash.update(buffer);
    return hash.digest("hex");
}

function validateDownloads(sessionDir) {
    const downloadDir = path.join(sessionDir, "directional-downloads");

    if (!fs.existsSync(downloadDir)) {
        return [];
    }

    return fs.readdirSync(downloadDir)
        .filter(file => file.endsWith(".ogg"))
        .map(file => {
            const fullPath = path.join(downloadDir, file);
            const stat = fs.statSync(fullPath);

            return {
                file,
                exists: true,
                size: stat.size,
                sha256: calculateSha256(fullPath),
                result:
                    stat.size > 0
                        ? "PASS"
                        : "FAIL"
            };
        });
}

function createReport(sessionDir) {
    const sessionFile = path.join(sessionDir, "session.json");
    const eventsFile = path.join(sessionDir, "directional-events.ndjson");

    if (!fs.existsSync(sessionFile)) {
        throw new Error(`Missing session.json: ${sessionFile}`);
    }

    const session = readJson(sessionFile);
    const events = readLines(eventsFile).map(normalizeEvent);

    const intervals = buildCutIntervals(events);
    const downloads = validateDownloads(sessionDir);

    const report = {
        generatedAt: new Date().toISOString(),
        sessionId: session.sessionId ?? path.basename(sessionDir),
        eventCount: events.length,
        intervalCount: intervals.length,
        downloadCount: downloads.length,
        events,
        intervals,
        downloads
    };

    const jsonPath = path.join(sessionDir, "MS6_Audit_Report.json");
    const txtPath = path.join(sessionDir, "MS6_Audit_Report.txt");

    fs.writeFileSync(
        jsonPath,
        JSON.stringify(report, null, 2),
        "utf8"
    );

    const text = [
        "MS6 DIRECTIONAL AUDIT REPORT",
        "",
        `SESSION: ${report.sessionId}`,
        `EVENT COUNT: ${report.eventCount}`,
        "",
        ...events.map(e =>
            `${e.timeMs} | ${e.sourceConnectionId} | ${e.receiverConnectionId} | ${e.type} | ${e.state}`
        ),
        "",
        "CUT INTERVALS",
        "",
        ...intervals.map(i =>
            `${i.type} | ${i.sourceConnectionId} | ${i.receiverConnectionId} | ${i.startMs}-${i.endMs} | ${i.durationMs}ms | ${i.result}`
        ),
        "",
        "DOWNLOAD VALIDATION",
        "",
        ...downloads.map(d =>
            `${d.file} | ${d.size} bytes | ${d.sha256} | ${d.result}`
        )
    ].join("\n");

    fs.writeFileSync(txtPath, text, "utf8");

    return {
        jsonPath,
        txtPath,
        eventCount: events.length
    };
}

export { createReport };
