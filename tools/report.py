#!/usr/bin/env python3
"""Summarise benchmark CSVs into a Markdown table on stdout."""

import csv
import statistics
from collections import defaultdict
from pathlib import Path

MIB = 1024 * 1024

HEADER = (
    "shot",
    "rss_kb",
    "delta_kb",
    "active_count",
    "estimated_bytes",
    "pruned_count",
    "shell_rss_bytes",
)

groups = defaultdict(list)

for path in sorted(Path("results").glob("*.csv")):
    case = res = None
    deltas = []
    active = []
    estimated = []
    with path.open(newline="") as handle:
        for line in handle:
            if line.startswith("# case="):
                parts = dict(
                    part.split("=", 1)
                    for part in line.strip()[2:].split(" ")
                    if "=" in part
                )
                case = parts.get("case")
                res = parts.get("res")
            elif line.startswith("#") or line.startswith("shot,") or not line.strip():
                continue
            else:
                values = next(csv.reader([line]))
                row = dict(zip(HEADER, values))
                deltas.append(int(row["delta_kb"]))
                if row.get("active_count"):
                    active.append(int(row["active_count"]))
                if row.get("estimated_bytes"):
                    estimated.append(int(row["estimated_bytes"]))
    if case and deltas:
        groups[(case, res)].append((deltas, active, estimated))

print("# Notman benchmark results")
print()
print("RSS deltas in kB; negative medians are GC/scheduling noise, not reclaimed memory.")
print()
print("| Case | Resolution | Runs | Peak RSS delta (kB) | Median RSS delta (kB) | Active notifications | Est. thumbnails (MiB) |")
print("| ---- | ---------- | ---- | ------------------- | --------------------- | -------------------- | --------------------- |")
for (case, res), runs in sorted(groups.items()):
    peaks = [max(d[0]) for d in runs]
    medians = [int(statistics.median(d[0])) for d in runs]
    last_active = [d[1][-1] for d in runs if d[1]]
    last_est = [d[2][-1] for d in runs if d[2]]
    active_text = str(int(statistics.median(last_active))) if last_active else "n/a"
    est_text = f"{statistics.median(last_est) / MIB:.1f}" if last_est else "n/a"
    print(
        f"| {case} | {res} | {len(runs)} | "
        f"{int(statistics.median(peaks))} | {int(statistics.median(medians))} | "
        f"{active_text} | {est_text} |"
    )
