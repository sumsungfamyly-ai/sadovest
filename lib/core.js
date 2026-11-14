import crypto from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import { r, getJ, setJ } from './db.js';
export { LESSONS } from './lessons.js';
export const DAY = 864e5;
export const admins = () => (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
export const isVip = u => u.vip_until > Date.now();
export const fmt = t => new Date(t).toLocaleDateString('ru-RU');

// ---- Блокировка на пользователя: запросы одного человека выполняются по очереди,
// иначе параллельные чтение-изменение-запись затирают друг друга.
const als = new AsyncLocalStorage();
const sleep = ms => new Promise(res => setTimeout(res, ms));
export async function withLock(id, fn) {
  id = String(id);
  const held = als.getStore();
  if (held && held.has(id)) return fn(); // уже держим эту блокировку
  const key = 'lock:' + id, token = crypto.randomUUID();
  let got = false;
  for (let i = 0; i < 100 && !got; i++) {
    got = (await r('SET', key, token, 'NX', 'PX', 30000)) === 'OK';
    if (!got) await sleep(50);
  }
  if (!got) {
    const error = new Error('Сервис занят: не удалось получить блокировку. Повторите запрос.');
    error.code = 503;
    throw error;
  }
  const next = new Set(held || []); next.add(id);
  try { return await als.run(next, fn); }
  finally { if (got) { try { if ((await r('GET', key)) === token) await r('DEL', key); } catch {} } }
}

// Ограничение частоты: не больше max попыток за sec секунд
export async function rate(key, max, sec) {
  const k = 'rl:' + key, n = await r('INCR', k);
  if (n === 1) await r('EXPIRE', k, sec);
  return n <= max;
}

export async function loadUsers(ids) {
  const out = [], chunks = [];
  for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));
  for (let i = 0; i < chunks.length; i += 4) {
    const parts = await Promise.all(chunks.slice(i, i + 4).map(c => r('MGET', ...c.map(x => 'user:' + x))));
    for (const vals of parts) for (const v of vals || []) if (v) { try { out.push(JSON.parse(v)); } catch {} }
  }
  return out;
}

export function verify(initData) {
  if (!initData || !process.env.BOT_TOKEN) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get('hash'); p.delete('hash');
  const s = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const key = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
  const h = crypto.createHmac('sha256', key).update(s).digest('hex');
  const a = Buffer.from(h), b = Buffer.from(String(hash || ''));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const age = Date.now() / 1000 - Number(p.get('auth_date'));
  if (!Number.isFinite(age) || age > 86400) return null;
  try { return JSON.parse(p.get('user')); } catch { return null; }
}

export async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}
export const say = (chat_id, text, extra = {}) => tg('sendMessage', { chat_id, text, parse_mode: 'HTML', ...extra }).catch(e => ({ ok: false, description: String(e && e.message || e) }));
export const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export async function getUser(t) {
  const id = String(t.id);
  const raw = await r('GET', 'user:' + id);
  const fresh = !raw;
  let stored = null;
  if (raw) { try { stored = JSON.parse(raw); } catch {} }
  const u = { vip_until: 0, progress: [], coins: 0, ach: [], lastDay: '', plants: [], promos: [], notify: true, bookmarks: [], profile: null, joined: Date.now(), name: t.first_name || t.username || 'Садовод', ...(stored || {}), id };
  if (fresh) await r('SADD', 'users', id);
  u.name = t.first_name || u.name;
  for (const k of ['streak', 'best', 'sr', 'lastAct', 'newReward', 'days']) delete u[k]; // серии и счётчика дней больше нет
  const today = new Date().toISOString().slice(0, 10);
  if (u.lastDay !== today) u.lastDay = today; // дата последней активности нужна только для статистики в админке
  achieve(u);
  // пишем в базу только если что-то изменилось (раньше каждый запрос перезаписывал профиль целиком)
  if (fresh || JSON.stringify(u) !== raw) await save(u);
  return u;
}
export const save = u => setJ('user:' + u.id, u);

export function achieve(u) {
  const add = k => { if (!u.ach.includes(k)) u.ach.push(k); };
  if (u.progress.length >= 1) add('first');
  if (u.progress.length >= 5) add('five');
  if (u.plants.length >= 3) add('garden');
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
  if (!(await rate('promo:' + u.id, 10, 600))) throw new Error('Слишком много попыток. Попробуйте через 10 минут');
  const p = await getJ('promo:' + code);
  if (!p || !p.active) throw new Error('Промокод не найден или отключён');
  if (p.expires && p.expires < Date.now()) throw new Error('Срок действия промокода истёк');
  if ((await r('SADD', 'used:' + code, u.id)) === 0) throw new Error('Вы уже активировали этот промокод');
  try {
    if (p.limit && (await r('SCARD', 'used:' + code)) > p.limit) throw new Error('Лимит активаций исчерпан');
    let msg;
    if (p.type === 'vip') { await addVip(u, p.value); msg = `VIP активирован на ${p.value} дн.`; }
    else if (p.type === 'coins') { u.coins += p.value; msg = `Начислено монет: ${p.value}`; }
    else {
      if (!u.discount || p.value > u.discount.value) u.discount = { code, value: p.value };
      msg = `Скидка ${p.value}% сохранена и учтётся при покупке VIP`;
    }
    u.promos.push({ code, at: Date.now(), type: p.type, value: p.value });
    achieve(u); await save(u);
    await say(u.id, `✅ Промокод <b>${code}</b> активирован.\n${msg}`);
    return msg;
  } catch (e) {
    await r('SREM', 'used:' + code, u.id).catch(() => {}); // не «сжигаем» код, если выдать награду не удалось
    throw e;
  }
}

export async function newPromo({ code, type, value, limit, days }) {
  code = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,20}$/.test(code)) throw new Error('Код: 3–20 символов A-Z, 0-9, _ -');
  if (!['vip', 'coins', 'discount'].includes(type)) throw new Error('Тип: vip, coins или discount');
  value = Number(value); if (!(value > 0) || value > 3650) throw new Error('Неверное значение');
  if (type === 'discount' && value > 100) throw new Error('Скидка не может быть больше 100%');
  if (type !== 'discount') value = Math.round(value);
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
  const vip = (await loadUsers(vids)).filter(isVip).length;
  const tids = (await r('LRANGE', 'tickets', 0, 499)) || [];
  let open = 0;
  for (let i = 0; i < tids.length; i += 200) {
    const vals = (await r('MGET', ...tids.slice(i, i + 200).map(id => 'ticket:' + id))) || [];
    for (const v of vals) { try { if (v && JSON.parse(v).status === 'open') open++; } catch {} }
  }
  return { users, vip, tickets: open, promos: await r('SCARD', 'promos') };
}

export async function sendFile(method, chat, field, buf, name, mime, caption) {
  const f = new FormData(); f.append('chat_id', String(chat)); if (caption) f.append('caption', caption.slice(0, 1000));
  f.append(field, new Blob([buf], { type: mime }), name);
  return (await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/${method}`, { method: 'POST', body: f })).json();
}
export async function newTicket(u, text, photo) {
  if (!isVip(u)) throw new Error('Поддержка доступна только VIP-пользователям');
  if (!(await rate('ticket:' + u.id, 5, 3600))) throw new Error('Слишком много обращений. Попробуйте позже');
  text = String(text || '').trim().slice(0, 1000);
  if (text.length < 3 && !photo) throw new Error('Опишите вопрос подробнее');
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(photo || ''); if (photo && (!m || m[1].length > 2e6)) throw new Error('Фото не подходит');
  const id = await r('INCR', 'ticket_seq');
  const t = { id, uid: u.id, name: u.name, text, created: Date.now(), status: 'open', reply: '', photo: !!m };
  await setJ('ticket:' + id, t); await r('LPUSH', 'tickets', id); await r('LPUSH', 'ut:' + u.id, id);
  for (const a of admins()) { const cap = `🎫 Тикет #${id} от ${u.name} (${u.id}):\n${text}\n\nОтвет: /reply ${id} текст`; if (m) await sendFile('sendPhoto', a, 'photo', Buffer.from(m[1], 'base64'), 'p.jpg', 'image/jpeg', cap); else await say(a, esc(cap)); }
  return t;
}

export async function replyTicket(id, text) {
  const t = await getJ('ticket:' + id);
  if (!t) throw new Error('Тикет не найден');
  if (!String(text || '').trim()) throw new Error('Введите текст ответа');
  t.reply = String(text).trim().slice(0, 2000); t.status = 'closed'; await setJ('ticket:' + id, t);
  await say(t.uid, `💬 Ответ поддержки на тикет #${id}:\n${esc(t.reply)}`);
  return t;
}

export async function grantVip(uid, days) {
  days = Math.round(Number(days));
  if (!(days > 0) || days > 3650) throw new Error('Дней: от 1 до 3650');
  return withLock(uid, async () => {
    const u = await getJ('user:' + uid);
    if (!u) throw new Error('Пользователь не найден (он должен открыть бота)');
    await addVip(u, days);
    if (u.discount) { delete u.discount; await save(u); } // скидка использована при покупке
    await say(uid, `👑 Вам выдан VIP на ${days} дн. Действует до ${fmt(u.vip_until)}`);
    return u;
  });
}

export const DEF_GREETING = 'Привет, {name}! 🌿\n«Садовест» — ваш помощник в мире растений: уроки, календарь работ, лунный календарь, энциклопедия и поддержка экспертов.';
export const DEF_BUTTON = '🌱 Открыть Садовест';
export async function botCfg() {
  const g = await getJ('cfg:greeting'), b = await getJ('cfg:button');
  return { greeting: g || DEF_GREETING, button: b || DEF_BUTTON, def: { greeting: DEF_GREETING, button: DEF_BUTTON } };
}
export const greet = (t, name) => esc(t).replace(/\{name\}/g, () => `<b>${esc(name)}</b>`);
