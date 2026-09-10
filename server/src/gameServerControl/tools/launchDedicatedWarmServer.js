// File => src/gameServerControl/tools/launchDedicatedWarmServer.js

import http from "http";
import net from "net";
import { spawn, execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const DEFAULT_HTTP_HOST = "127.0.0.1";
const DEFAULT_HTTP_PORT = 8080;
const DEFAULT_SERVER_ID_PREFIX = "ds_warm";
const DEFAULT_REGION = "eu-central";
const DEFAULT_ZONE = "de-1";
const DEFAULT_PUBLIC_HOST = "dev-world-3d.metarang.com";
const DEFAULT_LISTEN_HOST = "0.0.0.0";
const DEFAULT_START_PORT = 7777;
const DEFAULT_MAX_PORT_SCAN = 20;
const DEFAULT_GAME_SERVER_DIR = "/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer";
const DEFAULT_GAME_SERVER_BIN = "LinuxGameServer.x86_64";
const DEFAULT_WAIT_MS = 9000;
const DEFAULT_MIN_SERVER_MAX_PLAYERS = 200;

function readArg(name, fallback = "") {
    const prefix = `--${name}=`;
    const direct = process.argv.find((item) => item.startsWith(prefix));
    if (direct) return direct.slice(prefix.length).trim();

    const index = process.argv.indexOf(`--${name}`);
    if (index >= 0 && process.argv[index + 1] !== undefined) return String(process.argv[index + 1]).trim();

    return fallback;
}

function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

function asInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function safeFilePart(value) {
    return String(value || "")
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .replace(/_+/g, "_")
        .slice(0, 120);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function createWarmServerId() {
    const timePart = Date.now().toString(36);
    const randomPart = Math.random().toString(36).slice(2, 8);
    return `${DEFAULT_SERVER_ID_PREFIX}_${timePart}_${randomPart}`.slice(0, 160);
}

function canListenOnPort(host, port) {
    return new Promise((resolve) => {
        const server = net.createServer();

        server.once("error", () => resolve(false));
        server.once("listening", () => {
            server.close(() => resolve(true));
        });

        server.listen(port, host);
    });
}

async function findFreePort({ listenHost, startPort, maxScan }) {
    for (let offset = 0; offset < maxScan; offset++) {
        const port = startPort + offset;
        const free = await canListenOnPort(listenHost, port);
        if (free) return port;
    }

    throw new Error(`no_free_port_found:${startPort}-${startPort + maxScan - 1}`);
}

function createJsonRequest({ method, host, port, requestPath, body = null }) {
    return new Promise((resolve) => {
        const rawBody = body ? JSON.stringify(body) : "";

        const req = http.request({
            method,
            host,
            port,
            path: requestPath,
            headers: rawBody ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(rawBody)
            } : {}
        }, (res) => {
            const chunks = [];

            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => {
                const text = Buffer.concat(chunks).toString("utf8");
                let json = null;

                try {
                    json = text ? JSON.parse(text) : null;
                } catch {
                    json = null;
                }

                resolve({
                    statusCode: res.statusCode,
                    text,
                    json
                });
            });
        });

        req.on("error", (error) => {
            resolve({
                statusCode: 0,
                text: error.message,
                json: null
            });
        });

        if (rawBody) req.write(rawBody);
        req.end();
    });
}

async function readControlStatus({ httpHost, httpPort }) {
    const response = await createJsonRequest({
        method: "GET",
        host: httpHost,
        port: httpPort,
        requestPath: "/game-server-control/status"
    });

    return response.json?.data ?? null;
}

function createServiceToken(serverId) {
    const output = execFileSync(process.execPath, [
        "src/gameServerControl/tools/createGameServerServiceToken.js",
        `--serverId=${serverId}`,
        "--ttlSeconds=300"
    ], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
    });

    const parsed = JSON.parse(output);
    if (!parsed?.success || !parsed?.token) throw new Error("service_token_create_failed");

    return parsed.token;
}

function appendManifestRecord(manifestFile, record) {
    if (!isNonEmptyString(manifestFile)) return;

    fs.mkdirSync(path.dirname(manifestFile), { recursive: true });

    fs.appendFileSync(manifestFile, JSON.stringify({
        ...record,
        recordedAt: Date.now(),
        recordedAtIso: new Date().toISOString()
    }) + "\n", "utf8");
}

function launchWarmProcess(options) {
    const executablePath = path.join(options.gameServerDir, options.gameServerBin);

    if (!fs.existsSync(executablePath)) {
        throw new Error(`game_server_binary_not_found:${executablePath}`);
    }

    fs.chmodSync(executablePath, 0o775);

    const filePart = safeFilePart(options.serverId);
    const logFile = path.join(options.gameServerDir, `DedicatedServer_${filePart}.log`);
    const stdoutFile = path.join(options.gameServerDir, `DedicatedServer_${filePart}.stdout`);
    const pidFile = path.join(options.gameServerDir, `DedicatedServer_${filePart}.pid`);

    const stdoutStream = fs.openSync(stdoutFile, "a");

    const args = [
        "-batchmode",
        "-nographics",
        "-logFile", logFile,
        "-server",
        "-runmode", "2",
        "-controlbaseurl", options.controlBaseUrl,
        "-serverid", options.serverId,
        "-publichost", options.publicHost,
        "-publicport", String(options.publicPort),
        "-listenhost", options.listenHost,
        "-listenport", String(options.listenPort),
        "-region", options.region,
        "-zone", options.zone,
        "-maxplayers", String(options.maxPlayers),
        "-servicetoken", options.serviceToken,
        "-warm", "true"
    ];

    const child = spawn(executablePath, args, {
        cwd: options.gameServerDir,
        detached: true,
        stdio: ["ignore", stdoutStream, stdoutStream]
    });

    child.unref();

    fs.writeFileSync(pidFile, String(child.pid), "utf8");

    return {
        pid: child.pid,
        logFile,
        stdoutFile,
        pidFile,
        args
    };
}

async function main() {
    const httpHost = readArg("httpHost", process.env.GSC_HTTP_HOST || DEFAULT_HTTP_HOST);
    const httpPort = asInteger(readArg("httpPort", process.env.GSC_HTTP_PORT || String(DEFAULT_HTTP_PORT)), DEFAULT_HTTP_PORT);

    const gameServerDir = readArg("gameServerDir", process.env.GSC_GAME_SERVER_DIR || DEFAULT_GAME_SERVER_DIR);
    const gameServerBin = readArg("gameServerBin", process.env.GSC_GAME_SERVER_BIN || DEFAULT_GAME_SERVER_BIN);

    const region = readArg("region", process.env.GSC_REGION || DEFAULT_REGION);
    const zone = readArg("zone", process.env.GSC_ZONE || DEFAULT_ZONE);
    const maxPlayers = Math.max(
        DEFAULT_MIN_SERVER_MAX_PLAYERS,
        asInteger(readArg("maxPlayers", process.env.GSC_MAX_PLAYERS || String(DEFAULT_MIN_SERVER_MAX_PLAYERS)), DEFAULT_MIN_SERVER_MAX_PLAYERS)
    );

    const publicHost = readArg("publicHost", process.env.GSC_PUBLIC_HOST || DEFAULT_PUBLIC_HOST);
    const listenHost = readArg("listenHost", process.env.GSC_LISTEN_HOST || DEFAULT_LISTEN_HOST);

    const startPort = asInteger(readArg("startPort", process.env.GSC_START_PORT || String(DEFAULT_START_PORT)), DEFAULT_START_PORT);
    const maxPortScan = asInteger(readArg("maxPortScan", process.env.GSC_MAX_PORT_SCAN || String(DEFAULT_MAX_PORT_SCAN)), DEFAULT_MAX_PORT_SCAN);

    const listenPort = asInteger(readArg("listenPort", ""), 0) || await findFreePort({
        listenHost,
        startPort,
        maxScan: maxPortScan
    });

    const publicPort = asInteger(readArg("publicPort", ""), 0) || listenPort;

    const serverId = readArg("serverId", createWarmServerId());
    const controlBaseUrl = readArg("controlBaseUrl", `http://${httpHost}:${httpPort}`);

    const manifestFile = readArg(
        "processManifestFile",
        process.env.GAME_SERVER_PROCESS_MANIFEST_FILE ||
        process.env.GSC_PROCESS_MANIFEST_FILE ||
        path.join(gameServerDir, "DedicatedServer_process_manifest.jsonl")
    );

    const waitMs = asInteger(readArg("waitMs", process.env.GSC_WAIT_MS || String(DEFAULT_WAIT_MS)), DEFAULT_WAIT_MS);

    const before = await readControlStatus({ httpHost, httpPort });
    const serviceToken = createServiceToken(serverId);

    const launched = launchWarmProcess({
        gameServerDir,
        gameServerBin,
        serverId,
        publicHost,
        publicPort,
        listenHost,
        listenPort,
        controlBaseUrl,
        region,
        zone,
        serviceToken,
        maxPlayers
    });

    appendManifestRecord(manifestFile, {
        event: "launched",
        launchKind: "warm",
        pid: launched.pid,
        serverId,
        roomId: "",
        roomName: "",
        publicHost,
        publicPort,
        listenHost,
        listenPort,
        region,
        zone,
        maxPlayers,
        gameServerDir,
        gameServerBin,
        logFile: launched.logFile,
        stdoutFile: launched.stdoutFile,
        pidFile: launched.pidFile
    });

    await sleep(waitMs);

    const after = await readControlStatus({ httpHost, httpPort });

    const beforeWarm = before?.registry?.warm ?? 0;
    const afterWarm = after?.registry?.warm ?? 0;

    console.log(JSON.stringify({
        success: afterWarm > beforeWarm || afterWarm > 0,
        reason: afterWarm > beforeWarm || afterWarm > 0
            ? "dedicated_warm_server_launched"
            : "dedicated_warm_server_launch_pending_or_failed",
        message: afterWarm > beforeWarm || afterWarm > 0
            ? "Dedicated warm server launched and registered."
            : "Dedicated warm server process launched but warm registry was not confirmed.",
        data: {
            serverId,
            launched,
            publicHost,
            publicPort,
            listenHost,
            listenPort,
            maxPlayers,
            beforeRegistry: before?.registry ?? null,
            afterRegistry: after?.registry ?? null,
            manifestFile
        }
    }, null, 2));
}

main().catch((error) => {
    console.error(JSON.stringify({
        success: false,
        reason: "dedicated_warm_server_launcher_error",
        message: error.message
    }, null, 2));

    process.exit(1);
});
