import { tr } from '../i18n/index.js';
import type { OperationType } from '../../db/schema.js';

export const DEFAULT_CATEGORIES: Record<OperationType, string[]> = {
  get expense() {
    return [
      tr('index-message-1'),
      tr('index-message-2'),
      tr('index-message-3'),
      tr('index-message-4'),
      tr('index-message-5'),
      tr('index-message-6'),
      tr('index-message-7'),
      tr('index-message-8'),
    ];
  },
  get income() {
    return [
      tr('index-message-9'),
      tr('index-message-10'),
      tr('index-message-11'),
      tr('index-message-8'),
    ];
  },
};

export const OPERATION_TYPE_LABELS: Record<OperationType, string> = {
  get expense() {
    return tr('index-message-12');
  },
  get income() {
    return tr('index-message-13');
  },
};

export const OPERATION_TYPE_EMOJI: Record<OperationType, string> = {
  expense: '📉',
  income: '📈',
};

export const BUTTONS = {
  get expense() {
    return tr('index-message-14');
  },
  get income() {
    return tr('index-message-15');
  },
  get newCategory() {
    return tr('index-message-16');
  },
  get skip() {
    return tr('index-message-17');
  },
  get cancel() {
    return tr('edit-message-10');
  },
  get backToMenu() {
    return tr('index-message-18');
  },
  get add() {
    return tr('index-message-19');
  },
  get history() {
    return tr('index-message-20');
  },
  get stats() {
    return tr('index-message-21');
  },
  get categories() {
    return tr('index-message-22');
  },
  get export() {
    return tr('index-message-23');
  },
} as const;

export const CALLBACKS = {
  cancel: 'cancel',
  skip: 'skip',
  newCategory: 'new_category',
  menuBack: 'menu:back',
  menuAdd: 'menu:add',
  menuHistory: 'menu:history',
  menuStats: 'menu:stats',
  menuCategories: 'menu:categories',
  menuExport: 'menu:export',
  todo: 'todo',
} as const;

export const MAX_CATEGORY_NAME_LENGTH = 64;
export const MAX_COMMENT_LENGTH = 500;
export const MAX_AMOUNT = 999_999_999;
