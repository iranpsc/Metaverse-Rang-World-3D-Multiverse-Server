import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createTelemetryHandler,createFileSink,parseSample,QUALITY_PATH} from './vme2-frame-quality-telemetry-core.mjs';

const ids=[
 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
 'bbbbbbbb-aaaa-4ccc-8ddd-eeeeeeeeeeee',
 'cccccccc-aaaa-4ccc-8ddd-eeeeeeeeeeee'];
function sample(connectionId,normal=30,missing=70){return {
 type:'sample',connectionId,clientAtUtc:'2026-10-17T10:00:00.000Z',state:'OBSERVED',sessions:2,streams:2,bound:true,
 hasDelta:true,normal,missing,fec:1,plc:1,late:0,duplicate:0,overflow:0,reordered:0,
 underflows:4,captureDrops:0,encoded:20,decoded:20,statsUpdates:3,jitterMs:8.2,bufferFrames:10,targetDelayMs:100,statsAgeSec:0.4
};}
async function withServer(callback,{clock={value:100_000},emit=null,ticketTtlMs=60_000}={}){
 const lines=[];
 const telemetry=createTelemetryHandler({verifyAccessToken:token=>{
  if(token==='good-1')return {sub:'real-user-1'};
  if(token==='good-2')return {sub:'real-user-2'};
  throw Error('jwt failed');
 },emit:emit || (line=>lines.push(line)),now:()=>clock.value,ticketTtlMs});
 const server=http.createServer(telemetry.handler);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();
 const request=(body,headers={},url=QUALITY_PATH,method='POST')=>new Promise((resolve,reject)=>{
  const json=JSON.stringify(body);
  const req=http.request({hostname:'127.0.0.1',port:address.port,path:url,method,headers:{'Content-Type':'application/json',...headers}},res=>{
   let payload='';res.on('data',d=>payload+=d);res.on('end',()=>resolve({code:res.statusCode,json:payload?JSON.parse(payload):null}));
  });req.on('error',reject);req.end(method==='POST'?json:undefined);
 });
 try{return await callback({request,lines,clock,telemetry});}
 finally{await new Promise(resolve=>server.close(resolve));}
}
function init(request,id=ids[0],token='good-1') {return request({type:'init',connectionId:id},{Authorization:'Bearer '+token});}
function send(request,id,ticket,sampleData=sample(id)) {return request(sampleData,{'X-VME2-Telemetry-Ticket':ticket});}

test('validated sample accepts all real Unity counters',()=>{
 assert.equal(parseSample(sample(ids[0])).connectionId,ids[0]);
 assert.equal(parseSample({...sample(ids[0]),normal:-1}),null);
 assert.equal(parseSample({...sample(ids[0]),jitterMs:'NaN'}),null);
 assert.equal(parseSample({...sample(ids[0]),state:'FAKE'}),null);
 assert.equal(parseSample({...sample(ids[0]),clientAtUtc:'forged | accessToken=secret'}),null);
});
test('unauthorized requests and oversized payloads are rejected',()=>withServer(async({request})=>{
 assert.equal((await init(request,ids[0],'bad-jwt')).code,401);
 assert.equal((await request({type:'init',connectionId:ids[0]})).code,401);
 assert.equal((await request({type:'init',connectionId:'not-guid'},{Authorization:'Bearer good-1'})).code,400);
 assert.equal((await request(sample(ids[0]),{'X-VME2-Telemetry-Ticket':'bad'})).code,401);
 assert.equal((await request({...sample(ids[0]),oversize:'x'.repeat(5000)})).code,413);
 assert.equal((await request(sample(ids[0]),{},QUALITY_PATH,'GET')).code,405);
}));
test('three phones have independent tickets and values; no secrets logged',()=>withServer(async({request,lines})=>{
 const tokens=[];
 for(let i=0;i<3;i++){
  const res=await init(request,ids[i],i===2?'good-2':'good-1');
  assert.equal(res.code,200,res.json?.reason);tokens.push(res.json.ticket);
 }
 for(let i=0;i<3;i++)assert.equal((await send(request,ids[i],tokens[i],sample(ids[i],i===0?30:99,i===0?70:1))).code,204);
 assert.equal(lines.length,3);
 assert.ok(lines[0].includes('connectionId='+ids[0]));
 assert.ok(lines[0].includes('missing=70'));
 assert.ok(lines[1].includes('missing=1'));
 assert.ok(lines[2].includes('userTag='));
 assert.ok(lines.every(l=>l.includes('ownership=client_reported_not_registry_verified')));
 assert.ok(lines.every(l=>!l.includes('good-')&&!l.includes(tokens[0])));
 assert.equal((await send(request,ids[1],tokens[0])).code,403);
}));
test('one ticket cannot be used faster than 8 seconds or after expiry',()=>withServer(async({request,clock})=>{
 const ticket=(await init(request)).json.ticket;
 assert.equal((await send(request,ids[0],ticket)).code,204);
 clock.value+=1000;
 assert.equal((await send(request,ids[0],ticket)).code,429);
 clock.value+=8000;
 assert.equal((await send(request,ids[0],ticket)).code,204);
 clock.value+=60_000;
 assert.equal((await send(request,ids[0],ticket)).code,401);
}));
test('ticket is replaced when same authenticated subject initializes same connection',()=>withServer(async({request})=>{
 const first=(await init(request)).json.ticket;
 const second=(await init(request)).json.ticket;
 assert.notEqual(first,second);
 assert.equal((await send(request,ids[0],first)).code,401);
 assert.equal((await send(request,ids[0],second)).code,204);
}));
test('write failure does not acknowledge sample',()=>withServer(async({request})=>{
 const ticket=(await init(request)).json.ticket;
 assert.equal((await send(request,ids[0],ticket)).code,503);
},{emit:()=>{throw Error('disk_full');}}));
test('local file log is private and accepts sample records',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vme2-sidecar-log-'));
 try{
  const logfile=path.join(tmp,'trace','ingest.log');
  const write=createFileSink(logfile,300);
  write('VME2_WEBGL_FRAME_QUALITY | connectionId=x\n');
  assert.equal(fs.statSync(logfile).mode & 0o777,0o600);
  assert.equal(fs.statSync(path.dirname(logfile)).mode & 0o777,0o700);
  for(let i=0;i<12;i++)write('VME2_WEBGL_FRAME_QUALITY | connectionId=x\n');
  assert.ok(fs.existsSync(logfile+'.1'));
  assert.ok(fs.readFileSync(logfile,'utf8').includes('VME2_WEBGL_FRAME_QUALITY'));
 } finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
test('existing 2026-10-17 recorder ingests sidecar log into quality.ndjson with separate phone IDs',()=>{
 const recorderPath=process.env.VME2_EXISTING_TRACE_PATH;
 if(!recorderPath){return;}
 const {Recorder}=createRequire(import.meta.url)(recorderPath);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'vme2-bridge-test-'));
 try{
  const rec=new Recorder({outDir:path.join(temp,'rec'),maxMb:5});
  for(const [id,n,m] of [[ids[0],30,70],[ids[1],99,1]]){
   const s=sample(id,n,m);
   const line=['VME2_WEBGL_FRAME_QUALITY','atUtc=2026-10-17T10:00:00.000Z','connectionId='+id,
     'sessions=2','streams=2','bound=True','hasDelta=True','state=OBSERVED',
     'normal='+s.normal,'missing='+s.missing,'fec='+s.fec,'plc='+s.plc,
     'jitterMs=8.2','underflows=4'].join(' | ');
   rec.onLine(line,'CLIENT_LOG',false);
  }
  rec.writeSummary(true);
  const quality=fs.readFileSync(path.join(rec.outDir,'quality.ndjson'),'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(quality.map(x=>x.frameGapPercent),[70,1]);
  assert.deepEqual(quality.map(x=>x.connectionId),[ids[0],ids[1]]);
 } finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('actual HTTP report is recorded by existing VME2 quality parser', async()=>{
 const recorderPath=process.env.VME2_EXISTING_TRACE_PATH;
 if(!recorderPath)return;
 const {Recorder}=createRequire(import.meta.url)(recorderPath);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'vme2-full-uplink-'));
 try {
  const output=path.join(temp,'private','ingest.log');
  const write=createFileSink(output);
  await withServer(async({request})=>{
   const grant=(await init(request)).json;
   assert.equal((await send(request,ids[0],grant.ticket)).code,204);
  },{emit:write});
  const lines=fs.readFileSync(output,'utf8').trim().split('\n');
  assert.equal(lines.length,1);
  const rec=new Recorder({outDir:path.join(temp,'trace'),maxMb:5});
  rec.onLine(lines[0],'CLIENT_LOG',false);
  const parsed=fs.readFileSync(path.join(rec.outDir,'quality.ndjson'),'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(parsed[0].metric,'WEBGL_CLIENT_PLAYOUT');
  assert.equal(parsed[0].frameGapPercent,70);
  assert.equal(parsed[0].networkPacketLossMeasured,false);
  assert.equal(parsed[0].connectionId,ids[0]);
 } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
