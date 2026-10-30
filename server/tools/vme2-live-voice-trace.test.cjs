'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync,spawn } = require('node:child_process');
const {safeLine,classify,parseArgs,LogFollower,Recorder} = require('./vme2-live-voice-trace.cjs');

test('redacts authentication secrets and keeps identifiers', () => {
    const s = safeLine('connectionId=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee | accessToken=abc123 | refresh_token=xyz | authorization=Bearer_token');
    assert.match(s,/connectionId=aaaaaaaa-bbbb/);
    assert.doesNotMatch(s,/abc123|xyz|Bearer_token/);
    assert.doesNotMatch(safeLine('{"accessToken":"private_value","connectionId":"one"}'),/private_value/);
});
test('classifies observed server faults', () => {
    assert.equal(classify('VME2_PHASE11_MEDIA_EDGE_AUTH_DIAG=DENIED | code=ACCESS_TOKEN_EXPIRED'),'AUTH_DENIED');
    assert.equal(classify('VOICE_FRAME_LISTENER_DELIVERY_FAILED | reason=listener_offline'),'LISTENER_DELIVERY_FAILED');
    assert.equal(classify('VOICE_FRAME_ROUTE_RESULT | deliveryAttempts=2 | delivered=1'),'FRAME_ROUTE_PARTIAL');
    assert.equal(classify('VOICE_FRAME_ROUTE_RESULT | deliveryAttempts=2 | delivered=2'),'FRAME_ROUTE_RESULT');
});
test('arguments validate supported runtime', () => {
    assert.equal(parseArgs(['--duration-sec','1200']).durationSec,1200);
    assert.throws(() => parseArgs(['--duration-sec','-1']),/durationSec/);
});
test('tail retains new lines and survives truncation', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(),'vme2-follow-'));
    try {
        const file = path.join(temp,'one.log'); fs.writeFileSync(file,'historical\n');
        const tail = new LogFollower(file,'mock'); const seen=[];
        tail.consume(v => seen.push(v),true);
        fs.appendFileSync(file,'newone\nnewtwo\n');tail.consume(v => seen.push(v),false);
        fs.writeFileSync(file,'reset\n');tail.consume(v => seen.push(v),false);
        assert.deepEqual(seen,['historical','newone','newtwo','reset']);
    } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
test('live standalone fixture creates summary and ZIP without PM2', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'vme2-live-test-'));
    try {
        const logs = path.join(tmp,'logs'); const out=path.join(tmp,'capture');fs.mkdirSync(logs);
        fs.writeFileSync(path.join(logs,'metaverse-server-out.log'),'VME2_PHASE11_MEDIA_EDGE_AUTH_DIAG=DENIED | connectionId=abcd | code=ACCESS_TOKEN_EXPIRED\n');
        const child = spawnSync(process.execPath,[path.join(__dirname,'vme2-live-voice-trace.cjs'),'--duration-sec','2','--poll-ms','250','--snapshot-sec','2','--log-dir',logs,'--out-dir',out,'--no-pm2','--no-health'],{encoding:'utf8',timeout:15000});
        assert.equal(child.status,0,child.stderr);
        const summary=JSON.parse(fs.readFileSync(path.join(out,'summary.json'),'utf8'));
        assert.equal(summary.ended,true); assert.ok(summary.sources.length===1);assert.ok(fs.existsSync(`${out}.zip`));
    } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});

test('new failure during capture is never discarded by historical snapshot', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'vme2-live-event-'));
    try {
        const logs = path.join(tmp,'logs'); const out=path.join(tmp,'capture');fs.mkdirSync(logs);
        const logfile=path.join(logs,'metaverse-voice-media-edge-out.log');
        fs.writeFileSync(logfile,'VOICE_FRAME_ROUTE_RESULT | deliveryAttempts=1 | delivered=1\n');
        const child=spawn(process.execPath,[path.join(__dirname,'vme2-live-voice-trace.cjs'),'--duration-sec','3','--poll-ms','250','--snapshot-sec','2','--log-dir',logs,'--out-dir',out,'--no-pm2','--no-health'],{stdio:'ignore'});
        await new Promise(resolve => setTimeout(resolve,850));
        fs.appendFileSync(logfile,'VME2_PHASE11_MEDIA_EDGE_AUTH_DIAG=DENIED | connectionId=testconn | code=ACCESS_TOKEN_EXPIRED\n');
        await new Promise((resolve,reject) => {
            child.on('error',reject);
            child.on('exit',code => code===0 ? resolve() : reject(Error('exit code '+code)));
        });
        const summary=JSON.parse(fs.readFileSync(path.join(out,'summary.json'),'utf8'));
        assert.equal(summary.firstNewFailure?.kind,'AUTH_DENIED');
        const alerts=fs.readFileSync(path.join(out,'alerts.ndjson'),'utf8').trim().split('\n').map(JSON.parse);
        assert.ok(alerts.some(a=>a.connectionId==='testconn'));
    } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});

test('quality extension distinguishes sampled server routing from real WebGL playout gap', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'vme2-quality-'));
    try {
        const recorder = new Recorder({outDir:path.join(tmp,'capture'),maxMb:5});
        recorder.onLine('[G4_VOICE_TRACE] DEDICATED_SESSION_EVENT_RECEIVED | eventType=member_joined | sessionId=s1 | participantCount=3', 'metaverse-server:out', false);
        recorder.onLine('[G4_VOICE_TRACE] VOICE_FRAME_ROUTE_RESULT | connectionId=p1 | sessionId=s1 | deliveryAttempts=2 | delivered=1', 'metaverse-server:out', false);
        recorder.onLine('[G4_VOICE_TRACE] VOICE_FRAME_ROUTE_DROPPED | connectionId=p1 | sequence=100 | reason=listener_backpressure | error=Voice_media_plane_is_not_bound_for_the_listener.', 'metaverse-server:out', false);
        recorder.onLine('VME2_WEBGL_FRAME_QUALITY | atUtc=2026-10-17T00:10:00.000Z | connectionId=p1 | sessions=2 | streams=2 | bound=True | normal=30 | missing=70 | fec=4 | plc=60 | jitterMs=8.25 | late=3 | overflow=2 | duplicate=1 | reordered=0 | underflows=2', 'CLIENT_LOG', false);
        recorder.flushQualityWindow(new Date().toISOString());
        recorder.writeSummary(true);
        const quality=fs.readFileSync(path.join(recorder.outDir,'quality.ndjson'),'utf8').trim().split('\n').map(JSON.parse);
        const server=quality.find(q=>q.metric==='SERVER_ROUTE_OBSERVED_LOGS');
        const client=quality.find(q=>q.metric==='WEBGL_CLIENT_PLAYOUT');
        assert.equal(server.routeSampleDeliveryAttempts,2);
        assert.ok(quality.some(q=>q.metric==='SERVER_SESSION_MEMBERSHIP' && q.sessionId==='s1' && q.participantCount===3));
        assert.equal(server.sampledDeliveryRatioPercent,50);
        const unbound=quality.find(q=>q.metric==='SERVER_ROUTE_OBSERVED_LOGS' && q.missingMediaBindLogLines===1);
        assert.ok(unbound);
        assert.equal(unbound.listenerConnectionId,null);
        assert.equal(server.networkPacketLossMeasured,false);
        assert.equal(client.frameGapPercent,70);
        assert.equal(client.remoteStreams,2);
        assert.equal(client.networkPacketLossMeasured,false);
        const summary=JSON.parse(fs.readFileSync(path.join(recorder.outDir,'summary.json'),'utf8'));
        assert.equal(summary.clientPlayoutQuality[0].maxFrameGapPercent,70);
        assert.equal(summary.clientPlayoutQuality[0].overallObservedFrameGapPercent,70);
    } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});

test('offline Chrome log merge adds actual receiver frame gaps to same trace ZIP', () => {
    const {parseClientLog,summariseClient,merge}=require('./vme2-merge-webgl-frame-quality.cjs');
    const line='ff.framework.js.br:9 VME2_WEBGL_FRAME_QUALITY | atUtc=2026-10-16T21:00:00.000Z | connectionId=phone-1 | sessions=2 | streams=2 | bound=True | state=OBSERVED | normal=25 | missing=75 | fec=2 | plc=72 | jitterMs=11.50 | underflows=8';
    const records=parseClientLog(line,'chrome-test.log');
    assert.equal(records.length,1);
    assert.equal(records[0].frameGapPercent,75);
    assert.equal(summariseClient(records)[0].overallObservedFrameGapPercent,75);
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vme2-merge-test-'));
    try {
        const trace=path.join(tmp,'trace.zip');
        const summary=path.join(tmp,'summary.json');
        fs.writeFileSync(summary,'{"version":"fixture","counts":{}}');
        const fixtureFiles=['events.ndjson','alerts.ndjson','samples.ndjson'];
        for (const name of fixtureFiles) fs.writeFileSync(path.join(tmp,name),'');
        let r=spawnSync('zip',['-q','-j',trace,summary,...fixtureFiles.map(name=>path.join(tmp,name))],{encoding:'utf8'});
        assert.equal(r.status,0,r.stderr);
        const client=path.join(tmp,'chrome-test.log');fs.writeFileSync(client,line+'\n');
        const merged=merge(trace,[client]);
        assert.equal(merged.clientMetricSamples,1);
        assert.ok(fs.existsSync(merged.output));
        const mergedSummary=JSON.parse(require('node:child_process').execFileSync('unzip',['-p',merged.output,'summary.json'],{encoding:'utf8'}));
        assert.equal(mergedSummary.clientPlayoutQuality[0].maxFrameGapPercent,75);
    }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});


test('resource sampler adds real Linux process and system counters without writing into services', () => {
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vme2-resources-'));
    try {
        const recorder=new Recorder({outDir:path.join(tmp,'capture'),maxMb:5,noPm2:true,noHealth:true});
        recorder.lastProcesses=[{name:'metaverse-server',pid:process.pid,status:'online',restarts:0}];
        const a=recorder.collectResources();
        assert.ok(a.cpuCount>=1);
        if (process.platform==='linux') {
            assert.ok(a.memory.totalBytes>0);
            assert.ok(a.processes[0].rssBytes>0);
            assert.equal(a.hostCpuBusyPercent,null);
        }
        const b=recorder.collectResources();
        assert.equal(typeof b.processes[0].name,'string');
        recorder.writeSummary(true);
        const summary=JSON.parse(fs.readFileSync(path.join(tmp,'capture','summary.json'),'utf8'));
        assert.ok(summary.latestResourceSample);
    } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});
