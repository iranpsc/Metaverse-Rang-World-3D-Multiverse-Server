import assert from "node:assert/strict";

import "../directional/voiceDirectionalRoutingExtension.js";

import {
    VoiceMessageType
} from "../protocol/voiceMessageTypes.js";

import {
    VoiceBinaryProtocolConstants
} from "../protocol/voiceBinaryProtocolConstants.js";

import {
    VoiceConnectionState
} from "../core/voiceConnectionConstants.js";

import {
    VoiceListenerMuteKind
} from "../routing/voiceRoutingControlPayload.js";

import {
    VoiceRoutingApplication
} from "../routing/voiceRoutingApplication.js";

import {
    VoiceMuteRegistry
} from "../mute/voiceMuteRegistry.js";

import {
    encodeVoiceDirectionalControlPayload
} from "../directional/voiceDirectionalControlPayload.js";

const sender = "11111111-1111-1111-1111-111111111111";
const receiver = "22222222-2222-2222-2222-222222222222";
const third = "33333333-3333-3333-3333-333333333333";

const muteRegistry = new VoiceMuteRegistry();
const application = Object.create(VoiceRoutingApplication.prototype);
application.muteRegistry = muteRegistry;
application.now = () => 5000;
application.operationalMetrics = null;
application.assertControlEnvelopeUsesNoSession = () => {};
application.hasActivePeer = (left, right) =>
    left === sender && (right === receiver || right === third);

let ackCount = 0;
application.sendControlAck = async () => {
    ackCount += 1;
};

await application.handleEnvelope({
    envelope: {
        messageType: VoiceMessageType.LISTENER_MUTE_CHANGED,
        payload: encodeVoiceDirectionalControlPayload({
            blocked: true,
            targetConnectionId: receiver
        }),
        sequence: 10
    },
    transportConnection: {
        connectionId: sender
    }
});

assert.equal(ackCount, 1);
assert.equal(muteRegistry.isRouteAllowed(receiver, sender), false);
assert.equal(muteRegistry.isRouteAllowed(third, sender), true);
assert.equal(muteRegistry.isRouteAllowed(sender, receiver), true);

muteRegistry.applyChange({
    listenerConnectionId: third,
    kind: VoiceListenerMuteKind.PER_USER,
    muted: true,
    targetConnectionId: sender
});

assert.equal(muteRegistry.isRouteAllowed(third, sender), false);

await application.handleEnvelope({
    envelope: {
        messageType: VoiceMessageType.LISTENER_MUTE_CHANGED,
        payload: encodeVoiceDirectionalControlPayload({
            blocked: false,
            targetConnectionId: receiver
        }),
        sequence: 11
    },
    transportConnection: {
        connectionId: sender
    }
});

assert.equal(muteRegistry.isRouteAllowed(receiver, sender), true);
assert.equal(muteRegistry.isRouteAllowed(third, sender), false);

muteRegistry.removeConnection(sender);
assert.equal(muteRegistry.isRouteAllowed(receiver, sender), true);

function createLiveVerificationFixture() {
    const sessionId = "44444444-4444-4444-8444-444444444444";
    const session = {
        sessionId,
        participants: [sender, receiver, third].map(
            (connectionId) => ({ connectionId })
        )
    };
    const connection = {
        state: VoiceConnectionState.ACTIVE,
        lastReceivedSequence: 0,
        lastPublishedSequence: 0,
        updateSequences({
            lastReceivedSequence,
            lastPublishedSequence
        }) {
            this.lastReceivedSequence = lastReceivedSequence;
            this.lastPublishedSequence = lastPublishedSequence;
        }
    };
    const liveMuteRegistry = new VoiceMuteRegistry();
    const routingApplication = new VoiceRoutingApplication({
        voiceConnectionRegistry: {
            getByConnectionId(connectionId) {
                return [sender, receiver, third].includes(connectionId)
                    ? connection
                    : null;
            }
        },
        voiceSessionRegistry: {
            listActiveByConnectionId(connectionId) {
                return [sender, receiver, third].includes(connectionId)
                    ? [session]
                    : [];
            }
        },
        muteRegistry: liveMuteRegistry,
        packetFlowGuard: {
            inspect() {
                return Object.freeze({ accepted: true });
            }
        },
        reconnectCoordinator: {
            handleTransportClosed() {},
            handleConnectionAuthenticated() {}
        },
        now: () => 6000
    });
    const transports = new Map(
        [sender, receiver, third].map((connectionId) => [
            connectionId,
            {
                connectionId,
                controlEnvelopes: [],
                mediaEnvelopes: [],
                async sendEnvelope(envelope) {
                    this.controlEnvelopes.push(envelope);
                    return true;
                },
                enqueueMediaEnvelope(envelope) {
                    this.mediaEnvelopes.push(envelope);
                    return true;
                }
            }
        ])
    );

    routingApplication.setGateway({
        getConnectionByConnectionId(connectionId) {
            return transports.get(connectionId) ?? null;
        }
    });
    routingApplication.publisherSettingsByConnectionId.set(
        sender,
        Object.freeze({ bitrateKbps: 32 })
    );

    return {
        liveMuteRegistry,
        routingApplication,
        sessionId,
        transports
    };
}

async function setSenderRouteBlocked(
    fixture,
    blocked,
    sequence
) {
    return fixture.routingApplication.handleEnvelope({
        envelope: {
            messageType: VoiceMessageType.LISTENER_MUTE_CHANGED,
            sequence,
            sessionId: VoiceBinaryProtocolConstants.emptyUuid,
            payload: encodeVoiceDirectionalControlPayload({
                blocked,
                targetConnectionId: receiver
            })
        },
        transportConnection: fixture.transports.get(sender)
    });
}

async function publishVerificationFrame(
    fixture,
    sequence
) {
    const payload = Buffer.from([0xf8, 0xff, 0xfe, sequence]);
    return fixture.routingApplication.handleVoiceFrame(
        {
            flags: 0,
            sequence,
            timestampMs: 6000n,
            sessionId: VoiceBinaryProtocolConstants.emptyUuid,
            payloadLength: payload.length,
            payload
        },
        fixture.transports.get(sender)
    );
}

const liveFixture = createLiveVerificationFixture();
const liveLogs = [];
const originalConsoleLog = console.log;

try {
    console.log = (...values) => {
        liveLogs.push(values.join(" "));
    };

    await setSenderRouteBlocked(liveFixture, true, 20);
    await publishVerificationFrame(liveFixture, 21);
    await setSenderRouteBlocked(liveFixture, false, 22);
    await publishVerificationFrame(liveFixture, 23);

    liveFixture.liveMuteRegistry.applyChange({
        listenerConnectionId: receiver,
        kind: VoiceListenerMuteKind.PER_USER,
        muted: true,
        targetConnectionId: sender
    });
    await publishVerificationFrame(liveFixture, 24);

    liveFixture.liveMuteRegistry.applyChange({
        listenerConnectionId: receiver,
        kind: VoiceListenerMuteKind.PER_USER,
        muted: false,
        targetConnectionId: sender
    });
    await publishVerificationFrame(liveFixture, 25);
} finally {
    console.log = originalConsoleLog;
}

assert.equal(
    liveFixture.transports.get(receiver).mediaEnvelopes.length,
    2
);
assert.equal(
    liveFixture.transports.get(third).mediaEnvelopes.length,
    4
);
assert.equal(
    liveLogs.filter((line) =>
        line.includes("VOICE_DIRECTIONAL_ROUTE_DECISION_VERIFIED") &&
        line.includes("observedRoute=OFF") &&
        line.includes("match=true")
    ).length,
    2
);
assert.equal(
    liveLogs.filter((line) =>
        line.includes("VOICE_DIRECTIONAL_ROUTE_DELIVERY_VERIFIED") &&
        line.includes("delivered=true")
    ).length,
    2
);
assert.equal(
    liveLogs.filter((line) =>
        line.includes("VOICE_DIRECTIONAL_BUTTON_STATE") &&
        !line.includes("verificationId=none")
    ).length,
    4
);
assert.equal(
    liveLogs.some((line) =>
        line.includes("VOICE_DIRECTIONAL_ROUTE_VERIFICATION_TIMEOUT") ||
        line.includes("match=false") ||
        line.includes("delivered=false")
    ),
    false
);

console.log("VOICE_DIRECTIONAL_ROUTING_EXTENSION_TEST=PASS");
console.log("VOICE_DIRECTIONAL_LIVE_ROUTE_VERIFICATION_TEST=PASS");
