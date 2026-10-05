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
const waitingStatus = document.querySelector("#waitingStatus");
const expiredBox = document.querySelector("#expiredBox");
const successBox = document.querySelector("#successBox");
const cancelBtn = document.querySelector("#cancelBtn");
const qrArea = document.querySelector("#qrArea");
const successOrderId = document.querySelector("#successOrderId");
const successTotal = document.querySelector("#successTotal");
const failedOrderId = document.querySelector("#failedOrderId");
const failedTotal = document.querySelector("#failedTotal");
const failedTitle = document.querySelector("#failedTitle");
const failedDescription = document.querySelector("#failedDescription");
const failedLabel = document.querySelector("#failedLabel");

let pollingTimer = null;
let countdownTimer = null;
let expiresAt = null;
let finished = false;
let latestTransaction = null;
let preparePromise = null;
let dialogResolve = null;

function rupiah(n) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(n || 0);
}

function injectPaymentDialog() {
  const el = document.querySelector("#paymentDialog");
  if (!el) return;
  const ok = document.querySelector("#paymentDialogOk");
  const cancel = document.querySelector("#paymentDialogCancel");
  const backdrop = document.querySelector(".payment-dialog-backdrop");
  ok.onclick = () => closePaymentDialog(true);
  cancel.onclick = () => closePaymentDialog(false);
  backdrop.onclick = () => closePaymentDialog(false);
}

function closePaymentDialog(value) {
  const el = document.querySelector("#paymentDialog");
  if (!el || el.hidden) return;
  el.hidden = true;
  if (dialogResolve) {
    const resolve = dialogResolve;
    dialogResolve = null;
    resolve(value);
  }
}

function uiConfirm(message, title = "Konfirmasi") {
  injectPaymentDialog();
  return new Promise(resolve => {
    dialogResolve = value => resolve(Boolean(value));
    document.querySelector("#paymentDialogTitle").textContent = title;
    document.querySelector("#paymentDialogMessage").textContent = message;
    document.querySelector("#paymentDialogCancel").hidden = false;
    document.querySelector("#paymentDialogOk").textContent = "Ya";
    document.querySelector("#paymentDialog").hidden = false;
  });
}

function uiAlert(message, title = "Smart Canteen") {
  injectPaymentDialog();
  return new Promise(resolve => {
    dialogResolve = () => resolve();
    document.querySelector("#paymentDialogTitle").textContent = title;
    document.querySelector("#paymentDialogMessage").textContent = message;
    document.querySelector("#paymentDialogCancel").hidden = true;
    document.querySelector("#paymentDialogOk").textContent = "OK";
    document.querySelector("#paymentDialog").hidden = false;
  });
}

function savePaymentHistory(data) {
  if (!data?.order_id) return;
  try {
    const rows = JSON.parse(localStorage.getItem(TRANSACTION_HISTORY_KEY) || "[]");
    const old = Array.isArray(rows) ? rows.find(x => x.order_id === data.order_id) : null;
    const next = (Array.isArray(rows) ? rows : []).filter(x => x.order_id !== data.order_id);
    next.unshift({
      order_id: data.order_id,
      total: data.total,
      payment_status: data.payment_status,
      payment_type: data.payment_type || null,
      created_at: data.created_at || old?.created_at || new Date().toISOString(),
      updated_at: data.updated_at || new Date().toISOString(),
      items: Array.isArray(data.items) ? data.items : (old?.items || [])
    });
    localStorage.setItem(TRANSACTION_HISTORY_KEY, JSON.stringify(next.slice(0, 30)));
  } catch (error) {
    console.error("Gagal menyimpan riwayat transaksi:", error);
  }
}

function showQr(data) {
  if (data.qr_url) {
    qrEl.src = data.qr_url;
    qrEl.classList.remove("hidden");
    qrMessageEl.textContent = "Scan QRIS untuk melakukan pembayaran.";
    return true;
  }
  qrMessageEl.textContent = "Menyiapkan QRIS...";
  return false;
}

async function loadTransaction() {
  const response = await fetch(`/api/transactions/${encodeURIComponent(orderId)}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Transaksi tidak ditemukan.");

  const data = await response.json();
  latestTransaction = data;
  savePaymentHistory(data);
  orderIdEl.textContent = data.order_id;
  totalEl.textContent = rupiah(data.total);
  if (successOrderId) successOrderId.textContent = data.order_id;
  if (successTotal) successTotal.textContent = rupiah(data.total);
  if (failedOrderId) failedOrderId.textContent = data.order_id;
  if (failedTotal) failedTotal.textContent = rupiah(data.total);
  if (data.expires_at) expiresAt = new Date(data.expires_at);
  showQr(data);
  return data;
}

async function preparePayment() {
  if (preparePromise) return preparePromise;
  preparePromise = fetch(`/api/transactions/${encodeURIComponent(orderId)}/prepare-payment`, {
    method: "POST",
    cache: "no-store"
  })
    .then(async response => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || "QRIS gagal disiapkan.");
      latestTransaction = data;
      savePaymentHistory(data);
      showQr(data);
      return data;
    })
    .catch(error => {
      console.error("QRIS preparation error:", error);
      qrMessageEl.textContent = "QRIS sedang disiapkan...";
      return null;
    });
  return preparePromise;
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
    countdownEl.textContent = `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
  }
  updateCountdown();
  countdownTimer = setInterval(updateCountdown, 1000);
}

async function checkStatusNow() {
  if (finished) return;
  try {
    const response = await fetch(`/api/transactions/${encodeURIComponent(orderId)}`, { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    latestTransaction = data;
    savePaymentHistory(data);
    showQr(data);
    if (data.payment_status === "success") {
      paymentSuccess();
      return;
    }
    if (["expired", "failed", "cancelled"].includes(data.payment_status)) {
      paymentFinished(data.payment_status);
    }
  } catch (error) {
    console.debug("Status check error:", error);
  }
}

function startPolling() {
  pollingTimer = setInterval(checkStatusNow, 800);
}

function paymentSuccess() {
  if (finished) return;
  finished = true;
  clearInterval(pollingTimer);
  clearInterval(countdownTimer);
  localStorage.removeItem(ACTIVE_ORDER_KEY);
  if (latestTransaction) {
    latestTransaction.payment_status = "success";
    latestTransaction.updated_at = new Date().toISOString();
    savePaymentHistory(latestTransaction);
  }
  statusEl.textContent = "Pembayaran berhasil.";
  qrArea.classList.add("hidden");
  waitingStatus.classList.add("hidden");
  if (cancelBtn) cancelBtn.classList.add("hidden");
  successBox.classList.remove("hidden");
  setTimeout(() => { window.location.href = "/"; }, 700);
}

function paymentFinished(status) {
  if (finished) return;
  finished = true;
  clearInterval(pollingTimer);
  clearInterval(countdownTimer);
  localStorage.removeItem(ACTIVE_ORDER_KEY);
  if (latestTransaction) {
    latestTransaction.payment_status = status;
    latestTransaction.updated_at = new Date().toISOString();
    savePaymentHistory(latestTransaction);
  }
  qrEl.classList.add("hidden");
  qrArea.classList.add("hidden");
  waitingStatus.classList.add("hidden");
  if (cancelBtn) cancelBtn.classList.add("hidden");

  if (status === "expired") {
    countdownEl.textContent = "00:00";
    failedLabel.textContent = "WAKTU HABIS";
    failedTitle.textContent = "Pembayaran Kedaluwarsa";
    failedDescription.textContent = "Waktu pembayaran sudah habis. QRIS ini tidak dapat digunakan lagi.";
  } else if (status === "cancelled") {
    window.location.href = "/";
    return;
  } else {
    failedLabel.textContent = "PEMBAYARAN GAGAL";
    failedTitle.textContent = "Pembayaran Tidak Berhasil";
    failedDescription.textContent = "Pembayaran tidak berhasil diproses. Silakan kembali ke kantin dan buat transaksi baru.";
  }

  qrMessageEl.textContent = "QRIS sudah tidak dapat digunakan.";
  expiredBox.classList.remove("hidden");
}

async function cancelPayment() {
  if (finished) return;
  const confirmed = await uiConfirm(
    "Batalkan pembayaran ini?\n\nTransaksi yang dibatalkan tidak dapat digunakan lagi.",
    "Batalkan pembayaran?"
  );
  if (!confirmed) return;

  if (cancelBtn) {
    cancelBtn.disabled = true;
    cancelBtn.textContent = "Membatalkan...";
  }

  try {
    const response = await fetch(`/api/transactions/${encodeURIComponent(orderId)}/cancel`, { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Gagal membatalkan transaksi.");
    localStorage.removeItem(ACTIVE_ORDER_KEY);
    if (latestTransaction) {
      latestTransaction.payment_status = "cancelled";
      latestTransaction.updated_at = new Date().toISOString();
      savePaymentHistory(latestTransaction);
    }
    window.location.href = "/";
  } catch (error) {
    await uiAlert(error.message, "Pembatalan gagal");
    if (cancelBtn) {
      cancelBtn.disabled = false;
      cancelBtn.textContent = "Batal Pembayaran";
    }
  }
}

async function startPaymentPage() {
  if (!orderId) {
    window.location.href = "/";
    return;
  }
  const storedOrder = localStorage.getItem(ACTIVE_ORDER_KEY);
  if (storedOrder && storedOrder !== orderId) {
    window.location.href = `/payment.html?order_id=${encodeURIComponent(storedOrder)}`;
    return;
  }
  if (!storedOrder) localStorage.setItem(ACTIVE_ORDER_KEY, orderId);

  try {
    const data = await loadTransaction();
    if (data.payment_status === "success") return paymentSuccess();
    if (["expired", "failed", "cancelled"].includes(data.payment_status)) return paymentFinished(data.payment_status);

    startCountdown();
    preparePayment();
    startPolling();
  } catch (error) {
    statusEl.textContent = error.message;
  }
}

injectPaymentDialog();
if (cancelBtn) cancelBtn.addEventListener("click", cancelPayment);
startPaymentPage();
