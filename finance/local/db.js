import {
  FINANCE_SCHEMA_VERSION,
  LOCAL_DB_VERSION,
  STORE_NAMES,
  SYNC_PROTOCOL_VERSION,
  upgradeLocalDatabase,
} from './migrations.js';
import { toEntityMap } from '../core/entities.js';

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error ?? new Error('Ошибка IndexedDB.')), { once: true });
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('Транзакция IndexedDB отменена.')), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('Ошибка транзакции IndexedDB.')), { once: true });
  });
}

function safeNamePart(value, field) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 160 || /[\u0000-\u001f]/.test(value)) {
    throw new TypeError(`Некорректная локальная идентичность: ${field}.`);
  }
  return encodeURIComponent(value);
}

export function normalizeLocalIdentity(identity) {
  if (!identity || typeof identity !== 'object') throw new TypeError('Не указана локальная идентичность книги.');
  const normalized = {
    projectId: String(identity.projectId ?? 'local'),
    uid: String(identity.uid ?? 'local-user'),
    bookId: String(identity.bookId ?? 'default'),
    epoch: String(identity.epoch ?? 'local-epoch'),
  };
  for (const [field, value] of Object.entries(normalized)) safeNamePart(value, field);
  return Object.freeze(normalized);
}

export function localDatabaseName(identity) {
  const normalized = normalizeLocalIdentity(identity);
  return `potok-finance:${safeNamePart(normalized.projectId, 'projectId')}:${safeNamePart(normalized.uid, 'uid')}:${safeNamePart(normalized.bookId, 'bookId')}`;
}

export class IndexedDbLocalStore {
  constructor(database, identity) {
    this.database = database;
    this.identity = identity;
  }

  async initialize() {
    const transaction = this.database.transaction(STORE_NAMES.META, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAMES.META);
    const existing = await requestResult(store.get('identity'));
    if (existing && JSON.stringify(existing.value) !== JSON.stringify(this.identity)) {
      transaction.abort();
      try { await done; } catch {}
      throw new Error('Локальная база принадлежит другой книге.');
    }
    if (!existing) {
      store.put({ key: 'identity', value: clone(this.identity) });
      store.put({ key: 'localSequence', value: 0 });
      store.put({ key: 'cursor', value: 0 });
      store.put({ key: 'activeEpoch', value: this.identity.epoch });
      store.put({ key: 'financeSchemaVersion', value: FINANCE_SCHEMA_VERSION });
      store.put({ key: 'syncProtocolVersion', value: SYNC_PROTOCOL_VERSION });
      store.put({ key: 'lastConfirmedSyncAt', value: null });
    }
    await done;
  }

  async readState() {
    const names = [
      STORE_NAMES.SERVER_ENTITIES,
      STORE_NAMES.VIEW_ENTITIES,
      STORE_NAMES.OUTBOX,
      STORE_NAMES.CONFLICTS,
      STORE_NAMES.META,
    ];
    const transaction = this.database.transaction(names, 'readonly');
    const done = transactionDone(transaction);
    const [serverEntities, viewEntities, outbox, conflicts, metaRows] = await Promise.all(
      names.map((name) => requestResult(transaction.objectStore(name).getAll())),
    );
    await done;
    return {
      serverEntities: clone(serverEntities),
      viewEntities: clone(viewEntities),
      outbox: clone(outbox).sort((left, right) => left.localSequence - right.localSequence),
      conflicts: clone(conflicts),
      meta: Object.fromEntries(metaRows.map((row) => [row.key, clone(row.value)])),
    };
  }

  async commitCommand(command, planner) {
    const names = [STORE_NAMES.VIEW_ENTITIES, STORE_NAMES.OUTBOX, STORE_NAMES.META];
    const transaction = this.database.transaction(names, 'readwrite');
    const done = transactionDone(transaction);
    const viewStore = transaction.objectStore(STORE_NAMES.VIEW_ENTITIES);
    const outboxStore = transaction.objectStore(STORE_NAMES.OUTBOX);
    const metaStore = transaction.objectStore(STORE_NAMES.META);

    try {
      const [viewEntities, outbox, sequenceRow] = await Promise.all([
        requestResult(viewStore.getAll()),
        requestResult(outboxStore.getAll()),
        requestResult(metaStore.get('localSequence')),
      ]);
      const nextSequence = (sequenceRow?.value ?? 0) + 1;
      const plan = planner(command, {
        entities: toEntityMap(viewEntities),
        outbox,
      }, nextSequence);

      if (!plan.duplicate) {
        viewStore.put(clone(plan.entity));
        outboxStore.put(clone(plan.outbox));
        metaStore.put({ key: 'localSequence', value: nextSequence });
      }
      await done;
      return clone(plan);
    } catch (error) {
      try { transaction.abort(); } catch {}
      try { await done; } catch {}
      throw error;
    }
  }

  async exportRecovery() {
    const names = Object.values(STORE_NAMES);
    const transaction = this.database.transaction(names, 'readonly');
    const done = transactionDone(transaction);
    const entries = await Promise.all(names.map(async (name) => [
      name,
      await requestResult(transaction.objectStore(name).getAll()),
    ]));
    await done;
    return {
      format: 'travsen-local-recovery',
      version: 1,
      exportedAt: new Date().toISOString(),
      identity: clone(this.identity),
      stores: Object.fromEntries(entries.map(([name, rows]) => [name, clone(rows)])),
    };
  }

  close() {
    this.database.close();
  }
}

export function openIndexedDb(identity, options = {}) {
  const normalized = normalizeLocalIdentity(identity);
  const indexedDb = options.indexedDB ?? globalThis.indexedDB;
  if (!indexedDb) {
    return Promise.reject(new Error('IndexedDB недоступна в этом окружении.'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDb.open(localDatabaseName(normalized), LOCAL_DB_VERSION);
    request.addEventListener('upgradeneeded', (event) => {
      upgradeLocalDatabase(request.result, event.oldVersion);
    });
    request.addEventListener('blocked', () => {
      settled = true;
      reject(new Error('Обновление локальной базы заблокировано другой вкладкой.'));
    }, { once: true });
    request.addEventListener('error', () => {
      settled = true;
      reject(request.error ?? new Error('Не удалось открыть IndexedDB.'));
    }, { once: true });
    request.addEventListener('success', async () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      database.addEventListener('versionchange', () => database.close());
      const store = new IndexedDbLocalStore(database, normalized);
      try {
        await store.initialize();
        settled = true;
        resolve(store);
      } catch (error) {
        database.close();
        settled = true;
        reject(error);
      }
    }, { once: true });
  });
}
