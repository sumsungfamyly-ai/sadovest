import { r } from '../lib/db.js';
// Диагностика: https://ВАШ-САЙТ.vercel.app/api/health?key=WEBHOOK_SECRET
export default async function handler(req, res) {
  if (!process.env.WEBHOOK_SECRET || req.query.key !== process.env.WEBHOOK_SECRET) return res.status(401).send('Неверный ключ');
  const e = process.env;
  const out = { env: { BOT_TOKEN: !!e.BOT_TOKEN, ADMIN_IDS: !!e.ADMIN_IDS, KV_REST_API_URL: !!e.KV_REST_API_URL, KV_REST_API_TOKEN: !!e.KV_REST_API_TOKEN, UPSTASH_URL: !!e.UPSTASH_REDIS_REST_URL } };
  try { out.db = (await r('PING')) === 'PONG' ? 'ok' : 'unexpected response'; } catch (x) { out.db_error = String(x.stack || x); }
  out.user = 'skipped (read-only health check)';
  res.json(out);
}
