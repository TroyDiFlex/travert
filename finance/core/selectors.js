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

export function selectOverview(state) {
  return calculateLedger(state.viewEntities);
}

export function selectPendingCount(state) {
  return state.outbox.filter((item) => !['cancelled', 'resolved'].includes(item.state)).length;
}

export function runSelector(state, selector) {
  if (typeof selector === 'function') return selector(state);
  switch (selector?.type) {
    case 'entities': return selectEntities(state, selector);
    case 'accounts': return selectAccounts(state, selector);
    case 'categories': return selectCategories(state, selector);
    case 'expenses': return selectExpenses(state, selector);
    case 'overview': return selectOverview(state);
    case 'pending-count': return selectPendingCount(state);
    default: throw new TypeError('Неизвестный селектор репозитория.');
  }
}
