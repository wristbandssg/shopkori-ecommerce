document.addEventListener('DOMContentLoaded', function () {
  const cartCountEl = document.getElementById('cartCount');

  // Add to cart (works for product cards + product detail page)
  document.querySelectorAll('[data-add-cart]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const productId = btn.getAttribute('data-id');
      const qtySource = btn.getAttribute('data-qty-source');
      const qty = qtySource ? (parseInt(document.getElementById(qtySource).value, 10) || 1) : 1;

      const originalHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> যোগ হচ্ছে...';

      fetch('/cart/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'action=add&productId=' + encodeURIComponent(productId) + '&qty=' + encodeURIComponent(qty),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.success) {
            if (cartCountEl) cartCountEl.textContent = data.count;
            btn.innerHTML = '<i class="bi bi-check2"></i> যোগ হয়েছে';
            setTimeout(function () { btn.innerHTML = originalHtml; btn.disabled = false; }, 1200);
          } else {
            alert(data.message || 'একটি সমস্যা হয়েছে।');
            btn.innerHTML = originalHtml;
            btn.disabled = false;
          }
        })
        .catch(function () {
          btn.innerHTML = originalHtml;
          btn.disabled = false;
        });
    });
  });

  // Mega menu (category nav): hover opens it on desktop via CSS; this click
  // handler is the fallback for touch devices (and a11y) where hover doesn't fire.
  document.querySelectorAll('.mega-toggle, #allCatToggle .nav-toggle').forEach(function (toggle) {
    toggle.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var parent = toggle.closest('.mega-parent');
      if (!parent) return;
      var wasOpen = parent.classList.contains('open');
      document.querySelectorAll('.mega-parent.open').forEach(function (p) { p.classList.remove('open'); });
      if (!wasOpen) parent.classList.add('open');
    });
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.mega-parent')) {
      document.querySelectorAll('.mega-parent.open').forEach(function (p) { p.classList.remove('open'); });
    }
  });

  // Quantity stepper on product detail page
  const qtyInput = document.getElementById('qtyInput');
  if (qtyInput) {
    document.querySelectorAll('[data-qty-plus]').forEach(function (b) {
      b.addEventListener('click', function () {
        qtyInput.value = Math.max(1, (parseInt(qtyInput.value, 10) || 1) + 1);
      });
    });
    document.querySelectorAll('[data-qty-minus]').forEach(function (b) {
      b.addEventListener('click', function () {
        qtyInput.value = Math.max(1, (parseInt(qtyInput.value, 10) || 1) - 1);
      });
    });
  }
});
