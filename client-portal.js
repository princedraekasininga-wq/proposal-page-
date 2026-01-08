// =========================================
// CLIENT PORTAL LOGIC
// =========================================

function renderClientPortal() {
  console.log("Rendering Client Portal...");

  // 1. Hide ALL Admin Elements
  const header = document.querySelector("header");
  const topNav = document.querySelector(".top-nav");
  const fab = document.querySelector("#fabAddBtn");

  if (header) header.style.display = "none";
  if (topNav) topNav.style.display = "none";
  if (fab) fab.style.display = "none";

  // Hide all other views
  document.querySelectorAll("[id^='view-']").forEach(v => v.classList.add("view-hidden"));

  // Show Client View
  const view = document.getElementById("view-client-portal");
  if (view) view.classList.remove("view-hidden");

  // 2. Filter Loans for this Client (Match by Phone)
  // We sanitize phone numbers to ensure a match (remove spaces, +260)
  const myPhone = state.user.phone ? state.user.phone.replace(/\D/g, '') : "";

  const myLoans = state.loans.filter(l => {
      const loanPhone = (l.clientPhone || "").replace(/\D/g, '');
      return loanPhone.includes(myPhone) || (myPhone && myPhone.includes(loanPhone));
  });

  // 3. Calculate Totals
  const activeLoan = myLoans.find(l => l.status === "ACTIVE" || l.status === "OVERDUE");
  const totalBalance = activeLoan ? activeLoan.balance : 0;

  // 4. Update UI Elements
  const elName = document.getElementById("cpClientName");
  if(elName) elName.textContent = state.user.name || state.user.displayName || "Client";

  const elBalance = document.getElementById("cpBalance");
  if(elBalance) elBalance.textContent = formatMoney(totalBalance);

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

  // 5. Render History Table
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

  // 6. Attach Button Actions
  // Refresh
  const btnRefresh = document.getElementById("cpRefreshBtn");
  if (btnRefresh) {
      btnRefresh.onclick = () => {
          loadFromFirebase(); // Calls function from app.js
          showToast("Refreshing data...", "success");
      };
  }

  // Pay (WhatsApp)
  const btnPay = document.getElementById("cpPayBtn");
  if (btnPay) {
      btnPay.onclick = () => {
          const adminPhone = "260970000000"; // <--- CHANGE THIS TO YOUR NUMBER
          const msg = `Hi, I want to pay my balance of ${formatMoney(totalBalance)}.`;
          window.open(`https://wa.me/${adminPhone}?text=${encodeURIComponent(msg)}`, '_blank');
      };
  }

  // Logout
  const btnLogout = document.getElementById("cpLogoutBtn");
  if (btnLogout) {
      btnLogout.onclick = () => {
          if (typeof firebase !== "undefined") firebase.auth().signOut();
          location.reload();
      };
  }
}