import {
    VoiceMessageType
} from "../protocol/voiceMessageTypes.js";

import {
    AsyncLocalStorage
} from "node:async_hooks";

import {
    VoiceControlAckCode,
    VoiceListenerMuteKind
} from "../routing/voiceRoutingControlPayload.js";

import {
    VoiceRoutingApplication
} from "../routing/voiceRoutingApplication.js";

import {
    VoiceMuteRegistry
} from "../mute/voiceMuteRegistry.js";

import {
    decodeVoiceDirectionalControlPayload,
    isVoiceDirectionalControlPayload
} from "./voiceDirectionalControlPayload.js";

import {
    VoiceDirectionalPolicyRegistry
} from "./voiceDirectionalPolicyRegistry.js";

import {
    applyVoiceDirectionalRecordingTimelineExtension,
    recordVoiceDirectionalButtonState
} from "./voiceDirectionalRecordingTimeline.js";

import {
    applyVoiceDirectionalDownloadExtension
} from "./voiceDirectionalDownloadExtension.js";

const EXTENSION_APPLIED = Symbol.for(
    "network_a.voice.directional.routing_extension.applied"
);

const policyByApplication = new WeakMap();
const policyByMuteRegistry = new WeakMap();
const pendingRouteVerificationByMuteRegistry = new WeakMap();
const routeVerificationContext = new AsyncLocalStorage();

const ROUTE_VERIFICATION_TIMEOUT_MS = 5000;

let pendingRouteVerificationCount = 0;
let routeVerificationSequence = 0;

function getPolicyRegistry(application) {
    let registry = policyByApplication.get(application);
    if (registry) return registry;

    registry = new VoiceDirectionalPolicyRegistry({
        now: typeof application.now === "function"
            ? application.now
            : () => Date.now()
    });

    policyByApplication.set(application, registry);

    if (application.muteRegistry) {
        policyByMuteRegistry.set(application.muteRegistry, registry);
    }

    return registry;
}

function applyVoiceDirectionalRoutingExtension() {
    const applicationPrototype = VoiceRoutingApplication.prototype;
    if (applicationPrototype[EXTENSION_APPLIED] === true) return;

    patchRoutingApplication(applicationPrototype);
    patchMuteRegistry(VoiceMuteRegistry.prototype);

    Object.defineProperty(applicationPrototype, EXTENSION_APPLIED, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: true
    });

    console.log("VOICE_DIRECTIONAL_ROUTING_EXTENSION=READY");
}

function patchRoutingApplication(applicationPrototype) {
    const originalHandleEnvelope = applicationPrototype.handleEnvelope;
    const originalHandleDedicatedSessionEvent = applicationPrototype.handleDedicatedSessionEvent;
    const originalHandleVoiceFrame = applicationPrototype.handleVoiceFrame;
    const originalForwardVoiceFrame = applicationPrototype.forwardVoiceFrame;

    applicationPrototype.handleEnvelope = async function handleEnvelopeWithDirectionalControl(args = {}) {
        const envelope = args?.envelope;

        if (
            envelope?.messageType !== VoiceMessageType.LISTENER_MUTE_CHANGED ||
            !isVoiceDirectionalControlPayload(envelope.payload)
        ) {
            return originalHandleEnvelope.call(this, args);
        }

        const transportConnection = args?.transportConnection;
        if (!transportConnection) {
            throw new TypeError("Voice directional control requires a transport connection.");
        }

        this.assertControlEnvelopeUsesNoSession(envelope);

        const change = decodeVoiceDirectionalControlPayload(envelope.payload);
        const senderConnectionId = normalizeConnectionId(transportConnection.connectionId);
        const receiverConnectionId = normalizeConnectionId(change.targetConnectionId);

        if (!senderConnectionId || !receiverConnectionId || senderConnectionId === receiverConnectionId) {
            throw new Error("Voice directional control requires another active Voice peer.");
        }

        if (!this.hasActivePeer(senderConnectionId, receiverConnectionId)) {
            throw new Error("Voice directional control target is not an active Voice session peer.");
        }

        const registry = getPolicyRegistry(this);
        const changedAtMs = typeof this.now === "function"
            ? this.now()
            : Date.now();
        const result = registry.setBlocked({
            senderConnectionId,
            receiverConnectionId,
            blocked: change.blocked,
            changedAtMs
        });

        recordVoiceDirectionalButtonState({
            source: "sender_mic",
            senderConnectionId,
            receiverConnectionId,
            blocked: change.blocked,
            changedAtMs
        });

        logDirectionalRouteState({
            source: "sender_mic",
            senderConnectionId,
            receiverConnectionId,
            blocked: change.blocked,
            changed: result.changed,
            changedAtMs,
            muteRegistry: this.muteRegistry,
            directionalRegistry: registry
        });

        this.operationalMetrics?.increment?.("directional_mute_changes");

        await this.sendControlAck(
            transportConnection,
            envelope.sequence,
            VoiceControlAckCode.ACCEPTED
        );

        return Object.freeze({ handled: true });
    };

    applicationPrototype.handleDedicatedSessionEvent = async function handleDedicatedSessionEventWithDirectionalCleanup(args = {}) {
        const result = await originalHandleDedicatedSessionEvent.call(this, args);
        const registry = policyByApplication.get(this);

        if (registry) {
            const removed = registry.cleanupInactivePolicies((senderConnectionId, receiverConnectionId) =>
                this.hasActivePeer(senderConnectionId, receiverConnectionId)
            );

            if (removed > 0) {
                console.log(
                    `VOICE_DIRECTIONAL_POLICY_CLEANUP | removed=${removed}`
                );
            }
        }

        return result;
    };

    applicationPrototype.handleVoiceFrame = function handleVoiceFrameWithDirectionalVerification(
        envelope,
        transportConnection
    ) {
        if (pendingRouteVerificationCount === 0) {
            return originalHandleVoiceFrame.call(
                this,
                envelope,
                transportConnection
            );
        }

        return routeVerificationContext.run(
            {
                publisherConnectionId: normalizeConnectionId(
                    transportConnection?.connectionId
                ),
                sequence: Number(envelope?.sequence ?? 0)
            },
            () => originalHandleVoiceFrame.call(
                this,
                envelope,
                transportConnection
            )
        );
    };

    applicationPrototype.forwardVoiceFrame = function forwardVoiceFrameWithDirectionalVerification(args = {}) {
        const delivery = originalForwardVoiceFrame.call(
            this,
            args
        );

        if (pendingRouteVerificationCount === 0) {
            return delivery;
        }

        return delivery.then(
            (result) => {
                observeDirectionalRouteDelivery({
                    muteRegistry: this.muteRegistry,
                    senderConnectionId: args?.publisherConnectionId,
                    receiverConnectionId: args?.listenerTransport?.connectionId,
                    sessionId: args?.sessionId,
                    sequence: args?.envelope?.sequence,
                    delivered: true
                });
                return result;
            },
            (error) => {
                observeDirectionalRouteDelivery({
                    muteRegistry: this.muteRegistry,
                    senderConnectionId: args?.publisherConnectionId,
                    receiverConnectionId: args?.listenerTransport?.connectionId,
                    sessionId: args?.sessionId,
                    sequence: args?.envelope?.sequence,
                    delivered: false,
                    error
                });
                throw error;
            }
        );
    };
}

function patchMuteRegistry(mutePrototype) {
    const originalApplyChange = mutePrototype.applyChange;
    const originalIsRouteAllowed = mutePrototype.isRouteAllowed;
    const originalRemoveConnection = mutePrototype.removeConnection;

    mutePrototype.applyChange = function applyChangeWithDirectionalMonitoring(args = {}) {
        const receiverConnectionId = normalizeConnectionId(
            args?.listenerConnectionId
        );
        const senderConnectionId = normalizeConnectionId(
            args?.targetConnectionId
        );
        const previousSnapshot =
            args?.kind === VoiceListenerMuteKind.PER_USER
                ? this.getSnapshot(receiverConnectionId)
                : null;
        const result = originalApplyChange.call(this, args);

        if (args?.kind === VoiceListenerMuteKind.PER_USER) {
            const registry = policyByMuteRegistry.get(this) ?? null;
            const changedAtMs = typeof registry?.now === "function"
                ? registry.now()
                : Date.now();
            const wasBlocked =
                previousSnapshot?.mutedPublisherConnectionIds?.includes?.(
                    senderConnectionId
                ) === true;
            const isBlocked =
                result?.mutedPublisherConnectionIds?.includes?.(
                    senderConnectionId
                ) === true;

            recordVoiceDirectionalButtonState({
                source: "receiver_speaker",
                senderConnectionId,
                receiverConnectionId,
                blocked: args.muted === true,
                changedAtMs
            });

            logDirectionalRouteState({
                source: "receiver_speaker",
                senderConnectionId,
                receiverConnectionId,
                blocked: args.muted === true,
                changed: wasBlocked !== isBlocked,
                changedAtMs,
                muteRegistry: this,
                directionalRegistry: registry,
                originalIsRouteAllowed
            });
        }

        return result;
    };

    mutePrototype.isRouteAllowed = function isRouteAllowedWithDirectionalPolicy(
        listenerConnectionId,
        publisherConnectionId
    ) {
        const existingRouteAllowed = originalIsRouteAllowed.call(
            this,
            listenerConnectionId,
            publisherConnectionId
        );

        const registry = policyByMuteRegistry.get(this);
        const effectiveRouteAllowed =
            existingRouteAllowed &&
            (
                !registry ||
                registry.isRouteAllowed(
                    publisherConnectionId,
                    listenerConnectionId
                )
            );

        observeDirectionalRouteDecision({
            muteRegistry: this,
            senderConnectionId: publisherConnectionId,
            receiverConnectionId: listenerConnectionId,
            allowed: effectiveRouteAllowed
        });

        return effectiveRouteAllowed;
    };

    mutePrototype.removeConnection = function removeConnectionWithDirectionalCleanup(connectionId) {
        const result = originalRemoveConnection.call(this, connectionId);
        const removedDirectional = policyByMuteRegistry.get(this)?.removeConnection(connectionId) ?? 0;
        removeDirectionalRouteVerificationsForConnection(
            this,
            connectionId
        );

        if (removedDirectional > 0) {
            console.log(
                `VOICE_DIRECTIONAL_CONNECTION_CLEANUP | connectionId=${normalizeConnectionId(connectionId)} | removed=${removedDirectional}`
            );
        }

        return result;
    };
}

function logDirectionalRouteState({
    source,
    senderConnectionId,
    receiverConnectionId,
    blocked,
    changed,
    changedAtMs,
    muteRegistry,
    directionalRegistry = null,
    originalIsRouteAllowed = null
} = {}) {
    const senderId = normalizeConnectionId(senderConnectionId);
    const receiverId = normalizeConnectionId(receiverConnectionId);
    if (!senderId || !receiverId) return;

    const receiverSnapshot =
        typeof muteRegistry?.getSnapshot === "function"
            ? muteRegistry.getSnapshot(receiverId)
            : null;

    const receiverMuteBlocked =
        receiverSnapshot?.speakerOff === true ||
        receiverSnapshot?.muteAll === true ||
        receiverSnapshot?.mutedPublisherConnectionIds?.includes?.(senderId) === true;

    const directionalBlocked =
        directionalRegistry
            ? !directionalRegistry.isRouteAllowed(senderId, receiverId)
            : false;

    const existingAllowed =
        typeof originalIsRouteAllowed === "function"
            ? originalIsRouteAllowed.call(muteRegistry, receiverId, senderId)
            : !receiverMuteBlocked;

    const effectiveRouteAllowed = existingAllowed && !directionalBlocked;
    const verificationId = changed === true
        ? beginDirectionalRouteVerification({
            muteRegistry,
            source,
            senderConnectionId: senderId,
            receiverConnectionId: receiverId,
            requested: blocked ? "OFF" : "ON",
            expectedRoute: effectiveRouteAllowed ? "ON" : "OFF",
            changedAtMs
        })
        : "none";

    console.log(
        `VOICE_DIRECTIONAL_BUTTON_STATE | source=${source}` +
        ` | senderConnectionId=${senderId}` +
        ` | receiverConnectionId=${receiverId}` +
        ` | requested=${blocked ? "OFF" : "ON"}` +
        ` | changed=${changed === true}` +
        ` | changedAtMs=${Number(changedAtMs ?? 0)}` +
        ` | verificationId=${verificationId}` +
        ` | senderMicBlocked=${directionalBlocked}` +
        ` | receiverSpeakerBlocked=${receiverMuteBlocked}` +
        ` | effectiveRoute=${effectiveRouteAllowed ? "ON" : "OFF"}`
    );
}

function beginDirectionalRouteVerification({
    muteRegistry,
    source,
    senderConnectionId,
    receiverConnectionId,
    requested,
    expectedRoute,
    changedAtMs
} = {}) {
    if (!muteRegistry) return "none";

    const senderId = normalizeConnectionId(senderConnectionId);
    const receiverId = normalizeConnectionId(receiverConnectionId);
    if (!senderId || !receiverId) return "none";

    const verificationMap = getRouteVerificationMap(
        muteRegistry
    );
    const routeKey = createDirectionalRouteKey(
        senderId,
        receiverId
    );
    const existing = verificationMap.get(routeKey);

    if (existing) {
        console.log(
            `VOICE_DIRECTIONAL_ROUTE_VERIFICATION_SUPERSEDED | verificationId=${existing.verificationId}` +
            ` | senderConnectionId=${senderId}` +
            ` | receiverConnectionId=${receiverId}`
        );
        completeDirectionalRouteVerification({
            verificationMap,
            routeKey,
            verification: existing
        });
    }

    routeVerificationSequence += 1;
    const verificationId =
        `${Number(changedAtMs ?? 0)}-${routeVerificationSequence}`;
    const verification = {
        verificationId,
        source,
        senderConnectionId: senderId,
        receiverConnectionId: receiverId,
        requested,
        expectedRoute,
        changedAtMs: Number(changedAtMs ?? 0),
        decisionObserved: false,
        timeout: null
    };

    verification.timeout = setTimeout(() => {
        if (verificationMap.get(routeKey) !== verification) return;

        console.log(
            `VOICE_DIRECTIONAL_ROUTE_VERIFICATION_TIMEOUT | verificationId=${verification.verificationId}` +
            ` | source=${verification.source}` +
            ` | senderConnectionId=${verification.senderConnectionId}` +
            ` | receiverConnectionId=${verification.receiverConnectionId}` +
            ` | requested=${verification.requested}` +
            ` | expectedRoute=${verification.expectedRoute}` +
            ` | timeoutMs=${ROUTE_VERIFICATION_TIMEOUT_MS}`
        );

        completeDirectionalRouteVerification({
            verificationMap,
            routeKey,
            verification
        });
    }, ROUTE_VERIFICATION_TIMEOUT_MS);
    verification.timeout.unref?.();

    verificationMap.set(routeKey, verification);
    pendingRouteVerificationCount += 1;

    return verificationId;
}

function observeDirectionalRouteDecision({
    muteRegistry,
    senderConnectionId,
    receiverConnectionId,
    allowed
} = {}) {
    const context = routeVerificationContext.getStore();
    const senderId = normalizeConnectionId(senderConnectionId);
    const receiverId = normalizeConnectionId(receiverConnectionId);

    if (
        !context ||
        context.publisherConnectionId !== senderId
    ) {
        return;
    }

    const verificationMap =
        pendingRouteVerificationByMuteRegistry.get(muteRegistry);
    if (!verificationMap) return;

    const routeKey = createDirectionalRouteKey(
        senderId,
        receiverId
    );
    const verification = verificationMap.get(routeKey);
    if (!verification || verification.decisionObserved) return;

    const observedRoute = allowed ? "ON" : "OFF";
    const matches = observedRoute === verification.expectedRoute;
    verification.decisionObserved = true;

    console.log(
        `VOICE_DIRECTIONAL_ROUTE_DECISION_VERIFIED | verificationId=${verification.verificationId}` +
        ` | source=${verification.source}` +
        ` | senderConnectionId=${senderId}` +
        ` | receiverConnectionId=${receiverId}` +
        ` | requested=${verification.requested}` +
        ` | expectedRoute=${verification.expectedRoute}` +
        ` | observedRoute=${observedRoute}` +
        ` | frameSequence=${context.sequence}` +
        ` | match=${matches}`
    );

    if (!matches || observedRoute === "OFF") {
        completeDirectionalRouteVerification({
            verificationMap,
            routeKey,
            verification
        });
    }
}

function observeDirectionalRouteDelivery({
    muteRegistry,
    senderConnectionId,
    receiverConnectionId,
    sessionId,
    sequence,
    delivered,
    error = null
} = {}) {
    const senderId = normalizeConnectionId(senderConnectionId);
    const receiverId = normalizeConnectionId(receiverConnectionId);
    const verificationMap =
        pendingRouteVerificationByMuteRegistry.get(muteRegistry);
    if (!verificationMap) return;

    const routeKey = createDirectionalRouteKey(
        senderId,
        receiverId
    );
    const verification = verificationMap.get(routeKey);

    if (
        !verification ||
        verification.expectedRoute !== "ON" ||
        verification.decisionObserved !== true
    ) {
        return;
    }

    console.log(
        `VOICE_DIRECTIONAL_ROUTE_DELIVERY_VERIFIED | verificationId=${verification.verificationId}` +
        ` | source=${verification.source}` +
        ` | senderConnectionId=${senderId}` +
        ` | receiverConnectionId=${receiverId}` +
        ` | requested=${verification.requested}` +
        ` | sessionId=${normalizeConnectionId(sessionId)}` +
        ` | frameSequence=${Number(sequence ?? 0)}` +
        ` | delivered=${delivered === true}` +
        (error
            ? ` | error=${String(error?.message ?? error).replaceAll("|", "_")}`
            : "")
    );

    completeDirectionalRouteVerification({
        verificationMap,
        routeKey,
        verification
    });
}

function completeDirectionalRouteVerification({
    verificationMap,
    routeKey,
    verification
} = {}) {
    if (verificationMap?.get(routeKey) !== verification) return;

    clearTimeout(verification.timeout);
    verificationMap.delete(routeKey);
    pendingRouteVerificationCount = Math.max(
        0,
        pendingRouteVerificationCount - 1
    );
}

function getRouteVerificationMap(muteRegistry) {
    let verificationMap =
        pendingRouteVerificationByMuteRegistry.get(muteRegistry);

    if (!verificationMap) {
        verificationMap = new Map();
        pendingRouteVerificationByMuteRegistry.set(
            muteRegistry,
            verificationMap
        );
    }

    return verificationMap;
}

function createDirectionalRouteKey(
    senderConnectionId,
    receiverConnectionId
) {
    return `${senderConnectionId}|${receiverConnectionId}`;
}

function removeDirectionalRouteVerificationsForConnection(
    muteRegistry,
    connectionId
) {
    const normalizedConnectionId = normalizeConnectionId(
        connectionId
    );
    const verificationMap =
        pendingRouteVerificationByMuteRegistry.get(muteRegistry);

    if (!normalizedConnectionId || !verificationMap) return;

    for (const [routeKey, verification] of verificationMap) {
        if (
            verification.senderConnectionId !== normalizedConnectionId &&
            verification.receiverConnectionId !== normalizedConnectionId
        ) {
            continue;
        }

        console.log(
            `VOICE_DIRECTIONAL_ROUTE_VERIFICATION_CANCELLED | verificationId=${verification.verificationId}` +
            ` | senderConnectionId=${verification.senderConnectionId}` +
            ` | receiverConnectionId=${verification.receiverConnectionId}` +
            ` | reason=connection_removed`
        );

        completeDirectionalRouteVerification({
            verificationMap,
            routeKey,
            verification
        });
    }
}

function normalizeConnectionId(value) {
    return String(value ?? "").trim().toLowerCase();
}

applyVoiceDirectionalRecordingTimelineExtension();
applyVoiceDirectionalDownloadExtension();
applyVoiceDirectionalRoutingExtension();

export {
    applyVoiceDirectionalRoutingExtension
};
