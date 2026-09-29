#!/usr/bin/env bash
set -euo pipefail

ROOT="/home/world3d/.config/unity3d"

[ -d "$ROOT" ] || exit 0

while IFS= read -r -d "" DIR; do

    # Production policy: Markdown and HTML reports are not allowed.
    find "$DIR" -maxdepth 1 -type f \( \
        -name "Network_A_Play_*.md" -o \
        -name "Network_A_Play_*.html" \
    \) -print0 |
    while IFS= read -r -d "" FILE; do
        rm -f -- "$FILE"
        logger -t network-a-log-guard "removed forbidden report: $FILE"
    done

    # Keep only .log files still owned/opened by an active process.
    # Closed logs receive a short grace period before cleanup.
    find "$DIR" -maxdepth 1 -type f -name "Network_A_Play_*.log" -mmin +10 -print0 |
    while IFS= read -r -d "" FILE; do

        if ! lsof -t -- "$FILE" >/dev/null 2>&1; then
            rm -f -- "$FILE"
            logger -t network-a-log-guard "removed inactive log: $FILE"
        fi

    done

done < <(find "$ROOT" -type d -name "Network_A_Logs" -print0 2>/dev/null)
