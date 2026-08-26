// Mint Kids — playback spike. Edit freely; the bootstrap always loads it fresh.
var VERSION = 'v4 — SUA LUC NAY, KHONG CAI LAI';

document.body.insertAdjacentHTML('afterbegin',
  '<div id="banner">MINT KIDS &nbsp;·&nbsp; ' + VERSION +
  ' &nbsp;·&nbsp; <span id="stamp"></span></div>' +
  '<div id="player"></div><div id="log"></div>');

var logEl = document.getElementById('log');
function log(msg, cls) {
  var d = document.createElement('div');
  d.className = cls || 'info';
  d.textContent = msg;
  logEl.appendChild(d);
  logEl.scrollTop = logEl.scrollHeight;
}

document.getElementById('stamp').textContent =
  new Date().toLocaleTimeString('vi-VN');

var VIDEO_ID = new URLSearchParams(location.search).get('v') || 'aqz-KE-bpKQ';
log('build ' + VERSION + ' — loaded fresh, no cache', 'ok');
log('origin = ' + location.origin);
log('video id = ' + VIDEO_ID);

var ERRORS = {
  2: '2 — invalid parameter', 5: '5 — HTML5 player error',
  100: '100 — video not found / private',
  101: '101 — embedding disabled by owner',
  150: '150 — embedding disabled by owner',
  153: '153 — MISSING/BAD REFERRER'
};

var tag = document.createElement('script');
tag.src = 'https://www.youtube.com/iframe_api';
tag.onerror = function () { log('FAILED to load iframe_api', 'err'); };
document.head.appendChild(tag);

var player;
window.onYouTubeIframeAPIReady = function () {
  log('iframe_api loaded OK', 'ok');
  player = new YT.Player('player', {
    videoId: VIDEO_ID,
    playerVars: { autoplay: 1, controls: 0, rel: 0, modestbranding: 1, playsinline: 1 },
    events: {
      onReady: function (e) { log('player READY', 'ok'); e.target.playVideo(); },
      onStateChange: function (e) {
        var names = { '-1': 'unstarted', 0: 'ended', 1: 'PLAYING', 2: 'paused', 3: 'buffering', 5: 'cued' };
        log('state: ' + (names[e.data] || e.data), e.data === 1 ? 'ok' : 'info');
        if (e.data === 1) log('>>> PLAYBACK WORKS IN APP CONTAINER <<<', 'ok');
      },
      onError: function (e) { log('ERROR ' + (ERRORS[e.data] || e.data), 'err'); }
    }
  });
};

document.addEventListener('keydown', function (ev) {
  log('key: ' + ev.keyCode);
  if (ev.keyCode === 10009) {
    try { tizen.application.getCurrentApplication().exit(); } catch (e) {}
  }
  if (ev.keyCode === 13 && player) {
    player.getPlayerState() === 1 ? player.pauseVideo() : player.playVideo();
  }
});
