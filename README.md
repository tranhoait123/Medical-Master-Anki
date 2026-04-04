# 🩺 Medical Master Anki Generator

> **Trợ lý AI tạo thẻ Anki Y khoa tự động — "Học ít hiểu sâu, nhớ lâu trọn đời."**
>
> *Project mã nguồn mở phát triển bởi @PonZ.*

![Badge](https://img.shields.io/badge/Status-Active-success)
![Badge](https://img.shields.io/badge/Tech-React_TS-blue)
![Badge](https://img.shields.io/badge/AI-Gemini_Advanced-orange)
![Badge](https://img.shields.io/badge/License-MIT-green)

---

## 📖 Câu Chuyện & Lý Do Ra Đời

Là một sinh viên Y (hoặc người học Y), chắc chắn bạn hiểu cảm giác này:

* 📚 **Tài liệu quá nhiều:** Harrison, Guyton, Slide bài giảng, Note lâm sàng... đọc không xuể.
* ⏳ **Thời gian quá ít:** Vừa đi trực, vừa đi học, về nhà chỉ muốn ngủ chứ không muốn ngồi gõ từng cái thẻ Anki.
* 😫 **Anki cực hình:** Việc tạo thẻ (Card creation) chiếm 80% thời gian, chỉ còn 20% để học (Review).

**Medical Master** ra đời để đảo ngược tỷ lệ đó: **1% Tạo thẻ - 99% Học.**

Công cụ này không chỉ là một cái "máy copy paste". Nó được tích hợp **Prompt Engineering y khoa chuyên sâu** để tư duy như một sinh viên giỏi: biết lọc ý chính, biết phân tích cơ chế, và quan trọng nhất là **không bịa đặt**.

---

## ✨ Tính Năng Nổi Bật (v2.0.0)

### 1. 🧠 Smart API Management & Endless Rotation
* **Multi-Key Support:** Nhập nhiều API Key cùng lúc (ngăn cách bằng dấu phẩy). Hệ thống tự động xoay vòng.
* **Endless Rotation:** Vòng lặp API vô hạn ưu việt giúp tránh lỗi 429 triệt để ngay cả với lượng dữ liệu khổng lồ.
* **Smart Cache Bypass:** Tự động nhận diện (dưới 500KB) và bỏ qua rào cản quá tải từ Google Context Caching cho file nhỏ, gửi nội dung siêu tốc. Trữ tài nguyên cho các tài liệu khổng lồ.

### 2. ⚡ Command Batching (Giảm 50% Request)
* Thay vì bắn từng lệnh, Engine sẽ nhóm **(Batch = 8)** để giảm đáng kể tổng số lượt Request, giữ cho API Key của bạn không bị cạn kiệt Quota.
* Thiết lập hệ thống Exponential Backoff thông minh để App tự động ngủ đông & tiếp tục thay vì sập (Crash).

### 3. 🛡️ Strict Grounding & 100% Coverage
* **100% Coverage Rule:** Đảm bảo không bỏ sót bất kỳ chi tiết nhỏ nào (liều lượng, số liệu...).
* **Zero Hallucination Policy:** Nếu thiếu dữ liệu -> Báo "Missing Data", tuyệt đối không bịa.
* **Precise Sourcing:** Trích dẫn nguồn chính xác đến từng trang/phút `[File PDF - Trang 12]`.

### 4. 🎨 UI/UX "Pro" Edition (Light-Mode First)
* Giao diện Glassmorphism hoàn toàn mới dựa trên MCQ AnkiGen Pro.
* Gradient chủ đạo Thạch anh Tím (Indigo/Purple) cùng typography chuyên nghiệp.
* Live-Terminal Logs: Xem thực trạng từng dòng Code được xử lý thời gian thực.
* Hỗ trợ gạt **Chế độ Sáng/Tối (Light/Dark Mode)**.

---

## 🛠️ Hướng Dẫn Cài Đặt (Local)

Vì đây là tool cá nhân (để bảo mật API Key của bạn), nên cách tốt nhất là chạy Local trên máy tính.

### Bước 1: Chuẩn bị

* Cài [Node.js](https://nodejs.org/) (nếu chưa có).
* Cài [Anki Desktop](https://apps.ankiweb.net/).
* Cài Add-on **AnkiConnect** (Mã: `2055492159`).
  * *Config AnkiConnect:* Vào `Tools` -> `Add-ons` -> `AnkiConnect` -> `Config`. Thêm sai dòng `webCorsOriginList`:

        ```json
        "webCorsOriginList": ["http://localhost:5173", "http://127.0.0.1:5173"]
        ```

### Bước 2: Tải code về

    git clone https://github.com/tranhoait123/Medical-Master-Anki.git
    cd Medical-Master-Anki

### Bước 3: Cài thư viện & Chạy

    npm install
    npm run dev

Xong! Mở trình duyệt tại `http://localhost:5173` và bắt đầu thôi.

---

## 🔄 Quy Trình Sử Dụng Chuẩn (Workflow)

Để đạt hiệu quả cao nhất, hãy làm theo các bước sau:

### 1. Nạp nhiên liệu ⛽

* Nhập **Gemini API Key**.
* Upload file PDF bài giảng (Hỗ trợ nhiều file cùng lúc).
* Chọn Model phù hợp (Khuyên dùng **Flash-Lite** cho tài liệu dài, **3 Flash** cho độ chính xác tuyệt đối).

### 2. Phân tích & Lên kế hoạch 🧭

* Nhập **Topic Focus** (Ví dụ: "Bài Suy Tim").
* Bấm **Analyze** để AI tạo cache và lập dàn ý.

### 3. Kiểm duyệt (The Gatekeeper) 👮

* Review dàn ý (Outline).
* Chọn các phần muốn học.

### 4. Khởi động nhà máy 🏭

* Bấm **Start Generation**.
* Theo dõi Progress Bar và Log để xem AI làm việc.

### 5. Hậu kỳ & Xuất xưởng 📦

* Xem lại thẻ, sync sang Anki hoặc tải CSV.

---

## 📝 Changelog

| Version | Ngày | Thay đổi nổi bật |
| :--- | :--- | :--- |
| **v2.0.0** | 04/2026 | **Đại tu Toàn diện (Overhaul)**: UI mới chuẩn MCQ AnkiGen Pro (Light/Dark mode), **Endless Key Rotation**, **Command Batching**, Smart Cache Bypass, Exponential Backoff. |
| **v1.8.0** | 02/2026 | **Multi-Model Support** (3 Flash, 2.5 Flash, Lite), Token Usage, Granular Extractor v2.4. |
| **v1.7.0** | 02/2026 | Modular Refactor, True Multi-file Support. |
| **v1.0.0** | 01/2026 | Initial Release. |

---
*Made with ❤️ and ☕ by @PonZ.*
