// Структуровані JSON-логи: один рядок на подію.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const min = LEVELS[process.env.LOG_LEVEL || 'info'] ?? 20;

function write(level, msg, fields) {
  if (LEVELS[level] < min) return;
  process.stdout.write(JSON.stringify({ level, time: new Date().toISOString(), msg, ...fields }) + '\n');
}

module.exports = {
  debug: (m, f) => write('debug', m, f),
  info: (m, f) => write('info', m, f),
  warn: (m, f) => write('warn', m, f),
  error: (m, f) => write('error', m, f),
};
