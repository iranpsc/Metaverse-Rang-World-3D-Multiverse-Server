import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const QUALITY_PATH = '/voice/diagnostics/frame-quality';
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COUNTERS = Object.freeze(['normal', 'missing', 'fec', 'plc', 'late', 'duplicate', 'overflow', 'reordered', 'underflows', 'captureDrops', 'encoded', 'decoded', 'statsUpdates']);
const STATES = new Set(['AUTH_PENDING','PIPELINE_STOPPED','MEDIA_NOT_BOUND','BASELINE','NO_ACTIVE_SESSION','STATS_NOT_UPDATED','OBSERVED','UNAVAILABLE']);
const MAX_BODY = 4096;
const MAX_TICKETS = 256;
const MAX_PER_USER = 4;
const TICKET_TTL_MS = 45 * 60 * 1000;
const MIN_SAMPLE_MS = 8000;
const MAX_LOG_BYTES = 16 * 1024 * 1024;

function uint(n, max = 1_000_000_000) { return Number.isSafeInteger(n) && n >= 0 && n <= max; }
function nonnegative(n, max) { return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max; }
function parseSample(body) {
  if (!body || body.type !== 'sample' || !ID_RE.test(String(body.connectionId ?? ''))) return null;
  if (!STATES.has(body.state) || typeof body.bound !== 'boolean' || typeof body.hasDelta !== 'boolean') return null;
  if (!uint(body.sessions, 256) || !uint(body.streams, 256) || !uint(body.bufferFrames, 200000) || !uint(body.targetDelayMs, 60000)) return null;
  if (!nonnegative(body.jitterMs, 60000) || !nonnegative(body.statsAgeSec, 86400)) return null;
  if (typeof body.clientAtUtc !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(body.clientAtUtc)) return null;
  for (const k of COUNTERS) if (!uint(body[k])) return null;
  if (body.normal + body.missing > 1_000_000_000) return null;
  const sample = {
    connectionId:body.connectionId.toLowerCase(), clientAtUtc:body.clientAtUtc,
    state:body.state, sessions:body.sessions, streams:body.streams,
    bound:body.bound, hasDelta:body.hasDelta,
    jitterMs:body.jitterMs, bufferFrames:body.bufferFrames,
    targetDelayMs:body.targetDelayMs, statsAgeSec:body.statsAgeSec
  };
  for (const k of COUNTERS) sample[k] = body[k];
  return sample;
}
function json(res, code, object) {
  const body = Buffer.from(JSON.stringify(object), 'utf8');
  res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Content-Length':body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(body);
}
function digest(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function safeBody(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json(?:\s*;|\s*$)/i.test(String(req.headers['content-type'] ?? ''))) {
      reject({code:415});return;
    }
    const length = req.headers['content-length'];
    if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) {reject({code:413});return;}
    let bytes=0, chunks=[], done=false;
    const fail=code=>{if(done)return;done=true;reject({code});};
    req.on('data',chunk=>{
      if(done)return;
      bytes+=chunk.length;
      if(bytes>MAX_BODY){fail(413);return;}
      chunks.push(chunk);
    });
    req.on('aborted',()=>fail(400));
    req.on('error',()=>fail(400));
    req.on('end',()=>{
      if(done)return;done=true;
      try {
        const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('not_object');
        resolve(value);
      } catch {reject({code:400});}
    });
  });
}

function createFileSink(file, maxBytes = MAX_LOG_BYTES) {
  if (!path.isAbsolute(file)) throw Error('log file must be absolute');
  const folder=path.dirname(file);
  fs.mkdirSync(folder,{recursive:true,mode:0o700});
  fs.chmodSync(folder,0o700);
  const verifyFile=()=>{
    try {
      const st=fs.lstatSync(file);
      if(!st.isFile() || st.isSymbolicLink())throw Error('unsafe log path');
    } catch(e) {if(e.code!=='ENOENT')throw e;}
  };
  verifyFile();
  fs.closeSync(fs.openSync(file,'a',0o600));
  fs.chmodSync(file,0o600);
  return line=>{
    verifyFile();
    const bytes=Buffer.byteLength(line,'utf8');
    const size=fs.statSync(file).size;
    if(size+bytes > maxBytes){
      const old=`${file}.1`;
      try{fs.unlinkSync(old);}catch(e){if(e.code!=='ENOENT')throw e;}
      fs.renameSync(file,old);
      fs.closeSync(fs.openSync(file,'a',0o600));
      fs.chmodSync(file,0o600);
    }
    fs.appendFileSync(file,line,{encoding:'utf8',mode:0o600});
  };
}

function createTelemetryHandler({verifyAccessToken, emit, now=Date.now, ticketTtlMs=TICKET_TTL_MS, minSampleMs=MIN_SAMPLE_MS}={}) {
  if(typeof verifyAccessToken!=='function' || typeof emit!=='function')throw TypeError('verifyAccessToken and emit required');
  const tickets=new Map();
  const salt=crypto.randomBytes(16);
  const counts={acceptedSamples:0,rejected:0,initialized:0};
  const reject=(res,code,reason)=>{counts.rejected++;json(res,code,{success:false,reason});};
  const prune=()=>{for(const [k,t] of tickets)if(t.exp <= now())tickets.delete(k);};
  const userTag=sub=>crypto.createHmac('sha256',salt).update(sub).digest('hex').slice(0,16);
  const handler=async(req,res)=>{
    req.setTimeout(8000,()=>req.destroy());
    if(req.method==='GET' && req.url==='/health'){
      json(res,200,{status:'ok',service:'vme2-frame-quality-preload',activeTickets:tickets.size,...counts});return;
    }
    if(req.url!==QUALITY_PATH){reject(res,404,'not_found');return;}
    if(req.method!=='POST'){reject(res,405,'method_not_allowed');return;}
    let body;
    try{body=await safeBody(req);}catch(e){if(!res.writableEnded && !res.destroyed)reject(res,e.code||400,'invalid_request');return;}
    const connectionId=String(body.connectionId ?? '').toLowerCase();
    if(!ID_RE.test(connectionId)){reject(res,400,'invalid_connection_id');return;}
    if(body.type==='init'){
      const header=String(req.headers.authorization ?? '');
      if(!/^Bearer [A-Za-z0-9._~-]+$/.test(header) || header.length>4096){reject(res,401,'authorization_required');return;}
      let claims;
      try{claims=await Promise.resolve(verifyAccessToken(header.slice(7)));}
      catch {reject(res,401,'access_token_invalid');return;}
      const sub=typeof claims?.sub==='string' ? claims.sub.trim() : '';
      if(!sub || sub.length>256){reject(res,401,'user_identity_invalid');return;}
      prune();
      const subjectTag=userTag(sub);
      for(const [key,t] of tickets)if(t.subTag===subjectTag && t.connectionId===connectionId)tickets.delete(key);
      if(tickets.size>=MAX_TICKETS || [...tickets.values()].filter(t=>t.subTag===subjectTag).length>=MAX_PER_USER){reject(res,429,'ticket_capacity_limit');return;}
      const ticket=crypto.randomBytes(32).toString('base64url');
      tickets.set(digest(ticket),{connectionId,subTag:subjectTag,exp:now()+ticketTtlMs,last:-Infinity});
      counts.initialized++;
      json(res,200,{success:true,ticket,intervalSec:10,expiresAtUtc:new Date(now()+ticketTtlMs).toISOString()});return;
    }
    const sample=parseSample(body);
    if(!sample){reject(res,400,'invalid_sample');return;}
    const raw=String(req.headers['x-vme2-telemetry-ticket'] ?? '');
    if(!/^[A-Za-z0-9_-]{43}$/.test(raw)){reject(res,401,'ticket_required');return;}
    const hash=digest(raw);
    const ticket=tickets.get(hash);
    if(!ticket || ticket.exp<=now()) {tickets.delete(hash);reject(res,401,'ticket_expired_or_invalid');return;}
    if(ticket.connectionId!==sample.connectionId){reject(res,403,'connection_mismatch');return;}
    if(now()-ticket.last<minSampleMs){reject(res,429,'rate_limited');return;}
    // This is diagnostic data. No access to the main server's in-memory voice registry;
    // connectionId is therefore CLIENT-REPORTED, NOT independent ownership proof.
    const parts=[
      'VME2_WEBGL_FRAME_QUALITY',
      `atUtc=${new Date(now()).toISOString()}`,
      `clientAtUtc=${sample.clientAtUtc}`,
      'source=main_http_preload_wrapper',
      'ownership=client_reported_not_registry_verified',
      `userTag=${ticket.subTag}`,
      `connectionId=${sample.connectionId}`,
      `state=${sample.state}`,
      `sessions=${sample.sessions}`,
      `streams=${sample.streams}`,
      `bound=${sample.bound?'True':'False'}`,
      `hasDelta=${sample.hasDelta?'True':'False'}`,
      ...COUNTERS.map(k=>`${k}=${sample[k]}`),
      `jitterMs=${sample.jitterMs}`,
      `bufferFrames=${sample.bufferFrames}`,
      `targetDelayMs=${sample.targetDelayMs}`,
      `statsAgeSec=${sample.statsAgeSec}`,
      'metric=receiver_playout_frame_gap_not_network_packet_loss'
    ];
    try {await Promise.resolve(emit(parts.join(' | ')+'\n'));}
    catch {reject(res,503,'telemetry_write_failed');return;}
    ticket.last=now();counts.acceptedSamples++;
    res.writeHead(204,{'Cache-Control':'no-store'});res.end();
  };
  return {handler,counts};
}

export {QUALITY_PATH,parseSample,createTelemetryHandler,createFileSink};
