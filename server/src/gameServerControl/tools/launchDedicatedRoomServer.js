// File => src/gameServerControl/tools/launchDedicatedRoomServer.js

import http from "http";
import net from "net";
import { spawn, execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const DEFAULT_HTTP_HOST = "127.0.0.1";
const DEFAULT_HTTP_PORT = 8080;
const DEFAULT_SERVER_ID_PREFIX = "ds_room";
const DEFAULT_REGION = "eu-central";
const DEFAULT_ZONE = "de-1";
const DEFAULT_PUBLIC_HOST = "dev-world-3d.metarang.com";
const DEFAULT_LISTEN_HOST = "0.0.0.0";
const DEFAULT_START_PORT = 7777;
const DEFAULT_MAX_PORT_SCAN = 120;
const DEFAULT_GAME_SERVER_DIR = "/home/world3d/apps/metaverse-linux-game-server-phase25";
const DEFAULT_GAME_SERVER_BIN = "LinuxGameServer.x86_64";
const DEFAULT_MIN_SERVER_MAX_PLAYERS = 200;

//* این تابع بررسی می کند آیا آرگومان خط فرمان وجود دارد یا نه.
function hasArg(name) {
    const prefix = `--${name}=`;
    return process.argv.some((item) => item === `--${name}` || item.startsWith(prefix));
}

//* این تابع آرگومان خط فرمان را از روی نام می خواند.
function readArg(name, fallback = "") {
    const prefix = `--${name}=`;
    const direct = process.argv.find((item) => item.startsWith(prefix));
    if (direct) return direct.slice(prefix.length).trim();

    const index = process.argv.indexOf(`--${name}`);
    if (index >= 0 && process.argv[index + 1]) return String(process.argv[index + 1]).trim();

    return fallback;
}

//* این تابع بررسی می کند مقدار رشته ای معتبر است یا نه.
function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

//* این تابع مقدار ضروری را بررسی می کند.
function requireValue(value, name) {
    if (isNonEmptyString(value)) return value.trim();
    throw new Error(`${name}_required`);
}

//* این تابع مقدار عدد صحیح را می خواند.
function asInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

//* این تابع مقدار امن برای نام فایل می سازد.
function safeFilePart(value) {
    return String(value || "")
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .replace(/_+/g, "_")
        .slice(0, 120);
}

//* این تابع کمی صبر می کند.
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

//* این تابع رخدادهای لایف سایکل پروسه ددیکیتد را در مَنیفِست مشترک ثبت می کند.
function appendProcessLifecycleRecord(manifestFile, record) {
    if (!isNonEmptyString(manifestFile)) return null;

    const dir = path.dirname(manifestFile);
    fs.mkdirSync(dir, { recursive: true });

    const finalRecord = {
        ...record,
        recordedAt: Date.now(),
        recordedAtIso: new Date().toISOString()
    };

    fs.appendFileSync(manifestFile, `${JSON.stringify(finalRecord)}\n`, "utf8");
    return finalRecord;
}

//* این تابع بررسی می کند یک پورت روی هاست لیسن قابل استفاده است یا نه.
function canListenOnPort(host, port) {
    return new Promise((resolve) => {
        const server = net.createServer();

        server.once("error", () => {
            resolve(false);
        });

        server.once("listening", () => {
            server.close(() => resolve(true));
        });

        server.listen(port, host);
    });
}

//* این تابع اولین پورت آزاد را از یک بازه پیدا می کند.
async function findFreePort({ listenHost, startPort, maxScan }) {
    for (let offset = 0; offset < maxScan; offset++) {
        const port = startPort + offset;
        const isFree = await canListenOnPort(listenHost, port);

        if (isFree) return port;
    }

    throw new Error(`no_free_port_found:${startPort}-${startPort + maxScan - 1}`);
}

//* این تابع درخواست جیسون ساده می فرستد.
function createJsonRequest({ method, host, port, path: requestPath, headers = {}, body = null }) {
    return new Promise((resolve) => {
        const rawBody = body ? JSON.stringify(body) : "";

        const req = http.request({
            method,
            host,
            port,
            path: requestPath,
            headers: {
                ...(rawBody ? {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(rawBody)
                } : {}),
                ...headers
            }
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
                json: {
                    success: false,
                    reason: "http_request_failed",
                    message: error.message,
                    data: {}
                }
            });
        });

        if (rawBody) req.write(rawBody);
        req.end();
    });
}

//* این تابع توکن سرویس ددیکیتد سرور را می سازد.
function createServiceToken(serverId) {
    const output = execFileSync(process.execPath, [
        "src/gameServerControl/tools/createGameServerServiceToken.js",
        `--serverId=${serverId}`
    ], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
    });

    const parsed = JSON.parse(output);
    if (!parsed?.success || !parsed?.token) throw new Error("service_token_create_failed");

    return parsed.token;
}

//* این تابع بررسی می کند برای روم مورد نظر سرور قابل استفاده وجود دارد یا نه.
async function findAvailableServer({ httpHost, httpPort, roomId, region, zone, roomMaxPlayers }) {
    const query = new URLSearchParams({
        roomId,
        region,
        zone,
        roomMaxPlayers
    });

    if (Number.isFinite(roomMaxPlayers) && roomMaxPlayers > 0) {
        query.set("roomMaxPlayers", String(roomMaxPlayers));
    }

    const response = await createJsonRequest({
        method: "GET",
        host: httpHost,
        port: httpPort,
        path: `/game-server-control/client/servers?${query.toString()}`
    });

    const servers = response.json?.data?.servers ?? [];

    return {
        response,
        server: servers.length > 0 ? servers[0] : null,
        count: servers.length
    };
}

//* این تابع پروسه ددیکیتد سرور را برای یک روم اجرا می کند.
function launchProcess({
    gameServerDir,
    gameServerBin,
    serverId,
    roomId,
    roomName,
    publicHost,
    publicPort,
    listenHost,
    listenPort,
    controlBaseUrl,
    region,
    zone,
    serviceToken,
    roomMaxPlayers,
    maxPlayers
}) {
    const executablePath = path.join(gameServerDir, gameServerBin);
    const filePart = safeFilePart(roomId);
    const logFile = path.join(gameServerDir, `DedicatedServer_${filePart}.log`);
    const stdoutFile = path.join(gameServerDir, `DedicatedServer_${filePart}.stdout`);
    const pidFile = path.join(gameServerDir, `DedicatedServer_${filePart}.pid`);

    if (!fs.existsSync(executablePath)) {
        throw new Error(`game_server_binary_not_found:${executablePath}`);
    }

    const stdoutStream = fs.openSync(stdoutFile, "a");

    const args = [
        "-batchmode",
        "-nographics",
        "-logFile", logFile,
        "-server",
        "-runmode", "2",
        "-controlbaseurl", controlBaseUrl,
        "-serverid", serverId,
        "-roomid", roomId,
        "-roomname", roomName,
        "-publichost", publicHost,
        "-publicport", String(publicPort),
        "-listenhost", listenHost,
        "-listenport", String(listenPort),
        "-region", region,
        "-zone", zone,
        "-maxplayers", String(maxPlayers),
        "-roommaxplayers", String(roomMaxPlayers),
        "-servicetoken", serviceToken
    ];

    const child = spawn(executablePath, args, {
        cwd: gameServerDir,
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

//* این تابع اصلی ابزار را اجرا می کند.
async function main() {
    const httpHost = readArg("httpHost", process.env.GSC_HTTP_HOST || DEFAULT_HTTP_HOST);
    const httpPort = asInteger(readArg("httpPort", process.env.GSC_HTTP_PORT || String(DEFAULT_HTTP_PORT)), DEFAULT_HTTP_PORT);

    const roomId = requireValue(readArg("roomId", process.env.GSC_ROOM_ID || ""), "roomId");
    const roomName = readArg("roomName", roomId);
    const roomMaxPlayers = Math.max(1, asInteger(readArg("roomMaxPlayers", process.env.GSC_ROOM_MAX_PLAYERS || "50"), 50));
    const minServerMaxPlayers = Math.max(1, asInteger(readArg("minServerMaxPlayers", process.env.GSC_MIN_SERVER_MAX_PLAYERS || String(DEFAULT_MIN_SERVER_MAX_PLAYERS)), DEFAULT_MIN_SERVER_MAX_PLAYERS));
    const maxPlayers = Math.max(
        minServerMaxPlayers,
        roomMaxPlayers,
        asInteger(readArg("maxPlayers", process.env.GSC_MAX_PLAYERS || String(minServerMaxPlayers)), minServerMaxPlayers)
    );

    const region = readArg("region", process.env.GSC_REGION || DEFAULT_REGION);
    const zone = readArg("zone", process.env.GSC_ZONE || DEFAULT_ZONE);

    const publicHost = readArg("publicHost", process.env.GSC_PUBLIC_HOST || DEFAULT_PUBLIC_HOST);
    const listenHost = readArg("listenHost", process.env.GSC_LISTEN_HOST || DEFAULT_LISTEN_HOST);

    const startPort = asInteger(readArg("startPort", process.env.GSC_START_PORT || String(DEFAULT_START_PORT)), DEFAULT_START_PORT);
    const maxPortScan = asInteger(readArg("maxPortScan", process.env.GSC_MAX_PORT_SCAN || String(DEFAULT_MAX_PORT_SCAN)), DEFAULT_MAX_PORT_SCAN);

    const hasManualPublicPort = hasArg("publicPort") || isNonEmptyString(process.env.GSC_PUBLIC_PORT);
    const hasManualListenPort = hasArg("listenPort") || isNonEmptyString(process.env.GSC_LISTEN_PORT);

    let listenPort = hasManualListenPort
        ? asInteger(readArg("listenPort", process.env.GSC_LISTEN_PORT || String(startPort)), startPort)
        : 0;

    if (!listenPort) {
        listenPort = await findFreePort({
            listenHost,
            startPort,
            maxScan: maxPortScan
        });
    }

    const publicPort = hasManualPublicPort
        ? asInteger(readArg("publicPort", process.env.GSC_PUBLIC_PORT || String(listenPort)), listenPort)
        : listenPort;

    const serverId = readArg("serverId", `${DEFAULT_SERVER_ID_PREFIX}_${safeFilePart(roomId)}`);
    const controlBaseUrl = readArg("controlBaseUrl", `http://${httpHost}:${httpPort}`);

    const gameServerDir = readArg("gameServerDir", process.env.GSC_GAME_SERVER_DIR || DEFAULT_GAME_SERVER_DIR);
    const gameServerBin = readArg("gameServerBin", process.env.GSC_GAME_SERVER_BIN || DEFAULT_GAME_SERVER_BIN);
    const processManifestFile = readArg(
        "processManifestFile",
        process.env.GAME_SERVER_PROCESS_MANIFEST_FILE ||
            process.env.GSC_PROCESS_MANIFEST_FILE ||
            path.join(gameServerDir, "DedicatedServer_process_manifest.jsonl")
    );

    const waitMs = asInteger(readArg("waitMs", process.env.GSC_WAIT_MS || "9000"), 9000);

    const before = await findAvailableServer({
        httpHost,
        httpPort,
        roomId,
        region,
        zone,
        roomMaxPlayers
    });

    if (before.server) {
        console.log(JSON.stringify({
            success: true,
            reason: "dedicated_room_server_already_available",
            message: "Dedicated room server is already available.",
            data: {
                server: before.server,
                count: before.count
            }
        }, null, 2));

        return;
    }

    const serviceToken = createServiceToken(serverId);

    const launched = launchProcess({
        gameServerDir,
        gameServerBin,
        serverId,
        roomId,
        roomName,
        publicHost,
        publicPort,
        listenHost,
        listenPort,
        controlBaseUrl,
        region,
        zone,
        serviceToken,
        roomMaxPlayers,
        maxPlayers
    });

    appendProcessLifecycleRecord(processManifestFile, {
        event: "launched",
        pid: launched.pid,
        serverId,
        roomId,
        roomName,
        publicHost,
        publicPort,
        listenHost,
        listenPort,
        region,
        zone,
        gameServerDir,
        gameServerBin,
        logFile: launched.logFile,
        stdoutFile: launched.stdoutFile,
        pidFile: launched.pidFile
    });

    await sleep(waitMs);

    const after = await findAvailableServer({
        httpHost,
        httpPort,
        roomId,
        region,
        zone
    });

    console.log(JSON.stringify({
        success: !!after.server,
        reason: after.server ? "dedicated_room_server_launched" : "dedicated_room_server_launch_pending_or_failed",
        message: after.server ? "Dedicated room server launched and registered." : "Dedicated room server was launched but not available yet.",
        data: {
            launched: {
                pid: launched.pid,
                logFile: launched.logFile,
                stdoutFile: launched.stdoutFile,
                pidFile: launched.pidFile
            },
            server: after.server,
            availableCount: after.count,
            roomId,
            serverId,
            publicHost,
            publicPort,
            listenHost,
            listenPort,
            processManifestFile,
            autoPort: !hasManualListenPort,
            startPort,
            maxPortScan
        }
    }, null, 2));
}

main().catch((error) => {
    console.error(JSON.stringify({
        success: false,
        reason: "dedicated_room_server_launcher_error",
        message: error.message,
        data: {
            errorName: error.name
        }
    }, null, 2));

    process.exit(1);
});
