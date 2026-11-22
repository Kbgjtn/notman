#!/usr/bin/env python3
"""Extract four numeric fields from a gdbus GetStats reply as CSV."""

import re
import sys

text = sys.stdin.read()


def get(key):
    match = re.search(r"'%s': <(?:[a-z0-9]+ )?(-?\d+)>" % key, text)
    return match.group(1) if match else ""


print(",".join(get(key) for key in (
    "activeCount",
    "estimatedBytes",
    "prunedCount",
    "shellRssBytes",
)))
