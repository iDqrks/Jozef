document.addEventListener("DOMContentLoaded", () => {
  const LOCAL_STATS_KEY = "mekanders_local_stats_v1";

  function recordLocalVisit() {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const raw = localStorage.getItem(LOCAL_STATS_KEY);
      const stats = raw
        ? JSON.parse(raw)
        : { totalVisits: 0, uniqueVisitors: 0, visitsToday: 0, totalOrders: 0, dailyVisits: {}, recentEvents: [] };

      if (!localStorage.getItem("mekanders_local_vid")) {
        localStorage.setItem("mekanders_local_vid", "1");
        stats.uniqueVisitors = (stats.uniqueVisitors || 0) + 1;
      }

      stats.totalVisits = (stats.totalVisits || 0) + 1;
      stats.dailyVisits = stats.dailyVisits || {};
      stats.dailyVisits[today] = (stats.dailyVisits[today] || 0) + 1;
      stats.visitsToday = stats.dailyVisits[today];
      stats.recentEvents = stats.recentEvents || [];
      stats.recentEvents.unshift({ type: "visit", timestamp: new Date().toISOString() });
      stats.recentEvents = stats.recentEvents.slice(0, 25);

      localStorage.setItem(LOCAL_STATS_KEY, JSON.stringify(stats));
    } catch {}
  }

  function recordLocalOrder(packageType, deliveryMethod) {
    try {
      const raw = localStorage.getItem(LOCAL_STATS_KEY);
      const stats = raw
        ? JSON.parse(raw)
        : { totalVisits: 0, uniqueVisitors: 0, visitsToday: 0, totalOrders: 0, dailyVisits: {}, recentEvents: [] };

      stats.totalOrders = (stats.totalOrders || 0) + 1;
      stats.recentEvents = stats.recentEvents || [];
      stats.recentEvents.unshift({
        type: "order",
        packageType,
        deliveryMethod,
        timestamp: new Date().toISOString(),
      });
      stats.recentEvents = stats.recentEvents.slice(0, 25);
      localStorage.setItem(LOCAL_STATS_KEY, JSON.stringify(stats));
    } catch {}
  }

  recordLocalVisit();
  if (window.location.protocol.startsWith("http")) {
    fetch("/api/visit", { method: "POST" }).catch(() => {});
  }

  const mobileMenuBtn = document.getElementById("mobileMenuBtn");
  const mobileNav = document.getElementById("mobileNav");

  if (mobileMenuBtn && mobileNav) {
    mobileMenuBtn.addEventListener("click", () => {
      const isHidden = mobileNav.hasAttribute("hidden");
      if (isHidden) {
        mobileNav.removeAttribute("hidden");
        mobileMenuBtn.setAttribute("aria-expanded", "true");
      } else {
        mobileNav.setAttribute("hidden", "");
        mobileMenuBtn.setAttribute("aria-expanded", "false");
      }
    });

    mobileNav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        mobileNav.setAttribute("hidden", "");
        mobileMenuBtn.setAttribute("aria-expanded", "false");
      });
    });
  }

  const orderForm = document.getElementById("orderForm");
  const orderLayout = document.querySelector(".order-layout");
  const confirmationCard = document.getElementById("confirmationCard");
  const confirmDetails = document.getElementById("confirmDetails");
  const formError = document.getElementById("formError");

  const pickupField = document.getElementById("pickupField");
  const addressFields = document.getElementById("addressFields");
  const streetInput = document.getElementById("street");
  const postalInput = document.getElementById("postalCode");

  const summaryPackage = document.getElementById("summaryPackage");
  const summaryUnitPrice = document.getElementById("summaryUnitPrice");
  const summaryQuantity = document.getElementById("summaryQuantity");
  const summaryDelivery = document.getElementById("summaryDelivery");
  const summaryTotal = document.getElementById("summaryTotal");
  const submitOrderBtn = document.getElementById("submitOrderBtn");

  const printOrderBtn = document.getElementById("printOrderBtn");
  const newOrderBtn = document.getElementById("newOrderBtn");

  function formatEuro(amount) {
    return `€ ${amount.toFixed(2).replace(".", ",")}`;
  }

  function updateSummary() {
    const selectedPkg = orderForm.querySelector('input[name="packageType"]:checked');
    const selectedDelivery = orderForm.querySelector('input[name="deliveryMethod"]:checked');
    const quantity = Number(document.getElementById("quantity").value) || 1;
    const unitPrice = selectedPkg ? Number(selectedPkg.dataset.price) || 0 : 0;
    const total = unitPrice * quantity;

    if (selectedPkg) {
      summaryPackage.textContent = selectedPkg.value;
    }

    if (summaryUnitPrice) {
      summaryUnitPrice.textContent = formatEuro(unitPrice);
    }

    summaryQuantity.textContent = quantity === 1 ? "1 pakket" : `${quantity} pakketten`;

    if (summaryTotal) {
      summaryTotal.textContent = formatEuro(total);
    }

    if (submitOrderBtn) {
      submitOrderBtn.textContent = `Kerstpakket Bestellen (${formatEuro(total)})`;
    }

    if (selectedDelivery && selectedDelivery.value === "delivery") {
      summaryDelivery.textContent = "Gratis thuisbezorging";
      pickupField.setAttribute("hidden", "");
      addressFields.removeAttribute("hidden");
      streetInput.setAttribute("required", "required");
      postalInput.setAttribute("required", "required");
    } else {
      summaryDelivery.textContent = "Gratis afhalen";
      pickupField.removeAttribute("hidden");
      addressFields.setAttribute("hidden", "");
      streetInput.removeAttribute("required");
      postalInput.removeAttribute("required");
    }
  }

  orderForm.addEventListener("change", updateSummary);
  updateSummary();

  function showError(message) {
    formError.textContent = message;
    formError.removeAttribute("hidden");
    formError.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function clearError() {
    formError.textContent = "";
    formError.setAttribute("hidden", "");
  }

  orderForm.addEventListener("submit", (event) => {
    event.preventDefault();
    clearError();

    const fullName = document.getElementById("fullName").value.trim();
    const email = document.getElementById("email").value.trim();
    const phone = document.getElementById("phone").value.trim();
    const quantity = document.getElementById("quantity").value;
    const notes = document.getElementById("notes").value.trim();
    const selectedPkgEl = orderForm.querySelector('input[name="packageType"]:checked');
    const packageType = selectedPkgEl.value;
    const unitPrice = Number(selectedPkgEl.dataset.price) || 0;
    const totalPrice = unitPrice * (Number(quantity) || 1);
    const deliveryMethod = orderForm.querySelector('input[name="deliveryMethod"]:checked').value;
    const pickupLocation = document.getElementById("pickupLocation").value;
    const street = streetInput.value.trim();
    const postalCode = postalInput.value.trim();

    if (!fullName) {
      showError("Vul alstublieft uw voor- en achternaam in.");
      return;
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError("Vul alstublieft een geldig e-mailadres in.");
      return;
    }

    if (!phone) {
      showError("Vul alstublieft een telefoonnummer in.");
      return;
    }

    if (deliveryMethod === "delivery" && (!street || !postalCode)) {
      showError("Vul alstublieft uw straat, huisnummer, postcode en gemeente in voor bezorging.");
      return;
    }

    const orderNumber = `MEK-2026-${Math.floor(1000 + Math.random() * 9000)}`;
    recordLocalOrder(packageType, deliveryMethod);
    if (window.location.protocol.startsWith("http")) {
      fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderNumber,
          fullName,
          email,
          phone,
          packageType,
          quantity: Number(quantity) || 1,
          totalPrice,
          deliveryMethod,
          pickupLocation: deliveryMethod === "pickup" ? pickupLocation : "",
          street: deliveryMethod === "delivery" ? street : "",
          postalCode: deliveryMethod === "delivery" ? postalCode : "",
          notes,
        }),
      }).catch(() => {});
    }
    const deliveryText =
      deliveryMethod === "delivery"
        ? `Gratis bezorging aan: ${street}, ${postalCode}`
        : `Gratis afhalen bij: ${pickupLocation}`;

    confirmDetails.innerHTML = "";
    const rows = [
      ["Bestelnummer", orderNumber],
      ["Naam", fullName],
      ["E-mail", email],
      ["Telefoon", phone],
      ["Pakket", `${quantity}x ${packageType} (${formatEuro(unitPrice)} / stuk)`],
      ["Ontvangst", deliveryText],
      ["Totaalbedrag", formatEuro(totalPrice)],
    ];

    if (notes) {
      rows.push(["Opmerkingen", notes]);
    }

    rows.forEach(([label, value]) => {
      const row = document.createElement("div");
      const strong = document.createElement("strong");
      strong.textContent = `${label}: `;
      const span = document.createElement("span");
      span.textContent = value;
      row.appendChild(strong);
      row.appendChild(span);
      confirmDetails.appendChild(row);
    });

    orderLayout.setAttribute("hidden", "");
    confirmationCard.removeAttribute("hidden");
    confirmationCard.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  if (printOrderBtn) {
    printOrderBtn.addEventListener("click", () => {
      window.print();
    });
  }

  if (newOrderBtn) {
    newOrderBtn.addEventListener("click", () => {
      orderForm.reset();
      updateSummary();
      clearError();
      confirmationCard.setAttribute("hidden", "");
      orderLayout.removeAttribute("hidden");
      orderForm.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
});
