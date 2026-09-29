import assert from "node:assert/strict";
import http from "node:http";
import { createMediaNodeTelemetryRuntimeAdapter } from "./mediaNodeTelemetryRuntimeAdapter.js";
import { postMediaNodeMetrics } from "./mediaNodeTelemetryReporter.js";

//* این تابع یک شنونده محلی ساختگی برای بررسی درخواست احراز شده گزارش بار می سازد.
async function createMetricsTestServer(secret) {
    let lastBody = null;
    const server = http.createServer(async (req, res) => {
        if (req.method !== "POST" || req.url !== "/media-node/metrics") {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: "not_found" }));
            return;
        }
        if (String(req.headers.authorization ?? "") !== `Bearer ${secret}`) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: "unauthorized" }));
            return;
        }
        const chunks = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        lastBody = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    return Object.freeze({ server, port: Number(server.address().port), getLastBody: () => lastBody });
}

//* این تابع اندازه گیری اتصال فعال و پردازنده و نرخ خروجی را با ورودی قطعی بررسی می کند.
async function testTelemetryAdapter() {
    let nowNs = 0n;
    let cpuUsage = { user: 0, system: 0 };
    let bound = 2;
    const runtime = {
        mediaRegistry: {},
        acceptConnection(input) {
            return Object.freeze({ async sendForTest(packet) { await input.sendPacket(packet); } });
        },
        async deliverMedia() {},
        async closeMedia() {},
        async stop() {},
        getStats() { return Object.freeze({ total: bound, bound, stopped: false }); }
    };
    const telemetryRuntime = createMediaNodeTelemetryRuntimeAdapter({ runtime, nowNs: () => nowNs, readCpuUsage: () => ({ ...cpuUsage }) });
    const accepted = telemetryRuntime.acceptConnection({ transportConnectionKey: "test-1", async sendPacket() {}, async closeTransport() {} });
    await accepted.sendForTest(Buffer.alloc(12_500));
    nowNs = 1_000_000_000n;
    cpuUsage = { user: 200_000, system: 50_000 };
    const first = telemetryRuntime.sampleTelemetry();
    assert.equal(first.activeConnections, 2);
    assert.equal(first.cpuPercent, 25);
    assert.equal(first.outboundKbps, 100);
    assert.equal(first.outboundBytesTotal, 12_500);

    bound = 3;
    nowNs = 2_000_000_000n;
    cpuUsage = { user: 280_000, system: 70_000 };
    const second = telemetryRuntime.sampleTelemetry();
    assert.equal(second.activeConnections, 3);
    assert.equal(second.cpuPercent, 10);
    assert.equal(second.outboundKbps, 0);
}

//* این تابع قالب درخواست و احراز گزارش بار را روی شبکه محلی واقعی بررسی می کند.
async function testMetricsHttpRequest() {
    const secret = "0123456789abcdef0123456789abcdef";
    const target = await createMetricsTestServer(secret);
    try {
        await postMediaNodeMetrics({ host: "127.0.0.1", port: target.port, secret, nodeId: "node-metrics", metrics: { activeConnections: 9, cpuPercent: 31.25, outboundKbps: 640.5 } });
        assert.deepEqual(target.getLastBody(), { nodeId: "node-metrics", activeConnections: 9, cpuPercent: 31.25, outboundKbps: 640.5 });
        await assert.rejects(() => postMediaNodeMetrics({ host: "127.0.0.1", port: target.port, secret: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", nodeId: "node-metrics", metrics: { activeConnections: 1, cpuPercent: 1, outboundKbps: 1 } }), /unauthorized/);
    } finally {
        await new Promise((resolve) => target.server.close(resolve));
    }
}

//* این تابع همه آزمون های بار واقعی نود رسانه را اجرا می کند.
async function run() {
    await testTelemetryAdapter();
    await testMetricsHttpRequest();
    console.log("VOICE_MEDIA_NODE_TELEMETRY_TEST=PASS | activeConnectionsMeasured=True | cpuPercentMeasured=True | outboundKbpsMeasured=True | authenticatedMetricsRequest=True");
}

await run();
