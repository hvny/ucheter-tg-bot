import { AsyncLocalStorage } from 'node:async_hooks';
import { I18n, type I18nFlavor } from '@grammyjs/i18n';
import type { Context } from 'grammy';
import { createRequire } from 'node:module';
import type russianCatalog from './ru.json';
import type englishCatalog from './en.json';

// Load JSON without import attributes for Node runtimes that cannot parse `with`.
const require = createRequire(import.meta.url);
export const ru = require('./ru.json') as typeof russianCatalog;
export const en = require('./en.json') as typeof englishCatalog;

export type Language = 'ru' | 'en';
export type LocalizedContext = Context & I18nFlavor;
const languageContext = new AsyncLocalStorage<Language>();
export const currentLanguage = (): Language => languageContext.getStore() ?? 'ru';
export function withLanguage<T>(language: Language, task: () => T): T {
  return languageContext.run(language, task);
}
export function normalizeLanguage(value?: string): Language {
  return value?.toLowerCase().split('-')[0] === 'en' ? 'en' : 'ru';
}
/** Telegram start payloads accept only base64url-safe characters and up to 64 bytes. */
export function parseStartPayload(
  payload: string,
): { language: Language; timeZone?: string } | undefined {
  const value = payload.trim();
  if (value.length > 64) return undefined;
  const match = /^lang_(ru|en)(?:_tz_([A-Za-z0-9_-]+))?$/.exec(value);
  if (!match) return undefined;
  const language = match[1] as Language;
  if (!match[2]) return { language };
  const decoded = Buffer.from(match[2], 'base64url');
  if (decoded.toString('base64url') !== match[2]) return undefined;
  const timeZone = decoded.toString('utf8');
  // Preserve language handling for existing links that also carried a time zone.
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format();
    return { language, timeZone };
  } catch {
    return undefined;
  }
}
export function parseLanguagePayload(payload: string): Language | undefined {
  return parseStartPayload(payload)?.language;
}

export const i18n = new I18n<LocalizedContext>({
  defaultLocale: 'ru',
  localeNegotiator: () => currentLanguage(),
  fluentBundleOptions: { useIsolating: false },
});

// JSON catalogs compile into Fluent resources. Quotes preserve newlines and whitespace.
function fluentSource(messages: Record<string, string>): string {
  return Object.entries(messages)
    .map(([key, value]) => {
      const pattern = value
        .split(/(\{ \$\w+ \})/)
        .map((part) =>
          /^\{ \$\w+ \}$/.test(part)
            ? part
            : part
              ? `{ "${part.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\u000A').replace(/\r/g, '\\u000D')}" }`
              : '',
        )
        .join('');
      return `${key} = ${pattern}`;
    })
    .join('\n');
}
for (const [language, messages] of Object.entries({ ru, en }))
  i18n.loadLocaleSync(language, { source: fluentSource(messages) });
export function tr(key: keyof typeof ru, variables?: Record<string, string | number>): string {
  return i18n.t(currentLanguage(), key, variables);
}
