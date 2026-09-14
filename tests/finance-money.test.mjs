import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FinanceValidationError,
  addMinorUnits,
  moneyToDecimal,
  parseMoney,
  requireCalendarDate,
  requireCalendarMonth,
} from '../finance/core/money.js';

test('money parsing stays exact and respects currency scale', () => {
  assert.equal(parseMoney('1 250,05', 'RUB'), 125005);
  assert.equal(parseMoney('0.10', 'USD'), 10);
  assert.equal(parseMoney('-3', 'EUR'), -300);
  assert.equal(moneyToDecimal(125005, 'RUB'), '1250.05');
  assert.throws(() => parseMoney('1.001', 'RUB'), FinanceValidationError);
  assert.throws(() => parseMoney('1e3', 'RUB'), FinanceValidationError);
  assert.throws(() => parseMoney('NaN', 'RUB'), FinanceValidationError);
});

test('money totals fail instead of losing integer precision', () => {
  assert.equal(addMinorUnits(10, -4, 2), 8);
  assert.throws(() => addMinorUnits(Number.MAX_SAFE_INTEGER, 1), /безопасный/);
});

test('calendar dates are checked without UTC conversion', () => {
  assert.equal(requireCalendarDate('2024-02-29'), '2024-02-29');
  assert.throws(() => requireCalendarDate('2026-02-29'), /не существует/);
  assert.throws(() => requireCalendarDate('2026-13-01'), /не существует/);
  assert.equal(requireCalendarMonth('2026-09'), '2026-09');
  assert.throws(() => requireCalendarMonth('2026-00'), /формат/);
});
