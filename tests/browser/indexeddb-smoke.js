import {
  createAccountCommand,
  createCategoryCommand,
  recordExpenseCommand,
} from '../../finance/core/commands.js';
import { FinanceRepository } from '../../finance/repository.js';

const result = document.querySelector('#result');
const identity = { backendId: 'local-smoke', uid: 'demo-user', bookId: 'stage-1', epoch: 'epoch-1' };
const createdAt = '2026-09-14T08:00:00.000Z';
const options = (opId, entityId) => ({ opId, entityId, createdAt });

try {
  const first = new FinanceRepository();
  await first.open(identity);
  await first.dispatch(createAccountCommand(
    { name: 'Тестовая карта', kind: 'bank', currency: 'RUB' },
    options('op_browser_account', 'account_browser'),
  ));
  await first.dispatch(createCategoryCommand(
    { name: 'Тестовая категория', iconId: 'local:test', color: '#818cf8' },
    options('op_browser_category', 'category_browser'),
  ));
  await first.dispatch(recordExpenseCommand({
    date: '2026-09-14', accountId: 'account_browser', categoryId: 'category_browser',
    amountMinor: 12345, currency: 'RUB', note: 'Проверка перезапуска',
  }, options('op_browser_expense', 'txn_browser')));
  first.close();

  const reopened = new FinanceRepository();
  await reopened.open(identity);
  const expenses = await reopened.query({ type: 'expenses' });
  const pending = await reopened.query({ type: 'pending-count' });
  const passed = expenses.length === 1 && expenses[0].amountMinor === 12345 && pending === 3;
  if (!passed) throw new Error(`После повторного открытия получено расходов: ${expenses.length}, очередь: ${pending}.`);
  result.textContent = 'PASS\nРасход, счёт, категория и три команды очереди пережили закрытие и повторное открытие IndexedDB.';
  reopened.close();
} catch (error) {
  result.textContent = `FAIL\n${error.stack ?? error.message}`;
  document.body.dataset.failed = 'true';
}
