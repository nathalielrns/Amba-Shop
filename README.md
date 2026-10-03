# Smart Canteen — QRIS MVP

Prototype untuk Smart CCTV Robotik Kantin Kejujuran.

## Fitur tahap 1
- Katalog produk
- Keranjang
- Checkout
- Transaction ID unik
- QRIS dinamis via Midtrans Core API
- Penyimpanan transaksi SQLite
- Webhook notification
- Verifikasi signature notification
- Polling status pembayaran

## 1. Buat virtual environment

Windows PowerShell:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## 2. Konfigurasi Midtrans Sandbox

Copy `.env.example` menjadi `.env`, lalu isi:

```env
MIDTRANS_SERVER_KEY=SB-Mid-server-xxxxxxxx
MIDTRANS_IS_PRODUCTION=false
```

JANGAN commit `.env` dan jangan kirim Server Key ke chat.

## 3. Jalankan

```powershell
uvicorn app.main:app --reload
```

Buka:

http://127.0.0.1:8000

Swagger:

http://127.0.0.1:8000/docs

## 4. Test QRIS Sandbox

Setelah checkout, web akan menerima QR image URL dari Midtrans.

Untuk simulasi pembayaran Sandbox, gunakan QRIS Simulator Midtrans dan masukkan QR image URL tersebut.

## Catatan security
Prototype ini sengaja memisahkan secret dari frontend. Namun sebelum production:
- harga produk harus selalu berasal dari database/server, bukan dipercaya dari browser;
- webhook harus diverifikasi;
- endpoint admin perlu authentication + authorization;
- HTTPS wajib;
- rate limiting dan validation perlu ditambahkan;
- logging/audit trail perlu ditambahkan;
- secret sebaiknya dikelola melalui secret manager/environment yang aman.

## Roadmap
1. Product database
2. User/session
3. Admin dashboard
4. Webhook hardening + idempotency
5. Evidence/CCTV database
6. Snapshot/video reference
7. Robot status/expression API
8. Object detection/tracking
9. Backup power + location tracking
