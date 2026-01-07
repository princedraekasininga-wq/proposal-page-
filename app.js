// ==========================================
// 1. FIREBASE CONFIGURATION & SETUP
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyBRMITHX8gm0jKpEXuC4iePGWoYON85BDU",
  authDomain: "stallz-loans.firebaseapp.com",
  databaseURL: "https://stallz-loans-default-rtdb.firebaseio.com",
  projectId: "stallz-loans",
  storageBucket: "stallz-loans.firebasestorage.app",
  messagingSenderId: "496528682",
  appId: "1:496528682:web:26066f0ca7d440fb854253",
  measurementId: "G-ZELECKK94M"
};

let db, dataRef;

// Initialize Firebase safely
try {
  if (typeof firebase !== "undefined") {
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    dataRef = db.ref("loanManagerData_v5");
  } else {
    console.warn("Firebase SDK not loaded. Running in Offline/Test Mode.");
  }
} catch (e) {
  console.error("Firebase Init Error (Ignore if offline):", e);
}

// ==========================================
// 2. HELPER FUNCTIONS & CONSTANTS
// ==========================================

function el(id) { return document.getElementById(id); }

// Get local date string YYYY-MM-DD for input fields (Fixes timezone lag)
function getLocalDateVal() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// --- TOAST HELPER ---
function showToast(message, type = "success") {
  const container = el("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  const icon = type === "success" ? "✨" : "⚠️";

  toast.className = `toast ${type}`;
  toast.innerHTML = `<span style="font-size:1.2rem;">${icon}</span> <span>${message}</span>`;

  container.appendChild(toast);

  // Animate Out
  setTimeout(() => {
    toast.style.animation = "toastOut 0.5s forwards";
    setTimeout(() => toast.remove(), 500);
  }, 3500);
}

// --- SESSION MANAGEMENT ---
function updateSessionActivity() {
  localStorage.setItem("stallz_last_active", Date.now());
}

// Add listeners to track activity (clicks or key presses)
document.addEventListener("click", updateSessionActivity);
document.addEventListener("keydown", updateSessionActivity);
document.addEventListener("touchstart", updateSessionActivity);

// --- ROLLING COUNTER ANIMATION ---
function animateValue(obj, start, end, duration) {
  if (!obj) return;
  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    const value = Math.floor(progress * (end - start) + start);
    obj.innerHTML = "K" + value.toLocaleString(); // Format with K and commas
    if (progress < 1) {
      window.requestAnimationFrame(step);
    } else {
        // Ensure final value is exact format
        obj.innerHTML = formatMoney(end);
    }
  };
  window.requestAnimationFrame(step);
}
const INTEREST_BY_PLAN = { "Weekly": 0.20, "2 Weeks": 0.30, "3 Weeks": 0.35, "Monthly": 0.40 };
const DAYS_BY_PLAN = { "Weekly": 7, "2 Weeks": 14, "3 Weeks": 21, "Monthly": 30 };

const state = {
  dataLoaded: false,
  loans: [],
  nextId: 1,
  startingCapital: 0,
  startingCapitalSetDate: null,
  capitalTxns: [],
  nextCapitalTxnId: 1,
  repayments: [],
  nextRepaymentId: 1,
  admins: [],
  nextAdminId: 1,
  user: null,
  isLoggedIn: false
};

// --- FILTER STATE ---
let activeFilters = { status: 'All', plan: 'All' };

function setFilter(type, value, btnElement) {
  // Update State
  activeFilters[type] = value;

  // Update Visuals (Active Chip)
  const parent = btnElement.parentElement;
  parent.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  btnElement.classList.add('active');

  // Re-render
  renderLoansTable();
}

function getInitials(name) {
  return name.split(' ').map(n => n[0]).join('').substring(0,2).toUpperCase();
}

const LOAN_STEPS = [
  { key: "clientName", label: "Client Name", icon: "👤", type: "text", placeholder: "e.g. John Banda", required: true, helper: "Who is taking the loan?" },
  { key: "clientPhone", label: "Client Phone", icon: "📱", type: "text", placeholder: "e.g. 097...", required: false, helper: "Optional but useful for follow-up." },
  { key: "collateralItem", label: "Collateral Item", icon: "🎒", type: "text", placeholder: "e.g. Samsung A24, HP Laptop", required: true, helper: "What item are they leaving with you?" },
  { key: "collateralValue", label: "Collateral Value", icon: "💰", type: "number", placeholder: "Resale value (e.g. 3000)", required: false, helper: "How much can you realistically sell it for?" },
  { key: "amount", label: "Loan Amount", icon: "💵", type: "number", placeholder: "How much are you giving? (e.g. 1000)", required: true, helper: "Remember: short loans, strong profit, low risk." },
  { key: "plan", label: "Plan", icon: "🕒", type: "select", options: ["Weekly", "2 Weeks", "3 Weeks", "Monthly"], required: true, helper: "Pick the repayment period." },
  { key: "customInterest", label: "Negotiated Interest % (Optional)", icon: "🤝", type: "number", placeholder: "e.g. 15 (Leave empty for standard)", required: false, helper: "Enter a number to override the standard plan rate." },
  { key: "startDate", label: "Start Date", icon: "📅", type: "date", required: true, helper: "The date you give out the money." },
  { key: "notes", label: "Notes (optional)", icon: "📝", type: "textarea", placeholder: "ID, condition, extra details...", required: false, helper: "Extra info for this loan." }
];

let wizardStep = 0;
let wizardDraft = {};

const ACTION = { NONE: "NONE", PAY: "PAY", NOTE: "NOTE" };
let currentAction = ACTION.NONE;
let currentLoanId = null;

// ==========================================
// 3. AUTHENTICATION & CLOUD SYNC
// ==========================================
const TEST_MODE = true;

function showWelcomeScreen() {
  const screen = el("welcomeScreen");
  const loginBtn = el("authLoginBtn");
  const errorMsg = el("authError");
  const loader = el("loadingOverlay");

  // 1. DEFAULT: Hide Loader immediately
  if (loader) loader.style.display = "none";

  // 2. CHECK SESSION (Auto-Logout Logic)
  const lastActive = localStorage.getItem("stallz_last_active");
  const now = Date.now();
  const THIRTY_MINUTES = 30 * 60 * 1000;

  if (lastActive && (now - lastActive > THIRTY_MINUTES)) {
    console.log("Session expired. Logging out.");
    if (typeof firebase !== "undefined" && firebase.auth) firebase.auth().signOut();
    localStorage.removeItem("stallz_last_active");
    screen.style.display = "flex";
  } else {
    if (typeof firebase !== "undefined" && firebase.auth) {
      firebase.auth().onAuthStateChanged((user) => {
        if (user) {
          updateSessionActivity();
          state.user = user;
          state.isLoggedIn = true;
          if (loader) { loader.style.display = "flex"; loader.style.opacity = "1"; }
          screen.style.display = "none";
          loadFromFirebase();
        } else {
          screen.style.display = "flex";
        }
      });
    } else if (TEST_MODE) {
        screen.style.display = "flex";
    }
  }

  // 3. LOGIN BUTTON LOGIC
  if (loginBtn) {
    loginBtn.onclick = async () => {
      const email = el("loginEmail").value.trim();
      const password = el("loginPassword").value.trim();

      if (!email || !password) {
        errorMsg.textContent = "Please enter both email and password.";
        return;
      }

      // Show loader
      if (loader) { loader.style.display = "flex"; loader.style.opacity = "1"; }

      // --- BYPASS AUTH IN TEST MODE ---
      if (TEST_MODE) {
        console.log("TEST MODE: Bypassing Firebase Auth");
        setTimeout(() => {
          state.user = { email: email || "test@admin.com", uid: "test-user-123" };
          state.isLoggedIn = true;
          updateSessionActivity();
          screen.style.display = "none";
          loadFromFirebase();
        }, 1000);
        return;
      }

      try {
        if (typeof firebase === "undefined") throw new Error("Firebase not loaded");
        await firebase.auth().signInWithEmailAndPassword(email, password);
        updateSessionActivity();
      } catch (error) {
        if (loader) loader.style.display = "none";
        errorMsg.textContent = "Login failed: " + error.message;
      }
    };
  }
}

function loadFromFirebase() {
  if (TEST_MODE) {
    setTimeout(() => {
      try {
        const localData = localStorage.getItem("stallz_test_data");
        let parsed = localData ? JSON.parse(localData) : null;
        if (!parsed) parsed = { loans: [], nextId: 1, admins: [{ id: 1, name: "Test Owner", email: "test@admin.com", role: "Owner" }] };
        applyData(parsed);
      } catch(e) { console.error("Load Error:", e); }
    }, 500);
    return;
  }

  // Safety check: if dataRef is missing (offline), switch to test mode behavior or warn
  if (!dataRef) {
      console.warn("No DB connection. Cannot load live data.");
      return;
  }

  dataRef.on("value", (snapshot) => {
    applyData(snapshot.val() || {});
  });
}

function applyData(parsed) {
  // 1. Hide Loader
  const loader = el("loadingOverlay");
  if (loader) {
     loader.style.opacity = "0";
     setTimeout(() => loader.style.display = "none", 500);
  }

  // 2. Apply Data
  state.dataLoaded = true;
  state.loans = parsed.loans || [];
  state.nextId = parsed.nextId || 1;
  state.startingCapital = parsed.startingCapital || 0;
  state.startingCapitalSetDate = parsed.startingCapitalSetDate || null;
  state.capitalTxns = parsed.capitalTxns || [];
  state.nextCapitalTxnId = parsed.nextCapitalTxnId || 1;
  state.repayments = parsed.repayments || [];
  state.nextRepaymentId = parsed.nextRepaymentId || 1;
  state.admins = parsed.admins || [];
  state.nextAdminId = parsed.nextAdminId || 1;
  refreshUI();
}

function saveState() {
  if (!state.dataLoaded) return;
  const payload = {
    loans: state.loans,
    nextId: state.nextId,
    startingCapital: state.startingCapital,
    startingCapitalSetDate: state.startingCapitalSetDate,
    capitalTxns: state.capitalTxns,
    nextCapitalTxnId: state.nextCapitalTxnId,
    repayments: state.repayments,
    nextRepaymentId: state.nextRepaymentId,
    admins: state.admins,
    nextAdminId: state.nextAdminId
  };

  if (TEST_MODE) {
    localStorage.setItem("stallz_test_data", JSON.stringify(payload));
  } else {
    if (dataRef) {
        dataRef.set(payload).catch((e) => console.error("Save failed:", e));
    } else {
        console.warn("Save failed: No database connection.");
    }
  }
}

// ==========================================
// 4. LOGIC & FORMATTERS
// ==========================================

function formatMoney(amount) {
  if (amount === undefined || amount === null || isNaN(amount)) return "K0.00";
  return "K" + Number(amount).toFixed(2);
}

function formatDate(dateStr) {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-ZM", { year: "2-digit", month: "short", day: "numeric" });
}

function getMonthKey(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function computeDerivedFields(loan) {
  const today = new Date();
  let rate = INTEREST_BY_PLAN[loan.plan] || 0;
  if (loan.customInterest) rate = Number(loan.customInterest) / 100;

  const days = DAYS_BY_PLAN[loan.plan] || 0;
  const startDate = loan.startDate ? new Date(loan.startDate) : today;
  const dueDate = new Date(startDate.getTime());
  if (days > 0) dueDate.setDate(dueDate.getDate() + days);

  const totalDue = (loan.amount || 0) * (1 + rate);
  const paid = loan.paid || 0;
  const sale = loan.saleAmount || 0;
  const balance = totalDue - (paid + sale);

  let status = "ACTIVE";
  if (balance <= 1) status = "PAID";
  else if (loan.isDefaulted) status = "DEFAULTED";
  else if (today > dueDate) status = "OVERDUE";

  const daysOverdue = (today > dueDate && status !== "PAID")
    ? Math.floor((today - dueDate) / (1000 * 60 * 60 * 24))
    : 0;

  loan.rate = rate;
  loan.dueDate = dueDate.toISOString();
  loan.totalDue = totalDue;
  loan.balance = balance;
  loan.status = status;
  loan.daysOverdue = daysOverdue;
  loan.profitCollected = Math.max(0, (paid + sale) - loan.amount);
}

function recomputeAllLoans() {
  if (!state.loans) return;
  state.loans.forEach(loan => computeDerivedFields(loan));
}

function generateLoanId() { return state.nextId++; }
function generateRepaymentId() { return state.nextRepaymentId++; }
function generateCapitalTxnId() { return state.nextCapitalTxnId++; }

// ==========================================
// 5. PRINT RECEIPTS
// ==========================================

function openReceipt(loanId) {
  const loan = state.loans.find(l => l.id == loanId);
  if (!loan) return;

  const printWindow = window.open('', '', 'width=400,height=600');
  printWindow.document.write(`
    <html>
      <head>
        <style>
          body { font-family: monospace; padding: 20px; text-align: center; }
          .header { font-size: 1.2em; font-weight: bold; margin-bottom: 10px; border-bottom: 2px dashed #000; padding-bottom: 10px; }
          .row { display: flex; justify-content: space-between; margin: 5px 0; }
          .footer { margin-top: 20px; border-top: 1px solid #000; padding-top: 10px; font-size: 0.8em; }
        </style>
      </head>
      <body>
        <div class="header">STALLZ LOANS<br>OFFICIAL RECEIPT</div>
        <div class="row"><span>Date:</span> <span>${new Date().toLocaleDateString()}</span></div>
        <div class="row"><span>Loan ID:</span> <span>#${loan.id}</span></div>
        <div class="row"><span>Client:</span> <span>${loan.clientName}</span></div>
        <br>
        <div class="row"><span>Principal:</span> <span>${formatMoney(loan.amount)}</span></div>
        <div class="row"><span>Plan:</span> <span>${loan.plan}</span></div>
        <div class="row"><span>Total Due:</span> <span>${formatMoney(loan.totalDue)}</span></div>
        <div class="row"><span>Paid So Far:</span> <span>${formatMoney(loan.paid)}</span></div>
        <br>
        <div class="row" style="font-weight:bold; font-size:1.1em;"><span>BALANCE:</span> <span>${formatMoney(loan.balance)}</span></div>
        <div class="footer">
          Generated by: ${state.user ? state.user.email : 'System'}<br>
          Thank you for your business.
        </div>
        <script>window.print();</script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

// ==========================================
// 6. UI RENDERING
// ==========================================

function refreshUI() {
  try { recomputeAllLoans(); } catch(e) { console.error("Error computing loans:", e); }

  try { renderDashboard(); } catch(e) { console.error("Dash Error:", e); }
  try { renderLoansTable(); } catch(e) { console.error("Loans Table Error:", e); }
  try { renderRepaymentsTable(); } catch(e) { console.error("Repay Table Error:", e); }
  try { renderMonthlyTable(); } catch(e) { console.error("Monthly Table Error:", e); }
  try { renderClientsTable(); } catch(e) { console.error("Clients Table Error:", e); }
  try { renderAdminsTable(); } catch(e) { console.error("Admins Table Error:", e); }
}

function renderDashboard() {
  const container = el("dashboardStats");
  if (!container) return;

  const loans = state.loans || [];

  // 1. Calculate Stats
  const totalLoaned = loans.reduce((s, l) => s + (l.amount || 0), 0);
  const totalOutstanding = loans.reduce((s, l) => s + Math.max(0, l.balance || 0), 0);
  const totalProfit = loans.reduce((s, l) => s + (l.profitCollected || 0), 0);

  // New Metric: Active Loans Count (People who currently owe money)
  const activeCount = loans.filter(l => l.status === "ACTIVE" || l.status === "OVERDUE").length;

  const starting = state.startingCapital || 0;
  const added = (state.capitalTxns || []).reduce((s, t) => s + (t.amount || 0), 0);
  const paidIn = loans.reduce((s, l) => s + (l.paid || 0), 0);
  const cashOnHand = starting + added + paidIn - totalLoaned;

  // 2. Logic: Red Text if Cash is Negative
  const cashEl = el("cashOnHandValue");
  if(cashEl) {
    cashEl.textContent = formatMoney(cashOnHand);
    if (cashOnHand < 0) {
        cashEl.classList.add("text-danger-glow");
    } else {
        cashEl.classList.remove("text-danger-glow");
    }
  }

  // 3. Capital Tab Logic
  if (state.startingCapital > 0) {
      if(el("startingCapitalSetupRow")) el("startingCapitalSetupRow").style.display = "none";
      if(el("startingCapitalInfoRow")) {
          el("startingCapitalInfoRow").style.display = "block";
          el("startingCapitalInfoValue").textContent = formatMoney(state.startingCapital);
          el("startingCapitalInfoDate").textContent = formatDate(state.startingCapitalSetDate || new Date().toISOString());
      }
      if(el("startingCapitalValue")) el("startingCapitalValue").textContent = formatMoney(state.startingCapital);
  } else {
      if(el("startingCapitalSetupRow")) el("startingCapitalSetupRow").style.display = "block";
      if(el("startingCapitalInfoRow")) el("startingCapitalInfoRow").style.display = "none";
      if(el("startingCapitalValue")) el("startingCapitalValue").textContent = "Not set";
  }

  const capBody = el("capitalTableBody");
  if(capBody) {
     capBody.innerHTML = (state.capitalTxns || []).map(t => `
        <tr><td>${formatDate(t.date)}</td><td>${formatMoney(t.amount)}</td><td class="subtle">${t.note || '-'}</td></tr>
     `).join("");
  }

  // 4. Render Cards (UPDATED WITH DESCRIPTIONS)
  container.innerHTML = `
    <div class="stat-card" style="border-color: var(--primary);">
      <div class="stat-label">Active Deals</div>
      <div class="stat-value" style="font-size: 1.8rem; color:white;">${activeCount}</div>
      <div class="stat-sub">Clients with open balances</div>
    </div>

    <div class="stat-card stat-purple">
      <div class="stat-label">Total Loaned</div>
      <div class="stat-value" id="statLoaned">K0.00</div>
      <div class="stat-sub">Lifetime capital deployed</div>
    </div>

    <div class="stat-card stat-orange">
      <div class="stat-label">Outstanding</div>
      <div class="stat-value" id="statOutstanding">K0.00</div>
      <div class="stat-sub">Pending collection (Principal + Interest)</div>
    </div>

    <div class="stat-card stat-green">
      <div class="stat-label">Profit Made</div>
      <div class="stat-value" id="statProfit">K0.00</div>
      <div class="stat-sub">Total realized gains collected</div>
    </div>
  `;

  // Trigger Animations
  animateValue(el("statLoaned"), 0, totalLoaned, 1500);
  animateValue(el("statOutstanding"), 0, totalOutstanding, 2000);
  animateValue(el("statProfit"), 0, totalProfit, 2500);
}
function renderLoansTable() {
// Check for issues and show badge
  const overdueCount = (state.loans || []).filter(l => l.status === "OVERDUE").length;
  const badge = el("clientBadge");

  if (badge) {
    if (overdueCount > 0) {
      badge.classList.add("show");
    } else {
      badge.classList.remove("show");
    }
  }

  const tbody = el("loansTableBody");
  if (!tbody) return;

  const search = (el("searchInput")?.value || "").toLowerCase();

  // Use new chip state
  const statusFilter = activeFilters.status;
  const planFilter = activeFilters.plan;

  const visibleLoans = (state.loans || []).filter(l => {
     const matchSearch = !search || (l.clientName && l.clientName.toLowerCase().includes(search));
     const matchStatus = statusFilter === "All" || l.status === statusFilter;
     const matchPlan = planFilter === "All" || l.plan === planFilter;
     return matchSearch && matchStatus && matchPlan;
  });

  if (el("loansCountLabel")) el("loansCountLabel").textContent = `${visibleLoans.length} records`;
  // Only show Empty State if data has LOADED and there are still no loans
  if(el("emptyState")) {
      const shouldShow = state.dataLoaded && visibleLoans.length === 0;
      el("emptyState").style.display = shouldShow ? "block" : "none";
  }

  tbody.innerHTML = visibleLoans.map((l, index) => {
    // Progress Logic
    const percent = Math.min(100, Math.round(((l.paid || 0) / (l.totalDue || 1)) * 100));
    let progressColor = "var(--primary)";
    if (percent >= 100) progressColor = "#22c55e";
    else if (l.status === "OVERDUE") progressColor = "#ef4444";

    const isOverdue = l.status === "OVERDUE" || l.status === "DEFAULTED";
    const balanceStyle = isOverdue ? 'class="text-danger-glow" style="font-weight:bold;"' : 'style="font-weight:bold;"';

    // Avatar Color Logic (Random-ish based on ID)
    const avatarClass = `avatar-${l.id % 5}`;

    return `
    <tr class="row-${(l.status || 'active').toLowerCase()}">
      <td data-label="ID"><span style="opacity:0.5; font-size:0.8rem;">#${l.id}</span></td>

      <td data-label="Client">
        <div class="client-flex">
          <div class="avatar ${avatarClass}">${getInitials(l.clientName)}</div>
          <div>
            <div style="font-weight:600; color:white;">${l.clientName}</div>
            <div class="subtle" style="font-size:0.75rem;">${l.clientPhone||''}</div>
          </div>
        </div>
      </td>

      <td data-label="Item"><span style="color:#cbd5e1;">${l.collateralItem || '-'}</span></td>

      <td data-label="Progress">
        <div style="min-width: 100px;">
          <div style="display:flex; justify-content:space-between; font-size:0.7rem; margin-bottom:4px;">
            <span>${percent}%</span>
            <span>${formatMoney(l.paid)} / ${formatMoney(l.totalDue)}</span>
          </div>
          <div style="background:rgba(255,255,255,0.1); height:6px; border-radius:4px; overflow:hidden;">
            <div style="width:${percent}%; background:${progressColor}; height:100%; border-radius:4px; transition: width 1s ease;"></div>
          </div>
        </div>
      </td>

      <td data-label="Start">${formatDate(l.startDate)}</td>
      <td data-label="Due">${formatDate(l.dueDate)}</td>

      <td data-label="Balance" ${balanceStyle}>${formatMoney(l.balance)}</td>

      <td data-label="Status"><span class="status-pill status-${(l.status||'active').toLowerCase()}">${l.status}</span></td>

      <td data-label="Actions" style="text-align:right;">
        <button class="btn-icon" onclick="openReceipt(${l.id})" title="Print Receipt">🧾</button>
        <button class="btn-icon" onclick="openActionModal('PAY', ${l.id})" title="Pay" style="color:#4ade80;">💵</button>
        <button class="btn-icon" onclick="openActionModal('NOTE', ${l.id})" title="Edit">✏️</button>
      </td>
    </tr>
  `}).join("");
}

function renderRepaymentsTable() {
  const tbody = el("repaymentsTableBody");
  if (!tbody) return;
  tbody.innerHTML = (state.repayments || []).map(r => {
     const loan = state.loans.find(l => l.id === r.loanId);
     return `
     <tr>
       <td data-label="Date">${formatDate(r.date)}</td>
       <td data-label="Loan ID">#${r.loanId}</td>
       <td data-label="Client">${loan ? loan.clientName : 'Deleted'}</td>
       <td data-label="Recorder">${r.recordedBy||'System'}</td>
       <td data-label="Amount" style="color:#34d399">+${formatMoney(r.amount)}</td>
     </tr>`;
  }).join("");
}
function renderMonthlyTable() {
  const tbody = el("monthlyTableBody");
  if (!tbody) return;
  const map = {};
  (state.loans || []).forEach(loan => {
    const key = getMonthKey(loan.startDate);
    if (!key) return;
    if (!map[key]) map[key] = { loansOut: 0, in: 0 };
    map[key].loansOut += Number(loan.amount || 0);
  });
  (state.repayments || []).forEach(r => {
    const key = getMonthKey(r.date);
    if (!key) return;
    if (!map[key]) map[key] = { loansOut: 0, in: 0 };
    map[key].in += Number(r.amount || 0);
  });
  const keys = Object.keys(map).sort().reverse();
  tbody.innerHTML = keys.map(key => {
    const row = map[key];
    const net = row.in - row.loansOut;
    const [y, m] = key.split("-");
    const dateLabel = new Date(y, m-1).toLocaleDateString("en-ZM", { month: 'short', year: 'numeric' });
    return `
    <tr>
      <td data-label="Month">${dateLabel}</td>
      <td data-label="Loans Out">${formatMoney(row.loansOut)}</td>
      <td data-label="Money In">${formatMoney(row.in)}</td>
      <td data-label="Sales">-</td>
      <td data-label="Net Flow" style="color:${net >= 0 ? '#34d399' : '#f87171'}">${formatMoney(net)}</td>
    </tr>`;
  }).join("");
}

function renderClientsTable() {
  const tbody = el("clientsTableBody");
  if (!tbody) return;
  const map = {};
  (state.loans || []).forEach(loan => {
    const name = (loan.clientName || "Unknown").trim();
    if (!map[name]) map[name] = { phone: loan.clientPhone, count: 0, borrowed: 0, paid: 0, active: 0 };
    map[name].count++;
    map[name].borrowed += Number(loan.amount || 0);
    map[name].paid += Number(loan.paid || 0);
    if (loan.status === "ACTIVE" || loan.status === "OVERDUE") map[name].active++;
  });
  tbody.innerHTML = Object.keys(map).map(name => {
    const c = map[name];
    const statusHtml = c.active > 0 ? '<span class="status-pill status-active">Active</span>' : '<span class="status-pill status-paid">Clear</span>';
    return `
    <tr>
      <td data-label="Client">${name}</td>
      <td data-label="Phone">${c.phone||"-"}</td>
      <td data-label="Loans">${c.count}</td>
      <td data-label="Borrowed">${formatMoney(c.borrowed)}</td>
      <td data-label="Paid">${formatMoney(c.paid)}</td>
      <td data-label="Sales">-</td>
      <td data-label="Balance">${formatMoney(c.borrowed - c.paid)}</td>
      <td data-label="Status">${statusHtml}</td>
    </tr>`;
  }).join("");
}

function renderAdminsTable() {
  const tbody = el("adminsTableBody");
  if (!tbody) return;
  tbody.innerHTML = (state.admins || []).map(a => `
  <tr>
    <td data-label="ID">#${a.id}</td>
    <td data-label="Name">${a.name}</td>
    <td data-label="Role">${a.role}</td>
    <td data-label="Phone">${a.phone||'-'}</td>
  </tr>`).join("");
}

// ==========================================
// 7. LISTENERS
// ==========================================

function setActiveView(view) {
  document.querySelectorAll("[id^='view-']").forEach(v => v.classList.add("view-hidden"));
  const target = el(`view-${view}`);
  if (target) target.classList.remove("view-hidden");
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.classList.remove("nav-btn-active");
    if (btn.dataset.view === view) btn.classList.add("nav-btn-active");
  });
}

function updateWizard(direction = "next") {
  const step = LOAN_STEPS[wizardStep];
  const wrapper = el("wizardWrapper");
  wrapper.classList.remove("slide-in-right", "slide-out-left", "slide-in-left");
  wrapper.classList.add(direction === "next" ? "slide-in-right" : "slide-in-left");

  el("modalStepLabel").textContent = `Step ${wizardStep + 1} of ${LOAN_STEPS.length}`;
  el("modalFieldLabel").textContent = step.label;
  el("modalHelper").textContent = step.helper;

  el("modalStepDots").innerHTML = LOAN_STEPS.map((_, i) =>
    `<div class="step-dot ${i === wizardStep ? 'active' : ''}"></div>`
  ).join("");

  const container = el("modalFieldContainer");
  container.innerHTML = "";

  let input;
  if (step.type === "select") {
    input = document.createElement("select");
    step.options.forEach(opt => {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      input.appendChild(o);
    });
  } else if (step.type === "textarea") {
    input = document.createElement("textarea");
    input.rows = 3;
  } else {
    input = document.createElement("input");
    input.type = step.type;
    if(step.placeholder) input.placeholder = step.placeholder;
  }

  if (wizardDraft[step.key]) input.value = wizardDraft[step.key];
  input.id = "wizardInput";
  container.appendChild(input);
  setTimeout(() => input.focus(), 100);

  el("modalBackBtn").style.visibility = wizardStep === 0 ? "hidden" : "visible";
  el("modalNextBtn").textContent = wizardStep === LOAN_STEPS.length - 1 ? "Finish & Save" : "Next →";
}

function handleWizardNext() {
  const step = LOAN_STEPS[wizardStep];
  const input = el("wizardInput");
  const val = input.value.trim();

  if (step.required && !val) {
    input.style.border = "1px solid #ef4444";
    setTimeout(() => input.style.border = "", 2000);
    return;
  }
  wizardDraft[step.key] = val;

  if (wizardStep < LOAN_STEPS.length - 1) {
    wizardStep++;
    updateWizard("next");
  } else {
    saveNewLoan();
  }
}

function handleWizardBack() {
  if (wizardStep > 0) {
    wizardStep--;
    updateWizard("back");
  }
}

function saveNewLoan() {
  const newLoan = {
    id: generateLoanId(),
    ...wizardDraft,
    amount: Number(wizardDraft.amount),
    collateralValue: Number(wizardDraft.collateralValue || 0),
    customInterest: wizardDraft.customInterest ? Number(wizardDraft.customInterest) : null,
    paid: 0, saleAmount: 0, isDefaulted: false,
    createdBy: "Admin", createdAt: new Date().toISOString(),
    history: []
  };

  state.loans.unshift(newLoan);
  saveState();
  el("loanModal").classList.add("modal-hidden");
  wizardStep = 0; wizardDraft = {};
  refreshUI();

  // ADDED THIS LINE:
  showToast("Loan created successfully!", "success");
}

function openActionModal(action, loanId) {
  currentAction = action;
  currentLoanId = loanId;
  const loan = state.loans.find(l => l.id === loanId);
  if(!loan) return;

  el("actionModal").classList.remove("modal-hidden");
  const body = el("actionModalBody");

  if (action === "PAY") {
    el("actionModalTitle").textContent = "Record Payment";
    body.innerHTML = `
      <div class="field"><label>Amount</label><input type="number" id="actAmount" value="${Math.ceil(loan.balance)}"></div>
      <div class="field"><label>Date</label><input type="date" id="actDate" value="${getLocalDateVal()}"></div>
    `;
  } else if (action === "NOTE") {
    el("actionModalTitle").textContent = "Edit Note";
    body.innerHTML = `<div class="field"><label>Note</label><textarea id="actNote">${loan.notes||''}</textarea></div>`;
  }
}

// AUTO-REFRESH WHEN OPENING APP
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    console.log("App woke up - refreshing data...");
    if (!TEST_MODE) {
        // Force Firebase to reconnect if it dropped
        firebase.database().goOnline();
    } else {
        // In Test Mode, re-read local storage
        loadFromFirebase();
    }
  }
});


function init() {
  // Nav
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => setActiveView(btn.dataset.view));
  });

  // Modals
  el("openLoanModalBtn")?.addEventListener("click", () => { wizardStep=0; wizardDraft={}; updateWizard(); el("loanModal").classList.remove("modal-hidden"); });
  el("modalCloseBtn")?.addEventListener("click", () => el("loanModal").classList.add("modal-hidden"));
  el("modalNextBtn")?.addEventListener("click", handleWizardNext);
  el("modalBackBtn")?.addEventListener("click", handleWizardBack);

  // Action Modal
  el("actionModalCloseBtn")?.addEventListener("click", () => el("actionModal").classList.add("modal-hidden"));
  el("actionModalCancelBtn")?.addEventListener("click", () => el("actionModal").classList.add("modal-hidden"));

 el("actionModalConfirmBtn")?.addEventListener("click", () => {
     const loan = state.loans.find(l => l.id === currentLoanId);

     if (currentAction === "PAY" && loan) {
        const inputAmt = Number(el("actAmount").value);

        // --- SAFETY CHECK START ---
        // Prevents negative balance (e.g. paying 500 when they only owe 200)
        const maxPay = loan.balance;
        const safeAmt = Math.min(inputAmt, maxPay);
        // --- SAFETY CHECK END ---

        if (safeAmt > 0) {
            loan.paid = (loan.paid || 0) + safeAmt;
            state.repayments.unshift({
                id: generateRepaymentId(),
                loanId: loan.id,
                amount: safeAmt, // Record the SAFE amount, not the typed amount
                date: el("actDate").value
            });
        }
     }
     else if (currentAction === "NOTE" && loan) {
        loan.notes = el("actNote").value;
     }

     saveState();
     refreshUI();
     el("actionModal").classList.add("modal-hidden");

     // TOAST
     if (currentAction === "PAY") showToast("Payment recorded!", "success");
     else showToast("Note updated!", "success");
  });

  // Capital Tabs
  document.querySelectorAll('.mini-tab').forEach(b => {
      b.addEventListener('click', () => {
          document.querySelectorAll('.mini-tab').forEach(t => t.classList.remove('active'));
          document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
          b.classList.add('active');
          el(b.dataset.target).classList.add('active');
      });
  });

  el("setStartingCapitalBtn")?.addEventListener("click", () => {
      const val = Number(el("startingCapitalInitial").value);
      if (val > 0) { state.startingCapital = val; state.startingCapitalSetDate = new Date().toISOString(); saveState(); refreshUI(); }
  });

  el("addCapitalBtn")?.addEventListener("click", () => {
      const input = el("addCapitalInput");
      const val = Number(input.value);

      // FIX: Check for negative values
      if (val <= 0) {
          showToast("Enter a valid positive amount", "error");
          return;
      }

      state.capitalTxns.unshift({ id: generateCapitalTxnId(), amount: val, date: new Date().toISOString(), note: "Manual Add" });
      input.value = "";
      saveState(); refreshUI();
      showToast("Capital added successfully!", "success");
  });

  // EXPORT EXCEL
  el("exportBtn")?.addEventListener("click", () => {
     try {
       const loansData = state.loans.map(l => ({
           ID: l.id,
           Client: l.clientName,
           Phone: l.clientPhone,
           Amount: l.amount,
           Plan: l.plan,
           Start: l.startDate ? l.startDate.split('T')[0] : '-',
           Due: l.dueDate ? l.dueDate.split('T')[0] : '-',
           Balance: l.balance,
           Status: l.status
       }));

       const ws = XLSX.utils.json_to_sheet(loansData);
       const wb = XLSX.utils.book_new();
       XLSX.utils.book_append_sheet(wb, ws, "Loans");
       XLSX.writeFile(wb, "Stallz_Loans.xlsx");
     } catch (e) {
         showToast("Export failed. Check internet connection.", "error");
         console.error(e);
     }
  });
  // SMART HIDE NAVIGATION
  let lastScroll = 0;
  const nav = document.querySelector('.top-nav');

  window.addEventListener('scroll', () => {
    const currentScroll = window.pageYOffset;

    // If scrolling DOWN and not at the top
    if (currentScroll > lastScroll && currentScroll > 50) {
      nav.classList.add('nav-hidden');
    }
    // If scrolling UP
    else {
      nav.classList.remove('nav-hidden');
    }
    lastScroll = currentScroll;
  });

  // Filters
  ["searchInput", "statusFilter", "planFilter"].forEach(id => el(id)?.addEventListener("input", renderLoansTable));
  el("clearFiltersBtn")?.addEventListener("click", () => {
      el("searchInput").value = ""; el("statusFilter").value = "All"; renderLoansTable();
  });

  // Init
  setActiveView("main");
  showWelcomeScreen();
}
document.addEventListener("DOMContentLoaded", init);