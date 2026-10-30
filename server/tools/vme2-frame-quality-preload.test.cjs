'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const cp = require('node:child_process');
process.env.VME2_FRAME_QUALITY_NO_AUTO_INSTALL = '1';
const {wrapRequestListener,QUALITY_PATH,install} = require('./vme2-frame-quality-preload.cjs');

function fetch(port,p,opts={}) {
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port,path:p,method:opts.method||'GET',headers:opts.headers||{}},res=>{
      let b='';res.on('data',d=>b+=d);res.on('end',()=>resolve({code:res.statusCode,text:b}));
    });req.on('error',reject);req.end(opts.body);
  });
}

const IDs=['aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee','bbbbbbbb-aaaa-4ccc-8ddd-eeeeeeeeeeee'];
function sample(id,n=30,m=70){return {
 type:'sample',connectionId:id,clientAtUtc:'2026-10-17T10:00:00.000Z',state:'OBSERVED',sessions:2,streams:2,bound:true,
 hasDelta:true,normal:n,missing:m,fec:1,plc:1,late:0,duplicate:0,overflow:0,reordered:0,
 underflows:4,captureDrops:0,encoded:20,decoded:20,statsUpdates:3,jitterMs:8.2,bufferFrames:10,targetDelayMs:100,statsAgeSec:0.4
};}

test('intercepts only exact telemetry path and preserves context and game HTTP', async()=>{
  let visited=[];
  const original=function(req,res){visited.push(req.url);res.writeHead(201);res.end('original:'+req.url);};
  const telemetry=async(req,res)=>{res.writeHead(204);res.end();};
  const server=http.createServer(wrapRequestListener(original,()=>telemetry));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
    const port=server.address().port;
    assert.equal((await fetch(port,'/voice/health')).text,'original:/voice/health');
    assert.equal((await fetch(port,'/ws')).text,'original:/ws');
    assert.equal((await fetch(port,'/game-server-control/test')).text,'original:/game-server-control/test');
    assert.equal((await fetch(port,QUALITY_PATH)).code,204);
    assert.deepEqual(visited,['/voice/health','/ws','/game-server-control/test']);
  }finally{await new Promise(r=>server.close(r));}
});

test('telemetry handler failure returns 503 without invoking game handler',async()=>{
 let count=0;
 const server=http.createServer(wrapRequestListener((req,res)=>{count++;res.end('normal');},()=>Promise.reject(Error('expected'))));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{assert.equal((await fetch(server.address().port,QUALITY_PATH)).code,503);assert.equal(count,0);
  assert.equal((await fetch(server.address().port,'/health')).text,'normal');assert.equal(count,1);
 }finally{await new Promise(r=>server.close(r));}
});

test('preloaded HTTP wrapper has no effect on WebSocket Upgrade requests', async()=>{
 // Node's HTTP `upgrade` events bypass normal `request` callbacks.
 let called=false;const server=http.createServer(wrapRequestListener(()=>{called=true;},()=>()=>{}));
 server.on('upgrade',(_req,socket)=>{
  socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
  socket.end();
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const net=require('node:net');const data=await new Promise((resolve,reject)=>{
   let msg='';const s=net.connect(server.address().port,'127.0.0.1',()=>s.write('GET /ws HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'));
   s.on('data',d=>msg+=d);s.on('end',()=>resolve(msg));s.on('error',reject);
  });
  assert.ok(data.startsWith('HTTP/1.1 101'));
  assert.equal(called,false);
 }finally{await new Promise(r=>server.close(r));}
});

test('actual node --require preload + ESM main: routes unchanged and JWT-ticket flow ingested', async()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'vme2-noedit-preload-'));
 const toolDir=path.join(base,'tools');const authDir=path.join(base,'src/core/auth');
 fs.mkdirSync(toolDir,{recursive:true});fs.mkdirSync(authDir,{recursive:true});
 const here=__dirname;
 for(const file of ['vme2-frame-quality-preload.cjs','vme2-frame-quality-telemetry-core.mjs']) {
  fs.copyFileSync(path.join(here,file),path.join(toolDir,file));
 }
 fs.writeFileSync(path.join(base,'package.json'),'{"type":"module"}');
 fs.writeFileSync(path.join(authDir,'auth.instance.js'),"export const tokenService={verifyAccessToken:(jwt)=>{if(jwt==='fixture-valid')return {sub:'test-user'};throw Error('bad_jwt')}};");
 fs.writeFileSync(path.join(base,'src/index.js'),`import http from 'node:http';\nconst srv=http.createServer((req,res)=>{res.writeHead(200);res.end('main-handler:'+req.url)});\nsrv.listen(0,'127.0.0.1',()=>console.log('TEST_PORT='+srv.address().port));\n`);
 const logPath=path.join(base,'ingest','ingest.log');
 const env={...process.env,VME2_FRAME_QUALITY_NO_AUTO_INSTALL:'0',VME2_FRAME_QUALITY_LOG_PATH:logPath};
 const child=cp.spawn(process.execPath,['--require',path.join(toolDir,'vme2-frame-quality-preload.cjs'),path.join(base,'src/index.js')],{env,stdio:['ignore','pipe','pipe']});
 try{
  let out='';let err='';child.stderr.on('data',d=>err+=d);
  const port=await new Promise((resolve,reject)=>{
   const tm=setTimeout(()=>reject(Error('server_start_timeout:'+err)),5000);
   child.stdout.on('data',d=>{out+=d;if(out.includes('TEST_PORT=')){clearTimeout(tm);resolve(Number(out.match(/TEST_PORT=(\d+)/)[1]));}});
   child.on('exit',()=>{clearTimeout(tm);reject(Error('server_exited:'+err));});
  });
  assert.equal((await fetch(port,'/voice/health')).text,'main-handler:/voice/health');
  assert.equal((await fetch(port,'/ws')).text,'main-handler:/ws');
  const post=(body,headers)=>fetch(port,QUALITY_PATH,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  const noAuth=await post({type:'init',connectionId:IDs[0]});assert.equal(noAuth.code,401);
  const init=await post({type:'init',connectionId:IDs[0]},{Authorization:'Bearer fixture-valid'});
  assert.equal(init.code,200,init.text);
  const ticket=JSON.parse(init.text).ticket;
  const sent=await post(sample(IDs[0]),{'X-VME2-Telemetry-Ticket':ticket});assert.equal(sent.code,204,sent.text);
  assert.match(fs.readFileSync(logPath,'utf8'),/VME2_WEBGL_FRAME_QUALITY.*missing=70/);
  assert.equal((await fetch(port,'/game-server-control/test')).text,'main-handler:/game-server-control/test');
 }finally{child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));fs.rmSync(base,{recursive:true,force:true});}
});
