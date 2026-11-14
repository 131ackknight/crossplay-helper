(function () {
    var menus = document.querySelectorAll('.nav-dropdown');
    if (!menus.length) return;

    function closeAll(except) {
        menus.forEach(function (menu) {
            if (menu !== except) menu.open = false;
        });
    }

    menus.forEach(function (menu) {
        menu.addEventListener('toggle', function () {
            if (menu.open) closeAll(menu);
        });
    });

    document.addEventListener('click', function (event) {
        if (!event.target.closest('.nav-dropdown')) closeAll();
    });

    document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') return;
        var open = document.querySelector('.nav-dropdown[open]');
        if (!open) return;
        open.open = false;
        open.querySelector('summary').focus();
    });
})();

(function () {
    var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (standalone) return;

    var host = document.querySelector('.privacy-note');
    if (!host) {
        var paras = document.querySelectorAll('.site-footer p');
        for (var i = 0; i < paras.length; i++) {
            if (paras[i].textContent.indexOf('Works entirely in your browser') === 0) {
                host = paras[i];
                break;
            }
        }
    }
    if (!host) return;

    var deferredPrompt = null;
    var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    var wrap = document.createElement('span');
    wrap.className = 'install-wrap';

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'install-btn';
    button.textContent = 'Add to home screen';
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'install-help');

    var help = document.createElement('span');
    help.id = 'install-help';
    help.className = 'install-help';
    help.hidden = true;
    help.setAttribute('role', 'note');
    help.textContent = ios
        ? 'Tap Share, then Add to Home Screen.'
        : 'Open the browser menu and choose Install app, or Add to Home screen.';

    wrap.appendChild(button);
    wrap.appendChild(help);
    host.appendChild(document.createTextNode(' '));
    host.appendChild(wrap);

    function setHelp(open) {
        help.hidden = !open;
        button.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (!open) return;
        help.style.left = '0';
        help.style.right = 'auto';
        var rect = help.getBoundingClientRect();
        if (rect.right > window.innerWidth - 12) {
            help.style.left = 'auto';
            help.style.right = '0';
        }
    }

    window.addEventListener('beforeinstallprompt', function (event) {
        event.preventDefault();
        deferredPrompt = event;
        setHelp(false);
    });

    window.addEventListener('appinstalled', function () {
        deferredPrompt = null;
        wrap.hidden = true;
    });

    button.addEventListener('click', function () {
        if (!deferredPrompt) {
            setHelp(help.hidden);
            return;
        }
        var promptEvent = deferredPrompt;
        deferredPrompt = null;
        setHelp(false);
        promptEvent.prompt();
    });

    document.addEventListener('click', function (event) {
        if (!wrap.contains(event.target)) setHelp(false);
    });

    document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape' || help.hidden) return;
        setHelp(false);
        button.focus();
    });
})();
