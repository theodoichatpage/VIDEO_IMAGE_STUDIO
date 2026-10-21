# VIDEO IMAGE STUDIO Local Engine — Tách ảnh

## Mục tiêu
Tích hợp bộ tách ảnh SAM2/OpenCV đang chạy local vào VIDEO IMAGE STUDIO trên Vercel mà không dùng API/GPU trả phí và không làm thay đổi luồng Phân tích/Tạo ảnh hiện có.

## Thứ tự giao diện
1. Phân tích
2. Tạo ảnh
3. Tách ảnh
4. Dựng video
5. Dự án

Bỏ tab Tiến trình riêng. Dự án nằm cuối vì tần suất sử dụng thấp.

## Kiến trúc
Web Vercel không chạy SAM2. Một chương trình `VIDEO IMAGE STUDIO Local Engine` chạy nền trên Windows và cung cấp HTTP API tại loopback `127.0.0.1`. Trình duyệt gọi trực tiếp Local Engine; ảnh không cần đi qua Vercel để xử lý.

Local Engine tái sử dụng engine Python/SAM2/OpenCV từ bộ `Tach_Nguoi_Chu_Nen`. Giao diện HTML cũ không được nhúng vào web.

Local Engine được thiết kế theo module để sau này có thể thêm FFmpeg cho tab Dựng video mà không thay giao thức kết nối cơ bản.

## Local API v1
Base URL: `http://127.0.0.1:17841`

- `GET /v1/health`: trả trạng thái engine, version và khả năng `sam2`/`ffmpeg`.
- `POST /v1/separate`: multipart image + tùy chọn xử lý; tạo job và trả `jobId`.
- `GET /v1/jobs/{jobId}`: trạng thái `queued|processing|complete|error`, progress 0-100 và lỗi nếu có.
- `GET /v1/jobs/{jobId}/result`: metadata các layer khi hoàn tất.
- `GET /v1/jobs/{jobId}/files/{fileId}`: tải PNG/ZIP kết quả.

API chỉ bind `127.0.0.1`, không mở ra LAN/Internet. CORS chỉ cho origin production của VIDEO IMAGE STUDIO và localhost development. Dữ liệu đầu vào được kiểm tra loại file/kích thước; tên file do engine tạo, không dùng trực tiếp đường dẫn do browser gửi.

## Tab 3 — Tách ảnh
Khi mở tab, web gọi `/v1/health` và hiển thị:
- `Đã kết nối Local Engine` khi sẵn sàng.
- `Local Engine chưa chạy` cùng hướng dẫn/cài đặt khi không kết nối được.

Nguồn ảnh:
- Ảnh đã có từ tab Tạo ảnh.
- Ảnh người dùng tải trực tiếp từ máy.

Luồng: chọn ảnh -> Tách ảnh -> upload trực tiếp tới localhost -> hiển thị % -> nhận danh sách layer -> xem/tải Nền, Người, Chữ và ZIP toàn bộ.

Kết quả được gắn với session/project hiện tại ở lớp web. Bản file local vẫn nằm trong thư mục dữ liệu Local Engine; metadata có thể được lưu cùng dự án. Không tự động tải file ảnh lớn lên Vercel trong phiên bản đầu.

## Local Engine Windows
Engine có entrypoint riêng và script cài/khởi động. Mục tiêu sử dụng là cài một lần, sau đó chạy nền cùng Windows hoặc qua shortcut. SAM2 model được lưu local và tái sử dụng giữa các lần chạy.

Phiên bản đầu ưu tiên CPU để không yêu cầu GPU. Nếu PyTorch phát hiện CUDA tương thích thì có thể dùng GPU local, nhưng không phải điều kiện bắt buộc.

## Tương thích code hiện tại
Không sửa logic bridge ChatGPT ngoài việc đổi thứ tự menu. Không thay endpoint phân tích/tạo ảnh hiện có. Tách ảnh được cô lập thành component/client riêng và Local Engine riêng.

## Xử lý lỗi
- Engine offline: không mất ảnh/dữ liệu hiện có; nút Tách ảnh bị vô hiệu hóa và có nút kiểm tra lại.
- Job lỗi: giữ ảnh nguồn, hiển thị thông báo từ engine và cho phép chạy lại.
- Reload web khi job đang chạy: nếu còn `jobId`, web có thể tiếp tục poll job local.
- Local file đã bị xóa: metadata dự án được giữ nhưng đánh dấu tài nguyên không còn trên máy.

## Kiểm thử chấp nhận
1. Phân tích và Tạo ảnh tiếp tục hoạt động như trước.
2. Tab order là Phân tích, Tạo ảnh, Tách ảnh, Dựng video, Dự án.
3. Web nhận biết đúng Local Engine online/offline.
4. Một ảnh local có thể gửi sang SAM2, thấy progress và nhận layer PNG/ZIP.
5. Tắt Local Engine không làm web crash.
6. API Local Engine không listen trên địa chỉ LAN.
7. Không có dịch vụ AI/GPU cloud trả phí trong luồng tách ảnh.

## Ngoài phạm vi giai đoạn này
- Đồng bộ file layer lớn lên cloud.
- Chia sẻ Local Engine qua mạng LAN/Internet.
- AI video cloud.
- Triển khai FFmpeg; kiến trúc chỉ chừa khả năng bổ sung sau.
