const cart = new Map();
const ACTIVE_ORDER_KEY = "smart_canteen_active_order";
const SUPPORT_CACHE_KEY = "smart_canteen_support_cache";
const SUPPORT_SEEN_KEY = "smart_canteen_support_seen_replies";
const TRANSACTION_HISTORY_KEY = "smart_canteen_transaction_history";
const TRANSACTION_SEEN_KEY = "smart_canteen_transaction_seen";

let products = [];
let soldOutProducts = [];
let supportMessages = [];
let supportPollTimer = null;
let showingSoldOut = false;
let selectedSupportId = null;

const rupiah = n => new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0
}).format(n || 0);

const esc = s => String(s ?? "").replace(/[&<>'"]/g, c => ({
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
  trash: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16"/>
      <path d="M9 7V4h6v3"/>
      <path d="M7 7l1 13h8l1-13"/>
      <path d="M10 11v5M14 11v5"/>
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
  `,

  bell: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/>
      <path d="M10 21h4"/>
    </svg>
  `
};


/* =========================================================
   CUSTOM UI DIALOGS
========================================================= */

function injectDialogUI(){
  if(document.querySelector("#appDialog")) return;
  document.body.insertAdjacentHTML("beforeend", `
    <div id="appDialog" class="app-dialog" hidden>
      <div class="app-dialog-backdrop"></div>
      <section class="app-dialog-card" role="dialog" aria-modal="true" aria-labelledby="appDialogTitle">
        <h3 id="appDialogTitle">Smart Canteen</h3><p id="appDialogMessage"></p>
        <input id="appDialogInput" class="app-dialog-input" hidden autocomplete="off">
        <div class="app-dialog-actions"><button id="appDialogCancel" type="button" class="app-dialog-secondary" hidden>Batal</button><button id="appDialogOk" type="button">OK</button></div>
      </section>
    </div>`);
  document.querySelector("#appDialogOk").addEventListener("click",()=>finishDialog(true));
  document.querySelector("#appDialogCancel").addEventListener("click",()=>finishDialog(false));
  document.querySelector("#appDialog .app-dialog-backdrop").addEventListener("click",()=>finishDialog(false));
}
let dialogResolve=null;
function finishDialog(value){const el=document.querySelector("#appDialog");if(!el||el.hidden)return;const input=document.querySelector("#appDialogInput");const result=input.hidden?value:(value?input.value:null);el.hidden=true;if(dialogResolve){const r=dialogResolve;dialogResolve=null;r(result);}}
function uiAlert(message,title="Smart Canteen"){injectDialogUI();return new Promise(resolve=>{dialogResolve=()=>resolve();const el=document.querySelector("#appDialog"),input=document.querySelector("#appDialogInput");document.querySelector("#appDialogTitle").textContent=title;document.querySelector("#appDialogMessage").textContent=String(message??"");input.hidden=true;input.value="";document.querySelector("#appDialogCancel").hidden=true;document.querySelector("#appDialogOk").textContent="OK";el.hidden=false;});}
function uiConfirm(message,title="Konfirmasi"){injectDialogUI();return new Promise(resolve=>{dialogResolve=value=>resolve(Boolean(value));const el=document.querySelector("#appDialog"),input=document.querySelector("#appDialogInput");document.querySelector("#appDialogTitle").textContent=title;document.querySelector("#appDialogMessage").textContent=String(message??"");input.hidden=true;input.value="";document.querySelector("#appDialogCancel").hidden=false;document.querySelector("#appDialogOk").textContent="Ya";el.hidden=false;});}
function uiPrompt(message,defaultValue="",title="Isi data"){injectDialogUI();return new Promise(resolve=>{dialogResolve=value=>resolve(value);const el=document.querySelector("#appDialog"),input=document.querySelector("#appDialogInput");document.querySelector("#appDialogTitle").textContent=title;document.querySelector("#appDialogMessage").textContent=String(message??"");input.hidden=false;input.value=defaultValue??"";document.querySelector("#appDialogCancel").hidden=false;document.querySelector("#appDialogOk").textContent="Simpan";el.hidden=false;requestAnimationFrame(()=>{input.focus();input.select();});});}

/* =========================================================
   TRANSACTION NOTIFICATIONS / HISTORY
========================================================= */
function readTransactionHistory(){try{const rows=JSON.parse(localStorage.getItem(TRANSACTION_HISTORY_KEY)||"[]");return Array.isArray(rows)?rows:[];}catch{return[];}}
function getSeenTransactions(){try{const rows=JSON.parse(localStorage.getItem(TRANSACTION_SEEN_KEY)||"[]");return new Set(Array.isArray(rows)?rows.map(String):[]);}catch{return new Set();}}
function markTransactionSeen(orderId){const seen=getSeenTransactions();seen.add(String(orderId));localStorage.setItem(TRANSACTION_SEEN_KEY,JSON.stringify([...seen].slice(-100)));updateTransactionBadge();renderTransactionHistory();}
function saveTransactionHistory(tx){if(!tx?.order_id)return;const existing=readTransactionHistory().find(x=>x.order_id===tx.order_id);const rows=readTransactionHistory().filter(x=>x.order_id!==tx.order_id);rows.unshift({order_id:tx.order_id,total:tx.total,payment_status:tx.payment_status,payment_type:tx.payment_type||null,created_at:tx.created_at||existing?.created_at||new Date().toISOString(),updated_at:tx.updated_at||new Date().toISOString(),items:Array.isArray(tx.items)?tx.items:(existing?.items||[])});localStorage.setItem(TRANSACTION_HISTORY_KEY,JSON.stringify(rows.slice(0,30)));renderTransactionHistory();updateTransactionBadge();}
function transactionStatusLabel(status){return({success:"Berhasil",pending:"Menunggu pembayaran",cancelled:"Dibatalkan",expired:"Kedaluwarsa",failed:"Gagal"}[status]||status||"Tidak diketahui");}
function transactionStatusClass(status){return`tx-${status||"unknown"}`;}
function renderTransactionHistory(){const body=document.querySelector("#transactionPanelBody");if(!body)return;const rows=readTransactionHistory();if(!rows.length){body.innerHTML=`<div class="transaction-empty">Belum ada riwayat transaksi di perangkat ini.</div>`;return;}const seen=getSeenTransactions();body.innerHTML=rows.map(tx=>{const unread=!seen.has(String(tx.order_id));return `<button class="transaction-list-item ${unread?"unread":"read"}" type="button" onclick="openTransactionDetail('${esc(tx.order_id)}')"><span class="transaction-list-icon">${icons.bell}</span><span class="transaction-list-copy"><span class="transaction-list-title">${esc(tx.items?.[0]?.product_name||"Transaksi")}${tx.items?.length>1?` + ${tx.items.length-1} lainnya`:""}</span><span class="transaction-list-meta">${rupiah(tx.total)} · ${transactionStatusLabel(tx.payment_status)} · ${tx.created_at?new Date(tx.created_at).toLocaleDateString("id-ID"):"-"}</span><span class="transaction-list-unread" ${unread?"":"hidden"}>Belum dibaca</span></span><span class="transaction-list-status ${transactionStatusClass(tx.payment_status)}">${esc(transactionStatusLabel(tx.payment_status))}</span></button>`;}).join("");}
function updateTransactionBadge(){const badge=document.querySelector("#transactionFabBadge");if(!badge)return;const seen=getSeenTransactions();const unread=readTransactionHistory().filter(x=>!seen.has(String(x.order_id))).length;badge.textContent=unread>99?"99+":unread;badge.hidden=unread===0;}
function openTransactionDetail(orderId){markTransactionSeen(orderId);const tx=readTransactionHistory().find(x=>x.order_id===orderId);if(!tx)return;const body=document.querySelector("#transactionPanelBody");if(!body)return;body.innerHTML=`<div class="transaction-detail"><button class="transaction-detail-back" type="button" onclick="renderTransactionHistory()">${icons.back} Kembali</button><h3>${esc(tx.order_id)}</h3><p class="transaction-detail-date">${tx.created_at?new Date(tx.created_at).toLocaleString("id-ID"):"-"}</p><div class="transaction-detail-status ${transactionStatusClass(tx.payment_status)}">${esc(transactionStatusLabel(tx.payment_status))}</div><div class="transaction-detail-total"><span>Total</span><strong>${rupiah(tx.total)}</strong></div><div class="transaction-detail-items">${(tx.items||[]).map(i=>`<div><span>${esc(i.product_name)} × ${i.quantity}</span><strong>${rupiah(i.subtotal)}</strong></div>`).join("")||"Tidak ada detail item."}</div></div>`;}
async function syncTransactionHistory(){
  try{
    const res=await fetch("/api/transactions/history?limit=30",{cache:"no-store"});
    if(!res.ok)return;
    const rows=await res.json();
    if(!Array.isArray(rows)||!rows.length)return;
    rows.slice().reverse().forEach(saveTransactionHistory);
  }catch(e){console.debug("Riwayat server belum tersedia:",e);}
}
function setupTransactionUI(){if(document.querySelector("#transactionFab"))return;document.body.insertAdjacentHTML("beforeend",`<button id="transactionFab" class="transaction-fab" type="button" title="Riwayat transaksi" aria-label="Riwayat transaksi">${icons.bell}<span id="transactionFabBadge" class="transaction-fab-badge" hidden>0</span></button><aside id="transactionPanel" class="transaction-panel" hidden><div class="transaction-panel-head"><div><h3>Riwayat Transaksi</h3><small>Transaksi dari perangkat ini</small></div><button id="transactionPanelClose" class="transaction-panel-close" type="button" aria-label="Tutup">${icons.close}</button></div><div id="transactionPanelBody" class="transaction-panel-body"></div></aside>`);document.querySelector("#transactionFab").addEventListener("click",e=>{e.stopPropagation();const panel=document.querySelector("#transactionPanel");panel.hidden=!panel.hidden;if(!panel.hidden)renderTransactionHistory();});document.querySelector("#transactionPanelClose").addEventListener("click",()=>document.querySelector("#transactionPanel").hidden=true);renderTransactionHistory();updateTransactionBadge();}

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

    .app-dialog[hidden],.transaction-panel[hidden]{display:none}.app-dialog{position:fixed;inset:0;z-index:3000;display:grid;place-items:center;padding:18px}.app-dialog-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.38);backdrop-filter:blur(2px)}.app-dialog-card{position:relative;width:min(420px,100%);background:#fff;border:1px solid #e2e4e8;border-radius:18px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.22)}.app-dialog-card h3{margin:0 0 8px}.app-dialog-card p{margin:0;white-space:pre-line;color:#4b5563;line-height:1.5}.app-dialog-input{width:100%;box-sizing:border-box;margin-top:14px;padding:11px 12px;border:1px solid #d5d8dd;border-radius:10px;font:inherit}.app-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.app-dialog-actions button{min-width:84px}.app-dialog-secondary{background:#f1f2f4!important;color:#20242b!important}
.transaction-fab{
  position:fixed;
  right:22px;
  bottom:92px;
  width:52px;
  height:52px;
  border:1px solid #e2e4e8;
  border-radius:50%;
  display:grid;
  place-items:center;
  background:#fff;
  color:#111318;
  box-shadow:0 10px 30px rgba(0,0,0,.18);
  cursor:pointer;
  z-index:1000;
}

.transaction-fab svg{
  width:23px;
  height:23px;
  fill:none;
  stroke:currentColor;
  stroke-width:1.8;
  stroke-linecap:round;
  stroke-linejoin:round;
}

.transaction-fab-badge{
  position:absolute;
  right:-3px;
  top:-3px;
  min-width:19px;
  height:19px;
  padding:0 5px;
  border-radius:10px;
  background:#111318;
  color:#fff;
  font-size:10px;
  font-weight:700;
  display:grid;
  place-items:center;
  border:2px solid #fff;
}

.transaction-fab-badge.pending{
  background:#b51d2b;
}

.transaction-fab-badge[hidden]{
  display:none;
}


/* =========================
   TRANSACTION PANEL
========================= */

.transaction-panel{
  position:fixed;
  right:22px;
  bottom:154px;
  width:min(430px,calc(100vw - 30px));
  max-height:min(620px,calc(100vh - 180px));
  background:#fff;
  border:1px solid #e2e4e8;
  border-radius:18px;
  box-shadow:0 18px 50px rgba(0,0,0,.18);
  z-index:999;
  overflow:hidden;
}

.transaction-panel[hidden]{
  display:none;
}


/* =========================
   PANEL HEADER
========================= */

.transaction-panel-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  padding:15px 17px;
  border-bottom:1px solid #eceef1;
}

.transaction-panel-head h3{
  margin:0;
  font-size:1rem;
  color:#202124;
}

.transaction-panel-head small{
  display:block;
  margin-top:3px;
  color:#747982;
}


/* CLOSE BUTTON */

.transaction-panel-close{
  width:40px;
  height:40px;
  min-width:40px;
  border:1px solid #e3e5e8;
  border-radius:50%;
  background:#f7f8fa;
  color:#5f6670;
  display:grid;
  place-items:center;
  padding:0;
  cursor:pointer;
  transition:background .15s ease,color .15s ease;
}

.transaction-panel-close:hover{
  background:#eceef1;
  color:#111318;
}

.transaction-panel-close svg{
  width:18px;
  height:18px;
  fill:none;
  stroke:currentColor;
  stroke-width:1.8;
  stroke-linecap:round;
  stroke-linejoin:round;
}


/* =========================
   PANEL BODY
========================= */

.transaction-panel-body{
  max-height:520px;
  overflow:auto;
  padding:8px;
}


/* =========================
   TRANSACTION LIST
========================= */

.transaction-list-item{
  width:100%;
  display:flex;
  align-items:center;
  gap:10px;
  padding:13px 10px;
  border:0;
  border-bottom:1px solid #f0f1f3;
  background:#fff;
  text-align:left;
  cursor:pointer;
  color:#202124;
  min-width:0;
}

.transaction-list-item:hover{
  background:#f8f9fa;
}

.transaction-list-item.unread{
  background:#f7f8fa;
}

.transaction-list-item.read{
  background:#fff;
}


/* ICON */

.transaction-list-icon{
  width:34px;
  height:34px;
  min-width:34px;
  display:grid;
  place-items:center;
  border-radius:10px;
  background:#f1f2f4;
  color:#34383e;
  flex:none;
}

.transaction-list-item.unread .transaction-list-icon{
  background:#eceef1;
}

.transaction-list-icon svg{
  width:18px;
  height:18px;
  fill:none;
  stroke:currentColor;
  stroke-width:1.8;
  stroke-linecap:round;
  stroke-linejoin:round;
}


/* =========================
   ONE ROW CONTENT
========================= */

.transaction-list-copy{
  min-width:0;
  flex:1;
  display:flex;
  align-items:center;
  gap:6px;
  overflow:hidden;
  white-space:nowrap;
}

.transaction-list-title{
  flex:0 1 auto;
  min-width:0;
  max-width:45%;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  font-weight:700;
  color:#202124;
}

.transaction-list-item.unread .transaction-list-title{
  font-weight:700;
  color:#202124;
}

.transaction-list-item.read .transaction-list-title{
  font-weight:600;
  color:#202124;
}

.transaction-list-meta{
  flex:1 1 auto;
  min-width:0;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  font-size:.78rem;
  color:#5f6670 !important;
  font-weight:500;
  opacity:1 !important;
}


/* UNREAD LABEL */

.transaction-list-unread{
  display:inline-block;
  flex:none;
  margin:0;
  padding:2px 6px;
  border-radius:6px;
  background:#eef0f3;
  color:#34383e !important;
  font-size:.65rem;
  line-height:1.3;
  font-weight:800;
  white-space:nowrap;
}

.transaction-list-unread[hidden]{
  display:none;
}


/* STATUS */

.transaction-list-status{
  flex:none;
  max-width:90px;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  font-size:.72rem;
  font-weight:700;
}

.tx-success{
  color:#2f8f4e;
}

.tx-pending{
  color:#9a6a18;
}

.tx-cancelled,
.tx-failed{
  color:#777;
}

.tx-expired{
  color:#9a6a18;
}


/* EMPTY */

.transaction-empty{
  text-align:center;
  color:#747982;
  padding:34px 18px;
}


/* =========================
   TRANSACTION DETAIL
========================= */

.transaction-detail{
  padding:8px;
}

.transaction-detail-back{
  border:0;
  background:none;
  padding:6px 0;
  display:inline-flex;
  align-items:center;
  gap:4px;
  color:#34383e;
  cursor:pointer;
}

.transaction-detail-back svg{
  width:17px;
  height:17px;
  fill:none;
  stroke:currentColor;
  stroke-width:1.8;
  stroke-linecap:round;
  stroke-linejoin:round;
}

.transaction-detail h3{
  margin:15px 0 4px;
  font-size:.98rem;
  word-break:break-all;
  color:#202124;
}

.transaction-detail-date{
  font-size:.78rem;
  color:#747982;
}

.transaction-detail-status{
  margin:14px 0;
  padding:10px 12px;
  border-radius:10px;
  background:#f4f5f7;
}

.transaction-detail-total{
  display:flex;
  justify-content:space-between;
  gap:12px;
  padding:12px 0;
  border-bottom:1px solid #eceef1;
}

.transaction-detail-items{
  padding-top:10px;
}

.transaction-detail-items>div{
  display:flex;
  justify-content:space-between;
  gap:12px;
  padding:7px 0;
  font-size:.86rem;
}


/* =========================
   MOBILE
========================= */

@media (max-width:600px){

  .transaction-fab{
    right:16px;
    bottom:82px;
  }

  .transaction-panel{
    right:15px;
    bottom:145px;
    width:calc(100vw - 30px);
    max-height:70vh;
  }

  .transaction-panel-body{
    max-height:calc(70vh - 75px);
  }

  .transaction-list-item{
    gap:8px;
    padding:12px 8px;
  }

  .transaction-list-copy{
    gap:5px;
  }

  .transaction-list-title{
    max-width:38%;
  }

  .transaction-list-meta{
    font-size:.72rem;
  }

  .transaction-list-status{
    max-width:70px;
    font-size:.68rem;
  }

  .transaction-list-unread{
    font-size:.6rem;
    padding:2px 5px;
  }
}
    .sold-out-toggle{
      margin:18px auto 0;
      display:flex;
      align-items:center;
      gap:8px;
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

    .sold-out-card button{
      cursor:not-allowed;
    }
    .sold-out-section{
      display:flex;
      flex-direction:column;
      align-items:center;
      width:100%;
      margin-top:28px;
      padding-top:6px;
      clear:both;
    }

    .sold-out-toggle{
      min-height:44px;
      margin:0 auto;
      padding:10px 16px;
    }

    .sold-out-content{
      width:100%;
      margin-top:18px;
    }

    .sold-out-content .grid{
      width:100%;
    }

    .cart-controls{
      display:flex;
      align-items:center;
      justify-content:center;
      gap:8px;
      min-width:0;
    }

    .cart-controls .delete-btn{
      width:38px;
      height:38px;
      min-width:38px;
      padding:0;
      margin-left:4px;
      display:inline-flex;
      align-items:center;
      justify-content:center;
      border:1px solid #e7b8bd;
      border-radius:10px;
      background:#fff3f4;
      color:#b51d2b;
      line-height:0;
    }

    .cart-controls .delete-btn svg{
      width:17px;
      height:17px;
      display:block;
      fill:none;
      stroke:currentColor;
      stroke-width:1.8;
      stroke-linecap:round;
      stroke-linejoin:round;
    }

    .cart-controls .delete-btn:hover{
      background:#fde5e7;
      color:#9f1724;
    }

    @media(max-width:600px){
      .sold-out-section{
        margin-top:24px;
      }

      .cart-controls{
        gap:6px;
      }

      .cart-controls .delete-btn{
        width:36px;
        height:36px;
        min-width:36px;
      }
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
      width:40px;
      height:40px;
      min-width:40px;
      flex:0 0 40px;
      padding:0;

      border:0;
      border-radius:50%;

      background:#f7f8fa;
      border:1px solid #e3e5e8;
      color:#6f747c;

      display:grid;
      place-items:center;

      cursor:pointer;
    }

    .support-panel-close:hover{background:#eceef1;color:#111318}.support-panel-close svg{
      width:17px;
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

    .support-list-item.unread{background:#f7f8fa}.support-list-item.unread .support-list-title{font-weight:800;color:#111318}.support-list-item.unread .support-list-icon{background:#eceef1}.support-list-item.unread .support-list-meta{color:#4b5563;font-weight:600}

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
      color:#111318;

      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
    }

    .support-list-meta{
      font-size:.78rem;
      color:#626873;

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

  /*
    Kalau index.html lama masih punya
    kotak "Pesan Saya", hapus otomatis
    supaya tidak muncul dua UI.
  */
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

  document.addEventListener("pointerdown",event=>{
    const panel=document.querySelector("#supportPanel");
    const fab=document.querySelector("#supportFab");
    if(panel && !panel.hidden && !panel.contains(event.target) && !fab.contains(event.target)) panel.hidden=true;
    const txPanel=document.querySelector("#transactionPanel");
    const txFab=document.querySelector("#transactionFab");
    if(txPanel && !txPanel.hidden && !txPanel.contains(event.target) && !txFab.contains(event.target)) txPanel.hidden=true;
  });
  document.addEventListener("keydown",event=>{
    if(event.key!=="Escape")return;
    document.querySelector("#supportPanel")?.setAttribute("hidden","");
    document.querySelector("#transactionPanel")?.setAttribute("hidden","");
  });

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
    saveTransactionHistory(data);


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

async function loadProducts(
  includeUnavailable = false
){

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


  if (includeUnavailable){

    products =
      data.filter(
        p => p.available_stock > 0
      );

    soldOutProducts =
      data.filter(
        p => p.available_stock <= 0
      );

  }else{

    products = data;

  }


  renderProducts();

}


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


function renderProducts(){

  const box =
    document.querySelector(
      "#products"
    );


  if (!box) return;


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

  box.classList.remove("products-loading");
  box.removeAttribute("aria-busy");


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


  if (
    !soldOutProducts.length &&
    !showingSoldOut
  ){

    soldOutSection.hidden =
      true;

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

          <div class="sold-out-content">

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


  document
    .querySelector(
      "#soldOutToggle"
    )
    .addEventListener(
      "click",
      async () => {

        showingSoldOut =
          !showingSoldOut;


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

    return uiAlert(`Stok ${p.name} hanya ${p.available_stock}.`);

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
                  title="Hapus dari keranjang"
                  aria-label="Hapus ${esc(p.name)} dari keranjang"
                  onclick="removeFromCart(${p.id})"
                >
                  ${icons.trash}
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

    return uiAlert("Keranjang masih kosong.");

  }


  const btn =
    document.querySelector(
      "#checkoutBtn"
    );


  btn.disabled = true;

  btn.textContent =
    "Membuka pembayaran...";


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

    uiAlert(e.message);

    btn.disabled = false;

    btn.textContent =
      "Checkout & Generate QRIS";

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


  renderSupportList();
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
            class="support-list-item ${m.admin_reply && !getSeenReplies().has(Number(m.id)) ? "unread" : "read"}"
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
                    ? (getSeenReplies().has(Number(m.id)) ? "Sudah dibaca · Sudah dibalas admin" : "Belum dibaca · Sudah dibalas admin")
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
                      tx.payment_status
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

      uiAlert(e.message,"Gagal");

    }

  }

}


/* =========================================================
   SEND SUPPORT
========================================================= */

async function sendSupport(){

  const message =
    document
      .querySelector(
        "#supportMessage"
      )
      .value
      .trim();


  const contact =
    document
      .querySelector(
        "#supportContact"
      )
      .value
      .trim();


  const orderId =
    document
      .querySelector(
        "#supportOrderId"
      )
      .value
      .trim();


  const btn =
    document.querySelector(
      "#sendSupportBtn"
    );


  if (!message){

    return uiAlert("Tulis pesan dulu.");

  }


  btn.disabled = true;


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


    // Reset every support field after a successful send.
    document.querySelector("#supportMessage").value = "";
    document.querySelector("#supportContact").value = "";
    document.querySelector("#supportOrderId").value = "";

    uiAlert(data.message,"Pesan terkirim");

    // Refresh in the background so the form is not blocked by the follow-up GET.
    loadSupportMessages(false);


  }catch(e){

    uiAlert(e.message,"Gagal");


  }finally{

    btn.disabled = false;

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


injectDialogUI();
setupTransactionUI();
syncTransactionHistory();
setupSupportUI();

readSupportCache();

renderCart();


loadProducts(true)
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
    2000
  );

document.addEventListener("visibilitychange",()=>{
  if(!document.hidden) loadSupportMessages(false);
});
