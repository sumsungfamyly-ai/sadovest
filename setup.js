import { tg } from '../lib/core.js';
// Открыть один раз: https://ВАШ-САЙТ.vercel.app/api/setup?key=WEBHOOK_SECRET
export default async function handler(req, res) {
  if (!process.env.WEBHOOK_SECRET || req.query.key !== process.env.WEBHOOK_SECRET) return res.status(401).send('Неверный ключ');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const hook = await tg('setWebhook', { url: `https://${host}/api/bot`, secret_token: process.env.WEBHOOK_SECRET, allowed_updates: ['message'] });
  await tg('setMyCommands', { commands: [['start', 'Запуск'], ['help', 'Помощь'], ['vip', 'VIP-клуб'], ['support', 'Поддержка (VIP)'], ['profile', 'Профиль'], ['promo', 'Промокод']].map(([command, description]) => ({ command, description })) });
  await tg('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Садовест', web_app: { url: `https://${host}` } } });
  res.json({ webhook: hook });
}
