# Editing the site content — drone light shows site

How to change the words and photos on the When&Where drone light
shows site without touching code. Written for two sets of eyes: the
**editor** (the person updating copy and photos) and the
**manager/developer** (the person who owns the repo and the Sheet).

The short version: **the copy lives in a Google Sheet, not in the
code.** Edit a cell, save, reload the page — the change is live. No
push, no redeploy, no GitHub account needed for copy edits.

## How it works

Every bit of editable copy on the page is tagged with a **key** (for
example `hero-kicker`, `occ-heading`, `faq-1-q`). The page reads a
table of those keys from a Google Sheet and swaps the matching text
and images in. The text baked into `index.html` stays as the fallback,
so the page is never blank.

The content Sheet (published as CSV):

`https://docs.google.com/spreadsheets/d/e/2PACX-1vRBNnmT-q8v3IJ_iuMcxVFdJ001to_gjZiFQlxkXo0RDxGOQ2rIryhx3jTOwsY4KB7wcbZlOMw4T0ZD/pub?gid=0&single=true&output=csv`

The Sheet has four columns — `key | text | image | alt` — one row per
item. Text rows fill in `text`; image rows fill in `image` (a filename
in `assets/`, e.g. `assets/weddings.jpg`, or a full URL) and `alt`
(the accessibility description — the words a screen reader reads for
the photo). Image size is set by the page's CSS, not the Sheet. There
are 133 rows: 126 text items and 7 photos.

```mermaid
flowchart LR
    E[Editor edits a cell<br/>in the content Sheet] --> P[Published CSV<br/>updates automatically]
    P --> V[Visitor loads<br/>the page]
    V --> F[Page fetches<br/>the Sheet CSV]
    F -->|ok| A[Tagged text & images<br/>are overridden]
    F -->|fetch fails| J[Page reads<br/>content.json]
    J -->|ok| A
    J -->|also fails| H[Hardcoded HTML<br/>stays as-is]
```

The page fetches with `no-store`, so an edit shows on the next load.
Google can take a few minutes to republish the CSV after an edit — if
a change doesn't appear at once, wait a few minutes and hard-refresh
(`Ctrl+Shift+R` / `Cmd+Shift+R`).

### Who can edit the Sheet

The published CSV link is **read-only** — anyone who finds it can read
the site's current copy (the same words already public on the website),
but they cannot change anything through it. Editing is controlled
separately, by the Sheet's **Share** settings. Lock it down like this:

1. Open the Sheet → **Share** (top right).
2. Under **General access**, choose **Restricted** — "Only people
   added can open".
3. Add the accounts that should be able to edit (your Gmail, and
   anyone else who edits copy) and set each to **Editor**.
4. Leave **File → Share → Publish to web** turned on — that's the
   read-only copy the page fetches, and restricting Share does not
   turn it off or break the page.

If the Sheet is ever set to "Anyone with the link can edit", then
anyone who gets the Sheet's edit link can change the site's copy.
Keep it Restricted.

## The editor's view — changing copy

### Find the row

Every row's `key` describes where it lives on the page:
`hero-kicker` is the small line above the hero headline,
`occ-heading` is the occasions section's heading, `faq-1-q` /
`faq-1-a` are the first FAQ question and answer, `pkg-sig-title` is
the Signature Show package's name. Use `Ctrl+F` / `Cmd+F` in the
Sheet to find one.

### Edit text — worked example

Say the occasions heading should read "If the night matters, light
up the sky" instead of "If the night matters, put it in the sky":

1. Open the content Sheet, find the `occ-heading` row.
2. Change its `text` cell to `If the night matters, light up the sky`.
3. Save (the Sheet saves itself) and reload the site. Done — no push,
   no redeploy.

That's the whole workflow for any text row: find the key, edit the
cell, reload.

### Rules that will save you a headache

- **Blank cells are ignored.** Clearing a `text` cell does **not**
  clear the text on the page — the loader skips the blank cell and
  the old wording stays. To remove a line of copy entirely, ask the
  developer (the element itself has to come out of the page).
- **A few rows keep markup — keep their tags.** The hero headline and
  two labels carry HTML in their `text` value. For example,
  `hero-headline` reads:

  `Your story,<br />written in <span class="gold">light</span> across the sky.`

  The `<span class="gold">…</span>` makes a word gold and `<br />` is
  a line break. When you edit one of these rows, change the words but
  **keep the tags exactly as they are** — delete a `<br />` and two
  lines collapse into one; delete a `</span>` and the gold runs on
  into the next line. The rows with markup are: `hero-headline`,
  `form-label-phone`, `form-contact`. Every other row is plain text —
  type normally.
- **Commas and quotes are fine.** The Sheet handles them; the page's
  CSV parser reads quoted values correctly. An apostrophe in "we'll"
  is no problem.
- **Don't rename a key.** The page looks the row up by its key. Rename
  `occ-heading` and the page stops finding it — the old hardcoded
  heading comes back and your new row is ignored.

## The editor's view — changing a photo

A photo is one row: `image` says which file to show, `alt` says what
it shows. There are two ways to point at a new photo.

### Option A — a file in the repo (recommended)

The photo lives in the site's `assets/` folder, versioned in git
alongside everything else.

1. Get the new photo ready — a JPEG. The build downsizes it for you
   (hero to 1248px wide, occasion cards to 900px), so upload the
   full-size file.
2. Upload it to `assets/` in the repo. In GitHub: open the repo →
   `assets/` → **Add file → Upload files** → drag the photo in →
   **Commit changes**. Name it clearly, e.g.
   `assets/weddings-real.jpg`.
3. In the content Sheet, find the photo's row (for the weddings card,
   that's `img-weddings`) and set its `image` cell to the filename:
   `assets/weddings-real.jpg`.
4. Update the `alt` cell too — it should describe the **new** photo,
   not the old one. The current weddings alt is: *"Three glowing
   hearts formed by drones, reflected in a lake at night"*.
5. Reload the site. The new photo is live.

```mermaid
flowchart TD
    U[Upload the photo<br/>to assets/ in the repo] --> S[Set the image cell<br/>to assets/your-photo.jpg]
    S --> A[Update the alt cell<br/>to describe the new photo]
    A --> R[Reload the site —<br/>the new photo is live]
    U2[Use a hosted URL instead] --> S2[Set the image cell<br/>to the full URL]
    S2 --> C[Developer adds the host<br/>to the page's CSP img-src]
    C --> A
```

### Option B — a full URL

If the photo lives somewhere else on the web (a hosted image, a
public Drive link), put the full URL in the `image` cell instead of
a filename. **But this site has a Content Security Policy, and its
`img-src` currently allows only the site itself and `data:` URLs —
an external image is blocked until a developer adds its host to
`img-src` in `index.html` and pushes.** So for this site, Option A
is the one that works without a developer; Option B needs a
one-line code change first. The trade-off either way: a URL-hosted
image isn't versioned with the site, and if the host moves or
deletes it, the page shows a broken image.

### Which photo is which

| Key | Where it shows |
|---|---|
| `img-weddings` | The weddings occasion card |
| `img-proposals` | The proposals occasion card |
| `img-corporate` | The corporate occasion card |
| `img-festivals` | The festivals occasion card |
| `img-alumni` | The alumni occasion card |
| `img-vineyards` | The vineyards occasion card |

## What the page does on load

```mermaid
sequenceDiagram
    participant B as Browser
    participant S as Sheet CSV<br/>(published link)
    participant J as content.json<br/>(in the repo)
    participant H as Hardcoded HTML
    B->>S: fetch CONTENT_CSV_URL
    alt Sheet answers
        S-->>B: key → {text, image, alt}
        B->>B: override tagged elements
    else Sheet unreachable
        B->>J: fetch content.json
        alt content.json answers
            J-->>B: same key → value map
            B->>B: override tagged elements
        else content.json also fails
            B->>H: keep the hardcoded text
        end
    end
```

The fallback chain is why the page never goes blank: the Sheet is the
live source, `content.json` is the frozen copy from the last push, and
the hardcoded HTML is the last resort. `content.json` holds the same
133 keys as the Sheet, so the fallback looks identical — the only
difference is that edits made in the Sheet after the last push don't
show until the Sheet answers again.

One detail worth knowing: the published Sheet URL redirects to a
per-document `doc-*-sheets.googleusercontent.com` host, and the
page's Content Security Policy allows that redirect through a
`https://*.googleusercontent.com` entry in `connect-src`. If the
Sheet is ever re-published under a new link, the redirect host changes
with it — but the wildcard still covers it, so only `CONTENT_CSV_URL`
in `config.js` needs updating, not the policy.

## What's not in the Sheet

Some things are app behaviour, not copy, and stay in the code:

- **Nav labels** (Home, Occasions, Packages, …) — structural.
- **The Formation Studio's shape buttons and drone counts** — the
  counts come from `FLEET` in `config.js`; the buttons are the app.
- **The submit button and the form note** — the form's mode sets them
  in JS (the note changes depending on whether the inquiry endpoint
  is configured).
- **The send-failure result panel** and the **validation messages**
  ("Please enter your name", …) — dynamic, shown by the form.
- **The checkbox and radio option labels** (e.g. the package choices,
  the "surprise" tickbox) — they contain the `<input>` elements, so
  overriding their text would wipe the control.

To change one of those, or to add a new editable bit of copy, that's a
developer job: tag the element with `data-content="new-key"` (or
`data-content-img` for an image), add the row to the Sheet **and** to
`content.json`, and push. The loader picks the new key up with no
other code change.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| I edited a cell, the page still shows the old text | Google hasn't republished the CSV yet, or the browser cached the page | Wait a few minutes, then hard-refresh (`Ctrl+Shift+R`) |
| I edited a cell, the page shows the old text after an hour | The key was renamed, or the edit went in the wrong row | Check the `key` column — the page looks the row up by key, not by position |
| A line of text vanished / the gold ran on | A tag was deleted from an HTML row (`hero-headline`, `form-label-phone`, `form-contact`) | Restore the `<span>`, `</span>` or `<br />` from `content.json` (it holds the last good values) |
| A photo shows as broken | The `image` cell points at a file that isn't in `assets/`, or a URL that moved | Check the filename spelling (`assets/weddings.jpg`, not `weddings.jpg`); re-upload the file if it's missing |
| A photo from a URL shows as broken | The host isn't in the page's CSP `img-src` | Ask the developer to add the host to `img-src` in `index.html` and push |
| Everything reverted to the old copy | The Sheet is unreachable (or its publish was turned off) and the page fell back to `content.json` | Check the Sheet is still published (File → Share → Publish to web) and the link in `CONTENT_CSV_URL` matches |
| I cleared a cell and the text is still there | That's by design — blank cells are ignored | Put the text you want in the cell; to remove the line entirely, ask the developer |

## Manager / developer routine

- **The Sheet is the live source.** Copy edits need no push and no
  redeploy. A push is only needed when the page itself changes (new
  sections, new keys, a new photo file in `assets/`, a CSP change).
- **Keep `content.json` in step.** It is the fallback, and it's what
  the page shows if the Sheet is unreachable. Whenever a batch of
  Sheet edits is done, copy the Sheet's current contents back into
  `content.json` (export the Sheet as CSV, or copy
  `docs/content.csv` — the repo holds the same table) and push, so
  the fallback never goes stale.
- **`docs/content.csv` is the Sheet's seed.** It's the table as of the
  last push. If the Sheet is ever lost, paste this file into a new
  Sheet, publish it, and put the new link in `CONTENT_CSV_URL` in
  `config.js`.
- **If the Sheet is re-published under a new link**, update
  `CONTENT_CSV_URL` in `config.js` and push — the page reads that
  one URL. The CSP wildcard already covers the new redirect host.
- **Adding a new editable bit:** tag the element, add the row to the
  Sheet and to `content.json`, push. The loader needs no code change.
- **External image URLs:** add the host to `img-src` in `index.html`
  (currently `'self' data:` only) and push, or the image is blocked
  by the CSP even though the Sheet cell is right.

## Automatic vs manual

| Step | Automatic | Manual |
|---|---|---|
| Edit text or a photo's `alt` in the Sheet | Published CSV updates; page picks it up on next load | Find the right row, type the new value |
| Swap a photo to a repo file | Build downsizes it on push; page shows it once the cell points at it | Upload the file to `assets/`, update the `image` cell |
| Swap a photo to a URL | Page shows it once the cell points at it | Paste the URL in the `image` cell **and** get the host added to `img-src` |
| Add a new editable section | Nothing — it's a code change | Tag the element, add the row to Sheet + `content.json`, push |
| Sheet unreachable | Page falls back to `content.json`, then hardcoded HTML | Re-publish the Sheet or fix the link |
| New package or FAQ entry | Nothing — it's a code change (new keys) | Tag the new elements, add the rows, push |

## Gaps

- There is no history in the Sheet beyond Google's own version
  history (File → Version history) — if a bad edit goes in, restore
  the earlier version there.
- There is no preview: the only way to see an edit is to load the
  live page (or a local copy of the repo served over HTTP).
- `content.json` only updates when someone copies the Sheet back
  into the repo and pushes — it can drift behind the Sheet.
- A photo swap to a repo file needs a GitHub upload, which needs a
  GitHub account with write access — the one step in this doc that
  isn't Sheet-only.
- An external image URL needs a developer's one-line CSP change —
  the editor can't do that step alone.
