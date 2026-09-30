import { describe, expect, it } from 'vitest';
import { addressInArea, applyPlaceRoles, heuristicRoles, buildPlaces, distanceKm, distinctiveName, enforcePlaceSections, formatOperatingHours, formatPhone, headingMatches, heuristicClassify, normalizeGroupKey, normalizePrice, parsePlaceNotes, splitKeyword, stripInjectedLines, titleCaseWords } from '../../src/content-tool/core/roundup.js';
import { checkSectionRepeats } from '../../src/content-tool/generator/quality.js';
import type { Article, PlacesData } from '../../src/content-tool/core/types.js';
import type { RawPlace } from '../../src/content-tool/services/types.js';

const raw = (i: number, over: Partial<RawPlace> = {}): RawPlace => ({
  position: i,
  title: `Hủ tiếu Quán ${i}`,
  placeId: `p${i}`,
  dataId: `d${i}`,
  rating: 4.5,
  reviews: 100,
  price: '',
  type: 'Quán hủ tiếu',
  types: [],
  address: `${i} Thống Nhất, Phan Rang-Tháp Chàm, Ninh Thuận`,
  openState: 'Đang mở cửa',
  hours: '',
  operatingHours: {},
  phone: '',
  website: '',
  description: '',
  thumbnail: '',
  lat: 0,
  lng: 0,
  ...over,
});

describe('tổng hợp quán: tách từ khóa và so địa chỉ', () => {
  it('tách món và khu vực từ một dòng', () => {
    expect(splitKeyword('hủ tiếu phan rang')).toEqual({ dish: 'hủ tiếu', area: 'Phan Rang' });
    expect(splitKeyword('bún bò huế đà lạt')).toEqual({ dish: 'bún bò huế', area: 'Đà Lạt' });
    expect(splitKeyword('cơm tấm quận 3')).toEqual({ dish: 'cơm tấm', area: 'Quận 3' });
    expect(splitKeyword('phở')).toEqual({ dish: 'phở', area: '' });
  });
  it('địa chỉ khớp khu vực kể cả cách viết khác', () => {
    expect(addressInArea('12 Thống Nhất, Phan Rang-Tháp Chàm, Ninh Thuận', 'Phan Rang')).toBe(true);
    expect(addressInArea('12 Thống Nhất, Phan Rang-Tháp Chàm, Ninh Thuận', 'Thành phố Phan Rang')).toBe(true);
    expect(addressInArea('5 Trần Phú, Nha Trang, Khánh Hòa', 'Phan Rang')).toBe(false);
    expect(addressInArea('', 'Phan Rang')).toBe(false);
  });
  it('khóa gộp chi nhánh bỏ số và chữ "chi nhánh"', () => {
    expect(normalizeGroupKey('Hủ tiếu Cô Ba - Chi nhánh 2')).toBe(normalizeGroupKey('Hủ tiếu Cô Ba'));
    expect(normalizeGroupKey('Hủ tiếu Cô Ba')).not.toBe(normalizeGroupKey('Hủ tiếu Cô Bảy'));
  });
  it('gọn giờ mở cửa theo ngày và số điện thoại', () => {
    const all = Object.fromEntries(['thứ hai', 'thứ ba', 'thứ tư', 'thứ năm', 'thứ sáu', 'thứ bảy', 'chủ nhật'].map((d) => [d, '05:00–12:00']));
    expect(formatOperatingHours(all)).toBe('Hằng ngày 05:00 đến 12:00');
    expect(formatOperatingHours({ 'thứ hai': '06:00–13:00', 'thứ ba': '06:00–13:00', 'thứ tư': '06:00–13:00', 'thứ năm': '06:00–13:00', 'thứ sáu': '06:00–13:00', 'thứ bảy': '06:00–12:00', 'chủ nhật': 'Closed' })).toBe('Thứ hai đến Thứ sáu 06:00 đến 13:00; Thứ bảy 06:00 đến 12:00; Chủ nhật đóng cửa');
    expect(formatOperatingHours({ Monday: 'Open 24 hours', Tuesday: 'Open 24 hours' })).toBe('Thứ hai, Thứ ba Mở 24 giờ');
    expect(formatOperatingHours({})).toBe('');
    expect(formatPhone('+84 847 939 688')).toBe('0847 939 688');
    expect(formatPhone('0259 3822 123')).toBe('0259 3822 123');
  });
  it('không gán quán vào mục cấu trúc dù heading có cụm "quán hủ tiếu"', () => {
    expect(headingMatches('So sánh nhanh 6 quán hủ tiếu Phan Rang', 'Quán Hủ Tiếu Sa Đéc', 'hủ tiếu')).toBe(false);
    expect(headingMatches('4. Quán Hủ Tiếu Sa Đéc: mở dài trong ngày', 'Quán Hủ Tiếu Sa Đéc', 'hủ tiếu')).toBe(true);
    expect(headingMatches('1. Ông Giáo, mở từ 5 giờ sáng', 'Hủ Tiếu Nam Vang Ông Giáo', 'hủ tiếu')).toBe(true);
    expect(headingMatches('2. Hủ Tiếu Mực Ông Mập', 'Hủ Tiếu Nam Vang Ông Giáo', 'hủ tiếu')).toBe(false);
    expect(headingMatches('Quán nào hợp ai khi ăn hủ tiếu ở Phan Rang?', 'Quán Hủ Tiếu Sa Đéc', 'hủ tiếu')).toBe(false);
    expect(distinctiveName('Quán Hủ Tiếu Sa Đéc', 'hủ tiếu')).toBe('sa đéc');
    expect(titleCaseWords('phan rang-tháp chàm')).toBe('Phan Rang-Tháp Chàm');
  });
  it('quán trong bán kính quanh tâm được coi là thuộc khu vực dù địa chỉ không ghi tên', () => {
    const center = { lat: 11.5647, lng: 108.9886 };
    expect(distanceKm(center, { lat: 12.2388, lng: 109.1967 })).toBeGreaterThan(70);
    expect(distanceKm(center, { lat: 11.58, lng: 109.0 })).toBeLessThan(3);
    const list: RawPlace[] = [raw(1, { title: 'Hủ tiếu Bảo An', address: '525 21 Tháng 8, Bảo An, Khánh Hòa', lat: 11.58, lng: 109.0 }), raw(2, { title: 'Hủ tiếu Nha Trang', address: '1 Trần Phú, Nha Trang, Khánh Hòa', lat: 12.2388, lng: 109.1967 })];
    const cls = list.map((r, i) => ({ index: i + 1, matchesDish: true, inArea: false, groupKey: '' }));
    const { candidates } = buildPlaces({ raw: list, classes: cls, dish: 'hủ tiếu', area: 'Phan Rang', minReviews: 5, bayesM: 30, featuredCount: 5, userNotes: '', center, radiusKm: 15 });
    expect(candidates.find((p) => p.name === 'Hủ tiếu Bảo An')!.excludedReason).toBeNull();
    expect(candidates.find((p) => p.name === 'Hủ tiếu Nha Trang')!.excludedReason).toMatch(/không thuộc Phan Rang \(cách tâm/);
    // Tắt bán kính thì chỉ xét địa chỉ
    const strict = buildPlaces({ raw: list, classes: cls, dish: 'hủ tiếu', area: 'Phan Rang', minReviews: 5, bayesM: 30, featuredCount: 5, userNotes: '', center, radiusKm: 0 });
    expect(strict.candidates.find((p) => p.name === 'Hủ tiếu Bảo An')!.excludedReason).toMatch(/không thuộc/);
  });
  it('điểm = (sao Bayes trừ sàn) × độ tin cậy theo số lượt: quán lâu năm giữ sao cao thắng rõ', () => {
    const list: RawPlace[] = [raw(1, { title: 'Bánh canh Nhường', rating: 4.0, reviews: 2208 }), raw(2, { title: 'Hủ tiếu Năm Tài', rating: 5.0, reviews: 6 }), raw(3, { title: 'Hủ tiếu Ông Giáo', rating: 4.8, reviews: 33 }), raw(4, { title: 'Quán dở', rating: 3.2, reviews: 900 })];
    const cls = list.map((_r, i) => ({ index: i + 1, matchesDish: true, inArea: true, groupKey: '' }));
    const base = { raw: list, classes: cls, dish: 'hủ tiếu', area: 'Phan Rang', minReviews: 5, bayesM: 30, featuredCount: 5, userNotes: '' };
    const ranked = (cands: ReturnType<typeof buildPlaces>['candidates']) => cands.filter((p) => p.rank > 0).sort((a, b) => a.rank - b.rank);
    // Không đặt sàn: sàn mặc định 3,5; quán 3,2 sao vẫn được xếp nhưng cuối bảng, quán 6 lượt 5 sao không lên đầu
    const plain = ranked(buildPlaces(base).candidates);
    expect(plain.map((p) => p.name)).toEqual(['Bánh canh Nhường', 'Hủ tiếu Ông Giáo', 'Hủ tiếu Năm Tài', 'Quán dở']);
    expect(plain[3]!.score).toBeLessThan(0.2);
    // Có sàn 3,5: quán dở bị loại, sao trung bình nhóm tăng nên quán 4,8 sao 33 lượt vượt lên; quán 2.208 lượt vẫn trên quán 6 lượt
    const floored = buildPlaces({ ...base, minRating: 3.5 }).candidates;
    expect(ranked(floored).map((p) => p.name)).toEqual(['Hủ tiếu Ông Giáo', 'Bánh canh Nhường', 'Hủ tiếu Năm Tài']);
    expect(floored.find((p) => p.name === 'Quán dở')!.excludedReason).toMatch(/dưới sàn 3.5/);
  });
  it('cùng 1.000 lượt, quán 4,6 sao được gần gấp đôi quán 4,1 sao; quán 4,1 sao đông khách vẫn trên quán 5 sao ít lượt', () => {
    const list: RawPlace[] = [raw(1, { title: 'A', rating: 4.6, reviews: 1000 }), raw(2, { title: 'B', rating: 4.1, reviews: 1000 }), raw(3, { title: 'C', rating: 4.7, reviews: 60 }), raw(4, { title: 'D', rating: 4.4, reviews: 300 }), raw(5, { title: 'E', rating: 5.0, reviews: 15 })];
    const cls = list.map((_r, i) => ({ index: i + 1, matchesDish: true, inArea: true, groupKey: '' }));
    const ranked = buildPlaces({ raw: list, classes: cls, dish: 'hủ tiếu', area: 'Phan Rang', minReviews: 5, bayesM: 30, featuredCount: 5, userNotes: '', minRating: 3.5 }).candidates.filter((p) => p.rank > 0).sort((a, b) => a.rank - b.rank);
    expect(ranked.map((p) => p.name)).toEqual(['A', 'D', 'C', 'B', 'E']);
    const by = (n: string) => ranked.find((p) => p.name === n)!.score;
    expect(by('A') / by('B')).toBeGreaterThan(1.7);
    expect(by('A') / by('B')).toBeLessThan(1.9);
    expect(by('B')).toBeGreaterThan(by('E'));
  });
  it('bậc giá của Google thành chữ, khoảng giá thật giữ số', () => {
    expect(normalizePrice('₫1–100.000')).toBe('bình dân (dưới 100.000 đ một người)');
    expect(normalizePrice('1–100.000 ₫')).toBe('bình dân (dưới 100.000 đ một người)');
    expect(normalizePrice('₫100.000–200.000')).toBe('tầm trung (100.000 đến 200.000 đ một người)');
    expect(normalizePrice('$')).toBe('bình dân');
    expect(normalizePrice('$$$')).toBe('khá cao');
    expect(normalizePrice('₫20.000–50.000')).toBe('20.000 đến 50.000 đ');
    expect(normalizePrice('500.000+ ₫')).toBe('cao cấp (trên 500.000 đ một người)');
    expect(normalizePrice('')).toBe('');
  });
  it('phân loại bằng quy tắc khi model lỗi', () => {
    const c = heuristicClassify([raw(1, { title: 'Hủ tiếu Ông Giáo', type: 'Quán ăn nhỏ' }), raw(2, { title: 'Phở Bắc', type: 'Quán phở' }), raw(3, { title: 'Quán Bà Tư', type: 'Quán ăn', address: '1 Trần Phú, Nha Trang' })], 'hủ tiếu', 'Phan Rang');
    expect(c.map((x) => [x.matchesDish, x.inArea])).toEqual([
      [true, true],
      [false, true],
      [true, false],
    ]);
  });
  it('đọc ghi chú "Tên quán: ghi chú"', () => {
    expect(parsePlaceNotes('Cô Ba: tôi ăn ở đây mỗi sáng\ndòng không có tên\nNăm Tài: nước lèo hơi ngọt')).toEqual([
      { name: 'Cô Ba', note: 'tôi ăn ở đây mỗi sáng' },
      { name: 'Năm Tài', note: 'nước lèo hơi ngọt' },
    ]);
  });
});

describe('tổng hợp quán: lọc, gộp, xếp hạng', () => {
  const rawList: RawPlace[] = [
    raw(1, { title: 'Hủ tiếu Cô Ba', rating: 4.5, reviews: 500 }),
    raw(2, { title: 'Hủ tiếu Năm Tài', rating: 4.9, reviews: 12 }),
    raw(3, { title: 'Hủ tiếu Bà Sáu', rating: 4.7, reviews: 90, phone: '+84 847 939 688', website: 'https://basau.vn', operatingHours: { 'thứ hai': '05:00–12:00', 'thứ ba': '05:00–12:00', 'thứ tư': '05:00–12:00', 'thứ năm': '05:00–12:00', 'thứ sáu': '05:00–12:00', 'thứ bảy': '05:00–12:00', 'chủ nhật': '05:00–12:00' } }),
    raw(4, { title: 'Phở Hồng', type: 'Quán phở', rating: 4.8, reviews: 300 }),
    raw(5, { title: 'Hủ tiếu Anh Tư', address: '9 Trần Phú, Nha Trang', rating: 4.8, reviews: 300 }),
    raw(6, { title: 'Hủ tiếu Chú Bảy', openState: 'Đóng cửa vĩnh viễn', rating: 4.8, reviews: 300 }),
    raw(7, { title: 'Hủ tiếu Cô Ba - Chi nhánh 2', rating: 4.1, reviews: 100 }),
    raw(8, { title: 'Hủ tiếu Dì Út', rating: 4.3, reviews: 800 }),
  ];
  const classes = rawList.map((r, i) => ({ index: i + 1, matchesDish: !/phở/i.test(r.title), inArea: !/nha trang/i.test(r.address), groupKey: normalizeGroupKey(r.title) }));
  const { candidates, meanRating } = buildPlaces({ raw: rawList, classes, dish: 'hủ tiếu', area: 'Phan Rang', minReviews: 15, bayesM: 30, featuredCount: 3, userNotes: 'Bà Sáu: tôi hay ăn ở đây' });

  it('loại quán sai món, sai khu vực, đóng cửa, ít đánh giá; gộp chi nhánh', () => {
    const by = (name: string) => candidates.find((p) => p.name === name)!;
    expect(by('Phở Hồng').excludedReason).toMatch(/Không phải quán/);
    expect(by('Hủ tiếu Anh Tư').excludedReason).toMatch(/không thuộc/);
    expect(by('Hủ tiếu Chú Bảy').excludedReason).toBe('Đã đóng cửa');
    expect(by('Hủ tiếu Năm Tài').excludedReason).toMatch(/dưới mức 15/);
    expect(by('Hủ tiếu Cô Ba - Chi nhánh 2').excludedReason).toMatch(/Gộp vào/);
    const coBa = by('Hủ tiếu Cô Ba');
    expect(coBa.reviews).toBe(600);
    expect(coBa.branches.length).toBe(2);
    expect(coBa.rating).toBeCloseTo((4.5 * 500 + 4.1 * 100) / 600, 1);
  });

  it('xếp hạng: quán 600 và 800 lượt giữ sao trên 4,3 đứng trên quán 4,7 sao chỉ 90 lượt', () => {
    const ranked = candidates.filter((p) => p.rank > 0).sort((a, b) => a.rank - b.rank);
    expect(ranked.map((p) => p.name)).toEqual(['Hủ tiếu Cô Ba', 'Hủ tiếu Dì Út', 'Hủ tiếu Bà Sáu']);
    expect(ranked.every((p) => p.featured)).toBe(true);
    expect(meanRating).toBeGreaterThan(4);
    expect(candidates.find((p) => p.name === 'Hủ tiếu Bà Sáu')!.userNote).toBe('tôi hay ăn ở đây');
  });

  it('ép mỗi quán có mục riêng với địa chỉ và link Google Maps, bỏ dòng model tự bịa', () => {
    const data: PlacesData = { dish: 'hủ tiếu', area: 'Phan Rang', query: 'hủ tiếu Phan Rang', center: null, collectedAt: '', pagesFetched: 1, candidates, minReviews: 15, bayesM: 30, meanRating };
    data.candidates.find((p) => p.name === 'Hủ tiếu Cô Ba')!.photoFile = 'photos/2-hu-tieu-co-ba.jpg';
    const article: Article = {
      title: 't',
      metaDescription: 'm',
      h1: 'h',
      excerpt: '',
      quickSummary: [],
      intro: 'Mở bài.',
      sections: [
        { heading: 'So sánh nhanh', level: 2, body: '| Quán | Sao |\n|---|---|\n| a | b |' },
        { heading: '1. Hủ tiếu Bà Sáu: nước lèo trong', level: 2, body: '**Địa chỉ:** 999 đường bịa\n\nĐoạn văn về Bà Sáu.' },
        { heading: '2. Hủ tiếu Cô Ba', level: 2, body: 'Đoạn văn về Cô Ba. Xem [bản đồ](https://google.com/maps/xyz)' },
        { heading: 'Quán nào hợp ai', level: 2, body: 'bảng' },
      ],
      faq: [],
      nextSteps: '',
      images: [],
      targetKeyword: 'hủ tiếu Phan Rang',
      secondaryKeywords: [],
      style: 'story',
    };
    const out = enforcePlaceSections(article, data);
    const baSau = out.sections.find((s) => s.heading.includes('Bà Sáu'))!;
    expect(baSau.body).toContain('**Địa chỉ:** 3 Thống Nhất');
    expect(baSau.body).toContain('**[📍 Mở Google Maps](https://www.google.com/maps/search/?api=1&query=');
    expect(baSau.body).toContain('query_place_id=p3');
    expect(baSau.body).not.toContain('đường bịa');
    expect(baSau.body).toContain('**Giờ mở cửa:** Hằng ngày 05:00 đến 12:00');
    expect(baSau.body).toContain('**Liên hệ:** 0847 939 688 · [Website](https://basau.vn)');
    expect(baSau.body).toContain('**Đánh giá:** 4.7/5 (90 lượt)');
    expect(baSau.body).toContain('Đoạn văn về Bà Sáu');
    const coBa = out.sections.find((s) => s.heading === '2. Hủ tiếu Cô Ba')!;
    expect(coBa.body.startsWith('![Hủ tiếu Cô Ba ở Phan Rang](photos/2-hu-tieu-co-ba.jpg)')).toBe(true);
    expect(coBa.body).toContain('(còn 1 chi nhánh:');
    expect(coBa.body).not.toContain('google.com/maps/xyz');
    // Quán thiếu mục thì được chèn thêm ngay sau mục quán cuối
    const diUt = out.sections.findIndex((s) => s.heading.includes('Dì Út'));
    expect(diUt).toBe(3);
    expect(out.sections[4]!.heading).toBe('Quán nào hợp ai');
    expect(out.images.some((im) => im.src === 'photos/2-hu-tieu-co-ba.jpg')).toBe(true);
    expect(stripInjectedLines(coBa.body)).toBe('Đoạn văn về Cô Ba. Xem');
  });
});

describe('vai riêng của từng quán và kiểm tra mục quán không trùng khuôn', () => {
  const mk = (i: number, o: Partial<RawPlace>) => raw(i, { title: `Quán ${i}`, rating: 4.5, reviews: 100, ...o });
  const list: RawPlace[] = [
    mk(1, { title: 'Bánh canh Nhường', rating: 4.2, reviews: 2208, price: '₫1–100.000', operatingHours: { 'thứ hai': '06:00–21:00' } }),
    mk(2, { title: 'Hủ tiếu Ông Giáo', rating: 4.8, reviews: 320, price: '₫100.000–200.000', operatingHours: { 'thứ hai': '05:00–12:00' } }),
    mk(3, { title: 'Hủ tiếu Đêm', rating: 4.4, reviews: 150, operatingHours: { 'thứ hai': '17:00–01:00' } }),
    mk(4, { title: 'Hủ tiếu Bà Sáu', rating: 4.4, reviews: 90 }),
    mk(5, { title: 'Hủ tiếu Cô Ba', rating: 4.3, reviews: 80 }),
  ];
  const cls = list.map((_r, i) => ({ index: i + 1, matchesDish: true, inArea: true, groupKey: '' }));
  const featured = () => buildPlaces({ raw: list, classes: cls, dish: 'hủ tiếu', area: 'Phan Rang', minReviews: 5, bayesM: 30, featuredCount: 5, userNotes: '' }).candidates.filter((p) => p.rank > 0).sort((a, b) => a.rank - b.rank);

  it('quy tắc gán vai theo điểm nổi trội có số liệu, không hai quán trùng vai', () => {
    const f = featured();
    f.find((p) => p.name === 'Hủ tiếu Bà Sáu')!.summary = { praised: ['tỏi ngâm giòn'], complained: [], signature: ['tô khô tương đen'], bestFor: ['ăn trưa'], oneLine: '', sampleCount: 16 };
    const roles = heuristicRoles(f);
    const by = (n: string) => roles.get(f.find((p) => p.name === n)!.rank)!;
    expect(by('Bánh canh Nhường').label).toMatch(/đông khách nhất với 2.208 lượt/);
    expect(by('Hủ tiếu Ông Giáo').label).toMatch(/sao cao nhất, 4.8 sao/);
    expect(by('Hủ tiếu Đêm').label).toMatch(/mở khuya nhất, tới 01:00/);
    expect(by('Hủ tiếu Bà Sáu').label).toBe('nổi bật với tô khô tương đen');
    expect(by('Hủ tiếu Cô Ba').label).toMatch(/lựa chọn ổn định ở hạng/);
    expect(new Set([...roles.values()].map((r) => r.label)).size).toBe(5);
    expect(new Set([...roles.values()].map((r) => r.bestFor)).size).toBe(5);
  });

  it('vai model trả về được giữ khi hợp lệ; thiếu hoặc trùng thì lấy từ quy tắc', () => {
    const f = featured();
    const fromRules = applyPlaceRoles(f, [
      { index: f[0]!.rank, role: { label: 'quán đông khách nhất, 2.208 lượt', reason: 'nhiều lượt nhất', bestFor: 'muốn quán được kiểm chứng' } },
      { index: f[1]!.rank, role: { label: 'quán đông khách nhất, 2.208 lượt', reason: 'trùng', bestFor: 'x' } },
      { index: f[2]!.rank, role: { label: 'mở khuya duy nhất', reason: 'tới 1 giờ sáng', bestFor: 'ăn khuya' } },
    ]);
    expect(fromRules).toBe(3);
    expect(f[0]!.role!.label).toBe('quán đông khách nhất, 2.208 lượt');
    expect(f[1]!.role!.label).not.toBe('quán đông khách nhất, 2.208 lượt');
    expect(f[2]!.role!.label).toBe('mở khuya duy nhất');
    expect(f.every((p) => p.role?.label)).toBe(true);
    expect(new Set(f.map((p) => p.role!.label.toLowerCase())).size).toBe(5);
  });

  it('bắt hai mục quán mở đầu cùng câu và cụm chữ lặp ở ba mục; bỏ qua cụm chứa tên món', () => {
    const sec = (heading: string, body: string) => ({ heading, level: 2 as const, body });
    const a: Article = {
      title: 't', metaDescription: 'm', h1: 'h', excerpt: '', quickSummary: [], intro: '', faq: [], nextSteps: '', images: [], targetKeyword: 'hủ tiếu Phan Rang', secondaryKeywords: [], style: 'story',
      sections: [
        sec('So sánh nhanh', '| a | b |\n|---|---|\n| 1 | 2 |'),
        sec('1. Bánh canh Nhường', '**Địa chỉ:** 1 A\n\nNước lèo đậm đà là điều khách khen nhiều nhất ở đây, hủ tiếu Phan Rang kiểu này hiếm.'),
        sec('2. Hủ tiếu Ông Giáo', 'Nước lèo đậm đà là điều khách khen nhiều nhất, còn tô khô thì tương đen hơi ngọt. Hủ tiếu Phan Rang kiểu này hiếm.'),
        sec('3. Hủ tiếu Đêm', 'Mở tới một giờ sáng, quán này là chỗ duy nhất trong danh sách bán khuya. Nước lèo đậm đà là điều khách nhắc.'),
      ],
    };
    const issues = checkSectionRepeats(a, [1, 2, 3], 'hủ tiếu');
    expect(issues.map((i) => i.code).sort()).toEqual(['section_repeated_phrase', 'section_same_opening']);
    expect(issues.find((i) => i.code === 'section_same_opening')!.message).toContain('Bánh canh Nhường');
    expect(issues.find((i) => i.code === 'section_repeated_phrase')!.message).toContain('nước lèo đậm đà là');
    expect(issues.find((i) => i.code === 'section_repeated_phrase')!.message).not.toContain('hủ tiếu phan rang kiểu này');
    // Ba mục mở đầu khác nhau, không cụm chung thì không lỗi
    const ok = { ...a, sections: [a.sections[0]!, sec('1. Bánh canh Nhường', 'Hơn hai nghìn lượt đánh giá mà vẫn giữ 4,2 sao, quán này đông nhất danh sách.'), sec('2. Hủ tiếu Ông Giáo', 'Sao cao nhất, 4,8 sau 320 lượt. Tô khô tương đen được nhắc nhiều.'), sec('3. Hủ tiếu Đêm', 'Mở tới một giờ sáng, chỗ duy nhất bán khuya trong danh sách này.')] };
    expect(checkSectionRepeats(ok, [1, 2, 3], 'hủ tiếu')).toEqual([]);
  });
});
