# Kế hoạch triển khai: Site Autopilot

Tài liệu này chốt lại toàn bộ quyết định đã thống nhất ngày 09/09/2026 và mô tả hệ thống sẽ được xây dựng. Mã nguồn nằm trong thư mục `site-autopilot/`.

## 1. Mục tiêu và tiêu chí hoàn thành

Mục tiêu: từ dashboard, bạn nhập thông tin cơ bản của một website và bấm "Tạo". Hệ thống tự chạy toàn bộ quy trình cho đến khi website hoạt động, sau đó quản lý tập trung 10 đến 20 website.

Hệ thống chỉ được coi là hoàn thành khi thỏa tất cả các điểm sau:

1. Tạo site mới không cần thao tác tay nào, ngoại trừ đổi nameserver tại Namecheap. Bước này dashboard hiển thị hướng dẫn và tự dò cho đến khi zone active.
2. Cloudflare được cấu hình đúng: bản ghi DNS trỏ về IP host và bật proxy, SSL Flexible, Always Use HTTPS, HTTP/3, Brotli, Bot Fight Mode, 3 rule WAF, 1 rule rate limit.
3. aaPanel đã có site, mã nguồn website tĩnh được đưa lên đúng thư mục, truy cập qua HTTPS trả về trang chủ.
4. Website có đủ nội dung và hình ảnh: Trang chủ, Giới thiệu, Dịch vụ, Blog 5 bài, Liên hệ, Chính sách bảo mật, sitemap, robots.
5. Thông tin Entity SEO trong dashboard được đồng bộ lên website dưới dạng JSON-LD, thẻ Open Graph, favicon, mã theo dõi. Lưu form là website được cập nhật.
6. Dashboard quản lý được ít nhất 20 site: trạng thái từng bước, log lỗi, chạy lại bước hỏng, cập nhật Entity và WAF hàng loạt, kiểm tra sức khỏe định kỳ.
7. Chi phí vận hành thấp hơn 1000 USD mỗi tháng. Dự kiến thực tế khoảng 40 đến 170 USD.

## 2. Quyết định đã chốt

| Hạng mục | Quyết định |
|---|---|
| Nhà đăng ký domain | Namecheap. Bạn tự đổi nameserver, hệ thống dò đến khi active |
| Cloudflare | Một tài khoản, gói Free, API Token giới hạn quyền zone |
| WAF | 3 rule mặc định: chặn bot xấu, thử thách truy cập ngoài quốc gia mục tiêu, chặn đường dẫn quản trị và dò quét. Cộng 1 rule rate limit |
| SSL | Flexible. Bật thêm Always Use HTTPS, HTTP/3, Brotli, Bot Fight Mode |
| Hosting | Một server aaPanel, Nginx, PHP 8.x, một IP cố định. Cấp API key và SSH |
| Loại website | Site tĩnh HTML. Trang doanh nghiệp và blog vệ tinh |
| Cấu trúc trang | Trang chủ, Giới thiệu, Dịch vụ, Blog 5 bài, Liên hệ, Chính sách bảo mật |
| Nội dung | AI sinh qua Claude API, có bước biên tập lại để đảm bảo chất lượng |
| Hình ảnh | Pexels miễn phí, chuyển sang WebP |
| Logo | Tải lên. Nếu thiếu thì tự tạo logo chữ |
| Giao diện | 5 template, mỗi site đổi màu, font, bố cục để không trùng dấu vết |
| Entity SEO | Bộ trường mặc định, lưu là đồng bộ ngay. Tự gửi sitemap lên Google và IndexNow |
| Dashboard | Một tài khoản quản trị, chạy trên VPS dưới subdomain có đăng nhập |
| Công nghệ | Node.js 24, SQLite tích hợp, Hono, TypeScript |

## 3. Kiến trúc

```
┌──────────────────────────────────────────────────────────────┐
│  Dashboard (Hono + JSX)            Worker (cùng tiến trình)  │
│  - Đăng nhập                        - Bộ chạy pipeline dạng DAG│
│  - Tạo site / danh sách / chi tiết  - Hàng đợi job trong SQLite│
│  - Form Entity SEO                  - Lịch: dò NS, health check│
│  - Cài đặt WAF, server, API         - Retry, log từng bước    │
└───────────────┬──────────────────────────────┬───────────────┘
                │ SQLite (node:sqlite)          │
                ▼                               ▼
   ┌────────────────────┐   ┌────────────────────────────────┐
   │ Adapter Cloudflare │   │ Adapter aaPanel API + SSH/SFTP │
   └────────────────────┘   └────────────────────────────────┘
   ┌────────────────────┐   ┌──────────────┐  ┌─────────────┐
   │ Claude API (nội    │   │ Pexels (ảnh) │  │ Google GSC, │
   │ dung 2 lượt)       │   │              │  │ IndexNow    │
   └────────────────────┘   └──────────────┘  └─────────────┘
```

### Pipeline của một site

Pipeline là một đồ thị các bước. Hai nhánh chạy song song, vì đổi nameserver có thể mất nhiều giờ:

Nhánh Cloudflare:
`cf_zone` → `cf_wait_active` → `cf_dns` → `cf_settings` → `cf_waf` → `cf_ratelimit`

Nhánh dựng site:
`host_site` → `gen_plan` → `gen_content` → `gen_images` → `build` → `deploy`

Sau khi cả hai nhánh xong:
`verify_live` → `gsc_verify` → `gsc_sitemap` → `indexnow` → `live`

Mỗi bước có thể chạy lại an toàn. Ví dụ `cf_zone` kiểm tra zone đã tồn tại chưa trước khi tạo. Lỗi ở bước nào thì dashboard hiện đúng bước đó và cho chạy lại.

### Ba rule WAF và rate limit (theo cấu hình bạn đưa ngày 09/09/2026)

1. Skip Bot: `(cf.client.bot)` → skip. Bot đã xác minh bỏ qua mọi rule còn lại, rate limit, WAF managed và Super Bot Fight Mode.
2. Chặn quốc tế: `(ip.src.country ne "VN") and (not ip.src in {IP server})` → block. Hệ thống tự thêm ngoại lệ IP server để bước kiểm tra site và health check từ VPS không bị chặn.
3. Chặn /? phiên bản 7: chặn URL chứa `/?` trừ khi query có `post`, `utm`, `hl=vi-VN`, `ver=`, `customize`; chặn luôn `/xmlrpc.php` và `/wp-cron.php` → block.

Rate limit: `(starts_with(http.request.uri.path, "/"))`, đếm theo `ip.src` và `cf.colo.id`, 100 request mỗi 10 giây, vượt là chặn 10 giây.

Mọi thông số trên chỉnh được trong Cài đặt của dashboard và đồng bộ cho tất cả site bằng một nút.

### Chất lượng nội dung AI

Google không phạt vì nội dung do AI viết, mà phạt nội dung kém chất lượng hoặc sản xuất hàng loạt không có giá trị. Hệ thống áp dụng:

- Mỗi site có một bản kế hoạch riêng: giọng văn, góc nhìn, dịch vụ, chủ đề blog khác nhau, không dùng chung đoạn văn mẫu.
- Sinh nội dung theo hai lượt: lượt viết, rồi lượt biên tập với danh sách kiểm tra về tính cụ thể, số liệu, tránh câu sáo rỗng, giọng tự nhiên tiếng Việt.
- Thông tin doanh nghiệp thật được đưa vào nội dung: tên, địa chỉ, dịch vụ, khu vực.
- Có tác giả, trang giới thiệu, chính sách, thông tin liên hệ rõ ràng để tăng tín hiệu E-E-A-T.
- Ảnh có alt text mô tả đúng, tiêu đề và meta description riêng từng trang, liên kết nội bộ hợp lý.
- Dashboard cho xem và sửa lại từng trang, có thể sinh lại một trang mà không ảnh hưởng trang khác.

Bổ sung ngày 10/09/2026, sau khi bạn nhận xét nội dung chưa hay: có ba kiểu viết chọn được cho từng site (Kể chuyện thương hiệu, Chuyên gia giải đáp, Hướng dẫn thực chiến, hoặc tự chọn theo ngành) và ba kỹ thuật giữ chân người đọc cài sẵn cho mọi kiểu (móc câu và kết luận trước kèm "Tóm tắt nhanh"; nội dung có thịt với bảng, checklist, callout, liên kết nội bộ giữa bài; nhịp đọc với mục lục, heading có thông tin, "Bước tiếp theo").

### Entity SEO

Dữ liệu Entity lưu theo từng site và sinh ra: Organization hoặc LocalBusiness, WebSite, WebPage, BreadcrumbList, BlogPosting với Person tác giả, FAQPage, ContactPage, AboutPage. Kèm favicon, Open Graph, mã GA4 và GTM, thẻ xác minh Google Search Console. Lưu form là hệ thống dựng lại site và đẩy lên host.

## 4. Giai đoạn thực hiện

| Giai đoạn | Nội dung | Kết quả kiểm chứng |
|---|---|---|
| 0 | Khung dự án, cấu hình, tài liệu cài đặt, chế độ mô phỏng | Chạy được dashboard cục bộ, pipeline chạy hết bằng adapter giả |
| 1 | Module Cloudflare | Chạy thật trên 1 domain: zone, DNS, SSL, WAF, rate limit đúng |
| 2 | Module aaPanel và deploy qua SSH | Site xuất hiện trong aaPanel, file lên đúng thư mục |
| 3 | Sinh kế hoạch, nội dung, ảnh, logo, dựng site tĩnh | Site đầy đủ trang, ảnh WebP, sitemap, robots, JSON-LD hợp lệ |
| 4 | Dashboard hoàn chỉnh, pipeline DAG, chạy lại, log | Tạo site từ form, theo dõi đến Live |
| 5 | Entity SEO, Google Search Console, IndexNow | Lưu form là site cập nhật, sitemap được gửi |
| 6 | Vận hành: health check, cảnh báo, chạy thật 3 đến 5 site, mở rộng 20 | 20 site hiển thị và quản lý được trên dashboard |

## 5. Chi phí dự kiến cho 20 site

| Khoản | Mỗi tháng |
|---|---|
| Cloudflare Free | 0 USD |
| VPS aaPanel, nếu chưa có | 20 đến 40 USD |
| Dashboard chạy chung VPS | 0 USD, hoặc 6 đến 12 USD nếu tách riêng |
| Claude API sinh nội dung | 2 đến 5 USD mỗi site khi tạo, sau đó rất nhỏ |
| Pexels | 0 USD |
| Google Search Console API, IndexNow | 0 USD |
| Tổng | khoảng 40 đến 170 USD |

## 6. Trạng thái ngày 09/09/2026

Đã hoàn thành mã nguồn cho toàn bộ giai đoạn 0 đến 5 và chạy được trọn vẹn ở chế độ mô phỏng:

- Pipeline 17 bước chạy đúng thứ tự, hai nhánh song song, có chạy lại từng bước.
- Dashboard: đăng nhập, tạo site, chi tiết site, Entity SEO, nội dung, cài đặt WAF và server, tác vụ, log, xem bản dựng.
- Website tĩnh sinh ra đủ trang, ảnh WebP, favicon, Open Graph, sitemap, robots, JSON-LD hợp lệ.
- Bộ test tự động: 19 test, trong đó có test đầu-cuối bằng dịch vụ giả lập.

Chưa làm được vì cần key thật của bạn: chạy trên domain thật với Cloudflare, aaPanel, Claude, Pexels. Đây là giai đoạn 6.

Bổ sung cùng ngày: bộ script cài VPS Ubuntu mới toanh (`deploy/setup-vps.sh`, `deploy/install.sh`, `deploy/configure.sh`, `deploy/pack.ps1`) và hướng dẫn từng bước trong `HUONG-DAN-VPS-MOI.md`.

## 7. Những gì bạn cần cung cấp để chạy thật

1. Cloudflare: Account ID và API Token. Quyền cần có được liệt kê trong `site-autopilot/README.md`.
2. aaPanel: địa chỉ panel, API key, và thêm IP của máy chạy dashboard vào danh sách IP được phép gọi API.
3. SSH: user, cổng, và khóa private hoặc mật khẩu của server aaPanel.
4. Anthropic API key để sinh nội dung.
5. Pexels API key, đăng ký miễn phí.
6. Tùy chọn: file JSON service account của Google Cloud đã bật Site Verification API và Search Console API, để tự thêm site vào Search Console và gửi sitemap.
7. Tùy chọn: Telegram bot token và chat ID để nhận cảnh báo.
