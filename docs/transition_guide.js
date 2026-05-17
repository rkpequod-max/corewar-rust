document.addEventListener("DOMContentLoaded", () => {
    // 1. Wrap guide content to fix height issue
    const body = document.body;
    const isRayon = body.getAttribute('data-theme') === 'rayon';
    
    // Find all main content divs
    const contentDivs = Array.from(body.children).filter(el => {
        return el.tagName === 'DIV' && el.style.maxWidth === '900px';
    });
    
    if (contentDivs.length > 0) {
        const wrapper = document.createElement('div');
        wrapper.className = 'guide-glass-wrapper';
        contentDivs[0].parentNode.insertBefore(wrapper, contentDivs[0]);
        contentDivs.forEach(div => {
            // Remove inline padding and margins to let the wrapper handle it
            div.style.padding = '0';
            div.style.margin = '0 auto 40px';
            wrapper.appendChild(div);
        });
    }

    // 2. Intercept clicks to index.html and shell.html for camera pan
    const homeLinks = document.querySelectorAll('a[href="index.html"], a[href="shell.html"]');
    homeLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            if (document.body.getAttribute('data-theme') === 'rayon') {
                e.preventDefault();
                // Play animation Pan Up
                document.body.classList.add('is-transitioning-to-index');
                
                setTimeout(() => {
                    window.location.href = link.href;
                }, 1500);
            }
        });
    });
});
