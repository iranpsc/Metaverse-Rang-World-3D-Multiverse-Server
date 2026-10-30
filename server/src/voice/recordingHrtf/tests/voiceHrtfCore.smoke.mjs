import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VoiceHrtfDatasetStore } from "../voiceHrtfDatasetStore.js";
import { VoiceHrtfDirectionResolver } from "../voiceHrtfDirectionResolver.js";
import { VoiceHrtfConvolver } from "../voiceHrtfConvolver.js";

function makeDatasetBuffer() {
    const positions = new Float32Array([
        0,0,1, 90,0,1, 180,0,1, 270,0,1
    ]);
    const m=4,l=8;
    const left = new Float32Array(m*l);
    const right = new Float32Array(m*l);
    left[0*l+0]=1; right[0*l+0]=1;
    left[1*l+0]=1; right[1*l+2]=0.5;
    left[2*l+1]=0.7; right[2*l+1]=0.7;
    left[3*l+2]=0.5; right[3*l+0]=1;
    const buffer=Buffer.alloc(24+(positions.length+left.length+right.length)*4);
    buffer.write("VMEHRTF1",0,"ascii");
    buffer.writeUInt32LE(1,8); buffer.writeUInt32LE(48000,12); buffer.writeUInt32LE(m,16); buffer.writeUInt32LE(l,20);
    let o=24;
    for(const array of [positions,left,right]) for(const value of array){buffer.writeFloatLE(value,o);o+=4;}
    return buffer;
}

const dir=await mkdtemp(join(tmpdir(),"vme-hrtf-core-"));
try{
    const path=join(dir,"synthetic.vmehrtf");
    await writeFile(path,makeDatasetBuffer());
    const dataset=await VoiceHrtfDatasetStore.fromFile(path);
    assert.equal(dataset.sampleRate,48000);
    assert.equal(dataset.measurementCount,4);
    const resolver=new VoiceHrtfDirectionResolver(dataset,{neighbors:4});
    const rightSelection=resolver.resolve({azimuthDegrees:90,elevationDegrees:0});
    assert.equal(rightSelection.azimuthDegrees,270);
    assert.equal(rightSelection.neighbors[0].index,3);
    assert.equal(rightSelection.neighbors[0].weight,1);
    const leftSelection=resolver.resolve({azimuthDegrees:-90,elevationDegrees:0});
    assert.equal(leftSelection.azimuthDegrees,90);
    assert.equal(leftSelection.neighbors[0].index,1);
    const convolver=new VoiceHrtfConvolver({dataset,frameSize:16,smoothingMs:1,frameDurationMs:20});
    const input=new Float32Array(16); input[0]=1;
    const output=convolver.process(input,rightSelection,1);
    assert.ok(output[1] > 0.99, "right ear should receive the direct impulse");
    assert.ok(output[4] > 0.49, "left ear delayed impulse should be preserved");
    console.log("VOICE_HRTF_H1_H3_CORE_SYNTHETIC=PASS | sofaRight=270 | nearestRightIndex=3 | convolution=True");
} finally { await rm(dir,{recursive:true,force:true}); }
