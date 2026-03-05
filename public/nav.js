(function() {
    const pages = [
        { href: 'index.html', label: 'Overview' },
        { href: 'drc.html', label: 'DRC' },
        { href: 'erc.html', label: 'ERC' },
        { href: 'step.html', label: 'STEP Export' }
    ];

    const currentPage = location.pathname.split('/').pop() || 'index.html';

    const nav = document.createElement('nav');
    nav.className = 'nav';

    pages.forEach(page => {
        const a = document.createElement('a');
        a.href = page.href;
        a.textContent = page.label;
        if (currentPage === page.href) {
            a.className = 'active';
        }
        nav.appendChild(a);
    });

    const container = document.querySelector('.container');
    if (container) {
        container.insertBefore(nav, container.firstChild);
    }
})();
