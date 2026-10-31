/* آوا — اپلیکیشن موسیقی شخصی با تشخیص خودکار کشور */
(function () {
  'use strict';

  /* =========================================================
   * ابزارها
   * ========================================================= */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
  const fa = (v) => String(v).replace(/\d/g, (d) => FA_DIGITS[d]);
  const num = (n) => fa(Number(n || 0).toLocaleString('en-US'));
  const fmtTime = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return fa(h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`);
  };
  const fmtLong = (s) => {
    const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    return h ? `${num(h)} ساعت و ${num(m)} دقیقه` : `${num(m)} دقیقه`;
  };
  const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
  const relDate = (ts) => {
    const d = (Date.now() - ts) / 86400000;
    if (d < 1) return 'امروز';
    if (d < 2) return 'دیروز';
    if (d < 7) return `${num(Math.floor(d))} روز پیش`;
    if (d < 30) return `${num(Math.floor(d / 7))} هفته پیش`;
    if (d < 365) return `${num(Math.floor(d / 30))} ماه پیش`;
    return `${num(Math.floor(d / 365))} سال پیش`;
  };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const icon = (name) => `<svg class="ic"><use href="#i-${name}"/></svg>`;

  /* =========================================================
   * وضعیت
   * ========================================================= */
  const S = {
    tracks: new Map(),      // id → track
    files: new Map(),       // id → File (همین جلسه)
    artists: new Map(),     // نام نرمال خواننده → { country, source, why, confidence, manual, checked }
    playlists: new Map(),   // id → { id, name, ids, created, color }
    coverUrls: new Map(),   // coverId → url
    coverColors: new Map(),
    history: [],            // آخرین پخش‌ها
    dirs: [],               // FileSystemDirectoryHandle ها
    settings: {
      online: true, keepCopies: !window.showDirectoryPicker, accent: '#8b5cf6', dynamic: true,
      theme: 'dark', volume: 0.9, rate: 1, eq: Array(10).fill(0), eqPreset: 'صاف', visualizer: true,
    },
    listenSeconds: 0,
    lists: {},              // لیست‌های رندر شده برای پخش
  };
  window.AvaState = S;

  const saveSettings = debounce(() => DB.set('kv', 'settings', S.settings), 300);
  const saveTrack = (t) => DB.set('tracks', t.id, t);
  const saveArtists = debounce(() => DB.set('kv', 'artists', Array.from(S.artists.entries())), 800);
  const savePlaylists = () => DB.set('kv', 'playlists', Array.from(S.playlists.values()));
  const pendingTrackSaves = new Set();
  const flushTracks = debounce(() => {
    const entries = Array.from(pendingTrackSaves).map((id) => [id, S.tracks.get(id)]).filter((e) => e[1]);
    pendingTrackSaves.clear();
    if (entries.length) DB.putMany('tracks', entries);
  }, 600);
  const queueSave = (t) => { pendingTrackSaves.add(t.id); flushTracks(); };

  /* =========================================================
   * کشور
   * ========================================================= */
  const FAMILY = {
    IR: ['IR', 'AF', 'TJ'],
    XA: ['XA', 'EG', 'LB', 'SY', 'IQ', 'SA', 'AE', 'KW', 'QA', 'BH', 'OM', 'YE', 'JO', 'PS', 'MA', 'DZ', 'TN', 'LY', 'SD', 'MR', 'IR', 'IL'],
    RU: ['RU', 'UA', 'BY', 'KZ', 'KG', 'UZ', 'TJ', 'BG', 'RS', 'MK', 'MD', 'AM', 'AZ', 'GE', 'MN'],
    CN: ['CN', 'TW', 'HK', 'SG', 'MY', 'MO'],
    IN: ['IN', 'PK', 'NP', 'BD', 'LK'],
    PK: ['PK', 'IN'],
  };
  const artistKey = (t) => Country.norm(Country.primaryArtist(t.albumArtist && t.albumArtist !== 'Various Artists' ? t.artist : t.artist));

  function resolveCountry(t) {
    let code = null, why = '', source = '', conf = 0;
    if (t.manualCountry) { code = t.manualCountry; source = 'manual'; why = 'انتخاب شما'; conf = 1; }
    else {
      const a = S.artists.get(artistKey(t));
      const g = t.guess;
      if (a && a.manual) { code = a.country; source = 'manual'; why = 'انتخاب شما برای این خواننده'; conf = 1; }
      else if (a && a.country) {
        code = a.country; source = a.source; why = a.why; conf = a.confidence;
        // اگر MusicBrainz با خط نوشتاری نام خواننده تناقض داشت، خط قوی‌تر است
        if (a.source === 'musicbrainz' && g && g.source === 'script' && g.confidence >= 0.7) {
          const fam = FAMILY[g.code] || [g.code];
          if (!fam.includes(a.country)) { code = g.code; source = g.source; why = g.why; conf = g.confidence; }
        }
      } else if (g) { code = g.code; source = g.source; why = g.why; conf = g.confidence; }
    }
    const changed = t.country !== (code || 'ZZ');
    t.country = code || 'ZZ'; t.countrySource = source || 'none'; t.countryWhy = why || 'هنوز تشخیص داده نشده'; t.countryConf = conf;
    return changed;
  }

  const SOURCE_LABEL = {
    manual: 'دستی', db: 'پایگاه داده‌ی آوا', musicbrainz: 'MusicBrainz', script: 'خط نوشتاری',
    genre: 'ژانر', folder: 'نام پوشه', words: 'کلمات متن', none: 'نامشخص',
  };

  /* صف تشخیص آنلاین */
  let detecting = 0;
  async function detectCountries({ force = false } = {}) {
    // ۱. پایگاه داده‌ی داخلی + حدس متنی
    const byArtist = new Map();
    for (const t of S.tracks.values()) {
      if (force || !t.guess) { t.guess = Country.guessFromText(t); queueSave(t); }
      const k = artistKey(t);
      if (!byArtist.has(k)) byArtist.set(k, { name: Country.primaryArtist(t.artist), count: 0 });
      byArtist.get(k).count++;
    }
    for (const [k, info] of byArtist) {
      const cur = S.artists.get(k);
      if (cur && cur.manual) continue;
      if (cur && !force && (cur.country || cur.checked)) continue;
      const known = Country.lookupKnown(info.name);
      if (known) S.artists.set(k, { country: known, source: 'db', why: 'شناخته‌شده در پایگاه داده‌ی آوا', confidence: 0.95, checked: true });
      else if (force && cur && cur.source !== 'manual') S.artists.delete(k);
    }
    saveArtists();
    recomputeAll();

    // ۲. MusicBrainz برای بقیه
    if (!S.settings.online || !navigator.onLine) return;
    const todo = Array.from(byArtist.entries())
      .filter(([k, info]) => { const a = S.artists.get(k); return !a && info.name && !/ناشناس|unknown/i.test(info.name); })
      .sort((a, b) => b[1].count - a[1].count);
    detecting += todo.length;
    updateDetectBadge();
    for (const [k, info] of todo) {
      if (!S.settings.online) break;
      const r = await Country.lookupOnline(info.name);
      detecting--;
      updateDetectBadge();
      if (r && r.error) continue; // بعداً دوباره امتحان می‌شود
      S.artists.set(k, r ? { ...r, checked: true } : { country: null, source: 'none', checked: true });
      saveArtists();
      let changed = false;
      for (const t of S.tracks.values()) if (artistKey(t) === k && resolveCountry(t)) { queueSave(t); changed = true; }
      if (changed) softRefresh();
    }
    detecting = 0;
    updateDetectBadge();
  }

  function recomputeAll() {
    for (const t of S.tracks.values()) if (resolveCountry(t)) queueSave(t);
    softRefresh();
  }

  function updateDetectBadge() {
    const el = $('#detect-status');
    if (!el) return;
    if (detecting > 0) {
      el.hidden = false;
      el.innerHTML = `<span class="pulse"></span> در حال بررسی کشور ${num(detecting)} خواننده…`;
    } else el.hidden = true;
  }

  /* =========================================================
   * کاورها
   * ========================================================= */
  const coverObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      coverObserver.unobserve(e.target);
      loadCoverInto(e.target);
    }
  }, { rootMargin: '300px' });

  async function getCoverUrl(cid) {
    if (!cid) return null;
    if (S.coverUrls.has(cid)) return S.coverUrls.get(cid);
    const rec = await DB.get('covers', cid);
    const url = rec && rec.blob ? URL.createObjectURL(rec.blob) : null;
    S.coverUrls.set(cid, url);
    if (rec && rec.color) S.coverColors.set(cid, rec.color);
    return url;
  }
  async function loadCoverInto(el) {
    const url = await getCoverUrl(el.dataset.cid);
    if (url) { el.style.backgroundImage = `url("${url}")`; el.classList.add('has-img'); }
  }
  function hydrateCovers(root = document) {
    for (const el of $$('.cover[data-cid]:not([data-hyd])', root)) {
      el.dataset.hyd = '1';
      if (el.dataset.cid) coverObserver.observe(el);
    }
  }
  function coverHtml(t, cls = '', label) {
    const seed = t ? (t.album || t.artist || t.title || '') : (label || '');
    const hue = hash(seed) % 360;
    const letter = esc((label || (t && (t.album || t.title)) || '♪').trim().charAt(0) || '♪');
    return `<div class="cover ${cls}" data-cid="${esc(t && t.coverId || '')}" style="--h:${hue}"><span>${letter}</span></div>`;
  }

  /* =========================================================
   * دسترسی به فایل‌ها
   * ========================================================= */
  async function resolveUrl(id) {
    let f = S.files.get(id);
    if (!f) {
      const stored = await DB.get('files', id);
      if (stored) { f = stored; S.files.set(id, f); }
    }
    if (!f && S.dirs.length) {
      const ok = await ensureDirAccess(true);
      if (ok) f = S.files.get(id);
    }
    return f ? URL.createObjectURL(f) : null;
  }

  async function ensureDirAccess(prompt) {
    let any = false;
    for (const d of S.dirs) {
      try {
        let p = await d.queryPermission({ mode: 'read' });
        if (p !== 'granted' && prompt) p = await d.requestPermission({ mode: 'read' });
        if (p === 'granted') { any = true; if (!d._scanned) { d._scanned = true; await scanFromHandle(d, { quiet: true }); } }
      } catch (e) { /* handle قدیمی */ }
    }
    if (any) $('#access-banner').hidden = true;
    return any;
  }

  async function addFolder() {
    if (window.showDirectoryPicker) {
      try {
        const d = await window.showDirectoryPicker({ id: 'music', mode: 'read' });
        if (!S.dirs.some((x) => x.name === d.name)) {
          S.dirs.push(d);
          DB.set('kv', 'dirs', S.dirs);
        }
        d._scanned = true;
        await scanFromHandle(d);
      } catch (e) { if (e.name !== 'AbortError') toast('دسترسی به پوشه ممکن نشد'); }
    } else {
      $('#dir-input').click();
    }
  }

  async function scanFromHandle(d, opts = {}) {
    const items = [];
    showScan('در حال جستجوی فایل‌ها…', 0, 0);
    for await (const it of Scanner.walkHandle(d, d.name + '/')) {
      items.push(it);
      if (items.length % 50 === 0) showScan(`پیدا شد: ${num(items.length)} آهنگ`, 0, 0);
    }
    await ingest(items, { ...opts, root: d.name + '/' });
  }

  function filesFromInput(list) {
    return Array.from(list).filter((f) => Scanner.isAudio(f.name))
      .map((f) => ({ file: f, path: f.webkitRelativePath || ('آهنگ‌های من/' + f.name) }));
  }

  async function readDropped(dt) {
    const out = [];
    const walk = (entry, prefix) => new Promise((res) => {
      if (entry.isFile) entry.file((f) => { if (Scanner.isAudio(f.name)) out.push({ file: f, path: prefix + f.name }); res(); }, () => res());
      else if (entry.isDirectory) {
        const reader = entry.createReader();
        const all = [];
        const read = () => reader.readEntries(async (ents) => {
          if (!ents.length) { for (const e of all) await walk(e, prefix + entry.name + '/'); res(); }
          else { all.push(...ents); read(); }
        }, () => res());
        read();
      } else res();
    });
    const entries = Array.from(dt.items || []).map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    if (entries.length) for (const e of entries) await walk(e, e.isDirectory ? '' : 'آهنگ‌های من/');
    else out.push(...filesFromInput(dt.files));
    return out;
  }

  /* پردازش فایل‌های پیدا شده */
  let ingesting = false;
  async function ingest(items, { quiet = false, root = null } = {}) {
    if (ingesting) { toast('یک اسکن در حال انجام است'); return; }
    ingesting = true;
    try { await ingestInner(items, { quiet, root }); } finally { ingesting = false; hideScan(); }
    render();
    computeDurations();
    detectCountries();
  }
  async function ingestInner(items, { quiet, root }) {
    const firstImport = S.tracks.size === 0;
    const knownCovers = new Set(await DB.keys('covers'));
    const seen = new Set();
    const fresh = [];
    let done = 0;
    const total = items.length;
    const batch = [];
    for (const { file, path } of items) {
      const id = Scanner.fileId(path, file.size);
      seen.add(id);
      S.files.set(id, file);
      if (S.tracks.has(id)) { done++; continue; }
      if (!quiet || total - done > 0) showScan(`در حال خواندن «${path.split('/').pop()}»`, done, total);
      const { track, cover } = await Scanner.parse(file, path);
      track.id = id;
      track.addedAt = firstImport ? Math.min(track.mtime, Date.now()) : Date.now();
      track.plays = 0; track.liked = false; track.duration = 0;
      const albumKey = track.album ? Country.norm((track.albumArtist || Country.primaryArtist(track.artist)) + '|' + track.album) : null;
      const cid = albumKey ? 'c' + hash(albumKey).toString(36) : (cover ? 'c' + id : null);
      if (cover && cid && !knownCovers.has(cid)) {
        await DB.set('covers', cid, cover);
        knownCovers.add(cid);
      }
      track.coverId = cid && knownCovers.has(cid) ? cid : null;
      track.guess = Country.guessFromText(track);
      S.tracks.set(id, track);
      resolveCountry(track);
      batch.push([id, track]);
      fresh.push(track);
      if (S.settings.keepCopies) { try { await DB.set('files', id, file); } catch (e) { /* فضای کافی نیست */ } }
      if (batch.length >= 40) { await DB.putMany('tracks', batch.splice(0)); softRefresh(); }
      done++;
    }
    if (batch.length) await DB.putMany('tracks', batch);
    // آهنگ‌هایی که از پوشه حذف شده‌اند
    let removed = 0;
    if (root) {
      for (const t of Array.from(S.tracks.values())) {
        if (t.path.startsWith(root) && !seen.has(t.id)) {
          const copy = await DB.get('files', t.id);
          if (!copy) { S.tracks.delete(t.id); DB.del('tracks', t.id); removed++; }
        }
      }
    }
    if (fresh.length) toast(`${num(fresh.length)} آهنگ تازه اضافه شد ✨`);
    else if (!quiet) toast('آهنگ تازه‌ای پیدا نشد');
    if (removed) toast(`${num(removed)} آهنگ حذف‌شده از کتابخانه پاک شد`);
  }

  let durRunning = false;
  async function computeDurations() {
    if (durRunning) return;
    durRunning = true;
    const todo = Array.from(S.tracks.values()).filter((t) => !t.duration && S.files.has(t.id));
    for (const t of todo) {
      t.duration = await Scanner.duration(S.files.get(t.id));
      if (t.duration) queueSave(t);
    }
    durRunning = false;
    if (todo.length) softRefresh();
  }

  /* =========================================================
   * اسکن و پیام‌ها
   * ========================================================= */
  function showScan(text, done, total) {
    const el = $('#scan');
    el.hidden = false;
    $('#scan-text').textContent = text;
    $('#scan-count').textContent = total ? `${num(done)} از ${num(total)}` : '';
    $('#scan-bar').style.width = total ? `${(done / total) * 100}%` : '30%';
    $('#scan-bar').classList.toggle('indet', !total);
  }
  function hideScan() { $('#scan').hidden = true; }

  function toast(msg, action) {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
    if (action) el.querySelector('button').onclick = () => { action.run(); el.remove(); };
    box.appendChild(el);
    setTimeout(() => el.classList.add('out'), 3200);
    setTimeout(() => el.remove(), 3600);
  }

  /* =========================================================
   * کوئری‌ها
   * ========================================================= */
  const all = () => Array.from(S.tracks.values());
  const byAdded = () => all().sort((a, b) => b.addedAt - a.addedAt);
  const sortTracks = (arr, by) => {
    const c = new Intl.Collator('fa');
    const f = {
      title: (a, b) => c.compare(a.title, b.title),
      artist: (a, b) => c.compare(a.artist, b.artist) || c.compare(a.album, b.album) || (a.trackNo || 0) - (b.trackNo || 0),
      album: (a, b) => c.compare(a.album, b.album) || (a.trackNo || 0) - (b.trackNo || 0),
      added: (a, b) => b.addedAt - a.addedAt,
      plays: (a, b) => (b.plays || 0) - (a.plays || 0),
      duration: (a, b) => (b.duration || 0) - (a.duration || 0),
      year: (a, b) => (b.year || 0) - (a.year || 0),
      country: (a, b) => c.compare(Country.name(a.country), Country.name(b.country)),
    }[by];
    return f ? arr.sort(f) : arr;
  };
  function groupBy(arr, keyFn) {
    const m = new Map();
    for (const t of arr) { const k = keyFn(t); if (!m.has(k)) m.set(k, []); m.get(k).push(t); }
    return m;
  }
  const countries = () => {
    const m = groupBy(all(), (t) => t.country || 'ZZ');
    return Array.from(m.entries()).map(([code, tracks]) => ({ code, tracks }))
      .sort((a, b) => (a.code === 'ZZ') - (b.code === 'ZZ') || b.tracks.length - a.tracks.length);
  };
  const artistsList = () => {
    const m = groupBy(all(), (t) => artistKey(t));
    return Array.from(m.entries()).map(([key, tracks]) => ({
      key, name: Country.primaryArtist(tracks[0].artist), tracks,
      plays: tracks.reduce((s, t) => s + (t.plays || 0), 0), country: tracks[0].country,
    })).sort((a, b) => b.tracks.length - a.tracks.length);
  };
  const albumKeyOf = (t) => Country.norm((t.albumArtist || Country.primaryArtist(t.artist)) + '|' + (t.album || ''));
  const albumsList = () => {
    const m = groupBy(all().filter((t) => t.album), albumKeyOf);
    return Array.from(m.entries()).map(([key, tracks]) => ({
      key, name: tracks[0].album, artist: tracks[0].albumArtist || Country.primaryArtist(tracks[0].artist),
      tracks: tracks.sort((a, b) => (a.trackNo || 0) - (b.trackNo || 0)), year: tracks[0].year,
      addedAt: Math.max(...tracks.map((t) => t.addedAt)), cover: tracks.find((t) => t.coverId) || tracks[0],
    }));
  };

  /* =========================================================
   * اجزای رابط کاربری
   * ========================================================= */
  function flagHtml(code, cls = '') {
    const url = Country.flagUrl(code);
    return url
      ? `<img class="flag ${cls}" src="${url}" alt="${esc(Country.name(code))}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'flag-emoji ${cls}',textContent:'${Country.emoji(code)}'}))">`
      : `<span class="flag-emoji ${cls}">${Country.emoji(code)}</span>`;
  }
  const countryChip = (t) => `<button class="chip country-chip" data-act="country" data-tid="${t.id}" data-code="${t.country}" title="${esc(t.countryWhy)}">${flagHtml(t.country, 'sm')}<span>${esc(Country.name(t.country))}</span></button>`;

  function registerList(key, tracks) { S.lists[key] = tracks.map((t) => t.id); return key; }

  function trackRows(tracks, key, { showAlbum = true, numbered = false, limit = 150, showAdded = false } = {}) {
    registerList(key, tracks);
    const rows = tracks.slice(0, limit).map((t, i) => trackRow(t, key, i, { showAlbum, numbered, showAdded })).join('');
    const more = tracks.length > limit ? `<div class="load-more" data-more="${esc(key)}" data-from="${limit}" data-opts='${JSON.stringify({ showAlbum, numbered, showAdded })}'></div>` : '';
    return `<div class="tracklist" data-list="${esc(key)}">${rows}${more}</div>`;
  }
  function trackRow(t, key, i, { showAlbum, numbered, showAdded }) {
    const playing = Player.current === t.id;
    return `<div class="row ${playing ? 'playing' : ''}" data-id="${t.id}" data-list="${esc(key)}" data-i="${i}" draggable="true">
      <div class="row-lead">${numbered ? `<span class="row-num">${fa(t.trackNo || i + 1)}</span>` : coverHtml(t, 'xs')}<span class="eq-anim"><i></i><i></i><i></i></span><button class="row-play" data-act="play-row" aria-label="پخش">${icon('play')}</button></div>
      <div class="row-main"><div class="row-title">${esc(t.title)}</div><div class="row-sub"><a data-go="artist/${encodeURIComponent(artistKey(t))}">${esc(t.artist)}</a></div></div>
      ${showAlbum ? `<div class="row-album">${t.album ? `<a data-go="album/${encodeURIComponent(albumKeyOf(t))}">${esc(t.album)}</a>` : ''}</div>` : ''}
      <div class="row-country">${countryChip(t)}</div>
      ${showAdded ? `<div class="row-added">${relDate(t.addedAt)}</div>` : ''}
      <button class="icon-btn like ${t.liked ? 'on' : ''}" data-act="like" data-like-id="${t.id}" aria-label="پسندیدن">${icon(t.liked ? 'heart-fill' : 'heart')}</button>
      <div class="row-dur">${t.duration ? fmtTime(t.duration) : '–'}</div>
      <button class="icon-btn" data-act="menu" aria-label="بیشتر">${icon('more')}</button>
    </div>`;
  }

  function card({ cover, title, sub, go, play, round = false, badge = '' }) {
    return `<div class="card ${round ? 'round' : ''}" ${go ? `data-go="${go}"` : ''}>
      <div class="card-art">${cover}${badge}${play ? `<button class="fab-play" data-act="play-key" data-key="${esc(play)}" aria-label="پخش">${icon('play')}</button>` : ''}</div>
      <div class="card-title">${esc(title)}</div>${sub ? `<div class="card-sub">${sub}</div>` : ''}
    </div>`;
  }
  const shelf = (title, inner, more) => `<section class="shelf"><div class="shelf-head"><h2>${title}</h2>${more ? `<a class="see-all" data-go="${more}">مشاهده همه ${icon('chev-left')}</a>` : ''}</div><div class="scroller">${inner}</div></section>`;

  function countryCard(c, big = false) {
    const key = registerList('country-' + c.code, c.tracks);
    const covers = c.tracks.filter((t) => t.coverId).slice(0, 3);
    const artists = new Set(c.tracks.map((t) => artistKey(t))).size;
    const url = Country.flagUrl(c.code);
    return `<div class="ccard ${big ? 'big' : ''}" data-go="country/${c.code}" style="--h:${hash(c.code) % 360}">
      ${url ? `<div class="ccard-bg" style="background-image:url('${url}')"></div>` : '<div class="ccard-bg none"></div>'}
      <div class="ccard-flag">${flagHtml(c.code, 'lg')}</div>
      <div class="ccard-info"><div class="ccard-name">${esc(Country.name(c.code))}</div>
      <div class="ccard-sub">${num(c.tracks.length)} آهنگ • ${num(artists)} خواننده</div></div>
      <div class="ccard-covers">${covers.map((t) => coverHtml(t, 'mini')).join('')}</div>
      <button class="fab-play" data-act="play-key" data-key="${key}" aria-label="پخش">${icon('play')}</button>
    </div>`;
  }

  function hero({ art, kicker, title, meta, actions = '', bg }) {
    return `<header class="hero" ${bg ? `style="--hero:${bg}"` : ''}><div class="hero-art">${art}</div>
      <div class="hero-info"><div class="kicker">${kicker}</div><h1>${title}</h1><div class="hero-meta">${meta}</div><div class="hero-actions">${actions}</div></div></header>`;
  }
  const playBtns = (key) => `<button class="btn primary big" data-act="play-key" data-key="${esc(key)}">${icon('play')} پخش</button>
    <button class="btn ghost big" data-act="shuffle-key" data-key="${esc(key)}">${icon('shuffle')} پخش تصادفی</button>`;

  /* =========================================================
   * صفحه‌ها
   * ========================================================= */
  const views = {};

  function emptyState() {
    return `<div class="empty-state">
      <div class="empty-art"><div class="disc"></div></div>
      <h1>به آوا خوش اومدی 🎧</h1>
      <p>پوشه‌ی آهنگ‌هات رو انتخاب کن. آوا همه‌ی آهنگ‌ها رو می‌خونه، کاور و اطلاعاتشون رو درمیاره و <b>کشور هر آهنگ رو خودش تشخیص می‌ده</b>.</p>
      <div class="empty-actions">
        <button class="btn primary big" data-act="add-folder">${icon('folder')} انتخاب پوشه‌ی موزیک</button>
        <button class="btn ghost big" data-act="add-files">${icon('plus')} انتخاب چند آهنگ</button>
      </div>
      <p class="hint">می‌تونی فایل‌ها یا پوشه‌ها رو مستقیم بکشی و اینجا رها کنی. فایل‌ها از دستگاهت خارج نمی‌شن.</p>
    </div>`;
  }

  views.home = () => {
    if (!S.tracks.size) return emptyState();
    const h = new Date().getHours();
    const greet = h < 5 ? 'شب بخیر' : h < 12 ? 'صبح بخیر' : h < 17 ? 'ظهر بخیر' : h < 20 ? 'عصر بخیر' : 'شب بخیر';
    const tracks = all();
    const recent = byAdded().slice(0, 18);
    const cs = countries();
    const totalDur = tracks.reduce((s, t) => s + (t.duration || 0), 0);
    registerList('all', tracks);
    registerList('new', byAdded());
    const top = tracks.filter((t) => t.plays).sort((a, b) => b.plays - a.plays).slice(0, 20);
    const hist = S.history.map((id) => S.tracks.get(id)).filter(Boolean);
    const seenH = new Set();
    const histU = hist.filter((t) => !seenH.has(t.id) && seenH.add(t.id)).slice(0, 18);
    const never = tracks.filter((t) => !t.plays);
    const liked = tracks.filter((t) => t.liked);
    const arts = artistsList().slice(0, 14);

    let html = `<section class="greet">
      <div><h1>${greet} 👋</h1><p>${num(tracks.length)} آهنگ از ${num(cs.filter((c) => c.code !== 'ZZ').length)} کشور${totalDur ? ' • ' + fmtLong(totalDur) + ' موسیقی' : ''}</p></div>
      <div class="greet-actions"><button class="btn primary" data-act="shuffle-key" data-key="all">${icon('shuffle')} پخش تصادفی همه</button></div>
    </section>`;

    // کاشی‌های سریع
    const quick = [
      { t: 'آهنگ‌های پسندیده', s: `${num(liked.length)} آهنگ`, go: 'playlist/liked', g: 'linear-gradient(135deg,#ec4899,#8b5cf6)', i: 'heart-fill' },
      { t: 'تازه اضافه‌شده', s: `${num(recent.length ? byAdded().filter((x) => Date.now() - x.addedAt < 30 * 864e5).length : 0)} آهنگ این ماه`, go: 'new', g: 'linear-gradient(135deg,#06b6d4,#3b82f6)', i: 'sparkle' },
      { t: 'بیشترین پخش', s: `${num(top.length)} آهنگ`, go: 'playlist/top', g: 'linear-gradient(135deg,#f59e0b,#ef4444)', i: 'fire' },
      { t: 'کشف دوباره', s: `${num(never.length)} آهنگ پخش‌نشده`, go: 'playlist/never', g: 'linear-gradient(135deg,#10b981,#06b6d4)', i: 'compass' },
    ];
    html += `<section class="quick">${quick.map((q) => `<div class="qtile" data-go="${q.go}"><div class="qicon" style="background:${q.g}">${icon(q.i)}</div><div><b>${q.t}</b><small>${q.s}</small></div></div>`).join('')}</section>`;

    html += shelf(`${icon('sparkle')} تازه اضافه‌شده‌ها`, recent.map((t, i) => card({
      cover: coverHtml(t), title: t.title, sub: `${esc(t.artist)} • ${relDate(t.addedAt)}`, play: `new@${i}`, badge: Date.now() - t.addedAt < 3 * 864e5 ? '<span class="badge-new">جدید</span>' : '',
    })).join(''), 'new');

    html += shelf(`${icon('globe')} بر اساس کشور`, cs.slice(0, 16).map((c) => countryCard(c)).join(''), 'countries');

    // میکس هر کشور
    const mixes = cs.filter((c) => c.code !== 'ZZ' && c.tracks.length >= 3).slice(0, 8);
    if (mixes.length) {
      html += shelf(`${icon('disc')} میکس‌های کشوری برای تو`, mixes.map((c) => {
        const key = registerList('mix-' + c.code, c.tracks);
        const cv = c.tracks.filter((t) => t.coverId).slice(0, 4);
        const grid = `<div class="mix-art" style="--h:${hash(c.code) % 360}">${cv.length >= 4 ? cv.map((t) => coverHtml(t, 'q')).join('') : coverHtml(c.tracks[0])}<div class="mix-flag">${flagHtml(c.code, 'md')}</div></div>`;
        return card({ cover: grid, title: `میکس ${Country.name(c.code)}`, sub: `${num(c.tracks.length)} آهنگ`, play: key, go: `country/${c.code}` });
      }).join(''));
    }
    if (histU.length) {
      registerList('hist', histU);
      html += shelf(`${icon('clock')} اخیراً گوش دادی`, histU.map((t, i) => card({ cover: coverHtml(t), title: t.title, sub: esc(t.artist), play: `hist@${i}` })).join(''), 'playlist/recent');
    }
    if (top.length) {
      registerList('top', top);
      html += `<section class="shelf"><div class="shelf-head"><h2>${icon('fire')} محبوب‌ترین‌های تو</h2><a class="see-all" data-go="playlist/top">مشاهده همه ${icon('chev-left')}</a></div>${trackRows(top.slice(0, 6), 'top-mini', { showAlbum: false })}</section>`;
    }
    html += shelf(`${icon('mic')} خواننده‌ها`, arts.map((a) => card({
      cover: coverHtml(a.tracks.find((t) => t.coverId) || a.tracks[0], 'round-cover', a.name), title: a.name,
      sub: `${flagHtml(a.country, 'xs')} ${num(a.tracks.length)} آهنگ`, go: `artist/${encodeURIComponent(a.key)}`, round: true,
    })).join(''), 'library/artists');
    return html;
  };

  views.new = (arg) => {
    if (!S.tracks.size) return emptyState();
    const filter = arg || 'all';
    const now = Date.now();
    const list = byAdded();
    const ranges = { today: 864e5, week: 7 * 864e5, month: 30 * 864e5, all: Infinity };
    const filtered = list.filter((t) => now - t.addedAt < ranges[filter]);
    const buckets = [
      ['امروز', (t) => now - t.addedAt < 864e5],
      ['این هفته', (t) => now - t.addedAt < 7 * 864e5],
      ['این ماه', (t) => now - t.addedAt < 30 * 864e5],
      ['سه ماه اخیر', (t) => now - t.addedAt < 90 * 864e5],
      ['قدیمی‌تر', () => true],
    ];
    registerList('new', filtered);
    const used = new Set();
    let sections = '';
    for (const [name, fn] of buckets) {
      const items = filtered.filter((t) => !used.has(t.id) && fn(t));
      items.forEach((t) => used.add(t.id));
      if (!items.length) continue;
      sections += `<section class="bucket"><h3>${name} <small>${num(items.length)} آهنگ</small></h3>${trackRows(items, 'new-' + name, { showAdded: true })}</section>`;
    }
    const albums = albumsList().sort((a, b) => b.addedAt - a.addedAt).filter((a) => now - a.addedAt < ranges[filter]).slice(0, 12);
    return hero({
      art: `<div class="hero-icon" style="background:linear-gradient(135deg,#06b6d4,#8b5cf6)">${icon('sparkle')}</div>`,
      kicker: 'پلی‌لیست هوشمند', title: 'تازه اضافه‌شده‌ها',
      meta: `${num(filtered.length)} آهنگ • مرتب شده بر اساس زمان اضافه شدن`, actions: playBtns('new'),
    }) + `<div class="tabs">${[['all', 'همه'], ['today', 'امروز'], ['week', 'این هفته'], ['month', 'این ماه']].map(([k, l]) => `<button class="tab ${filter === k ? 'on' : ''}" data-go="new/${k}">${l}</button>`).join('')}</div>`
      + (albums.length ? shelf('آلبوم‌های تازه', albums.map((a) => card({ cover: coverHtml(a.cover), title: a.name, sub: esc(a.artist), go: `album/${encodeURIComponent(a.key)}` })).join('')) : '')
      + (sections || '<p class="muted pad">در این بازه آهنگی اضافه نشده.</p>');
  };

  views.countries = () => {
    if (!S.tracks.size) return emptyState();
    const cs = countries();
    const total = S.tracks.size;
    const bar = cs.map((c) => `<div class="dist-seg" style="flex:${c.tracks.length};--h:${hash(c.code) % 360}" title="${esc(Country.name(c.code))}: ${num(c.tracks.length)}" data-go="country/${c.code}"></div>`).join('');
    const legend = cs.slice(0, 8).map((c) => `<span class="legend"><i style="--h:${hash(c.code) % 360}"></i>${esc(Country.name(c.code))} ${fa(Math.round((c.tracks.length / total) * 100))}٪</span>`).join('');
    const pending = detecting ? `<div class="note">${icon('radar')} آوا در حال بررسی کشور ${num(detecting)} خواننده‌ی دیگر است؛ این صفحه خودکار به‌روز می‌شود.</div>` : '';
    return `<div class="page-head"><h1>${icon('globe')} کشورها</h1><p>آوا کشور هر آهنگ رو خودش تشخیص داده. اگه جایی اشتباه بود، روی پرچم آهنگ بزن و درستش کن.</p></div>
      ${pending}
      <div class="dist">${bar}</div><div class="legends">${legend}</div>
      <div class="cgrid">${cs.map((c) => countryCard(c, true)).join('')}</div>`;
  };

  views.country = (code) => {
    const tracks = sortTracks(all().filter((t) => t.country === code), 'artist');
    if (!tracks.length) return `<p class="pad muted">آهنگی از این کشور نیست.</p>`;
    const key = registerList('country-' + code, tracks);
    const arts = artistsList().filter((a) => a.tracks.some((t) => t.country === code));
    const albums = albumsList().filter((a) => a.tracks.some((t) => t.country === code));
    const dur = tracks.reduce((s, t) => s + (t.duration || 0), 0);
    const srcCount = {};
    for (const t of tracks) srcCount[t.countrySource] = (srcCount[t.countrySource] || 0) + 1;
    const srcInfo = Object.entries(srcCount).map(([k, v]) => `${SOURCE_LABEL[k] || k}: ${num(v)}`).join(' • ');
    const latest = tracks.slice().sort((a, b) => b.addedAt - a.addedAt).slice(0, 12);
    registerList('cl-' + code, latest);
    return hero({
      art: `<div class="hero-flag">${flagHtml(code, 'xl')}</div>`, kicker: 'کشور', title: esc(Country.name(code)),
      meta: `${num(tracks.length)} آهنگ • ${num(arts.length)} خواننده${dur ? ' • ' + fmtLong(dur) : ''}<br><small class="muted">روش تشخیص — ${srcInfo}</small>`,
      actions: playBtns(key), bg: `hsl(${hash(code) % 360} 60% 35%)`,
    })
      + shelf('خواننده‌ها', arts.map((a) => card({ cover: coverHtml(a.tracks.find((t) => t.coverId) || a.tracks[0], 'round-cover', a.name), title: a.name, sub: `${num(a.tracks.length)} آهنگ`, go: `artist/${encodeURIComponent(a.key)}`, round: true })).join(''))
      + shelf('تازه‌ترین‌ها از این کشور', latest.map((t, i) => card({ cover: coverHtml(t), title: t.title, sub: esc(t.artist), play: `cl-${code}@${i}` })).join(''))
      + (albums.length ? shelf('آلبوم‌ها', albums.map((a) => card({ cover: coverHtml(a.cover), title: a.name, sub: esc(a.artist), go: `album/${encodeURIComponent(a.key)}` })).join('')) : '')
      + `<section class="shelf"><div class="shelf-head"><h2>همه‌ی آهنگ‌ها</h2></div>${trackRows(tracks, key)}</section>`;
  };

  views.library = (tab) => {
    tab = tab || 'songs';
    if (!S.tracks.size) return emptyState();
    const tabs = [['songs', 'آهنگ‌ها'], ['artists', 'خواننده‌ها'], ['albums', 'آلبوم‌ها'], ['genres', 'ژانرها'], ['folders', 'پوشه‌ها']];
    let body = '';
    const sort = S.sort || 'added';
    if (tab === 'songs') {
      const tracks = sortTracks(all(), sort);
      body = `<div class="toolbar"><span class="muted">${num(tracks.length)} آهنگ</span>
        <label class="select">${icon('sort')}<select id="sort-select">${[['added', 'تاریخ اضافه شدن'], ['title', 'عنوان'], ['artist', 'خواننده'], ['album', 'آلبوم'], ['country', 'کشور'], ['plays', 'تعداد پخش'], ['duration', 'مدت'], ['year', 'سال']].map(([k, l]) => `<option value="${k}" ${k === sort ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <button class="btn ghost" data-act="shuffle-key" data-key="lib">${icon('shuffle')} تصادفی</button></div>` + trackRows(tracks, 'lib');
    } else if (tab === 'artists') {
      body = `<div class="grid">${artistsList().map((a) => card({ cover: coverHtml(a.tracks.find((t) => t.coverId) || a.tracks[0], 'round-cover', a.name), title: a.name, sub: `${flagHtml(a.country, 'xs')} ${num(a.tracks.length)} آهنگ`, go: `artist/${encodeURIComponent(a.key)}`, round: true })).join('')}</div>`;
    } else if (tab === 'albums') {
      const al = albumsList().sort((a, b) => new Intl.Collator('fa').compare(a.name, b.name));
      body = al.length ? `<div class="grid">${al.map((a) => card({ cover: coverHtml(a.cover), title: a.name, sub: `${esc(a.artist)}${a.year ? ' • ' + fa(a.year) : ''}`, go: `album/${encodeURIComponent(a.key)}` })).join('')}</div>` : '<p class="muted pad">آهنگ‌هات اطلاعات آلبوم ندارن.</p>';
    } else if (tab === 'genres') {
      const g = groupBy(all(), (t) => t.genre || 'بدون ژانر');
      body = `<div class="ggrid">${Array.from(g.entries()).sort((a, b) => b[1].length - a[1].length).map(([name, ts]) => {
        const key = registerList('genre-' + name, ts);
        return `<div class="gtile" style="--h:${hash(name) % 360}" data-act="play-key" data-key="${esc(key)}"><b>${esc(name)}</b><small>${num(ts.length)} آهنگ</small>${coverHtml(ts.find((t) => t.coverId) || ts[0], 'tilt')}</div>`;
      }).join('')}</div>`;
    } else if (tab === 'folders') {
      const g = groupBy(all(), (t) => t.path.split('/').slice(0, -1).join('/') || '/');
      body = `<div class="folders">${Array.from(g.entries()).sort().map(([p, ts]) => {
        const key = registerList('folder-' + p, ts);
        return `<div class="frow" data-act="play-key" data-key="${esc(key)}">${icon('folder')}<div><b>${esc(p.split('/').pop() || p)}</b><small>${esc(p)}</small></div><span class="muted">${num(ts.length)}</span></div>`;
      }).join('')}</div>`;
    }
    return `<div class="page-head"><h1>${icon('library')} کتابخانه</h1></div>
      <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${tab === k ? 'on' : ''}" data-go="library/${k}">${l}</button>`).join('')}</div>${body}`;
  };

  views.artist = (key) => {
    key = decodeURIComponent(key);
    const tracks = sortTracks(all().filter((t) => artistKey(t) === key), 'plays');
    if (!tracks.length) return '<p class="pad muted">خواننده پیدا نشد.</p>';
    const name = Country.primaryArtist(tracks[0].artist);
    const info = S.artists.get(key) || {};
    const code = tracks[0].country;
    const lkey = registerList('artist-' + key, tracks);
    const albums = albumsList().filter((a) => a.tracks.some((t) => artistKey(t) === key));
    const plays = tracks.reduce((s, t) => s + (t.plays || 0), 0);
    const why = info.manual ? 'انتخاب شما' : (tracks[0].countryWhy || '');
    return hero({
      art: coverHtml(tracks.find((t) => t.coverId) || tracks[0], 'round-cover hero-cover', name), kicker: 'خواننده', title: esc(name),
      meta: `<button class="chip country-chip big" data-act="artist-country" data-key="${esc(key)}">${flagHtml(code, 'sm')} ${esc(Country.name(code))} <small>• ${esc(why)}</small> ${icon('edit')}</button><br>${num(tracks.length)} آهنگ • ${num(plays)} بار پخش`,
      actions: playBtns(lkey),
    }) + (albums.length ? shelf('آلبوم‌ها', albums.map((a) => card({ cover: coverHtml(a.cover), title: a.name, sub: a.year ? fa(a.year) : '', go: `album/${encodeURIComponent(a.key)}` })).join('')) : '')
      + `<section class="shelf"><div class="shelf-head"><h2>آهنگ‌ها</h2></div>${trackRows(tracks, lkey)}</section>`;
  };

  views.album = (key) => {
    key = decodeURIComponent(key);
    const a = albumsList().find((x) => x.key === key);
    if (!a) return '<p class="pad muted">آلبوم پیدا نشد.</p>';
    const lkey = registerList('album-' + key, a.tracks);
    const dur = a.tracks.reduce((s, t) => s + (t.duration || 0), 0);
    return hero({
      art: coverHtml(a.cover, 'hero-cover'), kicker: 'آلبوم', title: esc(a.name),
      meta: `<a data-go="artist/${encodeURIComponent(artistKey(a.tracks[0]))}">${esc(a.artist)}</a> • ${countryChip(a.tracks[0])}<br>${a.year ? fa(a.year) + ' • ' : ''}${num(a.tracks.length)} آهنگ${dur ? ' • ' + fmtLong(dur) : ''}`,
      actions: playBtns(lkey),
    }) + trackRows(a.tracks, lkey, { showAlbum: false, numbered: true });
  };

  const SMART = {
    liked: { name: 'آهنگ‌های پسندیده', icon: 'heart-fill', g: 'linear-gradient(135deg,#ec4899,#8b5cf6)', get: () => all().filter((t) => t.liked).sort((a, b) => (b.likedAt || 0) - (a.likedAt || 0)) },
    top: { name: 'بیشترین پخش', icon: 'fire', g: 'linear-gradient(135deg,#f59e0b,#ef4444)', get: () => all().filter((t) => t.plays).sort((a, b) => b.plays - a.plays).slice(0, 100) },
    recent: { name: 'اخیراً پخش‌شده', icon: 'clock', g: 'linear-gradient(135deg,#3b82f6,#8b5cf6)', get: () => { const s = new Set(); return S.history.map((id) => S.tracks.get(id)).filter((t) => t && !s.has(t.id) && s.add(t.id)); } },
    never: { name: 'کشف دوباره', icon: 'compass', g: 'linear-gradient(135deg,#10b981,#06b6d4)', get: () => all().filter((t) => !t.plays).sort(() => Math.random() - 0.5) },
    newmonth: { name: 'تازه‌های این ماه', icon: 'sparkle', g: 'linear-gradient(135deg,#06b6d4,#3b82f6)', get: () => byAdded().filter((t) => Date.now() - t.addedAt < 30 * 864e5) },
  };

  views.playlists = () => {
    const smart = Object.entries(SMART).map(([k, p]) => {
      const n = p.get().length;
      return card({ cover: `<div class="pl-art" style="background:${p.g}">${icon(p.icon)}</div>`, title: p.name, sub: `${num(n)} آهنگ • هوشمند`, go: `playlist/${k}` });
    }).join('');
    const mine = Array.from(S.playlists.values()).sort((a, b) => b.created - a.created).map((p) => {
      const ts = p.ids.map((id) => S.tracks.get(id)).filter(Boolean);
      const cv = ts.filter((t) => t.coverId).slice(0, 4);
      const art = cv.length >= 4 ? `<div class="mix-art">${cv.map((t) => coverHtml(t, 'q')).join('')}</div>` : `<div class="pl-art" style="background:linear-gradient(135deg,hsl(${hash(p.id) % 360} 70% 50%),hsl(${(hash(p.id) + 60) % 360} 70% 40%))">${icon('list')}</div>`;
      return card({ cover: art, title: p.name, sub: `${num(ts.length)} آهنگ`, go: `playlist/${p.id}` });
    }).join('');
    return `<div class="page-head"><h1>${icon('list')} پلی‌لیست‌ها</h1><button class="btn primary" data-act="new-playlist">${icon('plus')} پلی‌لیست جدید</button></div>
      <h2 class="sub-h">هوشمند</h2><div class="grid">${smart}</div>
      <h2 class="sub-h">پلی‌لیست‌های من</h2>${mine ? `<div class="grid">${mine}</div>` : '<p class="muted pad">هنوز پلی‌لیستی نساختی. از منوی «⋯» هر آهنگ می‌تونی اضافه‌اش کنی.</p>'}`;
  };

  views.playlist = (id) => {
    const smart = SMART[id];
    let tracks, name, art, kicker, actions = '';
    if (smart) {
      tracks = smart.get(); name = smart.name; kicker = 'پلی‌لیست هوشمند';
      art = `<div class="hero-icon" style="background:${smart.g}">${icon(smart.icon)}</div>`;
    } else {
      const p = S.playlists.get(id);
      if (!p) return '<p class="pad muted">پلی‌لیست پیدا نشد.</p>';
      tracks = p.ids.map((x) => S.tracks.get(x)).filter(Boolean); name = p.name; kicker = 'پلی‌لیست';
      art = `<div class="hero-icon" style="background:linear-gradient(135deg,hsl(${hash(p.id) % 360} 70% 50%),hsl(${(hash(p.id) + 60) % 360} 70% 40%))">${icon('list')}</div>`;
      actions = `<button class="icon-btn" data-act="rename-pl" data-id="${p.id}" title="تغییر نام">${icon('edit')}</button>
        <button class="icon-btn" data-act="export-pl" data-id="${p.id}" title="خروجی M3U">${icon('download')}</button>
        <button class="icon-btn" data-act="delete-pl" data-id="${p.id}" title="حذف">${icon('trash')}</button>`;
    }
    const key = registerList('pl-' + id, tracks);
    const dur = tracks.reduce((s, t) => s + (t.duration || 0), 0);
    return hero({ art, kicker, title: esc(name), meta: `${num(tracks.length)} آهنگ${dur ? ' • ' + fmtLong(dur) : ''}`, actions: playBtns(key) + actions })
      + (tracks.length ? trackRows(tracks, key, { showAdded: id === 'newmonth' }) : '<p class="muted pad">این پلی‌لیست خالیه.</p>');
  };

  views.stats = () => {
    if (!S.tracks.size) return emptyState();
    const tracks = all();
    const cs = countries();
    const max = cs[0] ? cs[0].tracks.length : 1;
    const plays = tracks.reduce((s, t) => s + (t.plays || 0), 0);
    const dur = tracks.reduce((s, t) => s + (t.duration || 0), 0);
    const arts = artistsList().sort((a, b) => b.plays - a.plays || b.tracks.length - a.tracks.length).slice(0, 10);
    const genres = Array.from(groupBy(tracks.filter((t) => t.genre), (t) => t.genre).entries()).sort((a, b) => b[1].length - a[1].length).slice(0, 8);
    const decades = Array.from(groupBy(tracks.filter((t) => t.year > 1900), (t) => Math.floor(t.year / 10) * 10).entries()).sort((a, b) => a[0] - b[0]);
    const dmax = Math.max(1, ...decades.map((d) => d[1].length));
    const playsByCountry = cs.map((c) => ({ code: c.code, plays: c.tracks.reduce((s, t) => s + (t.plays || 0), 0) })).filter((c) => c.plays).sort((a, b) => b.plays - a.plays).slice(0, 6);
    const pmax = Math.max(1, ...playsByCountry.map((p) => p.plays));
    return `<div class="page-head"><h1>${icon('chart')} آمار شنیدن</h1></div>
      <div class="kpis">
        <div class="kpi"><small>آهنگ</small><b>${num(tracks.length)}</b></div>
        <div class="kpi"><small>خواننده</small><b>${num(artistsList().length)}</b></div>
        <div class="kpi"><small>کشور</small><b>${num(cs.filter((c) => c.code !== 'ZZ').length)}</b></div>
        <div class="kpi"><small>مدت کتابخانه</small><b>${fmtLong(dur)}</b></div>
        <div class="kpi"><small>دفعات پخش</small><b>${num(plays)}</b></div>
        <div class="kpi"><small>زمان گوش دادن</small><b>${fmtLong(S.listenSeconds)}</b></div>
      </div>
      <div class="panels">
        <div class="panel"><h3>آهنگ‌ها بر اساس کشور</h3>${cs.slice(0, 12).map((c) => `<div class="hbar" data-go="country/${c.code}">${flagHtml(c.code, 'sm')}<span class="hbar-l">${esc(Country.name(c.code))}</span><div class="hbar-t"><i style="width:${(c.tracks.length / max) * 100}%;--h:${hash(c.code) % 360}"></i></div><b>${num(c.tracks.length)}</b></div>`).join('')}</div>
        <div class="panel"><h3>بیشترین شنیده‌شده بر اساس کشور</h3>${playsByCountry.length ? playsByCountry.map((c) => `<div class="hbar">${flagHtml(c.code, 'sm')}<span class="hbar-l">${esc(Country.name(c.code))}</span><div class="hbar-t"><i style="width:${(c.plays / pmax) * 100}%;--h:${hash(c.code) % 360}"></i></div><b>${num(c.plays)}</b></div>`).join('') : '<p class="muted">هنوز چیزی پخش نکردی.</p>'}</div>
        <div class="panel"><h3>خواننده‌های برتر</h3>${arts.map((a, i) => `<div class="rank" data-go="artist/${encodeURIComponent(a.key)}"><span class="rank-n">${fa(i + 1)}</span>${coverHtml(a.tracks.find((t) => t.coverId) || a.tracks[0], 'xs round-cover', a.name)}<div><b>${esc(a.name)}</b><small>${num(a.plays)} پخش • ${num(a.tracks.length)} آهنگ</small></div>${flagHtml(a.country, 'sm')}</div>`).join('')}</div>
        ${decades.length ? `<div class="panel"><h3>دهه‌ها</h3><div class="vbars">${decades.map(([d, ts]) => `<div class="vbar"><i style="height:${(ts.length / dmax) * 100}%"></i><small>${fa(d)}</small></div>`).join('')}</div></div>` : ''}
        ${genres.length ? `<div class="panel"><h3>ژانرها</h3>${genres.map(([g, ts]) => `<div class="hbar"><span class="hbar-l">${esc(g)}</span><div class="hbar-t"><i style="width:${(ts.length / genres[0][1].length) * 100}%;--h:${hash(g) % 360}"></i></div><b>${num(ts.length)}</b></div>`).join('')}</div>` : ''}
      </div>`;
  };

  views.search = (q = '') => {
    q = decodeURIComponent(q || '').trim();
    if (!q) {
      const cs = countries();
      return `<div class="page-head"><h1>${icon('search')} جستجو</h1></div>
        <h2 class="sub-h">مرور کشورها</h2><div class="ggrid">${cs.map((c) => `<div class="gtile" style="--h:${hash(c.code) % 360}" data-go="country/${c.code}"><b>${esc(Country.name(c.code))}</b><small>${num(c.tracks.length)} آهنگ</small><div class="gtile-flag">${flagHtml(c.code, 'lg')}</div></div>`).join('')}</div>`;
    }
    const n = Country.norm(q);
    const match = (s) => Country.norm(s).includes(n);
    const tracks = all().filter((t) => match(t.title) || match(t.artist) || match(t.album) || match(t.genre) || match(Country.name(t.country)) || match(Country.enName(t.country)));
    const arts = artistsList().filter((a) => match(a.name));
    const albums = albumsList().filter((a) => match(a.name));
    const cs = countries().filter((c) => match(Country.name(c.code)) || match(Country.enName(c.code)));
    if (!tracks.length && !arts.length) return `<div class="pad muted center">برای «${esc(q)}» چیزی پیدا نشد.</div>`;
    return `<div class="page-head"><h1>نتایج «${esc(q)}»</h1></div>`
      + (cs.length ? `<div class="cgrid">${cs.map((c) => countryCard(c, true)).join('')}</div>` : '')
      + (arts.length ? shelf('خواننده‌ها', arts.slice(0, 20).map((a) => card({ cover: coverHtml(a.tracks.find((t) => t.coverId) || a.tracks[0], 'round-cover', a.name), title: a.name, sub: `${num(a.tracks.length)} آهنگ`, go: `artist/${encodeURIComponent(a.key)}`, round: true })).join('')) : '')
      + (albums.length ? shelf('آلبوم‌ها', albums.slice(0, 20).map((a) => card({ cover: coverHtml(a.cover), title: a.name, sub: esc(a.artist), go: `album/${encodeURIComponent(a.key)}` })).join('')) : '')
      + (tracks.length ? `<section class="shelf"><div class="shelf-head"><h2>آهنگ‌ها <small class="muted">${num(tracks.length)}</small></h2></div>${trackRows(tracks, 'search')}</section>` : '');
  };

  views.settings = () => {
    const st = S.settings;
    const accents = ['#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6', '#a3e635'];
    const known = Array.from(S.artists.values());
    const srcStats = {};
    for (const t of S.tracks.values()) srcStats[t.countrySource] = (srcStats[t.countrySource] || 0) + 1;
    return `<div class="page-head"><h1>${icon('gear')} تنظیمات</h1></div>
      <div class="settings">
        <section class="set-card"><h3>${icon('folder')} کتابخانه</h3>
          <p class="muted">${num(S.tracks.size)} آهنگ • ${S.dirs.length ? 'پوشه‌ها: ' + S.dirs.map((d) => esc(d.name)).join('، ') : 'پوشه‌ی متصلی نیست'}</p>
          <div class="btn-row"><button class="btn primary" data-act="add-folder">${icon('folder')} افزودن پوشه</button>
          <button class="btn ghost" data-act="add-files">${icon('plus')} افزودن آهنگ</button>
          ${S.dirs.length ? `<button class="btn ghost" data-act="rescan">${icon('refresh')} اسکن دوباره</button>` : ''}
          <button class="btn danger" data-act="clear-lib">${icon('trash')} پاک کردن کتابخانه</button></div>
          <label class="switch"><input type="checkbox" data-set="keepCopies" ${st.keepCopies ? 'checked' : ''}><span></span><div><b>ذخیره‌ی آفلاین داخل اپ</b><small>یک کپی از آهنگ‌های جدید داخل حافظه‌ی مرورگر نگه داشته می‌شه تا بعد از بستن اپ هم بدون انتخاب دوباره‌ی پوشه پخش بشن (مخصوص موبایل و آیفون).</small></div></label>
        </section>
        <section class="set-card"><h3>${icon('globe')} تشخیص کشور</h3>
          <p class="muted">${Object.entries(srcStats).map(([k, v]) => `${SOURCE_LABEL[k] || k}: ${num(v)}`).join(' • ') || '—'}</p>
          <label class="switch"><input type="checkbox" data-set="online" ${st.online ? 'checked' : ''}><span></span><div><b>جستجوی آنلاین در MusicBrainz</b><small>برای خواننده‌هایی که در پایگاه داده‌ی داخلی نیستن، کشورشون از دانشنامه‌ی آزاد موسیقی MusicBrainz پرسیده می‌شه (فقط نام خواننده ارسال می‌شه).</small></div></label>
          <div class="btn-row"><button class="btn ghost" data-act="redetect">${icon('radar')} تشخیص دوباره‌ی همه</button></div>
          <p class="muted small">${num(known.filter((a) => a.manual).length)} خواننده با انتخاب دستی</p>
        </section>
        <section class="set-card"><h3>${icon('palette')} ظاهر</h3>
          <div class="swatches">${accents.map((c) => `<button class="swatch ${st.accent === c ? 'on' : ''}" style="background:${c}" data-accent="${c}"></button>`).join('')}<input type="color" value="${st.accent}" id="accent-pick"></div>
          <div class="seg">${[['dark', 'تیره'], ['light', 'روشن'], ['auto', 'خودکار']].map(([k, l]) => `<button class="${st.theme === k ? 'on' : ''}" data-theme="${k}">${l}</button>`).join('')}</div>
          <label class="switch"><input type="checkbox" data-set="dynamic" ${st.dynamic ? 'checked' : ''}><span></span><div><b>رنگ پویا از کاور آهنگ</b><small>رنگ پس‌زمینه با کاور آهنگ در حال پخش هماهنگ می‌شه.</small></div></label>
          <label class="switch"><input type="checkbox" data-set="visualizer" ${st.visualizer ? 'checked' : ''}><span></span><div><b>ویژوالایزر</b><small>نمایش موج صدا در صفحه‌ی در حال پخش</small></div></label>
        </section>
        <section class="set-card"><h3>${icon('sliders')} اکولایزر</h3>${eqHtml()}</section>
        <section class="set-card"><h3>${icon('download')} پشتیبان‌گیری</h3>
          <p class="muted">لایک‌ها، پلی‌لیست‌ها، آمار پخش و کشورهای انتخابی‌ات رو ذخیره یا بازیابی کن.</p>
          <div class="btn-row"><button class="btn ghost" data-act="export">${icon('download')} خروجی گرفتن</button><button class="btn ghost" data-act="import">${icon('upload')} بازیابی</button></div>
        </section>
        <section class="set-card"><h3>${icon('keyboard')} میانبرهای صفحه‌کلید</h3>
          <div class="keys">${[['Space', 'پخش / توقف'], ['→ / ←', '۱۰ ثانیه جلو / عقب'], ['Shift + → / ←', 'آهنگ بعدی / قبلی'], ['↑ / ↓', 'صدا'], ['L', 'پسندیدن'], ['S', 'تصادفی'], ['R', 'تکرار'], ['M', 'بی‌صدا'], ['F', 'صفحه‌ی در حال پخش'], ['/', 'جستجو']].map(([k, d]) => `<div><kbd>${k}</kbd><span>${d}</span></div>`).join('')}</div>
        </section>
        <section class="set-card about"><h3>درباره‌ی آوا</h3><p class="muted">آوا کاملاً روی دستگاه خودت اجرا می‌شه. آهنگ‌ها هیچ‌وقت آپلود نمی‌شن. نسخه‌ی ۱٫۰</p></section>
      </div>`;
  };

  function eqHtml() {
    const g = S.settings.eq;
    const label = (f) => f >= 1000 ? fa(f / 1000) + 'k' : fa(f);
    return `<div class="eq-presets">${Object.keys(Player.EQ_PRESETS).map((p) => `<button class="chip ${S.settings.eqPreset === p ? 'on' : ''}" data-eqp="${p}">${p}</button>`).join('')}</div>
      <div class="eq">${Player.EQ_BANDS.map((f, i) => `<div class="eq-band"><input type="range" min="-12" max="12" step="1" value="${g[i]}" data-eq="${i}" orient="vertical"><small>${label(f)}</small></div>`).join('')}</div>`;
  }

  /* =========================================================
   * مسیریابی
   * ========================================================= */
  let currentRoute = '';
  function route() {
    const h = location.hash.replace(/^#\/?/, '') || 'home';
    const [name, ...rest] = h.split('/');
    const arg = rest.join('/');
    currentRoute = h;
    const fn = views[name] || views.home;
    const view = $('#view');
    view.innerHTML = `<div class="page">${fn(arg)}</div>`;
    view.scrollTop = 0;
    $$('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.route === name || (name === 'country' && a.dataset.route === 'countries') || (['artist', 'album'].includes(name) && a.dataset.route === 'library') || (name === 'playlist' && a.dataset.route === 'playlists')));
    afterRender(view);
  }
  function render() { route(); }
  const softRefresh = debounce(() => {
    // بدون پریدن اسکرول صفحه را به‌روز کن
    if (document.activeElement && document.activeElement.closest('#view input, #view select')) return;
    const view = $('#view');
    const top = view.scrollTop;
    const h = location.hash.replace(/^#\/?/, '') || 'home';
    const [name, ...rest] = h.split('/');
    const fn = views[name] || views.home;
    view.innerHTML = `<div class="page">${fn(rest.join('/'))}</div>`;
    view.scrollTop = top;
    afterRender(view);
  }, 700);

  function afterRender(root) {
    hydrateCovers(root);
    markPlaying();
    const ss = $('#sort-select', root);
    if (ss) ss.onchange = () => { S.sort = ss.value; render(); };
    for (const el of $$('.load-more', root)) moreObserver.observe(el);
  }
  const moreObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target;
      moreObserver.unobserve(el);
      const key = el.dataset.more, from = +el.dataset.from, opts = JSON.parse(el.dataset.opts);
      const ids = S.lists[key] || [];
      const chunk = ids.slice(from, from + 150).map((id, j) => trackRow(S.tracks.get(id), key, from + j, opts)).join('');
      const next = from + 150 < ids.length ? `<div class="load-more" data-more="${esc(key)}" data-from="${from + 150}" data-opts='${JSON.stringify(opts)}'></div>` : '';
      el.insertAdjacentHTML('afterend', chunk + next);
      const parent = el.parentElement;
      el.remove();
      hydrateCovers(parent);
      markPlaying();
      const n = $('.load-more', parent);
      if (n) moreObserver.observe(n);
    }
  }, { rootMargin: '600px' });

  function go(path) { location.hash = '#/' + path; }

  /* =========================================================
   * منوها و دیالوگ‌ها
   * ========================================================= */
  function closeMenu() { $('#menu').hidden = true; }
  function openMenu(x, y, items) {
    const m = $('#menu');
    m.innerHTML = items.map((it, i) => it === '-' ? '<hr>' : `<button data-mi="${i}">${icon(it.icon)}<span>${esc(it.label)}</span></button>`).join('');
    m.hidden = false;
    const r = m.getBoundingClientRect();
    const W = window.innerWidth, H = window.innerHeight;
    if (W < 640) { m.classList.add('sheet'); m.style.left = ''; m.style.top = ''; }
    else {
      m.classList.remove('sheet');
      m.style.left = Math.min(Math.max(8, x - r.width), W - r.width - 8) + 'px';
      m.style.top = Math.max(8, Math.min(y, H - r.height - 8)) + 'px';
    }
    m.onclick = (e) => {
      const b = e.target.closest('[data-mi]');
      if (!b) return;
      closeMenu();
      items[+b.dataset.mi].run();
    };
  }

  function trackMenu(id, x, y) {
    const t = S.tracks.get(id);
    if (!t) return;
    openMenu(x, y, [
      { icon: 'play', label: 'پخش', run: () => Player.playList([id]) },
      { icon: 'next-up', label: 'پخش بعدی', run: () => { Player.playNext(id); toast('بعد از این آهنگ پخش می‌شه'); } },
      { icon: 'queue', label: 'افزودن به صف', run: () => { Player.addToQueue(id); toast('به صف اضافه شد'); } },
      '-',
      { icon: t.liked ? 'heart-fill' : 'heart', label: t.liked ? 'حذف از پسندیده‌ها' : 'پسندیدن', run: () => toggleLike(id) },
      { icon: 'list', label: 'افزودن به پلی‌لیست…', run: () => addToPlaylistDialog([id]) },
      '-',
      { icon: 'flag', label: `تغییر کشور (${Country.name(t.country)})…`, run: () => countryDialog(t) },
      { icon: 'mic', label: 'رفتن به خواننده', run: () => go('artist/' + encodeURIComponent(artistKey(t))) },
      ...(t.album ? [{ icon: 'disc', label: 'رفتن به آلبوم', run: () => go('album/' + encodeURIComponent(albumKeyOf(t))) }] : []),
      { icon: 'globe', label: `رفتن به ${Country.name(t.country)}`, run: () => go('country/' + t.country) },
      { icon: 'info', label: 'اطلاعات آهنگ', run: () => infoDialog(t) },
    ]);
  }

  function dialog(html, { wide = false } = {}) {
    const d = $('#dialog');
    d.innerHTML = `<div class="dlg ${wide ? 'wide' : ''}"><button class="icon-btn dlg-x" data-close>${icon('close')}</button>${html}</div>`;
    d.hidden = false;
    d.onclick = (e) => { if (e.target === d || e.target.closest('[data-close]')) closeDialog(); };
    return d;
  }
  function closeDialog() { $('#dialog').hidden = true; $('#dialog').innerHTML = ''; }

  function allCountryCodes() {
    const set = new Set(Object.keys(window.KNOWN_ARTISTS));
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (const a of A) for (const b of A) {
      const c = a + b;
      try { const n = new Intl.DisplayNames(['en'], { type: 'region' }).of(c); if (n && n !== c && !/^\d/.test(n)) set.add(c); } catch (e) {}
    }
    ['EU', 'UN', 'EZ', 'QO', 'XA', 'XB', 'ZZ', 'AQ', 'BV', 'HM', 'TF', 'UM', 'IO', 'DG', 'EA', 'IC', 'CP', 'TA', 'AC', 'CQ'].forEach((c) => set.delete(c));
    set.add('XA');
    return Array.from(set).sort((a, b) => new Intl.Collator('fa').compare(Country.name(a), Country.name(b)));
  }
  let codesCache;

  function countryDialog(t, artistOnlyKey) {
    codesCache = codesCache || allCountryCodes();
    const key = artistOnlyKey || artistKey(t);
    const name = t ? Country.primaryArtist(t.artist) : (S.artists.get(key) && key);
    const cur = t ? t.country : null;
    const used = countries().map((c) => c.code).filter((c) => c !== 'ZZ');
    const d = dialog(`<h2>${icon('flag')} انتخاب کشور</h2>
      ${t ? `<p class="muted">${esc(t.title)} — ${esc(t.artist)}</p><p class="why">تشخیص فعلی: ${flagHtml(t.country, 'sm')} <b>${esc(Country.name(t.country))}</b> <small>(${esc(SOURCE_LABEL[t.countrySource] || '')}: ${esc(t.countryWhy)})</small></p>` : ''}
      ${t ? `<div class="seg scope"><button class="on" data-scope="artist">همه‌ی آهنگ‌های «${esc(name)}»</button><button data-scope="track">فقط این آهنگ</button></div>` : ''}
      <input class="input" id="cq" placeholder="جستجوی کشور…" autocomplete="off">
      <div class="clist">${[...used, ...codesCache.filter((c) => !used.includes(c))].map((c) => `<button class="citem ${c === cur ? 'on' : ''}" data-code="${c}" data-s="${esc(Country.name(c) + ' ' + Country.enName(c) + ' ' + c)}">${flagHtml(c, 'sm')}<span>${esc(Country.name(c))}</span><small>${esc(Country.enName(c))}</small></button>`).join('')}</div>
      <div class="btn-row"><button class="btn ghost" data-reset>${icon('refresh')} برگرداندن به تشخیص خودکار</button></div>`);
    let scope = 'artist';
    const q = $('#cq', d);
    q.focus();
    q.oninput = () => {
      const n = q.value.trim().toLowerCase();
      for (const b of $$('.citem', d)) b.hidden = n && !b.dataset.s.toLowerCase().includes(n);
    };
    d.querySelectorAll('[data-scope]').forEach((b) => b.onclick = () => {
      scope = b.dataset.scope;
      d.querySelectorAll('[data-scope]').forEach((x) => x.classList.toggle('on', x === b));
    });
    $('.clist', d).onclick = (e) => {
      const b = e.target.closest('.citem');
      if (!b) return;
      setCountry(t, key, b.dataset.code, scope);
      closeDialog();
    };
    $('[data-reset]', d).onclick = () => { setCountry(t, key, null, scope); closeDialog(); };
  }

  function setCountry(t, key, code, scope) {
    if (scope === 'track' && t) {
      t.manualCountry = code || null;
      resolveCountry(t); queueSave(t);
    } else {
      if (code) S.artists.set(key, { country: code, manual: true, source: 'manual', why: 'انتخاب شما', confidence: 1, checked: true });
      else {
        S.artists.delete(key);
        const sample = all().find((x) => artistKey(x) === key);
        if (sample) {
          const known = Country.lookupKnown(Country.primaryArtist(sample.artist));
          if (known) S.artists.set(key, { country: known, source: 'db', why: 'شناخته‌شده در پایگاه داده‌ی آوا', confidence: 0.95, checked: true });
          else if (S.settings.online) {
            Country.lookupOnline(Country.primaryArtist(sample.artist)).then((r) => {
              if (r && !r.error) { S.artists.set(key, { ...r, checked: true }); saveArtists(); recomputeAll(); }
            });
          }
        }
      }
      saveArtists();
      for (const x of all()) if (artistKey(x) === key) { if (code) x.manualCountry = null; resolveCountry(x); queueSave(x); }
    }
    toast(code ? `کشور به «${Country.name(code)}» تغییر کرد` : 'به تشخیص خودکار برگشت');
    softRefresh();
    updateNowPlaying();
  }

  function infoDialog(t) {
    const rows = [
      ['عنوان', t.title], ['خواننده', t.artist], ['آلبوم', t.album], ['ژانر', t.genre], ['سال', t.year && fa(t.year)],
      ['کشور', `${Country.emoji(t.country)} ${Country.name(t.country)}`], ['روش تشخیص', `${SOURCE_LABEL[t.countrySource] || ''} — ${t.countryWhy}`],
      ['اطمینان', `${fa(Math.round((t.countryConf || 0) * 100))}٪`], ['مدت', t.duration ? fmtTime(t.duration) : ''],
      ['تعداد پخش', num(t.plays || 0)], ['اضافه شده', new Date(t.addedAt).toLocaleDateString('fa-IR')],
      ['حجم', fa((t.size / 1048576).toFixed(1)) + ' مگابایت'], ['مسیر', t.path],
    ].filter((r) => r[1]);
    dialog(`<div class="info-head">${coverHtml(t, 'md')}<div><h2>${esc(t.title)}</h2><p class="muted">${esc(t.artist)}</p></div></div>
      <table class="info">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join('')}</table>
      ${t.lyrics ? `<h3>متن آهنگ</h3><pre class="lyrics-pre">${esc(t.lyrics)}</pre>` : ''}`);
    hydrateCovers($('#dialog'));
  }

  function addToPlaylistDialog(ids) {
    const pls = Array.from(S.playlists.values());
    const d = dialog(`<h2>${icon('list')} افزودن به پلی‌لیست</h2>
      <div class="new-pl"><input class="input" id="npl" placeholder="نام پلی‌لیست جدید"><button class="btn primary" id="npl-b">${icon('plus')} بساز</button></div>
      <div class="pl-pick">${pls.map((p) => `<button data-pl="${p.id}">${icon('list')}<span>${esc(p.name)}</span><small>${num(p.ids.length)}</small></button>`).join('') || '<p class="muted">هنوز پلی‌لیستی نداری.</p>'}</div>`);
    const add = (p) => {
      const before = p.ids.length;
      for (const id of ids) if (!p.ids.includes(id)) p.ids.push(id);
      savePlaylists();
      toast(p.ids.length > before ? `به «${p.name}» اضافه شد` : 'از قبل در این پلی‌لیست بود');
      closeDialog(); softRefresh();
    };
    $('#npl-b', d).onclick = () => {
      const name = $('#npl', d).value.trim() || `پلی‌لیست ${num(S.playlists.size + 1)}`;
      const p = { id: 'p' + Date.now().toString(36), name, ids: [], created: Date.now() };
      S.playlists.set(p.id, p); add(p);
    };
    $('.pl-pick', d).onclick = (e) => { const b = e.target.closest('[data-pl]'); if (b) add(S.playlists.get(b.dataset.pl)); };
  }

  function promptDialog(title, value, cb) {
    const d = dialog(`<h2>${title}</h2><input class="input" id="pd" value="${esc(value || '')}"><div class="btn-row"><button class="btn primary" id="pd-ok">تایید</button><button class="btn ghost" data-close>انصراف</button></div>`);
    const i = $('#pd', d); i.focus(); i.select();
    const ok = () => { cb(i.value.trim()); closeDialog(); };
    $('#pd-ok', d).onclick = ok;
    i.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
  }
  function confirmDialog(text, cb) {
    const d = dialog(`<h2>مطمئنی؟</h2><p>${text}</p><div class="btn-row"><button class="btn danger" id="cf-ok">بله</button><button class="btn ghost" data-close>انصراف</button></div>`);
    $('#cf-ok', d).onclick = () => { closeDialog(); cb(); };
  }

  /* =========================================================
   * لایک و پخش
   * ========================================================= */
  function toggleLike(id) {
    const t = S.tracks.get(id);
    if (!t) return;
    t.liked = !t.liked;
    t.likedAt = t.liked ? Date.now() : 0;
    queueSave(t);
    for (const b of $$(`[data-like-id="${id}"]`)) { b.classList.toggle('on', t.liked); b.innerHTML = icon(t.liked ? 'heart-fill' : 'heart'); }
    if (Player.current === id) updateNowPlaying();
    toast(t.liked ? 'به پسندیده‌ها اضافه شد ❤️' : 'از پسندیده‌ها حذف شد');
  }

  function playKey(key, { shuffle = false } = {}) {
    let start = 0;
    const m = !S.lists[key] && key.match(/^(.*)@(\d+)$/);
    if (m) { key = m[1]; start = +m[2]; }
    const ids = S.lists[key];
    if (!ids || !ids.length) return;
    Player.playList(ids, start, shuffle ? { shuffle: true } : {});
  }

  function markPlaying() {
    for (const r of $$('.row.playing')) r.classList.remove('playing');
    if (!Player.current) return;
    for (const r of $$(`.row[data-id="${Player.current}"]`)) r.classList.add('playing');
    document.body.classList.toggle('is-playing', !Player.audio.paused);
  }

  /* =========================================================
   * پخش‌کننده (رابط)
   * ========================================================= */
  let playCounted = false, lastTime = 0;
  function updateNowPlaying() {
    const t = S.tracks.get(Player.current);
    const bar = $('#playerbar');
    bar.classList.toggle('empty', !t);
    if (!t) return;
    for (const el of $$('[data-np="title"]')) el.textContent = t.title;
    for (const el of $$('[data-np="artist"]')) { el.textContent = t.artist; el.dataset.go = 'artist/' + encodeURIComponent(artistKey(t)); }
    for (const el of $$('[data-np="cover"]')) {
      el.dataset.cid = t.coverId || '';
      el.style.backgroundImage = '';
      el.classList.remove('has-img');
      el.style.setProperty('--h', hash(t.album || t.artist || t.title) % 360);
      el.querySelector('span').textContent = (t.album || t.title || '♪').charAt(0);
      if (t.coverId) loadCoverInto(el);
    }
    for (const el of $$('[data-np="country"]')) el.innerHTML = countryChip(t);
    for (const el of $$('[data-np="like"]')) { el.dataset.likeId = t.id; el.classList.toggle('on', !!t.liked); el.innerHTML = icon(t.liked ? 'heart-fill' : 'heart'); }
    const np = $('#np');
    np.querySelector('.np-album').textContent = t.album ? `از آلبوم ${t.album}` : '';
    document.title = `${t.title} • ${t.artist} — آوا`;
    applyDynamicColor(t);
    getCoverUrl(t.coverId).then((u) => Player.setMediaSession(t, u));
    renderLyrics(t);
    renderQueue();
  }

  async function applyDynamicColor(t) {
    let rgb = null;
    if (S.settings.dynamic && t && t.coverId) {
      await getCoverUrl(t.coverId);
      rgb = S.coverColors.get(t.coverId);
    }
    if (!rgb && t) {
      const h = hash(t.album || t.artist || t.title) % 360;
      document.documentElement.style.setProperty('--dyn', `hsl(${h} 55% 40%)`);
    } else if (rgb) {
      // روشنایی رنگ را متعادل کن
      const [r, g, b] = rgb;
      const l = (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
      const k = l < 60 ? 1.8 : l > 180 ? 0.6 : 1;
      document.documentElement.style.setProperty('--dyn', `rgb(${Math.min(255, r * k) | 0},${Math.min(255, g * k) | 0},${Math.min(255, b * k) | 0})`);
    }
  }

  function renderLyrics(t) {
    const el = $('#np-lyrics');
    if (!t || !t.lyrics) { el.innerHTML = `<div class="muted center pad">${icon('lyrics')}<p>متن این آهنگ در فایلش ذخیره نشده.</p></div>`; return; }
    el.innerHTML = `<div class="lyrics">${t.lyrics.split(/\r?\n/).map((l) => `<p>${esc(l.replace(/^\[\d+:\d+(\.\d+)?\]/, '')) || '&nbsp;'}</p>`).join('')}</div>`;
  }

  function renderQueue() {
    const el = $('#np-queue');
    if (!el) return;
    const items = Player.queue.map((id, i) => ({ t: S.tracks.get(id), i })).filter((x) => x.t);
    const cur = items.find((x) => x.i === Player.index);
    const up = items.filter((x) => x.i > Player.index).slice(0, 200);
    el.innerHTML = `${cur ? `<h4>در حال پخش</h4>${queueItem(cur.t, cur.i, true)}` : ''}
      <h4>بعدی‌ها <small>${num(items.length - Player.index - 1)}</small></h4>${up.map((x) => queueItem(x.t, x.i)).join('') || '<p class="muted">صف خالیه.</p>'}`;
    hydrateCovers(el);
  }
  const queueItem = (t, i, cur) => `<div class="qitem ${cur ? 'cur' : ''}" data-qi="${i}" draggable="${!cur}">${coverHtml(t, 'xs')}<div><b>${esc(t.title)}</b><small>${esc(t.artist)}</small></div>${flagHtml(t.country, 'xs')}${cur ? '' : `<button class="icon-btn" data-qrm="${i}">${icon('close')}</button>`}</div>`;

  function updateProgress() {
    const a = Player.audio;
    const d = a.duration || 0, c = a.currentTime || 0;
    const pct = d ? (c / d) * 100 : 0;
    for (const el of $$('.seek')) { if (!el._drag) { el.value = d ? c / d * 1000 : 0; el.style.setProperty('--p', pct + '%'); } }
    for (const el of $$('[data-np="cur"]')) el.textContent = fmtTime(c);
    for (const el of $$('[data-np="dur"]')) el.textContent = fmtTime(d);
    $('#mini-progress').style.width = pct + '%';
  }

  function updatePlayState() {
    const playing = !Player.audio.paused;
    for (const b of $$('[data-act="toggle"]')) b.innerHTML = icon(playing ? 'pause' : 'play');
    document.body.classList.toggle('is-playing', playing);
  }
  function updateModes() {
    for (const b of $$('[data-act="shuffle"]')) b.classList.toggle('on', Player.shuffle);
    for (const b of $$('[data-act="repeat"]')) { b.classList.toggle('on', Player.repeat !== 'off'); b.innerHTML = icon(Player.repeat === 'one' ? 'repeat-one' : 'repeat'); }
  }
  function updateVolume() {
    const v = Player.audio.muted ? 0 : Player.audio.volume;
    for (const el of $$('.vol')) { el.value = v * 100; el.style.setProperty('--p', v * 100 + '%'); }
    for (const b of $$('[data-act="mute"]')) b.innerHTML = icon(v === 0 ? 'vol-mute' : v < 0.5 ? 'vol-low' : 'vol');
  }

  function openNP() { $('#np').classList.add('open'); document.body.classList.add('np-open'); startViz(); }
  function closeNP() { $('#np').classList.remove('open'); document.body.classList.remove('np-open'); }
  function npTab(name) {
    $$('#np [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    $$('#np .np-pane').forEach((p) => p.hidden = p.id !== 'np-' + name);
    $('#np').classList.toggle('side-open', !!name);
    if (name === 'eq') $('#np-eq').innerHTML = eqHtml() + `<div class="speed"><h4>سرعت پخش</h4><div class="seg">${[0.75, 1, 1.25, 1.5, 2].map((r) => `<button class="${(S.settings.rate || 1) === r ? 'on' : ''}" data-rate="${r}">${fa(r)}×</button>`).join('')}</div></div>`;
    if (name === 'queue') renderQueue();
  }

  /* ویژوالایزر */
  let vizRaf;
  function startViz() {
    cancelAnimationFrame(vizRaf);
    const cv = $('#viz');
    if (!S.settings.visualizer) { cv.hidden = true; return; }
    cv.hidden = false;
    const ctx = cv.getContext('2d');
    const draw = () => {
      vizRaf = requestAnimationFrame(draw);
      if (!$('#np').classList.contains('open')) return cancelAnimationFrame(vizRaf);
      const an = Player.analyser();
      const W = cv.width = cv.clientWidth * devicePixelRatio, H = cv.height = cv.clientHeight * devicePixelRatio;
      ctx.clearRect(0, 0, W, H);
      if (!an) return;
      const data = new Uint8Array(an.frequencyBinCount);
      an.getByteFrequencyData(data);
      const n = 64, bw = W / n;
      const col = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8b5cf6';
      ctx.fillStyle = col;
      for (let i = 0; i < n; i++) {
        const v = data[Math.floor(i * data.length / n / 1.3)] / 255;
        const h = Math.max(2, v * v * H);
        ctx.globalAlpha = 0.35 + v * 0.6;
        const x = i * bw + bw * 0.2;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, H - h, bw * 0.6, h, bw * 0.3); else ctx.rect(x, H - h, bw * 0.6, h);
        ctx.fill();
      }
    };
    draw();
  }

  /* تایمر خواب */
  function sleepMenu(x, y) {
    const opts = [[0, 'خاموش'], [5, '۵ دقیقه'], [15, '۱۵ دقیقه'], [30, '۳۰ دقیقه'], [45, '۴۵ دقیقه'], [60, '۱ ساعت'], ['end', 'پایان همین آهنگ']];
    openMenu(x, y, opts.map(([m, l]) => ({ icon: 'moon', label: l, run: () => { Player.setSleep(m); toast(m ? `تایمر خواب: ${l}` : 'تایمر خواب خاموش شد'); } })));
  }
  function updateSleep() {
    for (const b of $$('[data-act="sleep"]')) {
      b.classList.toggle('on', !!(Player.sleepAt || Player.sleepEndOfTrack));
      b.title = Player.sleepAt ? `توقف در ${fa(Math.ceil((Player.sleepAt - Date.now()) / 60000))} دقیقه` : 'تایمر خواب';
    }
  }

  /* =========================================================
   * رویدادها
   * ========================================================= */
  function bindEvents() {
    document.addEventListener('click', (e) => {
      const el = e.target;
      if (!el.closest('#menu') && !el.closest('[data-act="menu"]') && !el.closest('[data-act="sleep"]')) closeMenu();

      const act = el.closest('[data-act]');
      if (act) {
        const a = act.dataset.act;
        const row = act.closest('.row');
        e.stopPropagation();
        switch (a) {
          case 'play-row': playKey(`${row.dataset.list}@${row.dataset.i}`); return;
          case 'like': toggleLike(act.dataset.likeId || (row && row.dataset.id)); return;
          case 'menu': { const r = act.getBoundingClientRect(); trackMenu(row ? row.dataset.id : Player.current, r.left, r.bottom); return; }
          case 'country': {
            const t = S.tracks.get(act.dataset.tid || (row ? row.dataset.id : Player.current));
            if (t) countryDialog(t);
            else go('country/' + act.dataset.code);
            return;
          }
          case 'artist-country': {
            const key = act.dataset.key;
            const t = all().find((x) => artistKey(x) === key);
            countryDialog(t, key); return;
          }
          case 'play-key': playKey(act.dataset.key); return;
          case 'shuffle-key': playKey(act.dataset.key, { shuffle: true }); return;
          case 'toggle': Player.toggle(); return;
          case 'next': Player.next(); return;
          case 'prev': Player.prev(); return;
          case 'shuffle': Player.toggleShuffle(); return;
          case 'repeat': Player.cycleRepeat(); return;
          case 'mute': Player.audio.muted = !Player.audio.muted; return;
          case 'open-np': openNP(); return;
          case 'close-np': closeNP(); return;
          case 'np-tab': npTab($('#np').classList.contains('side-open') && act.classList.contains('on') ? null : act.dataset.tab); return;
          case 'sleep': { const r = act.getBoundingClientRect(); sleepMenu(r.left, r.top - 300); return; }
          case 'add-folder': addFolder(); return;
          case 'add-files': $('#file-input').click(); return;
          case 'rescan': (async () => { for (const d of S.dirs) { d._scanned = false; } const ok = await ensureDirAccess(true); if (!ok) toast('دسترسی به پوشه داده نشد'); })(); return;
          case 'redetect': for (const [k, v] of S.artists) if (!v.manual) S.artists.delete(k); detectCountries({ force: true }); toast('تشخیص دوباره شروع شد'); return;
          case 'clear-lib': confirmDialog('همه‌ی آهنگ‌ها، کاورها و کپی‌های آفلاین از اپ پاک می‌شن (فایل‌های اصلی روی دستگاهت دست نمی‌خورن).', async () => {
            await Promise.all(['tracks', 'covers', 'files'].map((s) => DB.clear(s)));
            S.tracks.clear(); S.files.clear(); S.dirs = []; DB.set('kv', 'dirs', []);
            Player.pause(); Player.queue = []; Player.current = null; updateNowPlaying(); render();
          }); return;
          case 'new-playlist': promptDialog('پلی‌لیست جدید', '', (name) => {
            if (!name) return;
            const p = { id: 'p' + Date.now().toString(36), name, ids: [], created: Date.now() };
            S.playlists.set(p.id, p); savePlaylists(); go('playlist/' + p.id);
          }); return;
          case 'rename-pl': { const p = S.playlists.get(act.dataset.id); promptDialog('تغییر نام', p.name, (n) => { if (n) { p.name = n; savePlaylists(); render(); } }); return; }
          case 'delete-pl': confirmDialog('این پلی‌لیست حذف بشه؟', () => { S.playlists.delete(act.dataset.id); savePlaylists(); go('playlists'); }); return;
          case 'export-pl': exportM3U(S.playlists.get(act.dataset.id)); return;
          case 'export': exportBackup(); return;
          case 'import': $('#import-input').click(); return;
          case 'clear-search': $('#search').value = ''; go('search'); return;
        }
      }
      const goEl = el.closest('[data-go]');
      if (goEl) { e.preventDefault(); if (goEl.closest('#np')) closeNP(); go(goEl.dataset.go); closeMenu(); return; }

      // کلیک روی ردیف آهنگ = پخش
      const row = el.closest('.row');
      if (row && !el.closest('a,button')) { playKey(`${row.dataset.list}@${row.dataset.i}`); return; }

      const qi = el.closest('[data-qrm]');
      if (qi) { Player.removeAt(+qi.dataset.qrm); return; }
      const q = el.closest('.qitem');
      if (q && !q.classList.contains('cur')) { Player.jump(+q.dataset.qi); return; }

      const ac = el.closest('[data-accent]');
      if (ac) { S.settings.accent = ac.dataset.accent; applyTheme(); saveSettings(); render(); return; }
      const th = el.closest('[data-theme]');
      if (th) { S.settings.theme = th.dataset.theme; applyTheme(); saveSettings(); render(); return; }
      const ep = el.closest('[data-eqp]');
      if (ep) {
        S.settings.eqPreset = ep.dataset.eqp; S.settings.eq = Player.EQ_PRESETS[ep.dataset.eqp].slice();
        Player.setEq(S.settings.eq); saveSettings();
        for (const c of $$('[data-eqp]')) c.classList.toggle('on', c.dataset.eqp === ep.dataset.eqp);
        for (const r of $$('[data-eq]')) r.value = S.settings.eq[+r.dataset.eq];
        return;
      }
      const rt = el.closest('[data-rate]');
      if (rt) { S.settings.rate = +rt.dataset.rate; Player.setRate(S.settings.rate); saveSettings(); $$('[data-rate]').forEach((b) => b.classList.toggle('on', b === rt)); return; }
      if (el.closest('.mini-info') && !el.closest('a,button')) openNP();
    });

    document.addEventListener('contextmenu', (e) => {
      const row = e.target.closest('.row');
      if (row) { e.preventDefault(); trackMenu(row.dataset.id, e.clientX, e.clientY); }
    });

    document.addEventListener('input', (e) => {
      const t = e.target;
      if (t.classList.contains('seek')) { t._drag = true; t.style.setProperty('--p', t.value / 10 + '%'); }
      if (t.classList.contains('vol')) { Player.audio.muted = false; Player.setVolume(t.value / 100); S.settings.volume = t.value / 100; saveSettings(); }
      if (t.dataset.eq !== undefined) {
        S.settings.eq[+t.dataset.eq] = +t.value; S.settings.eqPreset = '';
        Player.setEq(S.settings.eq); saveSettings();
        $$('[data-eqp]').forEach((c) => c.classList.remove('on'));
      }
      if (t.id === 'accent-pick') { S.settings.accent = t.value; applyTheme(); saveSettings(); }
    });
    document.addEventListener('change', (e) => {
      const t = e.target;
      if (t.classList.contains('seek')) { t._drag = false; Player.seek((t.value / 1000) * (Player.audio.duration || 0)); }
      if (t.dataset.set) {
        S.settings[t.dataset.set] = t.checked; saveSettings();
        if (t.dataset.set === 'online' && t.checked) detectCountries();
        if (t.dataset.set === 'dynamic') applyDynamicColor(S.tracks.get(Player.current));
      }
    });

    const search = $('#search');
    const doSearch = debounce(() => go('search/' + encodeURIComponent(search.value)), 250);
    search.addEventListener('input', doSearch);
    search.addEventListener('focus', () => { if (!currentRoute.startsWith('search')) go('search/' + encodeURIComponent(search.value)); });

    $('#dir-input').addEventListener('change', (e) => { const items = filesFromInput(e.target.files); e.target.value = ''; if (items.length) ingest(items); else toast('فایل صوتی پیدا نشد'); });
    $('#file-input').addEventListener('change', (e) => { const items = filesFromInput(e.target.files); e.target.value = ''; if (items.length) ingest(items); });
    $('#import-input').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importBackup(await f.text()); });

    // کشیدن و رها کردن فایل
    let dragDepth = 0;
    window.addEventListener('dragenter', (e) => { if (e.dataTransfer.types.includes('Files')) { dragDepth++; document.body.classList.add('dropping'); } });
    window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dropping'); } });
    window.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
    window.addEventListener('drop', async (e) => {
      if (!e.dataTransfer.types.includes('Files')) return;
      e.preventDefault(); dragDepth = 0; document.body.classList.remove('dropping');
      const items = await readDropped(e.dataTransfer);
      if (items.length) ingest(items); else toast('فایل صوتی پیدا نشد');
    });

    // جابجایی در صف با کشیدن
    let dragQ = null;
    document.addEventListener('dragstart', (e) => {
      const q = e.target.closest && e.target.closest('.qitem');
      if (q) { dragQ = +q.dataset.qi; e.dataTransfer.effectAllowed = 'move'; }
      const row = e.target.closest && e.target.closest('.row');
      if (row) { e.dataTransfer.setData('text/ava-track', row.dataset.id); }
    });
    document.addEventListener('dragover', (e) => { if (dragQ !== null && e.target.closest('.qitem')) e.preventDefault(); });
    document.addEventListener('drop', (e) => {
      const q = e.target.closest('.qitem');
      if (dragQ !== null && q) { e.preventDefault(); Player.move(dragQ, Math.max(Player.index + 1, +q.dataset.qi)); }
      dragQ = null;
    });

    // صفحه‌کلید
    document.addEventListener('keydown', (e) => {
      if (e.target.matches('input:not([type=range]),textarea,select')) { if (e.key === 'Escape') e.target.blur(); return; }
      const a = Player.audio;
      switch (e.key) {
        case ' ': e.preventDefault(); Player.toggle(); break;
        case 'ArrowRight': e.preventDefault(); e.shiftKey ? Player.next() : Player.seek(a.currentTime + 10); break;
        case 'ArrowLeft': e.preventDefault(); e.shiftKey ? Player.prev() : Player.seek(a.currentTime - 10); break;
        case 'ArrowUp': e.preventDefault(); Player.setVolume(a.volume + 0.05); break;
        case 'ArrowDown': e.preventDefault(); Player.setVolume(a.volume - 0.05); break;
        case 'l': case 'L': case 'م': if (Player.current) toggleLike(Player.current); break;
        case 's': case 'S': case 'س': Player.toggleShuffle(); toast(Player.shuffle ? 'پخش تصادفی روشن' : 'پخش تصادفی خاموش'); break;
        case 'r': case 'R': case 'ق': Player.cycleRepeat(); break;
        case 'm': case 'M': case 'پ': a.muted = !a.muted; break;
        case 'f': case 'F': case 'ب': $('#np').classList.contains('open') ? closeNP() : openNP(); break;
        case '/': e.preventDefault(); $('#search').focus(); break;
        case 'Escape': closeMenu(); closeDialog(); closeNP(); break;
      }
    });

    window.addEventListener('hashchange', route);
    window.addEventListener('online', () => detectCountries());

    // رویدادهای پخش‌کننده
    Player.addEventListener('track', () => {
      playCounted = false; lastTime = 0;
      updateNowPlaying(); markPlaying(); saveSession();
      const t = S.tracks.get(Player.current);
      if (t) { S.history.unshift(t.id); S.history = S.history.slice(0, 200); DB.set('kv', 'history', S.history); }
    });
    Player.addEventListener('play', () => { updatePlayState(); markPlaying(); });
    Player.addEventListener('pause', () => { updatePlayState(); markPlaying(); saveSession(); });
    Player.addEventListener('timeupdate', () => {
      updateProgress();
      const a = Player.audio;
      const dt = a.currentTime - lastTime;
      if (dt > 0 && dt < 2) S.listenSeconds += dt;
      lastTime = a.currentTime;
      const t = S.tracks.get(Player.current);
      if (t && !playCounted && (a.currentTime > 30 || (a.duration && a.currentTime > a.duration * 0.5))) {
        playCounted = true; t.plays = (t.plays || 0) + 1; t.lastPlayed = Date.now(); queueSave(t);
        DB.set('kv', 'listen', S.listenSeconds);
      }
      if (Math.random() < 0.02) saveSession();
    });
    Player.addEventListener('loadedmetadata', () => {
      updateProgress();
      const t = S.tracks.get(Player.current);
      if (t && !t.duration && Player.audio.duration) { t.duration = Player.audio.duration; queueSave(t); }
    });
    Player.addEventListener('volumechange', updateVolume);
    Player.addEventListener('mode', updateModes);
    Player.addEventListener('queue', () => { renderQueue(); saveSession(); });
    Player.addEventListener('sleep', updateSleep);
    Player.addEventListener('missing', () => {
      toast('به فایل این آهنگ دسترسی نیست', { label: S.dirs.length ? 'اجازه‌ی دسترسی' : 'انتخاب پوشه', run: () => S.dirs.length ? ensureDirAccess(true) : addFolder() });
    });
    Player.addEventListener('playerror', () => toast('مرورگر نمی‌تونه این فرمت رو پخش کنه؛ آهنگ بعدی…') || setTimeout(() => Player.next(true), 800));
    setInterval(updateSleep, 30000);
  }

  /* =========================================================
   * پشتیبان، خروجی، جلسه
   * ========================================================= */
  function download(name, text, type = 'application/json') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function exportM3U(p) {
    const lines = ['#EXTM3U', `#PLAYLIST:${p.name}`];
    for (const id of p.ids) { const t = S.tracks.get(id); if (t) lines.push(`#EXTINF:${Math.round(t.duration || -1)},${t.artist} - ${t.title}`, t.path); }
    download(`${p.name}.m3u`, lines.join('\n'), 'audio/x-mpegurl');
  }
  function exportBackup() {
    const tracks = {};
    for (const t of S.tracks.values()) {
      if (t.liked || t.plays || t.manualCountry) tracks[t.path] = { liked: t.liked, likedAt: t.likedAt, plays: t.plays, lastPlayed: t.lastPlayed, manualCountry: t.manualCountry };
    }
    const pl = Array.from(S.playlists.values()).map((p) => ({ ...p, paths: p.ids.map((id) => S.tracks.get(id) && S.tracks.get(id).path).filter(Boolean) }));
    const manual = Array.from(S.artists.entries()).filter(([, v]) => v.manual);
    download(`ava-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: 'ava', v: 1, tracks, playlists: pl, artists: manual, settings: S.settings, listen: S.listenSeconds }, null, 1));
  }
  function importBackup(text) {
    try {
      const d = JSON.parse(text);
      if (d.app !== 'ava') throw new Error();
      const byPath = new Map(all().map((t) => [t.path, t]));
      for (const [p, v] of Object.entries(d.tracks || {})) { const t = byPath.get(p); if (t) { Object.assign(t, v); resolveCountry(t); queueSave(t); } }
      for (const p of d.playlists || []) { p.ids = (p.paths || []).map((x) => byPath.get(x)).filter(Boolean).map((t) => t.id); delete p.paths; S.playlists.set(p.id, p); }
      for (const [k, v] of d.artists || []) S.artists.set(k, v);
      if (d.settings) Object.assign(S.settings, d.settings);
      S.listenSeconds = Math.max(S.listenSeconds, d.listen || 0);
      savePlaylists(); saveArtists(); saveSettings(); applyTheme(); recomputeAll(); render();
      toast('بازیابی انجام شد ✅');
    } catch (e) { toast('فایل پشتیبان معتبر نیست'); }
  }
  const saveSession = debounce(() => {
    DB.set('kv', 'session', { queue: Player.queue, index: Player.index, time: Player.audio.currentTime || 0, shuffle: Player.shuffle, repeat: Player.repeat });
  }, 500);

  /* =========================================================
   * تم
   * ========================================================= */
  function applyTheme() {
    const r = document.documentElement;
    r.style.setProperty('--accent', S.settings.accent);
    const theme = S.settings.theme === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : S.settings.theme;
    r.dataset.theme = theme;
    const m = $('meta[name="theme-color"]');
    if (m) m.content = theme === 'light' ? '#f5f3ff' : '#0b0b12';
  }

  /* =========================================================
   * راه‌اندازی
   * ========================================================= */
  async function init() {
    Player.resolveUrl = resolveUrl;
    const [tracks, settings, artists, playlists, history, dirs, session, listen] = await Promise.all([
      DB.all('tracks'), DB.get('kv', 'settings'), DB.get('kv', 'artists'), DB.get('kv', 'playlists'),
      DB.get('kv', 'history'), DB.get('kv', 'dirs'), DB.get('kv', 'session'), DB.get('kv', 'listen'),
    ]);
    for (const [id, t] of tracks) S.tracks.set(id, t);
    if (settings) Object.assign(S.settings, settings);
    for (const [k, v] of artists || []) S.artists.set(k, v);
    for (const p of playlists || []) S.playlists.set(p.id, p);
    S.history = history || [];
    S.dirs = dirs || [];
    S.listenSeconds = listen || 0;

    applyTheme();
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);
    Player.setVolume(S.settings.volume);
    Player.setRate(S.settings.rate || 1);
    Player.eqGains = S.settings.eq.slice();
    bindEvents();
    updateVolume(); updateModes();

    if (session && session.queue && session.queue.length) {
      Player.queue = session.queue.filter((id) => S.tracks.has(id));
      Player.shuffle = !!session.shuffle; Player.repeat = session.repeat || 'off';
      const idx = Math.max(0, Math.min(Player.queue.length - 1, session.index));
      if (Player.queue.length) {
        Player.index = idx; Player.current = Player.queue[idx];
        updateNowPlaying(); updateModes();
        resolveUrl(Player.current).then((url) => {
          if (url && !Player.audio.src) {
            Player.audio.src = url;
            Player.audio.addEventListener('loadedmetadata', () => { Player.seek(session.time || 0); }, { once: true });
          }
        });
      }
    } else updateNowPlaying();

    render();

    // دسترسی به پوشه‌های ذخیره‌شده
    if (S.dirs.length) {
      const ok = await ensureDirAccess(false);
      if (!ok) {
        const b = $('#access-banner');
        b.hidden = false;
        b.onclick = async () => { if (await ensureDirAccess(true)) b.hidden = true; };
      }
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    computeDurations();
    detectCountries();
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  document.addEventListener('DOMContentLoaded', init);
})();
