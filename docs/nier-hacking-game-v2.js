/* ═══════════════════════════════════════════════════════════════
   COREWAR DEBUGGER  –  Hacking Minigame v6
   ═══════════════════════════════════════════════════════════════
   Fusion: NieR:Automata hacking × Core War VM debugging
   - Play as an antivirus debugger cleaning infected VM memory
   - Write Red Code before each level to boost abilities
   - ADD=damage, STI=split bullets, ZJMP=fast dash, LIVE=regen
   - FORK=double shot, LD=shield, SUB=bullet speed, AND=fire rate
   - Each level = hostile warrior process to terminate
   Controls: WASD move, Arrow keys aim, Left click shoot, Space dash, F fullscreen
   ═══════════════════════════════════════════════════════════════ */

(function () {
    "use strict";

    /* ══════════════ CONSTANTS ══════════════ */
    let MAZE_W = 16, MAZE_H = 12;
    const CELL = 2.0;
    const HALF = CELL / 2;
    const PLAYER_SPEED = 5.0;
    const BULLET_SPEED = 14;
    const ENEMY_BULLET_SPEED = 3.3;    // 3x slower — slow dark bullets
    const SHOOT_CD = 0.11;
    const MAX_HP = 100;
    const INVULN_T = 0.6;
    const DASH_SPEED = 15.0;
    const DASH_DURATION = 0.15;
    const DASH_COOLDOWN = 1.5;
    const MAX_PARTICLES = 60;   // hard cap to prevent frame drops
    const MAX_EBULLETS = 80;    // more enemy bullets on screen (bigger, slower, more numerous)

    /* Authentic NieR:Automata palette — sepia and warm grey minimalist theme */
    const C_BG       = 0x4d4b43;  // Warm dark sepia-grey background void
    const C_BORDER   = 0xd2734a;  // Signature warm orange-sepia for border cubes
    const C_FLOOR    = 0xd2d0c6;  // Clean warm beige for flat floor plane
    const C_WALL     = 0x9c9a91;  // Muted warm grey for inner obstacles
    const C_WALLTOP  = 0xa5a39b;  // Muted light grey for wall tops
    const C_PLAYER   = 0xFFFFFF;
    const C_ENEMY    = 0x000000;
    const C_ENEMYEMT = 0xFF6600;
    const C_PBULLET  = 0xFFFFFF;
    const C_EBULLET  = 0xFF0000;
    const C_RING     = 0xFF5500;
    const C_PARTICLE = 0xFFFFFF;
    const C_YORHA    = 0xd2734a;  // signature sepia-orange YoRHa accent
    const C_SHIELD   = 0xFFFFFF;  // Pure white shield circle outline
    const C_GOLD     = 0xFFD700;

    const LEVELS = [
        { name:"PROCESS_0x01", enemies:3,  hpMul:1,   spdMul:1,   shootRate:1.4, patterns:["aimed"], types:["scout","scout","core"], codeLines:1, tutorial:"add r1, r2, r3" },
        { name:"PROCESS_0x02", enemies:4,  hpMul:1.2, spdMul:1.1, shootRate:1.2, patterns:["aimed","burst"], types:["scout","scout","drone","core"], codeLines:1 },
        { name:"PROCESS_0x03", enemies:5,  hpMul:1.4, spdMul:1.2, shootRate:1.0, patterns:["aimed","burst","ring"], types:["scout","scout","drone","drone","core"], codeLines:1 },
        { name:"PROCESS_0x04", enemies:5,  hpMul:1.7, spdMul:1.3, shootRate:0.9, patterns:["aimed","burst","ring"], types:["scout","drone","drone","drone","core"], codeLines:2 },
        { name:"PROCESS_0x05", enemies:6,  hpMul:2.0, spdMul:1.4, shootRate:0.8, patterns:["aimed","burst","ring","spiral"], types:["scout","scout","drone","drone","drone","core"], codeLines:2 },
        { name:"PROCESS_0x06", enemies:7,  hpMul:2.3, spdMul:1.5, shootRate:0.7, patterns:["aimed","ring","spiral","wall"], types:["scout","drone","drone","drone","drone","drone","core"], codeLines:2 },
        { name:"PROCESS_0x07", enemies:8,  hpMul:2.8, spdMul:1.7, shootRate:0.6, patterns:["aimed","burst","ring","spiral","wall"], types:["scout","scout","drone","drone","drone","drone","drone","core"], codeLines:3 },
        { name:"KERNEL_PANIC", enemies:10, hpMul:3.5, spdMul:2.0, shootRate:0.5, patterns:["aimed","burst","ring","spiral","wall"], types:["scout","scout","drone","drone","drone","drone","drone","drone","drone","core"], codeLines:3 },
    ];

    /* ══════════════ STATE ══════════════ */
    let scene, camera, renderer, clock;
    let cameraPersp, cameraOrtho, dirLight, ambientLight;
    let is3D = true;
    let playerMesh, playerPos = {x:0,z:0}, playerAngle = 0, playerHP = MAX_HP;
    let mazeGrid = null;
    let wallMeshes = [], floorMesh = null, gridGroup = null;
    let enemies = [], pBullets = [], eBullets = [], particles = [];
    let powerups = [], powerupTimer = 0;
    let playerUpgrade = "standard";
    let upgradeTimeRemaining = 0;
    let curLvl = 0, score = 0, invulnT = 0, shootT = 0;
        let active = false, paused = false, rafId = null;
    let isFS = false, sceneOK = false;
    let screenFlash = 0;
    let shakeAmount = 0;
    let glitchTimer = 0;
    let glitchIntensity = 0;
    let podQueue = [];
    let podTimer = 0;
    let podEl = null;
    let transitionEl = null;
    let transitioning = false;
    const keys = {};
    let mouseDown = false;

    /* HUD Cache to prevent redundant DOM updates */
    let lastHUDState = { hp: -1, hpBar: -1, score: -1, lvl: -1, enm: -1, name: "" };

    /* DOM cache for hot paths */
    let wrapEl = null, glitchEl = null, vigEl = null;

    /* Dash state */
    let dashT = 0;
    let dashCooldownT = 0;
    let dashDir = {x:0, z:0};
    let dashAfterimages = [];

    /* Lock-on State */
    let isLockMode = false;
    let lockTargets = [];
    let rightMouseDown = false;
    let lockSoundThrottle = 0;
    let lockUIMeshes = [];

    /* Red Code Buffs */
    let playerBuffs = { damageMul: 1, bulletSplit: false, dashDistMul: 1, regenHP: 0, doubleShot: false, shieldTime: 0, bulletSpeedMul: 1, fireRateMul: 1 };
    let codeEditorEl = null;
    let codeEditorActive = false;
    let codeEditorBtnIdx = 1; /* 0=Skip, 1=Compile */
    let codeEditorBtns = [];
    let suppressFSExit = false; /* Prevent Escape from exiting fullscreen when blurring textarea */

    /* Slow-Motion State */
    let slowMoT = 0;
    let timeScale = 1.0;

    /* Boot Terminal State */
    let bootActive = false;
    let bootTimer = 0;
    let bootEl = null;

    /* Ambient particles */
    let ambientParticles = [];

    /* Enemy floor glows */
    let enemyGlows = [];

    /* Shared geos & mats */
    let geoBullet, geoEBullet, geoBeamGlow, matPBullet, matPBeamGlow, matEBullet, matEBullets, geoParticle, matHeavyBullet;
    let geoBulletRing, matBulletRing, geoHeavyBullet, geoHeavyBulletRing, matHeavyBulletRing, geoEBulletCore, geoEBulletShell, matEBulletCore, matEBulletShell;
    let geoWallH, geoWallV, matWall, matWallTop, matWallEdge;
    let geoPlayer;
    /* Shared geos for particles (avoid per-spawn allocation) */
    let geoTrail, geoSpark, geoDeathSmall, geoDeathMed, geoGlowCircle;
    let geoRingEffect, geoLaserTrail, matLaserTrail;
    let matTrailPlayer, matTrailEnemy;

    /* DOM */
    let canvas, overlay, hudHP, hudBar, hudScore, hudLvl, hudEnm, hudName, fsBtn, flashEl, muteBtn, viewBtn;
    let pauseMenu, pauseItems, pauseIdx = 0;
    let pauseWasActive = false;

    /* ══════════════ AUDIO MANAGER ══════════════
       Uses simple <audio> elements for SFX — much more reliable
       than Web Audio API fetch+decode which silently fails.       */
    const AudioManager = (function () {
        let bgm = null;
        const sfxPool = {};   // name → [Audio, Audio, ...] object pool
        const sfxIndex = {};  // name → next pool index (round-robin)
        let isMuted = false;
        let isInitialized = false;
        const POOL_SIZE = 4;  // concurrent instances per SFX

        const sfxFiles = {
            player_shoot: 'YoRHaHackingGame/sound/sfx/player_shoot.wav',
            enemy_shoot: 'YoRHaHackingGame/sound/sfx/enemy_shoot.wav',
            player_hit: 'YoRHaHackingGame/sound/sfx/player_hit.wav',
            enemy_hit: 'YoRHaHackingGame/sound/sfx/enemy_hit.wav',
            enemy_explode: 'YoRHaHackingGame/sound/sfx/enemy_explode.wav',
            core_broken: 'YoRHaHackingGame/sound/sfx/core_broken.wav',
            player_explode: 'YoRHaHackingGame/sound/sfx/player_explode.wav',
            bullet_cancel: 'YoRHaHackingGame/sound/sfx/contact.wav',
            button_select: 'YoRHaHackingGame/sound/sfx/button_select.wav',
            button_enter: 'YoRHaHackingGame/sound/sfx/button_enter.wav',
            type: 'YoRHaHackingGame/sound/sfx/type.wav'
        };

        return {
            init: function () {
                if (isInitialized) return;
                isMuted = localStorage.getItem('nh_muted') === 'true';
                this.updateMuteUI();

                /* BGM — single <audio> element */
                bgm = new Audio();
                bgm.src = 'YoRHaHackingGame/sound/bgm/Fortress_of_Lies.ogg';
                bgm.loop = true; bgm.volume = 0.4; bgm.muted = isMuted;

                /* SFX — pre-create pool of <audio> elements for each sound.
                   This avoids the Web Audio API fetch+decode issues entirely. */
                for (const name in sfxFiles) {
                    sfxPool[name] = [];
                    sfxIndex[name] = 0;
                    for (let i = 0; i < POOL_SIZE; i++) {
                        const a = new Audio();
                        a.src = sfxFiles[name];
                        a.volume = name === 'player_shoot' ? 0.4 : (name === 'type' ? 0.3 : (name === 'bullet_cancel' ? 0.25 : 0.7));
                        a.muted = isMuted;
                        a.preload = 'auto';
                        sfxPool[name].push(a);
                    }
                }

                isInitialized = true;
            },
            playBGM: function () {
                if (!bgm) return; bgm.muted = isMuted;
                bgm.play().catch(() => {});
            },
            stopBGM: function () { if (!bgm) return; bgm.pause(); bgm.currentTime = 0; },
            resumeContext: function () { /* no-op — not using Web Audio API */ },
            playSFX: function (name) {
                if (isMuted || !sfxPool[name]) return;
                const pool = sfxPool[name];
                const idx = sfxIndex[name];
                const a = pool[idx % pool.length];
                sfxIndex[name] = idx + 1;
                /* Reset and play — clone approach for overlapping sounds */
                try {
                    a.currentTime = 0;
                    a.muted = isMuted;
                    a.play().catch(() => {});
                } catch(e) {
                    /* Silently skip — avoid creating orphan Audio objects that leak memory */
                }
            },
            toggleMute: function () {
                isMuted = !isMuted; localStorage.setItem('nh_muted', isMuted);
                if (bgm) { bgm.muted = isMuted; }
                /* Update all SFX pool elements */
                for (const name in sfxPool) {
                    sfxPool[name].forEach(a => { a.muted = isMuted; });
                }
                this.updateMuteUI();
            },
            updateMuteUI: function () {
                const btn = document.getElementById('nh-mute');
                if (btn) { btn.textContent = isMuted ? '🔇' : '🔊'; btn.title = isMuted ? 'Activer le son (M)' : 'Couper le son (M)'; }
            }
        };
    })();

    /* ══════════════ RED CODE PARSER ══════════════ */
    const REDCODE_INSTRUCTIONS = {
        add:  { name: "ADD",  desc: "+50% damage",           color: "#FF6600" },
        sti:  { name: "STI",  desc: "Splitting projectiles",  color: "#00FFFF" },
        zjmp: { name: "ZJMP", desc: "+100% dash distance",    color: "#FFD700" },
        live: { name: "LIVE", desc: "+2 HP/sec regen",        color: "#00FF00" },
        fork: { name: "FORK", desc: "Double shot",            color: "#FF00FF" },
        ld:   { name: "LD",   desc: "+3s shield",             color: "#00AAFF" },
        sub:  { name: "SUB",  desc: "+30% bullet speed",      color: "#FF4444" },
        and:  { name: "AND",  desc: "+20% fire rate",         color: "#AAAAFF" },
    };

    function parseRedCode(code) {
        const buffs = { damageMul: 1, bulletSplit: false, dashDistMul: 1, regenHP: 0, doubleShot: false, shieldTime: 0, bulletSpeedMul: 1, fireRateMul: 1 };
        const detected = [];
        const lines = code.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
        for (const line of lines) {
            const trimmed = line.trim().toLowerCase();
            const instr = trimmed.split(/[\s,]+/)[0];
            if (instr === 'add' && buffs.damageMul < 2.5) { buffs.damageMul += 0.5; detected.push({ instr: 'add', valid: true }); }
            else if (instr === 'sti' && !buffs.bulletSplit) { buffs.bulletSplit = true; detected.push({ instr: 'sti', valid: true }); }
            else if (instr === 'zjmp' && buffs.dashDistMul < 3) { buffs.dashDistMul += 1; detected.push({ instr: 'zjmp', valid: true }); }
            else if (instr === 'live' && buffs.regenHP < 6) { buffs.regenHP += 2; detected.push({ instr: 'live', valid: true }); }
            else if (instr === 'fork' && !buffs.doubleShot) { buffs.doubleShot = true; detected.push({ instr: 'fork', valid: true }); }
            else if (instr === 'ld' && buffs.shieldTime < 9) { buffs.shieldTime += 3; detected.push({ instr: 'ld', valid: true }); }
            else if (instr === 'sub' && buffs.bulletSpeedMul < 2) { buffs.bulletSpeedMul += 0.3; detected.push({ instr: 'sub', valid: true }); }
            else if (instr === 'and' && buffs.fireRateMul < 2) { buffs.fireRateMul += 0.2; detected.push({ instr: 'and', valid: true }); }
            else if (instr) { detected.push({ instr, valid: false }); }
        }
        return { buffs, detected };
    }

    function showCodeEditor(callback) {
        if(!wrapEl) wrapEl = document.getElementById("nier-hack-wrapper");
        if(!wrapEl) { callback(); return; }

        const lvl = LEVELS[curLvl];
        const maxLines = lvl.codeLines || 1;

        /* Create or reuse editor overlay */
        if(!codeEditorEl) {
            codeEditorEl = document.createElement("div");
            codeEditorEl.id = "nh-code-editor";
            const canvasWrap = canvas.parentElement;
            if(canvasWrap) canvasWrap.appendChild(codeEditorEl);
        }

        codeEditorEl.style.cssText = "position:absolute;inset:0;background:#08080C;z-index:15;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:'Courier New',monospace;color:#D4CFC6;padding:20px;box-sizing:border-box;";

        /* Build instruction table — Core War opcode style */
        let refHTML = `<div style="margin-bottom:12px;width:100%;max-width:780px;border:1px solid #222;">`;
        refHTML += `<div style="display:flex;background:#111;border-bottom:1px solid #222;padding:6px 10px;font-size:1rem;color:#555;letter-spacing:0.15em;">`;
        refHTML += `<span style="width:120px;">OPCODE</span><span style="flex:1;">EFFECT</span><span style="width:70px;text-align:right;">TYPE</span></div>`;
        for (const [key, info] of Object.entries(REDCODE_INSTRUCTIONS)) {
            refHTML += `<div style="display:flex;align-items:center;padding:4px 10px;border-bottom:1px solid #1A1A1A;font-size:1.1rem;">`;
            refHTML += `<span style="width:120px;color:${info.color};font-weight:bold;letter-spacing:0.05em;">${info.name}</span>`;
            refHTML += `<span style="flex:1;color:#777;">${info.desc}</span>`;
            refHTML += `<span style="width:70px;text-align:right;font-size:0.9rem;color:#333;letter-spacing:0.1em;">${key === 'add' || key === 'sub' || key === 'and' ? 'ALU' : key === 'sti' || key === 'ld' ? 'MEM' : key === 'zjmp' || key === 'fork' ? 'CTL' : 'SPE'}</span>`;
            refHTML += `</div>`;
        }
        refHTML += `</div>`;

        /* Tutorial hint for first level */
        let tutorialHTML = '';
        if(lvl.tutorial) {
            tutorialHTML = `<div style="margin-bottom:10px;font-size:1.1rem;color:#667788;letter-spacing:0.03em;">$ pod042 --suggest "<span style="color:#FF6600;">${lvl.tutorial}</span>"</div>`;
        }

        codeEditorEl.innerHTML = `
            <div style="width:100%;max-width:780px;">
                <!-- Terminal header bar -->
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;padding:4px 0;">
                    <span style="width:8px;height:8px;border-radius:50%;background:#FF5F57;"></span>
                    <span style="width:8px;height:8px;border-radius:50%;background:#FEBC2E;"></span>
                    <span style="width:8px;height:8px;border-radius:50%;background:#28C840;"></span>
                    <span style="flex:1;"></span>
                    <span style="font-size:0.9rem;color:#333;letter-spacing:0.2em;">ARENA SHELL v3.14</span>
                </div>

                <!-- Main terminal window -->
                <div style="background:#0A0A0E;border:1px solid #1A1A1A;padding:12px 14px;">

                    <!-- Shell prompt header -->
                    <div style="font-size:1.05rem;color:#4A4A4A;letter-spacing:0.05em;margin-bottom:6px;">corewar-arena $ cat /proc/${lvl.name}/status</div>
                    <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:12px;">
                        <span style="font-size:1.8rem;letter-spacing:0.15em;color:#C4362B;font-weight:bold;">${lvl.name}</span>
                        <span style="font-size:0.95rem;color:#333;">SECTOR ${curLvl+1}/${LEVELS.length} | LINES: ${maxLines}</span>
                    </div>

                    <!-- Instruction reference table -->
                    ${refHTML}

                    <!-- Tutorial -->
                    ${tutorialHTML}

                    <!-- Code input area — terminal style with line numbers -->
                    <div style="display:flex;border:1px solid #222;margin-top:8px;background:#050508;">
                        <div id="nh-line-numbers" style="padding:10px 8px;background:#0A0A0E;border-right:1px solid #1A1A1A;color:#333;font-size:1.4rem;line-height:1.35;text-align:right;min-width:36px;user-select:none;"></div>
                        <textarea id="nh-code-input" rows="${maxLines}" maxlength="${maxLines*40}" spellcheck="false"
                            style="flex:1;background:transparent;border:none;color:#00FF00;font-family:'Courier New',monospace;font-size:1.4rem;padding:10px 12px;line-height:1.35;letter-spacing:0.05em;resize:none;outline:none;"
                            placeholder="_"></textarea>
                    </div>

                    <!-- Buffs preview -->
                    <div id="nh-code-buffs" style="margin-top:8px;min-height:22px;font-size:1rem;color:#555;"></div>

                    <!-- Error display -->
                    <div id="nh-code-error" style="display:none;margin-top:6px;font-size:1rem;color:#FF3333;letter-spacing:0.03em;"></div>

                    <!-- Action buttons — terminal command style -->
                    <div style="display:flex;gap:10px;margin-top:10px;">
                        <button id="nh-code-skip" style="padding:6px 22px;background:transparent;border:1px solid #333;color:#555;font-family:'Courier New',monospace;font-size:1.1rem;letter-spacing:0.1em;cursor:pointer;transition:border-color 0.15s,color 0.15s;">[skip]</button>
                        <button id="nh-code-compile" style="padding:6px 22px;background:transparent;border:1px solid #C4362B;color:#C4362B;font-family:'Courier New',monospace;font-size:1.1rem;letter-spacing:0.1em;cursor:pointer;transition:border-color 0.15s,color 0.15s;">[compile]</button>
                    </div>

                    <!-- Footer info -->
                    <div style="display:flex;justify-content:space-between;margin-top:10px;padding-top:6px;border-top:1px solid #1A1A1A;">
                        <span style="font-size:0.8rem;color:#2A2A2A;letter-spacing:0.08em;">MEM 4096 | IDX 512 | CTD 1536</span>
                        <span style="font-size:0.8rem;color:#2A2A2A;letter-spacing:0.08em;">ESC:unfocus | LEFT/RIGHT:select | ENTER:confirm</span>
                    </div>
                </div>
            </div>
        `;

        /* Live parsing on input */
        const textarea = document.getElementById('nh-code-input');
        const buffsDisplay = document.getElementById('nh-code-buffs');
        const lineNumbers = document.getElementById('nh-line-numbers');

        function updateLineNumbers() {
            const lines = textarea.value.split('\n').length;
            let nums = '';
            for(let i = 1; i <= Math.max(lines, maxLines); i++) {
                nums += (i <= maxLines ? i : '') + '\n';
            }
            lineNumbers.textContent = nums.trimEnd();
        }

        function updateBuffsPreview() {
            const code = textarea.value;
            const { buffs, detected } = parseRedCode(code);
            if(detected.length === 0) {
                buffsDisplay.innerHTML = '<span style="color:#333;">// no instructions parsed</span>';
            } else {
                buffsDisplay.innerHTML = detected.map(d => {
                    if(d.valid) {
                        const info = REDCODE_INSTRUCTIONS[d.instr];
                        return `<span style="color:${info ? info.color : '#888'};">+ ${info ? info.name : d.instr}</span>`;
                    } else {
                        return `<span style="color:#FF3333;">! ${d.instr}: UNKNOWN</span>`;
                    }
                }).join(' &nbsp;');
            }
            updateLineNumbers();
        }

        /* Enforce line limit — Enter compiles when all lines are filled */
        textarea.addEventListener('keydown', function(ev) {
            if(ev.code === 'Enter' || ev.code === 'NumpadEnter') {
                const currentLines = textarea.value.split('\n').length;
                if(currentLines >= maxLines) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    /* Trigger compile instead of adding a new line */
                    const compileBtn = document.getElementById('nh-code-compile');
                    if(compileBtn){ AudioManager.playSFX('button_enter'); compileBtn.click(); }
                    return;
                }
            }
        });

        /* Also enforce line limit on paste */
        textarea.addEventListener('paste', function(ev) {
            ev.preventDefault();
            const pasted = (ev.clipboardData || window.clipboardData).getData('text');
            const currentLines = textarea.value.split('\n').length;
            const pastedLines = pasted.split('\n').length;
            if(currentLines + pastedLines - 1 > maxLines) {
                /* Only paste lines that fit */
                const remaining = maxLines - currentLines + 1;
                const trimmed = pasted.split('\n').slice(0, remaining).join('\n');
                document.execCommand('insertText', false, trimmed);
            } else {
                document.execCommand('insertText', false, pasted);
            }
            updateBuffsPreview();
        });

        textarea.addEventListener('input', updateBuffsPreview);
        updateLineNumbers();

        /* Compile button */
        document.getElementById('nh-code-compile').addEventListener('click', function() {
            const code = textarea.value;
            const { buffs, detected } = parseRedCode(code);

            /* Check for unknown instructions */
            const hasErrors = detected.some(d => !d.valid);
            if(hasErrors) {
                /* Show compile error and don't close editor */
                const errorDiv = document.getElementById('nh-code-error');
                if(errorDiv){
                    errorDiv.textContent = 'COMPILE ERROR: unknown opcode — aborting';
                    errorDiv.style.display = 'block';
                }
                AudioManager.playSFX('enemy_hit');
                return;
            }
            /* Clear any previous error */
            const errorDiv = document.getElementById('nh-code-error');
            if(errorDiv) errorDiv.style.display = 'none';

            playerBuffs = buffs;

            /* Apply shield */
            if(buffs.shieldTime > 0) {
                invulnT = Math.max(invulnT, buffs.shieldTime);
                if(playerMesh.userData.shieldMat) playerMesh.userData.shieldMat.opacity = 0.6;
            }

            /* Flash and hide */
            codeEditorActive = false;
            codeEditorEl.style.transition = "opacity 0.2s";
            codeEditorEl.style.opacity = "0";
            setTimeout(() => { codeEditorEl.style.display = "none"; callback(); }, 200);
        });

        /* Skip button */
        document.getElementById('nh-code-skip').addEventListener('click', function() {
            playerBuffs = { damageMul: 1, bulletSplit: false, dashDistMul: 1, regenHP: 0, doubleShot: false, shieldTime: 0, bulletSpeedMul: 1, fireRateMul: 1 };
            codeEditorActive = false;
            codeEditorEl.style.transition = "opacity 0.2s";
            codeEditorEl.style.opacity = "0";
            setTimeout(() => { codeEditorEl.style.display = "none"; callback(); }, 200);
        });

        /* Button navigation state */
        codeEditorActive = true;
        codeEditorBtnIdx = 1; /* Default to Compile */
        codeEditorBtns = [
            document.getElementById('nh-code-skip'),
            document.getElementById('nh-code-compile')
        ];

        /* Highlight the initially selected button */
        updCodeBtnHL();

        /* When textarea is focused, disable game shortcuts */
        textarea.addEventListener('focus', function() { codeEditorActive = true; });

        /* When Escape is pressed in textarea, blur it but stay in fullscreen */
        textarea.addEventListener('keydown', function(ev) {
            if(ev.code === 'Escape') {
                ev.preventDefault();
                ev.stopPropagation();
                suppressFSExit = true;
                textarea.blur();
                /* Re-request fullscreen after browser processes the Escape key */
                setTimeout(function(){
                    if(suppressFSExit && isFS){
                        const w = document.getElementById('nier-hack-wrapper');
                        if(w && !document.fullscreenElement){
                            w.requestFullscreen().then(function(){isFS=true;if(fsBtn)fsBtn.textContent="⤓";resizeR();}).catch(function(){});
                        }
                    }
                    suppressFSExit = false;
                }, 100);
            }
            /* Stop propagation so game input handler doesn't fire */
            ev.stopPropagation();
        });

        /* Focus textarea */
        setTimeout(() => { if(textarea) textarea.focus(); }, 100);
    }

    function updCodeBtnHL(){
        for(let i=0; i<codeEditorBtns.length; i++){
            const btn = codeEditorBtns[i];
            if(!btn) continue;
            if(i === codeEditorBtnIdx){
                btn.style.borderColor = '#FFF';
                btn.style.color = '#FFF';
                btn.style.boxShadow = '0 0 6px rgba(255,255,255,0.2)';
            } else {
                btn.style.borderColor = btn.id === 'nh-code-compile' ? '#C4362B' : '#333';
                btn.style.color = btn.id === 'nh-code-compile' ? '#C4362B' : '#555';
                btn.style.boxShadow = 'none';
            }
        }
    }

    /* ══════════════ MAZE ══════════════ */
    function genMaze() {
        const g = [];
        let map = [];

        if (curLvl === 0) {
            // SECTOR A: The Corridor
            map = [
                [1,1,1,1,1,1,1],
                [1,0,0,0,0,0,1],
                [1,0,0,0,0,0,1],
                [1,0,0,0,0,0,1],
                [1,0,0,0,0,0,1],
                [1,0,0,0,0,0,1],
                [1,0,0,0,0,0,1],
                [1,1,1,1,1,1,1]
            ];
        } else if (curLvl === 1) {
            // SECTOR B: Core Arena
            map = [];
            for(let i=0; i<9; i++){
                let row = [1,0,0,0,0,0,0,0,1];
                if(i===0 || i===8) row = [1,1,1,1,1,1,1,1,1];
                map.push(row);
            }
        } else if (curLvl === 2) {
            // SECTOR C: The Ring
            map = [
                [1,1,1,1,1,1,1,1,1,1,1],
                [1,0,0,0,0,0,0,0,0,0,1],
                [1,0,0,0,0,0,0,0,0,0,1],
                [1,0,0,2,2,2,2,2,0,0,1],
                [1,0,0,2,2,2,2,2,0,0,1],
                [1,0,0,2,2,2,2,2,0,0,1],
                [1,0,0,2,2,2,2,2,0,0,1],
                [1,0,0,2,2,2,2,2,0,0,1],
                [1,0,0,0,0,0,0,0,0,0,1],
                [1,0,0,0,0,0,0,0,0,0,1],
                [1,1,1,1,1,1,1,1,1,1,1]
            ];
        } else if (curLvl === 3) {
            // SECTOR D: Fortress
            map = [
                [1,1,1,1,1,1,1,1,1,1,1],
                [1,0,0,0,0,0,0,0,0,0,1],
                [1,0,1,1,0,1,0,1,1,0,1],
                [1,0,1,0,0,0,0,0,1,0,1],
                [1,0,0,0,1,0,1,0,0,0,1],
                [1,0,1,0,0,0,0,0,1,0,1],
                [1,0,1,1,0,1,0,1,1,0,1],
                [1,0,0,0,0,0,0,0,0,0,1],
                [1,1,1,1,1,1,1,1,1,1,1]
            ];
        } else if (curLvl === 4) {
            // SECTOR E: The Labyrinth — complex maze with dead ends
            map = [
                [1,1,1,1,1,1,1,1,1,1,1,1,1],
                [1,0,0,0,1,0,0,0,1,0,0,0,1],
                [1,0,1,0,1,0,1,0,0,0,1,0,1],
                [1,0,1,0,0,0,1,0,1,0,1,0,1],
                [1,0,1,1,1,0,1,1,1,0,1,0,1],
                [1,0,0,0,0,0,0,0,0,0,0,0,1],
                [1,0,1,1,1,0,1,1,1,0,1,0,1],
                [1,0,1,0,0,0,1,0,1,0,1,0,1],
                [1,0,1,0,1,0,1,0,0,0,1,0,1],
                [1,0,0,0,1,0,0,0,1,0,0,0,1],
                [1,1,1,1,1,1,1,1,1,1,1,1,1]
            ];
        } else if (curLvl === 5) {
            // SECTOR F: The Gauntlet — long narrow corridor with alcoves
            map = [
                [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
                [1,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
                [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1],
                [1,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
                [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1],
                [1,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
                [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1],
                [1,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
                [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]
            ];
        } else if (curLvl === 6) {
            // SECTOR G: The Hive — honeycomb pattern
            map = [
                [1,1,1,1,1,1,1,1,1,1,1,1,1],
                [1,0,0,0,1,0,0,0,1,0,0,0,1],
                [1,0,0,0,0,0,0,0,0,0,0,0,1],
                [1,0,0,0,1,0,0,0,1,0,0,0,1],
                [1,1,0,1,1,1,0,1,1,1,0,1,1],
                [1,0,0,0,1,0,0,0,1,0,0,0,1],
                [1,0,0,0,0,0,0,0,0,0,0,0,1],
                [1,0,0,0,1,0,0,0,1,0,0,0,1],
                [1,1,0,1,1,1,0,1,1,1,0,1,1],
                [1,0,0,0,1,0,0,0,1,0,0,0,1],
                [1,0,0,0,0,0,0,0,0,0,0,0,1],
                [1,0,0,0,1,0,0,0,1,0,0,0,1],
                [1,1,1,1,1,1,1,1,1,1,1,1,1]
            ];
        } else {
            // SECTOR Ω: The Void — open arena with rotating wall segments
            map = [
                [1,1,1,1,1,1,1,1,1,1,1,1,1],
                [1,0,0,0,0,0,0,0,0,0,0,0,1],
                [1,0,0,0,0,0,0,0,0,0,0,0,1],
                [1,0,0,1,0,0,0,0,0,1,0,0,1],
                [1,0,0,0,0,0,0,0,0,0,0,0,1],
                [1,0,0,0,0,2,2,2,0,0,0,0,1],
                [1,0,0,0,0,2,2,2,0,0,0,0,1],
                [1,0,0,0,0,2,2,2,0,0,0,0,1],
                [1,0,0,0,0,0,0,0,0,0,0,0,1],
                [1,0,0,1,0,0,0,0,0,1,0,0,1],
                [1,0,0,0,0,0,0,0,0,0,0,0,1],
                [1,0,0,0,0,0,0,0,0,0,0,0,1],
                [1,1,1,1,1,1,1,1,1,1,1,1,1]
            ];
        }

        MAZE_H = map.length;
        MAZE_W = map[0].length;

        for (let y = 0; y < MAZE_H; y++) {
            g[y]=[];
            for (let x = 0; x < MAZE_W; x++) {
                g[y][x]={
                    t: y===0 || map[y-1][x]===1 || map[y-1][x]===2,
                    r: x===MAZE_W-1 || map[y][x+1]===1 || map[y][x+1]===2,
                    b: y===MAZE_H-1 || map[y+1][x]===1 || map[y+1][x]===2,
                    l: x===0 || map[y][x-1]===1 || map[y][x-1]===2,
                    v: true,
                    hole: map[y][x] === 2,
                    wall: map[y][x] === 1
                };
            }
        }
        return g;
    }
        function c2w(cx,cy){return{x:cx*CELL+HALF,z:cy*CELL+HALF};}

    /* ══════════════ PROCEDURAL TEXTURES (CORS-Safe) ══════════════ */
    function generateProceduralTexture(type) {
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "rgba(0,0,0,0)";
        ctx.fillRect(0, 0, 64, 64);

        if (type === "block") {
            // Draw a high-fidelity orange hacking block with grid borders and cross lines
            ctx.strokeStyle = "#FF3300";
            ctx.lineWidth = 4;
            ctx.strokeRect(2, 2, 60, 60);
            ctx.fillStyle = "rgba(255, 51, 0, 0.15)";
            ctx.fillRect(4, 4, 56, 56);
            ctx.beginPath();
            ctx.moveTo(4, 4); ctx.lineTo(60, 60);
            ctx.moveTo(60, 4); ctx.lineTo(4, 60);
            ctx.stroke();
        } else if (type === "enemy") {
            // Hexagon with glowing border and center core
            ctx.strokeStyle = "#FF6600";
            ctx.lineWidth = 4;
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
                const angle = (Math.PI / 3) * i;
                const x = 32 + 28 * Math.cos(angle);
                const y = 32 + 28 * Math.sin(angle);
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.stroke();
            ctx.fillStyle = "rgba(255, 102, 0, 0.25)";
            ctx.fill();
        } else if (type === "core") {
            // Nested neon retro squares
            ctx.strokeStyle = "#C4362B";
            ctx.lineWidth = 3;
            ctx.strokeRect(8, 8, 48, 48);
            ctx.fillStyle = "rgba(196, 54, 43, 0.2)";
            ctx.fillRect(16, 16, 32, 32);
        } else if (type === "pbullet") {
            // Glowing white plasma sphere
            const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 28);
            grad.addColorStop(0, "rgba(255, 255, 255, 1)");
            grad.addColorStop(0.3, "rgba(200, 220, 255, 0.8)");
            grad.addColorStop(1, "rgba(0, 0, 0, 0)");
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(32, 32, 28, 0, Math.PI * 2);
            ctx.fill();
        } else if (type === "ebullet") {
            // Glowing orange/red enemy bullet
            const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 28);
            grad.addColorStop(0, "rgba(255, 100, 0, 1)");
            grad.addColorStop(0.4, "rgba(200, 20, 0, 0.8)");
            grad.addColorStop(1, "rgba(0, 0, 0, 0)");
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(32, 32, 28, 0, Math.PI * 2);
            ctx.fill();
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        return texture;
    }

    /* ══════════════ SCENE ══════════════ */
    function initScene(){
        try {
            scene = new THREE.Scene();
            scene.background = new THREE.Color(C_BG);
            scene.fog = new THREE.FogExp2(C_BG, 0.015);  // lighter fog so bullets remain visible

            /* Dual Cameras */
            const aspect = 960/540;
            const sz = 10;
            cameraOrtho = new THREE.OrthographicCamera(-sz*aspect, sz*aspect, sz, -sz, 0.1, 100);
            cameraOrtho.position.set(MAZE_W*CELL/2, 30, MAZE_H*CELL/2);
            cameraOrtho.lookAt(MAZE_W*CELL/2, 0, MAZE_H*CELL/2);

            cameraPersp = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
            cameraPersp.position.set(MAZE_W*CELL/2, 7, MAZE_H*CELL/2 + 6);
            cameraPersp.lookAt(MAZE_W*CELL/2, 0.5, MAZE_H*CELL/2);

            camera = is3D ? cameraPersp : cameraOrtho;

            renderer = new THREE.WebGLRenderer({canvas:canvas, antialias:true});
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            renderer.setSize(960, 540, false);
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFShadowMap; // PCF is faster than PCFSoft

            /* Cinematic 3D Lighting — dark dramatic atmosphere */
            ambientLight = new THREE.AmbientLight(0x404050, 0.6);
            scene.add(ambientLight);

            dirLight = new THREE.DirectionalLight(0xCCCCCC, 0.7);
            dirLight.position.set(MAZE_W*CELL/2, 20, MAZE_H*CELL/2 + 10);
            dirLight.castShadow = true;
            dirLight.shadow.mapSize.width = 1024;
            dirLight.shadow.mapSize.height = 1024;
            dirLight.shadow.camera.near = 0.5;
            dirLight.shadow.camera.far = 45;
            const d = 16;
            dirLight.shadow.camera.left = -d;
            dirLight.shadow.camera.right = d;
            dirLight.shadow.camera.top = d;
            dirLight.shadow.camera.bottom = -d;
            scene.add(dirLight);

            /* Subtle hemisphere fill for richer 3D look */
            const hemiLight = new THREE.HemisphereLight(0x444455, 0x222233, 0.3);
            scene.add(hemiLight);

            /* Player follow light — REMOVED per user request */

            clock = new THREE.Clock();

            /* Procedural Textures — CORS-safe, robust, high performance */
            const texPBullet = generateProceduralTexture("pbullet");
            const texEBullet = generateProceduralTexture("ebullet");
            const texBlockA = generateProceduralTexture("block");
            const texEnemy = generateProceduralTexture("enemy");
            const texCore = generateProceduralTexture("core");

            /* Shared resources — player beam + enemy bullet geometry */
            /* Shared resources — player bullet needle */
            geoBullet  = new THREE.CylinderGeometry(0.035, 0.035, 0.35, 6); // player bullet needle
            geoBullet.rotateX(Math.PI/2);
            matPBullet = new THREE.MeshBasicMaterial({color: 0xFFFFFF});

            /* Heavy player bullet needle */
            geoHeavyBullet = new THREE.CylinderGeometry(0.065, 0.065, 0.55, 6);
            geoHeavyBullet.rotateX(Math.PI/2);
            matHeavyBullet = new THREE.MeshBasicMaterial({color: 0xff8800});

            /* Enemy solid bullets */
            geoEBullet = new THREE.SphereGeometry(0.18, 10, 10);
            const matEBulletPurple = new THREE.MeshLambertMaterial({color: 0x482087, flatShading: true});
            const matEBulletOrange = new THREE.MeshLambertMaterial({color: 0xff6600, flatShading: true});
            window._matEBulletPurple = matEBulletPurple;
            window._matEBulletOrange = matEBulletOrange;

            /* Compatibility fallbacks to prevent errors */
            geoBulletRing = new THREE.BufferGeometry();
            matBulletRing = new THREE.MeshBasicMaterial({color: 0x000000, transparent: true, opacity: 0.0});
            geoHeavyBulletRing = new THREE.BufferGeometry();
            matHeavyBulletRing = new THREE.MeshBasicMaterial({color: 0x000000, transparent: true, opacity: 0.0});
            geoEBulletCore = geoEBullet;
            geoEBulletShell = geoEBullet;
            matEBulletCore = matEBulletPurple;
            matEBulletShell = matEBulletPurple;
            matPBeamGlow = new THREE.MeshBasicMaterial({color: 0x000000, transparent: true, opacity: 0.0});
            geoBeamGlow = new THREE.BufferGeometry();
            matEBullets = [ matEBulletPurple ];
            matEBullet = matEBulletPurple;

            geoParticle= new THREE.PlaneGeometry(0.08, 0.08);
            geoParticle.rotateX(-Math.PI/2);

            /* Enhanced wall materials — clean flat-shaded Lambertian blocks */
            geoWallH   = new THREE.BoxGeometry(CELL+0.15, 0.6, 0.15);
            geoWallV   = new THREE.BoxGeometry(0.15, 0.6, CELL+0.15);
            matWall    = new THREE.MeshLambertMaterial({color:C_WALL, flatShading:true});
            matWallTop = new THREE.MeshLambertMaterial({color:C_WALLTOP, flatShading:true});
            matWallEdge = new THREE.LineBasicMaterial({color:0x000000, transparent:true, opacity:0.0});

            geoPlayer = new THREE.PlaneGeometry(0.45, 0.45);
            geoPlayer.rotateX(-Math.PI/2);

            /* Shared particle geometries — reuse across all spawns */
            geoTrail = new THREE.PlaneGeometry(0.04, 0.04);
            geoTrail.rotateX(-Math.PI/2);
            geoSpark = new THREE.BoxGeometry(0.04, 0.04, 0.04);
            geoDeathSmall = new THREE.BoxGeometry(0.12, 0.12, 0.12);
            geoDeathMed = new THREE.BoxGeometry(0.22, 0.22, 0.22);
            geoGlowCircle = new THREE.CircleGeometry(0.5, 12); // lower segments for perf
            geoGlowCircle.rotateX(-Math.PI/2);

            /* Shared geometries for ring effects & laser trails — prevent GC storm */
            geoRingEffect = new THREE.TorusGeometry(0.1, 0.02, 4, 16);
            geoLaserTrail = new THREE.PlaneGeometry(0.12, 0.12);
            geoLaserTrail.rotateX(-Math.PI/2);
            matLaserTrail = new THREE.MeshBasicMaterial({color: 0x00FFFF, transparent: true, opacity: 0.65});

            /* Shared trail materials — only 2, reused forever */
            matTrailPlayer = new THREE.MeshBasicMaterial({color: 0xFFFFFF, transparent:true, opacity:0.35});
            matTrailEnemy = new THREE.MeshBasicMaterial({color: 0xFF4400, transparent:true, opacity:0.35});

            window._matEnemy = new THREE.MeshBasicMaterial({map: texEnemy, color: 0xFF6600, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide});
            window._matBlock = new THREE.MeshBasicMaterial({map: texBlockA, color: 0xFF3300, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide});
            window._matCore = new THREE.MeshBasicMaterial({map: texCore, color: 0x1A1A1A, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide});

            sceneOK = true;
        } catch(e){ console.error("[NH] Scene init failed:", e); }
    }

    /* ══════════════ BUILD ══════════════ */
    function clearMaze(){
        wallMeshes.forEach(m=>{scene.remove(m);}); wallMeshes=[];
        if(gridGroup){scene.remove(gridGroup); gridGroup=null;}
        if(floorMesh){scene.remove(floorMesh); floorMesh.geometry.dispose(); floorMesh=null;}
        // Clear ambient particles
        ambientParticles.forEach(p=>{scene.remove(p.mesh); if(p.mesh.geometry)p.mesh.geometry.dispose(); if(p.mesh.material)p.mesh.material.dispose();});
        ambientParticles=[];
        // Clear enemy glows
        enemyGlows.forEach(g=>{scene.remove(g); if(g.geometry)g.geometry.dispose(); if(g.material)g.material.dispose();});
        enemyGlows=[];
    }

    function buildMaze(){
        clearMaze();
        const mazeW = MAZE_W*CELL, mazeH = MAZE_H*CELL;

        /* Floor — authentic flat NieR off-white/beige floor plane */
        const fg = new THREE.PlaneGeometry((MAZE_W + 2) * CELL, (MAZE_H + 2) * CELL);
        const fm = new THREE.MeshLambertMaterial({
            color: C_FLOOR
        });
        floorMesh = new THREE.Mesh(fg, fm);
        floorMesh.rotation.x=-Math.PI/2;
        floorMesh.position.set(mazeW/2, -0.01, mazeH/2);
        floorMesh.receiveShadow = true;
        scene.add(floorMesh);

        /* Empty Grid Group for compatibility */
        gridGroup = new THREE.Group();

        scene.add(gridGroup);

        const geoMonolith = new THREE.BoxGeometry(CELL - 0.05, 0.60, CELL - 0.05);
        const matMonolith = new THREE.MeshLambertMaterial({color: C_WALL, flatShading: true});

        const geoHoleFloor = new THREE.PlaneGeometry(CELL - 0.08, CELL - 0.08);
        geoHoleFloor.rotateX(-Math.PI/2);
        const matHoleFloor = new THREE.MeshLambertMaterial({color: 0x36342e}); // solid recessed dark grey

        for(let y=0;y<MAZE_H;y++) for(let x=0;x<MAZE_W;x++){
            const c=mazeGrid[y][x], wx=x*CELL, wz=y*CELL;

            /* Render solid monolithic block if cell is c.wall */
            if(c.wall){
                const m=new THREE.Mesh(geoMonolith, matMonolith);
                m.position.set(wx+HALF, 0.30, wz+HALF);
                m.castShadow=true; m.receiveShadow=true;
                scene.add(m); wallMeshes.push(m);
            }

            /* Render danger recessed void pit if cell is c.hole */
            if(c.hole){
                const m=new THREE.Mesh(geoHoleFloor, matHoleFloor);
                m.position.set(wx+HALF, -0.08, wz+HALF);
                scene.add(m); wallMeshes.push(m);
            }

            if(c.t){
                const m=new THREE.Mesh(geoWallH,matWall);m.position.set(wx+HALF,0.30,wz);m.castShadow=true;m.receiveShadow=true;scene.add(m);wallMeshes.push(m);
            }
            if(c.l){
                const m=new THREE.Mesh(geoWallV,matWall);m.position.set(wx,0.30,wz+HALF);m.castShadow=true;m.receiveShadow=true;scene.add(m);wallMeshes.push(m);
            }
            if(y===MAZE_H-1&&c.b){
                const m=new THREE.Mesh(geoWallH,matWall);m.position.set(wx+HALF,0.30,wz+CELL);m.castShadow=true;m.receiveShadow=true;scene.add(m);wallMeshes.push(m);
            }
            if(x===MAZE_W-1&&c.r){
                const m=new THREE.Mesh(geoWallV,matWall);m.position.set(wx+CELL,0.30,wz+HALF);m.castShadow=true;m.receiveShadow=true;scene.add(m);wallMeshes.push(m);
            }
        }

        /* Border — Spawns adjacent thick boundary cubes of signature orange-sepia C_BORDER */
        const geoBorderBlock = new THREE.BoxGeometry(CELL, 0.60, CELL);
        const matBorderBlock = new THREE.MeshLambertMaterial({color: C_BORDER, flatShading: true});

        // Top and Bottom borders (including corners)
        for(let x = -1; x <= MAZE_W; x++){
            // Top border
            let mbTop = new THREE.Mesh(geoBorderBlock, matBorderBlock);
            mbTop.position.set(x * CELL + HALF, 0.30, -0.5 * CELL);
            mbTop.castShadow = true; mbTop.receiveShadow = true;
            scene.add(mbTop); wallMeshes.push(mbTop);

            // Bottom border
            let mbBottom = new THREE.Mesh(geoBorderBlock, matBorderBlock);
            mbBottom.position.set(x * CELL + HALF, 0.30, MAZE_H * CELL + HALF);
            mbBottom.castShadow = true; mbBottom.receiveShadow = true;
            scene.add(mbBottom); wallMeshes.push(mbBottom);
        }
        // Left and Right borders (excluding corners since they are already covered)
        for(let y = 0; y < MAZE_H; y++){
            // Left border
            let mbLeft = new THREE.Mesh(geoBorderBlock, matBorderBlock);
            mbLeft.position.set(-0.5 * CELL, 0.30, y * CELL + HALF);
            mbLeft.castShadow = true; mbLeft.receiveShadow = true;
            scene.add(mbLeft); wallMeshes.push(mbLeft);

            // Right border
            let mbRight = new THREE.Mesh(geoBorderBlock, matBorderBlock);
            mbRight.position.set(MAZE_W * CELL + HALF, 0.30, y * CELL + HALF);
            mbRight.castShadow = true; mbRight.receiveShadow = true;
            scene.add(mbRight); wallMeshes.push(mbRight);
        }

        /* Ambient floating data fragments */
        spawnAmbientParticles();
    }

    /* ══════════════ AMBIENT PARTICLES ══════════════ */
    function spawnAmbientParticles(){}

    function updAmbientParticles(dt, time){}

    /* ══════════════ ENEMY FLOOR GLOW ══════════════ */
    const _glowMat = new THREE.MeshBasicMaterial({color:0xFF4400, transparent:true, opacity:0.0});
    function updateEnemyGlows(){}

    /* ══════════════ PLAYER ══════════════ */
    function createPlayer(){
        if(playerMesh)scene.remove(playerMesh);

        const group = new THREE.Group();

        /* A) Main hull — flat-shaded low-poly triangular arrow/chevron shape */
        const hullShape = new THREE.Shape();
        hullShape.moveTo(0, 0.5);        // nose tip (forward = +Z)
        hullShape.lineTo(-0.35, -0.3);   // back-left
        hullShape.lineTo(-0.12, -0.15);  // inner notch left
        hullShape.lineTo(0, -0.25);      // tail center notch
        hullShape.lineTo(0.12, -0.15);   // inner notch right
        hullShape.lineTo(0.35, -0.3);    // back-right
        hullShape.closePath();
        
        const extrudeSettings = { depth: 0.12, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1 };
        const hullGeo = new THREE.ExtrudeGeometry(hullShape, extrudeSettings);
        hullGeo.rotateX(-Math.PI/2);     // lay flat: Y-up → Z-forward
        hullGeo.translate(0, 0, -0.1);   // center
        const hullMat = new THREE.MeshLambertMaterial({color:0xe6e4dc, flatShading:true});
        const hull = new THREE.Mesh(hullGeo, hullMat);
        hull.castShadow = true;
        group.add(hull);
        group.userData.hull = hull;

        /* B) Dark core sphere embedded in the tail center notch */
        const coreGeo = new THREE.SphereGeometry(0.08, 8, 8);
        const coreMat = new THREE.MeshBasicMaterial({color:0x2e2d28});
        const coreGlow = new THREE.Mesh(coreGeo, coreMat);
        coreGlow.position.set(0, 0, -0.18);
        group.add(coreGlow);
        group.userData.coreGlow = coreGlow;
        group.userData.coreMat = coreMat;

        /* C) Shield indicator ring (simple clean white ring outline) */
        const shieldGeo = new THREE.TorusGeometry(0.35, 0.008, 4, 32);
        const shieldMat = new THREE.MeshBasicMaterial({color:0xFFFFFF, transparent:true, opacity:0.0});
        const shieldRing = new THREE.Mesh(shieldGeo, shieldMat);
        shieldRing.rotation.x = Math.PI/2;
        group.add(shieldRing);
        group.userData.shieldRing = shieldRing;
        group.userData.shieldMat = shieldMat;

        playerMesh = group;
        playerMesh.scale.set(0.7, 0.7, 0.7);
        playerMesh.position.y = 0.35;
        scene.add(playerMesh);
    }

    /* ══════════════ ENEMIES ══════════════ */
    function mkEnemy(type){
        const g = new THREE.Group();

        if(type === "scout"){
            /* Type A - Scout: small, fast, single ring */
            const bodyGeo = new THREE.OctahedronGeometry(0.18, 0);
            const bodyMat = new THREE.MeshPhongMaterial({color:0x111111, emissive:0xFF6600, emissiveIntensity:0.3, flatShading:true});
            const body = new THREE.Mesh(bodyGeo, bodyMat);
            body.castShadow = true;
            g.add(body);
            g.userData.core = body;

            /* Two small wing protrusions */
            const wingGeo = new THREE.BoxGeometry(0.15, 0.015, 0.04);
            const wingMat = new THREE.MeshBasicMaterial({color:0xFF6600, transparent:true, opacity:0.6});
            const lw = new THREE.Mesh(wingGeo, wingMat);
            lw.position.set(-0.12, 0, 0);
            g.add(lw);
            const rw = new THREE.Mesh(wingGeo, wingMat.clone());
            rw.position.set(0.12, 0, 0);
            g.add(rw);

            /* Single ring */
            const ringGeo = new THREE.TorusGeometry(0.2, 0.008, 4, 16);
            const ringMat = new THREE.MeshBasicMaterial({color:0xFF6600, transparent:true, opacity:0.5, side:THREE.DoubleSide});
            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.rotation.x = Math.PI/2;
            g.add(ring);
            g.userData.rings = [ring];

        } else if(type === "drone"){
            /* Type B - Drone: medium, shielded, two rings at different tilts */
            const bodyGeo = new THREE.IcosahedronGeometry(0.22, 0);
            const bodyMat = new THREE.MeshPhongMaterial({color:0x333333, emissive:0xFF5500, emissiveIntensity:0.15, flatShading:true});
            const body = new THREE.Mesh(bodyGeo, bodyMat);
            body.castShadow = true;
            g.add(body);
            g.userData.core = body;

            /* Shield blocks — 3-4 small boxes orbiting */
            g.userData.shieldMeshes = [];
            const shieldsGroup = new THREE.Group();
            g.add(shieldsGroup);
            g.userData.shieldsGroup = shieldsGroup;
            const numShields = curLvl >= 3 ? 4 : 3;
            const R = 0.45;
            const shieldBoxGeo = new THREE.BoxGeometry(0.12, 0.06, 0.12);
            const shieldBoxMat = new THREE.MeshPhongMaterial({color:0x444444, emissive:0xFF3300, emissiveIntensity:0.2});
            for(let i=0; i<numShields; i++){
                const angle = (i / numShields) * Math.PI * 2;
                const box = new THREE.Mesh(shieldBoxGeo, shieldBoxMat.clone());
                box.position.set(Math.cos(angle)*R, 0, Math.sin(angle)*R);
                shieldsGroup.add(box);
                g.userData.shieldMeshes.push({mesh: box, hp: 2, angle: angle});
            }

            /* Two rings at different tilts */
            g.userData.rings = [];
            const ringGeo = new THREE.TorusGeometry(0.25, 0.008, 4, 24);
            const ringMat1 = new THREE.MeshBasicMaterial({color:0xFF5500, transparent:true, opacity:0.45, side:THREE.DoubleSide});
            const ring1 = new THREE.Mesh(ringGeo, ringMat1);
            ring1.rotation.x = Math.PI/2;
            ring1.rotation.y = 0.3;
            g.add(ring1);
            g.userData.rings.push(ring1);

            const ringMat2 = new THREE.MeshBasicMaterial({color:0xFF3300, transparent:true, opacity:0.3, side:THREE.DoubleSide});
            const ring2 = new THREE.Mesh(ringGeo, ringMat2);
            ring2.rotation.x = Math.PI/2 + 0.5;
            ring2.rotation.z = 0.4;
            g.add(ring2);
            g.userData.rings.push(ring2);

        } else if(type === "core"){
            /* Type C - Core: large boss with rotating muzzles */
            const bodyGeo = new THREE.DodecahedronGeometry(0.32, 0);
            const bodyMat = new THREE.MeshPhongMaterial({color:0x0A0A0A, emissive:0xFF6600, emissiveIntensity:0.2, flatShading:true});
            const body = new THREE.Mesh(bodyGeo, bodyMat);
            body.castShadow = true;
            g.add(body);
            g.userData.core = body;

            /* THREE orbital rings at different tilts */
            g.userData.rings = [];
            for(let i=0;i<3;i++){
                const rg=new THREE.TorusGeometry(0.32+i*0.14, 0.015, 8, 32);
                const rm=new THREE.MeshBasicMaterial({color:C_RING, transparent:true, opacity:0.6-i*0.15, side:THREE.DoubleSide});
                const ring=new THREE.Mesh(rg,rm);
                ring.rotation.x = Math.PI/2 + (Math.random()-0.5)*0.5;
                ring.rotation.y = (Math.random()-0.5)*0.5;
                g.add(ring);
                g.userData.rings.push(ring);
            }

            /* Orbiting shield blocks */
            g.userData.shieldMeshes = [];
            if(curLvl >= 1){
                const shieldsGroup = new THREE.Group();
                g.add(shieldsGroup);
                g.userData.shieldsGroup = shieldsGroup;
                const numShields = curLvl <= 1 ? 2 : (curLvl <= 3 ? 3 : 4);
                const R = 0.55;
                const shieldBoxGeo = new THREE.PlaneGeometry(0.25, 0.25);
                shieldBoxGeo.rotateX(-Math.PI/2);
                for(let i=0; i<numShields; i++){
                    const angle = (i / numShields) * Math.PI * 2;
                    const box = new THREE.Mesh(shieldBoxGeo, window._matBlock.clone());
                    box.position.set(Math.cos(angle)*R, 0, Math.sin(angle)*R);
                    shieldsGroup.add(box);
                    g.userData.shieldMeshes.push({mesh: box, hp: 3, angle: angle});
                }
            }

            /* Rotating muzzle system — inspired by enemy_type_0C.gd */
            const muzzGroup = new THREE.Group();
            g.add(muzzGroup);
            g.userData.muzzGroup = muzzGroup;
            g.userData.muzzDeg = 0;
            g.userData.muzzSpeed = 100; // degrees per second, increases with damage
            g.userData.muzzSwitchCount = 0;
            g.userData.muzzBulletType = 1; // 1=aimed, 2=spread

            const muzzGeo = new THREE.CylinderGeometry(0.015, 0.025, 0.08, 4);
            const muzzMat = new THREE.MeshBasicMaterial({color:0xFF3300});
            for(let i=0; i<4; i++){
                const angle = (i / 4) * Math.PI * 2;
                const muzz = new THREE.Mesh(muzzGeo, muzzMat.clone());
                muzz.position.set(Math.cos(angle)*0.38, 0, Math.sin(angle)*0.38);
                muzz.rotation.x = Math.PI/2;
                muzzGroup.add(muzz);
            }
        }

        return g;
    }

    function spawnEnemies(){
        enemies.forEach(e=>{scene.remove(e.mesh);e.mesh.traverse(c=>{if(c.geometry)c.geometry.dispose();if(c.material)c.material.dispose();});});
        enemies=[];
        const lvl=LEVELS[curLvl], cells=[];
        for(let y=0;y<MAZE_H;y++) {
            for(let x=0;x<MAZE_W;x++) {
                if(!(x<=2&&y<=2) && mazeGrid[y] && mazeGrid[y][x] && !mazeGrid[y][x].wall && !mazeGrid[y][x].hole) {
                    cells.push({x,y});
                }
            }
        }
        for(let i=cells.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[cells[i],cells[j]]=[cells[j],cells[i]];}
        const cnt=Math.min(lvl.enemies,cells.length);

        /* Determine enemy type distribution */
        const typeList = lvl.types ? lvl.types.slice() : null;
        for(let i=0;i<cnt;i++){
            let type = "scout";
            if(typeList && i < typeList.length){
                type = typeList[i];
            } else {
                type = i === cnt-1 ? "core" : (Math.random() < 0.4 ? "drone" : "scout");
            }
            const mesh=mkEnemy(type);
            const pos=c2w(cells[i].x,cells[i].y);
            mesh.position.set(pos.x,0,pos.z);
            mesh.scale.set(0,0,0); // Start at 0 for spawn animation
            scene.add(mesh);
            const hpBase = type==="core"?15:(type==="drone"?10:6);
            const hp=Math.round(hpBase*lvl.hpMul);
            const speedBase = type==="scout"?1.2:(type==="drone"?0.8:0.6);
            enemies.push({mesh,type,hp,maxHp:hp,pos:{x:pos.x,z:pos.z},speed:(speedBase+Math.random()*0.4)*lvl.spdMul,
                md:{x:0,z:0},mt:0,st:Math.random()*lvl.shootRate,sr:lvl.shootRate,
                pat:lvl.patterns[Math.floor(Math.random()*lvl.patterns.length)],pp:Math.random()*Math.PI*2,
                spawnT:0.8, // spawn animation time
                muzzleShootCount:0
            });
        }
        updateEnemyGlows();
    }

    /* ══════════════ BULLETS ══════════════ */
    function mkBullet(x,z,angle,speed,isPlayer, damage, canSplit){
        damage = damage || 1;
        canSplit = canSplit || false;

        let m;
        let glowMesh = null;

        if(isPlayer){
            if(playerUpgrade === "heavy"){
                damage *= 2;
                canSplit = true;
                m = new THREE.Mesh(geoHeavyBullet, matHeavyBullet);
            } else {
                m = new THREE.Mesh(geoBullet, matPBullet);
            }
            m.position.set(x, 0.25, z);
            m.rotation.y = angle;
            scene.add(m);
        } else {
            const mat = Math.random() < 0.5 ? window._matEBulletPurple : window._matEBulletOrange;
            m = new THREE.Mesh(geoEBullet, mat);
            m.position.set(x, 0.25, z);
            scene.add(m);
        }

        const arr=isPlayer?pBullets:eBullets;
        arr.push({
            mesh:m,
            glowMesh: glowMesh,
            vx:Math.sin(angle)*speed,
            vz:-Math.cos(angle)*speed,
            life: isPlayer ? 30 : 999,
            isEnemyBullet: !isPlayer,
            damage: damage,
            piercing: canSplit,
            piercedTargets: [],
            canSplit: canSplit,
            hasSplit: false,
            trailT:0,
            speed: speed,
            angle: angle
        });
    }

    /* ══════════════ BULLET TRAILS ══════════════ */
    function spawnBulletTrail(x, z, isPlayer){
        if(particles.length >= MAX_PARTICLES) return; // respect cap
        const m = new THREE.Mesh(geoTrail, isPlayer ? matTrailPlayer : matTrailEnemy);
        m.position.set(x, 0.15, z);
        if(isPlayer){
            /* Player beam trail — bigger, brighter, longer lasting */
            m.scale.set(2.0, 1, 2.0);
            scene.add(m);
            particles.push({mesh:m, mat:m.material, vx:0, vy:0, vz:0, life:0.22, ml:0.22});
        } else {
            scene.add(m);
            particles.push({mesh:m, mat:m.material, vx:0, vy:0, vz:0, life:0.12, ml:0.12});
        }
    }

    /* ══════════════ HIT SPARKS ══════════════ */
    function spawnHitSparks(x, z, color, angle){
        const count = Math.min(3, MAX_PARTICLES - particles.length); // 3 instead of 5, capped
        for(let i=0;i<count;i++){
            /* Reuse shared geometry; create material only once per color via cache */
            if(!window._sparkMats) window._sparkMats = {};
            if(!window._sparkMats[color]) window._sparkMats[color] = new THREE.MeshBasicMaterial({color, transparent:true, opacity:1});
            const mat = window._sparkMats[color].clone();
            const m = new THREE.Mesh(geoSpark, mat);
            m.position.set(x, 0.15+Math.random()*0.15, z);
            scene.add(m);
            const spreadAngle = angle + (Math.random()-0.5)*1.2;
            const speed = 4 + Math.random()*6;
            particles.push({mesh:m, mat, vx:Math.sin(spreadAngle)*speed, vy:2+Math.random()*3, vz:-Math.cos(spreadAngle)*speed, life:0.2+Math.random()*0.15, ml:0.35, rotSpeed:(Math.random()-0.5)*12});
        }
    }

    /* ══════════════ PARTICLES ══════════════ */
    /* Material cache to avoid creating new materials every frame */
    const _particleMatCache = {};
    function getPMat(color){
        if(!_particleMatCache[color]) _particleMatCache[color] = new THREE.MeshBasicMaterial({color,transparent:true,opacity:1});
        return _particleMatCache[color].clone();
    }

    function spawnP(x,z,color,n){
        n = Math.min(n, MAX_PARTICLES - particles.length); // respect cap
        for(let i=0;i<n;i++){
            const mat = getPMat(color);
            const m=new THREE.Mesh(geoParticle,mat);
            m.position.set(x,0.1+Math.random()*0.2,z);
            scene.add(m);
            const a=Math.random()*Math.PI*2, s=1+Math.random()*3;
            particles.push({mesh:m,mat,vx:Math.sin(a)*s,vy:0.5+Math.random()*1.5,vz:Math.cos(a)*s,life:0.25+Math.random()*0.2,ml:0.45});
        }
    }

    /* ══════════════ POWERUPS ══════════════ */
    function spawnPowerup(x, z){
        const g = new THREE.Group();
        g.position.set(x, 0.15, z);
        const pg = new THREE.OctahedronGeometry(0.12, 0);
        const pm = new THREE.MeshBasicMaterial({color: 0xFFD700});
        const m = new THREE.Mesh(pg, pm);
        g.add(m);
        g.userData.coreMesh = m;
        const rg = new THREE.TorusGeometry(0.18, 0.008, 4, 16);
        const rm = new THREE.MeshBasicMaterial({color: 0xFFEA00});
        const ring = new THREE.Mesh(rg, rm);
        ring.rotation.x = Math.PI/2;
        g.add(ring);
        g.userData.ringMesh = ring;
        scene.add(g);
        powerups.push({mesh: g, pos: {x, z}, life: 8.0, maxLife: 8.0});
    }

    function updPowerups(dt){
        const time = clock ? clock.getElapsedTime() : 0;

        if(upgradeTimeRemaining > 0){
            upgradeTimeRemaining -= dt;
            if(upgradeTimeRemaining <= 0){
                upgradeTimeRemaining = 0;
                playerUpgrade = "standard";
                podSay("Subversion upgrade expired.", 3);
                if(playerMesh && playerMesh.userData.coreMat) {
                    playerMesh.userData.coreMat.color.setHex(C_YORHA);
                }
            }
        }

        for(let i = powerups.length - 1; i >= 0; i--){
            const p = powerups[i];
            p.life -= dt;
            if(p.life <= 0){
                scene.remove(p.mesh);
                p.mesh.traverse(c => { if(c.geometry) c.geometry.dispose(); if(c.material) c.material.dispose(); });
                powerups.splice(i, 1);
                continue;
            }
            const hover = Math.sin(time * 4.5 + p.pos.x * 3.0) * 0.04;
            p.mesh.position.y = 0.15 + hover;
            if(p.mesh.userData.coreMesh){ p.mesh.userData.coreMesh.rotation.y += dt * 1.5; p.mesh.userData.coreMesh.rotation.z += dt * 0.8; }
            if(p.mesh.userData.ringMesh){ p.mesh.userData.ringMesh.rotation.z -= dt * 2.0; }
            if(p.life < 2.0){ p.mesh.visible = Math.floor(p.life * 10) % 2 === 0; } else { p.mesh.visible = true; }

            if(d2(playerPos.x, playerPos.z, p.pos.x, p.pos.z) < 0.4){
                scene.remove(p.mesh);
                p.mesh.traverse(c => { if(c.geometry) c.geometry.dispose(); if(c.material) c.material.dispose(); });
                powerups.splice(i, 1);
                AudioManager.playSFX('button_enter');
                triggerGlitch(0.5, 0.25); shake(0.2); flashScreen();
                playerUpgrade = Math.random() < 0.5 ? "triple" : "heavy";
                upgradeTimeRemaining = 7.0;
                const upgradeName = playerUpgrade === "triple" ? "TRIPLE-SPREAD FIRE" : "HEAVY PIERCING PLASMA";
                podSay(`Subversion module collected. Weapon subversion active: ${upgradeName}.`, 4);
                spawnDeathBurst(playerPos.x, playerPos.z, C_GOLD, 10);
                if(playerMesh && playerMesh.userData.coreMat) {
                    playerMesh.userData.coreMat.color.setHex(C_GOLD);
                }
                break;
            }
        }
    }

    /* ══════════════ COLLISION ══════════════ */
    const WALL_MARGIN = 0.12;  // wall collision margin — matches visual wall half-thickness (0.075) + tiny buffer
    const PLAYER_RADIUS = 0.15;  // player collision radius

    /* Core wall check — returns true if point (wx,wz) is inside a wall */
    function wallAt(wx,wz){
        if(!mazeGrid)return true;
        const cx=Math.floor(wx/CELL),cz=Math.floor(wz/CELL);
        if(cx<0||cx>=MAZE_W||cz<0||cz>=MAZE_H)return true;
        const c=mazeGrid[cz][cx];
        /* If the cell itself is a solid wall or an impassable hole, it's blocked */
        if(c.wall || c.hole) return true;
        const lx=wx-cx*CELL,lz=wz-cz*CELL,m=WALL_MARGIN;
        if(lz<m&&c.t)return true; if(lz>CELL-m&&c.b)return true;
        if(lx<m&&c.l)return true; if(lx>CELL-m&&c.r)return true;
        return false;
    }

    /* Circle-vs-wall check — tests sample points around the player radius.
       Prevents corner clipping while keeping collision tight to visual walls. */
    function circleBlocked(cx,cz,radius){
        if(wallAt(cx,cz)) return true;
        const r = radius || PLAYER_RADIUS;
        /* Check 4 cardinal points — sufficient for axis-aligned walls */
        if(wallAt(cx+r,cz)) return true;
        if(wallAt(cx-r,cz)) return true;
        if(wallAt(cx,cz+r)) return true;
        if(wallAt(cx,cz-r)) return true;
        /* Check 4 diagonal points at 0.6 radius — catches corner cuts */
        const d = r * 0.6;
        if(wallAt(cx+d,cz+d)) return true;
        if(wallAt(cx-d,cz+d)) return true;
        if(wallAt(cx+d,cz-d)) return true;
        if(wallAt(cx-d,cz-d)) return true;
        return false;
    }

    /* Move with collision — slides along walls, prevents tunneling via sub-stepping */
    function moveWithCollision(pos, dx, dz){
        const stepSize = 0.12;  // max movement per sub-step (must be < WALL_MARGIN + PLAYER_RADIUS)
        const totalDist = Math.sqrt(dx*dx + dz*dz);
        if(totalDist < 0.001) return;
        const steps = Math.max(1, Math.ceil(totalDist / stepSize));
        const sx = dx / steps, sz = dz / steps;

        for(let i = 0; i < steps; i++){
            /* Try full step */
            const nx = pos.x + sx, nz = pos.z + sz;
            if(!circleBlocked(nx, nz)){
                pos.x = nx; pos.z = nz;
                continue;
            }
            /* Try X-only slide */
            if(!circleBlocked(pos.x + sx, pos.z)){
                pos.x += sx;
                continue;
            }
            /* Try Z-only slide */
            if(!circleBlocked(pos.x, pos.z + sz)){
                pos.z += sz;
                continue;
            }
            /* Fully blocked — stop */
            break;
        }
    }

    function d2(ax,az,bx,bz){const dx=ax-bx,dz=az-bz;return Math.sqrt(dx*dx+dz*dz);}

    /* ══════════════ ENEMY AI ══════════════ */
    function eShoot(e){
        /* Cap enemy bullets to prevent lag on later levels */
        if(eBullets.length >= MAX_EBULLETS) return;
        AudioManager.playSFX('enemy_shoot');
        const ex=e.pos.x,ez=e.pos.z,a=Math.atan2(playerPos.x-ex,-(playerPos.z-ez));

        /* Core type: rotating muzzle system — inspired by enemy_type_0C.gd */
        if(e.type === "core" && e.mesh.userData.muzzGroup){
            const muzzDeg = e.mesh.userData.muzzDeg || 0;
            const muzzRad = muzzDeg * Math.PI / 180;
            const bulletType = e.mesh.userData.muzzBulletType || 1;

            for(let i=0; i<4 && eBullets.length<MAX_EBULLETS; i++){
                const angle = muzzRad + (i / 4) * Math.PI * 2;
                const mx = ex + Math.cos(angle) * 0.38;
                const mz = ez + Math.sin(angle) * 0.38;

                if(bulletType === 1){
                    /* Type 1: Standard aimed bullets from each muzzle toward player */
                    const aimAngle = Math.atan2(playerPos.x - mx, -(playerPos.z - mz));
                    mkBullet(mx, mz, aimAngle, ENEMY_BULLET_SPEED * 0.8, false);
                } else {
                    /* Type 2: Spread burst from each muzzle (reduced from 3 to 2 for perf) */
                    for(let s=-1;s<=1;s+=2){
                        if(eBullets.length >= MAX_EBULLETS) break;
                        mkBullet(mx, mz, angle + s*0.25, ENEMY_BULLET_SPEED * 0.65, false);
                    }
                }
            }

            /* Count shots and switch bullet type */
            e.muzzleShootCount = (e.muzzleShootCount || 0) + 1;
            if(e.muzzleShootCount >= 5){
                e.muzzleShootCount = 0;
                e.mesh.userData.muzzBulletType = bulletType === 1 ? 2 : 1;
            }
            return;
        }

        switch(e.pat){
            case"aimed":mkBullet(ex,ez,a,ENEMY_BULLET_SPEED,false);break;
            case"burst":for(let i=-1;i<=1;i++)mkBullet(ex,ez,a+i*0.15,ENEMY_BULLET_SPEED,false);break;
            case"ring":{const n=Math.min(8+curLvl*2, 16);for(let i=0;i<n&&eBullets.length<MAX_EBULLETS;i++)mkBullet(ex,ez,(i/n)*Math.PI*2,ENEMY_BULLET_SPEED*0.65,false);break;}
            case"spiral":for(let i=0;i<5&&eBullets.length<MAX_EBULLETS;i++)mkBullet(ex,ez,a+i*0.4,ENEMY_BULLET_SPEED*0.8,false);break;
            case"wall":{const p=a+Math.PI/2;for(let i=-3;i<=3&&eBullets.length<MAX_EBULLETS;i++)mkBullet(ex+Math.sin(p)*i*0.35,ez-Math.cos(p)*i*0.35,a,ENEMY_BULLET_SPEED*0.55,false);break;}
        }
    }

    function updEnemies(dt){
        const time = clock ? clock.getElapsedTime() : 0;
        for(let j = enemies.length - 1; j >= 0; j--){
            const e = enemies[j];

            /* Cinematic dying collapse animation for boss cores */
            if(e.isDying){
                /* Collapse timer runs on real-time speed (un-dilated dt) */
                e.dyingT -= dt / timeScale;

                /* Slowly expand core size */
                const collapseRatio = Math.max(0, (1.5 - e.dyingT) / 1.5);
                const s = 1.0 + collapseRatio * 1.8;
                e.mesh.scale.set(s, s, s);

                /* Vibrate position intensely */
                const vib = 0.08 * collapseRatio;
                e.mesh.position.x = e.pos.x + (Math.random() - 0.5) * vib;
                e.mesh.position.z = e.pos.z + (Math.random() - 0.5) * vib;

                /* Flash core between white and critical-red */
                if(e.mesh.userData.core){
                    const isFlash = Math.floor(time * 36) % 2 === 0;
                    e.mesh.userData.core.material.color.setHex(isFlash ? 0xFFFFFF : 0xFF1100);
                }

                /* Emissive particle sparks and ring releases */
                if(Math.random() < 0.12){
                    spawnHitSparks(e.pos.x, e.pos.z, 0xFF6600, Math.random() * Math.PI * 2);
                }
                if(Math.random() < 0.06){
                    spawnRingEffect(e.pos.x, e.pos.z);
                }

                shake(0.04);

                if(e.dyingT <= 0){
                    AudioManager.playSFX('enemy_explode');
                    spawnDeathBurst(e.pos.x, e.pos.z, 0xFF6600, 24);
                    spawnDeathBurst(e.pos.x, e.pos.z, 0x1A1A1A, 16);
                    spawnDeathBurst(e.pos.x, e.pos.z, 0xFF0000, 10);
                    spawnDeathBurst(e.pos.x, e.pos.z, 0xFFCC00, 8);

                    /* Spawn 6 slowly drifting cyber debris shards in slow-motion */
                    for(let i=0; i<6; i++){
                        const ang = Math.random() * Math.PI * 2;
                        const spd = 1.5 + Math.random() * 2.5;
                        spawnShard(e.pos.x, e.pos.z, ang, spd);
                    }

                    flashScreen();
                    triggerGlitch(0.4, 0.25);

                    /* Deallocate assets cleanly */
                    scene.remove(e.mesh);
                    e.mesh.traverse(c=>{if(c.geometry)c.geometry.dispose();if(c.material)c.material.dispose();});

                    enemies.splice(j, 1);
                    updateEnemyGlows();

                    const remaining = enemies.length;
                    if(remaining === 1) podSay("One target remaining.", 2);
                    else if(remaining === 0 && curLvl < LEVELS.length - 1) podSay("Sector cleared. Proceeding to next area.", 3);
                }
                continue;
            }

            e.pp+=dt*4;
            const hover = Math.sin(time * 3.5 + e.pos.x * 2.0) * 0.04;

            /* Spawn animation — materialize from scale 0 */
            if(e.spawnT > 0){
                e.spawnT -= dt;
                const progress = 1 - Math.max(0, e.spawnT / 0.8);
                const s = Math.min(1, progress * progress * (3 - 2 * progress)); // smoothstep
                e.mesh.scale.set(s, s, s);
                if(e.spawnT > 0) continue; // Don't move or shoot while spawning
                else { e.mesh.scale.set(1,1,1); }
            }

            if(e.type==="core"){
                if(e.mesh.userData.core){
                    e.mesh.userData.core.position.y = 0.5 + hover;
                    e.mesh.userData.core.rotation.y += dt * 0.8;
                }
                if(e.mesh.userData.rings){
                    /* Rings spin faster as HP decreases */
                    const hpRatio = e.hp / e.maxHp;
                    const speedMul = 1 + (1 - hpRatio) * 2;
                    e.mesh.userData.rings.forEach((ring, idx) => {
                        ring.position.y = 0.5 + hover;
                        ring.rotation.x += dt * (0.2 + idx * 0.15) * speedMul;
                        ring.rotation.y += dt * (0.35 - idx * 0.1) * speedMul;
                        const s = 1 + Math.sin(e.pp + idx * 0.5) * 0.05;
                        ring.scale.set(s,s,s);
                    });
                }
                if(e.mesh.userData.shieldsGroup){
                    e.mesh.userData.shieldsGroup.position.y = 0.5 + hover;
                    e.mesh.userData.shieldsGroup.rotation.y += dt * 1.5;
                }
                /* Rotating muzzle system — continuous rotation like enemy_type_0C.gd */
                if(e.mesh.userData.muzzGroup){
                    const hpRatio = e.hp / e.maxHp;
                    const muzzSpeed = (e.mesh.userData.muzzSpeed || 100) * (1 + (1 - hpRatio) * 2);
                    e.mesh.userData.muzzDeg = ((e.mesh.userData.muzzDeg || 0) + muzzSpeed * dt) % 360;
                    const muzzRad = e.mesh.userData.muzzDeg * Math.PI / 180;

                    e.mesh.userData.muzzGroup.position.y = 0.5 + hover;
                    /* Rotate the muzzle group visually */
                    e.mesh.userData.muzzGroup.rotation.y = muzzRad;

                    /* Update individual muzzle positions for visual */
                    const children = e.mesh.userData.muzzGroup.children;
                    for(let i=0; i<children.length; i++){
                        const angle = (i / 4) * Math.PI * 2;
                        children[i].position.set(Math.cos(angle)*0.38, 0, Math.sin(angle)*0.38);
                    }
                }
            } else if(e.type==="drone"){
                if(e.mesh.userData.core){
                    e.mesh.userData.core.position.y = 0.4 + hover;
                    e.mesh.userData.core.rotation.y += dt * 1.4;
                    e.mesh.userData.core.rotation.x += dt * 0.6;
                }
                if(e.mesh.userData.shieldsGroup){
                    e.mesh.userData.shieldsGroup.position.y = 0.4 + hover;
                    e.mesh.userData.shieldsGroup.rotation.y += dt * 1.2;
                }
                if(e.mesh.userData.rings){
                    e.mesh.userData.rings.forEach((ring, idx) => {
                        ring.position.y = 0.4 + hover;
                        ring.rotation.x += dt * (0.3 + idx * 0.2);
                        ring.rotation.z += dt * (0.2 - idx * 0.1);
                    });
                }
            } else {
                /* Scout */
                if(e.mesh.userData.core){
                    e.mesh.userData.core.position.y = 0.35 + hover;
                    e.mesh.userData.core.rotation.y += dt * 2.0;
                }
                if(e.mesh.userData.rings){
                    e.mesh.userData.rings.forEach((ring) => {
                        ring.position.y = 0.35 + hover;
                        ring.rotation.z += dt * 3.0;
                    });
                }
            }

            /* Update floor glows to track enemies */
            /* Movement */
            e.mt-=dt;
            if(e.mt<=0){
                const tp=Math.atan2(playerPos.x-e.pos.x,-(playerPos.z-e.pos.z));
                const aggression = e.type==="scout"?0.7:(e.type==="drone"?0.5:0.3);
                if(Math.random()<aggression)e.md={x:Math.sin(tp),z:-Math.cos(tp)};
                else{const ra=Math.random()*Math.PI*2;e.md={x:Math.sin(ra),z:-Math.cos(ra)};}
                e.mt=0.5+Math.random()*1.5;
            }
            const nx=e.pos.x+e.md.x*e.speed*dt,nz=e.pos.z+e.md.z*e.speed*dt;
            if(!wallAt(nx,nz)&&!wallAt(e.pos.x,nz)&&!wallAt(nx,e.pos.z)){e.pos.x=nx;e.pos.z=nz;}else e.mt=0;
            e.mesh.position.set(e.pos.x,0,e.pos.z);

            /* Shoot */
            e.st-=dt;
            if(e.st<=0){
                eShoot(e);
                e.st=e.sr*(0.8+Math.random()*0.4);
            }
        }

        /* Update floor glow positions */
        for(let i=0;i<enemies.length && i<enemyGlows.length;i++){
            enemyGlows[i].position.set(enemies[i].pos.x, 0.005, enemies[i].pos.z);
        }
    }

    /* ══════════════ SCREEN FX ══════════════ */
    function flashScreen(){screenFlash=0.15;if(flashEl)flashEl.style.opacity="0.5";}
    function shake(amt){shakeAmount=amt;}

        /* ── GLITCH EFFECT ── */
    function triggerGlitch(intensity, duration){
        glitchIntensity = intensity;
        glitchTimer = duration;
    }
    function updGlitch(dt){
        if(glitchTimer > 0){
            glitchTimer -= dt;
            if(glitchTimer <= 0){ glitchTimer = 0; glitchIntensity = 0; }
        }
    }
    function renderGlitch(){
        if(!canvas) return;
        if(!wrapEl) wrapEl = document.getElementById("nier-hack-wrapper");
        if(!wrapEl) return;
        if(!glitchEl){
            glitchEl = document.getElementById("nh-glitch");
            if(!glitchEl){
                glitchEl = document.createElement("div"); glitchEl.id = "nh-glitch";
                glitchEl.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:6;overflow:hidden;";
                const canvasWrap = canvas.parentElement;
                if(canvasWrap) canvasWrap.appendChild(glitchEl);
                else return;
            }
        }
        if(glitchIntensity <= 0){
            glitchEl.innerHTML = ""; glitchEl.style.opacity = "0";
            canvas.style.transform = "";
            return;
        }
        glitchEl.style.opacity = "1";
        const g = glitchIntensity;

        if(Math.random() < 0.4 * g){
            const skewX = (Math.random() - 0.5) * 3 * g;
            const shiftX = (Math.random() - 0.5) * 8 * g;
            canvas.style.transform = `skewX(${skewX}deg) translateX(${shiftX}px)`;
        } else {
            canvas.style.transform = "";
        }

        let html = "";
        const slices = 4 + Math.floor(g * 10);
        for(let i = 0; i < slices; i++){
            const top = Math.random() * 100;
            const height = 1 + Math.random() * 20 * g;
            const shiftX = (Math.random() - 0.5) * 50 * g;
            const r = Math.random() < 0.35 ? `rgba(255,0,0,${0.25*g})` : "transparent";
            const b = Math.random() < 0.35 ? `rgba(0,80,255,${0.25*g})` : "transparent";
            const dark = `rgba(0,0,0,${(0.03 + Math.random()*0.08)*g})`;
            html += `<div style="position:absolute;top:${top}%;left:0;right:0;height:${height}px;transform:translateX(${shiftX}px);background:linear-gradient(90deg,${r},transparent 15%,${dark} 40%,${dark} 60%,transparent 85%,${b});"></div>`;
        }
        for(let i = 0; i < Math.floor(2 + g*3); i++){
            const top = Math.random() * 100;
            const height = 3 + Math.random() * 30 * g;
            const side = Math.random() < 0.5;
            html += `<div style="position:absolute;top:${top}%;${side?'left:0':'right:0'};width:${10+Math.random()*40*g}%;height:${height}px;background:${side?'rgba(255,0,0,0.08)':'rgba(0,80,255,0.08)'};"></div>`;
        }
        html += `<div style="position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent 0px,transparent 2px,rgba(0,0,0,${0.12*g}) 2px,rgba(0,0,0,${0.12*g}) 4px);"></div>`;
        glitchEl.innerHTML = html;
    }

    /* ── VIGNETTE ── */
    function ensureVignette(){
        if(!wrapEl) wrapEl = document.getElementById("nier-hack-wrapper");
        if(!wrapEl) return;
        if(!vigEl){
            vigEl = document.getElementById("nh-vignette");
            if(!vigEl){
                vigEl = document.createElement("div"); vigEl.id = "nh-vignette";
                vigEl.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:5;background:radial-gradient(ellipse at center,transparent 60%,rgba(0,0,0,0.12) 100%);";
                const canvasWrap = canvas.parentElement;
                if(canvasWrap) canvasWrap.appendChild(vigEl);
            }
        }
        /* Low HP intensifies vignette with red tint */
        const hpRatio = playerHP / MAX_HP;
        if(hpRatio < 0.3){
            vigEl.style.background = `radial-gradient(ellipse at center,transparent 40%,rgba(196,54,43,${0.15*(1-hpRatio/0.3)}) 100%)`;
        } else {
            vigEl.style.background = "radial-gradient(ellipse at center,transparent 60%,rgba(0,0,0,0.12) 100%)";
        }
    }

    /* ── DEATH PARTICLES ── */
    function spawnDeathBurst(x, z, color, count){
        count = Math.min(count, MAX_PARTICLES - particles.length); // respect cap
        for(let i = 0; i < count; i++){
            const useSmall = Math.random() < 0.6;
            const geo = useSmall ? geoDeathSmall : geoDeathMed;
            /* Clone from cached material to avoid creating from scratch every frame */
            if(!window._deathMats) window._deathMats = {};
            if(!window._deathMats[color]) window._deathMats[color] = new THREE.MeshBasicMaterial({color, transparent:true, opacity:1});
            const mat = window._deathMats[color].clone();
            const m = new THREE.Mesh(geo, mat);
            const s = 0.5 + Math.random() * 1.0;
            m.scale.set(s, s, s);
            m.position.set(x, 0.1 + Math.random() * 0.3, z);
            scene.add(m);
            const angle = Math.random() * Math.PI * 2;
            const speed = 3 + Math.random() * 7;
            particles.push({mesh:m, mat, vx:Math.sin(angle)*speed, vy:1.5+Math.random()*3.5, vz:Math.cos(angle)*speed, life:0.5+Math.random()*0.6, ml:1.1, rotSpeed:(Math.random()-0.5)*10});
        }
    }

    /* ── SPAWN RING EFFECT ── */
    function spawnRingEffect(x, z){
        if(!geoRingEffect) return; // safety
        const mat = new THREE.MeshBasicMaterial({color:0xFF6600, transparent:true, opacity:0.8});
        const ring = new THREE.Mesh(geoRingEffect, mat);
        ring.rotation.x = Math.PI/2;
        ring.position.set(x, 0.05, z);
        scene.add(ring);
        /* Animate as a special particle */
        particles.push({mesh:ring, mat, vx:0, vy:0, vz:0, life:0.6, ml:0.6, isRing:true, scaleSpeed:4});
    }

    /* ── DASH AFTERIMAGE ── */
    /* Shared afterimage geometry */
    let geoAfterimage = null;
    let matAfterimageCore = null;
    let matAfterimageWire = null;

    function spawnAfterimage(px, pz, angle){
        if(!geoAfterimage){
            geoAfterimage = new THREE.OctahedronGeometry(0.12, 0);
            geoAfterimage.scale(1, 0.5, 1.6);
            matAfterimageCore = new THREE.MeshBasicMaterial({color:0x00FFFF, transparent:true, opacity:0.45});
            matAfterimageWire = new THREE.MeshBasicMaterial({color:0x88FFFF, wireframe:true, transparent:true, opacity:0.6});
        }
        const mat = matAfterimageCore.clone();
        const m = new THREE.Mesh(geoAfterimage, mat);
        m.position.set(px, 0.15, pz);
        m.rotation.y = -angle;
        scene.add(m);
        particles.push({mesh:m, mat, vx:0, vy:0, vz:0, life:0.3, ml:0.3});

        const wireMat = matAfterimageWire.clone();
        const wireM = new THREE.Mesh(geoAfterimage, wireMat);
        wireM.position.set(px, 0.15, pz);
        wireM.rotation.y = -angle;
        scene.add(wireM);
        particles.push({mesh:wireM, mat:wireMat, vx:0, vy:0, vz:0, life:0.3, ml:0.3});
    }

    /* ── LOCK-ON SCANNING & HOMING LASERS ── */
    function updLockOn(dt){
        if(!active || paused || bootActive) return;

        /* Check if Q key or Right Click is held */
        const isLockHeld = rightMouseDown || keys["KeyQ"];
        isLockMode = isLockHeld;

        if(!isLockHeld){
            clearLockReticles();
            return;
        }

        /* Scan for enemies in lock-on range (6.5 units) */
        lockSoundThrottle -= dt;
        const scanRange = 6.5;
        const currentLocks = [...lockTargets];
        const newTargets = [];

        for(let e of enemies){
            if(e.spawnT > 0 || e.hp <= 0 || e.isDying) continue;
            const dist = d2(playerPos.x, playerPos.z, e.pos.x, e.pos.z);
            if(dist < scanRange){
                newTargets.push(e);
                if(newTargets.length >= 4) break; /* Cap to 4 targets */
            }
        }

        lockTargets = newTargets;
        updateLockReticles();

        /* Play locking beep sound on target acquisition */
        if(lockTargets.length > currentLocks.length && lockSoundThrottle <= 0){
            AudioManager.playSFX('button_select');
            lockSoundThrottle = 0.12; /* Throttle to avoid audio spam */
        }
    }

    function updateLockReticles(){
        /* Remove reticles for targets no longer active or locked */
        for(let i = lockUIMeshes.length - 1; i >= 0; i--){
            const ui = lockUIMeshes[i];
            if(!lockTargets.includes(ui.target) || ui.target.hp <= 0){
                scene.remove(ui.mesh);
                if(ui.mesh.geometry) ui.mesh.geometry.dispose();
                if(ui.mesh.material) ui.mesh.material.dispose();
                lockUIMeshes.splice(i, 1);
            }
        }

        /* Create reticles for newly locked targets */
        for(let target of lockTargets){
            const hasMesh = lockUIMeshes.some(ui => ui.target === target);
            if(!hasMesh){
                const geo = new THREE.RingGeometry(0.24, 0.28, 16);
                geo.rotateX(-Math.PI/2);
                const mat = new THREE.MeshBasicMaterial({color: 0xFF5500, side: THREE.DoubleSide, transparent: true, opacity: 0.9});
                const mesh = new THREE.Mesh(geo, mat);
                mesh.position.set(target.pos.x, 0.05, target.pos.z);
                scene.add(mesh);
                lockUIMeshes.push({ mesh, target });
            }
        }

        /* Animate spinning and pulsating target reticles */
        const time = clock ? clock.getElapsedTime() : 0;
        for(let ui of lockUIMeshes){
            ui.mesh.position.set(ui.target.pos.x, 0.04, ui.target.pos.z);
            ui.mesh.rotation.y = time * 3.5;
            const scale = 1.0 + Math.sin(time * 12) * 0.12;
            ui.mesh.scale.set(scale, 1, scale);
        }
    }

    function clearLockReticles(){
        for(let ui of lockUIMeshes){
            scene.remove(ui.mesh);
            if(ui.mesh.geometry) ui.mesh.geometry.dispose();
            if(ui.mesh.material) ui.mesh.material.dispose();
        }
        lockUIMeshes = [];
        lockTargets = [];
    }

    function fireHomingLasers(){
        if(lockTargets.length === 0) return;

        AudioManager.playSFX('button_enter');
        flashScreen();
        triggerGlitch(0.2, 0.15);

        for(let target of lockTargets){
            mkHomingLaser(playerPos.x, playerPos.z, target);
        }

        clearLockReticles();
    }

    function mkHomingLaser(px, pz, targetEnemy){
        const dx = targetEnemy.pos.x - px;
        const dz = targetEnemy.pos.z - pz;
        const angle = Math.atan2(dx, -dz);

        /* Stretch octahedron into curved neon-laser dart */
        const geo = new THREE.OctahedronGeometry(0.12, 0);
        geo.scale(0.8, 0.4, 2.5);
        const mat = new THREE.MeshBasicMaterial({color: 0x00FFFF, transparent: true, opacity: 0.9});
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(px, 0.15, pz);
        mesh.rotation.y = -angle;
        scene.add(mesh);

        /* Outer cyan glowing vector shell */
        const glowGeo = new THREE.OctahedronGeometry(0.15, 0);
        glowGeo.scale(0.8, 0.4, 2.8);
        const glowMat = new THREE.MeshBasicMaterial({color: 0x0088FF, transparent: true, opacity: 0.35});
        const glowMesh = new THREE.Mesh(glowGeo, glowMat);
        glowMesh.position.set(px, 0.15, pz);
        glowMesh.rotation.y = -angle;
        scene.add(glowMesh);

        const speed = BULLET_SPEED * 1.35;
        const vx = Math.sin(angle) * speed;
        const vz = -Math.cos(angle) * speed;

        pBullets.push({
            mesh,
            glowMesh,
            vx,
            vz,
            life: 3.5,
            damage: 2.0, /* Homing lasers deal double firewall damage! */
            isLaser: true,
            targetEnemy,
            speed,
            trailT: 0.0,
            piercing: false,
            piercedTargets: []
        });
    }

    /* ── CYBER SHARDS (FOR SLOW-MO CORE COLLAPSE) ── */
    /* Shared shard geometry */
    let geoShard = null;
    let matShard = null;

    function spawnShard(x, z, angle, speed){
        if(!geoShard){
            geoShard = new THREE.BoxGeometry(0.06, 0.06, 0.15);
            matShard = new THREE.MeshBasicMaterial({color: 0xFF8800, transparent: true, opacity: 0.9});
        }
        const mat = matShard.clone();
        const mesh = new THREE.Mesh(geoShard, mat);
        mesh.position.set(x, 0.15, z);
        mesh.rotation.y = angle;
        scene.add(mesh);
        particles.push({
            mesh,
            mat,
            vx: Math.sin(angle) * speed,
            vy: 0.04 + Math.random() * 0.05,
            vz: -Math.cos(angle) * speed,
            life: 1.2,
            ml: 1.2,
            rotSpeed: 5.0 + Math.random() * 8.0
        });
    }

    /* ── TYPEWRITER BOOT SEQUENCE ── */
    function triggerBootSequence(){
        active = false;
        bootActive = true;
        bootTimer = 0;

        if(!wrapEl) wrapEl = document.getElementById("nier-hack-wrapper");
        if(!wrapEl) return;

        bootEl = document.getElementById("nh-boot-terminal");
        if(!bootEl){
            bootEl = document.createElement("div");
            bootEl.id = "nh-boot-terminal";
            bootEl.style.cssText = "position:absolute;inset:0;background:#0A0A0E;z-index:12;color:#D4CFC6;font-family:'Courier New',monospace;font-size:0.8rem;padding:30px;text-align:left;display:flex;flex-direction:column;gap:8px;box-sizing:border-box;overflow:hidden;letter-spacing:0.06em;line-height:1.4;";
            const canvasWrap = canvas.parentElement;
            if(canvasWrap) canvasWrap.appendChild(bootEl);
        }
        bootEl.style.display = "flex";
        bootEl.style.opacity = "1";

        const logLines = [
            ">> LOADING VM DEBUGGER v3.14...",
            `>> PROBING MEMORY SECTOR: ${LEVELS[curLvl].name}...`,
            ">> ARENA SIZE: 4096 BYTES | CYCLE_TO_DIE: 1536",
            `>> SCANNING FOR HOSTILE PROCESSES... [${enemies.length} DETECTED]`,
            ">> DECOMPILING INSTRUCTION STREAM... [REDCODE IDENTIFIED]",
            `>> WARNING: ${enemies.length} THREAT${enemies.length>1?'S':''} IN MEMORY SPACE.`,
            `>> POD 042: Debugger online. Compile combat module and eliminate all hostile processes.`
        ];

        let lineIdx = 0;
        let charIdx = 0;
        bootEl.innerHTML = "";

        const scanlines = document.createElement("div");
        scanlines.style.cssText = "position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,transparent,transparent 1px,rgba(0,0,0,0.15) 1px,rgba(0,0,0,0.15) 2px);";
        bootEl.appendChild(scanlines);

        const textContainer = document.createElement("div");
        textContainer.style.cssText = "display:flex;flex-direction:column;gap:8px;position:relative;z-index:13;";
        bootEl.appendChild(textContainer);

        function typeNextChar(){
            if(!bootActive) return;
            if(lineIdx >= logLines.length){
                setTimeout(endBootSequence, 100);
                return;
            }

            const currentLine = logLines[lineIdx];
            if(charIdx === 0){
                const p = document.createElement("p");
                p.style.margin = "0";
                if(currentLine.includes("WARNING")) p.style.color = "#C4362B";
                else if(currentLine.includes("POD")) p.style.color = "#88AACC";
                textContainer.appendChild(p);
                AudioManager.playSFX('button_select');
            }

            const pNodes = textContainer.querySelectorAll("p");
            const activeP = pNodes[pNodes.length - 1];
            activeP.textContent += currentLine[charIdx];
            charIdx++;

            if(charIdx >= currentLine.length){
                lineIdx++;
                charIdx = 0;
                setTimeout(typeNextChar, 30);
            } else {
                setTimeout(typeNextChar, 2);
            }
        }

        typeNextChar();
    }

    function endBootSequence(){
        if(!bootActive) return;
        bootActive = false;

        AudioManager.playSFX('button_enter');

        if(bootEl){
            bootEl.style.transition = "opacity 0.05s ease-out";
            bootEl.style.opacity = "0";
            setTimeout(() => {
                bootEl.style.display = "none";
                active = true;
                paused = false;
                hideOv();
                updHUD();

                for(const e of enemies){
                    spawnRingEffect(e.pos.x, e.pos.z);
                }

                triggerGlitch(0.25, 0.15);
                flashScreen();
            }, 300);
        }
    }

    /* ── LEVEL TRANSITION ── */
    function showLevelTransition(name, callback){
        transitioning = true; active = false;
        const wrap = document.getElementById("nier-hack-wrapper");
        if(!wrap){ callback(); return; }
        let el = document.getElementById("nh-transition");
        if(!el){
            el = document.createElement("div"); el.id = "nh-transition";
            el.style.cssText = "position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;justify-content:center;align-items:center;background:#FFF;opacity:0;pointer-events:none;overflow:hidden;font-family:'Courier New',monospace;";
            const canvasWrap = canvas.parentElement;
            if(canvasWrap) canvasWrap.appendChild(el);
        }
        el.innerHTML = `<div style="font-size:0.6rem;letter-spacing:0.5em;color:#888;text-transform:uppercase;margin-bottom:10px;opacity:0;animation:nhTransIn 0.05s 0.05s ease-out forwards;">PROCESS TERMINATED</div><div style="font-size:2rem;letter-spacing:0.35em;color:#000;text-transform:uppercase;font-weight:bold;opacity:0;animation:nhTransIn 0.05s 0.075s ease-out forwards;">${name} NEUTRALIZED</div><div style="margin-top:18px;width:80px;height:2px;background:#C4362B;opacity:0;animation:nhTransIn 0.05s 0.1s ease-out forwards;"></div><div style="font-size:0.55rem;letter-spacing:0.2em;color:#999;margin-top:12px;opacity:0;animation:nhTransIn 0.05s 0.125s ease-out forwards;">LOADING NEXT PROCESS...</div><style>@keyframes nhTransIn{0%{opacity:0;transform:translateX(-8px)}100%{opacity:1;transform:translateX(0)}}</style>`;
        let scanLine = el.querySelector('.nh-scan-line');
        if(!scanLine){
            scanLine = document.createElement('div');
            scanLine.className = 'nh-scan-line';
            scanLine.style.cssText = 'position:absolute;left:0;right:0;height:3px;background:linear-gradient(90deg,transparent,rgba(196,54,43,0.6),rgba(196,54,43,0.9),rgba(196,54,43,0.6),transparent);box-shadow:0 0 15px rgba(196,54,43,0.4),0 0 30px rgba(196,54,43,0.2);z-index:1;pointer-events:none;';
            el.appendChild(scanLine);
        }
        el.style.opacity = "1"; el.style.pointerEvents = "auto";
        scanLine.style.top = '-3px';
        scanLine.style.transition = 'top 0.2s ease-in-out';
        requestAnimationFrame(function(){
            requestAnimationFrame(function(){
                scanLine.style.top = '100%';
            });
        });
        setTimeout(function(){
            el.style.transition = "opacity 0.075s";
            el.style.opacity = "0";
            setTimeout(function(){
                el.style.pointerEvents = "none";
                el.style.transition = "opacity 0.075s";
                scanLine.style.top = '-3px';
                scanLine.style.transition = 'none';
                transitioning = false;
                callback();
            }, 75);
        }, 275);
    }

    /* ── POD 042 DIALOGUE ── */
    let podTypingIdx = 0;
    let podFullMsg = '';
    let podTypingTimer = 0;
    const POD_TYPE_SPEED = 0.03;

    function podSay(msg, duration){
        podQueue.push({msg, duration: duration || 3});
        if(!podTimer && podQueue.length === 1) showNextPod();
    }
    function showNextPod(){
        if(podQueue.length === 0){ hidePod(); return; }
        const {msg, duration} = podQueue[0];
        podTimer = duration; podFullMsg = msg; podTypingIdx = 0; podTypingTimer = 0;
        if(!podEl){
            podEl = document.createElement("div"); podEl.id = "nh-pod";
            podEl.style.cssText = "position:absolute;top:6px;left:10px;right:10px;z-index:8;pointer-events:none;font-family:'Courier New',monospace;font-size:0.68rem;letter-spacing:0.06em;color:#AAA;background:rgba(10,10,10,0.88);border:1px solid #333;border-left:2px solid #C4362B;border-radius:2px;padding:8px 12px;opacity:0;transition:opacity 0.3s;line-height:1.6;";
            const canvasWrap = canvas ? canvas.parentElement : null;
            if(canvasWrap) canvasWrap.appendChild(podEl);
            else return;
        }
        podEl.innerHTML = `<span style="color:#C4362B;font-weight:bold;">Pod 042 :</span> <span class="nh-pod-text"></span><span class="nh-pod-cursor" style="display:inline-block;width:6px;height:12px;background:#C4362B;margin-left:2px;vertical-align:middle;animation:nhCursorBlink 0.6s step-end infinite;"></span>`;
        podEl.style.opacity = "1";
    }
    function hidePod(){ if(podEl) podEl.style.opacity = "0"; }
    function updPod(dt){
        if(podTimer > 0){
            podTimer -= dt;
            if(podTypingIdx < podFullMsg.length){
                podTypingTimer += dt;
                let typed = false;
                while(podTypingTimer >= POD_TYPE_SPEED && podTypingIdx < podFullMsg.length){
                    podTypingTimer -= POD_TYPE_SPEED; podTypingIdx++; typed = true;
                }
                if(typed) AudioManager.playSFX('type');
                const textEl = podEl ? podEl.querySelector('.nh-pod-text') : null;
                if(textEl) textEl.textContent = podFullMsg.substring(0, podTypingIdx);
            } else {
                const cursor = podEl ? podEl.querySelector('.nh-pod-cursor') : null;
                if(cursor) cursor.style.display = 'none';
            }
            if(podTimer <= 0){ podTimer = 0; podQueue.shift(); showNextPod(); }
        }
    }

    /* ══════════════ UPDATE ══════════════ */
    function update(dt){
        if(!active||paused||!sceneOK)return;
        dt=Math.min(dt,0.05);

        /* Slow-motion timescale scaling */
        if(slowMoT > 0){
            slowMoT -= dt;
            if(slowMoT <= 0){ slowMoT = 0; timeScale = 1.0; }
            else { timeScale = 0.2; }
        } else {
            timeScale = 1.0;
        }
        dt *= timeScale;

        /* Scan and update target locking reticles */
        updLockOn(dt);

        const time = clock.getElapsedTime();

        /* Animating player ship vector components (plumes, rings, halos) */
        if(playerMesh){
            // 1. Pulse core halo size and opacity
            if(playerMesh.userData.coreHalo) {
                const scale = 1.0 + 0.18 * Math.sin(time * 6.0);
                playerMesh.userData.coreHalo.scale.set(scale, scale, scale);
                playerMesh.userData.coreHalo.material.opacity = 0.16 + 0.08 * Math.sin(time * 6.0);
            }
            // 2. Rotate orbiting companion POD rings independently
            if(playerMesh.userData.podLeftRing1) {
                playerMesh.userData.podLeftRing1.rotation.y = time * 2.5;
                playerMesh.userData.podLeftRing1.rotation.x = time * 0.8;
            }
            if(playerMesh.userData.podLeftRing2) {
                playerMesh.userData.podLeftRing2.rotation.x = -time * 2.0;
                playerMesh.userData.podLeftRing2.rotation.z = time * 1.2;
            }
            if(playerMesh.userData.podRightRing1) {
                playerMesh.userData.podRightRing1.rotation.y = -time * 2.2;
                playerMesh.userData.podRightRing1.rotation.x = time * 0.9;
            }
            if(playerMesh.userData.podRightRing2) {
                playerMesh.userData.podRightRing2.rotation.x = time * 1.8;
                playerMesh.userData.podRightRing2.rotation.z = -time * 1.4;
            }
            // 3. Flicker and scale dynamic engine thruster plumes
            const tScale = 0.85 + 0.15 * Math.sin(time * 30.0);
            if(playerMesh.userData.plumeLeftEnv) playerMesh.userData.plumeLeftEnv.scale.set(tScale, tScale, 1.0 + 0.22 * Math.sin(time * 20.0));
            if(playerMesh.userData.plumeRightEnv) playerMesh.userData.plumeRightEnv.scale.set(tScale, tScale, 1.0 + 0.22 * Math.cos(time * 20.0));

            // 4. Spin central logic ring continuously
            if(playerMesh.userData.rLogic) {
                playerMesh.userData.rLogic.rotation.z += dt * 4.5;
            }
        }

        /* Animating custom impassable structures (Monolith pipes, Danger Forcefields) */
        if(gridGroup){
            if(gridGroup.userData.dangerLinesMat){
                gridGroup.userData.dangerLinesMat.opacity = 0.55 + 0.3 * Math.sin(time * 8.0);
            }
            if(gridGroup.userData.monolithPipesMat){
                gridGroup.userData.monolithPipesMat.opacity = 0.5 + 0.35 * Math.cos(time * 5.0);
            }
        }

        /* Screen flash decay */
        if(screenFlash>0){screenFlash-=dt;if(flashEl)flashEl.style.opacity=Math.max(0,screenFlash/0.15*0.5).toString();}
        /* Shake decay */
        if(shakeAmount>0)shakeAmount*=0.9;
        if(shakeAmount<0.01)shakeAmount=0;
        /* Glitch decay */
        updGlitch(dt);
        /* Pod dialogue timer */
        updPod(dt);
        /* Ambient particles */
        updAmbientParticles(dt, time);
        /* Vignette */
        ensureVignette();

        /* Camera selection & update */
        if (is3D) {
            camera = cameraPersp;
            const camDist = 5.5;
            const camHeight = 5.8;
            let biasX = 0, biasZ = 0;
            if (keys["ArrowUp"] || keys["KeyW"]) biasZ = -0.5;
            if (keys["ArrowDown"] || keys["KeyS"]) biasZ = 0.5;
            if (keys["ArrowLeft"] || keys["KeyA"]) biasX = -0.5;
            if (keys["ArrowRight"] || keys["KeyD"]) biasX = 0.5;
            const targetCamX = playerPos.x + biasX;
            const targetCamY = camHeight;
            const targetCamZ = playerPos.z + camDist + biasZ;
            camera.position.x += (targetCamX - camera.position.x) * 0.08;
            camera.position.y += (targetCamY - camera.position.y) * 0.08;
            camera.position.z += (targetCamZ - camera.position.z) * 0.08;
            if (shakeAmount > 0) {
                camera.position.x += (Math.random() - 0.5) * shakeAmount;
                camera.position.y += (Math.random() - 0.5) * shakeAmount;
                camera.position.z += (Math.random() - 0.5) * shakeAmount;
            }
            camera.lookAt(playerPos.x, 0.4, playerPos.z);
        } else {
            camera = cameraOrtho;
            const cx = MAZE_W * CELL / 2;
            const cz = MAZE_H * CELL / 2;
            if (shakeAmount > 0) {
                camera.position.set(cx + (Math.random() - 0.5) * shakeAmount, 30, cz + (Math.random() - 0.5) * shakeAmount);
            } else {
                camera.position.set(cx, 30, cz);
            }
            camera.lookAt(cx, 0, cz);
        }

        /* Player move */
        let dx=0,dz=0;
        if(keys["KeyW"]||keys["KeyZ"])dz=-1;if(keys["KeyS"])dz=1;
        if(keys["KeyA"]||keys["KeyQ"])dx=-1;if(keys["KeyD"])dx=1;

        /* Dash ability */
        if(dashT > 0){
            dashT -= dt;
            moveWithCollision(playerPos, dashDir.x*DASH_SPEED*dt, dashDir.z*DASH_SPEED*dt);
            /* Spawn afterimages */
            if(Math.random() < 0.4) spawnAfterimage(playerPos.x, playerPos.z, playerAngle);
        } else {
            if(dx||dz){
                const l=Math.sqrt(dx*dx+dz*dz);dx/=l;dz/=l;
                moveWithCollision(playerPos, dx*PLAYER_SPEED*dt, dz*PLAYER_SPEED*dt);
            }
        }
        if(dashCooldownT > 0) dashCooldownT -= dt;

        /* Aim */
        let ax=0,az=0;
        if(keys["ArrowUp"])az=-1;if(keys["ArrowDown"])az=1;
        if(keys["ArrowLeft"])ax=-1;if(keys["ArrowRight"])ax=1;
        if(ax||az)playerAngle=Math.atan2(ax,-az);

        /* Player mesh positioning and animation */
        if (is3D) {
            playerMesh.position.set(playerPos.x, 0.35 + Math.sin(time * 4.5) * 0.03, playerPos.z);
        } else {
            playerMesh.position.set(playerPos.x, 0.25, playerPos.z);
        }
        playerMesh.rotation.y = -playerAngle;
        playerMesh.rotation.x = 0;
        playerMesh.rotation.z = 0;

        /* Player light tracking — REMOVED */

        /* Animate thrusters */
        if(playerMesh.userData.thrusterLeft){
            const flicker = 0.85 + Math.random() * 0.3;
            playerMesh.userData.thrusterLeft.scale.z = flicker;
            playerMesh.userData.thrusterRight.scale.z = 0.85 + Math.random() * 0.3;
        }
        /* Animate support pods */
        if(playerMesh.userData.leftPod && playerMesh.userData.rightPod){
            playerMesh.userData.leftPod.position.y = 0.08 + Math.sin(time * 5.5) * 0.04;
            playerMesh.userData.rightPod.position.y = 0.08 + Math.sin(time * 5.5 + Math.PI) * 0.04;
        }
        /* Shield ring rotation and opacity */
        if(playerMesh.userData.shieldRing){
            playerMesh.userData.shieldRing.rotation.z += dt * 0.5;
            const shieldOp = invulnT > 0 ? 0.4 : 0.12;
            playerMesh.userData.shieldMat.opacity += (shieldOp - playerMesh.userData.shieldMat.opacity) * 0.1;
        }
        /* Core glow color change for upgrade */
        if(playerMesh.userData.coreMat){
            const targetColor = playerUpgrade !== "standard" ? C_GOLD : C_YORHA;
            const curColor = playerMesh.userData.coreMat.color.getHex();
            if(curColor !== targetColor) playerMesh.userData.coreMat.color.setHex(targetColor);
        }

        /* Invuln flash */
        if(invulnT>0){invulnT-=dt;playerMesh.visible=Math.floor(invulnT*12)%2===0;}
        else playerMesh.visible=true;

        /* HP regen from LIVE buff */
        if(playerBuffs.regenHP > 0 && active && !paused) {
            playerHP = Math.min(MAX_HP, playerHP + playerBuffs.regenHP * dt);
        }

        /* Dash grants invulnerability */
        if(dashT > 0 && invulnT <= 0) {
            /* Already handled by the dash movement above */
        }

        /* Shoot */
        shootT-=dt;
        if((mouseDown||keys["KeyE"])&&shootT<=0){
            const effectiveShootCD = SHOOT_CD / (playerBuffs.fireRateMul || 1);
            const effectiveBulletSpeed = BULLET_SPEED * (playerBuffs.bulletSpeedMul || 1);
            if(playerUpgrade === "triple"){
                mkBullet(playerPos.x, playerPos.z, playerAngle - 0.22, effectiveBulletSpeed, true, playerBuffs.damageMul, playerBuffs.bulletSplit);
                mkBullet(playerPos.x, playerPos.z, playerAngle, effectiveBulletSpeed, true, playerBuffs.damageMul, playerBuffs.bulletSplit);
                mkBullet(playerPos.x, playerPos.z, playerAngle + 0.22, effectiveBulletSpeed, true, playerBuffs.damageMul, playerBuffs.bulletSplit);
            } else if(playerBuffs.doubleShot){
                mkBullet(playerPos.x, playerPos.z, playerAngle - 0.08, effectiveBulletSpeed, true, playerBuffs.damageMul, playerBuffs.bulletSplit);
                mkBullet(playerPos.x, playerPos.z, playerAngle + 0.08, effectiveBulletSpeed, true, playerBuffs.damageMul, playerBuffs.bulletSplit);
            } else {
                mkBullet(playerPos.x,playerPos.z,playerAngle,effectiveBulletSpeed,true,playerBuffs.damageMul,playerBuffs.bulletSplit);
            }
            AudioManager.playSFX('player_shoot');
            shootT=effectiveShootCD;
        }

        /* Player bullets */
        for(let i=pBullets.length-1;i>=0;i--){
            const b=pBullets[i];

            /* Homing steering physics for lasers */
            if(b.isLaser && b.targetEnemy && b.targetEnemy.hp > 0 && !b.targetEnemy.isDying){
                const target = b.targetEnemy;
                const tx = target.pos.x - b.mesh.position.x;
                const tz = target.pos.z - b.mesh.position.z;
                const dist = Math.sqrt(tx*tx + tz*tz);
                if(dist > 0.05){
                    const destVx = (tx / dist) * b.speed;
                    const destVz = (tz / dist) * b.speed;

                    /* Smooth steering interpolation */
                    b.vx += (destVx - b.vx) * 0.18;
                    b.vz += (destVz - b.vz) * 0.18;

                    /* Maintain consistent laser speed */
                    const curSpeed = Math.sqrt(b.vx*b.vx + b.vz*b.vz);
                    if(curSpeed > 0){
                        b.vx = (b.vx / curSpeed) * b.speed;
                        b.vz = (b.vz / curSpeed) * b.speed;
                    }

                    b.mesh.rotation.y = -Math.atan2(b.vx, -b.vz);
                    if(b.glowMesh) b.glowMesh.rotation.y = b.mesh.rotation.y;
                }
            }

            b.mesh.position.x+=b.vx*dt;b.mesh.position.z+=b.vz*dt;b.life-=dt;

            /* Animate orbiting rings for standard/heavy bullets */
            if(b.mesh.userData.ring) {
                b.mesh.userData.ring.rotation.y += dt * 6.0;
            }
            if(b.mesh.userData.ring1) {
                b.mesh.userData.ring1.rotation.y += dt * 6.0;
            }
            if(b.mesh.userData.ring2) {
                b.mesh.userData.ring2.rotation.x += dt * 4.0;
            }

            /* Move beam glow with bullet */
            if(b.glowMesh) b.glowMesh.position.copy(b.mesh.position);

            /* Bullet trail — throttled to reduce particle count */
            b.trailT -= dt;
            if(b.trailT <= 0 && particles.length < MAX_PARTICLES * 0.5){
                spawnBulletTrail(b.mesh.position.x, b.mesh.position.z, true);
                b.trailT = 0.06;
            }

            /* Bullet split — when canSplit is true and bullet has traveled far enough */
            if(b.canSplit && !b.hasSplit && b.life < 25) {
                b.hasSplit = true;
                const splitAngle1 = b.angle + 0.35;
                const splitAngle2 = b.angle - 0.35;
                mkBullet(b.mesh.position.x, b.mesh.position.z, splitAngle1, b.speed, true, b.damage * 0.6, false);
                mkBullet(b.mesh.position.x, b.mesh.position.z, splitAngle2, b.speed * 0.6, true, b.damage * 0.6, false);
            }

            if(wallAt(b.mesh.position.x,b.mesh.position.z)||b.life<=0){
                if(b.life>0){
                    spawnP(b.mesh.position.x,b.mesh.position.z,0x555555,2);
                    spawnHitSparks(b.mesh.position.x, b.mesh.position.z, 0xAAAAAA, Math.atan2(b.vx, -b.vz));
                }
                if(b.glowMesh)scene.remove(b.glowMesh);
                scene.remove(b.mesh);pBullets.splice(i,1);continue;
            }

            /* Check shield block collisions */
            let shieldHit = false;
            for(let j=enemies.length-1;j>=0;j--){
                const e=enemies[j];
                if(e.isDying) continue; /* Skip shield check if core is already collapsing */

                if((e.type === "core" || e.type === "drone") && e.mesh.userData.shieldMeshes){
                    const shields = e.mesh.userData.shieldMeshes;
                    for(let k=shields.length-1; k>=0; k--){
                        const s = shields[k];
                        const shieldPos = new THREE.Vector3();
                        s.mesh.getWorldPosition(shieldPos);
                        if(d2(b.mesh.position.x, b.mesh.position.z, shieldPos.x, shieldPos.z) < 0.22){
                            if(b.piercing && b.piercedTargets.includes(s.mesh.uuid)) continue;
                            s.hp -= b.damage || 1;
                            spawnP(shieldPos.x, shieldPos.z, C_YORHA, 3);
                            spawnHitSparks(shieldPos.x, shieldPos.z, C_YORHA, Math.atan2(b.vx, -b.vz));
                            AudioManager.playSFX('enemy_hit');
                            const originalColor = s.mesh.material.color.getHex();
                            s.mesh.material.color.setHex(0xFFFFFF);
                            setTimeout(()=>{
                                if(s.mesh && s.mesh.material) s.mesh.material.color.setHex(originalColor);
                            }, 60);
                            if(s.hp <= 0){
                                AudioManager.playSFX('enemy_explode');
                                spawnDeathBurst(shieldPos.x, shieldPos.z, 0x1A1A1A, 8);
                                spawnDeathBurst(shieldPos.x, shieldPos.z, C_YORHA, 6);
                                spawnPowerup(shieldPos.x, shieldPos.z);
                                if(e.mesh.userData.shieldsGroup) e.mesh.userData.shieldsGroup.remove(s.mesh);
                                s.mesh.traverse(c=>{if(c.geometry)c.geometry.dispose();if(c.material)c.material.dispose();});
                                shields.splice(k, 1);
                            }
                            if(!b.piercing){
                                if(b.glowMesh)scene.remove(b.glowMesh);
                                scene.remove(b.mesh); pBullets.splice(i, 1); shieldHit = true; break;
                            } else {
                                b.piercedTargets.push(s.mesh.uuid);
                            }
                        }
                    }
                    if(shieldHit) break;
                }
            }
            if(shieldHit) continue;

            let hit=false;
            for(let j=enemies.length-1;j>=0;j--){
                const e=enemies[j];
                if(e.isDying) continue; /* Skip collision if core is already collapsing */

                const hitRadius = e.type==="core"?0.45:(e.type==="drone"?0.35:0.3);
                if(d2(b.mesh.position.x,b.mesh.position.z,e.pos.x,e.pos.z)<hitRadius){
                    if(b.piercing && b.piercedTargets.includes(e.mesh.uuid)) continue;
                    e.hp -= b.damage || 1;
                    spawnP(e.pos.x,e.pos.z,C_PARTICLE,3);
                    spawnHitSparks(e.pos.x, e.pos.z, 0xFF6600, Math.atan2(b.vx, -b.vz));
                    AudioManager.playSFX('enemy_hit');
                    if(e.mesh.userData.core){
                        const origColor = e.type==="core"?0x0A0A0A:(e.type==="drone"?0x333333:0x111111);
                        e.mesh.userData.core.material.color.setHex(0xFFFFFF);
                        setTimeout(()=>{
                            if(e.mesh.userData.core){
                                const mat = e.mesh.userData.core.material;
                                if(mat.color) mat.color.setHex(origColor);
                            }
                        },60);
                    }
                    /* Fork behavior — scouts split at 50% HP */
                    if(e.type === "scout" && e.hp <= e.maxHp * 0.5 && !e.hasForked) {
                        e.hasForked = true;
                        /* Find a valid spawn position (not inside a wall) */
                        let forkX = null, forkZ = null;
                        const forkOffsets = [
                            {x:1.5,z:1.5},{x:-1.5,z:1.5},{x:1.5,z:-1.5},{x:-1.5,z:-1.5},
                            {x:0,z:1.5},{x:0,z:-1.5},{x:1.5,z:0},{x:-1.5,z:0}
                        ];
                        for(const off of forkOffsets){
                            const tx = e.pos.x + off.x, tz = e.pos.z + off.z;
                            if(!wallAt(tx, tz)){
                                forkX = tx; forkZ = tz; break;
                            }
                        }
                        /* Only spawn forked enemy if a valid position was found */
                        if(forkX !== null){
                            const newMesh = mkEnemy("scout");
                            newMesh.position.set(forkX, 0, forkZ);
                            newMesh.scale.set(0.5, 0.5, 0.5);
                            scene.add(newMesh);
                            enemies.push({
                                mesh: newMesh, type: "scout", hp: Math.round(e.maxHp * 0.3), maxHp: Math.round(e.maxHp * 0.3),
                                pos: { x: forkX, z: forkZ },
                                speed: e.speed * 1.2,
                                md: {x:0,z:0}, mt:0, st: Math.random() * e.sr, sr: e.sr,
                                pat: e.pat, pp: Math.random() * Math.PI * 2,
                                spawnT: 0, muzzleShootCount: 0, hasForked: true, isDying: false
                            });
                            spawnDeathBurst(forkX, forkZ, 0xFF6600, 4);
                            AudioManager.playSFX('enemy_explode');
                        }
                    }
                    if(e.hp<=0){
                        if(e.type === "core"){
                            /* Core boss cinematic death sequence trigger */
                            AudioManager.playSFX('core_broken');
                            e.isDying = true;
                            e.dyingT = 1.5;
                            slowMoT = 1.5; /* Trigger 1.5s slow-motion */
                            flashScreen();
                            triggerGlitch(0.4, 0.25);
                            podSay("Pod 042: Combat core integrity failing. Initiating logic collapse...", 2);
                            score += 500;
                        } else {
                            AudioManager.playSFX('enemy_explode');
                            spawnDeathBurst(e.pos.x, e.pos.z, 0xFF6600, 5);
                            spawnDeathBurst(e.pos.x, e.pos.z, 0x1A1A1A, 3);
                            spawnDeathBurst(e.pos.x, e.pos.z, 0xFF0000, 3);
                            spawnDeathBurst(e.pos.x, e.pos.z, 0xFFCC00, 2);
                            flashScreen();
                            const chance = e.type === "drone" ? 0.4 : 0.2;
                            if(Math.random() < chance) spawnPowerup(e.pos.x, e.pos.z);
                            scene.remove(e.mesh);e.mesh.traverse(c=>{if(c.geometry)c.geometry.dispose();if(c.material)c.material.dispose();});
                            const scoreVal = e.type==="drone"?300:150;
                            score+=scoreVal;enemies.splice(j,1);
                            updateEnemyGlows();
                            const remaining = enemies.length;
                            if(remaining === 1) podSay("One target remaining.", 2);
                            else if(remaining === 0 && curLvl < LEVELS.length - 1) podSay("Sector cleared. Proceeding to next area.", 3);
                        }
                    }
                    if(!b.piercing){
                        if(b.glowMesh)scene.remove(b.glowMesh);
                        scene.remove(b.mesh);pBullets.splice(i,1);hit=true;break;
                    } else {
                        b.piercedTargets.push(e.mesh.uuid);
                    }
                }
            }
            if(hit)continue;

            /* Player bullet vs enemy bullet collision — destroy enemy bullet on hit (like original game) */
            let eBulletHit = false;
            for(let k=eBullets.length-1; k>=0; k--){
                const eb = eBullets[k];
                if(d2(b.mesh.position.x, b.mesh.position.z, eb.mesh.position.x, eb.mesh.position.z) < 0.28){
                    /* Small explosion effect on enemy bullet death */
                    const bx = eb.mesh.position.x, bz = eb.mesh.position.z;
                    const bColor = eb.mesh.material.color ? eb.mesh.material.color.getHex() : 0xFF4400;
                    spawnRingEffect(bx, bz);
                    spawnP(bx, bz, bColor, 4);
                    spawnP(bx, bz, 0xFFFFFF, 2);
                    spawnHitSparks(bx, bz, bColor, Math.atan2(eb.vx, -eb.vz));
                    scene.remove(eb.mesh); eBullets.splice(k, 1);
                    AudioManager.playSFX('bullet_cancel');
                    /* Also destroy the player bullet (unless piercing) */
                    if(!b.piercing){
                        if(b.glowMesh)scene.remove(b.glowMesh);
                        scene.remove(b.mesh); pBullets.splice(i, 1);
                        eBulletHit = true; break;
                    }
                }
            }
            if(eBulletHit) continue;
        }

        /* Enemy bullets */
        for(let i=eBullets.length-1;i>=0;i--){
            const b=eBullets[i];b.mesh.position.x+=b.vx*dt;b.mesh.position.z+=b.vz*dt;b.life-=dt;

            /* Spin outer wireframe shell of active enemy bullets */
            if(b.mesh.userData.shell){
                b.mesh.userData.shell.rotation.y += dt * 3.8;
                b.mesh.userData.shell.rotation.x += dt * 1.8;
            }

            /* Enemy bullet trail — throttled to reduce particle count */
            b.trailT -= dt;
            if(b.trailT <= 0 && particles.length < MAX_PARTICLES * 0.5){
                spawnBulletTrail(b.mesh.position.x, b.mesh.position.z, false);
                b.trailT = 0.10;
            }

            if(wallAt(b.mesh.position.x,b.mesh.position.z)||b.life<=0){scene.remove(b.mesh);eBullets.splice(i,1);continue;}
            /* Dash invulnerability */
            const isInvuln = invulnT > 0 || dashT > 0;
            if(!isInvuln&&d2(b.mesh.position.x,b.mesh.position.z,playerPos.x,playerPos.z)<0.3){
                playerHP-=10;invulnT=INVULN_T;
                spawnP(playerPos.x,playerPos.z,C_EBULLET,5);
                spawnHitSparks(playerPos.x, playerPos.z, 0xFF0000, Math.atan2(b.vx, -b.vz));
                AudioManager.playSFX('player_hit');
                flashScreen(); shake(0.3);
                triggerGlitch(0.7, 0.4);
                scene.remove(b.mesh);eBullets.splice(i,1);
                if(playerHP<=0){playerHP=0;gameOver();return;}
                if(playerHP <= 30 && playerHP > 20) podSay("Integrity critical. Recommendation: evade.", 3);
                else if(playerHP <= 50 && playerHP > 40) podSay("Damage exceeding threshold.", 2.5);
                continue;
            }
        }

        /* Particles */
        for(let i=particles.length-1;i>=0;i--){
            const p=particles[i];
            p.mesh.position.x+=p.vx*dt;p.mesh.position.y+=p.vy*dt;p.mesh.position.z+=p.vz*dt;
            p.vy-=5*dt;p.life-=dt;p.mat.opacity=Math.max(0,p.life/p.ml);
            if(p.rotSpeed) p.mesh.rotation.x+=p.rotSpeed*dt, p.mesh.rotation.z+=p.rotSpeed*0.7*dt;
            if(p.ml > 0.8){ p.vx *= 0.97; p.vz *= 0.97; }
            /* Ring effect expansion */
            if(p.isRing){
                const s = 1 + (1 - p.life/p.ml) * p.scaleSpeed;
                p.mesh.scale.set(s,s,s);
            }
            if(p.life<=0){
                scene.remove(p.mesh);
                /* Dispose geometry only if not a shared one */
                if(p.mesh.geometry && p.mesh.geometry !== geoParticle && p.mesh.geometry !== geoTrail &&
                   p.mesh.geometry !== geoSpark && p.mesh.geometry !== geoDeathSmall && p.mesh.geometry !== geoDeathMed &&
                   p.mesh.geometry !== geoRingEffect && p.mesh.geometry !== geoLaserTrail &&
                   p.mesh.geometry !== geoAfterimage && p.mesh.geometry !== geoShard){
                    p.mesh.geometry.dispose();
                }
                if(p.mat && p.mat !== matTrailPlayer && p.mat !== matTrailEnemy && p.mat !== matLaserTrail){
                    p.mat.dispose();
                }
                particles.splice(i,1);
            }
        }

        /* Dash afterimage cleanup is handled by the main particle loop above */

        updEnemies(dt);
        updPowerups(dt);
        if(enemies.length===0 && !transitioning){lvlClear();return;}
        updHUD();
    }

    /* ══════════════ HUD ══════════════ */
    function updHUD(){
        if(hudHP && lastHUDState.hp !== playerHP){
            hudHP.textContent=playerHP+"%";
            lastHUDState.hp = playerHP;
        }
        if(hudBar && lastHUDState.hpBar !== playerHP){
            hudBar.style.width=playerHP+"%";
            hudBar.className="nh-bar-inner"+(playerHP<30?" danger":"");
            lastHUDState.hpBar = playerHP;
        }
        if(hudScore && lastHUDState.score !== score){
            hudScore.textContent=score;
            lastHUDState.score = score;
        }
        if(hudLvl && lastHUDState.lvl !== curLvl){
            hudLvl.textContent=(curLvl+1)+"/"+LEVELS.length;
            lastHUDState.lvl = curLvl;
        }
        if(hudEnm && lastHUDState.enm !== enemies.length){
            hudEnm.textContent=enemies.length;
            lastHUDState.enm = enemies.length;
        }
        if(hudName && lastHUDState.name !== LEVELS[curLvl].name){
            hudName.textContent=LEVELS[curLvl].name;
            lastHUDState.name = LEVELS[curLvl].name;
        }
    }

    /* ══════════════ OVERLAY ══════════════ */
    function showOv(title,sub,btn,fn){
        if(!overlay)return;
        overlay.classList.remove("hidden");overlay.style.pointerEvents="auto";
        const sc=score>0?'<div class="nh-ov-score">SCORE: '+score+'</div>':'';
        overlay.innerHTML='<div class="nh-ov-title">'+title+'</div><div class="nh-ov-sub">'+sub+'</div>'+sc+'<button class="nh-ov-btn" onclick="window._nhBtn()">'+btn+'</button>';
        window._nhBtn=function(){try{AudioManager.resumeContext();AudioManager.playSFX('button_enter');fn();}catch(e){console.error("[NH]",e);}};
        const b=overlay.querySelector(".nh-ov-btn");if(b)b.focus();
    }
    function hideOv(){if(!overlay)return;overlay.classList.add("hidden");overlay.style.pointerEvents="none";overlay.innerHTML="";window._nhBtn=null;}

    /* ══════════════ GAME STATES ══════════════ */
    function startLvl(){
        AudioManager.playBGM();
        clearBP();
        /* Reset HUD Cache to force fresh rendering */
        lastHUDState = { hp: -1, hpBar: -1, score: -1, lvl: -1, enm: -1, name: "" };
        enemies.forEach(e=>{scene.remove(e.mesh);e.mesh.traverse(c=>{if(c.geometry)c.geometry.dispose();if(c.material)c.material.dispose();});});
        enemies=[];
        mazeGrid=genMaze();buildMaze();
        playerPos=c2w(1,1);playerAngle=0;playerHP=MAX_HP;invulnT=0;shootT=0;
        playerUpgrade = "standard"; upgradeTimeRemaining = 0;
        dashT = 0; dashCooldownT = 0;
        playerBuffs = { damageMul: 1, bulletSplit: false, dashDistMul: 1, regenHP: 0, doubleShot: false, shieldTime: 0, bulletSpeedMul: 1, fireRateMul: 1 };
        playerMesh.position.set(playerPos.x,0.05,playerPos.z);playerMesh.rotation.z=0;playerMesh.visible=true;
        if(playerMesh.userData.coreMat) playerMesh.userData.coreMat.color.setHex(C_YORHA);
        spawnEnemies();
        const cx=MAZE_W*CELL/2,cz=MAZE_H*CELL/2;
        camera.position.set(cx,30,cz);camera.lookAt(cx,0,cz);
        hideOv();
        /* Show Red Code editor first, then boot sequence */
        showCodeEditor(function(){
            triggerBootSequence();
        });
    }
    function lvlClear(){
        active=false;
        if(curLvl<LEVELS.length-1){
            const nextLvl = curLvl + 1;
            showLevelTransition(LEVELS[curLvl].name, function(){
                curLvl = nextLvl; startLvl();
            });
        } else {
            showLevelTransition("MEMORY CLEANED", function(){
                showOv("MEMORY CLEANED","All hostile processes terminated — arena secured","RESTART",function(){curLvl=0;score=0;startLvl();});
            });
        }
    }
    function gameOver(){
        active=false;
        AudioManager.stopBGM();
        AudioManager.playSFX('player_explode');
        flashScreen();shake(0.6);
        triggerGlitch(1.0, 1.2);
        setTimeout(function(){ showGameOverNier(); }, 600);
    }
    function showGameOverNier(){
        if(!overlay) return;
        overlay.classList.remove("hidden");overlay.style.pointerEvents="auto";
        overlay.style.background="rgba(10,10,10,0.96)";
        overlay.innerHTML = `
        <div style="opacity:0;animation:nhGoFlicker 0.15s 0.3s forwards;font-family:'Courier New',monospace;font-size:0.75rem;letter-spacing:0.4em;color:#C4362B;text-transform:uppercase;margin-bottom:16px;">This cannot continue</div>
        <div style="opacity:0;animation:nhGoFlicker 0.15s 0.7s forwards, nhGoGlitch 0.4s 0.9s;font-family:'Courier New',monospace;font-size:2.8rem;letter-spacing:0.2em;color:#FFF;text-transform:uppercase;margin-bottom:24px;">PROCESS KILLED</div>
        <div style="width:60px;height:1px;background:linear-gradient(90deg,#C4362B,transparent);margin:0 auto 24px;opacity:0;animation:nhGoFlicker 0.15s 1.0s forwards;"></div>
        <div style="opacity:0;animation:nhGoFlicker 0.15s 1.2s forwards;font-family:'Courier New',monospace;font-size:0.7rem;color:#555;letter-spacing:0.1em;">Process terminated — debugger crashed</div>
        <div style="margin-top:20px;opacity:0;animation:nhGoFlicker 0.15s 1.5s forwards;"><div style="font-family:'Courier New',monospace;font-size:0.9rem;color:#C4362B;letter-spacing:0.2em;">SCORE: ${score}</div></div>
        <button class="nh-ov-btn" style="opacity:0;animation:nhGoFlicker 0.15s 1.8s forwards;margin-top:28px;" onclick="window._nhBtn()">RETRY</button>
        <style>
        @keyframes nhGoFlicker{0%{opacity:0;transform:translateX(-5px)}25%{opacity:1;transform:translateX(3px)}50%{opacity:04;transform:translateX(-2px)}75%{opacity:0.9;transform:translateX(1px)}100%{opacity:1;transform:translateX(0)}}
        @keyframes nhGoGlitch{0%{text-shadow:-3px 0 rgba(255,0,0,0.8),3px 0 rgba(0,80,255,0.8);transform:skewX(-2deg)}25%{text-shadow:3px 0 rgba(255,0,0,0.8),-3px 0 rgba(0,80,255,0.8);transform:skewX(1deg)}50%{text-shadow:-2px 0 rgba(255,0,0,0.6),2px 0 rgba(0,80,255,0.6);transform:skewX(-0.5deg)}100%{text-shadow:none;transform:skewX(0)}}
        </style>`;
        window._nhBtn=function(){overlay.style.background="";try{AudioManager.resumeContext();AudioManager.playSFX('button_enter');startLvl();}catch(e){console.error("[NH]",e);}};
        const b=overlay.querySelector(".nh-ov-btn");if(b)b.focus();
    }
    function clearBP(){
        pBullets.forEach(b=>{if(b.glowMesh)scene.remove(b.glowMesh);scene.remove(b.mesh);});pBullets=[];
        eBullets.forEach(b=>{scene.remove(b.mesh);});eBullets=[];
        particles.forEach(p=>{scene.remove(p.mesh);p.mat.dispose();if(p.mesh.geometry)p.mesh.geometry.dispose();});particles=[];
        powerups.forEach(p=>{scene.remove(p.mesh);p.mesh.traverse(c=>{if(c.geometry)c.geometry.dispose();if(c.material)c.material.dispose();});});powerups=[];
    }

    /* ══════════════ FULLSCREEN ══════════════ */
    function toggleFS(){
        const w=document.getElementById("nier-hack-wrapper");if(!w)return;
        if(!document.fullscreenElement){
            w.requestFullscreen().then(()=>{isFS=true;if(fsBtn)fsBtn.textContent="⤓";resizeR();}).catch(()=>{});
        }else{
            document.exitFullscreen().then(()=>{isFS=false;if(fsBtn)fsBtn.textContent="⤒";resizeR();});
        }
    }
    function resizeR(){
        if(!renderer||!canvas)return;
        const w=canvas.clientWidth||960,h=canvas.clientHeight||540;
        renderer.setSize(w,h,false);
        const aspect=w/h;
        if (cameraOrtho) {
            const sz=10;
            cameraOrtho.left=-sz*aspect;cameraOrtho.right=sz*aspect;cameraOrtho.top=sz;cameraOrtho.bottom=-sz;
            cameraOrtho.updateProjectionMatrix();
        }
        if (cameraPersp) {
            cameraPersp.aspect = aspect;
            cameraPersp.updateProjectionMatrix();
        }
    }

    /* ══════════════ RENDER ══════════════ */
    function animate(){
        rafId=requestAnimationFrame(animate);
        if(!sceneOK)return;
        const dt=clock.getDelta();
        update(dt);
        renderer.render(scene,camera);
        renderGlitch();
    }

    /* ══════════════ PAUSE MENU ══════════════ */
    function togglePause(){
        if(!active && !paused) return;
        if(paused) resumeGame();
        else pauseGame();
    }
    function pauseGame(){
        if(!active) return;
        AudioManager.playSFX('button_enter');
        paused = true; active = false; mouseDown = false;
        for(var k in keys) keys[k] = false;
        pauseWasActive = true;
        showPauseMenu();
    }
    function resumeGame(){
        if(!pauseWasActive) return;
        paused = false; active = true;
        pauseWasActive = true;
        hidePauseMenu();
        if(clock) clock.getDelta();
    }
    function showPauseMenu(){
        if(!pauseMenu) return;
        pauseIdx = 0;
        pauseMenu.style.display = "flex";
        pauseMenu.style.opacity = "1";
        pauseMenu.style.pointerEvents = "auto";
        pauseMenu.classList.add("visible");
        pauseMenu.classList.remove("hidden");
        updPauseHL();
    }
    function hidePauseMenu(){
        if(!pauseMenu) return;
        pauseMenu.style.display = "none";
        pauseMenu.style.opacity = "0";
        pauseMenu.style.pointerEvents = "none";
        pauseMenu.classList.remove("visible");
        pauseMenu.classList.add("hidden");
    }
    function updPauseHL(){
        if(!pauseItems || !pauseItems.length) return;
        for(let i=0;i<pauseItems.length;i++){
            if(i===pauseIdx){pauseItems[i].classList.add("selected");}
            else{pauseItems[i].classList.remove("selected");}
        }
    }
    function pauseSelect(){
        if(!pauseItems || !pauseItems.length) return;
        const action = pauseItems[pauseIdx].dataset.action;
        switch(action){
            case "continue": resumeGame(); break;
            case "restart": hidePauseMenu(); paused=false; curLvl=0; score=0; startLvl(); break;
            case "retry": hidePauseMenu(); paused=false; startLvl(); break;
            case "quit": hidePauseMenu(); paused=false; pauseWasActive=false; curLvl=0; score=0; active=false; clearBP(); enemies.forEach(function(e){scene.remove(e.mesh);e.mesh.traverse(function(c){if(c.geometry)c.geometry.dispose();if(c.material)c.material.dispose();});});enemies=[]; clearMaze(); showOv("DEBUGGER ONLINE","Compile combat modules — eliminate hostile processes","INITIALIZE",function(){startLvl();if(!rafId)animate();}); break;
        }
    }

    function toggleViewMode(){
        is3D = !is3D;
        camera = is3D ? cameraPersp : cameraOrtho;
        AudioManager.playSFX('button_select');
        updateViewModeUI();
        shake(0.12);
        triggerGlitch(0.18, 0.12);
        resizeR();
    }

    function updateViewModeUI(){
        const btn = document.getElementById('nh-view');
        if (btn) {
            btn.textContent = is3D ? '3D' : '2D';
            btn.title = is3D ? 'Basculer 2D/3D (O)' : 'Basculer 2D/3D (O)';
        }
    }

    /* ══════════════ INPUT ══════════════ */
    function onKD(e){
        /* If textarea in code editor is focused, skip ALL game shortcuts */
        const activeEl = document.activeElement;
        const textareaFocused = activeEl && activeEl.tagName === 'TEXTAREA' && activeEl.id === 'nh-code-input';
        if(textareaFocused) return;

        keys[e.code]=true;
        if(e.code==="KeyM"){e.preventDefault();AudioManager.toggleMute();return;}
        if(e.code==="KeyO"){e.preventDefault();toggleViewMode();return;}
        /* Enter key activates overlay buttons (START / RETRY) */
        if(e.code==="Enter" && window._nhBtn && overlay && !overlay.classList.contains("hidden")){
            e.preventDefault(); window._nhBtn(); return;
        }

        /* Code editor button navigation (when editor is open but textarea is not focused) */
        if(codeEditorActive){
            if(e.code==="ArrowLeft"){e.preventDefault();codeEditorBtnIdx=0;updCodeBtnHL();AudioManager.playSFX('button_select');return;}
            if(e.code==="ArrowRight"){e.preventDefault();codeEditorBtnIdx=1;updCodeBtnHL();AudioManager.playSFX('button_select');return;}
            if(e.code==="Enter"){
                e.preventDefault();
                const btn = codeEditorBtns[codeEditorBtnIdx];
                if(btn){AudioManager.playSFX('button_enter');btn.click();}
                return;
            }
            /* Re-focus textarea when typing letters (not shortcuts) */
            if(e.code.startsWith("Key") && e.code !== "KeyF" && e.code !== "KeyP" && e.code !== "KeyM" && e.code !== "KeyO"){
                const ta = document.getElementById('nh-code-input');
                if(ta){ta.focus();return;}
            }
            /* Escape in editor: first press refocuses textarea, second exits fullscreen */
            if(e.code==="Escape"){
                const ta = document.getElementById('nh-code-input');
                if(ta){ta.focus();return;}
            }
        }

        /* Dash — Space key */
        if(e.code==="Space" && active && dashCooldownT <= 0 && dashT <= 0){
            e.preventDefault();
            /* Determine dash direction from movement keys or facing */
            let ddx=0,ddz=0;
            if(keys["KeyW"]||keys["KeyZ"])ddz=-1;if(keys["KeyS"])ddz=1;
            if(keys["KeyA"]||keys["KeyQ"])ddx=-1;if(keys["KeyD"])ddx=1;
            if(ddx||ddz){const l=Math.sqrt(ddx*ddx+ddz*ddz);ddx/=l;ddz/=l;}
            else{ddx=Math.sin(playerAngle);ddz=-Math.cos(playerAngle);}
            dashDir = {x:ddx, z:ddz};
            dashT = DASH_DURATION * (playerBuffs.dashDistMul || 1);
            dashCooldownT = DASH_COOLDOWN;
            invulnT = Math.max(invulnT, DASH_DURATION * (playerBuffs.dashDistMul || 1));
            triggerGlitch(0.15, 0.1);
            return;
        }
        /* Pause menu navigation */
        if(paused && pauseWasActive){
            if(e.code==="ArrowUp"||e.code==="KeyW"||e.code==="KeyZ"){e.preventDefault();pauseIdx=(pauseIdx-1+pauseItems.length)%pauseItems.length;updPauseHL();AudioManager.playSFX('button_select');return;}
            if(e.code==="ArrowDown"||e.code==="KeyS"){e.preventDefault();pauseIdx=(pauseIdx+1)%pauseItems.length;updPauseHL();AudioManager.playSFX('button_select');return;}
            if(e.code==="Enter"||e.code==="Space"){e.preventDefault();AudioManager.playSFX('button_enter');pauseSelect();return;}
            if(e.code==="KeyP"||e.code==="Escape"){e.preventDefault();AudioManager.playSFX('button_enter');resumeGame();return;}
            return;
        }
        if(active && e.code.startsWith("Arrow")) e.preventDefault();
        if(e.code==="KeyF") toggleFS();
        if(e.code==="KeyP" && active) togglePause();
    }
    function onKU(e){
        keys[e.code]=false;
        if(e.code==="KeyQ" && active && !paused && !bootActive){
            fireHomingLasers();
        }
    }
    function onMD(e){
        if(e.button===0)mouseDown=true;
        if(e.button===2 && active && !paused && !bootActive){
            rightMouseDown=true;
        }
    }
    function onMU(e){
        if(e.button===0)mouseDown=false;
        if(e.button===2 && active && !paused && !bootActive){
            rightMouseDown=false;
            fireHomingLasers();
        }
    }

    /* ══════════════ PUBLIC API ══════════════ */
    window.NierHackGame={
        init:function(){
            AudioManager.init();
            canvas=document.getElementById("nier-hack-canvas");
            overlay=document.getElementById("nier-hack-overlay");
            hudHP=document.getElementById("nh-health");hudBar=document.getElementById("nh-bar");
            hudScore=document.getElementById("nh-score");hudLvl=document.getElementById("nh-level");
            hudEnm=document.getElementById("nh-enemies");hudName=document.getElementById("nh-level-name");
            fsBtn=document.getElementById("nh-fullscreen");flashEl=document.getElementById("nh-flash");
            muteBtn=document.getElementById("nh-mute");
            viewBtn=document.getElementById("nh-view");
            pauseMenu=document.getElementById("nh-pause");
            updateViewModeUI();
            if(pauseMenu){
                pauseItems=pauseMenu.querySelectorAll(".nh-pause-item");
                pauseItems.forEach(function(item,idx){
                    item.addEventListener("mouseenter",function(){pauseIdx=idx;updPauseHL();AudioManager.playSFX('button_select');});
                    item.addEventListener("click",function(e){e.stopPropagation();pauseIdx=idx;updPauseHL();AudioManager.playSFX('button_enter');pauseSelect();});
                });
            }
            if(!canvas){console.error("[NH] No canvas");return;}
            if(!renderer){
                initScene();if(!sceneOK)return;createPlayer();
                document.addEventListener("keydown",onKD);document.addEventListener("keyup",onKU);
                canvas.addEventListener("mousedown",onMD);canvas.addEventListener("mouseup",onMU);canvas.addEventListener("mouseleave",onMU);
                canvas.addEventListener("contextmenu",function(e){e.preventDefault();});
                window.addEventListener("resize",function(){if(isFS)resizeR();});
                document.addEventListener("fullscreenchange",function(){if(!document.fullscreenElement){if(!suppressFSExit){isFS=false;if(fsBtn)fsBtn.textContent="⤒";resizeR();}}});
                if(fsBtn)fsBtn.addEventListener("click",function(e){e.stopPropagation();toggleFS();});
                if(muteBtn)muteBtn.addEventListener("click",function(e){e.stopPropagation();AudioManager.toggleMute();});
                if(viewBtn)viewBtn.addEventListener("click",function(e){e.stopPropagation();toggleViewMode();});
            }
            curLvl=0;score=0;mouseDown=false;paused=false;pauseWasActive=false;transitioning=false;
            dashT=0;dashCooldownT=0;
            hidePauseMenu();
            podQueue=[];podTimer=0;podFullMsg='';podTypingIdx=0;podTypingTimer=0;hidePod();
            showOv("DEBUGGER ONLINE","Compile combat modules — eliminate hostile processes","INITIALIZE",function(){startLvl();if(!rafId)animate();});
            setTimeout(function(){ podSay("VM Debugger engaged. Write Red Code to boost combat abilities. Eliminate all hostile processes. Press SPACE to dash.", 5); }, 500);
            if(!rafId)animate();
        },
        toggle:function(){
            if(document.documentElement.getAttribute("data-theme")==="nier")this.init();else this.destroy();
        },
        destroy:function(){
            AudioManager.stopBGM();
            active=false;paused=false;pauseWasActive=false;if(rafId){cancelAnimationFrame(rafId);rafId=null;}
            mouseDown=false;for(var k in keys)keys[k]=false;
            hidePauseMenu();
            if(sceneOK){clearBP();enemies.forEach(function(e){scene.remove(e.mesh);e.mesh.traverse(function(c){if(c.geometry)c.geometry.dispose();if(c.material)c.material.dispose();});});enemies=[];clearMaze();}
            hideOv();
            /* Remove vignette */
            const vig = document.getElementById("nh-vignette");
            if(vig) vig.remove();
        },
    };
})();
