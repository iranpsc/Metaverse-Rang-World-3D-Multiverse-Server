"use strict";
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const projectRoot = "/home/world3d/apps/metaverse-server";
const appName = "metaverse-server";
const hookPath = path.join(projectRoot, "src/voice/dedicated/voiceRecordingFinalizationAckReleaseStartupHook.js");
const hookArg = `--import=file://${hookPath}`;
const baselineChecksums = {
    "src/voice/dedicated/voiceDedicatedSessionDeltaService.js": "ddfad049789ffea2c9670800a4b227050da30b37e9638f44d426328a39cd95af",
    "src/voice/recording/voiceRecordingService.js": "274d4e09fbce4e97ca497363ea6e3389c2bd2bda9c18d2eb734a75a8f70a1cef",
    "src/voice/bootstrap/createVoiceV5RuntimeServices.js": "a3fed159fe8a3d18fb9eb712677fbbd2fadf3625153c30fc291a2bf0ceb34a45"
};
for (const [relative, expected] of Object.entries(baselineChecksums)) {
    const file = path.join(projectRoot, relative);
    if (!fs.existsSync(file) || createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== expected) {
        console.error("STOP=BASELINE_MISMATCH: " + relative);
        process.exit(1);
    }
}
const indexSource = fs.readFileSync(path.join(projectRoot, "src/index.js"), "utf8");
if (!indexSource.includes("voiceDedicatedSessionDeltaRuntime.setEventObserver(") ||
    !indexSource.includes("voiceV5RuntimeServices.handleDedicatedSessionEvent(input)") ||
    !indexSource.includes("voiceV4RuntimeServices.handleDedicatedSessionEvent(input)")) {
    console.error("STOP=INDEX_OBSERVER_CONTRACT_CHANGED");
    process.exit(1);
}

if (!fs.existsSync(hookPath)) {
    console.error("STOP=HOOK_FILE_MISSING");
    process.exit(1);
}
const list = JSON.parse(execFileSync("pm2", ["jlist"], { encoding: "utf8", timeout: 15000 }));
const matches = list.filter(p => p.name === appName);
if (matches.length !== 1) {
    console.error("STOP=EXPECTED_EXACTLY_ONE_BACKEND_PROCESS");
    process.exit(1);
}
const env = matches[0].pm2_env || {};
if (env.status !== "online" || env.exec_interpreter !== "node" ||
    env.pm_cwd !== projectRoot || !env.pm_exec_path?.startsWith(projectRoot + "/") ||
    !fs.existsSync(env.pm_exec_path) ||
    (env.exec_mode && env.exec_mode !== "fork_mode") ||
    !Array.isArray(env.node_args) ||
    !env.node_args.some(x => String(x).includes("voiceAuthorityEpochSessionCleanupStartupHook.js"))) {
    console.error("STOP=BACKEND_RUNTIME_UNEXPECTED");
    process.exit(1);
}
if (env.node_args.includes(hookArg)) {
    console.error("STOP=HOOK_ALREADY_PRESENT");
    process.exit(1);
}
const preservedEnv = {};
for (const [key, value] of Object.entries(env)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || key === "NODE_APP_INSTANCE" ||
        key.startsWith("PM2_") || !["string", "boolean", "number"].includes(typeof value)) continue;
    preservedEnv[key] = value;
}
const common = {
    name: appName,
    script: env.pm_exec_path,
    cwd: env.pm_cwd,
    interpreter: env.exec_interpreter,
    exec_mode: "fork",
    node_args: [...env.node_args],
    ...(env.args ? { args: env.args } : {}),
    env: preservedEnv
};
const dir = path.join(os.homedir(), ".vme2-recording-ack-rollout-20261016");
if (fs.existsSync(dir)) {
    console.error("STOP=BACKUP_DIRECTORY_EXISTS: " + dir);
    process.exit(1);
}
fs.mkdirSync(dir, { recursive: false, mode: 0o700 });
fs.chmodSync(dir, 0o700);
const files = [
    ["backend-original.json", common],
    ["backend-recording-hook.json", {
        ...common,
        node_args: [...common.node_args, hookArg],
        env: { ...common.env, VOICE_RECORDING_FINALIZE_ACK_RELEASE_ENABLED: "1" }
    }]
];
for (const [name, app] of files) {
    fs.writeFileSync(path.join(dir, name), JSON.stringify({ apps: [app] }, null, 2), { flag: "wx", mode: 0o600 });
}
console.log("BACKEND_ORIGINAL_CONFIG=PASS");
console.log("BACKEND_HOOK_CONFIG=PASS");
console.log("BACKEND_SCRIPT_UNCHANGED=true");
console.log("EXISTING_NODE_ARGS_PRESERVED=" + common.node_args.length);
console.log("ADDITIONAL_NODE_ARGS=1");
console.log("FILES_PRIVATE_MODE_0600=true");
console.log("CONFIG_DIRECTORY=" + dir);
console.log("WARNING=CONFIG_FILES_CONTAIN_SENSITIVE_ENV_DO_NOT_UPLOAD");
