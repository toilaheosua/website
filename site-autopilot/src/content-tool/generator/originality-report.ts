import JSZip from 'jszip';
import { wordCount } from '../core/util.js';

/**
 * Đọc file .docx xuất từ nút "Export" trên app.originality.ai.
 * File không ghi điểm tổng; mỗi đoạn chữ (w:r) mang màu nền w:shd theo bản đồ nhiệt của Originality.ai:
 * đỏ = giống văn máy, vàng = lưng chừng, xanh = giống người viết. Tool đổi màu thành xác suất AI 0..1,
 * lấy các câu ở vùng đỏ làm "câu bị đánh dấu" và ước tính điểm tổng theo số từ.
 */

export interface ReportRun {
  text: string;
  fill: string | null;
  /** 0..1, null nếu đoạn không có màu */
  ai: number | null;
}

export interface OriginalityReport {
  runs: ReportRun[];
  totalWords: number;
  /** Số từ nằm trong vùng AI ≥ 0.5 */
  flaggedWords: number;
  /** Điểm AI ước tính theo số từ (0..1) */
  estimatedAi: number;
  /** Các câu ở vùng đỏ, để vòng sửa viết lại đúng chỗ */
  flagged: string[];
  /** Văn bản đầy đủ đã quét */
  text: string;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/** Đổi màu nền pastel của Originality.ai thành xác suất AI: đỏ (hue 0°) → 1, xanh (hue ≥ 120°) → 0. */
export function fillToAiScore(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return null; // xám hoặc trắng: không phải màu đánh giá
  let hue: number;
  if (max === r) hue = 60 * (((g - b) / (max - min)) % 6);
  else if (max === g) hue = 60 * ((b - r) / (max - min) + 2);
  else hue = 60 * ((r - g) / (max - min) + 4);
  if (hue < 0) hue += 360;
  if (hue > 180) return null; // xanh dương, tím: không nằm trong thang đỏ→xanh lá
  return Math.max(0, Math.min(1, 1 - hue / 120));
}

/** Tách câu đơn giản cho tiếng Việt và tiếng Anh. */
function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+(?=[\p{Lu}"“(\d])/u)
    .map((s) => s.trim())
    .filter((s) => wordCount(s) >= 3);
}

/** Phân tích word/document.xml: gom các đoạn chữ và màu nền. */
export function parseOriginalityDocumentXml(xml: string, flagThreshold = 0.5): OriginalityReport {
  const runs: ReportRun[] = [];
  const paraRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let pm: RegExpExecArray | null;
  while ((pm = paraRe.exec(xml))) {
    const para = pm[1] ?? '';
    const runRe = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
    let rm: RegExpExecArray | null;
    let any = false;
    while ((rm = runRe.exec(para))) {
      const run = rm[1] ?? '';
      const fill = /<w:shd\b[^>]*w:fill="([0-9a-fA-F]{6})"/.exec(run)?.[1] ?? null;
      const text = [...run.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((t) => decodeXml(t[1] ?? '')).join('') + (/<w:br\b/.test(run) ? '\n' : '');
      if (!text.trim()) continue;
      any = true;
      runs.push({ text, fill, ai: fill ? fillToAiScore(fill) : null });
    }
    if (any) runs.push({ text: '\n', fill: null, ai: null });
  }
  let totalWords = 0;
  let flaggedWords = 0;
  let weighted = 0;
  const flagged: string[] = [];
  const seen = new Set<string>();
  for (const r of runs) {
    if (r.ai === null) continue;
    const w = wordCount(r.text);
    if (!w) continue;
    totalWords += w;
    weighted += w * r.ai;
    if (r.ai >= flagThreshold) {
      flaggedWords += w;
      for (const s of sentencesOf(r.text.replace(/^[#>*\-\s]+/, ''))) {
        const key = s.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          flagged.push(s);
        }
      }
    }
  }
  const text = runs
    .map((r) => r.text)
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { runs, totalWords, flaggedWords, estimatedAi: totalWords ? weighted / totalWords : 0, flagged: flagged.slice(0, 60), text };
}

/** Đọc file .docx (Buffer) và phân tích. */
export async function parseOriginalityDocx(data: Buffer | ArrayBuffer | Uint8Array, flagThreshold = 0.5): Promise<OriginalityReport> {
  const zip = await JSZip.loadAsync(data);
  const doc = zip.file('word/document.xml');
  if (!doc) throw new Error('File không phải .docx hợp lệ (thiếu word/document.xml)');
  const xml = await doc.async('string');
  const report = parseOriginalityDocumentXml(xml, flagThreshold);
  if (!report.runs.some((r) => r.fill)) throw new Error('File .docx không có màu đánh giá của Originality.ai. Hãy dùng nút Export ngay trên trang kết quả quét.');
  return report;
}
