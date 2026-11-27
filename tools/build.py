#!/usr/bin/env python3
"""Optimize the WhenWhere drone page's images and check the result.

`index.html` is the source of truth, edited by hand. This script is
what is left of the generator: it makes sure every photo the page
references meets the site's spec (hero at most 1248px wide, occasion
cards at most 900px; JPEG quality 80, progressive), syncs each <img>
tag's width and height attributes to the file on disk, and validates
the page (config.js and studio.js through `node --check`, the fleet
counts, and that no inline executable script remains — the Content
Security Policy allows script-src 'self' only).

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
import pathlib
import re
import shutil
import subprocess

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

    The page is hand-edited and its JavaScript lives in config.js (the
    launch settings), geometry.js (the formation geometry, bound by the
    createGeometry factory), and studio.js (the machinery), so a typo in
    any of them would ship silently without this. Check the page loads
    config.js before geometry.js before studio.js, carries no inline
    executable script (the Content Security Policy allows script-src
    'self' only), and run all three files through `node --check` when
    node is available; also assert the fleet counts made it into the
    page.
    """
    # the button labels are filled from FLEET at load, so check the wiring
    # (data-fleet spans) in the page and the source (the FLEET map) in
    # config.js, not a literal "80 drones" string, which appears in
    # neither.
    for key, count in (("heart", 80), ("rings", 100), ("glass", 60),
                       ("star", 200), ("finale", 240)):
        assert f'data-fleet="{key}"' in html, f"fleet button missing for {key}"
    assert '<script src="config.js">' in html, "index.html does not load config.js"
    assert '<script src="geometry.js">' in html, "index.html does not load geometry.js"
    assert '<script src="studio.js">' in html, "index.html does not load studio.js"
    assert html.index('<script src="config.js">') < html.index('<script src="geometry.js">'), \
        "config.js must load before geometry.js"
    assert html.index('<script src="geometry.js">') < html.index('<script src="studio.js">'), \
        "geometry.js must load before studio.js"
    assert '<link rel="stylesheet" href="style.css"' in html, "index.html does not link style.css"
    style = BASE / "style.css"
    assert style.is_file(), "style.css missing"
    for m in re.finditer(r"<script\b[^>]*>", html):
        tag = m.group(0)
        assert "src=" in tag or "application/ld+json" in tag, \
            f"inline executable <script> found — move it to studio.js (CSP allows script-src 'self' only): {tag[:80]!r}"
    config = BASE / "config.js"
    assert config.is_file(), "config.js missing"
    config_text = config.read_text(encoding="utf-8")
    for key, count in (("heart", 80), ("rings", 100), ("glass", 60),
                       ("star", 200), ("finale", 240)):
        assert f"{key}: {count}" in config_text, f"FLEET count missing for {key}"
    studio = BASE / "studio.js"
    assert studio.is_file(), "studio.js missing"
    geometry = BASE / "geometry.js"
    assert geometry.is_file(), "geometry.js missing"
    node = shutil.which("node")
    if not node:
        print("WARNING: node not found — skipping JS syntax check (install node to enable it)")
        return
    for js in (config, geometry, studio):
        r = subprocess.run([node, "--check", str(js)], capture_output=True, text=True)
        assert r.returncode == 0, f"{js.name} failed node --check:\n{r.stderr}"
    print("node --check: OK")


def _validate_workbench():
    """Fail the build if the workbench page is broken.

    The workbench (workbench/index.html) is a second page in the same
    repo: it loads the shared config + geometry + skyc exporter from
    the repo root and its own workbench.js. Same rules as the main
    page — config before geometry before skyc.js before workbench.js,
    no inline executable script (there is no CSP on the workbench, but
    the rule keeps the scripts checkable), the page carries noindex
    (it is unlisted), and workbench.js + skyc.js pass node --check.
    """
    wb = BASE / "workbench" / "index.html"
    assert wb.is_file(), "workbench/index.html missing"
    html = wb.read_text(encoding="utf-8")
    assert '<meta name="robots" content="noindex"' in html, \
        "workbench/index.html must carry noindex (it is unlisted)"
    assert '<script src="../config.js">' in html, "workbench does not load ../config.js"
    assert '<script src="../geometry.js">' in html, "workbench does not load ../geometry.js"
    assert '<script src="skyc.js">' in html, "workbench does not load skyc.js"
    assert '<script src="workbench.js">' in html, "workbench does not load workbench.js"
    assert html.index('<script src="../config.js">') < html.index('<script src="../geometry.js">'), \
        "workbench: config.js must load before geometry.js"
    assert html.index('<script src="../geometry.js">') < html.index('<script src="skyc.js">'), \
        "workbench: geometry.js must load before skyc.js"
    assert html.index('<script src="skyc.js">') < html.index('<script src="workbench.js">'), \
        "workbench: skyc.js must load before workbench.js"
    assert '<link rel="stylesheet" href="style.css"' in html, "workbench does not link style.css"
    assert (BASE / "workbench" / "style.css").is_file(), "workbench/style.css missing"
    for m in re.finditer(r"<script\b[^>]*>", html):
        tag = m.group(0)
        assert "src=" in tag, \
            f"inline executable <script> in workbench — move it to workbench.js: {tag[:80]!r}"
    wbjs = BASE / "workbench" / "workbench.js"
    assert wbjs.is_file(), "workbench/workbench.js missing"
    skycjs = BASE / "workbench" / "skyc.js"
    assert skycjs.is_file(), "workbench/skyc.js missing"
    node = shutil.which("node")
    if not node:
        print("WARNING: node not found — skipping workbench JS syntax check (install node to enable it)")
        return
    for js in (wbjs, skycjs):
        r = subprocess.run([node, "--check", str(js)], capture_output=True, text=True)
        assert r.returncode == 0, f"{js.name} failed node --check:\n{r.stderr}"
    print("workbench: node --check OK")


def build(write=True):
    """Optimize images, sync tag dimensions, validate.

    Returns (html, changed): changed is True when the build resized a
    photo or changed a tag, i.e. a plain build would write something new.
    """
    html = INDEX.read_text(encoding="utf-8")
    html, changed = optimize_images(html, write=write)
    _validate_built_html(html)
    _validate_workbench()
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
