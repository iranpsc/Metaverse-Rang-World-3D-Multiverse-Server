#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:-/home/world3d/data/metaverse-voice-hrtf}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOFA="$ROOT/pp1_HRIRs_measured.sofa"
BIN="$ROOT/hutubs-pp1-measured.vmehrtf"
META="$ROOT/hutubs-pp1-measured.vmehrtf.json"
URL="https://sofacoustics.org/data/database/hutubs/pp1_HRIRs_measured.sofa"
mkdir -p "$ROOT"
python3 - <<'PY'
import h5py,numpy
print("HRTF_PYTHON_DEPS=READY")
PY
if [[ ! -s "$SOFA" ]]; then
  curl -fL --retry 3 --connect-timeout 20 "$URL" -o "$SOFA"
fi
python3 "$HERE/convertHutubsSofaToVmeHrtf.py" "$SOFA" "$BIN" --meta "$META" --target-rate 48000 --source-url "$URL"
echo "VOICE_HRTF_DATASET_PATH=$BIN"
