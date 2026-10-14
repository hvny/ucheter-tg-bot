import { InlineKeyboard, type Context } from 'grammy';
import { tr } from '../../lib/i18n/index.js';
import { logger } from '../../lib/logging/logger.js';

function configuredUrl(field: string, telegram = false): string | undefined {
  const value = process.env[field]?.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      (telegram && (url.protocol !== 'https:' || url.hostname !== 't.me' || url.pathname === '/'))
    )
      throw new Error('Invalid URL');
    return url.href;
  } catch {
    logger.warn({ event: 'bot.config.invalid', field }, 'Некорректная ссылка разработчика');
    return undefined;
  }
}
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
export async function handleAbout(ctx: Context): Promise<void> {
  const website = configuredUrl('DEVELOPER_WEBSITE_URL');
  const contact = configuredUrl('DEVELOPER_CONTACT_BOT_URL', true);
  const text = [escapeHtml(tr('about-text'))];
  if (website)
    text.push(`<a href="${escapeHtml(website)}">${escapeHtml(tr('about-developer'))}</a>`);
  await ctx.reply(text.join('\n\n'), {
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...(contact ? { reply_markup: new InlineKeyboard().url(tr('about-contact'), contact) } : {}),
  });
}
