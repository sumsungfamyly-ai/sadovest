import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENC, FREE } from '../lib/enc.js';
import { LESSONS, SOON } from '../lib/lessons.js';
import { TESTS, pickQs, shuffle, testSize } from '../lib/tests.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const publicRoot = resolve(root, 'public');
const port = Number(process.env.PORT) || 4173;
const DAY = 864e5;
const pdfs = JSON.parse(await readFile(resolve(root, 'lib/pdf/index.json'), 'utf8'));
const events = new Set();
const demo = {
  id: 100000001,
  name: 'Демо-садовод',
  profile: { place: ['Дача'], level: 'Любитель', city: 'Москва' },
  progress: new Set([1, 2]),
  plants: [
    { id: 1, name: 'Томат', every: 3, last: Date.now() - 3 * DAY },
    { id: 2, name: 'Огурец', every: 2, last: Date.now() - 2 * DAY },
  ],
  tests: {},
  bookmarks: [],
  coins: 24,
  days: 12,
  notify: true,
  tickets: [],
  promos: [{ code: 'DEMO10', type: 'discount', value: 10, limit: 0, expires: 0, active: true, used: 0, created: Date.now() }],
  run: null,
};

const json = (res, status, value) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
};

async function readBody(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 4_000_000) throw Object.assign(new Error('Запрос слишком большой'), { status: 413 });
  }
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw Object.assign(new Error('Некорректный JSON'), { status: 400 });
  }
}

function me(req) {
  const vip = req.headers['x-preview-vip'] === '1';
  return {
    id: demo.id,
    name: demo.name,
    vip,
    bookmarks: demo.bookmarks,
    profile: demo.profile,
    vip_until: vip ? Date.now() + 30 * DAY : 0,
    done: demo.progress.size,
    total: LESSONS.length,
    coins: demo.coins,
    days: demo.days,
    ach: [...(demo.progress.size ? ['first'] : []), ...(demo.plants.length >= 3 ? ['garden'] : [])],
    notify: demo.notify,
    admin: req.headers['x-preview-admin'] === '1',
    discount: null,
    cfg: { buy: '' },
  };
}

function requireAdmin(admin) {
  if (!admin) throw Object.assign(new Error('Нет доступа в демо-режиме'), { status: 403 });
}

async function api(req, body) {
  if (!body || typeof body.action !== 'string') {
    throw Object.assign(new Error('Не указано действие'), { status: 400 });
  }
  const admin = req.headers['x-preview-admin'] === '1';
  const vip = req.headers['x-preview-vip'] === '1';
  const user = me(req);

  if (body.action.startsWith('admin_')) requireAdmin(admin);

  switch (body.action) {
    case 'me': return user;
    case 'onboard':
      demo.profile = { place: body.place || ['Дача'], level: body.level || 'Любитель', city: body.city || 'Москва' };
      return { ok: 1 };
    case 'plants': return { items: demo.plants };
    case 'plant_add': {
      const name = String(body.name || '').trim();
      if (!name) throw Object.assign(new Error('Введите название растения'), { status: 400 });
      if (name.length > 40) throw Object.assign(new Error('Название растения: максимум 40 символов'), { status: 400 });
      const rawEvery = String(body.every ?? '');
      const every = Number(rawEvery);
      if (!/^\d{1,2}$/.test(rawEvery) || !Number.isInteger(every) || every < 1 || every > 60) {
        throw Object.assign(new Error('Интервал полива: целое число от 1 до 60 дней'), { status: 400 });
      }
      if (demo.plants.length >= 30) throw Object.assign(new Error('Максимум 30 растений'), { status: 400 });
      demo.plants.push({ id: Date.now(), name, every, last: Date.now() });
      return { items: demo.plants };
    }
    case 'plant_interval': {
      const plant = demo.plants.find(item => item.id === Number(body.id));
      if (!plant) throw Object.assign(new Error('Растение не найдено'), { status: 404 });
      const rawEvery = String(body.every ?? '');
      const every = Number(rawEvery);
      if (!/^\d{1,2}$/.test(rawEvery) || !Number.isInteger(every) || every < 1 || every > 60) {
        throw Object.assign(new Error('Интервал полива: целое число от 1 до 60 дней'), { status: 400 });
      }
      plant.every = every;
      return { items: demo.plants };
    }
    case 'plant_water': {
      const plant = demo.plants.find(item => item.id === Number(body.id));
      if (plant) plant.last = Date.now();
      return { items: demo.plants };
    }
    case 'plant_del':
      demo.plants = demo.plants.filter(item => item.id !== Number(body.id));
      return { items: demo.plants };
    case 'notify':
      demo.notify = !!body.on;
      return { notify: demo.notify };
    case 'lessons':
      return { items: LESSONS.map(item => ({ id: item.id, title: item.title, free: item.free, level: item.level, done: demo.progress.has(item.id), locked: !item.free && !vip })), soon: SOON };
    case 'lesson': {
      const lesson = LESSONS.find(item => item.id === Number(body.id));
      if (!lesson) throw Object.assign(new Error('Урок не найден'), { status: 404 });
      if (!lesson.free && !vip) throw Object.assign(new Error('Урок доступен с VIP'), { status: 403 });
      return {
        id: lesson.id,
        title: lesson.title,
        intro: lesson.intro,
        sections: lesson.sections,
        tip: lesson.tip,
        fact: lesson.fact,
        words: lesson.words || [],
        done: demo.progress.has(lesson.id),
        quiz: lesson.quiz.map(([q, ...options]) => ({ q, o: shuffle(options) })),
      };
    }
    case 'done': {
      const lesson = LESSONS.find(item => item.id === Number(body.id));
      if (!lesson) throw Object.assign(new Error('Урок не найден'), { status: 404 });
      const answers = Array.isArray(body.answers) ? body.answers : [];
      const review = lesson.quiz.map(([q, right], i) => ({ q, right, mine: answers[i], ok: answers[i] === right }));
      const score = review.filter(item => item.ok).length;
      const first = score >= 2 && !demo.progress.has(lesson.id);
      if (first) {
        demo.progress.add(lesson.id);
        demo.coins += 2;
      }
      return { passed: score >= 2, score, total: review.length, review, gain: first ? 2 : 0, repeat: !first };
    }
    case 'tests':
      return { items: TESTS.map(test => ({ id: test.id, num: test.num || null, gen: !!test.gen, title: test.title, level: test.level, section: test.section, n: testSize(test), best: demo.tests[test.id] ?? null })) };
    case 'test': {
      const test = TESTS.find(item => item.id === Number(body.id));
      if (!test) throw Object.assign(new Error('Тест не найден'), { status: 404 });
      const questions = pickQs(test);
      demo.run = { id: test.id, keys: questions.map(([q, right]) => [q, right]) };
      return { id: test.id, title: test.title, questions: questions.map(([q, ...options]) => ({ q, o: shuffle(options) })) };
    }
    case 'test_done': {
      if (!demo.run) throw Object.assign(new Error('Начните тест заново'), { status: 400 });
      const answers = Array.isArray(body.answers) ? body.answers : [];
      const review = demo.run.keys.map(([q, right], i) => ({ q, right, mine: answers[i], ok: answers[i] === right }));
      const score = review.filter(item => item.ok).length;
      const old = demo.tests[demo.run.id] || 0;
      const coins = Math.floor(Math.max(0, score - old) / 3);
      demo.tests[demo.run.id] = Math.max(old, score);
      demo.coins += coins;
      demo.run = null;
      return { score, total: review.length, review, coins };
    }
    case 'enc_get': {
      const type = body.t === 'd' ? 'd' : 'p';
      const index = Number(body.i);
      if (!Number.isInteger(index) || index < 0 || index >= ENC[type].length) throw Object.assign(new Error('Запись не найдена'), { status: 404 });
      if (!FREE[type].includes(index) && !vip) throw Object.assign(new Error('Запись доступна с VIP'), { status: 403 });
      return { item: ENC[type][index] };
    }
    case 'files': return { items: pdfs };
    case 'pdf': return { ok: 1 };
    case 'tickets': return { items: demo.tickets };
    case 'ticket_new': {
      const ticket = { id: demo.tickets.length + 1, uid: demo.id, name: demo.name, text: String(body.text || ''), created: Date.now(), status: 'open', reply: '', photo: !!body.photo };
      demo.tickets.push(ticket);
      return { ok: 1 };
    }
    case 'promo': return { msg: `Демо-промокод ${String(body.code || '').toUpperCase()} принят` };
    case 'bookmark': {
      const key = String(body.key || '');
      demo.bookmarks = demo.bookmarks.includes(key) ? demo.bookmarks.filter(item => item !== key) : [...demo.bookmarks, key].slice(-100);
      return { bookmarks: demo.bookmarks };
    }
    case 'lb': return { items: [{ nick: 'Зелёный сад', score: 42 }, { nick: 'Росток', score: 31 }], you: demo.coins };
    case 'admin_stats': return { users: 1, vip: vip ? 1 : 0, tickets: demo.tickets.length, promos: demo.promos.length };
    case 'admin_overview': return { users: 1, vip: vip ? 1 : 0, tickets: demo.tickets.length, promos: demo.promos.length, active: 1, active7: 1, new7: 1, lessonsDone: demo.progress.size, testsDone: Object.keys(demo.tests).length, top: [] };
    case 'admin_users': return { total: 1, items: [{ id: demo.id, name: demo.name, vip_until: vip ? Date.now() + 30 * DAY : 0, coins: demo.coins, done: demo.progress.size, days: demo.days, joined: Date.now() }] };
    case 'admin_promos': return { items: demo.promos };
    case 'admin_promo_new': {
      const promo = { ...body, used: 0, active: true, created: Date.now(), expires: 0 };
      demo.promos.unshift(promo);
      return { items: demo.promos };
    }
    case 'admin_promo_toggle': {
      const promo = demo.promos.find(item => item.code === body.code);
      if (promo) promo.active = !promo.active;
      return { items: demo.promos };
    }
    case 'admin_promo_del':
      demo.promos = demo.promos.filter(item => item.code !== body.code);
      return { items: demo.promos };
    case 'admin_tickets': return { items: demo.tickets };
    case 'admin_reply': {
      const ticket = demo.tickets.find(item => item.id === Number(body.id));
      if (ticket) { ticket.reply = body.text; ticket.status = 'closed'; }
      return { ok: 1 };
    }
    case 'admin_grant':
    case 'admin_user_act':
    case 'admin_lb_set':
    case 'admin_lb_del':
    case 'admin_broadcast':
      return body.action === 'admin_broadcast' ? { sent: 1, failed: 0, total: 1, next: null } : { ok: 1 };
    case 'admin_bot_get': return { greeting: 'Привет, {name}! 🌿 Это локальный предпросмотр.', button: '🌱 Открыть Садовест' };
    case 'admin_bot_set':
    case 'admin_bot_reset':
    case 'admin_bot_test':
      return { ok: 1 };
    default:
      throw Object.assign(new Error('Неизвестное действие'), { status: 404 });
  }
}

function devScripts() {
  return `<script>
window.Telegram = { WebApp: {
  initData: 'local-preview',
  ready() {}, expand() {}, openLink(url) { window.open(url, '_blank', 'noopener'); },
  openTelegramLink(url) { window.open(url, '_blank', 'noopener'); },
  BackButton: { show() {}, hide() {}, onClick() {} }
} };
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (url.pathname === '/api/rpc') {
    const headers = new Headers(init.headers || {});
    const params = new URLSearchParams(location.search);
    headers.set('x-preview-vip', params.get('vip') === '1' ? '1' : '0');
    headers.set('x-preview-admin', params.get('admin') === '1' ? '1' : '0');
    return nativeFetch(input, { ...init, headers });
  }
  if (url.hostname === 'geocoding-api.open-meteo.com') {
    return Promise.resolve(new Response(JSON.stringify({ results: [{ name: 'Москва', latitude: 55.75, longitude: 37.62 }] }), { headers: { 'content-type': 'application/json' } }));
  }
  if (url.hostname === 'api.open-meteo.com') {
    const dates = Array.from({ length: 7 }, (_, i) => new Date(Date.now() + i * 86400000).toISOString().slice(0, 10));
    const daily = {
      time: dates, weather_code: [1, 2, 3, 61, 2, 1, 3], temperature_2m_max: [20, 19, 17, 15, 18, 21, 20],
      temperature_2m_min: [11, 10, 9, 8, 10, 12, 11], apparent_temperature_max: [20, 18, 16, 14, 18, 21, 20],
      apparent_temperature_min: [10, 9, 8, 7, 9, 11, 10], precipitation_sum: [0, 0, 1.2, 4, 0, 0, 0],
      precipitation_probability_max: [5, 10, 25, 70, 20, 5, 5], wind_speed_10m_max: [3, 4, 5, 6, 3, 2, 3],
      wind_gusts_10m_max: [7, 8, 9, 12, 7, 5, 6], sunrise: dates.map(d => d + 'T04:30'), sunset: dates.map(d => d + 'T20:30'),
      sunshine_duration: [36000, 32400, 28800, 18000, 28800, 36000, 32400], uv_index_max: [4, 4, 3, 2, 3, 5, 4]
    };
    const hourly = { temperature_2m: Array.from({ length: 168 }, (_, i) => 12 + Math.round(7 * Math.sin((i % 24 - 6) * Math.PI / 12))), precipitation_probability: Array(168).fill(10) };
    const value = url.searchParams.has('current')
      ? { current: { temperature_2m: 18, relative_humidity_2m: 58, wind_speed_10m: 3, weather_code: 1 } }
      : { daily, hourly };
    return Promise.resolve(new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } }));
  }
  return nativeFetch(input, init);
};
new EventSource('/__events').addEventListener('message', () => location.reload());
</script>`;
}

function contentType(file) {
  return ({
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
  })[extname(file).toLowerCase()] || 'application/octet-stream';
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  if (url.pathname === '/__events' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(': connected\n\n');
    events.add(res);
    req.on('close', () => events.delete(res));
    return;
  }
  if (url.pathname === '/api/rpc') {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
    try {
      return json(res, 200, await api(req, await readBody(req)));
    } catch (error) {
      return json(res, error.status || 400, { error: error.message || 'Ошибка предпросмотра' });
    }
  }
  if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' });

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  } catch {
    return json(res, 400, { error: 'Некорректный путь' });
  }
  const file = resolve(publicRoot, `.${pathname}`);
  if (file !== publicRoot && !file.startsWith(`${publicRoot}${sep}`)) return json(res, 403, { error: 'Forbidden' });

  try {
    let data = await readFile(file);
    if (file === resolve(publicRoot, 'index.html')) {
      const html = data.toString('utf8').replace('<script src="https://telegram.org/js/telegram-web-app.js"></script>', '');
      const marker = '<script>\nconst tg=';
      if (!html.includes(marker)) return json(res, 500, { error: 'Не удалось установить локальный preview-режим в index.html' });
      data = Buffer.from(html.replace(marker, `${devScripts()}\n<script>\nconst tg=`));
    }
    res.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    return res.end(data);
  } catch (error) {
    if (error.code === 'ENOENT') return json(res, 404, { error: 'Файл не найден' });
    console.error('Ошибка предпросмотра:', error);
    return json(res, 500, { error: 'Не удалось прочитать файл предпросмотра' });
  }
});

const watcher = watch(root, { recursive: true }, () => {
  for (const client of events) client.write('data: reload\n\n');
});
watcher.on('error', error => console.error('Ошибка отслеживания файлов:', error));

server.listen(port, '127.0.0.1', () => {
  console.log(`Локальный предпросмотр: http://127.0.0.1:${port}`);
  console.log('Демо-данные, мок API; для VIP и админки добавьте ?vip=1&admin=1');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    watcher.close();
    for (const client of events) client.end();
    server.close(() => process.exit(0));
  });
}
