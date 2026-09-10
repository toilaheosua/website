/** Lỗi nghiệp vụ: hiển thị nguyên văn cho người dùng và không thử lại tự động. */
export class AppError extends Error {
  readonly retryable: boolean;
  readonly details?: unknown;
  constructor(message: string, opts: { retryable?: boolean; details?: unknown; cause?: unknown } = {}) {
    super(message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = 'AppError';
    this.retryable = opts.retryable ?? false;
    this.details = opts.details;
  }
}

/** Lỗi tạm thời từ dịch vụ bên ngoài (mạng, 5xx, rate limit): nên thử lại. */
export class TransientError extends AppError {
  constructor(message: string, opts: { details?: unknown; cause?: unknown } = {}) {
    super(message, { ...opts, retryable: true });
    this.name = 'TransientError';
  }
}

/** Thiếu cấu hình: người dùng cần bổ sung .env hoặc cài đặt. */
export class ConfigError extends AppError {
  constructor(message: string) {
    super(message, { retryable: false });
    this.name = 'ConfigError';
  }
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof AppError) return err.retryable;
  if (err instanceof Error) {
    const m = err.message.toLowerCase();
    return /econnreset|etimedout|econnrefused|socket hang up|fetch failed|429|502|503|504|timeout/.test(m);
  }
  return false;
}
