#!/usr/bin/env node
'use strict';

// Offline merge of a server trace ZIP and Chrome WebGL debug logs. No service access.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');
const { field } = require('./vme2-live-voice-trace.cjs');

const SOURCES = ['events.ndjson','alerts.ndjson','samples.ndjson','quality.ndjson'];
function extractKnown(zip, name) {
    try {
        return execFileSync('unzip',['-p',zip,name],{timeout:60000,maxBuffer:140*1024*1024,encoding:'utf8',stdio:['ignore','pipe','pipe']});
    } catch (error) {
        if (name === 'quality.ndjson') return '';
        throw Error(`ZIP_FILE_MISSING_OR_UNREADABLE:${name}:${error.message}`);
    }
}
function parseClientLog(text, filename) {
    const rows=[];
    for (const line of text.split(/\r?\n/)) {
        const start=line.indexOf('VME2_WEBGL_FRAME_QUALITY | ');
        if (start < 0) continue;
        const record=line.slice(start);
        const normal=Number(field(record,'normal'));
        const missing=Number(field(record,'missing'));
        const fec=Number(field(record,'fec'));
        const plc=Number(field(record,'plc'));
        const valid=field(record,'state')==='OBSERVED' &&
            [normal,missing,fec].every(v=>Number.isSafeInteger(v)&&v>=0) && normal+missing>0;
        const clientAtUtc=field(record,'atUtc');
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(clientAtUtc)) continue;
        rows.push({metric:'WEBGL_CLIENT_PLAYOUT',source:path.basename(filename),clientAtUtc,
            connectionId:field(record,'connectionId')||'unknown',
            activeSessionCount:Number(field(record,'sessions'))||0,
            remoteStreams:Number(field(record,'streams'))||0,
            mediaBound:field(record,'bound')==='True',state:field(record,'state'),
            normalFrames:valid?normal:null,missingFrames:valid?missing:null,fecFrames:valid?fec:null,
            plcFrames:Number.isSafeInteger(plc)&&plc>=0?plc:null,
            frameGapPercent:valid?Math.round(10000*missing/(normal+missing))/100:null,
            playbackUnderflows:Number(field(record,'underflows'))||0,
            remoteLateDrops:Number(field(record,'late'))||0,
            remoteOverflowDrops:Number(field(record,'overflow'))||0,
            remoteDuplicateDrops:Number(field(record,'duplicate'))||0,
            remoteReorders:Number(field(record,'reordered'))||0,
            jitterMs:Number(field(record,'jitterMs'))||0,
            statsUpdates:Number(field(record,'statsUpdates'))||0,
            networkPacketLossMeasured:false});
    }
    return rows;
}
function summariseClient(records) {
    const by=new Map();
    for (const r of records) {
        let s=by.get(r.connectionId);
        if (!s) { s={connectionId:r.connectionId,samples:0,validSamples:0,normalFrames:0,missingFrames:0,maxFrameGapPercent:null,firstAtUtc:null,lastAtUtc:null};by.set(r.connectionId,s); }
        s.samples++;
        s.firstAtUtc=s.firstAtUtc===null||r.clientAtUtc<s.firstAtUtc?r.clientAtUtc:s.firstAtUtc;
        s.lastAtUtc=s.lastAtUtc===null||r.clientAtUtc>s.lastAtUtc?r.clientAtUtc:s.lastAtUtc;
        if (r.frameGapPercent!==null) {
            s.validSamples++;s.normalFrames+=r.normalFrames;s.missingFrames+=r.missingFrames;
            s.maxFrameGapPercent=Math.max(s.maxFrameGapPercent??0,r.frameGapPercent);
        }
    }
    return [...by.values()].map(s=>({...s,overallObservedFrameGapPercent:s.normalFrames+s.missingFrames>0?
        Math.round(10000*s.missingFrames/(s.normalFrames+s.missingFrames))/100:null}));
}
function merge(traceZip,clientPaths) {
    if (clientPaths.length<1) throw Error('at_least_one_webgl_chrome_log_required');
    const raw=fs.readFileSync(traceZip);
    if (raw.length===0) throw Error('empty_trace_zip');
    const summary=JSON.parse(extractKnown(traceZip,'summary.json'));
    const temp=fs.mkdtempSync(path.join(os.tmpdir(),'vme2-merge-'));
    const out=path.join(path.dirname(traceZip),path.basename(traceZip,'.zip')+'-WITH-WEBGL-QUALITY.zip');
    if (fs.existsSync(out)) throw Error(`output_exists:${out}`);
    try {
        fs.writeFileSync(path.join(temp,'summary.json'),'');
        for (const name of SOURCES) fs.writeFileSync(path.join(temp,name),extractKnown(traceZip,name));
        const qualityPath=path.join(temp,'quality.ndjson');
        const added=[];
        for (const file of clientPaths) added.push(...parseClientLog(fs.readFileSync(file,'utf8'),file));
        if (added.length>0) fs.appendFileSync(qualityPath,added.map(r=>JSON.stringify(r)).join('\n')+'\n');
        summary.clientPlayoutQuality=added.length>0 ? summariseClient(added) : (summary.clientPlayoutQuality||[]);
        summary.qualityMerge={mergedAtUtc:new Date().toISOString(),chromeFiles:clientPaths.map(x=>path.basename(x)),clientMetricSamples:added.length,
            warning:added.length===0?'NO_VME2_WEBGL_FRAME_QUALITY_LINES_IN_CLIENT_LOGS; WebGL must run the new diagnostic build first.':null,
            definition:'Frame gap is receiver-side Normal/Missing playout ratio; NOT measured network packet loss.'};
        fs.writeFileSync(path.join(temp,'summary.json'),JSON.stringify(summary,null,2)+'\n');
        const names=['summary.json',...SOURCES];
        const result=spawnSync('zip',['-q','-j',out,...names.map(n=>path.join(temp,n))],{timeout:60000,encoding:'utf8'});
        if(result.status!==0||result.error) throw Error(`zip_failed:${result.error?.message??result.stderr??result.status}`);
        fs.chmodSync(out,0o600);
        return {output:out,clientMetricSamples:added.length,connections:summary.clientPlayoutQuality.length};
    } finally {fs.rmSync(temp,{recursive:true,force:true});}
}
if(require.main===module) {
    try {
        if(process.argv.length<4) throw Error('Usage: node vme2-merge-webgl-frame-quality.cjs TRACE.zip CHROME1.log [CHROME2.log ...]');
        const result=merge(path.resolve(process.argv[2]),process.argv.slice(3).map(p=>path.resolve(p)));
        process.stdout.write(`VME2_QUALITY_MERGED_ZIP=${result.output}\nVME2_CLIENT_QUALITY_SAMPLES=${result.clientMetricSamples}\nVME2_CLIENT_CONNECTIONS=${result.connections}\n`);
    }catch(e){process.stderr.write(`VME2_QUALITY_MERGE_ERROR=${e.message}\n`);process.exitCode=1;}
}
module.exports={parseClientLog,summariseClient,merge};
