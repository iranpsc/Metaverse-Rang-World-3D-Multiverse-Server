import assert from "node:assert/strict";

import {
    VoiceDirectionalPolicyRegistry
} from "../directional/voiceDirectionalPolicyRegistry.js";

const sender = "11111111-1111-1111-1111-111111111111";
const receiver = "22222222-2222-2222-2222-222222222222";
const third = "33333333-3333-3333-3333-333333333333";

const registry = new VoiceDirectionalPolicyRegistry({ now: () => 1000 });

assert.equal(registry.isRouteAllowed(sender, receiver), true);
assert.equal(registry.isRouteAllowed(receiver, sender), true);

registry.setBlocked({
    senderConnectionId: sender,
    receiverConnectionId: receiver,
    blocked: true
});

assert.equal(registry.isRouteAllowed(sender, receiver), false);
assert.equal(registry.isRouteAllowed(receiver, sender), true);
assert.equal(registry.isRouteAllowed(sender, third), true);

registry.setBlocked({
    senderConnectionId: sender,
    receiverConnectionId: receiver,
    blocked: false
});

assert.equal(registry.isRouteAllowed(sender, receiver), true);

registry.setBlocked({
    senderConnectionId: sender,
    receiverConnectionId: receiver,
    blocked: true
});

assert.equal(
    registry.cleanupInactivePolicies((left, right) => left === sender && right === third),
    1
);
assert.equal(registry.isRouteAllowed(sender, receiver), true);

console.log("VOICE_DIRECTIONAL_POLICY_TEST=PASS");
