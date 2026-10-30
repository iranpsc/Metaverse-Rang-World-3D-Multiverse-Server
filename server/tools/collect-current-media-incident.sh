#!/usr/bin/env bash
set -euo pipefail
umask 077
cd /home/world3d/apps/metaverse-server || exit 1
OUT="$HOME/vme2-live-media-audit-$(date -u +%Y%m%d_%H%M%S).zip"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
python3 - "$TMP" <<'PY'
import json,os,re,sys,subprocess,urllib.request,datetime,pathlib
root=pathlib.Path(sys.argv[1]);root.mkdir(parents=True,exist_ok=True)
procs=json.loads(subprocess.check_output(['pm2','jlist'],text=True))
names=['metaverse-server','metaverse-voice-media-edge','metaverse-voice-media-node-a','metaverse-voice-media-node-b']
now=datetime.datetime.now(datetime.timezone.utc)
report={'utc':now.isoformat(),'processes':[]}
pat=re.compile(r'VME2_|VOICE_|media_edge|media_upstream|bridge|media_node|REFRESH|Failed|ERROR|error|timeout|capacity|flood|disconnected',re.I)
secret=re.compile(r'(?i)(\b(?:authorization|accessToken|refreshToken|secret|password|bearer|api[_-]?key)\b\s*(?:[=:]|\s+)\s*)([^\s,;|]+)')
def sanitize(s):
    return secret.sub(lambda m:m.group(1)+'[REDACTED]',s)
for p in procs:
    if p.get('name') not in names:continue
    env=p.get('pm2_env') or {};name=p['name']
    settings={k:env.get(k) for k in ('VOICE_MEDIA_P11_EDGE_WS_PORT','VOICE_MEDIA_P11_WS_PORT','VOICE_MEDIA_P11_BACKEND_PORT','VOICE_MEDIA_P11_NODE_ID','VOICE_MEDIA_FLOOD_PROTECTION_ENABLED','VOICE_MEDIA_PACKET_SECURITY_ENABLED') if k in env}
    report['processes'].append({'name':name,'pid':p.get('pid'),'status':env.get('status'),'script':env.get('pm_exec_path'),'uptimeSeconds':int((now.timestamp()*1000-(env.get('pm_uptime') or now.timestamp()*1000))/1000),'safeSettings':settings})
    for ty,field in (('out','pm_out_log_path'),('error','pm_err_log_path')):
        path=env.get(field)
        if not path or not os.path.isfile(path):continue
        with open(path,'rb') as f:
            f.seek(0,2);length=f.tell(); f.seek(max(0,length-12_000_000))
            data=f.read().decode('utf8','replace')
        lines=[sanitize(s)[:2000] for s in data.splitlines() if pat.search(s)]
        (root/f'{name}-{ty}-filtered.txt').write_text('\n'.join(lines[-16000:]),encoding='utf8')
for name,port in [('media-backend-bridge',51003),('media-node-a',51101),('media-node-b',51201)]:
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/health',timeout=5) as r:
            data=json.load(r)
        # Endpoint health does not contain passwords, but only keep relevant counters.
        payload={'status':data.get('status'),'success':data.get('success'),'nodeId':data.get('nodeId'),'bridge':data.get('bridge'),'media':data.get('media'),'scaling':data.get('scaling'),'connectedNodes':data.get('connectedNodes')}
    except Exception as e: payload={'healthError':type(e).__name__+':'+str(e)[:120]}
    (root/f'{name}-health.json').write_text(json.dumps(payload,indent=2,ensure_ascii=False,default=str),encoding='utf8')
edge=next((p for p in procs if p.get('name')=='metaverse-voice-media-edge'),None)
port=(edge or {}).get('pm2_env',{}).get('VOICE_MEDIA_P11_EDGE_WS_PORT')
if port and str(port).isdigit():
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/health',timeout=5) as r:d=json.load(r)
        (root/'media-edge-health.json').write_text(json.dumps(d,indent=2),encoding='utf8')
    except Exception as e: (root/'media-edge-health.txt').write_text(repr(e))
for log in ('/var/log/nginx/error.log', '/var/log/nginx/dev-world-3d.error.log'):
    if not os.path.isfile(log) or not os.access(log,os.R_OK): continue
    with open(log,'rb') as f:
        f.seek(0,2);size=f.tell();f.seek(max(0,size-6_000_000));chunk=f.read().decode('utf8','replace')
    rows=[sanitize(l)[:2000] for l in chunk.splitlines() if re.search('upstream|timed out|connect|no live|limit|voice|502|503|504',l,re.I)]
    (root/('nginx-'+pathlib.Path(log).name+'.txt')).write_text('\n'.join(rows[-3000:]),encoding='utf8')
try:
    r=subprocess.run(['systemctl','is-active','nginx'],capture_output=True,text=True,timeout=4)
    (root/'nginx-service-state.txt').write_text(r.stdout.strip()+'\n'+r.stderr.strip())
except Exception as e:
    (root/'nginx-service-state.txt').write_text(repr(e))
try:
    with urllib.request.urlopen('https://dev-world-3d.metarang.com/health',timeout=5) as r:
        result={'httpStatus':r.status,'domain':'dev-world-3d.metarang.com'}
except Exception as e:
    result={'error':type(e).__name__+':'+str(e)[:150]}
(root/'public-health-check.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
(root/'runtime.json').write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf8')
PY
(cd "$TMP" && zip -q -r "$OUT" .)
unzip -tq "$OUT"
echo "READ_ONLY_MEDIA_AUDIT=$OUT"
ls -lh "$OUT"
