import { r, getJ } from '../lib/db.js';
import { say, save, fmt, DAY } from '../lib/core.js';
// Ежедневно: напоминания о поливе и об истечении VIP
export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET || process.env.WEBHOOK_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).end();
  const ids = (await r('SMEMBERS', 'users')) || [];
  const today = new Date().toISOString().slice(0, 10);
  let sent = 0;
  for (const id of ids) {
    const u = await getJ('user:' + id); if (!u || !u.notify || u.remindDay === today) continue;
    const due = u.plants.filter(p => Date.now() >= p.last + p.every * DAY - 6 * 36e5);
    const left = u.vip_until - Date.now();
    const parts = [];
    if (due.length) parts.push('💧 Пора поливать: ' + due.map(p => p.name).join(', '));
    if (left > 0 && left < 3 * DAY) parts.push(`👑 VIP истекает ${fmt(u.vip_until)}. Продлите доступ в приложении.`);
    if (parts.length) { await say(id, parts.join('\n\n')); u.remindDay = today; await save(u); sent++; }
  }
  res.json({ sent });
}
