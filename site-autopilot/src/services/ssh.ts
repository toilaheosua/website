import fs from 'node:fs';
import path from 'node:path';
import { Client, type ConnectConfig, type SFTPWrapper } from 'ssh2';
import type { ServerConn, SshClient } from './types.js';
import { AppError, TransientError } from '../core/errors.js';
import { listLocalFiles, parseMd5sum, planUpload } from './deploy-diff.js';

/** Quote chuỗi an toàn cho shell POSIX. */
export function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function connectConfig(server: ServerConn): ConnectConfig {
  const cfg: ConnectConfig = {
    host: server.ssh_host || server.ip,
    port: server.ssh_port || 22,
    username: server.ssh_user || 'root',
    readyTimeout: 20_000,
    keepaliveInterval: 10_000,
  };
  if (server.ssh_key_path) {
    try {
      cfg.privateKey = fs.readFileSync(server.ssh_key_path);
    } catch {
      throw new AppError(`Không đọc được khóa SSH tại ${server.ssh_key_path}`);
    }
    if (server.ssh_password) cfg.passphrase = server.ssh_password;
  } else if (server.ssh_password) {
    cfg.password = server.ssh_password;
  } else {
    throw new AppError('Thiếu SSH_KEY_PATH hoặc SSH_PASSWORD cho server');
  }
  return cfg;
}

export async function connectSsh(server: ServerConn): Promise<SshClient> {
  const conn = new Client();
  const cfg = connectConfig(server);
  await new Promise<void>((resolve, reject) => {
    conn.on('ready', () => resolve());
    conn.on('error', (err) => reject(new TransientError(`SSH tới ${cfg.host}:${cfg.port} lỗi: ${err.message}`, { cause: err })));
    conn.connect(cfg);
  });

  const exec = (command: string, opts: { timeoutMs?: number } = {}) =>
    new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new TransientError(`Lệnh SSH quá thời gian: ${command.slice(0, 80)}`)), opts.timeoutMs ?? 120_000);
      conn.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          return reject(new TransientError(`SSH exec lỗi: ${err.message}`, { cause: err }));
        }
        let stdout = '';
        let stderr = '';
        stream.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
        stream.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
        stream.on('close', (code: number | null) => {
          clearTimeout(timer);
          resolve({ code: code ?? 0, stdout, stderr });
        });
      });
    });

  const sftp = () =>
    new Promise<SFTPWrapper>((resolve, reject) => {
      conn.sftp((err, s) => (err ? reject(new TransientError(`SFTP lỗi: ${err.message}`, { cause: err })) : resolve(s)));
    });

  /**
   * Đưa bản dựng lên host theo kiểu tăng dần và nguyên tử:
   * 1. Lấy md5 các tệp đang có trên host, so với bản cục bộ → chỉ tải tệp mới hoặc đổi, xóa tệp thừa.
   * 2. Sao chép thư mục hiện tại sang thư mục tạm, áp thay đổi vào đó (site đang chạy không bị đụng).
   * 3. Hoán đổi thư mục tạm vào vị trí chính.
   * Không có gì thay đổi thì không hoán đổi.
   */
  const uploadDirectory = async (localDir: string, remoteDir: string, opts: { owner?: string } = {}) => {
    const files = listLocalFiles(localDir);
    const staging = `${remoteDir}.uploading`;
    const owner = opts.owner ?? 'www:www';

    // Băm tệp trên host (thư mục chưa có thì coi như rỗng)
    const hashed = await exec(`if [ -d ${shq(remoteDir)} ]; then cd ${shq(remoteDir)} && find . -type f -exec md5sum {} +; else echo __NO_DIR__; fi`, { timeoutMs: 180_000 });
    const remoteExists = !hashed.stdout.includes('__NO_DIR__');
    const remote = remoteExists ? parseMd5sum(hashed.stdout) : new Map<string, string>();
    const plan = planUpload(files, remote);
    if (remoteExists && plan.upload.length === 0 && plan.remove.length === 0) {
      return { files: 0, bytes: 0, unchanged: plan.unchanged, removed: 0 };
    }

    // Thư mục tạm = bản sao thư mục hiện tại (hoặc rỗng), rồi tạo các thư mục con cần cho tệp mới
    const dirs = new Set<string>();
    for (const f of plan.upload) {
      const parts = f.rel.split('/');
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    }
    const mkdirs = [staging, ...[...dirs].map((d) => `${staging}/${d}`)].map(shq).join(' ');
    const copy = remoteExists ? `cp -a ${shq(remoteDir)} ${shq(staging)} && ` : '';
    const removes = plan.remove.map((rel) => `rm -f ${shq(`${staging}/${rel}`)}`).join(' && ');
    const prep = await exec(`rm -rf ${shq(staging)} && ${copy}mkdir -p ${mkdirs}${removes ? ' && ' + removes : ''}`, { timeoutMs: 180_000 });
    if (prep.code !== 0) throw new AppError(`Không tạo được thư mục tạm trên server: ${prep.stderr || prep.stdout}`);

    const s = await sftp();
    let bytes = 0;
    const queue = [...plan.upload];
    const workers = Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const f = queue.shift();
        if (!f) break;
        await new Promise<void>((resolve, reject) => {
          s.fastPut(f.abs, `${staging}/${f.rel}`, (err) => (err ? reject(new TransientError(`Tải lên ${f.rel} lỗi: ${err.message}`, { cause: err })) : resolve()));
        });
        bytes += f.size;
      }
    });
    await Promise.all(workers);
    s.end();

    // Hoán đổi thư mục: giữ site cũ ở .old cho đến khi bản mới vào đúng vị trí, rồi dọn.
    const swap = [
      `rm -rf ${shq(remoteDir + '.old')}`,
      `if [ -d ${shq(remoteDir)} ]; then chattr -i ${shq(remoteDir + '/.user.ini')} 2>/dev/null; mv ${shq(remoteDir)} ${shq(remoteDir + '.old')}; fi`,
      `mv ${shq(staging)} ${shq(remoteDir)}`,
      `chown -R ${owner} ${shq(remoteDir)}`,
      `find ${shq(remoteDir)} -type d -exec chmod 755 {} + && find ${shq(remoteDir)} -type f -exec chmod 644 {} +`,
      `rm -rf ${shq(remoteDir + '.old')}`,
    ].join(' && ');
    const res = await exec(swap);
    if (res.code !== 0) throw new AppError(`Hoán đổi thư mục site thất bại: ${res.stderr || res.stdout}`);
    return { files: plan.upload.length, bytes, unchanged: plan.unchanged, removed: plan.remove.length };
  };

  return {
    exec,
    uploadDirectory,
    close: async () => {
      conn.end();
    },
  };
}
