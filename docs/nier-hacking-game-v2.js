/* ═══════════════════════════════════════════════════════════════
   NIER AUTOMATA HACKING GAME  –  Faithful Recreation v4
   ═══════════════════════════════════════════════════════════════
   Visual reference: NieR:Automata hacking minigame
   - Flat 2D top-down view on light gray grid
   - White triangle player
   - Black/orange enemy cores with pulsating rings
   - White square bullets (player), Red square bullets (enemy)
   - Minimal particle effects, screen flash on damage
   Controls: WASD move, Arrow keys aim, Left click shoot, F fullscreen
   ═══════════════════════════════════════════════════════════════ */

(function () {
    "use strict";

    /* ══════════════ CONSTANTS ══════════════ */
    let MAZE_W = 16, MAZE_H = 12;
    const CELL = 2.0;
    const HALF = CELL / 2;
    const PLAYER_SPEED = 5.0;
    const BULLET_SPEED = 14;
    const ENEMY_BULLET_SPEED = 3.8;
    const SHOOT_CD = 0.11;
    const MAX_HP = 100;
    const INVULN_T = 0.6;

    /* Nier palette */
    const C_BG       = 0xE6E6E6;
    const C_GRID     = 0xFFFFFF;
    const C_GRIDDIM  = 0xD0D0D0;
    const C_WALL     = 0xF0F0F0;
    const C_WALLTOP  = 0xFAFAFA;
    const C_PLAYER   = 0xFFFFFF;
    const C_ENEMY    = 0x000000;
    const C_ENEMYEMT = 0xFF6600;
    const C_PBULLET  = 0xFFFFFF;
    const C_EBULLET  = 0xFF0000;
    const C_RING     = 0xFF5500;
    const C_PARTICLE = 0xFFFFFF;

    const LEVELS = [
        { name:"SECTOR A", enemies:3,  hpMul:1,   spdMul:1,   shootRate:2.8, patterns:["aimed"] },
        { name:"SECTOR B", enemies:4,  hpMul:1.2, spdMul:1.1, shootRate:2.4, patterns:["aimed","burst"] },
        { name:"SECTOR C", enemies:5,  hpMul:1.4, spdMul:1.2, shootRate:2.0, patterns:["aimed","burst","ring"] },
        { name:"SECTOR D", enemies:5,  hpMul:1.7, spdMul:1.3, shootRate:1.8, patterns:["aimed","burst","ring"] },
        { name:"SECTOR E", enemies:6,  hpMul:2.0, spdMul:1.4, shootRate:1.6, patterns:["aimed","burst","ring","spiral"] },
        { name:"SECTOR F", enemies:7,  hpMul:2.3, spdMul:1.5, shootRate:1.4, patterns:["aimed","ring","spiral","wall"] },
        { name:"SECTOR G", enemies:8,  hpMul:2.8, spdMul:1.7, shootRate:1.2, patterns:["aimed","burst","ring","spiral","wall"] },
        { name:"SECTOR Ω", enemies:10, hpMul:3.5, spdMul:2.0, shootRate:1.0, patterns:["aimed","burst","ring","spiral","wall"] },
    ];

    /* ══════════════ STATE ══════════════ */
    let scene, camera, renderer, clock;
    let cameraPersp, cameraOrtho, dirLight, ambientLight;
    let is3D = true; // 3D Isometric View by default to wow the user!
    let playerMesh, playerPos = {x:0,z:0}, playerAngle = 0, playerHP = MAX_HP;
    let mazeGrid = null;
    let wallMeshes = [], floorMesh = null, gridGroup = null;
    let enemies = [], pBullets = [], eBullets = [], particles = [];
    let powerups = [], powerupTimer = 0;
    let playerUpgrade = "standard"; // "standard", "triple", or "heavy"
    let upgradeTimeRemaining = 0;
    let curLvl = 0, score = 0, invulnT = 0, shootT = 0;
    let active = false, paused = false, rafId = null;
    let isFS = false, sceneOK = false;
    let screenFlash = 0;
    let shakeAmount = 0;
    let glitchTimer = 0;      // glitch overlay timer
    let glitchIntensity = 0;  // 0-1
    let podQueue = [];        // queued pod dialogues
    let podTimer = 0;         // time remaining for current pod msg
    let podEl = null;         // pod DOM element
    let transitionEl = null;  // level transition DOM element
    let transitioning = false;
    const keys = {};
    let mouseDown = false;

    /* Shared geos & mats */
    let geoBullet, matPBullet, matEBullet, geoParticle, matHeavyBullet;
    let geoWallH, geoWallV, matWall;
    let geoPlayer;

    /* DOM */
    let canvas, overlay, hudHP, hudBar, hudScore, hudLvl, hudEnm, hudName, fsBtn, flashEl, muteBtn, viewBtn;
    let pauseMenu, pauseItems, pauseIdx = 0;
    let pauseWasActive = false;

    /* ══════════════ AUDIO MANAGER ══════════════ */
    const AudioManager = (function () {
        let ctx = null;
        let bgm = null;
        const sfxBuffers = {};
        let isMuted = false;
        let isInitialized = false;

        const sfxFiles = {
            player_shoot: 'YoRHaHackingGame/sound/sfx/player_shoot.wav',
            enemy_shoot: 'YoRHaHackingGame/sound/sfx/enemy_shoot.wav',
            player_hit: 'YoRHaHackingGame/sound/sfx/player_hit.wav',
            enemy_hit: 'YoRHaHackingGame/sound/sfx/enemy_hit.wav',
            enemy_explode: 'YoRHaHackingGame/sound/sfx/enemy_explode.wav',
            core_broken: 'YoRHaHackingGame/sound/sfx/core_broken.wav',
            player_explode: 'YoRHaHackingGame/sound/sfx/player_explode.wav',
            button_select: 'YoRHaHackingGame/sound/sfx/button_select.wav',
            button_enter: 'YoRHaHackingGame/sound/sfx/button_enter.wav',
            type: 'YoRHaHackingGame/sound/sfx/type.wav'
        };

        return {
            init: function () {
                if (isInitialized) return;

                // Persist mute state
                isMuted = localStorage.getItem('nh_muted') === 'true';
                this.updateMuteUI();

                // Create AudioContext
                const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                if (AudioContextClass) {
                    ctx = new AudioContextClass();
                }

                // Create BGM using HTML5 Audio (better for large streaming files)
                bgm = new Audio();
                bgm.src = 'YoRHaHackingGame/sound/bgm/Fortress_of_Lies.ogg';
                bgm.loop = true;
                bgm.volume = 0.4;
                bgm.muted = isMuted;

                // Pre-decode all SFX
                for (const name in sfxFiles) {
                    this.loadSFX(name, sfxFiles[name]);
                }

                // Interaction listener to resume audio context if suspended by browser autoplay policy
                const unlock = () => {
                    if (ctx && ctx.state === 'suspended') {
                        ctx.resume().then(removeUnlockListeners);
                    } else {
                        removeUnlockListeners();
                    }
                };
                const removeUnlockListeners = () => {
                    document.removeEventListener('click', unlock);
                    document.removeEventListener('keydown', unlock);
                };
                document.addEventListener('click', unlock);
                document.addEventListener('keydown', unlock);

                isInitialized = true;
            },

            loadSFX: function (name, path) {
                if (!ctx) return;
                fetch(path)
                    .then(response => response.arrayBuffer())
                    .then(arrayBuffer => {
                        return new Promise((resolve, reject) => {
                            ctx.decodeAudioData(arrayBuffer, resolve, reject);
                        });
                    })
                    .then(audioBuffer => {
                        sfxBuffers[name] = audioBuffer;
                    })
                    .catch(err => console.warn('[NH Audio] Failed to load/decode SFX:', path, err));
            },

            playBGM: function () {
                if (!bgm) return;
                bgm.muted = isMuted;
                bgm.play().catch(err => {
                    // Browser blocked autoplay; it will recover on interaction
                    console.log('[NH Audio] BGM playback waiting for user interaction:', err);
                });
            },

            stopBGM: function () {
                if (!bgm) return;
                bgm.pause();
                bgm.currentTime = 0;
            },

            resumeContext: function () {
                if (ctx && ctx.state === 'suspended') {
                    ctx.resume();
                }
            },
            playSFX: function (name) {
                if (isMuted || !ctx || !sfxBuffers[name]) return;

                if (ctx.state === 'suspended') {
                    ctx.resume();
                }

                const source = ctx.createBufferSource();
                source.buffer = sfxBuffers[name];

                // Playback speed and volume tweaks for realism
                const gainNode = ctx.createGain();
                gainNode.gain.value = name === 'player_shoot' ? 0.8 : (name === 'type' ? 0.6 : 1.5);

                source.connect(gainNode);
                gainNode.connect(ctx.destination);
                source.start(0);
            },

            toggleMute: function () {
                isMuted = !isMuted;
                localStorage.setItem('nh_muted', isMuted);
                if (bgm) {
                    bgm.muted = isMuted;
                }
                this.updateMuteUI();
            },

            updateMuteUI: function () {
                const btn = document.getElementById('nh-mute');
                if (btn) {
                    btn.textContent = isMuted ? '🔇' : '🔊';
                    btn.title = isMuted ? 'Activer le son (M)' : 'Couper le son (M)';
                }
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
        } else {
            // SECTOR D+: Fortress
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
            /* No fog */

            /* Dual Cameras */
            const aspect = 960/540;
            const sz = 10;
            cameraOrtho = new THREE.OrthographicCamera(-sz*aspect, sz*aspect, sz, -sz, 0.1, 100);
            cameraOrtho.position.set(MAZE_W*CELL/2, 30, MAZE_H*CELL/2);
            cameraOrtho.lookAt(MAZE_W*CELL/2, 0, MAZE_H*CELL/2);

            cameraPersp = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
            cameraPersp.position.set(MAZE_W*CELL/2, 7, MAZE_H*CELL/2 + 6);
            cameraPersp.lookAt(MAZE_W*CELL/2, 0.5, MAZE_H*CELL/2);

            // Set camera based on mode
            camera = is3D ? cameraPersp : cameraOrtho;

            renderer = new THREE.WebGLRenderer({canvas:canvas, antialias:true});
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            renderer.setSize(960, 540, false);
            
            // Enable high-fidelity soft shadow maps
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFSoftShadowMap;

            /* Cinematic 3D Lighting */
            ambientLight = new THREE.AmbientLight(0xFFFFFF, 0.6); // Soft overall ambient
            scene.add(ambientLight);

            dirLight = new THREE.DirectionalLight(0xFFFFFF, 0.85); // Direct shadow caster
            dirLight.position.set(MAZE_W*CELL/2, 20, MAZE_H*CELL/2 + 10);
            dirLight.castShadow = true;
            dirLight.shadow.mapSize.width = 2048;
            dirLight.shadow.mapSize.height = 2048;
            dirLight.shadow.camera.near = 0.5;
            dirLight.shadow.camera.far = 45;
            
            // Set orthographic shadow camera bounds to fit the hacking maze perfectly
            const d = 16;
            dirLight.shadow.camera.left = -d;
            dirLight.shadow.camera.right = d;
            dirLight.shadow.camera.top = d;
            dirLight.shadow.camera.bottom = -d;
            scene.add(dirLight);

            clock = new THREE.Clock();

            /* Texture Loader for 2.5D Sprites */
            const tl = new THREE.TextureLoader();
            const getTex = (p) => { const t = tl.load(p); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; return t; };
            const texPlayer = getTex('YoRHaHackingGame/sprites/player.png');
            const texPBullet = getTex('YoRHaHackingGame/sprites/player_bullet.png');
            const texEnemy = getTex('YoRHaHackingGame/sprites/enemy1_new.png');
            const texEBullet = getTex('YoRHaHackingGame/sprites/enemy_bullet1.png');
            const texBlockA = getTex('YoRHaHackingGame/sprites/block_A.png');
            const texCore = getTex('YoRHaHackingGame/sprites/enemy_type2.png');

            /* Shared resources */
            geoBullet  = new THREE.PlaneGeometry(0.24, 0.24);
            geoBullet.rotateX(-Math.PI/2);
            matPBullet = new THREE.MeshBasicMaterial({map: texPBullet, color: 0xFFFFFF, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide});
            matEBullet = new THREE.MeshBasicMaterial({map: texEBullet, color: 0xFFFFFF, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide});
            matHeavyBullet = new THREE.MeshBasicMaterial({color:0xFF9900}); 
            
            geoParticle= new THREE.PlaneGeometry(0.08, 0.08);
            geoParticle.rotateX(-Math.PI/2);

            geoWallH   = new THREE.BoxGeometry(CELL+0.15, 0.6, 0.15);
            geoWallV   = new THREE.BoxGeometry(0.15, 0.6, CELL+0.15);
            matWall    = new THREE.MeshLambertMaterial({color:C_WALL});

            geoPlayer = new THREE.PlaneGeometry(0.45, 0.45);
            geoPlayer.rotateX(-Math.PI/2);
            window._matPlayer = new THREE.MeshBasicMaterial({map: texPlayer, color: 0xFFFFFF, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide});
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
    }

    function buildMaze(){
        clearMaze();
        /* Floor */
        const fg = new THREE.PlaneGeometry(MAZE_W*CELL+20, MAZE_H*CELL+20);
        const fm = new THREE.MeshLambertMaterial({color:C_BG});
        floorMesh = new THREE.Mesh(fg, fm);
        floorMesh.rotation.x=-Math.PI/2;
        floorMesh.position.set(MAZE_W*CELL/2, -0.01, MAZE_H*CELL/2);
        floorMesh.receiveShadow = true;
        scene.add(floorMesh);

        /* Grid lines — bright white for the Nier look */
        gridGroup = new THREE.Group();
        const lineMat = new THREE.LineBasicMaterial({color:C_GRID, transparent:true, opacity:0.5});
        const lineMatDim = new THREE.LineBasicMaterial({color:C_GRIDDIM, transparent:true, opacity:0.3});
        for(let x=0;x<=MAZE_W;x++){
            const pts=[new THREE.Vector3(x*CELL,0.01,0),new THREE.Vector3(x*CELL,0.01,MAZE_H*CELL)];
            const g=new THREE.BufferGeometry().setFromPoints(pts);
            gridGroup.add(new THREE.Line(g, x%4===0?lineMat:lineMatDim));
        }
        for(let y=0;y<=MAZE_H;y++){
            const pts=[new THREE.Vector3(0,0.01,y*CELL),new THREE.Vector3(MAZE_W*CELL,0.01,y*CELL)];
            const g=new THREE.BufferGeometry().setFromPoints(pts);
            gridGroup.add(new THREE.Line(g, y%4===0?lineMat:lineMatDim));
        }
        scene.add(gridGroup);

        /* Walls — white blocks, flat lit */
        for(let y=0;y<MAZE_H;y++) for(let x=0;x<MAZE_W;x++){
            const c=mazeGrid[y][x], wx=x*CELL, wz=y*CELL;
            if(c.t){const m=new THREE.Mesh(geoWallH,matWall);m.position.set(wx+HALF,0.3,wz);m.castShadow=true;m.receiveShadow=true;scene.add(m);wallMeshes.push(m);}
            if(c.l){const m=new THREE.Mesh(geoWallV,matWall);m.position.set(wx,0.3,wz+HALF);m.castShadow=true;m.receiveShadow=true;scene.add(m);wallMeshes.push(m);}
            if(y===MAZE_H-1&&c.b){const m=new THREE.Mesh(geoWallH,matWall);m.position.set(wx+HALF,0.3,wz+CELL);m.castShadow=true;m.receiveShadow=true;scene.add(m);wallMeshes.push(m);}
            if(x===MAZE_W-1&&c.r){const m=new THREE.Mesh(geoWallV,matWall);m.position.set(wx+CELL,0.3,wz+HALF);m.castShadow=true;m.receiveShadow=true;scene.add(m);wallMeshes.push(m);}
        }

        /* Border */
        const bMat=new THREE.MeshLambertMaterial({color:0x808080});
        const bH=new THREE.BoxGeometry(MAZE_W*CELL+0.3,0.3,0.1);
        const bV=new THREE.BoxGeometry(0.1,0.3,MAZE_H*CELL+0.3);
        let m;
        m=new THREE.Mesh(bH,bMat);m.position.set(MAZE_W*CELL/2,0.15,-0.05);m.castShadow=true;m.receiveShadow=true;scene.add(m);wallMeshes.push(m);
        m=new THREE.Mesh(bH,bMat);m.position.set(MAZE_W*CELL/2,0.15,MAZE_H*CELL+0.05);m.castShadow=true;m.receiveShadow=true;scene.add(m);wallMeshes.push(m);
        m=new THREE.Mesh(bV,bMat);m.position.set(-0.05,0.15,MAZE_H*CELL/2);m.castShadow=true;m.receiveShadow=true;scene.add(m);wallMeshes.push(m);
        m=new THREE.Mesh(bV,bMat);m.position.set(MAZE_W*CELL+0.05,0.15,MAZE_H*CELL/2);m.castShadow=true;m.receiveShadow=true;scene.add(m);wallMeshes.push(m);
    }

    /* ══════════════ PLAYER ══════════════ */
    function createPlayer(){
        if(playerMesh)scene.remove(playerMesh);
        
        const group = new THREE.Group();
        const bodyMesh = new THREE.Mesh(geoPlayer, window._matPlayer);
        bodyMesh.position.y = 0.05;
        group.add(bodyMesh);

        // Core indicator
        const coreGeo = new THREE.PlaneGeometry(0.15, 0.15);
        coreGeo.rotateX(-Math.PI/2);
        const coreMat = new THREE.MeshBasicMaterial({color: 0xC4362B, transparent: true, opacity: 0.8});
        const coreMesh = new THREE.Mesh(coreGeo, coreMat);
        coreMesh.position.set(0, 0.06, 0);
        group.add(coreMesh);
        
        playerMesh = group;
        playerMesh.position.y = 0.15;
        scene.add(playerMesh);
    }

    /* ══════════════ ENEMIES ══════════════ */
    function mkEnemy(type){
        const g=new THREE.Group();
        if(type==="core"){
            const cg=new THREE.PlaneGeometry(0.65, 0.65);
            cg.rotateX(-Math.PI/2);
            const core=new THREE.Mesh(cg, window._matCore);
            core.position.y=0.06;
            g.add(core);
            g.userData.core=core;

            /* Nesting 3D orbital rings (Torus Geometry) tilting and spinning in 3D space */
            g.userData.rings = [];
            for(let i=0;i<3;i++){
                const rg=new THREE.TorusGeometry(0.32+i*0.14, 0.015, 8, 32);
                const rm=new THREE.MeshBasicMaterial({color:C_RING, transparent:true, opacity:0.6-i*0.15, side:THREE.DoubleSide});
                const ring=new THREE.Mesh(rg,rm);
                ring.rotation.x = Math.PI/2 + (Math.random()-0.5)*0.5; // randomize tilt
                ring.rotation.y = (Math.random()-0.5)*0.5;
                ring.position.y=0.05;
                g.add(ring);
                g.userData.rings.push(ring);
            }

            /* Orbiting core shield blocks (Sector B and above) */
            g.userData.shieldMeshes = [];
            if(curLvl >= 1){
                const shieldsGroup = new THREE.Group();
                shieldsGroup.position.y = 0.05;
                g.add(shieldsGroup);
                g.userData.shieldsGroup = shieldsGroup;

                // Sector B: 2 shields, Sector C: 3 shields, Sector D+: 4 shields
                const numShields = curLvl === 1 ? 2 : (curLvl === 2 ? 3 : 4);
                const R = 0.55;
                const shieldBoxGeo = new THREE.PlaneGeometry(0.25, 0.25);
                shieldBoxGeo.rotateX(-Math.PI/2);

                for(let i=0; i<numShields; i++){
                    const angle = (i / numShields) * Math.PI * 2;
                    const box = new THREE.Mesh(shieldBoxGeo, window._matBlock);
                    box.position.set(Math.cos(angle)*R, 0, Math.sin(angle)*R);
                    shieldsGroup.add(box);
                    g.userData.shieldMeshes.push({mesh: box, hp: 3, angle: angle});
                }
            }

            /* Orbiting visual muzzle points (Sector C and above) */
            if(curLvl >= 2){
                const muzzGroup = new THREE.Group();
                muzzGroup.position.y = 0.05;
                g.add(muzzGroup);
                g.userData.muzzGroup = muzzGroup;

                const muzzGeo = new THREE.PlaneGeometry(0.1, 0.1);
                muzzGeo.rotateX(-Math.PI/2);
                for(let i=0; i<4; i++){
                    const angle = (i / 4) * Math.PI * 2;
                    const muzz = new THREE.Mesh(muzzGeo, window._matBlock);
                    muzz.position.set(Math.cos(angle)*0.38, 0, Math.sin(angle)*0.38);
                    muzzGroup.add(muzz);
                }
            }
        } else {
            /* 2.5D Plane Enemy */
            const sg=new THREE.PlaneGeometry(0.4, 0.4);
            sg.rotateX(-Math.PI/2);
            const sq=new THREE.Mesh(sg, window._matEnemy);
            sq.position.y=0.06;
            g.add(sq);
            g.userData.core=sq;
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
        for(let i=0;i<cnt;i++){
            const type=i===0?"core":"square";
            const mesh=mkEnemy(type);
            const pos=c2w(cells[i].x,cells[i].y);
            mesh.position.set(pos.x,0,pos.z);
            scene.add(mesh);
            const hp=Math.round((type==="core"?15:8)*lvl.hpMul);
            enemies.push({mesh,type,hp,maxHp:hp,pos:{x:pos.x,z:pos.z},speed:(0.8+Math.random()*0.4)*lvl.spdMul,
                md:{x:0,z:0},mt:0,st:Math.random()*lvl.shootRate,sr:lvl.shootRate,
                pat:lvl.patterns[Math.floor(Math.random()*lvl.patterns.length)],pp:Math.random()*Math.PI*2});
        }
    }

    /* ══════════════ BULLETS ══════════════ */
    function mkBullet(x,z,angle,speed,isPlayer, damage=1, piercing=false){
        let mat=isPlayer?matPBullet:matEBullet;
        let scale = 1;
        if(isPlayer && playerUpgrade === "heavy"){
            mat = matHeavyBullet;
            scale = 1.8;
            damage = 2;
            piercing = true;
        }
        const m=new THREE.Mesh(geoBullet,mat);
        m.position.set(x,0.15,z);
        m.scale.set(scale, scale, scale);
        scene.add(m);
        const arr=isPlayer?pBullets:eBullets;
        arr.push({
            mesh:m,
            vx:Math.sin(angle)*speed,
            vz:-Math.cos(angle)*speed,
            life:3.5,
            damage: damage,
            piercing: piercing,
            piercedTargets: []
        });
    }

    /* ══════════════ PARTICLES ══════════════ */
    function spawnP(x,z,color,n){
        for(let i=0;i<n;i++){
            const mat=new THREE.MeshBasicMaterial({color,transparent:true,opacity:1});
            const m=new THREE.Mesh(geoParticle,mat);
            m.position.set(x,0.1+Math.random()*0.2,z);
            scene.add(m);
            const a=Math.random()*Math.PI*2, s=1+Math.random()*3;
            particles.push({mesh:m,mat,vx:Math.sin(a)*s,vy:0.5+Math.random()*1.5,vz:Math.cos(a)*s,life:0.3+Math.random()*0.3,ml:0.6});
        }
    }

    /* ══════════════ POWERUPS ══════════════ */
    function spawnPowerup(x, z){
        const g = new THREE.Group();
        g.position.set(x, 0.15, z);
        
        // Golden central floating octahedron
        const pg = new THREE.OctahedronGeometry(0.12, 0);
        const pm = new THREE.MeshBasicMaterial({color: 0xFFD700});
        const m = new THREE.Mesh(pg, pm);
        g.add(m);
        g.userData.coreMesh = m;

        // Wireframe glowing ring
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
        
        // Decay the player upgrade timer
        if(upgradeTimeRemaining > 0){
            upgradeTimeRemaining -= dt;
            if(upgradeTimeRemaining <= 0){
                upgradeTimeRemaining = 0;
                playerUpgrade = "standard";
                podSay("Subversion upgrade expired.", 3);
                
                // Reset ship core color if it was changed
                if(playerMesh) {
                    playerMesh.traverse(c => {
                        if(c.geometry && c.geometry.type === "SphereGeometry" && c.material) {
                            c.material.color.setHex(0xC4362B); // Reset to terminal red
                        }
                    });
                }
            }
        }

        for(let i = powerups.length - 1; i >= 0; i--){
            const p = powerups[i];
            p.life -= dt;

            if(p.life <= 0){
                scene.remove(p.mesh);
                p.mesh.traverse(c => {
                    if(c.geometry) c.geometry.dispose();
                    if(c.material) c.material.dispose();
                });
                powerups.splice(i, 1);
                continue;
            }

            // Bobbing and rotation animation
            const hover = Math.sin(time * 4.5 + p.pos.x * 3.0) * 0.04;
            p.mesh.position.y = 0.15 + hover;
            
            if(p.mesh.userData.coreMesh){
                p.mesh.userData.coreMesh.rotation.y += dt * 1.5;
                p.mesh.userData.coreMesh.rotation.z += dt * 0.8;
            }
            if(p.mesh.userData.ringMesh){
                p.mesh.userData.ringMesh.rotation.z -= dt * 2.0;
            }

            // Blinking when life is low
            if(p.life < 2.0){
                p.mesh.visible = Math.floor(p.life * 10) % 2 === 0;
            } else {
                p.mesh.visible = true;
            }

            // Check collision with player
            if(d2(playerPos.x, playerPos.z, p.pos.x, p.pos.z) < 0.4){
                scene.remove(p.mesh);
                p.mesh.traverse(c => {
                    if(c.geometry) c.geometry.dispose();
                    if(c.material) c.material.dispose();
                });
                powerups.splice(i, 1);

                AudioManager.playSFX('button_enter');
                triggerGlitch(0.5, 0.25);
                shake(0.2);
                flashScreen();

                playerUpgrade = Math.random() < 0.5 ? "triple" : "heavy";
                upgradeTimeRemaining = 7.0;

                const upgradeName = playerUpgrade === "triple" ? "TRIPLE-SPREAD FIRE" : "HEAVY PIERCING PLASMA";
                podSay(`Subversion module collected. Weapon subversion active: ${upgradeName}.`, 4);

                spawnDeathBurst(playerPos.x, playerPos.z, 0xFFD700, 10);

                if(playerMesh) {
                    playerMesh.traverse(c => {
                        if(c.geometry && c.geometry.type === "SphereGeometry" && c.material) {
                            c.material.color.setHex(0xFFD700); // Golden core
                        }
                    });
                }
                break;
            }
        }
    }

    /* ══════════════ COLLISION ══════════════ */
    function wallAt(wx,wz){
        if(!mazeGrid)return true;
        const cx=Math.floor(wx/CELL),cz=Math.floor(wz/CELL);
        if(cx<0||cx>=MAZE_W||cz<0||cz>=MAZE_H)return true;
        const lx=wx-cx*CELL,lz=wz-cz*CELL,c=mazeGrid[cz][cx],m=0.2;
        if(lz<m&&c.t)return true; if(lz>CELL-m&&c.b)return true;
        if(lx<m&&c.l)return true; if(lx>CELL-m&&c.r)return true;
        return false;
    }
    function d2(ax,az,bx,bz){const dx=ax-bx,dz=az-bz;return Math.sqrt(dx*dx+dz*dz);}

    /* ══════════════ ENEMY AI ══════════════ */
    function eShoot(e){
        AudioManager.playSFX('enemy_shoot');
        const ex=e.pos.x,ez=e.pos.z,a=Math.atan2(playerPos.x-ex,-(playerPos.z-ez));

        // Progressive multi-muzzle spiral pattern for Sector C and above cores!
        if(e.type === "core" && curLvl >= 2){
            const muzzRot = e.mesh.userData.muzzGroup ? e.mesh.userData.muzzGroup.rotation.y : 0;
            for(let i=0; i<4; i++){
                const angle = muzzRot + (i / 4) * Math.PI * 2;
                const mx = ex + Math.cos(angle) * 0.38;
                const mz = ez + Math.sin(angle) * 0.38;
                
                // Fire a stream of bullets outwards from the muzzle
                mkBullet(mx, mz, angle, ENEMY_BULLET_SPEED * 0.75, false);
            }
            return;
        }

        switch(e.pat){
            case"aimed":mkBullet(ex,ez,a,ENEMY_BULLET_SPEED,false);break;
            case"burst":for(let i=-1;i<=1;i++)mkBullet(ex,ez,a+i*0.15,ENEMY_BULLET_SPEED,false);break;
            case"ring":{const n=8+curLvl*2;for(let i=0;i<n;i++)mkBullet(ex,ez,(i/n)*Math.PI*2,ENEMY_BULLET_SPEED*0.65,false);break;}
            case"spiral":for(let i=0;i<5;i++)mkBullet(ex,ez,a+i*0.4,ENEMY_BULLET_SPEED*0.8,false);break;
            case"wall":{const p=a+Math.PI/2;for(let i=-3;i<=3;i++)mkBullet(ex+Math.sin(p)*i*0.35,ez-Math.cos(p)*i*0.35,a,ENEMY_BULLET_SPEED*0.55,false);break;}
        }
    }
    function updEnemies(dt){
        const time = clock ? clock.getElapsedTime() : 0;
        for(const e of enemies){
            e.pp+=dt*4;
            
            // Hover bobbing in 3D
            const hover = Math.sin(time * 3.5 + e.pos.x * 2.0) * 0.04;

            if(e.type==="core"){
                // Rotate core icosahedron on two axes
                if(e.mesh.userData.core){
                    e.mesh.userData.core.position.y = 0.25 + hover;
                    e.mesh.userData.core.rotation.y += dt * 0.8;
                }
                
                // Pulsate and bob orange dot
                if(e.mesh.userData.orangeDot){
                    e.mesh.userData.orangeDot.position.y = 0.25 + hover;
                    const s = 0.8 + Math.sin(e.pp * 2) * 0.2;
                    e.mesh.userData.orangeDot.scale.set(s,s,s);
                }

                // Spin orbital rings on separate tilts
                if(e.mesh.userData.rings){
                    e.mesh.userData.rings.forEach((ring, idx) => {
                        ring.position.y = 0.25 + hover;
                        ring.rotation.x += dt * (0.2 + idx * 0.15);
                        ring.rotation.y += dt * (0.35 - idx * 0.1);
                        const s = 1 + Math.sin(e.pp + idx * 0.5) * 0.05;
                        ring.scale.set(s,s,s);
                    });
                }

                // Animate progressive orbiting shield blocks (Sector B+)
                if(e.mesh.userData.shieldsGroup){
                    e.mesh.userData.shieldsGroup.position.y = 0.25 + hover;
                    e.mesh.userData.shieldsGroup.rotation.y += dt * 1.5;
                }

                // Animate progressive orbiting green muzzle points (Sector C+)
                if(e.mesh.userData.muzzGroup){
                    e.mesh.userData.muzzGroup.position.y = 0.25 + hover;
                    e.mesh.userData.muzzGroup.rotation.y -= dt * 2.2;
                }
            } else {
                // Bob and spin the square enemy cube
                if(e.mesh.userData.core){
                    e.mesh.userData.core.position.y = 0.22 + hover;
                    e.mesh.userData.core.rotation.y += dt * 1.4;
                }
            }
            /* Movement */
            e.mt-=dt;
            if(e.mt<=0){
                const tp=Math.atan2(playerPos.x-e.pos.x,-(playerPos.z-e.pos.z));
                if(Math.random()<0.6)e.md={x:Math.sin(tp),z:-Math.cos(tp)};
                else{const ra=Math.random()*Math.PI*2;e.md={x:Math.sin(ra),z:-Math.cos(ra)};}
                e.mt=0.5+Math.random()*1.5;
            }
            const nx=e.pos.x+e.md.x*e.speed*dt,nz=e.pos.z+e.md.z*e.speed*dt;
            if(!wallAt(nx,nz)){e.pos.x=nx;e.pos.z=nz;}else e.mt=0;
            e.mesh.position.set(e.pos.x,0,e.pos.z);
            /* Shoot */
            e.st-=dt;
            if(e.st<=0){eShoot(e);e.st=e.sr*(0.8+Math.random()*0.4);}
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
            // Reset canvas transform
            canvas.style.transform = "";
            return;
        }
        ov.style.opacity = "1";
        const g = glitchIntensity;

        // Distort the canvas itself — horizontal skew + shift
        if(Math.random() < 0.4 * g){
            const skewX = (Math.random() - 0.5) * 3 * g;
            const shiftX = (Math.random() - 0.5) * 8 * g;
            canvas.style.transform = `skewX(${skewX}deg) translateX(${shiftX}px)`;
        } else {
            canvas.style.transform = "";
        }

        let html = "";
        // Dark horizontal tear slices — visible on light background
        const slices = 4 + Math.floor(g * 10);
        for(let i = 0; i < slices; i++){
            const top = Math.random() * 100;
            const height = 1 + Math.random() * 20 * g;
            const shiftX = (Math.random() - 0.5) * 50 * g;
            // Use dark slices + chromatic aberration
            const r = Math.random() < 0.35 ? `rgba(255,0,0,${0.25*g})` : "transparent";
            const b = Math.random() < 0.35 ? `rgba(0,80,255,${0.25*g})` : "transparent";
            const dark = `rgba(0,0,0,${(0.03 + Math.random()*0.08)*g})`;
            html += `<div style="position:absolute;top:${top}%;left:0;right:0;height:${height}px;transform:translateX(${shiftX}px);background:linear-gradient(90deg,${r},transparent 15%,${dark} 40%,${dark} 60%,transparent 85%,${b});"></div>`;
        }
        // Chromatic aberration bars — red and blue offset blocks
        for(let i = 0; i < Math.floor(2 + g*3); i++){
            const top = Math.random() * 100;
            const height = 3 + Math.random() * 30 * g;
            const side = Math.random() < 0.5;
            html += `<div style="position:absolute;top:${top}%;${side?'left:0':'right:0'};width:${10+Math.random()*40*g}%;height:${height}px;background:${side?'rgba(255,0,0,0.08)':'rgba(0,80,255,0.08)'};"></div>`;
        }
        // Heavy scanline overlay
        html += `<div style="position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent 0px,transparent 2px,rgba(0,0,0,${0.12*g}) 2px,rgba(0,0,0,${0.12*g}) 4px);"></div>`;
        ov.innerHTML = html;
    }

    /* ── DEATH PARTICLES ── */
    function spawnDeathBurst(x, z, color, count){
        for(let i = 0; i < count; i++){
            const size = 0.12 + Math.random() * 0.22;
            const geo = new THREE.BoxGeometry(size, size, size);
            const mat = new THREE.MeshBasicMaterial({color, transparent:true, opacity:1});
            const m = new THREE.Mesh(geo, mat);
            m.position.set(x, 0.1 + Math.random() * 0.3, z);
            scene.add(m);
            const angle = Math.random() * Math.PI * 2;
            const speed = 3 + Math.random() * 8;
            particles.push({mesh:m, mat, vx:Math.sin(angle)*speed, vy:1.5+Math.random()*4, vz:Math.cos(angle)*speed, life:0.6+Math.random()*0.8, ml:1.4, rotSpeed:(Math.random()-0.5)*12});
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
        // Content appears with staggered animations
        el.innerHTML = `<div style="font-size:0.6rem;letter-spacing:0.5em;color:#888;text-transform:uppercase;margin-bottom:10px;opacity:0;animation:nhTransIn 0.3s 0.3s ease-out forwards;">HACKING COMPLETE</div><div style="font-size:2rem;letter-spacing:0.35em;color:#000;text-transform:uppercase;font-weight:bold;opacity:0;animation:nhTransIn 0.3s 0.5s ease-out forwards;">${name} CLEARED</div><div style="margin-top:18px;width:80px;height:2px;background:#C4362B;opacity:0;animation:nhTransIn 0.3s 0.7s ease-out forwards;"></div><div style="font-size:0.55rem;letter-spacing:0.2em;color:#999;margin-top:12px;opacity:0;animation:nhTransIn 0.3s 0.9s ease-out forwards;">INITIALIZING NEXT SECTOR...</div><style>@keyframes nhTransIn{0%{opacity:0;transform:translateX(-8px)}100%{opacity:1;transform:translateX(0)}}</style>`;
        // Scan line sweep element
        let scanLine = el.querySelector('.nh-scan-line');
        if(!scanLine){
            scanLine = document.createElement('div');
            scanLine.className = 'nh-scan-line';
            scanLine.style.cssText = 'position:absolute;left:0;right:0;height:3px;background:linear-gradient(90deg,transparent,rgba(196,54,43,0.6),rgba(196,54,43,0.9),rgba(196,54,43,0.6),transparent);box-shadow:0 0 15px rgba(196,54,43,0.4),0 0 30px rgba(196,54,43,0.2);z-index:1;pointer-events:none;';
            el.appendChild(scanLine);
        }
        // Phase 1: flash white + start scan line
        el.style.opacity = "1"; el.style.pointerEvents = "auto";
        scanLine.style.top = '-3px';
        scanLine.style.transition = 'top 1.2s ease-in-out';
        // Trigger scan line sweep
        requestAnimationFrame(function(){
            requestAnimationFrame(function(){
                scanLine.style.top = '100%';
            });
        });
        // Phase 2: fade out after scan completes
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
    const POD_TYPE_SPEED = 0.03; // seconds per character

    function podSay(msg, duration){
        podQueue.push({msg, duration: duration || 3});
        if(!podTimer && podQueue.length === 1) showNextPod();
    }
    function showNextPod(){
        if(podQueue.length === 0){ hidePod(); return; }
        const {msg, duration} = podQueue[0];
        podTimer = duration;
        podFullMsg = msg;
        podTypingIdx = 0;
        podTypingTimer = 0;
        if(!podEl){
            podEl = document.createElement("div"); podEl.id = "nh-pod";
            podEl.style.cssText = "position:absolute;top:6px;left:10px;right:10px;z-index:8;pointer-events:none;font-family:'Courier New',monospace;font-size:0.68rem;letter-spacing:0.06em;color:#AAA;background:rgba(10,10,10,0.88);border:1px solid #333;border-left:2px solid #C4362B;border-radius:2px;padding:8px 12px;opacity:0;transition:opacity 0.3s;line-height:1.6;";
            const canvasWrap = canvas ? canvas.parentElement : null;
            if(canvasWrap) canvasWrap.appendChild(podEl);
            else return;
        }
        // Start with just the label, text will be typed out
        podEl.innerHTML = `<span style="color:#C4362B;font-weight:bold;">Pod 042 :</span> <span class="nh-pod-text"></span><span class="nh-pod-cursor" style="display:inline-block;width:6px;height:12px;background:#C4362B;margin-left:2px;vertical-align:middle;animation:nhCursorBlink 0.6s step-end infinite;"></span>`;
        podEl.style.opacity = "1";
    }
    function hidePod(){
        if(podEl) podEl.style.opacity = "0";
    }
    function updPod(dt){
        if(podTimer > 0){
            podTimer -= dt;
            // Typing effect
            if(podTypingIdx < podFullMsg.length){
                podTypingTimer += dt;
                let typed = false;
                while(podTypingTimer >= POD_TYPE_SPEED && podTypingIdx < podFullMsg.length){
                    podTypingTimer -= POD_TYPE_SPEED;
                    podTypingIdx++;
                    typed = true;
                }
                if(typed) AudioManager.playSFX('type');
                const textEl = podEl ? podEl.querySelector('.nh-pod-text') : null;
                if(textEl) textEl.textContent = podFullMsg.substring(0, podTypingIdx);
            } else {
                // Typing complete — remove cursor
                const cursor = podEl ? podEl.querySelector('.nh-pod-cursor') : null;
                if(cursor) cursor.style.display = 'none';
            }
            if(podTimer <= 0){
                podTimer = 0;
                podQueue.shift();
                showNextPod();
            }
        }
    }

    /* ══════════════ UPDATE ══════════════ */
    function update(dt){
        if(!active||paused||!sceneOK)return;
        dt=Math.min(dt,0.05);

        /* Screen flash decay */
        if(screenFlash>0){screenFlash-=dt;if(flashEl)flashEl.style.opacity=Math.max(0,screenFlash/0.15*0.5).toString();}
        /* Shake decay */
        if(shakeAmount>0)shakeAmount*=0.9;
        if(shakeAmount<0.01)shakeAmount=0;
        /* Glitch decay */
        updGlitch(dt);
        /* Pod dialogue timer */
        updPod(dt);

        /* Camera selection & update */
        if (is3D) {
            camera = cameraPersp;
            
            // Third-person isometric offset
            const camDist = 5.5;
            const camHeight = 5.8;
            
            // Aiming bias: push camera slightly in the player's facing direction to feel incredibly premium!
            let biasX = 0, biasZ = 0;
            if (keys["ArrowUp"] || keys["KeyW"]) biasZ = -0.5;
            if (keys["ArrowDown"] || keys["KeyS"]) biasZ = 0.5;
            if (keys["ArrowLeft"] || keys["KeyA"]) biasX = -0.5;
            if (keys["ArrowRight"] || keys["KeyD"]) biasX = 0.5;
            
            const targetCamX = playerPos.x + biasX;
            const targetCamY = camHeight;
            const targetCamZ = playerPos.z + camDist + biasZ;

            // Smooth camera lag
            camera.position.x += (targetCamX - camera.position.x) * 0.08;
            camera.position.y += (targetCamY - camera.position.y) * 0.08;
            camera.position.z += (targetCamZ - camera.position.z) * 0.08;

            // Apply camera shake
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
        if(dx||dz){const l=Math.sqrt(dx*dx+dz*dz);dx/=l;dz/=l;
            const nx=playerPos.x+dx*PLAYER_SPEED*dt,nz=playerPos.z+dz*PLAYER_SPEED*dt;
            if(!wallAt(nx,playerPos.z))playerPos.x=nx;if(!wallAt(playerPos.x,nz))playerPos.z=nz;}

        /* Aim */
        let ax=0,az=0;
        if(keys["ArrowUp"])az=-1;if(keys["ArrowDown"])az=1;
        if(keys["ArrowLeft"])ax=-1;if(keys["ArrowRight"])ax=1;
        if(ax||az)playerAngle=Math.atan2(ax,-az);

        const time = clock.getElapsedTime();
        if (is3D) {
            playerMesh.position.set(playerPos.x, 0.15 + Math.sin(time * 4.5) * 0.03, playerPos.z);
        } else {
            playerMesh.position.set(playerPos.x, 0.05, playerPos.z);
        }
        playerMesh.rotation.y = -playerAngle;
        playerMesh.rotation.x = 0;
        playerMesh.rotation.z = 0;

        // Animate tactical ship thruster scale flicker and floating support pods
        if (playerMesh.userData.thruster) {
            playerMesh.userData.thruster.scale.z = 0.85 + Math.random() * 0.3;
        }
        if (playerMesh.userData.leftPod && playerMesh.userData.rightPod) {
            playerMesh.userData.leftPod.position.y = 0.08 + Math.sin(time * 5.5) * 0.04;
            playerMesh.userData.rightPod.position.y = 0.08 + Math.sin(time * 5.5 + Math.PI) * 0.04;
        }

        /* Invuln flash */
        if(invulnT>0){invulnT-=dt;playerMesh.visible=Math.floor(invulnT*12)%2===0;}
        else playerMesh.visible=true;

        /* Shoot */
        shootT-=dt;
        if(mouseDown&&shootT<=0){
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
            if(wallAt(b.mesh.position.x,b.mesh.position.z)||b.life<=0){
                if(b.life>0)spawnP(b.mesh.position.x,b.mesh.position.z,C_GRIDDIM,2);
                scene.remove(b.mesh);pBullets.splice(i,1);continue;}
            
            // Check shield block collisions (Sector B+ cores)
            let shieldHit = false;
            for(let j=enemies.length-1;j>=0;j--){
                const e=enemies[j];
                if(e.type === "core" && e.mesh.userData.shieldMeshes){
                    const shields = e.mesh.userData.shieldMeshes;
                    for(let k=shields.length-1; k>=0; k--){
                        const s = shields[k];
                        const shieldPos = new THREE.Vector3();
                        s.mesh.getWorldPosition(shieldPos);
                        
                        if(d2(b.mesh.position.x, b.mesh.position.z, shieldPos.x, shieldPos.z) < 0.22){
                            if(b.piercing && b.piercedTargets.includes(s.mesh.uuid)) {
                                continue;
                            }
                            
                            s.hp -= b.damage || 1;
                            spawnP(shieldPos.x, shieldPos.z, 0xC4362B, 3);
                            AudioManager.playSFX('enemy_hit');
                            
                            const originalColor = s.mesh.material.color.getHex();
                            s.mesh.material.color.setHex(0xFFFFFF);
                            setTimeout(()=>{
                                if(s.mesh && s.mesh.material) s.mesh.material.color.setHex(originalColor);
                            }, 60);

                            if(s.hp <= 0){
                                AudioManager.playSFX('enemy_explode');
                                spawnDeathBurst(shieldPos.x, shieldPos.z, 0x1A1A1A, 8);
                                spawnDeathBurst(shieldPos.x, shieldPos.z, 0xC4362B, 6);
                                spawnPowerup(shieldPos.x, shieldPos.z);
                                
                                if(e.mesh.userData.shieldsGroup){
                                    e.mesh.userData.shieldsGroup.remove(s.mesh);
                                }
                                s.mesh.traverse(c=>{if(c.geometry)c.geometry.dispose();if(c.material)c.material.dispose();});
                                shields.splice(k, 1);
                            }

                            if(!b.piercing){
                                scene.remove(b.mesh);
                                pBullets.splice(i, 1);
                                shieldHit = true;
                                break;
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
                if(d2(b.mesh.position.x,b.mesh.position.z,e.pos.x,e.pos.z)<0.4){
                    if(b.piercing && b.piercedTargets.includes(e.mesh.uuid)) {
                        continue;
                    }

                    e.hp -= b.damage || 1;
                    spawnP(e.pos.x,e.pos.z,C_PARTICLE,3);
                    AudioManager.playSFX('enemy_hit');
                    /* Flash core white on hit */
                    if(e.mesh.userData.core){e.mesh.userData.core.material.color.setHex(0xFFFFFF);setTimeout(()=>{if(e.mesh.userData.core)e.mesh.userData.core.material.color.setHex(C_ENEMY);},60);}
                    if(e.hp<=0){
                        if(e.type === "core"){
                            AudioManager.playSFX('core_broken');
                        } else {
                            AudioManager.playSFX('enemy_explode');
                        }
                        // Death burst — big explosion of particles
                        spawnDeathBurst(e.pos.x, e.pos.z, 0xFF6600, 20); // orange
                        spawnDeathBurst(e.pos.x, e.pos.z, 0x1A1A1A, 15); // dark (visible on light bg)
                        spawnDeathBurst(e.pos.x, e.pos.z, 0xFF0000, 8);  // red
                        spawnDeathBurst(e.pos.x, e.pos.z, 0xFFCC00, 6);  // yellow sparks
                        // Brief screen flash for kill
                        flashScreen();

                        const chance = e.type === "core" ? 1.0 : 0.25;
                        if(Math.random() < chance){
                            spawnPowerup(e.pos.x, e.pos.z);
                        }

                        scene.remove(e.mesh);e.mesh.traverse(c=>{if(c.geometry)c.geometry.dispose();if(c.material)c.material.dispose();});
                        score+=e.type==="core"?500:200;enemies.splice(j,1);
                        // Pod commentary on kills
                        const remaining = enemies.length; // already spliced
                        if(remaining === 1) podSay("One target remaining.", 2);
                        else if(remaining === 0 && curLvl < LEVELS.length - 1) podSay("Sector cleared. Proceeding to next area.", 3);
                    }
                    
                    if(!b.piercing){
                        scene.remove(b.mesh);pBullets.splice(i,1);hit=true;break;
                    } else {
                        b.piercedTargets.push(e.mesh.uuid);
                    }
                }
            }
            if(hit)continue;
        }

        /* Enemy bullets */
        for(let i=eBullets.length-1;i>=0;i--){
            const b=eBullets[i];b.mesh.position.x+=b.vx*dt;b.mesh.position.z+=b.vz*dt;b.life-=dt;
            if(wallAt(b.mesh.position.x,b.mesh.position.z)||b.life<=0){scene.remove(b.mesh);eBullets.splice(i,1);continue;}
            if(invulnT<=0&&d2(b.mesh.position.x,b.mesh.position.z,playerPos.x,playerPos.z)<0.3){
                playerHP-=10;invulnT=INVULN_T;
                spawnP(playerPos.x,playerPos.z,C_EBULLET,5);
                AudioManager.playSFX('player_hit');
                flashScreen(); shake(0.3);
                triggerGlitch(0.7, 0.4); // glitch on damage
                scene.remove(b.mesh);eBullets.splice(i,1);
                if(playerHP<=0){playerHP=0;gameOver();return;}
                // Low HP pod warning
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
            // Death particles have rotation
            if(p.rotSpeed) p.mesh.rotation.x+=p.rotSpeed*dt, p.mesh.rotation.z+=p.rotSpeed*0.7*dt;
            // Slow down death particles faster
            if(p.ml > 0.8){ p.vx *= 0.97; p.vz *= 0.97; }
            if(p.life<=0){scene.remove(p.mesh);p.mat.dispose();if(p.mesh.geometry)p.mesh.geometry.dispose();particles.splice(i,1);}
        }

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
        playerUpgrade = "standard";
        upgradeTimeRemaining = 0;
        playerMesh.position.set(playerPos.x,0.05,playerPos.z);playerMesh.rotation.z=0;playerMesh.visible=true;
        spawnEnemies();
        const cx=MAZE_W*CELL/2,cz=MAZE_H*CELL/2;
        camera.position.set(cx,30,cz);camera.lookAt(cx,0,cz);
        active=true;paused=false;hideOv();updHUD();
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
        triggerGlitch(1.0, 1.2);  // Longer, more intense glitch
        // Show glitched game over after dramatic delay
        setTimeout(function(){
            showGameOverNier();
        }, 600);
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
        pBullets.forEach(b=>{scene.remove(b.mesh);});pBullets=[];
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

        // Resize Orthographic Camera
        if (cameraOrtho) {
            const sz=10;
            cameraOrtho.left=-sz*aspect;cameraOrtho.right=sz*aspect;cameraOrtho.top=sz;cameraOrtho.bottom=-sz;
            cameraOrtho.updateProjectionMatrix();
        }

        // Resize Perspective Camera
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
        // Glitch overlay render (after Three.js render)
        renderGlitch();
    }

    /* ══════════════ PAUSE MENU ══════════════ */
    function togglePause(){
        if(!active && !paused) return; /* not in gameplay */
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
        /* Reset clock to avoid dt spike */
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
        
        // Trigger a satisfying glitch/camera shake on mode switch
        shake(0.12);
        triggerGlitch(0.18, 0.12);
        
        // Reforce projection adjustment
        resizeR();
    }

    function updateViewModeUI(){
        const btn = document.getElementById('nh-view');
        if (btn) {
            btn.textContent = is3D ? '3D' : '2D';
            btn.title = is3D ? 'Basculer 2D/3D (V)' : 'Basculer 2D/3D (V)';
        }
    }

    /* ══════════════ INPUT ══════════════ */
    function onKD(e){
        keys[e.code]=true;
        if(e.code==="KeyM"){e.preventDefault();AudioManager.toggleMute();return;}
        if(e.code==="KeyV"){e.preventDefault();toggleViewMode();return;}
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
                /* Mouse interaction for pause items */
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
            hidePauseMenu();
            podQueue=[];podTimer=0;podFullMsg='';podTypingIdx=0;podTypingTimer=0;hidePod();
            showOv("HACKING INITIATED","Breach the firewall — destroy all enemy cores","START",function(){startLvl();if(!rafId)animate();});
            // Initial pod dialogue
            setTimeout(function(){ podSay("Hacking module engaged. Destroy all enemy cores.", 3.5); }, 500);
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
        },
    };
})();
