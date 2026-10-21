# LiteNVR cho ZimaOS (Tích hợp Home Assistant Motion)

Ứng dụng NVR độc lập siêu nhẹ (CPU < 1%), ghi hình trực tiếp RTSP (`-c:v copy`) và nhận tín hiệu Motion từ Home Assistant.

## Đăng nhập web
Web UI có **trang đăng nhập riêng** (`/login`), phiên làm việc bằng cookie an toàn, có thể **tạo tài khoản con** với quyền giới hạn và **xác thực 2 lớp (2FA)**.
- `NVR_USER` (mặc định `admin`) — **tài khoản gốc**, toàn quyền, không xoá được.
- `NVR_PASS` (mặc định `admin`) — **nên đổi ngay** (mật khẩu mạnh 12+ ký tự).
- `NVR_AUTH=off` để tắt đăng nhập (chỉ dùng trong LAN tin cậy).
- `NVR_IFRAME=on` nếu muốn nhúng giao diện vào iframe (mặc định chặn iframe để chống clickjacking).

Mọi client cũ dùng **HTTP Basic Auth** (script, Home Assistant, ffmpeg/VLC, Node-RED) vẫn hoạt động như trước — chỉ giao diện web chuyển sang phiên đăng nhập.

Trang `/` và `/login` trả `Cache-Control: no-store` để trình duyệt không dùng bản cũ. Nếu đăng nhập đúng mật khẩu mà vẫn quay lại trang login: xoá cookie/phiên cũ cho trang này (hoặc Ctrl+F5); LiteNVR cũng tự xoá cookie phiên hỏng khi mở lại `/login` và **báo rõ** nếu trình duyệt chặn cookie (do iframe khác site) thay vì im lặng.

## Bảo mật & tài khoản con
Bấm **🔐 Bảo mật** trên thanh công cụ:
- **Tài khoản của tôi**: đổi mật khẩu, bật **2FA** (quét/nhập mã vào Google Authenticator, Authy… — sau khi bật, mỗi lần đăng nhập cần thêm mã 6 số).
- **Tài khoản con** (chỉ quản trị viên): tạo tài khoản cho người xem. Chọn vai trò:
  - **Quản trị viên**: toàn quyền như tài khoản gốc.
  - **Người dùng**: tick chọn từng quyền — Xem trực tiếp, Xem lại bản ghi, Xem sự kiện, Xuất clip, Điều khiển PTZ, Khoá bản ghi — và **chọn từng camera được phép xem** (bỏ trống = tất cả). Người dùng chỉ thấy các nút được cấp quyền; mật khẩu camera bị che.
- **Nhật ký đăng nhập**: mọi lần đăng nhập thành công/thất bại, tạo/sửa/xoá tài khoản, bật/tắt 2FA đều được ghi lại (kèm IP, thời gian) và **lưu trên ổ cứng**.
- **Trạng thái bảo mật**: cảnh báo nếu mật khẩu gốc còn mặc định, xác thực đang tắt, hoặc không còn quản trị viên.

Cơ chế chống tấn công tự động:
- **Chống dò mật khẩu**: 8 lần sai trong 15 phút → tạm khoá theo IP 5 phút (HTTP 429).
- **Chống CSRF**: mọi thao tác thay đổi dữ liệu qua phiên cookie đều phải kèm mã chống giả mạo; API dùng Basic Auth được miễn (tương thích script cũ).
- **Phiên tự hết hạn** sau 7 ngày, đổi/xoá mật khẩu hoặc khoá tài khoản sẽ đăng xuất mọi phiên của tài khoản đó ngay.
- **Header bảo mật**: CSP, chống MIME-sniffing, chặn iframe (có thể mở bằng `NVR_IFRAME=on`).

## Liên kết Home Assistant (lấy Motion bằng Token)
Trên Web UI, bấm **🛰️ Home Assistant**:
1. Nhập **Địa chỉ HA** (VD `http://homeassistant.local:8123`).
2. Dán **Long-Lived Access Token** (HA → Hồ sơ người dùng → Security → Create Token). Token được lưu trong `config.json` và chỉ dùng ở phía server.
3. Bấm **Kiểm tra kết nối** rồi **Lưu**.
4. Gán cảm biến cho **từng camera** trong **+ Quản lý Camera** → **Sửa** → mở **⚙️ Tùy chọn nâng cao** → mục **🛰️ Cảm biến chuyển động Home Assistant**: bấm **↻ Tải danh sách sensor từ HA** để nạp cảm biến kèm trạng thái hiện tại, chọn cảm biến và **điều kiện kích hoạt** (VD `binary_sensor` → kích hoạt khi `on`; `device_tracker` → khi `home`; hoặc "mọi thay đổi trạng thái"). Danh sách lưu trong `hass_entities` của camera dưới dạng `{entity_id, state, label}`.

LiteNVR tự mở WebSocket tới HA (`/api/websocket`), xác thực bằng token, đăng ký `state_changed`; chỉ khi cảm biến **chuyển sang** giá trị kích hoạt mới ghi hình + snapshot cho camera tương ứng (cảm biến giữ nguyên trạng thái sẽ không kích hoạt lặp). Sự kiện ghi nhãn tuỳ chọn, mặc định `Chuyển động (HA: <entity_id>)`. Tự kết nối lại khi mất mạng.

## Nhãn AI (người/xe) từ bộ nhận diện ngoài
Gửi sự kiện từ bộ nhận diện AI bất kỳ (Frigate, DeepStack, CodeProject.AI, Node-RED…) vào endpoint:
```
POST /api/ai/detect
{"cam_id":"cam_cong","objects":["person","car"],"snapshot_url":"http://detector/snap.jpg"}
```
- `objects`: tên đối tượng tiếng Anh (`person`, `car`, `truck`, `motorcycle`, `bicycle`, `dog`, `cat`, `package`…), LiteNVR **tự dịch sang tiếng Việt** (`Người`, `Xe`, `Xe tải`…) và gộp thành nhãn `AI: Người, Xe`.
- `snapshot_url` (tuỳ chọn): LiteNVR tải ảnh này làm ảnh sự kiện (bỏ qua chụp từ luồng); chỉ nhận `http/https`, tối đa 8 MB. Không có thì tự chụp như sự kiện chuyển động thường.
- `label` (tuỳ chọn): ghi đè nhãn.
Sự kiện AI đi đúng luồng cũ: kích hoạt ghi hình, lưu vào danh sách sự kiện (tìm kiếm được theo nhãn/camera/ngày) và gửi thông báo (Telegram/webhook) nếu đã bật. Endpoint dùng chung quyền `live` nên client HTTP Basic (script/HA/Frigate) gọi được.

## Xem Live / Bản ghi bị đen hoặc không phát
Nguyên nhân phổ biến: camera dùng **H.265/HEVC** — trình duyệt (Chrome/Edge/Firefox) không giải mã được.
- Mặc định LiteNVR dùng **Tự động phát hiện**: tự dò codec camera bằng `ffprobe`; nếu là H.265/HEVC sẽ tự chuyển sang H.264 cho cả Live (HLS) và khi phát bản ghi.
- Muốn chỉnh tay: **+ Quản lý Camera** → sửa camera → mở **⚙️ Tùy chọn nâng cao** → **Codec video**:
  - **Tự động phát hiện** (khuyến nghị).
  - **Copy**: nhẹ CPU nhất, chỉ dùng khi camera chắc chắn là H.264.
  - **Luôn chuyển sang H.264**: tương thích mọi trình duyệt, tốn CPU hơn.
- Phát bản ghi cũ quay bằng H.265: LiteNVR tự chuyển mã khi trình duyệt báo lỗi (không cần quay lại).
- Nút **🔍 Chẩn đoán** hiển thị trạng thái ffmpeg, codec dò được và log lỗi gần nhất.
- **Âm thanh Live**: bấm nút **🔇 Tiếng / 🔊 Tiếng** cạnh **Trực tiếp** để bật/tắt. LiteNVR tự chuyển âm thanh G.711/AAC của camera (EZVIZ, Hikvision…) sang AAC để trình duyệt phát được; nếu camera kén tiếng hoặc không có audio, chọn **Tắt âm thanh** trong phần nâng cao của camera.

**Lưu ý luồng HEVC/H.265 4K (Imou/Dahua/Hanet/EZVIZ):** live view phải chuyển mã realtime nên tốn CPU. Nếu box yếu, dùng **luồng phụ H.264** làm `sub_rtsp_url` cho live (Imou `subtype=1`; Hanet `/user:hanet;pwd:...` kèm stream phụ) và để luồng chính HEVC cho ghi hình.

**Camera Hikvision/EZVIZ (đường dẫn `.../h264/ch01/main/av_stream`) bị đen / báo lỗi:** các camera này giới hạn số phiên RTSP đồng thời (~3) và **tự khoá tạm khi có quá nhiều kết nối nhanh**, trả lỗi `500/503 SETUP failed` cho tới khi hết khoá. Cách xử lý:
- Chỉ để **một** ứng dụng kéo luồng trực tiếp; nếu đang dùng Frigate/go2rtc, trỏ LiteNVR vào **restream của go2rtc** (`rtsp://<ip-go2rtc>:8554/<ten_cam>`) thay vì kéo trực tiếp camera.
- LiteNVR đã tự tăng thời gian chờ (backoff 15–120s) khi camera trả 5XX để nhả khoá; xem nút **🔍 Chẩn đoán** (dòng "Camera đang TỪ CHỐI kết nối").
- Nếu camera vẫn 500 dù đã chờ, khởi động lại (rút điện) camera.

**Thanh thời gian:** kéo hoặc bấm trên thanh để tua; rê chuột để xem mốc giờ; vạch vàng hiển thị vị trí đang phát.

**Hình bị "vỡ"/rác khi xem qua go2rtc/restream:** thường do luồng H.264 ở profile/màu mà trình duyệt không giải mã (High 4:2:2, 4:4:4, 10-bit). LiteNVR tự dò `profile` + `pix_fmt`; nếu không phải H.264 8-bit 4:2:0 (`yuv420p`/`yuvj420p`) sẽ tự chuyển mã sang H.264 chuẩn. Có thể ép thủ công bằng **Codec video = Luôn chuyển sang H.264**. Ngoài ra LiteNVR ưu tiên TCP (`prefer_tcp`) để tránh mất gói.

## Thêm camera & nhiều giao thức
- **Hai phương thức trong Quản lý Camera**:
  - **Tự động dò ONVIF**: bấm **🔎 Dò camera ONVIF** → chọn thiết bị → nhập tài khoản ONVIF → LiteNVR tự lấy **URL RTSP main + sub**. Hoạt động với hầu hết camera (Dahua/Imou, Hikvision/EZVIZ, Hanet, Tapo… bật ONVIF). Nếu multicast bị chặn, nhập dải IP rồi **Quét dải IP**, hoặc nhập thẳng IP vào ô ONVIF và bấm **Lấy luồng RTSP**.
  - **Nhập URL thủ công**: chọn hãng để tạo nhanh URL hoặc dán URL có sẵn; kiểm tra luồng rồi lưu. Mẫu preset:
    - Imou/Dahua: `rtsp://user:pass@ip:554/cam/realmonitor?channel=1&subtype=0`
    - EZVIZ/Hikvision: `rtsp://user:pass@ip:554/h264/ch01/main/av_stream`
    - Hanet: `rtsp://ip:554/user:<user>;pwd:<pass>`
- **Thêm hàng loạt**: trong tab **Nhập URL thủ công**, bấm **➕ Thêm hàng loạt**, mỗi dòng một camera: `mã | tên | rtsp_url | sub_url (tùy chọn)`.
- **Giao thức đầu vào**: RTSP (mặc định), HTTP MJPEG/snapshot, RTMP, HLS(m3u8) — chỉ cần dán URL, tham số `rtsp_transport` chỉ áp dụng cho RTSP.
- **Nhóm/Phòng và Nhãn**: điền khi thêm/sửa camera để phân loại; hiển thị trong danh sách và ô chọn nhanh.

## Tiết kiệm CPU / RAM
- **Restream nội bộ (go2rtc)**: bản Docker đã kèm `go2rtc`; LiteNVR tự tạo cấu hình và đẩy mọi nguồn qua restream `rtsp://127.0.0.1:8554`, nhờ đó **mỗi camera chỉ tốn 1 phiên RTSP** dù có ghi hình + xem live + chụp snapshot (tránh lỗi "đủ số phiên" của Hikvision/EZVIZ). Các stream bạn tự thêm trong `go2rtc.yaml` được **giữ nguyên** khi LiteNVR cập nhật cấu hình. Tắt bằng biến môi trường `GO2RTC=off`.
- **Live nhẹ CPU (LIVE_MAX_HEIGHT)**: với camera 2K/4K phải chuyển mã (H.265/HEVC), live được hạ về tối đa 720p — giảm tải mã hoá, băng thông (dễ xem qua Wi-Fi/4G) và tải máy khách; **bản ghi vẫn giữ nguyên độ phân giải gốc**. Đổi bằng biến môi trường `LIVE_MAX_HEIGHT` (`0` = giữ nguyên, `1080` = nét hơn nhưng nặng hơn). Lưu ý: camera HEVC vẫn tốn CPU để *giải mã* — cách tiết kiệm nhất là dùng luồng H.264 (xem bên dưới).
- **Dùng luồng phụ cho Live**: điền "Luồng phụ" trong phần sửa camera (vd Imou/Dahua `subtype=1`, Hikvision `/Streaming/Channels/102`) — live thường là H.264 nên **không cần chuyển mã** (CPU gần như 0).
- **Live theo nhu cầu**: khi không có ai xem, LiteNVR tự bỏ nhánh HLS (nhất là với camera phải chuyển mã HEVC/H.265 → H.264). Khi mở lại live, luồng tự khởi động trong vài giây. Có thể chỉnh thời gian chờ: biến môi trường `LIVE_IDLE_STOP_SEC` (mặc định 30 giây).
- **Ghi hình lưu nguyên codec (`-c:v copy`)**: CPU gần như bằng 0; chỉ chuyển mã khi bạn thực sự xem.
- **Giới hạn luồng giải mã/lọc ffmpeg**: mọi ffmpeg (ghi hình, live, phát lại, xuất clip, chụp snapshot) đều bị giới hạn `-threads` cho **giải mã + bộ lọc**, không chỉ bộ mã hoá. Đổi bằng biến môi trường `FFMPEG_THREADS` (mặc định 2, kẹp 1–8). Hạ số luồng giúp giảm đỉnh RAM/CPU khi camera 2K/4K hoặc HEVC.
- **Chụp snapshot có kiểm soát**: tối đa **2 ffmpeg chụp ảnh** chạy song song toàn hệ thống và **1 mỗi camera** (gộp yêu cầu trùng), tự dừng sau 12 giây nếu treo. Tránh dồn nhiều ffmpeg mở luồng cùng lúc khi có sự kiện chuyển động liên tục.
- **Preset transcode nhẹ**: `ultrafast` + 2 luồng, `zerolatency`.
- **Đệm Motion trong RAM**: tắt tuỳ chọn "Đệm chuyển động trong RAM" trong **⚙️ Lưu trữ** để ghi đệm ra đĩa nếu box ít RAM.
- **HLS độ trễ thấp**: live dùng segment **1 giây**, playlist **4 segment** và trình duyệt bắt đầu gần live edge; ffmpeg ép keyframe đúng nhịp segment khi phải chuyển mã. Đổi bằng `LIVE_HLS_TIME` (mặc định `1`, kẹp 1–10) và `LIVE_HLS_LIST` (mặc định `4`, kẹp 3–20). Mạng Wi-Fi yếu hoặc camera có GOP dài có thể tăng lên `LIVE_HLS_TIME=2`, `LIVE_HLS_LIST=5`; HLS vẫn có độ trễ nền khoảng 1–4 giây tuỳ camera. Nếu đặt sau reverse proxy, tắt proxy buffering cho `/hls/`.
- **Thấy LiteNVR "ăn" ~2GB RAM?** Phần lớn thường là **bộ đệm file (page cache)** của Linux khi ghi/đọc video liên tục — nó hiện trong số RAM của container nhưng **tự nhả khi máy cần**, không phải rò rỉ. Mở **Dashboard** (hoặc `GET /api/system` → mục `memory`) để xem chi tiết: `app_rss_mb` (app), `children_mb` (ffmpeg/go2rtc), `cgroup_file_mb` (cache — bình thường), `cgroup_shmem_mb` (đệm RAM/HLS). Mỗi tiến trình con trong `children` có thêm `role` (camera/snapshot/playback), `cam_id`, `threads`, `age_sec` và `peak_rss_mb` để biết ffmpeg nào đang tốn RAM. Muốn hạ: dùng luồng phụ H.264 cho live, `GO2RTC=off/on` phù hợp, và tắt "Đệm chuyển động trong RAM" nếu cần.
- Với box yếu hoặc camera giới hạn phiên: dùng **luồng phụ** cho live và/hoặc **restream go2rtc**.

## Nhật ký & Lỗi
- Nút **📋 Nhật ký** hiển thị: trạng thái từng camera (chạy / lỗi / bị từ chối 5XX / chưa dò được codec) và **danh sách sự kiện** (INFO/WARN/ERR) kèm gợi ý tiếng Việt cho các lỗi RTSP thường gặp.
- Badge đỏ trên nút đếm số lỗi; có thể lọc "chỉ hiện lỗi/cảnh báo" và **📄 Sao chép** toàn bộ để gửi hỗ trợ.
- Lỗi từ trình duyệt (HLS/playback) cũng được đẩy về nhật ký này; cảnh báo ổ đĩa đầy xuất hiện tại đây.
- Trạng thái **restream nội bộ (go2rtc)** hiển thị ngay đầu hộp Nhật ký kèm **CPU load và RAM** của máy; file ghi rỗng/hỏng được tự phát hiện và xoá (file 0 byte) kèm cảnh báo.
- Nhật ký lưu trong RAM, tự xoá khi khởi động lại container.

## Dashboard giám sát
- Thẻ **CPU / RAM / Bộ nhớ** cập nhật mỗi 5 giây kèm biểu đồ mini (sparkline) theo thời gian thực.
- **CPU** hiển thị % toàn hệ thống và %CPU riêng của từng tiến trình ffmpeg (dưới mỗi camera).
- **RAM / Bộ nhớ** có thanh màu đổi theo mức (xanh → cam ≥75% → đỏ ≥90%).
- **Sức khoẻ luồng**: ffmpeg báo tiến độ (`-progress`), LiteNVR hiển thị **fps** từng camera; nếu không có khung mới trong 20 giây thì đánh dấu **⏸ đứng** và tự khởi động lại luồng. Xem qua `GET /api/stats`/`/api/system` (mục `cam_health`: `fps`, `stalled`, `state`, `age_sec`).
- **Sức khoẻ ổ đĩa**: `GET /api/disk_health` (và trong `/api/system`) trả về dung lượng, **inode**, quyền ghi và **SMART** (nhiệt độ/health nếu có `smartctl` — thường không có trong container, khi đó ghi rõ "không khả dụng"). Trong 🔔 **Thông báo** có thể bật **cảnh báo ổ đĩa sắp đầy**: vượt ngưỡng cảnh báo/nguy hiểm sẽ gửi Telegram/webhook (báo lại tối đa mỗi 6 giờ khi vẫn vượt).
- Lưới **camera trực quan**: ô camera hiện ảnh chuyển động mới nhất, chế độ (24/7 / Motion / Live / Lịch), bấm để chuyển nhanh.
- Trên bản ghi liên tục, các **khoảng có chuyển động được tô màu cam** trên thanh thời gian để dễ dò lại đúng đoạn.
- **Ảnh sự kiện**: mỗi sự kiện chuyển động hiện kèm **ảnh snapshot** (thumbnail trong danh sách). Nếu hai ffmpeg chụp ảnh đang bận, sự kiện vẫn dùng **ảnh mới nhất** của camera làm dự phòng nên không bị thiếu ảnh.
- **Bấm ảnh sự kiện để xem đúng đoạn**: bấm vào ảnh một sự kiện (trên timeline hoặc trong kết quả tìm kiếm) để tự chuyển đúng camera, đúng ngày và **phát tại thời điểm sự kiện** (chờ danh sách đoạn tải xong trước khi phát, không phát sai đoạn).
- **Tìm kiếm sự kiện**: thanh lọc phía trên danh sách sự kiện cho phép tìm theo **nhãn/camera**, chọn **camera**, và giới hạn **khoảng ngày**. Kết quả gộp toàn hệ thống (không chỉ camera/ngày đang xem); bấm một kết quả để nhảy đúng camera, ngày và phát tại thời điểm sự kiện. Danh sách sự kiện tự cập nhật khi đang xem trực tiếp. API: `GET /api/events?cam_id=&q=&date_from=&date_to=&limit=` (trả kèm `time` `HH:MM:SS` và `sec_of_day`).
- **Ảnh thu nhỏ khi tua**: khi kéo/đưa chuột lên thanh thời gian, một ảnh thu nhỏ của đoạn bản ghi gần con trỏ hiện ra (tạo bằng ffmpeg và cache trong `/dev/shm`). API: `GET /api/thumb/{cam}/{fname}` (trả JPEG, tự tạo lại khi file gốc mới hơn).
- **Phát lại nâng cao**: đổi **tốc độ phát** (0.5×/1×/2×/4×), **tua từng khung** (⏪/⏩, mốc ~25 fps) và **lưu ảnh** khung hình đang phát (📷, tải JPEG về máy). Khi quay lại Live, tốc độ tự đặt lại 1×.

## Tính năng NVR nâng cao
- **⊞ Lưới nhiều camera**: bấm **⊞ Lưới** để xem 4 camera cùng lúc (bấm tiếp để chuyển 9 ô, bấm lần nữa để tắt). Bấm vào một ô để quay về chế độ 1 camera. Live trong lưới tự khởi động và tự dừng khi bạn thoát lưới (tiết kiệm CPU).
- **⏳ Thời gian lưu riêng cho từng camera**: trong phần sửa camera, đặt **Số ngày lưu riêng** (0 = dùng mức chung toàn hệ thống). Camera để lâu hơn (VD cổng chính 30 ngày) hoặc ngắn hơn (VD 1 ngày) đều được; bộ dọn ổ cứng áp dụng đúng mức cho từng thư mục camera.
- **🔒 Khoá bản ghi**: di con trỏ tới đoạn cần giữ rồi bấm **🔒 Khoá đoạn** — file này **không bao giờ bị xoá tự động** (theo ngày lưu, giới hạn GB hay % ổ cứng). Bấm **🔓 Mở khoá** để cho phép xoá lại.
- **⬇️ Xuất clip**: chọn *Từ giờ → Đến giờ* dưới thanh thời gian rồi bấm **Tải đoạn** để tải một file MP4 gồm toàn bộ các đoạn ghi trong khoảng đó. Nút **⬇️** trên mỗi sự kiện tải nhanh clip quanh sự kiện (mặc định 10s trước + 60s sau). Bật **chuyển H.264** nếu muốn gửi clip cho thiết bị/tài khoản không phát được H.265.
- **📅 Lịch ghi hình**: trong phần sửa camera, bật **Lịch ghi hình** và thêm các khung giờ (Thứ, Từ, Đến, chế độ 24/7 hay Motion). Ngoài mọi khung giờ, camera **không ghi** (vẫn xem live được). Hỗ trợ khung giờ qua đêm (VD 22:00 → 06:00). Ví dụ: ngày thường chỉ Motion 8h–17h, ban đêm 24/7.
- **🎮 PTZ (ONVIF)**: bấm **🎮 PTZ** để hiện bàn điều hướng xoay/zoom (dùng tài khoản trong URL RTSP; camera cần hỗ trợ ONVIF). Chọn preset có sẵn trong danh sách và bấm **📍 Đến preset**. Nếu camera dùng cổng ONVIF khác 80, thêm `onvif_port` trong `config.json`.
- **🔔 Thông báo Telegram/Webhook**: bấm **🔔 Thông báo**, dán **Bot Token** (tạo bot qua @BotFather), **Chat ID** và bật thông báo — mỗi khi có chuyển động, LiteNVR gửi tin kèm **ảnh snapshot** (tuỳ chọn). Ô **Webhook URL** cho phép đẩy JSON sang Node-RED/HA/n8n. Nút **📨 Gửi thử** để kiểm tra; tin nhắn giới hạn 1 tin/3 giây mỗi camera để tránh dội. Điền **Địa chỉ LiteNVR** (VD `http://192.168.5.63:9895`) để tin nhắn/webhook kèm **link ▶️ Xem lại** mở đúng camera + thời điểm sự kiện (giao diện tự đọc `?cam=&date=&t=`).
- **💾 Sao lưu / Khôi phục cấu hình**: trong **⚙️ Lưu trữ**, bấm **Xuất cấu hình** để tải file JSON (camera, lịch, HA, thông báo) và **Nhập cấu hình** để khôi phục sau khi chạy container mới / khôi phục nguyên trạng.
- **📱 Tối ưu điện thoại / máy tính bảng**: giao diện tự gọn thanh công cụ thành nút **☰** trên màn hình nhỏ, modal mở toàn màn hình, nút/ô nhập đủ lớn cho cảm ứng (ô nhập ≥16px, chống iOS tự phóng to), timeline cao hơn để kéo tua dễ hơn.


## Lưu bản ghi ra ổ ngoài (SMB/Samba/FTP)
Bấm **💾 Lưu trữ ngoài (SMB/FTP)** (admin) để tự động chuyển các đoạn ghi hoàn chỉnh ra máy chủ riêng:
- **SMB/Samba/CIFS**: nhập máy chủ, share, tài khoản/mật khẩu (và domain nếu có). Không cần mount share vào container. Ví dụ: host `192.168.1.20`, share `Camera`, thư mục con `LiteNVR`.
- **Thư mục đã mount**: nếu đã mount CIFS/NFS vào container, chọn kiểu này và nhập đường dẫn (VD `/mnt/backup`).
- **FTP/FTPS**: nhập máy chủ, cổng, tài khoản/mật khẩu, thư mục đích; bật **FTPS** nếu server yêu cầu TLS.
- **Thư mục tự chia theo ngày**: `<đích>/YYYY-MM-DD/<mã camera>/<tên file>`.
- **Sau khi chuyển**: `copy` giữ bản gốc trên NVR; `move` **xoá bản ghi khỏi ổ NVR** sau khi chuyển thành công, chỉ còn dữ liệu trên máy chủ ngoài. Nếu camera đang chờ tải lên Google Drive, LiteNVR tạm hoãn chuyển để không mất file.
- **Camera**: bỏ trống = tất cả. Bản ghi **đang ghi** (mới hơn 30 giây), bản ghi **đã chuyển** và bản ghi **đang khoá** sẽ bị bỏ qua; file thành công được ghi nhận để không chuyển lại.
- Nút **🔌 Kiểm tra đích** thử ghi file hoặc kết nối SMB/FTP. API: `GET/POST /api/backup`, `POST /api/backup/test`.

## Sao lưu 24/7 lên Google Drive (tự dọn khi đầy)
Bấm **☁️ Google Drive** (chỉ tài khoản admin) để bật tính năng: mọi đoạn ghi hoàn chỉnh sẽ **tự động tải lên Drive 24/7** vào thư mục `LiteNVR/YYYY-MM-DD/<tên camera>` (tự tạo, chia theo ngày cho dễ tìm). Khi Drive đầy, LiteNVR **tự xoá các file cũ nhất do chính nó tải lên** (xoá vĩnh viễn, không vào thùng rác, để giải phóng dung lượng ngay) rồi tiếp tục tải. File đang được ghi sẽ không bị đụng tới; file lỗi được **thử lại tự động** (5 lần, chờ tăng dần).

**Cách kết nối Google (làm 1 lần):**
1. Vào [console.cloud.google.com](https://console.cloud.google.com) → tạo Project → **APIs & Services → Library** → bật **Google Drive API**.
2. **OAuth consent screen**: chọn External → điền tên app, thêm email của bạn vào **Test users** → sau đó bấm **Publish app** (⚠️ nếu để chế độ *Testing*, Google sẽ hết hạn refresh token sau 7 ngày và LiteNVR sẽ báo lỗi xác thực định kỳ).
3. **Credentials → Create credentials → OAuth client ID** → loại **TVs and Limited Input devices** → copy **Client ID** và **Client secret**.
4. Trong LiteNVR: **☁️ Google Drive** → dán Client ID/secret → bấm **Kết nối Google** → mở [google.com/device](https://www.google.com/device) trên điện thoại/máy tính, nhập mã hiện trên LiteNVR → **Đồng ý**. Xong!
   - Google chỉ cho phép luồng "mã thiết bị" dùng scope **`drive.file`** — LiteNVR chỉ nhìn thấy/quản lý các file và thư mục **do chính nó tạo** (đủ cho sao lưu vì app tự tạo thư mục `LiteNVR`). Đây là giới hạn của Google, không phải lỗi.
5. Đã có refresh token sẵn (rclone, script cũ…)? Mở mục **Dán token có sẵn** trong hộp thoại và dán Client ID/secret/refresh token thay vì làm bước 4. Token tạo bằng scope `.../auth/drive` (đầy đủ) cũng dùng được — khi đó có thể trỏ `root_folder_id` vào thư mục có sẵn bất kỳ.

**Cài đặt trong hộp thoại Drive:**
- **Camera sao lưu**: bỏ trống = tất cả camera.
- **Nơi lưu (trong Sửa camera)**: mỗi camera chọn *Cả hai* (mặc định — giữ trên ổ cứng + sao lưu Drive nếu đã bật), *Chỉ ổ cứng*, hoặc *Chỉ Google Drive* — bản ghi tải lên Drive xong sẽ **tự xoá khỏi ổ cứng** để tiết kiệm dung lượng. Nếu Drive chưa bật/mất kết nối, camera *Chỉ Drive* vẫn ghi tạm ra ổ cứng và tải lên ngay khi Drive hoạt động lại (không mất dữ liệu). Camera *Chỉ ổ cứng* bị khoá trong danh sách *Camera sao lưu* của hộp thoại Drive.
- **Xem lại bản ghi trên Drive**: bản ghi đã sao lưu (kể cả đã xoá khỏi ổ cứng) vẫn hiện trong tab **Xem lại** với vạch màu xanh ☁️ trên thanh thời gian. Khi bấm phát/tua, LiteNVR **tự tải đoạn đó từ Drive về** (hiện % đang tải ở dòng trạng thái), sau đó phát và tua như bản ghi thường; đoạn đã tải được giữ trên ổ cứng làm cache (tự dọn theo dung lượng/ngày lưu). Nút **⬇️ Xuất clip** quanh sự kiện cũng tự tải các đoạn trên Drive nếu thiếu.
- **Giới hạn tốc độ**: chừa băng thông internet (Mbps), để 0 = không giới hạn.
- **Giới hạn dung lượng LiteNVR trên Drive (GB)**: 0 = không giới hạn; vượt mức → tự xoá cũ nhất.
- **Chừa trống tối thiểu trên Drive (MB)**: Drive còn ít hơn mức này → tự xoá cũ nhất (tối thiểu 200MB).
- **Tải bù theo ngày**: đẩy các bản ghi cũ (trước khi bật) lên Drive theo khoảng ngày — có thể rất nhiều, nên chạy vào lúc rảnh.
- Nút **🔎 Kiểm tra kết nối**, **Dọn ngay**, **↻ Thử lại file lỗi** và danh sách các file gần đây kèm trạng thái.

⚠️ Chỉ các đoạn ghi **sau khi bật** mới tự lên Drive; bản ghi cũ dùng nút *Tải bù theo ngày*. Xoá tự động là **vĩnh viễn** (không khôi phục được từ thùng rác).

## Tích hợp Home Assistant (Motion Webhook - không cần token)
HA chủ động gọi webhook khi phát hiện chuyển động:
```yaml
rest_command:
  litenvr_motion:
    url: "http://<ip-zimaos>:8080/api/motion"
    method: POST
    username: "admin"
    password: "admin"
    content_type: "application/json"
    payload: '{"cam_id":"cam_cong","label":"Chuyển động (HASS)"}'
```

## Cách đưa lên GitHub để tự động đóng gói Docker Image (`ghcr.io`)
1. Tạo 1 Repository mới ở chế độ **Public** trên GitHub của bạn với tên `litenvr`.
2. Giải nén file ZIP này và tải toàn bộ các file (bao gồm thư mục `.github/workflows`) lên Repository đó.
3. Ngay khi tải lên, tab **Actions** trên GitHub sẽ tự động chạy và đóng gói ứng dụng thành Docker Image tại địa chỉ:
   `ghcr.io/<ten-github-cua-ban>/litenvr:latest`
4. Vào mục **Packages** trên GitHub -> chọn package `litenvr` -> vào **Package settings** -> đổi quyền hiển thị sang **Public**.

## Cách bấm cài 1 chạm trên ZimaOS
1. Mở giao diện ZimaOS -> nhấn dấu **(+)** góc trên bên phải -> chọn **Install a customized app** -> bấm **Import** ở góc trên.
2. Dán nội dung file `docker-compose.yml` (đã điền sẵn `ghcr.io/trankhanhduy2929-beep/litenvr_docker_zimaos:latest`) và chỉnh đường dẫn `/storage` trỏ vào ổ cứng HDD của bạn.
3. Bấm **Submit** để cài đặt. Mở ứng dụng và thêm Camera trực tiếp trên giao diện Web!

### Mẫu riêng cho ZimaOS (kèm giới hạn CPU/RAM)
Nếu chạy ZimaOS và muốn cấu hình "chuẩn" như bản đang chạy (cổng **9895**, ổ `/DATA/NVR`, giới hạn **1 CPU / 4GB RAM**, tmpfs cho HLS + buffer), dùng file **`docker-compose.zimaos.yml`**:
- `GO2RTC=off`: chọn khi bạn **đã có go2rtc trong Frigate** và trỏ luồng qua đó (bớt 1 tầng relay, nhẹ hơn). Không có go2rtc ngoài thì đổi thành `GO2RTC=auto`.
- `LIVE_MAX_HEIGHT=720`: live H.265/HEVC được hạ về 720p cho nhẹ CPU (bản ghi vẫn giữ nguyên gốc). Đặt `0` để giữ nguyên.
- Giới hạn `cpus: "1.00"` phù hợp box yếu; muốn live mượt hơn với nhiều camera HEVC thì nâng lên `"2.00"`.

Cả 2 file đều import được theo cách ở trên; nhớ sửa `source` của volume cho đúng ổ cứng của bạn.
