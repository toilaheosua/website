/**
 * CLI tiện ích. Ví dụ:
 *   npm run cli -- list
 *   npm run cli -- create --domain vidu.com --brand "Điện lạnh Minh" --industry "Sửa điện lạnh" --location "Quận 7"
 *   npm run cli -- retry vidu.com cf_waf
 *   npm run cli -- build vidu.com
 *   npm run cli -- deploy vidu.com
 *   npm run cli -- test
 *   npm run cli -- run-once        (chạy worker cho đến khi hết việc, dùng cho cron)
 */
import fs from 'node:fs';
import { loadConfig } from './config.js';
import { Db } from './db/index.js';
import { createServices, ensureDefaultServer } from './services/index.js';
import { STEPS } from './core/steps.js';
import { runBuild, runDeploy } from './core/steps.js';
import { Worker } from './core/worker.js';
import { makeStepContext } from './core/context.js';
import { dependentsOf, progressOf, type StepId } from './core/pipeline.js';
import { EntitySchema, SiteBriefSchema } from './core/types.js';
import { normalizeDomain, parseList, sleep } from './core/util.js';
import { connectSsh } from './services/ssh.js';

function args(): { cmd: string; pos: string[]; opts: Record<string, string> } {
  const [, , cmd = 'help', ...rest] = process.argv;
  const pos: string[] = [];
  const opts: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] as string;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        opts[key] = next;
        i++;
      } else opts[key] = '1';
    } else pos.push(a);
  }
  return { cmd, pos, opts };
}

async function main() {
  const { cmd, pos, opts } = args();
  const config = loadConfig();
  fs.mkdirSync(config.sitesDir, { recursive: true });
  fs.mkdirSync(config.uploadsDir, { recursive: true });
  const db = new Db(config.dbPath);
  const services = createServices(config, db);
  ensureDefaultServer(config, db);

  const siteByArg = (d: string | undefined) => {
    const site = d ? db.getSiteByDomain(normalizeDomain(d)) : undefined;
    if (!site) throw new Error(`Không tìm thấy site ${d ?? ''}`);
    return site;
  };

  switch (cmd) {
    case 'list': {
      for (const s of db.listSites()) {
        const p = progressOf(STEPS, db.listSteps(s.id));
        console.log(`${s.id}\t${s.domain.padEnd(28)}\t${s.status.padEnd(10)}\t${p.done}/${p.total}\t${s.error_summary ?? ''}`);
      }
      break;
    }
    case 'create': {
      const domain = normalizeDomain(opts.domain ?? '');
      if (!domain) throw new Error('Thiếu --domain');
      if (db.getSiteByDomain(domain)) throw new Error('Domain đã tồn tại');
      const server = db.listServers()[0];
      if (!server) throw new Error('Chưa có server (cấu hình AAPANEL_* trong .env)');
      const general = db.getGeneralSettings();
      const brief = SiteBriefSchema.parse({
        brandName: opts.brand ?? domain,
        siteType: opts.type ?? 'business',
        language: opts.lang ?? general.defaultLanguage,
        industry: opts.industry ?? 'Dịch vụ',
        description: opts.description ?? '',
        services: parseList(opts.services),
        keywords: parseList(opts.keywords),
        location: opts.location ?? '',
        postsCount: Number.parseInt(opts.posts ?? String(general.defaultPostsCount), 10),
        targetCountries: general.defaultTargetCountries,
      });
      const entity = EntitySchema.parse({ name: brief.brandName, telephone: opts.phone ?? '', email: opts.email ?? '' });
      const id = db.createSite({ domain, server_id: server.id, brief, entity });
      db.ensureSteps(id, STEPS.map((s) => s.id));
      console.log(`Đã tạo site #${id} ${domain}. Khởi động dashboard (npm run dev) hoặc chạy "run-once" để xử lý.`);
      break;
    }
    case 'retry': {
      const site = siteByArg(pos[0]);
      const step = pos[1] as StepId;
      if (!STEPS.some((s) => s.id === step)) throw new Error(`Bước không hợp lệ. Các bước: ${STEPS.map((s) => s.id).join(', ')}`);
      const all = opts.from ? dependentsOf(STEPS, step) : [step];
      db.resetStepsFrom(site.id, all);
      db.updateSite(site.id, { status: 'building', error_summary: null });
      console.log(`Đã đặt lại: ${all.join(', ')}`);
      break;
    }
    case 'build': {
      const site = siteByArg(pos[0]);
      const ctx = makeStepContext(db, config, services, site, 'cli-build');
      const r = await runBuild(ctx);
      console.log(`Đã dựng ${r.files} tệp tại ${r.urls.length} URL`);
      break;
    }
    case 'deploy': {
      const site = siteByArg(pos[0]);
      const ctx = makeStepContext(db, config, services, site, 'cli-deploy');
      const r = await runDeploy(ctx);
      console.log(`Đã tải lên ${r.files} tệp`);
      break;
    }
    case 'test': {
      console.log('Cloudflare:', await services.cloudflare.verifyToken().catch((e: Error) => ({ ok: false, message: e.message })));
      const server = db.listServers()[0];
      if (server) {
        console.log('aaPanel:', await services.panelFor(server).ping().catch((e: Error) => ({ ok: false, message: e.message })));
        if (!config.isMock) {
          try {
            const ssh = await connectSsh(server);
            const r = await ssh.exec('id && nginx -v 2>&1');
            await ssh.close();
            console.log('SSH:', { ok: r.code === 0, message: (r.stdout + r.stderr).trim() });
          } catch (e) {
            console.log('SSH:', { ok: false, message: (e as Error).message });
          }
        }
      } else console.log('aaPanel: chưa có server');
      break;
    }
    case 'run-once': {
      const worker = new Worker({ db, config, services, steps: STEPS });
      let idle = 0;
      while (idle < 3) {
        const started = await worker.tick();
        if (started === 0 && worker.activeCount === 0) idle++;
        else idle = 0;
        await sleep(2000);
      }
      console.log('Không còn việc.');
      break;
    }
    default:
      console.log(`Lệnh: list | create --domain ... | retry <domain> <step> [--from] | build <domain> | deploy <domain> | test | run-once`);
  }
  db.close();
}

main().catch((err) => {
  console.error('Lỗi:', (err as Error).message);
  process.exit(1);
});
