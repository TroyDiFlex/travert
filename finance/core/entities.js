import {
  FinanceValidationError,
  assertMinorUnits,
  requireCalendarDate,
  requireCurrency,
} from './money.js';

export const ENTITY_TYPES = Object.freeze({
  ACCOUNTS: 'accounts',
  CATEGORIES: 'categories',
  TRANSACTIONS: 'transactions',
});

export const ACCOUNT_KINDS = Object.freeze(['cash', 'bank', 'savings']);
export const CATEGORY_KINDS = Object.freeze(['expense']);
export const TRANSACTION_KINDS = Object.freeze([
  'income',
  'expense',
  'expense-refund',
  'transfer',
  'opening-balance',
  'adjustment',
]);

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function fail(message, field, code = 'invalid-entity') {
  throw new FinanceValidationError(message, field, code);
}

export function requireId(value, field = 'id') {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    fail('Некорректный идентификатор.', field, 'invalid-id');
  }
  return value;
}

export function normalizeText(value, field, { min = 1, max = 120, optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === '')) return '';
  if (typeof value !== 'string') fail('Ожидается текст.', field, 'invalid-text');
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (optional && normalized === '') return '';
  if (normalized.length < min || normalized.length > max) {
    fail(`Длина поля должна быть от ${min} до ${max} символов.`, field, 'invalid-text-length');
  }
  return normalized;
}

export function requireIsoInstant(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value))) {
    fail('Некорректная отметка времени.', field, 'invalid-instant');
  }
  return value;
}

export function entityKey(entityType, id) {
  return `${entityType}:${id}`;
}

export function toEntityMap(entities = []) {
  return new Map(entities.map((entity) => [entity.key ?? entityKey(entity.entityType, entity.id), entity]));
}

function normalizeMetadata(entity, entityType) {
  requireId(entity.id);
  requireId(entity.lastOpId, 'lastOpId');
  if (!Number.isSafeInteger(entity.version) || entity.version < 0) {
    fail('Версия сущности должна быть неотрицательным целым числом.', 'version', 'invalid-version');
  }
  requireIsoInstant(entity.createdAt, 'createdAt');
  requireIsoInstant(entity.updatedAt, 'updatedAt');
  if (entity.deletedAt !== null) requireIsoInstant(entity.deletedAt, 'deletedAt');
  return { ...entity, key: entityKey(entityType, entity.id), entityType };
}

function requireActiveReference(context, entityType, id, field) {
  requireId(id, field);
  const entity = context?.entities?.get(`${entityType}:${id}`);
  if (!entity || (entity.deletedAt && !context?.allowHistoricalReferences)) {
    fail('Связанная запись не найдена.', field, 'missing-reference');
  }
  if (entity.archivedAt && !context?.allowHistoricalReferences) {
    fail('Нельзя использовать архивную запись.', field, 'archived-reference');
  }
  return entity;
}

function normalizeAccount(entity) {
  const account = normalizeMetadata(entity, ENTITY_TYPES.ACCOUNTS);
  account.name = normalizeText(account.name, 'name');
  if (!ACCOUNT_KINDS.includes(account.kind)) fail('Неизвестный тип счёта.', 'kind');
  requireCurrency(account.currency);
  if (account.archivedAt !== null) requireIsoInstant(account.archivedAt, 'archivedAt');
  return account;
}

function normalizeCategory(entity) {
  const category = normalizeMetadata(entity, ENTITY_TYPES.CATEGORIES);
  category.name = normalizeText(category.name, 'name');
  if (!CATEGORY_KINDS.includes(category.kind)) fail('Неизвестный тип категории.', 'kind');
  category.iconId = normalizeText(category.iconId, 'iconId', { max: 128 });
  if (!COLOR_PATTERN.test(category.color)) fail('Цвет должен иметь формат #RRGGBB.', 'color', 'invalid-color');
  if (!Number.isSafeInteger(category.sortOrder)) fail('Порядок должен быть целым числом.', 'sortOrder');
  if (typeof category.system !== 'boolean') fail('Признак системной категории должен быть логическим.', 'system');
  if (category.archivedAt !== null) requireIsoInstant(category.archivedAt, 'archivedAt');
  return category;
}

function normalizeTransaction(entity, context) {
  const transaction = normalizeMetadata(entity, ENTITY_TYPES.TRANSACTIONS);
  if (!TRANSACTION_KINDS.includes(transaction.kind)) fail('Неизвестный тип операции.', 'kind');
  requireCalendarDate(transaction.date);
  transaction.month = transaction.date.slice(0, 7);
  transaction.note = normalizeText(transaction.note, 'note', { max: 500, optional: true });

  if (transaction.kind === 'expense') {
    const account = requireActiveReference(context, ENTITY_TYPES.ACCOUNTS, transaction.accountId, 'accountId');
    const category = requireActiveReference(context, ENTITY_TYPES.CATEGORIES, transaction.categoryId, 'categoryId');
    assertMinorUnits(transaction.amountMinor, 'amountMinor', { positive: true });
    requireCurrency(transaction.currency);
    if (transaction.currency !== account.currency) fail('Валюта расхода не совпадает с валютой счёта.', 'currency', 'currency-mismatch');
    if (category.kind !== 'expense') fail('Для расхода нужна расходная категория.', 'categoryId', 'category-kind');
    transaction.accountIds = [transaction.accountId];
    return transaction;
  }

  fail('Этот тип операции будет включён на следующем этапе.', 'kind', 'unsupported-transaction-kind');
}

export function validateEntity(entityType, entity, context = {}) {
  if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
    fail('Сущность должна быть объектом.', 'entity');
  }
  switch (entityType) {
    case ENTITY_TYPES.ACCOUNTS:
      return normalizeAccount({ ...entity });
    case ENTITY_TYPES.CATEGORIES:
      return normalizeCategory({ ...entity });
    case ENTITY_TYPES.TRANSACTIONS:
      return normalizeTransaction({ ...entity }, context);
    default:
      fail('Неизвестный тип сущности.', 'entityType', 'unsupported-entity-type');
  }
}

export function makeLocalEntity(entityType, id, values, { opId, now }, context = {}) {
  return validateEntity(entityType, {
    ...values,
    id,
    version: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    lastOpId: opId,
  }, context);
}
