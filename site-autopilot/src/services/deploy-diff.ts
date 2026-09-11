import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Tải lên tăng dần: so hash tệp cục bộ với tệp đang có trên host, chỉ tải tệp mới hoặc đổi, xóa tệp thừa.
 * Dùng chung cho SSH thật (md5sum trên host) và deploy giả lập.
 */

export interface LocalFile {
  rel: string;
  abs: string;
  size: number;
  md5: string;
}

export interface UploadPlan {
  upload: LocalFile[];
  remove: string[];
  unchanged: number;
}

export function listLocalFiles(localDir: string): LocalFile[] {
  const files: LocalFile[] = [];
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile()) {
        const buf = fs.readFileSync(abs);
        files.push({ rel: path.relative(localDir, abs).split(path.sep).join('/'), abs, size: buf.length, md5: crypto.createHash('md5').update(buf).digest('hex') });
      }
    }
  };
  walk(localDir);
  return files;
}

/** Đọc kết quả `md5sum` trên host: mỗi dòng "<md5>  ./đường/dẫn". */
export function parseMd5sum(output: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of output.split('\n')) {
    const m = line.match(/^([0-9a-f]{32})\s+\*?(.+)$/);
    if (!m) continue;
    const rel = (m[2] as string).trim().replace(/^\.\//, '');
    if (rel) out.set(rel, m[1] as string);
  }
  return out;
}

export function planUpload(local: LocalFile[], remote: Map<string, string>): UploadPlan {
  const upload: LocalFile[] = [];
  let unchanged = 0;
  const localSet = new Set<string>();
  for (const f of local) {
    localSet.add(f.rel);
    if (remote.get(f.rel) === f.md5) unchanged++;
    else upload.push(f);
  }
  const remove = [...remote.keys()].filter((rel) => !localSet.has(rel));
  return { upload, remove, unchanged };
}
