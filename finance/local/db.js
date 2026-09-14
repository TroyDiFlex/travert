import {
  FINANCE_SCHEMA_VERSION,
  LOCAL_DB_VERSION,
  STORE_NAMES,
  SYNC_PROTOCOL_VERSION,
  upgradeLocalDatabase,
} from './migrations.js';
import { toEntityMap } from '../core/entities.js';
import { materializeProjection } from './projection.js';

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
    backendId: String(identity.backendId ?? 'local'),
    uid: String(identity.uid ?? 'local-user'),
    bookId: String(identity.bookId ?? 'default'),
    epoch: String(identity.epoch ?? 'local-epoch'),
  };
  for (const [field, value] of Object.entries(normalized)) safeNamePart(value, field);
  return Object.freeze(normalized);
}

export function localDatabaseName(identity) {
  const normalized = normalizeLocalIdentity(identity);
  return `travert-finance:${safeNamePart(normalized.backendId, 'backendId')}:${safeNamePart(normalized.uid, 'uid')}:${safeNamePart(normalized.bookId, 'bookId')}`;
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

  async getOutbox(opId) {
    const transaction = this.database.transaction(STORE_NAMES.OUTBOX, 'readonly');
    const done = transactionDone(transaction);
    const item = await requestResult(transaction.objectStore(STORE_NAMES.OUTBOX).get(opId));
    await done;
    return clone(item ?? null);
  }

  async updateOutbox(opId, updater) {
    const transaction = this.database.transaction(STORE_NAMES.OUTBOX, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAMES.OUTBOX);
    try {
      const current = await requestResult(store.get(opId));
      if (!current) throw new Error(`Команда очереди не найдена: ${opId}.`);
      const updated = updater(clone(current));
      if (!updated || updated.opId !== opId) throw new Error('Обновление очереди изменило opId.');
      store.put(clone(updated));
      await done;
      return clone(updated);
    } catch (error) {
      try { transaction.abort(); } catch {}
      try { await done; } catch {}
      throw error;
    }
  }

  async recordConflict(conflict) {
    const names = [STORE_NAMES.OUTBOX, STORE_NAMES.CONFLICTS];
    const transaction = this.database.transaction(names, 'readwrite');
    const done = transactionDone(transaction);
    const outboxStore = transaction.objectStore(STORE_NAMES.OUTBOX);
    try {
      const item = await requestResult(outboxStore.get(conflict.opId));
      if (!item) throw new Error('Конфликтующая команда не найдена в очереди.');
      outboxStore.put({ ...item, state: 'conflict', conflictId: conflict.conflictId });
      transaction.objectStore(STORE_NAMES.CONFLICTS).put(clone(conflict));
      await done;
    } catch (error) {
      try { transaction.abort(); } catch {}
      try { await done; } catch {}
      throw error;
    }
  }

  async applyRemotePage(page, confirmedAt = new Date().toISOString()) {
    const names = [
      STORE_NAMES.SERVER_ENTITIES,
      STORE_NAMES.VIEW_ENTITIES,
      STORE_NAMES.OUTBOX,
      STORE_NAMES.META,
    ];
    const transaction = this.database.transaction(names, 'readwrite');
    const done = transactionDone(transaction);
    const serverStore = transaction.objectStore(STORE_NAMES.SERVER_ENTITIES);
    const viewStore = transaction.objectStore(STORE_NAMES.VIEW_ENTITIES);
    const outboxStore = transaction.objectStore(STORE_NAMES.OUTBOX);
    const metaStore = transaction.objectStore(STORE_NAMES.META);

    try {
      const [serverEntities, outbox, cursorRow, epochRow] = await Promise.all([
        requestResult(serverStore.getAll()),
        requestResult(outboxStore.getAll()),
        requestResult(metaStore.get('cursor')),
        requestResult(metaStore.get('activeEpoch')),
      ]);
      const currentCursor = cursorRow?.value ?? 0;
      if (epochRow?.value !== page.epoch) throw new Error('Страница относится к другой эпохе.');
      if (page.commits[0]?.seq !== currentCursor + 1) throw new Error('Страница журнала больше не продолжает локальный cursor.');

      const serverMap = toEntityMap(serverEntities);
      const confirmedOpIds = new Set();
      let nextCursor = currentCursor;
      for (const commit of page.commits) {
        if (commit.seq !== nextCursor + 1) throw new Error('Страница журнала содержит пропуск.');
        nextCursor = commit.seq;
        confirmedOpIds.add(commit.opId);
        for (const change of commit.changes) {
          const entity = clone(change.value);
          serverMap.set(entity.key, entity);
          serverStore.put(entity);
        }
      }

      const remainingOutbox = outbox.filter((item) => !confirmedOpIds.has(item.opId));
      for (const opId of confirmedOpIds) outboxStore.delete(opId);
      const projection = materializeProjection([...serverMap.values()], remainingOutbox);
      viewStore.clear();
      for (const entity of projection) viewStore.put(clone(entity));
      metaStore.put({ key: 'cursor', value: nextCursor });
      metaStore.put({ key: 'lastConfirmedSyncAt', value: confirmedAt });
      await done;
      return { cursor: nextCursor, confirmedOpIds: [...confirmedOpIds] };
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
      format: 'travert-local-recovery',
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
