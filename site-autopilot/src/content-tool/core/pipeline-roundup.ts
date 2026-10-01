import fs from 'node:fs';
import path from 'node:path';
import type { PlaceRole, PlacesData } from './types.js';
import type { RawPlace } from '../services/types.js';
import { AppError } from './errors.js';
import { errorMessage, normText, nowIso } from './util.js';
import { applyPlaceRoles, buildPlaces, buildRoundupNotes, dishNoun, featuredPlaces, heuristicClassify, photoFileName, placeForRole, renumberPlaces, splitKeyword, titleCaseWords } from './roundup.js';
import { requireArtifact, throwIfCancelled, type StepContext, type StepResult } from './pipeline.js';

/**
 * Ba bước đầu của bài "tổng hợp quán theo khu vực", thay cho tìm Google, tải nguồn, rút ghi chú:
 *   search  → tìm quán trên Google Maps, lọc, gộp chi nhánh, xếp hạng
 *   fetch   → lấy đánh giá của các quán được chọn, rút ý, tải ảnh
 *   extract → dựng ghi chú tư liệu từ dữ liệu quán (không gọi model)
 * Các bước bố cục, viết, biên tập, kiểm tra, xuất dùng chung với bài thường.
 */

export function roundupInputs(ctx: StepContext): { dish: string; area: string } {
  const o = ctx.run.options;
  const guess = splitKeyword(ctx.run.keyword);
  const dish = (o.dish || guess.dish).trim();
  const area = titleCaseWords((o.area || guess.area).trim());
  if (!dish || !area) throw new AppError('Bài tổng hợp quán cần cả "món hoặc loại quán" và "khu vực". Tạo lại bài với hai ô này.');
  return { dish, area };
}

export async function stepPlaces(ctx: StepContext): Promise<StepResult> {
  const { run, db, settings } = ctx;
  const { dish, area } = roundupInputs(ctx);
  const maps = ctx.services.maps();
  const language = settings.language || 'vi';
  const center = await maps.geocode(area);
  ctx.count('searchCalls', 1);
  const query = `${dish} ${area}`;
  const raw: RawPlace[] = [];
  const seen = new Set<string>();
  const maxPages = Math.max(1, Math.ceil(settings.roundupCandidates / 20));
  let pages = 0;
  for (let page = 0; page < maxPages && raw.length < settings.roundupCandidates; page++) {
    throwIfCancelled(ctx);
    const r = await maps.searchPlaces(query, { page, center, language });
    ctx.count('searchCalls', 1);
    pages++;
    if (!r.length) break;
    for (const p of r) {
      const key = p.placeId || p.dataId || normText(`${p.title} ${p.address}`);
      if (seen.has(key)) continue;
      seen.add(key);
      raw.push(p);
    }
    if (r.length < 20) break;
  }
  if (!raw.length) throw new AppError(`Google Maps không trả về quán nào cho "${query}". Thử đổi cách gọi món hoặc khu vực (ví dụ thêm tên tỉnh).`);
  ctx.log(`Google Maps "${query}": ${raw.length} quán sau ${pages} trang${center ? ` quanh tâm ${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}` : ''}`);
  throwIfCancelled(ctx);
  // Model lọc theo nhóm; nhóm nào lỗi thì dùng quy tắc (tên hoặc loại hình chứa món, địa chỉ chứa khu vực)
  const fallback = heuristicClassify(raw, dish, area);
  let classes = fallback;
  try {
    const fromLlm = await ctx.llm.classifyPlaces({ dish, area, places: raw.map((p, i) => ({ index: i + 1, name: p.title, type: p.type, types: p.types, address: p.address, description: p.description })) });
    const got = new Map(fromLlm.map((c) => [c.index, c]));
    classes = fallback.map((f) => got.get(f.index) ?? f);
    if (got.size < raw.length) ctx.log(`Model chỉ phân loại được ${got.size}/${raw.length} quán, phần còn lại phân loại bằng quy tắc`, 'warn');
  } catch (err) {
    if (err instanceof AppError && err.code === 'cancelled') throw err;
    ctx.log(`Model lọc quán lỗi (${errorMessage(err)}), phân loại toàn bộ bằng quy tắc`, 'warn');
  }
  const { candidates, meanRating } = buildPlaces({ raw, classes, dish, area, minReviews: settings.roundupMinReviews, bayesM: settings.roundupBayesM, featuredCount: run.options.placesCount, userNotes: run.options.placeNotes, center, radiusKm: settings.roundupRadiusKm, minRating: settings.roundupMinRating });
  // dish trong dữ liệu là tên món/loại quán không kèm chữ "quán" ("quán ốc" → "ốc") để title, heading, từ khóa không thành "quán quán ốc"
  const data: PlacesData = { dish: dishNoun(dish), area, query, center, collectedAt: nowIso(), pagesFetched: pages, candidates, minReviews: settings.roundupMinReviews, bayesM: settings.roundupBayesM, meanRating, minRating: settings.roundupMinRating };
  db.saveArtifact(run.id, 'places', data);
  db.replaceSources(run.id, []);
  const featured = featuredPlaces(data);
  const eligible = candidates.filter((p) => !p.excludedReason).length;
  const merged = candidates.filter((p) => p.excludedReason?.startsWith('Gộp')).length;
  const msg = `${raw.length} quán trên Maps → ${eligible} đủ điều kiện (bỏ ${candidates.length - eligible}: ${merged} gộp chi nhánh, còn lại đóng cửa, sai khu vực, sai món hoặc dưới ${settings.roundupMinReviews} đánh giá) → chọn ${featured.length} quán vào bài`;
  ctx.log(msg);
  if (!featured.length) throw new AppError(`Không có quán nào đủ điều kiện cho "${query}". Hạ "Số đánh giá tối thiểu" trong Cài đặt hoặc mở rộng khu vực.`);
  if (featured.length < Math.min(5, run.options.placesCount)) ctx.log(`Chỉ có ${featured.length} quán đủ điều kiện, ít hơn mong muốn ${run.options.placesCount}`, 'warn');
  if (run.options.reviewPlaces) return { message: `${msg}. Đang chờ bạn duyệt danh sách quán.`, waiting: 'places' };
  return { message: msg };
}

export async function stepReviewsAndPhotos(ctx: StepContext): Promise<StepResult> {
  const { run, db, settings, config } = ctx;
  const data = renumberPlaces(requireArtifact<PlacesData>(ctx, 'places', 'danh sách quán'));
  const featured = featuredPlaces(data);
  if (!featured.length) throw new AppError('Chưa chọn quán nào vào bài. Tick chọn quán ở tab Quán rồi chạy lại.');
  const maps = ctx.services.maps();
  const language = settings.language || 'vi';
  let reviewsTotal = 0;
  for (const p of featured) {
    throwIfCancelled(ctx);
    if (!p.dataId) continue;
    try {
      p.reviewsFetched = await maps.reviews(p.dataId, { language, count: settings.roundupReviewsPerPlace, placeId: p.placeId });
      if (!p.reviewsFetched.length) ctx.log(`Google Maps không trả về nội dung đánh giá nào cho "${p.name}"`, 'warn');
      ctx.count('searchCalls', Math.max(1, Math.ceil(p.reviewsFetched.length / 8)));
      reviewsTotal += p.reviewsFetched.length;
    } catch (err) {
      ctx.log(`Không lấy được đánh giá của "${p.name}": ${errorMessage(err)}`, 'warn');
    }
  }
  throwIfCancelled(ctx);
  const summaries = await ctx.llm.summarizeReviews({ dish: data.dish, area: data.area, places: featured.map((p) => ({ index: p.rank, name: p.name, reviews: p.reviewsFetched })) });
  if (summaries.length < featured.filter((p) => p.reviewsFetched.length).length) ctx.log(`Chỉ rút được ý đánh giá cho ${summaries.length}/${featured.length} quán; quán thiếu sẽ chỉ có số liệu Maps`, 'warn');
  for (const s of summaries) {
    const p = featured.find((x) => x.rank === s.index);
    if (p) p.summary = s.summary;
  }
  throwIfCancelled(ctx);
  // Mỗi quán một vai riêng trong bài (không trùng), rút từ dữ liệu: model gán, quy tắc bù quán thiếu hoặc trùng vai
  let roles: { index: number; role: PlaceRole }[] = [];
  try {
    roles = await ctx.llm.assignPlaceRoles({ dish: data.dish, area: data.area, places: featured.map(placeForRole) });
  } catch (err) {
    if (err instanceof AppError && err.code === 'cancelled') throw err;
    ctx.log(`Gán vai cho quán lỗi (${errorMessage(err)}), dùng quy tắc`, 'warn');
  }
  const fromRules = applyPlaceRoles(featured, roles);
  if (fromRules) ctx.log(`${fromRules}/${featured.length} quán lấy vai từ quy tắc vì model thiếu hoặc trùng vai`, fromRules === featured.length ? 'warn' : 'info');
  let photos = 0;
  if (settings.roundupPhotos) {
    const dir = path.join(config.exportsDir, String(run.id));
    fs.mkdirSync(path.join(dir, 'photos'), { recursive: true });
    for (const p of featured) {
      throwIfCancelled(ctx);
      if (!p.thumbnail) continue;
      const img = await maps.downloadPhoto(p.thumbnail);
      if (!img) continue;
      const file = photoFileName(p, img.contentType);
      fs.writeFileSync(path.join(dir, file), img.data);
      p.photoFile = file;
      photos++;
    }
  }
  db.saveArtifact(run.id, 'places', data);
  const msg = `${reviewsTotal} đánh giá của ${featured.length} quán, rút ý cho ${summaries.length} quán, gán vai riêng cho ${featured.length} quán, tải ${photos} ảnh`;
  ctx.log(msg);
  return { message: msg };
}

export async function stepRoundupNotes(ctx: StepContext): Promise<StepResult> {
  const { run, db } = ctx;
  const data = requireArtifact<PlacesData>(ctx, 'places', 'danh sách quán');
  const notes = buildRoundupNotes(data, run.keyword, run.options);
  db.saveArtifact(run.id, 'notes', notes);
  const msg = `Ghi chú ${notes.totalWords} từ cho ${notes.roundup?.featured.length ?? 0} quán, ${notes.topics.length} nhãn`;
  ctx.log(msg);
  return { message: msg };
}
