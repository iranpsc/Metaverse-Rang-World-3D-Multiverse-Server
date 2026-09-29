import {
    DEFAULT_HARD_CONNECTION_LIMIT,
    DEFAULT_SOFT_CONNECTION_TARGET,
    installVoiceMediaCapacityAdmissionAdapter
} from "./voiceMediaCapacityAdmissionAdapter.js";

function readBoolean(name, defaultValue = false) {
    const text = String(process.env[name] ?? "").trim().toLowerCase();
    if (!text) return defaultValue;
    if (text === "true" || text === "1" || text === "yes") return true;
    if (text === "false" || text === "0" || text === "no") return false;
    throw new TypeError(`${name} is invalid.`);
}

function readPositiveInteger(name, defaultValue) {
    const text = String(process.env[name] ?? "").trim();
    if (!text) return defaultValue;
    const number = Number(text);
    if (!Number.isSafeInteger(number) || number < 1) throw new RangeError(`${name} is invalid.`);
    return number;
}

const enabled = readBoolean("VOICE_MEDIA_CAPACITY_ADMISSION_ENABLED", false);

if (enabled) {
    const softConnectionTarget = readPositiveInteger("VOICE_MEDIA_SOFT_CONNECTION_TARGET", DEFAULT_SOFT_CONNECTION_TARGET);
    const hardConnectionLimit = readPositiveInteger("VOICE_MEDIA_HARD_CONNECTION_LIMIT", DEFAULT_HARD_CONNECTION_LIMIT);
    const adapter = installVoiceMediaCapacityAdmissionAdapter({
        softConnectionTarget,
        hardConnectionLimit,
        logger: console
    });

    console.log(
        "VOICE_MEDIA_CAPACITY_ADMISSION_HOOK=READY" +
        ` | softConnectionTarget=${adapter.softConnectionTarget}` +
        ` | hardConnectionLimit=${adapter.hardConnectionLimit}` +
        " | stickyOwnershipPreserved=true" +
        " | replacementBindAllowedAtHardLimit=true" +
        " | windowsPathChanged=false" +
        " | questPathChanged=false" +
        " | webglProtocolChanged=false"
    );
}
