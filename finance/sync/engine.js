import { createConflictRecord, SyncConflictError, SyncEpochError } from './conflicts.js';
import { freezeOutboxRequest, validateCommitPage, validateReceipt, verifyFrozenRequest } from './protocol.js';

const ACTIVE_STATES = new Set(['pending', 'sending', 'unknown']);

export class SyncEngine {
  constructor({ localStore, remote, identity, deviceId, crypto = globalThis.crypto, clock = () => new Date().toISOString() }) {
    this.localStore = localStore;
    this.remote = remote;
    this.identity = structuredClone(identity);
    this.deviceId = deviceId;
    this.crypto = crypto;
    this.clock = clock;
    this.running = false;
    this.syncPromise = null;
    this.listeners = new Set();
    this.status = { phase: 'idle', pendingCount: 0, lastConfirmedSyncAt: null, error: null };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(structuredClone(this.status));
    return () => this.listeners.delete(listener);
  }

  start() {
    this.running = true;
    return this.syncNow();
  }

  stop() {
    this.running = false;
  }

  syncNow() {
    if (this.syncPromise) return this.syncPromise;
    const promise = this.#run().finally(() => {
      if (this.syncPromise === promise) this.syncPromise = null;
    });
    this.syncPromise = promise;
    return promise;
  }

  async #run() {
    this.#setStatus({ phase: 'syncing', error: null });
    try {
      await this.#pullToHead();
      while (true) {
        const state = await this.localStore.readState();
        const candidates = state.outbox
          .filter((item) => ACTIVE_STATES.has(item.state))
          .sort((left, right) => left.localSequence - right.localSequence);
        const remainingIds = new Set(state.outbox.map((item) => item.opId));
        const next = candidates.find((item) => item.dependsOn.every((opId) => !remainingIds.has(opId)));
        if (!next) break;

        let request = next.frozenRequest;
        if (!request) request = await freezeOutboxRequest(this.identity, this.deviceId, { ...next, dependsOn: [] }, this.crypto);
        else if (!await verifyFrozenRequest(request, this.crypto)) throw new Error('Замороженный запрос очереди повреждён.');

        await this.localStore.updateOutbox(next.opId, (item) => ({
          ...item,
          state: 'sending',
          dependsOn: [],
          frozenRequest: structuredClone(request),
          lastAttemptAt: this.clock(),
        }));

        let receipt;
        try {
          receipt = validateReceipt(await this.remote.commit({ identity: this.identity, request }), request);
        } catch (error) {
          if (error instanceof SyncConflictError) {
            const current = await this.localStore.getOutbox(next.opId);
            await this.localStore.recordConflict(createConflictRecord(current, error, this.clock()));
            this.#setStatus({ phase: 'conflict', error: error.message });
            continue;
          }
          if (error instanceof SyncEpochError) {
            await this.localStore.updateOutbox(next.opId, (item) => ({ ...item, state: 'blocked', blockReason: 'epoch-changed' }));
            this.#setStatus({ phase: 'blocked', error: error.message });
            return this.status;
          }
          await this.localStore.updateOutbox(next.opId, (item) => ({ ...item, state: 'unknown' }));
          this.#setStatus({ phase: 'offline', error: error.message });
          return this.status;
        }

        await this.localStore.updateOutbox(next.opId, (item) => ({
          ...item,
          state: 'committed-awaiting-pull',
          receipt: structuredClone(receipt),
        }));
        await this.#pullToSequence(receipt.seq);
      }

      const state = await this.localStore.readState();
      const pendingCount = state.outbox.filter((item) => !['cancelled', 'resolved'].includes(item.state)).length;
      const hasConflicts = state.conflicts.some((conflict) => !conflict.resolvedAt);
      this.#setStatus({
        phase: hasConflicts ? 'conflict' : pendingCount ? 'waiting' : 'synced',
        pendingCount,
        lastConfirmedSyncAt: state.meta.lastConfirmedSyncAt ?? this.status.lastConfirmedSyncAt,
        error: hasConflicts ? 'Нужно решить конфликт.' : null,
      });
      return this.status;
    } catch (error) {
      this.#setStatus({ phase: 'error', error: error.message });
      throw error;
    }
  }

  async #pullToHead() {
    while (true) {
      const state = await this.localStore.readState();
      const page = await this.remote.pull({
        identity: this.identity,
        epoch: this.identity.epoch,
        afterSeq: state.meta.cursor ?? 0,
        limit: 100,
      });
      validateCommitPage(page, { epoch: this.identity.epoch, afterSeq: state.meta.cursor ?? 0 });
      if (page.commits.length) await this.localStore.applyRemotePage(page, this.clock());
      if ((state.meta.cursor ?? 0) + page.commits.length >= page.headSeq) return;
      if (!page.commits.length) throw new Error('Сервер сообщил новые изменения, но вернул пустую страницу.');
    }
  }

  async #pullToSequence(targetSeq) {
    while (true) {
      const state = await this.localStore.readState();
      if ((state.meta.cursor ?? 0) >= targetSeq) return;
      const page = await this.remote.pull({
        identity: this.identity,
        epoch: this.identity.epoch,
        afterSeq: state.meta.cursor ?? 0,
        limit: 100,
      });
      validateCommitPage(page, { epoch: this.identity.epoch, afterSeq: state.meta.cursor ?? 0 });
      if (!page.commits.length) throw new Error('Квитанция есть, но подтверждённое изменение отсутствует в журнале.');
      await this.localStore.applyRemotePage(page, this.clock());
    }
  }

  #setStatus(patch) {
    this.status = { ...this.status, ...patch };
    for (const listener of this.listeners) listener(structuredClone(this.status));
  }
}
