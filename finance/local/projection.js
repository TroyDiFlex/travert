import { entityKey, toEntityMap } from '../core/entities.js';

export function applyChange(entities, change) {
  const next = new Map(entities);
  next.set(entityKey(change.entityType, change.id), structuredClone(change.value));
  return next;
}

export function materializeProjection(serverEntities, outbox) {
  let projection = toEntityMap(serverEntities);
  const ordered = [...outbox]
    .filter((item) => !['cancelled', 'resolved'].includes(item.state))
    .sort((left, right) => left.localSequence - right.localSequence);
  for (const item of ordered) projection = applyChange(projection, item.change);
  return [...projection.values()];
}
