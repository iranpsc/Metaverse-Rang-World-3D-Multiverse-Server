import assert from "node:assert/strict";
import test from "node:test";

import {
    VoiceRoutingApplication
} from "./voiceRoutingApplication.js";

import {
    installVoiceRoutingListenerDeliveryTrace
} from "./voiceRoutingListenerDeliveryTraceWrapper.js";

const publisher = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const listenerA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const listenerB = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const sessionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const lines = [];
let timeMs = Date.parse("2026-10-14T18:01:00.000Z");

const originalDescriptor = Object.getOwnPropertyDescriptor(
    VoiceRoutingApplication.prototype,
    "forwardVoiceFrame"
);

const installed = installVoiceRoutingListenerDeliveryTrace({
    now: () => timeMs,
    emit: (line) => lines.push(line),
    logIntervalMs: 5000
});

function makeTransport(connectionId, fail = false) {
    return {
        connectionId,
        sent: [],
        closes: 0,
        async sendEnvelope(envelope) {
            if (fail) throw new Error("Voice media plane is not bound for the listener.");
            this.sent.push(envelope);
        },
        async close() {
            this.closes++;
            this.connectionId = "";
        }
    };
}

function frame(transport, sequence = 71) {
    return {
        listenerTransport: transport,
        publisherConnectionId: publisher,
        sessionId,
        envelope: {
            sequence,
            flags: 0,
            payload: Buffer.from([1, 2, 3])
        }
    };
}

function app() {
    return {
        now: () => timeMs,
        forwardVoiceFrame: VoiceRoutingApplication.prototype.forwardVoiceFrame
    };
}

test("wrapper installs once without deleting or renaming the original method", () => {
    assert.equal(installed, true);
    assert.equal(
        installVoiceRoutingListenerDeliveryTrace(),
        false
    );
    assert.equal(typeof originalDescriptor.value, "function");
    assert.equal(typeof VoiceRoutingApplication.prototype.forwardVoiceFrame, "function");
});

test("listener id is captured before closing clears the connection", async () => {
    const transport = makeTransport(listenerA, true);
    const routing = app();
    const failure = await routing.forwardVoiceFrame(frame(transport)).catch(e => e);
    assert.equal(failure.message, "Voice media plane is not bound for the listener.");
    assert.equal(transport.closes, 1);
    assert.equal(transport.connectionId, "");
    const message = lines.at(-1);
    assert.match(message, /VOICE_FRAME_LISTENER_DELIVERY_FAILED/);
    assert.match(message, new RegExp(`listenerConnectionId=${listenerA}`));
    assert.match(message, new RegExp(`connectionId=${publisher}`));
    assert.match(message, new RegExp(`sessionId=${sessionId}`));
    assert.match(message, /sequence=71/);
    assert.match(message, /occurredAtUtc=2026-10-14T18:01:00\.000Z/);
});

test("successful media delivery does not produce a failure log", async () => {
    const length = lines.length;
    const transport = makeTransport(listenerA);
    await app().forwardVoiceFrame(frame(transport));
    assert.equal(transport.sent.length, 1);
    assert.equal(transport.closes, 0);
    assert.equal(lines.length, length);
});

test("concurrent failures keep their own listener identifiers", async () => {
    const before = lines.length;
    await Promise.allSettled([
        app().forwardVoiceFrame(frame(makeTransport(listenerB, true), 72)),
        app().forwardVoiceFrame(frame(makeTransport("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", true), 72))
    ]);
    assert.equal(lines.length, before + 2);
    assert.ok(lines.some(x => x.includes(`listenerConnectionId=${listenerB}`)));
    assert.ok(lines.some(x => x.includes("listenerConnectionId=eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")));
});

test("repeated failures are rate-limited and report suppression", async () => {
    const first = lines.length;
    await app().forwardVoiceFrame(frame(makeTransport(listenerB, true), 73)).catch(() => {});
    await app().forwardVoiceFrame(frame(makeTransport(listenerB, true), 74)).catch(() => {});
    assert.equal(lines.length, first);
    timeMs += 5000;
    await app().forwardVoiceFrame(frame(makeTransport(listenerB, true), 75)).catch(() => {});
    assert.equal(lines.length, first + 1);
    assert.match(lines.at(-1), /suppressedSincePreviousLog=2/);
});

test("diagnostic hook never changes the thrown error", async () => {
    const transport = makeTransport("ffffffff-ffff-4fff-8fff-ffffffffffff", true);
    const failure = await app().forwardVoiceFrame(frame(transport, 76)).catch(e => e);
    assert.equal(failure.message, "Voice media plane is not bound for the listener.");
    assert.equal(transport.closes, 1);
});
