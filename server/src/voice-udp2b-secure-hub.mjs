// Fail-closed access-controlled wrapper around the existing UDP-2A signaling state machine.
// This module is NOT a production server, nor an HTTP auth endpoint.
import { SignalHub, HubError } from '../reference/signal-hub.mjs';
const reject = () => { throw new HubError(403, 'voice_access_denied'); };

export class VoiceUdp2bSecureHub {
  constructor({ authorizer, hub = new SignalHub() }) {
    if (typeof authorizer?.authorize !== 'function') throw new TypeError('live_authorizer_required');
    this.authorizer = authorizer;
    this.hub = hub;
    this.members = new Map();
  }
  async join({ room, role, accessToken, controlConnectionId } = {}) {
    const result = await this.authorizer.authorize({ accessToken, controlConnectionId, roomId: room, role });
    if (result?.allowed !== true) reject();
    // Two independent users/connections are required; do not permit self-pairing.
    for (const existing of this.members.values()) {
      if (existing.roomId === room && (existing.userId === result.userId || existing.controlConnectionId === result.controlConnectionId)) reject();
    }
    const joined = this.hub.join({ room, role });
    this.members.set(joined.token, { accessToken, controlConnectionId, roomId: room, userId: result.userId, role });
    return joined;
  }
  async #check(token) {
    const member = this.members.get(token);
    if (!member || !this.hub.byToken.has(token)) { this.members.delete(token); reject(); }
    const proof = await this.authorizer.authorize(member);
    if (proof?.allowed !== true || proof.userId !== member.userId || proof.roomId !== member.roomId || proof.controlConnectionId !== member.controlConnectionId) {
      this.#revoke(token);
      reject();
    }
    return member;
  }
  #revoke(token) {
    this.members.delete(token);
    // A revoked participant must invalidate its pair and pending SDP/ICE.
    const peer = this.hub.byToken.get(token);
    if (peer) this.hub.leavePeer(peer);
  }
  async send(token, payload) {
    await this.#check(token);
    return this.hub.send(token, payload);
  }
  async poll(token, options) {
    await this.#check(token);
    const events = await this.hub.poll(token, options);
    await this.#check(token); // a membership/revocation change while poll was waiting must block data
    return events;
  }
  async leave(token) {
    // Cleanup is always permitted, even after authorization is revoked.
    if (!this.members.has(token)) reject();
    this.#revoke(token);
  }
  sweep() {
    this.hub.sweep();
    for (const token of this.members.keys()) if (!this.hub.byToken.has(token)) this.members.delete(token);
  }
  shutdown() { this.hub.shutdown(); this.members.clear(); }
}
