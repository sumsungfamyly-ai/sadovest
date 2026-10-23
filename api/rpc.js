import { r, getJ, setJ } from '../lib/db.js';
import fs from 'fs';
import path from 'path';
import { sendFile, verify, getUser, save, isVip, activate, achieve, LESSONS, admins, newPromo, listPromos, stats, newTicket, replyTicket, grantVip } from '../lib/core.js';

const deny = (m = 'Нет доступа', code = 403) => { const e = new Error(m); e.code = code; throw e; };
const needAdmin = a => { if (!a) deny(); };

const PDFS = { cal: ['Календарь посадок', 0], water: ['Чек-лист полива', 0], pests: ['Шпаргалка: болезни и вредители', 1], plan: ['Годовой план садовода', 1] };
const board = async () => { const a = (await r('HGETALL', 'lb')) || [], o = []; for (let i = 0; i < a.length; i += 2) o.push({ nick: a[i], score: Number(a[i + 1]) }); return o.sort((x, y) => y.score - x.score).slice(0, 50); };
const H = {
  async me({ u, admin }) {
    return { id: u.id, name: u.name, vip: isVip(u), streak: u.streak, best: u.best, bookmarks: u.bookmarks, profile: u.profile, newReward: await (async () => { const n = u.newReward; if (n) { u.newReward = 0; await save(u); } return n || 0; })(), vip_until: u.vip_until, done: u.progress.length, total: LESSONS.length, coins: u.coins, days: u.days, ach: u.ach, notify: u.notify, admin,
      quiz: (() => { const d = t => new Date(t).toISOString().slice(0, 10), log = u.quizLog || []; return { today: log.includes(d(Date.now())), days: [...Array(7)].map((_, i) => log.includes(d(Date.now() - (6 - i) * 864e5))) }; })(),
      cfg: { community: process.env.COMMUNITY_URL || '', buy: process.env.BUY_URL || '' } };
  },
  async lessons({ u }) {
    return { items: LESSONS.map(l => ({ id: l.id, title: l.title, free: l.free, level: l.level, done: u.progress.includes(l.id), locked: !l.free && !isVip(u) })) };
  },
  async lesson({ u, b }) {
    const l = LESSONS.find(x => x.id === Number(b.id)); if (!l) deny('Урок не найден', 404);
    if (!l.free && !isVip(u)) deny('Урок доступен с VIP');
    u.reading = { id: l.id, at: Date.now() }; await save(u);
    const mix = a => a.map(x => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map(x => x[1]);
    return { id: l.id, title: l.title, intro: l.intro, sections: l.sections, tip: l.tip, fact: l.fact, done: u.progress.includes(l.id), quiz: l.quiz.map(([q, ...o]) => ({ q, o: mix(o) })) };
  },
  async done({ u, b }) {
    const l = LESSONS.find(x => x.id === Number(b.id)); if (!l) deny('Урок не найден', 404);
    if (!l.free && !isVip(u)) deny('Урок доступен с VIP');
    if (!u.reading || u.reading.id !== l.id || Date.now() - u.reading.at < (l.sections.length + 2) * 4000) deny('Внимательно изучите все слайды урока', 400);
    const a = Array.isArray(b.answers) ? b.answers : [];
    if (l.quiz.filter(([, right], i) => a[i] === right).length < 2) deny('Нужно верно ответить минимум на 2 из 3 вопросов. Попробуйте ещё раз!', 400);
    if (!u.progress.includes(l.id)) { u.progress.push(l.id); u.coins += 2; }
    achieve(u); await save(u); return { done: u.progress.length };
  },
  async promo({ u, b }) { return { msg: await activate(u, b.code) }; },
  async tickets({ u }) {
    const ids = (await r('LRANGE', 'ut:' + u.id, 0, 19)) || [];
    return { items: (await Promise.all(ids.map(i => getJ('ticket:' + i)))).filter(Boolean) };
  },
  async ticket_new({ u, b }) { await newTicket(u, b.text, b.photo); return { ok: 1 }; },
  async plants({ u }) { return { items: u.plants }; },
  async plant_add({ u, b }) {
    const name = String(b.name || '').trim().slice(0, 40), every = Math.min(60, Math.max(1, Number(b.every) || 3));
    if (!name) deny('Введите название растения', 400);
    if (u.plants.length >= 30) deny('Максимум 30 растений', 400);
    u.plants.push({ id: Date.now(), name, every, last: Date.now() }); achieve(u); await save(u); return { items: u.plants };
  },
  async plant_water({ u, b }) { const p = u.plants.find(x => x.id === Number(b.id)); if (p) p.last = Date.now(); await save(u); return { items: u.plants }; },
  async plant_del({ u, b }) { u.plants = u.plants.filter(x => x.id !== Number(b.id)); await save(u); return { items: u.plants }; },
  async notify({ u, b }) { u.notify = !!b.on; await save(u); return { notify: u.notify }; },
  async quiz({ u, b }) {
    const today = new Date().toISOString().slice(0, 10);
    u.quizLog = u.quizLog || [];
    if (u.quizLog.includes(today)) deny('Сегодня вы уже играли', 400);
    u.quizLog = [...u.quizLog, today].slice(-14); u.coins += Math.min(5, Math.max(0, Number(b.score) || 0)); await save(u); return { coins: u.coins };
  },
  async bookmark({ u, b }) {
    const k = String(b.key || '').slice(0, 10); if (!/^[lpd]:\d+$/.test(k)) deny('Ошибка', 400);
    u.bookmarks = u.bookmarks.includes(k) ? u.bookmarks.filter(x => x !== k) : [...u.bookmarks, k].slice(-100); await save(u); return { bookmarks: u.bookmarks };
  },
  async onboard({ u, b }) {
    const city = String(b.city || '').trim().slice(0, 40);
    if (!['Дача', 'Балкон', 'Теплица'].includes(b.place) || !['Новичок', 'Любитель', 'Опытный'].includes(b.level) || !city) deny('Ответьте на все вопросы', 400);
    u.profile = { place: b.place, level: b.level, city }; await save(u); return { ok: 1 };
  },
  async lb({ u }) { return { items: await board(), you: u.coins }; },
  async pdf({ u, b }) {
    const f = PDFS[b.id]; if (!f) deny('Файл не найден', 404);
    if (f[1] && !isVip(u)) deny('Материал только для VIP');
    const buf = fs.readFileSync(path.join(process.cwd(), 'lib', 'pdf', b.id + '.pdf'));
    await sendFile('sendDocument', u.id, 'document', buf, f[0] + '.pdf', 'application/pdf', '📄 ' + f[0]); return { ok: 1 };
  },
  async admin_lb_set({ admin, b }) {
    needAdmin(admin); const n = String(b.nick || '').trim().slice(0, 24), sc = Number(b.score);
    if (!n || !Number.isFinite(sc)) deny('Введите ник и рейтинг', 400);
    await r('HSET', 'lb', n, String(Math.round(sc))); return { items: await board() };
  },
  async admin_lb_del({ admin, b }) { needAdmin(admin); await r('HDEL', 'lb', String(b.nick)); return { items: await board() }; },
  async admin_stats({ admin }) { needAdmin(admin); return await stats(); },
  async admin_promos({ admin }) { needAdmin(admin); return { items: await listPromos() }; },
  async admin_promo_new({ admin, b }) { needAdmin(admin); await newPromo(b); return { items: await listPromos() }; },
  async admin_promo_toggle({ admin, b }) { needAdmin(admin); const p = await getJ('promo:' + b.code); if (p) { p.active = !p.active; await setJ('promo:' + p.code, p); } return { items: await listPromos() }; },
  async admin_promo_del({ admin, b }) { needAdmin(admin); await r('DEL', 'promo:' + b.code); await r('SREM', 'promos', b.code); return { items: await listPromos() }; },
  async admin_grant({ admin, b }) { needAdmin(admin); await grantVip(String(b.uid), Math.min(3650, Number(b.days) || 30)); return { ok: 1 }; },
  async admin_tickets({ admin }) {
    needAdmin(admin);
    const ids = (await r('LRANGE', 'tickets', 0, 29)) || [];
    return { items: (await Promise.all(ids.map(i => getJ('ticket:' + i)))).filter(Boolean) };
  },
  async admin_reply({ admin, b }) { needAdmin(admin); await replyTicket(b.id, b.text); return { ok: 1 }; },
};

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    const tu = verify(req.headers['x-init'] || '');
    if (!tu) return res.status(401).json({ error: 'Откройте приложение через Telegram' });
    const u = await getUser(tu);
    const b = req.body || {};
    const fn = H[b.action]; if (!fn) deny('Неизвестное действие', 400);
    res.json(await fn({ u, b, admin: admins().includes(String(u.id)) }));
  } catch (e) { res.status(e.code || 400).json({ error: e.message }); }
}
