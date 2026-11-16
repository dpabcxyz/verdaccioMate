/* 技术文档：前端读取 docs/*.md，经 marked + DOMPurify 渲染（与 Verdaccio Mate 详情抽屉同款链路） */
(function () {
  'use strict';

  var DOCS = [
    { id: 'deployment', title: '部署与配置', desc: '镜像构建、compose 示例、挂载权限与环境变量' },
    { id: 'users',      title: '用户体系',   desc: '三种身份、双通道登录与关系边界' },
    { id: 'mcp',        title: 'MCP 接入',   desc: '只读端点、Key 管理与限速锁定' },
    { id: 'tech-stack', title: '技术栈',     desc: '前后端框架、依赖与构建链路' }
  ];
  var CDN_TIP = 'Markdown 渲染库（marked / DOMPurify）未能从 CDN 加载，以下为纯文本降级展示。';

  var listEl = document.getElementById('docs-list');
  var bodyEl = document.getElementById('md-body');
  var tocEl = document.getElementById('docs-toc');
  if (!listEl || !bodyEl || !tocEl) return;

  var currentId = null;

  /* —— 侧栏 —— */
  function renderNav() {
    var html = '';
    DOCS.forEach(function (d) {
      html += '<li><a href="#' + d.id + '" data-doc="' + d.id + '">'
        + '<b>' + d.title + '</b><span>' + d.desc + '</span></a></li>';
    });
    listEl.innerHTML = html;
    listEl.addEventListener('click', function (e) {
      var a = e.target.closest('a[data-doc]');
      if (a) markActive(a.getAttribute('data-doc'));
    });
  }

  function markActive(id) {
    listEl.querySelectorAll('a[data-doc]').forEach(function (a) {
      if (a.getAttribute('data-doc') === id) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
    var doc = DOCS.find(function (d) { return d.id === id; });
    if (doc) document.title = doc.title + ' · verdaccioMate';
  }

  /* —— hash 路由：#docId 或 #docId/headingId —— */
  function parseHash() {
    var h = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (!h) return { doc: 'deployment', anchor: '' };
    var parts = h.split('/');
    var doc = DOCS.some(function (d) { return d.id === parts[0]; }) ? parts[0] : 'deployment';
    return { doc: doc, anchor: parts[1] || '' };
  }

  /* —— 渲染 —— */
  function render(md) {
    if (window.marked && window.DOMPurify) {
      var raw = window.marked.parse(md, { gfm: true, breaks: false });
      bodyEl.innerHTML = window.DOMPurify.sanitize(raw);
      buildToc();
    } else {
      /* CDN 不可用：降级为纯文本，保证内容可读 */
      bodyEl.innerHTML = '';
      var tip = document.createElement('p');
      tip.className = 'docs-cdn-tip';
      tip.textContent = CDN_TIP;
      var pre = document.createElement('pre');
      pre.className = 'md-fallback';
      pre.textContent = md;
      bodyEl.appendChild(tip);
      bodyEl.appendChild(pre);
      tocEl.hidden = true;
    }
  }

  function buildToc() {
    var heads = bodyEl.querySelectorAll('h2');
    if (!heads.length) { tocEl.hidden = true; return; }
    var html = '<span class="docs-toc-title">本页目录</span>';
    heads.forEach(function (h, i) {
      var id = 'h-' + i;
      h.id = id;
      html += '<a href="#' + currentId + '/' + id + '" data-target="' + id + '">' + h.textContent + '</a>';
    });
    tocEl.innerHTML = html;
    tocEl.hidden = false;
  }

  function scrollToAnchor(anchor) {
    if (!anchor) { window.scrollTo({ top: 0 }); return; }
    var el = document.getElementById(anchor);
    if (el) el.scrollIntoView();
    else window.scrollTo({ top: 0 });
  }

  function loadDoc(id, anchor, updateHash) {
    currentId = id;
    markActive(id);
    bodyEl.innerHTML = '<p class="docs-loading">正在加载文档…</p>';
    tocEl.hidden = true;
    loadSource(id, function (md) {
      render(md);
      scrollToAnchor(anchor);
      if (updateHash !== false) history.replaceState(null, '', '#' + id + (anchor ? '/' + anchor : ''));
    }, function () {
      bodyEl.innerHTML = '<div class="docs-error"><p>文档加载失败，请刷新重试；'
        + '或直接阅读 <a href="docs/' + id + '.md">Markdown 源文件</a>。</p></div>';
    });
  }

  /* 来源双通道：HTTP 环境实时 fetch docs/*.md；file:// 直开或 fetch 失败时
     回退到 assets/docs-content.js 的内嵌副本（由 tools/build-docs-content.mjs 从 md 生成） */
  function loadSource(id, ok, fail) {
    var embedded = window.VCM_DOCS_MD && Object.prototype.hasOwnProperty.call(window.VCM_DOCS_MD, id)
      ? window.VCM_DOCS_MD[id] : null;
    if (location.protocol === 'file:') {
      if (embedded) ok(embedded); else fail();
      return;
    }
    fetch('docs/' + id + '.md', { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(ok)
      .catch(function () {
        if (embedded) ok(embedded); else fail();
      });
  }

  function onHashChange() {
    var r = parseHash();
    if (r.doc !== currentId) loadDoc(r.doc, r.anchor);
    else scrollToAnchor(r.anchor);
  }

  renderNav();
  window.addEventListener('hashchange', onHashChange);

  /* 等 CDN 脚本（defer）就绪后再首次渲染 */
  function start() {
    var r = parseHash();
    loadDoc(r.doc, r.anchor, false);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
