// VME2 WebRTC SFU: actual RTP/Opus transports. Isolated local stage only.
export const AUDIO_CODECS = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 }
];

export function assertLabOnlyConfiguration({ host, announcedAddress }) {
  if (host !== '127.0.0.1' && host !== '::1') {
    throw new Error('W1_STAGE_REQUIRES_LOOPBACK_BINDING');
  }
  if (announcedAddress && !['127.0.0.1', '::1', 'localhost'].includes(announcedAddress)) {
    throw new Error('W1_STAGE_PUBLIC_ICE_FORBIDDEN');
  }
}

export function cleanRoomId(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 ||
      !/^[\p{L}\p{N}_.:-]+$/u.test(value)) {
    throw new Error('INVALID_ROOM_ID');
  }
  return value;
}

export function cleanConnectionId(value) {
  if (typeof value !== 'string' || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)) {
    throw new Error('INVALID_CONTROL_CONNECTION_ID');
  }
  return value.toLowerCase();
}

export function checkRpcRequest(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) ||
      !Number.isSafeInteger(msg.id) || msg.id < 1 ||
      typeof msg.action !== 'string' || msg.action.length > 64 ||
      !/^[a-zA-Z]+$/.test(msg.action) ||
      (msg.data !== undefined &&
       (!msg.data || typeof msg.data !== 'object' || Array.isArray(msg.data)))) {
    throw new Error('INVALID_REQUEST');
  }
}

export class Vme2StageSfu {
  constructor({ mediasoup, listenIp = '127.0.0.1', announcedAddress = '',
    authorizeJoin = null, workerPortMin = 40000, workerPortMax = 40063,
    recordingBridge = null, sessionAclEnabled = false }) {
    this.mediasoup = mediasoup;
    this.listenIp = listenIp;
    this.announcedAddress = announcedAddress;
    this.authorizeJoin = authorizeJoin;
    this.workerPortMin = workerPortMin;
    this.workerPortMax = workerPortMax;
    this.recordingBridge = recordingBridge;
    this.sessionAclEnabled = sessionAclEnabled;
    this.recordingTransport = null;
    this.recordingConsumers = new Map();
    this.worker = null;
    this.router = null;
    this.peers = new Set();
  }

  async initialize() {
    this.worker = await this.mediasoup.createWorker({ logLevel: 'warn',
      rtcMinPort: this.workerPortMin, rtcMaxPort: this.workerPortMax });
    this.worker.on('died', () => {
      // Cannot safely serve existing sessions after the media worker dies.
      console.error('[VME2_SFU] worker_died; terminating stage process');
      process.exitCode = 1;
      setImmediate(() => process.exit(1));
    });
    this.router = await this.worker.createRouter({ mediaCodecs: AUDIO_CODECS });
    if (this.recordingBridge) {
      try {
        this.recordingTransport = await this.router.createDirectTransport();
        console.log('[VME2_W4_RECORDING] direct_transport_ready');
      } catch (error) {
        console.error('[VME2_W4_RECORDING] direct_transport_failed', String(error?.message ?? error));
      }
    }
  }

  createPeer(send) {
    const peer = {
      send, roomId: '', controlConnectionId: '', joined: false,
      transports: new Map(), producers: new Map(), consumers: new Map(),
      consumerOwners: new Map(), allowedPeers: new Set(), webGlMicDeniedPeers: new Set(),
      closed: false, authIdentity: null, lastVerifiedAt: 0
    };
    this.peers.add(peer);
    return peer;
  }

  async handle(peer, action, data = {}) {
    if (peer.closed) throw new Error('PEER_CLOSED');
    if (action === 'join') {
      if (peer.joined) throw new Error('ALREADY_JOINED');
      const roomId = cleanRoomId(data.roomId);
      const controlConnectionId = cleanConnectionId(data.controlConnectionId);
      // Fail closed for W3: authorization happens BEFORE allocating transports.
      const authorized = this.authorizeJoin
        ? await this.authorizeJoin({ roomId, controlConnectionId, ticket: data.ticket })
        : null;
      if (this.authorizeJoin && (!authorized || authorized.roomId !== roomId ||
          authorized.controlConnectionId !== controlConnectionId || !authorized.userId)) {
        throw new Error('W3_JOIN_UNAUTHORIZED');
      }
      if (peer.closed) throw new Error('PEER_CLOSED');
      peer.roomId = roomId;
      peer.controlConnectionId = controlConnectionId;
      peer.authIdentity = authorized;
      peer.lastVerifiedAt = Date.now();
      peer.joined = true;
      return { rtpCapabilities: this.router.rtpCapabilities, stageOnly: !this.authorizeJoin };
    }
    if (!peer.joined) throw new Error('NOT_JOINED');

    switch (action) {
      case 'createTransport': {
        if (!['send', 'recv'].includes(data.direction)) throw new Error('INVALID_DIRECTION');
        if ([...peer.transports.values()].some(t => t.appData.direction === data.direction)) {
          throw new Error('DUPLICATE_TRANSPORT');
        }
        const t = await this.router.createWebRtcTransport({
          listenInfos: [{ protocol: 'udp', ip: this.listenIp,
            ...(this.announcedAddress ? { announcedAddress: this.announcedAddress } : {}) }],
          enableSctp: false,
          initialAvailableOutgoingBitrate: 300000,
          appData: { direction: data.direction }
        });
        peer.transports.set(t.id, t);
        return {
          id: t.id, iceParameters: t.iceParameters,
          iceCandidates: t.iceCandidates, dtlsParameters: t.dtlsParameters
        };
      }
      case 'connectTransport': {
        const t = this.ownTransport(peer, data.transportId);
        if (!data.dtlsParameters || typeof data.dtlsParameters !== 'object') {
          throw new Error('INVALID_DTLS_PARAMETERS');
        }
        await t.connect({ dtlsParameters: data.dtlsParameters });
        return { connected: true };
      }
      case 'produce': {
        const t = this.ownTransport(peer, data.transportId, 'send');
        if (data.kind !== 'audio') throw new Error('AUDIO_ONLY');
        if (peer.producers.size >= 1) throw new Error('PRODUCER_LIMIT');
        const producer = await t.produce({ kind: 'audio', rtpParameters: data.rtpParameters });
        peer.producers.set(producer.id, producer);
        if (this.recordingTransport) {
          try { await this.attachRecordingConsumer(peer, producer); }
          catch (error) {
            console.error('[VME2_W4_RECORDING] recording_consumer_failed',
              String(error?.message ?? error));
          }
        }
        producer.on('transportclose', () => {
          peer.producers.delete(producer.id);
          this.detachRecordingConsumer(producer.id);
          this.notifyProducerClosed(peer, producer.id);
        });
        for (const other of this.peers) {
          if (other !== peer && other.joined && other.roomId === peer.roomId && !other.closed &&
              this.canReceiveFrom(other, peer)) {
            other.send('newProducer', { producerId: producer.id });
          }
        }
        return { id: producer.id };
      }
      case 'listProducers': {
        return { producerIds: [...this.peers]
          .filter(p => p !== peer && !p.closed && p.joined && p.roomId === peer.roomId &&
            this.canReceiveFrom(peer, p))
          .flatMap(p => [...p.producers.keys()]) };
      }
      case 'consume': {
        const t = this.ownTransport(peer, data.transportId, 'recv');
        const owner = [...this.peers].find(p =>
          p !== peer && p.joined && !p.closed && p.roomId === peer.roomId &&
          p.producers.has(data.producerId));
        if (!owner) throw new Error('PRODUCER_NOT_IN_ROOM');
        if (!this.canReceiveFrom(peer, owner)) throw new Error('NO_ACTIVE_VOICE_SESSION');
        if (peer.consumers.size >= 16) throw new Error('CONSUMER_LIMIT');
        if ([...peer.consumers.values()].some(c => c.producerId === data.producerId)) {
          throw new Error('ALREADY_CONSUMING');
        }
        if (!this.router.canConsume({ producerId: data.producerId, rtpCapabilities: data.rtpCapabilities })) {
          throw new Error('CANNOT_CONSUME_CODEC');
        }
        const consumer = await t.consume({
          producerId: data.producerId, rtpCapabilities: data.rtpCapabilities, paused: true
        });
        if (peer.closed || !this.canReceiveFrom(peer, owner)) {
          try { consumer.close(); } catch {}
          throw new Error('VOICE_SESSION_REVOKED');
        }
        peer.consumers.set(consumer.id, consumer);
        peer.consumerOwners.set(consumer.id, owner.controlConnectionId);
        consumer.on('transportclose', () => {
          peer.consumers.delete(consumer.id);
          peer.consumerOwners.delete(consumer.id);
        });
        consumer.on('producerclose', () => {
          peer.consumers.delete(consumer.id);
          peer.consumerOwners.delete(consumer.id);
          peer.send('producerClosed', { producerId: consumer.producerId });
        });
        return {
          id: consumer.id, producerId: consumer.producerId,
          kind: consumer.kind, rtpParameters: consumer.rtpParameters,
          senderConnectionId: owner.controlConnectionId
        };
      }
      case 'resumeConsumer': {
        const c = peer.consumers.get(data.consumerId);
        if (!c) throw new Error('CONSUMER_NOT_FOUND');
        if (this.sessionAclEnabled &&
            !peer.allowedPeers.has(peer.consumerOwners.get(c.id))) {
          this.closeRevokedConsumer(peer, c);
          throw new Error('NO_ACTIVE_VOICE_SESSION');
        }
        await c.resume();
        return { resumed: true };
      }
      default: throw new Error('UNKNOWN_ACTION');
    }
  }

  // Only the authoritative pair lease can make a sender audible to a receiver.
  canReceiveFrom(listener, sender) {
    return listener.webGlMicDeniedPeers?.has(sender.controlConnectionId) !== true &&
      (!this.sessionAclEnabled ||
        (listener.joined && !listener.closed && sender.joined && !sender.closed &&
         listener.roomId === sender.roomId &&
         listener.allowedPeers.has(sender.controlConnectionId)));
  }

  closeRevokedConsumer(peer, consumer) {
    peer.consumers.delete(consumer.id);
    peer.consumerOwners.delete(consumer.id);
    try { consumer.close(); } catch {}
    if (!peer.closed) peer.send('producerClosed', { producerId: consumer.producerId });
  }

  // WebGL kind-4 microphone denials from the signed internal W3 lease.
  // Does not activate global Session ACL or pause any public producer.
  reconcileWebGlMicDenials(peer, deniedConnectionIds) {
    if (peer.closed || !peer.joined) return;
    if (!Array.isArray(deniedConnectionIds) || deniedConnectionIds.length > 128) {
      throw new Error('WEBGL_MIC_DENIALS_INVALID');
    }
    const next = new Set(deniedConnectionIds.map(cleanConnectionId));
    const previous = peer.webGlMicDeniedPeers;
    peer.webGlMicDeniedPeers = next;
    for (const consumer of [...peer.consumers.values()]) {
      if (next.has(peer.consumerOwners.get(consumer.id))) this.closeRevokedConsumer(peer, consumer);
    }
    for (const sender of this.peers) {
      if (sender === peer || sender.closed || !sender.joined || sender.roomId !== peer.roomId ||
          !previous.has(sender.controlConnectionId) || next.has(sender.controlConnectionId) ||
          !this.canReceiveFrom(peer, sender)) continue;
      for (const producerId of sender.producers.keys()) peer.send('newProducer', { producerId });
    }
    if (next.size !== previous.size || [...next].some(id => !previous.has(id))) {
      console.log('VOICE_WEBGL_MIC_SFU_CONSUMER_RECONCILED | listener=' +
        peer.controlConnectionId + ' | previousDenied=' + previous.size +
        ' | denied=' + next.size);
    }
  }

  // Applied only from the signed, loopback session lease. No media packet waits for HTTP.
  reconcileSessionGrants(peer, grantedConnectionIds) {
    if (!this.sessionAclEnabled || peer.closed || !peer.joined) return;
    const next = new Set(grantedConnectionIds.map(cleanConnectionId));
    const previous = peer.allowedPeers;
    peer.allowedPeers = next;
    if (next.size !== previous.size || [...next].some(id => !previous.has(id))) {
      console.log('[VME2_W4_SESSION_ACL] grant_changed', {
        listener: peer.controlConnectionId,
        previousCount: previous.size,
        grantedCount: next.size
      });
    }
    for (const consumer of [...peer.consumers.values()]) {
      if (!next.has(peer.consumerOwners.get(consumer.id))) {
        this.closeRevokedConsumer(peer, consumer);
      }
    }
    for (const sender of this.peers) {
      if (sender === peer || sender.closed || !sender.joined || sender.roomId !== peer.roomId ||
          !next.has(sender.controlConnectionId) || previous.has(sender.controlConnectionId)) continue;
      for (const producerId of sender.producers.keys()) {
        peer.send('newProducer', { producerId });
      }
    }
  }

  async attachRecordingConsumer(peer, producer) {
    if (!this.recordingTransport || !this.recordingBridge || peer.closed) return;
    const consumer = await this.recordingTransport.consume({
      producerId: producer.id, rtpCapabilities: this.router.rtpCapabilities
    });
    this.recordingConsumers.set(producer.id, consumer);
    consumer.on('rtp', rtpPacket => {
      if (!peer.closed && !producer.closed) {
        this.recordingBridge.sendRtp({ roomId: peer.roomId,
          connectionId: peer.controlConnectionId, rtpPacket });
      }
    });
    consumer.on('producerclose', () => this.detachRecordingConsumer(producer.id));
    consumer.on('transportclose', () => this.detachRecordingConsumer(producer.id));
    if (consumer.paused) await consumer.resume();
  }

  detachRecordingConsumer(producerId) {
    const consumer = this.recordingConsumers.get(producerId);
    if (!consumer) return;
    this.recordingConsumers.delete(producerId);
    try { consumer.close(); } catch (_) {}
  }

  ownTransport(peer, id, direction = '') {
    const t = peer.transports.get(id);
    if (!t || t.closed) throw new Error('TRANSPORT_NOT_FOUND');
    if (direction && t.appData.direction !== direction) throw new Error('TRANSPORT_DIRECTION_MISMATCH');
    return t;
  }

  notifyProducerClosed(owner, producerId) {
    for (const peer of this.peers) {
      if (peer !== owner && peer.joined && peer.roomId === owner.roomId && !peer.closed) {
        peer.send('producerClosed', { producerId });
      }
    }
  }

  disposePeer(peer) {
    if (peer.closed) return;
    peer.closed = true;
    this.peers.delete(peer);
    for (const p of peer.producers.values()) {
      this.notifyProducerClosed(peer, p.id);
      this.detachRecordingConsumer(p.id);
      try { p.close(); } catch (_) {}
    }
    for (const c of peer.consumers.values()) { try { c.close(); } catch (_) {} }
    for (const t of peer.transports.values()) { try { t.close(); } catch (_) {} }
    peer.producers.clear();
    peer.consumers.clear();
    peer.consumerOwners.clear();
    peer.allowedPeers.clear();
    peer.webGlMicDeniedPeers.clear();
    peer.transports.clear();
  }

  close() {
    for (const peer of [...this.peers]) this.disposePeer(peer);
    for (const producerId of [...this.recordingConsumers.keys()]) this.detachRecordingConsumer(producerId);
    try { this.recordingTransport?.close(); } catch (_) {}
    this.router?.close();
    this.worker?.close();
  }
}
