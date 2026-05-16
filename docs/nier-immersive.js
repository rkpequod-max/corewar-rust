/* ═══════════════════════════════════════════════════════════════════
   NIER:AUTOMATA IMMERSIVE THEME ENGINE v1.0
   ─────────────────────────────────────────
   7 couches d'immersion pour le thème [data-theme="nier"]
   Shared between index.html, shell.html, guide.html
   ═══════════════════════════════════════════════════════════════════ */

(function() {
    'use strict';

    /* ── State ── */
    var active = false;
    var systems = [];
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ══════════════════════════════════════
       UTILITY
       ══════════════════════════════════════ */
    function isNier() {
        return document.documentElement.getAttribute('data-theme') === 'nier';
    }

    function lerp(a, b, t) { return a + (b - a) * t; }

    function rand(min, max) { return Math.random() * (max - min) + min; }

    /* ══════════════════════════════════════
       COUCHE 1 — GRAIN DE PARCHEMIN
       (CSS-only via injected style, no JS loop)
       ══════════════════════════════════════ */
    // Handled entirely in CSS via feTurbulence SVG filter

    /* ══════════════════════════════════════
       COUCHE 2 — POUSSIÈRE FLOTTANTE
       Single canvas, 30 particles, ~0.3px/frame
       ══════════════════════════════════════ */
    var dustCanvas, dustCtx, dustParticles = [], dustAnimId = null;

    function initDust() {
        dustCanvas = document.getElementById('nier-dust');
        if (!dustCanvas) {
            dustCanvas = document.createElement('canvas');
            dustCanvas.id = 'nier-dust';
            dustCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2;opacity:0.6;';
            document.body.appendChild(dustCanvas);
        }
        dustCtx = dustCanvas.getContext('2d');
        dustParticles = [];
        for (var i = 0; i < 30; i++) {
            dustParticles.push({
                x: rand(0, window.innerWidth),
                y: rand(0, window.innerHeight),
                size: rand(1, 3),
                speedY: rand(0.15, 0.4),
                speedX: rand(-0.1, 0.1),
                opacity: rand(0.1, 0.3),
                phase: rand(0, Math.PI * 2)
            });
        }
    }

    function resizeDust() {
        if (!dustCanvas) return;
        dustCanvas.width = window.innerWidth;
        dustCanvas.height = window.innerHeight;
    }

    function renderDust(now) {
        if (!active) return;
        dustAnimId = requestAnimationFrame(renderDust);
        if (!dustCtx) return;
        var w = dustCanvas.width, h = dustCanvas.height;
        dustCtx.clearRect(0, 0, w, h);
        var t = (now || 0) * 0.001;
        for (var i = 0; i < dustParticles.length; i++) {
            var p = dustParticles[i];
            p.y += p.speedY;
            p.x += p.speedX + Math.sin(t + p.phase) * 0.15;
            if (p.y > h + 5) { p.y = -5; p.x = rand(0, w); }
            if (p.x < -5) p.x = w + 5;
            if (p.x > w + 5) p.x = -5;
            dustCtx.globalAlpha = p.opacity;
            dustCtx.fillStyle = '#D4CFC6';
            dustCtx.beginPath();
            dustCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            dustCtx.fill();
        }
    }

    function startDust() {
        if (reducedMotion) return;
        initDust();
        resizeDust();
        dustCanvas.style.display = 'block';
        dustAnimId = requestAnimationFrame(renderDust);
    }

    function stopDust() {
        if (dustAnimId) { cancelAnimationFrame(dustAnimId); dustAnimId = null; }
        if (dustCanvas) dustCanvas.style.display = 'none';
    }

    /* ══════════════════════════════════════
       COUCHE 4 — GLITCH AU SURVOL
       clip-path + skewX + flash cramoisi
       ══════════════════════════════════════ */
    var glitchSelectors = '.video-card, .crate-card, .feature-card, .intro-card, .layer-card, .summary-card, .diagram-box, .process-card, .insight-box, .collapse-header';

    function onGlitchEnter(e) {
        if (reducedMotion) return;
        var el = e.currentTarget;
        if (el._glitching) return;
        el._glitching = true;

        // Flash border
        var origBorderColor = el.style.borderColor;
        el.style.borderColor = '#C4362B';
        el.style.transition = 'border-color 0s';

        // SkewX micro-distortion
        var skew = (Math.random() - 0.5) * 2; // -1 to 1 deg
        el.style.transform = 'skewX(' + skew + 'deg)';

        // Chromatic aberration via text-shadow
        var origTextShadow = el.style.textShadow;
        el.style.textShadow = '2px 0 rgba(196,54,43,0.3), -2px 0 rgba(58,110,165,0.3)';

        setTimeout(function() {
            el.style.transform = '';
            el.style.borderColor = origBorderColor;
            el.style.transition = '';
            el.style.textShadow = origTextShadow;
            el._glitching = false;
        }, 300);
    }

    function bindGlitch() {
        var els = document.querySelectorAll(glitchSelectors);
        for (var i = 0; i < els.length; i++) {
            els[i].removeEventListener('mouseenter', onGlitchEnter);
            els[i].addEventListener('mouseenter', onGlitchEnter);
        }
    }

    function unbindGlitch() {
        var els = document.querySelectorAll(glitchSelectors);
        for (var i = 0; i < els.length; i++) {
            els[i].removeEventListener('mouseenter', onGlitchEnter);
        }
    }

    /* ══════════════════════════════════════
       COUCHE — ONDE DE CHOC AU CLIC
       Expanding crimson ring from click point
       ══════════════════════════════════════ */
    function onClickShockwave(e) {
        if (reducedMotion) return;
        var ring = document.createElement('div');
        ring.style.cssText = 'position:fixed;border:1px solid rgba(196,54,43,0.4);border-radius:50%;pointer-events:none;z-index:9999;transform:translate(-50%,-50%);';
        ring.style.left = e.clientX + 'px';
        ring.style.top = e.clientY + 'px';
        ring.style.width = '0px';
        ring.style.height = '0px';
        document.body.appendChild(ring);

        var start = performance.now();
        function animate(now) {
            var t = (now - start) / 400; // 0.4s
            if (t >= 1) { ring.remove(); return; }
            var size = t * 60;
            ring.style.width = size + 'px';
            ring.style.height = size + 'px';
            ring.style.opacity = (1 - t) * 0.4;
            requestAnimationFrame(animate);
        }
        requestAnimationFrame(animate);

        // Second smaller ring with delay
        setTimeout(function() {
            var ring2 = document.createElement('div');
            ring2.style.cssText = 'position:fixed;border:1px solid rgba(196,54,43,0.3);border-radius:50%;pointer-events:none;z-index:9999;transform:translate(-50%,-50%);';
            ring2.style.left = e.clientX + 'px';
            ring2.style.top = e.clientY + 'px';
            ring2.style.width = '0px';
            ring2.style.height = '0px';
            document.body.appendChild(ring2);
            var start2 = performance.now();
            function animate2(now) {
                var t = (now - start2) / 300;
                if (t >= 1) { ring2.remove(); return; }
                var size = t * 30;
                ring2.style.width = size + 'px';
                ring2.style.height = size + 'px';
                ring2.style.opacity = (1 - t) * 0.3;
                requestAnimationFrame(animate2);
            }
            requestAnimationFrame(animate2);
        }, 100);
    }

    /* ══════════════════════════════════════
       COUCHE 5 — GRILLE DE DONNÉES HERO
       Subtle pulsing data grid in hero area
       ══════════════════════════════════════ */
    var gridOverlay = null;

    function createGrid() {
        gridOverlay = document.createElement('div');
        gridOverlay.id = 'nier-grid';
        gridOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:1;' +
            'background-image:linear-gradient(rgba(196,54,43,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(196,54,43,0.03) 1px,transparent 1px);' +
            'background-size:80px 80px;opacity:0;transition:opacity 1s;';
        document.body.appendChild(gridOverlay);

        // Pulse animation
        var pulseUp = true;
        var opacity = 0.4;
        function pulse() {
            if (!active) return;
            opacity += pulseUp ? 0.003 : -0.003;
            if (opacity >= 0.7) pulseUp = false;
            if (opacity <= 0.3) pulseUp = true;
            if (gridOverlay) gridOverlay.style.opacity = opacity;
            requestAnimationFrame(pulse);
        }

        // Fade in based on scroll (only visible near top)
        function updateGridScroll() {
            if (!gridOverlay || !active) return;
            var scrollY = window.scrollY || window.pageYOffset;
            var fadeStart = 0, fadeEnd = 600;
            var t = Math.max(0, 1 - scrollY / fadeEnd);
            gridOverlay.style.opacity = t * opacity;
        }
        window.addEventListener('scroll', updateGridScroll, { passive: true });
        requestAnimationFrame(pulse);
        updateGridScroll();
    }

    function removeGrid() {
        if (gridOverlay) { gridOverlay.remove(); gridOverlay = null; }
    }

    /* ══════════════════════════════════════
       COUCHE 6 — POD 042 COMPAGNON
       Floating diamond, cursor tracking, dialogues
       ══════════════════════════════════════ */
    var pod = null, podBubble = null;
    var podX = 0, podY = 0, podTargetX = 0, podTargetY = 0;
    var podAnimId = null, podDialogueTimer = null;
    var podMessages = [
        'Suggestion : exploration recommandée.',
        'Analyse : données pertinentes détectées.',
        'Rapport : section inexplorée à proximité.',
        'Alerte : nouveau contenu disponible.',
        'Observation : architecture système nominale.',
        'Conseil : défilement vers le bas recommandé.',
        'Log : activité utilisateur enregistrée.',
        'Status : systèmes YoRHa opérationnels.',
    ];
    var podMsgIdx = 0;

    function createPod() {
        pod = document.createElement('div');
        pod.id = 'nier-pod';
        pod.innerHTML = '◆';
        pod.style.cssText = 'position:fixed;bottom:80px;right:80px;width:32px;height:32px;z-index:9998;pointer-events:none;' +
            'display:flex;align-items:center;justify-content:center;font-size:18px;color:rgba(196,54,43,0.7);' +
            'text-shadow:0 0 8px rgba(196,54,43,0.3);transition:none;';
        document.body.appendChild(pod);

        podBubble = document.createElement('div');
        podBubble.id = 'nier-pod-bubble';
        podBubble.style.cssText = 'position:fixed;bottom:120px;right:40px;z-index:9997;pointer-events:none;' +
            'background:rgba(26,26,26,0.92);border:1px solid #333;border-left:2px solid #C4362B;' +
            'padding:6px 10px;font-family:"Courier New",monospace;font-size:0.65rem;color:#AAA;' +
            'letter-spacing:0.05em;line-height:1.5;max-width:260px;opacity:0;transition:opacity 0.3s;';
        document.body.appendChild(podBubble);

        podX = window.innerWidth - 96;
        podY = window.innerHeight - 96;
        podTargetX = podX;
        podTargetY = podY;

        document.addEventListener('mousemove', onPodMouseMove);
        podAnimId = requestAnimationFrame(animatePod);

        // Start dialogue cycle
        schedulePodDialogue();
    }

    function onPodMouseMove(e) {
        var dist = Math.sqrt(Math.pow(e.clientX - podX, 2) + Math.pow(e.clientY - podY, 2));
        if (dist > 200) {
            podTargetX = e.clientX + 40;
            podTargetY = e.clientY - 40;
        }
    }

    function animatePod() {
        if (!active || !pod) return;
        podX = lerp(podX, podTargetX, 0.05);
        podY = lerp(podY, podTargetY, 0.05);

        // Keep in bounds
        podX = Math.max(20, Math.min(window.innerWidth - 52, podX));
        podY = Math.max(20, Math.min(window.innerHeight - 52, podY));

        pod.style.left = podX + 'px';
        pod.style.top = podY + 'px';
        pod.style.bottom = 'auto';
        pod.style.right = 'auto';

        // Slow rotation
        var angle = (performance.now() * 0.03) % 360;
        pod.style.transform = 'rotate(' + angle + 'deg)';

        if (podBubble) {
            podBubble.style.left = (podX - 220) + 'px';
            podBubble.style.top = (podY - 50) + 'px';
            podBubble.style.bottom = 'auto';
            podBubble.style.right = 'auto';
        }

        podAnimId = requestAnimationFrame(animatePod);
    }

    function showPodMessage(msg) {
        if (!podBubble) return;
        podBubble.innerHTML = '<span style="color:#C4362B">POD 042 :</span> ' + msg;
        podBubble.style.opacity = '1';
        setTimeout(function() {
            if (podBubble) podBubble.style.opacity = '0';
        }, 4000);
    }

    function schedulePodDialogue() {
        if (!active) return;
        podDialogueTimer = setTimeout(function() {
            showPodMessage(podMessages[podMsgIdx % podMessages.length]);
            podMsgIdx++;
            schedulePodDialogue();
        }, 15000 + Math.random() * 10000); // 15-25s between messages
    }

    function destroyPod() {
        if (podAnimId) { cancelAnimationFrame(podAnimId); podAnimId = null; }
        if (podDialogueTimer) { clearTimeout(podDialogueTimer); podDialogueTimer = null; }
        document.removeEventListener('mousemove', onPodMouseMove);
        if (pod) { pod.remove(); pod = null; }
        if (podBubble) { podBubble.remove(); podBubble = null; }
    }

    /* ══════════════════════════════════════
       COUCHE 7 — CORRUPTION D'INACTIVITÉ
       30s → distortion, 60s → POD alert
       ══════════════════════════════════════ */
    var inactivityTimer = null, corruptionLevel = 0;
    var corruptionOverlay = null, corruptionAnimId = null;

    function resetInactivity() {
        corruptionLevel = 0;
        if (corruptionOverlay) {
            corruptionOverlay.style.opacity = '0';
        }
        document.body.style.filter = '';
        clearTimeout(inactivityTimer);
        if (active) startInactivityTimer();
    }

    function startInactivityTimer() {
        if (reducedMotion) return;
        inactivityTimer = setTimeout(function() {
            // 30s — start corruption
            startCorruption();
        }, 30000);
    }

    function startCorruption() {
        if (!active) return;
        if (!corruptionOverlay) {
            corruptionOverlay = document.createElement('div');
            corruptionOverlay.id = 'nier-corruption';
            corruptionOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9990;opacity:0;transition:opacity 2s;';
            document.body.appendChild(corruptionOverlay);
        }

        corruptionLevel = 1;
        corruptionOverlay.style.opacity = '1';

        // Draw corruption bars
        function renderCorruption() {
            if (!active || corruptionLevel === 0) return;
            var html = '';
            for (var i = 0; i < 5; i++) {
                var top = Math.random() * 100;
                var height = 1 + Math.random() * 3;
                var offsetX = (Math.random() - 0.5) * 8;
                html += '<div style="position:absolute;top:' + top + '%;left:0;right:0;height:' + height + 'px;' +
                    'background:rgba(196,54,43,0.08);transform:translateX(' + offsetX + 'px);"></div>';
            }
            corruptionOverlay.innerHTML = html;
            if (corruptionLevel > 0) setTimeout(renderCorruption, 2000);
        }
        renderCorruption();

        // Desaturate
        document.body.style.filter = 'saturate(0.7)';

        // 60s — POD alert
        setTimeout(function() {
            if (active && corruptionLevel > 0) {
                showPodMessage('Alerte : dégradation système détectée. Interaction requise.');
                document.body.style.filter = 'saturate(0.4)';
                corruptionLevel = 2;
            }
        }, 30000);
    }

    function destroyCorruption() {
        corruptionLevel = 0;
        clearTimeout(inactivityTimer);
        document.body.style.filter = '';
        if (corruptionOverlay) { corruptionOverlay.remove(); corruptionOverlay = null; }
    }

    /* ══════════════════════════════════════
       DATA STREAM AU SCROLL
       Hex characters flowing on right edge
       ══════════════════════════════════════ */
    var dataStreamCanvas, dataStreamCtx, dataStreamAnimId = null;
    var hexChars = '0123456789ABCDEF';
    var dataStreamChars = [];

    function initDataStream() {
        dataStreamCanvas = document.getElementById('nier-datastream');
        if (!dataStreamCanvas) {
            dataStreamCanvas = document.createElement('canvas');
            dataStreamCanvas.id = 'nier-datastream';
            dataStreamCanvas.style.cssText = 'position:fixed;top:0;right:0;width:16px;height:100%;pointer-events:none;z-index:3;';
            document.body.appendChild(dataStreamCanvas);
        }
        dataStreamCtx = dataStreamCanvas.getContext('2d');
        dataStreamCanvas.width = 16;
        dataStreamCanvas.height = window.innerHeight;

        dataStreamChars = [];
        for (var i = 0; i < 80; i++) {
            dataStreamChars.push({
                char: hexChars[Math.floor(Math.random() * 16)],
                y: i * (window.innerHeight / 80),
                speed: 0
            });
        }
    }

    var lastScrollY = 0;
    function onDataStreamScroll() {
        if (!active) return;
        var scrollY = window.scrollY || window.pageYOffset;
        var delta = Math.abs(scrollY - lastScrollY);
        lastScrollY = scrollY;
        for (var i = 0; i < dataStreamChars.length; i++) {
            dataStreamChars[i].speed = delta * 0.5;
        }
    }

    function renderDataStream() {
        if (!active) return;
        dataStreamAnimId = requestAnimationFrame(renderDataStream);
        if (!dataStreamCtx) return;
        var h = dataStreamCanvas.height;
        dataStreamCtx.clearRect(0, 0, 16, h);
        dataStreamCtx.font = '8px "Courier New", monospace';
        dataStreamCtx.fillStyle = 'rgba(196,54,43,0.15)';

        for (var i = 0; i < dataStreamChars.length; i++) {
            var c = dataStreamChars[i];
            c.y += c.speed;
            c.speed *= 0.95;
            if (c.y > h) { c.y = 0; c.char = hexChars[Math.floor(Math.random() * 16)]; }
            if (c.speed > 0.5) {
                c.char = hexChars[Math.floor(Math.random() * 16)];
            }
            dataStreamCtx.fillText(c.char, 3, c.y);
        }
    }

    function startDataStream() {
        if (reducedMotion) return;
        initDataStream();
        dataStreamCanvas.style.display = 'block';
        window.addEventListener('scroll', onDataStreamScroll, { passive: true });
        dataStreamAnimId = requestAnimationFrame(renderDataStream);
    }

    function stopDataStream() {
        if (dataStreamAnimId) { cancelAnimationFrame(dataStreamAnimId); dataStreamAnimId = null; }
        window.removeEventListener('scroll', onDataStreamScroll);
        if (dataStreamCanvas) dataStreamCanvas.style.display = 'none';
    }

    /* ══════════════════════════════════════
       DYNAMIC FAVICON — Crimson Diamond
       Pulses when active, desaturates when
       tab is in background
       ══════════════════════════════════════ */
    var originalFavicon = null;
    var nierFaviconLink = null;

    function setNierFavicon() {
        // Save original
        var existing = document.querySelector('link[rel="icon"]') || document.querySelector('link[rel="shortcut icon"]');
        if (existing && !originalFavicon) {
            originalFavicon = existing.href;
        }

        // Create crimson diamond favicon SVG
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
            '<rect width="16" height="16" x="8" y="8" rx="1" fill="#C4362B" transform="rotate(45 16 16)">' +
            '<animate attributeName="opacity" values="0.7;1;0.7" dur="3s" repeatCount="indefinite"/>' +
            '</rect>' +
            '<rect width="8" height="8" x="12" y="12" rx="0.5" fill="#F5F0E8" transform="rotate(45 16 16)" opacity="0.3"/>' +
            '</svg>';
        var dataUrl = 'data:image/svg+xml,' + encodeURIComponent(svg);

        if (!nierFaviconLink) {
            nierFaviconLink = document.createElement('link');
            nierFaviconLink.rel = 'icon';
            nierFaviconLink.type = 'image/svg+xml';
        }
        nierFaviconLink.href = dataUrl;

        // Remove existing favicon
        var oldLinks = document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]');
        for (var i = 0; i < oldLinks.length; i++) {
            if (oldLinks[i] !== nierFaviconLink) oldLinks[i].remove();
        }
        document.head.appendChild(nierFaviconLink);
    }

    function restoreFavicon() {
        if (nierFaviconLink) {
            nierFaviconLink.remove();
            nierFaviconLink = null;
        }
        if (originalFavicon) {
            var link = document.createElement('link');
            link.rel = 'icon';
            link.href = originalFavicon;
            document.head.appendChild(link);
        }
    }

    /* ══════════════════════════════════════
       CURSEUR AMÉLIORÉ — RÉTICULE YORHA
       Crosshair → diamond on interactive,
       contraction on click, crimson trail
       ══════════════════════════════════════ */
    var cursorEl = null, cursorOuter = null, cursorTrailCanvas = null, cursorTrailCtx = null;
    var cursorAnimId = null;
    var cursorX = 0, cursorY = 0, cursorTargetX = 0, cursorTargetY = 0;
    var cursorOnInteractive = false, cursorClicking = false;

    function createCursor() {
        if (reducedMotion) return;
        // Hide default cursor
        var style = document.createElement('style');
        style.id = 'nier-cursor-style';
        style.textContent = '[data-theme="nier"] * { cursor: none !important; }';
        document.head.appendChild(style);

        // Inner crosshair
        cursorEl = document.createElement('div');
        cursorEl.id = 'nier-cursor';
        cursorEl.style.cssText = 'position:fixed;pointer-events:none;z-index:99999;' +
            'width:20px;height:20px;transform:translate(-50%,-50%);transition:width 0.15s,height 0.15s,transform 0.15s;';
        cursorEl.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<line x1="10" y1="0" x2="10" y2="7" stroke="#C4362B" stroke-width="1.5"/>' +
            '<line x1="10" y1="13" x2="10" y2="20" stroke="#C4362B" stroke-width="1.5"/>' +
            '<line x1="0" y1="10" x2="7" y2="10" stroke="#C4362B" stroke-width="1.5"/>' +
            '<line x1="13" y1="10" x2="20" y2="10" stroke="#C4362B" stroke-width="1.5"/>' +
            '</svg>';
        document.body.appendChild(cursorEl);

        // Outer ring
        cursorOuter = document.createElement('div');
        cursorOuter.id = 'nier-cursor-outer';
        cursorOuter.style.cssText = 'position:fixed;pointer-events:none;z-index:99998;' +
            'width:28px;height:28px;border:1px solid rgba(196,54,43,0.5);border-radius:50%;' +
            'transform:translate(-50%,-50%);transition:width 0.15s,height 0.15s,border-radius 0.2s,transform 0.2s;';
        document.body.appendChild(cursorOuter);

        // Trail canvas
        cursorTrailCanvas = document.createElement('canvas');
        cursorTrailCanvas.id = 'nier-cursor-trail';
        cursorTrailCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:99997;';
        cursorTrailCanvas.width = window.innerWidth;
        cursorTrailCanvas.height = window.innerHeight;
        document.body.appendChild(cursorTrailCanvas);
        cursorTrailCtx = cursorTrailCanvas.getContext('2d');

        cursorX = window.innerWidth / 2;
        cursorY = window.innerHeight / 2;
        cursorTargetX = cursorX;
        cursorTargetY = cursorY;

        document.addEventListener('mousemove', onCursorMove);
        document.addEventListener('mousedown', onCursorDown);
        document.addEventListener('mouseup', onCursorUp);
        cursorAnimId = requestAnimationFrame(animateCursor);
    }

    function onCursorMove(e) {
        cursorTargetX = e.clientX;
        cursorTargetY = e.clientY;

        // Check if over interactive element
        var target = e.target;
        var interactive = target && (
            target.tagName === 'A' || target.tagName === 'BUTTON' ||
            target.closest('a') || target.closest('button') ||
            target.closest('.cta-primary') || target.closest('.cta-ghost') ||
            target.closest('.theme-toggle') || target.closest('[onclick]') ||
            target.closest('.video-card') || target.closest('.crate-card') ||
            target.closest('.feature-card') || target.closest('.collapse-header')
        );
        if (interactive && !cursorOnInteractive) {
            cursorOnInteractive = true;
            // Transform to diamond
            if (cursorOuter) {
                cursorOuter.style.borderRadius = '0';
                cursorOuter.style.transform = 'translate(-50%,-50%) rotate(45deg)';
                cursorOuter.style.borderColor = 'rgba(196,54,43,0.8)';
                cursorOuter.style.width = '22px';
                cursorOuter.style.height = '22px';
            }
        } else if (!interactive && cursorOnInteractive) {
            cursorOnInteractive = false;
            if (cursorOuter) {
                cursorOuter.style.borderRadius = '50%';
                cursorOuter.style.transform = 'translate(-50%,-50%)';
                cursorOuter.style.borderColor = 'rgba(196,54,43,0.5)';
                cursorOuter.style.width = '28px';
                cursorOuter.style.height = '28px';
            }
        }
    }

    function onCursorDown() {
        cursorClicking = true;
        if (cursorOuter) {
            cursorOuter.style.width = '18px';
            cursorOuter.style.height = '18px';
        }
    }

    function onCursorUp() {
        cursorClicking = false;
        if (cursorOuter) {
            cursorOuter.style.width = cursorOnInteractive ? '22px' : '28px';
            cursorOuter.style.height = cursorOnInteractive ? '22px' : '28px';
        }
    }

    function animateCursor() {
        if (!active || !cursorEl) return;
        cursorX = lerp(cursorX, cursorTargetX, 0.35);
        cursorY = lerp(cursorY, cursorTargetY, 0.35);

        cursorEl.style.left = cursorTargetX + 'px';
        cursorEl.style.top = cursorTargetY + 'px';

        cursorOuter.style.left = cursorX + 'px';
        cursorOuter.style.top = cursorY + 'px';

        // Trail — fade previous frame
        if (cursorTrailCtx) {
            cursorTrailCtx.globalCompositeOperation = 'destination-out';
            cursorTrailCtx.fillStyle = 'rgba(0,0,0,0.08)';
            cursorTrailCtx.fillRect(0, 0, cursorTrailCanvas.width, cursorTrailCanvas.height);
            cursorTrailCtx.globalCompositeOperation = 'source-over';

            // Draw trail point only if moving fast enough
            var dx = cursorTargetX - cursorX;
            var dy = cursorTargetY - cursorY;
            var speed = Math.sqrt(dx * dx + dy * dy);
            if (speed > 3) {
                cursorTrailCtx.globalAlpha = Math.min(speed * 0.01, 0.15);
                cursorTrailCtx.fillStyle = '#C4362B';
                cursorTrailCtx.beginPath();
                cursorTrailCtx.arc(cursorX, cursorY, 1.5, 0, Math.PI * 2);
                cursorTrailCtx.fill();
            }
        }

        cursorAnimId = requestAnimationFrame(animateCursor);
    }

    function destroyCursor() {
        if (cursorAnimId) { cancelAnimationFrame(cursorAnimId); cursorAnimId = null; }
        document.removeEventListener('mousemove', onCursorMove);
        document.removeEventListener('mousedown', onCursorDown);
        document.removeEventListener('mouseup', onCursorUp);
        if (cursorEl) { cursorEl.remove(); cursorEl = null; }
        if (cursorOuter) { cursorOuter.remove(); cursorOuter = null; }
        if (cursorTrailCanvas) { cursorTrailCanvas.remove(); cursorTrailCanvas = null; cursorTrailCtx = null; }
        var style = document.getElementById('nier-cursor-style');
        if (style) style.remove();
    }

    /* ══════════════════════════════════════
       CTA SCAN EFFECT
       White scan line traversing buttons
       ══════════════════════════════════════ */
    function bindCTAScan() {
        var ctas = document.querySelectorAll('.cta-primary, .cta-ghost, .cta');
        for (var i = 0; i < ctas.length; i++) {
            ctas[i].removeEventListener('mouseenter', onCTAScanEnter);
            ctas[i].addEventListener('mouseenter', onCTAScanEnter);
        }
    }

    function unbindCTAScan() {
        var ctas = document.querySelectorAll('.cta-primary, .cta-ghost, .cta');
        for (var i = 0; i < ctas.length; i++) {
            ctas[i].removeEventListener('mouseenter', onCTAScanEnter);
        }
    }

    function onCTAScanEnter(e) {
        if (reducedMotion) return;
        var btn = e.currentTarget;
        if (btn._scanning) return;
        btn._scanning = true;

        var scan = document.createElement('div');
        scan.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:2px;' +
            'background:linear-gradient(90deg,transparent 20%,rgba(255,255,255,0.5) 50%,transparent 80%);' +
            'pointer-events:none;z-index:10;filter:blur(0.5px);';
        var orig = btn.style.position;
        if (!orig || orig === 'static') btn.style.position = 'relative';
        btn.style.overflow = 'hidden';
        btn.appendChild(scan);

        var start = performance.now();
        function anim(now) {
            var t = (now - start) / 400;
            if (t >= 1) {
                scan.remove();
                btn._scanning = false;
                return;
            }
            scan.style.top = (t * 100) + '%';
            requestAnimationFrame(anim);
        }
        requestAnimationFrame(anim);
    }

    /* ══════════════════════════════════════
       BOOT ANIMATION
       Progressive reveal on first load
       ══════════════════════════════════════ */
    var hasBooted = false;

    function playBootAnimation() {
        if (reducedMotion || hasBooted) return;
        hasBooted = true;

        var overlay = document.createElement('div');
        overlay.id = 'nier-boot';
        overlay.style.cssText = 'position:fixed;inset:0;background:#F5F0E8;z-index:100000;' +
            'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
            'font-family:"JetBrains Mono","Courier New",monospace;color:#6B6560;font-size:0.7rem;' +
            'letter-spacing:0.1em;transition:opacity 0.5s;';

        var lines = [
            'INITIALIZING YORHA SYSTEMS...',
            'LOADING BUNKER INTERFACE v5.0',
            'CONNECTING TO POD 042...',
            'THEME ACTIVE ◆ GLORY TO MANKIND'
        ];

        var container = document.createElement('div');
        container.style.cssText = 'text-align:left;min-width:340px;';
        overlay.appendChild(container);

        // Progress bar
        var barWrap = document.createElement('div');
        barWrap.style.cssText = 'width:100%;height:2px;background:#EDE8DF;margin-top:20px;overflow:hidden;';
        var bar = document.createElement('div');
        bar.style.cssText = 'width:0;height:100%;background:#C4362B;transition:width 0.3s ease;';
        barWrap.appendChild(bar);
        overlay.appendChild(barWrap);

        document.body.appendChild(overlay);

        var lineIdx = 0;
        function typeLine() {
            if (lineIdx >= lines.length) {
                // Complete — fade out
                bar.style.width = '100%';
                setTimeout(function() {
                    overlay.style.opacity = '0';
                    setTimeout(function() { overlay.remove(); }, 500);
                }, 300);
                return;
            }

            var lineEl = document.createElement('div');
            lineEl.style.cssText = 'margin-bottom:6px;opacity:0;transform:translateX(-10px);' +
                'transition:opacity 0.3s,transform 0.3s;';
            var prefix = document.createElement('span');
            prefix.style.color = '#C4362B';
            prefix.textContent = '> ';
            lineEl.appendChild(prefix);
            lineEl.appendChild(document.createTextNode(lines[lineIdx]));
            container.appendChild(lineEl);

            bar.style.width = ((lineIdx + 1) / lines.length * 85) + '%';

            setTimeout(function() {
                lineEl.style.opacity = '1';
                lineEl.style.transform = 'translateX(0)';
            }, 50);

            lineIdx++;
            setTimeout(typeLine, 250 + Math.random() * 150);
        }

        setTimeout(typeLine, 200);
    }

    /* ══════════════════════════════════════
       TRANSITION DE THÈME — 3 PHASES
       Détection → Corruption → Réinitialisation
       ══════════════════════════════════════ */
    function playThemeTransition() {
        if (reducedMotion) return;

        var overlay = document.createElement('div');
        overlay.id = 'nier-transition';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:100001;pointer-events:none;overflow:hidden;';
        document.body.appendChild(overlay);

        // Phase 1: Detection (0-300ms) — crimson scan line
        var scanLine = document.createElement('div');
        scanLine.style.cssText = 'position:absolute;top:50%;left:-10%;width:120%;height:2px;' +
            'background:linear-gradient(90deg,transparent 0%,#C4362B 30%,rgba(58,110,165,0.8) 50%,#C4362B 70%,transparent 100%);' +
            'box-shadow:0 0 20px rgba(196,54,43,0.6),0 -2px 10px rgba(196,54,43,0.3),0 2px 10px rgba(58,110,165,0.3);' +
            'transform:translateX(-100%);transition:transform 0.3s ease-in;';
        overlay.appendChild(scanLine);

        // Chromatic aberration layer
        var chromatic = document.createElement('div');
        chromatic.style.cssText = 'position:absolute;inset:0;opacity:0;transition:opacity 0.1s;' +
            'background:linear-gradient(0deg,rgba(196,54,43,0.05) 0%,transparent 30%,transparent 70%,rgba(58,110,165,0.05) 100%);';
        overlay.appendChild(chromatic);

        // Phase 1 start
        requestAnimationFrame(function() {
            scanLine.style.transform = 'translateX(100%)';
            chromatic.style.opacity = '1';
        });

        // Phase 2: Corruption (300-800ms)
        setTimeout(function() {
            scanLine.remove();

            // Generate corruption bands
            for (var i = 0; i < 12; i++) {
                var band = document.createElement('div');
                var top = Math.random() * 100;
                var height = 2 + Math.random() * 6;
                var offsetX = (Math.random() - 0.5) * 30;
                band.style.cssText = 'position:absolute;top:' + top + '%;left:0;right:0;height:' + height + 'px;' +
                    'background:rgba(245,240,232,0.6);transform:translateX(' + offsetX + 'px);' +
                    'mix-blend-mode:difference;';
                band.className = 'nier-corrupt-band';
                overlay.appendChild(band);
            }

            // Random characters
            for (var j = 0; j < 20; j++) {
                var ch = document.createElement('span');
                ch.textContent = hexChars[Math.floor(Math.random() * 16)];
                ch.style.cssText = 'position:absolute;color:#C4362B;font-family:"Courier New",monospace;font-size:' +
                    (8 + Math.random() * 14) + 'px;opacity:' + (0.2 + Math.random() * 0.5) +
                    ';left:' + (Math.random() * 100) + '%;top:' + (Math.random() * 100) + '%;';
                overlay.appendChild(ch);
            }

            // Chromatic split intensifies
            chromatic.style.background = 'linear-gradient(0deg,rgba(196,54,43,0.12) 0%,transparent 25%,transparent 75%,rgba(58,110,165,0.12) 100%)';
        }, 300);

        // Phase 3: Reset (800-1200ms)
        setTimeout(function() {
            // White flash
            var flash = document.createElement('div');
            flash.style.cssText = 'position:absolute;inset:0;background:#FFFFFF;opacity:0.6;' +
                'transition:opacity 0.15s;';
            overlay.appendChild(flash);

            setTimeout(function() {
                flash.style.opacity = '0';
            }, 50);

            // Clean up corruption bands and chars
            var bands = overlay.querySelectorAll('.nier-corrupt-band, span');
            for (var k = 0; k < bands.length; k++) {
                bands[k].style.opacity = '0';
                bands[k].style.transition = 'opacity 0.1s';
            }
            chromatic.style.opacity = '0';
        }, 800);

        // Remove overlay
        setTimeout(function() {
            overlay.remove();
            // POD confirmation
            if (active) {
                showPodMessage('Système réinitialisé. Thème YoRHa actif.');
            }
        }, 1200);
    }

    /* ══════════════════════════════════════
       KEYBOARD SHORTCUT — P to toggle POD
       ══════════════════════════════════════ */
    var podEnabled = true;

    function onKeyDown(e) {
        if (!active) return;
        if (e.key === 'p' || e.key === 'P') {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
            e.preventDefault();
            podEnabled = !podEnabled;
            if (podEnabled) {
                createPod();
            } else {
                destroyPod();
            }
        }
    }

    /* ══════════════════════════════════════
       MASTER CONTROLLER
       ══════════════════════════════════════ */
    function activate() {
        if (active) return;
        active = true;

        // Couche 2 — Poussière
        startDust();

        // Couche 4 — Glitch au survol
        bindGlitch();

        // Couche — Onde de choc
        document.addEventListener('click', onClickShockwave);

        // Couche 5 — Grille de données
        createGrid();

        // Couche 6 — POD 042
        if (podEnabled) createPod();

        // Couche 7 — Corruption d'inactivité
        document.addEventListener('mousemove', resetInactivity);
        document.addEventListener('scroll', resetInactivity, { passive: true });
        document.addEventListener('click', resetInactivity);
        startInactivityTimer();

        // Data stream
        startDataStream();

        // Curseur amélioré
        createCursor();

        // CTA scan
        bindCTAScan();

        // Keyboard shortcut
        document.addEventListener('keydown', onKeyDown);

        // Dynamic favicon
        setNierFavicon();
    }

    function deactivate() {
        active = false;

        // Couche 2
        stopDust();

        // Couche 4
        unbindGlitch();

        // Onde de choc
        document.removeEventListener('click', onClickShockwave);

        // Couche 5
        removeGrid();

        // Couche 6
        destroyPod();

        // Couche 7
        destroyCorruption();
        document.removeEventListener('mousemove', resetInactivity);
        document.removeEventListener('scroll', resetInactivity);
        document.removeEventListener('click', resetInactivity);

        // Data stream
        stopDataStream();

        // Curseur
        destroyCursor();

        // CTA scan
        unbindCTAScan();

        // Keyboard
        document.removeEventListener('keydown', onKeyDown);

        // Favicon
        restoreFavicon();
    }

    /* ── Theme observer with transition ── */
    var previousTheme = document.documentElement.getAttribute('data-theme');
    var observer = new MutationObserver(function() {
        var currentTheme = document.documentElement.getAttribute('data-theme');
        if (currentTheme === 'nier' && previousTheme !== 'nier') {
            playThemeTransition();
            activate();
        } else if (currentTheme !== 'nier' && previousTheme === 'nier') {
            deactivate();
        }
        previousTheme = currentTheme;
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    /* ── Visibility change — pause when hidden ── */
    document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
            if (active) {
                stopDust();
                stopDataStream();
                if (podAnimId) { cancelAnimationFrame(podAnimId); podAnimId = null; }
                if (cursorAnimId) { cancelAnimationFrame(cursorAnimId); cursorAnimId = null; }
            }
        } else if (isNier()) {
            if (active) {
                startDust();
                startDataStream();
                podAnimId = requestAnimationFrame(animatePod);
                cursorAnimId = requestAnimationFrame(animateCursor);
            }
        }
    });

    /* ── Window resize ── */
    window.addEventListener('resize', function() {
        if (active) {
            resizeDust();
            if (dataStreamCanvas) {
                dataStreamCanvas.height = window.innerHeight;
            }
            if (cursorTrailCanvas) {
                cursorTrailCanvas.width = window.innerWidth;
                cursorTrailCanvas.height = window.innerHeight;
            }
        }
    });

    /* ── Initial check ── */
    if (isNier()) {
        playBootAnimation();
        activate();
    }

})();
