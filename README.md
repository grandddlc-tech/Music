# 🎧 Music

A beautiful personal music player that reads your whole music library and **works out which country every song is from — automatically**.
Everything runs on your own device; your songs are never uploaded.

## Running it

It's a static web app — no install or build step:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Or publish it with **GitHub Pages** (Settings → Pages → Branch) so it opens on your phone too, where you can **install** it like a native app (PWA).

Once it's open, click **Choose music folder**, or drag a folder onto the page.

## How country detection works

Each song is checked in this order:

1. **Your choice** — if you changed the country by hand (for one song, or for every song by an artist).
2. **Built-in database** — about 4,600 artist names (Latin and native scripts) from 100+ countries, from Googoosh and Ebi to BTS, Tarkan and Shakira.
3. **MusicBrainz** — artists not in the database are looked up in the free MusicBrainz music encyclopedia (only the artist name is sent; can be turned off).
4. **Text analysis** — the writing script (Persian, Arabic, Urdu, Korean, Japanese, Cyrillic, Greek, …), language-specific letters (Turkish, Vietnamese, Polish, …), genre tags (K-Pop, Bandari, Reggaeton, …), folder names and common words.

The reason behind each detection is shown in **Song info**, and you can correct any song by clicking its flag.

## Features

- 🏠 **Home** — recently added, countries, per-country mixes, recently played, top songs and artists
- ✨ **Recently Added** — grouped into today / this week / this month / older, plus new albums
- 🌍 **Countries** — distribution bar, a flag card per country, and a page for each country with its artists, albums and songs
- 📚 **Library** — songs (sortable), artists, albums, genres, folders
- 🎵 **Playlists** — Liked Songs, smart playlists (Most Played, Recently Played, Rediscover, New This Month) and your own playlists, with M3U export
- 🔎 **Search** across titles, artists, albums, genres and country names
- ▶️ **Player** — reorderable queue, play next, shuffle, repeat (all/one), resume where you left off
- 🖼️ **Now Playing** screen with colours taken from the cover art, a visualizer and embedded lyrics
- 🎚️ **10-band equalizer** with presets and **playback speed**
- 🌙 **Sleep timer** (gentle fade-out, or stop at the end of the song)
- 📊 **Stats** — songs and plays by country, top artists, decades, genres, time listened
- 🎨 Dark / light / auto theme, custom accent colour, fully responsive for phones
- 🔒 Lock-screen & headphone controls (Media Session), keyboard shortcuts, drag & drop
- 💾 Works offline (PWA), optional offline copies inside the app (great on iPhone), backup & restore

## Formats

MP3, M4A/AAC, FLAC, OGG/Opus, WAV and anything else your browser can play. Tags (title, artist, album, genre, year, cover art, lyrics) are read with [jsmediatags](https://github.com/aadsm/jsmediatags); files without tags fall back to the file name (`Artist - Title`).

## Browsers

- **Chrome / Edge (desktop & Android):** best experience — you pick the folder once and it's remembered.
- **Safari / iPhone / Firefox:** pick your songs; "Keep offline copies in the app" is on by default so you don't have to pick them again next time.

## Project layout

```
index.html            UI shell
css/style.css         styles
js/app.js             app logic and views
js/country.js         country detection engine
js/artists.js         artist → country database
js/scanner.js         file, tag and cover-art reading
js/player.js          playback, queue, equalizer, sleep timer
js/db.js              IndexedDB storage
sw.js                 offline support
```
