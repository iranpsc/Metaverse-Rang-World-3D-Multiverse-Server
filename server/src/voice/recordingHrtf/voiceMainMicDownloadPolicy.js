import {
    mergeIntervals,
    subtractIntervals
} from "../directional/voiceDirectionalDownloadExtension.js";

function cleanText(value) {
    return String(value ?? "").trim();
}

function clampMilliseconds(value, durationMs, fallback = 0) {
    const parsed = Number(value);
    const normalized = Number.isFinite(parsed) ? parsed : Number(fallback) || 0;
    return Math.max(0, Math.min(Math.max(0, Number(durationMs) || 0), Math.floor(normalized)));
}

function normalizeIntervals(intervals, durationMs) {
    const duration = Math.max(0, Number(durationMs) || 0);
    return mergeIntervals(
        (Array.isArray(intervals) ? intervals : [])
            .map((interval) => ({
                startOffsetMs: clampMilliseconds(interval?.startOffsetMs, duration, 0),
                endOffsetMs: clampMilliseconds(interval?.endOffsetMs, duration, duration)
            }))
            .filter((interval) => interval.endOffsetMs > interval.startOffsetMs)
    );
}

function resolveMembershipIntervals(participant, metadata) {
    const durationMs = Math.max(0, Number(metadata?.durationMs) || 0);
    const explicit = normalizeIntervals(participant?.intervals, durationMs);
    if (explicit.length > 0) return explicit;

    const startedAtMs = Number(metadata?.startedAtMs) || 0;
    const joinedAtMs = Number(participant?.joinedAtMs);
    const leftAtMs = Number(participant?.leftAtMs);
    const startOffsetMs = Number.isFinite(joinedAtMs)
        ? clampMilliseconds(joinedAtMs - startedAtMs, durationMs, 0)
        : 0;
    const endOffsetMs = Number.isFinite(leftAtMs)
        ? clampMilliseconds(leftAtMs - startedAtMs, durationMs, durationMs)
        : durationMs;

    return endOffsetMs > startOffsetMs
        ? [{ startOffsetMs, endOffsetMs }]
        : [];
}

function resolveConsentedIntervals(participant, metadata) {
    const durationMs = Math.max(0, Number(metadata?.durationMs) || 0);
    return normalizeIntervals(participant?.consentIntervals, durationMs);
}

function buildMainMicBlockedIntervalsBySenderConnectionId({ metadata } = {}) {
    const result = new Map();
    for (const participant of Array.isArray(metadata?.participants) ? metadata.participants : []) {
        const connectionId = cleanText(participant?.connectionId).toLowerCase();
        if (!connectionId) continue;

        // Legacy recordings created before per-participant consent intervals existed
        // must keep their historical behavior. An explicit array means the
        // recording contract knows the participant's Main Mic consent timeline;
        // an explicit empty array therefore means no consented recording interval.
        if (!Array.isArray(participant?.consentIntervals)) continue;

        const membershipIntervals = resolveMembershipIntervals(participant, metadata);
        if (membershipIntervals.length === 0) continue;

        const consentedIntervals = resolveConsentedIntervals(participant, metadata);
        const blockedIntervals = subtractIntervals(membershipIntervals, consentedIntervals);
        if (blockedIntervals.length > 0) {
            result.set(connectionId, blockedIntervals);
        }
    }
    return result;
}

function mergeBlockedIntervalMaps(...sources) {
    const merged = new Map();
    for (const source of sources) {
        if (!(source instanceof Map)) continue;
        for (const [connectionId, intervals] of source.entries()) {
            const key = cleanText(connectionId).toLowerCase();
            if (!key) continue;
            merged.set(key, mergeIntervals([...(merged.get(key) ?? []), ...(intervals ?? [])]));
        }
    }
    return merged;
}

function stableBlockedIntervalSignature(source) {
    return Array.from(source?.entries?.() ?? [])
        .map(([connectionId, intervals]) => ({ connectionId, intervals }))
        .sort((left, right) => left.connectionId.localeCompare(right.connectionId));
}

function hasMainMicBlockedIntervals({ metadata } = {}) {
    return buildMainMicBlockedIntervalsBySenderConnectionId({ metadata }).size > 0;
}

export {
    buildMainMicBlockedIntervalsBySenderConnectionId,
    mergeBlockedIntervalMaps,
    stableBlockedIntervalSignature,
    hasMainMicBlockedIntervals
};
