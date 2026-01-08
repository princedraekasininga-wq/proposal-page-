// =========================================
// CLIENT PORTAL LOGIC (v2.0 - Calculator & Fixes)
// =========================================

function renderClientPortal() {
  console.log("Rendering Client Portal...");

  // ==========================================
  // 1. MANAGE UI ELEMENTS (Show Header, Hide Admin Nav)
  // ==========================================
  const header = document.querySelector("header");
  const topNav = document.querySelector(".top-nav");
  const fab = document.querySelector("#fabAddBtn");
  const adminLogout = document.getElementById("adminLogoutBtn");

  // SHOW HEADER (Logo + Rates)
  if (header) header.style.display = "flex";

  // HIDE ADMIN CONTROLS
  if (topNav) topNav.style.display = "none";
  if (fab) fab.style.display = "none";
  if (adminLogout) adminLogout.style.display = "none"; // Hide Admin Logout

  // Hide all Admin Views
  document.querySelectorAll("[id^='view-']").forEach(v => v.classList.add("view-hidden"));

  // Show Client View
  const view = document.getElementById("view-client-portal");
  if (view) view.classList.remove("view-hidden");


  // ==========================================
  // 2. FETCH & FILTER DATA
  // ==========================================
  const myPhone = state.user.phone ? state.user.phone.replace(/\D/g, '') : "";

  const myLoans = state.loans.filter(l => {
      const loanPhone = (l.clientPhone || "").replace(/\D/g, '');
      return loanPhone.includes(myPhone) || (myPhone && myPhone.includes(loanPhone));
  });

  // Calculate Active Balance
  const activeLoan = myLoans.find(l => l.status === "ACTIVE" || l.status === "OVERDUE");
  const totalBalance = activeLoan ? activeLoan.balance : 0;


  // ==========================================
  // 3. TIER & TRUST SCORE LOGIC
  // ==========================================
  let score = 50; // Start with 50 points
  const paidCount = myLoans.filter(l => l.status === "PAID").length;
  const defaultCount = myLoans.filter(l => l.status === "DEFAULTED").length;

  score += (paidCount * 10); // +10 points per paid loan
  score -= (defaultCount * 50); // -50 points per default
  if (activeLoan && activeLoan.status === "OVERDUE") score -= 20;

  let tier = { name: "Bronze Member", class: "tier-bronze", icon: "🥉", limit: "K500" };
  if (score >= 80) tier = { name: "Silver Member", class: "tier-silver", icon: "🥈", limit: "K2,000" };
  if (score >= 150) tier = { name: "Gold Member", class: "tier-gold", icon: "🥇", limit: "K5,000" };
  if (score >= 300) tier = { name: "Platinum VIP", class: "tier-platinum", icon: "💎", limit: "K10,000+" };


  // ==========================================
  // 4. UPDATE UI ELEMENTS
  // ==========================================

  const elName = document.getElementById("cpClientName");
  if(elName) elName.textContent = state.user.name || state.user.displayName || "Client";

  const elBalance = document.getElementById("cpBalance");
  if(elBalance) elBalance.textContent = formatMoney(totalBalance);

  // Render Tier Card
  const tierContainer = document.getElementById("cpTierContainer");
  if (tierContainer) {
      tierContainer.innerHTML = `
        <div class="cp-tier-card ${tier.class}">
            <div class="cp-tier-icon">${tier.icon}</div>
            <div class="cp-tier-info">
                <h3>${tier.name}</h3>
                <p>Trust Score: ${score}</p>
            </div>
            <div class="cp-tier-limit">
                <span>Limit</span>
                <strong>${tier.limit}</strong>
            </div>
        </div>
      `;
  }

  const elDate = document.getElementById("cpDueDate");
  if (elDate) {
      if (activeLoan) {
          elDate.textContent = `Due: ${formatDate(activeLoan.dueDate)}`;
          elDate.style.background = activeLoan.status === "OVERDUE" ? "#ef4444" : "rgba(255,255,255,0.2)";
      } else {
          elDate.textContent = "No active loans";
          elDate.style.background = "rgba(255,255,255,0.1)";
      }
  }

  // Render History Table
  const tbody = document.getElementById("cpHistoryBody");
  if (tbody) {
      tbody.innerHTML = myLoans.map(l => `
         <tr>
           <td>${formatDate(l.startDate)}</td>
           <td>${l.collateralItem}</td>
           <td>${formatMoney(l.amount)}</td>
           <td><span class="status-pill status-${(l.status||'').toLowerCase()}">${l.status}</span></td>
         </tr>
      `).join("");
  }


  // ==========================================
  // 5. BUTTON ACTIONS & TOOLS
  // ==========================================

  // --- LOAN CALCULATOR LOGIC (NEW) ---
  const calcAmount = document.getElementById("calcAmount");
  const calcPlan = document.getElementById("calcPlan");
  const calcResult = document.getElementById("calcResult");

  const updateCalc = () => {
      const val = parseFloat(calcAmount.value) || 0;
      let rate = 0.20; // Default Weekly
      if (calcPlan.value === "2 Weeks") rate = 0.30;
      if (calcPlan.value === "3 Weeks") rate = 0.35;
      if (calcPlan.value === "Monthly") rate = 0.40;

      const total = val * (1 + rate);
      if(calcResult) calcResult.textContent = formatMoney(total);
  };

  if (calcAmount && calcPlan) {
      calcAmount.oninput = updateCalc;
      calcPlan.onchange = updateCalc;
  }

  // Refresh Button
  const btnRefresh = document.getElementById("cpRefreshBtn");
  if (btnRefresh) {
      btnRefresh.onclick = () => {
          if(typeof loadFromFirebase === "function") loadFromFirebase();
          if(typeof showToast === "function") showToast("Refreshing...", "success");
      };
  }

  // Request Loan Button (Creates PENDING Loan + WhatsApp)
  const btnRequest = document.getElementById("cpRequestBtn");
  if (btnRequest) {
      btnRequest.onclick = () => {
          const amount = prompt("How much do you want to borrow? (e.g. 500)");
          if(!amount) return;

          const item = prompt("What are you offering as collateral? (e.g. Phone, Laptop)");
          if(!item) return;

          // 1. Create Pending Loan
          const newRequest = {
             id: Date.now(),
             clientName: state.user.name || "Client",
             clientPhone: state.user.phone || "",
             amount: Number(amount),
             collateralItem: item,
             status: "PENDING",
             startDate: new Date().toISOString(),
             plan: "Weekly",
             balance: Number(amount),
             totalDue: Number(amount)
          };

          // 2. Save
          if(state.loans) state.loans.unshift(newRequest);
          if (typeof saveState === "function") saveState();

          // 3. WhatsApp
          const adminPhone = "260970000000"; // <--- UPDATE YOUR NUMBER
          const text = `Hi, I have requested a loan in the app.\n\n💰 Amount: K${amount}\n🎒 Collateral: ${item}`;
          window.open(`https://wa.me/${adminPhone}?text=${encodeURIComponent(text)}`, '_blank');

          if (typeof showToast === "function") showToast("Request sent!", "success");
          setTimeout(() => location.reload(), 1000);
      };
  }

  const btnPay = document.getElementById("cpPayBtn");
  if (btnPay) {
      btnPay.onclick = () => {
          const adminPhone = "260970000000"; // <--- UPDATE YOUR NUMBER
          const msg = `Hi, I want to pay my balance of ${formatMoney(totalBalance)}.`;
          window.open(`https://wa.me/${adminPhone}?text=${encodeURIComponent(msg)}`, '_blank');
      };
  }

  // Logout Button (Stops Auto-Login Loop)
  const btnLogout = document.getElementById("cpLogoutBtn");
  if (btnLogout) {
      btnLogout.onclick = () => {
          localStorage.removeItem("stallz_test_session");
          localStorage.removeItem("stallz_last_active");
          localStorage.removeItem("stallz_user_profile"); // <--- CRITICAL FIX

          if (typeof firebase !== "undefined" && firebase.auth) firebase.auth().signOut();
          location.reload();
      };
  }
}