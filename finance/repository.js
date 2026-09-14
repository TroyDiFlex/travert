import { planLocalCommand } from './core/commands.js';
import { runSelector } from './core/selectors.js';
import { openIndexedDb } from './local/db.js';

export class FinanceRepository {
  constructor({ openLocalStore = openIndexedDb } = {}) {
    this.openLocalStore = openLocalStore;
    this.localStore = null;
    this.identity = null;
    this.listeners = new Set();
    this.generation = 0;
  }

  async open(identity) {
    const generation = ++this.generation;
    this.localStore?.close?.();
    const store = await this.openLocalStore(identity);
    if (generation !== this.generation) {
      store.close?.();
      throw new Error('Открытие книги отменено сменой пользователя.');
    }
    this.localStore = store;
    this.identity = structuredClone(store.identity ?? identity);
    await this.#notify();
    return this;
  }

  async query(selector) {
    this.#requireOpen();
    const state = await this.localStore.readState();
    return runSelector(state, selector);
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Подписчик должен быть функцией.');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async dispatch(command) {
    this.#requireOpen();
    const generation = this.generation;
    const plan = await this.localStore.commitCommand(command, planLocalCommand);
    if (generation !== this.generation) throw new Error('Книга была сменена во время сохранения.');
    const state = await this.localStore.readState();
    await this.#notify(state);
    return {
      status: 'saved-local',
      duplicate: plan.duplicate,
      opId: plan.outbox.opId,
      entity: structuredClone(plan.entity),
      pendingCount: state.outbox.filter((item) => !['cancelled', 'resolved'].includes(item.state)).length,
    };
  }

  async exportRecovery() {
    this.#requireOpen();
    return this.localStore.exportRecovery();
  }

  close() {
    this.generation += 1;
    this.localStore?.close?.();
    this.localStore = null;
    this.identity = null;
  }

  #requireOpen() {
    if (!this.localStore) throw new Error('Сначала откройте локальную книгу.');
  }

  async #notify(existingState = null) {
    if (!this.localStore || this.listeners.size === 0) return;
    const state = existingState ?? await this.localStore.readState();
    for (const listener of this.listeners) {
      try {
        listener(structuredClone(state));
      } catch (error) {
        queueMicrotask(() => { throw error; });
      }
    }
  }
}

export function createFinanceRepository(options) {
  return new FinanceRepository(options);
}
