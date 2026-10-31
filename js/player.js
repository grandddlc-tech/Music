/* پخش‌کننده: صف، شافل، تکرار، اکولایزر، ویژوالایزر، تایمر خواب */
(function () {
  const P = new EventTarget();
  window.Player = P;

  const audio = new Audio();
  audio.preload = 'auto';
  P.audio = audio;

  P.queue = [];      // آرایه‌ی شناسه‌ها به ترتیب پخش
  P.original = [];   // ترتیب اصلی (برای خاموش کردن شافل)
  P.index = -1;
  P.shuffle = false;
  P.repeat = 'off';  // off | all | one
  P.current = null;
  P.resolveUrl = null;   // تابعی که App ست می‌کند: id → Promise<url>
  let currentUrl = null;

  /* ---------- Web Audio ---------- */
  P.EQ_BANDS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
  P.EQ_PRESETS = {
    'صاف': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    'باس قوی': [7, 6, 4, 2, 0, 0, 0, 0, 0, 0],
    'پاپ': [-1, 2, 4, 5, 3, 0, -1, -1, 0, 0],
    'راک': [5, 3, -1, -3, -1, 2, 4, 5, 5, 5],
    'وکال': [-2, -2, 0, 3, 5, 5, 3, 1, 0, -1],
    'سنتی': [2, 1, 0, 2, 3, 3, 2, 3, 2, 1],
    'الکترونیک': [6, 5, 1, 0, -2, 2, 1, 2, 5, 6],
    'جز': [3, 2, 1, 2, -1, -1, 0, 1, 2, 3],
    'کلاسیک': [4, 3, 2, 1, -1, -1, 0, 2, 3, 4],
    'هیپ‌هاپ': [6, 5, 1, 3, -1, -1, 1, -1, 2, 3],
  };
  let ctx, filters = [], analyser, gainNode;
  P.eqGains = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  function ensureGraph() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaElementSource(audio);
      filters = P.EQ_BANDS.map((f, i) => {
        const b = ctx.createBiquadFilter();
        b.type = i === 0 ? 'lowshelf' : i === P.EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
        b.frequency.value = f; b.Q.value = 1.1; b.gain.value = P.eqGains[i];
        return b;
      });
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      gainNode = ctx.createGain();
      let node = src;
      for (const f of filters) { node.connect(f); node = f; }
      node.connect(gainNode); gainNode.connect(analyser); analyser.connect(ctx.destination);
    } catch (e) { console.warn('WebAudio unavailable', e); }
  }
  P.setEq = (gains) => {
    P.eqGains = gains.slice();
    filters.forEach((f, i) => { f.gain.value = gains[i]; });
  };
  P.analyser = () => analyser;

  /* ---------- پخش ---------- */
  async function loadIndex(i, autoplay = true) {
    if (i < 0 || i >= P.queue.length) return;
    P.index = i;
    const id = P.queue[i];
    P.current = id;
    let url;
    try { url = await P.resolveUrl(id); } catch (e) { url = null; }
    if (P.current !== id) return; // در این فاصله آهنگ دیگری انتخاب شده
    if (!url) {
      P.dispatchEvent(new CustomEvent('missing', { detail: id }));
      return;
    }
    if (currentUrl && currentUrl.startsWith('blob:') && currentUrl !== url) URL.revokeObjectURL(currentUrl);
    currentUrl = url;
    audio.src = url;
    audio.playbackRate = P.rate || 1;
    P.dispatchEvent(new CustomEvent('track', { detail: id }));
    if (autoplay) await P.play();
  }

  P.playList = (ids, start = 0, { shuffle } = {}) => {
    if (!ids.length) return;
    if (shuffle !== undefined) P.shuffle = shuffle;
    P.original = ids.slice();
    if (P.shuffle) {
      const first = ids[start] !== undefined && shuffle !== true ? ids[start] : null;
      const rest = shuffleArr(ids.filter((x) => x !== first));
      P.queue = first ? [first, ...rest] : rest;
      start = 0;
    } else {
      P.queue = ids.slice();
    }
    P.dispatchEvent(new Event('queue'));
    return loadIndex(start);
  };
  P.play = async () => {
    ensureGraph();
    try { await audio.play(); } catch (e) { /* نیاز به تعامل کاربر */ }
  };
  P.pause = () => audio.pause();
  P.toggle = () => {
    if (!P.current && P.queue.length) return loadIndex(0);
    return audio.paused ? P.play() : P.pause();
  };
  P.next = (auto = false) => {
    if (!P.queue.length) return;
    if (auto && P.repeat === 'one') { audio.currentTime = 0; return P.play(); }
    let i = P.index + 1;
    if (i >= P.queue.length) {
      if (P.repeat === 'all' || !auto) i = 0;
      else { P.dispatchEvent(new Event('ended')); return; }
    }
    return loadIndex(i);
  };
  P.prev = () => {
    if (audio.currentTime > 4) { audio.currentTime = 0; return; }
    let i = P.index - 1;
    if (i < 0) i = P.repeat === 'all' ? P.queue.length - 1 : 0;
    return loadIndex(i);
  };
  P.jump = (i) => loadIndex(i);
  P.seek = (t) => { if (isFinite(t)) audio.currentTime = t; };
  P.setVolume = (v) => { audio.volume = Math.max(0, Math.min(1, v)); };
  P.setRate = (r) => { P.rate = r; audio.playbackRate = r; };

  P.toggleShuffle = () => {
    P.shuffle = !P.shuffle;
    const cur = P.queue[P.index];
    if (P.shuffle) {
      P.original = P.queue.slice();
      P.queue = [cur, ...shuffleArr(P.queue.filter((x, i) => i !== P.index))].filter(Boolean);
      P.index = cur ? 0 : -1;
    } else if (P.original.length) {
      P.queue = P.original.slice();
      P.index = Math.max(0, P.queue.indexOf(cur));
    }
    P.dispatchEvent(new Event('queue'));
    P.dispatchEvent(new Event('mode'));
  };
  P.cycleRepeat = () => {
    P.repeat = P.repeat === 'off' ? 'all' : P.repeat === 'all' ? 'one' : 'off';
    P.dispatchEvent(new Event('mode'));
  };
  P.playNext = (id) => {
    if (!P.queue.length) return P.playList([id]);
    P.queue.splice(P.index + 1, 0, id);
    P.dispatchEvent(new Event('queue'));
  };
  P.addToQueue = (id) => {
    if (!P.queue.length) return P.playList([id]);
    P.queue.push(id);
    P.dispatchEvent(new Event('queue'));
  };
  P.removeAt = (i) => {
    if (i === P.index) return;
    P.queue.splice(i, 1);
    if (i < P.index) P.index--;
    P.dispatchEvent(new Event('queue'));
  };
  P.move = (from, to) => {
    const [x] = P.queue.splice(from, 1);
    P.queue.splice(to, 0, x);
    if (from === P.index) P.index = to;
    else if (from < P.index && to >= P.index) P.index--;
    else if (from > P.index && to <= P.index) P.index++;
    P.dispatchEvent(new Event('queue'));
  };

  /* ---------- تایمر خواب ---------- */
  let sleepTimer = null;
  P.sleepAt = 0;
  P.sleepEndOfTrack = false;
  P.setSleep = (minutes) => {
    clearTimeout(sleepTimer);
    P.sleepEndOfTrack = minutes === 'end';
    P.sleepAt = 0;
    if (minutes && minutes !== 'end') {
      P.sleepAt = Date.now() + minutes * 60000;
      sleepTimer = setTimeout(fadeOutAndStop, minutes * 60000);
    }
    P.dispatchEvent(new Event('sleep'));
  };
  function fadeOutAndStop() {
    const start = audio.volume;
    let k = 0;
    const iv = setInterval(() => {
      k++;
      audio.volume = Math.max(0, start * (1 - k / 20));
      if (k >= 20) { clearInterval(iv); audio.pause(); audio.volume = start; P.sleepAt = 0; P.dispatchEvent(new Event('sleep')); }
    }, 150);
  }

  audio.addEventListener('ended', () => {
    P.dispatchEvent(new CustomEvent('finished', { detail: P.current }));
    if (P.sleepEndOfTrack) { P.sleepEndOfTrack = false; P.dispatchEvent(new Event('sleep')); return; }
    P.next(true);
  });
  ['play', 'pause', 'timeupdate', 'loadedmetadata', 'volumechange'].forEach((ev) =>
    audio.addEventListener(ev, () => P.dispatchEvent(new Event(ev))));
  audio.addEventListener('error', () => {
    if (audio.src) P.dispatchEvent(new CustomEvent('playerror', { detail: P.current }));
  });

  function shuffleArr(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  /* ---------- Media Session (کنترل از صفحه‌ی قفل و هدفون) ---------- */
  P.setMediaSession = (t, artworkUrl) => {
    if (!('mediaSession' in navigator) || !t) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title, artist: t.artist, album: t.album || '',
      artwork: artworkUrl ? [{ src: artworkUrl, sizes: '400x400', type: 'image/jpeg' }] : [],
    });
  };
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    const h = (a, f) => { try { ms.setActionHandler(a, f); } catch (e) {} };
    h('play', () => P.play()); h('pause', () => P.pause());
    h('previoustrack', () => P.prev()); h('nexttrack', () => P.next());
    h('seekto', (d) => P.seek(d.seekTime));
    h('seekbackward', (d) => P.seek(audio.currentTime - (d.seekOffset || 10)));
    h('seekforward', (d) => P.seek(audio.currentTime + (d.seekOffset || 10)));
  }
})();
