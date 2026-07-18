import type { Context } from 'grammy';
import { registerUser } from '../../lib/services/users.js';

const COMMANDS_HELP = [
  '/add — добавить расход или доход',
  '/categories — категории',
  '/menu — меню',
  '/cancel — отменить текущий диалог',
].join('\n');

export async function handleStart(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const { isNew } = await registerUser(String(from.id), from.username);

  if (isNew) {
    await ctx.reply(
      [
        `Привет${from.first_name ? `, ${from.first_name}` : ''}! 👋`,
        '',
        'Я помогу вести учёт доходов и расходов.',
        'Я уже создал для тебя базовый набор категорий — посмотреть и дополнить: /categories',
        '',
        COMMANDS_HELP,
      ].join('\n'),
    );
  } else {
    await ctx.reply(['С возвращением! 👋', '', COMMANDS_HELP].join('\n'));
  }
}
