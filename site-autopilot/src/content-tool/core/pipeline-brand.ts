import fs from 'node:fs';
import path from 'node:path';
import type { PlacesData } from './types.js';
import { AppError } from './errors.js';
import { errorMessage, nowIso } from './util.js';
import { buildPlaces, photoFileName } from './roundup.js';
import { brandPlace, buildBrandNotes, parseMapsUrl } from './brand.js';
import { requireArtifact, throwIfCancelled, type StepContext, type StepResult } from './pipeline.js';

/**
 * Ba bước đầu của bài "giới thiệu thương hiệu": tìm địa điểm từ link Google Maps, lấy đánh giá và bộ ảnh,
 * dựng ghi chú từ dữ liệu Maps cộng thông tin người đặt bài. Các bước sau dùng chung.
 */

export async function stepBrandPlace(ctx: StepContext): Promise<StepResult> {
  const { run, db, settings } = ctx;
  const url = run.options.mapsUrl.trim();
  if (!url) throw new AppError('Bài giới thiệu thương hiệu cần link Google Maps của địa điểm.');
  const maps = ctx.services.maps();
  const language = settings.language || 'vi';
  const full = await maps.resolveUrl(url);
  const ref = parseMapsUrl(full);
  if (!ref.placeId && !ref.dataId && !ref.name) throw new AppError(`Không đọc được địa điểm từ link "${url}". Dán link đầy đủ từ nút "Chia sẻ" trên Google Maps (có tên địa điểm hoặc place_id).`);
  ctx.log(`Link Maps: ${ref.placeId ? `place_id ${ref.placeId}` : ref.dataId ? `data_id ${ref.dataId}` : `tên "${ref.name}"`}${ref.lat ? ` tại ${ref.lat.toFixed(4)}, ${ref.lng?.toFixed(4)}` : ''}`);
  const raw = await maps.lookupPlace(ref, { language });
  ctx.count('searchCalls', 1);
  if (!raw) throw new AppError('Google Maps không trả về địa điểm cho link này. Thử dán link khác của cùng địa điểm (nút Chia sẻ → Sao chép liên kết).');
  const { candidates, meanRating } = buildPlaces({ raw: [raw], classes: [{ index: 1, matchesDish: true, inArea: true, groupKey: '' }], dish: run.options.brandName || raw.title, area: '', minReviews: 0, bayesM: 1, featuredCount: 1, userNotes: '' });
  const p = candidates[0]!;
  p.excludedReason = null;
  p.rank = 1;
  p.featured = true;
  const data: PlacesData = { dish: run.options.brandName || raw.title, area: raw.address, query: url, center: raw.lat && raw.lng ? { lat: raw.lat, lng: raw.lng } : null, collectedAt: nowIso(), pagesFetched: 1, candidates, minReviews: 0, bayesM: 1, meanRating };
  db.saveArtifact(run.id, 'places', data);
  db.replaceSources(run.id, []);
  if (!run.options.brandName && run.keyword !== raw.title) db.updateRun(run.id, { keyword: raw.title });
  const msg = `${raw.title}: ${raw.rating.toFixed(1)} sao, ${raw.reviews} đánh giá, ${raw.address}`;
  ctx.log(msg);
  return { message: msg };
}

export async function stepBrandMedia(ctx: StepContext): Promise<StepResult> {
  const { run, db, settings, config } = ctx;
  const data = requireArtifact<PlacesData>(ctx, 'places', 'địa điểm');
  const p = brandPlace(data);
  if (!p) throw new AppError('Chưa có địa điểm. Chạy lại từ bước đầu.');
  const maps = ctx.services.maps();
  const language = settings.language || 'vi';
  try {
    p.reviewsFetched = await maps.reviews(p.dataId, { language, count: settings.brandReviews, placeId: p.placeId });
    ctx.count('searchCalls', Math.max(1, Math.ceil(p.reviewsFetched.length / 8)));
  } catch (err) {
    ctx.log(`Không lấy được đánh giá: ${errorMessage(err)}`, 'warn');
  }
  throwIfCancelled(ctx);
  const summaries = await ctx.llm.summarizeReviews({ dish: p.type || 'quán', area: data.area, places: [{ index: 1, name: p.name, reviews: p.reviewsFetched }] });
  if (summaries[0]) p.summary = summaries[0].summary;
  const dir = path.join(config.exportsDir, String(run.id));
  fs.mkdirSync(path.join(dir, 'photos'), { recursive: true });
  const urls = settings.brandPhotos > 0 ? await maps.photos(p.dataId, { count: settings.brandPhotos, language }).catch((err) => (ctx.log(`Không lấy được bộ ảnh: ${errorMessage(err)}`, 'warn'), [] as string[])) : [];
  if (urls.length) ctx.count('searchCalls', 1);
  const files: string[] = [];
  for (const [i, u] of (urls.length ? urls : p.thumbnail ? [p.thumbnail] : []).entries()) {
    throwIfCancelled(ctx);
    const img = await maps.downloadPhoto(u);
    if (!img) continue;
    const file = photoFileName({ ...p, rank: i + 1 }, img.contentType);
    fs.writeFileSync(path.join(dir, file), img.data);
    files.push(file);
  }
  p.photoFiles = files;
  p.photoFile = files[0] ?? null;
  db.saveArtifact(run.id, 'places', data);
  const msg = `${p.reviewsFetched.length} đánh giá, ${p.summary ? 'đã rút ý' : 'chưa rút được ý'}, tải ${files.length} ảnh`;
  ctx.log(msg);
  return { message: msg };
}

export async function stepBrandNotes(ctx: StepContext): Promise<StepResult> {
  const { run, db } = ctx;
  const data = requireArtifact<PlacesData>(ctx, 'places', 'địa điểm');
  const notes = buildBrandNotes(data, run.keyword, run.options);
  db.saveArtifact(run.id, 'notes', notes);
  const msg = `Ghi chú ${notes.totalWords} từ, ${notes.topics.length} nhãn${run.options.brandInfo.trim() ? ', có thông tin từ thương hiệu' : ', chưa có thông tin từ thương hiệu'}`;
  ctx.log(msg);
  return { message: msg };
}
