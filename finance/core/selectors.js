import { calculateLedger } from './ledger.js';

function visible(entities, entityType, includeDeleted = false) {
  return entities.filter((entity) => entity.entityType === entityType && (includeDeleted || !entity.deletedAt));
}

export function selectEntities(state, { entityType, includeDeleted = false } = {}) {
  if (!entityType) return state.viewEntities.filter((entity) => includeDeleted || !entity.deletedAt);
  return visible(state.viewEntities, entityType, includeDeleted);
}

export function selectAccounts(state, options) {
  return visible(state.viewEntities, 'accounts', options?.includeDeleted)
    .sort((left, right) => left.name.localeCompare(right.name, 'ru'));
}

export function selectCategories(state, options) {
  return visible(state.viewEntities, 'categories', options?.includeDeleted)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'ru'));
}

export function selectExpenses(state, options = {}) {
  return visible(state.viewEntities, 'transactions', options.includeDeleted)
    .filter((transaction) => transaction.kind === 'expense')
    .filter((transaction) => !options.accountId || transaction.accountId === options.accountId)
    .filter((transaction) => !options.categoryId || transaction.categoryId === options.categoryId)
    .filter((transaction) => !options.month || transaction.month === options.month)
    .sort((left, right) => right.date.localeCompare(left.date) || right.createdAt.localeCompare(left.createdAt));
}

export function selectTransfers(state, options = {}) {
  return visible(state.viewEntities, 'transactions', options.includeDeleted)
    .filter((transaction) => transaction.kind === 'transfer')
    .filter((transaction) => !options.accountId || transaction.fromAccountId === options.accountId || transaction.toAccountId === options.accountId)
    .filter((transaction) => !options.month || transaction.month === options.month)
    .sort((left, right) => right.date.localeCompare(left.date) || right.createdAt.localeCompare(left.createdAt));
}

export function selectOverview(state) {
  return calculateLedger(state.viewEntities);
}

export function selectPendingCount(state) {
  return state.outbox.filter((item) => !['cancelled', 'resolved'].includes(item.state)).length;
}

export function selectCategoryUsage(state, categoryId) {
  const expenses = visible(state.viewEntities, 'transactions')
    .filter((transaction) => transaction.kind === 'expense' && transaction.categoryId === categoryId);
  const totalByCurrency = {};
  for (const expense of expenses) {
    totalByCurrency[expense.currency] = (totalByCurrency[expense.currency] ?? 0) + expense.amountMinor;
  }
  return { categoryId, count: expenses.length, totalByCurrency, expenseIds: expenses.map((expense) => expense.id) };
}

export function selectAccountUsage(state, accountId) {
  const expenses = visible(state.viewEntities, 'transactions')
    .filter((transaction) => transaction.kind === 'expense' && transaction.accountId === accountId);
  const transfers = visible(state.viewEntities, 'transactions')
    .filter((transaction) => transaction.kind === 'transfer' && (transaction.fromAccountId === accountId || transaction.toAccountId === accountId));
  const totalByCurrency = {};
  for (const expense of expenses) {
    totalByCurrency[expense.currency] = (totalByCurrency[expense.currency] ?? 0) + expense.amountMinor;
  }
  return { accountId, count: expenses.length, totalByCurrency, expenseIds: expenses.map((expense) => expense.id), transferCount: transfers.length, transferIds: transfers.map((transfer) => transfer.id) };
}

export function selectExpenseSummary(state, filters = {}) {
  const expenses = selectExpenses(state, filters);
  const totalByCurrency = {};
  const byCategory = new Map();
  const byMonth = new Map();
  for (const expense of expenses) {
    totalByCurrency[expense.currency] = (totalByCurrency[expense.currency] ?? 0) + expense.amountMinor;
    const categoryEntry = byCategory.get(expense.categoryId) ?? { categoryId: expense.categoryId, count: 0, totalByCurrency: {} };
    categoryEntry.count += 1;
    categoryEntry.totalByCurrency[expense.currency] = (categoryEntry.totalByCurrency[expense.currency] ?? 0) + expense.amountMinor;
    byCategory.set(expense.categoryId, categoryEntry);
    const monthEntry = byMonth.get(expense.month) ?? { month: expense.month, count: 0, totalByCurrency: {} };
    monthEntry.count += 1;
    monthEntry.totalByCurrency[expense.currency] = (monthEntry.totalByCurrency[expense.currency] ?? 0) + expense.amountMinor;
    byMonth.set(expense.month, monthEntry);
  }
  return {
    count: expenses.length,
    totalByCurrency,
    byCategory: [...byCategory.values()].sort((left, right) => right.count - left.count),
    byMonth: [...byMonth.values()].sort((left, right) => left.month.localeCompare(right.month)),
  };
}

export function runSelector(state, selector) {
  if (typeof selector === 'function') return selector(state);
  switch (selector?.type) {
    case 'entities': return selectEntities(state, selector);
    case 'accounts': return selectAccounts(state, selector);
    case 'categories': return selectCategories(state, selector);
    case 'expenses': return selectExpenses(state, selector);
    case 'transfers': return selectTransfers(state, selector);
    case 'expense-summary': return selectExpenseSummary(state, selector);
    case 'category-usage': return selectCategoryUsage(state, selector.categoryId);
    case 'account-usage': return selectAccountUsage(state, selector.accountId);
    case 'overview': return selectOverview(state);
    case 'pending-count': return selectPendingCount(state);
    default: throw new TypeError('Неизвестный селектор репозитория.');
  }
}
