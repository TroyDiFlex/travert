import { FinanceValidationError } from './money.js';
import { ENTITY_TYPES, entityKey, requireId, toEntityMap, validateEntity } from './entities.js';

export const COMMAND_TYPES = Object.freeze({
  CREATE_ACCOUNT: 'create-account',
  CREATE_CATEGORY: 'create-category',
  RECORD_EXPENSE: 'record-expense',
  RECORD_TRANSFER: 'record-transfer',
  UPDATE_ACCOUNT: 'update-account',
  UPDATE_CATEGORY: 'update-category',
  UPDATE_EXPENSE: 'update-expense',
  UPDATE_TRANSFER: 'update-transfer',
  DELETE_TRANSACTION: 'delete-transaction',
  DELETE_CATEGORY: 'delete-category',
  DELETE_ACCOUNT: 'delete-account',
});

function defaultUuid() {
  if (!globalThis.crypto?.randomUUID) throw new Error('crypto.randomUUID недоступен.');
  return globalThis.crypto.randomUUID();
}

function makeCommand(type, payload, options = {}) {
  const uuid = options.uuid ?? defaultUuid;
  const entityPrefix = type === COMMAND_TYPES.RECORD_EXPENSE || type === COMMAND_TYPES.RECORD_TRANSFER ? 'txn' : type.includes('account') ? 'account' : 'category';
  return Object.freeze({
    protocolVersion: 2,
    type,
    opId: options.opId ?? `op_${uuid()}`,
    entityId: options.entityId ?? `${entityPrefix}_${uuid()}`,
    createdAt: options.createdAt ?? new Date().toISOString(),
    payload: structuredClone(payload),
  });
}

export function createAccountCommand(input, options) {
  return makeCommand(COMMAND_TYPES.CREATE_ACCOUNT, {
    name: input.name,
    kind: input.kind ?? 'bank',
    currency: input.currency ?? 'RUB',
  }, options);
}

export function createCategoryCommand(input, options) {
  return makeCommand(COMMAND_TYPES.CREATE_CATEGORY, {
    name: input.name,
    kind: 'expense',
    iconId: input.iconId ?? 'local:circle',
    color: input.color ?? '#818cf8',
    sortOrder: input.sortOrder ?? 0,
    system: input.system ?? false,
  }, options);
}

export function recordExpenseCommand(input, options) {
  return makeCommand(COMMAND_TYPES.RECORD_EXPENSE, {
    date: input.date,
    accountId: input.accountId,
    categoryId: input.categoryId,
    amountMinor: input.amountMinor,
    currency: input.currency,
    note: input.note ?? '',
  }, options);
}

export function updateAccountCommand(id, patch, options = {}) {
  return makeCommand(COMMAND_TYPES.UPDATE_ACCOUNT, { patch: structuredClone(patch) }, { ...options, entityId: id });
}

export function updateCategoryCommand(id, patch, options = {}) {
  return makeCommand(COMMAND_TYPES.UPDATE_CATEGORY, { patch: structuredClone(patch) }, { ...options, entityId: id });
}

export function deleteTransactionCommand(id, options = {}) {
  return makeCommand(COMMAND_TYPES.DELETE_TRANSACTION, {}, { ...options, entityId: id });
}

export function updateExpenseCommand(id, patch, options = {}) {
  return makeCommand(COMMAND_TYPES.UPDATE_EXPENSE, { patch: structuredClone(patch) }, { ...options, entityId: id });
}

export function recordTransferCommand(input, options) {
  return makeCommand(COMMAND_TYPES.RECORD_TRANSFER, {
    date: input.date,
    fromAccountId: input.fromAccountId,
    toAccountId: input.toAccountId,
    fromAmountMinor: input.fromAmountMinor,
    toAmountMinor: input.toAmountMinor,
    currency: input.currency,
    note: input.note ?? '',
  }, options);
}

export function updateTransferCommand(id, patch, options = {}) {
  return makeCommand(COMMAND_TYPES.UPDATE_TRANSFER, { patch: structuredClone(patch) }, { ...options, entityId: id });
}

export function deleteCategoryCommand(id, options = {}) {
  return makeCommand(COMMAND_TYPES.DELETE_CATEGORY, {}, { ...options, entityId: id });
}

export function deleteAccountCommand(id, options = {}) {
  return makeCommand(COMMAND_TYPES.DELETE_ACCOUNT, {}, { ...options, entityId: id });
}

function assertCommand(command) {
  if (!command || typeof command !== 'object' || command.protocolVersion !== 2) {
    throw new FinanceValidationError('Неподдерживаемый формат команды.', 'command', 'invalid-command');
  }
  requireId(command.opId, 'opId');
  requireId(command.entityId, 'entityId');
  if (!Object.values(COMMAND_TYPES).includes(command.type)) {
    throw new FinanceValidationError('Неизвестная команда.', 'type', 'unsupported-command');
  }
  if (typeof command.createdAt !== 'string' || Number.isNaN(Date.parse(command.createdAt))) {
    throw new FinanceValidationError('Некорректное время команды.', 'createdAt', 'invalid-instant');
  }
}

function pendingDependency(outbox, entityType, id) {
  return [...outbox]
    .filter((item) => item.change.entityType === entityType && item.change.id === id)
    .filter((item) => !['cancelled', 'resolved'].includes(item.state))
    .sort((left, right) => right.localSequence - left.localSequence)[0]?.opId ?? null;
}

function collectDependencies(command, outbox, change) {
  const dependencies = new Set();
  const targetDependency = pendingDependency(outbox, change.entityType, change.id);
  if (targetDependency) dependencies.add(targetDependency);

  if (command.type === COMMAND_TYPES.RECORD_EXPENSE) {
    for (const [type, id] of [
      [ENTITY_TYPES.ACCOUNTS, command.payload.accountId],
      [ENTITY_TYPES.CATEGORIES, command.payload.categoryId],
    ]) {
      const dependency = pendingDependency(outbox, type, id);
      if (dependency) dependencies.add(dependency);
    }
  }
  if (command.type === COMMAND_TYPES.UPDATE_EXPENSE) {
    const patch = command.payload.patch ?? {};
    for (const [type, id] of [
      [ENTITY_TYPES.ACCOUNTS, patch.accountId],
      [ENTITY_TYPES.CATEGORIES, patch.categoryId],
    ]) {
      if (typeof id !== 'string') continue;
      const dependency = pendingDependency(outbox, type, id);
      if (dependency) dependencies.add(dependency);
    }
  }
  if (command.type === COMMAND_TYPES.RECORD_TRANSFER || command.type === COMMAND_TYPES.UPDATE_TRANSFER) {
    const payload = command.type === COMMAND_TYPES.RECORD_TRANSFER ? command.payload : (command.payload.patch ?? {});
    for (const id of [payload.fromAccountId, payload.toAccountId]) {
      if (typeof id !== 'string') continue;
      const dependency = pendingDependency(outbox, ENTITY_TYPES.ACCOUNTS, id);
      if (dependency) dependencies.add(dependency);
    }
  }
  dependencies.delete(command.opId);
  return [...dependencies];
}

function createEntity(command, entityType, values, entities) {
  const key = entityKey(entityType, command.entityId);
  if (entities.has(key)) {
    throw new FinanceValidationError('Этот идентификатор уже использован.', 'entityId', 'duplicate-id');
  }
  return validateEntity(entityType, {
    ...values,
    id: command.entityId,
    version: 0,
    createdAt: command.createdAt,
    updatedAt: command.createdAt,
    deletedAt: null,
    lastOpId: command.opId,
  }, { entities });
}

function updateEntity(command, entityType, allowedFields, entities) {
  const key = entityKey(entityType, command.entityId);
  const current = entities.get(key);
  if (!current || current.deletedAt) {
    throw new FinanceValidationError('Изменяемая запись не найдена.', 'entityId', 'missing-entity');
  }
  const patch = command.payload.patch;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new FinanceValidationError('Некорректное изменение.', 'patch', 'invalid-patch');
  }
  const unknown = Object.keys(patch).filter((field) => !allowedFields.includes(field));
  if (unknown.length) {
    throw new FinanceValidationError(`Поле нельзя изменить: ${unknown[0]}.`, unknown[0], 'immutable-field');
  }
  return validateEntity(entityType, {
    ...current,
    ...patch,
    updatedAt: command.createdAt,
    lastOpId: command.opId,
  }, { entities });
}

function commandChange(command, entities) {
  switch (command.type) {
    case COMMAND_TYPES.CREATE_ACCOUNT:
      return {
        entityType: ENTITY_TYPES.ACCOUNTS,
        id: command.entityId,
        action: 'create',
        expectedVersion: 0,
        value: createEntity(command, ENTITY_TYPES.ACCOUNTS, {
          ...command.payload,
          archivedAt: null,
        }, entities),
      };
    case COMMAND_TYPES.CREATE_CATEGORY:
      return {
        entityType: ENTITY_TYPES.CATEGORIES,
        id: command.entityId,
        action: 'create',
        expectedVersion: 0,
        value: createEntity(command, ENTITY_TYPES.CATEGORIES, {
          ...command.payload,
          archivedAt: null,
        }, entities),
      };
    case COMMAND_TYPES.RECORD_EXPENSE:
      return {
        entityType: ENTITY_TYPES.TRANSACTIONS,
        id: command.entityId,
        action: 'create',
        expectedVersion: 0,
        value: createEntity(command, ENTITY_TYPES.TRANSACTIONS, {
          kind: 'expense',
          ...command.payload,
        }, entities),
      };
    case COMMAND_TYPES.RECORD_TRANSFER:
      return {
        entityType: ENTITY_TYPES.TRANSACTIONS,
        id: command.entityId,
        action: 'create',
        expectedVersion: 0,
        value: createEntity(command, ENTITY_TYPES.TRANSACTIONS, {
          kind: 'transfer',
          ...command.payload,
        }, entities),
      };
    case COMMAND_TYPES.UPDATE_ACCOUNT: {
      const current = entities.get(entityKey(ENTITY_TYPES.ACCOUNTS, command.entityId));
      return {
        entityType: ENTITY_TYPES.ACCOUNTS,
        id: command.entityId,
        action: 'update',
        expectedVersion: current?.version ?? 0,
        value: updateEntity(command, ENTITY_TYPES.ACCOUNTS, ['name', 'kind', 'archivedAt'], entities),
      };
    }
    case COMMAND_TYPES.UPDATE_CATEGORY: {
      const current = entities.get(entityKey(ENTITY_TYPES.CATEGORIES, command.entityId));
      return {
        entityType: ENTITY_TYPES.CATEGORIES,
        id: command.entityId,
        action: 'update',
        expectedVersion: current?.version ?? 0,
        value: updateEntity(command, ENTITY_TYPES.CATEGORIES, ['name', 'iconId', 'color', 'sortOrder', 'archivedAt'], entities),
      };
    }
    case COMMAND_TYPES.DELETE_TRANSACTION: {
      const key = entityKey(ENTITY_TYPES.TRANSACTIONS, command.entityId);
      const current = entities.get(key);
      if (!current || current.deletedAt) {
        throw new FinanceValidationError('Удаляемая операция не найдена.', 'entityId', 'missing-entity');
      }
      return {
        entityType: ENTITY_TYPES.TRANSACTIONS,
        id: command.entityId,
        action: 'delete',
        expectedVersion: current.version,
        value: validateEntity(ENTITY_TYPES.TRANSACTIONS, {
          ...current,
          deletedAt: command.createdAt,
          updatedAt: command.createdAt,
          lastOpId: command.opId,
        }, { entities, allowHistoricalReferences: true }),
      };
    }
    case COMMAND_TYPES.UPDATE_EXPENSE: {
      const key = entityKey(ENTITY_TYPES.TRANSACTIONS, command.entityId);
      const current = entities.get(key);
      if (!current || current.deletedAt) {
        throw new FinanceValidationError('Изменяемый расход не найден.', 'entityId', 'missing-entity');
      }
      if (current.kind !== 'expense') {
        throw new FinanceValidationError('Можно изменить только расход.', 'entityId', 'unsupported-transaction-kind');
      }
      const patch = command.payload.patch;
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new FinanceValidationError('Некорректное изменение расхода.', 'patch', 'invalid-patch');
      }
      const allowed = ['date', 'accountId', 'categoryId', 'amountMinor', 'currency', 'note'];
      const unknown = Object.keys(patch).filter((field) => !allowed.includes(field));
      if (unknown.length) {
        throw new FinanceValidationError(`Поле нельзя изменить: ${unknown[0]}.`, unknown[0], 'immutable-field');
      }
      if (Object.keys(patch).length === 0) {
        throw new FinanceValidationError('Нет изменений для сохранения.', 'patch', 'empty-patch');
      }
      return {
        entityType: ENTITY_TYPES.TRANSACTIONS,
        id: command.entityId,
        action: 'update',
        expectedVersion: current.version,
        value: validateEntity(ENTITY_TYPES.TRANSACTIONS, {
          ...current,
          ...patch,
          updatedAt: command.createdAt,
          lastOpId: command.opId,
        }, { entities }),
      };
    }
    case COMMAND_TYPES.UPDATE_TRANSFER: {
      const key = entityKey(ENTITY_TYPES.TRANSACTIONS, command.entityId);
      const current = entities.get(key);
      if (!current || current.deletedAt) {
        throw new FinanceValidationError('Изменяемый перевод не найден.', 'entityId', 'missing-entity');
      }
      if (current.kind !== 'transfer') {
        throw new FinanceValidationError('Можно изменить только перевод.', 'entityId', 'unsupported-transaction-kind');
      }
      const patch = command.payload.patch;
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new FinanceValidationError('Некорректное изменение перевода.', 'patch', 'invalid-patch');
      }
      const allowed = ['date', 'fromAccountId', 'toAccountId', 'fromAmountMinor', 'toAmountMinor', 'currency', 'note'];
      const unknown = Object.keys(patch).filter((field) => !allowed.includes(field));
      if (unknown.length) {
        throw new FinanceValidationError(`Поле нельзя изменить: ${unknown[0]}.`, unknown[0], 'immutable-field');
      }
      if (Object.keys(patch).length === 0) {
        throw new FinanceValidationError('Нет изменений для сохранения.', 'patch', 'empty-patch');
      }
      return {
        entityType: ENTITY_TYPES.TRANSACTIONS,
        id: command.entityId,
        action: 'update',
        expectedVersion: current.version,
        value: validateEntity(ENTITY_TYPES.TRANSACTIONS, {
          ...current,
          ...patch,
          updatedAt: command.createdAt,
          lastOpId: command.opId,
        }, { entities }),
      };
    }
    case COMMAND_TYPES.DELETE_CATEGORY:
    case COMMAND_TYPES.DELETE_ACCOUNT: {
      const entityType = command.type === COMMAND_TYPES.DELETE_CATEGORY
        ? ENTITY_TYPES.CATEGORIES
        : ENTITY_TYPES.ACCOUNTS;
      const key = entityKey(entityType, command.entityId);
      const current = entities.get(key);
      if (!current || current.deletedAt) {
        throw new FinanceValidationError('Удаляемая запись не найдена.', 'entityId', 'missing-entity');
      }
      if (current.system === true) {
        throw new FinanceValidationError('Системную запись нельзя удалить.', 'entityId', 'system-entity');
      }
      return {
        entityType,
        id: command.entityId,
        action: 'delete',
        expectedVersion: current.version,
        value: validateEntity(entityType, {
          ...current,
          deletedAt: command.createdAt,
          updatedAt: command.createdAt,
          lastOpId: command.opId,
        }, { entities, allowHistoricalReferences: true }),
      };
    }
    default:
      throw new FinanceValidationError('Неизвестная команда.', 'type', 'unsupported-command');
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function commandFingerprint(command) {
  return JSON.stringify(canonicalize(command));
}

export function planLocalCommand(command, snapshot, localSequence) {
  assertCommand(command);
  const duplicate = snapshot.outbox.find((item) => item.opId === command.opId);
  if (duplicate) {
    if (duplicate.commandFingerprint !== commandFingerprint(command)) {
      throw new FinanceValidationError('Один opId использован для разных команд.', 'opId', 'op-id-collision');
    }
    return { duplicate: true, outbox: duplicate, entity: duplicate.change.value };
  }

  const entities = snapshot.entities instanceof Map ? snapshot.entities : toEntityMap(snapshot.entities);
  const change = commandChange(command, entities);
  const dependsOn = collectDependencies(command, snapshot.outbox, change);
  const before = entities.get(entityKey(change.entityType, change.id)) ?? null;
  const outbox = {
    opId: command.opId,
    localSequence,
    state: 'pending',
    command: structuredClone(command),
    commandFingerprint: commandFingerprint(command),
    before: before ? structuredClone(before) : null,
    change: structuredClone(change),
    dependsOn,
    frozenRequest: null,
    createdAt: command.createdAt,
    lastAttemptAt: null,
    receipt: null,
  };
  return { duplicate: false, outbox, entity: change.value };
}
