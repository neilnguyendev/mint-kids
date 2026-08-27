/**
 * Mint Kids — a walled garden over YouTube.
 *
 * Channels come from a published Google Sheet, video lists come from each
 * channel's uploads playlist read through the IFrame player, and titles come
 * from oEmbed. None of it needs a YouTube API key. See README.md for why the
 * playlist has to be read through the player rather than fetched.
 */

// ---------------------------------------------------------------- config ----

var SHEET_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vScJOEVp-KGJPXKnyS56qFBN-' +
  '400qvNW_P1EUGBcGA9BfXJZV3VQUD_m2afqdFull9zxBJv3dpDsAmX/pub?gid=0&single=true&output=csv';

// YouTube caps a playlist read at 200 entries anyway; this trims further so a
// row stays navigable with a remote instead of endless.
var MAX_PER_ROW = 60;

// Behaviour at the end of a video. YouTube itself rolls straight on; flip this
// to false to drop back to the grid after every video instead.
var AUTOPLAY_NEXT = true;

// Daily screen-time budget. It is spent whenever the app is open and on screen,
// not only while a video plays — browsing the grid is screen time too.
// Used only until the Sheet says otherwise; see readSettings.
// TEMPORARY: 2 instead of 30 so the limit can be exercised by hand. Put it back.
var QUOTA_MINUTES = 2;

// A parent's PIN is exactly four digits, entered on a keypad with a remote.
var PIN_LENGTH = 4;
var QUOTA_KEY = 'mintkids.quota';

// The channel list comes from a third party we do not control, so the wait for
// it is bounded and the last good answer is kept as a fallback.
var CHANNELS_CACHE_KEY = 'mintkids.channels';
var SHEET_TIMEOUT_MS = 8000;

var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, ESC: 27 };

// How far one press of left/right jumps while a video is playing.
var SEEK_STEP_SECONDS = 10;

// How long the seek readout stays up. Long enough for a child to read a
// timestamp, short enough not to camp on the picture.
var SEEK_HINT_MS = 2500;

// ------------------------------------------------------------------ dom -----

var app = document.createElement('div');
app.id = 'app';
app.innerHTML =
  '<header id="top">' +
    '<img id="logo" src="logo.png" alt="">' +
    '<h1>Mint Kids</h1>' +
    '<div id="status">Đang tải danh sách kênh…</div>' +
  '</header>' +
  '<main id="rows"></main>' +
  '<div id="stage" hidden><div id="player"></div><div id="nowplaying"></div>' +
    '<div id="seekhint" hidden></div></div>' +
  '<div id="clock"><span id="clock-time">--:--</span></div>' +
  '<div id="timeup" hidden><div class="panel">' +
    '<div class="big">Đã xem hết giờ hôm nay</div>' +
    '<div class="small">Mai mình xem tiếp nhé</div>' +
    '<div id="resetbtn" role="button" hidden>Đặt lại thời gian</div>' +
    '<div id="pinbox" hidden>' +
      '<div class="pin-label">Bố mẹ nhập mật khẩu để xem thêm</div>' +
      '<div class="pin-cells"></div>' +
      '<div class="pin-error">&nbsp;</div>' +
      '<div class="keypad"></div>' +
    '</div>' +
  '</div></div>';
document.body.appendChild(app);

var rowsEl = document.getElementById('rows');
var statusEl = document.getElementById('status');
var stageEl = document.getElementById('stage');
var nowEl = document.getElementById('nowplaying');
var clockEl = document.getElementById('clock');
var clockTimeEl = document.getElementById('clock-time');
var timeUpEl = document.getElementById('timeup');
var seekHintEl = document.getElementById('seekhint');
var timeUpTitleEl = timeUpEl.querySelector('.big');
var timeUpSubEl = timeUpEl.querySelector('.small');
var resetBtnEl = document.getElementById('resetbtn');
var pinBoxEl = document.getElementById('pinbox');
var pinCellsEl = pinBoxEl.querySelector('.pin-cells');
var pinErrorEl = pinBoxEl.querySelector('.pin-error');
var keypadEl = pinBoxEl.querySelector('.keypad');

function setStatus(text, isError) {
  statusEl.textContent = text || '';
  statusEl.classList.toggle('error', !!isError);
}

// ------------------------------------------------------------- utilities ---

/** Minimal CSV reader — enough for one column of URLs, quotes included. */
function parseCsv(text) {
  var rows = [], row = [], field = '', quoted = false;
  for (var i = 0; i < text.length; i++) {
    var c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(function (r) { return r.some(function (c) { return c.trim(); }); });
}

/** Fold a spreadsheet heading down to something matchable: lower case, no
 *  Vietnamese accents, no spaces or punctuation. The parent types these by hand
 *  into a spreadsheet, so "Số phút", "so phut" and "minutes" must all land. */
function normKey(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// Markers looked for *inside* a heading rather than matched against it whole.
// A parent writes "Số phút tối đa / ngày", not "sophut", and a heading that
// describes itself should still be understood.
var MINUTE_MARKERS = ['sophut', 'phut', 'minute'];
var PIN_MARKERS = ['matkhau', 'pin', 'password'];

function hasMarker(key, markers) {
  for (var i = 0; i < markers.length; i++) {
    if (key.indexOf(markers[i]) >= 0) return true;
  }
  return false;
}

var SETTING_READERS = {
  // Checked before minutes: "Mật khẩu để reset số phút" mentions both, and the
  // more specific reading is the right one.
  pin: {
    markers: PIN_MARKERS,
    parse: function (text) { return /^\d{4}$/.test(text) ? text : null; }
  },
  minutes: {
    markers: MINUTE_MARKERS,
    parse: function (text) {
      var n = parseInt(text, 10);
      return n > 0 && String(n) === text.replace(/[^0-9]/g, '') ? n : null;
    }
  }
};

/**
 * Settings live in the same sheet as the channels. Two layouts both work,
 * because both are things a person naturally does with a spreadsheet:
 *
 *   a heading with its value underneath      a key beside its value
 *   ┌───────────────┬─────────┐              ┌──────────┬──────────┬─────┐
 *   │ Số phút / ngày│ Mật khẩu│              │ <channel>│ số phút  │ 30  │
 *   ├───────────────┼─────────┤              ├──────────┼──────────┼─────┤
 *   │ 30            │ 1234    │              │ <channel>│ mật khẩu │ 1234│
 *
 * So from the cell naming a setting, the value is looked for to the right first
 * and then down the same column, taking the first cell that is actually a valid
 * value for that setting. That also means a heading sitting next to another
 * heading is skipped rather than read as its value.
 */
function readSettings(rows) {
  var found = {};

  rows.forEach(function (cells, rowIndex) {
    cells.forEach(function (cell, colIndex) {
      var key = normKey(cell);
      if (!key) return;

      var name = null;
      if (hasMarker(key, SETTING_READERS.pin.markers)) name = 'pin';
      else if (hasMarker(key, SETTING_READERS.minutes.markers)) name = 'minutes';
      if (!name || found[name] !== undefined) return;

      var candidates = [(cells[colIndex + 1] || '')];
      for (var r = rowIndex + 1; r < rows.length; r++) {
        candidates.push((rows[r] || [])[colIndex] || '');
      }

      for (var i = 0; i < candidates.length; i++) {
        var value = SETTING_READERS[name].parse(String(candidates[i]).trim());
        if (value !== null) { found[name] = value; return; }
      }
    });
  });

  return found;
}

/** A channel id can be pasted bare or inside a /channel/ URL, and works the
 *  moment the Sheet is saved. A bare @handle cannot be resolved in the browser
 *  — youtube.com sends no CORS headers and oEmbed 404s on channel URLs — so it
 *  is looked up in handles.json, regenerated by scripts/resolve-handles.py. A
 *  handle missing from that map is reported, never silently dropped. */
function readChannelCell(cells, handleMap) {
  var joined = cells.join(' ');
  var id = joined.match(/(UC[\w-]{22})/);
  if (id) return { id: id[1] };
  var handle = joined.match(/@([A-Za-z0-9._-]+)/);
  if (!handle) return null;
  var name = '@' + handle[1];
  var mapped = handleMap[name.toLowerCase()];
  return mapped ? { id: mapped, handle: name } : { handle: name };
}

/**
 * A fetch that gives up. Without this, one slow response from Google leaves the
 * screen sitting on "loading" forever — which on a TV is indistinguishable from
 * a broken app, with no way for a child to recover.
 */
function fetchWithTimeout(url, ms) {
  return new Promise(function (resolve, reject) {
    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      reject(new Error('quá ' + Math.round(ms / 1000) + ' giây không phản hồi'));
    }, ms);
    fetch(url).then(function (r) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    }, function (e) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
  });
}

/** Remembers the last channel list that loaded, so a failure to reach the Sheet
 *  degrades to yesterday's list instead of an empty screen. The Sheet is still
 *  tried first every launch: a channel the parent removes has to disappear
 *  promptly, which a cache-first order would delay by a session. */
var channelCache = {
  read: function () {
    try {
      var raw = window.localStorage.getItem(CHANNELS_CACHE_KEY);
      var parsed = raw && JSON.parse(raw);
      if (parsed && parsed.csv) return parsed;
    } catch (e) {}
    return null;
  },
  write: function (csv) {
    try {
      window.localStorage.setItem(CHANNELS_CACHE_KEY, JSON.stringify({ csv: csv, at: Date.now() }));
    } catch (e) {}
  }
};

/** Runs jobs with a ceiling on how many are in flight, so a row of sixty
 *  cards does not open sixty sockets at once. */
function pooled(limit) {
  var active = 0, queue = [];
  function pump() {
    while (active < limit && queue.length) {
      var job = queue.shift();
      active++;
      job.run().then(job.ok, job.fail).then(function () { active--; pump(); });
    }
  }
  return function (run) {
    return new Promise(function (ok, fail) { queue.push({ run: run, ok: ok, fail: fail }); pump(); });
  };
}

/**
 * oEmbed is the only keyless source for a video's title — and, via author_name,
 * for its channel's display name. One request answers both, so it is cached and
 * shared rather than fetched twice, and it goes through a pool: fifteen rows
 * firing at once got throttled and the channel headings silently stayed as raw
 * @handles.
 */
var fetchMeta = (function () {
  var pool = pooled(6), cache = {};
  return function (videoId) {
    if (!cache[videoId]) {
      cache[videoId] = pool(function () {
        return fetch('https://www.youtube.com/oembed?format=json&url=' +
          encodeURIComponent('https://www.youtube.com/watch?v=' + videoId))
          .then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; });
      });
    }
    return cache[videoId];
  };
})();

function fetchTitle(videoId) {
  return fetchMeta(videoId).then(function (m) { return m && m.title; });
}

// ------------------------------------------------- playlist via the player --

/**
 * One hidden player, reused. Pointing it at a channel's uploads playlist makes
 * YouTube fetch the list on our behalf, which is what sidesteps CORS entirely —
 * we never issue the cross-origin request ourselves.
 */
var playlistReader = (function () {
  var apiPromise = null;

  function apiReady() {
    if (apiPromise) return apiPromise;
    apiPromise = new Promise(function (resolve, reject) {
      if (window.YT && window.YT.Player) return resolve();
      window.onYouTubeIframeAPIReady = resolve;
      var s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = function () { reject(new Error('Không tải được YouTube IFrame API')); };
      document.head.appendChild(s);
    });
    return apiPromise;
  }

  /**
   * Each channel gets its own throwaway player with the playlist supplied at
   * construction. Re-pointing one shared player with cuePlaylist() looks like it
   * works but returns the PREVIOUS channel's list for a full cycle, which
   * silently shifts every row by one and drops the last channel. Building fresh
   * costs an iframe per channel and is worth it.
   */
  function read(uploadsId) {
    return apiReady().then(function () {
      return new Promise(function (resolve) {
        var host = document.createElement('div');
        host.className = 'probe';
        document.body.appendChild(host);

        var settled = false;
        function finish(list) {
          if (settled) return;
          settled = true;
          try { player.destroy(); } catch (e) {}
          if (host.parentNode) host.parentNode.removeChild(host);
          resolve((list || []).slice(0, MAX_PER_ROW));
        }

        var player = new YT.Player(host, {
          height: 1,
          width: 1,
          playerVars: { autoplay: 0, controls: 0, listType: 'playlist', list: uploadsId },
          events: {
            onReady: function () {
              var tries = 0;
              (function poll() {
                if (settled) return;
                var list = player.getPlaylist();
                if (list && list.length) return finish(list);
                if (++tries > 40) return finish([]);
                setTimeout(poll, 250);
              })();
            },
            onError: function () { finish([]); }
          }
        });
      });
    });
  }

  return { read: read };
})();

// -------------------------------------------------------------- rendering --

var rows = [];        // filled rows, kept in Sheet order
var focus = { row: 0, col: 0 };

// The countdown badge is a focus stop of its own, reached by pressing up from
// the top row or from a playing video. It is only reachable when a PIN exists,
// since resetting the day is all it does.
var clockFocused = false;

/**
 * A row's shell is created immediately, in Sheet order, so channels can be
 * loaded concurrently without the finish order deciding what the viewer sees.
 * The heading starts as the handle from the Sheet and is replaced by the real
 * channel name once the first video's metadata arrives — there is no keyless
 * endpoint that names a channel directly.
 */
function createRow(channel, order) {
  var row = document.createElement('section');
  row.className = 'row loading';

  var heading = document.createElement('h2');
  heading.textContent = channel.handle || channel.id;
  row.appendChild(heading);

  var strip = document.createElement('div');
  strip.className = 'strip';
  row.appendChild(strip);

  rowsEl.appendChild(row);
  return { el: row, heading: heading, strip: strip, cards: [], channel: channel, order: order };
}

function fillRow(record, videoIds) {
  // A channel that yields nothing leaves no trace: an empty row is worse than
  // no row, because it looks like something failed to load and never recovers.
  if (!videoIds.length) {
    if (record.el.parentNode) record.el.parentNode.removeChild(record.el);
    return;
  }

  record.cards = videoIds.map(function (videoId, colIndex) {
    // Deliberately a div, not a <button>: Chrome blockifies everything inside a
    // button subtree, which turns display:-webkit-box into flow-root and
    // silently disables -webkit-line-clamp on the caption. Focus here is drawn
    // and moved by this app, so a button's native behaviour buys nothing.
    var card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('role', 'button');

    var body = document.createElement('span');
    body.className = 'body';
    card.appendChild(body);

    var img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = '';
    img.src = 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg';
    body.appendChild(img);

    var cap = document.createElement('span');
    cap.className = 'cap';
    cap.textContent = '…';
    body.appendChild(cap);

    card.addEventListener('click', function () {
      play(rows.indexOf(record), colIndex);
    });
    record.strip.appendChild(card);

    return { el: card, videoId: videoId, cap: cap };
  });

  record.el.classList.remove('loading');
  rows.push(record);
  rows.sort(function (a, b) { return a.order - b.order; });
  observeTitles(record);

  // The first video's metadata also carries the channel's display name; the
  // same cached request serves that card's caption.
  fetchMeta(videoIds[0]).then(function (meta) {
    if (meta && meta.author_name) {
      record.channel.name = meta.author_name;
      record.heading.textContent = meta.author_name;
    }
  });

  if (stageEl.hidden) applyFocus();
}

/**
 * A title costs one request each, so only the cards the viewer can actually
 * reach get one — a row of sixty would otherwise fire sixty requests the moment
 * it appears, for cards nobody has scrolled to.
 */
function observeTitles(record) {
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      io.unobserve(entry.target);
      var card = record.cards.filter(function (c) { return c.el === entry.target; })[0];
      if (!card) return;
      fetchTitle(card.videoId).then(function (title) {
        card.title = title || '';
        card.cap.textContent = title || 'Video';
      });
    });
  }, { root: record.strip, rootMargin: '400px' });
  record.cards.forEach(function (c) { io.observe(c.el); });
}

// --------------------------------------------------------------- focusing --

/** Rows arrive out of order and are then sorted into Sheet order, so the
 *  highlight has to be redrawn whenever the list changes — otherwise it stays
 *  on whichever row happened to load first. Scrolling is only wanted when the
 *  viewer actually pressed something. */
function applyFocus(scroll) {
  clockEl.classList.toggle('focused', clockFocused);
  rows.forEach(function (r, ri) {
    r.cards.forEach(function (c, ci) {
      c.el.classList.toggle('focused', !clockFocused && ri === focus.row && ci === focus.col);
    });
  });
  if (clockFocused) return;
  var row = rows[focus.row];
  if (!row) return;
  var card = row.cards[focus.col];
  if (card && scroll) {
    card.el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    row.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function move(dRow, dCol) {
  if (!rows.length) return;
  if (dRow) {
    focus.row = Math.max(0, Math.min(rows.length - 1, focus.row + dRow));
    focus.col = Math.min(focus.col, rows[focus.row].cards.length - 1);
  }
  if (dCol) {
    focus.col = Math.max(0, Math.min(rows[focus.row].cards.length - 1, focus.col + dCol));
  }
  applyFocus(true);
}

// -------------------------------------------------------------- playback ---

var stagePlayer = null, playing = null, pendingVideoId = null;

// While a video is on screen the grid can be pulled up over it, the way the
// YouTube TV app does: the video keeps playing behind and the rows become the
// way to pick the next one.
var overVideo = false;
var seekHintTimer = null;

/** new YT.Player() hands back an object immediately, but its methods are only
 *  attached once the iframe has loaded. Calling one before then throws, which
 *  once left the player stuck open because closeStage() died half way through.
 *  Every call goes through here. */
function callPlayer(method) {
  var args = Array.prototype.slice.call(arguments, 1);
  try {
    if (stagePlayer && typeof stagePlayer[method] === 'function') {
      return stagePlayer[method].apply(stagePlayer, args);
    }
  } catch (e) {}
  return null;
}

function play(rowIndex, colIndex) {
  var row = rows[rowIndex];
  if (!row) return;
  var card = row.cards[colIndex];
  if (!card) return;

  playing = { row: rowIndex, col: colIndex };
  nowEl.textContent = (card.title || '') + ' — ' + (row.channel.name || '');
  stageEl.hidden = false;

  if (!stagePlayer) {
    pendingVideoId = card.videoId;
    stagePlayer = new YT.Player('player', {
      playerVars: {
        autoplay: 1, controls: 0, rel: 0, modestbranding: 1,
        playsinline: 1,
        // The remote is handled by this app; letting the player bind keys too
        // means Back and the arrows do two things at once.
        disablekb: 1
      },
      videoId: card.videoId,
      events: {
        onReady: function () {
          // The chosen video may already have changed while the iframe loaded.
          if (pendingVideoId) callPlayer('loadVideoById', pendingVideoId);
          pendingVideoId = null;
          callPlayer('playVideo');
        },
        onStateChange: function (e) { if (e.data === YT.PlayerState.ENDED) advance(); },
        onError: function () { advance(); }
      }
    });
  } else if (typeof stagePlayer.loadVideoById === 'function') {
    pendingVideoId = null;
    stagePlayer.loadVideoById(card.videoId);
  } else {
    pendingVideoId = card.videoId;   // still loading; onReady will pick it up
  }
}

function advance() {
  // A late ENDED or error can arrive after the viewer already backed out; it
  // must not pull the player open again.
  if (stageEl.hidden || !playing) return;
  if (!AUTOPLAY_NEXT) return closeStage();
  var row = rows[playing.row];
  var next = playing.col + 1;
  if (!row || next >= row.cards.length) return closeStage();
  play(playing.row, next);
}

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  var total = Math.floor(seconds);
  var m = Math.floor(total / 60);
  var ss = total % 60;
  return m + ':' + (ss < 10 ? '0' : '') + ss;
}

/**
 * Seeking needs its own readout. The player runs with controls:0, so there is no
 * scrubber and no other sign that a press did anything — without this, pressing
 * left just looks broken until the picture happens to change.
 */
function seek(deltaSeconds) {
  var at = callPlayer('getCurrentTime');
  var total = callPlayer('getDuration');
  if (typeof at !== 'number') return;

  var target = Math.max(0, at + deltaSeconds);
  if (typeof total === 'number' && total > 0) target = Math.min(target, total - 1);
  callPlayer('seekTo', target, true);

  seekHintEl.textContent =
    (deltaSeconds < 0 ? '\u25C0\u25C0  ' : '\u25B6\u25B6  ') + formatTime(target) +
    (typeof total === 'number' && total > 0 ? ' / ' + formatTime(total) : '');
  seekHintEl.hidden = false;
  clearTimeout(seekHintTimer);
  seekHintTimer = setTimeout(function () { seekHintEl.hidden = true; }, SEEK_HINT_MS);
}

/** Pull the grid up over the playing video. */
function openOverVideo() {
  if (stageEl.hidden || overVideo) return;
  overVideo = true;
  app.classList.add('over-video');
  // Start from whatever is playing, so the child sees where they are before
  // moving — not a highlight parked somewhere unrelated.
  if (playing && rows[playing.row]) {
    focus.row = playing.row;
    focus.col = playing.col;
  }
  applyFocus(true);
}

function closeOverVideo() {
  if (!overVideo) return;
  overVideo = false;
  app.classList.remove('over-video');
  seekHintEl.hidden = true;
}

function closeStage() {
  // Hide first: whatever the player does next, the viewer is already out.
  closeOverVideo();
  seekHintEl.hidden = true;
  stageEl.hidden = true;
  playing = null;
  pendingVideoId = null;
  callPlayer('stopVideo');
  applyFocus();
}

// ------------------------------------------------------------ screen time ---

/**
 * A daily budget, not a per-session one: a countdown that resets when the app
 * restarts is defeated by turning the app off and on again. Time spent is kept
 * in localStorage against today's date and reset on the first run of a new day.
 *
 * Storage can be unavailable — a TV with site data blocked, a private context —
 * so every access is guarded and falls back to counting for this session only.
 * A timer that runs is better than one that throws on startup.
 */
var quota = (function () {
  // The budget starts at the built-in default and is replaced by the Sheet's
  // value when it arrives — the countdown has to be running before then, or the
  // first seconds of every session would be free.
  var budgetMs = QUOTA_MINUTES * 60 * 1000;
  var memory = null;          // fallback when localStorage cannot be used
  var lastTick = Date.now();
  var exhausted = false;

  // The day rolls over at midnight in Vietnam, wherever the device thinks it is.
  // Reading the TV's own clock would hand out a second allowance to a set whose
  // timezone is wrong or unset. Vietnam is UTC+7 year round, with no daylight
  // saving, so a fixed offset is exact rather than an approximation.
  function todayKey() {
    var vn = new Date(Date.now() + 7 * 60 * 60 * 1000);
    return vn.getUTCFullYear() + '-' + (vn.getUTCMonth() + 1) + '-' + vn.getUTCDate();
  }

  function read() {
    try {
      var raw = window.localStorage.getItem(QUOTA_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.day === todayKey() && typeof parsed.usedMs === 'number') {
          return parsed;
        }
      }
    } catch (e) {}
    if (memory && memory.day === todayKey()) return memory;
    return { day: todayKey(), usedMs: 0 };
  }

  function write(state) {
    memory = state;
    try { window.localStorage.setItem(QUOTA_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function remaining() {
    return Math.max(0, budgetMs - read().usedMs);
  }

  /** Adopt the budget from the Sheet. Lowering it below what has already been
   *  spent ends the session immediately, which is the point of lowering it. */
  function setMinutes(minutes) {
    if (!(minutes > 0) || minutes * 60 * 1000 === budgetMs) return;
    budgetMs = minutes * 60 * 1000;
    render();
    if (!exhausted && remaining() === 0) { exhausted = true; onExhausted(); }
  }

  /** Hand back the whole day. Used by the parent PIN on the out-of-time screen. */
  function resetToday() {
    write({ day: todayKey(), usedMs: 0 });
    lastTick = Date.now();
    exhausted = false;
    render();
  }

  function render() {
    var left = remaining();
    var totalSeconds = Math.ceil(left / 1000);
    var mm = Math.floor(totalSeconds / 60);
    var ss = totalSeconds % 60;
    clockTimeEl.textContent = mm + ':' + (ss < 10 ? '0' : '') + ss;
    // "Nearly out" has to scale with the budget: a fixed five minutes leaves the
    // clock permanently amber whenever the allowance is short.
    var lowFrom = Math.min(5 * 60 * 1000, budgetMs * 0.2);
    clockEl.classList.toggle('low', left <= lowFrom && left > 0);
    clockEl.classList.toggle('out', left === 0);
  }

  function spend() {
    var now = Date.now();
    var elapsed = now - lastTick;
    lastTick = now;

    // Time only runs while the app is open and on screen. Closing it pauses the
    // countdown rather than letting the clock keep draining in the background:
    // a suspended app — closed, backgrounded, TV switched off — comes back with
    // an enormous gap, and charging that would silently eat the whole day.
    if (document.hidden) return;
    if (elapsed < 0 || elapsed > 5000) elapsed = 0;

    var state = read();
    state.usedMs += elapsed;
    write(state);
  }

  function tick() {
    spend();
    render();

    if (!exhausted && remaining() === 0) {
      exhausted = true;
      onExhausted();
      return;
    }

    // Midnight can arrive while the app is sitting on the out-of-time screen —
    // a child who ran out at 23:58 should get their time back at 00:00 without
    // having to be told to restart the app.
    if (exhausted && remaining() > 0) {
      exhausted = false;
      timeUpEl.hidden = true;
      applyFocus();
    }
  }

  function start() {
    lastTick = Date.now();
    render();
    if (remaining() === 0) { exhausted = true; onExhausted(); }
    setInterval(tick, 1000);
    // Coming back from a suspend must not be billed as elapsed time.
    document.addEventListener('visibilitychange', function () { lastTick = Date.now(); });
  }

  return {
    start: start,
    remaining: remaining,
    setMinutes: setMinutes,
    resetToday: resetToday,
    isExhausted: function () { return exhausted; }
  };
})();

function onExhausted() {
  closeStage();
  blurClock();
  openPinScreen('timeup');
  // With no PIN configured there is no way onward at all, so the screen is just
  // the message.
  if (!pinPad.isEnabled()) {
    timeUpEl.hidden = false;
    timeUpTitleEl.textContent = 'Đã xem hết giờ hôm nay';
    timeUpSubEl.textContent = 'Mai mình xem tiếp nhé';
  }
}

// ----------------------------------------------------------- parent PIN ---

/**
 * The way back from the out-of-time screen: a four digit code from the Sheet,
 * typed on an on-screen keypad because a TV remote has no keyboard and the
 * newer ones have no number buttons either.
 *
 * With no PIN in the Sheet the whole thing stays hidden — an empty keypad
 * inviting presses that can never work is worse than no keypad.
 */
var pinMode = 'timeup';
// The out-of-time screen shows a button first and the keypad only once it is
// pressed: a keypad sitting there is an invitation for a child to try codes,
// and the message is what they are meant to read.
var pinStep = 'button';

var pinPad = (function () {
  var LAYOUT = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['\u232B', '0', '']];
  var secret = null;
  var entered = '';
  var focus = { row: 0, col: 0 };   // starts on 1, the top-left key
  var buttons = [];

  function build() {
    keypadEl.innerHTML = '';
    buttons = LAYOUT.map(function (row, r) {
      var rowEl = document.createElement('div');
      rowEl.className = 'keypad-row';
      keypadEl.appendChild(rowEl);
      return row.map(function (label, c) {
        var key = document.createElement('div');
        key.className = 'key' + (label ? '' : ' key-blank');
        key.textContent = label;
        if (label) key.addEventListener('click', function () { pressKey(label); });
        rowEl.appendChild(key);
        return { el: key, label: label, row: r, col: c };
      });
    });

    pinCellsEl.innerHTML = '';
    for (var i = 0; i < PIN_LENGTH; i++) {
      pinCellsEl.appendChild(document.createElement('span'));
    }
  }

  function renderCells() {
    var cells = pinCellsEl.children;
    for (var i = 0; i < cells.length; i++) {
      // Digits are masked: the code is for the parent, and a child watching
      // over a shoulder learns it in one go otherwise.
      cells[i].textContent = i < entered.length ? '\u2022' : '';
      cells[i].classList.toggle('filled', i < entered.length);
      cells[i].classList.toggle('active', i === entered.length);
    }
  }

  function renderFocus() {
    buttons.forEach(function (row) {
      row.forEach(function (key) {
        key.el.classList.toggle('focused', key.row === focus.row && key.col === focus.col);
      });
    });
  }

  function setError(message) {
    pinErrorEl.innerHTML = message || '&nbsp;';
    pinErrorEl.classList.toggle('shown', !!message);
  }

  function move(dRow, dCol) {
    var row = focus.row, col = focus.col;
    for (var i = 0; i < 4; i++) {
      row = Math.max(0, Math.min(LAYOUT.length - 1, row + dRow));
      col = Math.max(0, Math.min(LAYOUT[0].length - 1, col + dCol));
      if (LAYOUT[row][col]) break;          // step over the blank key
      if (!dRow && !dCol) break;
    }
    if (!LAYOUT[row][col]) return;
    focus.row = row;
    focus.col = col;
    renderFocus();
  }

  function submit() {
    if (entered === secret) {
      entered = '';
      renderCells();
      setError('');
      quota.resetToday();
      timeUpEl.hidden = true;
      pinBoxEl.hidden = true;
      resetBtnEl.hidden = true;
      pinMode = 'timeup';
      blurClock();
      applyFocus();
      return;
    }
    entered = '';
    renderCells();
    setError('Mật khẩu không đúng');
    pinCellsEl.classList.remove('wrong');
    // Restart the animation rather than leaving a second wrong entry silent.
    void pinCellsEl.offsetWidth;
    pinCellsEl.classList.add('wrong');
  }

  function pressKey(label) {
    if (!secret) return;
    if (label === '\u232B') {
      entered = entered.slice(0, -1);
      setError('');
      renderCells();
      return;
    }
    if (!/^\d$/.test(label) || entered.length >= PIN_LENGTH) return;
    setError('');
    entered += label;
    renderCells();
    if (entered.length === PIN_LENGTH) submit();
  }

  return {
    setSecret: function (value) {
      secret = value || null;
      if (!buttons.length) build();
      pinBoxEl.hidden = !secret;
      if (secret && !timeUpEl.hidden && pinStep === 'button') showResetButton();
    },
    isEnabled: function () { return !!secret; },
    open: function () {
      if (!secret) return;
      entered = '';
      focus = { row: 0, col: 0 };
      pinBoxEl.hidden = false;
      renderCells();
      renderFocus();
      setError('');
    },
    handleKey: function (code) {
      if (!secret) return false;
      if (code === KEY.LEFT) { move(0, -1); return true; }
      if (code === KEY.RIGHT) { move(0, 1); return true; }
      if (code === KEY.UP) { move(-1, 0); return true; }
      if (code === KEY.DOWN) { move(1, 0); return true; }
      if (code === KEY.ENTER) { pressKey(LAYOUT[focus.row][focus.col]); return true; }
      if (code === 8) { pressKey('\u232B'); return true; }
      // Remotes with a number pad, and the on-screen one Samsung offers, send
      // plain digit codes — take them directly rather than making the parent
      // walk the grid.
      if (code >= 48 && code <= 57) { pressKey(String(code - 48)); return true; }
      if (code >= 96 && code <= 105) { pressKey(String(code - 96)); return true; }
      return false;
    }
  };
})();

// ------------------------------------------------- reaching the badge ---

/** Move the highlight onto the countdown. Refused when no PIN is set: the badge
 *  would be a dead end, since resetting the day is the only thing it offers. */
function focusClock() {
  if (!pinPad.isEnabled() || clockFocused) return false;
  clockFocused = true;
  applyFocus();
  return true;
}

function blurClock() {
  if (!clockFocused) return;
  clockFocused = false;
  applyFocus();
}

/**
 * The PIN screen serves two errands, and they differ in one important way: when
 * the day is spent there is no way past it except the PIN, but when a parent
 * opens it deliberately they must be able to change their mind.
 */
function openPinScreen(mode) {
  if (!pinPad.isEnabled()) return;
  pinMode = mode;
  timeUpEl.hidden = false;

  if (mode === 'reset') {
    // Opened deliberately from the badge, so the keypad is what was asked for —
    // another button in the way would just be a second press.
    timeUpTitleEl.textContent = 'Đặt lại thời gian';
    timeUpSubEl.textContent = 'Bấm Trở về để huỷ';
    showPinForm();
    return;
  }

  timeUpTitleEl.textContent = 'Đã xem hết giờ hôm nay';
  timeUpSubEl.textContent = 'Mai mình xem tiếp nhé';
  showResetButton();
}

/** Step one of the out-of-time screen: the message, and one way onward. */
resetBtnEl.addEventListener('click', function () { showPinForm(); });

function showResetButton() {
  pinStep = 'button';
  pinBoxEl.hidden = true;
  resetBtnEl.hidden = false;
  resetBtnEl.classList.add('focused');
}

/** Step two: the keypad. */
function showPinForm() {
  pinStep = 'form';
  resetBtnEl.hidden = true;
  resetBtnEl.classList.remove('focused');
  pinPad.open();
}

/** Leave the PIN screen without using it. Only ever reachable from a reset the
 *  parent started; being out of time is not something to dismiss. */
function cancelPinScreen() {
  if (pinMode !== 'reset') return;
  timeUpEl.hidden = true;
  pinBoxEl.hidden = true;
  resetBtnEl.hidden = true;
  pinMode = 'timeup';
  applyFocus();
}

// ------------------------------------------------------------------ keys ---

document.addEventListener('keydown', function (ev) {
  var code = ev.keyCode;

  // The PIN screen is up — either because the day ran out or because a parent
  // asked for it. Being out of time is not something to dismiss, so only the
  // second one takes Back as "never mind".
  if (!timeUpEl.hidden) {
    ev.preventDefault();

    // Step one of the out-of-time screen: nothing but the way onward.
    if (pinStep === 'button') {
      if (code === KEY.ENTER) showPinForm();
      else if (code === KEY.BACK || code === KEY.ESC) {
        try { tizen.application.getCurrentApplication().exit(); } catch (e) {}
      }
      return;
    }

    if (code === KEY.BACK || code === KEY.ESC) {
      // Back steps out of the keypad rather than off the screen: from a reset
      // the parent opened it cancels, from the out-of-time screen it returns to
      // the message, which is still not something to dismiss.
      if (pinMode === 'reset') cancelPinScreen();
      else showResetButton();
      return;
    }
    pinPad.handleKey(code);
    return;
  }

  // The countdown badge holds the highlight: the only thing it does is offer
  // the reset, so OK opens the PIN and everything else steps back down.
  if (clockFocused) {
    ev.preventDefault();
    if (code === KEY.ENTER) openPinScreen('reset');
    else if (code === KEY.DOWN || code === KEY.BACK || code === KEY.ESC) blurClock();
    return;
  }
  if (!stageEl.hidden) {
    ev.preventDefault();

    // Grid pulled up over the video: the arrows belong to the grid, and the
    // video carries on playing behind it.
    if (overVideo) {
      if (code === KEY.BACK || code === KEY.ESC) closeOverVideo();
      else if (code === KEY.LEFT) move(0, -1);
      else if (code === KEY.RIGHT) move(0, 1);
      else if (code === KEY.DOWN) move(1, 0);
      else if (code === KEY.UP) {
        // Up from the top row is the way back to the video, the same press that
        // opened the grid, reversed.
        if (focus.row === 0) closeOverVideo();
        else move(-1, 0);
      } else if (code === KEY.ENTER) {
        closeOverVideo();
        play(focus.row, focus.col);
      }
      return;
    }

    // Watching. Left and right scrub within this video rather than skipping to
    // another one — jumping tracks on a stray press is how a child loses the
    // thing they were watching.
    if (code === KEY.BACK || code === KEY.ESC) closeStage();
    else if (code === KEY.UP) focusClock();
    else if (code === KEY.DOWN) openOverVideo();
    else if (code === KEY.LEFT) seek(-SEEK_STEP_SECONDS);
    else if (code === KEY.RIGHT) seek(SEEK_STEP_SECONDS);
    else if (code === KEY.ENTER) {
      callPlayer(callPlayer('getPlayerState') === YT.PlayerState.PLAYING
        ? 'pauseVideo' : 'playVideo');
    }
    return;
  }

  if (code === KEY.LEFT) { ev.preventDefault(); move(0, -1); }
  else if (code === KEY.RIGHT) { ev.preventDefault(); move(0, 1); }
  else if (code === KEY.UP) {
    ev.preventDefault();
    // Above the first row there is only the badge; from any other row this is
    // ordinary navigation.
    if (focus.row === 0 && focusClock()) return;
    move(-1, 0);
  }
  else if (code === KEY.DOWN) { ev.preventDefault(); move(1, 0); }
  else if (code === KEY.ENTER) { ev.preventDefault(); play(focus.row, focus.col); }
  else if (code === KEY.BACK) {
    ev.preventDefault();
    try { tizen.application.getCurrentApplication().exit(); } catch (e) {}
  }
});

// ------------------------------------------------------------------ boot ---

function boot() {
  var usedCache = false;

  Promise.all([
    fetchWithTimeout(SHEET_CSV, SHEET_TIMEOUT_MS)
      .then(function (r) {
        if (!r.ok) throw new Error('Sheet trả về HTTP ' + r.status);
        return r.text();
      })
      .then(function (csv) { channelCache.write(csv); return csv; })
      .catch(function (e) {
        // Reading the published Sheet from a browser is throttled hard, so a
        // failure here is routine rather than exceptional. Fall back to the last
        // live answer, then to the copy committed beside the app — which is
        // same-origin and therefore always reachable, and is what makes a TV
        // that has never had a successful live read still work.
        var cached = channelCache.read();
        if (cached) { usedCache = 'cache'; return cached.csv; }
        return fetch('channels.json?t=' + Date.now())
          .then(function (r) { return r.ok ? r.json() : null; })
          // The snapshot failing too must not replace the message below with a
          // raw fetch error; the viewer needs to know which thing is missing.
          .catch(function () { return null; })
          .then(function (snap) {
            if (!snap || !snap.csv) {
              throw new Error('không đọc được danh sách kênh (' + e.message + ')');
            }
            usedCache = 'snapshot';
            return snap.csv;
          });
      }),
    // Same origin, so this one cannot fail on CORS; an empty map just means
    // every @handle in the Sheet gets reported as needing a channel id.
    fetch('handles.json?t=' + Date.now())
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; })
  ])
    .then(function (both) {
      var csv = both[0], handleMap = both[1];
      var parsed = parseCsv(csv);
      // Settings are scanned across every row, header included, because they
      // are a key/value pair placed wherever suits the parent rather than in a
      // reserved position.
      var settings = readSettings(parsed);
      if (settings.minutes) quota.setMinutes(settings.minutes);
      pinPad.setSecret(settings.pin);

      var body = parsed.slice(1); // drop the header row
      var wanted = [], unresolved = [];
      body.forEach(function (cells) {
        var got = readChannelCell(cells, handleMap);
        if (!got) return;
        if (got.id) wanted.push(got);
        else unresolved.push(got.handle);
      });

      if (usedCache) {
        setStatus(usedCache === 'snapshot'
          ? 'Đang dùng danh sách kênh kèm theo app — chưa kết nối được tới Sheet'
          : 'Đang dùng danh sách kênh đã lưu — chưa kết nối được tới Sheet', true);
      }
      if (unresolved.length) {
        setStatus('Chưa dùng được: ' + unresolved.join(', ') +
          ' — chạy scripts/resolve-handles.py, hoặc dán link /channel/UC… vào Sheet', true);
      }
      if (!wanted.length) {
        setStatus('Không có kênh nào dùng được. Sheet cần cột chứa channel ID dạng UC…', true);
        return;
      }

      // Channels load concurrently, but only a few at a time: each one costs an
      // iframe, and a TV has far less to spare than a desktop. Rows appear in
      // Sheet order regardless of which channel finishes first.
      var shells = wanted.map(function (channel, i) { return createRow(channel, i); });
      var run = pooled(4);
      var done = 0;

      Promise.all(shells.map(function (shell) {
        return run(function () { return playlistReader.read('UU' + shell.channel.id.slice(2)); })
          .then(function (ids) { return ids; }, function () { return []; })
          .then(function (ids) {
            fillRow(shell, ids);
            done++;
            if (!unresolved.length && !usedCache) {
              setStatus(done < wanted.length ? 'Đang tải ' + done + '/' + wanted.length + '…' : '');
            }
          });
      })).then(function () {
        if (!unresolved.length && !usedCache) setStatus('');
        if (!rows.length) setStatus('Không tải được video nào.', true);
      });
    })
    .catch(function (e) { setStatus('Lỗi: ' + e.message, true); });
}

quota.start();
boot();
