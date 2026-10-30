import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLabOnlyConfiguration, cleanConnectionId, cleanRoomId, checkRpcRequest, Vme2StageSfu } from '../sfu-core.mjs';
const id = '01234567-89ab-cdef-0123-456789abcdef';
test('loopback is mandatory', () => {
  assert.doesNotThrow(() => assertLabOnlyConfiguration({ host: '127.0.0.1' }));
  assert.throws(() => assertLabOnlyConfiguration({ host: '0.0.0.0' }));
  assert.throws(() => assertLabOnlyConfiguration({ host: '127.0.0.1', announcedAddress: '8.8.8.8' }));
});
test('ids validated', () => {
  assert.equal(cleanRoomId('room-01'), 'room-01');
  assert.equal(cleanConnectionId(id.toUpperCase()), id);
  assert.throws(() => cleanRoomId('../room'));
  assert.throws(() => cleanConnectionId('x'));
});
test('rpc validation', () => {
  checkRpcRequest({ id: 1, action: 'join', data: {} });
  assert.throws(() => checkRpcRequest({ id: '1', action: 'join' }));
  assert.throws(() => checkRpcRequest({ id: 1, action: 'x/y' }));
});
test('room isolated, sender restriction, peer cleanup', async () => {
  let next = 0;
  const closed = [];
  const fakeRouter = {
    rtpCapabilities: { codecs: [] },
    async createWebRtcTransport({ appData }) {
      const id = 'T' + ++next;
      return { id, appData, iceParameters: {}, iceCandidates: [], dtlsParameters: {},
        closed: false, async connect() {}, async produce() {
          const p = { id: 'P' + ++next, on() {}, close() { closed.push(this.id); } };
          return p;
        }, close() { closed.push(id); } };
    }
  };
  const sfu = new Vme2StageSfu({ mediasoup: {} });
  sfu.router = fakeRouter;
  const events = [];
  const a = sfu.createPeer((type, data) => events.push([type, data]));
  const b = sfu.createPeer((type, data) => events.push([type, data]));
  const c = sfu.createPeer((type, data) => events.push([type, data]));
  await sfu.handle(a, 'join', { roomId: 'one', controlConnectionId: id });
  await sfu.handle(b, 'join', { roomId: 'one', controlConnectionId: id });
  await sfu.handle(c, 'join', { roomId: 'two', controlConnectionId: id });
  await assert.rejects(sfu.handle(a, 'join', { roomId: 'two', controlConnectionId: id }));
  const t = await sfu.handle(a, 'createTransport', { direction: 'send' });
  await assert.rejects(sfu.handle(a, 'createTransport', { direction: 'send' }));
  const produced = await sfu.handle(a, 'produce', { transportId: t.id, kind: 'audio', rtpParameters: {} });
  assert.equal((await sfu.handle(b, 'listProducers')).producerIds[0], produced.id);
  assert.deepEqual((await sfu.handle(c, 'listProducers')).producerIds, []);
  await assert.rejects(sfu.handle(a, 'produce', { transportId: t.id, kind: 'video' }));
  sfu.disposePeer(a);
  assert.deepEqual((await sfu.handle(b, 'listProducers')).producerIds, []);
  assert(events.some(e => e[0] === 'producerClosed'));
  assert(closed.includes(t.id));
});
