document.addEventListener("DOMContentLoaded", () => {
    // 1. Wrap guide content to fix height issue
    const body = document.body;
    const theme = document.documentElement.getAttribute('data-theme');
    const isRayon = theme === 'rayon' || !theme;
    
    // Find all main content divs and sections
    const contentDivs = Array.from(body.children).filter(el => {
        if (el.tagName === 'SECTION' || el.tagName === 'FOOTER') return true;
        if (el.id === 'partie-b' || el.classList.contains('part-divider')) return true;
        if (el.tagName === 'DIV') {
            const style = el.getAttribute('style') || '';
            return style.replace(/\s+/g, '').includes('max-width:900px');
        }
        return false;
    });
    
    if (contentDivs.length > 0) {
        const wrapper = document.createElement('div');
        wrapper.className = 'guide-glass-wrapper';

        // Holographic HUD Elements (Only active and styled for Rayon Vert)
        const header = document.createElement('div');
        header.className = 'guide-glass-header';
        header.innerHTML = `
            <div class="hud-status-group">
                <span class="hud-beacon"></span>
                <span>SYS.MONITOR // DEEP SPACE NAVIGATION DATA</span>
            </div>
            <div class="hud-telemetry">
                <span class="hud-sector">SECTOR: COREWAR.ALPHA</span>
                <span id="hud-clock">00:00:00</span>
            </div>
        `;
        wrapper.appendChild(header);

        // Dynamic Reading Progress Bar
        const progressContainer = document.createElement('div');
        progressContainer.className = 'reading-progress-bar';
        const progressFill = document.createElement('div');
        progressFill.className = 'reading-progress-fill';
        progressContainer.appendChild(progressFill);
        wrapper.appendChild(progressContainer);

        // Cybernetic Corner Brackets
        ['tl', 'tr', 'bl', 'br'].forEach(pos => {
            const corner = document.createElement('div');
            corner.className = `cyber-corner ${pos}`;
            wrapper.appendChild(corner);
        });

        // Animated Hologram Scanline
        const scanline = document.createElement('div');
        scanline.className = 'holo-scanline';
        wrapper.appendChild(scanline);

        // Content wrapper
        const innerContent = document.createElement('div');
        innerContent.className = 'guide-glass-content';
        wrapper.appendChild(innerContent);

        // Move all content blocks inside the inner container
        contentDivs[0].parentNode.insertBefore(wrapper, contentDivs[0]);
        contentDivs.forEach(div => {
            div.style.padding = '0';
            div.style.margin = '0 auto 40px';
            innerContent.appendChild(div);
        });

        // Holographic Footer Telemetry
        const footer = document.createElement('div');
        footer.className = 'guide-glass-footer';
        footer.innerHTML = `
            <div>SYS.ACCESS // AUTH_LEVEL: COMMANDER</div>
            <div>TELEMETRY TRANSMISSION // SECURE_LINK</div>
        `;
        wrapper.appendChild(footer);

        // Clock Script
        function updateHUDClock() {
            const now = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            const clockEl = document.getElementById('hud-clock');
            if (clockEl) {
                clockEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
            }
        }
        setInterval(updateHUDClock, 1000);
        updateHUDClock();

        // Scroll reading progress meter
        window.addEventListener('scroll', () => {
            const docHeight = document.documentElement.scrollHeight - window.innerHeight;
            const scrolled = docHeight > 0 ? (window.scrollY / docHeight) * 100 : 0;
            progressFill.style.width = scrolled + '%';
        });
    }

    // 2. Intercept clicks to index.html and shell.html for camera pan
    const homeLinks = document.querySelectorAll('a[href="index.html"], a[href="shell.html"]');
    homeLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            const t = document.documentElement.getAttribute('data-theme');
            if (t === 'rayon' || !t) {
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
