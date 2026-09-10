import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
    VOICE_NPC_SERVICE_TOKEN_PURPOSE,
    createGameServerNpcServiceTokenVerifier
} from "../npc/createGameServerNpcServiceTokenVerifier.js";
import { VoiceRecordingService } from "../recording/voiceRecordingService.js";

const indexPath = fileURLToPath(new URL("../../index.js", import.meta.url));
const indexSource = await readFile(indexPath, "utf8");

for (const marker of [
    "createVoiceV4RuntimeServices",
    "createVoiceV5RuntimeServices",
    "createVoiceV7RuntimeServices",
    "createVoiceV8RuntimeServices",
    "createVoiceTransportRuntimeWrapper",
    "METAVERSE_VOICE_RUNTIME_ENABLED",
    "METAVERSE_VOICE_RECORDING_STORAGE_ROOT",
    "voiceTransportRuntime?.registerGrpc",
    "voiceV8RuntimeServices?.registerGrpc"
]) {
    assert.equal(indexSource.includes(marker), true, `Production composition marker is missing: ${marker}`);
}

const recoveryRoot = await mkdtemp(join(tmpdir(), "voice-v9-recovery-"));
const interruptedSessionId = "990e8400-e29b-41d4-a716-446655440000";
await mkdir(join(recoveryRoot, interruptedSessionId), { recursive: true });

const recordingService = new VoiceRecordingService({
    storageRoot: recoveryRoot,
    now: () => 123456789
});
const recovery = await recordingService.initializeStorage();
assert.equal(recovery.quarantinedInterruptedRecordings, 1);
assert.equal((await readdir(recoveryRoot)).includes(
    `${interruptedSessionId}.interrupted.123456789`
), true);

const verifier = createGameServerNpcServiceTokenVerifier({
    serviceTokenService: {
        verifyToken(token, expected) {
            assert.equal(token, "signed-service-token");
            assert.equal(expected.purpose, VOICE_NPC_SERVICE_TOKEN_PURPOSE);
            return {
                success: true,
                payload: {
                    serverId: "server-v9",
                    expiresAt: 200000,
                    metadata: {
                        serviceId: "npc-service-v9",
                        role: "npc_voice_publisher",
                        scope: "voice:npc:publish",
                        npcId: "npc-v9"
                    }
                }
            };
        }
    }
});
const claims = verifier.verifyServiceToken("signed-service-token");
assert.deepEqual(claims.roles, ["npc_voice_publisher"]);
assert.deepEqual(claims.scopes, ["voice:npc:publish"]);
assert.equal(claims.npcId, "npc-v9");
assert.equal(claims.serverId, "server-v9");

console.log("VOICE_V9_PRODUCTION_COMPOSITION=PASS");
console.log("VOICE_V9_RECORDING_BUCKET_RECOVERY=PASS");
console.log("VOICE_V9_NPC_SERVICE_TOKEN_ADAPTER=PASS");
console.log("VOICE_V9_NODE_READINESS=PASS");
