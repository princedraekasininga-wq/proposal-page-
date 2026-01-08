// =========================================
// CLIENT PORTAL LOGIC (v3.0 - Floating Nav)
// =========================================

function renderClientPortal() {
  console.log("Rendering Client Portal...");

  // 1. UI Setup
  const header = document.querySelector("header");
  const topNav = document.querySelector(".top-nav");
  const adminLogout = document.getElementById("adminLogoutBtn");

  if (header) header.style.display = "flex";
  if (topNav) topNav.style.display = "none";
  if (adminLogout) adminLogout.style.display = "none";

  document.querySelectorAll("[id^='view-']").forEach(v => v.classList.add("view-hidden"));
  const view = document.getElementById("view-client-portal");
  if (view) view.classList.remove("view-hidden");

  // 2. Fetch Data
  const myPhone = state.user.phone ? state.user.phone.replace(/\D/g, '') : "";
  const myLoans = state.loans.filter(l => {
      const loanPhone = (l.clientPhone || "").replace(/\D/g, '');
      return loanPhone.includes(myPhone) || (myPhone && myPhone.includes(loanPhone));
  });

  // 3. Render Tier Card
  let score = 50;
  // ... (Your existing Tier Logic here) ...
  const paidCount = myLoans.filter(l => l.status === "PAID").length;
  score += (paidCount * 10);

  let tier = { name: "Bronze Member", class: "tier-bronze", icon: "🥉", limit: "K500" };
  if (score >= 80) tier = { name: "Silver Member", class: "tier-silver", icon: "🥈", limit: "K2,000" };
  if (score >= 150) tier = { name: "Gold Member", class: "tier-gold", icon: "🥇", limit: "K5,000" };

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

  // 4. Update Header
  const elName = document.getElementById("cpClientName");
  if(elName) elName.textContent = state.user.name || "Client";

  const activeLoan = myLoans.find(l => l.status === "ACTIVE" || l.status === "OVERDUE");
  const totalBalance = activeLoan ? activeLoan.balance : 0;

  const elBalance = document.getElementById("cpBalance");
  if(elBalance) elBalance.textContent = formatMoney(totalBalance);

  // 5. FLOATING MENU LOGIC
  const fabBtn = document.getElementById("fabMainBtn");
  const fabMenu = document.getElementById("fabMenu");

  if (fabBtn && fabMenu) {
      fabBtn.onclick = () => {
          fabBtn.classList.toggle("open");
          fabMenu.classList.toggle("show");
          if(typeof vibrate === "function") vibrate([10]);
      };
  }

  // --- A. CALCULATOR ---
  const btnCalc = document.getElementById("fabCalculator");
  const modalCalc = document.getElementById("calculatorModal");
  const closeCalc = document.getElementById("closeCalcModal");

  if (btnCalc) {
      btnCalc.onclick = () => {
          modalCalc.classList.remove("modal-hidden");
          fabMenu.classList.remove("show");
          fabBtn.classList.remove("open");
      };
  }
  if (closeCalc) {
      closeCalc.onclick = () => modalCalc.classList.add("modal-hidden");
  }

  // Calculator Math
  const mAmount = document.getElementById("modalCalcAmount");
  const mPlan = document.getElementById("modalCalcPlan");
  const mResult = document.getElementById("modalCalcResult");

  const runCalc = () => {
      const val = parseFloat(mAmount.value) || 0;
      let rate = 0.20;
      if (mPlan.value === "2 Weeks") rate = 0.30;
      if (mPlan.value === "3 Weeks") rate = 0.35;
      if (mPlan.value === "Monthly") rate = 0.40;
      mResult.textContent = formatMoney(val * (1 + rate));
  };
  if(mAmount && mPlan) {
      mAmount.oninput = runCalc;
      mPlan.onchange = runCalc;
  }

  // --- B. REQUEST LOAN ---
  const btnReq = document.getElementById("fabRequestLoan");
  if (btnReq) {
      btnReq.onclick = () => {
          const amount = prompt("Amount to borrow (e.g. 500):");
          if(!amount) return;
          const item = prompt("Collateral item:");
          if(!item) return;

          const newRequest = {
             id: Date.now(),
             clientName: state.user.name,
             clientPhone: state.user.phone,
             amount: Number(amount),
             collateralItem: item,
             status: "PENDING",
             startDate: new Date().toISOString(),
             plan: "Weekly",
             balance: Number(amount)
          };

          if(state.loans) state.loans.unshift(newRequest);
          if(typeof saveState === "function") saveState();

          const adminPhone = "260970000000";
          const text = `Hi, I request a loan.\n\n💰 K${amount}\n🎒 ${item}`;
          window.open(`https://wa.me/${adminPhone}?text=${encodeURIComponent(text)}`, '_blank');

          if(typeof showToast === "function") showToast("Request sent!", "success");
          setTimeout(() => location.reload(), 1000);
      };
  }

  // --- C. PAY ---
  const fabPay = document.getElementById("fabPay");
  if (fabPay) {
      fabPay.onclick = () => {
          const adminPhone = "260970000000";
          const msg = `Hi, I want to pay my balance of ${formatMoney(totalBalance)}.`;
          window.open(`https://wa.me/${adminPhone}?text=${encodeURIComponent(msg)}`, '_blank');
      };
  }
}