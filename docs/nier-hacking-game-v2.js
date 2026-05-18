/* ═══════════════════════════════════════════════════════════════
   NIER AUTOMATA HACKING GAME  –  GOTY Edition v5
   ═══════════════════════════════════════════════════════════════
   Visual reference: NieR:Automata hacking minigame
   - 3D composite player ship with thrusters, pods, shield ring
   - Three distinct enemy types: Scout, Drone, Core
   - Enhanced arena with hexagonal floor, glowing walls, ambient particles
   - Rotating muzzle system inspired by enemy_type_0C.gd
   - Dash ability, bullet trails, hit sparks, spawn animations
   - Extended level roster: Sectors A through Ω
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
    const MAX_PARTICLES = 120;   // hard cap to prevent frame drops
    const MAX_EBULLETS = 120;    // more enemy bullets on screen (bigger, slower, more numerous)

    /* Nier palette — dark dramatic theme */
    const C_BG       = 0x0A0A12;  // Dark void background
    const C_GRID     = 0x334455;  // Dim blue-gray grid
    const C_GRIDDIM  = 0x1A2233;  // Even dimmer grid
    const C_WALL     = 0x333333;  // Dark grey walls
    const C_WALLTOP  = 0x444444;  // Slightly lighter grey wall tops
    const C_PLAYER   = 0xFFFFFF;
    const C_ENEMY    = 0x000000;
    const C_ENEMYEMT = 0xFF6600;
    const C_PBULLET  = 0xFFFFFF;
    const C_EBULLET  = 0xFF0000;
    const C_RING     = 0xFF5500;
    const C_PARTICLE = 0xFFFFFF;
    const C_YORHA    = 0xC4362B;
    const C_SHIELD   = 0x4488FF;
    const C_GOLD     = 0xFFD700;

    const LEVELS = [
        { name:"SECTOR A", enemies:3,  hpMul:1,   spdMul:1,   shootRate:1.4, patterns:["aimed"], types:["scout","scout","core"] },
        { name:"SECTOR B", enemies:4,  hpMul:1.2, spdMul:1.1, shootRate:1.2, patterns:["aimed","burst"], types:["scout","scout","drone","core"] },
        { name:"SECTOR C", enemies:5,  hpMul:1.4, spdMul:1.2, shootRate:1.0, patterns:["aimed","burst","ring"], types:["scout","scout","drone","drone","core"] },
        { name:"SECTOR D", enemies:5,  hpMul:1.7, spdMul:1.3, shootRate:0.9, patterns:["aimed","burst","ring"], types:["scout","drone","drone","drone","core"] },
        { name:"SECTOR E", enemies:6,  hpMul:2.0, spdMul:1.4, shootRate:0.8, patterns:["aimed","burst","ring","spiral"], types:["scout","scout","drone","drone","drone","core"] },
        { name:"SECTOR F", enemies:7,  hpMul:2.3, spdMul:1.5, shootRate:0.7, patterns:["aimed","ring","spiral","wall"], types:["scout","drone","drone","drone","drone","drone","core"] },
        { name:"SECTOR G", enemies:8,  hpMul:2.8, spdMul:1.7, shootRate:0.6, patterns:["aimed","burst","ring","spiral","wall"], types:["scout","scout","drone","drone","drone","drone","drone","core"] },
        { name:"SECTOR Ω", enemies:10, hpMul:3.5, spdMul:2.0, shootRate:0.5, patterns:["aimed","burst","ring","spiral","wall"], types:["scout","scout","drone","drone","drone","drone","drone","drone","drone","core"] },
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

    /* Dash state */
    let dashT = 0;
    let dashCooldownT = 0;
    let dashDir = {x:0, z:0};
    let dashAfterimages = [];

    /* Ambient particles */
    let ambientParticles = [];

    /* Enemy floor glows */
    let enemyGlows = [];

    /* Shared geos & mats */
    let geoBullet, geoEBullet, geoBeamGlow, matPBullet, matPBeamGlow, matEBullet, matEBullets, geoParticle, matHeavyBullet;
    let geoWallH, geoWallV, matWall, matWallTop, matWallEdge;
    let geoPlayer;
    /* Shared geos for particles (avoid per-spawn allocation) */
    let geoTrail, geoSpark, geoDeathSmall, geoDeathMed, geoGlowCircle;
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
                    /* If play fails (e.g. still loading), try a fresh Audio */
                    const b = new Audio(a.src);
                    b.volume = a.volume; b.muted = isMuted;
                    b.play().catch(() => {});
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

            /* Texture Loader */
            const tl = new THREE.TextureLoader();
            const getTex = (p) => { const t = tl.load(p); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; return t; };
            const texPBullet = getTex('YoRHaHackingGame/sprites/player_bullet.png');
            const texEBullet = getTex('YoRHaHackingGame/sprites/enemy_bullet1.png');
            const texBlockA = getTex('YoRHaHackingGame/sprites/block_A.png');
            const texEnemy = getTex('YoRHaHackingGame/sprites/enemy1_new.png');
            const texCore = getTex('YoRHaHackingGame/sprites/enemy_type2.png');

            /* Shared resources — player beam + enemy bullet geometry */
            geoBullet  = new THREE.SphereGeometry(0.08, 6, 6);   // player bullet core — small bright sphere
            geoEBullet = new THREE.SphereGeometry(0.22, 8, 8);   // enemy bullets — bigger and more visible
            matPBullet = new THREE.MeshBasicMaterial({color: 0xFFFFFF});
            matPBeamGlow = new THREE.MeshBasicMaterial({color: 0xAABBFF, transparent: true, opacity: 0.35});  // beam glow
            geoBeamGlow = new THREE.SphereGeometry(0.16, 4, 4);  // shared glow halo for player bullets
            /* Enemy bullet colors — dark palette: black, dark grey, midnight blue */
            matEBullets = [
                new THREE.MeshBasicMaterial({color: 0x111111}),   // noir
                new THREE.MeshBasicMaterial({color: 0x333333}),   // gris foncé
                new THREE.MeshBasicMaterial({color: 0x1A1A3A}),   // bleu nuit
            ];
            matEBullet = matEBullets[0]; // default
            matHeavyBullet = new THREE.MeshBasicMaterial({color:0xFF9900});

            geoParticle= new THREE.PlaneGeometry(0.08, 0.08);
            geoParticle.rotateX(-Math.PI/2);

            /* Enhanced wall materials */
            geoWallH   = new THREE.BoxGeometry(CELL+0.15, 0.6, 0.15);
            geoWallV   = new THREE.BoxGeometry(0.15, 0.6, CELL+0.15);
            matWall    = new THREE.MeshPhongMaterial({color:C_WALL, emissive:0x222222, emissiveIntensity:0.2});
            matWallTop = new THREE.MeshPhongMaterial({color:C_WALLTOP, emissive:0x333333, emissiveIntensity:0.3});
            matWallEdge = new THREE.LineBasicMaterial({color:0x555555, transparent:true, opacity:0.6});

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

        /* Floor — dark void base */
        const fg = new THREE.PlaneGeometry(mazeW+20, mazeH+20);
        const fm = new THREE.MeshPhongMaterial({color:0xFFFFFF, emissive:0xFFFFFF, emissiveIntensity:1.2, specular:0xFFFFFF, shininess:1000, reflectivity: 1.0});
        floorMesh = new THREE.Mesh(fg, fm);
        floorMesh.rotation.x=-Math.PI/2;
        floorMesh.position.set(mazeW/2, -0.01, mazeH/2);
        floorMesh.receiveShadow = true;
        scene.add(floorMesh);

        /* Grid overlay — merged into 3 Line objects for performance (1 draw call each) */
        gridGroup = new THREE.Group();
        const lineMat = new THREE.LineBasicMaterial({color:0x333333, transparent:true, opacity:0.5});
        const lineMatDim = new THREE.LineBasicMaterial({color:0x555555, transparent:true, opacity:0.2});

        /* Standard grid lines — collect all points then merge */
        const brightPts = [], dimPts = [];
        for(let x=0;x<=MAZE_W;x++){
            const arr = x%4===0 ? brightPts : dimPts;
            arr.push(new THREE.Vector3(x*CELL,0.01,0), new THREE.Vector3(x*CELL,0.01,mazeH));
        }
        for(let y=0;y<=MAZE_H;y++){
            const arr = y%4===0 ? brightPts : dimPts;
            arr.push(new THREE.Vector3(0,0.01,y*CELL), new THREE.Vector3(mazeW,0.01,y*CELL));
        }
        /* Build merged line segments using NaN breaks */
        const brightSegs = [];
        for(let i=0;i<brightPts.length;i+=2){
            brightSegs.push(brightPts[i].x, brightPts[i].y, brightPts[i].z);
            brightSegs.push(brightPts[i+1].x, brightPts[i+1].y, brightPts[i+1].z);
        }
        const dimSegs = [];
        for(let i=0;i<dimPts.length;i+=2){
            dimSegs.push(dimPts[i].x, dimPts[i].y, dimPts[i].z);
            dimSegs.push(dimPts[i+1].x, dimPts[i+1].y, dimPts[i+1].z);
        }
        if(brightSegs.length > 0){
            const bGeo = new THREE.BufferGeometry();
            bGeo.setAttribute('position', new THREE.Float32BufferAttribute(brightSegs, 3));
            gridGroup.add(new THREE.LineSegments(bGeo, lineMat));
        }
        if(dimSegs.length > 0){
            const dGeo = new THREE.BufferGeometry();
            dGeo.setAttribute('position', new THREE.Float32BufferAttribute(dimSegs, 3));
            gridGroup.add(new THREE.LineSegments(dGeo, lineMatDim));
        }

        /* Hexagonal sub-grid — merged into a single LineSegments */
        const hexMat = new THREE.LineBasicMaterial({color:0x666666, transparent:true, opacity:0.08});
        const hexSize = CELL * 0.5;
        const hexH = hexSize * Math.sqrt(3);
        const hexSegs = [];
        for(let row = -1; row < MAZE_H * 2 + 2; row++){
            for(let col = -1; col < MAZE_W * 2 + 2; col++){
                const cx = col * hexSize * 1.5;
                const cz = row * hexH + (col % 2 ? hexH * 0.5 : 0);
                for(let i = 0; i < 6; i++){
                    const a1 = Math.PI / 3 * i - Math.PI / 6;
                    const a2 = Math.PI / 3 * ((i+1)%6) - Math.PI / 6;
                    hexSegs.push(cx + hexSize*0.4*Math.cos(a1), 0.005, cz + hexSize*0.4*Math.sin(a1));
                    hexSegs.push(cx + hexSize*0.4*Math.cos(a2), 0.005, cz + hexSize*0.4*Math.sin(a2));
                }
            }
        }
        if(hexSegs.length > 0){
            const hexGeo = new THREE.BufferGeometry();
            hexGeo.setAttribute('position', new THREE.Float32BufferAttribute(hexSegs, 3));
            gridGroup.add(new THREE.LineSegments(hexGeo, hexMat));
        }

        /* Central circle decoration */
        const circPts = [];
        const circR = Math.min(mazeW, mazeH) * 0.35;
        const circMat = new THREE.LineBasicMaterial({color:0x555555, transparent:true, opacity:0.2});
        for(let i=0;i<=64;i++){
            const a = (i/64)*Math.PI*2;
            circPts.push(new THREE.Vector3(mazeW/2 + Math.cos(a)*circR, 0.008, mazeH/2 + Math.sin(a)*circR));
        }
        gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(circPts), circMat));
        /* Inner ring */
        const circPts2 = [];
        for(let i=0;i<=64;i++){
            const a = (i/64)*Math.PI*2;
            circPts2.push(new THREE.Vector3(mazeW/2 + Math.cos(a)*circR*0.7, 0.008, mazeH/2 + Math.sin(a)*circR*0.7));
        }
        gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(circPts2), circMat));

        scene.add(gridGroup);

        /* Enhanced walls — body + glowing top cap + base edge lines (merged into 1 draw call) */
        const geoWallTopH = new THREE.BoxGeometry(CELL+0.15, 0.04, 0.18);
        const geoWallTopV = new THREE.BoxGeometry(0.18, 0.04, CELL+0.15);
        const edgeSegs = []; // collect all edge segments for merging

        for(let y=0;y<MAZE_H;y++) for(let x=0;x<MAZE_W;x++){
            const c=mazeGrid[y][x], wx=x*CELL, wz=y*CELL;
            if(c.t){
                const m=new THREE.Mesh(geoWallH,matWall);m.position.set(wx+HALF,0.3,wz);m.castShadow=true;m.receiveShadow=true;scene.add(m);wallMeshes.push(m);
                const tc=new THREE.Mesh(geoWallTopH,matWallTop);tc.position.set(wx+HALF,0.61,wz);scene.add(tc);wallMeshes.push(tc);
                edgeSegs.push(wx-0.07,0.01,wz, wx+CELL+0.07,0.01,wz);
            }
            if(c.l){
                const m=new THREE.Mesh(geoWallV,matWall);m.position.set(wx,0.3,wz+HALF);m.castShadow=true;m.receiveShadow=true;scene.add(m);wallMeshes.push(m);
                const tc=new THREE.Mesh(geoWallTopV,matWallTop);tc.position.set(wx,0.61,wz+HALF);scene.add(tc);wallMeshes.push(tc);
                edgeSegs.push(wx,0.01,wz-0.07, wx,0.01,wz+CELL+0.07);
            }
            if(y===MAZE_H-1&&c.b){
                const m=new THREE.Mesh(geoWallH,matWall);m.position.set(wx+HALF,0.3,wz+CELL);m.castShadow=true;m.receiveShadow=true;scene.add(m);wallMeshes.push(m);
                const tc=new THREE.Mesh(geoWallTopH,matWallTop);tc.position.set(wx+HALF,0.61,wz+CELL);scene.add(tc);wallMeshes.push(tc);
                edgeSegs.push(wx-0.07,0.01,wz+CELL, wx+CELL+0.07,0.01,wz+CELL);
            }
            if(x===MAZE_W-1&&c.r){
                const m=new THREE.Mesh(geoWallV,matWall);m.position.set(wx+CELL,0.3,wz+HALF);m.castShadow=true;m.receiveShadow=true;scene.add(m);wallMeshes.push(m);
                const tc=new THREE.Mesh(geoWallTopV,matWallTop);tc.position.set(wx+CELL,0.61,wz+HALF);scene.add(tc);wallMeshes.push(tc);
                edgeSegs.push(wx+CELL,0.01,wz-0.07, wx+CELL,0.01,wz+CELL+0.07);
            }
        }
        /* Merge all wall edge lines into one LineSegments draw call */
        if(edgeSegs.length > 0){
            const edgeGeo = new THREE.BufferGeometry();
            edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgeSegs, 3));
            const edgeMesh = new THREE.LineSegments(edgeGeo, matWallEdge);
            scene.add(edgeMesh);
            wallMeshes.push(edgeMesh);
        }

        /* Border */
        const bMat=new THREE.MeshLambertMaterial({color:0x333333, emissive:0x222222, emissiveIntensity:0.1});
        const bH=new THREE.BoxGeometry(mazeW+0.3,0.3,0.1);
        const bV=new THREE.BoxGeometry(0.1,0.3,mazeH+0.3);
        let m;
        m=new THREE.Mesh(bH,bMat);m.position.set(mazeW/2,0.15,-0.05);m.castShadow=true;m.receiveShadow=true;scene.add(m);wallMeshes.push(m);
        m=new THREE.Mesh(bH,bMat);m.position.set(mazeW/2,0.15,mazeH+0.05);m.castShadow=true;m.receiveShadow=true;scene.add(m);wallMeshes.push(m);
        m=new THREE.Mesh(bV,bMat);m.position.set(-0.05,0.15,mazeH/2);m.castShadow=true;m.receiveShadow=true;scene.add(m);wallMeshes.push(m);
        m=new THREE.Mesh(bV,bMat);m.position.set(mazeW+0.05,0.15,mazeH/2);m.castShadow=true;m.receiveShadow=true;scene.add(m);wallMeshes.push(m);

        /* Ambient floating data fragments */
        spawnAmbientParticles();
    }

    /* ══════════════ AMBIENT PARTICLES ══════════════ */
    function spawnAmbientParticles(){
        const count = 15; // reduced from 25 for performance
        const mazeW = MAZE_W*CELL, mazeH = MAZE_H*CELL;
        for(let i=0;i<count;i++){
            const geo = new THREE.PlaneGeometry(0.04, 0.04);
            geo.rotateX(-Math.PI/2);
            const mat = new THREE.MeshBasicMaterial({color:0x446688, transparent:true, opacity:0.2+Math.random()*0.3, side:THREE.DoubleSide});
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(Math.random()*mazeW, 0.05+Math.random()*0.5, Math.random()*mazeH);
            mesh.rotation.y = Math.random()*Math.PI*2;
            scene.add(mesh);
            ambientParticles.push({
                mesh, mat,
                vx: (Math.random()-0.5)*0.3,
                vz: (Math.random()-0.5)*0.3,
                rotSpeed: (Math.random()-0.5)*0.5,
                baseY: mesh.position.y
            });
        }
    }

    function updAmbientParticles(dt, time){
        const mazeW = MAZE_W*CELL, mazeH = MAZE_H*CELL;
        for(const p of ambientParticles){
            p.mesh.position.x += p.vx * dt;
            p.mesh.position.z += p.vz * dt;
            p.mesh.position.y = p.baseY + Math.sin(time*1.5 + p.mesh.position.x*2)*0.06;
            p.mesh.rotation.y += p.rotSpeed * dt;
            /* Respawn if out of bounds */
            if(p.mesh.position.x < -1 || p.mesh.position.x > mazeW+1 || p.mesh.position.z < -1 || p.mesh.position.z > mazeH+1){
                p.mesh.position.x = Math.random()*mazeW;
                p.mesh.position.z = Math.random()*mazeH;
                p.vx = (Math.random()-0.5)*0.3;
                p.vz = (Math.random()-0.5)*0.3;
            }
        }
    }

    /* ══════════════ ENEMY FLOOR GLOW ══════════════ */
    const _glowMat = new THREE.MeshBasicMaterial({color:0xFF4400, transparent:true, opacity:0.08});
    function updateEnemyGlows(){
        /* Remove excess glows */
        while(enemyGlows.length > enemies.length){
            const g = enemyGlows.pop();
            scene.remove(g);
            if(g.geometry) g.geometry.dispose();
        }
        /* Reuse or create glows to match enemy count */
        for(let i=0; i<enemies.length; i++){
            if(i < enemyGlows.length){
                /* Reuse existing glow — just update position */
                enemyGlows[i].position.set(enemies[i].pos.x, 0.005, enemies[i].pos.z);
            } else {
                /* Create new glow using shared geometry */
                const glow = new THREE.Mesh(geoGlowCircle, _glowMat);
                glow.position.set(enemies[i].pos.x, 0.005, enemies[i].pos.z);
                scene.add(glow);
                enemyGlows.push(glow);
            }
        }
    }

    /* ══════════════ PLAYER ══════════════ */
    function createPlayer(){
        if(playerMesh)scene.remove(playerMesh);

        const group = new THREE.Group();

        /* A) Main hull — triangular arrow/chevron shape */
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
        const hullMat = new THREE.MeshPhongMaterial({color:0xFFFFFF, emissive:0xFFFFFF, emissiveIntensity:0.15, flatShading:true});
        const hull = new THREE.Mesh(hullGeo, hullMat);
        hull.castShadow = true;
        group.add(hull);
        group.userData.hull = hull;

        /* B) Two swept-back wing strakes — sharp angular lines */
        const wingShape = new THREE.Shape();
        wingShape.moveTo(0, 0.15);       // wing root front
        wingShape.lineTo(-0.25, -0.15);  // wing tip
        wingShape.lineTo(0, -0.1);       // wing root back
        wingShape.closePath();
        const wingExtSettings = { depth: 0.03, bevelEnabled: false };
        const wingGeoL = new THREE.ExtrudeGeometry(wingShape, wingExtSettings);
        wingGeoL.rotateX(-Math.PI/2);
        wingGeoL.translate(-0.1, 0, -0.05);
        const leftWing = new THREE.Mesh(wingGeoL, new THREE.MeshPhongMaterial({color:0xCCCCCC, emissive:0x222222, emissiveIntensity:0.05, flatShading:true}));
        group.add(leftWing);

        // Mirror wing for right side
        const wingShapeR = new THREE.Shape();
        wingShapeR.moveTo(0, 0.15);
        wingShapeR.lineTo(0.25, -0.15);
        wingShapeR.lineTo(0, -0.1);
        wingShapeR.closePath();
        const wingGeoR = new THREE.ExtrudeGeometry(wingShapeR, wingExtSettings);
        wingGeoR.rotateX(-Math.PI/2);
        wingGeoR.translate(0.1, 0, -0.05);
        const rightWing = new THREE.Mesh(wingGeoR, new THREE.MeshPhongMaterial({color:0xCCCCCC, emissive:0x222222, emissiveIntensity:0.05, flatShading:true}));
        group.add(rightWing);

        /* Red tips on wing ends */
        const tipGeo = new THREE.BoxGeometry(0.06, 0.025, 0.06);
        const tipMat = new THREE.MeshBasicMaterial({color:C_YORHA});
        const leftTip = new THREE.Mesh(tipGeo, tipMat);
        leftTip.position.set(-0.32, 0, -0.12);
        group.add(leftTip);
        const rightTip = new THREE.Mesh(tipGeo, tipMat);
        rightTip.position.set(0.32, 0, -0.12);
        group.add(rightTip);

        /* C) Engine thrusters */
        const thrusterGeo = new THREE.CylinderGeometry(0.03, 0.04, 0.08, 6);
        const thrusterMat = new THREE.MeshBasicMaterial({color:0x4488FF, transparent:true, opacity:0.8});
        const thrusterLeft = new THREE.Mesh(thrusterGeo, thrusterMat);
        thrusterLeft.position.set(-0.10, 0, -0.28);
        thrusterLeft.rotation.x = Math.PI/2;
        group.add(thrusterLeft);
        group.userData.thrusterLeft = thrusterLeft;

        const thrusterRight = new THREE.Mesh(thrusterGeo, thrusterMat.clone());
        thrusterRight.position.set(0.10, 0, -0.28);
        thrusterRight.rotation.x = Math.PI/2;
        group.add(thrusterRight);
        group.userData.thrusterRight = thrusterRight;

        /* D) Support pods — two small octahedrons orbiting */
        const podGeo = new THREE.OctahedronGeometry(0.04, 0);
        const podMat = new THREE.MeshBasicMaterial({color:0x88AACC});
        const leftPod = new THREE.Mesh(podGeo, podMat);
        leftPod.position.set(-0.36, 0.1, -0.12);
        group.add(leftPod);
        group.userData.leftPod = leftPod;

        const rightPod = new THREE.Mesh(podGeo, podMat.clone());
        rightPod.position.set(0.36, 0.1, -0.12);
        group.add(rightPod);
        group.userData.rightPod = rightPod;

        /* E) Shield indicator ring */
        const shieldGeo = new THREE.TorusGeometry(0.35, 0.008, 4, 32);
        const shieldMat = new THREE.MeshBasicMaterial({color:C_SHIELD, transparent:true, opacity:0.12});
        const shieldRing = new THREE.Mesh(shieldGeo, shieldMat);
        shieldRing.rotation.x = Math.PI/2;
        group.add(shieldRing);
        group.userData.shieldRing = shieldRing;
        group.userData.shieldMat = shieldMat;

        /* F) Core glow sphere */
        const coreGeo = new THREE.SphereGeometry(0.05, 8, 8);
        const coreMat = new THREE.MeshBasicMaterial({color:C_YORHA});
        const coreGlow = new THREE.Mesh(coreGeo, coreMat);
        group.add(coreGlow);
        group.userData.coreGlow = coreGlow;
        group.userData.coreMat = coreMat;

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
    function mkBullet(x,z,angle,speed,isPlayer, damage, piercing){
        damage = damage || 1;
        piercing = piercing || false;
        let mat=isPlayer?matPBullet:matEBullets[Math.floor(Math.random()*matEBullets.length)];
        let scale = 1;
        if(isPlayer && playerUpgrade === "heavy"){
            mat = matHeavyBullet;
            scale = 1.8;
            damage = 2;
            piercing = true;
        }
        const m=new THREE.Mesh(isPlayer?geoBullet:geoEBullet,mat);
        m.position.set(x,0.25,z);
        m.scale.set(scale, scale, scale);
        scene.add(m);

        /* Player beam glow halo — soft light around the bullet */
        let glowMesh = null;
        if(isPlayer){
            glowMesh = new THREE.Mesh(geoBeamGlow, matPBeamGlow);
            glowMesh.position.copy(m.position);
            scene.add(glowMesh);
        }

        const arr=isPlayer?pBullets:eBullets;
        arr.push({
            mesh:m,
            glowMesh: glowMesh,
            vx:Math.sin(angle)*speed,
            vz:-Math.cos(angle)*speed,
            life: isPlayer ? 30 : 999,   // enemy bullets never expire by time — only wall/player hit
            isEnemyBullet: !isPlayer,
            damage: damage,
            piercing: piercing,
            piercedTargets: [],
            trailT:0
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
            const mat = new THREE.MeshBasicMaterial({color, transparent:true, opacity:1});
            const m = new THREE.Mesh(geoSpark, mat);
            m.position.set(x, 0.15+Math.random()*0.15, z);
            scene.add(m);
            const spreadAngle = angle + (Math.random()-0.5)*1.2;
            const speed = 4 + Math.random()*6;
            particles.push({mesh:m, mat, vx:Math.sin(spreadAngle)*speed, vy:2+Math.random()*3, vz:-Math.cos(spreadAngle)*speed, life:0.2+Math.random()*0.15, ml:0.35, rotSpeed:(Math.random()-0.5)*12});
        }
    }

    /* ══════════════ PARTICLES ══════════════ */
    function spawnP(x,z,color,n){
        n = Math.min(n, MAX_PARTICLES - particles.length); // respect cap
        for(let i=0;i<n;i++){
            const mat=new THREE.MeshBasicMaterial({color,transparent:true,opacity:1});
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
        for(const e of enemies){
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
        const wrap = document.getElementById("nier-hack-wrapper");
        if(!wrap) return;
        let ov = document.getElementById("nh-glitch");
        if(!ov){
            ov = document.createElement("div"); ov.id = "nh-glitch";
            ov.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:6;overflow:hidden;";
            const canvasWrap = canvas.parentElement;
            if(canvasWrap) canvasWrap.appendChild(ov);
            else return;
        }
        if(glitchIntensity <= 0){
            ov.innerHTML = ""; ov.style.opacity = "0";
            canvas.style.transform = "";
            return;
        }
        ov.style.opacity = "1";
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
        ov.innerHTML = html;
    }

    /* ── VIGNETTE ── */
    function ensureVignette(){
        const wrap = document.getElementById("nier-hack-wrapper");
        if(!wrap) return;
        let vig = document.getElementById("nh-vignette");
        if(!vig){
            vig = document.createElement("div"); vig.id = "nh-vignette";
            vig.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:5;background:radial-gradient(ellipse at center,transparent 60%,rgba(0,0,0,0.12) 100%);";
            const canvasWrap = canvas.parentElement;
            if(canvasWrap) canvasWrap.appendChild(vig);
        }
        /* Low HP intensifies vignette with red tint */
        const hpRatio = playerHP / MAX_HP;
        if(hpRatio < 0.3){
            vig.style.background = `radial-gradient(ellipse at center,transparent 40%,rgba(196,54,43,${0.15*(1-hpRatio/0.3)}) 100%)`;
        } else {
            vig.style.background = "radial-gradient(ellipse at center,transparent 60%,rgba(0,0,0,0.12) 100%)";
        }
    }

    /* ── DEATH PARTICLES ── */
    function spawnDeathBurst(x, z, color, count){
        count = Math.min(count, MAX_PARTICLES - particles.length); // respect cap
        for(let i = 0; i < count; i++){
            const useSmall = Math.random() < 0.6;
            const geo = useSmall ? geoDeathSmall : geoDeathMed;
            const mat = new THREE.MeshBasicMaterial({color, transparent:true, opacity:1});
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
        const geo = new THREE.TorusGeometry(0.1, 0.02, 4, 16);
        const mat = new THREE.MeshBasicMaterial({color:0xFF6600, transparent:true, opacity:0.8});
        const ring = new THREE.Mesh(geo, mat);
        ring.rotation.x = Math.PI/2;
        ring.position.set(x, 0.05, z);
        scene.add(ring);
        /* Animate as a special particle */
        particles.push({mesh:ring, mat, vx:0, vy:0, vz:0, life:0.6, ml:0.6, isRing:true, scaleSpeed:4});
    }

    /* ── DASH AFTERIMAGE ── */
    function spawnAfterimage(px, pz, angle){
        const geo = new THREE.OctahedronGeometry(0.12, 0);
        geo.scale(1, 0.5, 1.6);
        const mat = new THREE.MeshBasicMaterial({color:0x4488FF, transparent:true, opacity:0.35});
        const m = new THREE.Mesh(geo, mat);
        m.position.set(px, 0.15, pz);
        m.rotation.y = -angle;
        scene.add(m);
        particles.push({mesh:m, mat, vx:0, vy:0, vz:0, life:0.25, ml:0.25});
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
        el.innerHTML = `<div style="font-size:0.6rem;letter-spacing:0.5em;color:#888;text-transform:uppercase;margin-bottom:10px;opacity:0;animation:nhTransIn 0.3s 0.3s ease-out forwards;">HACKING COMPLETE</div><div style="font-size:2rem;letter-spacing:0.35em;color:#000;text-transform:uppercase;font-weight:bold;opacity:0;animation:nhTransIn 0.3s 0.5s ease-out forwards;">${name} CLEARED</div><div style="margin-top:18px;width:80px;height:2px;background:#C4362B;opacity:0;animation:nhTransIn 0.3s 0.7s ease-out forwards;"></div><div style="font-size:0.55rem;letter-spacing:0.2em;color:#999;margin-top:12px;opacity:0;animation:nhTransIn 0.3s 0.9s ease-out forwards;">INITIALIZING NEXT SECTOR...</div><style>@keyframes nhTransIn{0%{opacity:0;transform:translateX(-8px)}100%{opacity:1;transform:translateX(0)}}</style>`;
        let scanLine = el.querySelector('.nh-scan-line');
        if(!scanLine){
            scanLine = document.createElement('div');
            scanLine.className = 'nh-scan-line';
            scanLine.style.cssText = 'position:absolute;left:0;right:0;height:3px;background:linear-gradient(90deg,transparent,rgba(196,54,43,0.6),rgba(196,54,43,0.9),rgba(196,54,43,0.6),transparent);box-shadow:0 0 15px rgba(196,54,43,0.4),0 0 30px rgba(196,54,43,0.2);z-index:1;pointer-events:none;';
            el.appendChild(scanLine);
        }
        el.style.opacity = "1"; el.style.pointerEvents = "auto";
        scanLine.style.top = '-3px';
        scanLine.style.transition = 'top 1.2s ease-in-out';
        requestAnimationFrame(function(){
            requestAnimationFrame(function(){
                scanLine.style.top = '100%';
            });
        });
        setTimeout(function(){
            el.style.transition = "opacity 0.5s";
            el.style.opacity = "0";
            setTimeout(function(){
                el.style.pointerEvents = "none";
                el.style.transition = "opacity 0.15s";
                scanLine.style.top = '-3px';
                scanLine.style.transition = 'none';
                transitioning = false;
                callback();
            }, 500);
        }, 1600);
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
        const time = clock.getElapsedTime();

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

        /* Dash grants invulnerability */
        if(dashT > 0 && invulnT <= 0) {
            /* Already handled by the dash movement above */
        }

        /* Shoot */
        shootT-=dt;
        if((mouseDown||keys["KeyE"])&&shootT<=0){
            if(playerUpgrade === "triple"){
                mkBullet(playerPos.x, playerPos.z, playerAngle - 0.22, BULLET_SPEED, true);
                mkBullet(playerPos.x, playerPos.z, playerAngle, BULLET_SPEED, true);
                mkBullet(playerPos.x, playerPos.z, playerAngle + 0.22, BULLET_SPEED, true);
            } else {
                mkBullet(playerPos.x,playerPos.z,playerAngle,BULLET_SPEED,true);
            }
            AudioManager.playSFX('player_shoot');
            shootT=SHOOT_CD;
        }

        /* Player bullets */
        for(let i=pBullets.length-1;i>=0;i--){
            const b=pBullets[i];b.mesh.position.x+=b.vx*dt;b.mesh.position.z+=b.vz*dt;b.life-=dt;
            /* Move beam glow with bullet */
            if(b.glowMesh) b.glowMesh.position.copy(b.mesh.position);

            /* Bullet trail — throttled to reduce particle count */
            b.trailT -= dt;
            if(b.trailT <= 0 && particles.length < MAX_PARTICLES * 0.7){
                spawnBulletTrail(b.mesh.position.x, b.mesh.position.z, true);
                b.trailT = 0.04; // faster trail for beam effect
            }

            if(wallAt(b.mesh.position.x,b.mesh.position.z)||b.life<=0){
                if(b.life>0){
                    spawnP(b.mesh.position.x,b.mesh.position.z,C_GRIDDIM,2);
                    spawnHitSparks(b.mesh.position.x, b.mesh.position.z, 0xAAAAAA, Math.atan2(b.vx, -b.vz));
                }
                if(b.glowMesh)scene.remove(b.glowMesh);
                scene.remove(b.mesh);pBullets.splice(i,1);continue;
            }

            /* Check shield block collisions */
            let shieldHit = false;
            for(let j=enemies.length-1;j>=0;j--){
                const e=enemies[j];
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
                    if(e.hp<=0){
                        if(e.type === "core"){
                            AudioManager.playSFX('core_broken');
                        } else {
                            AudioManager.playSFX('enemy_explode');
                        }
                        spawnDeathBurst(e.pos.x, e.pos.z, 0xFF6600, e.type==="core"?10:5);
                        spawnDeathBurst(e.pos.x, e.pos.z, 0x1A1A1A, e.type==="core"?6:3);
                        spawnDeathBurst(e.pos.x, e.pos.z, 0xFF0000, 3);
                        spawnDeathBurst(e.pos.x, e.pos.z, 0xFFCC00, 2);
                        flashScreen();
                        const chance = e.type === "core" ? 1.0 : (e.type === "drone" ? 0.4 : 0.2);
                        if(Math.random() < chance) spawnPowerup(e.pos.x, e.pos.z);
                        scene.remove(e.mesh);e.mesh.traverse(c=>{if(c.geometry)c.geometry.dispose();if(c.material)c.material.dispose();});
                        const scoreVal = e.type==="core"?500:(e.type==="drone"?300:150);
                        score+=scoreVal;enemies.splice(j,1);
                        updateEnemyGlows();
                        const remaining = enemies.length;
                        if(remaining === 1) podSay("One target remaining.", 2);
                        else if(remaining === 0 && curLvl < LEVELS.length - 1) podSay("Sector cleared. Proceeding to next area.", 3);
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

            /* Enemy bullet trail — throttled to reduce particle count */
            b.trailT -= dt;
            if(b.trailT <= 0 && particles.length < MAX_PARTICLES * 0.7){
                spawnBulletTrail(b.mesh.position.x, b.mesh.position.z, false);
                b.trailT = 0.07;
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
            if(p.life<=0){scene.remove(p.mesh);p.mat.dispose();if(p.mesh.geometry)p.mesh.geometry.dispose();particles.splice(i,1);}
        }

        /* Dash afterimage cleanup is handled by the main particle loop above */

        updEnemies(dt);
        updPowerups(dt);
        if(enemies.length===0 && !transitioning){lvlClear();return;}
        updHUD();
    }

    /* ══════════════ HUD ══════════════ */
    function updHUD(){
        if(hudHP)hudHP.textContent=playerHP+"%";
        if(hudBar){hudBar.style.width=playerHP+"%";hudBar.className="nh-bar-inner"+(playerHP<30?" danger":"");}
        if(hudScore)hudScore.textContent=score;
        if(hudLvl)hudLvl.textContent=(curLvl+1)+"/"+LEVELS.length;
        if(hudEnm)hudEnm.textContent=enemies.length;
        if(hudName)hudName.textContent=LEVELS[curLvl].name;
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
        enemies.forEach(e=>{scene.remove(e.mesh);e.mesh.traverse(c=>{if(c.geometry)c.geometry.dispose();if(c.material)c.material.dispose();});});
        enemies=[];
        mazeGrid=genMaze();buildMaze();
        playerPos=c2w(1,1);playerAngle=0;playerHP=MAX_HP;invulnT=0;shootT=0;
        playerUpgrade = "standard"; upgradeTimeRemaining = 0;
        dashT = 0; dashCooldownT = 0;
        playerMesh.position.set(playerPos.x,0.05,playerPos.z);playerMesh.rotation.z=0;playerMesh.visible=true;
        if(playerMesh.userData.coreMat) playerMesh.userData.coreMat.color.setHex(C_YORHA);
        spawnEnemies();
        const cx=MAZE_W*CELL/2,cz=MAZE_H*CELL/2;
        camera.position.set(cx,30,cz);camera.lookAt(cx,0,cz);
        active=true;paused=false;hideOv();updHUD();

        /* Spawn ring effects for each enemy */
        for(const e of enemies){
            spawnRingEffect(e.pos.x, e.pos.z);
        }
    }
    function lvlClear(){
        active=false;
        if(curLvl<LEVELS.length-1){
            const nextLvl = curLvl + 1;
            showLevelTransition(LEVELS[curLvl].name, function(){
                curLvl = nextLvl; startLvl();
            });
        } else {
            showLevelTransition("SYSTEM COMPROMISED", function(){
                showOv("SYSTEM COMPROMISED","All sectors breached — hack successful","RESTART",function(){curLvl=0;score=0;startLvl();});
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
        <div style="opacity:0;animation:nhGoFlicker 0.15s 0.7s forwards, nhGoGlitch 0.4s 0.9s;font-family:'Courier New',monospace;font-size:2.8rem;letter-spacing:0.2em;color:#FFF;text-transform:uppercase;margin-bottom:24px;">CONNECTION LOST</div>
        <div style="width:60px;height:1px;background:linear-gradient(90deg,#C4362B,transparent);margin:0 auto 24px;opacity:0;animation:nhGoFlicker 0.15s 1.0s forwards;"></div>
        <div style="opacity:0;animation:nhGoFlicker 0.15s 1.2s forwards;font-family:'Courier New',monospace;font-size:0.7rem;color:#555;letter-spacing:0.1em;">Signal terminated — hack failed</div>
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
            case "quit": hidePauseMenu(); paused=false; pauseWasActive=false; curLvl=0; score=0; active=false; clearBP(); enemies.forEach(function(e){scene.remove(e.mesh);e.mesh.traverse(function(c){if(c.geometry)c.geometry.dispose();if(c.material)c.material.dispose();});});enemies=[]; clearMaze(); showOv("HACKING INITIATED","Breach the firewall — destroy all enemy cores","START",function(){startLvl();if(!rafId)animate();}); break;
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
        keys[e.code]=true;
        if(e.code==="KeyM"){e.preventDefault();AudioManager.toggleMute();return;}
        if(e.code==="KeyO"){e.preventDefault();toggleViewMode();return;}
        /* Enter key activates overlay buttons (START / RETRY) */
        if(e.code==="Enter" && window._nhBtn && overlay && !overlay.classList.contains("hidden")){
            e.preventDefault(); window._nhBtn(); return;
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
            dashT = DASH_DURATION;
            dashCooldownT = DASH_COOLDOWN;
            invulnT = Math.max(invulnT, DASH_DURATION);
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
    function onKU(e){keys[e.code]=false;}
    function onMD(e){if(e.button===0)mouseDown=true;}
    function onMU(e){if(e.button===0)mouseDown=false;}

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
                document.addEventListener("fullscreenchange",function(){if(!document.fullscreenElement){isFS=false;if(fsBtn)fsBtn.textContent="⤒";resizeR();}});
                if(fsBtn)fsBtn.addEventListener("click",function(e){e.stopPropagation();toggleFS();});
                if(muteBtn)muteBtn.addEventListener("click",function(e){e.stopPropagation();AudioManager.toggleMute();});
                if(viewBtn)viewBtn.addEventListener("click",function(e){e.stopPropagation();toggleViewMode();});
            }
            curLvl=0;score=0;mouseDown=false;paused=false;pauseWasActive=false;transitioning=false;
            dashT=0;dashCooldownT=0;
            hidePauseMenu();
            podQueue=[];podTimer=0;podFullMsg='';podTypingIdx=0;podTypingTimer=0;hidePod();
            showOv("HACKING INITIATED","Breach the firewall — destroy all enemy cores","START",function(){startLvl();if(!rafId)animate();});
            setTimeout(function(){ podSay("Hacking module engaged. Destroy all enemy cores. Press SPACE to dash.", 4); }, 500);
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
