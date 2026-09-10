import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const basePath = "/home/world3d/data/metaverse-voice-recordings";

const sessions = fs.readdirSync(basePath)
    .map(name => {
        const fullPath = path.join(basePath, name);

        if (!fs.statSync(fullPath).isDirectory()) {
            return null;
        }

        const sessionFile = path.join(fullPath, "session.json");

        if (!fs.existsSync(sessionFile)) {
            return null;
        }

        return {
            name,
            time: fs.statSync(sessionFile).mtimeMs
        };
    })
    .filter(Boolean)
    .sort((a, b) => b.time - a.time);

if (sessions.length === 0) {
    console.error("No voice sessions found.");
    process.exit(1);
}

const latestSession = sessions[0].name;

console.log(`Latest Session: ${latestSession}`);

execFileSync(
    "node",
    [
        "scripts/export-ms6-audit.js",
        latestSession
    ],
    {
        stdio: "inherit"
    }
);
