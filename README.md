# Medical Master (Anki Generator)

> **Tool tự động tạo thẻ Anki từ tài liệu Y khoa.**
> *Project cá nhân phát triển bởi @PonZ.*

![Badge](https://img.shields.io/badge/Status-Active-success)
![Badge](https://img.shields.io/badge/Tech-React_TS-blue)

## 📖 Giới thiệu

Chào các bạn, mình là PonZ.
Đây là công cụ mình viết để giải quyết vấn đề muôn thuở của sinh viên Y: **Tốn quá nhiều thời gian làm thẻ Anki hơn là học.**

Thay vì phải ngồi copy-paste từng dòng, tool này sử dụng AI (Gemini 3.0) để đọc tài liệu (PDF, ảnh chụp, note viết tay) và tự động trích xuất ra các thẻ học chuẩn format y khoa (Cơ chế, Triệu chứng, Điều trị...).

## 💡 Tại sao lại dùng cái này?

* **Nhanh:** Thả file vào, đi uống cốc nước, quay lại có sẵn thẻ để học.
* **Chính xác:** Mình đã cấu hình để AI TUYỆT ĐỐI KHÔNG BỊA RA KIẾN THỨC (Strict Grounding). Có sao nói vậy.
* **Topic Focus:** Mới update tính năng này, cho phép bạn chỉ học 1 bài cụ thể trong cuốn sách dày cộp.
* **Anki Sync:** Đẩy thẻ thẳng vào Anki Desktop, không cần export/import lằng nhằng.

## ⚙️ Cài đặt (Local)

Anh em Clone về chạy trên máy cho an toàn nhé (API Key lưu trên trình duyệt của bạn, mình không lưu server).

1. **Clone repo:**

    ```bash
    git clone https://github.com/yourusername/anki-notebooklm-gen.git
    cd anki-notebooklm-gen
    ```

2. **Cài thư viện:**

    ```bash
    npm install
    ```

3. **Cấu hình AnkiConnect:**
    Để tool này nói chuyện được với Anki của bạn, cần cài add-on **AnkiConnect** và sửa config một chút:
    * Mở Anki -> Tools -> Add-ons -> AnkiConnect -> Config.
    * Thêm dòng này vào `webCorsOriginList`: `http://localhost:5173`.

4. **Chạy:**

    ```bash
    npm run dev
    ```

## 🧠 Kinh nghiệm sử dụng

Sau một thời gian test, mình rút ra mấy mẹo này cho anh em:

1. **Đừng tham:** Nếu nạp file PDF 100 trang, AI sẽ bị "ngáo". Hãy dùng tính năng **Topic Focus** để chia nhỏ ra (vd: "Chương Tim mạch", "Bài Viêm phổi").
2. **Chữ bác sĩ:** Yên tâm là Gemini 3.0 đọc chữ viết tay còn tốt hơn mình đọc. Cứ chụp vở ném vào.
3. **Check lại:** Dù xịn đến mấy thì thi thoảng vẫn nên liếc qua thẻ trước khi học.

---
*Made with ☕ by PonZ.*
