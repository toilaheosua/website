import { GeneralSettingsSchema, RunOptionsSchema, type Article, type GeneralSettings, type Outline, type OutlineSection, type PlacesData, type RunOptions } from '../core/types.js';
import { parseList } from '../core/util.js';
import { titleCaseWords } from '../core/roundup.js';

export type FormBody = Record<string, string | File | (string | File)[]>;

export function str(body: FormBody, key: string): string {
  const v = body[key];
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : '';
  return typeof v === 'string' ? v : '';
}

export function num(body: FormBody, key: string, fallback: number): number {
  const n = Number.parseFloat(str(body, key).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

export function bool(body: FormBody, key: string): boolean {
  const v = str(body, key);
  return v === 'on' || v === '1' || v === 'true';
}

export function lines(body: FormBody, key: string): string[] {
  return str(body, key)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseRunOptions(body: FormBody, s: GeneralSettings): RunOptions {
  const kindRaw = str(body, 'kind');
  const kind = kindRaw === 'roundup' ? 'roundup' : kindRaw === 'brand' ? 'brand' : 'web';
  const min = Math.round(num(body, 'minWords', kind === 'roundup' ? s.roundupMinWords : kind === 'brand' ? s.brandMinWords : s.articleMinWords));
  const max = Math.round(num(body, 'maxWords', kind === 'roundup' ? s.roundupMaxWords : kind === 'brand' ? s.brandMaxWords : s.articleMaxWords));
  return RunOptionsSchema.parse({
    kind,
    dish: str(body, 'dish').trim().replace(/\s+/g, ' ').slice(0, 120),
    // Khu vực là tên riêng: "phan rang" thành "Phan Rang" để title, alt ảnh, heading đúng chính tả
    area: titleCaseWords(str(body, 'area').trim().replace(/\s+/g, ' ').slice(0, 120)),
    placesCount: Math.max(3, Math.min(20, Math.round(num(body, 'placesCount', s.roundupPlaces)))),
    reviewPlaces: bool(body, 'reviewPlaces'),
    placeNotes: str(body, 'placeNotes').trim().slice(0, 4000),
    mapsUrl: str(body, 'mapsUrl').trim().slice(0, 2000),
    brandName: str(body, 'brandName').trim().replace(/\s+/g, ' ').slice(0, 120),
    brandInfo: str(body, 'brandInfo').trim().slice(0, 6000),
    brandIncludeCons: bool(body, 'brandIncludeCons'),
    provider: str(body, 'provider') || 'default',
    style: str(body, 'style') || s.defaultStyle,
    reviewOutline: bool(body, 'reviewOutline'),
    voice: str(body, 'voice') || s.defaultVoice,
    dialect: str(body, 'dialect') || s.defaultDialect,
    audience: str(body, 'audience').trim().slice(0, 500),
    notes: str(body, 'notes').trim().slice(0, 3000),
    secondaryKeywords: parseList(str(body, 'secondaryKeywords')).slice(0, 20),
    minWords: Math.max(300, Math.min(min, 5000)),
    maxWords: Math.max(Math.max(300, Math.min(min, 5000)) + 100, Math.min(max, 6000)),
    comparison: kind === 'web' ? bool(body, 'comparison') : false,
  });
}

export function parseGeneralSettings(body: FormBody, cur: GeneralSettings): GeneralSettings {
  const pct = (key: string, fallback: number) => Math.min(1, Math.max(0, num(body, key, fallback * 100) / 100));
  return GeneralSettingsSchema.parse({
    ...cur,
    searchProvider: str(body, 'searchProvider') || cur.searchProvider,
    googleDomain: str(body, 'googleDomain').trim() || cur.googleDomain,
    country: str(body, 'country').trim().toLowerCase() || cur.country,
    language: str(body, 'language').trim().toLowerCase() || cur.language,
    resultsCount: Math.round(num(body, 'resultsCount', cur.resultsCount)),
    searchMaxPages: Math.round(num(body, 'searchMaxPages', cur.searchMaxPages)),
    minSources: Math.round(num(body, 'minSources', cur.minSources)),
    maxSources: Math.round(num(body, 'maxSources', cur.maxSources)),
    englishFallback: bool(body, 'englishFallback'),
    blockedDomains: parseList(str(body, 'blockedDomains')).map((d) => d.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')),
    notesMinWords: Math.round(num(body, 'notesMinWords', cur.notesMinWords)),
    notesMaxWords: Math.round(num(body, 'notesMaxWords', cur.notesMaxWords)),
    articleMinWords: Math.round(num(body, 'articleMinWords', cur.articleMinWords)),
    articleMaxWords: Math.round(num(body, 'articleMaxWords', cur.articleMaxWords)),
    defaultStyle: str(body, 'defaultStyle') || cur.defaultStyle,
    defaultVoice: str(body, 'defaultVoice') || cur.defaultVoice,
    defaultDialect: str(body, 'defaultDialect') || cur.defaultDialect,
    styleSamples: str(body, 'styleSamples').trim().slice(0, 8000),
    comparisonMode: bool(body, 'comparisonMode'),
    topSitesPriority: Math.round(num(body, 'topSitesPriority', cur.topSitesPriority)),
    roundupMinReviews: Math.round(num(body, 'roundupMinReviews', cur.roundupMinReviews)),
    roundupRadiusKm: num(body, 'roundupRadiusKm', cur.roundupRadiusKm),
    roundupBayesM: Math.round(num(body, 'roundupBayesM', cur.roundupBayesM)),

    roundupMinRating: num(body, 'roundupMinRating', cur.roundupMinRating),
    roundupCandidates: Math.round(num(body, 'roundupCandidates', cur.roundupCandidates)),
    roundupPlaces: Math.round(num(body, 'roundupPlaces', cur.roundupPlaces)),
    roundupMinWords: Math.round(num(body, 'roundupMinWords', cur.roundupMinWords)),
    roundupMaxWords: Math.round(num(body, 'roundupMaxWords', cur.roundupMaxWords)),
    roundupPhotos: bool(body, 'roundupPhotos'),
    roundupReviewsPerPlace: Math.round(num(body, 'roundupReviewsPerPlace', cur.roundupReviewsPerPlace)),
    brandPhotos: Math.round(num(body, 'brandPhotos', cur.brandPhotos)),
    brandReviews: Math.round(num(body, 'brandReviews', cur.brandReviews)),
    brandMinWords: Math.round(num(body, 'brandMinWords', cur.brandMinWords)),
    brandMaxWords: Math.round(num(body, 'brandMaxWords', cur.brandMaxWords)),
    photoBaseUrl: str(body, 'photoBaseUrl').trim().slice(0, 300),
    aiScoreMax: pct('aiScoreMax', cur.aiScoreMax),
    dupRatioMax: pct('dupRatioMax', cur.dupRatioMax),
    shingleSize: Math.round(num(body, 'shingleSize', cur.shingleSize)),
    maxFixRounds: Math.round(num(body, 'maxFixRounds', cur.maxFixRounds)),
    detectorMode: str(body, 'detectorMode') || cur.detectorMode,
    maxManualScans: Math.round(num(body, 'maxManualScans', cur.maxManualScans)),
    originalityModel: str(body, 'originalityModel').trim() || cur.originalityModel,
    webPlagiarismCheck: bool(body, 'webPlagiarismCheck'),
    skipAiDetection: bool(body, 'skipAiDetection'),
    writerModel: str(body, 'writerModel').trim() || cur.writerModel,
    researchModel: str(body, 'researchModel').trim() || cur.researchModel,
    effort: str(body, 'effort') || cur.effort,
    llmProvider: str(body, 'llmProvider') || cur.llmProvider,
    openrouterWriterModel: str(body, 'openrouterWriterModel').trim() || cur.openrouterWriterModel,
    openrouterResearchModel: str(body, 'openrouterResearchModel').trim() || cur.openrouterResearchModel,
    openrouterTemperature: num(body, 'openrouterTemperature', cur.openrouterTemperature),
    openrouterReasoning: str(body, 'openrouterReasoning') || cur.openrouterReasoning,
    deepseekWriterModel: str(body, 'deepseekWriterModel').trim() || cur.deepseekWriterModel,
    deepseekResearchModel: str(body, 'deepseekResearchModel').trim() || cur.deepseekResearchModel,
    deepseekTemperature: num(body, 'deepseekTemperature', cur.deepseekTemperature),
    llmFallback: bool(body, 'llmFallback'),
  });
}

/**
 * Đọc điểm AI người dùng nhập từ web Originality.ai. Chấp nhận "23", "23%", "23,5" hoặc cả đoạn văn bản
 * dán từ trang kết quả ("AI 23% Original 77%"). Trả về 0..1, hoặc null nếu không hiểu.
 */
export function parseAiScoreInput(raw: string): number | null {
  const t = raw.replace(/,/g, '.').trim();
  if (!t) return null;
  const pct = (v: number) => (Number.isFinite(v) && v >= 0 && v <= 100 ? v / 100 : null);
  const onlyNumber = /^(\d{1,3}(?:\.\d+)?)\s*%?$/.exec(t);
  if (onlyNumber) return pct(Number.parseFloat(onlyNumber[1]!));
  const aiFirst = /(?:\bAI\b|\bFake\b|\bmáy\b)[^\d%]{0,25}(\d{1,3}(?:\.\d+)?)\s*%/i.exec(t);
  if (aiFirst) return pct(Number.parseFloat(aiFirst[1]!));
  const pctFirst = /(\d{1,3}(?:\.\d+)?)\s*%[^\w%]{0,10}(?:AI|Fake)\b/i.exec(t);
  if (pctFirst) return pct(Number.parseFloat(pctFirst[1]!));
  const original = /(?:\bOriginal\b|\bHuman\b|\bReal\b)[^\d%]{0,25}(\d{1,3}(?:\.\d+)?)\s*%/i.exec(t) ?? /(\d{1,3}(?:\.\d+)?)\s*%[^\w%]{0,10}(?:Original|Human|Real)\b/i.exec(t);
  if (original) {
    const o = pct(Number.parseFloat(original[1]!));
    return o === null ? null : Math.round((1 - o) * 10000) / 10000;
  }
  const any = /(\d{1,3}(?:\.\d+)?)\s*%/.exec(t);
  return any ? pct(Number.parseFloat(any[1]!)) : null;
}

/**
 * Bố cục trong ô sửa dạng văn bản:
 *   ## Heading H2   hoặc   ### Heading H3
 *   Mục tiêu: ...
 *   Nhãn: cách chế biến
 *   Dạng: text | steps | table | checklist | mixed
 *   So sánh: đối tượng A | đối tượng B
 *   Tiêu chí: tiêu chí 1 | tiêu chí 2
 *   - điểm cần viết
 */
export function outlineSectionsToText(sections: OutlineSection[]): string {
  return sections
    .map((s) =>
      [
        `${s.level === 3 ? '###' : '##'} ${s.heading}`,
        `Mục tiêu: ${s.goal}`,
        ...(s.tag ? [`Nhãn: ${s.tag}`] : []),
        `Dạng: ${s.format}`,
        ...(s.comparisonItems?.length ? [`So sánh: ${s.comparisonItems.join(' | ')}`] : []),
        ...(s.comparisonCriteria?.length ? [`Tiêu chí: ${s.comparisonCriteria.join(' | ')}`] : []),
        ...s.points.map((p) => `- ${p}`),
      ].join('\n'),
    )
    .join('\n\n');
}

const splitBar = (v: string) => v.split(/\s*\|\s*|\s*;\s*/).map((x) => x.trim()).filter(Boolean);

export function parseOutlineSections(text: string, previous: OutlineSection[]): OutlineSection[] {
  const out: OutlineSection[] = [];
  let cur: OutlineSection | null = null;
  const formats = new Set(['text', 'steps', 'table', 'checklist', 'mixed']);
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const h = /^(#{2,3})\s+(.+)$/.exec(line);
    if (h) {
      cur = { heading: h[2]!.trim(), level: h[1]!.length === 3 ? 3 : 2, goal: '', points: [], sourceRefs: [], format: 'text', tag: '', comparisonItems: [], comparisonCriteria: [] };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    const goal = /^mục tiêu\s*:\s*(.*)$/i.exec(line);
    if (goal) {
      cur.goal = goal[1]!.trim();
      continue;
    }
    const tag = /^(?:nhãn|tag)\s*:\s*(.*)$/i.exec(line);
    if (tag) {
      cur.tag = tag[1]!.trim();
      continue;
    }
    const cmp = /^so sánh\s*:\s*(.*)$/i.exec(line);
    if (cmp) {
      cur.comparisonItems = splitBar(cmp[1]!.replace(/\s+vs\s+/gi, ' | '));
      continue;
    }
    const crit = /^tiêu chí\s*:\s*(.*)$/i.exec(line);
    if (crit) {
      cur.comparisonCriteria = splitBar(crit[1]!);
      continue;
    }
    const fmt = /^dạng\s*:\s*(\w+)/i.exec(line);
    if (fmt && formats.has(fmt[1]!.toLowerCase())) {
      cur.format = fmt[1]!.toLowerCase() as OutlineSection['format'];
      continue;
    }
    const point = /^[-*•]\s*(.+)$/.exec(line);
    if (point) cur.points.push(point[1]!.trim());
    else cur.points.push(line);
  }
  // Giữ sourceRefs của mục cũ có heading giống hoặc cùng vị trí
  return out.map((s, i) => {
    const prev = previous.find((p) => p.heading.trim().toLowerCase() === s.heading.toLowerCase()) ?? previous[i];
    return { ...s, sourceRefs: prev?.sourceRefs ?? [], goal: s.goal || prev?.goal || '', tag: s.tag || prev?.tag || '' };
  });
}

export function parseOutlineForm(body: FormBody, cur: Outline): Outline {
  const sections = parseOutlineSections(str(body, 'sections'), cur.sections);
  const style = str(body, 'style');
  return {
    ...cur,
    title: str(body, 'title').trim() || cur.title,
    h1: str(body, 'h1').trim() || cur.h1,
    metaDescription: str(body, 'metaDescription').trim() || cur.metaDescription,
    style: style === 'story' || style === 'expert' || style === 'playbook' ? style : cur.style,
    hookIdea: str(body, 'hookIdea').trim() || cur.hookIdea,
    quickSummary: lines(body, 'quickSummary').length ? lines(body, 'quickSummary') : cur.quickSummary,
    sections: sections.length ? sections : cur.sections,
    faq: lines(body, 'faq').length ? lines(body, 'faq') : cur.faq,
    nextSteps: str(body, 'nextSteps').trim() || cur.nextSteps,
    secondaryKeywords: parseList(str(body, 'secondaryKeywords')).length ? parseList(str(body, 'secondaryKeywords')) : cur.secondaryKeywords,
    targetWords: Math.round(num(body, 'targetWords', cur.targetWords)),
  };
}

/** Tab Quán: người dùng tick quán đưa vào bài và ghi chú trải nghiệm thật của mình cho từng quán. */
export function parsePlacesForm(body: FormBody, cur: PlacesData): PlacesData {
  const candidates = cur.candidates.map((p, i) => {
    const note = str(body, `p${i}_note`).trim().slice(0, 1000);
    const eligible = !p.excludedReason;
    return { ...p, featured: eligible ? bool(body, `p${i}_featured`) : false, userNote: note };
  });
  return { ...cur, candidates };
}

export function parseArticleForm(body: FormBody, cur: Article): Article {
  const sections = cur.sections.map((s, i) => {
    const lvl = str(body, `s${i}_level`);
    return { heading: str(body, `s${i}_heading`).trim() || s.heading, level: lvl === '3' ? 3 : lvl === '2' ? 2 : s.level, body: str(body, `s${i}_body`).trim() || s.body } as Article['sections'][number];
  });
  const faq = cur.faq.map((f, i) => ({ question: str(body, `f${i}_q`).trim() || f.question, answer: str(body, `f${i}_a`).trim() || f.answer }));
  return {
    ...cur,
    title: str(body, 'title').trim() || cur.title,
    metaDescription: str(body, 'metaDescription').trim() || cur.metaDescription,
    h1: str(body, 'h1').trim() || cur.h1,
    excerpt: str(body, 'excerpt').trim() || cur.excerpt,
    quickSummary: lines(body, 'quickSummary'),
    intro: str(body, 'intro').trim() || cur.intro,
    sections,
    faq,
    nextSteps: str(body, 'nextSteps').trim(),
  };
}
