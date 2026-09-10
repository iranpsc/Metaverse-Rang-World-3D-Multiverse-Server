// File => src/gameServerControl/tools/warmPoolKeepAlive.js

import http from "http";
import { execFile } from "child_process";

const DEFAULT_HTTP_HOST = "127.0.0.1";
const DEFAULT_HTTP_PORT = 8080;
const DEFAULT_MIN_READY = 1;
const DEFAULT_CHECK_INTERVAL_SECONDS = 10;
const DEFAULT_LAUNCH_COOLDOWN_SECONDS = 20;
const DEFAULT_LAUNCHER = "src/gameServerControl/tools/launchDedicatedWarmServer.js";

function asInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function readStatus({ host, port }) {
    return new Promise((resolve) => {
        const req = http.request({
            method: "GET",
            host,
            port,
            path: "/game-server-control/status"
        }, (res) => {
            const chunks = [];

            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => {
                const text = Buffer.concat(chunks).toString("utf8");

                try {
                    resolve(JSON.parse(text));
                } catch {
                    resolve(null);
                }
            });
        });

        req.on("error", () => resolve(null));
        req.end();
    });
}

function runLauncher() {
    return new Promise((resolve) => {
        execFile(process.execPath, [process.env.GAME_SERVER_WARM_POOL_LAUNCHER || DEFAULT_LAUNCHER], {
            cwd: process.cwd(),
            env: process.env,
            maxBuffer: 1024 * 1024
        }, (error, stdout, stderr) => {
            resolve({
                success: !error,
                code: error?.code ?? 0,
                stdout: String(stdout || "").trim(),
                stderr: String(stderr || "").trim()
            });
        });
    });
}

async function tick(state) {
    const status = await readStatus({
        host: state.httpHost,
        port: state.httpPort
    });

    const registry = status?.data?.registry ?? null;
    const warm = registry?.warm ?? 0;
    const total = registry?.total ?? 0;

    console.log(JSON.stringify({
        event: "warm_pool_tick",
        minReady: state.minReady,
        warm,
        total,
        registry,
        ts: Date.now()
    }));

    if (!registry) return;

    if (warm >= state.minReady) return;

    const now = Date.now();

    if (now - state.lastLaunchAt < state.launchCooldownMs) {
        console.log(JSON.stringify({
            event: "warm_pool_launch_skipped_cooldown",
            warm,
            minReady: state.minReady,
            remainingMs: state.launchCooldownMs - (now - state.lastLaunchAt),
            ts: now
        }));

        return;
    }

    state.lastLaunchAt = now;

    console.log(JSON.stringify({
        event: "warm_pool_launch_requested",
        warm,
        minReady: state.minReady,
        ts: now
    }));

    const result = await runLauncher();

    console.log(JSON.stringify({
        event: "warm_pool_launch_result",
        success: result.success,
        code: result.code,
        stdout: result.stdout.slice(0, 4000),
        stderr: result.stderr.slice(0, 4000),
        ts: Date.now()
    }));
}

async function main() {
    const state = {
        httpHost: process.env.GSC_HTTP_HOST || DEFAULT_HTTP_HOST,
        httpPort: asInteger(process.env.GSC_HTTP_PORT, DEFAULT_HTTP_PORT),
        minReady: asInteger(process.env.GAME_SERVER_WARM_POOL_MIN_READY, DEFAULT_MIN_READY),
        checkIntervalMs: asInteger(process.env.GAME_SERVER_WARM_POOL_CHECK_INTERVAL_SECONDS, DEFAULT_CHECK_INTERVAL_SECONDS) * 1000,
        launchCooldownMs: asInteger(process.env.GAME_SERVER_WARM_POOL_LAUNCH_COOLDOWN_SECONDS, DEFAULT_LAUNCH_COOLDOWN_SECONDS) * 1000,
        lastLaunchAt: 0
    };

    console.log(JSON.stringify({
        event: "warm_pool_keepalive_started",
        state,
        ts: Date.now()
    }));

    await tick(state);

    setInterval(() => {
        tick(state).catch((error) => {
            console.error(JSON.stringify({
                event: "warm_pool_tick_error",
                message: error.message,
                ts: Date.now()
            }));
        });
    }, state.checkIntervalMs);
}

main().catch((error) => {
    console.error(JSON.stringify({
        event: "warm_pool_keepalive_fatal",
        message: error.message,
        ts: Date.now()
    }));

    process.exit(1);
});
