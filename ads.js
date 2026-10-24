(function () {
  function AdSlot(root) {
    this.root = root;
    this.ins = root.querySelector('ins.adsbygoogle');
  }

  AdSlot.prototype.mount = function () {
    if (!this.ins || this.root.getAttribute('data-ad-mounted') === 'true') return;
    this.root.setAttribute('data-ad-mounted', 'true');
    this.watch();
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  };

  AdSlot.prototype.watch = function () {
    var ins = this.ins;
    var root = this.root;

    function sync() {
      if (ins.getAttribute('data-ad-status') === 'filled') {
        root.classList.add('ad-slot--filled');
      }
    }

    sync();
    if (typeof MutationObserver !== 'function') return;
    var observer = new MutationObserver(sync);
    observer.observe(ins, { attributes: true, attributeFilter: ['data-ad-status'] });
  };

  AdSlot.mountAll = function (scope) {
    var nodes = (scope || document).querySelectorAll('.ad-slot');
    Array.prototype.forEach.call(nodes, function (node) {
      new AdSlot(node).mount();
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      AdSlot.mountAll(document);
    });
  } else {
    AdSlot.mountAll(document);
  }
})();
