import { createReport } from "../src/voice/directional/ms6DirectionalAuditReport.js";

const sessionDir = process.argv[2];

if (!sessionDir) {
    console.error("Usage: node scripts/run-ms6-audit.js <session-directory>");
    process.exit(1);
}

try {
    const result = createReport(sessionDir);
    console.log(JSON.stringify(result, null, 2));
} catch (error) {
    console.error(error.message);
    process.exit(1);
}
