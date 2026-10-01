import type { Context } from 'grammy';
import { logger, safeError } from '../lib/logging/logger.js';

/** Used where a failed Telegram UI operation is recoverable. Never logs request payloads. */
export function logTelegramFailure(ctx: Context, method: string): (error: unknown) => void {
  return (error) => {
    const details = safeError(error);
    const fields = {
      event: 'telegram.request.failed',
      method,
      updateId: ctx.update?.update_id,
      err: error,
    };
    if (['not-modified', 'already-deleted', 'callback-expired'].includes(details.code)) {
      logger.debug(fields, 'Ожидаемая ошибка Telegram');
    } else {
      logger.warn(fields, 'Не удалось выполнить запрос Telegram');
    }
  };
}

export function updateKind(ctx: Context): string {
  if (ctx.callbackQuery) return 'callback';
  const command = ctx.message?.text?.match(
    /^\/(start|menu|add|history|stats|categories|export|cancel)(?:@[A-Za-z0-9_]+)?(?:\s|$)/,
  )?.[1];
  return command ? `command.${command}` : ctx.message ? 'message' : 'other';
}
