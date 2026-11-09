const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { fail } = require('../lib/errors');

const DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads');
fs.mkdirSync(DIR, { recursive: true });

const TYPES = {
  jpeg: { ext: 'jpg', magic: [0xff, 0xd8, 0xff] },
  png: { ext: 'png', magic: [0x89, 0x50, 0x4e, 0x47] },
  webp: { ext: 'webp', magic: [0x52, 0x49, 0x46, 0x46] },
};
const MAX_BYTES = 3 * 1024 * 1024;

// Приймає data URL (клієнт зменшує фото перед відправкою), перевіряє справжній підпис файлу, зберігає на диск.
function saveImages(dataUrls) {
  return dataUrls.map((url, i) => {
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(url);
    if (!m) fail('validation', 'Unsupported image', { errors: [{ field: `images[${i}]`, rule: 'type' }] });
    const buf = Buffer.from(m[2], 'base64');
    const t = TYPES[m[1]];
    if (buf.length > MAX_BYTES || !t.magic.every((b, j) => buf[j] === b)) {
      fail('validation', 'Image is too large or corrupted', { errors: [{ field: `images[${i}]`, rule: 'file' }] });
    }
    const name = `${crypto.randomUUID()}.${t.ext}`;
    fs.writeFileSync(path.join(DIR, name), buf);
    return `/uploads/${name}`;
  });
}

module.exports = { saveImages, DIR };
