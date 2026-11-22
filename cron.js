import { r, getJ } from '../lib/db.js';
import { say, save, fmt, esc, DAY, loadUsers, withLock } from '../lib/core.js';
// Ежедневно: напоминания о поливе и об истечении VIP
const sleep = ms => new Promise(res => setTimeout(res, ms));
export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET || process.env.WEBHOOK_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).end();
  const started = Date.now(), LIMIT = 50000; // укладываемся в maxDuration (60 с)
  const ids = (await r('SMEMBERS', 'users')) || [];
  const today = new Date().toISOString().slice(0, 10);
  let sent = 0, failed = 0, partial = false;
  for (let i = 0; i < ids.length && !partial; i += 200) {
    const users = await loadUsers(ids.slice(i, i + 200));
    // кому что отправлять
    const todo = [];
    for (const u of users) {
      if (!u.notify || u.remindDay === today) continue;
      const due = (u.plants || []).filter(p => Date.now() >= p.last + p.every * DAY - 6 * 36e5);
      const left = u.vip_until - Date.now();
      const parts = [];
      if (due.length) parts.push('💧 Пора поливать: ' + due.map(p => esc(p.name)).join(', '));
      if (left > 0 && left < 3 * DAY) parts.push(`👑 VIP истекает ${fmt(u.vip_until)}. Продлите доступ в приложении.`);
      if (parts.length) todo.push([u.id, parts.join('\n\n')]);
    }
    // ~25 сообщений в секунду — в пределах лимитов Telegram
    for (let k = 0; k < todo.length; k += 20) {
      if (Date.now() - started > LIMIT) { partial = true; break; }
      const results = await Promise.all(todo.slice(k, k + 20).map(async ([id, text]) => {
        const j = await say(id, text);
        // помечаем «отправлено» только при успехе; если пользователь заблокировал бота — отключаем напоминания
        if (j && (j.ok || j.error_code === 403)) {
          await withLock(id, async () => {
            const u = await getJ('user:' + id); if (!u) return;
            u.remindDay = today; if (!j.ok) u.notify = false; await save(u);
          });
        }
        return !!(j && j.ok);
      }));
      results.forEach(ok => (ok ? sent++ : failed++));
      await sleep(800);
    }
  }
  res.json({ sent, failed, partial });
}
