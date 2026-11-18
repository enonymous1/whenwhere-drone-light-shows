#!/usr/bin/env python3
"""Build the fixed WhenWhere drone page (repo root `index.html`).

Reads tools/source.html (the original page), extracts the 7 inline base64
photos to assets/*.jpg (resized + recompressed), and applies the 2026-11-12
review fixes. Every replacement asserts so a missed anchor fails loud
instead of silently shipping the old text.

Run from anywhere: `python3 tools/build.py` from the repo root.
The GitHub Actions workflow (`.github/workflows/pages.yml`) runs this on
every push to main and deploys the result to Pages.
"""
import base64
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
SRC = BASE / "tools/source.html"
OUT = BASE
ASSETS = OUT / "assets"
NAMES = ["hero", "weddings", "vineyards", "corporate", "festivals", "alumni", "proposals"]

def rep(html, old, new, count=1):
    found = html.count(old)
    assert found == count, f"expected {count}x {old[:70]!r}, found {found}x"
    return html.replace(old, new)

def _validate_built_html(html):
    """Fail the build if the shipped page is broken.

    The `rep()` asserts catch a missed anchor, but they cannot catch a
    syntactically broken <script>: the studio engine is spliced in as a raw
    string, so a typo there would ship silently. Extract the inline script
    and run it through `node --check` when node is available, and assert the
    fleet counts made it into the page.
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


def main():
    html = SRC.read_text(encoding="utf-8")
    ASSETS.mkdir(parents=True, exist_ok=True)

    # ---------- 1. images: base64 -> assets/*.jpg ----------
    tags = list(re.finditer(r"<img[^>]+>", html))
    assert len(tags) == 7, f"expected 7 img tags, got {len(tags)}"
    new_tags = []
    for i, m in enumerate(tags):
        tag = m.group(0)
        b64 = re.search(r"data:image/jpeg;base64,([A-Za-z0-9+/=]+)", tag).group(1)
        alt = re.search(r'alt="([^"]*)"', tag).group(1)
        cls = re.search(r'class="([^"]*)"', tag)
        raw = base64.b64decode(b64)
        im = Image.open(io.BytesIO(raw)).convert("RGB")
        if i == 0:  # hero: keep 1248w, recompress only
            im2 = im
        else:       # cards display ~360px wide; 900w is plenty at 2x
            im2 = im.resize((900, round(900 * im.height / im.width)), Image.LANCZOS)
        path = ASSETS / f"{NAMES[i]}.jpg"
        im2.save(path, "JPEG", quality=80, progressive=True, optimize=True)
        w, h = im2.size
        print(f"{NAMES[i]}.jpg {im.size} -> {w}x{h}, {path.stat().st_size // 1024}KB (was {len(raw) // 1024}KB)")
        if i == 0:
            new_tags.append(
                f'<img class="bg" src="assets/hero.jpg" alt="{alt}" fetchpriority="high" width="{w}" height="{h}" />')
        else:
            new_tags.append(
                f'<img src="assets/{NAMES[i]}.jpg" alt="{alt}" loading="lazy" decoding="async" width="{w}" height="{h}" />')
    # replace tags right-to-left so offsets stay valid
    for m, new in zip(reversed(tags), reversed(new_tags)):
        html = html[: m.start()] + new + html[m.end():]

    # ---------- 2. head: favicon, SEO, social, structured data ----------
    html = rep(html, '<link rel="icon" href="data:," />',
               '<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 32 32\'%3E%3Crect width=\'32\' height=\'32\' rx=\'7\' fill=\'%23060a1a\'/%3E%3Ctext x=\'16\' y=\'23\' font-size=\'19\' text-anchor=\'middle\' fill=\'%23d9a441\'%3E%E2%9C%A6%3C/text%3E%3C/svg%3E" />')
    html = rep(html,
               '<meta name="description" content="Custom drone light shows for weddings, vineyard celebrations, alumni weekends, corporate events and festivals across Charlottesville and Central Virginia. Register interest for the 2027 founding season." />',
               '''<meta name="description" content="Custom drone light shows for weddings, vineyard celebrations, alumni weekends, corporate events and festivals across Charlottesville and Central Virginia. Register interest for the 2027 founding season." />
    <meta name="theme-color" content="#060a1a" />
    <link rel="canonical" href="https://whenwhere.biz/drone-light-shows/" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="WhenWhere Drone Light Shows — Charlottesville &amp; Central Virginia" />
    <meta property="og:description" content="Your story, written in light across the sky. Custom drone light shows for weddings, vineyards, alumni weekends and festivals. Join the 2027 founding-season list." />
    <meta property="og:url" content="https://whenwhere.biz/drone-light-shows/" />
    <meta property="og:image" content="https://whenwhere.biz/drone-light-shows/assets/hero.jpg" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"ProfessionalService","name":"WhenWhere Drone Light Shows","url":"https://whenwhere.biz/drone-light-shows/","description":"Custom drone light shows for weddings, vineyard celebrations, alumni weekends, corporate events and festivals across Charlottesville and Central Virginia.","areaServed":{"@type":"City","name":"Charlottesville, Virginia"}}
    </script>''')

    # ---------- 3. CSS: nav fallback + form/studio extras ----------
    html = rep(html, "background:color-mix(in srgb, var(--night) 92%, transparent);",
               "background:#060a1a;background:color-mix(in srgb, var(--night) 92%, transparent);")
    html = rep(html, "      /* ---------- responsive ---------- */",
               """      .check{display:flex;gap:10px;align-items:flex-start;font-weight:500;color:#cfd7ff;cursor:pointer}
      .check input{width:18px;height:18px;margin-top:2px;accent-color:var(--gold-bright);flex:none}
      .contact-line{color:var(--night-muted);font-size:.95rem;margin-top:20px}
      .contact-line a{color:var(--gold-bright)}
      #useDesignBtn{margin-top:14px}
      /* ---------- responsive ---------- */""")

    # ---------- 4. copy fixes: US spelling, UVA wording, trust ----------
    html = rep(html, "Dozens of synchronised drones paint your initials, your logo, your date — animated, in full colour, above your guests.",
               "Dozens of synchronized drones paint your initials, your logo, your date — animated, in full color, above your guests.")
    html = rep(html, "A drone light show forming swirling galaxies of coloured light above a festival crowd at night",
               "A drone light show forming swirling galaxies of colored light above a festival crowd at night")
    html = rep(html, "Reunions, alumni weekends and graduation parties across Grounds and Charlottesville's estates.",
               "Reunions, alumni weekends and graduation parties at estates and venues around Charlottesville.")
    html = rep(html, "School colours", "School colors")
    html = rep(html, "airspace authorisations, venue coordination",
               "airspace authorizations, venue coordination")
    html = rep(html, "the FAA authorisation process needs lead time",
               "the FAA authorization process needs lead time")
    html = rep(html, "Quiet — kind to horses, dogs and neighbours in horse country",
               "Quiet — kind to horses, dogs and neighbors in horse country")
    html = rep(html, "our favourite kind of secret", "our favorite kind of secret")
    html = rep(html,
               "Drone light shows are regulated for good reason, and every show is planned around FAA rules: licensed pilots, the airspace authorisations your venue needs, a dedicated safety observer, and a defined flight zone that keeps the fleet away from your guests.",
               "Drone light shows are regulated for good reason, and every show is planned around FAA rules: FAA Part 107 licensed pilots, the airspace authorizations your venue needs, a dedicated safety observer, insured operations, and a defined flight zone that keeps the fleet away from your guests.")

    # ---------- 5. studio: "Use this design" button ----------
    html = rep(html, "and we'll design the real thing.</p>",
               "and we'll design the real thing.</p>\n            <button type=\"button\" class=\"btn line-btn\" id=\"useDesignBtn\">Use this design in my inquiry ↓</button>")

    # ---------- 6. form side: surprise wording + contact line ----------
    html = rep(html, "Planning a surprise? Mark it and we'll keep it quiet",
               "Planning a surprise? Tick the box in the form and we'll keep it quiet")
    html = rep(html,
               "<li>Venues &amp; planners: ask about partnering for your clients</li>\n            </ul>",
               """<li>Venues &amp; planners: ask about partnering for your clients</li>
            </ul>
            <p class="contact-line">Questions first? Visit the <a href="https://enonymous1.github.io/whenwhere-biz-main-site/">main site</a>.</p>""")

    # ---------- 7. form fields ----------
    html = rep(html,
               """                <div class="field" id="f-date">
                  <label for="inDate">Event date *</label>
                  <input id="inDate" name="date" type="date" />
                  <p class="err">Please pick your event date (or your best guess).</p>
                </div>""",
               """                <div class="field" id="f-date">
                  <label for="inDate">Event date *</label>
                  <input id="inDate" name="date" type="date" />
                  <p class="err">Please pick your 2027 event date, or tick the flexible box.</p>
                  <label class="check" style="margin-top:10px"><input type="checkbox" id="inFlexDate" /> My date is flexible / not sure yet</label>
                </div>""")
    html = rep(html, 'value="The Signature Show" checked', 'value="The Signature Show"')
    html = rep(html, 'value="Planning ahead" checked', 'value="Planning ahead"')
    html = rep(html, 'value="E + J"', 'value="LOVE"')
    html = rep(html, "|| 'E + J'", "|| 'LOVE'")
    html = rep(html,
               """                  <label><input type="radio" name="stage" value="Just curious" />Just curious</label>
                </div>
              </div>""",
               """                  <label><input type="radio" name="stage" value="Just curious" />Just curious</label>
                </div>
              </div>
              <div class="field">
                <label class="check"><input type="checkbox" id="inSurprise" /> This is a surprise — please keep every conversation discreet</label>
              </div>""")
    html = rep(html, '<button class="btn" type="submit" style="width:100%">Build my inquiry</button>',
               '<button class="btn" type="submit" style="width:100%">Send my inquiry</button>')
    html = rep(html,
               '<p style="color:var(--night-muted);font-size:.88rem;margin:12px 0 0">This page is a preview, so nothing is sent automatically. Submitting builds your inquiry below — copy it or download it and send it to us, and we\'ll take it from there.</p>',
               '<p id="formNote" style="color:var(--night-muted);font-size:.88rem;margin:12px 0 0">Submitting sends your inquiry to WhenWhere. We only use your details to reply about your event.</p>')

    # ---------- 8. result panel: addressable heading/desc/actions ----------
    html = rep(html, '<div class="result" id="resultPanel" role="status">\n              <h3>Your inquiry is ready, <span id="resultName">friend</span> ✦</h3>\n              <p>Copy it into an email or message to WhenWhere, or download it to send later. The sooner it reaches us, the sooner your date is on the founding-season list.</p>',
               '<div class="result" id="resultPanel" role="status">\n              <h3 id="resultHeading">Your inquiry is ready, <span id="resultName">friend</span> ✦</h3>\n              <p id="resultDesc">Copy it into an email or message to WhenWhere, or download it to send later. The sooner it reaches us, the sooner your date is on the founding-season list.</p>')
    html = rep(html, '              <div class="row">\n                <button class="btn" type="button" id="copyBtn">Copy my inquiry</button>',
               '              <div class="row" id="resultActions">\n                <button class="btn" type="button" id="copyBtn">Copy my inquiry</button>')

    # ---------- 9. footer: copyright ----------
    html = rep(html, '<a href="https://enonymous1.github.io/whenwhere-biz-main-site/">Visit the main site →</a>',
               '<span><a href="https://enonymous1.github.io/whenwhere-biz-main-site/">Visit the main site →</a></span><span>© 2026 WhenWhere.biz</span>')

    # ---------- 10. JS: config + studio density/colours + form wiring ----------
    html = fix_js(html)

    # ---------- 11. Fleet sizing: designs sized to the 100-drone opening fleet ----------
    html = fix_fleet(html)
    html = fix_reduced_motion(html)
    html = fix_studio_sampling(html)

    (OUT / "index.html").write_text(html, encoding="utf-8")
    print("index.html written:", len(html), "chars")
    _validate_built_html(html)
    return html


def fix_js(html):
    # 10a. CONFIG block right after <script>
    html = rep(html, "    <script>\n      /* ============ Formation Studio ============ */",
               """    <script>
      /* ============ Config: the thing to set before launch ============ */
      var WHENWHERE_CONFIG = {
        // Deployed Apps Script Web app URL (see README.md).
        // Leave blank to keep the copy/download fallback (demo mode).
        INQUIRY_ENDPOINT: 'https://script.google.com/macros/s/AKfycbxGXFDzmwqyUB3vUu-pex2y6VfSR27AMCUbZffagkcWP0SiOaI_IUml0viK1ScUeOE1/exec'
      };
      /* ============ Formation Studio ============ */""")

    # 10b. Studio: larger glowing dots (r 3.4 -> 4.2, blur 9 -> 12) + one palette per shape
    html = rep(html, "ctx.arc(d.x, d.y, 3.4, 0, Math.PI * 2);",
               "ctx.arc(d.x, d.y, 4.2, 0, Math.PI * 2);")
    html = rep(html, "ctx.shadowBlur = 9;", "ctx.shadowBlur = 12;")
    # per-shape palettes instead of one rainbow for every shape
    html = rep(html,
               "var COLORS = ['#ffd166', '#8fd8ff', '#ff7d9c', '#7dffcb', '#c9a7ff', '#ffffff', '#ffb36b'];",
               """var COLORS = ['#ffd166', '#8fd8ff', '#ff7d9c', '#7dffcb', '#c9a7ff', '#ffffff', '#ffb36b'];
        var PALETTES = {
          heart: ['#ff7d9c', '#ff4d6d', '#ffb3c1', '#ffffff'],
          rings: ['#ffd166', '#e3b356', '#fff3c4', '#ffffff'],
          glass: ['#8fd8ff', '#bfe9ff', '#ffffff', '#7dffcb'],
          star: ['#ffd166', '#ff7d9c', '#8fd8ff', '#ffffff'],
          word: ['#ffd166', '#ffffff', '#e3b356']
        };""")
    html = rep(html, "function setFormation(pts, name) {",
               "function setFormation(pts, name, palette) {")
    html = rep(html, "c: COLORS[idx % COLORS.length], ph: Math.random() * Math.PI * 2",
               "c: p.c || (palette || COLORS)[idx % (palette || COLORS).length], ph: Math.random() * Math.PI * 2")
    html = rep(html, "setFormation(sample(SHAPES.heart.draw), SHAPES.heart.name);",
               "setFormation(sample(SHAPES.heart.draw), SHAPES.heart.name, PALETTES.heart);")
    html = rep(html, "setFormation(sample(SHAPES[key].draw), SHAPES[key].name);",
               "setFormation(sample(SHAPES[key].draw), SHAPES[key].name, PALETTES[key]);")
    assert html.count("setFormation(wordPoints(w),") == 2
    html = html.replace("setFormation(wordPoints(w), '“' + w + '” — your words in the sky');",
                        "setFormation(wordPoints(w), '“' + w + '” — your words in the sky', PALETTES.word);")
    # "Use this design" button: prefill the inquiry's dream field
    html = rep(html, "      })();\n\n      /* ============ Package shortcuts ============ */",
               """        document.getElementById('useDesignBtn').addEventListener('click', function () {
          if (typeof currentName === 'undefined') return;
          var dream = document.getElementById('inDream');
          var line = 'Design we liked in the Formation Studio: ' + currentName + '. ';
          if (dream.value.indexOf(line) === -1) dream.value = (dream.value ? dream.value.replace(/\\s+$/, ' ') : '') + line;
          document.getElementById('inquire').scrollIntoView({ behavior: 'smooth' });
          dream.focus();
        });
      })();

      /* ============ Package shortcuts ============ */""")

    # 10c. Form: replace the whole inquiry-form IIFE with the Apps Script version
    # (same setup as the main site: POST to the Web app endpoint, which
    # appends a row to the private Sheet and emails a notification)
    new_form_js = '''/* ============ Inquiry form ============ */
      (function () {
        var form = document.getElementById('inquiryForm');
        var dateInput = document.getElementById('inDate');
        var flexBox = document.getElementById('inFlexDate');
        var note = document.getElementById('formNote');
        var cfg = (typeof WHENWHERE_CONFIG !== 'undefined') ? WHENWHERE_CONFIG : {};
        var endpoint = (cfg.INQUIRY_ENDPOINT || '').trim();
        var configured = !!endpoint;
        var COOLDOWN_MS = 5 * 60 * 1000;
        var inFlight = false;
        var submitBtn = form.querySelector('button[type="submit"]');
        function setNote() {
          if (note) note.textContent = configured
            ? 'Submitting sends your inquiry to WhenWhere. We only use your details to reply about your event.'
            : 'Demo mode: no inquiry endpoint is connected yet, so submitting builds your inquiry below to copy or download. See README.md to connect the inquiry form.';
        }
        setNote();

        // Founding season starts in 2027, and shows still need 14 days' lead time.
        var minDate = new Date(); minDate.setDate(minDate.getDate() + 14);
        var seasonStart = new Date('2027-01-01T00:00:00');
        if (seasonStart > minDate) minDate = seasonStart;
        dateInput.min = minDate.getFullYear() + '-' + String(minDate.getMonth() + 1).padStart(2, '0') + '-' + String(minDate.getDate()).padStart(2, '0');

        flexBox.addEventListener('change', function () {
          dateInput.disabled = flexBox.checked;
          if (flexBox.checked) document.getElementById('f-date').classList.remove('invalid');
        });

        function val(id) { return document.getElementById(id).value.trim(); }
        function mark(fieldId, bad) { document.getElementById(fieldId).classList.toggle('invalid', bad); return !bad; }

        function showResult(first, lines, sent, sendFailed) {
          document.getElementById('resultText').textContent = lines;
          document.getElementById('resultHeading').textContent = sent
            ? 'Thank you, ' + first + ' \\u2726'
            : 'Your inquiry is ready, ' + first + ' \\u2726';
          document.getElementById('resultDesc').textContent = sent
            ? "Your inquiry is in — we'll come back with availability and honest guidance on what your budget can do, usually within two working days."
            : sendFailed
              ? "We couldn't send it automatically — please copy it below and send it to us through the main site, and we'll take it from there."
              : 'Copy it into an email or message to WhenWhere, or download it to send later. The sooner it reaches us, the sooner your date is on the founding-season list.';
          document.getElementById('resultActions').style.display = sent ? 'none' : 'flex';
          var panel = document.getElementById('resultPanel');
          panel.classList.add('show');
          panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        form.addEventListener('submit', function (ev) {
          ev.preventDefault();
          if (inFlight) return; /* double-click / double-Enter while sending */
          setNote();
          var ok = true;
          ok = mark('f-name', !val('inName')) && ok;
          var email = val('inEmail');
          ok = mark('f-email', !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) && ok;
          ok = mark('f-type', !val('inType')) && ok;
          var flex = flexBox.checked;
          var dateBad = !flex && (!val('inDate') || val('inDate') < dateInput.min);
          ok = mark('f-date', dateBad) && ok;
          if (!ok) { var bad = document.querySelector('.field.invalid input, .field.invalid select'); if (bad) bad.focus(); return; }

          var pkg = (form.querySelector('input[name="pkg"]:checked') || {}).value || 'Not specified yet';
          var stage = (form.querySelector('input[name="stage"]:checked') || {}).value || 'Not specified yet';
          var surprise = document.getElementById('inSurprise').checked ? 'Yes' : 'No';
          var dateStr = flex ? 'Flexible / not sure yet'
            : new Date(val('inDate') + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
          var first = val('inName').split(' ')[0];
          var lines = [
            'DRONE LIGHT SHOW INQUIRY — WhenWhere.biz',
            '----------------------------------------',
            'Name: ' + val('inName'),
            'Email: ' + email,
            val('inPhone') ? 'Phone: ' + val('inPhone') : null,
            'Event type: ' + val('inType'),
            'Event date: ' + dateStr,
            val('inVenue') ? 'Venue / town: ' + val('inVenue') : null,
            val('inGuests') ? 'Expected guests: ' + val('inGuests') : null,
            val('inBudget') ? 'Rough budget: ' + val('inBudget') : null,
            'Package of interest: ' + pkg,
            'Planning stage: ' + stage,
            'Surprise: ' + surprise,
            val('inDream') ? 'In the sky, we would love to see: ' + val('inDream') : null
          ].filter(Boolean).join('\\n');

          if (!configured) { showResult(first, lines, false, false); return; }

          /* Spam guard (browser side): one send per browser per 5 minutes.
             The server enforces the same window, so this is just the
             friendly version — no second POST at all. */
          var lastSent = 0;
          try { lastSent = +localStorage.getItem('wwDroneLastInquiry') || 0; } catch (e) { lastSent = 0; }
          if (Date.now() - lastSent < COOLDOWN_MS) {
            if (note) note.textContent = "Your inquiry is already in. It was sent a few minutes ago — we've got it, and we'll reply from our personal email, usually within two working days.";
            if (note) note.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            return;
          }

          /* Live mode: POST to the Apps Script endpoint, which appends a row
             to the private Sheet and emails a notification. Replies come
             from our personal email. */
          inFlight = true;
          if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending...'; }
          var params = new URLSearchParams();
          params.set('name', val('inName')); params.set('email', email);
          params.set('phone', val('inPhone')); params.set('type', val('inType'));
          params.set('date', dateStr); params.set('venue', val('inVenue'));
          params.set('guests', val('inGuests')); params.set('budget', val('inBudget'));
          params.set('pkg', pkg); params.set('dream', val('inDream'));
          params.set('stage', stage); params.set('surprise', surprise);
          fetch(endpoint, { method: 'POST', body: params })
            .then(function (res) { if (!res.ok) throw new Error('send failed'); return res.text(); })
            .then(function () {
              try { localStorage.setItem('wwDroneLastInquiry', String(Date.now())); } catch (e) {}
              showResult(first, lines, true, false);
            })
            .catch(function () { showResult(first, lines, false, true); })
            .finally(function () {
              inFlight = false;
              if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Send my inquiry'; }
            });
        });

        document.getElementById('copyBtn').addEventListener('click', function () {
          var text = document.getElementById('resultText').textContent;
          var msg = document.getElementById('copiedMsg');
          function done() { msg.textContent = 'Copied \\u2713'; setTimeout(function () { msg.textContent = ''; }, 3000); }
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, function () { fallback(); });
          } else fallback();
          function fallback() {
            var ta = document.createElement('textarea');
            ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); done(); } catch (e) { msg.textContent = 'Select the text above and copy it manually.'; }
            document.body.removeChild(ta);
          }
        });

        document.getElementById('dlBtn').addEventListener('click', function () {
          var text = document.getElementById('resultText').textContent;
          var blob = new Blob([text], { type: 'text/plain' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'whenwhere-drone-show-inquiry.txt';
          document.body.appendChild(a); a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
        });
      })();
    '''
    pattern = re.compile(r"/\* =+ Inquiry form =+ \*/.*?\)\(\);\s*\n", re.S)
    html2, n = pattern.subn(lambda m: new_form_js, html)
    assert n == 1, f"form IIFE replacement matched {n}x"
    return html2



def fix_fleet(html):
    """Size every Formation Studio design to the real fleet.

    Opening fleet is 100 drones (measured 2026-11-12: step-12 sampling gave
    hearts 270, rings 258, glass 282, star 129, words 27-65 — all wrong
    bands). Targets: hearts 80, rings 100, glass 60, star 200, words
    ~25/character capped at 100, plus a new 240-drone Grand finale.
    The shapes are now placed by contour (see fix_studio_sampling), so this
    pass only sets the copy, the FLEET targets, and the call sites.
    """
    # --- studio copy: fleet note in the lede ---
    html = rep(html,
               "Tap a design and watch the fleet assemble it. This is a simplified sketch of how a show is choreographed — your real design is built with you, frame by frame, and previewed as an animation before show night.",
               "Tap a design and watch the fleet assemble it. This is a simplified sketch of how a show is choreographed — your real design is built with you, frame by frame, and previewed as an animation before show night. Our opening fleet is 100 drones, so most designs here fit it as drawn — the two marked 200+ are larger finales that need extra lead time to secure additional units.")

    # --- shape buttons: drone-count tags + new Grand finale ---
    html = rep(html, "Interlocking hearts <span>weddings</span>",
               "Interlocking hearts <span>weddings · <span data-fleet=\"heart\">80</span> drones</span>")
    html = rep(html, "Wedding rings <span>weddings</span>",
               "Wedding rings <span>weddings · <span data-fleet=\"rings\">100</span> drones</span>")
    html = rep(html, "Wine glass <span>vineyards</span>",
               "Wine glass <span>vineyards · <span data-fleet=\"glass\">60</span> drones</span>")
    html = rep(html, "Starburst <span>festivals &amp; finales</span>",
               "Starburst <span>festivals &amp; finales · <span data-fleet=\"star\">200</span> drones</span>")
    html = rep(html,
               '<button type="button" class="shape-btn" data-shape="star">Starburst <span>festivals &amp; finales · <span data-fleet="star">200</span> drones</span></button>',
               '''<button type="button" class="shape-btn" data-shape="star">Starburst <span>festivals &amp; finales · <span data-fleet="star">200</span> drones</span></button>
            <button type="button" class="shape-btn" data-shape="finale">Grand finale <span>finales · <span data-fleet="finale">240</span> drones</span></button>''')
    html = rep(html, "Your words <span>initials · dates · logos</span>",
               "Your words <span>up to 100 drones</span>")

    # --- hero + packages + FAQ: fleet in words ---
    html = rep(html, "Dozens of synchronized drones paint your initials, your logo, your date",
               "Up to 100 synchronized drones paint your initials, your logo, your date")
    html = rep(html, "Every event is different — venue, guest count, and how custom the artwork is — so every show is quoted individually. Founding-season clients for 2027 get priority dates and a free design consultation.",
               "Every event is different — venue, guest count, and how custom the artwork is — so every show is quoted individually. Founding-season clients for 2027 get priority dates and a free design consultation. Our opening fleet is 100 drones; larger 200+ drone finales are available with extra lead time to secure the additional units.")
    html = rep(html, "<li>One custom formation, designed with you</li>",
               "<li>One custom formation, designed with you</li>\n              <li>50–100 drones — fits our opening fleet</li>")
    html = rep(html, "<li>Multiple scenes, roughly 10–15 minutes</li>",
               "<li>Multiple scenes, roughly 10–15 minutes</li>\n              <li>Up to 100 drones per scene — 200+ finales with extra lead time</li>")
    html = rep(html, "Our 2027 founding-season interest list is open now.",
               "Our 2027 founding-season interest list is open now. Planning a 200+ drone finale? Tell us as early as you can — the additional units take extra lead time to secure.")

    # --- JS: sample() signature (the splice anchor in fix_studio_sampling) ---
    html = rep(html, "function sample(drawFn) {",
               "function sample(drawFn, target) {")

    # --- JS: fleet targets, Grand finale shape + palette ---
    html = rep(html,
               """        var PALETTES = {""",
               """        var FLEET = { heart: 80, rings: 100, glass: 60, star: 200, finale: 240 };
        var PALETTES = {""")
    html = rep(html, "          word: ['#ffd166', '#ffffff', '#e3b356']",
               """          word: ['#ffd166', '#ffffff', '#e3b356'],
          finale: ['#ffd166', '#ff7d9c', '#8fd8ff', '#ffffff']""")

    # --- JS: count caption now says whether it fits the opening fleet ---
    html = rep(html,
               "countEl.textContent = pts.length + ' drones in this sketch — final designs are scaled to your show';",
               "countEl.textContent = pts.length + ' drones — ' + (pts.length > 100 ? 'a larger show; extra lead time to secure additional units' : 'fits our 100-drone opening fleet');")

    # --- JS: pass targets at every call site; words scale ~25/character, capped 100 ---
    html = rep(html, "setFormation(sample(SHAPES.heart.draw), SHAPES.heart.name, PALETTES.heart);",
               "setFormation(sample(SHAPES.heart.draw, FLEET.heart), SHAPES.heart.name, PALETTES.heart);")
    html = rep(html, "setFormation(sample(SHAPES[key].draw), SHAPES[key].name, PALETTES[key]);",
               "setFormation(sample(SHAPES[key].draw, FLEET[key]), SHAPES[key].name, PALETTES[key]);")
    return html




def fix_reduced_motion(html):
    """Reduced-motion users saw an empty sky (pre-existing bug).

    setFormation() snaps drones to their targets when reduced motion is
    on, but draw() then recomputes x/y from the start positions with
    lt=0 (t=0 at first paint), putting every drone back below the canvas
    — and the rAF loop never runs again when reduced, so they never rise.
    With reduced motion, treat every drone as fully arrived (lt=1).
    """
    html = rep(html, "var lt = Math.min(1, Math.max(0, (t - d.d) / 1.5));",
               "var lt = reduced ? 1 : Math.min(1, Math.max(0, (t - d.d) / 1.5));")
    return html




STUDIO_ENGINE = '''        /* ---- Even drone placement (2026-11-12): the old raster + stride
           thinning picked dots in row-major order, so one side of a shape
           could end up denser than the other and dots wobbled off the
           outline. Outline shapes are now placed evenly along their true
           contour by arc length; words are drawn one character at a time
           as filled glyphs thinned one point per grid cell, so identical
           glyphs get identical dots. Hearts interlock on a diagonal with
           a deep overlap: every crossing along one heart's outline is
           found and the under-heart alternates at each crossing, and the
           gaps are real - resampleRuns() never interpolates dots across
           a break. */
        function cubic(p0, p1, p2, p3, n) {
          var pts = [];
          for (var i = 0; i <= n; i++) {
            var t = i / n, u = 1 - t;
            pts.push({ x: u*u*u*p0.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*p3.x,
                       y: u*u*u*p0.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*p3.y });
          }
          return pts;
        }
        function resample(pts, n) {
          var L = [0];
          for (var i = 1; i < pts.length; i++) L.push(L[i-1] + Math.hypot(pts[i].x-pts[i-1].x, pts[i].y-pts[i-1].y));
          var total = L[L.length-1];
          if (!total || n <= 0) return [];
          var out = [], j = 0;
          for (var k = 0; k < n; k++) {
            var d = total * k / n;
            while (j < L.length-2 && L[j+1] < d) j++;
            var seg = (L[j+1]-L[j]) || 1, f = (d-L[j])/seg;
            out.push({ x: pts[j].x + (pts[j+1].x-pts[j].x)*f, y: pts[j].y + (pts[j+1].y-pts[j].y)*f });
          }
          return out;
        }
        function circlePts(cx, cy, r, n, squash) {
          var pts = [];
          for (var i = 0; i < n; i++) { var a = i/n*Math.PI*2 - Math.PI/2; pts.push({ x: cx+Math.cos(a)*r, y: cy+Math.sin(a)*r*(squash||1) }); }
          return pts;
        }
        function heartDense(cx, cy, s) {
          var tip = { x: cx, y: cy + s * .85 };
          var dense = cubic(tip, {x:cx-s*1.5,y:cy-s*.1}, {x:cx-s*.75,y:cy-s*1.15}, {x:cx,y:cy-s*.35}, 48);
          dense = dense.concat(cubic({x:cx,y:cy-s*.35}, {x:cx+s*.75,y:cy-s*1.15}, {x:cx+s*1.5,y:cy-s*.1}, tip, 48).slice(1));
          return dense;
        }
        function runLen(r) { var L = 0; for (var i = 1; i < r.length; i++) L += Math.hypot(r[i].x-r[i-1].x, r[i].y-r[i-1].y); return L; }
        // resample that never interpolates across a break: split into runs, share dots by run length
        function resampleRuns(pts, n) {
          var runs = [[]];
          for (var i = 0; i < pts.length; i++) {
            if (i && Math.hypot(pts[i].x-pts[i-1].x, pts[i].y-pts[i-1].y) > 25) runs.push([]);
            runs[runs.length-1].push(pts[i]);
          }
          runs = runs.filter(function (r) { return r.length > 1; });
          if (!runs.length) return resample(pts, n);
          var lens = runs.map(runLen), total = lens.reduce(function (a, b) { return a+b; }, 0);
          if (!total) return resample(pts, n);
          var shares = lens.map(function (L) { return Math.max(1, Math.floor(n*L/total)); });
          var sum = shares.reduce(function (a, b) { return a+b; }, 0);
          var order = lens.map(function (L, i) { return i; }).sort(function (a, b) { return lens[b]-lens[a]; });
          var k = 0, guard = 0;
          while (sum < n && guard++ < 100) { shares[order[k % order.length]]++; sum++; k++; }
          while (sum > n && guard++ < 100) { var idx = order[k % order.length]; if (shares[idx] > 1) { shares[idx]--; sum--; } k++; }
          var out = [];
          runs.forEach(function (r, i) { out = out.concat(resample(r, shares[i])); });
          return out;
        }
        function heartPair(n) {
          var s = 100;
          function tilt(dense, cx, cy, a) { var co = Math.cos(a), si = Math.sin(a); return dense.map(function (p) { var dx = p.x-cx, dy = p.y-cy; return { x: cx+dx*co-dy*si, y: cy+dx*si+dy*co }; }); }
          // diagonal, leaning into each other: left heart up-left, right heart down-right
          var cA = { x: W*.42, y: H*.45 }, cB = { x: W*.58, y: H*.55 };
          var dA = tilt(heartDense(cA.x, cA.y, s), cA.x, cA.y, .18);
          var dB = tilt(heartDense(cB.x, cB.y, s), cB.x, cB.y, -.18);
          function nearest(p, arr) { var m = Infinity; for (var i = 0; i < arr.length; i++) { var d = (p.x-arr[i].x)*(p.x-arr[i].x) + (p.y-arr[i].y)*(p.y-arr[i].y); if (d < m) m = d; } return Math.sqrt(m); }
          function centroid(list) { if (!list.length) return null; var sx = 0, sy = 0; list.forEach(function (p) { sx += p.x; sy += p.y; }); return { x: sx/list.length, y: sy/list.length }; }
          // crossings, in order along dA: consecutive dA points near dB form one cluster
          var candIdx = [];
          dA.forEach(function (p, i) { if (nearest(p, dB) < 12) candIdx.push(i); });
          var clusters = [];
          candIdx.forEach(function (i) { var last = clusters[clusters.length-1]; if (last && i - last[last.length-1] <= 8) last.push(i); else clusters.push([i]); });
          var crossings = clusters.map(function (idxs) { return centroid(idxs.map(function (i) { return dA[i]; })); }).filter(Boolean);
          // merge crossings closer than 40px (one crossing split by sparse candidates, or wrapping the tip)
          for (var m = 0; m < crossings.length - 1; m++) {
            if (Math.hypot(crossings[m+1].x-crossings[m].x, crossings[m+1].y-crossings[m].y) < 40) {
              crossings[m] = { x: (crossings[m].x+crossings[m+1].x)/2, y: (crossings[m].y+crossings[m+1].y)/2 };
              crossings.splice(m+1, 1); m--;
            }
          }
          function gap(dense, centers, r) { return dense.filter(function (p) { return centers.every(function (c) { var d = (p.x-c.x)*(p.x-c.x) + (p.y-c.y)*(p.y-c.y); return d > r*r; }); }); }
          var h = Math.floor(n/2);
          // alternate the under-heart at each crossing, in order along dA
          var gapsA = [], gapsB = [];
          crossings.forEach(function (c, k) { if (k % 2 === 0) gapsA.push(c); else gapsB.push(c); });
          var left = resampleRuns(gap(dA, gapsA, 30), h), right = resampleRuns(gap(dB, gapsB, 30), n-h);
          left.forEach(function (p, i) { p.c = PALETTES.heart[i % PALETTES.heart.length]; });
          right.forEach(function (p, i) { p.c = PALETTES.rings[i % PALETTES.rings.length]; });
          return left.concat(right);
        }
        function glassPts(n) {
          var P = function (x, y) { return { x: W*x, y: H*y }; };
          var dense = [P(.40,.10), P(.60,.10)];
          dense = dense.concat(cubic(P(.60,.10), P(.60,.34), P(.55,.44), P(.52,.47), 32).slice(1));
          dense = dense.concat([P(.52,.78), P(.60,.78), P(.60,.86), P(.40,.86), P(.40,.78), P(.48,.78), P(.48,.47)]);
          dense = dense.concat(cubic(P(.48,.47), P(.45,.44), P(.40,.34), P(.40,.10), 32).slice(1));
          return resample(dense, n);
        }
        function starPts(n) {
          var cx = W/2, cy = H/2, verts = [];
          for (var k = 0; k < 12; k++) {
            var a = k*Math.PI/6 - Math.PI/2;
            verts.push({ x: cx+Math.cos(a)*165, y: cy+Math.sin(a)*165*.82 });
            var a2 = a + Math.PI/12;
            verts.push({ x: cx+Math.cos(a2)*95, y: cy+Math.sin(a2)*95*.82 });
          }
          verts.push(verts[0]);
          return resample(verts, n);
        }
        function ringsPts(n) {
          var per = Math.floor((n - 12) / 2);
          var pts = circlePts(W*.42, H*.52, 105, per).concat(circlePts(W*.58, H*.52, 105, n - 12 - per));
          var gx = W*.58, gy = H*.52 - 105 - 30;
          var gem = [{x:gx,y:gy-30},{x:gx+26,y:gy},{x:gx,y:gy+30},{x:gx-26,y:gy},{x:gx,y:gy-30}];
          return pts.concat(resample(gem, 12));
        }
        function finalePts(n) {
          var cx = W/2, cy = H/2;
          var pts = circlePts(cx, cy, 175, 95).concat(circlePts(cx, cy, 118, 65));
          pts = pts.concat(circlePts(cx, cy, 15, 8));
          for (var k = 0; k < 12; k++) {
            var a = k*Math.PI/6 - Math.PI/2;
            for (var j = 0; j < 6; j++) {
              var r = 95 + j*22;
              pts.push({ x: cx+Math.cos(a)*r, y: cy+Math.sin(a)*r });
            }
          }
          return pts;
        }
        var SHAPES = {
          heart: { name: 'Interlocking hearts', points: heartPair },
          rings: { name: 'Wedding rings', points: ringsPts },
          glass: { name: 'Wine glass', points: glassPts },
          star: { name: 'Starburst', points: starPts },
          finale: { name: 'Grand finale', points: finalePts }
        };
        function thinUniform(pts, target) {
          if (pts.length <= target) return pts.slice();
          var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, i, p;
          for (i = 0; i < pts.length; i++) { p = pts[i]; if (p.x<minX) minX=p.x; if (p.x>maxX) maxX=p.x; if (p.y<minY) minY=p.y; if (p.y>maxY) maxY=p.y; }
          var w = Math.max(1, maxX-minX+1), h = Math.max(1, maxY-minY+1);
          var cols = Math.max(1, Math.round(Math.sqrt(target*w/h)));
          var rows = Math.max(1, Math.round(target/cols));
          var cw = w/cols, ch = h/rows, cells = {};
          for (i = 0; i < pts.length; i++) {
            p = pts[i];
            var cx = Math.min(cols-1, Math.floor((p.x-minX)/cw));
            var cy = Math.min(rows-1, Math.floor((p.y-minY)/ch));
            var k = cy*cols+cx, ccx = minX+(cx+.5)*cw, ccy = minY+(cy+.5)*ch;
            var d = (p.x-ccx)*(p.x-ccx)+(p.y-ccy)*(p.y-ccy);
            if (!cells[k] || d < cells[k].d) cells[k] = { p: p, d: d };
          }
          var out = [];
          for (var k in cells) out.push(cells[k].p);
          while (out.length < target) {
            var best = null, bestD = -1;
            for (i = 0; i < pts.length; i++) {
              p = pts[i];
              if (out.indexOf(p) >= 0) continue;
              var m = Infinity;
              for (var j = 0; j < out.length; j++) {
                var dd = (p.x-out[j].x)*(p.x-out[j].x)+(p.y-out[j].y)*(p.y-out[j].y);
                if (dd < m) m = dd;
              }
              if (m > bestD) { bestD = m; best = p; }
            }
            if (!best) break;
            out.push(best);
          }
          return out.slice(0, target);
        }
        // One character at a time, each rastered on a tight canvas just big
        // enough for the glyph (not the full 900x520 stage): wordPoints runs
        // on every keystroke, and a full-stage canvas per character was ~2MB
        // of allocation per keystroke for a 4-letter word. The glyph is drawn
        // centered, so points translate back by the same offset.
        function wordPoints(text) {
          var chars = text.replace(/\\s/g, '').split('');
          if (!chars.length) return [];
          var target = Math.max(50, Math.min(100, chars.length * 25));
          var size = text.length > 5 ? 130 : 190;
          var mc = document.createElement('canvas').getContext('2d');
          mc.font = '700 ' + size + 'px Marcellus, Georgia, serif';
          var widths = chars.map(function (c) { return mc.measureText(c).width; });
          var gap = size * .18;
          var totalW = widths.reduce(function (a, b) { return a + b; }, 0) + gap * (chars.length - 1);
          var x = W / 2 - totalW / 2;
          var per = Math.floor(target / chars.length), extra = target - per * chars.length;
          var pts = [];
          chars.forEach(function (c, idx) {
            var n = per + (idx < extra ? 1 : 0);
            var tw = Math.ceil(widths[idx]) + 16, th = Math.ceil(size * 1.5);
            var off = document.createElement('canvas'); off.width = tw; off.height = th;
            var o = off.getContext('2d');
            o.font = '700 ' + size + 'px Marcellus, Georgia, serif';
            o.textAlign = 'center'; o.textBaseline = 'middle';
            o.fillStyle = '#fff';
            o.fillText(c, tw / 2, th / 2 + 6);
            var img = null;
            try { img = o.getImageData(0, 0, tw, th).data; } catch (e) { img = null; }
            var cp = [];
            if (img) {
              for (var y = 4; y < th; y += 4) for (var xx = 4; xx < tw; xx += 4) {
                if (img[(Math.floor(y) * tw + Math.floor(xx)) * 4 + 3] > 110) cp.push({ x: xx, y: y });
              }
            }
            var thinned = thinUniform(cp, n);
            var cx = x + widths[idx] / 2;
            thinned.forEach(function (p) { pts.push({ x: p.x - tw / 2 + cx, y: p.y - th / 2 + H / 2 }); });
            x += widths[idx] + gap;
          });
          return pts;
        }

'''


def fix_studio_sampling(html):
    """Even drone placement (2026-11-12, Justin's screenshots).

    Root cause: raster sampling + row-major stride thinning. It put more
    dots on one side of a shape than the other (glass heavier left), let
    dots wobble off the outline (finale outer ring, rings), and starved
    thin glyphs (the '+' in "E + J" was never counted in the target and
    kept ~3 dots). Outline shapes now get evenly spaced points along
    their true contour by arc length; words are thinned one point per
    grid cell, every non-space character counts, and the font is bigger.
    Starburst is a real 12-point star outline (not 13 blobs = asterisk)
    with a gentle breathing pulse; the rings get a proper diamond outline
    gem on the right ring instead of a filled triangle blob.
    """
    start = html.find("        function sample(drawFn, target) {")
    end = html.find("        var drones = [], targets = [], startTime = 0, currentName = '';")
    assert start != -1 and end != -1 and start < end, "studio block anchors not found"
    html = html[:start] + STUDIO_ENGINE + html[end:]
    html = rep(html,
               "setFormation(sample(SHAPES.heart.draw, FLEET.heart), SHAPES.heart.name, PALETTES.heart);",
               """setFormation(SHAPES.heart.points(FLEET.heart), SHAPES.heart.name, PALETTES.heart);
        // Fleet counts on the buttons come from FLEET, not from hardcoded
        // HTML, so the button labels can never drift from the real counts.
        document.querySelectorAll('[data-fleet]').forEach(function (el) {
          var n = FLEET[el.getAttribute('data-fleet')];
          if (typeof n === 'number') el.textContent = n;
        });""")
    html = rep(html,
               "setFormation(sample(SHAPES[key].draw, FLEET[key]), SHAPES[key].name, PALETTES[key]);",
               "setFormation(SHAPES[key].points(FLEET[key]), SHAPES[key].name, PALETTES[key]);")
    html = rep(html,
               "            d.y = d.sy + (d.ty - d.sy) * e + Math.sin(t * 1.8 + d.ph) * (lt >= 1 ? 1.6 : 0);\n",
               "            d.y = d.sy + (d.ty - d.sy) * e + Math.sin(t * 1.8 + d.ph) * (lt >= 1 ? 1.6 : 0);\n            if (currentName === 'Starburst') { var pulse = 1 + .03 * Math.sin(t * 2.2); d.x = W / 2 + (d.x - W / 2) * pulse; d.y = H / 2 + (d.y - H / 2) * pulse; }\n            if (currentName === 'Grand finale') { var rot = t * .15, co = Math.cos(rot), si = Math.sin(rot), dx = d.x - W/2, dy = d.y - H/2; d.x = W/2 + dx*co - dy*si; d.y = H/2 + dx*si + dy*co; }\n")
    return html


if __name__ == "__main__":
    main()
