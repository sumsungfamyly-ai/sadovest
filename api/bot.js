import { getUser, isVip, fmt, say, esc, admins, activate, newPromo, stats, newTicket, replyTicket, grantVip, LESSONS } from '../lib/core.js';

export default async function handler(req, res) {
  if (!process.env.WEBHOOK_SECRET || req.headers['x-telegram-bot-api-secret-token'] !== process.env.WEBHOOK_SECRET) return res.status(401).end();
  const m = req.body?.message;
  try {
    if (m?.text) {
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const openBtn = { reply_markup: { inline_keyboard: [[{ text: '🌱 Открыть Садовест', web_app: { url: `https://${host}` } }]] } };
      const [cmd0, ...rest] = m.text.trim().split(/\s+/);
      const cmd = cmd0.split('@')[0].toLowerCase(), arg = rest.join(' ');
      const u = await getUser(m.from), chat = m.chat.id, adm = admins().includes(String(u.id));
      try {
        if (cmd === '/start') await say(chat, `Привет, <b>${esc(u.name)}</b>! 🌿\n«Садовест» — ваш помощник в мире растений: уроки, календарь полива, сообщество и поддержка экспертов.`, openBtn);
        else if (cmd === '/help') await say(chat, '/start — запуск\n/profile — профиль\n/vip — VIP-клуб\n/promo КОД — активировать промокод\n/support вопрос — тикет (VIP)' + (adm ? '\n\nАдмин:\n/grant ID дни\n/newpromo КОД тип значение лимит дни\n/stats\n/reply ID текст' : ''));
        else if (cmd === '/profile') await say(chat, `👤 <b>${esc(u.name)}</b>\nСтатус: ${isVip(u) ? '👑 VIP до ' + fmt(u.vip_until) : 'обычный'}\nУроков: ${u.progress.length} из ${LESSONS.length}\nМонеты: ${u.coins}\nДней в приложении: ${u.days}`, openBtn);
        else if (cmd === '/vip') await say(chat, isVip(u) ? `👑 VIP активен до ${fmt(u.vip_until)}` : '👑 VIP-клуб: 100 уроков, поддержка экспертов, эксклюзивные материалы и золотой значок. Откройте приложение, чтобы купить VIP или ввести промокод.', openBtn);
        else if (cmd === '/promo') { if (!arg) await say(chat, 'Использование: /promo КОД'); else await activate(u, arg); }
        else if (cmd === '/support') { await newTicket(u, arg); await say(chat, '✅ Тикет создан. Ответ в течение 1–2 часов.'); }
        else if (adm && cmd === '/grant') { const [id, d] = rest; await grantVip(id, Number(d) || 30); await say(chat, '✅ VIP выдан'); }
        else if (adm && cmd === '/newpromo') { const [code, type, value, limit, days] = rest; await newPromo({ code, type, value, limit, days }); await say(chat, `✅ Промокод ${esc(code.toUpperCase())} создан`); }
        else if (adm && cmd === '/stats') { const s = await stats(); await say(chat, `👥 Пользователи: ${s.users}\n👑 VIP: ${s.vip}\n🎫 Тикеты: ${s.tickets}\n🏷 Промокоды: ${s.promos}`); }
        else if (adm && cmd === '/reply') { const [id, ...t] = rest; await replyTicket(id, t.join(' ')); await say(chat, '✅ Отправлено'); }
      } catch (e) { await say(chat, '⚠️ ' + esc(e.message)); }
    }
  } catch (e) { console.error(e); if (m?.chat?.id) await say(m.chat.id, '⚠️ Ошибка сервера: ' + esc(e.message)); }
  res.json({ ok: 1 });
}
