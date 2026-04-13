# 📄 PaperLens

**Công cụ nghiên cứu bài báo khoa học & luyện dịch Anh-Việt**

> Paste link hoặc nội dung bài báo → PaperLens tự động phân tách từng câu, nhóm theo phần (Abstract, Introduction, Methods...) và loại bỏ References → Bạn luyện dịch từng câu ngay trong bảng 2 cột.

🔗 **Live demo:** [paperlens.vercel.app](https://paperlens.vercel.app)

---

## ✨ Tính năng

- **3 cách nhập liệu:** Dán text | Paste link URL | Tải file PDF
- **Tự động phân đoạn:** Nhận diện các phần Abstract, Introduction, Methods, Results, Discussion, Conclusion
- **Loại bỏ References:** Tự động cắt bỏ phần tài liệu tham khảo
- **Bảng dịch 2 cột:** English ↔ Tiếng Việt (bạn tự nhập bản dịch)
- **Theo dõi tiến độ:** Thanh tiến trình % câu đã dịch
- **Lưu phiên làm việc:** Tự động lưu vào localStorage
- **Export đa dạng:**
  - 📄 TXT — file text thuần
  - 📋 Notion — file Markdown ready để import vào Notion
  - 📝 Google Docs — copy HTML table thẳng vào Google Docs (Ctrl+V)
- **Dark/Light mode**
- **Hỗ trợ CORS proxy** để fetch PDF từ link trực tiếp

## 🚀 Cách dùng

1. Mở [paperlens.vercel.app](https://paperlens.vercel.app)
2. Chọn cách nhập nội dung:
   - **Dán nội dung:** Copy text từ bài báo rồi paste vào
   - **Dán link:** Nhập URL bài báo (PubMed, PMC, journal sites, PDF links)
   - **Tải PDF:** Download PDF về máy rồi upload
3. Click **Phân tích bài báo**
4. Bảng 2 cột hiện ra — nhập bản dịch của bạn vào cột Tiếng Việt
5. Export ra Notion hoặc Google Docs khi xong

## 🛠 Tech Stack

- **Vanilla HTML/CSS/JavaScript** — không cần framework
- **PDF.js** (v3.11.174) — trích xuất text từ PDF client-side
- **CORS Proxies** — allorigins.win, corsproxy.io, codetabs.com
- **localStorage** — lưu phiên làm việc offline

## 📦 Chạy local

```bash
# Chỉ cần mở file HTML — không cần server
open index.html
# Hoặc dùng Live Server extension trong VS Code
```
