export const LOCAL_DB_VERSION = 1;
export const FINANCE_SCHEMA_VERSION = 1;
export const SYNC_PROTOCOL_VERSION = 2;

export const STORE_NAMES = Object.freeze({
  SERVER_ENTITIES: 'serverEntities',
  VIEW_ENTITIES: 'viewEntities',
  OUTBOX: 'outbox',
  CONFLICTS: 'conflicts',
  META: 'meta',
  STAGING: 'staging',
});

export function upgradeLocalDatabase(database, oldVersion) {
  if (oldVersion >= 1) return;

  database.createObjectStore(STORE_NAMES.SERVER_ENTITIES, { keyPath: 'key' });
  const view = database.createObjectStore(STORE_NAMES.VIEW_ENTITIES, { keyPath: 'key' });
  view.createIndex('byType', 'entityType');
  view.createIndex('byTypeDate', ['entityType', 'date']);
  view.createIndex('byAccountDate', ['accountId', 'date']);
  view.createIndex('byCategoryMonth', ['categoryId', 'month']);
  view.createIndex('bySourceMonth', ['sourceId', 'month']);
  view.createIndex('byAccountIds', 'accountIds', { multiEntry: true });

  const outbox = database.createObjectStore(STORE_NAMES.OUTBOX, { keyPath: 'opId' });
  outbox.createIndex('byState', 'state');
  outbox.createIndex('byLocalSequence', 'localSequence', { unique: true });

  database.createObjectStore(STORE_NAMES.CONFLICTS, { keyPath: 'conflictId' });
  database.createObjectStore(STORE_NAMES.META, { keyPath: 'key' });
  database.createObjectStore(STORE_NAMES.STAGING, { keyPath: 'key' });
}
