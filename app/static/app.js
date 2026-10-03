const cart = new Map();

const ACTIVE_ORDER_KEY = "smart_canteen_active_order";
const SUPPORT_CACHE_KEY = "smart_canteen_support_cache";
const SUPPORT_SEEN_KEY = "smart_canteen_support_seen_replies";

let products = [];
let soldOutProducts = [];

let supportMessages = [];
let supportPollTimer = null;

let showingSoldOut = false;
let selectedSupportId = null;


/* =========================================================
   FORMAT
========================================================= */

const rupiah = n =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(n || 0);


const esc = s =>
  String(s ?? "").replace(/[&<>'"]/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[c]));


/* =========================================================
   ICON
========================================================= */

const icons = {

  message: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 11.5a7.5 7.5 0 0 1-8 7.5
               8.8 8.8 0 0 1-4-.9L4 20l1.2-3.4
               A7.3 7.3 0 0 1 4.5 12
               7.5 7.5 0 0 1 12 4.5
               7.5 7.5 0 0 1 20 11.5Z"/>
      <path d="M8 12h.01M12 12h.01M16 12h.01"/>
    </svg>
  `,

  close: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m7 7 10 10M17 7 7 17"/>
    </svg>
  `,

  back: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m15 6-6 6 6 6"/>
    </svg>
  `,

  arrow: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9 18 6-6-6-6"/>
    </svg>
  `

};


/* =========================================================
   SUPPORT FLOATING UI
========================================================= */

function injectSupportStyles() {

  if (document.querySelector("#supportFloatingStyles")) {
    return;
  }

  const style = document.createElement("style");

  style.id = "supportFloatingStyles";

  style.textContent = `

    .sold-out-toggle{
  margin:28px auto 32px;

  display:flex;
  align-items:center;
  justify-content:center;
  gap:8px;

  padding:12px 20px;

  border-radius:14px;
}

    .sold-out-section[hidden]{
      display:none;
    }

    .sold-out-title{
      margin:0 0 12px;
      font-size:1rem;
      opacity:.72;
    }

    .sold-out-card{
      opacity:.58;
      filter:grayscale(.2);
    }

    .delete-btn{
  width:42px !important;
  height:42px !important;

  min-width:42px !important;
  min-height:42px !important;

  padding:0 !important;

  display:inline-flex !important;
  align-items:center !important;
  justify-content:center !important;

  flex:0 0 42px;

  border:0 !important;
  border-radius:12px !important;

  background:#b51d2b !important;
  color:#fff !important;

  cursor:pointer;
}

.delete-btn:hover{
  background:#961827 !important;
}

.delete-icon{
  width:20px !important;
  height:20px !important;

  display:block !important;

  flex:0 0 20px;

  color:#fff !important;
}

.delete-icon path{
  vector-effect:non-scaling-stroke;
}

    .sold-out-card button{
      cursor:not-allowed;
    }


    /* FLOATING MESSAGE BUTTON */

    .support-fab{
      position:fixed;
      right:22px;
      bottom:22px;

      width:58px;
      height:58px;

      border:0;
      border-radius:50%;

      display:grid;
      place-items:center;

      background:#111318;
      color:#fff;

      box-shadow:
        0 10px 30px rgba(0,0,0,.2);

      cursor:pointer;

      z-index:1000;

      transition:
        transform .15s ease,
        box-shadow .15s ease;
    }

    .support-fab:hover{
      transform:translateY(-2px);

      box-shadow:
        0 14px 34px rgba(0,0,0,.24);
    }

    .support-fab svg{
      width:25px;
      height:25px;

      fill:none;
      stroke:currentColor;
      stroke-width:1.8;
      stroke-linecap:round;
      stroke-linejoin:round;
    }


    /* BADGE */

    .support-fab-badge{
      position:absolute;

      right:-2px;
      top:-2px;

      min-width:20px;
      height:20px;

      padding:0 5px;

      border-radius:10px;

      background:#b51d2b;
      color:#fff;

      font-size:11px;
      font-weight:700;

      display:grid;
      place-items:center;

      border:2px solid #fff;
    }

    .support-fab-badge[hidden]{
      display:none;
    }


    /* PANEL */

    .support-panel{
      position:fixed;

      right:22px;
      bottom:90px;

      width:min(
        390px,
        calc(100vw - 30px)
      );

      max-height:min(
        620px,
        calc(100vh - 120px)
      );

      background:#fff;

      border:1px solid #e2e4e8;

      border-radius:18px;

      box-shadow:
        0 18px 50px rgba(0,0,0,.18);

      z-index:999;

      overflow:hidden;
    }

    .support-panel[hidden]{
      display:none;
    }


    /* PANEL HEADER */

    .support-panel-head{
      display:flex;
      align-items:center;
      justify-content:space-between;

      padding:15px 17px;

      border-bottom:
        1px solid #eceef1;
    }

    .support-panel-head h3{
      margin:0;
      font-size:1rem;
    }

    .support-panel-head small{
      display:block;
      margin-top:3px;
      color:#747982;
    }

    .support-panel-close{
      width:34px;
      height:34px;

      border:0;
      border-radius:10px;

      background:#f1f2f4;

      display:grid;
      place-items:center;

      cursor:pointer;
    }

    .support-panel-close svg{
      width:18px;
      height:18px;

      fill:none;
      stroke:currentColor;
      stroke-width:1.8;

      stroke-linecap:round;
    }


    /* LIST */

    .support-panel-body{
      max-height:520px;
      overflow:auto;

      padding:8px;
    }

    .support-list-item{
      width:100%;

      display:flex;
      align-items:center;

      gap:10px;

      padding:13px 10px;

      border:0;
      border-bottom:
        1px solid #f0f1f3;

      background:#fff;

      text-align:left;

      cursor:pointer;
    }

    .support-list-item:hover{
      background:#f7f7f8;
    }

    .support-list-icon{
      width:34px;
      height:34px;

      flex:0 0 34px;

      border-radius:10px;

      background:#f1f2f4;

      display:grid;
      place-items:center;

      color:#333;
    }

    .support-list-icon svg{
      width:18px;
      height:18px;

      fill:none;
      stroke:currentColor;
      stroke-width:1.8;

      stroke-linecap:round;
      stroke-linejoin:round;
    }

    .support-list-copy{
      min-width:0;
      flex:1;
    }

    .support-list-title{
      font-weight:700;

      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
    }

    .support-list-meta{
      font-size:.78rem;
      color:#7a7f87;

      margin-top:4px;
    }

    .support-list-arrow svg{
      width:18px;
      height:18px;

      fill:none;
      stroke:#8a8f98;

      stroke-width:1.8;

      stroke-linecap:round;
      stroke-linejoin:round;
    }


    /* DETAIL */

    .support-detail{
      padding:15px 14px;
    }

    .support-detail-back{
      border:0;
      background:none;

      padding:5px 0;

      display:inline-flex;
      align-items:center;

      gap:4px;

      cursor:pointer;

      font-weight:600;
    }

    .support-detail-back svg{
      width:17px;
      height:17px;

      fill:none;
      stroke:currentColor;

      stroke-width:1.8;

      stroke-linecap:round;
      stroke-linejoin:round;
    }

    .support-detail-title{
      margin:15px 0 4px;

      font-size:1.05rem;
    }

    .support-detail-date{
      font-size:.78rem;

      color:#7a7f87;

      margin-bottom:15px;
    }


    /* CHAT BUBBLES */

    .support-bubble{
      padding:12px 13px;

      border-radius:13px;

      background:#f4f5f7;

      margin-bottom:10px;
    }

    .support-bubble strong{
      display:block;

      margin-bottom:6px;

      font-size:.83rem;
    }

    .support-reply-bubble{
      background:#f3f8f4;

      border:
        1px solid #d9eadc;
    }


    /* TRANSACTION */

    .support-tx{
      margin-top:16px;

      border:
        1px solid #e2e4e8;

      border-radius:13px;

      overflow:hidden;
    }

    .support-tx-head{
      padding:11px 12px;

      background:#f7f7f8;

      font-weight:700;

      font-size:.85rem;
    }

    .support-tx-body{
      padding:12px;

      font-size:.82rem;
    }

    .support-tx-row{
      display:flex;

      justify-content:space-between;

      gap:12px;

      margin-bottom:6px;
    }

    .support-tx-items{
      margin-top:9px;

      padding-top:9px;

      border-top:
        1px solid #eceef1;
    }

    .support-empty-panel{
      padding:30px 18px;

      text-align:center;

      color:#7a7f87;

      font-size:.9rem;
    }


    @media(max-width:600px){

      .support-fab{
        right:15px;
        bottom:15px;
      }

      .support-panel{
        right:15px;
        bottom:82px;
      }

    }

  `;

  document.head.appendChild(style);
}


function setupSupportUI(){

  injectSupportStyles();

  document
    .querySelector(".support-inbox")
    ?.remove();

  if (
    document.querySelector("#supportFab")
  ){
    return;
  }


  document.body.insertAdjacentHTML(
    "beforeend",
    `

    <button
      id="supportFab"
      class="support-fab"
      type="button"
      title="Pesan saya"
    >

      ${icons.message}

      <span
        id="supportFabBadge"
        class="support-fab-badge"
        hidden
      >
        0
      </span>

    </button>


    <aside
      id="supportPanel"
      class="support-panel"
      hidden
    >

      <div class="support-panel-head">

        <div>

          <h3 id="supportPanelTitle">
            Pesan Saya
          </h3>

          <small>
            Balasan admin untuk perangkat ini
          </small>

        </div>


        <button
          id="supportPanelClose"
          class="support-panel-close"
          type="button"
          title="Tutup"
        >
          ${icons.close}
        </button>

      </div>


      <div
        id="supportPanelBody"
        class="support-panel-body"
      ></div>

    </aside>

    `
  );


  document
    .querySelector("#supportFab")
    .addEventListener(
      "click",
      () => {

        const panel =
          document.querySelector(
            "#supportPanel"
          );

        panel.hidden =
          !panel.hidden;

        if (!panel.hidden){

          renderSupportList();

          loadSupportMessages(false);

        }

      }
    );


  document
    .querySelector("#supportPanelClose")
    .addEventListener(
      "click",
      () => {

        document
          .querySelector(
            "#supportPanel"
          )
          .hidden = true;

      }
    );

}


/* =========================================================
   ACTIVE ORDER
========================================================= */

async function checkActiveOrder(){

  const activeOrder =
    localStorage.getItem(
      ACTIVE_ORDER_KEY
    );

  if (!activeOrder) return;


  try{

    const response =
      await fetch(
        `/api/transactions/${encodeURIComponent(activeOrder)}`
      );


    if (!response.ok){

      localStorage.removeItem(
        ACTIVE_ORDER_KEY
      );

      return;
    }


    const data =
      await response.json();


    if (
      data.payment_status ===
      "pending"
    ){

      window.location.href =
        `/payment.html?order_id=${encodeURIComponent(activeOrder)}`;

      return;
    }


    localStorage.removeItem(
      ACTIVE_ORDER_KEY
    );


  }catch(error){

    console.error(
      "Gagal mengecek transaksi aktif:",
      error
    );

  }

}


/* =========================================================
   PRODUCTS
========================================================= */

async function loadProducts(includeUnavailable = false){

  const url =
    includeUnavailable
      ? "/api/products?include_unavailable=true"
      : "/api/products";


  const res =
    await fetch(
      url,
      {
        cache:"no-store"
      }
    );


  if (!res.ok){

    throw new Error(
      "Gagal mengambil produk."
    );

  }


  const data =
    await res.json();


  /*
    Mode normal:
    - products = produk yang tersedia
    - ambil juga produk habis
      supaya tombolnya langsung muncul
  */

  if (!includeUnavailable){

    products =
      data.filter(
        p => p.available_stock > 0
      );


    try{

      const soldOutRes =
        await fetch(
          "/api/products?include_unavailable=true",
          {
            cache:"no-store"
          }
        );


      if (soldOutRes.ok){

        const soldOutData =
          await soldOutRes.json();


        soldOutProducts =
          soldOutData.filter(
            p => p.available_stock <= 0
          );

      }else{

        soldOutProducts = [];

      }


    }catch(error){

      console.error(
        "Gagal mengambil produk habis:",
        error
      );

      soldOutProducts = [];

    }

  }


  /*
    Mode produk habis:
    backend mengirim produk yang
    tidak tersedia.
  */

  else{

    products =
      data.filter(
        p => p.available_stock > 0
      );


    soldOutProducts =
      data.filter(
        p => p.available_stock <= 0
      );

  }


  renderProducts();

}


/* =========================================================
   PRODUCT CARD
========================================================= */

function productCard(
  p,
  soldOut = false
){

  return `

    <article
      class="
        product
        card
        ${soldOut ? "sold-out-card" : ""}
      "
    >

      <h3>
        ${esc(p.name)}
      </h3>


      ${
        p.discount_percent > 0

        ?

        `
          <p class="old-price">
            ${rupiah(p.price)}
          </p>

          <p class="discount">
            Diskon ${p.discount_percent}%
          </p>
        `

        :

        ""
      }


      <p class="product-price">
        ${rupiah(p.effective_price)}
      </p>


      <p class="stock-info">

        ${
          soldOut
            ? "Stok habis"
            : `Tersedia: ${p.available_stock}`
        }

      </p>


      <button
        ${soldOut ? "disabled" : ""}
        ${
          soldOut
            ? ""
            : `onclick="addToCart(${p.id})"`
        }
      >

        ${
          soldOut
            ? "Stok Habis"
            : "Tambah"
        }

      </button>

    </article>

  `;
}


/* =========================================================
   RENDER PRODUCTS
========================================================= */

function renderProducts(){

  const box =
    document.querySelector(
      "#products"
    );


  if (!box) return;


  /*
    Produk tersedia
  */

  const availableHtml =
    products.length

      ?

      products
        .map(
          p => productCard(
            p,
            false
          )
        )
        .join("")

      :

      `
        <p class="empty">
          Belum ada produk yang tersedia.
        </p>
      `;


  box.innerHTML =
    availableHtml;


  /*
    Container produk habis
  */

  let soldOutSection =
    document.querySelector(
      "#soldOutSection"
    );


  if (!soldOutSection){

    soldOutSection =
      document.createElement(
        "section"
      );


    soldOutSection.id =
      "soldOutSection";


    soldOutSection.className =
      "sold-out-section";


    box.insertAdjacentElement(
      "afterend",
      soldOutSection
    );

  }


  /*
    Kalau tidak ada produk habis,
    tombol tidak perlu ditampilkan.
  */

  if (
    !soldOutProducts.length
  ){

    soldOutSection.hidden =
      true;

    soldOutSection.innerHTML =
      "";

    return;

  }


  soldOutSection.hidden =
    false;


  soldOutSection.innerHTML = `

    <button
      id="soldOutToggle"
      class="sold-out-toggle"
      type="button"
    >

      ${
        showingSoldOut

          ?

          "Sembunyikan produk habis"

          :

          `Lihat produk habis (${soldOutProducts.length})`
      }

    </button>


    ${
      showingSoldOut

        ?

        `

          <div class="sold-out-section">

            <h3 class="sold-out-title">
              Produk Habis
            </h3>


            <section class="grid">

              ${
                soldOutProducts
                  .map(
                    p => productCard(
                      p,
                      true
                    )
                  )
                  .join("")
              }

            </section>

          </div>

        `

        :

        ""
    }

  `;


  const toggle =
    document.querySelector(
      "#soldOutToggle"
    );


  if (!toggle) return;


  toggle.addEventListener(
    "click",
    async () => {

      showingSoldOut =
        !showingSoldOut;


      /*
        Kalau data produk habis
        belum ada, ambil ulang.
      */

      if (
        showingSoldOut &&
        !soldOutProducts.length
      ){

        await loadProducts(
          true
        );

      }else{

        renderProducts();

      }

    }
  );

}


/* =========================================================
   CART
========================================================= */

function addToCart(id){

  const p =
    products.find(
      x => x.id === id
    );


  if (!p) return;


  const old =
    cart.get(id)?.quantity || 0;


  if (
    old >=
    p.available_stock
  ){

    return alert(
      `Stok ${p.name} hanya ${p.available_stock}.`
    );

  }


  cart.set(
    id,
    {
      ...p,
      quantity:
        old + 1
    }
  );


  renderCart();

}


function increaseCart(id){

  addToCart(id);

}


function decreaseCart(id){

  const item =
    cart.get(id);


  if (!item) return;


  if (
    item.quantity <= 1
  ){

    cart.delete(id);

  }else{

    item.quantity--;

  }


  renderCart();

}


function removeFromCart(id){

  cart.delete(id);

  renderCart();

}


function renderCart(){

  const rows =
    [...cart.values()];


  const cartEl =
    document.querySelector(
      "#cart"
    );


  if (!cartEl) return;


  cartEl.innerHTML =
    rows.length

      ?

      rows
        .map(
          p => `

            <div class="row">

              <div>

                <strong>
                  ${esc(p.name)}
                </strong>

                <br>

                <small>
                  ${rupiah(p.effective_price)}
                  / item
                </small>

              </div>


              <div class="cart-controls">

                <button
                  onclick="decreaseCart(${p.id})"
                >
                  −
                </button>


                <span>
                  ${p.quantity}
                </span>


                <button
                  onclick="increaseCart(${p.id})"
                >
                  +
                </button>


                <button
  class="delete-btn"
  type="button"
  title="Hapus dari keranjang"
  aria-label="Hapus ${esc(p.name)} dari keranjang"
  onclick="removeFromCart(${p.id})"
>
  <svg
    class="delete-icon"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      d="M4 7h16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
    />

    <path
      d="M9 7V4h6v3"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />

    <path
      d="M6 7l1 13h10l1-13"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linejoin="round"
    />

    <path
      d="M10 11v5M14 11v5"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
    />
  </svg>
</button>

              </div>


              <strong>

                ${
                  rupiah(
                    p.effective_price *
                    p.quantity
                  )
                }

              </strong>

            </div>

          `
        )
        .join("")

      :

      "<p>Keranjang masih kosong.</p>";


  const total =
    rows.reduce(
      (s,p) =>
        s +
        p.effective_price *
        p.quantity,
      0
    );


  const totalEl =
    document.querySelector(
      "#total"
    );


  if (totalEl){

    totalEl.textContent =
      rupiah(total);

  }

}


/* =========================================================
   CHECKOUT
========================================================= */

async function checkout(){

  const activeOrder =
    localStorage.getItem(
      ACTIVE_ORDER_KEY
    );


  if (activeOrder){

    window.location.href =
      `/payment.html?order_id=${encodeURIComponent(activeOrder)}`;

    return;

  }


  const items =
    [...cart.values()].map(
      p => ({
        product_id:p.id,
        quantity:p.quantity
      })
    );


  if (!items.length){

    return alert(
      "Keranjang masih kosong."
    );

  }


  const btn =
    document.querySelector(
      "#checkoutBtn"
    );


  if (btn){

    btn.disabled = true;

    btn.textContent =
      "Membuat transaksi...";

  }


  try{

    const res =
      await fetch(
        "/api/checkout",
        {
          method:"POST",

          headers:{
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              items
            })

        }
      );


    const data =
      await res.json();


    if (!res.ok){

      throw new Error(
        data.detail ||
        "Checkout gagal"
      );

    }


    localStorage.setItem(
      ACTIVE_ORDER_KEY,
      data.order_id
    );


    window.location.href =
      `/payment.html?order_id=${encodeURIComponent(data.order_id)}`;


  }catch(e){

    alert(
      e.message
    );


    if (btn){

      btn.disabled = false;

      btn.textContent =
        "Checkout & Generate QRIS";

    }


    await loadProducts();

  }

}


/* =========================================================
   SUPPORT CACHE
========================================================= */

function readSupportCache(){

  try{

    const cached =
      JSON.parse(
        localStorage.getItem(
          SUPPORT_CACHE_KEY
        ) || "[]"
      );


    supportMessages =
      Array.isArray(cached)
        ? cached
        : [];


  }catch{

    supportMessages = [];

  }


  renderSupportList();

  updateSupportBadge();

}


function saveSupportCache(
  rows
){

  supportMessages =
    Array.isArray(rows)
      ? rows
      : [];


  localStorage.setItem(
    SUPPORT_CACHE_KEY,
    JSON.stringify(
      supportMessages.slice(
        0,
        50
      )
    )
  );


  renderSupportList();

  updateSupportBadge();

}


/* =========================================================
   SUPPORT READ STATE
========================================================= */

function getSeenReplies(){

  try{

    const x =
      JSON.parse(
        localStorage.getItem(
          SUPPORT_SEEN_KEY
        ) || "[]"
      );


    return new Set(
      Array.isArray(x)
        ? x.map(Number)
        : []
    );


  }catch{

    return new Set();

  }

}


function markReplySeen(id){

  const seen =
    getSeenReplies();


  seen.add(
    Number(id)
  );


  localStorage.setItem(
    SUPPORT_SEEN_KEY,
    JSON.stringify(
      [...seen].slice(-100)
    )
  );


  updateSupportBadge();

}


function updateSupportBadge(){

  const badge =
    document.querySelector(
      "#supportFabBadge"
    );


  if (!badge) return;


  const seen =
    getSeenReplies();


  const unread =
    supportMessages.filter(
      m =>
        m.admin_reply &&
        !seen.has(
          Number(m.id)
        )
    ).length;


  badge.textContent =
    unread;


  badge.hidden =
    unread === 0;

}


/* =========================================================
   SUPPORT LIST
========================================================= */

function supportTitle(
  message
){

  const title =
    String(
      message || ""
    )
      .split(/\r?\n/)[0]
      .trim();


  return title.length > 48
    ? title.slice(0,48) + "…"
    : title ||
      "Pesan tanpa judul";

}


function renderSupportList(){

  const body =
    document.querySelector(
      "#supportPanelBody"
    );


  if (!body) return;


  if (
    !supportMessages.length
  ){

    body.innerHTML = `
      <div class="support-empty-panel">
        Belum ada pesan dari perangkat ini.
      </div>
    `;

    return;

  }


  body.innerHTML =
    supportMessages
      .map(
        m => `

          <button
            class="support-list-item"
            type="button"
            onclick="openSupportDetail(${m.id})"
          >

            <span
              class="support-list-icon"
            >
              ${icons.message}
            </span>


            <span
              class="support-list-copy"
            >

              <span
                class="support-list-title"
              >

                ${esc(
                  supportTitle(
                    m.message
                  )
                )}

              </span>


              <span
                class="support-list-meta"
              >

                ${
                  m.admin_reply
                    ? "Sudah dibalas admin"
                    : "Menunggu balasan"
                }

                ·

                ${
                  m.created_at
                    ? new Date(
                        m.created_at
                      ).toLocaleDateString(
                        "id-ID"
                      )
                    : "-"
                }

              </span>

            </span>


            <span
              class="support-list-arrow"
            >
              ${icons.arrow}
            </span>

          </button>

        `
      )
      .join("");

}


/* =========================================================
   SUPPORT DETAIL
========================================================= */

function openSupportDetail(
  id
){

  selectedSupportId =
    Number(id);


  const item =
    supportMessages.find(
      x =>
        Number(x.id) ===
        selectedSupportId
    );


  if (!item) return;


  if (item.admin_reply){

    markReplySeen(
      item.id
    );

  }


  const body =
    document.querySelector(
      "#supportPanelBody"
    );


  if (!body) return;


  const tx =
    item.transaction;


  body.innerHTML = `

    <div class="support-detail">

      <button
        class="support-detail-back"
        type="button"
        onclick="renderSupportList()"
      >

        ${icons.back}

        Kembali

      </button>


      <h3
        class="support-detail-title"
      >

        ${esc(
          supportTitle(
            item.message
          )
        )}

      </h3>


      <div
        class="support-detail-date"
      >

        ${
          item.created_at
            ? new Date(
                item.created_at
              ).toLocaleString(
                "id-ID"
              )
            : "-"
        }

      </div>


      <div class="support-bubble">

        <strong>
          Pesan kamu
        </strong>

        ${
          esc(
            item.message
          ).replace(
            /\n/g,
            "<br>"
          )
        }

      </div>


      ${
        item.admin_reply

          ?

          `

            <div
              class="
                support-bubble
                support-reply-bubble
              "
            >

              <strong>
                Balasan admin
              </strong>

              ${
                esc(
                  item.admin_reply
                ).replace(
                  /\n/g,
                  "<br>"
                )
              }


              ${
                item.replied_at

                  ?

                  `
                    <br>
                    <small>
                      ${
                        new Date(
                          item.replied_at
                        ).toLocaleString(
                          "id-ID"
                        )
                      }
                    </small>
                  `

                  :

                  ""
              }

            </div>

          `

          :

          `

            <div class="support-bubble">

              <strong>
                Status
              </strong>

              Pesan kamu sedang
              menunggu balasan admin.

            </div>

          `
      }


      ${
        tx

          ?

          `

            <div class="support-tx">

              <div class="support-tx-head">
                Catatan Transaksi
              </div>


              <div class="support-tx-body">

                <div class="support-tx-row">

                  <span>
                    Transaction ID
                  </span>

                  <strong>
                    ${esc(tx.order_id)}
                  </strong>

                </div>


                <div class="support-tx-row">

                  <span>
                    Status
                  </span>

                  <strong>
                    ${esc(
                      tx.payment_status ||
                      "-"
                    )}
                  </strong>

                </div>


                <div class="support-tx-row">

                  <span>
                    Metode
                  </span>

                  <strong>
                    ${
                      esc(
                        tx.payment_type ||
                        "-"
                      )
                    }
                  </strong>

                </div>


                <div class="support-tx-row">

                  <span>
                    Total
                  </span>

                  <strong>
                    ${rupiah(tx.total)}
                  </strong>

                </div>


                <div
                  class="support-tx-items"
                >

                  ${
                    tx.items?.length

                      ?

                      tx.items
                        .map(
                          i => `

                            <div
                              class="
                                support-tx-row
                              "
                            >

                              <span>

                                ${
                                  esc(
                                    i.product_name
                                  )
                                }

                                ×

                                ${i.quantity}

                              </span>


                              <strong>

                                ${
                                  rupiah(
                                    i.subtotal
                                  )
                                }

                              </strong>

                            </div>

                          `
                        )
                        .join("")

                      :

                      "Tidak ada detail item."
                  }

                </div>

              </div>

            </div>

          `

          :

          ""
      }

    </div>

  `;

}


/* =========================================================
   LOAD SUPPORT
========================================================= */

async function loadSupportMessages(
  showError = false
){

  try{

    const res =
      await fetch(
        "/api/support",
        {
          cache:"no-store"
        }
      );


    if (!res.ok){

      throw new Error(
        "Gagal mengambil pesan."
      );

    }


    const rows =
      await res.json();


    saveSupportCache(
      rows
    );


  }catch(e){

    console.error(
      "Gagal mengambil pesan admin:",
      e
    );


    if (showError){

      alert(
        e.message
      );

    }

  }

}


/* =========================================================
   SEND SUPPORT
========================================================= */

async function sendSupport(){

  const messageEl =
    document.querySelector(
      "#supportMessage"
    );

  const contactEl =
    document.querySelector(
      "#supportContact"
    );

  const orderEl =
    document.querySelector(
      "#supportOrderId"
    );


  if (!messageEl) return;


  const message =
    messageEl.value.trim();


  const contact =
    contactEl
      ? contactEl.value.trim()
      : "";


  const orderId =
    orderEl
      ? orderEl.value.trim()
      : "";


  const btn =
    document.querySelector(
      "#sendSupportBtn"
    );


  if (!message){

    return alert(
      "Tulis pesan dulu."
    );

  }


  if (btn){

    btn.disabled = true;

  }


  try{

    const res =
      await fetch(
        "/api/support",
        {
          method:"POST",

          headers:{
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              message,

              contact:
                contact ||
                null,

              order_id:
                orderId ||
                null
            })

        }
      );


    const data =
      await res.json();


    if (!res.ok){

      throw new Error(
        data.detail ||
        "Gagal mengirim pesan."
      );

    }


    alert(
      data.message
    );


    messageEl.value = "";


    await loadSupportMessages();


  }catch(e){

    alert(
      e.message
    );


  }finally{

    if (btn){

      btn.disabled = false;

    }

  }

}


/* =========================================================
   INITIALIZE
========================================================= */

const checkoutBtn =
  document.querySelector(
    "#checkoutBtn"
  );


if (checkoutBtn){

  checkoutBtn.addEventListener(
    "click",
    checkout
  );

}


const sendSupportBtn =
  document.querySelector(
    "#sendSupportBtn"
  );


if (sendSupportBtn){

  sendSupportBtn.addEventListener(
    "click",
    sendSupport
  );

}


setupSupportUI();

readSupportCache();

renderCart();


loadProducts()
  .catch(
    e => {

      console.error(e);

      const box =
        document.querySelector(
          "#products"
        );


      if (box){

        box.innerHTML =
          `
            <p class="error">
              ${esc(e.message)}
            </p>
          `;

      }

    }
  );


loadSupportMessages();


checkActiveOrder();


if (supportPollTimer){

  clearInterval(
    supportPollTimer
  );

}


supportPollTimer =
  setInterval(
    () =>
      loadSupportMessages(false),
    15000
  );