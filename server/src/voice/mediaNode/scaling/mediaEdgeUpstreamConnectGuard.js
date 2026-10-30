function abortUnopenedUpstream(upstream) {
    const lateError = () => {};
    const cleanup = () => {
        upstream.off("error", lateError);
        upstream.off("close", cleanup);
    };
    upstream.on("error", lateError);
    upstream.once("close", cleanup);
    try {
        upstream.terminate?.();
    } catch {
        cleanup();
    }
}

export function waitForMediaEdgeUpstreamOpen({ client, upstream, timeoutMs = 3500 } = {}) {
    if (!client || !upstream || typeof client.once !== "function" || typeof upstream.once !== "function") {
        throw new TypeError("Media edge WebSocket connections are invalid.");
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 15000) {
        throw new RangeError("Media edge upstream timeout is invalid.");
    }
    return new Promise((resolve, reject) => {
        if (client.readyState !== 1) {
            abortUnopenedUpstream(upstream);
            reject(new Error("media_edge_client_already_closed"));
            return;
        }
        let finished = false;
        let timeout = null;
        function cleanup() {
            client.off("close", clientClosed);
            upstream.off("open", opened);
            upstream.off("close", upstreamClosed);
            upstream.off("error", upstreamError);
        }
        function finish(error = null, terminate = false) {
            if (finished) return;
            finished = true;
            if (timeout !== null) clearTimeout(timeout);
            client.off("close", clientClosed);
            upstream.off("open", opened);
            if (terminate) {
                try {
                    upstream.terminate?.();
                } catch {
                    cleanup();
                }
                if (upstream.readyState === 3) cleanup();
            } else {
                cleanup();
            }
            if (error) reject(error);
            else resolve();
        }
        function opened() {
            if (client.readyState !== 1) {
                finish(new Error("media_edge_client_closed_before_upstream_open"), true);
                return;
            }
            finish();
        }
        function upstreamError(error) {
            finish(error instanceof Error ? error : new Error("media_edge_upstream_socket_error"), true);
        }
        function upstreamClosed() {
            if (finished) { cleanup(); return; }
            finish(new Error("media_edge_upstream_closed_before_open"));
        }
        function clientClosed() {
            finish(new Error("media_edge_client_closed_before_upstream_open"), true);
        }
        client.once("close", clientClosed);
        upstream.once("open", opened);
        upstream.on("error", upstreamError);
        upstream.on("close", upstreamClosed);
        timeout = setTimeout(() => finish(new Error("media_edge_upstream_open_timeout"), true), timeoutMs);
        if (upstream.readyState === 1) opened();
        else if (upstream.readyState === 3) upstreamClosed();
    });
}
