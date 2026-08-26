# Mint Kids

A walled-garden YouTube player for a Samsung TV: only whitelisted kids' channels
are reachable, with no search, no recommendations and no way out to full YouTube.

## Why it is a hosted app, not a packaged one

YouTube's IFrame player refuses to start with error 153 unless the embedding page
sends a usable HTTP `Referer`. A packaged Tizen app loads from `file://` and so
sends none. The app is therefore published as static files and the `.wgt` on the TV
is a thin shell whose `config.xml` points `<content src>` at that URL.

## Layout

    docs/     the app itself — published by GitHub Pages
    tizen/    config.xml + icon for the .wgt shell installed on the TV
    serve.py  local dev server for docs/, caching disabled

`docs/index.html` is a frozen bootstrap: never edit it. It loads `app.css` and
`app.js` with a cache-busting query so edits show up on a plain app restart.
Changing `index.html` or `config.xml` means repackaging and reinstalling.
