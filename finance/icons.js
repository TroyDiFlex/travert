// Локальный реестр иконок категорий расходов. Без CDN, работает офлайн.
// В данных хранится только стабильный iconId, SVG берётся отсюда.
export const CATEGORY_ICONS = [
  { id: 'local:basket', name: 'Продукты', synonyms: ['еда', 'магазин', 'супермаркет', 'grocery'], svg: '<path d="M4 9h16l-1.5 9.5a2 2 0 0 1-2 1.5h-9a2 2 0 0 1-2-1.5L4 9Z"/><path d="M8 9l3-5m5 5l-3-5M9.5 13v3m5-3v3"/>' },
  { id: 'local:cafe', name: 'Кафе', synonyms: ['кофе', 'ресторан', 'обед', 'ужин'], svg: '<path d="M5 9h12v5a5 5 0 0 1-5 5H9a4 4 0 0 1-4-4V9Z"/><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17M7 5c0 1 1 1 1 2m3-2c0 1 1 1 1 2"/>' },
  { id: 'local:transport', name: 'Транспорт', synonyms: ['автобус', 'метро', 'такси', 'проезд'], svg: '<rect x="4" y="4" width="16" height="12" rx="3"/><path d="M4 11h16M8 20l1-4m7 4l-1-4"/><circle cx="8.5" cy="13.5" r=".8"/><circle cx="15.5" cy="13.5" r=".8"/>' },
  { id: 'local:fuel', name: 'Топливо', synonyms: ['бензин', 'заправка', 'авто', 'машина'], svg: '<rect x="4" y="4" width="10" height="16" rx="2"/><path d="M7 8h4v4a2 2 0 0 1-4 0V8Z"/><path d="M14 10h2.5A1.5 1.5 0 0 1 18 11.5V18h-2"/>' },
  { id: 'local:home', name: 'Дом', synonyms: ['аренда', 'квартира', 'жильё', 'ипотека'], svg: '<path d="M4 11l8-6 8 6"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>' },
  { id: 'local:utilities', name: 'Коммуналка', synonyms: ['свет', 'вода', 'жкх', 'электричество'], svg: '<path d="M13 3L6 13h5l-1 8 7-10h-5l1-8Z"/>' },
  { id: 'local:health', name: 'Здоровье', synonyms: ['врач', 'больница', 'клиника'], svg: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10Z"/><path d="M12 8v5m-2.5-2.5h5"/>' },
  { id: 'local:pill', name: 'Аптека', synonyms: ['лекарства', 'таблетки'], svg: '<rect x="4" y="9" width="16" height="7" rx="3.5" transform="rotate(-35 12 12)"/><path d="M10.5 10.5l3 3"/>' },
  { id: 'local:education', name: 'Образование', synonyms: ['учёба', 'курсы', 'книги', 'школа'], svg: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v13H6.5A2.5 2.5 0 0 0 4 18.5V5.5Z"/><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20"/>' },
  { id: 'local:work', name: 'Работа', synonyms: ['офис', 'дело'], svg: '<rect x="3" y="7" width="18" height="12" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 12h18"/>' },
  { id: 'local:travel', name: 'Путешествия', synonyms: ['отпуск', 'самолёт', 'отель', 'поездка'], svg: '<path d="M10 20l-6-2 4-2 1-5-2-1 1-2 3 2 4-5 1 1-2 5 4 1-1 2-3-1-3 4-1 3Z"/>' },
  { id: 'local:film', name: 'Развлечения', synonyms: ['кино', 'игры', 'досуг'], svg: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 9h18M7 5v4m4-4v4m4-4v4"/>' },
  { id: 'local:shirt', name: 'Одежда', synonyms: ['обувь', 'вещи'], svg: '<path d="M9 4L4 7l2 3 2-1v11h8V9l2 1 2-3-5-3a3 3 0 0 1-6 0Z"/>' },
  { id: 'local:phone', name: 'Связь', synonyms: ['телефон', 'интернет', 'мобильная'], svg: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 18h2"/>' },
  { id: 'local:gift', name: 'Подарки', synonyms: ['праздник', 'день рождения'], svg: '<rect x="4" y="9" width="16" height="4"/><path d="M6 13v7h12v-7M12 9v11M12 9S7 9 5.5 7.5 8 4 9.5 5.5 12 9 12 9Zm0 0s5 0 6.5-1.5S16 4 14.5 5.5 12 9 12 9Z"/>' },
  { id: 'local:pets', name: 'Питомцы', synonyms: ['кот', 'собака', 'животные'], svg: '<circle cx="8" cy="9" r="1.4"/><circle cx="16" cy="9" r="1.4"/><circle cx="5" cy="13.5" r="1.2"/><circle cx="19" cy="13.5" r="1.2"/><path d="M12 11c2.5 0 4.5 2 4.5 4 0 1.5-1 2.5-2.3 2.5-.9 0-1.4-.4-2.2-.4s-1.3.4-2.2.4c-1.3 0-2.3-1-2.3-2.5 0-2 2-4 4.5-4Z"/>' },
  { id: 'local:kids', name: 'Дети', synonyms: ['ребёнок', 'школа', 'сад'], svg: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>' },
  { id: 'local:sport', name: 'Спорт', synonyms: ['фитнес', 'зал', 'тренировка'], svg: '<path d="M7 8v8M17 8v8M4 10v4m16-4v4M7 12h10"/>' },
  { id: 'local:beauty', name: 'Красота', synonyms: ['салон', 'стрижка', 'косметика'], svg: '<path d="M6 20l5-12 1.5 3L15 8l-3 12H6Z"/><path d="M15 4l1 1 2-1-1 2 1 1-2-1-1 2v-2l-2-1 2-1V4Z"/>' },
  { id: 'local:bank', name: 'Финансы', synonyms: ['банк', 'кредит', 'комиссия'], svg: '<path d="M4 9l8-5 8 5M4 9h16M6 9v9m4-9v9m4-9v9m4-9v9M3 20h18"/>' },
  { id: 'local:shield', name: 'Страховка', synonyms: ['страхование', 'защита'], svg: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z"/><path d="M9.5 12l2 2 3.5-4"/>' },
  { id: 'local:tools', name: 'Ремонт', synonyms: ['инструменты', 'стройка'], svg: '<path d="M14 6a4 4 0 0 1 5 5L11 19l-4-4 7-9Z"/><path d="M13 7l4 4"/>' },
  { id: 'local:savings', name: 'Накопления', synonyms: ['сбережения', 'копилка'], svg: '<rect x="4" y="8" width="16" height="11" rx="2"/><path d="M9 8V6a3 3 0 0 1 6 0v2M9 13h.01M12.5 13h.01M16 13h.01"/>' },
  { id: 'local:circle', name: 'Другое', synonyms: ['прочее', 'без категории', 'разное'], svg: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1"/>' },
];

const byId = new Map(CATEGORY_ICONS.map((icon) => [icon.id, icon]));

export function getCategoryIcon(iconId) {
  return byId.get(iconId) ?? byId.get('local:circle');
}

export function categoryIconSvg(iconId, cssClass = 'icon') {
  const icon = getCategoryIcon(iconId);
  return `<svg class="${cssClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon.svg}</svg>`;
}

export function searchCategoryIcons(query) {
  const normalized = String(query ?? '').trim().toLocaleLowerCase('ru-RU');
  if (!normalized) return [...CATEGORY_ICONS];
  return CATEGORY_ICONS.filter((icon) => {
    const haystack = [icon.name, ...(icon.synonyms ?? [])].join(' ').toLocaleLowerCase('ru-RU');
    return normalized.split(/\s+/).every((part) => haystack.includes(part));
  });
}
