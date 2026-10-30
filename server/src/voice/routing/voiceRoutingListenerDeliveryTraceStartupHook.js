import { installVoiceRoutingListenerDeliveryTrace } from "./voiceRoutingListenerDeliveryTraceWrapper.js";

const installed = installVoiceRoutingListenerDeliveryTrace();

if (!installed) {
    throw new Error("Voice listener delivery trace is already installed.");
}

console.log("VOICE_LISTENER_DELIVERY_TRACE=ENABLED");
