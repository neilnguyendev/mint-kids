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

### The Sheet is unreliable, on purpose-built fallbacks

Google throttles reads of the published Sheet from a browser origin hard —
measured at three successes in eight consecutive tries, the rest hanging past
twelve seconds. Server-side it answers in about a second every time, so this is
per-origin rate limiting, not an outage. The app therefore never depends on it:

1. the live Sheet, with an 8s timeout — authoritative when it answers, so a
   channel the parent deletes disappears on the next launch
2. the last live answer, cached in `localStorage`
3. `docs/channels.json`, a copy committed beside the app — same-origin and so
   always reachable, which is what makes a TV that has never managed a live read
   still work

The screen says which one it fell back to. `scripts/resolve-handles.py` refreshes
both `handles.json` and `channels.json`, and retries, because the Sheet drops
server-side requests too.

**Rerun it after changing a setting in the Sheet.** The snapshot carries the
allowance and the PIN as well as the channels, so a stale one hands the app an
old PIN — or, if it predates the settings entirely, no PIN at all, which locks
the parent out of the out-of-time screen at exactly the moment the PIN is for. A
test covers that case.

Every UI test stubs the Sheet for the same reason; the live one has a single
dedicated test that asserts it is reachable *at all* rather than on demand.

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

## Remote vocabulary

The player screen has two modes, and the arrow keys mean different things in
each — the same split the YouTube TV app uses, so the household already knows it.

| | Watching | Grid pulled up over the video |
|---|---|---|
| Down | open the grid | next row |
| Up | — | previous row; closes the grid from the top row |
| Left / Right | scrub -10s / +10s | move along the row |
| OK | pause / resume | play that video |
| Back | leave the video | close the grid, keep watching |

Left and right deliberately do *not* skip tracks: a stray press should not lose
the thing the child was watching. Because the player runs with `controls: 0`
there is no scrubber, so a seek draws its own readout — without it a press looks
like nothing happened.

## Settings in the Sheet

Two settings live in the same Sheet as the channels. Either layout works, since
both are things a person naturally does with a spreadsheet — a heading with its
value underneath:

| A: YouTube channel | B: Số phút tối đa / ngày | C: Mật khẩu để reset số phút (4 số) |
|---|---|---|
| `https://youtube.com/@Numberblocks` | `30` | `1234` |

or a key beside its value:

| A: YouTube channel | B | C |
|---|---|---|
| `https://youtube.com/@Numberblocks` | `số phút` | `30` |
| `https://youtube.com/@SciShowKids` | `mật khẩu` | `1234` |

The name is looked for *inside* the cell with accents, case and punctuation
folded away, so a heading that describes itself is still understood: anything
containing `số phút` / `phút` / `minute` is the allowance, and anything
containing `mật khẩu` / `pin` / `password` is the PIN. The PIN is checked first,
because `Mật khẩu để reset số phút` names both and the more specific reading is
the right one. A PIN that is not exactly four digits is ignored rather than
half-honoured, and with no PIN set the keypad never appears — an empty keypad
inviting presses that cannot work is worse than none.

## Screen time

A countdown sits in the top-right corner and stays above the player, because the
moment a child most needs to see time running out is mid-video. When it reaches
zero the app says `Đã xem hết giờ hôm nay`, stops whatever is playing and stops
responding to everything except leaving.

The budget is **per day, not per session**. It is held in `localStorage` against
today's date and reset on the first run of a new day — a countdown that starts
over when the app restarts is defeated by turning the app off and on again. Time
is spent whenever the app is open and on screen, browsing included, not only
while a video plays. A gap longer than a few seconds is assumed to be the app
having been suspended and is not charged, so switching the TV off overnight does
not silently eat tomorrow's half hour.

`QUOTA_MINUTES` at the top of `docs/app.js` is only the default, used until the
Sheet's own value arrives — the countdown has to be running before the Sheet
answers, or the first seconds of every session would be free.

The countdown badge is a focus stop: pressing up from the top row of the grid, or
from a playing video, lands on it. OK there offers two things:

- **Đặt lại thời gian** — the PIN, then the whole day back
- **Khoá luôn** — end the day now, no PIN asked for

Locking early needs no PIN because it takes time away rather than granting it,
and the PIN is still there to undo it; guarding it would only slow the parent
down at the moment they want it. Back cancels and returns to whatever was on — a
video carries on playing throughout, and topping the time up does not interrupt
it.

The same screen serves both errands, and they differ in one way that matters: a
reset the parent opened can be dismissed with Back, while running out of time
cannot, or the limit is one button press away from meaningless.

The out-of-time screen is not a dead end, but the way onward is a step removed:
it shows the message and a single **Đặt lại thời gian** button, and the keypad
only appears once that is pressed. A keypad sitting on the screen is an
invitation for a child to try codes, and the message is the part they are meant
to read. Back steps out of the keypad, back to the button — not off the screen.

Behind it, the parent's four-digit PIN hands the day back. The keypad exists because a TV remote
has no keyboard and the current ones have no number buttons either; it is
navigable with the four arrows and OK alone, and also takes digits directly from
remotes that can send them. Entry is masked, the fourth digit submits by itself,
and a wrong code clears the boxes rather than leaving them stuck full.

## Working on it

    npm run serve     # http://localhost:8080
    npm test          # Playwright, drives a real Chromium

The tests hit live YouTube and the live Sheet on purpose: they are there to catch
the day one of those stops working without a key.

Playwright runs Chromium on a desktop, not the TV's WebView. To check something
on the real device without repackaging, open the TV's Browser at the dev server's
LAN address.
