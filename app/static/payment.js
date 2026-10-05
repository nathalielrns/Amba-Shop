const params = new URLSearchParams(window.location.search);
const orderId = params.get("order_id");
const ACTIVE_ORDER_KEY = "smart_canteen_active_order";
const TRANSACTION_HISTORY_KEY = "smart_canteen_transaction_history";

const orderIdEl = document.querySelector("#orderId");
const totalEl = document.querySelector("#paymentTotal");
const countdownEl = document.querySelector("#countdown");
const qrEl = document.querySelector("#qr");
const qrMessageEl = document.querySelector("#qrMessage");
const statusEl = document.querySelector("#status");
const expiredBox = document.querySelector("#expiredBox");
const successBox = document.querySelector("#successBox");
const cancelBtn = document.querySelector("#cancelBtn");

let pollingTimer = null;
let countdownTimer = null;
let expiresAt = null;
let finished = false;
let latestTransaction = null;

const STATUS_ICONS = {
  pending: `
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="21" class="status-ring pending-ring"/>
      <path d="M24 13v11l7 5" class="status-stroke"/>
      <circle cx="24" cy="24" r="2" class="status-dot"/>
    </svg>`,
  success: `
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="21" class="status-ring success-ring"/>
      <path d="m14 24 6.5 6.5L34 17" class="status-check"/>
    </svg>`,
  failed: `
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="21" class="status-ring failed-ring"/>
      <path d="m17 17 14 14M31 17 17 31" class="status-cross"/>
    </svg>`,
  expired: `
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="21" class="status-ring expired-ring"/>
      <path d="M17 15h14M17 33h14M18 15c0 5 4 7 6 9-2 2-6 4-6 9M30 15c0 5-4 7-6 9 2 2 6 4 6 9" class="status-stroke"/>
    </svg>`,
  cancelled: `
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="21" class="status-ring cancelled-ring"/>
      <path d="m17 17 14 14M31 17 17 31" class="status-stroke"/>
    </svg>`
};

function rupiah(n) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(n || 0);
}

function setStatus(type, title, message = "") {
  statusEl.className = `payment-status status-${type}`;
  statusEl.innerHTML = `
    <div class="status-icon">${STATUS_ICONS[type] || STATUS_ICONS.failed}</div>
    <div class="status-copy">
      <strong>${title}</strong>
      ${message ? `<span>${message}</span>` : ""}
    </div>`;
}

if (!orderId) {
  window.location.href = "/";
}

const storedOrder = localStorage.getItem(ACTIVE_ORDER_KEY);
if (storedOrder && storedOrder !== orderId) {
  window.location.href = `/payment.html?order_id=${encodeURIComponent(storedOrder)}`;
}

function injectPaymentDialog(){if(document.querySelector("#paymentDialog"))return;const style=document.createElement("style");style.textContent=`.payment-dialog[hidden]{display:none}.payment-dialog{position:fixed;inset:0;z-index:3000;display:grid;place-items:center;padding:18px}.payment-dialog-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.38);backdrop-filter:blur(2px)}.payment-dialog-card{position:relative;width:min(420px,100%);background:#fff;border:1px solid #e2e4e8;border-radius:18px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.22)}.payment-dialog-card h3{margin:0 0 8px}.payment-dialog-card p{margin:0;white-space:pre-line;line-height:1.5;color:#4b5563}.payment-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.payment-dialog-actions button{min-width:84px}.payment-dialog-secondary{background:#f1f2f4!important;color:#20242b!important}`;document.head.appendChild(style);document.body.insertAdjacentHTML("beforeend",`<div id="paymentDialog" class="payment-dialog" hidden><div class="payment-dialog-backdrop"></div><section class="payment-dialog-card" role="dialog" aria-modal="true"><h3 id="paymentDialogTitle">Konfirmasi</h3><p id="paymentDialogMessage"></p><div class="payment-dialog-actions"><button id="paymentDialogCancel" class="payment-dialog-secondary" type="button">Batal</button><button id="paymentDialogOk" type="button">Ya</button></div></section></div>`);document.querySelector("#paymentDialogOk").addEventListener("click",()=>closePaymentDialog(true));document.querySelector("#paymentDialogCancel").addEventListener("click",()=>closePaymentDialog(false));document.querySelector(".payment-dialog-backdrop").addEventListener("click",()=>closePaymentDialog(false));}
let paymentDialogResolve=null;function closePaymentDialog(result){const el=document.querySelector("#paymentDialog");if(!el||el.hidden)return;el.hidden=true;if(paymentDialogResolve){const r=paymentDialogResolve;paymentDialogResolve=null;r(result);}}function uiConfirm(message,title="Konfirmasi"){injectPaymentDialog();return new Promise(resolve=>{paymentDialogResolve=resolve;document.querySelector("#paymentDialogTitle").textContent=title;document.querySelector("#paymentDialogMessage").textContent=message;document.querySelector("#paymentDialogCancel").hidden=false;document.querySelector("#paymentDialogOk").textContent="Ya";document.querySelector("#paymentDialog").hidden=false;});}function uiAlert(message,title="Smart Canteen"){injectPaymentDialog();return new Promise(resolve=>{paymentDialogResolve=()=>resolve();document.querySelector("#paymentDialogTitle").textContent=title;document.querySelector("#paymentDialogMessage").textContent=message;document.querySelector("#paymentDialogCancel").hidden=true;document.querySelector("#paymentDialogOk").textContent="OK";document.querySelector("#paymentDialog").hidden=false;});}function savePaymentHistory(data){if(!data?.order_id)return;try{const rows=JSON.parse(localStorage.getItem(TRANSACTION_HISTORY_KEY)||"[]");const next=Array.isArray(rows)?rows.filter(x=>x.order_id!==data.order_id):[];next.unshift({order_id:data.order_id,total:data.total,payment_status:data.payment_status,payment_type:data.payment_type||null,created_at:data.created_at||new Date().toISOString(),updated_at:data.updated_at||new Date().toISOString(),items:Array.isArray(data.items)?data.items:[]});localStorage.setItem(TRANSACTION_HISTORY_KEY,JSON.stringify(next.slice(0,30)));}catch(e){console.error("Gagal menyimpan riwayat transaksi:",e);}}

async function loadTransaction() {
  const response = await fetch(`/api/transactions/${encodeURIComponent(orderId)}`);
  if (!response.ok) throw new Error("Transaksi tidak ditemukan.");

  const data = await response.json();
  latestTransaction = data;
  savePaymentHistory(data);
  orderIdEl.textContent = data.order_id;
  totalEl.textContent = rupiah(data.total);

  if (data.expires_at) expiresAt = new Date(data.expires_at);

  if (data.qr_url) {
    qrEl.src = data.qr_url;
    qrEl.classList.remove("hidden");
    qrMessageEl.textContent = "Scan QRIS untuk melakukan pembayaran.";
  } else {
    qrMessageEl.textContent = "Mode lokal: QRIS belum dikonfigurasi.";
  }

  return data;
}

function startCountdown() {
  if (!expiresAt) return;

  function updateCountdown() {
    const remaining = expiresAt.getTime() - Date.now();

    if (remaining <= 0) {
      countdownEl.textContent = "00:00";
      clearInterval(countdownTimer);
      checkStatusNow();
      return;
    }

    const totalSeconds = Math.floor(remaining / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    countdownEl.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  updateCountdown();
  countdownTimer = setInterval(updateCountdown, 1000);
}

async function checkStatusNow() {
  if (finished) return;

  try {
    const response = await fetch(`/api/transactions/${encodeURIComponent(orderId)}`);
    if (!response.ok) return;

    const data = await response.json();

    if (data.payment_status === "success") {
      paymentSuccess();
      return;
    }

    if (["expired", "failed", "cancelled"].includes(data.payment_status)) {
      paymentFinished(data.payment_status);
    }
  } catch (error) {
    console.error("Status check error:", error);
  }
}

function startPolling() {
  pollingTimer = setInterval(checkStatusNow, 1000);
}

function paymentSuccess() {
  if (finished) return;
  finished = true;

  clearInterval(pollingTimer);
  clearInterval(countdownTimer);
  localStorage.removeItem(ACTIVE_ORDER_KEY);
  if(latestTransaction){latestTransaction.payment_status="success";latestTransaction.updated_at=new Date().toISOString();savePaymentHistory(latestTransaction);}

  setStatus("success", "Pembayaran berhasil", "Transaksi sudah tercatat di sistem.");
  qrEl.classList.add("hidden");

  if (cancelBtn) cancelBtn.disabled = true;
  successBox.classList.remove("hidden");

  setTimeout(() => {
    window.location.href = "/";
  }, 1200);
}

function paymentFinished(status) {
  if (finished) return;
  finished = true;

  clearInterval(pollingTimer);
  clearInterval(countdownTimer);
  localStorage.removeItem(ACTIVE_ORDER_KEY);
  if(latestTransaction){latestTransaction.payment_status=status;latestTransaction.updated_at=new Date().toISOString();savePaymentHistory(latestTransaction);}
  qrEl.classList.add("hidden");

  if (status === "expired") {
    countdownEl.textContent = "00:00";
    setStatus("expired", "Pembayaran kedaluwarsa", "Waktu pembayaran sudah habis.");
  } else if (status === "cancelled") {
    setStatus("cancelled", "Pembayaran dibatalkan", "Transaksi ini tidak akan diproses.");
  } else {
    setStatus("failed", "Pembayaran gagal", "Transaksi belum berhasil diproses.");
  }

  qrMessageEl.textContent = "QRIS sudah tidak dapat digunakan.";

  if (cancelBtn) cancelBtn.disabled = true;
  expiredBox.classList.remove("hidden");
}

async function cancelPayment() {
  if (finished) return;

  if (!(await uiConfirm("Batalkan pembayaran ini?\n\nTransaksi yang dibatalkan tidak dapat digunakan lagi.","Batalkan pembayaran?"))) return;

  if (cancelBtn) {
    cancelBtn.disabled = true;
    cancelBtn.textContent = "Membatalkan...";
  }

  try {
    const response = await fetch(`/api/transactions/${encodeURIComponent(orderId)}/cancel`, {
      method: "POST"
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Gagal membatalkan transaksi.");

    localStorage.removeItem(ACTIVE_ORDER_KEY);
    if(latestTransaction){latestTransaction.payment_status="cancelled";latestTransaction.updated_at=new Date().toISOString();savePaymentHistory(latestTransaction);}
    window.location.href = "/";
  } catch (error) {
    await uiAlert(error.message,"Pembatalan gagal");

    if (cancelBtn) {
      cancelBtn.disabled = false;
      cancelBtn.textContent = "Batal Pembayaran";
    }
  }
}

async function startPaymentPage() {
  const currentOrder = localStorage.getItem(ACTIVE_ORDER_KEY);

  if (currentOrder !== orderId) {
    window.location.href = currentOrder
      ? `/payment.html?order_id=${encodeURIComponent(currentOrder)}`
      : "/";
    return;
  }

  try {
    const data = await loadTransaction();

    if (data.payment_status === "success") {
      paymentSuccess();
      return;
    }

    if (["expired", "failed", "cancelled"].includes(data.payment_status)) {
      paymentFinished(data.payment_status);
      return;
    }

    setStatus("pending", "Menunggu pembayaran", "Selesaikan pembayaran sebelum waktu habis.");
    startCountdown();
    startPolling();
  } catch (error) {
    setStatus("failed", "Transaksi tidak dapat dimuat", error.message);
  }
}

injectPaymentDialog();
if (cancelBtn) cancelBtn.addEventListener("click", cancelPayment);

startPaymentPage();
