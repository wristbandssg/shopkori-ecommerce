document.addEventListener('DOMContentLoaded', function () {
  const toggleBtn = document.querySelector('.sidebar-toggle');
  const sidebar = document.querySelector('.admin-sidebar');
  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', function () {
      sidebar.classList.toggle('open');
    });
  }

  // "Select All" checkboxes in the Orders bulk-action toolbars: toggles
  // every checkbox named "ids" within the same <form>.
  document.querySelectorAll('.js-select-all').forEach(function (master) {
    master.addEventListener('change', function () {
      const form = master.closest('form');
      if (!form) return;
      form.querySelectorAll('input[name="ids"]').forEach(function (cb) {
        cb.checked = master.checked;
      });
    });
  });

  // Confirmation prompts on destructive/important actions. Works whether
  // the class is on a <button> (e.g. a bulk-delete button inside a larger
  // form with several formaction targets) or on a whole <form> (a
  // single-purpose action form, e.g. Restore).
  document.querySelectorAll('.js-confirm').forEach(function (el) {
    const message = el.getAttribute('data-confirm') || 'Are you sure?';
    if (el.tagName === 'FORM') {
      el.addEventListener('submit', function (e) {
        if (!window.confirm(message)) e.preventDefault();
      });
    } else {
      el.addEventListener('click', function (e) {
        if (!window.confirm(message)) e.preventDefault();
      });
    }
  });
});
