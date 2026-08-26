#!/usr/bin/env python3
"""Regenerate docs/handles.json from the channel Sheet.

A YouTube @handle cannot be turned into a channel id from the browser:
youtube.com sends no CORS headers, and oEmbed 404s on channel URLs. So the
lookup happens here, on a machine that is not a browser, and the result is
committed. Channels pasted into the Sheet as /channel/UC... URLs skip this
entirely and work the moment the Sheet is saved.

Run after adding a channel to the Sheet by @handle:

    python3 scripts/resolve-handles.py
"""
import json
import os
import re
import sys
import urllib.request

SHEET_CSV = (
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vScJOEVp-KGJPXKnyS56qFBN-"
    "400qvNW_P1EUGBcGA9BfXJZV3VQUD_m2afqdFull9zxBJv3dpDsAmX"
    "/pub?gid=0&single=true&output=csv"
)
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "docs", "handles.json")
UA = {"User-Agent": "Mozilla/5.0"}


def get(url):
    return urllib.request.urlopen(
        urllib.request.Request(url, headers=UA), timeout=30
    ).read().decode("utf-8", "replace")


def resolve(handle):
    """@name -> UC..., by reading the channel page server-side."""
    html = get("https://www.youtube.com/" + handle)
    m = re.search(r'"externalId":"(UC[\w-]{22})"', html)
    return m.group(1) if m else None


def main():
    rows = get(SHEET_CSV).splitlines()[1:]
    existing = {}
    if os.path.exists(OUT):
        with open(OUT) as f:
            existing = json.load(f)

    out, failed = dict(existing), []
    for row in rows:
        row = row.strip().strip('"')
        if not row or re.search(r"UC[\w-]{22}", row):
            continue  # blank, or already an explicit channel id
        m = re.search(r"@([A-Za-z0-9._-]+)", row)
        if not m:
            continue
        handle = "@" + m.group(1)
        key = handle.lower()
        if key in out:
            print("  = %-18s %s (cached)" % (handle, out[key]))
            continue
        cid = resolve(handle)
        if cid:
            out[key] = cid
            print("  + %-18s %s" % (handle, cid))
        else:
            failed.append(handle)
            print("  ! %-18s could not resolve" % handle)

    with open(OUT, "w") as f:
        json.dump(out, f, indent=2, sort_keys=True)
        f.write("\n")
    print("\nwrote %s (%d handles)" % (OUT, len(out)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
