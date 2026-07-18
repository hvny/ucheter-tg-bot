import { InlineKeyboard } from 'grammy';
import { BUTTONS, CALLBACKS } from '../../lib/constants/index.js';

export const MENU_TEXT = '📋 Меню — что делаем?';

export function menuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(BUTTONS.add, CALLBACKS.menuAdd)
    .text(BUTTONS.history, CALLBACKS.menuHistory)
    .row()
    .text(BUTTONS.stats, CALLBACKS.menuStats)
    .text(BUTTONS.categories, CALLBACKS.menuCategories)
    .row()
    .text(BUTTONS.export, CALLBACKS.menuExport);
}
