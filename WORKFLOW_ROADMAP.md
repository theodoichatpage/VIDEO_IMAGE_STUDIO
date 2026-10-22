# VIDEO IMAGE STUDIO — workflow roadmap

## Mục tiêu
Biến kịch bản thành bộ ảnh theo luồng an toàn:

1. Nhập toàn bộ kịch bản.
2. ChatGPT phân tích nội dung và tự chia số phần theo mạch kể.
3. Mỗi phần được lưu độc lập, có mã tác vụ và trạng thái: chờ, đang xử lý, hoàn tất, lỗi, đã dừng.
4. Khi toàn bộ phần nội dung hoàn tất, ChatGPT lập phương án hình ảnh cho từng cảnh: chủ thể, hành động, bối cảnh, cỡ cảnh, góc máy và bố cục.
5. Người dùng duyệt hoặc sửa từng phương án.
6. Studio ghép phương án với prompt phong cách chung.
7. Studio gửi đúng một lệnh tạo ảnh tại một thời điểm tới ChatGPT, nhận ảnh, lưu ảnh rồi mới gửi cảnh kế tiếp.

## Quy tắc an toàn
- Không gửi tác vụ mới khi một tác vụ chưa rõ đã được ChatGPT nhận hay chưa.
- Dừng chỉ dừng hàng đợi Studio; người dùng vẫn có thể dừng câu trả lời đang chạy trong ChatGPT.
- Tiếp tục chỉ gửi lại tác vụ có trạng thái rõ ràng là chưa gửi; tác vụ không chắc chắn phải dùng Nhận lại kết quả hoặc Nhập ảnh.
- Mọi kết quả được lưu theo dự án và theo số phần/cảnh trước khi chuyển bước.
- Không tự thay đổi nội dung kịch bản gốc khi tách phần hoặc tách cảnh.

## Đợt sửa tiếp theo
1. Thêm bảng tiến trình cố định theo phần/cảnh, không dùng trạng thái màu nhấp nháy.
2. Tách dữ liệu nội dung khỏi phương án hình ảnh trong giao diện và dữ liệu dự án.
3. Bổ sung lịch sử lệnh cho từng ảnh: prompt, thời điểm gửi, URL cuộc trò chuyện, ảnh đã nhận và số lần tạo lại.
4. Bổ sung nút xem prompt, sao chép prompt, tạo lại một cảnh, bỏ qua một cảnh và đánh dấu cần xử lý thủ công.
5. Xuất danh sách cảnh/prompt ra JSON và CSV để không bị khóa vào một cuộc hội thoại ChatGPT.
