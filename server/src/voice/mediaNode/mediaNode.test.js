import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { VoiceConnectionState } from "../core/voiceConnectionConstants.js";
import { VoiceMessageType } from "../protocol/voiceMessageTypes.js";
import {
    VoiceMediaV2Codec,
    VoiceMediaV2PacketKind,
    decodeVoiceMediaV2BindResult,
    decodeVoiceMediaV2Packet,
    encodeVoiceMediaV2BindRequest,
    encodeVoiceMediaV2Packet
} from "../mediaV2/voiceMediaV2Protocol.js";
import { VoiceMediaNodeBridgeRpcPeer } from "./bridgeRpcPeer.js";
import { createVoiceMediaNodeBackendBridgeCore } from "./backendBridgeCore.js";
import { createVoiceMediaNodeRuntime } from "./mediaNodeRuntime.js";
import { VoiceMediaNodeBridgeMessageType, decodeVoiceMediaNodeBridgeMessage, encodeVoiceMediaNodeBridgeMessage } from "./internalBridgeProtocol.js";

const senderConnectionId = "11111111-1111-4111-8111-111111111111";
const listenerConnectionId = "22222222-2222-4222-8222-222222222222";
const senderStreamId = "33333333-3333-4333-8333-333333333333";
const listenerStreamId = "44444444-4444-4444-8444-444444444444";
const sessionId = "55555555-5555-4555-8555-555555555555";
const roomId = "room_public_lobby_main";

class FakeSocket extends EventEmitter {
    //* این سازنده یک سر اتصال درون حافظه را آماده می کند.
    constructor() {
        super();
        this.readyState = 1;
        this.other = null;
    }

    //* این تابع سر دیگر اتصال را برای انتقال پیام ثبت می کند.
    pair(other) {
        this.other = other;
    }

    //* این تابع پیام باینری را به سر دیگر اتصال در نوبت بعدی حلقه رویداد تحویل می دهد.
    send(packet, options, callback) {
        if (this.readyState !== 1 || !this.other || this.other.readyState !== 1) {
            callback?.(new Error("fake_socket_closed"));
            return;
        }
        const copy = Buffer.from(packet);
        queueMicrotask(() => this.other.emit("message", copy, true));
        callback?.();
    }

    //* این تابع هر دو سر اتصال درون حافظه را می بندد.
    close() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        queueMicrotask(() => this.emit("close"));
        if (this.other && this.other.readyState !== 3) {
            this.other.readyState = 3;
            queueMicrotask(() => this.other.emit("close"));
        }
    }
}

//* این تابع دو سر اتصال درون حافظه را به هم متصل می کند.
function createFakeSocketPair() {
    const left = new FakeSocket();
    const right = new FakeSocket();
    left.pair(right);
    right.pair(left);
    return { left, right };
}

//* این تابع رجیستری کنترل کوچک آزمون را می سازد.
function createControlRegistry() {
    const records = new Map([
        [senderConnectionId, { connectionId: senderConnectionId, userId: "sender-user", roomId, state: VoiceConnectionState.ACTIVE }],
        [listenerConnectionId, { connectionId: listenerConnectionId, userId: "listener-user", roomId, state: VoiceConnectionState.ACTIVE }]
    ]);
    return {
        //* این تابع رکورد کنترل نمونه را با شناسه اتصال برمی گرداند.
        getByConnectionId(connectionId) {
            return records.get(String(connectionId).toLowerCase()) ?? null;
        }
    };
}

//* این تابع قرارداد باینری پل داخلی را جداگانه بررسی می کند.
function testBridgeProtocol() {
    const packet = encodeVoiceMediaNodeBridgeMessage({
        type: VoiceMediaNodeBridgeMessageType.ROUTE_FRAME_REQUEST,
        requestId: 77,
        metadata: { mediaSequence: 9, mediaTimestamp100Ns: "15400000" },
        payload: Buffer.from([1, 2, 3])
    });
    const decoded = decodeVoiceMediaNodeBridgeMessage(packet);
    assert.equal(decoded.type, VoiceMediaNodeBridgeMessageType.ROUTE_FRAME_REQUEST);
    assert.equal(decoded.requestId, 77);
    assert.equal(decoded.metadata.mediaSequence, 9);
    assert.deepEqual(decoded.payload, Buffer.from([1, 2, 3]));
}

//* این تابع مسیر کامل بایند و رفت و برگشت رسانه را با پل باینری دوطرفه بررسی می کند.
async function testMediaRouteThroughBridge() {
    const voiceConnectionRegistry = createControlRegistry();
    const controlSent = [];
    const controlGateway = {
        connectionRegistrationService: {
            connectionRegistrationService: {
                connectionPreparationService: {
                    accessTokenVerifier: {
                        //* این تابع توکن نمونه آزمون را به هویت کنترل متناظر تبدیل می کند.
                        verify(token) {
                            if (token === "sender-token") return { success: true, userId: "sender-user" };
                            if (token === "listener-token") return { success: true, userId: "listener-user" };
                            return { success: false, userId: "" };
                        }
                    }
                }
            }
        },
        //* این تابع اتصال کنترل نمونه را با شناسه اتصال پیدا می کند.
        getConnectionByConnectionId(connectionId) {
            if (!voiceConnectionRegistry.getByConnectionId(connectionId)) return null;
            return {
                connectionId,
                //* این تابع پیام کنترل نمونه را برای بررسی آزمون ذخیره می کند.
                sendEnvelope(input) {
                    controlSent.push({ connectionId, input });
                    return Promise.resolve(true);
                },
                //* این تابع بسته شدن اتصال کنترل نمونه را بدون اثر جانبی تکمیل می کند.
                close() {
                    return Promise.resolve();
                }
            };
        }
    };
    const routingApplication = {
        voiceConnectionRegistry,
        gateway: controlGateway,
        //* این تابع درگاه مسیریابی نمونه را برای آزمون جایگزین می کند.
        setGateway(gateway) {
            this.gateway = gateway;
        },
        //* این تابع فریم رسانه نمونه را از مسیر موجود به شنونده نمونه تحویل می دهد.
        async handleVoiceFrame(envelope, transportConnection) {
            assert.equal(transportConnection.connectionId, senderConnectionId);
            const listener = this.gateway.getConnectionByConnectionId(listenerConnectionId);
            await listener.sendEnvelope({
                messageType: VoiceMessageType.VOICE_FRAME,
                flags: envelope.flags,
                sessionId,
                senderId: senderConnectionId,
                payload: envelope.payload
            });
            return Object.freeze({ accepted: true });
        }
    };

    const backendCore = createVoiceMediaNodeBackendBridgeCore({ routingApplication, controlGateway, voiceConnectionRegistry });
    const pair = createFakeSocketPair();
    const backendPeer = new VoiceMediaNodeBridgeRpcPeer({ socket: pair.left, handlers: backendCore.handlers, requestTimeoutMs: 1000 });
    backendCore.setPeer(backendPeer);

    let runtime = null;
    const nodeHandlers = {
        //* این پردازشگر فرمان تحویل رسانه نمونه را روی رانتایم نود اجرا می کند.
        [VoiceMediaNodeBridgeMessageType.DELIVER_MEDIA_REQUEST]: async (message, responder) => {
            try {
                await runtime.deliverMedia({ ...message.metadata, payload: message.payload });
                await responder.respond({ type: VoiceMediaNodeBridgeMessageType.DELIVER_MEDIA_RESULT, requestId: message.requestId, metadata: { success: true } });
            } catch (error) {
                await responder.respond({ type: VoiceMediaNodeBridgeMessageType.DELIVER_MEDIA_RESULT, requestId: message.requestId, metadata: { success: false, error: String(error?.message ?? error) } });
            }
        },
        //* این پردازشگر فرمان بستن رسانه نمونه را روی رانتایم نود اجرا می کند.
        [VoiceMediaNodeBridgeMessageType.CLOSE_MEDIA_REQUEST]: async (message, responder) => {
            await runtime.closeMedia(message.metadata?.listenerConnectionId, message.metadata?.reason);
            await responder.respond({ type: VoiceMediaNodeBridgeMessageType.CLOSE_MEDIA_RESULT, requestId: message.requestId, metadata: { success: true } });
        }
    };
    const nodePeer = new VoiceMediaNodeBridgeRpcPeer({ socket: pair.right, handlers: nodeHandlers, requestTimeoutMs: 1000 });
    const bridgeClient = {
        //* این تابع درخواست اجازه بایند نمونه را از پل داخلی به بک اند می فرستد.
        async authorizeBind(input) {
            const response = await nodePeer.request({ type: VoiceMediaNodeBridgeMessageType.AUTHORIZE_BIND_REQUEST, responseType: VoiceMediaNodeBridgeMessageType.AUTHORIZE_BIND_RESULT, metadata: input });
            return response.metadata;
        },
        //* این تابع فریم رسانه نمونه را برای تصمیم گیری مسیر به بک اند می فرستد.
        async routeFrame(input) {
            const response = await nodePeer.request({
                type: VoiceMediaNodeBridgeMessageType.ROUTE_FRAME_REQUEST,
                responseType: VoiceMediaNodeBridgeMessageType.ROUTE_FRAME_RESULT,
                metadata: {
                    controlConnectionId: input.controlConnectionId,
                    flags: input.flags,
                    mediaSequence: input.mediaSequence,
                    mediaTimestamp100Ns: String(input.mediaTimestamp100Ns),
                    streamId: input.streamId
                },
                payload: input.payload
            });
            return response.metadata;
        }
    };
    runtime = createVoiceMediaNodeRuntime({ bridgeClient });

    const senderOut = [];
    const listenerOut = [];
    const sender = runtime.acceptConnection({
        transportConnectionKey: "sender-media",
        //* این تابع بسته خروجی فرستنده نمونه را برای بررسی ذخیره می کند.
        sendPacket(packet) {
            senderOut.push(Buffer.from(packet));
        },
        //* این تابع بسته شدن راه انتقال فرستنده نمونه را بدون اثر جانبی تکمیل می کند.
        closeTransport() {}
    });
    const listener = runtime.acceptConnection({
        transportConnectionKey: "listener-media",
        //* این تابع بسته خروجی شنونده نمونه را برای بررسی ذخیره می کند.
        sendPacket(packet) {
            listenerOut.push(Buffer.from(packet));
        },
        //* این تابع بسته شدن راه انتقال شنونده نمونه را بدون اثر جانبی تکمیل می کند.
        closeTransport() {}
    });

    await sender.receive(encodeVoiceMediaV2Packet({
        kind: VoiceMediaV2PacketKind.BIND_REQUEST,
        transportSequence: 1,
        streamId: senderStreamId,
        payload: encodeVoiceMediaV2BindRequest({ accessToken: "sender-token", roomId, controlConnectionId: senderConnectionId, platform: 1 })
    }));
    await listener.receive(encodeVoiceMediaV2Packet({
        kind: VoiceMediaV2PacketKind.BIND_REQUEST,
        transportSequence: 1,
        streamId: listenerStreamId,
        payload: encodeVoiceMediaV2BindRequest({ accessToken: "listener-token", roomId, controlConnectionId: listenerConnectionId, platform: 1 })
    }));

    assert.equal(decodeVoiceMediaV2BindResult(decodeVoiceMediaV2Packet(senderOut[0]).payload).success, true);
    assert.equal(decodeVoiceMediaV2BindResult(decodeVoiceMediaV2Packet(listenerOut[0]).payload).success, true);

    const rejectedOut = [];
    const rejected = runtime.acceptConnection({
        transportConnectionKey: "rejected-media",
        //* این تابع پاسخ بایند رد شده را برای مقایسه با قرارداد فاز نه ذخیره می کند.
        sendPacket(packet) {
            rejectedOut.push(Buffer.from(packet));
        },
        //* این تابع بسته شدن راه انتقال رد شده نمونه را بدون اثر جانبی تکمیل می کند.
        closeTransport() {}
    });
    await rejected.receive(encodeVoiceMediaV2Packet({
        kind: VoiceMediaV2PacketKind.BIND_REQUEST,
        transportSequence: 1,
        streamId: "66666666-6666-4666-8666-666666666666",
        payload: encodeVoiceMediaV2BindRequest({ accessToken: "invalid-token", roomId, controlConnectionId: senderConnectionId, platform: 1 })
    }));
    const rejectedBind = decodeVoiceMediaV2BindResult(decodeVoiceMediaV2Packet(rejectedOut[0]).payload);
    assert.equal(rejectedBind.success, false);
    assert.equal(rejectedBind.retryable, false);
    assert.equal(rejectedBind.code, 1);
    assert.equal(rejectedBind.message, "media_bind_rejected");

    const opus = Buffer.from([1, 2, 3, 4, 5, 6]);
    await sender.receive(encodeVoiceMediaV2Packet({
        kind: VoiceMediaV2PacketKind.MEDIA,
        codec: VoiceMediaV2Codec.OPUS,
        flags: 3,
        transportSequence: 2,
        mediaSequence: 77,
        mediaTimestamp100Ns: 15400000n,
        streamId: senderStreamId,
        payload: opus
    }));

    assert.equal(listenerOut.length, 2);
    const routed = decodeVoiceMediaV2Packet(listenerOut[1]);
    assert.equal(routed.kind, VoiceMediaV2PacketKind.MEDIA);
    assert.equal(routed.codec, VoiceMediaV2Codec.OPUS);
    assert.equal(routed.flags, 3);
    assert.equal(routed.mediaSequence, 77);
    assert.equal(routed.mediaTimestamp100Ns, 15400000n);
    assert.equal(routed.sessionId, sessionId);
    assert.equal(routed.streamId, senderStreamId);
    assert.equal(routed.senderId, senderConnectionId);
    assert.deepEqual(routed.payload, opus);

    const listenerFacade = routingApplication.gateway.getConnectionByConnectionId(listenerConnectionId);
    await listenerFacade.sendEnvelope({ messageType: VoiceMessageType.ACK, payload: Buffer.from([9]) });
    assert.equal(controlSent.length, 1);
    assert.equal(controlSent[0].input.messageType, VoiceMessageType.ACK);

    assert.equal(runtime.getStats().bound, 2);
    nodePeer.close();
    backendPeer.close();
    await runtime.stop();
    backendCore.stop();
}

//* این تابع همه آزمون های ایستای فاز ده را به ترتیب اجرا می کند.
async function run() {
    testBridgeProtocol();
    await testMediaRouteThroughBridge();
    console.log("VME2_PHASE10_SERVER_TEST=PASS | separateProcessContract=True | bindAuthority=Backend | mediaTransportOwner=MediaNode | controlDelegation=True | routedSequence=77 | routedTimestamp100Ns=15400000 | binaryBridge=True");
}

await run();
