/* 官网主题切换：与 Verdaccio Mate 同一套 token，独立存储键，默认跟随系统 */
(function () {
  var btn = document.getElementById('theme-toggle');
  if (!btn) return;
  function label() {
    var dark = document.documentElement.classList.contains('dark');
    var tip = dark ? '切换到浅色主题' : '切换到深色主题';
    btn.setAttribute('aria-label', tip);
    btn.setAttribute('title', tip);
  }
  btn.addEventListener('click', function () {
    var dark = document.documentElement.classList.toggle('dark');
    try { localStorage.setItem('vcm-site-theme', dark ? 'dark' : 'bright'); } catch (e) { /* 存储不可用则本次会话内生效 */ }
    label();
  });
  label();
})();
