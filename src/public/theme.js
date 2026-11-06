(function () {
  var key = 'wishlisto-theme';
  var stored = null;
  try {
    stored = window.localStorage.getItem(key);
  } catch (error) {
    stored = null;
  }
  var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var theme = stored === 'light' || stored === 'dark' ? stored : prefersDark ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
})();
