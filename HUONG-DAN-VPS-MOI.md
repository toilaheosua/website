# Hướng dẫn cài từ VPS Ubuntu mới toanh

Áp dụng cho VPS vừa tạo, đăng nhập bằng root qua PuTTY, ví dụ VPS Contabo trong ảnh của bạn. Toàn bộ mất khoảng 20 đến 30 phút, phần lớn là máy tự chạy.

Quy trình gồm 5 bước:

| Bước | Ở đâu | Làm gì |
|---|---|---|
| 1 | Máy Windows | Đóng gói mã nguồn và tải lên VPS |
| 2 | PuTTY | Chạy `setup-vps.sh`: cập nhật hệ thống, bảo mật, aaPanel, Nginx, bật API |
| 3 | PuTTY | Chạy `install.sh`: cài Node.js, PM2, build và chạy dashboard |
| 4 | PuTTY | Chạy `configure.sh`: nhập key, tạo file `.env` |
| 5 | Máy Windows | Mở dashboard qua SSH tunnel, kiểm tra kết nối, tạo site đầu tiên |

## Bước 1. Tải mã nguồn lên VPS (trên máy Windows)

Cách dễ nhất: mở thư mục `site-autopilot\deploy`, nhấp đúp file **`upload.cmd`**, nhập IP VPS khi được hỏi.

Hoặc dùng PowerShell. Vì đường dẫn có khoảng trắng nên phải đặt trong dấu ngoặc kép, chạy được từ bất kỳ thư mục nào:

```bash
powershell -ExecutionPolicy Bypass -File "C:\Đĩa D\Tài Liệu\3. Bot Tháng 9\Tự động hóa Website\site-autopilot\deploy\pack.ps1" -Server IP_VPS
```

Lần đầu kết nối sẽ hỏi `Are you sure you want to continue connecting`, gõ `yes`. Sau đó nhập mật khẩu root của VPS, khi gõ mật khẩu màn hình không hiện ký tự nào là bình thường. Script tạo file nén bỏ qua `node_modules`, `data`, `.env` và tải lên `/root/site-autopilot.tar.gz`.

Nếu thấy cảnh báo `REMOTE HOST IDENTIFICATION HAS CHANGED`: máy Windows từng kết nối tới IP này trước khi VPS được cài lại, nên khóa nhận dạng đã đổi. Script sẽ hỏi có xóa khóa cũ không, gõ `y`. Xóa tay bằng lệnh sau rồi chạy lại:

```bash
ssh-keygen -R IP_VPS
```

## Bước 2. Chuẩn bị VPS (trong PuTTY)

Dán từng dòng:

```bash
cd /root && tar xzf site-autopilot.tar.gz
```

```bash
bash site-autopilot/deploy/setup-vps.sh
```

Script tự chạy khoảng 10 đến 20 phút. Khi xong sẽ in ra địa chỉ đăng nhập aaPanel, tài khoản, mật khẩu và API key. Mọi thông tin được lưu trong `/root/site-autopilot-credentials.txt`, xem lại bất cứ lúc nào bằng:

```bash
cat /root/site-autopilot-credentials.txt
```

Nếu script hỏi khởi động lại, gõ `y`. Đăng nhập PuTTY lại sau khoảng một phút.

Những gì script đã làm cho bạn:

- Cập nhật Ubuntu, đặt múi giờ Việt Nam, tạo swap 2 GB.
- Bật fail2ban chặn dò mật khẩu SSH, bật tự cập nhật bản vá bảo mật.
- Cài aaPanel với tài khoản `autopilot`, cổng ngẫu nhiên, đường dẫn bảo mật ngẫu nhiên.
- Cài Nginx trong aaPanel.
- Bật API aaPanel, whitelist `127.0.0.1` và IP của VPS.
- Tường lửa chỉ mở SSH, 80, 443 và cổng panel.

Nếu cài Nginx tự động thất bại, đăng nhập aaPanel, vào App Store, cài Nginx rồi chạy lại script, các bước đã xong sẽ được bỏ qua.

## Bước 3. Cài Site Autopilot (trong PuTTY)

```bash
cd /root/site-autopilot && bash deploy/install.sh
```

Script cài Node.js 24 và PM2, sao chép ứng dụng vào `/opt/site-autopilot`, build và chạy nền. Dashboard chỉ lắng nghe nội bộ ở cổng 3000, chưa mở ra Internet.

## Bước 4. Nhập key (trong PuTTY)

```bash
cd /opt/site-autopilot && bash deploy/configure.sh
```

Trình hướng dẫn hỏi từng mục, Enter để nhận giá trị gợi ý. Thông tin aaPanel được điền sẵn từ bước 2. Mật khẩu dashboard và các khóa API đều có thể nhấn Enter bỏ qua để đặt trên web ở bước 5.

Chạy lại script này khi muốn đổi thông tin server.

## Bước 5. Mở dashboard (trên máy Windows)

Cách nhanh nhất: trong thư mục dự án, nhấp đúp **MO-DASHBOARD.cmd**. File này tự mở đường hầm SSH tới VPS (cửa sổ đen hiện ra, giữ nguyên đừng đóng) rồi mở trình duyệt vào http://localhost:3000. Lần đầu nên chạy **CAI-KHOA-SSH.cmd** một lần (nhập mật khẩu root lần cuối) để từ đó không phải gõ mật khẩu nữa. Khi có bản mới trên GitHub, nhấp **CAP-NHAT-VPS.cmd**.

Cách thủ công tương đương, mở PowerShell:

```bash
ssh -L 3000:127.0.0.1:3000 root@IP_VPS
```

Giữ cửa sổ này mở, rồi vào trình duyệt: http://localhost:3000. Lần đầu mở sẽ hiện trang **Thiết lập lần đầu**: đặt tài khoản và mật khẩu quản trị ngay trên web, xong là đăng nhập luôn. Đổi mật khẩu sau này trong Cài đặt. Tắt cửa sổ PowerShell là dashboard không còn truy cập được từ ngoài.

Nếu thấy dòng `Chưa đặt ADMIN_PASSWORD trong file .env` là bản trên VPS còn cũ: chạy lại `upload.cmd` để tải bản mới rồi trên VPS chạy `cd /root && tar xzf site-autopilot.tar.gz && bash site-autopilot/deploy/install.sh`, sau đó tải lại trang.

Trong dashboard, vào **Cài đặt → Khóa API và dịch vụ** và dán các khóa:

1. **Cloudflare API Token và Account ID**. Cách lấy ghi ngay dưới ô nhập.
2. **Anthropic API key** tại platform.claude.com.
3. **Pexels API key** tại pexels.com/api.
4. Tùy chọn: nội dung file JSON service account Google, Telegram bot.

Khóa được mã hóa trước khi lưu và không hiển thị lại, chỉ thấy trạng thái "Đã lưu" cùng 4 ký tự cuối. Muốn đổi thì dán khóa mới đè lên. Lưu xong bấm các nút **Kiểm tra Cloudflare, aaPanel, SSH, Claude, Pexels**. Tất cả xanh là sẵn sàng tạo site đầu tiên.

Nếu muốn truy cập dashboard bằng địa chỉ cố định như `panel.tenmien.com`, làm theo `site-autopilot/deploy/nginx-panel.conf`: thêm site trong aaPanel, reverse proxy tới `http://127.0.0.1:3000`, bật SSL Let's Encrypt, và điền `BASE_URL=https://panel.tenmien.com` khi chạy lại `configure.sh`.

## Tạo site đầu tiên

1. Dashboard → **Tạo site** → điền domain đã mua ở Namecheap, thương hiệu, ngành, khu vực, dịch vụ, từ khóa, liên hệ.
2. Sau vài giây, trang site hiện hai nameserver Cloudflare. Vào Namecheap → Domain List → Manage → Nameservers → Custom DNS → dán hai dòng đó.
3. Chờ. Nhánh dựng website chạy ngay, nhánh Cloudflare tiếp tục khi zone active. Site chuyển sang **Live** khi mọi bước xong.

## Việc nên làm thêm về bảo mật

- Đổi mật khẩu root VPS bằng `passwd` nếu vẫn dùng mật khẩu do nhà cung cấp gửi qua email.
- Không chia sẻ file `/root/site-autopilot-credentials.txt` và `/opt/site-autopilot/.env`.
- Sao lưu định kỳ thư mục `/opt/site-autopilot/data` chứa cơ sở dữ liệu và bản dựng các site.

## Lệnh hay dùng

```bash
pm2 logs site-autopilot --lines 100
```

```bash
pm2 restart site-autopilot
```

```bash
cd /opt/site-autopilot && npm run cli -- test
```

```bash
bt default
```

Lệnh cuối in lại địa chỉ, tài khoản và mật khẩu aaPanel. Đổi mật khẩu panel bằng `bt 5`.
