import { tr } from '../../lib/i18n/index.js';
import { backToMenuKeyboard, sectionKeyboard } from './menu.js';
import { InlineKeyboard, InputFile, type Context } from 'grammy';
import XLSX from 'xlsx-js-style';
import { BUTTONS, CALLBACKS, OPERATION_TYPE_LABELS } from '../../lib/constants/index.js';
import { listAllTransactions } from '../../lib/services/transactions.js';
import { formatDate } from '../../lib/utils/date.js';
import { getPeriodStart, PERIOD_LABELS, type Period } from '../../lib/utils/period.js';

const PERIOD_CODES: Record<Period, string> = { all: 'a', week: 'w', month: 'm' };
const PERIOD_FROM_CODE: Record<string, Period> = { a: 'all', w: 'week', m: 'month' };

export const EXPORT_PATTERN = /^exp:(a|w|m)$/;
export const EXPORT_CLOSE_CALLBACK = 'exp:close';

export function decodeExportPeriod(match: RegExpMatchArray): Period {
  return PERIOD_FROM_CODE[match[1]!]!;
}

/** Экран выбора периода перед выгрузкой. */
export function renderExportMenu(fromMenu = true): { text: string; keyboard: InlineKeyboard } {
  const keyboard = new InlineKeyboard();
  (['week', 'month', 'all'] as const).forEach((period) => {
    keyboard.text(PERIOD_LABELS[period], `exp:${PERIOD_CODES[period]}`);
  });
  keyboard.row().text(BUTTONS.backToMenu, CALLBACKS.menuBack);
  keyboard.row().text(tr('edit-message-10'), EXPORT_CLOSE_CALLBACK);
  return {
    text: tr('export-message-1'),
    keyboard: sectionKeyboard(keyboard, fromMenu),
  };
}

const HEADER_STYLE = {
  font: { bold: true, color: { rgb: 'FFFFFF' } },
  fill: { fgColor: { rgb: '4E79A7' } },
  alignment: { horizontal: 'center' },
} as const;

/** Строит .xlsx с операциями пользователя за период и возвращает его как Buffer. */
export async function buildExportWorkbook(userId: string, period: Period): Promise<Buffer> {
  const from = getPeriodStart(period);
  const items = await listAllTransactions(userId, from ? { from } : {});

  const header = [
    tr('export-message-2'),
    tr('edit-message-6'),
    tr('edit-message-7'),
    tr('edit-message-4'),
    tr('edit-message-5'),
    tr('edit-message-8'),
  ];
  const rows = items.map((t) => [
    formatDate(t.createdAt),
    OPERATION_TYPE_LABELS[t.type],
    t.categoryName ?? tr('edit-message-2'),
    Number(t.amount) * (t.type === 'expense' ? -1 : 1),
    t.currency,
    t.comment ?? '',
  ]);

  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  sheet['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 22 }, { wch: 12 }, { wch: 10 }, { wch: 32 }];
  for (let col = 0; col < header.length; col++) {
    const address = XLSX.utils.encode_cell({ r: 0, c: col });
    const cell = sheet[address];
    if (cell) cell.s = HEADER_STYLE;
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, tr('export-message-3'));

  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
}

/** Генерирует файл и отправляет его документом в чат. */
export async function sendExport(
  ctx: Context,
  userId: string,
  period: Period,
  fromMenu = true,
): Promise<void> {
  const buffer = await buildExportWorkbook(userId, period);
  const filename = `ucheter-${period}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  await ctx.replyWithDocument(new InputFile(buffer, filename), {
    caption: tr('export-message-4', { v0: PERIOD_LABELS[period] }),
    reply_markup: fromMenu
      ? backToMenuKeyboard()
      : new InlineKeyboard().text(tr('categories-message-7'), EXPORT_CLOSE_CALLBACK),
  });
}
