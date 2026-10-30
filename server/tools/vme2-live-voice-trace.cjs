#!/usr/bin/env node
'use strict';

// Standalone, read-only VME2 timeline collector. Does not attach hooks or change services.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { execFileSync, spawnSync } = require('node:child_process');

const VERSION = '2026-10-17.3';
const SERVICE_RE = /^(?:metaverse-server|metaverse-voice-media-(?:edge|node-a|node-b)|metaverse-warm-pool|[a-z0-9_.-]*(?:dedicated|game-server)[a-z0-9_.-]*)$/i;
const LINE_RE = /VME2_|VOICE_|voice|media|session|heartbeat|websocket|upstream|transport|reconnect|bind|authorization|token|error|fail|close|timeout|ETIMEDOUT|EPIPE|ECONN|ERR_NETWORK_/i;
const FRAME_RE = /VOICE_FRAME_ROUTE_RESULT|VOICE_FRAME_ROUTED|VOICE_FRAME_RECEIVED|VOICE_MEDIA_FRAME|CAPTURE_FRAME_ACCEPTED|RECORDING_CAPTURE_FRAME_RESULT/i;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const PRIVATE_RE = /\b([a-z0-9_-]*(?:token|secret|password|passwd|credential|api[_-]?key|private[_-]?key)|authorization|cookie|set-cookie)\b\s*[:=]\s*(?:Bearer\s+)?(?:"[^"]*"|'[^']*'|[^\s|;,]+)/gi;
const JSON_PRIVATE_RE = /(["'](?:accessToken|refreshToken|token|secret|password|authorization|cookie|apiKey|privateKey)["']\s*:\s*)["'][^"']*["']/gi;
const QUERY_RE = /([?&](?:access_token|refresh_token|token|key|authorization|code)=)[^\s&#|]+/gi;
const MAX_LINE = 1700;

function safeLine(input) {
    return String(input ?? '').replace(/\x1b\[[0-9;]*m/g, '')
        .replace(JWT_RE, '[JWT_REDACTED]')
        .replace(JSON_PRIVATE_RE, '$1"[REDACTED]"')
        .replace(PRIVATE_RE, (_, key) => `${key}=[REDACTED]`)
        .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{10,}/gi, 'Bearer [REDACTED]')
        .replace(QUERY_RE, '$1[REDACTED]')
        .slice(0, MAX_LINE);
}
function field(line, name) {
    const match = String(line).match(new RegExp(`(?:^|[|\\s])${name}=([^\\s|]+)`));
    return match ? String(match[1]).slice(0, 128) : '';
}
function classify(input) {
    const s = String(input);
    if (/VME2_WEBGL_FRAME_QUALITY\b/.test(s)) return 'CLIENT_FRAME_QUALITY';
    if (/VME2_TRACE_PROCESS_CHANGE/.test(s)) return 'PROCESS_CHANGED';
    if (/VME2_PHASE11_MEDIA_EDGE_AUTH_DIAG=DENIED|media_edge_authorization_failed|ACCESS_TOKEN_EXPIRED|media_bind_rejected/i.test(s)) return 'AUTH_DENIED';
    if (/VOICE_FRAME_LISTENER_DELIVERY_FAILED|Voice_media_plane_is_not_bound_for_the_listener|listenerTransportExists=false|listener_offline/i.test(s)) return 'LISTENER_DELIVERY_FAILED';
    if (/VME2_PHASE11_MEDIA_EDGE_ROUTE=FAIL|media_edge_route_failed|media_wrong_room_owner/i.test(s)) return 'EDGE_ROUTE_FAILED';
    if (/VME2_PHASE11_MEDIA_EDGE_UPSTREAM=(?:CLOSED|ERROR)|CLOSE_MEDIA_REQUEST|MEDIA_NODE.*(?:CLOSE|DISCONNECT)|MEDIA.*TRANSPORT_CLOSED/i.test(s)) return 'MEDIA_CLOSED';
    if (/VOICE_FRAME_ROUTE_RESULT/.test(s)) {
        const attempts = Number(field(s, 'deliveryAttempts'));
        const delivered = Number(field(s, 'delivered'));
        if (Number.isFinite(attempts) && attempts > 0 && Number.isFinite(delivered) && delivered < attempts) return 'FRAME_ROUTE_PARTIAL';
        return 'FRAME_ROUTE_RESULT';
    }
    if (/VOICE_FRAME_ROUTE_DROPPED|frame_route_dropped/i.test(s)) return 'FRAME_ROUTE_DROPPED';
    if (/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_CONNECTION_TIMED_OUT|ECONNRESET|ETIMEDOUT|EPIPE/i.test(s)) return 'NETWORK_FAILURE';
    if (/VOICE_CLIENT_SESSION_JOINED|DEDICATED_SESSION_EVENT_RECEIVED|member_joined|member_left|session_closed|SESSION_CREATED/i.test(s)) return 'SESSION_CHANGE';
    if (/MEDIA_BIND=PASS|MEDIA_RECONNECT=PASS|mediaBound=true|mediaBound=True/i.test(s)) return 'MEDIA_BIND_SIGNAL';
    if (/RECONNECT|REPAIR|GUARD/i.test(s)) return 'RECONNECT_SIGNAL';
    if (/HEARTBEAT|PublishStart|CONTROL_ACK/i.test(s)) return 'CONTROL_SIGNAL';
    if (/ERROR|FAIL|DENIED|REJECTED/i.test(s)) return 'OTHER_FAILURE';
    return 'OBSERVATION';
}
const ALERT_KINDS = new Set(['PROCESS_CHANGED','AUTH_DENIED','LISTENER_DELIVERY_FAILED','EDGE_ROUTE_FAILED','MEDIA_CLOSED','FRAME_ROUTE_PARTIAL','FRAME_ROUTE_DROPPED','NETWORK_FAILURE','OTHER_FAILURE']);
function parseArgs(argv) {
    const result = { durationSec: 1800, pollMs: 1000, snapshotSec: 10, maxMb: 100, logDir: '', outDir: '', noPm2: false, noHealth: false, clientLogs: [] };
    for (let i = 0; i < argv.length; i++) {
        const opt = argv[i];
        if (opt === '--help') { result.help = true; continue; }
        if (opt === '--no-pm2') { result.noPm2 = true; continue; }
        if (opt === '--no-health') { result.noHealth = true; continue; }
        const value = argv[++i];
        if (!value) throw Error(`Missing value for ${opt}`);
        if (opt === '--duration-sec') result.durationSec = Number(value);
        else if (opt === '--poll-ms') result.pollMs = Number(value);
        else if (opt === '--snapshot-sec') result.snapshotSec = Number(value);
        else if (opt === '--max-mb') result.maxMb = Number(value);
        else if (opt === '--log-dir') result.logDir = value;
        else if (opt === '--out-dir') result.outDir = value;
        else if (opt === '--client-log') result.clientLogs.push(value);
        else throw Error(`Unsupported option: ${opt}`);
    }
    const ranges = [['durationSec',2,86400],['pollMs',200,10000],['snapshotSec',2,300],['maxMb',5,1024]];
    for (const [name,min,max] of ranges) if (!Number.isFinite(result[name]) || result[name] < min || result[name] > max) throw Error(`${name} must be between ${min} and ${max}`);
    return result;
}
function pm2Snapshot() {
    const raw = execFileSync('pm2', ['jlist'], { timeout: 7000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8', stdio: ['ignore','pipe','ignore'] });
    return JSON.parse(raw).filter(p => SERVICE_RE.test(String(p.name ?? ''))).map(p => ({
        name: String(p.name), pid: Number(p.pid) || 0,
        status: String(p.pm2_env?.status ?? 'unknown'),
        restarts: Number(p.pm2_env?.restart_time) || 0,
        uptimeMs: Number(p.pm2_env?.pm_uptime) || 0,
        outLog: String(p.pm2_env?.pm_out_log_path ?? ''),
        errorLog: String(p.pm2_env?.pm_err_log_path ?? ''),
        pm2CpuPercent: Number.isFinite(Number(p.monit?.cpu)) ? Number(p.monit.cpu) : null,
        pm2MemoryBytes: Number.isFinite(Number(p.monit?.memory)) ? Number(p.monit.memory) : null
    }));
}
function healthCheck(port, timeoutMs = 1600) {
    return new Promise(resolve => {
        let settled = false;
        const finish = data => { if (!settled) { settled = true; resolve(data); } };
        const req = http.get({ hostname:'127.0.0.1', port, path:'/health', agent:false, timeout:timeoutMs }, res => {
            let body = ''; res.setEncoding('utf8');
            res.on('data', chunk => { body += chunk; if (body.length > 65536) req.destroy(Error('oversized_health_response')); });
            res.on('end', () => {
                let data = {};
                try { data = JSON.parse(body); } catch { /* Health JSON not available. */ }
                finish({ port, statusCode:res.statusCode, status:data.status ?? null, success:data.success ?? null,
                    nodeId:String(data.nodeId ?? '').slice(0,80), bridge:data.bridge?.status ?? null,
                    connectedNodes:Array.isArray(data.connectedNodes) ? data.connectedNodes.length : null });
            });
        });
        req.on('timeout', () => req.destroy(Error('health_timeout')));
        req.on('error', e => finish({ port, error:e.code ?? e.message }));
    });
}
// Linux-only read-only resource probes. A failed or unavailable counter is null, never a fabricated zero.
function readLinuxCpu() {
    try {
        const first = fs.readFileSync('/proc/stat','utf8').split('\n')[0].trim().split(/\s+/);
        if (first[0] !== 'cpu') return null;
        const values = first.slice(1).map(Number);
        if (values.length < 5 || values.some(n => !Number.isFinite(n))) return null;
        return {total:values.reduce((a,b)=>a+b,0), idle:values[3]+values[4]};
    } catch { return null; }
}
function readLinuxProcess(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0) return null;
    try {
        const raw = fs.readFileSync(`/proc/${pid}/stat`,'utf8');
        const close = raw.lastIndexOf(') ');
        if (close < 0) return null;
        const fields = raw.slice(close+2).trim().split(/\s+/);
        if (fields.length <= 21) return null;
        const utime=Number(fields[11]), stime=Number(fields[12]);
        const startTime=String(fields[19]);
        if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null;
        let rssBytes = null;
        try {
            const status=fs.readFileSync(`/proc/${pid}/status`,'utf8');
            const match=status.match(/^VmRSS:\s*(\d+)\s*kB/m);
            if (match) rssBytes=Number(match[1])*1024;
        } catch { /* Process may have exited. */ }
        return {cpuTicks:utime+stime,startTime,rssBytes};
    } catch { return null; }
}
function readLinuxMemory() {
    try {
        const data=fs.readFileSync('/proc/meminfo','utf8');
        const get=key => {const m=data.match(new RegExp(`^${key}:\\s*(\\d+)\\s*kB`,'m'));return m?Number(m[1])*1024:null;};
        const total=get('MemTotal'),available=get('MemAvailable');
        if (total === null || available === null || total <= 0) return null;
        return {totalBytes:total,availableBytes:available,usedPercent:Math.round(10000*(total-available)/total)/100};
    } catch { return null; }
}
function readLinuxNetwork() {
    try {
        return fs.readFileSync('/proc/net/dev','utf8').split('\n').slice(2).map(line => {
            const split=line.indexOf(':'); if (split < 0) return null;
            const name=line.slice(0,split).trim();
            const columns=line.slice(split+1).trim().split(/\s+/).map(Number);
            if (columns.length < 12 || !columns.every(Number.isFinite)) return null;
            return {interface:name,rxPackets:columns[1],rxErrors:columns[2],rxDrops:columns[3],
                txPackets:columns[9],txErrors:columns[10],txDrops:columns[11]};
        }).filter(Boolean);
    } catch { return []; }
}
function roundPercent(n) {return Number.isFinite(n) ? Math.round(n*100)/100 : null;}
class LogFollower {
    constructor(filename, label) { this.filename = filename; this.label = label; this.offset = 0; this.inode = ''; this.partial = ''; this.init = false; }
    consume(callback, initial = false) {
        let stat;
        try { stat = fs.statSync(this.filename); } catch (e) { if (e.code === 'ENOENT') return 0; throw e; }
        if (!stat.isFile()) return 0;
        const inode = `${stat.dev}:${stat.ino}`;
        if (!this.init) { this.init = true; this.inode = inode; this.offset = initial ? Math.max(0,stat.size - 256 * 1024) : stat.size; }
        else if (this.inode !== inode || stat.size < this.offset) { this.inode = inode; this.offset = 0; this.partial = ''; }
        const amount = Math.min(stat.size - this.offset, 2 * 1024 * 1024);
        if (amount <= 0) return 0;
        const buffer = Buffer.alloc(amount); const fd = fs.openSync(this.filename,'r');
        let count = 0;
        try {
            const size = fs.readSync(fd,buffer,0,amount,this.offset);
            this.offset += size;
            let chunks = (this.partial + buffer.toString('utf8',0,size)).split(/\r?\n/);
            this.partial = chunks.pop() ?? '';
            if (this.partial.length > 10000) this.partial = '';
            if (initial && stat.size > 256*1024) chunks = chunks.slice(1);
            for (const row of chunks) { if (row.length > 10000) continue; callback(row, this.label, initial); count++; }
        } finally { fs.closeSync(fd); }
        return count;
    }
}
class Recorder {
    constructor(options) {
        this.options = options;
        const stamp = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z');
        this.outDir = path.resolve(options.outDir || path.join(os.homedir(),'.vme2-voice-traces',`trace-${stamp}`));
        fs.mkdirSync(this.outDir,{recursive:true,mode:0o700}); fs.chmodSync(this.outDir,0o700);
        this.startedAt = new Date().toISOString(); this.followers = new Map(); this.stats = {};
        this.alerts = 0; this.events = 0; this.totalBytes = 0;
        this.maxBytes = Math.floor(options.maxMb * 1024 * 1024);
        this.lastProcesses = []; this.firstFailure = null; this.lastPoll = null; this.failure = null; this.previousProcesses = new Map();
        this.lastSnapshotAt = 0; this.lastDiscoverAt = 0; this.stopped = false; this.pendingStop = false;
        this.previousHostCpu = null; this.previousProcessCpu = new Map(); this.previousNetwork = new Map();
        this.lastResourceSample = null;
        this.qualityBuckets = new Map(); this.qualityTotals = new Map(); this.clientQuality = new Map(); this.sessionParticipants = new Map();
        this.out = {events:path.join(this.outDir,'events.ndjson'),alerts:path.join(this.outDir,'alerts.ndjson'),samples:path.join(this.outDir,'samples.ndjson'),quality:path.join(this.outDir,'quality.ndjson')};
        for (const p of Object.values(this.out)) fs.writeFileSync(p,'',{mode:0o600,flag:'wx'});
    }
    append(key, payload) {
        const row = JSON.stringify(payload) + '\n'; const bytes = Buffer.byteLength(row);
        if (this.totalBytes + bytes > this.maxBytes) { this.failure = 'OUTPUT_SIZE_LIMIT'; this.pendingStop = true; return false; }
        fs.appendFileSync(this.out[key],row,{encoding:'utf8',mode:0o600}); this.totalBytes += bytes; return true;
    }
    discover() {
        let processes = [];
        if (!this.options.noPm2) {
            try {
                processes = pm2Snapshot();
                for (const p of processes) {
                    const old = this.previousProcesses.get(p.name);
                    if (old && (old.pid !== p.pid || old.restarts !== p.restarts || old.status !== p.status)) {
                        this.onLine(`VME2_TRACE_PROCESS_CHANGE | name=${p.name} | previousPid=${old.pid} | pid=${p.pid} | previousRestarts=${old.restarts} | restarts=${p.restarts} | previousStatus=${old.status} | status=${p.status}`, `${p.name}:pm2`, false);
                    }
                    this.previousProcesses.set(p.name, { pid:p.pid, restarts:p.restarts, status:p.status });
                }
                this.lastProcesses = processes;
            }
            catch(e) { this.failure = `PM2_SNAPSHOT_FAILED:${e.code ?? e.message}`; }
        }
        const sources = new Map();
        for (const p of processes) {
            if (p.outLog) sources.set(p.outLog,`${p.name}:out`);
            if (p.errorLog) sources.set(p.errorLog,`${p.name}:error`);
        }
        const folder = this.options.logDir || path.join(os.homedir(),'.pm2','logs');
        if (this.options.logDir || processes.length === 0) {
            try {
                for (const name of fs.readdirSync(folder)) {
                    const match = name.match(/^(.*)-(out|error)\.log$/i);
                    if (match && SERVICE_RE.test(match[1])) sources.set(path.join(folder,name),`${match[1]}:${match[2]}`);
                }
            } catch(e) { if (e.code !== 'ENOENT') throw e; }
        }
        for (const filename of this.options.clientLogs) sources.set(path.resolve(filename),'CLIENT_LOG');
        for (const [name,label] of sources) {
            if (this.followers.has(name)) continue;
            if (!fs.existsSync(name)) continue;
            const tail = new LogFollower(name,label); this.followers.set(name,tail);
            tail.consume((line,src) => this.onLine(line,src,true),true);
        }
        this.lastDiscoverAt = Date.now();
    }
    // Diagnostic counts are counts of emitted server log events, NOT packet-loss totals.
    // Server may itself sample successful VOICE_FRAME_ROUTE_RESULT traces.
    trackQuality(line, source, kind, historical, observedAtUtc) {
        if (historical) return;
        const publisherConnectionId = field(line, 'connectionId') || field(line, 'controlConnectionId');
        const sessionId = field(line, 'sessionId');
        const listenerConnectionId = field(line, 'listenerConnectionId');
        const reason = field(line, 'reason');
        if (/DEDICATED_SESSION_EVENT_RECEIVED/.test(line) && sessionId) {
            const count = Number(field(line, 'participantCount'));
            if (field(line, 'sessionClosed') === 'true') this.sessionParticipants.set(sessionId, 0);
            else if (Number.isInteger(count) && count >= 0) this.sessionParticipants.set(sessionId, count);
        }
        if (kind === 'CLIENT_FRAME_QUALITY') {
            // Only data explicitly reported by the mobile WebGL client is labeled playout loss.
            const id = publisherConnectionId || 'unknown';
            const windowNormal = Number(field(line, 'normal'));
            const windowMissing = Number(field(line, 'missing'));
            const windowFec = Number(field(line, 'fec'));
            const windowPlc = Number(field(line, 'plc'));
            const valid = [windowNormal, windowMissing, windowFec].every(n => Number.isSafeInteger(n) && n >= 0) && windowNormal + windowMissing > 0;
            const record = {
                metric: 'WEBGL_CLIENT_PLAYOUT', receivedAtUtc: observedAtUtc,
                clientAtUtc: field(line, 'atUtc') || null, source, connectionId: id,
                activeSessionCount: Number(field(line, 'sessions')) || 0,
                remoteStreams: Number(field(line, 'streams')) || 0,
                mediaBound: field(line, 'bound') === 'True',
                normalFrames: valid ? windowNormal : null,
                missingFrames: valid ? windowMissing : null,
                fecFrames: valid ? windowFec : null,
                plcFrames: Number.isSafeInteger(windowPlc) && windowPlc >= 0 ? windowPlc : null,
                frameGapPercent: valid ? Math.round(10000 * windowMissing / (windowNormal + windowMissing)) / 100 : null,
                playbackUnderflows: Number(field(line, 'underflows')) || 0,
                remoteLateDrops: Number(field(line, 'late')) || 0,
                remoteOverflowDrops: Number(field(line, 'overflow')) || 0,
                remoteDuplicateDrops: Number(field(line, 'duplicate')) || 0,
                remoteReorders: Number(field(line, 'reordered')) || 0,
                jitterMs: Number(field(line, 'jitterMs')) || 0,
                networkPacketLossMeasured: false
            };
            this.append('quality',record);
            const prev = this.clientQuality.get(id) || {samples:0, validSamples:0, maxFrameGapPercent:null, sumNormal:0, sumMissing:0};
            prev.samples++;
            if (valid) {
                prev.validSamples++; prev.sumNormal += windowNormal; prev.sumMissing += windowMissing;
                prev.maxFrameGapPercent = prev.maxFrameGapPercent === null ? record.frameGapPercent : Math.max(prev.maxFrameGapPercent, record.frameGapPercent);
            }
            prev.last = record;
            this.clientQuality.set(id,prev);
            return;
        }
        let metric = '';
        if (line.includes('VOICE_FRAME_ROUTE_RESULT')) metric = 'routeResultSampleLines';
        else if (line.includes('VOICE_FRAME_ROUTE_DROPPED')) metric = 'routeDroppedLogLines';
        else if (line.includes('VOICE_FRAME_LISTENER_DELIVERY_FAILED')) metric = 'listenerFailureDiagnosticLines';
        else if (line.includes('VOICE_FRAME_FLOW_GUARD_REJECTED')) metric = 'flowGuardRejectedLogLines';
        else if (line.includes('VME2_PHASE11_MEDIA_EDGE_UPSTREAM=CLOSED')) metric = 'edgeUpstreamClosedLines';
        else if (kind === 'AUTH_DENIED') metric = 'authorizationDeniedLogLines';
        if (!metric) return;
        const key = JSON.stringify([publisherConnectionId || 'unknown', sessionId || '', listenerConnectionId || '']);
        const add = (map) => {
            if (!map.has(key)) map.set(key, { publisherConnectionId:publisherConnectionId || null,
                sessionId:sessionId || null, listenerConnectionId:listenerConnectionId || null,
                routeResultSampleLines:0, routeSampleDeliveryAttempts:0, routeSampleDelivered:0,
                routeDroppedLogLines:0, listenerFailureDiagnosticLines:0,
                flowGuardRejectedLogLines:0, edgeUpstreamClosedLines:0, authorizationDeniedLogLines:0,
                missingMediaBindLogLines:0, listenerOfflineLogLines:0,
                maxObservedParticipants:null, reasons: {} });
            const r = map.get(key);
            r[metric]++;
            if (metric === 'routeResultSampleLines') {
                const attempts = Number(field(line,'deliveryAttempts'));
                const delivered = Number(field(line,'delivered'));
                if (Number.isSafeInteger(attempts) && Number.isSafeInteger(delivered) && attempts >= 0 && delivered >= 0 && delivered <= attempts) {
                    r.routeSampleDeliveryAttempts += attempts;
                    r.routeSampleDelivered += delivered;
                }
            }
            if (line.includes('Voice_media_plane_is_not_bound_for_the_listener')) r.missingMediaBindLogLines++;
            if (reason === 'listener_offline') r.listenerOfflineLogLines++;
            if (reason) r.reasons[reason] = (r.reasons[reason] || 0) + 1;
            const participants = this.sessionParticipants.get(sessionId);
            if (participants !== undefined) r.maxObservedParticipants = Math.max(r.maxObservedParticipants ?? 0,participants);
        };
        add(this.qualityBuckets);
        add(this.qualityTotals);
    }
    flushQualityWindow(atUtc) {
        for (const [sessionId,participantCount] of this.sessionParticipants.entries()) {
            this.append('quality',{metric:'SERVER_SESSION_MEMBERSHIP',atUtc,sessionId,participantCount});
        }
        for (const r of this.qualityBuckets.values()) {
            this.append('quality',{metric:'SERVER_ROUTE_OBSERVED_LOGS',atUtc,
                ...r, sampledDeliveryRatioPercent: r.routeSampleDeliveryAttempts > 0
                    ? Math.round(10000*r.routeSampleDelivered/r.routeSampleDeliveryAttempts)/100 : null,
                networkPacketLossMeasured:false});
        }
        this.qualityBuckets.clear();
    }
    onLine(line,source,historical) {
        if (!LINE_RE.test(line) && !source.endsWith(':error')) return;
        const kind = classify(line), now = new Date().toISOString();
        this.stats[kind] = (this.stats[kind] ?? 0) + 1;
        this.trackQuality(line,source,kind,historical,now);
        const alert = ALERT_KINDS.has(kind);
        const count = this.stats[kind];
        // Keep every failure; throttle only verbose successes.
        const keep = alert || !FRAME_RE.test(line) || count === 1 || count % 50 === 0;
        if (!keep) return;
        const row = { observedAtUtc: historical ? null : now, historical,
            source, kind, connectionId:field(line,'connectionId') || field(line,'controlConnectionId'),
            listenerConnectionId:field(line,'listenerConnectionId'),
            sessionId:field(line,'sessionId'), roomId:field(line,'roomId'),
            reason:field(line,'reason'), code:field(line,'code'),
            line:safeLine(line) };
        if (this.append('events',row)) this.events++;
        if (alert && !historical) {
            if (this.append('alerts',row)) this.alerts++;
            if (!this.firstFailure) this.firstFailure = { observedAtUtc:now, source, kind, connectionId:row.connectionId, reason:row.reason };
        }
    }
    collectResources() {
        const cpu = readLinuxCpu(), cpuCount = Math.max(1, os.cpus().length);
        let hostCpuBusyPercent=null, totalDelta=null;
        if (cpu && this.previousHostCpu) {
            totalDelta=cpu.total-this.previousHostCpu.total;
            const idleDelta=cpu.idle-this.previousHostCpu.idle;
            if (totalDelta > 0 && idleDelta >= 0) hostCpuBusyPercent=roundPercent(100*(totalDelta-idleDelta)/totalDelta);
        }
        this.previousHostCpu=cpu;
        const nextProcessCpu=new Map();
        const tracked=[...this.lastProcesses,{name:'vme2-live-voice-trace (observer)',pid:process.pid}];
        const processes=tracked.map(p => {
            const actual=readLinuxProcess(p.pid);
            const previous=this.previousProcessCpu.get(p.pid);
            let cpuPercentOneCore=null;
            if (actual) {
                if (previous && previous.startTime === actual.startTime && totalDelta > 0) {
                    const ticks=actual.cpuTicks-previous.cpuTicks;
                    if (ticks >= 0) cpuPercentOneCore=roundPercent(100*cpuCount*ticks/totalDelta);
                }
                nextProcessCpu.set(p.pid,actual);
            }
            return {name:p.name,pid:p.pid,cpuPercentOneCore,rssBytes:actual?.rssBytes ?? null,
                pm2CpuPercent:p.pm2CpuPercent ?? null,pm2MemoryBytes:p.pm2MemoryBytes ?? null};
        });
        this.previousProcessCpu=nextProcessCpu;
        const networks=readLinuxNetwork().map(n => {
            const prev=this.previousNetwork.get(n.interface);
            const deltas={};
            for (const key of ['rxErrors','rxDrops','txErrors','txDrops']) {
                const delta=prev ? n[key]-prev[key] : null;
                deltas[key+'Delta']=delta === null || delta < 0 ? null : delta;
            }
            return {...n,...deltas};
        });
        this.previousNetwork=new Map(networks.map(n=>[n.interface,n]));
        const loadAvg=os.loadavg();
        const resources={ cpuCount,hostCpuBusyPercent,
            loadAverage1m:roundPercent(loadAvg[0]),loadAverage5m:roundPercent(loadAvg[1]),
            loadPerCore1m:roundPercent(loadAvg[0]/cpuCount),
            memory:readLinuxMemory(),processes,network:networks,
            interpretation:'CPU is host-wide / process CPU is percent of ONE logical core; counters do not prove audio latency or WebGL packet loss.'};
        this.lastResourceSample=resources;
        return resources;
    }
    async snapshot() {
        const status = this.lastProcesses.map(({name,pid,status,restarts,uptimeMs}) => ({name,pid,status,restarts,uptimeMs}));
        const health = this.options.noHealth ? [] : await Promise.all([51003,51101,51201].map(p => healthCheck(p)));
        if (this.stopped) return;
        const snapshotUtc = new Date().toISOString();
        this.flushQualityWindow(snapshotUtc);
        const row = {observedAtUtc:snapshotUtc, processStatus:status, health,
            resources:this.collectResources(),
            sources:this.followers.size, events:this.events, alerts:this.alerts, counts:{...this.stats}, firstFailure:this.firstFailure};
        this.append('samples',row); this.writeSummary(false);
        this.lastSnapshotAt = Date.now();
        process.stdout.write(`VME2_TRACE_SAMPLE | utc=${row.observedAtUtc} | sources=${row.sources} | alerts=${row.alerts} | totalEvents=${row.events}\n`);
    }
    writeSummary(ended) {
        const output = {version:VERSION, startedAtUtc:this.startedAt, lastObservedAtUtc:new Date().toISOString(), ended,
            firstNewFailure:this.firstFailure, counts:{...this.stats}, retainedEvents:this.events, retainedAlerts:this.alerts,
            sources:[...this.followers.values()].map(f => ({label:f.label, path:f.filename})),
            processStatus:this.lastProcesses.map(({name,pid,status,restarts}) => ({name,pid,status,restarts})),
            failure:this.failure, bytes:this.totalBytes, latestResourceSample:this.lastResourceSample,
            observedRoutingLogTotals:[...this.qualityTotals.values()].map(v => ({...v,
                sampledDeliveryRatioPercent:v.routeSampleDeliveryAttempts > 0 ? Math.round(10000*v.routeSampleDelivered/v.routeSampleDeliveryAttempts)/100 : null})),
            observedSessionParticipants:[...this.sessionParticipants.entries()].map(([sessionId,participantCount]) => ({sessionId,participantCount})),
            clientPlayoutQuality:[...this.clientQuality.entries()].map(([connectionId,v]) => ({connectionId,...v,
                overallObservedFrameGapPercent:v.sumNormal+v.sumMissing > 0 ? Math.round(10000*v.sumMissing/(v.sumNormal+v.sumMissing))/100 : null})),
            limitations:[
                'Server logs and configured client log files only; no internal state not exposed by existing logs.',
                'Historical startup tail has no reliable event time; observedAtUtc is null.',
                'Event counts are emitted log lines, not total media packets.',
                'Server route success logs are sampled by the server itself: sampledDeliveryRatioPercent is NOT real packet loss.',
                'WEBGL_CLIENT_PLAYOUT measures receiver-side missing frames, NOT proven network packet loss.',
                'Two simultaneous incoming streams are aggregated in existing WebGL browser pipeline stats.',
                'Client metrics appear only if a client log containing VME2_WEBGL_FRAME_QUALITY is supplied to --client-log.',
                'High-frequency success frame lines are sampled 1/50; every recognized failure is retained.',
                'Health 51003/51101/51201 endpoints are taken from the existing server collector; unavailable results are not treated as root causes.',
                'OS resource metrics are sampled every snapshot; first CPU delta is null; process CPU percent is relative to ONE logical CPU core and can exceed 100.',
                 'Host CPU, memory, OS interface drops, and process RSS do not prove media packet loss or audio decoder underflow.',
                 'Use the recorder before reproducing the failure to capture the first new event.'
            ]};
        const file = path.join(this.outDir,'summary.json');
        fs.writeFileSync(file,JSON.stringify(output,null,2)+'\n',{mode:0o600});
    }
    async tick() {
        if (this.stopped) return;
        if (Date.now() - this.lastDiscoverAt >= 15000) this.discover();
        for (const tail of this.followers.values()) tail.consume((line,src) => this.onLine(line,src,false));
        if (Date.now() - this.lastSnapshotAt >= this.options.snapshotSec * 1000) await this.snapshot();
    }
    finish() {
        if (this.stopped) return;
        this.stopped = true;
        try { for (const tail of this.followers.values()) tail.consume((line,src) => this.onLine(line,src,false)); }
        catch(e) { this.failure = `FINAL_POLL_ERROR:${e.code ?? e.message}`; }
        this.flushQualityWindow(new Date().toISOString());
        this.writeSummary(true);
        const zipPath = `${this.outDir}.zip`;
        const names = ['summary.json','events.ndjson','alerts.ndjson','samples.ndjson','quality.ndjson'];
        const zip = spawnSync('zip',['-q','-j',zipPath,...names.map(n => path.join(this.outDir,n))],{timeout:30000,encoding:'utf8'});
        if (zip.error || zip.status !== 0) process.stderr.write(`VME2_TRACE_ZIP_FAILED=${safeLine(zip.error?.message ?? zip.stderr ?? String(zip.status))}\n`);
        else { fs.chmodSync(zipPath,0o600); process.stdout.write(`VME2_TRACE_ZIP=${zipPath}\n`); }
        process.stdout.write(`VME2_TRACE_DIR=${this.outDir}\nVME2_TRACE_ALERTS=${this.alerts}\n`);
    }
}
async function main(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    if (args.help) {
        process.stdout.write('Usage: node vme2-live-voice-trace.cjs [--duration-sec 1800] [--poll-ms 1000] [--snapshot-sec 10] [--max-mb 100] [--client-log PATH] [--log-dir PATH] [--out-dir PATH] [--no-pm2] [--no-health]\n'); return;
    }
    process.umask(0o077);
    const recorder = new Recorder(args);
    recorder.discover();
    if (recorder.followers.size === 0) {
        recorder.failure = 'NO_READABLE_LOG_FILES'; recorder.writeSummary(true);
        process.stderr.write('VME2_TRACE_STOP=NO_READABLE_LOG_FILES\n'); process.exitCode = 2; return;
    }
    process.stdout.write(`VME2_TRACE_READY=TRUE | sources=${recorder.followers.size} | durationSec=${args.durationSec} | dir=${recorder.outDir}\n`);
    let busy = false;
    const poll = async () => {
        if (busy || recorder.stopped) return;
        busy = true;
        try { await recorder.tick(); }
        catch(e) { recorder.failure = `POLL_ERROR:${e.code ?? e.message}`; process.stderr.write(`VME2_TRACE_POLL_WARNING=${safeLine(e.message)}\n`); }
        finally { busy = false; }
        if (recorder.pendingStop) stop();
    };
    const timer = setInterval(() => { void poll(); },args.pollMs);
    const expiry = setTimeout(() => stop(),args.durationSec * 1000);
    function stop() { clearInterval(timer); clearTimeout(expiry); recorder.finish(); }
    process.once('SIGINT',stop); process.once('SIGTERM',stop);
    await poll();
}
if (require.main === module) main().catch(e => {process.stderr.write(`VME2_TRACE_FATAL=${safeLine(e.stack ?? e.message)}\n`); process.exitCode = 1;});
module.exports = { safeLine,field,classify,parseArgs,LogFollower,Recorder,pm2Snapshot,healthCheck };
