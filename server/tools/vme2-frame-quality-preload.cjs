'use strict';

// A *preload-only* diagnostic wrapper. Does not modify src/index.js or nginx.
// Install with Node's --require on the metaverse-server process after approval.
// Requests outside the precise telemetry path are delegated to the original handler.

const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const QUALITY_PATH = '/voice/diagnostics/frame-quality';
const DEFAULT_LOG = '/home/world3d/.vme2-frame-quality-uplink/ingest.log';

function isTelemetryRequest(request) {
  return request && request.url === QUALITY_PATH;
}

function wrapRequestListener(existingListener, getTelemetryHandler) {
  if (typeof existingListener !== 'function') throw new TypeError('existingListener required');
  if (typeof getTelemetryHandler !== 'function') throw new TypeError('getTelemetryHandler required');
  return function interceptedHttpRequest(req, res) {
    if (!isTelemetryRequest(req)) return existingListener.call(this, req, res);
    // Never invoke the normal application handler for the reserved diagnostic URL.
    // Failure to initialize telemetry yields only a 503, without affecting voice or game routes.
    try {
      Promise.resolve(getTelemetryHandler())
        .then((handler) => handler(req, res))
        .catch(() => {
          if (!res.writableEnded && !res.destroyed) {
            res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end('{"success":false,"reason":"telemetry_unavailable"}');
          }
        });
    } catch {
      if (!res.writableEnded && !res.destroyed) {
        res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end('{"success":false,"reason":"telemetry_unavailable"}');
      }
    }
  };
}

function install({ createTelemetryHandler = getHandler } = {}) {
  if (http.createServer.__vme2FrameQualityWrapped === true) return false;
  const original = http.createServer;
  function createServerWithTelemetry(...args) {
    const idx = typeof args[0] === 'function' ? 0 :
      (typeof args[1] === 'function' ? 1 : -1);
    if (idx >= 0) args[idx] = wrapRequestListener(args[idx], createTelemetryHandler);
    return Reflect.apply(original, this, args);
  }
  Object.defineProperty(createServerWithTelemetry, '__vme2FrameQualityWrapped', { value: true });
  http.createServer = createServerWithTelemetry;
  return true;
}

let handlerPromise;
function getHandler() {
  if (!handlerPromise) {
    handlerPromise = (async () => {
      // Use the same JWT verifier already used by the metaverse server.
      // No private keys, tokens or raw audio are written to the telemetry log.
      const root = path.resolve(__dirname, '..');
      const [{ tokenService }, { createTelemetryHandler, createFileSink }] = await Promise.all([
        import(pathToFileURL(path.join(root, 'src/core/auth/auth.instance.js')).href),
        import(pathToFileURL(path.join(__dirname, 'vme2-frame-quality-telemetry-core.mjs')).href)
      ]);
      if (typeof tokenService?.verifyAccessToken !== 'function') {
        throw new TypeError('token_verifier_not_available');
      }
      const target = process.env.VME2_FRAME_QUALITY_LOG_PATH || DEFAULT_LOG;
      const emit = createFileSink(target);
      return createTelemetryHandler({
        verifyAccessToken: (jwt) => tokenService.verifyAccessToken(jwt),
        emit
      }).handler;
    })();
    // A failed initialization can be retried (e.g. if a log folder becomes writable).
    handlerPromise.catch(() => { handlerPromise = undefined; });
  }
  return handlerPromise;
}

if (process.env.VME2_FRAME_QUALITY_NO_AUTO_INSTALL !== '1') install();

module.exports = { QUALITY_PATH, isTelemetryRequest, wrapRequestListener, install };
