const CURRENCY_DEFINITIONS = {
  RUB: { code: 'RUB', scale: 2, symbol: '₽', name: 'Российский рубль' },
  USD: { code: 'USD', scale: 2, symbol: '$', name: 'Доллар США' },
  EUR: { code: 'EUR', scale: 2, symbol: '€', name: 'Евро' },
};

export const CURRENCIES = Object.freeze(
  Object.fromEntries(
    Object.entries(CURRENCY_DEFINITIONS).map(([code, definition]) => [code, Object.freeze(definition)]),
  ),
);

export class FinanceValidationError extends Error {
  constructor(message, field = null, code = 'invalid-value') {
    super(message);
    this.name = 'FinanceValidationError';
    this.field = field;
    this.code = code;
  }
}

export function requireCurrency(code) {
  const currency = CURRENCIES[code];
  if (!currency) {
    throw new FinanceValidationError('Поддерживаются валюты RUB, USD и EUR.', 'currency', 'unsupported-currency');
  }
  return currency;
}

export function assertMinorUnits(value, field = 'amountMinor', { positive = false, allowZero = true } = {}) {
  if (!Number.isSafeInteger(value)) {
    throw new FinanceValidationError('Сумма вышла за безопасный целочисленный диапазон.', field, 'unsafe-money');
  }
  if (positive && value <= 0) {
    throw new FinanceValidationError('Сумма должна быть больше нуля.', field, 'non-positive-money');
  }
  if (!allowZero && value === 0) {
    throw new FinanceValidationError('Нулевая сумма недопустима.', field, 'zero-money');
  }
  return value;
}

export function addMinorUnits(...values) {
  let total = 0;
  for (const value of values) {
    assertMinorUnits(value);
    total += value;
    assertMinorUnits(total);
  }
  return total;
}

export function parseMoney(input, currencyCode) {
  const { scale } = requireCurrency(currencyCode);
  if (typeof input !== 'string') {
    throw new FinanceValidationError('Введите сумму текстом.', 'amount', 'invalid-money-text');
  }

  const value = input.trim().replace(/\s/g, '');
  const match = /^([+-]?)(\d+)(?:[.,](\d+))?$/.exec(value);
  if (!match) {
    throw new FinanceValidationError('Введите сумму в формате 1250,50.', 'amount', 'invalid-money-text');
  }

  const fraction = match[3] ?? '';
  if (fraction.length > scale) {
    throw new FinanceValidationError(`Для ${currencyCode} допустимо не больше ${scale} знаков после запятой.`, 'amount', 'money-scale');
  }

  const factor = 10n ** BigInt(scale);
  const major = BigInt(match[2]);
  const paddedFraction = fraction.padEnd(scale, '0');
  const fractionMinor = paddedFraction ? BigInt(paddedFraction) : 0n;
  const sign = match[1] === '-' ? -1n : 1n;
  const minor = sign * (major * factor + fractionMinor);

  if (minor > BigInt(Number.MAX_SAFE_INTEGER) || minor < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new FinanceValidationError('Сумма вышла за безопасный диапазон.', 'amount', 'unsafe-money');
  }
  return Number(minor);
}

export function moneyToDecimal(minor, currencyCode) {
  const { scale } = requireCurrency(currencyCode);
  assertMinorUnits(minor);
  const sign = minor < 0 ? '-' : '';
  const absolute = BigInt(Math.abs(minor));
  const factor = 10n ** BigInt(scale);
  const major = absolute / factor;
  if (scale === 0) return `${sign}${major}`;
  return `${sign}${major}.${String(absolute % factor).padStart(scale, '0')}`;
}

export function formatMoney(minor, currencyCode, locale = 'ru-RU') {
  const { scale } = requireCurrency(currencyCode);
  assertMinorUnits(minor);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
  }).format(minor / (10 ** scale));
}

export function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function requireCalendarDate(value, field = 'date') {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) {
    throw new FinanceValidationError('Дата должна иметь формат ГГГГ-ММ-ДД.', field, 'invalid-date');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) {
    throw new FinanceValidationError('Такой календарной даты не существует.', field, 'invalid-date');
  }
  return value;
}

export function requireCalendarMonth(value, field = 'month') {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? '');
  if (!match || Number(match[1]) < 1 || Number(match[2]) < 1 || Number(match[2]) > 12) {
    throw new FinanceValidationError('Месяц должен иметь формат ГГГГ-ММ.', field, 'invalid-month');
  }
  return value;
}

export function monthFromDate(date) {
  return requireCalendarDate(date).slice(0, 7);
}
