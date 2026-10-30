import { VoiceDedicatedSessionDeltaService } from "./voiceDedicatedSessionDeltaService.js";
import { VoiceRecordingService } from "../recording/voiceRecordingService.js";
import { installVoiceRecordingFinalizationAckRelease } from "./voiceRecordingFinalizationAckReleaseAdapter.js";

const enabled = ["1", "true", "yes", "on"].includes(
    String(process.env.VOICE_RECORDING_FINALIZE_ACK_RELEASE_ENABLED ?? "").trim().toLowerCase()
);
const installationKey = Symbol.for("network_a.voice.recording_finalization_ack_release.v1");

if (enabled && !globalThis[installationKey]) {
    const adapter = installVoiceRecordingFinalizationAckRelease({
        deltaPrototype: VoiceDedicatedSessionDeltaService.prototype,
        recordingPrototype: VoiceRecordingService.prototype
    });
    globalThis[installationKey] = adapter;
    console.log("VOICE_RECORDING_FINALIZE_ACK_RELEASE_HOOK=READY | originalMethodsPreserved=true | indexChanged=false");
}
