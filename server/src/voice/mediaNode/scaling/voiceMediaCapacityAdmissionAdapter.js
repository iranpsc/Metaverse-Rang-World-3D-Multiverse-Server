import { Phase11MediaNodeRegistry } from "./mediaNodeRegistry.js";
import { VoiceMediaV2Registry } from "../../mediaV2/voiceMediaV2Runtime.js";

const INSTALL_SYMBOL = Symbol.for("metarang.voice.mediaCapacityAdmissionAdapter");
const DEFAULT_SOFT_CONNECTION_TARGET = 80;
const DEFAULT_HARD_CONNECTION_LIMIT = 90;

function normalizePositiveInteger(value, name) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1) throw new RangeError(`${name} is invalid.`);
    return number;
}

function normalizeConnectionId(value) {
    return String(value ?? "").trim().toLowerCase();
}

//* این تابع محدودیت نرم انتخاب نود و محدودیت سخت اتصال رسانه را بدون تغییر فایل های پایدار نصب می کند.
function installVoiceMediaCapacityAdmissionAdapter({
    softConnectionTarget = DEFAULT_SOFT_CONNECTION_TARGET,
    hardConnectionLimit = DEFAULT_HARD_CONNECTION_LIMIT,
    logger = null
} = {}) {
    const softLimit = normalizePositiveInteger(softConnectionTarget, "softConnectionTarget");
    const hardLimit = normalizePositiveInteger(hardConnectionLimit, "hardConnectionLimit");
    if (hardLimit <= softLimit) throw new RangeError("hardConnectionLimit must be greater than softConnectionTarget.");

    const previous = globalThis[INSTALL_SYMBOL];
    if (previous?.installed === true) {
        if (previous.softConnectionTarget !== softLimit || previous.hardConnectionLimit !== hardLimit) {
            throw new Error("Voice media capacity admission adapter is already installed with different limits.");
        }
        return previous.api;
    }

    const originalListReadyNodes = Phase11MediaNodeRegistry.prototype.listReadyNodes;
    const originalNodeGetStats = Phase11MediaNodeRegistry.prototype.getStats;
    const originalBind = VoiceMediaV2Registry.prototype.bind;
    const originalMediaGetStats = VoiceMediaV2Registry.prototype.getStats;

    let softRejectedCandidates = 0;
    let hardRejectedBinds = 0;

    function patchedListReadyNodes(input = {}) {
        const candidates = originalListReadyNodes.call(this, input);
        const admitted = [];
        for (const candidate of candidates) {
            if (Number(candidate?.node?.activeConnections ?? 0) >= softLimit) {
                softRejectedCandidates += 1;
                continue;
            }
            admitted.push(candidate);
        }
        return Object.freeze(admitted);
    }

    function patchedNodeGetStats() {
        const stats = originalNodeGetStats.call(this);
        return Object.freeze({
            ...stats,
            capacityAdmission: Object.freeze({
                enabled: true,
                softConnectionTarget: softLimit,
                hardConnectionLimit: hardLimit,
                softRejectedCandidates
            })
        });
    }

    function patchedBind(connection, controlConnectionId) {
        const normalizedControlConnectionId = normalizeConnectionId(controlConnectionId);
        const previousConnection = this.getByControlConnectionId(normalizedControlConnectionId);
        const boundConnections = Number(this.getStats()?.bound ?? 0);

        if (!previousConnection && boundConnections >= hardLimit) {
            hardRejectedBinds += 1;
            logger?.warn?.("VOICE_MEDIA_CAPACITY_ADMISSION=REJECT", {
                reason: "hard_connection_limit",
                controlConnectionId: normalizedControlConnectionId,
                boundConnections,
                hardConnectionLimit: hardLimit
            });
            const error = new Error("Voice media node hard connection capacity reached.");
            error.code = "VOICE_MEDIA_CAPACITY_REACHED";
            error.boundConnections = boundConnections;
            error.hardConnectionLimit = hardLimit;
            throw error;
        }

        return originalBind.call(this, connection, normalizedControlConnectionId);
    }

    function patchedMediaGetStats() {
        const stats = originalMediaGetStats.call(this);
        const boundConnections = Number(stats?.bound ?? 0);
        return Object.freeze({
            ...stats,
            capacityAdmission: Object.freeze({
                enabled: true,
                softConnectionTarget: softLimit,
                hardConnectionLimit: hardLimit,
                remainingHardConnections: Math.max(0, hardLimit - boundConnections),
                atSoftTarget: boundConnections >= softLimit,
                atHardLimit: boundConnections >= hardLimit,
                hardRejectedBinds
            })
        });
    }

    Phase11MediaNodeRegistry.prototype.listReadyNodes = patchedListReadyNodes;
    Phase11MediaNodeRegistry.prototype.getStats = patchedNodeGetStats;
    VoiceMediaV2Registry.prototype.bind = patchedBind;
    VoiceMediaV2Registry.prototype.getStats = patchedMediaGetStats;

    function uninstall() {
        const state = globalThis[INSTALL_SYMBOL];
        if (!state || state.api !== api) return false;
        if (Phase11MediaNodeRegistry.prototype.listReadyNodes === patchedListReadyNodes) Phase11MediaNodeRegistry.prototype.listReadyNodes = originalListReadyNodes;
        if (Phase11MediaNodeRegistry.prototype.getStats === patchedNodeGetStats) Phase11MediaNodeRegistry.prototype.getStats = originalNodeGetStats;
        if (VoiceMediaV2Registry.prototype.bind === patchedBind) VoiceMediaV2Registry.prototype.bind = originalBind;
        if (VoiceMediaV2Registry.prototype.getStats === patchedMediaGetStats) VoiceMediaV2Registry.prototype.getStats = originalMediaGetStats;
        delete globalThis[INSTALL_SYMBOL];
        return true;
    }

    function getStats() {
        return Object.freeze({
            installed: true,
            softConnectionTarget: softLimit,
            hardConnectionLimit: hardLimit,
            softRejectedCandidates,
            hardRejectedBinds
        });
    }

    const api = Object.freeze({
        installed: true,
        softConnectionTarget: softLimit,
        hardConnectionLimit: hardLimit,
        uninstall,
        getStats
    });

    globalThis[INSTALL_SYMBOL] = Object.freeze({
        installed: true,
        softConnectionTarget: softLimit,
        hardConnectionLimit: hardLimit,
        api
    });

    return api;
}

export {
    DEFAULT_HARD_CONNECTION_LIMIT,
    DEFAULT_SOFT_CONNECTION_TARGET,
    installVoiceMediaCapacityAdmissionAdapter
};
