# Садовест — Telegram Mini App + бот

Mini App (уроки, VIP, промокоды, огород и календарь полива, поддержка, игры, профиль, админ-панель) и Telegram-бот на одном проекте Vercel. Зависимостей нет, сборка не нужна.

## Структура
- `public/index.html` — приложение (интерфейс)
- `api/rpc.js` — API приложения (проверка подписи Telegram, уроки, промокоды, тикеты, админка)
- `api/bot.js` — вебхук бота (/start /help /vip /support /profile /promo + админ-команды)
- `api/setup.js` — одноразовая настройка вебхука и кнопки меню
- `api/cron.js` — ежедневные напоминания (полив, истечение VIP)
- `lib/lessons.js` — тексты уроков (5 бесплатных + 95 VIP, VIP-тексты замените на свои)

## Запуск
1. @BotFather → /newbot → получите BOT_TOKEN.
2. Залейте проект в GitHub (новый репозиторий, загрузите все файлы из папки).
3. vercel.com → Add New → Project → выберите репозиторий → Framework Preset: Other → Deploy.
4. В проекте: Storage → Create/Connect → Upstash Redis (Marketplace). Переменные базы добавятся сами.
5. Settings → Environment Variables: BOT_TOKEN, ADMIN_IDS, WEBHOOK_SECRET, CRON_SECRET (= WEBHOOK_SECRET), COMMUNITY_URL, BUY_URL.
6. Deployments → Redeploy.
7. Откройте в браузере один раз: https://ВАШ-ПРОЕКТ.vercel.app/api/setup?key=ВАШ_WEBHOOK_SECRET
8. В Telegram напишите боту /start и нажмите «Открыть Садовест».

## Админ
Ваш Telegram ID в ADMIN_IDS. В приложении появится «Панель администратора». В боте:
/grant ID дни, /newpromo КОД тип(vip|coins|discount) значение лимит дни, /stats, /reply ID текст.
