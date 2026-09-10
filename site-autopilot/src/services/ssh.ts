import fs from 'node:fs';
import path from 'node:path';
import { Client, type ConnectConfig, type SFTPWrapper } from 'ssh2';
import type { ServerConn, SshClient } from './types.js';
import { AppError, TransientError } from '../core/errors.js';

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

  const uploadDirectory = async (localDir: string, remoteDir: string, opts: { owner?: string } = {}) => {
    const files: { rel: string; abs: string; size: number }[] = [];
    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(abs);
        else if (ent.isFile()) files.push({ rel: path.relative(localDir, abs).split(path.sep).join('/'), abs, size: fs.statSync(abs).size });
      }
    };
    walk(localDir);

    const staging = `${remoteDir}.uploading`;
    const dirs = new Set<string>(['']);
    for (const f of files) {
      const parts = f.rel.split('/');
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    }
    const mkdirs = [...dirs].map((d) => shq(d ? `${staging}/${d}` : staging)).join(' ');
    const prep = await exec(`rm -rf ${shq(staging)} && mkdir -p ${mkdirs}`);
    if (prep.code !== 0) throw new AppError(`Không tạo được thư mục tạm trên server: ${prep.stderr || prep.stdout}`);

    const s = await sftp();
    let bytes = 0;
    const queue = [...files];
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
    const owner = opts.owner ?? 'www:www';
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
    return { files: files.length, bytes };
  };

  return {
    exec,
    uploadDirectory,
    close: async () => {
      conn.end();
    },
  };
}
