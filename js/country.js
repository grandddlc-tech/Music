/* موتور تشخیص کشور آهنگ‌ها
 * ترتیب: ۱) انتخاب دستی کاربر ۲) پایگاه داده‌ی داخلی ۳) MusicBrainz (آنلاین) ۴) تحلیل خط/زبان متن
 */
(function () {
  const C = {};
  window.Country = C;

  /* ---------- نام و پرچم ---------- */
  let faNames, enNames;
  try { faNames = new Intl.DisplayNames(['fa'], { type: 'region' }); } catch (e) {}
  try { enNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (e) {}

  const SPECIAL = {
    XA: { fa: 'جهان عرب', en: 'Arab World', emoji: '🌙' },
    XK: { fa: 'کوزوو', en: 'Kosovo', emoji: '🇽🇰' },
    ZZ: { fa: 'نامشخص', en: 'Unknown', emoji: '🌐' },
  };

  C.name = (code) => {
    if (!code) return SPECIAL.ZZ.fa;
    if (SPECIAL[code]) return SPECIAL[code].fa;
    try { return (faNames && faNames.of(code)) || code; } catch (e) { return code; }
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

  /* نام انگلیسی کشور → کد (برای جواب‌های MusicBrainz) */
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

  /* ---------- پایگاه داده‌ی داخلی ---------- */
  const KNOWN = new Map();

  /* ---------- نرمال‌سازی نام خواننده ---------- */
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

  /* جدا کردن خواننده‌ی اصلی از feat و ... */
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

  /* ---------- تحلیل متن (خط و زبان) ---------- */
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
    if (/[가-힯ᄀ-ᇿ]/.test(t)) return { code: 'KR', why: 'خط کره‌ای' };
    if (/[぀-ヿ]/.test(t)) return { code: 'JP', why: 'خط ژاپنی' };
    if (/[฀-๿]/.test(t)) return { code: 'TH', why: 'خط تایلندی' };
    if (/[֐-׿]/.test(t)) return { code: 'IL', why: 'خط عبری' };
    if (/[Ͱ-Ͽ]/.test(t)) return { code: 'GR', why: 'خط یونانی' };
    if (/[԰-֏]/.test(t)) return { code: 'AM', why: 'خط ارمنی' };
    if (/[Ⴀ-ჿ]/.test(t)) return { code: 'GE', why: 'خط گرجی' };
    if (/[ሀ-፿]/.test(t)) return { code: 'ET', why: 'خط امهری' };
    if (/[ऀ-ॿ਀-੿஀-௿ఀ-౿ঀ-৿]/.test(t)) return { code: 'IN', why: 'خط هندی' };
    if (/[一-鿿]/.test(t)) return { code: 'CN', why: 'خط چینی' };
    if (/[؀-ۿ]/.test(t)) {
      if (/[ٹڈڑںےۓھ]/.test(t)) return { code: 'PK', why: 'خط اردو' };
      if (/[پچژگ]/.test(t) || /[ی]/.test(t) || /[ک]/.test(t)) return { code: 'IR', why: 'حروف فارسی' };
      return { code: 'XA', why: 'خط عربی' };
    }
    if (/[Ѐ-ӿ]/.test(t)) {
      if (/[іїєґІЇЄҐ]/.test(t)) return { code: 'UA', why: 'خط اوکراینی' };
      if (/[ўЎ]/.test(t)) return { code: 'BY', why: 'خط بلاروسی' };
      if (/[әғқңөұүһі]/i.test(t)) return { code: 'KZ', why: 'خط قزاقی' };
      if (/[ђјљњћџ]/i.test(t)) return { code: 'RS', why: 'خط صربی' };
      return { code: 'RU', why: 'خط سیریلیک' };
    }
    if (/[ğışİĞŞ]/.test(t)) return { code: 'TR', why: 'حروف ترکی' };
    if (/[ạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹđ]/i.test(t)) return { code: 'VN', why: 'حروف ویتنامی' };
    if (/[ąęłńśźż]/i.test(t)) return { code: 'PL', why: 'حروف لهستانی' };
    if (/[řěůť]/i.test(t)) return { code: 'CZ', why: 'حروف چکی' };
    if (/[őű]/i.test(t)) return { code: 'HU', why: 'حروف مجاری' };
    if (/[ăâîșşțţ]/i.test(t) && /[șşțţă]/i.test(t)) return { code: 'RO', why: 'حروف رومانیایی' };
    if (/[ãõ]/i.test(t)) return { code: 'BR', why: 'حروف پرتغالی' };
    if (/[ñ¿¡]/i.test(t)) return { code: 'ES', why: 'حروف اسپانیایی' };
    if (/[ß]/.test(t)) return { code: 'DE', why: 'حروف آلمانی' };
    if (/[åæø]/i.test(t)) return { code: 'NO', why: 'حروف اسکاندیناوی' };
    return null;
  }

  /** حدس کشور از متن آهنگ (عنوان، خواننده، آلبوم، ژانر، مسیر پوشه) */
  C.guessFromText = (track) => {
    const artistTxt = `${track.artist || ''}`;
    const all = `${track.title || ''} ${track.artist || ''} ${track.album || ''}`;
    const folder = track.path || '';
    const genre = track.genre || '';
    // ۱. ژانر و نام پوشه
    for (const [re, code] of GENRE_HINTS) {
      if (re.test(genre)) return { code, source: 'genre', confidence: 0.65, why: `ژانر «${genre}»` };
    }
    // ۲. خط نوشتاری نام خواننده (قوی‌تر از عنوان)
    let s = fromScript(artistTxt);
    if (s) return { code: s.code, source: 'script', confidence: 0.7, why: s.why + ' در نام خواننده' };
    s = fromScript(all);
    if (s) return { code: s.code, source: 'script', confidence: 0.6, why: s.why + ' در عنوان' };
    for (const [re, code] of GENRE_HINTS) {
      if (re.test(folder)) return { code, source: 'folder', confidence: 0.55, why: 'نام پوشه' };
    }
    // ۳. کلمات رایج زبان‌ها با حروف لاتین
    if (FINGLISH.test(all)) return { code: 'IR', source: 'words', confidence: 0.45, why: 'کلمات فینگلیش' };
    if (TURKISH_WORDS.test(all)) return { code: 'TR', source: 'words', confidence: 0.35, why: 'کلمات ترکی' };
    if (ARABIC_DIALECT.test(all)) return { code: 'XA', source: 'words', confidence: 0.35, why: 'کلمات عربی' };
    if (PORT.test(all)) return { code: 'BR', source: 'words', confidence: 0.3, why: 'کلمات پرتغالی' };
    if (SPANISH.test(all)) return { code: 'ES', source: 'words', confidence: 0.3, why: 'کلمات اسپانیایی' };
    if (ITALIAN.test(all)) return { code: 'IT', source: 'words', confidence: 0.25, why: 'کلمات ایتالیایی' };
    if (FRENCH.test(all)) return { code: 'FR', source: 'words', confidence: 0.25, why: 'کلمات فرانسوی' };
    if (GERMAN.test(all)) return { code: 'DE', source: 'words', confidence: 0.25, why: 'کلمات آلمانی' };
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

  /** درخواست به صف MusicBrainz اضافه می‌شود (هر ۱.۱ ثانیه یک درخواست، طبق قوانین سرویس) */
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
