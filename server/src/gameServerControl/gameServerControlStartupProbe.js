// File => src/gameServerControl/gameServerControlStartupProbe.js

import fs from "fs/promises";
import path from "path";

const PROJECT_ROOT = process.cwd();
const REPORT_PATH = path.join(PROJECT_ROOT, "src/gameServerControl/gameServerControlStartupProbe.report.txt");

const IGNORED_DIRS = new Set([
    "node_modules",
    ".git",
    ".next",
    "dist",
    "build",
    "coverage",
    "logs",
    "tmp",
    "temp",
    "backup",
    "backups"
]);

const SOURCE_EXTENSIONS = new Set([
    ".js",
    ".mjs",
    ".cjs",
    ".ts"
]);

const STARTUP_PATTERNS = [
    { key: "app.listen", weight: 30 },
    { key: "server.listen", weight: 30 },
    { key: "http.createServer", weight: 25 },
    { key: "https.createServer", weight: 25 },
    { key: "express()", weight: 25 },
    { key: "new WebSocketServer", weight: 20 },
    { key: "attachRealtime", weight: 20 },
    { key: "attachGrpc", weight: 15 },
    { key: "attach", weight: 8 },
    { key: "listen(", weight: 10 },
    { key: "process.env.PORT", weight: 10 },
    { key: "app.use", weight: 8 },
    { key: "router", weight: 5 }
];

//* این تابع بررسی می کند مسیر باید نادیده گرفته شود یا نه.
function shouldIgnorePath(fullPath) {
    const relativePath = path.relative(PROJECT_ROOT, fullPath);
    const parts = relativePath.split(path.sep);

    return parts.some((part) => IGNORED_DIRS.has(part));
}

//* این تابع بررسی می کند فایل منبع قابل اسکن است یا نه.
function isSourceFile(fullPath) {
    return SOURCE_EXTENSIONS.has(path.extname(fullPath));
}

//* این تابع همه فایل های قابل اسکن را از پروژه پیدا می کند.
async function collectSourceFiles(dir) {
    const result = [];

    if (shouldIgnorePath(dir)) return result;

    let entries = [];

    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return result;
    }

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (shouldIgnorePath(fullPath)) continue;

        if (entry.isDirectory()) {
            const nestedFiles = await collectSourceFiles(fullPath);
            result.push(...nestedFiles);
            continue;
        }

        if (!entry.isFile()) continue;
        if (!isSourceFile(fullPath)) continue;

        result.push(fullPath);
    }

    return result;
}

//* این تابع پکیج جیسون را می خواند و اسکریپت های پروژه را برمی گرداند.
async function readPackageInfo() {
    const packagePath = path.join(PROJECT_ROOT, "package.json");

    try {
        const raw = await fs.readFile(packagePath, "utf8");
        const parsed = JSON.parse(raw);

        return {
            exists: true,
            path: packagePath,
            main: parsed.main ?? "",
            type: parsed.type ?? "",
            scripts: parsed.scripts ?? {}
        };
    } catch (error) {
        return {
            exists: false,
            path: packagePath,
            error: error.message,
            main: "",
            type: "",
            scripts: {}
        };
    }
}

//* این تابع یک فایل را از نظر نشانه های استارتاپ بررسی می کند.
async function analyzeFile(fullPath) {
    let content = "";

    try {
        content = await fs.readFile(fullPath, "utf8");
    } catch {
        return null;
    }

    const matches = [];
    let score = 0;

    for (const pattern of STARTUP_PATTERNS) {
        if (!content.includes(pattern.key)) continue;

        matches.push(pattern.key);
        score += pattern.weight;
    }

    if (score <= 0) return null;

    const relativePath = path.relative(PROJECT_ROOT, fullPath).replace(/\\/g, "/");

    return {
        path: relativePath,
        score,
        matches,
        lineHints: findLineHints(content)
    };
}

//* این تابع چند خط مهم از فایل را برای گزارش پیدا می کند.
function findLineHints(content) {
    const lines = content.split(/\r?\n/g);
    const hints = [];

    const hintPatterns = [
        "app.listen",
        "server.listen",
        "http.createServer",
        "https.createServer",
        "express()",
        "attachRealtime",
        "attachGrpc",
        "app.use",
        "listen("
    ];

    lines.forEach((line, index) => {
        const cleanLine = line.trim();

        if (!cleanLine) return;

        const matched = hintPatterns.some((pattern) => cleanLine.includes(pattern));
        if (!matched) return;

        hints.push({
            line: index + 1,
            text: cleanLine.slice(0, 180)
        });
    });

    return hints.slice(0, 20);
}

//* این تابع گزارش خوانا از نتیجه اسکن می سازد.
function buildReport(packageInfo, candidates) {
    const lines = [];

    lines.push("GameServerControl Startup Probe Report");
    lines.push("=====================================");
    lines.push("");
    lines.push(`Project Root: ${PROJECT_ROOT}`);
    lines.push("");

    lines.push("package.json");
    lines.push("------------");
    lines.push(`exists: ${packageInfo.exists}`);
    lines.push(`path: ${path.relative(PROJECT_ROOT, packageInfo.path).replace(/\\/g, "/")}`);
    lines.push(`type: ${packageInfo.type || "-"}`);
    lines.push(`main: ${packageInfo.main || "-"}`);
    lines.push("");

    lines.push("scripts");
    lines.push("-------");

    const scriptEntries = Object.entries(packageInfo.scripts);

    if (scriptEntries.length === 0) {
        lines.push("-");
    } else {
        for (const [name, command] of scriptEntries) {
            lines.push(`${name}: ${command}`);
        }
    }

    lines.push("");
    lines.push("startup candidates");
    lines.push("------------------");

    if (candidates.length === 0) {
        lines.push("No startup candidates found.");
    } else {
        candidates.forEach((candidate, index) => {
            lines.push("");
            lines.push(`#${index + 1} ${candidate.path}`);
            lines.push(`score: ${candidate.score}`);
            lines.push(`matches: ${candidate.matches.join(", ")}`);

            if (candidate.lineHints.length > 0) {
                lines.push("line hints:");

                for (const hint of candidate.lineHints) {
                    lines.push(`  L${hint.line}: ${hint.text}`);
                }
            }
        });
    }

    lines.push("");
    lines.push("next step");
    lines.push("---------");
    lines.push("Open the highest-score candidate file before applying any startup patch.");
    lines.push("Do not modify startup before reviewing the exact file.");

    return lines.join("\n");
}

//* این تابع اسکن کامل استارتاپ پروژه را اجرا می کند.
async function runStartupProbe() {
    const packageInfo = await readPackageInfo();
    const files = await collectSourceFiles(PROJECT_ROOT);

    const analyses = [];

    for (const file of files) {
        const analysis = await analyzeFile(file);

        if (!analysis) continue;

        analyses.push(analysis);
    }

    analyses.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.path.localeCompare(b.path);
    });

    const report = buildReport(packageInfo, analyses);
    await fs.writeFile(REPORT_PATH, report, "utf8");

    console.log(report);
    console.log("");
    console.log(`Report written to: ${path.relative(PROJECT_ROOT, REPORT_PATH).replace(/\\/g, "/")}`);

    if (analyses.length > 0) {
        console.log("");
        console.log(`Top candidate: ${analyses[0].path}`);
    }
}

await runStartupProbe();

// این فایل فقط استارتاپ احتمالی پروژه را پیدا می کند و هیچ فایل قدیمی را تغییر نمی دهد.
