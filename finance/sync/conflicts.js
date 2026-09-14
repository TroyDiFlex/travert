export class SyncConflictError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'SyncConflictError';
    this.code = 'version-conflict';
    this.details = structuredClone(details);
  }
}

export class SyncEpochError extends Error {
  constructor(expectedEpoch, actualEpoch) {
    super('Серверная эпоха книги изменилась.');
    this.name = 'SyncEpochError';
    this.code = 'epoch-changed';
    this.expectedEpoch = expectedEpoch;
    this.actualEpoch = actualEpoch;
  }
}

export function createConflictRecord(outboxItem, error, now = new Date().toISOString()) {
  return {
    conflictId: `conflict:${outboxItem.opId}`,
    opId: outboxItem.opId,
    entityType: outboxItem.change.entityType,
    entityId: outboxItem.change.id,
    reason: error.code ?? 'version-conflict',
    base: structuredClone(outboxItem.before),
    local: structuredClone(outboxItem.change.value),
    server: structuredClone(error.details?.server ?? null),
    expectedVersion: outboxItem.change.expectedVersion,
    serverVersion: error.details?.server?.version ?? null,
    createdAt: now,
    resolvedAt: null,
    resolution: null,
  };
}
