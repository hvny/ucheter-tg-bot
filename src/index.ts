import 'dotenv/config';
import { createBot } from './bot/bot.js';

const token = process.env.TG_BOT_TOKEN;
if (!token) {
  throw new Error('TG_BOT_TOKEN не задан в .env');
}
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL не задан в .env');
}

const bot = createBot(token);

void bot.start({
  onStart: (botInfo) => {
    console.log(`Бот @${botInfo.username} запущен`);
  },
});
