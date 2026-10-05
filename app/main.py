import base64
import hashlib
import hmac
import json
import os
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from html import escape
from io import BytesIO
from urllib.parse import quote

import qrcode

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    create_engine,
    inspect,
    text,
)
from sqlalchemy.orm import declarative_base, sessionmaker

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./smart_canteen.db")
MIDTRANS_SERVER_KEY = os.getenv("MIDTRANS_SERVER_KEY", "").strip()
IS_PRODUCTION = os.getenv("MIDTRANS_IS_PRODUCTION", "false").lower() == "true"
MIDTRANS_BASE_URL = "https://api.midtrans.com" if IS_PRODUCTION else "https://api.sandbox.midtrans.com"

# Duitku Sandbox / Production
DUITKU_MERCHANT_CODE = os.getenv("DUITKU_MERCHANT_CODE", "").strip()
DUITKU_API_KEY = os.getenv("DUITKU_API_KEY", "").strip()
DUITKU_ENV = os.getenv("DUITKU_ENV", "sandbox").strip().lower()
DUITKU_PAYMENT_METHOD = os.getenv("DUITKU_PAYMENT_METHOD", "").strip().upper()
DUITKU_CALLBACK_URL = os.getenv("DUITKU_CALLBACK_URL", "https://amba-shop-eta.vercel.app/callback").strip()
DUITKU_RETURN_URL = os.getenv("DUITKU_RETURN_URL", "https://amba-shop-eta.vercel.app/payment.html").strip()
DUITKU_CUSTOMER_EMAIL = os.getenv("DUITKU_CUSTOMER_EMAIL", "test@example.com").strip()
DUITKU_BASE_URL = (
    "https://sandbox.duitku.com"
    if DUITKU_ENV != "production"
    else "https://passport.duitku.com"
)
PAYMENT_DURATION_MINUTES = 5
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")
ADMIN_SECRET = os.getenv("ADMIN_SECRET", "smart-canteen-change-this-secret")
ADMIN_PANEL_PATH = os.getenv("ADMIN_PANEL_PATH","/management-7xK92")

ADMIN_SESSION_MINUTES = int(
    os.getenv(
        "ADMIN_SESSION_MINUTES",
        "30"
    )
)

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def money(value):
    return int(round(value))


class Product(Base):
    __tablename__ = "products"
    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)
    price = Column(Integer, nullable=False)
    discount_percent = Column(Float, nullable=False, default=0)
    stock = Column(Integer, nullable=False, default=0)
    reserved_stock = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)


class Transaction(Base):
    __tablename__ = "transactions"
    id = Column(Integer, primary_key=True)
    order_id = Column(String(64), unique=True, nullable=False, index=True)
    total = Column(Integer, nullable=False)
    payment_status = Column(String(30), nullable=False, default="pending")
    payment_type = Column(String(30), nullable=True)
    qr_url = Column(String(1000), nullable=True)
    midtrans_transaction_id = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)
    expires_at = Column(DateTime, nullable=True)


class TransactionItem(Base):
    __tablename__ = "transaction_items"
    id = Column(Integer, primary_key=True)
    transaction_id = Column(Integer, ForeignKey("transactions.id"), nullable=False, index=True)
    product_id = Column(Integer, nullable=True, index=True)
    product_name = Column(String(100), nullable=False)
    unit_price = Column(Integer, nullable=False)
    discount_percent = Column(Float, nullable=False, default=0)
    quantity = Column(Integer, nullable=False)
    subtotal = Column(Integer, nullable=False)


class StockMovement(Base):
    __tablename__ = "stock_movements"
    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, nullable=False, index=True)
    change_qty = Column(Integer, nullable=False)
    reason = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=utc_now)


class SupportMessage(Base):
    __tablename__ = "support_messages"
    id = Column(Integer, primary_key=True)
    order_id = Column(String(64), nullable=True, index=True)
    contact = Column(String(120), nullable=True)
    message = Column(String(2000), nullable=False)
    status = Column(String(20), nullable=False, default="open")
    admin_reply = Column(String(2000), nullable=True)
    created_at = Column(DateTime, default=utc_now)
    replied_at = Column(DateTime, nullable=True)
    client_id = Column(String(64), nullable=True, index=True)


Base.metadata.create_all(bind=engine)


def migrate_database():
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    if "transactions" in tables:
        columns = [c["name"] for c in inspector.get_columns("transactions")]
        if "expires_at" not in columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE transactions ADD COLUMN expires_at DATETIME"))
    if "products" not in tables:
        Product.__table__.create(bind=engine, checkfirst=True)
    if "transaction_items" not in tables:
        TransactionItem.__table__.create(bind=engine, checkfirst=True)
    if "stock_movements" not in tables:
        StockMovement.__table__.create(bind=engine, checkfirst=True)
    if "support_messages" not in tables:
        SupportMessage.__table__.create(bind=engine, checkfirst=True)
    else:
        columns = [c["name"] for c in inspector.get_columns("support_messages")]
        if "client_id" not in columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE support_messages ADD COLUMN client_id VARCHAR(64)"))


migrate_database()


def seed_products():
    db = SessionLocal()
    try:
        if db.query(Product).count() == 0:
            for name, price, stock in [
                ("Roti Coklat", 5000, 20),
                ("Teh Botol", 4000, 20),
                ("Keripik", 3000, 20),
                ("Air Mineral", 3000, 20),
            ]:
                db.add(Product(name=name, price=price, stock=stock, discount_percent=0, is_active=True))
            db.commit()
    finally:
        db.close()


seed_products()

app = FastAPI(title="Smart Canteen API", version="1.1.0-duitku")
app.mount("/static", StaticFiles(directory="app/static"), name="static")


# =========================
# AUTH / ADMIN HELPERS
# =========================

def make_admin_token():
    stamp = str(int(datetime.now(timezone.utc).timestamp()))
    body = f"{ADMIN_USERNAME}:{stamp}"
    sig = hmac.new(ADMIN_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(f"{body}:{sig}".encode()).decode()


def is_admin(request: Request):
    token = request.cookies.get("admin_token")
    if not token:
        return False
    try:
        raw = base64.urlsafe_b64decode(token.encode()).decode()
        username, stamp, sig = raw.split(":", 2)
        body = f"{username}:{stamp}"
        expected = hmac.new(ADMIN_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()
        age = int(datetime.now(timezone.utc).timestamp()) - int(stamp)
        return (username == ADMIN_USERNAME and age < ADMIN_SESSION_MINUTES * 60 and hmac.compare_digest(sig, expected))
    except Exception:
        return False


def require_admin(request: Request):
    if not is_admin(request):
        raise HTTPException(status_code=401, detail="Admin login diperlukan.")


def product_dict(p: Product):
    effective = money(p.price * (1 - p.discount_percent / 100))
    return {
        "id": p.id,
        "name": p.name,
        "price": p.price,
        "discount_percent": p.discount_percent,
        "effective_price": effective,
        "stock": p.stock,
        "reserved_stock": p.reserved_stock,
        "available_stock": max(0, p.stock - p.reserved_stock),
        "is_active": p.is_active,
    }


def serialize_tx(db, tx):
    items = db.query(TransactionItem).filter(TransactionItem.transaction_id == tx.id).all()
    return {
        "id": tx.id,
        "order_id": tx.order_id,
        "total": tx.total,
        "payment_status": tx.payment_status,
        "payment_type": tx.payment_type,
        "qr_url": tx.qr_url,
        "midtrans_transaction_id": tx.midtrans_transaction_id,
        "created_at": tx.created_at.isoformat() if tx.created_at else None,
        "updated_at": tx.updated_at.isoformat() if tx.updated_at else None,
        "expires_at": tx.expires_at.isoformat() + "Z" if tx.expires_at else None,
        "items": [
            {
                "product_id": i.product_id,
                "product_name": i.product_name,
                "unit_price": i.unit_price,
                "discount_percent": i.discount_percent,
                "quantity": i.quantity,
                "subtotal": i.subtotal,
            }
            for i in items
        ],
    }


def release_reservation(db, tx):
    items = db.query(TransactionItem).filter(TransactionItem.transaction_id == tx.id).all()
    for item in items:
        if item.product_id is None:
            continue
        product = db.query(Product).filter(Product.id == item.product_id).first()
        if product:
            product.reserved_stock = max(0, product.reserved_stock - item.quantity)


def finalize_success(db, tx, payment_type=None):
    if tx.payment_status == "success":
        return
    if tx.payment_status != "pending":
        return
    now = utc_now()
    if tx.expires_at and now >= tx.expires_at:
        tx.payment_status = "expired"
        release_reservation(db, tx)
        tx.updated_at = now
        return
    items = db.query(TransactionItem).filter(TransactionItem.transaction_id == tx.id).all()
    for item in items:
        if item.product_id is None:
            continue
        product = db.query(Product).filter(Product.id == item.product_id).first()
        if not product or product.reserved_stock < item.quantity:
            raise HTTPException(status_code=409, detail=f"Stok {item.product_name} tidak mencukupi untuk menyelesaikan transaksi.")
        product.reserved_stock -= item.quantity
        product.stock = max(0, product.stock - item.quantity)
        db.add(StockMovement(product_id=product.id, change_qty=-item.quantity, reason=f"Penjualan {tx.order_id}"))
    tx.payment_status = "success"
    tx.payment_type = payment_type or tx.payment_type or "manual"
    tx.updated_at = now


def finalize_failure(db, tx, status="failed"):
    if tx.payment_status in ("success", "expired", "cancelled"):
        return
    tx.payment_status = status
    release_reservation(db, tx)
    tx.updated_at = utc_now()


# =========================
# PAGES
# =========================
@app.get("/")
def index():
    return FileResponse("app/static/index.html")


@app.get("/payment.html")
def payment_page():
    return FileResponse("app/static/payment.html")

@app.get(
    ADMIN_PANEL_PATH,
    response_class=HTMLResponse
)
def admin_panel():

    return HTMLResponse(
        ADMIN_HTML
    )

# =========================
# REQUEST MODELS
# =========================
class CheckoutItem(BaseModel):
    product_id: int = Field(gt=0)
    quantity: int = Field(gt=0, le=100)


class CheckoutRequest(BaseModel):
    items: list[CheckoutItem] = Field(min_length=1, max_length=50)


class AdminLoginRequest(BaseModel):
    username: str
    password: str


class ProductRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    price: int = Field(gt=0, le=10_000_000)
    discount_percent: float = Field(ge=0, le=100)
    stock: int = Field(ge=0, le=1_000_000)


class ProductEditRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    price: int = Field(gt=0, le=10_000_000)
    discount_percent: float = Field(ge=0, le=100)
    stock: int | None = Field(default=None, ge=0, le=1_000_000)
    is_active: bool = True


class StockRequest(BaseModel):
    change_qty: int = Field(ge=-1_000_000, le=1_000_000)
    reason: str = Field(min_length=1, max_length=255)


class ManualPaymentRequest(BaseModel):
    status: str


class SupportRequest(BaseModel):
    order_id: str | None = Field(default=None, max_length=64)
    contact: str | None = Field(default=None, max_length=120)
    message: str = Field(min_length=1, max_length=2000)


class SupportReplyRequest(BaseModel):
    reply: str = Field(min_length=1, max_length=2000)


# =========================
# DUITKU
# =========================
def duitku_signature(value: str) -> str:
    return hmac.new(
        DUITKU_API_KEY.encode("utf-8"),
        value.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


async def get_duitku_qris_method(amount: int) -> str:
    if DUITKU_PAYMENT_METHOD:
        if DUITKU_PAYMENT_METHOD not in {"SP", "NQ", "SQ"}:
            raise HTTPException(
                status_code=500,
                detail="DUITKU_PAYMENT_METHOD harus SP, NQ, atau SQ untuk QRIS.",
            )
        return DUITKU_PAYMENT_METHOD

    jakarta_now = datetime.now(timezone(timedelta(hours=7)))
    duitku_datetime = jakarta_now.strftime("%Y-%m-%d %H:%M:%S")
    signature = duitku_signature(f"{DUITKU_MERCHANT_CODE}{amount}{duitku_datetime}")
    body = {
        "merchantcode": DUITKU_MERCHANT_CODE,
        "amount": amount,
        "datetime": duitku_datetime,
        "signature": signature,
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                f"{DUITKU_BASE_URL}/webapi/api/merchant/paymentmethod/getpaymentmethod",
                headers={"Content-Type": "application/json", "Accept": "application/json"},
                json=body,
            )
        data = response.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gagal mengambil metode pembayaran Duitku: {exc}")

    if response.status_code >= 400 or str(data.get("responseCode", "")) != "00":
        raise HTTPException(status_code=502, detail={
            "message": "Gagal mengambil metode pembayaran aktif dari Duitku.",
            "duitku": data,
        })

    available = {str(row.get("paymentMethod", "")).upper() for row in data.get("paymentFee", [])}
    for candidate in ("SP", "NQ", "SQ"):
        if candidate in available:
            return candidate

    raise HTTPException(
        status_code=503,
        detail="Tidak ada metode QRIS aktif (SP/NQ/SQ) pada proyek Duitku ini.",
    )


# =========================
# MIDTRANS LEGACY WEBHOOK
# =========================
# =========================
# CUSTOMER PRODUCTS
# =========================
@app.get("/api/products")
def get_products(include_unavailable: bool = False):
    db = SessionLocal()
    try:
        q = db.query(Product).filter(Product.is_active.is_(True))
        if not include_unavailable:
            q = q.filter((Product.stock - Product.reserved_stock) > 0)
        products = q.order_by(((Product.stock - Product.reserved_stock) > 0).desc(), Product.id.asc()).all()
        return [product_dict(p) for p in products]
    finally:
        db.close()


# =========================
# CHECKOUT
# =========================
@app.post("/api/checkout")
async def checkout(payload: CheckoutRequest):
    db = SessionLocal()
    try:
        if not payload.items:
            raise HTTPException(status_code=400, detail="Keranjang kosong.")

        requested = {}
        for item in payload.items:
            requested[item.product_id] = requested.get(item.product_id, 0) + item.quantity

        products = []
        total = 0
        for product_id, quantity in requested.items():
            product = db.query(Product).filter(Product.id == product_id, Product.is_active.is_(True)).first()
            if not product:
                raise HTTPException(status_code=404, detail=f"Produk ID {product_id} tidak ditemukan.")
            available = product.stock - product.reserved_stock
            if quantity > available:
                raise HTTPException(status_code=409, detail=f"Stok {product.name} tidak cukup. Tersedia {max(0, available)}.")
            effective = money(product.price * (1 - product.discount_percent / 100))
            total += effective * quantity
            products.append((product, quantity, effective))

        created_at = utc_now()
        expires_at = created_at + timedelta(minutes=PAYMENT_DURATION_MINUTES)
        order_id = f"TRX-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:10].upper()}"
        tx = Transaction(order_id=order_id, total=total, payment_status="pending", created_at=created_at, updated_at=created_at, expires_at=expires_at)
        db.add(tx)
        db.flush()

        for product, quantity, effective in products:
            product.reserved_stock += quantity
            db.add(TransactionItem(transaction_id=tx.id, product_id=product.id, product_name=product.name, unit_price=effective, discount_percent=product.discount_percent, quantity=quantity, subtotal=effective * quantity))

        db.commit()
        db.refresh(tx)

        if not DUITKU_MERCHANT_CODE or not DUITKU_API_KEY:
            return {
                "order_id": order_id,
                "total": total,
                "payment_status": "pending",
                "qr_url": None,
                "midtrans_transaction_id": None,
                "mode": "local",
                "expires_at": expires_at.isoformat() + "Z",
                "payment_duration_minutes": PAYMENT_DURATION_MINUTES,
            }

        payment_method = await get_duitku_qris_method(total)
        callback_url = DUITKU_CALLBACK_URL
        return_url = f"{DUITKU_RETURN_URL}{'&' if '?' in DUITKU_RETURN_URL else '?'}order_id={quote(order_id)}"
        item_details = [
            {
                "name": p.name,
                "price": effective,
                "quantity": quantity,
            }
            for p, quantity, effective in products
        ]
        string_to_sign = f"{DUITKU_MERCHANT_CODE}{order_id}{total}"
        signature = hmac.new(
            DUITKU_API_KEY.encode("utf-8"),
            string_to_sign.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        body = {
            "merchantCode": DUITKU_MERCHANT_CODE,
            "paymentAmount": total,
            "paymentMethod": payment_method,
            "merchantOrderId": order_id,
            "productDetails": "Pembayaran Amba Shop",
            "email": DUITKU_CUSTOMER_EMAIL,
            "customerVaName": "Amba Shop",
            "itemDetails": item_details,
            "callbackUrl": callback_url,
            "returnUrl": return_url,
            "signature": signature,
            "expiryPeriod": PAYMENT_DURATION_MINUTES,
        }

        try:
            async with httpx.AsyncClient(timeout=20) as client:
                response = await client.post(
                    f"{DUITKU_BASE_URL}/webapi/api/merchant/v2/inquiry",
                    headers={"Content-Type": "application/json", "Accept": "application/json"},
                    json=body,
                )
            try:
                data = response.json()
            except ValueError:
                data = {"raw": response.text}
        except Exception as exc:
            finalize_failure(db, tx, "failed")
            db.commit()
            raise HTTPException(status_code=502, detail=f"Duitku request failed: {exc}")

        if response.status_code >= 400 or str(data.get("statusCode", "00")) not in ("00", "0"):
            finalize_failure(db, tx, "failed")
            db.commit()
            raise HTTPException(status_code=502, detail={
                "message": "Duitku menolak transaksi.",
                "duitku": data,
            })

        qr_string = data.get("qrString")
        if not qr_string:
            finalize_failure(db, tx, "failed")
            db.commit()
            raise HTTPException(status_code=502, detail="Duitku tidak mengembalikan qrString.")

        try:
            qr_image = qrcode.make(qr_string)
            buffer = BytesIO()
            qr_image.save(buffer, format="PNG")
            qr_url = "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")
        except Exception as exc:
            finalize_failure(db, tx, "failed")
            db.commit()
            raise HTTPException(status_code=500, detail=f"Gagal membuat gambar QRIS: {exc}")

        tx.qr_url = qr_url
        tx.midtrans_transaction_id = data.get("reference") or data.get("publisherOrderId")
        tx.payment_type = payment_method
        tx.updated_at = utc_now()
        db.commit()
        return {
            "order_id": order_id,
            "total": total,
            "payment_status": tx.payment_status,
            "qr_url": qr_url,
            "midtrans_transaction_id": tx.midtrans_transaction_id,
            "raw_status_code": data.get("statusCode"),
            "mode": "duitku",
            "payment_method": payment_method,
            "expires_at": expires_at.isoformat() + "Z",
            "payment_duration_minutes": PAYMENT_DURATION_MINUTES,
        }
    finally:
        db.close()


# =========================
# TRANSACTION STATUS
# =========================
@app.get("/api/transactions/{order_id}")
def transaction_status(order_id: str):
    db = SessionLocal()
    try:
        tx = db.query(Transaction).filter(Transaction.order_id == order_id).first()
        if not tx:
            raise HTTPException(status_code=404, detail="Transaction not found")
        if tx.payment_status == "pending" and tx.expires_at and utc_now() >= tx.expires_at:
            finalize_failure(db, tx, "expired")
            db.commit()
        return serialize_tx(db, tx)
    finally:
        db.close()


# =========================
# CANCEL
# =========================
@app.post("/api/transactions/{order_id}/cancel")
def cancel_transaction(order_id: str):
    db = SessionLocal()
    try:
        tx = db.query(Transaction).filter(Transaction.order_id == order_id).first()
        if not tx:
            raise HTTPException(status_code=404, detail="Transaction not found")
        if tx.payment_status == "success":
            raise HTTPException(status_code=409, detail="Pembayaran sudah berhasil.")
        if tx.payment_status in ("expired", "failed", "cancelled"):
            raise HTTPException(status_code=409, detail=f"Transaksi sudah {tx.payment_status}.")
        if tx.expires_at and utc_now() >= tx.expires_at:
            finalize_failure(db, tx, "expired")
            db.commit()
            raise HTTPException(status_code=409, detail="Transaksi sudah kedaluwarsa.")
        finalize_failure(db, tx, "cancelled")
        db.commit()
        return {"status": "cancelled", "order_id": order_id}
    finally:
        db.close()


# =========================
# DUITKU CALLBACK
# =========================
@app.post("/callback", response_class=PlainTextResponse)
async def duitku_callback(request: Request):
    raw_body = await request.body()
    from urllib.parse import parse_qs
    parsed = parse_qs(raw_body.decode("utf-8"), keep_blank_values=True)
    payload = {key: values[-1] if values else "" for key, values in parsed.items()}

    merchant_code = payload.get("merchantCode", "").strip()
    amount = payload.get("amount", "").strip()
    order_id = payload.get("merchantOrderId", "").strip()
    result_code = payload.get("resultCode", "").strip()
    reference = payload.get("reference", "").strip()
    signature = payload.get("signature", "").strip()

    if not merchant_code or not amount or not order_id or not signature:
        raise HTTPException(status_code=400, detail="Parameter callback Duitku tidak lengkap.")
    if not DUITKU_MERCHANT_CODE or not DUITKU_API_KEY:
        raise HTTPException(status_code=500, detail="Konfigurasi Duitku belum lengkap.")
    if not hmac.compare_digest(merchant_code, DUITKU_MERCHANT_CODE):
        raise HTTPException(status_code=403, detail="Merchant code tidak valid.")

    expected_signature = duitku_signature(f"{merchant_code}{amount}{order_id}")
    if not hmac.compare_digest(expected_signature, signature):
        raise HTTPException(status_code=403, detail="Signature callback Duitku tidak valid.")

    try:
        callback_amount = int(float(amount))
    except ValueError:
        raise HTTPException(status_code=400, detail="Amount callback tidak valid.")

    db = SessionLocal()
    try:
        tx = db.query(Transaction).filter(Transaction.order_id == order_id).first()
        if not tx:
            raise HTTPException(status_code=404, detail="Transaction not found")

        if callback_amount != tx.total:
            raise HTTPException(status_code=400, detail="Nominal callback tidak sama dengan nominal transaksi.")

        if tx.payment_status in ("success", "expired", "failed", "cancelled"):
            return "SUCCESS"

        if tx.expires_at and utc_now() >= tx.expires_at:
            finalize_failure(db, tx, "expired")
            db.commit()
            return "SUCCESS"

        if reference:
            tx.midtrans_transaction_id = reference
        if payload.get("paymentCode"):
            tx.payment_type = payload.get("paymentCode")

        if result_code == "00":
            finalize_success(db, tx, tx.payment_type or "qris")
        elif result_code == "01":
            finalize_failure(db, tx, "failed")
        else:
            # Callback code selain 00/01 tidak boleh dianggap sukses.
            tx.updated_at = utc_now()

        db.commit()
        return "SUCCESS"
    finally:
        db.close()


# =========================
# CUSTOMER SUPPORT
# =========================
@app.post("/api/support")
def create_support(payload: SupportRequest, request: Request):
    db = SessionLocal()
    try:
        client_id = request.cookies.get("support_client_id") or secrets.token_urlsafe(24)
        msg = SupportMessage(
            order_id=payload.order_id,
            contact=payload.contact,
            message=payload.message,
            status="open",
            client_id=client_id,
            created_at=utc_now(),
        )
        db.add(msg)
        db.commit()
        db.refresh(msg)
        result = JSONResponse({"id": msg.id, "status": msg.status, "message": "Pesan berhasil dikirim ke admin."})
        result.set_cookie("support_client_id", client_id, max_age=31536000, httponly=True, samesite="lax", secure=False)
        return result
    finally:
        db.close()


@app.get("/api/support")
def get_support(request: Request):
    client_id = request.cookies.get("support_client_id") or secrets.token_urlsafe(24)
    db = SessionLocal()
    try:
        rows = (db.query(SupportMessage).filter(SupportMessage.client_id == client_id).order_by(SupportMessage.created_at.desc()).limit(50).all())
        payload = []
        for r in rows:
            tx_info = None
            if r.order_id:
                tx = db.query(Transaction).filter(Transaction.order_id == r.order_id).first()
                if tx:
                    items = db.query(TransactionItem).filter(TransactionItem.transaction_id == tx.id).all()
                    tx_info = {
                        "order_id": tx.order_id,
                        "total": tx.total,
                        "payment_status": tx.payment_status,
                        "payment_type": tx.payment_type,
                        "created_at": tx.created_at.isoformat() if tx.created_at else None,
                        "items": [{
                            "product_name": i.product_name,
                            "quantity": i.quantity,
                            "unit_price": i.unit_price,
                            "subtotal": i.subtotal,
                        } for i in items],
                    }
            payload.append({
                "id": r.id, "order_id": r.order_id, "contact": r.contact, "message": r.message,
                "status": r.status, "admin_reply": r.admin_reply,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "replied_at": r.replied_at.isoformat() if r.replied_at else None,
                "transaction": tx_info,
            })
        response = JSONResponse(payload)
        response.set_cookie("support_client_id", client_id, max_age=31536000, httponly=True, samesite="lax", secure=False)
        return response
    finally:
        db.close()

# =========================
# ADMIN AUTH
# =========================
@app.post("/api/admin/login")
def admin_login(payload: AdminLoginRequest):
    if not hmac.compare_digest(payload.username, ADMIN_USERNAME) or not hmac.compare_digest(payload.password, ADMIN_PASSWORD):
        raise HTTPException(status_code=401, detail="Username atau password salah.")

    response = JSONResponse({"ok": True})

    response.set_cookie(
        "admin_token",
        make_admin_token(),
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=ADMIN_SESSION_MINUTES * 60
    )

    return response


@app.post("/api/admin/logout")
def admin_logout(request: Request):
    response = JSONResponse({"ok": True})
    response.delete_cookie("admin_token")
    return response


@app.get("/api/admin/me")
def admin_me(request: Request):
    return {"authenticated": is_admin(request)}


# =========================
# ADMIN DASHBOARD DATA
# =========================
@app.get("/api/admin/summary")
def admin_summary(request: Request):
    require_admin(request)
    db = SessionLocal()
    try:
        today = utc_now().date()
        products_count = db.query(Product).filter(Product.is_active.is_(True)).count()
        low_stock = db.query(Product).filter(Product.is_active.is_(True), (Product.stock - Product.reserved_stock) <= 5).count()
        pending = db.query(Transaction).filter(Transaction.payment_status == "pending").count()
        today_start = datetime.combine(today, datetime.min.time())
        success_today = db.query(Transaction).filter(Transaction.created_at >= today_start, Transaction.payment_status == "success").all()
        messages = db.query(SupportMessage).filter(SupportMessage.status == "open").count()
        return {"products": products_count, "low_stock": low_stock, "pending_payments": pending, "today_transactions": len(success_today), "today_revenue": sum(t.total for t in success_today), "open_messages": messages}
    finally:
        db.close()


@app.get("/api/admin/products")
def admin_products(request: Request, page: int = 1, page_size: int = 20):
    require_admin(request)
    page = max(1, page)
    page_size = min(50, max(1, page_size))
    db = SessionLocal()
    try:
        q = db.query(Product).order_by(Product.id.asc())
        total = q.count()
        rows = q.offset((page - 1) * page_size).limit(page_size).all()
        return {"items": [product_dict(p) for p in rows], "page": page, "page_size": page_size, "total": total, "has_next": page * page_size < total}
    finally:
        db.close()


@app.post("/api/admin/products")
def admin_add_product(payload: ProductRequest, request: Request):
    require_admin(request)
    db = SessionLocal()
    try:
        p = Product(name=payload.name.strip(), price=payload.price, discount_percent=payload.discount_percent, stock=payload.stock, reserved_stock=0, is_active=True, created_at=utc_now(), updated_at=utc_now())
        db.add(p)
        db.flush()
        if payload.stock:
            db.add(StockMovement(product_id=p.id, change_qty=payload.stock, reason="Stok awal produk"))
        db.commit()
        db.refresh(p)
        return product_dict(p)
    finally:
        db.close()


@app.put("/api/admin/products/{product_id}")
def admin_edit_product(product_id: int, payload: ProductEditRequest, request: Request):
    require_admin(request)
    db = SessionLocal()
    try:
        p = db.query(Product).filter(Product.id == product_id).first()
        if not p:
            raise HTTPException(status_code=404, detail="Produk tidak ditemukan.")
        p.name = payload.name.strip()
        p.price = payload.price
        p.discount_percent = payload.discount_percent
        p.is_active = payload.is_active
        if payload.stock is not None and payload.stock != p.stock:
            if payload.stock < p.reserved_stock:
                raise HTTPException(status_code=409, detail=f"Stok tidak bisa diatur ke {payload.stock} karena {p.reserved_stock} unit sedang dipesan.")
            delta = payload.stock - p.stock
            p.stock = payload.stock
            db.add(StockMovement(product_id=p.id, change_qty=delta, reason="Edit stok produk"))
        p.updated_at = utc_now()
        db.commit()
        db.refresh(p)
        return product_dict(p)
    finally:
        db.close()


@app.post("/api/admin/products/{product_id}/stock")
def admin_change_stock(product_id: int, payload: StockRequest, request: Request):
    require_admin(request)
    if payload.change_qty == 0:
        raise HTTPException(status_code=400, detail="Perubahan stok tidak boleh 0.")
    db = SessionLocal()
    try:
        p = db.query(Product).filter(Product.id == product_id).first()
        if not p:
            raise HTTPException(status_code=404, detail="Produk tidak ditemukan.")
        new_stock = p.stock + payload.change_qty
        if new_stock < p.reserved_stock:
            raise HTTPException(status_code=409, detail="Stok tidak bisa dikurangi di bawah stok yang sedang dipesan.")
        if new_stock < 0:
            raise HTTPException(status_code=409, detail="Stok tidak boleh negatif.")
        p.stock = new_stock
        p.updated_at = utc_now()
        db.add(StockMovement(product_id=p.id, change_qty=payload.change_qty, reason=payload.reason.strip()))
        db.commit()
        return product_dict(p)
    finally:
        db.close()


@app.delete("/api/admin/products/{product_id}")
def admin_delete_product(product_id: int, request: Request):
    require_admin(request)
    db = SessionLocal()
    try:
        p = db.query(Product).filter(Product.id == product_id).first()
        if not p:
            raise HTTPException(status_code=404, detail="Produk tidak ditemukan.")
        if p.reserved_stock > 0:
            raise HTTPException(status_code=409, detail="Produk masih punya stok yang sedang dipesan.")
        # product_id pada transaction_items dan stock_movements tidak memakai FK,
        # sehingga histori tetap aman walaupun baris produk benar-benar dihapus.
        db.delete(p)
        db.commit()
        return {"ok": True, "deleted": product_id}
    finally:
        db.close()


@app.get("/api/admin/transactions")
def admin_transactions(request: Request, status: str = "all", page: int = 1, page_size: int = 20):
    require_admin(request)
    page = max(1, page); page_size = min(50, max(1, page_size))
    db = SessionLocal()
    try:
        q = db.query(Transaction)
        if status != "all": q = q.filter(Transaction.payment_status == status)
        q = q.order_by(Transaction.created_at.desc())
        total = q.count(); rows = q.offset((page-1)*page_size).limit(page_size).all()
        return {"items": [serialize_tx(db, tx) for tx in rows], "page": page, "page_size": page_size, "total": total, "has_next": page*page_size < total}
    finally:
        db.close()

@app.post("/api/admin/transactions/{order_id}/verify")
def admin_verify_transaction(order_id: str, payload: ManualPaymentRequest, request: Request):
    require_admin(request)
    if payload.status not in ("success", "failed"):
        raise HTTPException(status_code=400, detail="Status manual hanya success atau failed.")
    db = SessionLocal()
    try:
        tx = db.query(Transaction).filter(Transaction.order_id == order_id).first()
        if not tx:
            raise HTTPException(status_code=404, detail="Transaksi tidak ditemukan.")
        if tx.payment_status != "pending":
            raise HTTPException(status_code=409, detail=f"Transaksi sudah {tx.payment_status}.")
        # Manual verification must always have a visible payment method.
        # This prevents the Metode column from remaining NULL after admin verification.
        tx.payment_type = "manual"
        if payload.status == "success":
            finalize_success(db, tx, "manual")
        else:
            finalize_failure(db, tx, "failed")
        db.commit()
        return serialize_tx(db, tx)
    finally:
        db.close()


@app.get("/api/admin/stock-movements")
def admin_stock_movements(request: Request, page: int = 1, page_size: int = 20):
    require_admin(request); page=max(1,page); page_size=min(50,max(1,page_size))
    db=SessionLocal()
    try:
        q=db.query(StockMovement).order_by(StockMovement.created_at.desc()); total=q.count(); rows=q.offset((page-1)*page_size).limit(page_size).all()
        return {"items":[{"id":r.id,"product_id":r.product_id,"change_qty":r.change_qty,"reason":r.reason,"created_at":r.created_at.isoformat() if r.created_at else None} for r in rows],"page":page,"page_size":page_size,"total":total,"has_next":page*page_size<total}
    finally: db.close()


@app.get("/api/admin/support")
def admin_support(request: Request, page: int = 1, page_size: int = 20):
    require_admin(request); page=max(1,page); page_size=min(50,max(1,page_size))
    db=SessionLocal()
    try:
        q=db.query(SupportMessage).order_by(SupportMessage.created_at.desc()); total=q.count(); rows=q.offset((page-1)*page_size).limit(page_size).all()
        return {"items":[{"id":r.id,"order_id":r.order_id,"contact":r.contact,"message":r.message,"status":r.status,"admin_reply":r.admin_reply,"created_at":r.created_at.isoformat() if r.created_at else None,"replied_at":r.replied_at.isoformat() if r.replied_at else None} for r in rows],"page":page,"page_size":page_size,"total":total,"has_next":page*page_size<total}
    finally: db.close()


@app.post("/api/admin/support/{message_id}/reply")
def admin_reply(message_id: int, payload: SupportReplyRequest, request: Request):
    require_admin(request)
    db = SessionLocal()
    try:
        row = db.query(SupportMessage).filter(SupportMessage.id == message_id).first()
        if not row:
            raise HTTPException(status_code=404, detail="Pesan tidak ditemukan.")
        row.admin_reply = payload.reply.strip()
        row.status = "answered"
        row.replied_at = utc_now()
        db.commit()
        return {"ok": True}
    finally:
        db.close()


@app.get("/api/admin/database")
def admin_database(request: Request, table: str = "products", page: int = 1, page_size: int = 20):
    require_admin(request); page=max(1,page); page_size=min(50,max(1,page_size))
    db=SessionLocal()
    try:
        if table == "products":
            q=db.query(Product).order_by(Product.id.asc()); total=q.count(); rows=[product_dict(x) for x in q.offset((page-1)*page_size).limit(page_size).all()]
        elif table == "transactions":
            q=db.query(Transaction).order_by(Transaction.created_at.desc()); total=q.count(); rows=[serialize_tx(db,x) for x in q.offset((page-1)*page_size).limit(page_size).all()]
        elif table == "stock_movements":
            q=db.query(StockMovement).order_by(StockMovement.created_at.desc()); total=q.count(); rows=[{"id":r.id,"product_id":r.product_id,"change_qty":r.change_qty,"reason":r.reason,"created_at":r.created_at.isoformat() if r.created_at else None} for r in q.offset((page-1)*page_size).limit(page_size).all()]
        elif table == "support_messages":
            q=db.query(SupportMessage).order_by(SupportMessage.created_at.desc()); total=q.count(); rows=[{"id":r.id,"client_id":r.client_id,"order_id":r.order_id,"contact":r.contact,"message":r.message,"status":r.status,"admin_reply":r.admin_reply,"created_at":r.created_at.isoformat() if r.created_at else None} for r in q.offset((page-1)*page_size).limit(page_size).all()]
        else:
            raise HTTPException(status_code=400, detail="Tabel tidak dikenal.")
        return {"table":table,"items":rows,"page":page,"page_size":page_size,"total":total,"has_next":page*page_size<total}
    finally: db.close()

ADMIN_HTML = r'''<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Admin - Smart Canteen</title>
<link rel="stylesheet" href="/static/style.css">
<style>
.ui-icon{width:16px;height:16px;display:inline-block;vertical-align:-3px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;margin-right:6px}
.admin-tabs{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0}.admin-tabs button{display:inline-flex;align-items:center}
.table-wrap{overflow-x:auto}.inline-actions{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.row-edit{display:grid;grid-template-columns:1.5fr 1fr 1fr auto;gap:7px;min-width:650px}.row-edit input{width:100%;box-sizing:border-box}
.icon-disabled{display:inline-flex;align-items:center;gap:5px}.icon-disabled svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
button:disabled{cursor:not-allowed;opacity:.55}.pager-actions{display:flex;gap:7px}.pager-actions button{display:inline-flex;align-items:center;gap:5px}.pager-actions svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.db-switch{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:15px}.db-switch button{display:inline-flex;align-items:center}.db-block.hidden{display:none}.stock-inline{display:flex;flex-wrap:wrap;gap:5px;margin-top:5px}.stock-inline input{max-width:130px}
</style>
</head>
<body class="admin-body">
<main class="admin-container">
<div id="loginPanel" class="admin-card"><p class="eyebrow">SMART CANTEEN</p><h1>Admin Dashboard</h1><p>Login untuk mengelola produk, pembayaran, database, dan pesan user.</p><form id="loginForm" class="admin-form"><input id="username" placeholder="Username" autocomplete="username" required><input id="password" type="password" placeholder="Password" autocomplete="current-password" required><button>Login Admin</button><p id="loginError" class="error"></p></form></div>
<section id="dashboard" class="hidden">
<div class="admin-topbar"><div><p class="eyebrow">SMART CANTEEN</p><h1>Dashboard Admin</h1></div><div class="admin-actions"><a class="button-link" href="/">← Kantin</a><button id="logoutBtn">Logout</button></div></div>
<div id="summary" class="summary-grid"></div>
<div class="admin-tabs">
<button data-tab="productsTab"><svg class="ui-icon" viewBox="0 0 24 24"><path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>Produk</button>
<button data-tab="transactionsTab"><svg class="ui-icon" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/></svg>Pembayaran</button>
<button data-tab="supportTab"><svg class="ui-icon" viewBox="0 0 24 24"><path d="M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4 20l1.8-4.2A7.5 7.5 0 1 1 20 11.5Z"/><path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01"/></svg>Pesan User</button>
<button data-tab="databaseTab"><svg class="ui-icon" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/></svg>Database</button>
</div>
<section id="productsTab" class="admin-card tab-panel"><div class="section-head"><div><h2>Produk</h2><p>Tambah produk, edit langsung pada baris, dan kelola stok tanpa tab terpisah.</p></div></div><form id="productForm" class="product-form"><input id="pName" placeholder="Nama produk" required><input id="pPrice" type="number" min="1" placeholder="Harga" required><input id="pDiscount" type="number" min="0" max="100" step="0.01" placeholder="Diskon %" value="0" required><input id="pStock" type="number" min="0" placeholder="Stok awal" value="0" required><button type="submit">Tambah Produk</button></form><div id="productsTable" class="table-wrap"></div><div id="productsPager"></div></section>
<section id="transactionsTab" class="admin-card tab-panel hidden"><div class="section-head"><div><h2>Verifikasi Pembayaran</h2><p>Transaksi pending bisa diverifikasi manual sebagai berhasil atau ditolak.</p></div><select id="txFilter"><option value="all">Semua</option><option value="pending">Pending</option><option value="success">Success</option><option value="failed">Failed</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option></select></div><div id="transactionsTable" class="table-wrap"></div><div id="transactionsPager"></div></section>
<section id="supportTab" class="admin-card tab-panel hidden"><div class="section-head"><div><h2>Pesan User</h2><p>Pesan terhubung ke browser/device pengirim melalui cookie anonim.</p></div></div><div id="supportTable" class="table-wrap"></div><div id="supportPager"></div></section>
<section id="databaseTab" class="admin-card tab-panel hidden"><div class="section-head"><div><h2>Data Aplikasi</h2><p>Read-only. Hanya tabel yang dipilih yang dimuat, 20 data per halaman.</p></div></div><div class="db-switch"><button data-db="products"><svg class="ui-icon" viewBox="0 0 24 24"><path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/></svg>Produk</button><button data-db="transactions"><svg class="ui-icon" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/></svg>Pembayaran</button><button data-db="stock_movements"><svg class="ui-icon" viewBox="0 0 24 24"><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/></svg>Riwayat Stok</button><button data-db="support_messages"><svg class="ui-icon" viewBox="0 0 24 24"><path d="M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4 20l1.8-4.2A7.5 7.5 0 1 1 20 11.5Z"/></svg>Pesan</button></div><div id="db-products" class="database-block db-block"></div><div id="db-transactions" class="database-block db-block hidden"></div><div id="db-stock_movements" class="database-block db-block hidden"></div><div id="db-support_messages" class="database-block db-block hidden"></div></section>
</section></main>
<script>
const ADMIN_PANEL_PATH='/management-7xK92';
const rupiah=n=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(n||0);
const esc=s=>String(s??'').replace(/[&<>\'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]));
const blockedIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="m9 9 6 6M15 9l-6 6"/></svg>';
const api=async(url,opt={})=>{const r=await fetch(url,opt);let d={};try{d=await r.json()}catch{}if(r.status===401){showLogin();throw new Error('')}if(!r.ok)throw new Error(d.detail||'Request gagal');return d};
const loginPanel=document.querySelector('#loginPanel'),dashboard=document.querySelector('#dashboard');function showLogin(){loginPanel.classList.remove('hidden');dashboard.classList.add('hidden')}function showDashboard(){loginPanel.classList.add('hidden');dashboard.classList.remove('hidden');loadAll()}
async function checkAuth(){try{const d=await api('/api/admin/me');d.authenticated?showDashboard():showLogin()}catch{showLogin()}}
document.querySelector('#loginForm').addEventListener('submit',async e=>{e.preventDefault();const er=document.querySelector('#loginError');er.textContent='';try{await api('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:document.querySelector('#username').value,password:document.querySelector('#password').value})});window.location.href=ADMIN_PANEL_PATH}catch(x){er.textContent=x.message}});document.querySelector('#logoutBtn').onclick=async()=>{await api('/api/admin/logout',{method:'POST'});showLogin()};
const PAGE_SIZE=20;const pageState={products:1,transactions:1,support:1,database:{products:1,transactions:1,stock_movements:1,support_messages:1}};
function pager(id,state,total,hasNext,loader){const el=document.querySelector('#'+id);if(!el)return;const prev=state<=1?`<button disabled title="Sudah di halaman pertama"><span class="icon-disabled">${blockedIcon}Sebelumnya</span></button>`:`<button onclick="${loader}(${state-1})">‹ Sebelumnya</button>`;const next=!hasNext?`<button disabled title="Tidak ada halaman berikutnya"><span class="icon-disabled">Berikutnya ${blockedIcon}</span></button>`:`<button onclick="${loader}(${state+1})">Berikutnya ›</button>`;el.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:14px"><small>Halaman ${state} · ${total} data · ${PAGE_SIZE} per halaman</small><div class="pager-actions">${prev}${next}</div></div>`}
let editingProductId=null,stockProductId=null;
function productRow(p){if(editingProductId===p.id)return `<tr><td colspan="6"><div class="row-edit"><input id="editName-${p.id}" value="${esc(p.name)}" placeholder="Nama"><input id="editPrice-${p.id}" type="number" min="1" value="${p.price}" placeholder="Harga"><input id="editDiscount-${p.id}" type="number" min="0" max="100" step="0.01" value="${p.discount_percent}" placeholder="Diskon %"><input id="editStock-${p.id}" type="number" min="0" step="1" value="${p.stock}" placeholder="Stok"><div class="inline-actions"><button onclick="saveProductEdit(${p.id})">Simpan</button><button onclick="cancelProductEdit()">Batal</button></div></div><small>Stok boleh diubah langsung, termasuk menjadi 0. Kalau ada unit yang sedang dipesan, stok tidak bisa diatur di bawah jumlah tersebut.</small></td></tr>`;if(stockProductId===p.id)return `<tr><td><b>${esc(p.name)}</b><br><small>ID ${p.id} · ${p.is_active?'Aktif':'Nonaktif'}</small></td><td>${rupiah(p.price)}</td><td>${p.discount_percent}%</td><td>${rupiah(p.effective_price)}</td><td><b>${p.available_stock}</b> <small>(fisik ${p.stock}, dipesan ${p.reserved_stock})</small><div class="stock-inline"><input id="stockChange-${p.id}" type="number" step="1" value="0" ${!p.is_active?'disabled':''}><input id="stockReason-${p.id}" placeholder="Alasan" value="Restock manual" ${!p.is_active?'disabled':''}></div></td><td><div class="inline-actions"><button ${!p.is_active?'disabled':''} onclick="saveStock(${p.id})">Simpan</button><button onclick="cancelStockEdit()">Batal</button></div></td></tr>`;return `<tr><td><b>${esc(p.name)}</b><br><small>ID ${p.id} · ${p.is_active?'Aktif':'Nonaktif'}${p.stock===0?' · Habis':''}</small></td><td>${rupiah(p.price)}</td><td>${p.discount_percent}%</td><td>${rupiah(p.effective_price)}</td><td>${p.available_stock} <small>(fisik ${p.stock}, dipesan ${p.reserved_stock})</small></td><td><div class="inline-actions"><button onclick="startProductEdit(${p.id})">Edit</button><button onclick="startStockEdit(${p.id})">± Stok</button><button class="danger" onclick="deleteProduct(${p.id},${JSON.stringify(p.name)})">Hapus</button></div></td></tr>`}
async async function loadProducts(page=pageState.products){pageState.products=Math.max(1,page);const d=await api('/api/admin/products?page='+pageState.products+'&page_size='+PAGE_SIZE);const rows=d.items||[];if(!rows.length&&pageState.products>1&&d.total>0){return loadProducts(pageState.products-1)}document.querySelector('#productsTable').innerHTML=rows.length?`<table><thead><tr><th>Produk</th><th>Harga</th><th>Diskon</th><th>Harga Jual</th><th>Stok</th><th>Aksi</th></tr></thead><tbody>${rows.map(productRow).join('')}</tbody></table>`:'<p>Belum ada produk.</p>';pager('productsPager',d.page,d.total,d.has_next,'loadProducts')}
function startProductEdit(id){editingProductId=id;stockProductId=null;loadProducts(pageState.products)}function cancelProductEdit(){editingProductId=null;loadProducts(pageState.products)}
async function saveProductEdit(id){const name=document.querySelector('#editName-'+id)?.value.trim();const price=Number(document.querySelector('#editPrice-'+id)?.value);const discount=Number(document.querySelector('#editDiscount-'+id)?.value);const stock=Number(document.querySelector('#editStock-'+id)?.value);if(!name||!Number.isInteger(price)||price<=0||!Number.isFinite(discount)||discount<0||discount>100||!Number.isInteger(stock)||stock<0)return alert('Data produk belum valid.');try{await api('/api/admin/products/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,price,discount_percent:discount,stock,is_active:true})});editingProductId=null;await loadProducts(pageState.products);await loadSummary()}catch(e){alert(e.message)}}
function startStockEdit(id){stockProductId=id;editingProductId=null;loadProducts(pageState.products)}function cancelStockEdit(){stockProductId=null;loadProducts(pageState.products)}
async function saveStock(id){const change=Number(document.querySelector('#stockChange-'+id)?.value);const reason=document.querySelector('#stockReason-'+id)?.value.trim();if(!Number.isInteger(change)||change===0)return alert('Perubahan stok harus bilangan bulat selain 0.');if(!reason)return alert('Alasan perubahan stok wajib diisi.');try{await api('/api/admin/products/'+id+'/stock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({change_qty:change,reason})});stockProductId=null;await loadProducts(pageState.products);await loadSummary()}catch(e){alert(e.message)}}
async function deleteProduct(id,name){if(!confirm(`Hapus permanen ${name}? Data produk akan benar-benar dihapus. Histori transaksi tetap menyimpan nama produk saat transaksi.`))return;try{await api('/api/admin/products/'+id,{method:'DELETE'});await loadProducts(pageState.products);await loadSummary()}catch(e){alert(e.message)}}
document.querySelector('#productForm').addEventListener('submit',async e=>{e.preventDefault();const btn=e.target.querySelector('button');const payload={name:document.querySelector('#pName').value.trim(),price:Number(document.querySelector('#pPrice').value),discount_percent:Number(document.querySelector('#pDiscount').value),stock:Number(document.querySelector('#pStock').value)};if(!payload.name||!Number.isInteger(payload.price)||payload.price<=0||!Number.isFinite(payload.discount_percent)||payload.discount_percent<0||payload.discount_percent>100||!Number.isInteger(payload.stock)||payload.stock<0)return alert('Data produk belum valid.');btn.disabled=true;try{await api('/api/admin/products',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});e.target.reset();document.querySelector('#pDiscount').value=0;document.querySelector('#pStock').value=0;pageState.products=1;await loadProducts(1);await loadSummary()}catch(x){alert(x.message)}finally{btn.disabled=false}});
async function loadTransactions(page=pageState.transactions){pageState.transactions=Math.max(1,page);const st=document.querySelector('#txFilter').value;const d=await api('/api/admin/transactions?status='+encodeURIComponent(st)+'&page='+pageState.transactions+'&page_size='+PAGE_SIZE);const rows=d.items||[];document.querySelector('#transactionsTable').innerHTML=rows.length?`<table><thead><tr><th>Order</th><th>Items</th><th>Total</th><th>Status</th><th>Waktu</th><th>Aksi</th></tr></thead><tbody>${rows.map(t=>`<tr><td><code>${esc(t.order_id)}</code></td><td>${t.items.map(i=>`${esc(i.product_name)} × ${i.quantity}`).join('<br>')}</td><td>${rupiah(t.total)}</td><td><span class="status-${t.payment_status}">${esc(t.payment_status)}</span></td><td>${new Date(t.created_at).toLocaleString('id-ID')}</td><td>${t.payment_status==='pending'?`<button onclick="verifyTx('${t.order_id}','success')">Bayar</button> <button class="danger" onclick="verifyTx('${t.order_id}','failed')">Tolak</button>`:'—'}</td></tr>`).join('')}</tbody></table>`:'<p>Belum ada transaksi.</p>';pager('transactionsPager',d.page,d.total,d.has_next,'loadTransactions')}
async function verifyTx(id,status){if(!confirm(status==='success'?'Tandai pembayaran sebagai BERHASIL?':'Tolak pembayaran ini?'))return;try{await api('/api/admin/transactions/'+encodeURIComponent(id)+'/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})});await loadTransactions(pageState.transactions);await loadProducts(pageState.products);await loadSummary()}catch(e){alert(e.message)}}document.querySelector('#txFilter').onchange=()=>loadTransactions(1);
async function loadSupport(page=pageState.support){pageState.support=Math.max(1,page);const d=await api('/api/admin/support?page='+pageState.support+'&page_size='+PAGE_SIZE);const rows=d.items||[];document.querySelector('#supportTable').innerHTML=rows.length?`<table><thead><tr><th>Waktu</th><th>Kontak</th><th>Order</th><th>Pesan</th><th>Status</th><th>Balasan</th><th>Aksi</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${new Date(r.created_at).toLocaleString('id-ID')}</td><td>${esc(r.contact||'—')}</td><td>${esc(r.order_id||'—')}</td><td>${esc(r.message)}</td><td>${esc(r.status)}</td><td>${esc(r.admin_reply||'—')}</td><td>${r.status==='open'?`<button onclick="replySupport(${r.id})">Balas</button>`:'—'}</td></tr>`).join('')}</tbody></table>`:'<p>Belum ada pesan.</p>';pager('supportPager',d.page,d.total,d.has_next,'loadSupport')}
async function replySupport(id){const reply=prompt('Balasan admin:');if(!reply)return;try{await api('/api/admin/support/'+id+'/reply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reply})});await loadSupport(pageState.support);await loadSummary()}catch(e){alert(e.message)}}
const dbConfigs={products:{title:'Products',cols:[['ID','id'],['Nama','name'],['Harga',r=>rupiah(r.price)],['Diskon',r=>esc(r.discount_percent)+'%'],['Harga Jual',r=>rupiah(r.effective_price)],['Stok Tersedia','available_stock'],['Stok Fisik','stock'],['Dipesan','reserved_stock'],['Status',r=>r.is_active?'Aktif':'Nonaktif']]},transactions:{title:'Transactions',cols:[['Order','order_id'],['Total',r=>rupiah(r.total)],['Status','payment_status'],['Metode','payment_type'],['Dibuat',r=>r.created_at?new Date(r.created_at).toLocaleString('id-ID'):'-'],['Kedaluwarsa',r=>r.expires_at?new Date(r.expires_at).toLocaleString('id-ID'):'-']]},stock_movements:{title:'Stock Movements',cols:[['ID','id'],['Produk ID','product_id'],['Perubahan',r=>(r.change_qty>0?'+':'')+r.change_qty],['Alasan','reason'],['Waktu',r=>r.created_at?new Date(r.created_at).toLocaleString('id-ID'):'-']]},support_messages:{title:'Support Messages',cols:[['ID','id'],['Client ID','client_id'],['Order','order_id'],['Kontak','contact'],['Pesan','message'],['Status','status'],['Balasan Admin','admin_reply'],['Waktu',r=>r.created_at?new Date(r.created_at).toLocaleString('id-ID'):'-']]}};
async function loadDatabaseTable(table,page=pageState.database[table]){pageState.database[table]=Math.max(1,page);document.querySelectorAll('.db-block').forEach(x=>x.classList.add('hidden'));const box=document.querySelector('#db-'+table);box.classList.remove('hidden');const d=await api('/api/admin/database?table='+encodeURIComponent(table)+'&page='+pageState.database[table]+'&page_size='+PAGE_SIZE);const c=dbConfigs[table];box.innerHTML=`<h3>${c.title} <small>(${d.total})</small></h3>${d.items.length?`<div class="table-wrap"><table><thead><tr>${c.cols.map(x=>`<th>${x[0]}</th>`).join('')}</tr></thead><tbody>${d.items.map(r=>`<tr>${c.cols.map(x=>`<td>${typeof x[1]==='function'?x[1](r):esc(r[x[1]])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<p>Belum ada data.</p>'}<div id="dbPager-${table}"></div>`;pager('dbPager-'+table,d.page,d.total,d.has_next,'loadDb_'+table)}
function loadDb_products(page){return loadDatabaseTable('products',page)}function loadDb_transactions(page){return loadDatabaseTable('transactions',page)}function loadDb_stock_movements(page){return loadDatabaseTable('stock_movements',page)}function loadDb_support_messages(page){return loadDatabaseTable('support_messages',page)}
document.querySelectorAll('[data-db]').forEach(b=>b.onclick=()=>loadDatabaseTable(b.dataset.db,pageState.database[b.dataset.db]||1));
async function openTab(tab){document.querySelectorAll('.tab-panel').forEach(x=>x.classList.add('hidden'));document.querySelector('#'+tab).classList.remove('hidden');if(tab==='productsTab')await loadProducts(pageState.products);else if(tab==='transactionsTab')await loadTransactions(pageState.transactions);else if(tab==='supportTab')await loadSupport(pageState.support);else if(tab==='databaseTab')await loadDatabaseTable('products',pageState.database.products)}document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>openTab(b.dataset.tab));
async function loadSummary(){const d=await api('/api/admin/summary');document.querySelector('#summary').innerHTML=`<div class="summary-card"><strong>${d.products}</strong><span>Produk Aktif</span></div><div class="summary-card"><strong>${d.low_stock}</strong><span>Stok Menipis</span></div><div class="summary-card"><strong>${d.pending_payments}</strong><span>Pembayaran Pending</span></div><div class="summary-card"><strong>${d.today_transactions}</strong><span>Transaksi Hari Ini</span></div><div class="summary-card"><strong>${rupiah(d.today_revenue)}</strong><span>Pendapatan Hari Ini</span></div><div class="summary-card"><strong>${d.open_messages}</strong><span>Pesan Belum Dibalas</span></div>`}async function loadAll(){try{await loadSummary();await openTab('productsTab')}catch(e){console.error(e)}}checkAuth();
</script></body></html>'''

