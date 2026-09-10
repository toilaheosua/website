import type { Notifier } from './types.js';
import { httpRequest } from '../core/http.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('telegram');

export class TelegramNotifier implements Notifier {
  constructor(private readonly token: string, private readonly chatId: string) {}

  async send(message: string): Promise<void> {
    if (!this.token || !this.chatId) return;
    try {
      await httpRequest(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: this.chatId, text: message.slice(0, 4000), disable_web_page_preview: true }),
        timeoutMs: 10_000,
      });
    } catch (err) {
      log.warn('Gửi Telegram thất bại', { err: (err as Error).message });
    }
  }
}

export class NoopNotifier implements Notifier {
  async send(): Promise<void> {
    /* không cấu hình Telegram */
  }
}
