// ==========================================
// APP VERSION CONTROL
// ==========================================
const APP_VERSION = "1.6"; // <--- Matches HTML

// ==========================================
// 1. FIREBASE CONFIGURATION & SETUP
// ==========================================

// --- SETTINGS ---
// Set to TRUE for testing offline/local only.
// Set to FALSE for GitHub/Production to use the live database.
const TEST_MODE = true;

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

// Initialize Firebase safely with Persistence
try {
  if (typeof firebase !== "undefined") {
    firebase.initializeApp(firebaseConfig);

    // OPTIMIZATION: Keep user logged in across refreshes
    firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL)
      .catch((error) => console.error("Auth Persistence Error:", error));

    db = firebase.database();
    dataRef = db.ref("loanManagerData_v5");

    console.log("Firebase initialized. Mode: " + (TEST_MODE ? "Test/Offline" : "Live/Online"));
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

// Get local date string YYYY-MM-DD for input fields
function getLocalDateVal() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// --- NEW: SMART THEME ENGINE (Day/Night Toggle) ---
function initTheme() {
  const savedTheme = localStorage.getItem("stallz_theme");
  const btn = document.getElementById("themeToggleBtn");

  // 1. Load Saved Theme or Default to Time
  if (savedTheme) {
      document.documentElement.setAttribute("data-theme", savedTheme);
  } else {
      const hour = new Date().getHours();
      const isDay = hour >= 6 && hour < 18;
      if (isDay) document.documentElement.setAttribute("data-theme", "light");
  }

  // 2. Toggle Listener
  if (btn) {
      btn.onclick = () => {
          const current = document.documentElement.getAttribute("data-theme");
          const newTheme = current === "light" ? "dark" : "light";

          if (newTheme === "light") {
              document.documentElement.setAttribute("data-theme", "light");
          } else {
              document.documentElement.removeAttribute("data-theme");
          }
          localStorage.setItem("stallz_theme", newTheme);
          vibrate([10]); // Haptic feedback
      };
  }
}

// Helper: Format Phone for WhatsApp (Zambia)
function formatWhatsApp(phone) {
  if (!phone) return "";
  let p = phone.replace(/\D/g, ''); // Remove non-digits
  if (p.startsWith('0')) p = '260' + p.substring(1); // 097 -> 26097
  if (p.length === 9) p = '260' + p; // 97... -> 26097...
  return p;
}

// --- TOAST NOTIFICATION (Minimal) ---
function showToast(message, type = "success") {
  const container = el("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  if (type === "success") vibrate([20]);
  if (type === "error") vibrate([30, 30]);

  setTimeout(() => {
    toast.style.animation = "toastFadeOut 0.4s forwards";
    setTimeout(() => toast.remove(), 400);
  }, 2500);
}

// --- SESSION MANAGEMENT ---
function updateSessionActivity() {
  localStorage.setItem("stallz_last_active", Date.now());
}
document.addEventListener("click", updateSessionActivity);
document.addEventListener("keydown", updateSessionActivity);
document.addEventListener("touchstart", updateSessionActivity);

function checkAppVersion() {
  const storedVersion = localStorage.getItem("stallz_app_version");
  const subtitle = document.querySelector(".welcome-subtitle");
  if (subtitle) {
      subtitle.textContent = `Secure Admin Login (v${APP_VERSION})`;
  }

  if (storedVersion !== APP_VERSION) {
    localStorage.setItem("stallz_app_version", APP_VERSION);
    setTimeout(() => {
        showToast(`App Updated to v${APP_VERSION}`, "success");
        vibrate([50, 50, 50]);
    }, 1500);
  }
}

// --- ROLLING COUNTER ANIMATION ---
function animateValue(obj, start, end, duration) {
  if (!obj) return;
  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    const value = Math.floor(progress * (end - start) + start);
    obj.innerHTML = "K" + value.toLocaleString();
    if (progress < 1) {
      window.requestAnimationFrame(step);
    } else {
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
  activeFilters[type] = value;
  const parent = btnElement.parentElement;
  parent.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  btnElement.classList.add('active');
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

const ACTION = { NONE: "NONE", PAY: "PAY", NOTE: "NOTE", WRITEOFF: "WRITEOFF" };
let currentAction = ACTION.NONE;
let currentLoanId = null;

// ==========================================
// 3. AUTHENTICATION & CLOUD SYNC
// ==========================================

function showWelcomeScreen() {
  const screen = el("welcomeScreen");
  const actionBtn = el("authActionBtn");
  const toggleBtn = el("authToggleBtn");
  const errorMsg = el("authError");
  const loader = el("loadingOverlay");

  const regFields = el("registerFields");
  const authTitle = el("authTitle");
  const toggleText = el("authToggleText");

  let isRegisterMode = false;

  // --- 1. AUTO-LOGIN CHECK ---
  const lastActive = localStorage.getItem("stallz_last_active");
  const savedProfile = localStorage.getItem("stallz_user_profile");
  const now = Date.now();
  const THIRTY_MINUTES = 30 * 60 * 1000;

  if (lastActive && (now - lastActive > THIRTY_MINUTES)) {
    console.log("Session expired.");
    if (typeof firebase !== "undefined" && firebase.auth) firebase.auth().signOut();
    localStorage.removeItem("stallz_last_active");
    localStorage.removeItem("stallz_test_session");
    // NOTE: We don't clear profile here so they can login faster
    if (loader) loader.style.display = "none";
    screen.style.display = "flex";
    return;
  }

  // A. RESTORE SAVED USER (Offline/Test Mode)
  if (TEST_MODE && savedProfile) {
       console.log("Restoring saved offline profile...");
       state.user = JSON.parse(savedProfile);
       state.isLoggedIn = true;
       updateSessionActivity();

       screen.style.display = "none";
       if (loader) { loader.style.display = "flex"; loader.style.opacity = "1"; }
       loadFromFirebase();

  }
  // B. REAL FIREBASE AUTH
  else if (typeof firebase !== "undefined" && firebase.auth) {
      firebase.auth().onAuthStateChanged((user) => {
        if (user) {
           if (db) {
             db.ref('users/' + user.uid).once('value').then((snap) => {
                 const profile = snap.val() || {};
                 state.user = { ...user, ...profile };
                 state.isLoggedIn = true;
                 updateSessionActivity();
                 screen.style.display = "none";
                 if (loader) { loader.style.display = "flex"; loader.style.opacity = "1"; }
                 loadFromFirebase();
             });
          }
        } else {
          if (loader) loader.style.display = "none";
          screen.style.display = "flex";
        }
      });
  } else {
      if (loader) loader.style.display = "none";
      screen.style.display = "flex";
  }

  // --- 2. TOGGLE BUTTONS ---
  if (toggleBtn) {
      toggleBtn.onclick = () => {
          isRegisterMode = !isRegisterMode;
          errorMsg.textContent = "";
          if (isRegisterMode) {
              regFields.style.display = "block";
              actionBtn.textContent = "Create Account";
              authTitle.textContent = "Register a new profile";
              toggleText.textContent = "Already have an account?";
              toggleBtn.textContent = "Login";
          } else {
              regFields.style.display = "none";
              actionBtn.textContent = "Login";
              authTitle.textContent = "Sign in with PIN";
              toggleText.textContent = "Don't have an account?";
              toggleBtn.textContent = "Create Account";
          }
      };
  }

  // --- 3. LOGIN / REGISTER ACTION ---
  if (actionBtn) {
    actionBtn.onclick = async () => {
      const email = el("loginEmail").value.trim();
      const password = el("loginPassword").value.trim();

      const name = isRegisterMode ? el("regName").value.trim() : "";
      const phone = isRegisterMode ? el("regPhone").value.trim() : "";
      const nrc = isRegisterMode ? el("regNRC").value.trim() : "";

      if (!email || !password) { showToast("Enter email & PIN", "error"); return; }
      if (isRegisterMode && (!name || !phone || !nrc)) { showToast("All fields required", "error"); return; }

      if (loader) { loader.style.display = "flex"; loader.style.opacity = "1"; }

      // TEST MODE LOGIC
      if (TEST_MODE) {
        setTimeout(() => {
          localStorage.setItem("stallz_test_session", "true");

          let role = "client";
          if (email.includes("admin") || (!isRegisterMode && email === "test@admin.com")) role = "admin";

          const userObj = {
              email: email,
              uid: "test-" + Date.now(),
              displayName: name || "Test User",
              phone: phone,
              nrc: nrc,
              name: name,
              role: role
          };

          state.user = userObj;

          // CRITICAL: SAVE USER PROFILE PERMANENTLY
          localStorage.setItem("stallz_user_profile", JSON.stringify(userObj));

          state.isLoggedIn = true;
          updateSessionActivity();
          screen.style.display = "none";
          loadFromFirebase();

          showToast(isRegisterMode ? "Account created!" : "Welcome back!", "success");
        }, 1000);
        return;
      }

      // FIREBASE LOGIC
      try {
        if (isRegisterMode) {
            const userCredential = await firebase.auth().createUserWithEmailAndPassword(email, password);
            const user = userCredential.user;
            await user.updateProfile({ displayName: name });
            if (db) {
                await db.ref('users/' + user.uid).set({
                    name: name, email: email, phone: phone, nrc: nrc, role: 'client', joinedAt: new Date().toISOString()
                });
            }
        } else {
            await firebase.auth().signInWithEmailAndPassword(email, password);
        }
        updateSessionActivity();
      } catch (error) {
        if (loader) loader.style.display = "none";
        showToast("Authentication failed.", "error");
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
  if (!dataRef) {
      console.warn("No DB connection. Cannot load live data.");
      return;
  }
  dataRef.on("value", (snapshot) => {
    applyData(snapshot.val() || {});
  });
}

function applyData(parsed) {
  const loader = el("loadingOverlay");
  if (loader) {
     loader.style.opacity = "0";
     setTimeout(() => loader.style.display = "none", 500);
  }
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
  // If PENDING, don't compute overdue etc.
  if(loan.status === "PENDING") {
      loan.balance = loan.amount;
      loan.totalDue = loan.amount;
      return;
  }

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

  // 1. Client View?
  if (state.user && state.user.role === 'client') {
      if (typeof renderClientPortal === "function") {
          renderClientPortal();
      } else {
          setTimeout(refreshUI, 100);
      }
      return;
  }

  // 2. Admin View
  try { renderDashboard(); } catch(e) { console.error("Dash Error:", e); }
  try { renderLoansTable(); } catch(e) { console.error("Loans Table Error:", e); }
  try { renderRepaymentsTable(); } catch(e) { console.error("Repay Table Error:", e); }
  try { renderMonthlyTable(); } catch(e) { console.error("Monthly Table Error:", e); }
  try { renderClientsTable(); } catch(e) { console.error("Clients Table Error:", e); }
  try { renderAdminsTable(); } catch(e) { console.error("Admins Table Error:", e); }

  // New: Render Chart
  try { renderCashFlowChart(); } catch(e) { console.error("Chart Error:", e); }

  const clientView = el("view-client-portal");
  if (clientView) clientView.classList.add("view-hidden");
}

function renderDashboard() {
    // 1. Cash on Hand
    const capitalAdded = (state.capitalTxns || []).reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const totalPrincipal = (state.loans || []).filter(l=>l.status!=='PENDING').reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
    const totalRepayments = (state.repayments || []).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

    const startingCap = Number(state.startingCapital) || 0;
    const cashOnHand = (startingCap + capitalAdded + totalRepayments) - totalPrincipal;

    const elCash = el("cashOnHandValue");
    if(elCash) animateValue(elCash, 0, cashOnHand, 1000);

    const elStart = el("startingCapitalValue");
    if(elStart) elStart.textContent = formatMoney(startingCap);

    // 2. Overview Stats
    const activeLoans = state.loans.filter(l => l.status === "ACTIVE" || l.status === "OVERDUE");
    const outstanding = activeLoans.reduce((sum, l) => sum + l.balance, 0);
    const totalProfit = state.loans.reduce((sum, l) => sum + (l.profitCollected || 0), 0);

    // Default Rate (Avoid division by zero)
    const totalLoans = state.loans.filter(l => l.status === 'PAID' || l.status === 'DEFAULTED').length;
    const defaulted = state.loans.filter(l => l.status === 'DEFAULTED').length;
    const defaultRate = totalLoans > 0 ? Math.round((defaulted / totalLoans) * 100) : 0;

    const statsGrid = el("dashboardStats");
    if(statsGrid) {
        statsGrid.innerHTML = `
            <div class="stat-card">
               <div class="stat-label">Outstanding</div>
               <div class="stat-value">${formatMoney(outstanding)}</div>
               <div class="stat-sub">${activeLoans.length} Active Loans</div>
            </div>
            <div class="stat-card">
               <div class="stat-label">Net Profit</div>
               <div class="stat-value" style="color:#22c55e;">${formatMoney(totalProfit)}</div>
               <div class="stat-sub">Realized Gains</div>
            </div>
            <div class="stat-card">
               <div class="stat-label">Default Rate</div>
               <div class="stat-value">${defaultRate}%</div>
               <div class="stat-sub">${defaulted} Written Off</div>
            </div>
        `;
    }
}

// --- CHART RENDERING ENGINE (NEW) ---
let cashFlowChartInstance = null;

function renderCashFlowChart() {
  const ctx = document.getElementById('cashFlowChart');
  if (!ctx || typeof Chart === 'undefined') return;

  // 1. Group Data by Month
  const monthlyData = {};
  const allMonths = new Set();

  (state.loans || []).filter(l => l.status !== 'PENDING').forEach(l => {
      const k = getMonthKey(l.startDate);
      if(k) { allMonths.add(k); monthlyData[k] = monthlyData[k] || { out:0, in:0 }; monthlyData[k].out += Number(l.amount); }
  });

  (state.repayments || []).forEach(r => {
      const k = getMonthKey(r.date);
      if(k) { allMonths.add(k); monthlyData[k] = monthlyData[k] || { out:0, in:0 }; monthlyData[k].in += Number(r.amount); }
  });

  const sortedMonths = Array.from(allMonths).sort().slice(-6); // Last 6 months
  const labels = sortedMonths.map(m => {
      const [y, mo] = m.split('-');
      return new Date(y, mo-1).toLocaleDateString('en-US', { month:'short' });
  });
  const dataOut = sortedMonths.map(m => monthlyData[m].out);
  const dataIn = sortedMonths.map(m => monthlyData[m].in);

  // 2. Destroy Old Chart
  if (cashFlowChartInstance) cashFlowChartInstance.destroy();

  // 3. Render New Chart
  cashFlowChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        { label: 'Lent Out', data: dataOut, backgroundColor: '#ef4444', borderRadius: 4 },
        { label: 'Collected', data: dataIn, backgroundColor: '#22c55e', borderRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#94a3b8' } } },
      scales: {
        y: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        x: { ticks: { color: '#64748b' }, grid: { display: false } }
      }
    }
  });
}

function renderLoansTable() {
  const overdueCount = (state.loans || []).filter(l => l.status === "OVERDUE").length;
  const badge = el("clientBadge");

  if (badge) {
    if (overdueCount > 0) badge.classList.add("show");
    else badge.classList.remove("show");
  }

  const tbody = el("loansTableBody");
  if (!tbody) return;

  const search = (el("searchInput")?.value || "").toLowerCase();
  const statusFilter = activeFilters.status;
  const planFilter = activeFilters.plan;

  const visibleLoans = (state.loans || []).filter(l => {
     const matchSearch = !search || (l.clientName && l.clientName.toLowerCase().includes(search));
     const matchStatus = statusFilter === "All" || l.status === statusFilter;
     const matchPlan = planFilter === "All" || l.plan === planFilter;
     return matchSearch && matchStatus && matchPlan;
  });

  if (el("loansCountLabel")) el("loansCountLabel").textContent = `${visibleLoans.length} records`;
  if(el("emptyState")) {
      const shouldShow = state.dataLoaded && visibleLoans.length === 0;
      el("emptyState").style.display = shouldShow ? "block" : "none";
  }

  tbody.innerHTML = visibleLoans.map((l, index) => {
    const percent = Math.min(100, Math.round(((l.paid || 0) / (l.totalDue || 1)) * 100));
    let progressColor = "var(--primary)";

    if (percent >= 100) progressColor = "#22c55e";
    else if (l.status === "OVERDUE") progressColor = "#ef4444";
    else if (l.status === "DEFAULTED") progressColor = "#64748b";
    else if (l.status === "PENDING") progressColor = "#f59e0b"; // Orange

    const isOverdue = l.status === "OVERDUE";
    const balanceStyle = isOverdue ? 'class="text-danger-glow" style="font-weight:bold;"' : 'style="font-weight:bold;"';
    const avatarClass = `avatar-${l.id % 5}`;

    const waNumber = formatWhatsApp(l.clientPhone);
    const waMsg = encodeURIComponent(`Hi ${l.clientName}, friendly reminder from Stallz Loans. Your balance of ${formatMoney(l.balance)} was due on ${formatDate(l.dueDate)}.`);
    const waLink = waNumber ? `https://wa.me/${waNumber}?text=${waMsg}` : "#";
    const waStyle = waNumber ? "color:#4ade80;" : "color:#64748b; cursor:not-allowed;";

    const isClosed = l.status === "PAID" || l.status === "DEFAULTED";

    return `
    <tr class="row-${(l.status || 'active').toLowerCase()}">
      <td data-label="ID"><span style="opacity:0.5; font-size:0.8rem;">#${l.id}</span></td>

      <td data-label="Client">
        <div class="client-flex">
          <div class="avatar ${avatarClass}">${getInitials(l.clientName)}</div>
          <div>
            <div style="font-weight:600; color:var(--text-main);">${l.clientName}</div>
            <div class="subtle" style="font-size:0.75rem;">${l.clientPhone||''}</div>
          </div>
        </div>
      </td>

      <td data-label="Item"><span style="color:var(--text-muted);">${l.collateralItem || '-'}</span></td>

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
      <td data-label="Due">${l.status === 'PENDING' ? 'Pending' : formatDate(l.dueDate)}</td>
      <td data-label="Balance" ${balanceStyle}>${formatMoney(l.balance)}</td>
      <td data-label="Status"><span class="status-pill status-${(l.status||'active').toLowerCase()}">${l.status}</span></td>

      <td data-label="Actions" style="text-align:right; white-space:nowrap;">

        ${l.status === "PENDING" ? `
            <button class="btn-icon" onclick="approveLoan(${l.id})" title="Approve Request" style="color:#22c55e; border:1px solid #22c55e; border-radius:4px; padding:2px 6px; font-size:0.75rem; width:auto; margin-right:4px;">✔ Approve</button>
        ` : ''}

        <button class="btn-icon" onclick="openReceipt(${l.id})" title="Print Receipt">🧾</button>
        <a href="${waLink}" target="_blank" class="btn-icon" style="${waStyle}; text-decoration:none; display:inline-block;" title="Send WhatsApp Reminder">💬</a>
        <button class="btn-icon" onclick="openActionModal('PAY', ${l.id})" title="Pay" style="color:#38bdf8;" ${isClosed ? 'disabled style="opacity:0.3"' : ''}>💵</button>
        <button class="btn-icon" onclick="openActionModal('WRITEOFF', ${l.id})" title="Write Off (Bad Debt)" style="color:#f87171;" ${isClosed ? 'disabled style="opacity:0.3"' : ''}>🚫</button>
        <button class="btn-icon" onclick="openActionModal('NOTE', ${l.id})" title="Edit Note">✏️</button>
      </td>
    </tr>
  `}).join("");
}

// --- NEW HELPER: APPROVE LOAN ---
function approveLoan(id) {
    if(!confirm("Approve this loan request? The timer will start now.")) return;

    const loan = state.loans.find(l => l.id === id);
    if (loan) {
        loan.status = "ACTIVE";
        loan.startDate = new Date().toISOString();

        // Recalculate due date based on plan
        computeDerivedFields(loan);

        saveState();
        refreshUI();
        showToast("Loan Approved & Active!", "success");
    }
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
  (state.loans || []).filter(l => l.status !== 'PENDING').forEach(loan => {
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

  const clientMap = {};

  (state.loans || []).forEach(loan => {
    const name = (loan.clientName || "Unknown").trim();
    if (!clientMap[name]) {
        clientMap[name] = {
            name: name,
            phone: loan.clientPhone,
            loans: [],
            defaults: 0,
            overdues: 0
        };
    }
    clientMap[name].loans.push(loan);
    if (loan.status === "DEFAULTED") clientMap[name].defaults++;
    if (loan.status === "OVERDUE") clientMap[name].overdues++;
  });

  const clientRows = Object.values(clientMap).map(c => {
    const borrowed = c.loans.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    const paid = c.loans.reduce((s, l) => s + (Number(l.paid) || 0), 0);
    const balance = c.loans.reduce((s, l) => s + (Number(l.balance) || 0), 0);
    const activeCount = c.loans.filter(l => l.status === "ACTIVE" || l.status === "OVERDUE").length;

    let score = 100;
    score -= (c.defaults * 50);
    score -= (c.overdues * 15);

    let stars = "⭐⭐⭐⭐⭐";
    let ratingColor = "#4ade80";

    if (score < 50) { stars = "⚠️ RISKY"; ratingColor = "#ef4444"; }
    else if (score < 70) { stars = "⭐⭐"; ratingColor = "#fbbf24"; }
    else if (score < 90) { stars = "⭐⭐⭐"; ratingColor = "#facc15"; }
    else if (score < 100) { stars = "⭐⭐⭐⭐"; ratingColor = "#a3e635"; }

    return { ...c, borrowed, paid, balance, activeCount, stars, ratingColor };
  });

  tbody.innerHTML = clientRows.map(c => {
    const statusHtml = c.activeCount > 0
        ? '<span class="status-pill status-active">Active</span>'
        : '<span class="status-pill status-paid">Clear</span>';

    return `
    <tr>
      <td data-label="Client">
        <div style="font-weight:bold;">${c.name}</div>
        <div style="font-size:0.75rem; color:${c.ratingColor}; margin-top:2px;">${c.stars}</div>
      </td>
      <td data-label="Phone">${c.phone||"-"}</td>
      <td data-label="History">
        <div style="font-size:0.8rem;">${c.loans.length} Loans</div>
        <div style="font-size:0.7rem; opacity:0.7;">${c.defaults} Defaults</div>
      </td>
      <td data-label="Borrowed">${formatMoney(c.borrowed)}</td>
      <td data-label="Paid">${formatMoney(c.paid)}</td>
      <td data-label="Balance" style="${c.balance > 0 ? 'color:var(--primary); font-weight:bold;' : ''}">${formatMoney(c.balance)}</td>
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
    input.setAttribute("autocomplete", "off");

    if (step.key === "clientName") {
       input.setAttribute("list", "clientList");
       const uniqueClients = [...new Set(state.loans.map(l => l.clientName))].sort();
       const dataList = document.getElementById("clientList");
       if(dataList) dataList.innerHTML = uniqueClients.map(name => `<option value="${name}">`).join("");
    }
  }

  if (wizardDraft[step.key]) input.value = wizardDraft[step.key];
  input.id = "wizardInput";
  container.appendChild(input);

  if (step.type === "date") {
    const chipContainer = document.createElement("div");
    chipContainer.style.cssText = "display:flex; gap:10px; margin-top:12px;";

    const createChip = (text, dateVal) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-secondary btn-sm";
      btn.style.cssText = "padding:6px 12px; font-size:0.75rem; border-radius:20px; border:1px solid var(--primary); color:var(--primary); background:rgba(59, 130, 246, 0.1);";
      btn.textContent = text;
      btn.onclick = () => {
        el("wizardInput").value = dateVal;
        vibrate([20]);
      };
      return btn;
    };

    chipContainer.appendChild(createChip("Today", getLocalDateVal()));
    const y = new Date(); y.setDate(y.getDate() - 1);
    chipContainer.appendChild(createChip("Yesterday", y.toISOString().split('T')[0]));

    container.appendChild(chipContainer);
  }

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
  showToast("Loan created successfully!", "success");
}

function openActionModal(action, loanId) {
  currentAction = action;
  currentLoanId = loanId;
  const loan = state.loans.find(l => l.id === loanId);
  if(!loan) return;

  el("actionModal").classList.remove("modal-hidden");
  const body = el("actionModalBody");
  const title = el("actionModalTitle");

  if (action === "PAY") {
    title.textContent = "Record Payment";
    body.innerHTML = `
      <div class="field"><label>Amount</label><input type="number" id="actAmount" value="${Math.ceil(loan.balance)}"></div>
      <div class="field"><label>Date</label><input type="date" id="actDate" value="${getLocalDateVal()}"></div>
    `;
  } else if (action === "NOTE") {
    title.textContent = "Edit Note";
    body.innerHTML = `<div class="field"><label>Note</label><textarea id="actNote">${loan.notes||''}</textarea></div>`;
  } else if (action === "WRITEOFF") {
    title.textContent = "Write Off Loan";
    body.innerHTML = `
      <div style="background:rgba(239, 68, 68, 0.1); border:1px solid #ef4444; padding:12px; border-radius:8px; color:#fca5a5;">
        <strong>⚠️ Warning:</strong> You are about to mark this loan as <strong>Bad Debt</strong>.
        <br><br>
        This will stop the timer and remove the balance from your "Outstanding" assets. This action is final.
      </div>
      <div class="field" style="margin-top:16px;"><label>Reason (Optional)</label><textarea id="actNote" placeholder="e.g. Client relocated, uncontactable..."></textarea></div>
    `;
  }
}

// ==========================================
// 8. MOBILE UX ENHANCEMENTS
// ==========================================

function vibrate(pattern = [15]) {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    navigator.vibrate(pattern);
  }
}

function setupMobileUX() {
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = el("installAppBtn");
    if (btn) {
      btn.style.display = "inline-flex";
      btn.addEventListener('click', () => {
        vibrate([30]);
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choiceResult) => {
          if (choiceResult.outcome === 'accepted') {
            btn.style.display = 'none';
          }
          deferredPrompt = null;
        });
      });
    }
  });

  let longPressTimer;
  const touchDuration = 800;

  document.addEventListener("touchstart", (e) => {
    const row = e.target.closest("tr");
    if (!row) return;
    const idCell = row.querySelector("td[data-label='ID'] span");
    if (!idCell) return;
    const idText = idCell.textContent.replace('#', '');
    const loanId = parseInt(idText);

    if (loanId) {
      longPressTimer = setTimeout(() => {
        vibrate([40, 40]);
        openActionModal("PAY", loanId);
      }, touchDuration);
    }
  }, { passive: true });

  document.addEventListener("touchend", () => clearTimeout(longPressTimer));
  document.addEventListener("touchmove", () => clearTimeout(longPressTimer));

  // iOS Install Instructions
  const isIos = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
  const isStandalone = window.navigator.standalone === true;
  if (isIos && !isStandalone) {
      setTimeout(() => {
          const modal = document.getElementById("iosInstallModal");
          if(modal) modal.classList.remove("modal-hidden");
      }, 2000);
  }
  document.getElementById("closeIosModalBtn")?.addEventListener("click", () => {
    document.getElementById("iosInstallModal").classList.add("modal-hidden");
  });
}

const originalShowToast = showToast;
showToast = function(message, type = "success") {
  if (type === "success") vibrate([30]);
  if (type === "error") vibrate([40, 40, 40]);
  originalShowToast(message, type);
};

// ==========================================
// 9. MAIN INIT
// ==========================================
function init() {
  // 1. Navigation
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      vibrate([10]);
      setActiveView(btn.dataset.view);
    });
  });

  // 2. Wizard Modals
  const openLoanBtn = el("openLoanModalBtn");
  if (openLoanBtn) {
      openLoanBtn.addEventListener("click", () => {
        vibrate([10]);
        wizardStep = 0;
        wizardDraft = {};
        updateWizard();
        el("loanModal").classList.remove("modal-hidden");
      });
  }

  el("modalCloseBtn")?.addEventListener("click", () => el("loanModal").classList.add("modal-hidden"));
  el("modalNextBtn")?.addEventListener("click", () => { vibrate([10]); handleWizardNext(); });
  el("modalBackBtn")?.addEventListener("click", () => { vibrate([10]); handleWizardBack(); });

  // 3. Action Modals
  el("actionModalCloseBtn")?.addEventListener("click", () => el("actionModal").classList.add("modal-hidden"));
  el("actionModalCancelBtn")?.addEventListener("click", () => el("actionModal").classList.add("modal-hidden"));

  el("actionModalConfirmBtn")?.addEventListener("click", () => {
     vibrate([20]);
     const loan = state.loans.find(l => l.id === currentLoanId);

     if (currentAction === "PAY" && loan) {
        const inputAmt = Number(el("actAmount").value);
        const maxPay = loan.balance;
        const safeAmt = Math.min(inputAmt, maxPay);

        if (safeAmt > 0) {
            loan.paid = (loan.paid || 0) + safeAmt;
            state.repayments.unshift({
                id: generateRepaymentId(),
                loanId: loan.id,
                amount: safeAmt,
                date: el("actDate").value,
                recordedBy: state.user ? (state.user.email || "Admin") : "System"
            });
        }
     }
     else if (currentAction === "NOTE" && loan) {
        loan.notes = el("actNote").value;
     }
     else if (currentAction === "WRITEOFF" && loan) {
        loan.isDefaulted = true;
        loan.status = "DEFAULTED";
        const reason = el("actNote").value;
        if(reason) loan.notes = (loan.notes ? loan.notes + "\n" : "") + "[Write-Off]: " + reason;
     }

     saveState();
     refreshUI();
     el("actionModal").classList.add("modal-hidden");

     if (currentAction === "PAY") showToast("Payment recorded!", "success");
     else if (currentAction === "WRITEOFF") showToast("Loan written off", "error");
     else showToast("Note updated!", "success");
  });

  // 4. Capital Tabs
  document.querySelectorAll('.mini-tab').forEach(b => {
      b.addEventListener('click', () => {
          vibrate([10]);
          document.querySelectorAll('.mini-tab').forEach(t => t.classList.remove('active'));
          document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
          b.classList.add('active');
          el(b.dataset.target).classList.add('active');
      });
  });

  // 5. Capital Actions
  el("setStartingCapitalBtn")?.addEventListener("click", () => {
      const val = Number(el("startingCapitalInitial").value);
      if (val > 0) {
          state.startingCapital = val;
          state.startingCapitalSetDate = new Date().toISOString();
          saveState();
          refreshUI();
      }
  });

  el("addCapitalBtn")?.addEventListener("click", () => {
      const input = el("addCapitalInput");
      const val = Number(input.value);
      if (val <= 0) {
          showToast("Enter a valid positive amount", "error");
          return;
      }
      state.capitalTxns.unshift({
          id: generateCapitalTxnId(),
          amount: val,
          date: new Date().toISOString(),
          note: "Manual Add"
      });
      input.value = "";
      saveState();
      refreshUI();
      showToast("Capital added successfully!", "success");
  });

  // 6. Export
  el("exportBtn")?.addEventListener("click", () => {
     vibrate([20]);
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
         showToast("Export failed.", "error");
         console.error(e);
     }
  });

  // 7. Scroll Nav
  let lastScroll = 0;
  const nav = document.querySelector('.top-nav');
  if (nav) {
    window.addEventListener('scroll', () => {
      const currentScroll = window.pageYOffset;
      if (currentScroll > lastScroll && currentScroll > 50) {
        nav.classList.add('nav-hidden');
      } else {
        nav.classList.remove('nav-hidden');
      }
      lastScroll = currentScroll;
    }, { passive: true });
  }

  ["searchInput", "statusFilter", "planFilter"].forEach(id => el(id)?.addEventListener("input", renderLoansTable));

  // 8. Admin Logout
  const adminLogoutBtn = el("adminLogoutBtn");
  if (adminLogoutBtn) {
      adminLogoutBtn.addEventListener("click", () => {
          vibrate([20]);
          if (confirm("Log out of Admin Dashboard?")) {
              localStorage.removeItem("stallz_test_session");
              localStorage.removeItem("stallz_last_active");
              if (typeof firebase !== "undefined" && firebase.auth) firebase.auth().signOut();
              state.user = null;
              state.isLoggedIn = false;
              location.reload();
          }
      });
  }

  // 9. Startup Sequence
  initTheme(); // NEW: Smart Theme
  setActiveView("main");
  showWelcomeScreen();
  checkAppVersion();
  setupMobileUX();
}

document.addEventListener("DOMContentLoaded", init);