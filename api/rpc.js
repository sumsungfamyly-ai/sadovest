import { r, getJ, setJ } from '../lib/db.js';
import fs from 'fs';
import path from 'path';
import { SOON } from '../lib/lessons.js';
import { TESTS, pickQs, testSize, shuffle } from '../lib/tests.js';
import { botCfg, greet, say, esc, bump, sendFile, verify, getUser, save, isVip, activate, achieve, LESSONS, admins, newPromo, listPromos, stats, newTicket, replyTicket, grantVip } from '../lib/core.js';

const deny = (m = 'Нет доступа', code = 403) => { const e = new Error(m); e.code = code; throw e; };
const needAdmin = a => { if (!a) deny(); };

const pdfs = () => JSON.parse(fs.readFileSync(path.join(process.cwd(), 'lib', 'pdf', 'index.json'), 'utf8'));
const board = async () => { const a = (await r('HGETALL', 'lb')) || [], o = []; for (let i = 0; i < a.length; i += 2) o.push({ nick: a[i], score: Number(a[i + 1]) }); return o.sort((x, y) => y.score - x.score).slice(0, 50); };
const loadUsers = async ids => {
  const out = [];
  for (let i = 0; i < ids.length; i += 200) {
    const vals = await r('MGET', ...ids.slice(i, i + 200).map(x => 'user:' + x));
    for (const v of vals || []) if (v) { try { out.push(JSON.parse(v)); } catch {} }
  }
  return out;
};
const sleep = ms => new Promise(res => setTimeout(res, ms));
const H = {
  async me({ u, admin }) {
    return { id: u.id, name: u.name, vip: isVip(u), streak: (u.lastAct === new Date().toISOString().slice(0, 10) || u.lastAct === new Date(Date.now() - 864e5).toISOString().slice(0, 10)) ? u.streak : 0, best: u.best, bookmarks: u.bookmarks, profile: u.profile, newReward: await (async () => { const n = u.newReward; if (n) { u.newReward = 0; await save(u); } return n || 0; })(), vip_until: u.vip_until, done: u.progress.length, total: LESSONS.length, coins: u.coins, days: u.days, ach: u.ach, notify: u.notify, admin,
      cfg: { buy: process.env.BUY_URL || '' } };
  },
  async lessons({ u }) {
    return { items: LESSONS.map(l => ({ id: l.id, title: l.title, free: l.free, level: l.level, done: u.progress.includes(l.id), locked: !l.free && !isVip(u) })), soon: SOON };
  },
  async lesson({ u, b }) {
    const l = LESSONS.find(x => x.id === Number(b.id)); if (!l) deny('Урок не найден', 404);
    if (!l.free && !isVip(u)) deny('Урок доступен с VIP');
    u.reading = { id: l.id, at: Date.now() }; await save(u);
    const mix = a => a.map(x => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map(x => x[1]);
    return { id: l.id, title: l.title, intro: l.intro, sections: l.sections, tip: l.tip, fact: l.fact, words: l.words || [], done: u.progress.includes(l.id), quiz: l.quiz.map(([q, ...o]) => ({ q, o: mix(o) })) };
  },
  async done({ u, b }) {
    const l = LESSONS.find(x => x.id === Number(b.id)); if (!l) deny('Урок не найден', 404);
    if (!l.free && !isVip(u)) deny('Урок доступен с VIP');
    if (!u.reading || u.reading.id !== l.id) deny('Откройте урок заново', 400);
    const wait = Math.ceil(((l.sections.length + 2) * 3000 - (Date.now() - u.reading.at)) / 1000);
    if (wait > 0) deny(`Изучите слайды внимательнее: подождите ещё ${wait} сек.`, 400);
    const a = Array.isArray(b.answers) ? b.answers : [];
    const review = l.quiz.map(([q, right], i) => ({ q, right, mine: a[i], ok: a[i] === right })), score = review.filter(x => x.ok).length;
    u.reading = null;
    if (score < 2) { await save(u); return { passed: false, score, total: review.length, review }; }
    const first = !u.progress.includes(l.id); if (first) { u.progress.push(l.id); u.coins += 2; }
    if (first) await bump(u);
    achieve(u); await save(u); return { passed: true, score, total: review.length, review, gain: first ? 2 : 0, repeat: !first };
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
  async admin_overview({ admin }) {
    needAdmin(admin);
    const st = await stats(), ids = (await r('SMEMBERS', 'users')) || [], us = await loadUsers(ids.slice(0, 2000));
    const today = new Date().toISOString().slice(0, 10), w = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10), now = Date.now(), cnt = {};
    let done = 0, tests = 0;
    for (const u of us) { done += (u.progress || []).length; tests += Object.keys(u.tests || {}).length; (u.progress || []).forEach(i => { cnt[i] = (cnt[i] || 0) + 1; }); }
    const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, n]) => ({ title: (LESSONS.find(l => l.id == id) || {}).title || 'Урок ' + id, n }));
    return { ...st, vip: us.filter(u => isVip(u)).length, users: ids.length, active: us.filter(u => u.lastDay === today).length, active7: us.filter(u => (u.lastDay || '') >= w).length, new7: us.filter(u => (u.joined || 0) > now - 7 * 864e5).length, lessonsDone: done, testsDone: tests, top };
  },
  async admin_users({ admin, b }) {
    needAdmin(admin);
    const q = String(b.q || '').trim().toLowerCase(), ids = (await r('SMEMBERS', 'users')) || [];
    let list;
    if (/^\d+$/.test(q)) { const u = await getJ('user:' + q); list = u ? [u] : []; }
    else { const us = await loadUsers(ids.slice(0, 2000)); list = q ? us.filter(u => String(u.name).toLowerCase().includes(q)) : us.sort((a, c) => (c.joined || 0) - (a.joined || 0)); }
    return { total: ids.length, items: list.slice(0, 15).map(u => ({ id: u.id, name: u.name, vip_until: u.vip_until || 0, streak: u.streak || 0, coins: u.coins || 0, done: (u.progress || []).length, days: u.days || 0, joined: u.joined || 0 })) };
  },
  async admin_user_act({ admin, b }) {
    needAdmin(admin);
    const id = String(b.uid || ''), u = await getJ('user:' + id); if (!u) deny('Пользователь не найден', 404);
    if (b.act === 'vip+') await grantVip(id, Math.min(3650, Number(b.value) || 30));
    else if (b.act === 'vip-') { u.vip_until = 0; await save(u); }
    else if (b.act === 'coins') { u.coins = Math.max(0, (u.coins || 0) + Math.round(Number(b.value) || 0)); await save(u); }
    else deny('Неизвестное действие', 400);
    return { ok: 1 };
  },
  async admin_broadcast({ admin, b }) {
    needAdmin(admin);
    const text = String(b.text || '').trim().slice(0, 1000); if (text.length < 3) deny('Введите текст сообщения', 400);
    const ids = ((await r('SMEMBERS', 'users')) || []).sort(), off = Math.max(0, Number(b.offset) || 0), part = ids.slice(off, off + 300);
    const us = await loadUsers(part), pick = us.filter(u => b.target === 'vip' ? isVip(u) : b.target === 'free' ? !isVip(u) : true);
    let sent = 0, failed = 0;
    for (let i = 0; i < pick.length; i += 20) {
      const res = await Promise.all(pick.slice(i, i + 20).map(u => fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: u.id, text: esc(text) }) }).then(x => x.json()).then(j => !!j.ok).catch(() => false)));
      res.forEach(ok => (ok ? sent++ : failed++));
      if (i + 20 < pick.length) await sleep(700);
    }
    return { sent, failed, total: ids.length, next: off + 300 < ids.length ? off + 300 : null };
  },
  async admin_bot_get({ admin }) { needAdmin(admin); return await botCfg(); },
  async admin_bot_set({ admin, b }) {
    needAdmin(admin);
    const g = String(b.greeting || '').trim(), bt = String(b.button || '').trim();
    if (g.length < 3 || g.length > 1000) deny('Приветствие: от 3 до 1000 символов', 400);
    if (bt.length < 2 || bt.length > 40) deny('Текст кнопки: от 2 до 40 символов', 400);
    await setJ('cfg:greeting', g); await setJ('cfg:button', bt); return { ok: 1 };
  },
  async admin_bot_reset({ admin }) { needAdmin(admin); await r('DEL', 'cfg:greeting', 'cfg:button'); return await botCfg(); },
  async admin_bot_test({ admin, u, host }) {
    needAdmin(admin);
    const c = await botCfg();
    await say(u.id, greet(c.greeting, u.name), { reply_markup: { inline_keyboard: [[{ text: c.button, web_app: { url: `https://${host}` } }]] } });
    return { ok: 1 };
  },
  async bookmark({ u, b }) {
    const k = String(b.key || '').slice(0, 10); if (!/^[lpdh]:\d+$/.test(k)) deny('Ошибка', 400);
    u.bookmarks = u.bookmarks.includes(k) ? u.bookmarks.filter(x => x !== k) : [...u.bookmarks, k].slice(-100); await save(u); return { bookmarks: u.bookmarks };
  },
  async onboard({ u, b }) {
    const city = String(b.city || '').trim().slice(0, 40), place = (Array.isArray(b.place) ? b.place : []).filter(x => ['Дача', 'Теплица', 'Балкон', 'Огород во дворе', 'Подоконник'].includes(x));
    if (!place.length || !['Новичок', 'Любитель', 'Опытный'].includes(b.level) || !city) deny('Ответьте на все три вопроса', 400);
    u.profile = { place, level: b.level, city }; await save(u); return { ok: 1 };
  },
  async tests({ u }) { return { items: TESTS.map(t => ({ id: t.id, title: t.title, level: t.level, section: t.section, n: testSize(t), best: (u.tests || {})[t.id] ?? null })) }; },
  async test({ u, b }) {
    const t = TESTS.find(x => x.id === Number(b.id)); if (!t) deny('Тест не найден', 404);
    const qs = pickQs(t); u.run = { id: t.id, keys: qs.map(([q, r]) => [q, r]) }; await save(u);
    return { id: t.id, title: t.title, questions: qs.map(([q, ...o]) => ({ q, o: shuffle(o) })) };
  },
  async test_done({ u, b }) {
    if (!u.run) deny('Начните тест заново', 400);
    const a = Array.isArray(b.answers) ? b.answers : [], keys = u.run.keys, id = u.run.id;
    const review = keys.map(([q, right], i) => ({ q, right, mine: a[i], ok: a[i] === right })), score = review.filter(x => x.ok).length;
    u.tests = u.tests || {}; const old = u.tests[id] || 0, coins = Math.floor(Math.max(0, score - old) / 3);
    const need = Math.ceil(keys.length / 2);
    if (score >= need && old < need) await bump(u);
    if (score > old) u.tests[id] = score; u.coins += coins; u.run = null; await save(u);
    return { score, total: keys.length, review, coins };
  },
  async lb({ u }) { return { items: await board(), you: u.coins }; },
  async files() { return { items: pdfs() }; },
  async pdf({ u, b }) {
    const f = pdfs().find(x => x.id === b.id); if (!f) deny('Файл не найден', 404);
    if (f.vip && !isVip(u)) deny('Материал только для VIP');
    const buf = fs.readFileSync(path.join(process.cwd(), 'lib', 'pdf', f.id + '.pdf'));
    await sendFile('sendDocument', u.id, 'document', buf, f.title + '.pdf', 'application/pdf', '📄 ' + f.title); return { ok: 1 };
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
    if (!u.profile && !['me', 'onboard'].includes((req.body || {}).action)) deny('Сначала ответьте на вопросы', 400);
    const b = req.body || {};
    const fn = H[b.action]; if (!fn) deny('Неизвестное действие', 400);
    res.json(await fn({ u, b, admin: admins().includes(String(u.id)), host: req.headers['x-forwarded-host'] || req.headers.host }));
  } catch (e) { res.status(e.code || 400).json({ error: e.message }); }
}
