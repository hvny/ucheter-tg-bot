import 'dotenv/config';
import { startExchangeRateJob } from './lib/services/exchange.js';
import { createBot } from './bot/bot.js';

const token = process.env.TG_BOT_TOKEN;
if (!token) {
  throw new Error('TG_BOT_TOKEN не задан в .env');
}
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL не задан в .env');
}

const bot = createBot(token);
const exchangeRateJob = startExchangeRateJob();

await bot.api.setMyCommands([
  { command: 'menu', description: 'Меню' },
  { command: 'add', description: 'Добавить расход или доход' },
  { command: 'history', description: 'История операций' },
  { command: 'stats', description: 'Статистика' },
  { command: 'categories', description: 'Категории' },
  { command: 'export', description: 'Экспорт в Excel' },
  { command: 'cancel', description: 'Отменить текущий диалог' },
]);

void bot.start({
  onStart: (botInfo) => {
    console.log(`Бот @${botInfo.username} запущен`);
  },
});

async function shutdown(signal: string): Promise<void> {
  console.log(`Получен ${signal}, останавливаю бота...`);
  await exchangeRateJob.destroy();
  await bot.stop();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
