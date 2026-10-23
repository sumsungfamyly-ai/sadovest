import crypto from 'crypto';
import { r, getJ, setJ } from './db.js';
export { LESSONS } from './lessons.js';
export const DAY = 864e5;
export const admins = () => (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
export const isVip = u => u.vip_until > Date.now();
export const fmt = t => new Date(t).toLocaleDateString('ru-RU');

export function verify(initData) {
  if (!initData || !process.env.BOT_TOKEN) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get('hash'); p.delete('hash');
  const s = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const key = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
  const h = crypto.createHmac('sha256', key).update(s).digest('hex');
  if (h !== hash) return null;
  if (Date.now() / 1000 - Number(p.get('auth_date')) > 86400) return null;
  try { return JSON.parse(p.get('user')); } catch { return null; }
}

export async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}
export const say = (chat_id, text, extra = {}) => tg('sendMessage', { chat_id, text, parse_mode: 'HTML', ...extra }).catch(() => {});
export const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export async function getUser(t) {
  const id = String(t.id);
  let u = await getJ('user:' + id);
  if (!u) {
    u = { id, name: t.first_name || t.username || 'Садовод', vip_until: 0, progress: [], coins: 0, ach: [], days: 0, lastDay: '', plants: [], promos: [], notify: true, joined: Date.now() };
    await r('SADD', 'users', id);
  }
  u.name = t.first_name || u.name;
  const today = new Date().toISOString().slice(0, 10);
  if (u.lastDay !== today) { u.days++; u.lastDay = today; }
  achieve(u);
  await save(u);
  return u;
}
export const save = u => setJ('user:' + u.id, u);

export function achieve(u) {
  const add = k => { if (!u.ach.includes(k)) u.ach.push(k); };
  if (u.progress.length >= 1) add('first');
  if (u.progress.length >= 5) add('five');
  if (u.plants.length >= 3) add('garden');
  if (u.days >= 7) add('week');
  if (u.promos.length >= 1) add('promo');
  if (u.vip_until) add('vip');
}

export async function addVip(u, days) {
  u.vip_until = Math.max(Date.now(), u.vip_until || 0) + days * DAY;
  await r('SADD', 'vips', u.id);
  achieve(u); await save(u);
}

// Активация промокода: защита от повторного использования через атомарный SADD
export async function activate(u, raw) {
  const code = String(raw || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,20}$/.test(code)) throw new Error('Неверный формат промокода');
  const p = await getJ('promo:' + code);
  if (!p || !p.active) throw new Error('Промокод не найден или отключён');
  if (p.expires && p.expires < Date.now()) throw new Error('Срок действия промокода истёк');
  if ((await r('SADD', 'used:' + code, u.id)) === 0) throw new Error('Вы уже активировали этот промокод');
  if (p.limit && (await r('SCARD', 'used:' + code)) > p.limit) { await r('SREM', 'used:' + code, u.id); throw new Error('Лимит активаций исчерпан'); }
  let msg;
  if (p.type === 'vip') { await addVip(u, p.value); msg = `VIP активирован на ${p.value} дн.`; }
  else if (p.type === 'coins') { u.coins += p.value; msg = `Начислено монет: ${p.value}`; }
  else msg = `Скидка ${p.value}% применена к следующей покупке VIP`;
  u.promos.push({ code, at: Date.now(), type: p.type, value: p.value });
  achieve(u); await save(u);
  await say(u.id, `✅ Промокод <b>${code}</b> активирован.\n${msg}`);
  return msg;
}

export async function newPromo({ code, type, value, limit, days }) {
  code = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,20}$/.test(code)) throw new Error('Код: 3–20 символов A-Z, 0-9, _ -');
  if (!['vip', 'coins', 'discount'].includes(type)) throw new Error('Тип: vip, coins или discount');
  value = Number(value); if (!(value > 0) || value > 3650) throw new Error('Неверное значение');
  if (await getJ('promo:' + code)) throw new Error('Такой промокод уже есть');
  const p = { code, type, value, limit: Number(limit) || 0, expires: Number(days) ? Date.now() + Number(days) * DAY : 0, active: true, created: Date.now() };
  await setJ('promo:' + code, p); await r('SADD', 'promos', code);
  return p;
}

export async function listPromos() {
  const codes = (await r('SMEMBERS', 'promos')) || [];
  const out = [];
  for (const c of codes) { const p = await getJ('promo:' + c); if (p) { p.used = await r('SCARD', 'used:' + c); out.push(p); } }
  return out.sort((a, b) => b.created - a.created);
}

export async function stats() {
  const users = await r('SCARD', 'users');
  const vids = (await r('SMEMBERS', 'vips')) || [];
  let vip = 0;
  for (const id of vids) { const u = await getJ('user:' + id); if (u && isVip(u)) vip++; }
  const tids = (await r('LRANGE', 'tickets', 0, 99)) || [];
  let open = 0;
  for (const id of tids) { const t = await getJ('ticket:' + id); if (t && t.status === 'open') open++; }
  return { users, vip, tickets: open, promos: await r('SCARD', 'promos') };
}

export async function newTicket(u, text) {
  if (!isVip(u)) throw new Error('Поддержка доступна только VIP-пользователям');
  text = String(text || '').trim().slice(0, 1000);
  if (text.length < 3) throw new Error('Опишите вопрос подробнее');
  const id = await r('INCR', 'ticket_seq');
  const t = { id, uid: u.id, name: u.name, text, created: Date.now(), status: 'open', reply: '' };
  await setJ('ticket:' + id, t); await r('LPUSH', 'tickets', id); await r('LPUSH', 'ut:' + u.id, id);
  for (const a of admins()) await say(a, `🎫 Тикет #${id} от ${esc(u.name)} (${u.id}):\n${esc(text)}\n\nОтвет: /reply ${id} текст`);
  return t;
}

export async function replyTicket(id, text) {
  const t = await getJ('ticket:' + id);
  if (!t) throw new Error('Тикет не найден');
  t.reply = String(text).slice(0, 2000); t.status = 'closed'; await setJ('ticket:' + id, t);
  await say(t.uid, `💬 Ответ поддержки на тикет #${id}:\n${esc(t.reply)}`);
  return t;
}

export async function grantVip(uid, days) {
  const u = await getJ('user:' + uid);
  if (!u) throw new Error('Пользователь не найден (он должен открыть бота)');
  await addVip(u, Number(days));
  await say(uid, `👑 Вам выдан VIP на ${days} дн. Действует до ${fmt(u.vip_until)}`);
  return u;
}
