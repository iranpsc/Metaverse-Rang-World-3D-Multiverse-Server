const path = require("path");
const { pathToFileURL } = require("url");
const dotenv = require("dotenv");

const APP_ROOT = __dirname;
dotenv.config({ path: path.join(APP_ROOT, ".env") });

function pickEnv(names) {
    const result = {};

    for (const name of names) {
        const value = process.env[name];
        if (value !== undefined && value !== "") result[name] = value;
    }

    return result;
}

const warmPoolEnvKeys = [
    "GSC_MAX_PORT_SCAN",
    "GSC_GAME_SERVER_DIR",
    "GSC_PUBLIC_HOST",
    "GAME_SERVER_PROCESS_MANIFEST_FILE",
    "GSC_GAME_SERVER_BIN",
    "GSC_LISTEN_HOST",
    "GAME_SERVER_WARM_POOL_LAUNCH_COOLDOWN_SECONDS",
    "GSC_HTTP_HOST",
    "GAME_SERVER_WARM_POOL_CHECK_INTERVAL_SECONDS",
    "GSC_WAIT_MS",
    "GSC_HTTP_PORT",
    "GAME_SERVER_WARM_POOL_MIN_READY",
    "GSC_START_PORT"
];

module.exports = {
    apps: [
        {
            name: "metaverse-server",
            cwd: APP_ROOT,
            script: "src/index.js",
            interpreter: "node",
            exec_mode: "fork",
            instances: 1,
            watch: false,
            autorestart: true,
            env: {
                NODE_ENV: process.env.NODE_ENV || "production",
                NODE_OPTIONS: `--import=${pathToFileURL(
                    path.join(APP_ROOT, "src/voice/directional/voiceDirectionalRoutingExtension.js")
                ).href}`
            }
        },
        {
            name: "metaverse-warm-pool",
            cwd: APP_ROOT,
            script: "src/gameServerControl/tools/warmPoolKeepAlive.js",
            interpreter: "node",
            exec_mode: "fork",
            instances: 1,
            watch: false,
            autorestart: true,
            env: pickEnv(warmPoolEnvKeys)
        }
    ]
};
