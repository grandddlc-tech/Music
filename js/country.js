/* Country detection engine
 * Order: 1) manual choice 2) built-in artist database 3) MusicBrainz (online) 4) script/language/genre heuristics
 */
(function () {
  const C = {};
  window.Country = C;

  /* ---------- Names & flags ---------- */
  let enNames;
  try { enNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (e) {}

  const SPECIAL = {
    XA: { en: 'Arab World', emoji: '🌙' },
    XK: { en: 'Kosovo', emoji: '🇽🇰' },
    ZZ: { en: 'Unknown', emoji: '🌐' },
  };

  C.name = (code) => {
    if (!code) return SPECIAL.ZZ.en;
    if (SPECIAL[code]) return SPECIAL[code].en;
    try { return (enNames && enNames.of(code)) || code; } catch (e) { return code; }
  };
  C.enName = (code) => {
    if (SPECIAL[code]) return SPECIAL[code].en;
    try { return (enNames && enNames.of(code)) || code; } catch (e) { return code; }
  };
  C.emoji = (code) => {
    if (!code || SPECIAL[code]) return (SPECIAL[code] || SPECIAL.ZZ).emoji;
    return String.fromCodePoint(...code.toUpperCase().split('').map((c) => 127397 + c.charCodeAt(0)));
  };
  C.flagUrl = (code) => (code && /^[A-Z]{2}$/.test(code) && !['XA', 'ZZ'].includes(code))
    ? `https://flagcdn.com/w160/${code.toLowerCase()}.png` : null;

  /* English country name → code (for MusicBrainz answers) */
  const EN2CODE = {};
  (function buildEn() {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (!enNames) return;
    for (const a of A) for (const b of A) {
      const code = a + b;
      try { const n = enNames.of(code); if (n && n !== code) EN2CODE[n.toLowerCase()] = code; } catch (e) {}
    }
    Object.assign(EN2CODE, {
      'united states': 'US', usa: 'US', 'united kingdom': 'GB', england: 'GB', scotland: 'GB', wales: 'GB',
      'northern ireland': 'GB', 'south korea': 'KR', 'korea, republic of': 'KR', russia: 'RU',
      'russian federation': 'RU', iran: 'IR', 'iran, islamic republic of': 'IR', persia: 'IR', tehran: 'IR',
      'czech republic': 'CZ', 'soviet union': 'RU', ussr: 'RU', yugoslavia: 'RS', 'puerto rico': 'PR',
      'hong kong': 'HK', taiwan: 'TW', 'türkiye': 'TR', turkey: 'TR', 'ivory coast': 'CI',
      "côte d'ivoire": 'CI', 'dr congo': 'CD', 'democratic republic of the congo': 'CD',
      'los angeles': 'US', 'new york': 'US', london: 'GB', paris: 'FR', seoul: 'KR', tokyo: 'JP',
      istanbul: 'TR', cairo: 'EG', beirut: 'LB', kabul: 'AF', dushanbe: 'TJ', baku: 'AZ',
    });
  })();
  C.codeFromName = (n) => n ? (EN2CODE[String(n).toLowerCase().trim()] || null) : null;

  /* ---------- Built-in database ---------- */
  const KNOWN = new Map();

  /* ---------- Artist name normalisation ---------- */
  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFKC')
      .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[ۀة]/g, 'ه').replace(/[أإآ]/g, (m) => m === 'آ' ? 'آ' : 'ا')
      .replace(/‌/g, ' ')
      .replace(/[ً-ٰٟ]/g, '')
      .replace(/[“”"'`’]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }
  C.norm = norm;
  for (const [code, list] of Object.entries(window.KNOWN_ARTISTS || {})) {
    for (const name of list.split('|')) if (name) KNOWN.set(norm(name), code);
  }

  /* Split the main artist from feat. etc. */
  C.splitArtists = (artist) => {
    const s = String(artist || '').replace(/\(.*?(feat|ft|with)\.?.*?\)/ig, '');
    return s.split(/\s*(?:,|;|\/|&|\+| x | X |\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b| و | ft |،|Feat\.?|Ft\.?)\s*/)
      .map((x) => x.trim()).filter(Boolean);
  };
  C.primaryArtist = (artist) => C.splitArtists(artist)[0] || String(artist || '').trim();

  C.lookupKnown = (artist) => {
    if (!artist) return null;
    const full = norm(artist);
    if (KNOWN.has(full)) return KNOWN.get(full);
    for (const a of C.splitArtists(artist)) {
      const n = norm(a);
      if (KNOWN.has(n)) return KNOWN.get(n);
      const noThe = n.replace(/^the /, '');
      if (KNOWN.has(noThe)) return KNOWN.get(noThe);
      const noBand = n.replace(/ (band|music|official|vevo)$/, '');
      if (KNOWN.has(noBand)) return KNOWN.get(noBand);
    }
    return null;
  };

  /* ---------- Text analysis (script & language) ---------- */
  const FINGLISH = /\b(eshgh|eshq|asheghi|asheghet|delam|deltangi|dooset daram|doostet daram|ghalbam|ghalb|negaham|bargard|divoone|divouneh|divune|khoda|khodaya|joonam|jooni|azizam|nafas|mano|toro|beraghs|shabe|baroon|baran|parvaz|tanhaei|tanhayi|ghalbe|nazanin|sarnevesht|bahooneh|bahaneh|cheshmat|cheshmaye|hamishe|hamisheh|delbar|mahi|gerye|khiyabon|khiaban|mikham|nemikham|nemiram|bia|boro|mast|ey vay|yadet|yade|saghi|saaghi|khatere|khaterat|sedam kon|bezan|raghs)\b/i;
  const TURKISH_WORDS = /\b(aşk|ask|sevgilim|seni|benim|gönül|yalan|gel|bana|kalbim|unutma|sevdim|olsun|değil|yok|bir|şarkı|sarki|aman|canım|canim|yar|hasret|beni)\b/i;
  const ARABIC_DIALECT = /\b(habibi|habibti|ya leil|yalla|inta|enta|albi|qalbi|hayati|ya rab|wallah|ahebak|bahebak|ana|leh)\b/i;
  const SPANISH = /\b(amor|corazón|corazon|te quiero|bailar|contigo|mujer|vida|noche|besame|bésame|quiero|tú|mi amor|perreo|reggaeton|baila)\b/i;
  const PORT = /\b(saudade|coração|voce|você|não|nao|amanhã|beijo|meu amor|obrigado|funk|samba|forró|pagode|sertanejo)\b/i;
  const FRENCH = /\b(je|tu|mon|ma|amour|toujours|chanson|c'est|j'ai|pas|pour|avec|coeur|cœur|belle|vie)\b/i;
  const ITALIAN = /\b(amore|cuore|ti amo|sempre|bella|vita|canzone|notte|perché|perche|io|sei|sono)\b/i;
  const GERMAN = /\b(ich|liebe|nicht|und|mein|dein|herz|nacht|immer|schön|schon|für|fur|wir|sie)\b/i;

  const GENRE_HINTS = [
    [/persian|iranian|irani|farsi|پاپ ایرانی|ایرانی|فارسی|سنتی|mazandarani|lori|gilaki|bandari|بندری/i, 'IR'],
    [/k-?pop|korean|케이팝/i, 'KR'], [/j-?pop|j-?rock|anime|japanese|enka/i, 'JP'],
    [/c-?pop|mandopop|chinese/i, 'CN'], [/cantopop/i, 'HK'], [/turkish|türk|arabesk|anatolian/i, 'TR'],
    [/afghan|افغانی/i, 'AF'], [/tajik|تاجیک/i, 'TJ'], [/bollywood|hindi|punjabi|bhangra|desi|filmi/i, 'IN'],
    [/qawwali/i, 'PK'], [/khaleeji|خليجي/i, 'SA'], [/arabic|arab|عربی|عربي|tarab|mahraganat|rai\b/i, 'XA'],
    [/reggae|dancehall|ska\b/i, 'JM'], [/afrobeat|afrobeats|naija/i, 'NG'], [/amapiano|gqom|kwaito/i, 'ZA'],
    [/bongo flava/i, 'TZ'], [/sertanejo|forró|forro|pagode|mpb|bossa|samba|funk carioca|baile funk/i, 'BR'],
    [/corridos|banda|norteño|norteno|ranchera|mariachi|regional mexican/i, 'MX'],
    [/reggaeton|reguetón|latin trap/i, 'PR'], [/vallenato|cumbia colombiana/i, 'CO'], [/tango/i, 'AR'],
    [/flamenco/i, 'ES'], [/fado/i, 'PT'], [/chanson|variété française|french/i, 'FR'],
    [/schlager|deutsch/i, 'DE'], [/italo|italian/i, 'IT'], [/russian|русск|шансон/i, 'RU'],
    [/ukrain/i, 'UA'], [/greek|laiko|έντεχνο|λαϊκό/i, 'GR'], [/kurdish|کردی|kurdî/i, 'IR'],
    [/azeri|azerbaijan/i, 'AZ'], [/armenian/i, 'AM'], [/turbo ?folk/i, 'RS'], [/manele/i, 'RO'],
    [/chalga|чалга/i, 'BG'], [/opm\b|pinoy/i, 'PH'], [/v-?pop/i, 'VN'], [/t-?pop|luk thung/i, 'TH'],
    [/dangdut/i, 'ID'], [/k-?indie|trot/i, 'KR'], [/uk drill|grime/i, 'GB'], [/country/i, 'US'],
  ];

  function fromScript(text) {
    if (!text) return null;
    const t = String(text);
    if (/[가-힯ᄀ-ᇿ]/.test(t)) return { code: 'KR', why: 'Korean script' };
    if (/[぀-ヿ]/.test(t)) return { code: 'JP', why: 'Japanese script' };
    if (/[฀-๿]/.test(t)) return { code: 'TH', why: 'Thai script' };
    if (/[֐-׿]/.test(t)) return { code: 'IL', why: 'Hebrew script' };
    if (/[Ͱ-Ͽ]/.test(t)) return { code: 'GR', why: 'Greek script' };
    if (/[԰-֏]/.test(t)) return { code: 'AM', why: 'Armenian script' };
    if (/[Ⴀ-ჿ]/.test(t)) return { code: 'GE', why: 'Georgian script' };
    if (/[ሀ-፿]/.test(t)) return { code: 'ET', why: 'Amharic script' };
    if (/[ऀ-ॿ਀-੿஀-௿ఀ-౿ঀ-৿]/.test(t)) return { code: 'IN', why: 'Indic script' };
    if (/[一-鿿]/.test(t)) return { code: 'CN', why: 'Chinese characters' };
    if (/[؀-ۿ]/.test(t)) {
      if (/[ٹڈڑںےۓھ]/.test(t)) return { code: 'PK', why: 'Urdu letters' };
      if (/[پچژگ]/.test(t) || /[ی]/.test(t) || /[ک]/.test(t)) return { code: 'IR', why: 'Persian letters' };
      return { code: 'XA', why: 'Arabic script' };
    }
    if (/[Ѐ-ӿ]/.test(t)) {
      if (/[іїєґІЇЄҐ]/.test(t)) return { code: 'UA', why: 'Ukrainian letters' };
      if (/[ўЎ]/.test(t)) return { code: 'BY', why: 'Belarusian letters' };
      if (/[әғқңөұүһі]/i.test(t)) return { code: 'KZ', why: 'Kazakh letters' };
      if (/[ђјљњћџ]/i.test(t)) return { code: 'RS', why: 'Serbian letters' };
      return { code: 'RU', why: 'Cyrillic script' };
    }
    if (/[ğışİĞŞ]/.test(t)) return { code: 'TR', why: 'Turkish letters' };
    if (/[ạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹđ]/i.test(t)) return { code: 'VN', why: 'Vietnamese letters' };
    if (/[ąęłńśźż]/i.test(t)) return { code: 'PL', why: 'Polish letters' };
    if (/[řěůť]/i.test(t)) return { code: 'CZ', why: 'Czech letters' };
    if (/[őű]/i.test(t)) return { code: 'HU', why: 'Hungarian letters' };
    if (/[ăâîșşțţ]/i.test(t) && /[șşțţă]/i.test(t)) return { code: 'RO', why: 'Romanian letters' };
    if (/[ãõ]/i.test(t)) return { code: 'BR', why: 'Portuguese letters' };
    if (/[ñ¿¡]/i.test(t)) return { code: 'ES', why: 'Spanish letters' };
    if (/[ß]/.test(t)) return { code: 'DE', why: 'German letters' };
    if (/[åæø]/i.test(t)) return { code: 'NO', why: 'Scandinavian letters' };
    return null;
  }

  /** Guess a country from the song text (title, artist, album, genre, folder path) */
  C.guessFromText = (track) => {
    const artistTxt = `${track.artist || ''}`;
    const all = `${track.title || ''} ${track.artist || ''} ${track.album || ''}`;
    const folder = track.path || '';
    const genre = track.genre || '';
    // 1. genre
    for (const [re, code] of GENRE_HINTS) {
      if (re.test(genre)) return { code, source: 'genre', confidence: 0.65, why: `Genre "${genre}"` };
    }
    // 2. writing script of the artist name (stronger than the title)
    let s = fromScript(artistTxt);
    if (s) return { code: s.code, source: 'script', confidence: 0.7, why: s.why + ' in artist name' };
    s = fromScript(all);
    if (s) return { code: s.code, source: 'script', confidence: 0.6, why: s.why + ' in title' };
    for (const [re, code] of GENRE_HINTS) {
      if (re.test(folder)) return { code, source: 'folder', confidence: 0.55, why: 'Folder name' };
    }
    // 3. common words of languages written in Latin letters
    if (FINGLISH.test(all)) return { code: 'IR', source: 'words', confidence: 0.45, why: 'Finglish (Persian) words' };
    if (TURKISH_WORDS.test(all)) return { code: 'TR', source: 'words', confidence: 0.35, why: 'Turkish words' };
    if (ARABIC_DIALECT.test(all)) return { code: 'XA', source: 'words', confidence: 0.35, why: 'Arabic words' };
    if (PORT.test(all)) return { code: 'BR', source: 'words', confidence: 0.3, why: 'Portuguese words' };
    if (SPANISH.test(all)) return { code: 'ES', source: 'words', confidence: 0.3, why: 'Spanish words' };
    if (ITALIAN.test(all)) return { code: 'IT', source: 'words', confidence: 0.25, why: 'Italian words' };
    if (FRENCH.test(all)) return { code: 'FR', source: 'words', confidence: 0.25, why: 'French words' };
    if (GERMAN.test(all)) return { code: 'DE', source: 'words', confidence: 0.25, why: 'German words' };
    return null;
  };

  /* ---------- MusicBrainz ---------- */
  const queue = [];
  let running = false;
  let lastCall = 0;

  async function mbFetch(artist) {
    const wait = Math.max(0, lastCall + 1150 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    const q = encodeURIComponent(`artist:"${artist.replace(/"/g, '')}"`);
    const res = await fetch(`https://musicbrainz.org/ws/2/artist/?query=${q}&fmt=json&limit=3`, {
      headers: { Accept: 'application/json' },
    });
    if (res.status === 503) { await new Promise((r) => setTimeout(r, 3000)); return mbFetch(artist); }
    if (!res.ok) throw new Error('MB ' + res.status);
    const data = await res.json();
    const n = norm(artist);
    for (const a of data.artists || []) {
      const score = a.score || 0;
      const nameMatch = norm(a.name) === n || norm(a['sort-name'] || '') === n ||
        (a.aliases || []).some((al) => norm(al.name) === n);
      if (score < 85 && !nameMatch) continue;
      let code = a.country || null;
      if (!code && a.area) code = (a.area['iso-3166-1-codes'] || [])[0] || C.codeFromName(a.area.name);
      if (!code && a['begin-area']) code = C.codeFromName(a['begin-area'].name);
      if (code && code !== 'XW' && code !== 'XE') {
        return { code, source: 'musicbrainz', confidence: nameMatch ? 0.9 : 0.75,
          why: `MusicBrainz: ${a.name}${a.disambiguation ? ' (' + a.disambiguation + ')' : ''}` };
      }
    }
    return null;
  }

  /** Queued MusicBrainz lookup (max ~1 request/sec, per the service's rules) */
  C.lookupOnline = (artist) => new Promise((resolve) => {
    queue.push({ artist, resolve });
    pump();
  });
  C.pendingOnline = () => queue.length;

  async function pump() {
    if (running) return;
    running = true;
    while (queue.length) {
      const { artist, resolve } = queue.shift();
      try { resolve(await mbFetch(artist)); } catch (e) { resolve({ error: true }); }
    }
    running = false;
  }
})();
