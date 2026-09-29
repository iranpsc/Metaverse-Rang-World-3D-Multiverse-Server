#!/usr/bin/env python3
import argparse
import array
import json
import math
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Iterable

UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
SAMPLE_RATE = 48000
CHANNELS = 1
FRAME_MS = 20
FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS // 1000
DEFAULT_ROOT = "/home/world3d/data/metaverse-voice-recordings"
DEFAULT_LOG = "/home/world3d/.pm2/logs/metaverse-server-out.log"


def dbfs(value: float) -> float:
    if value <= 0.0:
        return float("-inf")
    return 20.0 * math.log10(min(1.0, value))


def fmt_db(v: float) -> str:
    return "-inf" if not math.isfinite(v) else f"{v:.2f}"


def newest_session_dir(root: Path) -> Path:
    candidates = []
    if not root.exists():
        raise FileNotFoundError(f"recording root does not exist: {root}")
    for p in root.iterdir():
        if not p.is_dir() or not UUID_RE.match(p.name):
            continue
        participant_dir = p / "participants"
        if not participant_dir.is_dir():
            continue
        has_audio = any(participant_dir.glob("*.ogg")) or any(participant_dir.glob("*.ogg.partial"))
        if not has_audio:
            continue
        try:
            mtime = max([x.stat().st_mtime for x in participant_dir.glob("*.ogg*")] or [p.stat().st_mtime])
        except OSError:
            mtime = p.stat().st_mtime
        candidates.append((mtime, p))
    if not candidates:
        raise FileNotFoundError(f"no voice recording session with participant audio found under: {root}")
    candidates.sort(key=lambda x: x[0], reverse=True)
    return candidates[0][1]


def resolve_session(root: Path, session: str | None) -> Path:
    if session:
        p = root / session
        if not p.is_dir():
            raise FileNotFoundError(f"session directory does not exist: {p}")
        return p
    return newest_session_dir(root)


def read_metadata(session_dir: Path) -> dict:
    p = session_dir / "session.json"
    if not p.is_file():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def metadata_by_connection(metadata: dict) -> dict[str, dict]:
    out = {}
    for item in metadata.get("participants", []) if isinstance(metadata, dict) else []:
        if not isinstance(item, dict):
            continue
        cid = str(item.get("connectionId", "")).strip()
        if cid:
            out[cid] = item
    return out


def read_tail(path: Path, max_bytes: int = 8 * 1024 * 1024) -> str:
    if not path.is_file():
        return ""
    with path.open("rb") as f:
        size = f.seek(0, os.SEEK_END)
        f.seek(max(0, size - max_bytes), os.SEEK_SET)
        return f.read().decode("utf-8", errors="replace")


def infer_platform(connection_id: str, log_text: str) -> str:
    if not log_text or not connection_id:
        return "unknown"
    positions = [m.start() for m in re.finditer(re.escape(connection_id), log_text, flags=re.IGNORECASE)]
    if not positions:
        return "unknown"
    for pos in reversed(positions[-20:]):
        start = max(0, pos - 1200)
        end = min(len(log_text), pos + 1200)
        window = log_text[start:end]
        patterns = [
            r"platform(?:Scope)?\s*[=:]\s*([A-Za-z0-9_-]+)",
            r'"platform"\s*:\s*"([^"]+)"',
            r'"platformScope"\s*:\s*"([^"]+)"',
        ]
        for pat in patterns:
            m = re.search(pat, window, flags=re.IGNORECASE)
            if m:
                return m.group(1)
        lw = window.lower()
        if "webgl" in lw:
            return "WebGL"
        if "windows" in lw or "standalonewindows" in lw:
            return "Windows"
        if "quest" in lw or "android" in lw:
            return "Quest"
    return "unknown"


def decode_pcm(path: Path) -> bytes:
    cmd = [
        "ffmpeg", "-v", "error", "-nostdin",
        "-i", str(path),
        "-f", "s16le", "-acodec", "pcm_s16le",
        "-ac", str(CHANNELS), "-ar", str(SAMPLE_RATE), "pipe:1"
    ]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if proc.returncode != 0 and not proc.stdout:
        err = proc.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"ffmpeg decode failed for {path.name}: {err[-700:]}")
    return proc.stdout


def iter_frames(samples: array.array, frame_samples: int) -> Iterable[array.array]:
    total = len(samples)
    for i in range(0, total, frame_samples):
        chunk = samples[i:i + frame_samples]
        if len(chunk) >= frame_samples // 2:
            yield chunk


def analyze_pcm(raw: bytes, threshold_db: float) -> dict:
    samples = array.array("h")
    samples.frombytes(raw[: len(raw) - (len(raw) % 2)])
    if sys.byteorder != "little":
        samples.byteswap()
    if not samples:
        return {
            "durationSec": 0.0, "sampleCount": 0,
            "allRmsDb": float("-inf"), "activeRmsDb": float("-inf"), "peakDb": float("-inf"),
            "activeFramePercent": 0.0, "activeFrames": 0, "totalFrames": 0,
        }

    total_sq = 0.0
    peak_abs = 0
    for s in samples:
        a = abs(int(s))
        if a > peak_abs:
            peak_abs = a
        n = float(s) / 32768.0
        total_sq += n * n
    all_rms = math.sqrt(total_sq / len(samples))

    threshold_linear = 10.0 ** (threshold_db / 20.0)
    active_sq = 0.0
    active_count = 0
    active_frames = 0
    total_frames = 0
    for chunk in iter_frames(samples, FRAME_SAMPLES):
        total_frames += 1
        sq = 0.0
        for s in chunk:
            n = float(s) / 32768.0
            sq += n * n
        rms = math.sqrt(sq / len(chunk))
        if rms >= threshold_linear:
            active_frames += 1
            active_sq += sq
            active_count += len(chunk)

    active_rms = math.sqrt(active_sq / active_count) if active_count else 0.0
    return {
        "durationSec": len(samples) / float(SAMPLE_RATE),
        "sampleCount": len(samples),
        "allRmsDb": dbfs(all_rms),
        "activeRmsDb": dbfs(active_rms),
        "peakDb": dbfs(peak_abs / 32768.0),
        "activeFramePercent": (active_frames * 100.0 / total_frames) if total_frames else 0.0,
        "activeFrames": active_frames,
        "totalFrames": total_frames,
    }


def participant_audio_files(session_dir: Path) -> list[Path]:
    pdir = session_dir / "participants"
    finals = sorted(pdir.glob("*.ogg"))
    partials = sorted(pdir.glob("*.ogg.partial"))
    by_cid = {}
    for p in partials:
        cid = p.name[:-len(".ogg.partial")]
        by_cid[cid] = p
    for p in finals:
        cid = p.name[:-len(".ogg")]
        by_cid[cid] = p
    return [by_cid[k] for k in sorted(by_cid)]


def connection_id_from_file(path: Path) -> str:
    n = path.name
    if n.endswith(".ogg.partial"):
        return n[:-len(".ogg.partial")]
    if n.endswith(".ogg"):
        return n[:-len(".ogg")]
    return path.stem


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only Voice participant recording level audit.")
    parser.add_argument("--root", default=DEFAULT_ROOT, help="Voice recording storage root")
    parser.add_argument("--session", default=None, help="Specific Voice session UUID; default = newest session with participant audio")
    parser.add_argument("--threshold-db", type=float, default=-45.0, help="20ms frame RMS threshold used to classify active speech")
    parser.add_argument("--log", default=DEFAULT_LOG, help="Backend PM2 out log used only for best-effort platform inference")
    parser.add_argument("--json", action="store_true", help="Also emit compact JSON result")
    args = parser.parse_args()

    if shutil.which("ffmpeg") is None:
        print("VOICE_RECORDING_LEVEL_AUDIT=FAIL | reason=ffmpeg_not_found")
        return 2

    root = Path(args.root).resolve()
    try:
        session_dir = resolve_session(root, args.session)
    except Exception as exc:
        print(f"VOICE_RECORDING_LEVEL_AUDIT=FAIL | reason=session_not_found | error={exc}")
        return 3

    metadata = read_metadata(session_dir)
    meta_by_cid = metadata_by_connection(metadata)
    log_text = read_tail(Path(args.log))
    files = participant_audio_files(session_dir)
    if not files:
        print(f"VOICE_RECORDING_LEVEL_AUDIT=FAIL | reason=no_participant_audio | sessionId={session_dir.name}")
        return 4

    results = []
    print(
        "VOICE_RECORDING_LEVEL_AUDIT=START"
        f" | sessionId={session_dir.name}"
        f" | participantFiles={len(files)}"
        f" | activeThresholdDb={args.threshold_db:.1f}"
        " | productionFilesChanged=false"
        " | serverRestartRequired=false"
    )

    for audio_path in files:
        cid = connection_id_from_file(audio_path)
        meta = meta_by_cid.get(cid, {})
        platform = infer_platform(cid, log_text)
        try:
            raw = decode_pcm(audio_path)
            stats = analyze_pcm(raw, args.threshold_db)
            result = {
                "connectionId": cid,
                "userId": str(meta.get("userId", "")),
                "platform": platform,
                "file": str(audio_path),
                "finalized": audio_path.name.endswith(".ogg"),
                "frameCountMetadata": int(meta.get("frameCount", 0) or 0),
                "opusBytesMetadata": int(meta.get("opusBytes", 0) or 0),
                **stats,
            }
            results.append(result)
            print(
                "VOICE_RECORDING_PARTICIPANT_LEVEL=PASS"
                f" | connectionId={cid}"
                f" | userId={result['userId'] or 'unknown'}"
                f" | platform={platform}"
                f" | finalized={str(result['finalized']).lower()}"
                f" | durationSec={result['durationSec']:.3f}"
                f" | allRmsDb={fmt_db(result['allRmsDb'])}"
                f" | activeRmsDb={fmt_db(result['activeRmsDb'])}"
                f" | peakDb={fmt_db(result['peakDb'])}"
                f" | activeFramePercent={result['activeFramePercent']:.2f}"
                f" | activeFrames={result['activeFrames']}"
                f" | totalFrames={result['totalFrames']}"
                f" | metadataFrames={result['frameCountMetadata']}"
                f" | metadataOpusBytes={result['opusBytesMetadata']}"
            )
        except Exception as exc:
            print(
                "VOICE_RECORDING_PARTICIPANT_LEVEL=FAIL"
                f" | connectionId={cid}"
                f" | platform={platform}"
                f" | file={audio_path}"
                f" | error={str(exc).replace('|', '/')}"
            )

    valid = [r for r in results if math.isfinite(r["activeRmsDb"])]
    if len(valid) >= 2:
        loudest = max(valid, key=lambda r: r["activeRmsDb"])
        quietest = min(valid, key=lambda r: r["activeRmsDb"])
        delta = loudest["activeRmsDb"] - quietest["activeRmsDb"]
        print(
            "VOICE_RECORDING_LEVEL_COMPARISON=PASS"
            f" | loudestConnectionId={loudest['connectionId']}"
            f" | loudestPlatform={loudest['platform']}"
            f" | loudestActiveRmsDb={fmt_db(loudest['activeRmsDb'])}"
            f" | quietestConnectionId={quietest['connectionId']}"
            f" | quietestPlatform={quietest['platform']}"
            f" | quietestActiveRmsDb={fmt_db(quietest['activeRmsDb'])}"
            f" | activeRmsDeltaDb={delta:.2f}"
        )

    if args.json:
        print("VOICE_RECORDING_LEVEL_JSON=" + json.dumps({
            "sessionId": session_dir.name,
            "thresholdDb": args.threshold_db,
            "participants": results,
        }, separators=(",", ":"), ensure_ascii=False))

    print(
        "VOICE_RECORDING_LEVEL_AUDIT=PASS"
        f" | sessionId={session_dir.name}"
        f" | analyzedParticipants={len(results)}"
        " | readOnly=true"
        " | productionFilesChanged=false"
        " | serverRestartRequired=false"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
