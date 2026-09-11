# Site Autopilot

Tự động hóa toàn bộ quy trình: domain → Cloudflare (DNS, SSL Flexible, WAF, rate limit) → aaPanel → website tĩnh có nội dung và ảnh → Entity SEO → Google Search Console và IndexNow. Quản lý 10 đến 20 website từ một dashboard.

## 1. Chạy thử ngay trên máy bạn (không cần key nào)

```bash
npm install
npm run mock
```

Mở http://127.0.0.1:3000, đăng nhập `admin` / `admin123` (đặt trong file `.env`; nếu `.env` không có mật khẩu, lần mở đầu tiên sẽ hiện trang đặt mật khẩu ngay trên web). Ở chế độ MOCK, mọi dịch vụ bên ngoài đều là giả lập: bạn tạo site, xem pipeline chạy hết 17 bước trong vài giây, bấm "Xem bản dựng" để xem website sinh ra. Không tốn tiền, không gọi ra ngoài.

## 2. Cài đặt thật trên VPS

**VPS Ubuntu mới toanh chưa có gì:** làm theo [HUONG-DAN-VPS-MOI.md](../HUONG-DAN-VPS-MOI.md). Tóm tắt: trên Windows chạy `deploy\pack.ps1 -Server IP` để tải mã nguồn lên, rồi trên VPS chạy lần lượt `deploy/setup-vps.sh` (hệ thống, bảo mật, aaPanel, Nginx, bật API), `deploy/install.sh` (Node.js, PM2, build) và `deploy/configure.sh` (nhập key, tạo `.env`).

**VPS đã có aaPanel:** tải mã nguồn lên `/root/site-autopilot` rồi:

```bash
bash /root/site-autopilot/deploy/install.sh && cd /opt/site-autopilot && bash deploy/configure.sh
```

Dashboard lắng nghe nội bộ ở cổng 3000. Truy cập bằng SSH tunnel từ Windows (`ssh -L 3000:127.0.0.1:3000 root@IP` rồi mở http://localhost:3000), hoặc thêm subdomain trong aaPanel với reverse proxy tới `http://127.0.0.1:3000` theo mẫu `deploy/nginx-panel.conf` và bật SSL Let's Encrypt.

Muốn chạy trên máy Windows cá nhân thay vì VPS cũng được: `npm run build` rồi `npm start`, nhưng phải thêm IP nhà bạn vào whitelist API của aaPanel và mở SSH từ IP đó.

## 3. Lấy các key

Cloudflare, Claude, Pexels, Google và Telegram nhập trực tiếp trên dashboard tại **Cài đặt → Khóa API và dịch vụ**: khóa được mã hóa bằng `SESSION_SECRET` trước khi lưu, không hiển thị lại, chỉ thấy trạng thái và 4 ký tự cuối, và có hiệu lực ngay. Các biến trong `.env` bên dưới là cách thay thế cho người muốn cấu hình bằng file; khóa trên dashboard luôn được ưu tiên.

| Biến | Cách lấy |
|---|---|
| `ADMIN_PASSWORD`, `SESSION_SECRET` | Tự đặt. Mật khẩu mạnh, chuỗi bí mật ngẫu nhiên |
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → Create Token → Custom token. Quyền: **Zone · Zone · Edit**, **Zone · DNS · Edit**, **Zone · Zone Settings · Edit**, **Zone · Zone WAF · Edit**, **Zone · Bot Management · Edit**, **Account · Account Settings · Read**. Zone Resources: Include → All zones from an account → chọn tài khoản |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare → mở bất kỳ domain → Overview → cột phải "Account ID" |
| `AAPANEL_URL` | Địa chỉ panel kèm cổng, ví dụ `https://1.2.3.4:31750`. Xem cổng bằng lệnh `bt 14` trên server |
| `AAPANEL_API_KEY` | aaPanel → Settings → API Interface → bật → sao chép Interface key. Thêm IP máy chạy dashboard vào IP whitelist (chạy trên VPS thì thêm `127.0.0.1` và IP public của VPS) |
| `AAPANEL_SERVER_IP` | IP public của VPS, dùng cho bản ghi A |
| `SSH_HOST`, `SSH_USER`, `SSH_KEY_PATH` | SSH tới VPS để tải file. Chạy trên VPS: `SSH_HOST=127.0.0.1`, khóa do `install.sh` tạo |
| `ANTHROPIC_API_KEY` | https://platform.claude.com → API Keys. Model mặc định `claude-opus-5`, chi phí khoảng 2 đến 5 USD cho một site đầy đủ |
| `PEXELS_API_KEY` | https://www.pexels.com/api → Get Started, miễn phí |
| `GOOGLE_SERVICE_ACCOUNT_JSON` (tùy chọn) | Google Cloud Console → tạo project → bật **Site Verification API** và **Google Search Console API** → IAM → Service Accounts → tạo → Keys → JSON. Lưu vào `secrets/google-service-account.json`. Điền `GOOGLE_OWNER_EMAIL` là Gmail của bạn để được thêm làm chủ sở hữu property |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (tùy chọn) | Tạo bot với @BotFather, lấy chat id bằng @userinfobot. Nhận cảnh báo khi site lỗi hoặc live |

Vào Cài đặt trên dashboard và bấm "Kiểm tra Cloudflare / aaPanel / SSH" để xác nhận trước khi tạo site đầu tiên.

## 4. Quy trình tạo một site

1. Dashboard → **Tạo site**: điền domain, thương hiệu, ngành, khu vực, dịch vụ, từ khóa, thông tin liên hệ, logo (không bắt buộc). Bấm "Tạo và chạy tự động".
2. Hệ thống chạy hai nhánh song song:
   - Cloudflare: tạo zone → **chờ bạn đổi nameserver tại Namecheap** (dashboard hiện đúng hai nameserver cần điền) → DNS → SSL Flexible và tối ưu → 3 rule WAF → rate limit.
   - Dựng site: thêm site vào aaPanel → AI lập kế hoạch → viết và biên tập từng trang → tải ảnh Pexels → dựng HTML → tải lên host.
3. Khi cả hai xong: kiểm tra HTTPS → xác minh Google Search Console → gửi sitemap → IndexNow → **Live**.
4. Vào **Entity SEO** của site để điền đầy đủ địa chỉ, giờ mở cửa, mạng xã hội, tác giả, GA4. Lưu là website được dựng lại và cập nhật ngay.

Bước nào lỗi sẽ hiện màu đỏ với nguyên nhân. Bấm "Chạy lại" để chạy lại bước đó, "Từ đây" để chạy lại bước đó và mọi bước phía sau.

## 5. Quản lý hàng ngày

- **Kho ảnh thật**: trang site → Kho ảnh thật → tải ảnh của bạn lên (nhiều ảnh, gắn tag như `mat-tien`, `mon`, `khong-gian`, slug dịch vụ) hoặc "Nhập từ Google Maps" bằng link share.google, link Maps, Place ID hay tên quán (cần Google Maps Platform API key có bật Places API New). Mặc định chỉ lấy ảnh do chính doanh nghiệp đăng; ảnh của khách thuộc bản quyền của họ nên chỉ lấy khi bạn tick và đã xin phép. Bấm "Áp dụng ảnh vào website và dựng lại" để thay toàn bộ ảnh stock. Bỏ tick "Dùng ảnh stock Pexels" trong brief nếu muốn site không bao giờ dùng ảnh stock.
- **Chỉnh sửa trực quan**: trang site → Chỉnh sửa trực quan → chọn trang cần sửa. Trang hiện đúng như website thật; nhấp vào tiêu đề, nút, câu hỏi để gõ lại tại chỗ (Enter để xong, Esc để hủy), nhấp vào đoạn văn để sửa markdown trong bảng bên phải rồi "Áp dụng", nhấp vào ảnh để chọn ảnh trong kho, tải ảnh mới hoặc bỏ ảnh. Nút "Tiêu đề & mô tả SEO" sửa thẻ title và meta description. Bấm "Lưu và dựng lại" là nội dung được lưu, website dựng lại và đưa lên host ngay. Ảnh chọn tay được giữ nguyên khi hệ thống gán lại ảnh hàng loạt.
- **Viết thêm bài blog**: trong trang site, nhập chủ đề (hoặc để trống cho AI đề xuất) → Viết. Bài mới được dựng, deploy và gửi IndexNow.
- **Sinh lại một trang**: Nội dung → Sinh lại. Hoặc sửa JSON trực tiếp rồi Lưu.
- **Đổi giao diện**: Sửa brief → chọn theme → "Đổi theme và dựng lại".
- **WAF**: Cài đặt → bật tắt Skip Bot, đổi quốc gia được phép, từ cho phép trong query, đường dẫn chặn, ngưỡng rate limit → "Lưu và đồng bộ tất cả site". Ba rule mặc định: Skip Bot cho bot đã xác minh, chặn truy cập ngoài VN (miễn IP server), chặn URL có `/?` lạ cùng xmlrpc và wp-cron; rate limit 100 request mỗi 10 giây.
- **Sức khỏe**: tự kiểm tra mỗi 15 phút (DNS qua Cloudflare, HTTPS 200, zone active, SSL Flexible, số rule WAF). Cảnh báo qua Telegram nếu cấu hình.
- **Xóa site**: trong trang site, chọn có xóa zone Cloudflare và site aaPanel hay không.

## 6. Cấu trúc mã nguồn

```
src/
  config.ts            đọc .env
  db/                  SQLite (node:sqlite), schema và truy vấn
  core/                pipeline DAG, worker, các bước, job, log
  services/            adapter Cloudflare, aaPanel, SSH, Claude, Pexels, Google, IndexNow, Telegram + bản mock
  generator/           kế hoạch nội dung, template JSX, CSS, ảnh, logo, JSON-LD, WAF rule, builder
  monitor/             health check
  web/                 dashboard Hono: auth, view, form, route
test/                  vitest (có test đầu-cuối bằng mock)
deploy/                install.sh, PM2, mẫu nginx
data/                  DB, ảnh cache, bản dựng từng site (tự tạo)
```

Lệnh hữu ích: `npm test`, `npm run typecheck`, `npm run cli -- list`, `npm run cli -- test`, `npm run cli -- retry vidu.com cf_waf --from`.

## 7. Lưu ý về SSL Flexible

Flexible nghĩa là Cloudflare ↔ host đi HTTP thường. Vì vậy site trong aaPanel được tạo ở cổng 80, **không bật Force HTTPS trong aaPanel** (sẽ gây vòng lặp chuyển hướng). Muốn nâng lên Full (strict) sau này chỉ cần đổi một bước trong `src/core/steps.ts` và cài chứng chỉ Origin CA, hệ thống đã sẵn sàng cho việc đó.

## 8. Chất lượng nội dung AI

Google không phạt nội dung do AI viết, mà phạt nội dung kém giá trị hoặc sản xuất hàng loạt. Hệ thống: mỗi site có kế hoạch, giọng văn và chủ đề riêng; viết hai lượt (viết rồi biên tập theo checklist chống sáo rỗng, không bịa số liệu); nhúng thông tin doanh nghiệp thật; có tác giả, giới thiệu, chính sách, liên hệ; ảnh có alt; title, meta, JSON-LD riêng từng trang.

**Ba kiểu viết**, chọn khi tạo site hoặc trong Sửa brief (mặc định "Tự chọn theo ngành"):

| Kiểu | Giọng | Hợp với |
|---|---|---|
| Kể chuyện thương hiệu | Cây viết địa phương, chi tiết giác quan, câu chuyện thật, thông tin thực dụng ở cuối | Quán ăn, cà phê, spa, thời trang, thủ công, du lịch |
| Chuyên gia giải đáp | Người trong nghề trả lời đúng câu khách hỏi, kết luận trước rồi giải thích, có "Lời khuyên của người trong nghề" | Sửa chữa, kỹ thuật, y tế, pháp lý, tư vấn, blog vệ tinh |
| Hướng dẫn thực chiến | Cẩm nang từng bước, checklist, bảng so sánh, sai lầm thường gặp, ví dụ giả định | Thi công, lắp đặt, vận chuyển, thiết bị, hướng dẫn mua |

**Ba kỹ thuật giữ chân người đọc** áp dụng cho mọi kiểu: mở bài móc câu và kết luận trước kèm hộp "Tóm tắt nhanh"; nội dung có thịt với dữ liệu thật, bảng, checklist, callout Mẹo/Lưu ý và liên kết nội bộ đặt giữa bài; nhịp đọc với đoạn ngắn, câu ngắn xen kẽ, in đậm ý chính, heading có thông tin, mục lục đầu bài và "Bước tiếp theo" cuối bài. Bài liên quan được chọn theo độ trùng chủ đề. Muốn thử kiểu khác cho site đã có: Sửa brief → chọn kiểu → chạy lại từ bước "Lập kế hoạch nội dung".
