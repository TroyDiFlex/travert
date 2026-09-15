import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packageRoot = resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Передайте путь к распакованному lucide-static.');

const legacy = [
  ['local:basket', 'shopping-basket', 'Продукты', 'еда магазин супермаркет покупки'],
  ['local:cafe', 'coffee', 'Кафе', 'кофе ресторан обед ужин'],
  ['local:transport', 'bus-front', 'Транспорт', 'автобус метро такси проезд'],
  ['local:fuel', 'fuel', 'Топливо', 'бензин заправка авто машина'],
  ['local:home', 'house', 'Дом', 'аренда квартира жильё ипотека'],
  ['local:utilities', 'bolt', 'Коммунальные услуги', 'свет вода жкх электричество'],
  ['local:health', 'heart-plus', 'Здоровье', 'врач больница клиника медицина'],
  ['local:pill', 'pill', 'Аптека', 'лекарства таблетки'],
  ['local:education', 'graduation-cap', 'Образование', 'учёба курсы книги школа'],
  ['local:work', 'briefcase-business', 'Работа', 'офис дело бизнес'],
  ['local:travel', 'plane', 'Путешествия', 'отпуск самолёт отель поездка'],
  ['local:film', 'clapperboard', 'Развлечения', 'кино игры досуг'],
  ['local:shirt', 'shirt', 'Одежда', 'обувь вещи гардероб'],
  ['local:phone', 'smartphone', 'Связь', 'телефон интернет мобильная'],
  ['local:gift', 'gift', 'Подарки', 'праздник день рождения'],
  ['local:pets', 'paw-print', 'Питомцы', 'кот собака животные'],
  ['local:kids', 'baby', 'Дети', 'ребёнок школа сад'],
  ['local:sport', 'dumbbell', 'Спорт', 'фитнес зал тренировка'],
  ['local:beauty', 'sparkles', 'Красота', 'салон стрижка косметика'],
  ['local:bank', 'landmark', 'Финансы', 'банк кредит комиссия'],
  ['local:shield', 'shield-check', 'Страхование', 'страховка защита'],
  ['local:tools', 'wrench', 'Ремонт', 'инструменты стройка'],
  ['local:savings', 'piggy-bank', 'Накопления', 'сбережения копилка'],
  ['local:circle', 'circle', 'Другое', 'прочее без категории разное'],
];

const catalog = [
  ['shopping-cart', 'Тележка', 'магазин покупки'], ['shopping-bag', 'Покупки', 'магазин пакет'], ['store', 'Магазин', 'торговля'], ['package', 'Посылка', 'доставка заказ'],
  ['apple', 'Фрукты', 'яблоко еда'], ['banana', 'Фрукты и овощи', 'банан еда'], ['carrot', 'Овощи', 'еда продукты'], ['salad', 'Здоровая еда', 'салат продукты'],
  ['beef', 'Мясо', 'еда продукты'], ['fish', 'Рыба', 'еда продукты'], ['egg-fried', 'Завтрак', 'еда яйца'], ['milk', 'Молочные продукты', 'еда молоко'],
  ['pizza', 'Пицца', 'еда доставка'], ['sandwich', 'Перекус', 'еда'], ['soup', 'Обед', 'еда'], ['utensils', 'Ресторан', 'еда кафе'],
  ['utensils-crossed', 'Ресторан и кафе', 'еда ужин'], ['cake-slice', 'Десерты', 'еда торт'], ['ice-cream-cone', 'Мороженое', 'еда сладкое'], ['cookie', 'Сладости', 'еда печенье'],
  ['candy', 'Конфеты', 'еда сладости'], ['beer', 'Бар', 'напитки'], ['wine', 'Вино', 'напитки'], ['bottle-wine', 'Алкоголь', 'напитки'],
  ['car-front', 'Автомобиль', 'машина авто'], ['car-taxi-front', 'Такси', 'машина транспорт'], ['bus', 'Автобус', 'транспорт проезд'], ['train-front', 'Поезд', 'транспорт железная дорога'],
  ['tram-front', 'Трамвай', 'транспорт проезд'], ['bike', 'Велосипед', 'транспорт спорт'], ['scooter', 'Самокат', 'транспорт'], ['ship', 'Корабль', 'транспорт путешествия'],
  ['plane-takeoff', 'Вылет', 'самолёт путешествия'], ['plane-landing', 'Прилёт', 'самолёт путешествия'], ['baggage-claim', 'Багаж', 'чемодан путешествия'], ['luggage', 'Чемодан', 'багаж путешествия'],
  ['map', 'Маршрут', 'карта путешествия'], ['map-pin', 'Место', 'адрес геолокация'], ['compass', 'Поездка', 'маршрут путешествия'], ['tent-tree', 'Кемпинг', 'палатка отдых'],
  ['hotel', 'Отель', 'гостиница путешествия'], ['tree-palm', 'Отпуск', 'пляж путешествия'], ['umbrella', 'Пляж', 'отдых путешествия'], ['sun', 'Отдых', 'отпуск солнце'],
  ['bed-double', 'Жильё', 'квартира спальня'], ['sofa', 'Мебель', 'дом диван'], ['lamp-floor', 'Интерьер', 'дом свет'], ['washing-machine', 'Стирка', 'дом техника'],
  ['shower-head', 'Ванная', 'дом душ'], ['toilet', 'Сантехника', 'дом'], ['paint-roller', 'Отделка', 'ремонт краска'], ['hammer', 'Инструменты', 'ремонт молоток'],
  ['drill', 'Ремонтные работы', 'инструменты дрель'], ['brick-wall', 'Строительство', 'ремонт дом'], ['key-round', 'Аренда', 'ключ квартира'], ['building-2', 'Недвижимость', 'дом квартира'],
  ['zap', 'Электричество', 'коммунальные услуги свет'], ['droplet', 'Вода', 'коммунальные услуги'], ['flame', 'Газ и отопление', 'коммунальные услуги'], ['wifi', 'Интернет', 'связь коммунальные услуги'],
  ['heart-pulse', 'Медицина', 'здоровье пульс'], ['stethoscope', 'Врач', 'медицина здоровье'], ['hospital', 'Больница', 'медицина здоровье'], ['ambulance', 'Скорая помощь', 'медицина здоровье'],
  ['syringe', 'Процедуры', 'медицина здоровье'], ['bandage', 'Лечение', 'медицина здоровье'], ['pill-bottle', 'Лекарства', 'аптека здоровье'], ['toothbrush', 'Стоматология', 'зубы здоровье'],
  ['activity', 'Анализы', 'здоровье диагностика'], ['brain', 'Психология', 'здоровье терапия'], ['eye', 'Зрение', 'здоровье офтальмолог'], ['glasses', 'Очки', 'зрение здоровье'],
  ['book-open', 'Книги', 'образование чтение'], ['notebook-pen', 'Канцелярия', 'образование тетрадь'], ['pencil', 'Учёба', 'образование школа'], ['school', 'Школа', 'образование дети'],
  ['library-big', 'Библиотека', 'образование книги'], ['languages', 'Языки', 'образование курсы'], ['calculator', 'Математика', 'образование расчёты'], ['microscope', 'Наука', 'образование исследования'],
  ['briefcase', 'Бизнес', 'работа офис'], ['laptop', 'Компьютер', 'работа техника'], ['monitor', 'Рабочее место', 'работа компьютер'], ['printer', 'Печать', 'работа офис'],
  ['phone-call', 'Звонки', 'связь телефон'], ['mail', 'Почта', 'связь работа'], ['calendar-days', 'Сервисы', 'подписка календарь'], ['credit-card', 'Подписки', 'оплата карта'],
  ['film', 'Кино', 'развлечения'], ['music', 'Музыка', 'развлечения'], ['headphones', 'Аудио', 'музыка развлечения'], ['gamepad-2', 'Игры', 'развлечения'],
  ['dices', 'Настольные игры', 'развлечения'], ['ticket', 'Билеты', 'развлечения концерт'], ['theater', 'Театр', 'развлечения'], ['camera', 'Фото', 'развлечения хобби'],
  ['palette', 'Творчество', 'развлечения хобби'], ['party-popper', 'Праздник', 'развлечения вечеринка'], ['sparkles', 'Событие', 'праздник развлечения'], ['tv', 'Телевидение', 'развлечения подписка'],
  ['shopping-basket', 'Корзина продуктов', 'еда магазин'], ['sport-shoe', 'Обувь', 'одежда спорт'], ['watch', 'Аксессуары', 'одежда часы'], ['gem', 'Украшения', 'одежда драгоценности'],
  ['crown', 'Премиум', 'покупки роскошь'], ['scissors', 'Парикмахерская', 'красота стрижка'], ['flower-2', 'Уход', 'красота цветы'], ['shirt', 'Гардероб', 'одежда вещи'],
  ['cat', 'Кошка', 'питомцы животные'], ['dog', 'Собака', 'питомцы животные'], ['bird', 'Птица', 'питомцы животные'], ['rabbit', 'Кролик', 'питомцы животные'],
  ['turtle', 'Другие питомцы', 'животные'], ['fish-symbol', 'Аквариум', 'рыбы питомцы'], ['birdhouse', 'Товары для животных', 'питомцы'], ['bone', 'Корм', 'собака питомцы'],
  ['toy-brick', 'Игрушки', 'дети ребёнок'], ['baby', 'Малыш', 'дети ребёнок'], ['backpack', 'Школьные товары', 'дети школа'], ['book-heart', 'Развитие детей', 'дети книги'],
  ['dumbbell', 'Фитнес', 'спорт тренировка'], ['biceps-flexed', 'Тренажёрный зал', 'спорт фитнес'], ['volleyball', 'Игровой спорт', 'мяч тренировка'], ['medal', 'Соревнования', 'спорт награда'],
  ['trophy', 'Спортивные события', 'спорт награда'], ['footprints', 'Ходьба', 'спорт прогулка'], ['timer', 'Кардио', 'спорт время'], ['gauge', 'Активность', 'спорт здоровье'],
  ['gift', 'Подарок', 'праздник'], ['cake', 'День рождения', 'праздник торт'], ['balloon', 'Праздники', 'вечеринка'], ['heart-handshake', 'Благотворительность', 'помощь пожертвования'],
  ['banknote', 'Наличные', 'деньги финансы'], ['wallet-cards', 'Кошелёк', 'деньги карта'], ['coins', 'Монеты', 'деньги финансы'], ['receipt-text', 'Счета', 'чек оплата'],
  ['badge-percent', 'Скидки', 'процент покупки'], ['circle-dollar-sign', 'Валюта', 'доллар деньги'], ['badge-russian-ruble', 'Рубли', 'деньги валюта'], ['badge-euro', 'Евро', 'деньги валюта'],
  ['landmark', 'Банк', 'финансы'], ['piggy-bank', 'Сбережения', 'деньги накопления'], ['vault', 'Резерв', 'деньги накопления'], ['chart-no-axes-combined', 'Инвестиции', 'финансы график'],
  ['shield-check', 'Защита', 'страхование'], ['shield-plus', 'Медицинская страховка', 'страхование здоровье'], ['car', 'Автострахование', 'страхование машина'], ['house-heart', 'Страхование жилья', 'страховка дом'],
  ['wrench', 'Сервис', 'ремонт инструменты'], ['tool-case', 'Мастер', 'ремонт инструменты'], ['paint-bucket', 'Материалы', 'ремонт краска'], ['house-plus', 'Улучшение дома', 'ремонт жильё'],
  ['leaf', 'Экология', 'природа'], ['tree-deciduous', 'Сад', 'природа дом'], ['sprout', 'Растения', 'сад природа'], ['recycle', 'Переработка', 'экология'],
  ['cigarette', 'Сигареты', 'табак'], ['badge-alert', 'Штрафы', 'платёж предупреждение'], ['scale', 'Юридические услуги', 'право'], ['circle-ellipsis', 'Прочее', 'другое разное'],
];

const icons = [
  ...legacy,
  ...catalog.map(([file, name, synonyms]) => [`lucide:${file}`, file, name, synonyms]),
];
if (icons.length < 150) throw new Error(`Нужно минимум 150 иконок, сейчас ${icons.length}.`);
const ids = new Set();
const records = icons.map(([id, file, name, synonyms]) => {
  if (ids.has(id)) throw new Error(`Повторный ID: ${id}`);
  ids.add(id);
  const source = readFileSync(resolve(packageRoot, 'icons', `${file}.svg`), 'utf8');
  const svg = source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>[\s\S]*$/, '')
    .replace(/\s+/g, ' ')
    .replace(/> </g, '><')
    .trim();
  return { id, name, synonyms: synonyms.split(/\s+/), svg };
});

const output = `// Static Lucide subset for expense categories. See LUCIDE-LICENSE.txt.\n`
  + `// Generated by scripts/build-category-icons.mjs; no runtime dependency or CDN.\n`
  + `export const CATEGORY_ICONS = ${JSON.stringify(records, null, 2)};\n\n`
  + `const byId = new Map(CATEGORY_ICONS.map((icon) => [icon.id, icon]));\n\n`
  + `export function getCategoryIcon(iconId) {\n  return byId.get(iconId) ?? byId.get('local:circle');\n}\n\n`
  + `export function categoryIconSvg(iconId, cssClass = 'icon') {\n  const icon = getCategoryIcon(iconId);\n  return \`<svg class="\${cssClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">\${icon.svg}</svg>\`;\n}\n\n`
  + `export function searchCategoryIcons(query) {\n  const normalized = String(query ?? '').trim().toLocaleLowerCase('ru-RU');\n  if (!normalized) return [...CATEGORY_ICONS];\n  return CATEGORY_ICONS.filter((icon) => {\n    const haystack = [icon.name, ...(icon.synonyms ?? [])].join(' ').toLocaleLowerCase('ru-RU');\n    return normalized.split(/\\s+/).every((part) => haystack.includes(part));\n  });\n}\n`;

writeFileSync(resolve('finance/icons.js'), output);
copyFileSync(resolve(packageRoot, 'LICENSE'), resolve('finance/LUCIDE-LICENSE.txt'));
console.log(`Собрано иконок: ${records.length}`);
