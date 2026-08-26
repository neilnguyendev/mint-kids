# Mint Kids

A walled-garden YouTube player for a Samsung TV: only channels the parent has
listed are reachable, with no search, no recommendations and no way out to full
YouTube.

## No API key anywhere

Every piece of data is read without a YouTube Data API key:

| Data | Source |
|---|---|
| Channel list | a published Google Sheet, read live (it sends CORS headers) |
| Videos per channel | the channel's uploads playlist, read through the IFrame player |
| Video titles | oEmbed |
| Thumbnails | `i.ytimg.com/vi/<id>/hqdefault.jpg` via a plain `<img>` |

The playlist is read *through the player* rather than fetched, because the
obvious source — the per-channel RSS feed — sends no CORS headers at all and is
unreachable from browser JavaScript. Pointing the player at a playlist makes
YouTube fetch the list on our behalf, so no cross-origin request is ever issued
by this code. A test in `tests/data-access.spec.js` asserts RSS is still blocked,
to stop a future refactor "simplifying" the indirection away.

A channel pasted into the Sheet as a `/channel/UC…` URL works the moment the
Sheet is saved. A bare `@handle` cannot be resolved in the browser — youtube.com
sends no CORS headers and oEmbed 404s on channel URLs — so handles are resolved
by `scripts/resolve-handles.py` and committed to `docs/handles.json`.

## Why it is a hosted app, not a packaged one

YouTube's IFrame player refuses to start with error 153 unless the embedding
page sends a usable HTTP `Referer`. A packaged Tizen app loads from `file://` and
so sends none. The app is therefore published as static files and the `.wgt` on
the TV is a thin shell whose `config.xml` points `<content src>` at that URL.

## Layout

    docs/       the app — published by GitHub Pages
      index.html  frozen bootstrap: never edit, see below
      app.js      everything
      app.css     TV-first styling, 1920x1080
      handles.json  @handle -> channel id, generated
    tizen/      config.xml + icon for the .wgt shell installed on the TV
    scripts/    resolve-handles.py
    tests/      Playwright end-to-end suite
    serve.py    local dev server for docs/, caching disabled

`docs/index.html` loads `app.css` and `app.js` with a cache-busting query, so
edits show up on a plain app restart. That indirection exists because Tizen's
WebView caches the hosted entry page hard enough that a restart otherwise
re-renders the old build without even contacting the server. Changing
`index.html` or `config.xml` means repackaging and reinstalling the `.wgt`.

## Working on it

    npm run serve     # http://localhost:8080
    npm test          # Playwright, drives a real Chromium

The tests hit live YouTube and the live Sheet on purpose: they are there to catch
the day one of those stops working without a key.

Playwright runs Chromium on a desktop, not the TV's WebView. To check something
on the real device without repackaging, open the TV's Browser at the dev server's
LAN address.
