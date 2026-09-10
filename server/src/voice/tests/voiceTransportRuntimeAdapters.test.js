// مسیر فایل: src/voice/tests/voiceTransportRuntimeAdapters.test.js

import assert from "node:assert/strict";

import {
    EventEmitter
} from "node:events";

import WebSocket from "ws";

import {
    VoiceTransportName
} from "../transport/voiceTransportConstants.js";

import {
    createVoiceGrpcStreamHandler
} from "../transport/grpc/createVoiceGrpcStreamHandler.js";

import {
    registerVoiceGrpcTransport
} from "../transport/grpc/registerVoiceGrpcTransport.js";

import {
    attachVoiceWebSocketTransport
} from "../transport/websocket/attachVoiceWebSocketTransport.js";

class FakeVoiceTransportConnection {
    //* این سازنده بسته‌ها و رویدادهای دریافت‌شده اتصال آزمایشی را نگه می‌دارد.
    constructor() {
        this.receivedPackets = [];
        this.closedMessages = [];
        this.closeRequests = [];
    }

    //* این تابع بسته تحویلی آداپتور را برای بررسی آزمون ثبت می‌کند.
    async receiveBinary(packet) {
        this.receivedPackets.push(
            packet
        );
    }

    //* این تابع بسته‌شدن راه انتقال زیرین را برای بررسی آزمون ثبت می‌کند.
    async notifyTransportClosed(
        message
    ) {
        this.closedMessages.push(
            message
        );
    }

    //* این تابع درخواست بستن مستقیم آداپتور را برای بررسی آزمون ثبت می‌کند.
    async close(options) {
        this.closeRequests.push(
            options
        );
    }
}

class FakeVoiceTransportGateway {
    //* این سازنده سیاست و اتصال‌های پذیرفته‌شده درگاه آزمایشی را آماده می‌کند.
    constructor() {
        this.policy =
            Object.freeze({
                maxPacketBytes:
                    64 * 1024,

                sendTimeoutMs:
                    1000
            });

        this.accepted = [];
    }

    //* این تابع مشخصات اتصال ساخته‌شده توسط آداپتور را ثبت و اتصال آزمایشی برمی‌گرداند.
    acceptConnection(options) {
        const connection =
            new FakeVoiceTransportConnection();

        this.accepted.push({
            options,
            connection
        });

        return connection;
    }

    //* این تابع آمار ساده اتصال‌های پذیرفته‌شده را برای آزمون برمی‌گرداند.
    getStats() {
        return Object.freeze({
            transportConnections:
                this.accepted.length
        });
    }
}

class FakeVoiceWebSocket extends EventEmitter {
    //* این سازنده وضعیت وب‌سوکت باز و داده‌های خروجی آن را آماده می‌کند.
    constructor() {
        super();

        this.readyState =
            WebSocket.OPEN;

        this.bufferedAmount = 0;
        this.sentPackets = [];
        this.closeInfo = null;
        this.terminated = false;
    }

    //* این تابع بسته خروجی وب‌سوکت را ثبت و موفقیت ارسال را اعلام می‌کند.
    send(
        packet,
        options,
        callback
    ) {
        this.sentPackets.push({
            packet,
            options
        });

        callback?.();
    }

    //* این تابع کد و علت بستن وب‌سوکت را ثبت می‌کند.
    close(
        code,
        reason
    ) {
        this.closeInfo = {
            code,
            reason
        };

        this.readyState =
            WebSocket.CLOSING;
    }

    //* این تابع پایان اجباری وب‌سوکت آزمایشی را ثبت می‌کند.
    terminate() {
        this.terminated = true;

        this.readyState =
            WebSocket.CLOSED;
    }
}

class FakeVoiceGrpcCall extends EventEmitter {
    //* این سازنده وضعیت جریان جی‌آرپی و پیام‌های خروجی آن را آماده می‌کند.
    constructor() {
        super();

        this.cancelled = false;
        this.destroyed = false;
        this.writtenMessages = [];
        this.endCount = 0;
    }

    //* این تابع پیام خروجی جی‌آرپی را ثبت و آزادبودن صف را اعلام می‌کند.
    write(message) {
        this.writtenMessages.push(
            message
        );

        return true;
    }

    //* این تابع پایان جریان جی‌آرپی را ثبت می‌کند.
    end() {
        this.endCount += 1;
    }
}

//* این تابع اتصال آداپتور وب‌سوکت به درگاه صوت را بدون بازکردن پورت بررسی می‌کند.
async function testVoiceWebSocketRuntimeAdapter() {
    const gateway =
        new FakeVoiceTransportGateway();

    const webSocketServer =
        new EventEmitter();

    const runtime =
        attachVoiceWebSocketTransport({
            webSocketServer,
            gateway
        });

    const socket =
        new FakeVoiceWebSocket();

    webSocketServer.emit(
        "connection",
        socket
    );

    assert.equal(
        gateway.accepted.length,
        1
    );

    assert.equal(
        gateway.accepted[0]
            .options
            .transportName,
        VoiceTransportName.WEBSOCKET
    );

    const packet =
        Buffer.from([
            1,
            2,
            3,
            4
        ]);

    socket.emit(
        "message",
        packet,
        true
    );

    await new Promise(
        (resolve) =>
            setImmediate(resolve)
    );

    assert.deepEqual(
        gateway.accepted[0]
            .connection
            .receivedPackets,
        [
            packet
        ]
    );

    socket.emit(
        "close",
        1000,
        Buffer.alloc(0)
    );

    await new Promise(
        (resolve) =>
            setImmediate(resolve)
    );

    assert.equal(
        gateway.accepted[0]
            .connection
            .closedMessages
            .length,
        1
    );

    await runtime.stop();

    assert.equal(
        webSocketServer
            .listenerCount(
                "connection"
            ),
        0
    );
}

//* این تابع تبدیل جریان جی‌آرپی به اتصال درگاه صوت را بدون ثبت روی پورت بررسی می‌کند.
async function testVoiceGrpcRuntimeHandler() {
    const gateway =
        new FakeVoiceTransportGateway();

    const handler =
        createVoiceGrpcStreamHandler({
            gateway
        });

    const call =
        new FakeVoiceGrpcCall();

    const connection =
        handler(call);

    assert.equal(
        gateway.accepted.length,
        1
    );

    assert.equal(
        gateway.accepted[0]
            .options
            .transportName,
        VoiceTransportName.GRPC
    );

    const packet =
        Buffer.from([
            5,
            6,
            7,
            8
        ]);

    call.emit(
        "data",
        {
            packet
        }
    );

    await new Promise(
        (resolve) =>
            setImmediate(resolve)
    );

    assert.deepEqual(
        connection.receivedPackets,
        [
            packet
        ]
    );

    call.emit("end");

    await new Promise(
        (resolve) =>
            setImmediate(resolve)
    );

    assert.equal(
        connection
            .closedMessages
            .length,
        1
    );

    assert.equal(
        call.endCount,
        1
    );
}

//* این تابع ثبت سرویس جی‌آرپی روی سرور تزریق‌شده را بدون بایند یا شروع سرور بررسی می‌کند.
function testVoiceGrpcRuntimeRegistration() {
    const gateway =
        new FakeVoiceTransportGateway();

    const registrations = [];

    const grpcServer = {
        //* این تابع تعریف سرویس و هندلرهای ثبت‌شده را برای بررسی آزمون نگه می‌دارد.
        addService(
            serviceDefinition,
            handlers
        ) {
            registrations.push({
                serviceDefinition,
                handlers
            });
        }
    };

    const result =
        registerVoiceGrpcTransport({
            grpcServer,
            gateway
        });

    assert.equal(
        result.registered,
        true
    );

    assert.equal(
        registrations.length,
        1
    );

    assert.equal(
        typeof registrations[0]
            .handlers
            .connect,
        "function"
    );

    assert.equal(
        typeof result
            .serviceDefinition,
        "object"
    );
}

await testVoiceWebSocketRuntimeAdapter();
await testVoiceGrpcRuntimeHandler();
testVoiceGrpcRuntimeRegistration();

console.log(
    "VOICE_TRANSPORT_RUNTIME_ADAPTERS_TEST=OK"
);

/*
توضیح فایل:
این فایل اتصال وب‌سوکت تزریق‌شده، ساخت هندلر جی‌آرپی و ثبت سرویس روی سرور تزریق‌شده را بدون بازکردن پورت یا اتصال به فایل اصلی بررسی می‌کند.
*/
