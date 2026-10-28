/* 识字星球 · 返回按钮
   用法：<script src="xzq-back.js" data-target="CSS 选择器"></script>（放在 </body> 前）
   按钮插到 data-target 元素的最前面；没有 data-target 时插到页面顶部。
   有站内上一页时返回上一页，否则回首页 index.html。
   在 app-shell 的 iframe 里也显示：没有上一页时让整个窗口回首页。 */
(function(){
  var framed = window.top !== window;
  var me = document.currentScript;
  var sel = me && me.getAttribute('data-target');
  var home = (me && me.getAttribute('data-home')) || 'index.html';
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'xzq-back';
  btn.setAttribute('aria-label', '返回上一级');
  btn.innerHTML = '<span aria-hidden="true">←</span> 返回';
  btn.onclick = function(){
    var ref = document.referrer;
    var sameSite = ref && (location.protocol === 'file:' ? ref.indexOf('file:') === 0 : ref.indexOf(location.origin) === 0);
    if (sameSite && history.length > 1) history.back();
    else if (framed) { try { window.top.location.href = home; } catch (e) { location.href = home; } }
    else location.href = home;
  };
  var css = document.createElement('style');
  css.textContent = '.xzq-back{flex:0 0 auto;display:inline-flex;align-items:center;gap:4px;min-height:40px;padding:0 14px;margin-right:10px;border:1px solid var(--xzq-line,#F0E6D6);border-radius:999px;background:#fff;color:var(--xzq-ink,#2B2A4C);font:600 15px/1 var(--xzq-sans,"PingFang SC","Microsoft YaHei",sans-serif);cursor:pointer;box-shadow:0 2px 0 rgba(43,42,76,.06)}'
    + '.xzq-back:hover{background:var(--xzq-bg,#FFF8EE)}.xzq-back span{font-size:18px}'
    + '.xzq-back-bar{max-width:1240px;margin:0 auto;padding:12px 16px 0}';
  document.head.appendChild(css);
  var target = sel && document.querySelector(sel);
  if (target) { target.insertBefore(btn, target.firstChild); }
  else { var bar = document.createElement('div'); bar.className = 'xzq-back-bar'; bar.appendChild(btn); document.body.insertBefore(bar, document.body.firstChild); }
})();
