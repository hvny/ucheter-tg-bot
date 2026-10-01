import { InlineKeyboard, InputFile, type Context } from 'grammy';
import XLSX from 'xlsx-js-style';
import { OPERATION_TYPE_LABELS } from '../../lib/constants/index.js';
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
export function renderExportMenu(): { text: string; keyboard: InlineKeyboard } {
  const keyboard = new InlineKeyboard();
  (['week', 'month', 'all'] as const).forEach((period) => {
    keyboard.text(PERIOD_LABELS[period], `exp:${PERIOD_CODES[period]}`);
  });
  keyboard.row().text('❌ Отмена', EXPORT_CLOSE_CALLBACK);
  return { text: '📤 За какой период выгрузить операции?', keyboard };
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

  const header = ['Дата', 'Тип', 'Категория', 'Сумма', 'Валюта', 'Комментарий'];
  const rows = items.map((t) => [
    formatDate(t.createdAt),
    OPERATION_TYPE_LABELS[t.type],
    t.categoryName ?? 'Без категории',
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
  XLSX.utils.book_append_sheet(workbook, sheet, 'Операции');

  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
}

/** Генерирует файл и отправляет его документом в чат. */
export async function sendExport(ctx: Context, userId: string, period: Period): Promise<void> {
  const buffer = await buildExportWorkbook(userId, period);
  const filename = `ucheter-${period}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  await ctx.replyWithDocument(new InputFile(buffer, filename), {
    caption: `📤 Экспорт операций · ${PERIOD_LABELS[period]}`,
  });
}
