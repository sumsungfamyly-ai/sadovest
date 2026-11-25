import { r } from '../lib/db.js';

// Фото новостей: GET /api/newsimg?id=...&v=... (v — версия для кэша). Хранятся в Redis как base64 JPEG.
export default async function handler(req, res) {
  try {
    const id = String(req.query?.id || '');
    if (!/^\d{1,16}$/.test(id)) return res.status(400).end();
    const b64 = await r('GET', 'news:img:' + id);
    if (!b64) return res.status(404).end();
    res.setHeader('content-type', 'image/jpeg');
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    res.status(200).send(Buffer.from(b64, 'base64'));
  } catch (e) { console.error(e); res.status(500).end(); }
}
