const params =
  new URLSearchParams(
    window.location.search
  );


const orderId =
  params.get(
    "order_id"
  );


const ACTIVE_ORDER_KEY =
  "smart_canteen_active_order";


const orderIdEl =
  document.querySelector(
    "#orderId"
  );


const totalEl =
  document.querySelector(
    "#paymentTotal"
  );


const countdownEl =
  document.querySelector(
    "#countdown"
  );


const qrEl =
  document.querySelector(
    "#qr"
  );


const qrMessageEl =
  document.querySelector(
    "#qrMessage"
  );


const statusEl =
  document.querySelector(
    "#status"
  );


const waitingStatus =
  document.querySelector(
    "#waitingStatus"
  );


const expiredBox =
  document.querySelector(
    "#expiredBox"
  );


const successBox =
  document.querySelector(
    "#successBox"
  );


const cancelBtn =
  document.querySelector(
    "#cancelBtn"
  );


const qrArea =
  document.querySelector(
    "#qrArea"
  );


const successOrderId =
  document.querySelector(
    "#successOrderId"
  );


const successTotal =
  document.querySelector(
    "#successTotal"
  );


const failedOrderId =
  document.querySelector(
    "#failedOrderId"
  );


const failedTotal =
  document.querySelector(
    "#failedTotal"
  );


const failedTitle =
  document.querySelector(
    "#failedTitle"
  );


const failedDescription =
  document.querySelector(
    "#failedDescription"
  );


const failedLabel =
  document.querySelector(
    "#failedLabel"
  );


let pollingTimer = null;

let countdownTimer = null;

let expiresAt = null;

let finished = false;


/* =========================================================
   FORMAT RUPIAH
========================================================= */

function rupiah(n) {

  return new Intl.NumberFormat(
    "id-ID",
    {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0
    }
  ).format(n);

}


/* =========================================================
   VALIDASI ORDER
========================================================= */

if (!orderId) {

  window.location.href =
    "/";

}


const storedOrder =
  localStorage.getItem(
    ACTIVE_ORDER_KEY
  );


if (
  storedOrder &&
  storedOrder !== orderId
) {

  window.location.href =
    `/payment.html?order_id=${encodeURIComponent(storedOrder)}`;

}


/* =========================================================
   LOAD TRANSACTION
========================================================= */

async function loadTransaction() {

  const response =
    await fetch(
      `/api/transactions/${encodeURIComponent(orderId)}`
    );


  if (!response.ok) {

    throw new Error(
      "Transaksi tidak ditemukan."
    );

  }


  const data =
    await response.json();


  orderIdEl.textContent =
    data.order_id;


  totalEl.textContent =
    rupiah(
      data.total
    );


  if (successOrderId) {

    successOrderId.textContent =
      data.order_id;

  }


  if (successTotal) {

    successTotal.textContent =
      rupiah(data.total);

  }


  if (failedOrderId) {

    failedOrderId.textContent =
      data.order_id;

  }


  if (failedTotal) {

    failedTotal.textContent =
      rupiah(data.total);

  }


  if (data.expires_at) {

    expiresAt =
      new Date(
        data.expires_at
      );

  }


  if (data.qr_url) {

    qrEl.src =
      data.qr_url;

    qrEl.classList.remove(
      "hidden"
    );

    qrMessageEl.textContent =
      "Scan QRIS untuk melakukan pembayaran.";

  } else {

    qrMessageEl.textContent =
      "Mode lokal: QRIS belum dikonfigurasi.";

  }


  return data;

}


/* =========================================================
   COUNTDOWN
========================================================= */

function startCountdown() {

  if (!expiresAt) {

    return;

  }


  function updateCountdown() {

    const remaining =
      expiresAt.getTime()
      - Date.now();


    if (remaining <= 0) {

      countdownEl.textContent =
        "00:00";


      clearInterval(
        countdownTimer
      );


      checkStatusNow();

      return;

    }


    const totalSeconds =
      Math.floor(
        remaining / 1000
      );


    const minutes =
      Math.floor(
        totalSeconds / 60
      );


    const seconds =
      totalSeconds % 60;


    countdownEl.textContent =
      `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  }


  updateCountdown();


  countdownTimer =
    setInterval(
      updateCountdown,
      1000
    );

}


/* =========================================================
   CHECK STATUS
========================================================= */

async function checkStatusNow() {

  if (finished) {

    return;

  }


  try {

    const response =
      await fetch(
        `/api/transactions/${encodeURIComponent(orderId)}`
      );


    if (!response.ok) {

      return;

    }


    const data =
      await response.json();


    if (
      data.payment_status ===
      "success"
    ) {

      paymentSuccess();

      return;

    }


    if (
      data.payment_status ===
      "expired" ||
      data.payment_status ===
      "failed" ||
      data.payment_status ===
      "cancelled"
    ) {

      paymentFinished(
        data.payment_status
      );

    }

  } catch (error) {

    console.error(
      "Status check error:",
      error
    );

  }

}


/* =========================================================
   POLLING
========================================================= */

function startPolling() {

  pollingTimer =
    setInterval(
      checkStatusNow,
      3000
    );

}


/* =========================================================
   SUCCESS
========================================================= */

function paymentSuccess() {

  if (finished) {

    return;

  }


  finished = true;


  clearInterval(
    pollingTimer
  );


  clearInterval(
    countdownTimer
  );


  localStorage.removeItem(
    ACTIVE_ORDER_KEY
  );


  statusEl.textContent =
    "Pembayaran berhasil.";


  qrEl.classList.add(
    "hidden"
  );


  qrArea.classList.add(
    "hidden"
  );


  waitingStatus.classList.add(
    "hidden"
  );


  if (cancelBtn) {

    cancelBtn.classList.add(
      "hidden"
    );

  }


  successBox.classList.remove(
    "hidden"
  );


  setTimeout(
    () => {

      window.location.href =
        "/";

    },
    5000
  );

}


/* =========================================================
   EXPIRED / FAILED / CANCELLED
========================================================= */

function paymentFinished(
  status
) {

  if (finished) {

    return;

  }


  finished = true;


  clearInterval(
    pollingTimer
  );


  clearInterval(
    countdownTimer
  );


  localStorage.removeItem(
    ACTIVE_ORDER_KEY
  );


  qrEl.classList.add(
    "hidden"
  );


  qrArea.classList.add(
    "hidden"
  );


  waitingStatus.classList.add(
    "hidden"
  );


  if (cancelBtn) {

    cancelBtn.classList.add(
      "hidden"
    );

  }


  if (status === "expired") {

    countdownEl.textContent =
      "00:00";


    failedLabel.textContent =
      "WAKTU HABIS";


    failedTitle.textContent =
      "Pembayaran Kedaluwarsa";


    failedDescription.textContent =
      "Waktu pembayaran sudah habis. QRIS ini tidak dapat digunakan lagi.";

  }


  else if (
    status === "cancelled"
  ) {

    failedLabel.textContent =
      "TRANSAKSI DIBATALKAN";


    failedTitle.textContent =
      "Pembayaran Dibatalkan";


    failedDescription.textContent =
      "Transaksi ini telah dibatalkan dan tidak dapat digunakan kembali.";

  }


  else {

    failedLabel.textContent =
      "PEMBAYARAN GAGAL";


    failedTitle.textContent =
      "Pembayaran Tidak Berhasil";


    failedDescription.textContent =
      "Pembayaran tidak berhasil diproses. Silakan kembali ke kantin dan buat transaksi baru.";

  }


  qrMessageEl.textContent =
    "QRIS sudah tidak dapat digunakan.";


  expiredBox.classList.remove(
    "hidden"
  );

}


/* =========================================================
   CANCEL PAYMENT
========================================================= */

async function cancelPayment() {

  if (finished) {

    return;

  }


  const confirmed =
    confirm(
      "Batalkan pembayaran ini?\n\nTransaksi yang dibatalkan tidak dapat digunakan lagi."
    );


  if (!confirmed) {

    return;

  }


  if (cancelBtn) {

    cancelBtn.disabled =
      true;

    cancelBtn.textContent =
      "Membatalkan...";

  }


  try {

    const response =
      await fetch(
        `/api/transactions/${encodeURIComponent(orderId)}/cancel`,
        {
          method: "POST"
        }
      );


    const data =
      await response.json();


    if (!response.ok) {

      throw new Error(
        data.detail ||
        "Gagal membatalkan transaksi."
      );

    }


    localStorage.removeItem(
      ACTIVE_ORDER_KEY
    );


    /*
      Tampilkan halaman hasil
      pembatalan terlebih dahulu.
    */

    paymentFinished(
      "cancelled"
    );


  } catch (error) {

    alert(
      error.message
    );


    if (cancelBtn) {

      cancelBtn.disabled =
        false;

      cancelBtn.textContent =
        "Batal Pembayaran";

    }

  }

}


/* =========================================================
   START
========================================================= */

async function startPaymentPage() {

  const currentOrder =
    localStorage.getItem(
      ACTIVE_ORDER_KEY
    );


  if (
    currentOrder !== orderId
  ) {

    window.location.href =
      currentOrder
        ? `/payment.html?order_id=${encodeURIComponent(currentOrder)}`
        : "/";

    return;

  }


  try {

    const data =
      await loadTransaction();


    if (
      data.payment_status ===
      "success"
    ) {

      paymentSuccess();

      return;

    }


    if (
      data.payment_status ===
      "expired" ||
      data.payment_status ===
      "failed" ||
      data.payment_status ===
      "cancelled"
    ) {

      paymentFinished(
        data.payment_status
      );

      return;

    }


    startCountdown();

    startPolling();

  } catch (error) {

    statusEl.textContent =
      error.message;

  }

}


/* =========================================================
   CANCEL BUTTON
========================================================= */

if (cancelBtn) {

  cancelBtn.addEventListener(
    "click",
    cancelPayment
  );

}


startPaymentPage();