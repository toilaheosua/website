/** Lỗi nghiệp vụ có thông điệp tiếng Việt hiển thị thẳng cho người dùng. */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code = 'app_error',
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** Lỗi tạm thời (mạng, rate limit, 5xx): bước được chạy lại tự động. */
export class TransientError extends AppError {
  constructor(message: string) {
    super(message, 'transient');
    this.name = 'TransientError';
  }
}

/** Thiếu khóa hoặc cấu hình: dừng bước, hướng người dùng vào Cài đặt. */
export class ConfigError extends AppError {
  constructor(message: string) {
    super(message, 'config');
    this.name = 'ConfigError';
  }
}
