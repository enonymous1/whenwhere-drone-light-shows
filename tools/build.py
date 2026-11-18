#!/usr/bin/env python3
"""Optimize the WhenWhere drone page's images and check the result.

`index.html` is the source of truth, edited by hand. This script is
what is left of the generator: it makes sure every photo the page
references meets the site's spec (hero at most 1248px wide, occasion
cards at most 900px; JPEG quality 80, progressive), syncs each <img>
tag's width and height attributes to the file on disk, and validates
the page (the inline scripts through `node --check`, the fleet counts).

Photos already at spec are left byte-for-byte alone, so a rebuild with
nothing changed is a no-op. Drop a replacement photo into assets/ and
rebuild: an oversize file is downsized in place, and the tag's
dimensions are updated to match.

Run from anywhere: `python3 tools/build.py` from the repo root.
`--check` does the same work in memory and exits non-zero if the
committed index.html differs (the same check CI runs on pull requests),
without writing anything. `--help` shows the usage.
"""
import argparse
import difflib
import io
import os
import pathlib
import re
import shutil
import subprocess
import tempfile

from PIL import Image

# Paths resolve from this file, not the working directory: the build used to
# fail unless run from ~ (relative "workspace/..." paths). This script lives
# in tools/, so the repo root is its parent.
BASE = pathlib.Path(__file__).resolve().parent.parent
INDEX = BASE / "index.html"
ASSETS = BASE / "assets"

# Widest a photo may be, by file: the hero is shown large, the occasion
# cards display ~360px wide, so 900px is plenty at 2x.
MAX_WIDTH = {"hero.jpg": 1248}
DEFAULT_MAX_WIDTH = 900

IMG_RE = re.compile(r"<img\b[^>]*>", re.S)
SRC_RE = re.compile(r'\bsrc="assets/([^"]+)"')


def _set_dimension(tag, name, value):
    """Set one width/height attribute on an <img> tag, adding it if missing."""
    m = re.search(rf'\b{name}="\d+"', tag)
    if m:
        return tag[:m.start()] + f'{name}="{value}"' + tag[m.end():]
    if tag.rstrip().endswith("/>"):
        i = tag.rfind("/>")
        return tag[:i] + f' {name}="{value}"' + tag[i:]
    i = tag.rfind(">")
    return tag[:i] + f' {name}="{value}"' + tag[i:]


def optimize_images(html, write=True):
    """Bring every referenced photo to spec; sync tag dimensions.

    Returns (html, changed): changed is True when a photo would be
    downsized or a tag's dimensions would change. With write=False
    nothing is written to disk: oversize photos are resized in memory
    only, so --check can tell the build would change something without
    touching files. (Comparing HTML strings alone cannot see a file
    resize when the tag already has the right dimensions.)
    """
    out = []
    pos = 0
    changed = False
    for m in IMG_RE.finditer(html):
        tag = m.group(0)
        src = SRC_RE.search(tag)
        if not src:
            continue
        name = src.group(1)
        path = ASSETS / name
        assert path.is_file(), f"referenced photo missing: assets/{name}"
        with Image.open(path) as im:
            assert im.format == "JPEG", f"assets/{name} is not a JPEG"
            im.load()  # fail loud on a corrupt file, not just a bad header
            width, height = im.width, im.height
            max_w = MAX_WIDTH.get(name, DEFAULT_MAX_WIDTH)
            if width > max_w:
                changed = True
                resized = im.convert("RGB").resize(
                    (max_w, round(max_w * height / width)), Image.LANCZOS)
                buf = io.BytesIO()
                resized.save(buf, "JPEG", quality=80, progressive=True, optimize=True)
                if write:
                    path.write_bytes(buf.getvalue())
                width, height = resized.size
                print(f"{name}: downsized to {width}x{height}" +
                      ("" if write else " (check mode: not written)"))
        new_tag = _set_dimension(_set_dimension(tag, "width", width), "height", height)
        if new_tag != tag:
            changed = True
            print(f"{name}: tag dimensions set to {width}x{height}" +
                  ("" if write else " (check mode: not written)"))
        out.append(html[pos:m.start()])
        out.append(new_tag)
        pos = m.end()
    out.append(html[pos:])
    return "".join(out), changed


def _validate_built_html(html):
    """Fail the build if the shipped page is broken.

    The page is hand-edited now, so a typo in an inline <script> would
    ship silently without this. Extract the inline scripts and run them
    through `node --check` when node is available, and assert the fleet
    counts made it into the page.
    """
    # the button labels are filled from FLEET at load, so check the wiring
    # (data-fleet spans) and the source (the FLEET map), not a literal
    # "80 drones" string, which no longer appears in the markup.
    for key, count in (("heart", 80), ("rings", 100), ("glass", 60),
                       ("star", 200), ("finale", 240)):
        assert f'data-fleet="{key}"' in html, f"fleet button missing for {key}"
        assert f"{key}: {count}" in html, f"FLEET count missing for {key}"
    scripts = re.findall(r"<script>(.*?)</script>", html, re.S)
    assert scripts, "no inline <script> found in built page"
    node = shutil.which("node")
    if not node:
        print("WARNING: node not found — skipping JS syntax check (install node to enable it)")
        return
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as f:
        f.write("\n".join(scripts))
        path = f.name
    try:
        r = subprocess.run([node, "--check", path], capture_output=True, text=True)
    finally:
        os.unlink(path)
    assert r.returncode == 0, f"built JS failed node --check:\n{r.stderr}"
    print("node --check: OK")


def build(write=True):
    """Optimize images, sync tag dimensions, validate.

    Returns (html, changed): changed is True when the build resized a
    photo or changed a tag, i.e. a plain build would write something new.
    """
    html = INDEX.read_text(encoding="utf-8")
    html, changed = optimize_images(html, write=write)
    _validate_built_html(html)
    return html, changed


def main(argv=None):
    """Build the page, or --check it against the committed copy."""
    parser = argparse.ArgumentParser(
        description="Optimize the WhenWhere drone light shows page's images and check the result.")
    parser.add_argument("--check", action="store_true",
                        help="do not write anything; exit 0 if index.html matches a fresh build, 1 if it is stale (prints the first differences)")
    args = parser.parse_args(argv)
    html, changed = build(write=not args.check)
    if args.check:
        current = INDEX.read_text(encoding="utf-8")
        if not changed and current == html:
            print("index.html is up to date")
            return 0
        print("index.html is stale - run `python3 tools/build.py` to rebuild.")
        diff = list(difflib.unified_diff(
            current.splitlines(), html.splitlines(),
            fromfile="index.html (committed)", tofile="index.html (fresh build)", lineterm=""))
        if diff:
            print("First differences:")
            print("\n".join(diff[:30]))
            if len(diff) > 30:
                print(f"... ({len(diff) - 30} more diff lines)")
        return 1
    INDEX.write_text(html, encoding="utf-8")
    print("index.html written:", len(html), "chars")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
