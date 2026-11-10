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
