import { AsyncLocalStorage } from "node:async_hooks";
import { VoiceRecordingStopReason } from "../recording/voiceRecordingConstants.js";

// Keep realtime session event delivery/sequence-acknowledgment independent
// of long-running recording finalization. All original methods are preserved.
function installVoiceRecordingFinalizationAckRelease({
    deltaPrototype,
    recordingPrototype,
    writeDiagnostic = (level, message) => console[level](message)
} = {}) {
    if (typeof deltaPrototype?.notifyEventApplied !== "function" ||
        typeof recordingPrototype?.finalizeSession !== "function") {
        throw new TypeError("Voice finalization adapter requires existing runtime methods.");
    }

    const storage = new AsyncLocalStorage();
    const originalNotify = deltaPrototype.notifyEventApplied;
    const originalFinalize = recordingPrototype.finalizeSession;
    const pending = new Set();

    deltaPrototype.notifyEventApplied = function notifyEventAppliedWithFinalizationScope(event, result) {
        const closesByMemberLeft = event?.type === "member_left" && result?.data?.result?.closed === true;
        const closesSession = event?.type === "session_closed" || closesByMemberLeft;
        const sessionId = String(event?.sessionId ?? "").trim().toLowerCase();
        if (!closesSession || !sessionId) {
            return originalNotify.call(this, event, result);
        }
        // AsyncLocalStorage isolates parallel session/event requests.
        return storage.run({ sessionId }, () => originalNotify.call(this, event, result));
    };

    recordingPrototype.finalizeSession = function finalizeSessionWithoutAuthorityAckWait(sessionId, stopReason, ...args) {
        const scope = storage.getStore();
        const normalizedSessionId = String(sessionId ?? "").trim().toLowerCase();
        const normalizedStopReason = stopReason ?? VoiceRecordingStopReason.SESSION_CLOSED;
        if (!scope || scope.sessionId !== normalizedSessionId ||
            normalizedStopReason !== VoiceRecordingStopReason.SESSION_CLOSED) {
            return originalFinalize.call(this, sessionId, stopReason, ...args);
        }

        const startedAtMs = Date.now();
        let work;
        try {
            // Start original finalization at once, but outside the observer's
            // async context so its own async work cannot inherit this exemption.
            work = storage.exit(() => originalFinalize.call(this, sessionId, stopReason, ...args));
        } catch (error) {
            writeDiagnostic("error", `VOICE_RECORDING_FINALIZE_ASYNC=SYNC_FAILURE | sessionId=${normalizedSessionId} | code=${String(error?.code ?? "unknown")}`);
            // Keep original synchronous failures observable.
            throw error;
        }

        const task = Promise.resolve(work);
        pending.add(task);
        writeDiagnostic("info", `VOICE_RECORDING_FINALIZE_ASYNC=STARTED | sessionId=${normalizedSessionId}`);
        void task.then(
            () => writeDiagnostic("info", `VOICE_RECORDING_FINALIZE_ASYNC=COMPLETED | sessionId=${normalizedSessionId} | elapsedMs=${Date.now() - startedAtMs}`),
            error => writeDiagnostic("error", `VOICE_RECORDING_FINALIZE_ASYNC=FAILED | sessionId=${normalizedSessionId} | code=${String(error?.code ?? "unknown").replace(/[^A-Z0-9_]/gi, "_").slice(0, 80)} | elapsedMs=${Date.now() - startedAtMs}`)
        ).finally(() => pending.delete(task));

        // The regular observer still awaits realtime delivery and all other
        // recording events; only this exact finalized session is detached.
        return Promise.resolve(null);
    };

    const thisNotify = deltaPrototype.notifyEventApplied;
    const thisFinalize = recordingPrototype.finalizeSession;

    return Object.freeze({
        pendingCount: () => pending.size,
        uninstall() {
            if (deltaPrototype.notifyEventApplied === thisNotify) deltaPrototype.notifyEventApplied = originalNotify;
            if (recordingPrototype.finalizeSession === thisFinalize) recordingPrototype.finalizeSession = originalFinalize;
        }
    });
}

export { installVoiceRecordingFinalizationAckRelease };
