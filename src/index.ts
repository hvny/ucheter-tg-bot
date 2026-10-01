import 'dotenv/config';
import { logger } from './lib/logging/logger.js';
import { startExchangeRateJob } from './lib/services/exchange.js';
import { createBot } from './bot/bot.js';

const token = process.env.TG_BOT_TOKEN;
if (!token) {
  logger.fatal(
    { event: 'bot.config.invalid', field: 'TG_BOT_TOKEN' },
    'Не задан обязательный параметр',
  );
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  logger.fatal(
    { event: 'bot.config.invalid', field: 'DATABASE_URL' },
    'Не задан обязательный параметр',
  );
  process.exit(1);
}

const bot = createBot(token);
const exchangeRateJob = startExchangeRateJob();

try {
  await bot.api.setMyCommands([
    { command: 'menu', description: 'Меню' },
    { command: 'add', description: 'Добавить расход или доход' },
    { command: 'history', description: 'История операций' },
    { command: 'stats', description: 'Статистика' },
    { command: 'categories', description: 'Категории' },
    { command: 'export', description: 'Экспорт в Excel' },
    { command: 'cancel', description: 'Отменить текущий диалог' },
  ]);
} catch (error) {
  logger.fatal(
    { event: 'bot.start.failed', stage: 'set-commands', err: error },
    'Не удалось запустить бота',
  );
  await exchangeRateJob.destroy();
  process.exit(1);
}

void bot
  .start({
    onStart: (botInfo) => {
      logger.info({ event: 'bot.started', botUsername: botInfo.username }, 'Бот запущен');
    },
  })
  .catch(async (error: unknown) => {
    logger.fatal({ event: 'bot.polling.failed', err: error }, 'Опрос Telegram остановился');
    await exchangeRateJob.destroy();
    process.exit(1);
  });

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ event: 'bot.stopping', signal }, 'Останавливаю бота');
  await exchangeRateJob.destroy();
  if (bot.isRunning()) await bot.stop();
  logger.info({ event: 'bot.stopped' }, 'Бот остановлен');
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT').catch(fatalError));
process.once('SIGTERM', () => void shutdown('SIGTERM').catch(fatalError));

function fatalError(error: unknown): void {
  logger.fatal({ event: 'process.failed', err: error }, 'Необработанная ошибка процесса');
  process.exit(1);
}
process.on('unhandledRejection', fatalError);
process.on('uncaughtException', fatalError);
