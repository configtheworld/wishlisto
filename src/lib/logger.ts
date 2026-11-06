export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levels: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const REDACTED = '[redacted]';
const SENSITIVE = /pass(word)?|secret|token|cookie|authorization|recovery|csrf/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[deep]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE.test(k) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export function createLogger(minLevel: LogLevel = 'info', base: Record<string, unknown> = {}): Logger {
  const threshold = levels[minLevel];
  const write = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (levels[level] < threshold) return;
    const line = {
      time: new Date().toISOString(),
      level,
      msg,
      ...(redact(base) as Record<string, unknown>),
      ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
    };
    process.stdout.write(`${JSON.stringify(line)}\n`);
  };
  return {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
    child: (f) => createLogger(minLevel, { ...base, ...f }),
  };
}
