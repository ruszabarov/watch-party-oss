import pino, { type Logger } from 'pino';

type LogFields = Record<string, unknown>;

const isProduction = import.meta.env.PROD;

export const logger = pino({
  level: isProduction ? 'silent' : 'debug',
  browser: {
    asObject: true,
  },
});

export function createLogger(scope: string): Logger {
  return logger.child({ scope });
}

export async function logDuration<T>(
  log: Logger,
  message: string,
  fields: LogFields,
  action: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();

  try {
    const result = await action();
    log.debug({ ...fields, durationMs: elapsedMs(startedAt) }, `${message}:ok`);
    return result;
  } catch (error) {
    log.warn(
      { ...fields, durationMs: elapsedMs(startedAt), error: getLogError(error) },
      `${message}:failed`,
    );
    throw error;
  }
}

export function elapsedMs(startedAt: number): number {
  return Number((performance.now() - startedAt).toFixed(1));
}

export function getLogError(error: unknown): LogFields {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return { message: String(error) };
}
