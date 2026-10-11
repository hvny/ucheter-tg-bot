import { formatNotificationTime } from '../../lib/utils/time-zone.js';
import { setNotifications } from '../../lib/services/notifications.js';
import { menuKeyboard } from './menu.js';
import { parseStartPayload, currentLanguage, tr } from '../../lib/i18n/index.js';
import type { Context } from 'grammy';
import { registerUser, setUserLanguage } from '../../lib/services/users.js';

function commandsHelp(): string {
  return [
    tr('start-message-1'),
    tr('start-message-2'),
    tr('start-message-3'),
    tr('start-message-4'),
  ]
    .concat(tr('language-help'))
    .join('\n');
}

export async function handleStart(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const { user, isNew } = await registerUser(String(from.id), from.username, currentLanguage());
  const payload = parseStartPayload(typeof ctx.match === 'string' ? ctx.match : '');
  if (payload) await setUserLanguage(String(from.id), payload.language);
  let timeZoneNotice: string[] = [];
  if (payload?.timeZone && ctx.chat?.type === 'private') {
    // First-time setup enables the digest; an explicit previous opt-out stays off.
    const enabled = user.dailyNotifications || !user.timeZone;
    await setNotifications(String(from.id), enabled, payload.timeZone);
    timeZoneNotice = [
      '',
      tr(enabled ? 'daily-link-enabled' : 'daily-link-disabled', {
        v0: payload.timeZone,
        v1: formatNotificationTime(user.notificationTime),
      }),
    ];
  }

  if (isNew) {
    await ctx.reply(
      [
        tr('start-message-5', { v0: from.first_name ? `, ${from.first_name}` : '' }),
        '',
        tr('start-message-6'),
        tr('start-message-7'),
        '',
        commandsHelp(),
        ...timeZoneNotice,
      ].join('\n'),
      { reply_markup: menuKeyboard() },
    );
  } else {
    await ctx.reply([tr('start-message-8'), '', commandsHelp(), ...timeZoneNotice].join('\n'), {
      reply_markup: menuKeyboard(),
    });
  }
}
