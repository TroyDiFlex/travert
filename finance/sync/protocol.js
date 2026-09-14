import { FinanceValidationError } from '../core/money.js';
import { requireId } from '../core/entities.js';

export const PROTOCOL_VERSION = 2;

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256(value, cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.subtle) throw new Error('Web Crypto SHA-256 недоступен.');
  const data = new TextEncoder().encode(typeof value === 'string' ? value : canonicalJson(value));
  return bytesToHex(await cryptoApi.subtle.digest('SHA-256', data));
}

export async function freezeOutboxRequest(identity, deviceId, outboxItem, cryptoApi) {
  requireId(outboxItem.opId, 'opId');
  requireId(deviceId, 'deviceId');
  if (outboxItem.dependsOn.length) {
    throw new FinanceValidationError('Команда ещё зависит от неподтверждённых изменений.', 'dependsOn', 'pending-dependency');
  }
  const payload = {
    protocolVersion: PROTOCOL_VERSION,
    bookId: identity.bookId,
    epoch: identity.epoch,
    deviceId,
    opId: outboxItem.opId,
    changes: [structuredClone(outboxItem.change)],
  };
  return Object.freeze({ ...payload, payloadHash: await sha256(payload, cryptoApi) });
}

export async function verifyFrozenRequest(request, cryptoApi) {
  const { payloadHash, ...payload } = request;
  return typeof payloadHash === 'string' && payloadHash === await sha256(payload, cryptoApi);
}

export function validateReceipt(receipt, request) {
  if (!receipt || typeof receipt !== 'object') throw new Error('Сервер не вернул квитанцию.');
  if (receipt.opId !== request.opId || receipt.payloadHash !== request.payloadHash) {
    throw new Error('Квитанция не соответствует отправленной команде.');
  }
  if (!Number.isSafeInteger(receipt.seq) || receipt.seq < 1) throw new Error('Квитанция содержит неверный seq.');
  if (!Array.isArray(receipt.results) || receipt.results.length !== request.changes.length) {
    throw new Error('Квитанция содержит неверный набор результатов.');
  }
  for (const result of receipt.results) {
    requireId(result.id, 'receipt.results.id');
    if (!Number.isSafeInteger(result.version) || result.version < 1) throw new Error('Квитанция содержит неверную версию.');
  }
  return receipt;
}

export function validateCommitPage(page, { epoch, afterSeq }) {
  if (!page || page.epoch !== epoch || !Array.isArray(page.commits)) {
    throw new Error('Сервер вернул страницу другой эпохи или неверного формата.');
  }
  let expected = afterSeq + 1;
  for (const commit of page.commits) {
    if (commit.seq !== expected) throw new Error(`Нарушена последовательность журнала: ожидался ${expected}.`);
    requireId(commit.opId, 'commit.opId');
    if (!Array.isArray(commit.changes) || commit.changes.length < 1) throw new Error('Пустой commit недопустим.');
    for (const change of commit.changes) {
      requireId(change.id, 'commit.change.id');
      if (typeof change.entityType !== 'string' || !change.value || change.value.id !== change.id || change.value.entityType !== change.entityType) {
        throw new Error('Commit содержит несогласованную сущность.');
      }
      if (change.value.key !== `${change.entityType}:${change.id}`) throw new Error('Commit содержит неверный ключ сущности.');
      if (!Number.isSafeInteger(change.value.version) || change.value.version < 1) {
        throw new Error('Серверная версия должна быть положительной.');
      }
    }
    expected += 1;
  }
  if (!Number.isSafeInteger(page.headSeq) || page.headSeq < afterSeq) throw new Error('Некорректный headSeq.');
  if (page.commits.at(-1)?.seq > page.headSeq) throw new Error('Журнал вышел за объявленный headSeq.');
  return page;
}
