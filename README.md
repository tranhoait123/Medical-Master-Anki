# 🩺 Medical Master Anki Generator

> **Trợ lý AI tạo thẻ Anki Y khoa tự động — "Học ít hiểu sâu, nhớ lâu trọn đời."**
>
> *Project mã nguồn mở phát triển bởi @PonZ.*

![Badge](https://img.shields.io/badge/Status-Active-success)
![Badge](https://img.shields.io/badge/Tech-React_TS-blue)
![Badge](https://img.shields.io/badge/AI-Gemini_3.0_Flash-orange)
![Badge](https://img.shields.io/badge/License-MIT-green)

---

## 📖 Câu Chuyện & Lý Do Ra Đời

Là một sinh viên Y (hoặc người học Y), chắc chắn bạn hiểu cảm giác này:

* 📚 **Tài liệu quá nhiều:** Harrison, Guyton, Slide bài giảng, Note lâm sàng... đọc không xuể.
* ⏳ **Thời gian quá ít:** Vừa đi trực, vừa đi học, về nhà chỉ muốn ngủ chứ không muốn ngồi gõ từng cái thẻ Anki.
* 😫 **Anki cực hình:** Việc tạo thẻ (Card creation) chiếm 80% thời gian, chỉ còn 20% để học (Review). Đây là một sự lãng phí khủng khiếp.

**Medical Master** ra đời để đảo ngược tỷ lệ đó: **1% Tạo thẻ - 99% Học.**

Công cụ này không chỉ là một cái "máy copy paste". Nó được tích hợp **Prompt Engineering y khoa chuyên sâu** để tư duy như một sinh viên giỏi: biết lọc ý chính, biết phân tích cơ chế, và quan trọng nhất là **không bịa đặt**.

---

## ✨ Tính Năng Nổi Bật (v1.5.0)

### 1. 🧠 Gemini 3.0 Flash Power

Sử dụng model mới nhất của Google (2025/2026) với tốc độ xử lý "ánh sáng" và khả năng hiểu ngữ cảnh khổng lồ.

* **Đọc đa phương tiện:** PDF, Ảnh chụp vở (OCR viết tay cực đỉnh), Text.
* **Context Caching:** (Mới) Tự động ghi nhớ tài liệu, giúp giảm 90% chi phí API và tăng tốc độ xử lý khi tạo hàng nghìn thẻ.

### 2. 🛡️ Strict Grounding (Chống ảo giác)

Nỗi sợ lớn nhất khi dùng AI học Y là **AI bịa kiến thức (Hallucination)**.

* Mình đã thiết lập "Hàng rào thép" 3 lớp.
* Nếu thông tin không có trong tài liệu bạn nạp vào -> AI sẽ báo **"Missing Data"** chứ tuyệt đối không chế thêm.
* Mỗi thẻ đều có trích dẫn nguồn: `📍 Nguồn: [File PDF - Trang 12]`.

### 3. � Outline Review & Selective Generation

Thay vì phó mặc cho AI "muốn làm gì thì làm", bạn nắm quyền kiểm soát:

1. **Analyze (Phân tích):** AI đọc bài, vẽ ra một cái Mục lục (Outline) chi tiết.
2. **Review (Duyệt):** Bạn xem trước dàn ý.
3. **Select (Chọn):** Chỉ tick chọn những phần bạn muốn học (VD: Bỏ qua phần "Đại cương", chỉ học "Điều trị").
4. **Anti-Duplicate:** Thuật toán thông minh tự động loại bỏ các mục trùng lặp, chỉ giữ lại kiến thức tinh gọn nhất.

### 4. ⚡ Power User Tools

* **Edit Mode:** Sửa lỗi chính tả, thêm ghi chú cá nhân ngay trước khi tạo thẻ.
* **History:** Tự động lưu thẻ vào bộ nhớ trình duyệt. Lỡ tay tắt tab? Không sao, mở lại vẫn còn nguyên.
* **AnkiConnect:** Bấm một nút, thẻ bay thẳng vào bộ bài (Deck) Anki của bạn. Không cần file .txt, không cần Excel.

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

```bash
git clone https://github.com/tranhoait123/Medical-Master-Anki.git
cd Medical-Master-Anki
```

### Bước 3: Cài thư viện & Chạy

```bash
npm install
npm run dev
```

Xong! Mở trình duyệt tại `http://localhost:5173` và bắt đầu thôi.

---

## 🔄 Quy Trình Sử Dụng Chuẩn (Workflow)

Để đạt hiệu quả cao nhất, hãy làm theo các bước sau:

**1. Nạp nhiên liệu ⛽**

* Nhập **Gemini API Key** (Lấy miễn phí tại Google AI Studio).
* Upload file PDF bài giảng, hoặc Paste đoạn văn bản cần học.

**2. Phân tích & Lên kế hoạch 🧭**

* Nhập **Topic Focus** (Quan trọng): Nếu file PDF dài 100 trang, hãy gõ "Bài Suy Tim" để AI chỉ tập trung vào đó.
* Bấm **Analyze**.

**3. Kiểm duyệt (The Gatekeeper) 👮**

* AI sẽ trả về bảng **Review Outline**.
* Kiểm tra xem nó chia mục đúng chưa.
* Bỏ tick những phần rườm rà không cần thiết.

**4. Khởi động nhà máy 🏭**

* Bấm **Start Generation**.
* Ngồi đợi AI "nhả" thẻ. Chỗ này có **Context Caching** nên sẽ chạy khá nhanh.

**5. Hậu kỳ & Xuất xưởng 📦**

* Đọc lướt qua các thẻ. Bấm vào icon ✏️ để sửa nếu cần.
* Bấm **Sync to Anki**. Bùm! Xong.

---

## ❓ FAQ & Troubleshooting

**Q: Tại sao bấm Start Generation mà không chạy?**

* A: Có thể do Cache hết hạn (nếu bạn treo máy quá 1 tiếng). Nhưng yên tâm, bản **v1.5.0** đã có tính năng **Auto-Refresh Cache**, nó sẽ tự sửa lỗi này cho bạn. Chỉ cần đợi thêm vài giây.

**Q: Tool báo lỗi "Failed to fetch" khi Sync?**

* A: Bạn chưa bật Anki Desktop, hoặc chưa config AnkiConnect đúng (xem lại Bước 1).

**Q: Thẻ tạo ra quá nhiều, trùng lặp?**

* A: Hãy dùng tính năng **Selective Generation** ở bước Review để bỏ bớt các mục cha (I, II...) nếu thấy không cần thiết.

**Q: Dữ liệu của tôi có bị gửi đi đâu không?**

* A: Không. Mọi thứ diễn ra trên trình duyệt của bạn và gửi trực tiếp đến Google Gemini API. Mình (tác giả) không lưu bất kỳ cái gì.

---

## 📝 Changelog

| Version | Ngày | Thay đổi nổi bật |
| :--- | :--- | :--- |
| **v1.5.0** | 02/2026 | Auto-Refresh Cache, Selective Generation, UI Polish. |
| **v1.4.0** | 02/2026 | Explicit Context Caching (Tiết kiệm 90% token). |
| **v1.3.0** | 02/2026 | Outline Review & Card Estimation. |
| **v1.2.0** | 01/2026 | Edit Mode & History Persistence. |
| **v1.0.0** | 01/2026 | Initial Release. |

---
*Made with ❤️ and ☕ by @PonZ.*
