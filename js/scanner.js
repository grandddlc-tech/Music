/* Reading music files, tags and cover art */
(function () {
  const AUDIO_EXT = /\.(mp3|m4a|aac|flac|ogg|oga|opus|wav|webm|mp4|alac|aiff?|wma)$/i;
  const S = {};
  window.Scanner = S;
  S.isAudio = (name) => AUDIO_EXT.test(name);

  /* Stable id for each file */
  S.fileId = (path, size) => {
    let h = 2166136261;
    const s = `${path}|${size}`;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return 't' + (h >>> 0).toString(36) + size.toString(36);
  };

  /* Walk a folder with the File System Access API */
  S.walkHandle = async function* (dir, prefix = '') {
    for await (const entry of dir.values()) {
      if (entry.kind === 'file' && S.isAudio(entry.name)) {
        yield { file: await entry.getFile(), path: prefix + entry.name };
      } else if (entry.kind === 'directory' && !entry.name.startsWith('.')) {
        yield* S.walkHandle(entry, prefix + entry.name + '/');
      }
    }
  };

  /* Fast walk: yields file handles + paths without opening the files */
  S.walkEntries = async function* (dir, prefix = '') {
    for await (const entry of dir.values()) {
      if (entry.kind === 'file' && S.isAudio(entry.name)) {
        yield { handle: entry, path: prefix + entry.name };
      } else if (entry.kind === 'directory' && !entry.name.startsWith('.')) {
        yield* S.walkEntries(entry, prefix + entry.name + '/');
      }
    }
  };

  function readTags(file) {
    return new Promise((resolve) => {
      if (!window.jsmediatags) return resolve({});
      try {
        window.jsmediatags.read(file, {
          onSuccess: (r) => resolve(r.tags || {}),
          onError: () => resolve({}),
        });
      } catch (e) { resolve({}); }
    });
  }

  function cleanStr(v) {
    if (v == null) return '';
    if (typeof v === 'object') v = v.data || v.text || '';
    return String(v).replace(/\u0000/g, '').trim();
  }

  /* No tags? Guess from the file name: "Artist - Title" */
  function fromFilename(path) {
    const base = path.split('/').pop().replace(/\.[^.]+$/, '')
      .replace(/[_]+/g, ' ')
      .replace(/\s*[\[(]?(320|128|256)\s*k?(bps)?[\])]?/ig, '')
      .replace(/\s*\((official|lyric|audio|video|music video|hq|hd)[^)]*\)/ig, '')
      .replace(/^\d{1,3}[\s.\-_]+/, '')
      .trim();
    const m = base.split(/\s+[-–—]\s+|\s*-\s*/);
    if (m.length >= 2) return { artist: m[0].trim(), title: m.slice(1).join(' - ').trim() };
    return { artist: '', title: base };
  }

  async function shrinkCover(picture) {
    try {
      const bytes = new Uint8Array(picture.data);
      const blob = new Blob([bytes], { type: picture.format || 'image/jpeg' });
      const bmp = await createImageBitmap(blob);
      const size = 400;
      const scale = Math.min(1, size / Math.max(bmp.width, bmp.height));
      const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.drawImage(bmp, 0, 0, w, h);
      // average colour for the dynamic theme
      const px = ctx.getImageData(0, 0, w, h).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < px.length; i += 4 * 37) {
        const R = px[i], G = px[i + 1], B = px[i + 2];
        const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
        const sat = mx - mn;
        const wgt = 1 + sat / 32; // saturated colours weigh more
        r += R * wgt; g += G * wgt; b += B * wgt; n += wgt;
      }
      const color = n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : null;
      const out = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.85));
      bmp.close && bmp.close();
      return { blob: out || blob, color };
    } catch (e) {
      return null;
    }
  }

  /* Extract all metadata from a file */
  S.parse = async (file, path) => {
    const tags = await readTags(file);
    const fn = fromFilename(path);
    const track = {
      title: cleanStr(tags.title) || fn.title,
      artist: cleanStr(tags.artist) || fn.artist || 'Unknown Artist',
      album: cleanStr(tags.album) || '',
      albumArtist: cleanStr(tags.TPE2 && tags.TPE2.data) || '',
      genre: cleanStr(tags.genre).replace(/^\((\d+)\)/, ''),
      year: parseInt(cleanStr(tags.year), 10) || null,
      trackNo: parseInt(cleanStr(tags.track), 10) || null,
      lyrics: '',
      path,
      size: file.size,
      mtime: file.lastModified || Date.now(),
      type: file.type || '',
    };
    const lyr = tags.lyrics || (tags.USLT && tags.USLT.data);
    if (lyr) track.lyrics = cleanStr(typeof lyr === 'object' ? (lyr.lyrics || lyr.text) : lyr);
    let cover = null;
    if (tags.picture && tags.picture.data) cover = await shrinkCover(tags.picture);
    return { track, cover };
  };

  /* Track duration */
  S.duration = (file) => new Promise((resolve) => {
    const a = document.createElement('audio');
    const url = URL.createObjectURL(file);
    const done = (d) => { URL.revokeObjectURL(url); a.src = ''; resolve(d); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => done(0);
    setTimeout(() => done(0), 8000);
    a.src = url;
  });
})();
