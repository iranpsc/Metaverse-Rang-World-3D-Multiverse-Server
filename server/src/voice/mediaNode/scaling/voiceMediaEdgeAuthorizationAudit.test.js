import assert from "node:assert/strict";
import { test } from "node:test";
import { VoiceAuthResultCode } from "../../auth/voiceAuthConstants.js";
import { VoiceConnectionState } from "../../core/voiceConnectionConstants.js";
import { createPhase11BackendCore } from "./mediaClusterBackendCore.js";
import { createVoiceMediaEdgeAuthorizationAudit } from "./voiceMediaEdgeAuthorizationAudit.js";

const connectionId = "11111111-1111-4111-8111-111111111111";
const roomId = "audit-room";

function makeCore({ records = new Map(), verify = () => ({ success: false, code: VoiceAuthResultCode.ACCESS_TOKEN_INVALID }) } = {}) {
    const routingApplication = { handleVoiceFrame: async () => undefined, setGateway() {} };
    const controlGateway = { getConnectionByConnectionId() { return null; } };
    const voiceConnectionRegistry = { getByConnectionId(id) { return records.get(id) ?? null; } };
    return createPhase11BackendCore({ routingApplication, controlGateway, voiceConnectionRegistry, accessTokenVerifier: { verify } });
}

async function captureWarning(fn) {
    const warnings = [];
    const original = console.warn;
    console.warn = (line) => warnings.push(line);
    try { return { response: await fn(), warnings }; }
    finally { console.warn = original; }
}

test("reports distinct safe verifier errors, suppresses repeats, and never prints credentials", () => {
    let time = 1_000;
    const lines = [];
    const audit = createVoiceMediaEdgeAuthorizationAudit({ write: (line) => lines.push(line), now: () => time });
    const input = {
        transport: "ws", reason: "token_rejected", verifyCode: VoiceAuthResultCode.ACCESS_TOKEN_EXPIRED,
        controlStateCode: VoiceConnectionState.ACTIVE, controlConnectionId: connectionId
    };
    assert.equal(audit.recordDenied(input), true);
    assert.equal(audit.recordDenied(input), false);
    assert.equal(audit.recordDenied(input), false);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /reason=token_rejected/);
    assert.match(lines[0], /code=ACCESS_TOKEN_EXPIRED/);
    assert.match(lines[0], /controlState=ACTIVE/);
    assert.match(lines[0], /connectionId=11111111-1111-4111-8111-111111111111/);
    time += 10_001;
    assert.equal(audit.recordDenied(input), true);
    assert.match(lines[1], /suppressedPrevious=2/);
    assert.equal(audit.recordDenied({ ...input, verifyCode: VoiceAuthResultCode.ACCESS_TOKEN_INVALID }), true);
    assert.match(lines[2], /code=ACCESS_TOKEN_INVALID/);
    assert.doesNotMatch(lines.join("\n"), /Bearer|eyJ|accessToken|password|cookie/);
});

test("invalid identifiers, reason, state, and code cannot inject log fields", () => {
    const lines = [];
    const audit = createVoiceMediaEdgeAuthorizationAudit({ write: (line) => lines.push(line) });
    audit.recordDenied({ transport: "ws", reason: "bad|INJECTED=YES\n", verifyCode: 98765, controlStateCode: 98765, controlConnectionId: "hack|secret=my-key" });
    assert.equal(lines.length, 1);
    assert.match(lines[0], /reason=unknown \| code=unknown \| controlState=unknown/);
    assert.match(lines[0], /connectionId=invalid/);
    assert.doesNotMatch(lines[0], /INJECTED|my-key|secret=/);
});

test("does not log for grpc (Windows path) or missing transport", () => {
    const lines = [];
    const audit = createVoiceMediaEdgeAuthorizationAudit({ write: (line) => lines.push(line) });
    assert.equal(audit.recordDenied({ transport: "grpc", reason: "token_rejected" }), false);
    assert.equal(audit.recordDenied({ reason: "token_rejected" }), false);
    assert.equal(lines.length, 0);
});

test("logger failure has no effect on authorization", () => {
    const audit = createVoiceMediaEdgeAuthorizationAudit({ write: () => { throw new Error("log failure"); } });
    assert.equal(audit.recordDenied({ transport: "ws", reason: "token_rejected", controlConnectionId: connectionId }), false);
});

test("expired token is denied with unchanged generic response, precise private code", async () => {
    const records = new Map([[connectionId, { connectionId, state: VoiceConnectionState.ACTIVE, userId: "user-a", roomId }]]);
    const core = makeCore({ records, verify: () => ({ success: false, code: VoiceAuthResultCode.ACCESS_TOKEN_EXPIRED }) });
    const { response, warnings } = await captureWarning(() => core.resolveAuthorizedRoomTarget({ accessToken: "PRIVATE_EXPIRED_TOKEN", roomId, controlConnectionId: connectionId, transport: "ws" }));
    assert.deepEqual(response, { success: false, reason: "media_edge_authorization_failed" });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /reason=token_rejected/);
    assert.match(warnings[0], /code=ACCESS_TOKEN_EXPIRED/);
    assert.doesNotMatch(warnings[0], /PRIVATE_EXPIRED_TOKEN|user-a|audit-room/);
    assert.equal(core.coordinator.roomRegistry.getAssignment(roomId), null);
});

test("valid token but missing control record gives separate internal reason", async () => {
    const core = makeCore({ verify: () => ({ success: true, code: VoiceAuthResultCode.AUTHENTICATED, userId: "user-a" }) });
    const { response, warnings } = await captureWarning(() => core.resolveAuthorizedRoomTarget({ accessToken: "PRIVATE_VALID_TOKEN", roomId, controlConnectionId: connectionId, transport: "ws" }));
    assert.deepEqual(response, { success: false, reason: "media_edge_authorization_failed" });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /reason=control_connection_not_found/);
    assert.match(warnings[0], /code=AUTHENTICATED/);
    assert.match(warnings[0], /controlState=unknown/);
});

test("state, user, and room failures remain independently visible, without changing decisions", async () => {
    const records = new Map([[connectionId, { connectionId, state: VoiceConnectionState.SUSPENDED, userId: "user-a", roomId }]]);
    const core = makeCore({ records, verify: () => ({ success: true, code: VoiceAuthResultCode.AUTHENTICATED, userId: "user-b" }) });
    const warnings = [];
    const original = console.warn;
    console.warn = (line) => warnings.push(line);
    try {
        const input = { accessToken: "PRIVATE", roomId, controlConnectionId: connectionId, transport: "ws" };
        assert.equal((await core.resolveAuthorizedRoomTarget(input)).success, false);
        assert.match(warnings.at(-1), /reason=control_connection_not_active/);
        assert.match(warnings.at(-1), /controlState=SUSPENDED/);
        records.get(connectionId).state = VoiceConnectionState.ACTIVE;
        assert.equal((await core.resolveAuthorizedRoomTarget(input)).success, false);
        assert.match(warnings.at(-1), /reason=user_mismatch/);
        records.get(connectionId).userId = "user-b";
        assert.equal((await core.resolveAuthorizedRoomTarget({ ...input, roomId: "different-room" })).success, false);
        assert.match(warnings.at(-1), /reason=room_mismatch/);
    } finally { console.warn = original; }
});

test("authorized WebGL request preserves normal owner selection and makes no denial log", async () => {
    const records = new Map([[connectionId, { connectionId, state: VoiceConnectionState.ACTIVE, userId: "user-a", roomId }]]);
    const core = makeCore({ records, verify: () => ({ success: true, code: VoiceAuthResultCode.AUTHENTICATED, userId: "user-a" }) });
    core.registerNode({ nodeId: "a", region: "eu-central", zone: "de-1", advertiseHost: "127.0.0.1", wsPort: 52001, grpcPort: 52002, peer: { closed: false, request: async () => ({ metadata: { success: true } }) } });
    const { response, warnings } = await captureWarning(() => core.resolveAuthorizedRoomTarget({ accessToken: "PRIVATE", roomId, controlConnectionId: connectionId, region: "eu-central", zone: "de-1", transport: "ws" }));
    assert.equal(response.success, true);
    assert.equal(response.nodeId, "a");
    assert.equal(response.port, 52001);
    assert.equal(warnings.length, 0);
});

test("rejected Windows grpc request does not emit WebGL diagnostic", async () => {
    const core = makeCore();
    const { response, warnings } = await captureWarning(() => core.resolveAuthorizedRoomTarget({ accessToken: "PRIVATE", roomId, controlConnectionId: connectionId, transport: "grpc" }));
    assert.deepEqual(response, { success: false, reason: "media_edge_authorization_failed" });
    assert.equal(warnings.length, 0);
});
