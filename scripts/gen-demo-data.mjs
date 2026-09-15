// Детерминированный генератор демо-данных: 2 года доходов (2024-10..2026-09)
// и бэкфилл расходов/переводов до уже существующего сида.
// Один и тот же запуск всегда даёт один и тот же результат,
// поэтому повторная загрузка не создаёт дублей (идемпотентные ID).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUB = (rubles) => Math.round(rubles * 100);

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function monthRange(from, to) {
  const result = [];
  let [year, month] = from.split('-').map(Number);
  const [endYear, endMonth] = to.split('-').map(Number);
  while (year < endYear || (year === endYear && month <= endMonth)) {
    result.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return result;
}

// --- Доходы: 6 источников, 24 месяца ---
export function buildIncomeSeed() {
  const rand = mulberry32(20241001);
  const whole = (min, max) => RUB(min + Math.floor(rand() * (max - min + 1)));
  const months = monthRange('2024-10', '2026-09');
  const sources = [
    { id: 'demo_salary', name: 'Основная работа', active: true, color: '#5ed9bc', order: 0 },
    { id: 'demo_freelance', name: 'Фриланс', active: true, color: '#a78bfa', order: 1 },
    { id: 'demo_consult', name: 'Консультации', active: true, color: '#f5bd72', order: 2 },
    { id: 'demo_digital', name: 'Цифровые продукты', active: true, color: '#ec88bf', order: 3 },
    { id: 'demo_rent', name: 'Аренда', active: true, color: '#79b8ff', order: 4 },
    { id: 'demo_other', name: 'Прочее', active: false, color: '#d3d96c', order: 5 },
  ];
  const entries = [];
  for (const month of months) {
    const salary = month < '2025-06' ? whole(118000, 122000) : month < '2026-01' ? whole(133000, 137000) : whole(148000, 152000);
    entries.push({ sourceId: 'demo_salary', month, amount: salary });
    if (rand() < 0.72) entries.push({ sourceId: 'demo_freelance', month, amount: whole(15000, 60000) });
    if (rand() < 0.42) entries.push({ sourceId: 'demo_consult', month, amount: whole(10000, 40000) });
    if (month >= '2025-03' && rand() < 0.8) {
      const growth = (Number(month.slice(0, 4)) - 2025) * 12 + Number(month.slice(5)) - 3;
      entries.push({ sourceId: 'demo_digital', month, amount: whole(5000 + growth * 1500, 9000 + growth * 1500) });
    }
    if (month >= '2025-01') entries.push({ sourceId: 'demo_rent', month, amount: month === '2026-02' ? 0 : 3500000 });
    if (rand() < 0.25) entries.push({ sourceId: 'demo_other', month, amount: whole(2000, 12000) });
  }
  entries.sort((a, b) => a.month.localeCompare(b.month) || a.sourceId.localeCompare(b.sourceId));
  return { sources, entries };
}

// --- Расходы: месячные паттерны по категориям и счетам сида ---
const EXPENSE_NOTES = {
  category_food: ['Супермаркет', 'Магазин у дома', 'Рынок', 'Продукты на неделю'],
  category_cafe: ['Обед', 'Кофе с собой', 'Ужин с друзьями', 'Бизнес-ланч'],
  category_transport: ['Проездной', 'Такси', 'Каршеринг', 'Электричка'],
  category_home: ['Коммуналка', 'Интернет', 'Хозтовары', 'Мелкий ремонт'],
  category_health: ['Аптека', 'Стоматолог', 'Анализы', 'Оптика'],
  category_travel: ['Билеты', 'Отель', 'Экскурсия', 'Страховка'],
  category_fun: ['Кино', 'Концерт', 'Подписка', 'Игра'],
  category_uncategorized: ['Пока не разобрано'],
};

export function buildExpenseBackfill(accounts, categories) {
  const rand = mulberry32(7391);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const day = () => String(int(1, 28)).padStart(2, '0');
  const out = [];
  const push = (id, date, accountId, categoryId, rubles, note) => {
    out.push({ id, date, accountId, categoryId, amountMinor: RUB(rubles), currency: byId.get(accountId).currency, note });
  };
  const usd = (id, date, accountId, categoryId, cents, note) => {
    out.push({ id, date, accountId, categoryId, amountMinor: cents, currency: 'USD', note });
  };
  const eur = (id, date, accountId, categoryId, cents, note) => {
    out.push({ id, date, accountId, categoryId, amountMinor: cents, currency: 'EUR', note });
  };
  const months = monthRange('2024-10', '2026-06');
  for (const month of months) {
    const tag = month.replace('-', '');
    let i = 0;
    const next = (cat) => `txn_bk_${tag}_${cat}_${i++}`;
    for (let k = 0, n = int(3, 5); k < n; k++) push(next('food'), `${month}-${day()}`, 'account_card_main', 'category_food', int(1500, 4500), pick(EXPENSE_NOTES.category_food));
    for (let k = 0, n = int(1, 3); k < n; k++) push(next('cafe'), `${month}-${day()}`, 'account_card_main', 'category_cafe', int(800, 3500), pick(EXPENSE_NOTES.category_cafe));
    for (let k = 0, n = int(2, 4); k < n; k++) push(next('tp'), `${month}-${day()}`, rand() < 0.8 ? 'account_card_main' : 'account_cash', 'category_transport', int(300, 1500), pick(EXPENSE_NOTES.category_transport));
    push(next('home'), `${month}-10`, 'account_card_main', 'category_home', int(4000, 6000), pick(EXPENSE_NOTES.category_home));
    for (let k = 0, n = int(1, 2); k < n; k++) push(next('fun'), `${month}-${day()}`, 'account_card_main', 'category_fun', int(1000, 5000), pick(EXPENSE_NOTES.category_fun));
    usd(next('sub'), `${month}-14`, 'account_usd', 'category_fun', 1599, 'Подписка');
    if (rand() < 0.35) push(next('med'), `${month}-${day()}`, 'account_cash', 'category_health', int(1500, 8000), pick(EXPENSE_NOTES.category_health));
    if (rand() < 0.3) eur(next('trv'), `${month}-${day()}`, 'account_eur', 'category_travel', int(10000, 40000), pick(EXPENSE_NOTES.category_travel));
    if (rand() < 0.15) push(next('unc'), `${month}-${day()}`, 'account_cash', 'category_uncategorized', int(500, 3000), pick(EXPENSE_NOTES.category_uncategorized));
  }
  return out;
}

export function buildTransferBackfill() {
  const rand = mulberry32(4242);
  const out = [];
  for (const month of monthRange('2024-10', '2026-06')) {
    const tag = month.replace('-', '');
    const amount = RUB(15000 + Math.floor(rand() * 11) * 1000);
    out.push({
      id: `txn_bk_t_${tag}`, date: `${month}-05`,
      fromAccountId: 'account_card_main', toAccountId: 'account_cash',
      fromAmountMinor: amount, toAmountMinor: amount, currency: 'RUB', note: 'На наличные расходы',
    });
  }
  return out;
}

function main() {
  const income = buildIncomeSeed();
  writeFileSync(join(root, 'income-demo-seed.json'), JSON.stringify(income, null, 2) + '\n');
  console.log('income-demo-seed.json:', income.sources.length, 'источников,', income.entries.length, 'записей');

  const seedPath = join(root, 'finance', 'demo-seed.json');
  const seed = JSON.parse(readFileSync(seedPath, 'utf8'));
  // Идемпотентность файла: сначала выкидываем свой же прошлый бэкфилл, потом генерируем заново.
  seed.expenses = seed.expenses.filter((e) => !e.id.startsWith('txn_bk_'));
  seed.transfers = (seed.transfers ?? []).filter((t) => !t.id.startsWith('txn_bk_'));
  seed.expenses = [...buildExpenseBackfill(seed.accounts, seed.categories), ...seed.expenses];
  seed.expenses.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  seed.transfers = [...buildTransferBackfill(), ...(seed.transfers ?? [])];
  seed.transfers.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  writeFileSync(seedPath, JSON.stringify(seed, null, 2) + '\n');
  console.log('demo-seed.json:', seed.expenses.length, 'расходов,', seed.transfers.length, 'переводов');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
