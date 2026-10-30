import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { waitForMediaEdgeUpstreamOpen } from "../mediaNode/scaling/mediaEdgeUpstreamConnectGuard.js";

function socket(readyState = 1) {
    const s = new EventEmitter();
    s.readyState = readyState;
    s.terminated = false;
    s.terminate = () => { s.terminated = true; };
    return s;
}

test("ready upstream succeeds while client remains open", async () => {
    const client = socket(); const upstream = socket(0);
    const promise = waitForMediaEdgeUpstreamOpen({client,upstream,timeoutMs:500});
    upstream.readyState=1; upstream.emit("open");
    await promise;
    assert.equal(client.listenerCount("close"),0);
    assert.equal(upstream.listenerCount("error"),0);
});

test("upstream refusal rejects immediately", async () => {
    const client = socket(); const upstream = socket(0);
    const promise = waitForMediaEdgeUpstreamOpen({client,upstream,timeoutMs:500});
    upstream.emit("error",Object.assign(new Error("refused"),{code:"ECONNREFUSED"}));
    await assert.rejects(promise,/refused/);
});

test("upstream close before open rejects", async () => {
    const client = socket(); const upstream = socket(0);
    const promise = waitForMediaEdgeUpstreamOpen({client,upstream,timeoutMs:500});
    upstream.emit("close",1006);
    await assert.rejects(promise,/closed_before_open/);
});

test("already closed client never starts connection wait", async () => {
    const client = socket(3); const upstream = socket(0);
    await assert.rejects(waitForMediaEdgeUpstreamOpen({client,upstream,timeoutMs:500}),/already_closed/);
    assert.equal(upstream.listenerCount("open"),0);
});

test("client closure aborts upstream wait", async () => {
    const client = socket(); const upstream = socket(0);
    const promise = waitForMediaEdgeUpstreamOpen({client,upstream,timeoutMs:500});
    client.readyState=3;client.emit("close");
    await assert.rejects(promise,/client_closed_before_upstream_open/);
    assert.equal(upstream.terminated,true);
});

test("upstream open wait has a strict timeout", async () => {
    const client = socket(); const upstream = socket(0);
    await assert.rejects(waitForMediaEdgeUpstreamOpen({client,upstream,timeoutMs:100}),/open_timeout/);
    assert.equal(upstream.terminated,true);
});

test("cancelling CONNECTING socket consumes delayed ws error and cleans listeners", async () => {
    const client = socket();
    const upstream = socket(0);
    upstream.terminate = () => {
        upstream.terminated = true;
        setImmediate(() => {
            upstream.emit("error", new Error("WebSocket was closed before establishment"));
            upstream.readyState = 3;
            upstream.emit("close", 1006);
        });
    };
    const promise = waitForMediaEdgeUpstreamOpen({ client, upstream, timeoutMs:500 });
    client.readyState = 3;
    client.emit("close");
    await assert.rejects(promise, /client_closed_before_upstream_open/);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(upstream.terminated, true);
    assert.equal(upstream.listenerCount("error"), 0);
    assert.equal(upstream.listenerCount("close"), 0);
});

test("timed-out CONNECTING socket consumes late error", async () => {
    const client = socket();
    const upstream = socket(0);
    upstream.terminate = () => {
        upstream.terminated = true;
        setImmediate(() => {
            upstream.emit("error", new Error("WebSocket was closed before establishment"));
            upstream.readyState = 3;
            upstream.emit("close", 1006);
        });
    };
    await assert.rejects(waitForMediaEdgeUpstreamOpen({ client, upstream, timeoutMs:100 }), /open_timeout/);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(upstream.listenerCount("error"), 0);
    assert.equal(upstream.listenerCount("close"), 0);
});

test("already closed client terminates unopened upstream safely", async () => {
    const client = socket(3);
    const upstream = socket(0);
    upstream.terminate = () => {
        upstream.terminated = true;
        setImmediate(() => {
            upstream.emit("error", new Error("WebSocket was closed before establishment"));
            upstream.readyState = 3;
            upstream.emit("close", 1006);
        });
    };
    await assert.rejects(waitForMediaEdgeUpstreamOpen({ client, upstream, timeoutMs:500 }), /already_closed/);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(upstream.terminated, true);
    assert.equal(upstream.listenerCount("error"), 0);
});
