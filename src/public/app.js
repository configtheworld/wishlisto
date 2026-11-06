(function () {
  'use strict';

  var THEME_KEY = 'wishlisto-theme';
  var root = document.documentElement;

  function currentTheme() {
    return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch (error) {
      /* Private mode or storage disabled: the theme still applies for this page. */
    }
    document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
      button.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    });
  }

  document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
    button.setAttribute('aria-pressed', currentTheme() === 'dark' ? 'true' : 'false');
    button.addEventListener('click', function () {
      applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    });
  });

  document.querySelectorAll('[data-autosubmit] select').forEach(function (select) {
    select.addEventListener('change', function () {
      var form = select.form;
      if (form) form.requestSubmit();
    });
  });

  document.querySelectorAll('[data-copy-target]').forEach(function (button) {
    button.addEventListener('click', function () {
      var target = document.getElementById(button.getAttribute('data-copy-target'));
      if (!target) return;
      var text = (target.textContent || '').trim();
      var label = button.querySelector('[data-copy-label]');
      var original = label ? label.textContent : '';
      var copied = button.getAttribute('data-copied-label') || 'Copied';

      function done() {
        if (!label) return;
        label.textContent = copied;
        window.setTimeout(function () {
          label.textContent = original;
        }, 2200);
      }

      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done, function () {});
        return;
      }

      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', 'readonly');
      area.className = 'visually-hidden';
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand('copy');
        done();
      } catch (error) {
        /* Nothing else we can do; the code is still selectable. */
      }
      document.body.removeChild(area);
    });
  });

  document.querySelectorAll('[data-print]').forEach(function (button) {
    button.addEventListener('click', function () {
      window.print();
    });
  });

  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (event) {
      var message = form.getAttribute('data-confirm');
      if (message && !window.confirm(message)) event.preventDefault();
    });
  });

  document.querySelectorAll('details.menu').forEach(function (details) {
    document.addEventListener('click', function (event) {
      if (details.open && !details.contains(event.target)) details.open = false;
    });
    details.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        details.open = false;
        var summary = details.querySelector('summary');
        if (summary) summary.focus();
      }
    });
  });
})();
