import { raw } from 'hono/html';
import type { AppConfig } from '../config.js';
import type { LogRow, Run, SourceRow, StepRow } from '../db/index.js';
import type { Article, CheckRound, Experiment, GeneralSettings, ManualScore, Outline, PendingScore, PlacesData, ResearchNotes, SerpData } from '../core/types.js';
import { DETECTOR_MODE_LABEL, DIALECT_LABEL, LLM_PROVIDER_LABEL, LLM_PROVIDER_SHORT, RUN_KIND_LABEL, RUN_STATUS_LABEL, SEARCH_PROVIDER_LABEL, VOICE_LABEL, placeMapsUrl } from '../core/types.js';
import { CONTENT_STYLES, CONTENT_STYLE_CHOICES } from '../generator/content-styles.js';
import { STEP_ORDER, stepMetaFor, type CurrentArticle, type StepId } from '../core/pipeline.js';
import { SECRET_LABELS, SECRET_NAMES, type SecretInfo, type SecretName } from '../core/secrets.js';
import type { IntegrationStatus } from '../services/types.js';
import { articleToHtml, articleToMarkdown } from '../generator/markdown.js';
import { articleWordCount } from '../generator/quality.js';
import { formatDateVi, truncate } from '../core/util.js';
import { outlineSectionsToText } from './forms.js';
import { Badge } from './layout.js';

const pct = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(digits)}%`);
const usd = (v: number | undefined) => (v === undefined ? '—' : `$${v.toFixed(2)}`);

/* ------------------------------------------------------------------ */
/*  Trang chủ                                                            */
/* ------------------------------------------------------------------ */

export function HomePage(props: { runs: Run[]; settings: GeneralSettings; integ: IntegrationStatus; mock: boolean; stats: { total: number; done: number; needsReview: number; running: number } }) {
  const { runs, settings: s, integ } = props;
  const warnings: string[] = [];
  if (!props.mock) {
    if (integ.llmProvider === 'anthropic' && !integ.anthropic.configured) warnings.push('Chưa có Anthropic API key.');
    if (integ.llmProvider === 'openrouter' && !integ.openrouter.configured) warnings.push('Chưa có OpenRouter API key.');
    if (integ.llmProvider === 'deepseek' && !integ.deepseek.configured) warnings.push('Chưa có DeepSeek API key.');
    if (!integ.search.configured) warnings.push(`Chưa có key cho nhà cung cấp tìm kiếm (${integ.search.provider}).`);
    if (integ.originality.mode === 'api' && !integ.originality.configured) warnings.push('Đang chọn Originality.ai API nhưng chưa có key.');
  }
  const aiModeText =
    integ.originality.mode === 'off'
      ? 'Đã tắt'
      : integ.originality.mode === 'manual'
        ? `Chấm tay trên web Originality.ai (tối đa ${s.maxManualScans} lần mỗi bài), ngưỡng ${pct(s.aiScoreMax, 0)}`
        : `Originality.ai API (${integ.originality.model}), ngưỡng ${pct(s.aiScoreMax, 0)}`;
  return (
    <>
      {warnings.length ? (
        <div class="alert warn">
          {warnings.join(' ')} <a href="/content/settings">Vào Cài đặt</a> để nhập.
        </div>
      ) : null}
      <div class="grid cols-4" style="margin-bottom:16px">
        <div class="card tight stat">
          <span class="n">{props.stats.total}</span>
          <span class="l">Tổng bài</span>
        </div>
        <div class="card tight stat good">
          <span class="n">{props.stats.done}</span>
          <span class="l">Đạt kiểm tra</span>
        </div>
        <div class="card tight stat">
          <span class="n">{props.stats.needsReview}</span>
          <span class="l">Chưa đạt, cần xem</span>
        </div>
        <div class="card tight stat">
          <span class="n">{props.stats.running}</span>
          <span class="l">Đang chạy hoặc chờ</span>
        </div>
      </div>
      <div class="grid side">
        <div class="card" id="new">
          <h2>Viết bài mới</h2>
          <form method="post" action="/runs">
            <label>Từ khóa chính</label>
            <input type="text" name="keyword" placeholder="Ví dụ: Hủ tiếu Nam Vang" required maxlength={200} autofocus />
            <label>Model viết bài</label>
            <select name="provider">
              <option value="default">Theo Cài đặt ({LLM_PROVIDER_SHORT[integ.llmProvider]} · {integ[integ.llmProvider].writerModel})</option>
              <option value="anthropic">Claude · {integ.anthropic.writerModel}{integ.anthropic.configured ? '' : ' (chưa có key)'}</option>
              <option value="openrouter">OpenRouter · {integ.openrouter.writerModel}{integ.openrouter.configured ? '' : ' (chưa có key)'}</option>
              <option value="deepseek">DeepSeek · {integ.deepseek.writerModel}{integ.deepseek.configured ? '' : ' (chưa có key)'}</option>
            </select>
            <div class="row three">
              <div>
                <label>Kiểu viết</label>
                <select name="style">
                  {CONTENT_STYLE_CHOICES.map((c) => (
                    <option value={c.id} selected={c.id === s.defaultStyle}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>Ngôi kể</label>
                <select name="voice">
                  {Object.entries(VOICE_LABEL).map(([k, v]) => (
                    <option value={k} selected={k === s.defaultVoice}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>Từ vựng</label>
                <select name="dialect">
                  {Object.entries(DIALECT_LABEL).map(([k, v]) => (
                    <option value={k} selected={k === s.defaultDialect}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div class="row">
              <div>
                <label>
                  Số từ tối thiểu <small>bài cuối</small>
                </label>
                <input type="number" name="minWords" value={String(s.articleMinWords)} min={300} max={5000} />
              </div>
              <div>
                <label>Số từ tối đa</label>
                <input type="number" name="maxWords" value={String(s.articleMaxWords)} min={400} max={6000} />
              </div>
            </div>
            <label>
              Người đọc mục tiêu <small>để trống = người đọc phổ thông</small>
            </label>
            <input type="text" name="audience" placeholder="Ví dụ: người Sài Gòn thích ăn sáng ngoài, lần đầu tìm hiểu" maxlength={500} />
            <label>
              Từ khóa phụ <small>phân cách bằng dấu phẩy, để trống = tool tự rút từ nguồn</small>
            </label>
            <input type="text" name="secondaryKeywords" placeholder="hủ tiếu khô, hủ tiếu nước, cách nấu hủ tiếu" />
            <label>
              Yêu cầu riêng <small>tùy chọn</small>
            </label>
            <textarea name="notes" placeholder="Ví dụ: nhấn vào phần so sánh với hủ tiếu Mỹ Tho; không nhắc tên quán cụ thể" maxlength={3000}></textarea>
            <label class="check">
              <input type="checkbox" name="comparison" checked={s.comparisonMode} /> Viết 100% dạng so sánh: mỗi mục H2 là một bảng so sánh (cách chế biến, quán, món tương tự...)
            </label>
            <label class="check">
              <input type="checkbox" name="reviewOutline" /> Dừng sau bước bố cục để tôi duyệt rồi mới viết
            </label>
            <p style="margin-top:16px">
              <button class="btn" type="submit">
                Thu thập và viết
              </button>
            </p>
            <p class="hint">
              Quy trình: tìm Google top {s.resultsCount} → tải {s.minSources} đến {s.maxSources} nguồn → rút {s.notesMinWords} đến {s.notesMaxWords} từ ghi chú → bố cục → viết → biên tập → kiểm tra (chất lượng, trùng lặp, Originality.ai) và tự sửa tối đa {s.maxFixRounds} vòng → xuất file.
            </p>
          </form>
        </div>
        <div class="card">
          <h2>Cấu hình đang dùng</h2>
          <dl class="kv">
            <dt>Nhà cung cấp</dt>
            <dd>{LLM_PROVIDER_LABEL[integ.llmProvider]}</dd>
            <dt>Model viết</dt>
            <dd>{integ[integ.llmProvider].writerModel}</dd>
            <dt>Model đọc nguồn</dt>
            <dd>{integ[integ.llmProvider].researchModel}</dd>
            <dt>Tìm kiếm</dt>
            <dd>{SEARCH_PROVIDER_LABEL[integ.search.provider]}</dd>
            <dt>Điểm AI</dt>
            <dd>{aiModeText}</dd>
            <dt>Trùng lặp</dt>
            <dd>
              Tối đa {pct(s.dupRatioMax, 0)}, chuỗi {s.shingleSize} từ
            </dd>
            <dt>Vòng sửa</dt>
            <dd>{s.maxFixRounds}</dd>
          </dl>
          <p style="margin-top:14px">
            <a class="btn accent lg" href="/content/settings">
              {ICO_GEAR}
              Sửa cài đặt
            </a>
          </p>
        </div>
      </div>
      <div class="card" style="margin-top:16px" id="roundup">
        <h2>Tổng hợp quán theo khu vực (Google Maps)</h2>
        <p class="hint">Tool tìm quán trên Google Maps, lọc đúng món và đúng khu vực, gộp chi nhánh, xếp hạng theo sao và số đánh giá, đọc đánh giá của các quán được chọn rồi viết bài: bảng so sánh, mỗi quán một mục kèm địa chỉ và link Google Maps, quán nào hợp ai. Cần SerpAPI key.</p>
        <form method="post" action="/runs">
          <input type="hidden" name="kind" value="roundup" />
          <div class="row three">
            <div>
              <label>Món hoặc loại quán</label>
              <input type="text" name="dish" placeholder="Ví dụ: hủ tiếu" required maxlength={120} />
            </div>
            <div>
              <label>Khu vực</label>
              <input type="text" name="area" placeholder="Ví dụ: Phan Rang" required maxlength={120} />
            </div>
            <div>
              <label>Số quán đưa vào bài</label>
              <input type="number" name="placesCount" value={String(s.roundupPlaces)} min={3} max={20} />
            </div>
          </div>
          <div class="row three">
            <div>
              <label>Model viết bài</label>
              <select name="provider">
                <option value="default">Theo Cài đặt</option>
                <option value="anthropic">Claude · {integ.anthropic.writerModel}</option>
                <option value="openrouter">OpenRouter · {integ.openrouter.writerModel}</option>
                <option value="deepseek">DeepSeek · {integ.deepseek.writerModel}</option>
              </select>
            </div>
            <div>
              <label>Ngôi kể</label>
              <select name="voice">
                {Object.entries(VOICE_LABEL).map(([k, v]) => (
                  <option value={k} selected={k === s.defaultVoice}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Từ vựng</label>
              <select name="dialect">
                {Object.entries(DIALECT_LABEL).map(([k, v]) => (
                  <option value={k} selected={k === s.defaultDialect}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div class="row">
            <div>
              <label>Số từ tối thiểu</label>
              <input type="number" name="minWords" value={String(s.roundupMinWords)} min={300} max={5000} />
            </div>
            <div>
              <label>Số từ tối đa</label>
              <input type="number" name="maxWords" value={String(s.roundupMaxWords)} min={400} max={6000} />
            </div>
          </div>
          <label>
            Ghi chú của tôi về quán <small>mỗi dòng "Tên quán: ghi chú"; chỉ quán có ghi chú mới được kể trải nghiệm cá nhân</small>
          </label>
          <textarea name="placeNotes" placeholder={'Hủ tiếu Cô Ba: tôi ăn ở đây mỗi sáng thứ bảy, tô khô ngon hơn tô nước\nHủ tiếu Năm Tài: nước lèo hơi ngọt với tôi'} maxlength={4000}></textarea>
          <label>
            Yêu cầu riêng <small>tùy chọn</small>
          </label>
          <textarea name="notes" placeholder="Ví dụ: ưu tiên quán mở buổi sáng; nhấn vào giá" maxlength={3000}></textarea>
          <label class="check">
            <input type="checkbox" name="reviewPlaces" checked /> Dừng sau khi xếp hạng để tôi chọn quán và ghi chú trước khi viết
          </label>
          <p style="margin-top:16px">
            <button class="btn" type="submit">
              Tìm quán và viết bài tổng hợp
            </button>
          </p>
          <p class="hint">
            Chi phí SerpAPI mỗi bài: 1 lượt tìm tọa độ + {Math.ceil(s.roundupCandidates / 20)} lượt tìm quán + 1 lượt đánh giá cho mỗi quán được chọn. Quán được xét khi có từ {s.roundupMinReviews} đánh giá trở lên (đổi trong Cài đặt).
          </p>
        </form>
      </div>
      <div class="card" style="margin-top:16px" id="brand">
        <h2>Giới thiệu thương hiệu, doanh nghiệp (từ link Google Maps)</h2>
        <p class="hint">Dán link Google Maps của địa điểm, điền thông tin cơ bản về thương hiệu. Tool lấy địa chỉ, giờ mở, sao, số đánh giá, điện thoại, website, bộ ảnh và ý khách khen từ Google Maps, rồi viết bài giới thiệu để đăng trên website của thương hiệu hoặc trang tin. Cần SerpAPI key.</p>
        <form method="post" action="/runs">
          <input type="hidden" name="kind" value="brand" />
          <label>Link Google Maps của địa điểm</label>
          <input type="text" name="mapsUrl" placeholder="https://maps.app.goo.gl/... hoặc https://www.google.com/maps/place/..." required maxlength={2000} />
          <div class="row three">
            <div>
              <label>
                Tên thương hiệu <small>trống = lấy tên trên Maps</small>
              </label>
              <input type="text" name="brandName" placeholder="Ví dụ: Hủ Tiếu Nam Vang Ông Giáo" maxlength={120} />
            </div>
            <div>
              <label>Model viết bài</label>
              <select name="provider">
                <option value="default">Theo Cài đặt</option>
                <option value="anthropic">Claude · {integ.anthropic.writerModel}</option>
                <option value="openrouter">OpenRouter · {integ.openrouter.writerModel}</option>
                <option value="deepseek">DeepSeek · {integ.deepseek.writerModel}</option>
              </select>
            </div>
            <div>
              <label>Ngôi kể</label>
              <select name="voice">
                {Object.entries(VOICE_LABEL).map(([k, v]) => (
                  <option value={k} selected={k === 'chung_toi'}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label>
            Thông tin cơ bản về thương hiệu <small>mô tả, năm thành lập, sản phẩm dịch vụ, điểm mạnh, câu chuyện; mỗi dòng một ý; không có thì để trống</small>
          </label>
          <textarea name="brandInfo" class="tall" placeholder={'Mở từ 2015, chủ quán người Sóc Trăng\nNước lèo hầm xương ống 6 tiếng, không dùng bột ngọt\nMón chủ lực: hủ tiếu khô, hủ tiếu sa tế\nGiao tận nơi bán kính 3 km'} maxlength={6000}></textarea>
          <div class="row">
            <div>
              <label>Số từ tối thiểu</label>
              <input type="number" name="minWords" value={String(s.brandMinWords)} min={300} max={5000} />
            </div>
            <div>
              <label>Số từ tối đa</label>
              <input type="number" name="maxWords" value={String(s.brandMaxWords)} min={400} max={6000} />
            </div>
          </div>
          <label class="check">
            <input type="checkbox" name="brandIncludeCons" /> Nhắc cả góp ý của khách (mục "điều nên biết trước khi đến")
          </label>
          <p style="margin-top:16px">
            <button class="btn" type="submit">
              Lấy dữ liệu Maps và viết bài giới thiệu
            </button>
          </p>
        </form>
      </div>
      <div class="card" style="margin-top:16px">
        <h2>Các bài đã chạy</h2>
        {runs.length === 0 ? (
          <p class="muted">Chưa có bài nào. Nhập từ khóa ở trên để bắt đầu.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Từ khóa</th>
                <th>Trạng thái</th>
                <th>Bước</th>
                <th>AI</th>
                <th>Trùng</th>
                <th>Từ</th>
                <th>Vòng</th>
                <th>Chi phí</th>
                <th>Tạo lúc</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr>
                  <td>{r.id}</td>
                  <td>
                    <a href={`/runs/${r.id}`}>
                      <b>{r.keyword}</b>
                    </a>
                    {r.error ? <div class="small" style="color:var(--err)">{truncate(r.error, 120)}</div> : null}
                  </td>
                  <td>
                    <Badge status={r.status} label={RUN_STATUS_LABEL[r.status]} />
                  </td>
                  <td class="small muted">
                    {r.options.kind === 'roundup' ? <span class="pill">quán</span> : null}
                    {r.current_step ? stepMetaFor(r.options.kind)[r.current_step as StepId]?.name ?? r.current_step : ''}
                  </td>
                  <td>{r.finalScore ? pct(r.finalScore.aiScore) : ''}</td>
                  <td>{r.finalScore ? pct(r.finalScore.dupRatio) : ''}</td>
                  <td>{r.finalScore?.words ?? ''}</td>
                  <td>{r.rounds || ''}</td>
                  <td>{r.usage ? usd(r.usage.usd) : ''}</td>
                  <td class="small muted">{formatDateVi(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Chi tiết một lần chạy                                                */
/* ------------------------------------------------------------------ */

export type RunTab = 'overview' | 'sources' | 'places' | 'notes' | 'outline' | 'article' | 'checks' | 'experiment' | 'log';
const TABS: { id: RunTab; name: string }[] = [
  { id: 'overview', name: 'Tổng quan' },
  { id: 'sources', name: 'Nguồn' },
  { id: 'places', name: 'Quán' },
  { id: 'notes', name: 'Ghi chú' },
  { id: 'outline', name: 'Bố cục' },
  { id: 'article', name: 'Bài viết' },
  { id: 'checks', name: 'Kiểm tra' },
  { id: 'experiment', name: 'Thử model' },
  { id: 'log', name: 'Log' },
];

export interface RunDetailProps {
  run: Run;
  steps: StepRow[];
  tab: RunTab;
  settings: GeneralSettings;
  serp: SerpData | null;
  sources: SourceRow[];
  /** Bài tổng hợp quán: danh sách quán đã xếp hạng */
  places: { content: PlacesData; version: number } | null;
  notes: ResearchNotes | null;
  outline: { content: Outline; version: number } | null;
  article: CurrentArticle | null;
  checks: { version: number; content: CheckRound }[];
  exportsInfo: { dir: string; files: Record<string, string> } | null;
  logs: LogRow[];
  /** Vòng kiểm tra đang chờ điểm chấm tay */
  pending: PendingScore | null;
  /** Các điểm người dùng đã nhập */
  scores: ManualScore[];
  /** Thử nghiệm model của bài này */
  experiment: Experiment | null;
  experimentRunning: boolean;
  /** Model và key đang cấu hình, để gợi ý danh sách thử */
  integ: IntegrationStatus;
  detectorMode: 'api' | 'manual' | 'off';
  /** Các bài đang chiếm chỗ trong worker và số chỗ */
  activeRuns: number[];
  concurrency: number;
  /** Site của bot có thể đăng bài vào; rỗng khi chạy rời */
  publishSites: { id: number; domain: string }[];
  /** Site đã gắn với lần chạy này; pageId có khi bài đã tạo trên site */
  published: { siteId: number; domain: string; pageId: number | null } | null;
}

/* Biểu tượng nhỏ trong nút (SVG nét, tô theo màu chữ) */
const ICO_GEAR = raw('<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>');
const ICO_UPLOAD = raw('<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>');
const ICO_CHECK = raw('<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>');

export function RunDetail(p: RunDetailProps) {
  const { run } = p;
  const busy = run.status === 'queued' || run.status === 'running';
  return (
    <>
      <div class="actions" style="justify-content:space-between;margin-bottom:12px">
        <div>
          <h1 style="margin:0">
            #{run.id} · {run.keyword}
          </h1>
          <div class="small muted">
            {RUN_KIND_LABEL[run.options.kind]} · Tạo {formatDateVi(run.created_at)} · {run.options.provider === 'default' ? 'model theo Cài đặt' : LLM_PROVIDER_SHORT[run.options.provider]} · kiểu {run.options.style === 'auto' ? `tự chọn${p.outline ? ` (${CONTENT_STYLES[p.outline.content.style].name})` : ''}` : CONTENT_STYLES[run.options.style].name} · {VOICE_LABEL[run.options.voice]} · {run.options.minWords} đến {run.options.maxWords} từ
          </div>
        </div>
        <div class="actions">
          <Badge status={run.status} label={RUN_STATUS_LABEL[run.status]} />
          {run.status === 'waiting_places' ? (
            p.tab === 'places' ? (
              <button class="btn sm" type="submit" form="places-form" name="action" value="approve">
                Duyệt các quán đang tích và viết bài
              </button>
            ) : (
              <a class="btn sm" href={`/runs/${run.id}?tab=places`}>
                Chọn quán và duyệt
              </a>
            )
          ) : null}
          {run.status === 'waiting_outline' ? (
            p.tab === 'outline' ? (
              <button class="btn sm" type="submit" form="outline-form" name="action" value="approve">
                Duyệt bố cục này và viết bài
              </button>
            ) : (
              <a class="btn sm" href={`/runs/${run.id}?tab=outline`}>
                Xem bố cục và duyệt
              </a>
            )
          ) : null}
          {busy ? (
            <form method="post" action={`/runs/${run.id}/cancel`} class="inline">
              <button class="btn danger sm" type="submit">
                Hủy
              </button>
            </form>
          ) : null}
          <form method="post" action={`/runs/${run.id}/delete`} class="inline" onsubmit="return confirm('Xóa lần chạy này và toàn bộ dữ liệu của nó? Nếu đang chạy sẽ bị ngắt ngay.')">
            <button class="btn danger sm" type="submit">
              Xóa
            </button>
          </form>
        </div>
      </div>
      {run.error ? <div class="alert err">Lỗi: {run.error}</div> : null}
      {run.status === 'queued' ? (
        <div class="alert info">
          {p.activeRuns.filter((id) => id !== run.id).length >= p.concurrency
            ? `Đang chờ tới lượt: worker chạy tối đa ${p.concurrency} bài một lúc và đang bận với bài ${p.activeRuns.filter((id) => id !== run.id).map((id) => `#${id}`).join(', ')}. Hủy bài đó nếu không cần nữa, chỗ sẽ được trả ngay.`
            : 'Đang chờ worker nhận bài, thường trong vài giây. Nếu quá một phút vẫn chờ, khởi động lại tool bằng run.cmd.'}
        </div>
      ) : null}
      {run.status === 'waiting_places' ? (
        <div class="alert warn">
          Đã xếp hạng quán. Tick chọn quán và ghi chú trải nghiệm của bạn ở tab <a href={`/runs/${run.id}?tab=places`}>Quán</a>, rồi bấm Duyệt: các quán đang tích được đưa vào bài ngay, không cần bấm Lưu trước.
        </div>
      ) : null}
      {run.status === 'waiting_outline' ? (
        <div class="alert warn">
          Bố cục đã sẵn. Xem và sửa ở tab <a href={`/runs/${run.id}?tab=outline`}>Bố cục</a>, rồi bấm Duyệt: bố cục đang hiện trên màn hình được dùng để viết.
        </div>
      ) : null}
      {run.status === 'waiting_ai_score' ? (
        <div class="alert warn">
          Kiểm tra nội bộ đã đạt. Còn thiếu điểm Originality.ai: làm theo bảng "Nhập điểm Originality.ai" ở tab <a href={`/runs/${run.id}?tab=overview`}>Tổng quan</a>, khoảng một phút.
        </div>
      ) : null}
      {run.status === 'needs_review' ? (
        <div class="alert warn">
          Bài đã viết xong nhưng chưa qua hết kiểm tra sau {run.rounds} vòng. Xem lý do ở tab <a href={`/runs/${run.id}?tab=checks`}>Kiểm tra</a>, sửa tay ở tab Bài viết, hoặc chạy lại bước "Kiểm tra và sửa".
        </div>
      ) : null}
      <div class="tabs">
        {TABS.filter((t) => (run.options.kind !== 'web' ? t.id !== 'sources' : t.id !== 'places')).map((t) => (
          <a href={`/runs/${run.id}?tab=${t.id}`} class={p.tab === t.id ? 'active' : ''}>
            {t.id === 'places' && run.options.kind === 'brand' ? 'Thương hiệu' : t.name}
          </a>
        ))}
      </div>
      {p.tab === 'overview' ? <OverviewTab {...p} /> : null}
      {p.tab === 'sources' ? <SourcesTab {...p} /> : null}
      {p.tab === 'places' ? <PlacesTab {...p} /> : null}
      {p.tab === 'notes' ? <NotesTab {...p} /> : null}
      {p.tab === 'outline' ? <OutlineTab {...p} /> : null}
      {p.tab === 'article' ? <ArticleTab {...p} /> : null}
      {p.tab === 'checks' ? <ChecksTab {...p} /> : null}
      {p.tab === 'experiment' ? <ExperimentTab {...p} /> : null}
      {p.tab === 'log' ? <LogTab {...p} /> : null}
    </>
  );
}

/** Bảng nhập điểm Originality.ai khi chạy ở chế độ chấm tay. */
function ScorePanel(p: RunDetailProps) {
  const { run, pending, settings } = p;
  const cur = p.article;
  if (!cur) return null;
  const text = pending && pending.articleKey === cur.key ? pending.text : null;
  const already = p.scores.some((s) => s.articleKey === cur.key);
  const scansUsed = p.scores.length;
  const plain = text ?? '';
  const copyJs = `(function(){var b=document.getElementById('copy-open');if(!b)return;b.addEventListener('click',function(){var t=document.getElementById('scan-text');t.select();navigator.clipboard.writeText(t.value).then(function(){b.textContent='Đã sao chép, đang mở Originality.ai...';window.open('https://app.originality.ai/','_blank');setTimeout(function(){b.textContent='Sao chép bài và mở Originality.ai'},2500)})})})();`;
  return (
    <div class="card score-panel" style="margin-bottom:16px">
      <h2>Nhập điểm Originality.ai {pending ? `(lần chấm ${scansUsed + 1}/${settings.maxManualScans})` : ''}</h2>
      {text ? (
        <>
          <p class="small">
            Kiểm tra nội bộ của bản này đã đạt: {pending!.words} từ, trùng nguồn {pct(pending!.dup.ratio)}. Giờ cần điểm AI từ đúng công cụ bạn dùng. Tool không tự gửi bài lên web Originality.ai vì điều khoản của họ cấm lấy điểm tự động ngoài API.
          </p>
          <ol class="small">
            <li>
              Bấm <b>Sao chép bài và mở Originality.ai</b>. Trang app.originality.ai mở ở tab mới, bạn đăng nhập nếu cần.
            </li>
            <li>
              Chọn <b>AI Check</b>, đổi model sang <b>Multi Language</b>, dán bài vào ô nội dung, bấm Scan.
            </li>
            <li>
              Bấm <b>Export</b> trên trang kết quả để tải file <b>.docx</b>, rồi chọn file đó ở ô dưới: tool đọc màu từng đoạn để lấy đúng các câu bị tô đỏ và ước tính điểm. Gõ thêm <b>phần trăm AI</b> hiển thị trên màn hình nếu muốn dùng số chính xác (ví dụ 12 hoặc 12%). Không có file thì chỉ cần gõ điểm và dán các câu bị tô đỏ nếu có.
            </li>
          </ol>
          <button class="btn" id="copy-open" type="button">
            Sao chép bài và mở Originality.ai
          </button>
          <textarea id="scan-text" class="mono" readonly style="min-height:140px;margin-top:10px">
            {plain}
          </textarea>
        </>
      ) : (
        <p class="small">
          {already ? `Bản ${cur.key} đã có điểm. Nhập điểm mới nếu bạn vừa quét lại bản này.` : `Bản ${cur.key} chưa có điểm Originality.ai. Sao chép Markdown ở tab Bài viết, quét trên web, rồi nhập điểm ở đây để tool kiểm tra tiếp.`}
        </p>
      )}
      <form method="post" action={`/runs/${run.id}/score`} enctype="multipart/form-data">
        <label>
          File .docx xuất từ Originality.ai <small>nút Export trên trang kết quả, tùy chọn nhưng nên có</small>
        </label>
        <input type="file" name="report" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
        <div class="row" style="grid-template-columns:220px 1fr">
          <div>
            <label>
              Phần trăm AI <small>bắt buộc nếu không có file</small>
            </label>
            <input type="text" name="score" placeholder="ví dụ 12 hoặc 12%" autocomplete="off" />
          </div>
          <div>
            <label>
              Câu bị đánh dấu <small>tùy chọn, mỗi dòng một câu</small>
            </label>
            <textarea name="flagged" style="min-height:70px" placeholder="Dán các câu Originality.ai tô đỏ (nếu có) để vòng sửa viết lại đúng câu đó"></textarea>
          </div>
        </div>
        <p style="margin-top:10px">
          <button class="btn" type="submit">
            Ghi điểm và kiểm tra tiếp
          </button>
          <span class="hint" style="margin-left:10px">
            Đạt khi AI ≤ {pct(settings.aiScoreMax, 0)}. Không đạt thì tool viết lại đúng các câu bị tô đỏ trong file rồi dừng lại chờ điểm lần sau.
          </span>
        </p>
      </form>
      <script>{raw(copyJs)}</script>
    </div>
  );
}

function OverviewTab(p: RunDetailProps) {
  const { run } = p;
  const fs = run.finalScore;
  const u = run.usage;
  const stepRows = STEP_ORDER.map((id) => p.steps.find((s) => s.step === id) ?? ({ run_id: run.id, step: id, status: 'pending', attempts: 0, started_at: null, finished_at: null, message: null, error: null } as StepRow));
  const busy = run.status === 'queued' || run.status === 'running';
  const showScorePanel = p.detectorMode === 'manual' && (run.status === 'waiting_ai_score' || run.status === 'needs_review');
  return (
    <>
      {showScorePanel ? <ScorePanel {...p} /> : null}
      <div class="grid cols-5" style="margin-bottom:16px">
        <div class={`card tight stat ${fs ? (fs.aiScore === null ? '' : fs.aiScore <= p.settings.aiScoreMax ? 'good' : 'bad') : ''}`}>
          <span class="n">{fs ? (fs.aiScore === null ? (p.detectorMode === 'off' ? 'Bỏ qua' : 'Chưa chấm') : pct(fs.aiScore)) : '—'}</span>
          <span class="l">
            Điểm AI ({p.detectorMode === 'manual' ? 'bạn nhập từ Originality.ai' : 'Originality.ai'}), ngưỡng {pct(p.settings.aiScoreMax, 0)}
          </span>
        </div>
        <div class={`card tight stat ${fs ? (fs.dupRatio !== null && fs.dupRatio <= p.settings.dupRatioMax ? 'good' : 'bad') : ''}`}>
          <span class="n">{fs ? pct(fs.dupRatio) : '—'}</span>
          <span class="l">Trùng với nguồn, ngưỡng {pct(p.settings.dupRatioMax, 0)}</span>
        </div>
        <div class="card tight stat">
          <span class="n">{fs?.words ?? (p.article ? articleWordCount(p.article.article) : '—')}</span>
          <span class="l">Số từ</span>
        </div>
        <div class="card tight stat">
          <span class="n">{run.rounds || '—'}</span>
          <span class="l">Vòng kiểm tra</span>
        </div>
        <div class="card tight stat">
          <span class="n">{u ? usd(u.usd) : '—'}</span>
          <span class="l">{u ? `${u.calls} lượt Claude, ${u.inputTokens.toLocaleString('vi-VN')} token vào, ${u.outputTokens.toLocaleString('vi-VN')} ra` : 'Chi phí ước tính'}</span>
        </div>
      </div>
      <div class="card">
        <h2>Các bước</h2>
        <div class="steps">
          {stepRows.map((s) => (
            <div class={`step ${s.status}`}>
              <div>
                <div class="name">{stepMetaFor(run.options.kind)[s.step as StepId]?.name ?? s.step}</div>
                <Badge status={s.status} />
              </div>
              <div>
                <div class="desc">{stepMetaFor(run.options.kind)[s.step as StepId]?.desc}</div>
                {s.message ? <div class="msg">{s.message}</div> : null}
                {s.error ? <div class="msg err">{s.error}</div> : null}
                {s.finished_at ? <div class="small muted">{formatDateVi(s.finished_at)}</div> : null}
              </div>
              <div>
                {!busy ? (
                  <form method="post" action={`/runs/${run.id}/retry/${s.step}`} class="inline">
                    <button class="btn secondary sm" type="submit" title="Chạy lại bước này và mọi bước phía sau">
                      Từ đây
                    </button>
                  </form>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        <p class="hint">"Từ đây" chạy lại bước đó và tất cả bước phía sau, giữ nguyên kết quả các bước trước. Ví dụ đổi Cài đặt rồi chạy lại từ "Viết bài" để dùng lại ghi chú và bố cục cũ.</p>
      </div>
      {u && Object.keys(u.byModel).length ? (
        <div class="card" style="margin-top:16px">
          <h2>Chi phí theo model</h2>
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th>Lượt</th>
                <th>Token vào</th>
                <th>Token ra</th>
                <th>USD</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(u.byModel).map(([m, v]) => (
                <tr>
                  <td>{m}</td>
                  <td>{v.calls}</td>
                  <td>{v.inputTokens.toLocaleString('vi-VN')}</td>
                  <td>{v.outputTokens.toLocaleString('vi-VN')}</td>
                  <td>{usd(v.usd)}</td>
                </tr>
              ))}
              <tr>
                <td class="muted">Tìm kiếm Google</td>
                <td>{u.searchCalls}</td>
                <td colspan={3} class="muted">
                  lượt
                </td>
              </tr>
              <tr>
                <td class="muted">Originality.ai</td>
                <td>{u.detectorCredits}</td>
                <td colspan={3} class="muted">
                  credit
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

function SourcesTab(p: RunDetailProps) {
  return (
    <>
      {p.serp ? (
        <div class="grid cols-2" style="margin-bottom:16px">
          <div class="card">
            <h3>Mọi người cũng hỏi</h3>
            {p.serp.peopleAlsoAsk.length ? (
              <ul class="small">
                {p.serp.peopleAlsoAsk.map((q) => (
                  <li>{q}</li>
                ))}
              </ul>
            ) : (
              <p class="muted small">Không có (nhà cung cấp tìm kiếm không trả về).</p>
            )}
          </div>
          <div class="card">
            <h3>Tìm kiếm liên quan</h3>
            <div>
              {p.serp.relatedSearches.map((q) => (
                <span class="pill">{q}</span>
              ))}
            </div>
            <p class="small muted" style="margin-top:8px">
              Nhà cung cấp: {p.serp.provider} · {formatDateVi(p.serp.fetchedAt)}
            </p>
          </div>
        </div>
      ) : null}
      <div class="card">
        <h2>Nguồn thu thập ({p.sources.filter((s) => s.status === 'ok').length} dùng được / {p.sources.filter((s) => s.position < 200).length} bài web)</h2>
        {p.serp?.pagesFetched ? (
          <p class="hint">
            Top {p.sources.filter((s) => s.position < 100).length} là thứ hạng giữa các bài web, đã bỏ mạng xã hội, video, sàn và domain chặn ({p.serp.skipped?.length ?? 0} kết quả, xem các dòng "bỏ" ở cuối). Đã lật {p.serp.pagesFetched} trang Google.
          </p>
        ) : null}
        {p.sources.length === 0 ? (
          <p class="muted">Chưa có. Bước "Tìm Google" chưa chạy.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Trang</th>
                <th>Ngôn ngữ</th>
                <th>Trạng thái</th>
                <th>Từ</th>
                <th>Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {p.sources.map((s) => (
                <tr style={s.position >= 200 ? 'opacity:.7' : ''}>
                  <td>{s.position >= 200 ? <span class="small muted">bỏ</span> : s.position >= 100 ? `EN ${s.position - 100}` : s.position}</td>
                  <td>
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      {s.title || s.url}
                    </a>
                    <div class="small muted">{s.domain}</div>
                  </td>
                  <td>{s.language}</td>
                  <td>
                    <Badge status={s.status} />
                  </td>
                  <td>{s.word_count || ''}</td>
                  <td class="small muted">{s.error ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function NotesTab(p: RunDetailProps) {
  const n = p.notes;
  if (!n) return <div class="card muted">Chưa có ghi chú. Bước "Rút ghi chú" chưa chạy.</div>;
  return (
    <>
      <div class="card" style="margin-bottom:16px">
        <h2>Ghi chú tư liệu ({n.totalWords} từ)</h2>
        <p>
          <b>Ý định tìm kiếm:</b> {n.searchIntent}. {n.intentExplanation}
        </p>
        <p>{n.summary}</p>
        <div class="grid cols-2">
          <div>
            <h3>Dữ kiện chính</h3>
            <ul class="small">
              {n.keyFacts.map((f) => (
                <li>{f}</li>
              ))}
            </ul>
            <h3>Số liệu và tên riêng</h3>
            <ul class="small">
              {n.numbersAndNames.map((f) => (
                <li>{f}</li>
              ))}
            </ul>
          </div>
          <div>
            {(n.topSites ?? []).length ? (
              <>
                <h3>Trang top đầu Google</h3>
                <ul class="small">
                  {(n.topSites ?? []).map((t) => (
                    <li>
                      <b>Top {t.position}</b> · {t.contentType}
                      <div class="muted">Cấu trúc: {t.structure.join(' · ')}</div>
                      <div>
                        {t.tags.map((k) => (
                          <span class="pill">{k}</span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {(n.comparisons ?? []).length ? (
              <>
                <h3>So sánh dựng được từ nguồn</h3>
                <ul class="small">
                  {(n.comparisons ?? []).map((c) => (
                    <li>
                      <b>{c.topic}</b>: {c.items.join(' vs ')} <span class="muted">(tiêu chí: {c.criteria.join(', ')})</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {(n.similarItems ?? []).length ? (
              <>
                <h3>Món hoặc phương án tương tự</h3>
                <ul class="small">
                  {(n.similarItems ?? []).map((c) => (
                    <li>
                      <b>{c.name}</b>: {c.differences.join('; ')}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <h3>Mục hầu hết nguồn đều có</h3>
            <ul class="small">
              {n.commonSubtopics.map((f) => (
                <li>{f}</li>
              ))}
            </ul>
            <h3>Điều nguồn chưa nói rõ</h3>
            <ul class="small">
              {n.gaps.map((f) => (
                <li>{f}</li>
              ))}
            </ul>
            {n.disagreements.length ? (
              <>
                <h3>Nguồn mâu thuẫn</h3>
                <ul class="small">
                  {n.disagreements.map((f) => (
                    <li>{f}</li>
                  ))}
                </ul>
              </>
            ) : null}
            <h3>Từ khóa phụ</h3>
            <div>
              {n.secondaryKeywords.map((k) => (
                <span class="pill">{k}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
      {(n.topics ?? []).length ? (
        <div class="card" style="margin-bottom:16px">
          <h2>Phân loại theo nhãn ({(n.topics ?? []).length} nhãn)</h2>
          <p class="hint">Bố cục dựng từ các nhãn này. Nhãn có dấu "top" là có mặt ở trang top đầu Google nên bắt buộc có mục riêng.</p>
          {(n.topics ?? []).map((t) => (
            <details class="panel" open={t.inTopSites}>
              <summary>
                <span class="pill">{t.tag}</span> {t.inTopSites ? <span class="pill ok">top</span> : null} {t.description} · {t.facts.length} dữ kiện
                {t.sourceRefs.length ? <span class="muted"> · nguồn {t.sourceRefs.join(', ')}</span> : null}
              </summary>
              <ul class="small">
                {t.facts.map((f) => (
                  <li>{f}</li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      ) : null}
      {n.perSource.map((s) => (
        <details class="panel">
          <summary>
            Nguồn {s.sourceIndex} · {s.angle} · {s.facts.length} dữ kiện
            {(s.tags ?? []).map((k) => (
              <span class="pill">{k}</span>
            ))}
          </summary>
          <p class="small muted">{s.url}</p>
          <ul class="small">
            {s.facts.map((f) => (
              <li>{f}</li>
            ))}
          </ul>
        </details>
      ))}
    </>
  );
}

function OutlineTab(p: RunDetailProps) {
  const o = p.outline?.content;
  if (!o) return <div class="card muted">Chưa có bố cục. Bước "Lập bố cục" chưa chạy.</div>;
  const waiting = p.run.status === 'waiting_outline';
  return (
    <div class="grid side">
      <div class="card">
        <h2>
          Bố cục (bản {p.outline!.version}) · {CONTENT_STYLES[o.style].name}
        </h2>
        <p class="small muted">{o.styleReason}</p>
        <dl class="kv">
          <dt>Title</dt>
          <dd>
            {o.title} <span class="muted small">({o.title.length} ký tự)</span>
          </dd>
          <dt>H1</dt>
          <dd>{o.h1}</dd>
          <dt>Meta</dt>
          <dd>
            {o.metaDescription} <span class="muted small">({o.metaDescription.length} ký tự)</span>
          </dd>
          <dt>Ý mở bài</dt>
          <dd>{o.hookIdea}</dd>
          <dt>Mục tiêu</dt>
          <dd>{o.targetWords} từ</dd>
        </dl>
        <h3 style="margin-top:14px">Tóm tắt nhanh</h3>
        <ul class="small">
          {o.quickSummary.map((s) => (
            <li>{s}</li>
          ))}
        </ul>
        <h3>Các mục</h3>
        <ol class="small">
          {o.sections.map((s) => (
            <li style={s.level === 3 ? 'margin-left:18px;list-style:circle' : ''}>
              <b>{s.heading}</b> <span class="pill">{s.level === 3 ? 'H3' : 'H2'}</span>
              <span class="pill">{s.format}</span>
              {s.tag ? <span class="pill">{s.tag}</span> : null}
              <div class="muted">{s.goal}</div>
              {(s.comparisonItems ?? []).length ? (
                <div class="small">
                  So sánh: <b>{s.comparisonItems.join(' vs ')}</b>
                  {(s.comparisonCriteria ?? []).length ? <span class="muted"> theo {s.comparisonCriteria.join(', ')}</span> : null}
                </div>
              ) : null}
              <ul>
                {s.points.map((pt) => (
                  <li>{pt}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        <h3>FAQ</h3>
        <ul class="small">
          {o.faq.map((q) => (
            <li>{q}</li>
          ))}
        </ul>
        <h3>Kết</h3>
        <p class="small">{o.nextSteps}</p>
        <div>
          {o.secondaryKeywords.map((k) => (
            <span class="pill">{k}</span>
          ))}
        </div>
      </div>
      <div class="card">
        <h2>Sửa bố cục</h2>
        <form method="post" action={`/runs/${p.run.id}/outline`} id="outline-form">
          <label>Title</label>
          <input type="text" name="title" value={o.title} />
          <label>H1</label>
          <input type="text" name="h1" value={o.h1} />
          <label>Meta description</label>
          <textarea name="metaDescription">{o.metaDescription}</textarea>
          <div class="row">
            <div>
              <label>Kiểu viết</label>
              <select name="style">
                {Object.values(CONTENT_STYLES).map((s) => (
                  <option value={s.id} selected={s.id === o.style}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Mục tiêu số từ</label>
              <input type="number" name="targetWords" value={String(o.targetWords)} />
            </div>
          </div>
          <label>Ý mở bài</label>
          <input type="text" name="hookIdea" value={o.hookIdea} />
          <label>
            Tóm tắt nhanh <small>mỗi dòng một ý</small>
          </label>
          <textarea name="quickSummary">{o.quickSummary.join('\n')}</textarea>
          <label>
            Các mục <small>## H2, ### H3, "Mục tiêu:", "Nhãn:", "Dạng: text|steps|table|checklist|mixed", "So sánh: A | B", "Tiêu chí: x | y", "- điểm cần viết"</small>
          </label>
          <textarea name="sections" class="tall mono">
            {outlineSectionsToText(o.sections)}
          </textarea>
          <label>
            FAQ <small>mỗi dòng một câu hỏi</small>
          </label>
          <textarea name="faq">{o.faq.join('\n')}</textarea>
          <label>Phần kết nên nói gì</label>
          <textarea name="nextSteps">{o.nextSteps}</textarea>
          <label>
            Từ khóa phụ <small>phân cách bằng dấu phẩy</small>
          </label>
          <input type="text" name="secondaryKeywords" value={o.secondaryKeywords.join(', ')} />
          <div class="actions" style="margin-top:16px">
            <button class="btn secondary" type="submit" name="action" value="save">
              Lưu bố cục
            </button>
            {waiting ? (
              <button class="btn" type="submit" name="action" value="approve">
                Lưu, duyệt và viết bài
              </button>
            ) : (
              <button class="btn" type="submit" name="action" value="rewrite">
                Lưu và viết lại bài theo bố cục này
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function ArticleTab(p: RunDetailProps) {
  const cur = p.article;
  if (!cur) return <div class="card muted">Chưa có bài. Bước "Viết bài" chưa chạy.</div>;
  const a = cur.article;
  const md = articleToMarkdown(a);
  const html = articleToHtml(a, { withH1: true }).replace(/src="photos\//g, `src="/runs/${p.run.id}/photos/`);
  const kindLabel: Record<string, string> = { draft: 'bản nháp', edited: 'đã biên tập', fixed: 'đã sửa' };
  const finished = p.run.status === 'done' || p.run.status === 'needs_review';
  const pub = p.published;
  const publishBox = pub?.pageId ? (
    <a class="btn accent sm" href={`/sites/${pub.siteId}/pages/${pub.pageId}`}>
      {ICO_CHECK}
      Đã đăng vào {pub.domain}: mở bài
    </a>
  ) : p.publishSites.length && finished ? (
    <form method="post" action={`/content/runs/${p.run.id}/publish`} class="publish-form">
      {pub ? (
        <input type="hidden" name="siteId" value={String(pub.siteId)} />
      ) : p.publishSites.length === 1 ? (
        <input type="hidden" name="siteId" value={String(p.publishSites[0]!.id)} />
      ) : (
        <select name="siteId" aria-label="Site đăng bài">
          {p.publishSites.map((s) => (
            <option value={String(s.id)}>{s.domain}</option>
          ))}
        </select>
      )}
      <button class="btn accent sm" type="submit" title={pub ? `Tạo bài nháp trên ${pub.domain}` : 'Tạo bài nháp trên site đã chọn'}>
        {ICO_UPLOAD}
        Đăng bài
      </button>
    </form>
  ) : null;
  return (
    <>
      <div class="card" style="margin-bottom:16px">
        <div class="actions" style="justify-content:space-between">
          <div>
            <b>
              Bản {kindLabel[cur.kind] ?? cur.kind} v{cur.version}
            </b>{' '}
            · {articleWordCount(a)} từ · {a.sections.length} mục · {a.faq.length} FAQ · kiểu {CONTENT_STYLES[a.style].name}
          </div>
          <div class="actions">
            {publishBox}
            <a class="btn secondary sm" href={`/runs/${p.run.id}/export/md`}>
              Tải .md
            </a>
            <a class="btn secondary sm" href={`/runs/${p.run.id}/export/html`}>
              Tải .html
            </a>
            <a class="btn secondary sm" href={`/runs/${p.run.id}/export/docx`}>
              Tải .docx
            </a>
            <a class="btn secondary sm" href={`/runs/${p.run.id}/export/json`}>
              JSON site-autopilot
            </a>
            <a class="btn secondary sm" href={`/runs/${p.run.id}/export/txt`}>
              .txt
            </a>
            <a class="btn sm" href={`/runs/${p.run.id}/export/zip`}>
              Tải gói ZIP (bài + ảnh)
            </a>
          </div>
          {publishBox && !pub?.pageId ? (
            <p class="hint">
              <b>Đăng bài</b> tạo bài nháp trên site từ gói bài + ảnh (chưa công khai). Bạn sửa tiêu đề, đường dẫn, meta ở trang bài rồi bấm "Duyệt và đăng" để đưa lên web.
            </p>
          ) : null}
          {a.images.some((im) => im.src) ? (
            <p class="hint">
              Bài có {a.images.filter((im) => im.src).length} ảnh quán. Ảnh nằm trong gói ZIP (thư mục photos); .html và .docx đã nhúng sẵn ảnh.{' '}
              {p.settings.photoBaseUrl ? `Các file đang trỏ ảnh tới ${p.settings.photoBaseUrl}: tải thư mục photos lên đó trước khi đăng.` : 'Muốn .md và .json trỏ thẳng tới ảnh trên web của bạn, đặt "URL gốc ảnh" trong Cài đặt.'}
            </p>
          ) : null}
        </div>
        <dl class="kv" style="margin-top:12px">
          <dt>Title SEO</dt>
          <dd>
            {a.title} <span class="muted small">({a.title.length} ký tự)</span>
          </dd>
          <dt>Meta description</dt>
          <dd>
            {a.metaDescription} <span class="muted small">({a.metaDescription.length} ký tự)</span>
          </dd>
          <dt>Excerpt</dt>
          <dd>{a.excerpt}</dd>
          <dt>Từ khóa phụ đã dùng</dt>
          <dd>
            {a.secondaryKeywords.map((k) => (
              <span class="pill">{k}</span>
            ))}
          </dd>
          <dt>Ảnh gợi ý</dt>
          <dd>
            {a.images.map((im) => (
              <div class="small">
                {im.position}: {im.src ? `ảnh đã tải ${im.src}` : `tìm "${im.query}"`}, alt "{im.alt}"
              </div>
            ))}
          </dd>
        </dl>
      </div>
      <div class="grid side">
        <div class="card">
          <h2>Xem trước</h2>
          <div class="prose">{raw(html)}</div>
        </div>
        <div>
          <div class="card" style="margin-bottom:16px">
            <h2>Markdown</h2>
            <textarea id="md-src" class="tall mono" readonly style="min-height:420px">
              {md}
            </textarea>
          </div>
          <details class="panel">
            <summary>Sửa tay từng phần</summary>
            <p class="hint">Sửa xong bấm "Lưu bản sửa tay". Bản mới được kiểm tra nhanh (chất lượng, trùng nguồn) và dùng cho xuất file. Muốn chấm lại bằng Originality.ai và AI duyệt thì bấm "Kiểm tra lại bằng AI" sau khi lưu.</p>
            <form method="post" action={`/runs/${p.run.id}/article`}>
              <label>Title SEO</label>
              <input type="text" name="title" value={a.title} />
              <label>Meta description</label>
              <textarea name="metaDescription">{a.metaDescription}</textarea>
              <label>H1</label>
              <input type="text" name="h1" value={a.h1} />
              <label>Excerpt</label>
              <input type="text" name="excerpt" value={a.excerpt} />
              <label>
                Tóm tắt nhanh <small>mỗi dòng một ý</small>
              </label>
              <textarea name="quickSummary">{a.quickSummary.join('\n')}</textarea>
              <label>Mở bài</label>
              <textarea name="intro" class="tall">
                {a.intro}
              </textarea>
              {a.sections.map((s, i) => (
                <div class="section-edit">
                  <div class="row" style="grid-template-columns:1fr 90px">
                    <div>
                      <label>Heading mục {i + 1}</label>
                      <input type="text" name={`s${i}_heading`} value={s.heading} />
                    </div>
                    <div>
                      <label>Cấp</label>
                      <select name={`s${i}_level`}>
                        <option value="2" selected={s.level === 2}>
                          H2
                        </option>
                        <option value="3" selected={s.level === 3}>
                          H3
                        </option>
                      </select>
                    </div>
                  </div>
                  <label>Nội dung (markdown)</label>
                  <textarea name={`s${i}_body`} class="tall">
                    {s.body}
                  </textarea>
                </div>
              ))}
              {a.faq.map((f, i) => (
                <div class="section-edit">
                  <label>Câu hỏi {i + 1}</label>
                  <input type="text" name={`f${i}_q`} value={f.question} />
                  <label>Trả lời</label>
                  <textarea name={`f${i}_a`}>{f.answer}</textarea>
                </div>
              ))}
              <label>Phần kết</label>
              <textarea name="nextSteps">{a.nextSteps}</textarea>
              <div class="actions" style="margin-top:16px">
                <button class="btn" type="submit">
                  Lưu bản sửa tay
                </button>
              </div>
            </form>
            <form method="post" action={`/runs/${p.run.id}/retry/verify`} class="inline" style="margin-top:10px;display:block">
              <button class="btn secondary" type="submit">
                Kiểm tra lại bằng AI và Originality.ai
              </button>
            </form>
          </details>
        </div>
      </div>
    </>
  );
}

function ChecksTab(p: RunDetailProps) {
  if (!p.checks.length) return <div class="card muted">Chưa có kết quả kiểm tra. Bước "Kiểm tra và sửa" chưa chạy.</div>;
  const rounds = [...p.checks].reverse();
  return (
    <>
      {rounds.map(({ content: r }, idx) => (
        <details class="panel" open={idx === 0}>
          <summary>
            Vòng {r.round} · <Badge status={r.pass ? 'pass' : 'fail'} /> · chất lượng {r.qualityPass ? 'đạt' : 'chưa'} · trùng {pct(r.dup.ratio)} {r.dup.pass ? 'đạt' : 'chưa'} · AI {r.ai.skipped ? 'bỏ qua' : `${pct(r.ai.aiScore)} ${r.ai.pass ? 'đạt' : 'chưa'}`} · AI duyệt {r.review ? (r.review.pass ? 'đạt' : 'chưa') : '—'} · {formatDateVi(r.checkedAt)}
          </summary>
          <div class="grid cols-2" style="margin-top:12px">
            <div>
              <h3>
                {r.ai.provider === 'manual' ? 'Điểm bạn nhập từ Originality.ai' : 'Originality.ai'}{' '}
                <span class={`score ${r.ai.skipped ? 'na' : r.ai.pass ? 'good' : 'bad'}`}>{r.ai.skipped ? (r.ai.provider === 'manual' ? 'chưa chấm' : 'bỏ qua') : pct(r.ai.aiScore)}</span>
              </h3>
              {r.ai.skipped ? <p class="small muted">{r.ai.error}</p> : null}
              {r.ai.provider === 'manual' && !r.ai.skipped ? (
                <p class="small muted">
                  {p.scores.find((s) => Math.abs(s.aiScore - r.ai.aiScore) < 1e-6)?.report
                    ? (() => {
                        const rep = p.scores.find((s) => Math.abs(s.aiScore - r.ai.aiScore) < 1e-6)!.report!;
                        return `Từ file ${rep.fileName}: ${rep.words} từ, ${rep.flaggedWords} từ trong vùng đỏ, ước tính ${pct(rep.estimatedAi)}${rep.scoreTyped ? ', điểm bạn gõ được ưu tiên' : ' (dùng làm điểm)'}`;
                      })()
                    : 'Điểm bạn gõ tay'}
                </p>
              ) : null}
              {r.ai.error && !r.ai.skipped ? <p class="small" style="color:var(--err)">{r.ai.error}</p> : null}
              {!r.ai.skipped && !r.ai.error && r.ai.provider !== 'manual' ? (
                <p class="small muted">
                  Model {p.settings.originalityModel} · {r.ai.blocks.length} câu · credit {r.ai.creditsUsed ?? '?'}
                  {r.ai.publicLink ? (
                    <>
                      {' '}
                      ·{' '}
                      <a href={r.ai.publicLink} target="_blank" rel="noopener noreferrer">
                        xem trên Originality.ai
                      </a>
                    </>
                  ) : null}
                </p>
              ) : null}
              {r.ai.plagiarism ? (
                <p class="small">
                  Trùng toàn web: <b>{pct(r.ai.plagiarism.score, 0)}</b> {r.ai.plagiarism.pass ? '(đạt)' : '(chưa đạt)'}
                  {r.ai.plagiarism.sources.slice(0, 5).map((s) => (
                    <div class="muted">
                      {s.percent}% · {s.url}
                    </div>
                  ))}
                </p>
              ) : null}
              {r.ai.blocks.filter((b) => b.aiScore >= 0.5).length ? (
                <>
                  <h3 style="margin-top:10px">Câu bị chấm là văn máy (≥ 50%)</h3>
                  {r.ai.blocks
                    .filter((b) => b.aiScore >= 0.5)
                    .sort((x, y) => y.aiScore - x.aiScore)
                    .slice(0, 30)
                    .map((b) => (
                      <div class="flag">
                        <span class="score">{pct(b.aiScore, 0)}</span>
                        {b.where ? <span class="pill">{b.where}</span> : null}
                        {b.text}
                      </div>
                    ))}
                </>
              ) : null}
              <h3 style="margin-top:14px">
                Trùng với nguồn <span class={`score ${r.dup.pass ? 'good' : 'bad'}`}>{pct(r.dup.ratio)}</span>
              </h3>
              <p class="small muted">
                {r.dup.matchedWords}/{r.dup.totalWords} từ nằm trong chuỗi trùng ≥ {p.settings.shingleSize} từ; chuỗi dài nhất {r.dup.longestRun} từ. Không đạt khi vượt {pct(p.settings.dupRatioMax, 0)} hoặc có chuỗi từ {p.settings.shingleSize + 4} từ trở lên.
              </p>
              {r.dup.matches.slice(0, 15).map((m) => (
                <div class="flag" style="background:#fff7ed;border-color:var(--warn)">
                  <span class="score" style="color:var(--warn)">
                    {m.words} từ
                  </span>
                  <span class="pill">{m.where}</span> "{m.text}"{' '}
                  <a href={m.sourceUrl} target="_blank" rel="noopener noreferrer" class="small">
                    nguồn {m.sourceIndex}
                  </a>
                </div>
              ))}
              {r.dup.libraryMatches.length ? (
                <p class="small">
                  Giống bài đã viết:{' '}
                  {r.dup.libraryMatches.map((l) => (
                    <span class="pill">
                      <a href={`/runs/${l.runId}`}>#{l.runId}</a> {l.keyword} {pct(l.ratio)}
                    </span>
                  ))}
                </p>
              ) : null}
            </div>
            <div>
              <h3>
                Cổng chất lượng <Badge status={r.qualityPass ? 'pass' : 'fail'} />
              </h3>
              {r.quality.length ? (
                r.quality.map((i) => (
                  <div class="issue">
                    <Badge status={i.severity} label={i.severity === 'major' ? 'Bắt buộc' : 'Nên'} /> <span class="pill">{i.where}</span> {i.message}
                  </div>
                ))
              ) : (
                <p class="small muted">Không có lỗi.</p>
              )}
              {r.review ? (
                <>
                  <h3 style="margin-top:14px">
                    AI duyệt <Badge status={r.review.pass ? 'pass' : 'fail'} />
                  </h3>
                  <p class="small">{r.review.summary}</p>
                  {r.review.issues.map((i) => (
                    <div class="issue">
                      <Badge status={i.severity} label={i.severity === 'major' ? 'Bắt buộc' : 'Nên'} /> <span class="pill">{i.where}</span> {i.problem} <span class="muted">→ {i.fix}</span>
                    </div>
                  ))}
                </>
              ) : null}
              {!r.pass && r.feedback.length ? (
                <>
                  <h3 style="margin-top:14px">Chỉ dẫn gửi cho vòng sửa</h3>
                  <ul class="small">
                    {r.feedback.slice(0, 30).map((f) => (
                      <li>{f}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          </div>
        </details>
      ))}
    </>
  );
}

function LogTab(p: RunDetailProps) {
  return (
    <div class="card">
      <h2>Log</h2>
      <div class="log">
        {[...p.logs].reverse().map((l) => (
          <div class={l.level}>
            {formatDateVi(l.created_at)} [{l.step ?? '-'}] {l.message}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Cài đặt                                                              */
/* ------------------------------------------------------------------ */

export interface SettingsProps {
  settings: GeneralSettings;
  config: AppConfig;
  secrets: Record<SecretName, SecretInfo>;
  integ: IntegrationStatus;
  tests?: Record<string, { ok: boolean; message: string }>;
}

export function SettingsPage(p: SettingsProps) {
  const s = p.settings;
  const t = p.tests ?? {};
  const Test = (props: { id: string }) => (t[props.id] ? <div class={`alert ${t[props.id]!.ok ? 'ok' : 'err'}`}>{t[props.id]!.message}</div> : null);
  return (
    <>
      <h1>Cài đặt</h1>
      <div class="grid side">
        <div>
          <div class="card" style="margin-bottom:16px">
            <h2>Khóa API và dịch vụ</h2>
            <p class="small muted">
              Khóa Claude, OpenRouter, DeepSeek, SerpAPI, Google Custom Search và Originality.ai nhập tại <a href="/settings">Cài đặt chung</a> của dashboard (mục "Khóa API và dịch vụ"), dùng chung cho toàn hệ thống. Trạng thái hiện tại:{' '}
              {SECRET_NAMES.map((name) => (
                <span class={`badge ${p.secrets[name].set ? 'ok' : 'pending'}`} style="margin-right:6px">
                  {SECRET_LABELS[name].split(' (')[0]}: {p.secrets[name].set ? p.secrets[name].hint : 'chưa có'}
                </span>
              ))}
            </p>
            <h3 style="margin-top:16px">Kiểm tra kết nối</h3>
            <div class="actions">
              <form method="post" action="/content/settings/test" class="inline">
                <input type="hidden" name="which" value="anthropic" />
                <button class="btn secondary sm" type="submit">
                  Claude
                </button>
              </form>
              <form method="post" action="/content/settings/test" class="inline">
                <input type="hidden" name="which" value="openrouter" />
                <button class="btn secondary sm" type="submit">
                  OpenRouter
                </button>
              </form>
              <form method="post" action="/content/settings/test" class="inline">
                <input type="hidden" name="which" value="deepseek" />
                <button class="btn secondary sm" type="submit">
                  DeepSeek
                </button>
              </form>
              <form method="post" action="/content/settings/test" class="inline">
                <input type="hidden" name="which" value="search" />
                <button class="btn secondary sm" type="submit">
                  Tìm kiếm ({s.searchProvider})
                </button>
              </form>
              <form method="post" action="/content/settings/test" class="inline">
                <input type="hidden" name="which" value="originality" />
                <button class="btn secondary sm" type="submit">
                  Originality.ai
                </button>
              </form>
            </div>
            <div style="margin-top:10px">
              <Test id="anthropic" />
              <Test id="openrouter" />
              <Test id="deepseek" />
              <Test id="search" />
              <Test id="originality" />
            </div>
          </div>
        </div>
        <div class="card">
          <h2>Quy trình và ngưỡng</h2>
          <form method="post" action="/content/settings">
            <fieldset>
              <legend>Thu thập</legend>
              <label>Nhà cung cấp tìm kiếm</label>
              <select name="searchProvider">
                {Object.entries(SEARCH_PROVIDER_LABEL).map(([k, v]) => (
                  <option value={k} selected={k === s.searchProvider}>
                    {v}
                  </option>
                ))}
              </select>
              <div class="row three">
                <div>
                  <label>Google domain</label>
                  <input type="text" name="googleDomain" value={s.googleDomain} />
                </div>
                <div>
                  <label>Quốc gia (gl)</label>
                  <input type="text" name="country" value={s.country} />
                </div>
                <div>
                  <label>Ngôn ngữ (hl)</label>
                  <input type="text" name="language" value={s.language} />
                </div>
              </div>
              <div class="row three">
                <div>
                  <label>
                    Số bài web cần lấy <small>không tính mạng xã hội, video, sàn</small>
                  </label>
                  <input type="number" name="resultsCount" value={String(s.resultsCount)} min={3} max={20} />
                </div>
                <div>
                  <label>
                    Số trang Google tối đa <small>lật thêm để gom đủ; mỗi trang một lượt tìm</small>
                  </label>
                  <input type="number" name="searchMaxPages" value={String(s.searchMaxPages)} min={1} max={5} />
                </div>
                <div>
                  <label>Nguồn tối thiểu</label>
                  <input type="number" name="minSources" value={String(s.minSources)} min={1} max={20} />
                </div>
                <div>
                  <label>Nguồn tối đa</label>
                  <input type="number" name="maxSources" value={String(s.maxSources)} min={1} max={20} />
                </div>
              </div>
              <label class="check">
                <input type="checkbox" name="englishFallback" checked={s.englishFallback} /> Thiếu nguồn tiếng Việt thì tìm thêm nguồn tiếng Anh
              </label>
              <label>
                Domain bỏ qua <small>mỗi dòng một domain: site của bạn, đối thủ, trang rác</small>
              </label>
              <textarea name="blockedDomains">{s.blockedDomains.join('\n')}</textarea>
              <div class="row">
                <div>
                  <label>Ghi chú tối thiểu (từ)</label>
                  <input type="number" name="notesMinWords" value={String(s.notesMinWords)} />
                </div>
                <div>
                  <label>Ghi chú tối đa (từ)</label>
                  <input type="number" name="notesMaxWords" value={String(s.notesMaxWords)} />
                </div>
              </div>
            </fieldset>
            <fieldset>
              <legend>Bài viết mặc định</legend>
              <div class="row">
                <div>
                  <label>Số từ tối thiểu</label>
                  <input type="number" name="articleMinWords" value={String(s.articleMinWords)} />
                </div>
                <div>
                  <label>Số từ tối đa</label>
                  <input type="number" name="articleMaxWords" value={String(s.articleMaxWords)} />
                </div>
              </div>
              <div class="row three">
                <div>
                  <label>Kiểu viết</label>
                  <select name="defaultStyle">
                    {CONTENT_STYLE_CHOICES.map((c) => (
                      <option value={c.id} selected={c.id === s.defaultStyle}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>Ngôi kể</label>
                  <select name="defaultVoice">
                    {Object.entries(VOICE_LABEL).map(([k, v]) => (
                      <option value={k} selected={k === s.defaultVoice}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>Từ vựng</label>
                  <select name="defaultDialect">
                    {Object.entries(DIALECT_LABEL).map(([k, v]) => (
                      <option value={k} selected={k === s.defaultDialect}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div class="row">
                <div>
                  <label class="check" style="margin-top:22px">
                    <input type="checkbox" name="comparisonMode" checked={s.comparisonMode} /> Mặc định viết 100% dạng so sánh
                  </label>
                  <p class="hint">Mỗi mục H2 đối chiếu từ hai đối tượng trở lên và có bảng so sánh: cách chế biến, biến thể, quán, giá, món tương tự. Bỏ tick được cho từng bài lúc tạo.</p>
                </div>
                <div>
                  <label>
                    Số trang top đầu Google được ưu tiên <small>0 đến 5</small>
                  </label>
                  <input type="number" name="topSitesPriority" value={String(s.topSitesPriority)} min={0} max={5} />
                  <p class="hint">Bước rút ghi chú lập hồ sơ cấu trúc và nhãn nội dung của các trang này; bố cục bắt buộc có các nhãn đó và xếp theo thứ tự của chúng, vì đó là dạng nội dung Google đang xếp cao.</p>
                </div>
              </div>
            </fieldset>
            <fieldset>
              <legend>Tổng hợp quán theo khu vực (Google Maps)</legend>
              <div class="row three">
                <div>
                  <label>
                    Số đánh giá tối thiểu <small>quán ít hơn bị loại</small>
                  </label>
                  <input type="number" name="roundupMinReviews" value={String(s.roundupMinReviews)} min={0} max={500} />
                </div>
                <div>
                  <label>
                    Hằng số m <small>số lượt cần có trước khi tin số sao; lớn hơn = kéo quán ít lượt về mức chung mạnh hơn</small>
                  </label>
                  <input type="number" name="roundupBayesM" value={String(s.roundupBayesM)} min={1} max={500} />
                </div>
                <div>
                  <label>
                    Số quán ứng viên <small>20 quán một lượt tìm</small>
                  </label>
                  <input type="number" name="roundupCandidates" value={String(s.roundupCandidates)} min={20} max={60} />
                </div>
              </div>
              <div class="row">
                <div>
                  <label>Số quán mặc định vào bài</label>
                  <input type="number" name="roundupPlaces" value={String(s.roundupPlaces)} min={3} max={20} />
                </div>
                <div>
                  <label>
                    Số đánh giá đọc mỗi quán <small>8 = 1 lượt SerpAPI, 16 = 2, 24 = 3</small>
                  </label>
                  <input type="number" name="roundupReviewsPerPlace" value={String(s.roundupReviewsPerPlace)} min={8} max={24} step="8" />
                </div>
                <div>
                  <label>
                    Bán kính khu vực <small>km quanh tâm; 0 = chỉ xét địa chỉ</small>
                  </label>
                  <input type="number" name="roundupRadiusKm" value={String(s.roundupRadiusKm)} min={0} max={100} step="0.5" />
                </div>
                <div>
                  <label>Số từ tối thiểu</label>
                  <input type="number" name="roundupMinWords" value={String(s.roundupMinWords)} />
                </div>
                <div>
                  <label>Số từ tối đa</label>
                  <input type="number" name="roundupMaxWords" value={String(s.roundupMaxWords)} />
                </div>
              </div>
              <label class="check">
                <input type="checkbox" name="roundupPhotos" checked={s.roundupPhotos} /> Tải ảnh đại diện của quán từ Google Maps vào thư mục xuất (ảnh do Google và người dùng đăng, bạn tự chịu trách nhiệm bản quyền khi đăng lại)
              </label>
              <div class="row">
                <div>
                  <label>
                    Sàn sao <small>quán thấp hơn bị loại dù đông khách; cũng là mốc trừ trong điểm xếp hạng</small>
                  </label>
                  <input type="number" name="roundupMinRating" value={String(s.roundupMinRating)} min={0} max={5} step="0.1" />
                </div>
              </div>
              <p class="hint">Điểm = (v/(v+m)) × sao + (m/(v+m)) × sao trung bình + w × log10(1+v), với v là số đánh giá, w là thưởng theo số lượng. Phần Bayes kéo quán ít đánh giá về mức trung bình (chống đánh giá hộ), phần thưởng nâng quán lâu đời đông khách vì tính ổn định. Ví dụ w = 0,2: quán 4,0 sao với 2.208 lượt được 4,69, quán 5,0 sao với 6 lượt chỉ 4,60.</p>
              <div class="row">
                <div>
                  <label>
                    Bài thương hiệu: số ảnh tải <small>0 đến 12, một lượt SerpAPI</small>
                  </label>
                  <input type="number" name="brandPhotos" value={String(s.brandPhotos)} min={0} max={12} />
                </div>
                <div>
                  <label>
                    Bài thương hiệu: số đánh giá đọc <small>8 mỗi lượt</small>
                  </label>
                  <input type="number" name="brandReviews" value={String(s.brandReviews)} min={8} max={24} step="8" />
                </div>
                <div>
                  <label>Bài thương hiệu: số từ</label>
                  <div class="row">
                    <input type="number" name="brandMinWords" value={String(s.brandMinWords)} />
                    <input type="number" name="brandMaxWords" value={String(s.brandMaxWords)} />
                  </div>
                </div>
              </div>
              <label>
                URL gốc ảnh trên web của bạn <small>tùy chọn; ví dụ https://site.vn/wp-content/uploads/2026/09</small>
              </label>
              <input type="text" name="photoBaseUrl" value={s.photoBaseUrl} placeholder="https://site.vn/wp-content/uploads/2026/09" maxlength={300} />
              <p class="hint">Có URL này thì file .md, .html, .json xuất ra trỏ thẳng ảnh tới đó: bạn tải thư mục photos trong gói ZIP lên đúng chỗ rồi đăng bài. Để trống thì .html nhúng sẵn ảnh, .docx nhúng ảnh, còn .md và .json dùng đường dẫn "photos/..." đi cùng gói ZIP.</p>
            </fieldset>
            <fieldset>
              <legend>Giọng người thật</legend>
              <label>
                Đoạn văn mẫu do chính bạn viết <small>2 đến 4 đoạn, tổng 200 đến 600 từ, giọng bạn muốn bài có</small>
              </label>
              <textarea name="styleSamples" class="tall" placeholder="Dán vài đoạn bạn từng viết tay (bài blog cũ, bài đăng Facebook dài, ghi chú). Claude học cách xưng hô, nhịp câu, từ quen dùng từ đây và không sao chép nguyên văn. Đây là cách hạ điểm AI hiệu quả nhất.">
                {s.styleSamples}
              </textarea>
            </fieldset>
            <fieldset>
              <legend>Kiểm tra</legend>
              <div class="row three">
                <div>
                  <label>
                    Điểm AI tối đa <small>%</small>
                  </label>
                  <input type="number" name="aiScoreMax" value={String(Math.round(s.aiScoreMax * 100))} min={0} max={100} />
                </div>
                <div>
                  <label>
                    Trùng nguồn tối đa <small>%</small>
                  </label>
                  <input type="number" name="dupRatioMax" value={String(Math.round(s.dupRatioMax * 100))} min={0} max={100} />
                </div>
                <div>
                  <label>Chuỗi từ so trùng</label>
                  <input type="number" name="shingleSize" value={String(s.shingleSize)} min={4} max={20} />
                </div>
              </div>
              <label>Cách lấy điểm AI</label>
              <select name="detectorMode">
                {Object.entries(DETECTOR_MODE_LABEL).map(([k, v]) => (
                  <option value={k} selected={k === s.detectorMode}>
                    {v}
                  </option>
                ))}
              </select>
              <p class="hint">Chấm tay dùng gói trả trước của Originality.ai (không cần Enterprise): tool chạy hết kiểm tra nội bộ và vòng sửa trước, chỉ dừng khi cần điểm; bạn dán bài lên web và nhập số.</p>
              <div class="row three">
                <div>
                  <label>Số vòng tự sửa tối đa</label>
                  <input type="number" name="maxFixRounds" value={String(s.maxFixRounds)} min={0} max={6} />
                </div>
                <div>
                  <label>
                    Số lần chấm tay tối đa <small>mỗi bài</small>
                  </label>
                  <input type="number" name="maxManualScans" value={String(s.maxManualScans)} min={1} max={6} />
                </div>
                <div>
                  <label>
                    Model Originality.ai <small>API, multilang cho tiếng Việt</small>
                  </label>
                  <input type="text" name="originalityModel" value={s.originalityModel} />
                </div>
              </div>
              <label class="check">
                <input type="checkbox" name="webPlagiarismCheck" checked={s.webPlagiarismCheck} /> Quét trùng toàn web bằng Originality.ai (tốn thêm credit, chậm hơn)
              </label>
            </fieldset>
            <fieldset>
              <legend>Model viết bài</legend>
              <label>Nhà cung cấp mặc định cho bài mới</label>
              <select name="llmProvider">
                {Object.entries(LLM_PROVIDER_LABEL).map(([k, v]) => (
                  <option value={k} selected={k === s.llmProvider}>
                    {v}
                  </option>
                ))}
              </select>
              <p class="hint">Từng bài chọn lại được ở form "Viết bài mới". Cả ba nhà cung cấp dùng chung prompt, cổng chất lượng và quy trình kiểm tra.</p>
              <div class="row">
                <div>
                  <label>
                    DeepSeek: model viết <small>deepseek-chat (nhanh, trần 8K token ra) hoặc deepseek-reasoner (suy luận, chậm và tốn hơn)</small>
                  </label>
                  <input type="text" name="deepseekWriterModel" value={s.deepseekWriterModel} />
                </div>
                <div>
                  <label>
                    DeepSeek: model đọc nguồn <small>thường để deepseek-chat</small>
                  </label>
                  <input type="text" name="deepseekResearchModel" value={s.deepseekResearchModel} />
                </div>
                <div>
                  <label>
                    DeepSeek: nhiệt độ sinh <small>DeepSeek khuyên 1,3 hội thoại, 1,5 viết sáng tạo; deepseek-reasoner bỏ qua</small>
                  </label>
                  <input type="number" name="deepseekTemperature" value={String(s.deepseekTemperature)} min={0} max={2} step="0.1" />
                </div>
              </div>
              <div class="row">
                <div>
                  <label>
                    OpenRouter: model viết <small>dạng hang/ten-model, xem openrouter.ai/models</small>
                  </label>
                  <input type="text" name="openrouterWriterModel" value={s.openrouterWriterModel} />
                </div>
                <div>
                  <label>
                    OpenRouter: model đọc nguồn <small>rẻ, ngữ cảnh dài</small>
                  </label>
                  <input type="text" name="openrouterResearchModel" value={s.openrouterResearchModel} />
                </div>
              </div>
              <div class="row">
                <div>
                  <label>
                    OpenRouter: nhiệt độ sinh <small>0 đến 2, mặc định 1; cao hơn = văn ít "an toàn" hơn; tab "Thử model" giúp chọn</small>
                  </label>
                  <input type="number" name="openrouterTemperature" value={String(s.openrouterTemperature)} min={0} max={2} step="0.1" />
                </div>
                <div>
                  <label>
                    OpenRouter: mức suy nghĩ <small>cho model suy luận; thấp = ít tốn token, ít bị cắt. DeepSeek trên OpenRouter không giảm được, chỉ tắt được: mức thấp tự tắt suy nghĩ với model deepseek (trừ r1/reasoner)</small>
                  </label>
                  <label class="check" style="margin-top:8px">
                    <input type="checkbox" name="llmFallback" checked={s.llmFallback} /> OpenRouter hoặc DeepSeek lỗi tạm thời 3 lần liên tiếp thì chạy tiếp bằng Claude
                  </label>
                  <select name="openrouterReasoning">
                    {(['off', 'low', 'medium', 'high'] as const).map((v) => (
                      <option value={v} selected={v === s.openrouterReasoning}>
                        {v === 'off' ? 'Tắt suy nghĩ (model nào cho phép tắt)' : v === 'low' ? 'Thấp (khuyên dùng)' : v === 'medium' ? 'Vừa' : 'Cao'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </fieldset>
            <fieldset>
              <legend>Claude</legend>
              <div class="row">
                <div>
                  <label>
                    Model viết <small>bố cục, viết, biên tập, sửa, duyệt</small>
                  </label>
                  <input type="text" name="writerModel" value={s.writerModel} />
                </div>
                <div>
                  <label>
                    Model đọc nguồn <small>rút ghi chú</small>
                  </label>
                  <input type="text" name="researchModel" value={s.researchModel} />
                </div>
              </div>
              <label>Mức nỗ lực (effort)</label>
              <select name="effort">
                {['low', 'medium', 'high', 'xhigh', 'max'].map((e) => (
                  <option value={e} selected={e === s.effort}>
                    {e}
                  </option>
                ))}
              </select>
            </fieldset>
            <p>
              <button class="btn" type="submit">
                Lưu cài đặt
              </button>
            </p>
          </form>
        </div>
      </div>
    </>
  );
}

function envHas(config: AppConfig, name: SecretName): boolean {
  const map: Record<SecretName, string> = {
    anthropic_key: config.ANTHROPIC_API_KEY,
    openrouter_key: config.OPENROUTER_API_KEY,
    deepseek_key: config.DEEPSEEK_API_KEY,
    serpapi_key: config.SERPAPI_KEY,
    google_cse_key: config.GOOGLE_CSE_KEY,
    google_cse_cx: config.GOOGLE_CSE_CX,
    originality_key: config.ORIGINALITY_API_KEY,
  };
  return Boolean(map[name]);
}

export function LogsPage(props: { logs: LogRow[] }) {
  return (
    <div class="card">
      <h1>Log toàn hệ thống</h1>
      <div class="log">
        {[...props.logs].reverse().map((l) => (
          <div class={l.level}>
            {formatDateVi(l.created_at)} {l.run_id ? `#${l.run_id}` : ''} [{l.step ?? '-'}] {l.message}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab Quán (bài tổng hợp theo khu vực)                                 */
/* ------------------------------------------------------------------ */

function PlacesTab(p: RunDetailProps) {
  const d = p.places?.content;
  if (!d) return <div class="card muted">Chưa có danh sách quán. Bước "Tìm quán trên Maps" chưa chạy.</div>;
  const waiting = p.run.status === 'waiting_places';
  const busy = p.run.status === 'queued' || p.run.status === 'running';
  const eligible = d.candidates.filter((x) => !x.excludedReason);
  const excluded = d.candidates.filter((x) => x.excludedReason);
  const featuredCount = eligible.filter((x) => x.featured).length;
  return (
    <form method="post" action={`/runs/${p.run.id}/places`} id="places-form">
      <div class="card" style="margin-bottom:16px">
        <h2>
          Quán {d.dish} ở {d.area} (bản {p.places!.version}) · <span id="featured-live">{featuredCount}</span> quán vào bài / {eligible.length} đủ điều kiện / {d.candidates.length} trên Maps
          <span id="featured-unsaved" class="pill" style="display:none;margin-left:8px">
            đang tích <b id="featured-picked">{featuredCount}</b> (đã lưu {featuredCount}); bấm Duyệt là dùng các quán đang tích
          </span>
        </h2>
        {/* Đếm ô tick ngay khi người dùng đổi, trước khi bấm Lưu */}
        {raw(
          `<script>(function(){var f=document.getElementById('places-form');var live=document.getElementById('featured-live');var tag=document.getElementById('featured-unsaved');var picked=document.getElementById('featured-picked');if(!f||!live)return;var saved=${featuredCount};function upd(){var n=f.querySelectorAll('input[name$="_featured"]:checked').length;live.textContent=String(n);if(picked)picked.textContent=String(n);if(tag)tag.style.display=n===saved?'none':'inline-block';}f.addEventListener('change',function(e){if(e.target&&/_featured$/.test(e.target.name||''))upd();});upd();})();</script>`,
        )}
        <p class="hint">
          Tìm "{d.query}" trên Google Maps, {d.pagesFetched} trang. Điểm xếp hạng = (sao đã hiệu chỉnh trừ sàn {d.minRating ?? 3.5}) × độ tin cậy theo số lượt (10 lượt = 1, 100 = 2, 1.000 = 3); m = {d.bayesM}, sao trung bình nhóm {d.meanRating.toFixed(2)}, ngưỡng {d.minReviews} đánh giá. Cùng số lượt, quán 4,6 sao được gần gấp đôi quán 4,1 sao. Tick để chọn quán vào bài; ghi chú trải nghiệm thật của bạn ở cột cuối, chỉ quán có ghi chú mới được kể ở ngôi thứ nhất.
        </p>
        <table>
          <thead>
            <tr>
              <th>Hạng</th>
              <th>Vào bài</th>
              <th>Quán</th>
              <th>Sao</th>
              <th>Đánh giá</th>
              <th>Điểm</th>
              <th>Giá · giờ · liên hệ</th>
              <th>Ý từ đánh giá</th>
              <th>Ghi chú của tôi</th>
            </tr>
          </thead>
          <tbody>
            {eligible.map((x) => {
              const i = d.candidates.indexOf(x);
              return (
                <tr>
                  <td>{x.rank}</td>
                  <td>
                    <input type="checkbox" name={`p${i}_featured`} checked={x.featured} />
                  </td>
                  <td>
                    <b>{x.name}</b>
                    {x.photoFile ? <span class="pill">ảnh</span> : null}
                    <div class="small muted">
                      {x.address}
                      {x.branches.length > 1 ? ` (+${x.branches.length - 1} chi nhánh)` : ''}
                    </div>
                    <div class="small">
                      <a href={placeMapsUrl(x)} target="_blank" rel="noopener noreferrer">
                        Mở Google Maps
                      </a>
                      {x.type ? <span class="muted"> · {x.type}</span> : null}
                    </div>
                  </td>
                  <td>{x.rating.toFixed(1)}</td>
                  <td>{x.reviews}</td>
                  <td>{x.score.toFixed(3)}</td>
                  <td class="small">
                    {x.price || '—'}
                    {x.openingHours ? <div class="muted">{x.openingHours}</div> : null}
                    {x.phone ? <div class="muted">{x.phone}</div> : null}
                    {x.website ? (
                      <div class="muted">
                        <a href={x.website} target="_blank" rel="noopener noreferrer">
                          website
                        </a>
                      </div>
                    ) : null}
                  </td>
                  <td class="small">
                    {x.role ? (
                      <div>
                        <b>Vai:</b> {x.role.label}
                        {x.role.bestFor ? <span class="muted"> · hợp nhất khi {x.role.bestFor}</span> : null}
                      </div>
                    ) : null}
                    {x.summary ? (
                      <>
                        {x.summary.oneLine ? <div>{x.summary.oneLine}</div> : null}
                        {x.summary.praised.length ? <div class="muted">Khen: {x.summary.praised.join('; ')}</div> : null}
                        {x.summary.complained.length ? <div class="muted">Chê: {x.summary.complained.join('; ')}</div> : null}
                      </>
                    ) : (
                      <span class="muted">{x.reviewsFetched.length ? `${x.reviewsFetched.length} đánh giá` : 'chưa lấy'}</span>
                    )}
                  </td>
                  <td>
                    <textarea name={`p${i}_note`} rows={2} style="min-height:48px" placeholder="Trải nghiệm thật của bạn, nếu có">
                      {x.userNote}
                    </textarea>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div class="actions" style="margin-top:16px">
          <button class="btn secondary" type="submit" name="action" value="save" disabled={busy}>
            Lưu danh sách
          </button>
          {waiting ? (
            <button class="btn" type="submit" name="action" value="approve">
              Duyệt các quán đang tích và viết bài
            </button>
          ) : (
            <button class="btn" type="submit" name="action" value="rerun" disabled={busy}>
              Lưu, lấy lại đánh giá và viết lại bài
            </button>
          )}
        </div>
      </div>
      {excluded.length ? (
        <details class="panel">
          <summary>{excluded.length} quán bị loại hoặc gộp</summary>
          <table>
            <thead>
              <tr>
                <th>Quán</th>
                <th>Sao</th>
                <th>Đánh giá</th>
                <th>Lý do</th>
              </tr>
            </thead>
            <tbody>
              {excluded.map((x) => (
                <tr style="opacity:.75">
                  <td>
                    {x.name}
                    <div class="small muted">{x.address}</div>
                  </td>
                  <td>{x.rating ? x.rating.toFixed(1) : '—'}</td>
                  <td>{x.reviews}</td>
                  <td class="small muted">{x.excludedReason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </form>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab Thử model                                                        */
/* ------------------------------------------------------------------ */

function ExperimentTab(p: RunDetailProps) {
  const { run } = p;
  const e = p.experiment;
  const busy = run.status === 'queued' || run.status === 'running';
  const hasOutline = Boolean(p.outline);
  const defaults = [`anthropic:${p.integ.anthropic.writerModel}`, `openrouter:${p.integ.openrouter.writerModel}`, 'openrouter:deepseek/deepseek-v4-flash-0731 @t=1.2', `deepseek:${p.integ.deepseek.writerModel} @t=1.5`, `openrouter:${p.integ.openrouter.writerModel} >> anthropic:${p.integ.anthropic.writerModel}`].join('\n');
  const scored = e?.variants.filter((v) => v.status === 'done' && v.aiScore !== null) ?? [];
  const bestId = scored.length ? [...scored].sort((a, b) => a.aiScore! - b.aiScore!)[0]!.id : null;
  const copyJs = `document.querySelectorAll('[data-copy]').forEach(function(b){b.addEventListener('click',function(){var t=document.getElementById(b.getAttribute('data-copy'));navigator.clipboard.writeText(t.value).then(function(){var o=b.textContent;b.textContent='Đã sao chép';setTimeout(function(){b.textContent=o},1500)})})});`;
  return (
    <>
      <div class="card" style="margin-bottom:16px">
        <h2>Thử nghiệm model</h2>
        <p class="hint">
          Cùng ghi chú và bố cục của bài này, viết bằng nhiều model rồi so điểm AI. Mỗi dòng một bản: <code>anthropic:claude-opus-5</code>, <code>openrouter:hang/model</code>, <code>deepseek:deepseek-chat</code> (API trực tiếp platform.deepseek.com), thêm <code>@t=1.2</code> để đổi nhiệt độ (OpenRouter và DeepSeek), thêm <code>&gt;&gt; model-khac</code> để model thứ hai viết lại. Tên model OpenRouter xem tại openrouter.ai/models. Mỗi bản tốn một lượt viết (khoảng 0,3 đến 1 USD) và một lần quét.
        </p>
        {!hasOutline ? <div class="alert warn">Bài chưa có bố cục. Chạy tới bước "Lập bố cục" rồi quay lại.</div> : null}
        <form method="post" action={`/runs/${run.id}/experiment`}>
          <label>
            Các model cần thử <small>tối đa 8 dòng</small>
          </label>
          <textarea name="models" class="tall mono" style="min-height:120px">
            {defaults}
          </textarea>
          <label>
            Ghi chú thử nghiệm <small>tùy chọn</small>
          </label>
          <input type="text" name="note" placeholder="Ví dụ: lần 1, chưa có đoạn mẫu giọng" maxlength={500} />
          <div class="actions" style="margin-top:12px">
            <button class="btn" type="submit" disabled={busy || !hasOutline || p.experimentRunning}>
              Viết thử bằng các model này
            </button>
            {p.experimentRunning ? (
              <button class="btn danger sm" type="submit" formaction={`/runs/${run.id}/experiment/cancel`}>
                Hủy thử nghiệm
              </button>
            ) : null}
          </div>
        </form>
      </div>
      {e ? (
        <div class="card">
          <h2>
            Kết quả {e.status === 'running' ? '(đang chạy, trang tự làm mới)' : e.status === 'cancelled' ? '(đã hủy)' : ''} · {formatDateVi(e.createdAt)}
            {e.note ? <span class="muted small"> · {e.note}</span> : null}
          </h2>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Model</th>
                <th>Trạng thái</th>
                <th>Từ</th>
                <th>Lỗi bắt buộc</th>
                <th>Trùng</th>
                <th>Chi phí</th>
                <th>Điểm AI</th>
                <th>Việc</th>
              </tr>
            </thead>
            <tbody>
              {e.variants.map((v, i) => (
                <tr style={v.id === bestId ? 'background:#e6f6ec' : ''}>
                  <td>{i + 1}</td>
                  <td>
                    <b>{v.write.model}</b>
                    {v.write.temperature !== null ? <span class="pill">t={v.write.temperature}</span> : null}
                    {v.rewrite ? <div class="small muted">viết lại: {v.rewrite.model}</div> : null}
                    {v.error ? <div class="small" style="color:var(--err)">{v.error}</div> : null}
                  </td>
                  <td>
                    <Badge status={v.status} label={v.status === 'done' ? 'Xong' : v.status === 'running' ? 'Đang viết' : v.status === 'failed' ? 'Lỗi' : 'Chờ'} />
                  </td>
                  <td>{v.words || ''}</td>
                  <td>{v.status === 'done' ? v.qualityMajor : ''}</td>
                  <td>{v.status === 'done' ? pct(v.dupRatio, 1) : ''}</td>
                  <td>{v.usd ? usd(v.usd) : ''}</td>
                  <td>
                    {v.aiScore !== null ? (
                      <b style={v.aiScore <= p.settings.aiScoreMax ? 'color:var(--ok)' : 'color:var(--err)'}>
                        {pct(v.aiScore)} {v.id === bestId ? '★' : ''}
                      </b>
                    ) : v.status === 'done' ? (
                      <span class="muted small">chưa chấm</span>
                    ) : (
                      ''
                    )}
                    {v.scoreSource ? <div class="small muted">{v.scoreSource === 'manual' ? 'bạn nhập' : v.scoreSource === 'api' ? 'API' : 'mock'}</div> : null}
                  </td>
                  <td>
                    {v.status === 'done' ? (
                      <div class="actions">
                        <button class="btn secondary sm" type="button" data-copy={`exp-text-${v.id}`}>
                          Sao chép văn bản
                        </button>
                        <form method="post" action={`/runs/${run.id}/experiment/adopt`} class="inline">
                          <input type="hidden" name="variant" value={v.id} />
                          <button class="btn sm" type="submit" disabled={busy || p.experimentRunning}>
                            Dùng bản này
                          </button>
                        </form>
                        <form method="post" action={`/runs/${run.id}/experiment/default`} class="inline">
                          <input type="hidden" name="variant" value={v.id} />
                          <button class="btn secondary sm" type="submit">
                            Đặt mặc định
                          </button>
                        </form>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {e.variants
            .filter((v) => v.status === 'done')
            .map((v) => (
              <details class="panel">
                <summary>
                  Văn bản và nhập điểm cho: {v.label} ({v.words} từ)
                </summary>
                <textarea id={`exp-text-${v.id}`} class="tall mono" readonly style="min-height:160px">
                  {v.text}
                </textarea>
                <form method="post" action={`/runs/${run.id}/experiment/score`} enctype="multipart/form-data" class="row" style="margin-top:8px;align-items:end">
                  <input type="hidden" name="variant" value={v.id} />
                  <div>
                    <label>Điểm AI trên Originality.ai (%)</label>
                    <input type="text" name="score" placeholder="ví dụ 12 hoặc dán 'AI 12% Original 88%'" />
                  </div>
                  <div>
                    <label>Hoặc file .docx xuất từ Originality.ai</label>
                    <input type="file" name="report" accept=".docx" />
                  </div>
                  <div>
                    <button class="btn sm" type="submit">
                      Ghi điểm
                    </button>
                  </div>
                </form>
                {v.flagged.length ? <p class="small muted">{v.flagged.length} câu bị đánh dấu.</p> : null}
              </details>
            ))}
          <p class="hint">
            Cách đọc: bản có điểm AI thấp nhất được tô xanh và đánh dấu ★. "Dùng bản này" lấy bản đó làm bài chính rồi chạy kiểm tra và xuất file. "Đặt mặc định" ghi model đó vào Cài đặt cho các bài sau. Nên so cùng điều kiện: cùng bài, cùng đoạn mẫu giọng, quét cùng model Multi Language.
          </p>
        </div>
      ) : null}
      {raw(`<script>${copyJs}</script>`)}
    </>
  );
}
