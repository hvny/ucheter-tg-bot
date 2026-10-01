import type { OperationType } from '../../db/schema.js';

export const DEFAULT_CATEGORIES: Record<OperationType, string[]> = {
  expense: [
    'Продукты',
    'Транспорт',
    'Жильё',
    'Кафе и рестораны',
    'Здоровье',
    'Развлечения',
    'Одежда',
    'Прочее',
  ],
  income: ['Зарплата', 'Подработка', 'Подарки', 'Прочее'],
};

export const OPERATION_TYPE_LABELS: Record<OperationType, string> = {
  expense: 'Расход',
  income: 'Доход',
};

export const OPERATION_TYPE_EMOJI: Record<OperationType, string> = {
  expense: '📉',
  income: '📈',
};

export const BUTTONS = {
  expense: '📉 Расход',
  income: '📈 Доход',
  newCategory: '➕ Новая категория',
  skip: '⏭ Пропустить',
  cancel: '❌ Отмена',
  backToMenu: '◀️ Назад в меню',
  add: '➕ Добавить',
  history: '📜 Просмотреть',
  stats: '📊 Статистика',
  categories: '🗂 Категории',
  export: '📤 Экспорт',
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
