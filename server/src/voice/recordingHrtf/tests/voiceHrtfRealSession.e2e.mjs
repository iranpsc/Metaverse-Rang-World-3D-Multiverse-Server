import "dotenv/config";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { tokenService } from "../../../core/auth/auth.instance.js";
import { VoiceRecordingDownloadService } from "../../recording/voiceRecordingDownloadService.js";
import { ensureSessionSpatialTimeline } from "../../recordingSpatial/voiceSpatialTimelineMaterializer.js";
import { createPersonalHrtfDownload, startIsolatedPersonalHrtfDownloadRuntime } from "../voicePersonalHrtfDownloadStartupHook.js";

const root=process.env.METAVERSE_VOICE_RECORDING_STORAGE_ROOT||"/home/world3d/data/metaverse-voice-recordings";
const datasetPath=process.env.VOICE_HRTF_DATASET_PATH||"";
assert.ok(datasetPath,"VOICE_HRTF_DATASET_PATH is required");
const requested=String(process.env.SID||process.argv[2]||"").trim().toLowerCase();

async function chooseSession(){
    if(requested){
        const sd=join(root,requested); return {sd,m:JSON.parse(await readFile(join(sd,"session.json"),"utf8"))};
    }
    const dirs=await readdir(root,{withFileTypes:true}); const sessions=[];
    for(const d of dirs){if(!d.isDirectory()||d.name.startsWith("."))continue;try{const sd=join(root,d.name),m=JSON.parse(await readFile(join(sd,"session.json"),"utf8"));if((m.participants?.length??0)>=2)sessions.push({sd,m});}catch{}}
    sessions.sort((a,b)=>Number(b.m.endedAtMs)-Number(a.m.endedAtMs));
    if(!sessions.length)throw new Error("NO_REAL_HRTF_SESSION_FOUND"); return sessions[0];
}
function probe(path){
    const p=spawnSync("ffprobe",["-v","error","-select_streams","a:0","-show_entries","stream=codec_name,sample_rate,channels,channel_layout","-show_entries","format=duration,size","-of","json",path],{encoding:"utf8"});
    if(p.status!==0)throw new Error(p.stderr); return JSON.parse(p.stdout);
}
function sha(buffer){return createHash("sha256").update(buffer).digest("hex");}

const {sd,m}=await chooseSession();
await ensureSessionSpatialTimeline({storageRoot:root,sessionDirectory:sd,metadata:m});
const users=[...new Set(m.participants.map(p=>String(p.userId)).filter(Boolean))];
assert.ok(users.length>=2,"At least two participants are required");
const service=new VoiceRecordingDownloadService({storageRoot:root});
const out=join("/tmp",`vme2-real-hrtf-${m.sessionId}`); await mkdir(out,{recursive:true});

for(const userId of users){
    const base=await service.resolveDownload({sessionId:m.sessionId,userId});
    const download=await createPersonalHrtfDownload({downloadService:service,baseDownload:base,sessionId:m.sessionId,userId,datasetPath});
    const rr=download.renderResult;
    if(rr){
        console.log(`H5_HRTF_PERSONAL_MIX=PASS | listener=${userId} | tracks=${rr.participantTrackCount} | bytes=${rr.outputBytes} | durationMs=${rr.durationMs}`);
        for(const track of rr.tracks){const x=track.result;console.log(`H4_HRTF_TRACK=PASS | listener=${userId} | speaker=${track.userId} | mode=${x.hrtfMode} | frames=${x.frames} | missingSpatialFrames=${x.missingSpatialFrames} | front=${x.frontFrames} | right=${x.rightFrames} | back=${x.backFrames} | left=${x.leftFrames} | minDistance=${x.minimumDistance} | maxDistance=${x.maximumDistance}`);}
    } else console.log(`H5_HRTF_PERSONAL_MIX=CACHE | listener=${userId} | bytes=${download.contentLength}`);
}

const port=51915;
const runtime=await startIsolatedPersonalHrtfDownloadRuntime({host:"127.0.0.1",port,storageRoot:root,datasetPath});
try{
    for(const userId of users){
        const token=tokenService.createAccessToken({id:userId});
        const response=await fetch(`http://127.0.0.1:${port}/voice/recordings/${m.sessionId}/download/personal-hrtf`,{headers:{Authorization:`Bearer ${token}`}});
        const data=Buffer.from(await response.arrayBuffer());
        const expected=response.headers.get("x-voice-recording-sha256")||"";
        const actual=sha(data);
        const mode=response.headers.get("x-voice-recording-download-mode")||"";
        assert.equal(response.status,200); assert.equal(mode,"personal_hrtf_binaural"); assert.equal(expected,actual);
        const path=join(out,`${userId}-personal-hrtf.ogg`); await writeFile(path,data);
        const info=probe(path); const stream=info.streams?.[0]||{};
        assert.equal(stream.codec_name,"opus"); assert.equal(Number(stream.sample_rate),48000); assert.equal(Number(stream.channels),2);
        console.log(`H6_HRTF_HTTP=PASS | user=${userId} | status=200 | mode=${mode} | shaMatch=True | bytes=${data.length} | codec=${stream.codec_name} | sampleRate=${stream.sample_rate} | channels=${stream.channels} | output=${path}`);
    }
    const badToken=tokenService.createAccessToken({id:"hrtf-non-member-probe"});
    const forbidden=await fetch(`http://127.0.0.1:${port}/voice/recordings/${m.sessionId}/download/personal-hrtf`,{headers:{Authorization:`Bearer ${badToken}`}});
    assert.equal(forbidden.status,403); console.log("H6_HRTF_NON_MEMBER=PASS | status=403");
    const unauth=await fetch(`http://127.0.0.1:${port}/voice/recordings/${m.sessionId}/download/personal-hrtf`);
    assert.equal(unauth.status,401); console.log("H6_HRTF_NO_AUTH=PASS | status=401");
} finally { await runtime.stop(); }
console.log(`VME2_REAL_HRTF_H1_H6=PASS | sessionId=${m.sessionId} | users=${users.length} | output=${out}`);
