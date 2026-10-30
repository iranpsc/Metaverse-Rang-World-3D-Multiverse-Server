#!/usr/bin/env python3
import argparse, hashlib, json, math, os, struct, sys
try:
    import h5py
    import numpy as np
except Exception as exc:
    print("HRTF_CONVERTER_DEPENDENCY_MISSING: python3-h5py and python3-numpy are required", file=sys.stderr)
    raise

MAGIC=b"VMEHRTF1"

def pick(root, names):
    for name in names:
        if name in root:
            return root[name]
    found=[]
    def visit(name, obj):
        if isinstance(obj, h5py.Dataset): found.append((name, obj))
    root.visititems(visit)
    for candidate, obj in found:
        normalized=candidate.replace('/', '.').lower()
        for name in names:
            if normalized.endswith(name.replace('/', '.').lower()): return obj
    raise KeyError("dataset not found: "+", ".join(names))

def normalize_ir_shape(ir):
    a=np.asarray(ir, dtype=np.float64)
    if a.ndim != 3: raise ValueError(f"Data.IR must be 3-D, got {a.shape}")
    # SOFA canonical M,R,N. If receiver dimension is elsewhere, move the dimension of size 2 to axis 1.
    if a.shape[1] == 2: return a
    candidates=[i for i,s in enumerate(a.shape) if s==2]
    if not candidates: raise ValueError(f"Could not locate receiver dimension in {a.shape}")
    return np.moveaxis(a, candidates[0], 1)

def normalize_positions(pos, measurements):
    a=np.asarray(pos, dtype=np.float64)
    a=np.squeeze(a)
    if a.ndim==1 and a.size==3: a=np.tile(a.reshape(1,3),(measurements,1))
    if a.ndim!=2: raise ValueError(f"SourcePosition must be 2-D, got {a.shape}")
    if a.shape[0] != measurements and a.shape[1] == measurements: a=a.T
    if a.shape[0] != measurements or a.shape[1] < 3: raise ValueError(f"SourcePosition shape mismatch {a.shape}, M={measurements}")
    return a[:,:3]

def receiver_lr_indices(receiver):
    try:
        a=np.asarray(receiver, dtype=np.float64)
        a=np.squeeze(a)
        if a.ndim==3: a=a[:,:,0]
        if a.ndim==2 and a.shape[0] != 2 and a.shape[1] == 2: a=a.T
        if a.ndim==2 and a.shape[0] >= 2 and a.shape[1] >= 2:
            y=a[:2,1]
            return int(np.argmax(y)), int(np.argmin(y))
    except Exception:
        pass
    return 0,1

def expand_delay(delay, measurements, receivers):
    if delay is None: return np.zeros((measurements,receivers), dtype=np.float64)
    a=np.asarray(delay, dtype=np.float64)
    a=np.squeeze(a)
    if a.ndim==0: return np.full((measurements,receivers), float(a))
    if a.ndim==1:
        if a.size==receivers: return np.tile(a.reshape(1,receivers),(measurements,1))
        if a.size==measurements: return np.tile(a.reshape(measurements,1),(1,receivers))
    if a.ndim==2:
        if a.shape==(measurements,receivers): return a
        if a.shape==(1,receivers): return np.tile(a,(measurements,1))
        if a.shape==(receivers,measurements): return a.T
    return np.zeros((measurements,receivers), dtype=np.float64)

def apply_fractional_delay(signal, delay_samples, out_length):
    out=np.zeros(out_length, dtype=np.float64)
    base=int(math.floor(max(0.0,float(delay_samples))))
    frac=max(0.0,float(delay_samples))-base
    for i,value in enumerate(signal):
        j=i+base
        if j<out_length: out[j]+=value*(1-frac)
        if frac and j+1<out_length: out[j+1]+=value*frac
    return out

def linear_resample(signal, source_rate, target_rate):
    if source_rate==target_rate: return signal
    new_len=max(1,int(round(len(signal)*target_rate/source_rate)))
    old=np.arange(len(signal),dtype=np.float64)
    new=np.linspace(0,len(signal)-1,new_len,dtype=np.float64)
    return np.interp(new,old,signal)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("input_sofa")
    ap.add_argument("output_bin")
    ap.add_argument("--meta", default="")
    ap.add_argument("--target-rate", type=int, default=48000)
    ap.add_argument("--source-url", default="https://sofacoustics.org/data/database/hutubs/pp1_HRIRs_measured.sofa")
    args=ap.parse_args()

    with h5py.File(args.input_sofa,"r") as f:
        ir=normalize_ir_shape(pick(f,["Data.IR","Data/IR"]))
        m,r,n=ir.shape
        pos=normalize_positions(pick(f,["SourcePosition"]),m)
        sr_raw=np.asarray(pick(f,["Data.SamplingRate","Data/SamplingRate"]),dtype=np.float64).reshape(-1)
        source_rate=int(round(float(sr_raw[0])))
        try: receiver=pick(f,["ReceiverPosition"])
        except Exception: receiver=None
        left_index,right_index=receiver_lr_indices(receiver)
        try: delay_obj=pick(f,["Data.Delay","Data/Delay"])
        except Exception: delay_obj=None
        delays=expand_delay(delay_obj,m,r)

    max_delay=int(math.ceil(float(np.max(delays)))) if delays.size else 0
    delayed_len=n+max_delay+1
    processed=[]
    max_len=0
    for measurement in range(m):
        ears=[]
        for receiver_index in (left_index,right_index):
            sig=apply_fractional_delay(ir[measurement,receiver_index,:],delays[measurement,receiver_index],delayed_len)
            sig=linear_resample(sig,source_rate,args.target_rate)
            ears.append(sig)
            max_len=max(max_len,len(sig))
        processed.append(ears)

    left=np.zeros((m,max_len),dtype=np.float32)
    right=np.zeros((m,max_len),dtype=np.float32)
    for measurement,(l,r_) in enumerate(processed):
        left[measurement,:len(l)]=l.astype(np.float32)
        right[measurement,:len(r_)]=r_.astype(np.float32)

    os.makedirs(os.path.dirname(os.path.abspath(args.output_bin)),exist_ok=True)
    with open(args.output_bin,"wb") as out:
        out.write(MAGIC)
        out.write(struct.pack("<IIII",1,args.target_rate,m,max_len))
        out.write(np.asarray(pos,dtype="<f4").tobytes(order="C"))
        out.write(np.asarray(left,dtype="<f4").tobytes(order="C"))
        out.write(np.asarray(right,dtype="<f4").tobytes(order="C"))

    sha=hashlib.sha256(open(args.output_bin,"rb").read()).hexdigest()
    meta={
        "format":"VMEHRTF1","version":1,"database":"HUTUBS","subject":"pp1","acquisition":"measured",
        "measurements":m,"sampleRate":args.target_rate,"irLength":max_len,"sourceSampleRate":source_rate,
        "leftReceiverIndex":left_index,"rightReceiverIndex":right_index,"sourceUrl":args.source_url,
        "license":"CC BY 4.0","licenseUrl":"https://creativecommons.org/licenses/by/4.0/",
        "datasetSha256":sha
    }
    meta_path=args.meta or args.output_bin+".json"
    with open(meta_path,"w",encoding="utf-8") as f: json.dump(meta,f,ensure_ascii=False,indent=2)
    print(f"VME_HRTF_CONVERT=PASS | measurements={m} | sampleRate={args.target_rate} | irLength={max_len} | sha256={sha} | output={args.output_bin}")

if __name__=="__main__": main()
