import { VoiceMessageType } from '../protocol/voiceMessageTypes.js';
import { isVoiceDirectionalControlPayload, decodeVoiceDirectionalControlPayload } from './voiceDirectionalControlPayload.js';

// A per-instance, WebGL-kind-4-only observation of the existing authoritative handler.
// No shared prototype or Windows media route is altered.
const INSTALL_MARK = Symbol.for('vme2.webgl.mic.sfu.policy.relay.v1');
let active = null;
const id = value => String(value ?? '').trim().toLowerCase();

export function installWebGlMicSfuPolicyRelay(application) {
  if (!application || typeof application.handleEnvelope !== 'function' ||
      typeof application.hasActivePeer !== 'function') throw new Error('WEBGL_MIC_RELAY_INVALID_APP');
  if (application[INSTALL_MARK]) return;
  if (active !== null && active.application !== application) throw new Error('WEBGL_MIC_RELAY_MULTIPLE_APPS');
  const blocked = new Map();
  const original = application.handleEnvelope;
  Object.defineProperty(application, INSTALL_MARK, { value: true });
  application.handleEnvelope = async function handleEnvelopeWithWebGlMicSfuRelay(args = {}) {
    const envelope = args?.envelope;
    // Never change the original routing result. Observe only the WebGL kind-4 control.
    if (envelope?.messageType !== VoiceMessageType.LISTENER_MUTE_CHANGED ||
        !isVoiceDirectionalControlPayload(envelope.payload)) {
      return original.call(this, args);
    }
    const result = await original.call(this, args); // authoritative validation and ACK
    if (result?.handled !== true) return result;
    const sender = id(args?.transportConnection?.connectionId);
    const change = decodeVoiceDirectionalControlPayload(envelope.payload);
    const receiver = id(change.targetConnectionId);
    if (sender && receiver && sender !== receiver && this.hasActivePeer(sender, receiver)) {
      const key = `${sender}>${receiver}`;
      if (change.blocked) blocked.set(key, [sender, receiver]);
      else blocked.delete(key);
      console.log('VOICE_WEBGL_MIC_SFU_RELAY_STATE | requested=' +
        (change.blocked ? 'OFF' : 'ON') + ' | sender=' + sender + ' | receiver=' + receiver);
    }
    return result;
  };
  active = { application, blocked };
  console.log('VOICE_WEBGL_MIC_SFU_RELAY=READY | scope=kind4_instance_only');
}

// Called solely by the authenticated, signed W3 lease endpoint.
export function getWebGlMicDeniedSendersForLease(identities) {
  if (!Array.isArray(identities)) throw new TypeError('identities must be an array');
  const result = identities.map(() => []);
  const state = active;
  if (!state) return result;
  const receiverPositions = new Map();
  identities.forEach((entry, i) => {
    if (entry?.controlConnectionId) receiverPositions.set(id(entry.controlConnectionId), i);
  });
  for (const [key, pair] of state.blocked) {
    const [sender, receiver] = pair;
    if (!state.application.hasActivePeer(sender, receiver)) {
      state.blocked.delete(key); continue;
    }
    // Sender can be in a different W3 lease batch (up to 128 peers per batch).
    // hasActivePeer() is the authoritative session guard; only the receiver
    // must be in this signed, admitted batch.
    const receiverPos = receiverPositions.get(receiver);
    if (receiverPos === undefined) continue;
    result[receiverPos].push(sender);
  }
  return result.map(group => group.sort().slice(0, 128));
}

export function releaseWebGlMicSfuPolicyRelay(application) {
  if (active?.application === application) active = null;
}
