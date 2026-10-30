// VME2 UDP-2B: stand-alone authorization boundary. Node.js built-ins only.
// Source contract: VoiceAccessTokenVerifierAdapter.verify and VoiceConnectionRegistry.getByConnectionId.
// No new registry is created. Caller must inject *live* provider from the existing VME2 process.
const CONTROL_ACTIVE = 2; // VoiceConnectionState.ACTIVE in the inspected 2026-10-15 source.
const id = value => typeof value === 'string' ? value.trim() : '';
const normalizedConnectionId = value => id(value).toLowerCase();
const denied = () => Object.freeze({ allowed: false });

export class VoiceUdp2bAuthorizer {
  constructor({ accessTokenVerifier, voiceConnectionRegistry, membershipVerifier }) {
    if (typeof accessTokenVerifier?.verify !== 'function') throw new TypeError('live_token_verifier_required');
    if (typeof voiceConnectionRegistry?.getByConnectionId !== 'function') throw new TypeError('live_control_registry_required');
    if (typeof membershipVerifier !== 'function') throw new TypeError('authoritative_membership_verifier_required');
    this.accessTokenVerifier = accessTokenVerifier;
    this.voiceConnectionRegistry = voiceConnectionRegistry;
    this.membershipVerifier = membershipVerifier;
  }

  async authorize({ accessToken, controlConnectionId, roomId, role } = {}) {
    const token = id(accessToken);
    const connId = normalizedConnectionId(controlConnectionId);
    const room = id(roomId);
    if (!token || token.length > 8192 || !connId || !room || room.length > 512 || !['sender', 'receiver'].includes(role)) return denied();
    try {
      const proof = await this.accessTokenVerifier.verify(token);
      if (proof?.success !== true || !id(proof.userId)) return denied();
      const connection = await this.voiceConnectionRegistry.getByConnectionId(connId);
      if (!connection || normalizedConnectionId(connection.connectionId) !== connId) return denied();
      if (connection.state !== CONTROL_ACTIVE) return denied();
      if (id(connection.userId) !== id(proof.userId) || id(connection.roomId) !== room) return denied();
      // Room membership in the control registry is not enough to assert media/session membership.
      // The live authoritative session registry must verify this exact tuple.
      const member = await this.membershipVerifier({ userId: id(proof.userId), roomId: room, controlConnectionId: connId, role });
      if (member?.allowed !== true) return denied();
      return Object.freeze({ allowed: true, userId: id(proof.userId), roomId: room, controlConnectionId: connId, role });
    } catch {
      // No fallback: token/verifier/registry outage always rejects.
      return denied();
    }
  }
}
