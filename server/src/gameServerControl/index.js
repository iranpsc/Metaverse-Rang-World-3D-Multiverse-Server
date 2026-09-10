// File => src/gameServerControl/index.js

import fs from "fs";
import {
    loadGameServerControlConfig,
    validateGameServerControlConfig,
    toSafeGameServerControlConfigLog
} from "./gameServerControlConfig.js";

import {
    createGameTicketStore
} from "./tickets/gameTicketStore.js";

import {
    createGameTicketService
} from "./tickets/gameTicketService.js";

import {
    createGameServerRegistry
} from "./registry/gameServerRegistry.js";

import {
    createGameServerHealthStore
} from "./registry/gameServerHealthStore.js";

import {
    createGameServerAllocator
} from "./allocation/gameServerAllocator.js";

import {
    createGameSessionRegistry
} from "./sessions/gameSessionRegistry.js";

import {
    createGameServerServiceToken
} from "./security/gameServerServiceToken.js";

import {
    createClientGameServerHandler
} from "./handlers/clientGameServerHandler.js";

import {
    createDedicatedServerHandler
} from "./handlers/dedicatedServerHandler.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 7777;
const DEFAULT_TICKET_TTL_SECONDS = 60;
const DEFAULT_HEARTBEAT_TIMEOUT_SECONDS = 15;
const DEFAULT_MAX_PLAYERS_PER_INSTANCE = 20;
const DEFAULT_CLEANUP_INTERVAL_SECONDS = 10;
const DEFAULT_SERVICE_SECRET = "change_me";
const DEFAULT_PROCESS_MANIFEST_FILE = "/home/world3d/apps/metaverse-linux-game-server-phase25/DedicatedServer_process_manifest.jsonl";
const DEFAULT_IDLE_SHUTDOWN_ENABLED = false;
const DEFAULT_IDLE_SHUTDOWN_SECONDS = 120;
const DEFAULT_RESTART_ORPHAN_CLEANUP_ENABLED = false;
const DEFAULT_RESTART_ORPHAN_GRACE_SECONDS = 30;
const DEFAULT_PROCESS_MANIFEST_COMPACT_ENABLED = true;
const DEFAULT_PROCESS_MANIFEST_COMPACT_MIN_RECORDS = 200;
const DEFAULT_PROCESS_MANIFEST_COMPACT_KEEP_RECENT_RECORDS = 120;
const DEFAULT_PROCESS_MANIFEST_COMPACT_INTERVAL_SECONDS = 300;
const DEFAULT_PROCESS_RESOURCE_LIMITS_ENABLED = true;
const DEFAULT_PROCESS_MEMORY_LIMIT_MB = 2048;
const DEFAULT_PROCESS_CPU_LIMIT_PERCENT = 300;
const DEFAULT_PROCESS_CPU_GRACE_SECONDS = 30;
const DEFAULT_PROCESS_RESOURCE_SAMPLE_INTERVAL_SECONDS = 10;

//* این تابع مقدار رشته ای معتبر را بررسی می کند.
function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

//* این تابع مقدار عدد صحیح را در بازه امن نگه می دارد.
function clampInteger(value, fallbackValue, minValue, maxValue) {
    const parsedValue = Number.parseInt(value, 10);

    if (!Number.isFinite(parsedValue)) return fallbackValue;
    if (parsedValue < minValue) return minValue;
    if (parsedValue > maxValue) return maxValue;

    return parsedValue;
}

//* این تابع مقدار رشته ای را تمیز می کند و اگر خالی بود مقدار پیش فرض می دهد.
function cleanString(value, fallbackValue = "") {
    if (!isNonEmptyString(value)) return fallbackValue;
    return value.trim();
}

//* این تابع کانفیگ ورودی یا اِنوی را به کانفیگ نهایی ماژول تبدیل می کند.
function resolveGameServerControlConfig(config = null) {
    const sourceConfig = config ?? loadGameServerControlConfig();

    return validateGameServerControlConfig({
        enabled: sourceConfig.enabled === true,
        defaultHost: cleanString(sourceConfig.defaultHost, DEFAULT_HOST),
        defaultPort: clampInteger(sourceConfig.defaultPort, DEFAULT_PORT, 1, 65535),
        ticketTtlSeconds: clampInteger(sourceConfig.ticketTtlSeconds, DEFAULT_TICKET_TTL_SECONDS, 5, 3600),
        heartbeatTimeoutSeconds: clampInteger(sourceConfig.heartbeatTimeoutSeconds, DEFAULT_HEARTBEAT_TIMEOUT_SECONDS, 3, 300),
        maxPlayersPerInstance: clampInteger(sourceConfig.maxPlayersPerInstance, DEFAULT_MAX_PLAYERS_PER_INSTANCE, 1, 1024),
        cleanupIntervalSeconds: clampInteger(sourceConfig.cleanupIntervalSeconds, DEFAULT_CLEANUP_INTERVAL_SECONDS, 1, 300),
        serviceSecret: cleanString(sourceConfig.serviceSecret, DEFAULT_SERVICE_SECRET)
    });
}


//* این تابع مقدار بولی را از اِنوی می خواند.
function readBooleanEnv(name, fallbackValue = false) {
    const rawValue = process.env[name];

    if (rawValue === undefined || rawValue === null || rawValue === "") return fallbackValue;

    const normalizedValue = String(rawValue).trim().toLowerCase();

    if (["1", "true", "yes", "on"].includes(normalizedValue)) return true;
    if (["0", "false", "no", "off"].includes(normalizedValue)) return false;

    return fallbackValue;
}

//* این تابع مقدار عدد صحیح را از اِنوی می خواند.
function readIntegerEnv(name, fallbackValue, minValue, maxValue) {
    const rawValue = process.env[name];

    if (rawValue === undefined || rawValue === null || rawValue === "") return fallbackValue;

    return clampInteger(rawValue, fallbackValue, minValue, maxValue);
}

//* این تابع کانفیگ لایف سایکل پروسه ددیکیتد سرورها را می سازد.
function resolveProcessLifecycleConfig(config = {}) {
    return {
        idleShutdownEnabled: config.idleShutdownEnabled ??
            readBooleanEnv("GAME_SERVER_IDLE_SHUTDOWN_ENABLED", DEFAULT_IDLE_SHUTDOWN_ENABLED),
        idleShutdownSeconds: clampInteger(
            config.idleShutdownSeconds ??
                readIntegerEnv("GAME_SERVER_IDLE_SHUTDOWN_SECONDS", DEFAULT_IDLE_SHUTDOWN_SECONDS, 10, 86400),
            DEFAULT_IDLE_SHUTDOWN_SECONDS,
            10,
            86400
        ),
        processManifestFile: cleanString(
            config.processManifestFile ??
                process.env.GAME_SERVER_PROCESS_MANIFEST_FILE ??
                process.env.GSC_PROCESS_MANIFEST_FILE,
            DEFAULT_PROCESS_MANIFEST_FILE
        ),
        restartOrphanCleanupEnabled: config.restartOrphanCleanupEnabled ??
            readBooleanEnv("GAME_SERVER_RESTART_ORPHAN_CLEANUP_ENABLED", DEFAULT_RESTART_ORPHAN_CLEANUP_ENABLED),
        restartOrphanGraceSeconds: clampInteger(
            config.restartOrphanGraceSeconds ??
                readIntegerEnv("GAME_SERVER_RESTART_ORPHAN_GRACE_SECONDS", DEFAULT_RESTART_ORPHAN_GRACE_SECONDS, 5, 3600),
            DEFAULT_RESTART_ORPHAN_GRACE_SECONDS,
            5,
            3600
        ),
        manifestCompactEnabled: config.manifestCompactEnabled ??
            readBooleanEnv("GAME_SERVER_PROCESS_MANIFEST_COMPACT_ENABLED", DEFAULT_PROCESS_MANIFEST_COMPACT_ENABLED),
        manifestCompactMinRecords: clampInteger(
            config.manifestCompactMinRecords ??
                readIntegerEnv("GAME_SERVER_PROCESS_MANIFEST_COMPACT_MIN_RECORDS", DEFAULT_PROCESS_MANIFEST_COMPACT_MIN_RECORDS, 1, 1000000),
            DEFAULT_PROCESS_MANIFEST_COMPACT_MIN_RECORDS,
            1,
            1000000
        ),
        manifestCompactKeepRecentRecords: clampInteger(
            config.manifestCompactKeepRecentRecords ??
                readIntegerEnv("GAME_SERVER_PROCESS_MANIFEST_COMPACT_KEEP_RECENT_RECORDS", DEFAULT_PROCESS_MANIFEST_COMPACT_KEEP_RECENT_RECORDS, 10, 1000000),
            DEFAULT_PROCESS_MANIFEST_COMPACT_KEEP_RECENT_RECORDS,
            10,
            1000000
        ),
        manifestCompactIntervalSeconds: clampInteger(
            config.manifestCompactIntervalSeconds ??
                readIntegerEnv("GAME_SERVER_PROCESS_MANIFEST_COMPACT_INTERVAL_SECONDS", DEFAULT_PROCESS_MANIFEST_COMPACT_INTERVAL_SECONDS, 10, 86400),
            DEFAULT_PROCESS_MANIFEST_COMPACT_INTERVAL_SECONDS,
            10,
            86400
        ),
        resourceLimitsEnabled: config.resourceLimitsEnabled ??
            readBooleanEnv("GAME_SERVER_PROCESS_RESOURCE_LIMITS_ENABLED", DEFAULT_PROCESS_RESOURCE_LIMITS_ENABLED),
        resourceMemoryLimitMb: clampInteger(
            config.resourceMemoryLimitMb ??
                readIntegerEnv("GAME_SERVER_PROCESS_MEMORY_LIMIT_MB", DEFAULT_PROCESS_MEMORY_LIMIT_MB, 128, 65536),
            DEFAULT_PROCESS_MEMORY_LIMIT_MB,
            128,
            65536
        ),
        resourceCpuLimitPercent: clampInteger(
            config.resourceCpuLimitPercent ??
                readIntegerEnv("GAME_SERVER_PROCESS_CPU_LIMIT_PERCENT", DEFAULT_PROCESS_CPU_LIMIT_PERCENT, 50, 10000),
            DEFAULT_PROCESS_CPU_LIMIT_PERCENT,
            50,
            10000
        ),
        resourceCpuGraceSeconds: clampInteger(
            config.resourceCpuGraceSeconds ??
                readIntegerEnv("GAME_SERVER_PROCESS_CPU_GRACE_SECONDS", DEFAULT_PROCESS_CPU_GRACE_SECONDS, 5, 3600),
            DEFAULT_PROCESS_CPU_GRACE_SECONDS,
            5,
            3600
        ),
        resourceSampleIntervalSeconds: clampInteger(
            config.resourceSampleIntervalSeconds ??
                readIntegerEnv("GAME_SERVER_PROCESS_RESOURCE_SAMPLE_INTERVAL_SECONDS", DEFAULT_PROCESS_RESOURCE_SAMPLE_INTERVAL_SECONDS, 5, 3600),
            DEFAULT_PROCESS_RESOURCE_SAMPLE_INTERVAL_SECONDS,
            5,
            3600
        )
    };
}

//* این تابع فایل مَنیفِست پروسه ها را می خواند.
function readProcessManifestRecords(manifestFile) {
    if (!isNonEmptyString(manifestFile)) return [];
    if (!fs.existsSync(manifestFile)) return [];

    const content = fs.readFileSync(manifestFile, "utf8");
    const records = [];

    for (const line of content.split(/\r?\n/g)) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        try {
            records.push(JSON.parse(trimmedLine));
        } catch {
            // خط خراب مَنیفِست نادیده گرفته می شود تا پاکسازی متوقف نشود.
        }
    }

    return records;
}

//* این تابع یک رویداد لایف سایکل را در مَنیفِست ثبت می کند.
function createManifestRecordProcessKey(record = {}) {
    return [
        record.serverId ?? "",
        record.roomId ?? "",
        record.pid ?? ""
    ].join("|");
}

function writeProcessManifestRecordsAtomic(manifestFile, records = []) {
    const dir = path.dirname(manifestFile);
    fs.mkdirSync(dir, { recursive: true });

    const tempFile = `${manifestFile}.tmp_${process.pid}_${Date.now()}`;
    const finalContent = records.map((record) => JSON.stringify(record)).join("\n") + (records.length > 0 ? "\n" : "");

    fs.writeFileSync(tempFile, finalContent, "utf8");
    fs.renameSync(tempFile, manifestFile);
}

function compactProcessManifestRecords(manifestFile, manifestRecords = [], options = {}) {
    const result = {
        success: true,
        reason: "manifest_compaction_not_needed",
        manifestFile,
        beforeRecords: manifestRecords.length,
        afterRecords: manifestRecords.length,
        removedRecords: 0,
        keptRecentRecords: 0,
        keptActiveLaunchRecords: 0,
        keptLiveLaunchRecords: 0,
        keptLiveTerminalRecords: 0,
        backupFile: ""
    };

    if (!isNonEmptyString(manifestFile)) {
        return {
            ...result,
            success: false,
            reason: "manifest_file_missing"
        };
    }

    if (!fs.existsSync(manifestFile)) {
        return {
            ...result,
            reason: "manifest_file_not_found"
        };
    }

    const minRecords = clampInteger(options.minRecords, DEFAULT_PROCESS_MANIFEST_COMPACT_MIN_RECORDS, 1, 1000000);
    const keepRecentRecords = clampInteger(options.keepRecentRecords, DEFAULT_PROCESS_MANIFEST_COMPACT_KEEP_RECENT_RECORDS, 10, 1000000);
    const activeServerIds = options.activeServerIds instanceof Set ? options.activeServerIds : new Set();

    if (manifestRecords.length < minRecords) {
        return {
            ...result,
            reason: "manifest_record_count_below_compaction_threshold"
        };
    }

    const terminalEvents = new Set([
        "idle_shutdown_signal_sent",
        "orphan_shutdown_signal_sent",
        "process_not_alive_cleanup"
    ]);

    const keepIndexes = new Set();
    const liveProcessKeys = new Set();
    const activeProcessKeys = new Set();
    const recentStartIndex = Math.max(0, manifestRecords.length - keepRecentRecords);

    for (let index = recentStartIndex; index < manifestRecords.length; index++) {
        keepIndexes.add(index);
        result.keptRecentRecords++;
    }

    for (let index = 0; index < manifestRecords.length; index++) {
        const record = manifestRecords[index];
        if (!record || record.event !== "launched") continue;

        const processKey = createManifestRecordProcessKey(record);
        const isActiveRegistryServer = activeServerIds.has(record.serverId);
        const alive = isProcessAlive(record.pid);

        if (isActiveRegistryServer) {
            keepIndexes.add(index);
            activeProcessKeys.add(processKey);
            result.keptActiveLaunchRecords++;
        }

        if (alive) {
            keepIndexes.add(index);
            liveProcessKeys.add(processKey);
            result.keptLiveLaunchRecords++;
        }
    }

    for (let index = 0; index < manifestRecords.length; index++) {
        const record = manifestRecords[index];
        if (!record || !terminalEvents.has(record.event)) continue;

        const processKey = createManifestRecordProcessKey(record);

        if (liveProcessKeys.has(processKey) || activeProcessKeys.has(processKey)) {
            keepIndexes.add(index);
            result.keptLiveTerminalRecords++;
        }
    }

    const compactedRecords = manifestRecords.filter((record, index) => keepIndexes.has(index));

    if (compactedRecords.length >= manifestRecords.length) {
        return {
            ...result,
            reason: "manifest_compaction_no_records_removed"
        };
    }

    const backupFile = `${manifestFile}.compact_bak_${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fs.copyFileSync(manifestFile, backupFile);
    writeProcessManifestRecordsAtomic(manifestFile, compactedRecords);

    return {
        ...result,
        reason: "manifest_compacted",
        afterRecords: compactedRecords.length,
        removedRecords: manifestRecords.length - compactedRecords.length,
        backupFile
    };
}

function appendProcessLifecycleRecord(manifestFile, record) {
    if (!isNonEmptyString(manifestFile)) return null;

    const finalRecord = {
        ...record,
        recordedAt: Date.now(),
        recordedAtIso: new Date().toISOString()
    };

    fs.appendFileSync(manifestFile, `${JSON.stringify(finalRecord)}\n`, "utf8");

    return finalRecord;
}

//* این تابع بررسی می کند پروسه لینوکسی هنوز زنده است یا نه.
function isProcessAlive(pid) {
    const normalizedPid = Number.parseInt(pid, 10);

    if (!Number.isInteger(normalizedPid) || normalizedPid <= 0) return false;

    try {
        process.kill(normalizedPid, 0);
        return true;
    } catch {
        return false;
    }
}


function readLinuxProcessResourceUsage(pid) {
    const normalizedPid = Number.parseInt(pid, 10);

    if (!Number.isInteger(normalizedPid) || normalizedPid <= 0) {
        return {
            success: false,
            reason: "pid_invalid",
            pid
        };
    }

    const procDir = `/proc/${normalizedPid}`;

    if (!fs.existsSync(procDir)) {
        return {
            success: false,
            reason: "proc_not_found",
            pid: normalizedPid
        };
    }

    let rssMb = 0;
    let cpuPercent = 0;
    let elapsedSeconds = 0;

    try {
        const statusText = fs.readFileSync(`${procDir}/status`, "utf8");
        const rssMatch = statusText.match(/^VmRSS:\s+(\d+)\s+kB/im);

        if (rssMatch) {
            rssMb = Number.parseInt(rssMatch[1], 10) / 1024;
        }
    } catch {
        rssMb = 0;
    }

    try {
        const statText = fs.readFileSync(`${procDir}/stat`, "utf8");
        const closeIndex = statText.lastIndexOf(")");
        const after = statText.slice(closeIndex + 2).trim().split(/\s+/g);

        const clockTicks = 100;
        const utimeTicks = Number.parseInt(after[11], 10);
        const stimeTicks = Number.parseInt(after[12], 10);
        const startTimeTicks = Number.parseInt(after[19], 10);

        const uptimeText = fs.readFileSync("/proc/uptime", "utf8");
        const systemUptimeSeconds = Number.parseFloat(uptimeText.split(/\s+/g)[0]);

        const processCpuSeconds = (utimeTicks + stimeTicks) / clockTicks;
        const processStartSeconds = startTimeTicks / clockTicks;

        elapsedSeconds = Math.max(0.001, systemUptimeSeconds - processStartSeconds);
        cpuPercent = Math.max(0, (processCpuSeconds / elapsedSeconds) * 100);
    } catch {
        cpuPercent = 0;
        elapsedSeconds = 0;
    }

    return {
        success: true,
        reason: "process_resource_usage_loaded",
        pid: normalizedPid,
        rssMb: Number(rssMb.toFixed(2)),
        cpuPercent: Number(cpuPercent.toFixed(2)),
        elapsedSeconds: Number(elapsedSeconds.toFixed(2))
    };
}

//* این تابع پاسخ موفق استاندارد برای کنترلر داخلی می سازد.
function createSuccess(reason, message, data = {}) {
    return {
        success: true,
        reason,
        message,
        data,
        ts: Date.now()
    };
}

//* این تابع پاسخ خطای استاندارد برای کنترلر داخلی می سازد.
function createFailure(reason, message, data = {}) {
    return {
        success: false,
        reason,
        message,
        data,
        ts: Date.now()
    };
}

//* این کلاس همه قطعات ماژول کنترل گیم سرور را کنار هم مدیریت می کند.
class GameServerControl {
    constructor(options = {}) {
        this.config = resolveGameServerControlConfig(options.config ?? null);
        this.logger = options.logger ?? console;

        this.ticketStore = options.ticketStore ?? createGameTicketStore({
            maxTickets: options.maxTickets
        });

        this.ticketService = options.ticketService ?? createGameTicketService({
            config: this.config,
            ticketStore: this.ticketStore,
            serviceSecret: this.config.serviceSecret,
            ticketTtlSeconds: this.config.ticketTtlSeconds
        });

        this.registry = options.registry ?? createGameServerRegistry({
            defaultHost: this.config.defaultHost,
            defaultPort: this.config.defaultPort,
            defaultMaxPlayers: this.config.maxPlayersPerInstance
        });

        this.healthStore = options.healthStore ?? createGameServerHealthStore({
            heartbeatTimeoutSeconds: this.config.heartbeatTimeoutSeconds
        });

        this.sessionRegistry = options.sessionRegistry ?? createGameSessionRegistry();

        this.allocator = options.allocator ?? createGameServerAllocator({
            registry: this.registry,
            healthStore: this.healthStore
        });

        this.serviceTokenService = options.serviceTokenService ?? createGameServerServiceToken({
            serviceSecret: this.config.serviceSecret,
            defaultTtlSeconds: this.config.ticketTtlSeconds
        });

        this.clientHandler = options.clientHandler ?? createClientGameServerHandler({
            allocator: this.allocator,
            ticketService: this.ticketService,
            sessionRegistry: this.sessionRegistry,
            registry: this.registry,
            healthStore: this.healthStore,
            logger: this.logger
        });

        this.dedicatedServerHandler = options.dedicatedServerHandler ?? createDedicatedServerHandler({
            registry: this.registry,
            healthStore: this.healthStore,
            ticketService: this.ticketService,
            sessionRegistry: this.sessionRegistry,
            serviceTokenService: this.serviceTokenService,
            logger: this.logger
        });

        this.processLifecycleConfig = resolveProcessLifecycleConfig(options.processLifecycle ?? {});
        this.emptyServerSeenAtByServerId = new Map();
        this.orphanProcessSeenAtByProcessKey = new Map();
        this.lastManifestCompactionAt = 0;
        this.resourceCpuExceededSeenAtByProcessKey = new Map();
        this.lastResourceLimitSampleAt = 0;

        this.started = false;
        this.cleanupTimer = null;

        if (options.autoStart === true) {
            this.start();
        }
    }

    //* این تابع ماژول را روشن می کند ولی هیچ روت یا سرور جدیدی باز نمی کند.
    start() {
        if (!this.config.enabled) {
            return createSuccess("game_server_control_disabled", "Game server control module is disabled.", {
                config: toSafeGameServerControlConfigLog(this.config)
            });
        }

        if (this.started) {
            return createSuccess("game_server_control_already_started", "Game server control module is already started.", {
                config: toSafeGameServerControlConfigLog(this.config)
            });
        }

        this.started = true;

        this.cleanupTimer = setInterval(() => {
            this.cleanup();
        }, this.config.cleanupIntervalSeconds * 1000);

        if (typeof this.cleanupTimer.unref === "function") {
            this.cleanupTimer.unref();
        }

        return createSuccess("game_server_control_started", "Game server control module started.", {
            config: toSafeGameServerControlConfigLog(this.config)
        });
    }

    //* این تابع ماژول را خاموش می کند و تایمرهای داخلی را می بندد.
    stop() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }

        this.started = false;

        return createSuccess("game_server_control_stopped", "Game server control module stopped.", {
            config: toSafeGameServerControlConfigLog(this.config)
        });
    }

    //* این تابع پاکسازی داخلی تیکت ها، سلامت سرورها و سشن های بسته شده را انجام می دهد.
    cleanup() {
        const expiredTickets = this.ticketService.cleanupExpiredTickets();
        const staleHealthRecords = this.healthStore.cleanupStaleHealthRecords();
        const closedSessions = this.sessionRegistry.cleanupClosedSessions();
        const timedOutServers = this.healthStore.listTimedOutServers();

        for (const serverHealth of timedOutServers) {
            this.registry.markServerUnhealthy(serverHealth.serverId);
        }

        const processLifecycle = this.cleanupDedicatedServerProcesses();

        return createSuccess("game_server_control_cleanup_done", "Game server control cleanup completed.", {
            expiredTickets,
            staleHealthRecords,
            closedSessions,
            timedOutServers: timedOutServers.length,
            processLifecycle
        });
    }

    //#region Phase 7.L - Public 3D Lobby Idle Shutdown Protection

    //* این تابع بررسی می کند آیا سرور دارای سشن دائمی و باز لابی عمومی است یا خیر.
    hasPermanentOpenSessionForServer(serverId) {
        const normalizedServerId = cleanString(serverId, "");

        if (!normalizedServerId || !this.sessionRegistry ||
            typeof this.sessionRegistry.listSessionsByServer !== "function") return false;

        const sessions = this.sessionRegistry.listSessionsByServer(normalizedServerId);

        return sessions.some((session) => {
            if (!this.sessionRegistry.isPublicSessionOpen(session)) return false;

            const metadata = session?.metadata && typeof session.metadata === "object"
                ? session.metadata
                : {};

            return metadata.isPermanent === true ||
                metadata.autoCloseWhenEmpty === false;
        });
    }

    //#endregion Phase 7.L - Public 3D Lobby Idle Shutdown Protection

    //* این تابع پروسه های ددیکیتد سرور را بر اساس مَنیفِست و وضعیت خالی بودن مدیریت می کند.
    cleanupDedicatedServerProcesses() {
        const result = {
            enabled: this.processLifecycleConfig.idleShutdownEnabled,
            manifestFile: this.processLifecycleConfig.processManifestFile,
            scannedServers: 0,
            missingManifest: 0,
            deadProcessesRemoved: 0,
            idleServersTracked: 0,
            idleShutdowns: 0,
            manifestCompaction: null,
            resourceLimits: null,
            errors: []
        };

        if (!this.registry || !this.healthStore || !this.sessionRegistry) return result;

        const servers = this.registry.listServers();
        const manifestRecords = readProcessManifestRecords(this.processLifecycleConfig.processManifestFile);
        const now = Date.now();
        const idleShutdownMs = this.processLifecycleConfig.idleShutdownSeconds * 1000;

        for (const server of servers) {
            result.scannedServers++;

            const launchRecord = this.findLatestLaunchRecord(manifestRecords, server);

            if (!launchRecord) {
                result.missingManifest++;
                continue;
            }

            const alive = isProcessAlive(launchRecord.pid);

            if (!alive) {
                this.removeServerAfterProcessExit(server, launchRecord, "process_not_alive");
                this.emptyServerSeenAtByServerId.delete(server.serverId);
                result.deadProcessesRemoved++;
                continue;
            }

            if (!this.processLifecycleConfig.idleShutdownEnabled) continue;

            //#region Phase 7.L - Public 3D Lobby Idle Shutdown Protection

            //* سروری که سشن دائمی و باز لابی را نگه می دارد حتی با صفر بازیکن وارد شمارش خاموشی بیکار نمی شود.
            if (this.hasPermanentOpenSessionForServer(server.serverId)) {
                this.emptyServerSeenAtByServerId.delete(server.serverId);
                continue;
            }

            //#endregion Phase 7.L - Public 3D Lobby Idle Shutdown Protection

            if (server.currentPlayers > 0) {
                this.emptyServerSeenAtByServerId.delete(server.serverId);
                continue;
            }

            const firstEmptyAt = this.emptyServerSeenAtByServerId.get(server.serverId) ?? now;
            this.emptyServerSeenAtByServerId.set(server.serverId, firstEmptyAt);
            result.idleServersTracked++;

            if (now - firstEmptyAt < idleShutdownMs) continue;

            const shutdownResult = this.shutdownIdleServerProcess(server, launchRecord);

            if (shutdownResult.success) {
                result.idleShutdowns++;
                this.emptyServerSeenAtByServerId.delete(server.serverId);
            } else {
                result.errors.push(shutdownResult);
            }
        }

        const resourceLimits = this.cleanupResourceLimitViolations(servers, manifestRecords);
        const orphanRecovery = this.cleanupOrphanProcessesFromManifest(manifestRecords);
        const manifestCompaction = this.compactProcessManifestIfNeeded(manifestRecords);

        return {
            ...result,
            resourceLimits,
            orphanRecovery,
            manifestCompaction
        };
    }

    cleanupResourceLimitViolations(servers = [], manifestRecords = []) {
        const cfg = this.processLifecycleConfig;
        const now = Date.now();

        const result = {
            enabled: cfg.resourceLimitsEnabled,
            memoryLimitMb: cfg.resourceMemoryLimitMb,
            cpuLimitPercent: cfg.resourceCpuLimitPercent,
            cpuGraceSeconds: cfg.resourceCpuGraceSeconds,
            sampleIntervalSeconds: cfg.resourceSampleIntervalSeconds,
            scannedServers: 0,
            skippedInterval: false,
            missingManifest: 0,
            deadProcesses: 0,
            resourceSamples: 0,
            memoryViolations: 0,
            cpuViolationsTracked: 0,
            cpuViolationsShutdown: 0,
            shutdowns: 0,
            errors: []
        };

        if (!cfg.resourceLimitsEnabled) return result;

        if (this.lastResourceLimitSampleAt > 0) {
            const intervalMs = cfg.resourceSampleIntervalSeconds * 1000;

            if (now - this.lastResourceLimitSampleAt < intervalMs) {
                return {
                    ...result,
                    skippedInterval: true
                };
            }
        }

        this.lastResourceLimitSampleAt = now;

        for (const server of servers) {
            result.scannedServers++;

            const launchRecord = this.findLatestLaunchRecord(manifestRecords, server);

            if (!launchRecord) {
                result.missingManifest++;
                continue;
            }

            const processKey = this.createManifestProcessKey(launchRecord);

            if (!isProcessAlive(launchRecord.pid)) {
                this.resourceCpuExceededSeenAtByProcessKey.delete(processKey);
                result.deadProcesses++;
                continue;
            }

            const usage = readLinuxProcessResourceUsage(launchRecord.pid);

            if (!usage.success) {
                result.errors.push({
                    reason: usage.reason,
                    serverId: server.serverId,
                    roomId: server.roomId,
                    pid: launchRecord.pid
                });
                continue;
            }

            result.resourceSamples++;

            const memoryExceeded = cfg.resourceMemoryLimitMb > 0 && usage.rssMb > cfg.resourceMemoryLimitMb;
            const cpuExceeded = cfg.resourceCpuLimitPercent > 0 && usage.cpuPercent > cfg.resourceCpuLimitPercent;

            if (memoryExceeded) {
                result.memoryViolations++;

                const shutdownResult = this.shutdownResourceLimitedServerProcess(
                    server,
                    launchRecord,
                    "memory_limit_exceeded",
                    usage
                );

                if (shutdownResult.success) {
                    result.shutdowns++;
                    this.resourceCpuExceededSeenAtByProcessKey.delete(processKey);
                } else {
                    result.errors.push(shutdownResult);
                }

                continue;
            }

            if (!cpuExceeded) {
                this.resourceCpuExceededSeenAtByProcessKey.delete(processKey);
                continue;
            }

            const firstExceededAt = this.resourceCpuExceededSeenAtByProcessKey.get(processKey) ?? now;
            this.resourceCpuExceededSeenAtByProcessKey.set(processKey, firstExceededAt);
            result.cpuViolationsTracked++;

            const graceMs = cfg.resourceCpuGraceSeconds * 1000;

            if (now - firstExceededAt < graceMs) continue;

            const shutdownResult = this.shutdownResourceLimitedServerProcess(
                server,
                launchRecord,
                "cpu_limit_exceeded",
                usage
            );

            if (shutdownResult.success) {
                result.shutdowns++;
                result.cpuViolationsShutdown++;
                this.resourceCpuExceededSeenAtByProcessKey.delete(processKey);
            } else {
                result.errors.push(shutdownResult);
            }
        }

        return result;
    }

    shutdownResourceLimitedServerProcess(server, launchRecord, violationReason, resourceUsage = {}) {
        try {
            appendProcessLifecycleRecord(this.processLifecycleConfig.processManifestFile, {
                event: "resource_limit_shutdown_requested",
                reason: violationReason,
                pid: launchRecord.pid,
                serverId: server.serverId,
                roomId: server.roomId,
                port: server.port,
                memoryLimitMb: this.processLifecycleConfig.resourceMemoryLimitMb,
                cpuLimitPercent: this.processLifecycleConfig.resourceCpuLimitPercent,
                resourceUsage
            });

            process.kill(Number.parseInt(launchRecord.pid, 10), "SIGTERM");

            const sessions = this.closeSessionsForServer(server.serverId, "resource_limit_session_closed");
            const registryRemoved = this.registry.unregisterServer(server.serverId);
            const healthRemoved = this.healthStore.removeHealth(server.serverId);

            appendProcessLifecycleRecord(this.processLifecycleConfig.processManifestFile, {
                event: "resource_limit_shutdown_signal_sent",
                reason: "sigterm_sent",
                violationReason,
                pid: launchRecord.pid,
                serverId: server.serverId,
                roomId: server.roomId,
                port: server.port,
                registryRemoved,
                healthRemoved,
                sessionsClosed: sessions.closed,
                resourceUsage
            });

            return {
                success: true,
                reason: "resource_limit_shutdown_signal_sent",
                violationReason,
                serverId: server.serverId,
                roomId: server.roomId,
                pid: launchRecord.pid,
                resourceUsage
            };
        } catch (error) {
            return {
                success: false,
                reason: "resource_limit_shutdown_failed",
                violationReason,
                serverId: server.serverId,
                roomId: server.roomId,
                pid: launchRecord.pid,
                error: error?.message ?? String(error)
            };
        }
    }

    compactProcessManifestIfNeeded(manifestRecords = []) {
        const cfg = this.processLifecycleConfig;
        const now = Date.now();

        const result = {
            enabled: cfg.manifestCompactEnabled,
            manifestFile: cfg.processManifestFile,
            minRecords: cfg.manifestCompactMinRecords,
            keepRecentRecords: cfg.manifestCompactKeepRecentRecords,
            intervalSeconds: cfg.manifestCompactIntervalSeconds,
            elapsedSeconds: this.lastManifestCompactionAt > 0 ? Math.floor((now - this.lastManifestCompactionAt) / 1000) : null,
            success: true,
            reason: "manifest_compaction_disabled"
        };

        if (!cfg.manifestCompactEnabled) return result;

        if (this.lastManifestCompactionAt > 0) {
            const intervalMs = cfg.manifestCompactIntervalSeconds * 1000;
            if (now - this.lastManifestCompactionAt < intervalMs) {
                return {
                    ...result,
                    reason: "manifest_compaction_interval_not_reached"
                };
            }
        }

        const activeServerIds = new Set(
            this.registry && typeof this.registry.listServers === "function"
                ? this.registry.listServers().map((server) => server.serverId)
                : []
        );

        try {
            const compactResult = compactProcessManifestRecords(cfg.processManifestFile, manifestRecords, {
                activeServerIds,
                minRecords: cfg.manifestCompactMinRecords,
                keepRecentRecords: cfg.manifestCompactKeepRecentRecords
            });

            if (compactResult.reason === "manifest_compacted") {
                this.lastManifestCompactionAt = now;

                appendProcessLifecycleRecord(cfg.processManifestFile, {
                    event: "manifest_compacted",
                    reason: "manifest_cleanup_hardening",
                    beforeRecords: compactResult.beforeRecords,
                    afterRecords: compactResult.afterRecords,
                    removedRecords: compactResult.removedRecords,
                    backupFile: compactResult.backupFile,
                    keepRecentRecords: cfg.manifestCompactKeepRecentRecords,
                    minRecords: cfg.manifestCompactMinRecords
                });
            }

            return {
                ...result,
                ...compactResult
            };
        } catch (error) {
            return {
                ...result,
                success: false,
                reason: "manifest_compaction_failed",
                error: error?.message ?? String(error)
            };
        }
    }

    //* این تابع پروسه های زنده ای را که بعد از ریستارت نود داخل رجیستری نیستند خاموش می کند.
    cleanupOrphanProcessesFromManifest(manifestRecords) {
        const result = {
            enabled: this.processLifecycleConfig.restartOrphanCleanupEnabled,
            graceSeconds: this.processLifecycleConfig.restartOrphanGraceSeconds,
            scannedLaunchRecords: 0,
            liveOrphansTracked: 0,
            orphanShutdowns: 0,
            deadLaunchRecordsMarked: 0,
            skippedActiveRegistryServers: 0,
            skippedTerminalRecords: 0,
            errors: []
        };

        const terminalProcessKeys = this.buildTerminalManifestProcessKeys(manifestRecords);
        const activeServerIds = new Set(this.registry.listServers().map((server) => server.serverId));
        const now = Date.now();
        const graceMs = this.processLifecycleConfig.restartOrphanGraceSeconds * 1000;

        for (let index = manifestRecords.length - 1; index >= 0; index--) {
            const record = manifestRecords[index];

            if (!record || record.event !== "launched") continue;

            result.scannedLaunchRecords++;

            const processKey = this.createManifestProcessKey(record);

            if (terminalProcessKeys.has(processKey)) {
                result.skippedTerminalRecords++;
                continue;
            }

            if (activeServerIds.has(record.serverId)) {
                this.orphanProcessSeenAtByProcessKey.delete(processKey);
                result.skippedActiveRegistryServers++;
                continue;
            }

            const alive = isProcessAlive(record.pid);

            if (!alive) {
                appendProcessLifecycleRecord(this.processLifecycleConfig.processManifestFile, {
                    event: "process_not_alive_cleanup",
                    reason: "manifest_process_dead_without_registry",
                    pid: record.pid,
                    serverId: record.serverId,
                    roomId: record.roomId,
                    port: record.publicPort ?? record.listenPort
                });

                terminalProcessKeys.add(processKey);
                this.orphanProcessSeenAtByProcessKey.delete(processKey);
                result.deadLaunchRecordsMarked++;
                continue;
            }

            if (!this.processLifecycleConfig.restartOrphanCleanupEnabled) continue;

            const firstSeenAt = this.orphanProcessSeenAtByProcessKey.get(processKey) ?? now;
            this.orphanProcessSeenAtByProcessKey.set(processKey, firstSeenAt);
            result.liveOrphansTracked++;

            if (now - firstSeenAt < graceMs) continue;

            const shutdownResult = this.shutdownOrphanServerProcess(record);

            if (shutdownResult.success) {
                result.orphanShutdowns++;
                this.orphanProcessSeenAtByProcessKey.delete(processKey);
                terminalProcessKeys.add(processKey);
            } else {
                result.errors.push(shutdownResult);
            }
        }

        return result;
    }

    //* این تابع کلید یکتای پروسه را برای مَنیفِست می سازد.
    createManifestProcessKey(record) {
        return [
            record.serverId ?? "",
            record.roomId ?? "",
            record.pid ?? ""
        ].join("|");
    }

    //* این تابع رکوردهای پایانی مَنیفِست را برای جلوگیری از پردازش دوباره جدا می کند.
    buildTerminalManifestProcessKeys(manifestRecords) {
        const terminalEvents = new Set([
            "idle_shutdown_signal_sent",
            "orphan_shutdown_signal_sent",
            "process_not_alive_cleanup"
        ]);

        const keys = new Set();

        for (const record of manifestRecords) {
            if (!record || !terminalEvents.has(record.event)) continue;
            keys.add(this.createManifestProcessKey(record));
        }

        return keys;
    }

    //* این تابع پروسه اورفَن را خاموش می کند.
    shutdownOrphanServerProcess(record) {
        try {
            appendProcessLifecycleRecord(this.processLifecycleConfig.processManifestFile, {
                event: "orphan_shutdown_requested",
                reason: "live_manifest_process_missing_from_registry_after_restart",
                pid: record.pid,
                serverId: record.serverId,
                roomId: record.roomId,
                port: record.publicPort ?? record.listenPort,
                graceSeconds: this.processLifecycleConfig.restartOrphanGraceSeconds
            });

            process.kill(Number.parseInt(record.pid, 10), "SIGTERM");

            appendProcessLifecycleRecord(this.processLifecycleConfig.processManifestFile, {
                event: "orphan_shutdown_signal_sent",
                reason: "sigterm_sent",
                pid: record.pid,
                serverId: record.serverId,
                roomId: record.roomId,
                port: record.publicPort ?? record.listenPort
            });

            return {
                success: true,
                reason: "orphan_shutdown_signal_sent",
                serverId: record.serverId,
                roomId: record.roomId,
                pid: record.pid
            };
        } catch (error) {
            return {
                success: false,
                reason: "orphan_shutdown_failed",
                serverId: record.serverId,
                roomId: record.roomId,
                pid: record.pid,
                error: error?.message ?? String(error)
            };
        }
    }

    //* این تابع آخرین رکورد لانچ یک سرور را از مَنیفِست پیدا می کند.
    findLatestLaunchRecord(manifestRecords, server) {
        for (let index = manifestRecords.length - 1; index >= 0; index--) {
            const record = manifestRecords[index];

            if (!record || record.event !== "launched") continue;
            if (record.serverId !== server.serverId) continue;
            if (server.roomId && record.roomId !== server.roomId) continue;

            return record;
        }

        return null;
    }

    //* این تابع سروری را که پروسه اش دیگر زنده نیست از حافظه کنترل پاک می کند.
    removeServerAfterProcessExit(server, launchRecord, reason) {
        const sessions = this.closeSessionsForServer(server.serverId, `${reason}_session_closed`);
        const registryRemoved = this.registry.unregisterServer(server.serverId);
        const healthRemoved = this.healthStore.removeHealth(server.serverId);

        appendProcessLifecycleRecord(this.processLifecycleConfig.processManifestFile, {
            event: "process_not_alive_cleanup",
            reason,
            pid: launchRecord.pid,
            serverId: server.serverId,
            roomId: server.roomId,
            port: server.port,
            sessionsClosed: sessions.closed
        });

        return { registryRemoved, healthRemoved, sessions };
    }

    //* این تابع پروسه سرور خالی را خاموش و رکوردهای داخلی را پاک می کند.
    shutdownIdleServerProcess(server, launchRecord) {
        try {
            appendProcessLifecycleRecord(this.processLifecycleConfig.processManifestFile, {
                event: "idle_shutdown_requested",
                reason: "current_players_zero_idle_timeout",
                pid: launchRecord.pid,
                serverId: server.serverId,
                roomId: server.roomId,
                port: server.port,
                idleShutdownSeconds: this.processLifecycleConfig.idleShutdownSeconds
            });

            process.kill(Number.parseInt(launchRecord.pid, 10), "SIGTERM");

            const sessions = this.closeSessionsForServer(server.serverId, "idle_shutdown_session_closed");
            const registryRemoved = this.registry.unregisterServer(server.serverId);
            const healthRemoved = this.healthStore.removeHealth(server.serverId);

            appendProcessLifecycleRecord(this.processLifecycleConfig.processManifestFile, {
                event: "idle_shutdown_signal_sent",
                reason: "sigterm_sent",
                pid: launchRecord.pid,
                serverId: server.serverId,
                roomId: server.roomId,
                port: server.port,
                registryRemoved,
                healthRemoved,
                sessionsClosed: sessions.closed
            });

            return {
                success: true,
                reason: "idle_shutdown_signal_sent",
                serverId: server.serverId,
                roomId: server.roomId,
                pid: launchRecord.pid
            };
        } catch (error) {
            return {
                success: false,
                reason: "idle_shutdown_failed",
                serverId: server.serverId,
                roomId: server.roomId,
                pid: launchRecord.pid,
                error: error?.message ?? String(error)
            };
        }
    }

    //* این تابع سشن های مربوط به یک سرور را می بندد.
    closeSessionsForServer(serverId, reason) {
        const sessions = this.sessionRegistry.listSessionsByServer(serverId);
        let closed = 0;

        for (const session of sessions) {
            if (!this.sessionRegistry.isPublicSessionOpen(session)) continue;

            const result = this.sessionRegistry.closeSession(session.sessionId, reason);
            if (result?.success) closed++;
        }

        return { total: sessions.length, closed };
    }

    //* این تابع وضعیت کلی ماژول کنترل گیم سرور را برمی گرداند.
    getDedicatedHealthReport(options = {}) {
        const maxManifestTailRecords = clampInteger(options.maxManifestTailRecords, 20, 1, 200);
        const servers = this.registry && typeof this.registry.listServers === "function"
            ? this.registry.listServers()
            : [];

        const serverReports = servers.map((server) => {
            const serverId = server?.serverId ?? "";
            const health = this.healthStore && typeof this.healthStore.getHealth === "function"
                ? this.healthStore.getHealth(serverId)
                : null;
            const sessions = this.sessionRegistry && typeof this.sessionRegistry.listSessionsByServer === "function"
                ? this.sessionRegistry.listSessionsByServer(serverId)
                : [];

            return {
                server,
                health,
                sessions,
                sessionCount: Array.isArray(sessions) ? sessions.length : 0
            };
        });

        const manifestRecords = readProcessManifestRecords(this.processLifecycleConfig.processManifestFile);
        const manifestTail = manifestRecords.slice(Math.max(0, manifestRecords.length - maxManifestTailRecords));
        const manifestEvents = {};

        for (const record of manifestRecords) {
            const event = record?.event ?? "unknown";
            manifestEvents[event] = (manifestEvents[event] ?? 0) + 1;
        }

        const terminalProcessKeys = this.buildTerminalManifestProcessKeys(manifestRecords);
        const launchedRecords = manifestRecords.filter((record) => record?.event === "launched");
        const liveLaunches = launchedRecords.filter((record) => {
            const processKey = this.createManifestProcessKey(record);
            return !terminalProcessKeys.has(processKey) && isProcessAlive(record.pid);
        });

        const report = {
            overview: {
                registeredServerCount: servers.length,
                healthServerCount: this.healthStore && typeof this.healthStore.getStats === "function"
                    ? this.healthStore.getStats()?.totalServers ?? 0
                    : 0,
                sessionCount: this.sessionRegistry && typeof this.sessionRegistry.getStats === "function"
                    ? this.sessionRegistry.getStats()?.totalSessions ?? 0
                    : 0,
                liveManifestProcessCount: liveLaunches.length
            },
            registry: {
                stats: this.registry && typeof this.registry.getStats === "function"
                    ? this.registry.getStats()
                    : null,
                servers
            },
            health: {
                stats: this.healthStore && typeof this.healthStore.getStats === "function"
                    ? this.healthStore.getStats()
                    : null
            },
            sessions: {
                stats: this.sessionRegistry && typeof this.sessionRegistry.getStats === "function"
                    ? this.sessionRegistry.getStats()
                    : null
            },
            dedicatedServers: serverReports,
            processLifecycle: this.processLifecycleConfig,
            manifest: {
                file: this.processLifecycleConfig.processManifestFile,
                exists: fs.existsSync(this.processLifecycleConfig.processManifestFile),
                totalRecords: manifestRecords.length,
                eventCounts: manifestEvents,
                latestRecord: manifestRecords.length > 0 ? manifestRecords[manifestRecords.length - 1] : null,
                liveLaunches: liveLaunches.map((record) => ({
                    pid: record.pid,
                    serverId: record.serverId,
                    roomId: record.roomId,
                    port: record.publicPort ?? record.listenPort ?? record.port ?? 0,
                    recordedAt: record.recordedAt ?? 0,
                    recordedAtIso: record.recordedAtIso ?? ""
                })),
                tail: manifestTail
            }
        };

        return createSuccess("dedicated_health_report_loaded", "Dedicated server health report loaded.", report);
    }

    getStatus() {
        const sessionStats = this.sessionRegistry.getStats();

        const activeRoomIds = Object.entries(sessionStats.byRoom ?? {})
            .filter(([, roomStats]) => {
                const statusCounts = roomStats?.statusCounts ?? {};
                return (statusCounts.creating ?? 0) > 0 || (statusCounts.active ?? 0) > 0;
            })
            .map(([roomId]) => roomId);

        const emptyRoomCleanup = this.registry && typeof this.registry.cleanupEmptyRoomReservations === "function"
            ? this.registry.cleanupEmptyRoomReservations({ activeRoomIds })
            : null;

        return createSuccess("game_server_control_status", "Game server control status loaded.", {
            started: this.started,
            config: toSafeGameServerControlConfigLog(this.config),
            registry: this.registry.getStats(),
            health: this.healthStore.getStats(),
            sessions: sessionStats,
            tickets: this.ticketService.getStats(),
            allocator: this.allocator.getStats(),
            processLifecycle: this.processLifecycleConfig,
            emptyRoomCleanup
        });
    }

    //* این تابع تمام حافظه داخلی ماژول را پاک می کند و فقط برای تست یا خاموشی کامل استفاده می شود.
    clear() {
        const tickets = this.ticketStore.clear();
        const sessions = this.sessionRegistry.clear();
        const health = this.healthStore.clear();
        const servers = this.registry.clear();

        return createSuccess("game_server_control_cleared", "Game server control internal stores cleared.", {
            tickets,
            sessions,
            health,
            servers
        });
    }
}

//* این تابع نمونه کامل ماژول کنترل گیم سرور را می سازد.
function createGameServerControl(options = {}) {
    return new GameServerControl(options);
}

export {
    GameServerControl,
    createGameServerControl,
    resolveGameServerControlConfig,

    createGameTicketStore,
    createGameTicketService,
    createGameServerRegistry,
    createGameServerHealthStore,
    createGameServerAllocator,
    createGameSessionRegistry,
    createGameServerServiceToken,
    createClientGameServerHandler,
    createDedicatedServerHandler
};

// این فایل فقط قطعات داخلی ماژول کنترل گیم سرور را کنار هم می گذارد و هنوز هیچ اتصال به استارتاپ اصلی سرور ایجاد نمی کند.
