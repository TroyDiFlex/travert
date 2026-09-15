import {
  createAccountCommand,
  createCategoryCommand,
  deleteTransactionCommand,
  recordExpenseCommand,
} from './core/commands.js';
import { formatMoney, parseMoney, requireCalendarDate } from './core/money.js';
import { FinanceRepository } from './repository.js';
import { isKnownIcon } from './icons.js';

export const EXPENSES_IDENTITY = Object.freeze({
  backendId: 'local',
  uid: 'local-user',
  bookId: 'main',
  epoch: 'local-epoch',
});

export const SEED_ACCOUNT_ID = 'account_cash_default';
export const UNCATEGORIZED_ID = 'category_uncategorized';

export const ACCOUNT_KIND_LABELS = Object.freeze({
  cash: 'Наличные',
  bank: 'Банк',
  savings: 'Накопления',
});

export const CATEGORY_COLORS = Object.freeze([
  '#f87171', '#fb923c', '#fbbf24', '#a3e635', '#34d399', '#22d3ee',
  '#818cf8', '#e879f9', '#f472b6', '#94a3b8', '#facc15', '#4ade80',
]);

function todayLocal() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export class ExpensesController {
  constructor({ repository = new FinanceRepository() } = {}) {
    this.repository = repository;
    this.ready = false;
  }

  async open(identity = EXPENSES_IDENTITY) {
    await this.repository.open(identity);
    await this.ensureSeed();
    this.ready = true;
    return this;
  }

  async ensureSeed() {
    const [accounts, categories] = await Promise.all([
      this.repository.query({ type: 'accounts' }),
      this.repository.query({ type: 'categories', includeDeleted: true }),
    ]);
    if (!accounts.some((account) => account.id === SEED_ACCOUNT_ID)) {
      await this.repository.dispatch(createAccountCommand(
        { name: 'Наличные', kind: 'cash', currency: 'RUB' },
        { opId: 'op_seed_default_account', entityId: SEED_ACCOUNT_ID },
      ));
    }
    if (!categories.some((category) => category.id === UNCATEGORIZED_ID)) {
      await this.repository.dispatch(createCategoryCommand(
        { name: 'Без категории', iconId: 'local:circle', color: '#94a3b8', sortOrder: -1, system: true },
        { opId: 'op_seed_uncategorized', entityId: UNCATEGORIZED_ID },
      ));
    }
  }

  onUpdate(listener) {
    return this.repository.subscribe(listener);
  }

  listAccounts() {
    return this.repository.query({ type: 'accounts' });
  }

  listCategories() {
    return this.repository.query({ type: 'categories' });
  }

  listExpenses(filter = {}) {
    return this.repository.query({ type: 'expenses', ...filter });
  }

  pendingCount() {
    return this.repository.query({ type: 'pending-count' });
  }

  async createAccount({ name, kind = 'cash', currency = 'RUB' }) {
    if (!ACCOUNT_KIND_LABELS[kind]) throw new Error('Неизвестный тип счёта.');
    return this.repository.dispatch(createAccountCommand({ name, kind, currency }));
  }

  async createCategory({ name, color = '#818cf8', iconId = 'local:circle', sortOrder } = {}) {
    const order = sortOrder ?? await this.#nextCategoryOrder();
    return this.repository.dispatch(createCategoryCommand({
      name,
      color,
      iconId: isKnownIcon(iconId) ? iconId : 'local:circle',
      sortOrder: order,
      system: false,
    }));
  }

  async saveExpense({ date, amountText, accountId, categoryId = UNCATEGORIZED_ID, note = '' }) {
    const accounts = await this.listAccounts();
    const account = accounts.find((item) => item.id === accountId);
    if (!account) throw new Error('Выберите счёт из списка.');
    const normalizedDate = requireCalendarDate(date ?? todayLocal());
    const amountMinor = parseMoney(amountText ?? '', account.currency);
    if (amountMinor <= 0) throw new Error('Сумма должна быть больше нуля.');
    return this.repository.dispatch(recordExpenseCommand({
      date: normalizedDate,
      accountId: account.id,
      categoryId,
      amountMinor,
      currency: account.currency,
      note,
    }));
  }

  async deleteExpense(id) {
    return this.repository.dispatch(deleteTransactionCommand(id));
  }

  formatAmount(minor, currency) {
    return formatMoney(minor, currency);
  }

  close() {
    this.ready = false;
    this.repository.close();
  }

  async #nextCategoryOrder() {
    const categories = await this.listCategories();
    return categories.reduce((max, category) => Math.max(max, category.sortOrder), 0) + 1;
  }
}

export function createExpensesController(options) {
  return new ExpensesController(options);
}
