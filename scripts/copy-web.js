// Copies the web app into www/ so Capacitor can bundle it into the Android app.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'www');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const item of ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'vendor', 'icons']) {
  fs.cpSync(path.join(root, item), path.join(out, item), { recursive: true });
}
console.log('Web assets copied to www/');
