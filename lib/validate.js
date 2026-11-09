const { fail } = require('./errors');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Перевірка цілого числа. Повертає { value } або { error }.
function checkInt(value, rules) {
  // з адресного рядка числа приходять як текст "42", тож перетворюємо
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    value = Number(value);
  }
  if (!Number.isSafeInteger(value)) return { error: { rule: 'int' } };
  if (rules.min !== undefined && value < rules.min) return { error: { rule: 'min', min: rules.min } };
  if (rules.max !== undefined && value > rules.max) return { error: { rule: 'max', max: rules.max } };
  return { value };
}

// Перевірка масиву.
function checkArray(value, rules) {
  if (!Array.isArray(value)) return { error: { rule: 'array' } };
  if (rules.min !== undefined && value.length < rules.min) return { error: { rule: 'minItems', min: rules.min } };
  if (rules.max !== undefined && value.length > rules.max) return { error: { rule: 'maxItems', max: rules.max } };
  if (rules.of && value.some((item) => typeof item !== rules.of)) return { error: { rule: 'items' } };
  return { value };
}

// Перевірка тексту (і email як різновиду тексту).
function checkString(value, rules) {
  if (typeof value !== 'string') return { error: { rule: 'string' } };
  value = value.trim();
  if (rules.type === 'email' && !EMAIL_REGEX.test(value)) return { error: { rule: 'email' } };
  if (rules.min !== undefined && value.length < rules.min) return { error: { rule: 'minLength', min: rules.min } };
  if (rules.max !== undefined && value.length > rules.max) return { error: { rule: 'maxLength', max: rules.max } };
  if (rules.pattern && !rules.pattern.test(value)) return { error: { rule: 'pattern' } };
  return { value };
}

function checkField(value, rules) {
  if (rules.type === 'int') return checkInt(value, rules);
  if (rules.type === 'array') return checkArray(value, rules);
  if (rules.type === 'bool') {
    return typeof value === 'boolean' ? { value } : { error: { rule: 'bool' } };
  }
  return checkString(value, rules);
}

// Перевіряє вхідні дані за схемою і повертає ЛИШЕ поля, описані в схемі.
// Приклад схеми: { email: { type: 'email' }, age: { type: 'int', min: 18, optional: true } }
// Правила: type ('string' | 'int' | 'bool' | 'email' | 'array'), min, max, optional, enum, pattern, of
// Якщо є помилки, кидає 'validation' зі списком усіх помилок одразу.
function check(input, schema) {
  const source = input && typeof input === 'object' ? input : {};
  const result = {};
  const errors = [];

  for (const field of Object.keys(schema)) {
    const rules = schema[field];
    const value = source[field];

    const isEmpty = value === undefined || value === null || value === '';
    if (isEmpty) {
      if (!rules.optional) errors.push({ field, rule: 'required' });
      continue;
    }

    const checked = checkField(value, rules);
    if (checked.error) {
      errors.push({ field, ...checked.error });
      continue;
    }
    if (rules.enum && !rules.enum.includes(checked.value)) {
      errors.push({ field, rule: 'enum', allowed: rules.enum });
      continue;
    }
    result[field] = checked.value;
  }

  if (errors.length > 0) {
    fail('validation', 'Invalid input', { errors });
  }
  return result;
}

// Алгоритм Луна для номерів карток: кожна друга цифра справа подвоюється
// (якщо вийшло більше 9, віднімаємо 9), все додається, сума має ділитися на 10.
function luhn(cardNumber) {
  let sum = 0;
  for (let i = 0; i < cardNumber.length; i++) {
    let digit = Number(cardNumber[cardNumber.length - 1 - i]);
    if (i % 2 === 1) {
      digit = digit * 2;
      if (digit > 9) digit = digit - 9;
    }
    sum = sum + digit;
  }
  return sum % 10 === 0;
}

module.exports = { check, luhn };
