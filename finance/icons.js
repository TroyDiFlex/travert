const FALLBACK_ICON_ID = 'local:circle';

function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .trim()
    .replace(/\s+/g, ' ');
}

// Каталог локальных SVG-иконок категорий. Стиль единый: контур 24x24,
// stroke currentColor. Тело хранится без обертки <svg>, цвет задается
// категорией при отрисовке. Каталог работает офлайн и растет до 150+.
const ICON_DEFINITIONS = [
  // Еда
  { id: 'local:basket', group: 'Еда', label: 'Продукты', keywords: ['продукты', 'еда', 'магазин', 'супермаркет', 'лавка'], body: '<path d="M4 10h16l-1.5 9a2 2 0 0 1-2 1.7h-9A2 2 0 0 1 5.5 19L4 10Z"/><path d="M8 10l3-6 2 4 3-4 2 6"/><path d="M9.5 14v3M14.5 14v3"/>' },
  { id: 'local:apple', group: 'Еда', label: 'Фрукты', keywords: ['фрукты', 'яблоко', 'овощи', 'витамины'], body: '<path d="M12 8c-4-2-8 1-8 6 0 4 3 7 5 7 1 0 2-1 3-1s2 1 3 1c2 0 5-3 5-7 0-5-4-8-8-6Z"/><path d="M12 8c0-3 2-5 5-5"/>' },
  { id: 'local:bread', group: 'Еда', label: 'Хлеб', keywords: ['хлеб', 'выпечка', 'пекарня', 'булка'], body: '<path d="M3 12a4 4 0 0 1 4-4h9a4 4 0 0 1 0 8H7a4 4 0 0 1-4-4Z"/><path d="M8 12h.01M12 12h.01M10 15h.01"/>' },
  { id: 'local:coffee', group: 'Еда', label: 'Кофе', keywords: ['кофе', 'чай', 'кафе', 'напитки', 'кофейня'], body: '<path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Z"/><path d="M17 10h2a2 2 0 0 1 0 4h-2"/><path d="M8 5c0-1 1-1 1-2M12 5c0-1 1-1 1-2"/>' },
  { id: 'local:restaurant', group: 'Еда', label: 'Рестораны', keywords: ['ресторан', 'кафе', 'обед', 'ужин', 'общепит', 'столовая'], body: '<path d="M7 3v6a2 2 0 0 0 2 2v10M7 3v3M11 3v3M7 6h4"/><path d="M17 3c-1.5 2-2 5-2 8v2h2v8"/>' },
  { id: 'local:cake', group: 'Еда', label: 'Сладости', keywords: ['сладости', 'торт', 'десерт', 'конфеты', 'пирожное'], body: '<path d="M5 13h14v7H5z"/><path d="M5 13c0-2 2-2 2-4a2 2 0 0 1 4 0c0 2 2 2 2 4"/><path d="M12 9V6"/>' },
  // Дом
  { id: 'local:home', group: 'Дом', label: 'Дом', keywords: ['дом', 'квартира', 'жилье', 'аренда', 'ипотека'], body: '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-6h4v6"/>' },
  { id: 'local:sofa', group: 'Дом', label: 'Мебель', keywords: ['мебель', 'диван', 'интерьер', 'кресло'], body: '<path d="M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3"/><path d="M3 13a2 2 0 0 1 4 0v1h10v-1a2 2 0 0 1 4 0v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3Z"/><path d="M5 18v2M19 18v2"/>' },
  { id: 'local:lamp', group: 'Дом', label: 'Свет', keywords: ['свет', 'лампа', 'люстра', 'электрика'], body: '<path d="M9 3h6l3 7H6l3-7Z"/><path d="M12 10v8"/><path d="M9 21h6"/>' },
  { id: 'local:wrench', group: 'Дом', label: 'Ремонт', keywords: ['ремонт', 'инструменты', 'мастер', 'сантехник'], body: '<path d="M14.5 6.5a4 4 0 0 0-5.6 4.8L4 16.2V20h3.8l4.9-4.9a4 4 0 0 0 4.8-5.6l-2.7 2.7-2.3-.7-.7-2.3 2.7-2.7Z"/>' },
  { id: 'local:droplet', group: 'Дом', label: 'Коммуналка', keywords: ['коммуналка', 'вода', 'жкх', 'сантехника', 'отопление'], body: '<path d="M12 3s6 6.3 6 11a6 6 0 0 1-12 0c0-4.7 6-11 6-11Z"/>' },
  { id: 'local:bolt', group: 'Дом', label: 'Электричество', keywords: ['электричество', 'энергия', 'свет', 'газ'], body: '<path d="M13 2L5 13h5l-1 9 8-11h-5l1-9Z"/>' },
  // Покупки
  { id: 'local:cart', group: 'Покупки', label: 'Покупки', keywords: ['покупки', 'тележка', 'магазин', 'шопинг'], body: '<path d="M3 4h2l2.5 12h11L21 8H7"/><circle cx="9.5" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/>' },
  { id: 'local:bag', group: 'Покупки', label: 'Заказы', keywords: ['заказы', 'товары', 'посылки', 'маркетплейс', 'сумка'], body: '<path d="M6 8h12l-1 12H7L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>' },
  { id: 'local:shirt', group: 'Покупки', label: 'Одежда', keywords: ['одежда', 'обувь', 'вещи', 'гардероб', 'футболка'], body: '<path d="M9 4L3 7l2 4 2-1v10h10V10l2 1 2-4-6-3a3 3 0 0 1-6 0Z"/>' },
  { id: 'local:gift', group: 'Покупки', label: 'Подарки', keywords: ['подарки', 'праздник', 'сувениры', 'поздравление'], body: '<rect x="4" y="9" width="16" height="4"/><path d="M6 13v8h12v-8"/><path d="M12 9v12"/><path d="M12 9S8 9 6.5 7.5 8 4 10 5.5 12 9 12 9Zm0 0s4 0 5.5-1.5S16 4 14 5.5 12 9 12 9Z"/>' },
  { id: 'local:tag', group: 'Покупки', label: 'Скидки', keywords: ['скидки', 'цены', 'распродажа', 'ценник', 'акция'], body: '<path d="M3 12V4h8l9 9-8 8-9-9Z"/><circle cx="8" cy="9" r="1.4"/>' },
  { id: 'local:truck', group: 'Покупки', label: 'Доставка', keywords: ['доставка', 'курьер', 'посылки', 'перевозка'], body: '<path d="M2 6h13v10H2z"/><path d="M15 10h4l3 3v3h-7"/><circle cx="6.5" cy="18.5" r="1.6"/><circle cx="17.5" cy="18.5" r="1.6"/>' },
  // Транспорт
  { id: 'local:car', group: 'Транспорт', label: 'Авто', keywords: ['авто', 'машина', 'такси', 'каршеринг', 'автомобиль'], body: '<path d="M5 12l1.5-4.5A2 2 0 0 1 8.4 6h7.2a2 2 0 0 1 1.9 1.5L19 12"/><rect x="4" y="12" width="16" height="6" rx="1.5"/><circle cx="8" cy="18.5" r="1.6"/><circle cx="16" cy="18.5" r="1.6"/>' },
  { id: 'local:bus', group: 'Транспорт', label: 'Автобус', keywords: ['автобус', 'маршрутка', 'проезд', 'общественный'], body: '<rect x="4" y="4" width="16" height="13" rx="2"/><path d="M4 11h16"/><circle cx="8" cy="19.5" r="1.5"/><circle cx="16" cy="19.5" r="1.5"/>' },
  { id: 'local:train', group: 'Транспорт', label: 'Поезд', keywords: ['поезд', 'метро', 'электричка', 'жд'], body: '<rect x="6" y="3" width="12" height="14" rx="3"/><path d="M6 10h12M9 13.5h.01M15 13.5h.01M8 20l-2 2M16 20l2 2"/>' },
  { id: 'local:fuel', group: 'Транспорт', label: 'Топливо', keywords: ['бензин', 'топливо', 'азс', 'заправка', 'дизель'], body: '<path d="M5 21V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15"/><path d="M4 21h12"/><path d="M15 10h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V9l-2-2"/><path d="M7 8h6"/>' },
  { id: 'local:plane', group: 'Транспорт', label: 'Авиа', keywords: ['самолет', 'авиа', 'перелет', 'аэропорт'], body: '<path d="M21 3L10 14"/><path d="M21 3l-7 18-4-7-7-4 18-7Z"/>' },
  { id: 'local:bike', group: 'Транспорт', label: 'Велосипед', keywords: ['велосипед', 'самокат', 'байк'], body: '<circle cx="6" cy="16" r="4"/><circle cx="18" cy="16" r="4"/><path d="M6 16l4-8h5l3 8M10 8H7M15 8l-2-4h3"/>' },
  // Здоровье
  { id: 'local:heart', group: 'Здоровье', label: 'Здоровье', keywords: ['здоровье', 'врач', 'пульс', 'медицина', 'сердце'], body: '<path d="M12 20s-7-4.5-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.5-9 9-9 9Z"/>' },
  { id: 'local:pill', group: 'Здоровье', label: 'Аптека', keywords: ['аптека', 'лекарства', 'таблетки', 'препараты'], body: '<rect x="3.5" y="8.5" width="17" height="7" rx="3.5" transform="rotate(-45 12 12)"/><path d="M8.5 8.5l7 7"/>' },
  { id: 'local:aid', group: 'Здоровье', label: 'Врач', keywords: ['врач', 'больница', 'клиника', 'анализы', 'поликлиника'], body: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>' },
  { id: 'local:dumbbell', group: 'Здоровье', label: 'Спорт', keywords: ['спорт', 'фитнес', 'зал', 'тренировки'], body: '<path d="M7 8v8M17 8v8M4 10v4M20 10v4M7 12h10"/>' },
  { id: 'local:tooth', group: 'Здоровье', label: 'Стоматолог', keywords: ['стоматолог', 'зубы', 'дантист'], body: '<path d="M7 3c-2 0-3 2-3 4 0 4 2 5 2.5 9 .2 1.6.7 5 2 5 1.6 0 1-4.5 3.5-4.5s1.9 4.5 3.5 4.5c1.3 0 1.8-3.4 2-5 .5-4 2.5-5 2.5-9 0-2-1-4-3-4-1.5 0-2.5 1-5 1s-3.5-1-5-1Z"/>' },
  { id: 'local:glasses', group: 'Здоровье', label: 'Оптика', keywords: ['очки', 'оптика', 'зрение', 'линзы'], body: '<circle cx="7" cy="14" r="3.5"/><circle cx="17" cy="14" r="3.5"/><path d="M10.5 14h3M3.5 14L2 8M20.5 14L22 8"/>' },
  // Образование
  { id: 'local:book', group: 'Образование', label: 'Книги', keywords: ['книги', 'учеба', 'чтение', 'курсы', 'литература'], body: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Z"/><path d="M4 19a2 2 0 0 1 2-2h13"/>' },
  { id: 'local:cap', group: 'Образование', label: 'Учеба', keywords: ['университет', 'школа', 'экзамен', 'диплом', 'институт'], body: '<path d="M2 9l10-5 10 5-10 5-10-5Z"/><path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5"/><path d="M22 9v5"/>' },
  { id: 'local:pen', group: 'Образование', label: 'Канцелярия', keywords: ['канцелярия', 'ручки', 'тетради', 'офис'], body: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1Z"/><path d="M14.5 6.5l3 3"/>' },
  { id: 'local:globe', group: 'Образование', label: 'Языки', keywords: ['языки', 'английский', 'география', 'репетитор'], body: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14 0 18M12 3c-3 3.5-3 14 0 18"/>' },
  { id: 'local:palette', group: 'Образование', label: 'Творчество', keywords: ['творчество', 'рисование', 'хобби', 'дизайн', 'краски'], body: '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 1.5-2-.5-1.2.3-2.5 1.7-2.5H17a4 4 0 0 0 4-4c0-5-4.5-9.5-9-9.5Z"/><circle cx="8" cy="10" r="1"/><circle cx="12" cy="8" r="1"/><circle cx="16" cy="10" r="1"/>' },
  { id: 'local:music', group: 'Образование', label: 'Музыка', keywords: ['музыка', 'уроки', 'инструмент', 'гитара', 'пианино'], body: '<circle cx="7" cy="18" r="3"/><circle cx="17" cy="16" r="3"/><path d="M10 18V5l10-2v11"/>' },
  // Работа
  { id: 'local:briefcase', group: 'Работа', label: 'Работа', keywords: ['работа', 'бизнес', 'офис', 'дело'], body: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>' },
  { id: 'local:laptop', group: 'Работа', label: 'Техника', keywords: ['ноутбук', 'компьютер', 'техника', 'гаджеты', 'планшет'], body: '<rect x="4" y="4" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>' },
  { id: 'local:phone', group: 'Работа', label: 'Связь', keywords: ['телефон', 'связь', 'мобильная', 'смартфон'], body: '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18.5h2"/>' },
  { id: 'local:wifi', group: 'Работа', label: 'Интернет', keywords: ['интернет', 'wifi', 'провайдер', 'вайфай', 'сеть'], body: '<path d="M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="19" r="1.2"/>' },
  { id: 'local:printer', group: 'Работа', label: 'Печать', keywords: ['печать', 'принтер', 'документы', 'ксерокс'], body: '<path d="M7 8V3h10v5"/><rect x="4" y="8" width="16" height="8" rx="2"/><rect x="7" y="14" width="10" height="7"/>' },
  { id: 'local:idcard', group: 'Работа', label: 'Документы', keywords: ['документы', 'паспорт', 'госуслуги', 'справки', 'виза'], body: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="11" r="2"/><path d="M5.5 16a3 3 0 0 1 6 0M14 9.5h5M14 13h5"/>' },
  // Путешествия
  { id: 'local:suitcase', group: 'Путешествия', label: 'Путешествия', keywords: ['путешествия', 'отпуск', 'чемодан', 'поездка', 'отель'], body: '<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M4 13h16"/>' },
  { id: 'local:tent', group: 'Путешествия', label: 'Природа', keywords: ['палатка', 'кемпинг', 'природа', 'дача', 'поход'], body: '<path d="M12 4L3 20h18L12 4Z"/><path d="M12 12l-3.5 8M12 12l3.5 8"/>' },
  { id: 'local:map', group: 'Путешествия', label: 'Карты', keywords: ['карта', 'навигация', 'маршрут', 'такси'], body: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>' },
  { id: 'local:compass', group: 'Путешествия', label: 'Походы', keywords: ['компас', 'поход', 'туризм', 'треккинг'], body: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-2 5-4 1 2-5 4-1Z"/>' },
  { id: 'local:camera', group: 'Путешествия', label: 'Фото', keywords: ['фото', 'камера', 'фотографии', 'снимки'], body: '<path d="M4 8h3l2-2h6l2 2h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="14" r="3.5"/>' },
  { id: 'local:ticket', group: 'Путешествия', label: 'Билеты', keywords: ['билеты', 'вокзал', 'аэропорт', 'проезд'], body: '<path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8Z"/><path d="M13 6v2M13 11v2M13 16v2"/>' },
  // Развлечения
  { id: 'local:gamepad', group: 'Развлечения', label: 'Игры', keywords: ['игры', 'гейминг', 'приставка', 'видеоигры'], body: '<path d="M7 8h10a5 5 0 0 1 5 5c0 3-2 5-4 5-1.5 0-2.5-.8-3.5-2h-5c-1 1.2-2 2-3.5 2-2 0-4-2-4-5a5 5 0 0 1 5-5Z"/><path d="M8 11v4M6 13h4M16 12h.01M18 14h.01"/>' },
  { id: 'local:film', group: 'Развлечения', label: 'Кино', keywords: ['кино', 'фильмы', 'кинотеатр'], body: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16M16 4v16M3 9h5M3 15h5M16 9h5M16 15h5"/>' },
  { id: 'local:tv', group: 'Развлечения', label: 'Подписки', keywords: ['подписки', 'сервисы', 'стриминг', 'сериалы', 'телевизор'], body: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M9 21h6"/>' },
  { id: 'local:mic', group: 'Развлечения', label: 'Концерты', keywords: ['концерты', 'караоке', 'музыка', 'шоу'], body: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4"/>' },
  { id: 'local:ball', group: 'Развлечения', label: 'Мяч', keywords: ['футбол', 'мяч', 'матчи', 'баскетбол', 'волейбол'], body: '<circle cx="12" cy="12" r="9"/><path d="M12 8l2.8 2-1 3.2h-3.6l-1-3.2 2.8-2Z"/><path d="M12 3v5M4.5 9.5L9 10.5M19.5 9.5L15 10.5M7 20l2-3.5M17 20l-2-3.5"/>' },
  { id: 'local:party', group: 'Развлечения', label: 'Праздники', keywords: ['праздник', 'вечеринка', 'день рождения', 'торжество'], body: '<path d="M6 14L13 3l3 2-7 11-3-2Z"/><path d="M6 14c-1 1-1 3 0 4s3 1 4 0M15 8l4-2M16.5 11.5L20 12M14 5l1-3"/>' },
  // Финансы
  { id: 'local:wallet', group: 'Финансы', label: 'Кошелек', keywords: ['кошелек', 'деньги', 'наличные', 'портмоне'], body: '<path d="M3 7a2 2 0 0 1 2-2h14a1 1 0 0 1 1 1v2"/><path d="M3 7v10a2 2 0 0 0 2 2h16V9H5a2 2 0 0 1-2-2Z"/><circle cx="17" cy="14" r="1.2"/>' },
  { id: 'local:bank', group: 'Финансы', label: 'Банк', keywords: ['банк', 'счет', 'вклад', 'кредит'], body: '<path d="M3 9l9-6 9 6"/><path d="M4 9v10M20 9v10M8 12v5M12 12v5M16 12v5M2 21h20"/>' },
  { id: 'local:card', group: 'Финансы', label: 'Карта', keywords: ['карта', 'безнал', 'оплата', 'банковская'], body: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>' },
  { id: 'local:percent', group: 'Финансы', label: 'Налоги', keywords: ['налоги', 'проценты', 'комиссия', 'кэшбэк', 'ставка'], body: '<path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>' },
  { id: 'local:shield', group: 'Финансы', label: 'Страховка', keywords: ['страховка', 'защита', 'осаго', 'полис'], body: '<path d="M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6l7-3Z"/><path d="M9 12l2 2 4-4"/>' },
  { id: 'local:piggy', group: 'Финансы', label: 'Копилка', keywords: ['копилка', 'накопления', 'сбережения', 'отложить'], body: '<path d="M4 13a7 6 0 0 1 12-4l3-3v4"/><path d="M4 13v4h3l1 2h2l1-2h4v-2"/><circle cx="17" cy="10" r="1"/>' },
  // Системная заглушка
  { id: FALLBACK_ICON_ID, group: 'Системные', label: 'Без иконки', keywords: ['без иконки', 'круг', 'точка', 'прочее'], body: '<circle cx="12" cy="12" r="8"/>' },
];

const ICONS_BY_ID = new Map(ICON_DEFINITIONS.map((icon) => [icon.id, icon]));

export const ICON_GROUPS = Object.freeze([...new Set(ICON_DEFINITIONS.map((icon) => icon.group))]);

export function iconCount() {
  return ICON_DEFINITIONS.length;
}

export function listIcons() {
  return ICON_DEFINITIONS.map(({ id, group, label }) => ({ id, group, label }));
}

export function getIcon(id) {
  return ICONS_BY_ID.get(id) ?? ICONS_BY_ID.get(FALLBACK_ICON_ID);
}

export function isKnownIcon(id) {
  return ICONS_BY_ID.has(id);
}

export function iconSvg(id) {
  const icon = getIcon(id);
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-icon="${icon.id}">${icon.body}</svg>`;
}

export function searchIcons(query) {
  const words = normalizeText(query).split(' ').filter(Boolean);
  const matches = ICON_DEFINITIONS.filter((icon) => {
    if (icon.id === FALLBACK_ICON_ID) return words.length === 0;
    if (words.length === 0) return true;
    const haystack = normalizeText(`${icon.label} ${icon.keywords.join(' ')} ${icon.id}`);
    return words.every((word) => haystack.includes(word));
  });
  return matches
    .map(({ id, group, label }) => ({ id, group, label }))
    .sort((left, right) => left.label.localeCompare(right.label, 'ru'));
}
