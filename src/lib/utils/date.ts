import { currentLanguage } from '../i18n/index.js';
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat(currentLanguage() === 'en' ? 'en-GB' : 'ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}
