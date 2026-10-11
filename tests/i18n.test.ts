import assert from 'node:assert/strict';
import { test } from 'node:test';
import ru from '../src/lib/i18n/ru.json' with { type: 'json' };
import en from '../src/lib/i18n/en.json' with { type: 'json' };
import {
  currentLanguage,
  i18n,
  normalizeLanguage,
  parseLanguagePayload,
  parseStartPayload,
  tr,
  withLanguage,
} from '../src/lib/i18n/index.js';
import { menuKeyboard, menuText } from '../src/bot/commands/menu.js';
import { OPERATION_TYPE_LABELS, DEFAULT_CATEGORIES } from '../src/lib/constants/index.js';
import { PERIOD_LABELS } from '../src/lib/utils/period.js';
import { formatAmount } from '../src/lib/utils/money.js';

const args = { v0: 'A', v1: 'B', v2: 'C', v3: 'D', v4: 'E' };

test('both catalogs contain all messages and compatible placeholders', () => {
  assert.deepEqual(Object.keys(ru).sort(), Object.keys(en).sort());
  for (const key of Object.keys(ru) as (keyof typeof ru)[]) {
    assert.deepEqual(ru[key].match(/\{ \$\w+ \}/g), en[key].match(/\{ \$\w+ \}/g));
    for (const language of ['ru', 'en'] as const) {
      const translated = i18n.t(language, key, args);
      assert.notEqual(translated, key);
      assert.ok(!translated.includes('{ $'));
      if (language === 'en')
        assert.ok(!/[А-Яа-яЁё]/.test(translated), `${key}: untranslated Russian`);
    }
  }
});

test('deep link parser accepts only supported lang payloads', () => {
  assert.equal(parseLanguagePayload('lang_en'), 'en');
  assert.equal(parseLanguagePayload('lang_ru'), 'ru');
  for (const value of ['', 'lang_de', 'en', 'lang_en_extra', 'lang=en'])
    assert.equal(parseLanguagePayload(value), undefined);
  assert.equal(normalizeLanguage('en-US'), 'en');
  assert.equal(normalizeLanguage('ru-RU'), 'ru');
});

test('menu, types, periods and defaults follow language at render time', () => {
  withLanguage('en', () => {
    assert.equal(menuText(), '📋 Menu — what would you like to do?');
    assert.equal(OPERATION_TYPE_LABELS.expense, 'Expense');
    assert.equal(PERIOD_LABELS.month, 'Month');
    assert.equal(DEFAULT_CATEGORIES.expense[0], 'Groceries');
    assert.ok(
      menuKeyboard()
        .inline_keyboard.flat()
        .some((b) => b.text === '🌐 Language'),
    );
    assert.equal(formatAmount(1234.5), '1,234.5');
  });
  assert.equal(currentLanguage(), 'ru');
  assert.equal(OPERATION_TYPE_LABELS.expense, 'Расход');
});

test('concurrent users keep independent languages and user content is preserved', async () => {
  const [russian, english] = await Promise.all([
    withLanguage('ru', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return tr('edit-message-12', { ...args, v3: 'My custom категория' });
    }),
    withLanguage('en', async () => {
      await Promise.resolve();
      return tr('edit-message-12', { ...args, v3: 'My custom категория' });
    }),
  ]);
  assert.ok(russian.includes('Комментарий:'));
  assert.ok(english.includes('Comment:'));
  for (const text of [russian, english]) assert.ok(text.includes('My custom категория'));
});

test('browser timezone start payloads decode safely and keep old links compatible', () => {
  const encode = (zone: string) => `lang_en_tz_${Buffer.from(zone).toString('base64url')}`;
  assert.deepEqual(parseStartPayload(encode('Europe/Belgrade')), {
    language: 'en',
    timeZone: 'Europe/Belgrade',
  });
  assert.equal(parseLanguagePayload(encode('Asia/Kathmandu')), 'en');
  assert.deepEqual(parseStartPayload('lang_ru'), { language: 'ru' });
  assert.equal(parseStartPayload(encode('Invalid/Zone')), undefined);
  assert.equal(parseStartPayload('lang_en_tz_!!!'), undefined);
  assert.equal(parseStartPayload('lang_en_tz_' + 'a'.repeat(64)), undefined);
  assert.equal(parseStartPayload(encode('Europe/Belgrade') + '='), undefined);
});
