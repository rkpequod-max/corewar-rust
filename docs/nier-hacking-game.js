/* ═══════════════════════════════════════════════════════════════════════
   NIER AUTOMATA HACKING MINI-GAME  —  Three.js Isometric Twin-Stick Shooter
   ═══════════════════════════════════════════════════════════════════════
   Faithful to the original Nier:Automata hacking sequences:
   • 3D isometric cube labyrinth
   • Twin-stick controls (WASD + mouse aim)
   • Spaceship player (not a cube!)
   • Multiple levels with increasing difficulty
   • Red / beige / black Nier palette
   • CRT scanline overlay
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    /* ── Only init when Nier theme is active ── */
    var gameInstance = null;
    var initialized = false;

    function isNierTheme() {
        return document.documentElement.getAttribute('data-theme') === 'nier';
    }

    /* ── PUBLIC: init / destroy hooks ── */
    window.NierHackGame = {
        init: function () {
            if (initialized) { gameInstance && gameInstance.show(); return; }
            initialized = true;
            gameInstance = new NierHackGame();
        },
        destroy: function () {
            if (gameInstance) gameInstance.hide();
        },
        toggle: function () {
            if (isNierTheme()) this.init(); else this.destroy();
        }
    };

    /* ═════════════════════════════════════════
       HELPERS
       ═════════════════════════════════════════ */

    /* Create a spaceship-shaped mesh (like Nier hacking avatar) */
    function createSpaceship(color, emissiveColor, scale) {
        var s = scale || 1;
        var group = new THREE.Group();

        /* Main body — elongated diamond/arrow shape */
        var bodyShape = new THREE.Shape();
        bodyShape.moveTo(0, 0.6 * s);        /* nose */
        bodyShape.lineTo(0.3 * s, -0.1 * s); /* right wing root */
        bodyShape.lineTo(0.5 * s, -0.5 * s); /* right wing tip */
        bodyShape.lineTo(0.1 * s, -0.3 * s); /* right inner */
        bodyShape.lineTo(0, -0.45 * s);       /* tail center */
        bodyShape.lineTo(-0.1 * s, -0.3 * s); /* left inner */
        bodyShape.lineTo(-0.5 * s, -0.5 * s); /* left wing tip */
        bodyShape.lineTo(-0.3 * s, -0.1 * s); /* left wing root */
        bodyShape.lineTo(0, 0.6 * s);          /* back to nose */

        var extrudeSettings = { depth: 0.15 * s, bevelEnabled: true, bevelThickness: 0.04 * s, bevelSize: 0.03 * s, bevelSegments: 2 };
        var bodyGeo = new THREE.ExtrudeGeometry(bodyShape, extrudeSettings);
        var bodyMat = new THREE.MeshStandardMaterial({
            color: color,
            emissive: emissiveColor || color,
            emissiveIntensity: 0.35,
            roughness: 0.3,
            metalness: 0.7
        });
        var bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
        bodyMesh.rotation.x = -Math.PI / 2;
        bodyMesh.position.y = 0.07 * s;
        bodyMesh.castShadow = true;
        group.add(bodyMesh);

        /* Engine glow */
        var glowGeo = new THREE.CircleGeometry(0.12 * s, 8);
        var glowMat = new THREE.MeshBasicMaterial({
            color: emissiveColor || color,
            transparent: true,
            opacity: 0.6,
            side: THREE.DoubleSide
        });
        var glow1 = new THREE.Mesh(glowGeo, glowMat);
        glow1.rotation.x = -Math.PI / 2;
        glow1.position.set(0.2 * s, 0.02, -0.35 * s);
        group.add(glow1);
        var glow2 = new THREE.Mesh(glowGeo, glowMat);
        glow2.rotation.x = -Math.PI / 2;
        glow2.position.set(-0.2 * s, 0.02, -0.35 * s);
        group.add(glow2);

        /* Ambient glow aura */
        var auraGeo = new THREE.PlaneGeometry(1.4 * s, 1.4 * s);
        var auraMat = new THREE.MeshBasicMaterial({
            color: emissiveColor || color,
            transparent: true,
            opacity: 0.08,
            side: THREE.DoubleSide
        });
        var aura = new THREE.Mesh(auraGeo, auraMat);
        aura.rotation.x = -Math.PI / 2;
        aura.position.y = 0.01;
        group.add(aura);

        return group;
    }

    /* Create enemy ship — different shape from player */
    function createEnemyShip(color, scale) {
        var s = scale || 1;
        var group = new THREE.Group();

        /* Enemy body — hexagonal angular shape */
        var bodyShape = new THREE.Shape();
        var sides = 6;
        var outerR = 0.35 * s;
        var innerR = 0.2 * s;
        for (var i = 0; i < sides; i++) {
            var angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
            var r = (i % 2 === 0) ? outerR : innerR;
            var px = Math.cos(angle) * r;
            var py = Math.sin(angle) * r;
            if (i === 0) bodyShape.moveTo(px, py);
            else bodyShape.lineTo(px, py);
        }
        bodyShape.closePath();

        var extrudeSettings = { depth: 0.12 * s, bevelEnabled: true, bevelThickness: 0.03 * s, bevelSize: 0.02 * s, bevelSegments: 1 };
        var bodyGeo = new THREE.ExtrudeGeometry(bodyShape, extrudeSettings);
        var bodyMat = new THREE.MeshStandardMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: 0.3,
            roughness: 0.4,
            metalness: 0.6
        });
        var bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
        bodyMesh.rotation.x = -Math.PI / 2;
        bodyMesh.position.y = 0.06 * s;
        bodyMesh.castShadow = true;
        group.add(bodyMesh);

        /* Spinning ring around enemy */
        var ringGeo = new THREE.TorusGeometry(0.4 * s, 0.03 * s, 6, 16);
        var ringMat = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.4
        });
        var ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.15 * s;
        group.add(ring);
        group.userData.ring = ring;

        return group;
    }

    /* ═════════════════════════════════════════
       LEVEL CONFIGURATIONS
       ═════════════════════════════════════════ */
    var LEVEL_CONFIGS = [
        /* Level 1 — intro, small maze */
        { grid: 13, enemies: 4,  pickups: 2, wallH: 2.0, extraOpenings: 0.35, enemyHP: 2, enemySpeed: 0.02, enemyShootRate: 80, name: 'SECTOR A' },
        /* Level 2 — more enemies */
        { grid: 15, enemies: 6,  pickups: 2, wallH: 2.5, extraOpenings: 0.30, enemyHP: 3, enemySpeed: 0.025, enemyShootRate: 70, name: 'SECTOR B' },
        /* Level 3 — larger maze */
        { grid: 17, enemies: 8,  pickups: 3, wallH: 2.5, extraOpenings: 0.28, enemyHP: 3, enemySpeed: 0.03, enemyShootRate: 60, name: 'SECTOR C' },
        /* Level 4 — tall walls, faster enemies */
        { grid: 17, enemies: 10, pickups: 3, wallH: 3.0, extraOpenings: 0.25, enemyHP: 4, enemySpeed: 0.035, enemyShootRate: 55, name: 'SECTOR D' },
        /* Level 5 — dense */
        { grid: 19, enemies: 12, pickups: 3, wallH: 3.0, extraOpenings: 0.22, enemyHP: 4, enemySpeed: 0.04, enemyShootRate: 50, name: 'SECTOR E' },
        /* Level 6 — nightmare */
        { grid: 19, enemies: 14, pickups: 4, wallH: 3.5, extraOpenings: 0.20, enemyHP: 5, enemySpeed: 0.04, enemyShootRate: 45, name: 'SECTOR F' },
        /* Level 7+ — procedural scaling */
        { grid: 21, enemies: 16, pickups: 4, wallH: 3.5, extraOpenings: 0.18, enemyHP: 6, enemySpeed: 0.045, enemyShootRate: 40, name: 'DEEP CORE' }
    ];

    function getLevelConfig(level) {
        var idx = Math.min(level - 1, LEVEL_CONFIGS.length - 1);
        var cfg = Object.assign({}, LEVEL_CONFIGS[idx]);
        /* For levels beyond 7, keep scaling */
        if (level > LEVEL_CONFIGS.length) {
            cfg.enemies += (level - LEVEL_CONFIGS.length) * 2;
            cfg.enemyHP += (level - LEVEL_CONFIGS.length);
            cfg.enemySpeed += (level - LEVEL_CONFIGS.length) * 0.005;
            cfg.grid = Math.min(cfg.grid + Math.floor((level - LEVEL_CONFIGS.length) / 2), 25);
            cfg.name = 'FIREWALL ' + level;
        }
        return cfg;
    }

    /* ═════════════════════════════════════════
       GAME CLASS
       ═════════════════════════════════════════ */
    function NierHackGame() {
        this.canvas = document.getElementById('nier-hack-canvas');
        this.section = document.getElementById('nier-hack-section');
        if (!this.canvas) return;

        /* ── State ── */
        this.running = false;
        this.paused = false;
        this.health = 100;
        this.score = 0;
        this.level = 1;
        this.maxLevels = 7;   /* can go beyond, but this is the "story" set */
        this.enemiesKilled = 0;
        this.enemiesToKill = 0;
        this.totalEnemiesKilled = 0;
        this.keys = {};
        this.mouse = { x: 0, y: 0 };
        this.shootCooldown = 0;
        this.damageFlash = 0;
        this.playerBullets = [];
        this.enemyBullets = [];
        this.enemies = [];
        this.particles = [];
        this.gridWalls = [];
        this.pickups = [];
        this._aimDir = new THREE.Vector3(0, 0, -1);

        /* ── Three.js setup ── */
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.playerMesh = null;
        this.playerShip = null;
        this.clock = null;
        this.groundMesh = null;
        this.gridHelper = null;

        this._setupThree();
        this._buildLevel();
        this._setupInput();
        this._updateHUD();

        /* Show start overlay */
        this._showOverlay('start');

        /* Start loop */
        this.running = true;
        this.clock = new THREE.Clock();
        this._loop();
    }

    /* ────────────────────────────────────────────
       THREE.JS SETUP
       ──────────────────────────────────────────── */
    NierHackGame.prototype._setupThree = function () {
        var W = this.canvas.clientWidth || 960;
        var H = this.canvas.clientHeight || 540;

        /* Scene */
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1A1A1A);
        this.scene.fog = new THREE.FogExp2(0x1A1A1A, 0.015);

        /* Isometric camera */
        var aspect = W / H;
        var d = 14;
        this.camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 0.1, 200);
        this.camera.position.set(20, 20, 20);
        this.camera.lookAt(0, 0, 0);

        /* Renderer */
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setSize(W, H);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        /* Lights */
        var ambient = new THREE.AmbientLight(0xD4CFC6, 0.4);
        this.scene.add(ambient);

        var dirLight = new THREE.DirectionalLight(0xF5F0E8, 0.8);
        dirLight.position.set(10, 20, 10);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.set(1024, 1024);
        dirLight.shadow.camera.near = 1;
        dirLight.shadow.camera.far = 60;
        dirLight.shadow.camera.left = -25;
        dirLight.shadow.camera.right = 25;
        dirLight.shadow.camera.top = 25;
        dirLight.shadow.camera.bottom = -25;
        this.scene.add(dirLight);

        /* Subtle red point light that follows player later */
        this.redLight = new THREE.PointLight(0xC4362B, 0.4, 30);
        this.redLight.position.set(0, 6, 0);
        this.scene.add(this.redLight);

        /* Ground plane */
        var groundGeo = new THREE.PlaneGeometry(60, 60);
        var groundMat = new THREE.MeshStandardMaterial({
            color: 0x222222,
            roughness: 0.9,
            metalness: 0.1
        });
        this.groundMesh = new THREE.Mesh(groundGeo, groundMat);
        this.groundMesh.rotation.x = -Math.PI / 2;
        this.groundMesh.receiveShadow = true;
        this.scene.add(this.groundMesh);

        /* Grid lines on ground */
        this.gridHelper = new THREE.GridHelper(60, 60, 0x333333, 0x2A2A2A);
        this.gridHelper.position.y = 0.01;
        this.scene.add(this.gridHelper);

        /* Resize handler */
        var self = this;
        this._resizeHandler = function () {
            var w = self.canvas.clientWidth;
            var h = self.canvas.clientHeight;
            if (w === 0 || h === 0) return;
            var asp = w / h;
            var d2 = 14;
            self.camera.left = -d2 * asp;
            self.camera.right = d2 * asp;
            self.camera.top = d2;
            self.camera.bottom = -d2;
            self.camera.updateProjectionMatrix();
            self.renderer.setSize(w, h);
        };
        window.addEventListener('resize', this._resizeHandler);
    };

    /* ────────────────────────────────────────────
       LEVEL GENERATION
       ──────────────────────────────────────────── */
    NierHackGame.prototype._buildLevel = function () {
        var self = this;
        var cfg = getLevelConfig(this.level);

        /* Clear old objects */
        this.gridWalls.forEach(function (w) { self.scene.remove(w); });
        this.gridWalls = [];
        this.enemies.forEach(function (e) { self.scene.remove(e.mesh); });
        this.enemies = [];
        this.pickups.forEach(function (p) { self.scene.remove(p.mesh); });
        this.pickups = [];
        this.playerBullets.forEach(function (b) { self.scene.remove(b.mesh); });
        this.playerBullets = [];
        this.enemyBullets.forEach(function (b) { self.scene.remove(b.mesh); });
        this.enemyBullets = [];
        this.particles.forEach(function (p) { self.scene.remove(p.mesh); });
        this.particles = [];

        if (this.playerShip) { this.scene.remove(this.playerShip); this.playerShip = null; }

        var GRID = cfg.grid;

        /* Maze grid: 1 = wall, 0 = open */
        var maze = [];
        for (var y = 0; y < GRID; y++) {
            maze[y] = [];
            for (var x = 0; x < GRID; x++) {
                if (x === 0 || y === 0 || x === GRID - 1 || y === GRID - 1) {
                    maze[y][x] = 1;
                } else {
                    maze[y][x] = 1; /* start all as wall, DFS carves paths */
                }
            }
        }

        /* Generate maze with DFS */
        var visited = [];
        for (var vy = 0; vy < GRID; vy++) {
            visited[vy] = [];
            for (var vx = 0; vx < GRID; vx++) visited[vy][vx] = false;
        }
        function carve(cx, cy) {
            visited[cy][cx] = true;
            maze[cy][cx] = 0;
            var dirs = [[0, -2], [0, 2], [-2, 0], [2, 0]];
            for (var i = dirs.length - 1; i > 0; i--) {
                var j = Math.floor(Math.random() * (i + 1));
                var tmp = dirs[i]; dirs[i] = dirs[j]; dirs[j] = tmp;
            }
            for (var d = 0; d < dirs.length; d++) {
                var nx = cx + dirs[d][0];
                var ny = cy + dirs[d][1];
                if (nx > 0 && nx < GRID - 1 && ny > 0 && ny < GRID - 1 && !visited[ny][nx]) {
                    maze[cy + dirs[d][1] / 2][cx + dirs[d][0] / 2] = 0;
                    carve(nx, ny);
                }
            }
        }
        carve(1, 1);

        /* Extra openings for gameplay */
        for (var ey = 2; ey < GRID - 2; ey++) {
            for (var ex = 2; ex < GRID - 2; ex++) {
                if (maze[ey][ex] === 1 && Math.random() < cfg.extraOpenings) {
                    maze[ey][ex] = 0;
                }
            }
        }

        /* Ensure start area is clear */
        maze[1][1] = 0; maze[1][2] = 0; maze[2][1] = 0;

        /* Build wall meshes */
        var wallGeo = new THREE.BoxGeometry(2, cfg.wallH, 2);
        var wallMatDark = new THREE.MeshStandardMaterial({
            color: 0x2A2A2A,
            roughness: 0.7,
            metalness: 0.3
        });
        var wallMatLight = new THREE.MeshStandardMaterial({
            color: 0x353535,
            roughness: 0.6,
            metalness: 0.4
        });
        var wallMatRed = new THREE.MeshStandardMaterial({
            color: 0x3A2020,
            emissive: 0xC4362B,
            emissiveIntensity: 0.05,
            roughness: 0.6,
            metalness: 0.3
        });

        for (var wy = 0; wy < GRID; wy++) {
            for (var wx = 0; wx < GRID; wx++) {
                if (maze[wy][wx] === 1) {
                    var rnd = Math.random();
                    var mat = rnd < 0.10 ? wallMatRed : (rnd < 0.30 ? wallMatLight : wallMatDark);
                    var wall = new THREE.Mesh(wallGeo, mat);
                    wall.position.set(wx * 2 - GRID, cfg.wallH / 2, wy * 2 - GRID);
                    wall.castShadow = true;
                    wall.receiveShadow = true;
                    this.scene.add(wall);
                    this.gridWalls.push(wall);
                }
            }
        }

        /* Store maze for collision */
        this.maze = maze;
        this.mazeGridSize = GRID;
        this.wallHeight = cfg.wallH;

        /* ── Player Ship ── */
        this.playerShip = createSpaceship(0xC4362B, 0xC4362B, 1.2);
        this.playerShip.position.set(1 * 2 - GRID, 0.5, 1 * 2 - GRID);
        this.scene.add(this.playerShip);

        /* Player mesh reference for collision (invisible) */
        if (this.playerMesh) this.scene.remove(this.playerMesh);
        this.playerMesh = new THREE.Object3D();
        this.playerMesh.position.copy(this.playerShip.position);
        this.scene.add(this.playerMesh);

        /* ── Enemies ── */
        this.enemiesKilled = 0;
        this.enemiesToKill = cfg.enemies;
        this._spawnEnemies(cfg);

        /* ── Pickups ── */
        this._spawnPickups(cfg.pickups);

        /* Adjust ground to maze size */
        var mazeWorldSize = GRID * 2 + 4;
        this.groundMesh.scale.set(mazeWorldSize / 60, mazeWorldSize / 60, 1);
        this.gridHelper.scale.set(mazeWorldSize / 60, 1, mazeWorldSize / 60);

        /* Update level name in HUD */
        var nameEl = document.getElementById('nh-level-name');
        if (nameEl) nameEl.textContent = cfg.name;
    };

    NierHackGame.prototype._spawnEnemies = function (cfg) {
        var GRID = this.mazeGridSize;
        var spawned = 0;
        var attempts = 0;
        while (spawned < cfg.enemies && attempts < 300) {
            attempts++;
            var ex = Math.floor(Math.random() * (GRID - 4)) + 2;
            var ey = Math.floor(Math.random() * (GRID - 4)) + 2;
            if (this.maze[ey][ex] !== 0) continue;

            /* Don't spawn too close to player */
            var px = Math.round((this.playerShip.position.x + GRID) / 2);
            var py = Math.round((this.playerShip.position.z + GRID) / 2);
            if (Math.abs(ex - px) + Math.abs(ey - py) < 5) continue;

            /* Don't spawn on existing enemy */
            var tooClose = false;
            for (var ei = 0; ei < this.enemies.length; ei++) {
                var ePos = this.enemies[ei].mesh.position;
                if (Math.abs(ePos.x - (ex * 2 - GRID)) < 2 && Math.abs(ePos.z - (ey * 2 - GRID)) < 2) {
                    tooClose = true; break;
                }
            }
            if (tooClose) continue;

            /* Create enemy ship */
            var enemyColor = Math.random() < 0.3 ? 0x3A6EA5 : (Math.random() < 0.5 ? 0x4A7C59 : 0x7B5EA7);
            var enemyGroup = createEnemyShip(enemyColor, 1.0);
            enemyGroup.position.set(ex * 2 - GRID, 0.5, ey * 2 - GRID);
            this.scene.add(enemyGroup);

            this.enemies.push({
                mesh: enemyGroup,
                color: enemyColor,
                hp: cfg.enemyHP,
                shootTimer: Math.random() * cfg.enemyShootRate + 30,
                moveTimer: 0,
                moveDir: { x: 0, z: 0 },
                speed: cfg.enemySpeed + Math.random() * 0.015,
                shootRate: cfg.enemyShootRate,
                type: Math.random() < 0.2 ? 'chaser' : 'patrol'
            });
            spawned++;
        }
    };

    NierHackGame.prototype._spawnPickups = function (count) {
        var GRID = this.mazeGridSize;
        for (var i = 0; i < count; i++) {
            var attempts = 0;
            while (attempts < 80) {
                attempts++;
                var px = Math.floor(Math.random() * (GRID - 2)) + 1;
                var py = Math.floor(Math.random() * (GRID - 2)) + 1;
                if (this.maze[py][px] !== 0) continue;

                var pickGeo = new THREE.OctahedronGeometry(0.3, 0);
                var pickMat = new THREE.MeshStandardMaterial({
                    color: 0x4A7C59,
                    emissive: 0x4A7C59,
                    emissiveIntensity: 0.5,
                    roughness: 0.2,
                    metalness: 0.8
                });
                var pickMesh = new THREE.Mesh(pickGeo, pickMat);
                pickMesh.position.set(px * 2 - GRID, 0.5, py * 2 - GRID);
                pickMesh.castShadow = true;
                this.scene.add(pickMesh);
                this.pickups.push({ mesh: pickMesh, heal: 25 });
                break;
            }
        }
    };

    /* ────────────────────────────────────────────
       INPUT
       ──────────────────────────────────────────── */
    NierHackGame.prototype._setupInput = function () {
        var self = this;
        this._keyDown = function (e) {
            /* Prevent default for game keys when game is active */
            var k = e.key.toLowerCase();
            if (['w','a','s','d','z','q','arrowup','arrowdown','arrowleft','arrowright'].indexOf(k) >= 0) {
                if (self.running && !self.paused) e.preventDefault();
            }
            self.keys[k] = true;
        };
        this._keyUp = function (e) { self.keys[e.key.toLowerCase()] = false; };
        this._mouseMove = function (e) {
            var rect = self.canvas.getBoundingClientRect();
            self.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            self.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        };
        this._mouseDown = function (e) { if (e.button === 0) self.keys['mouse0'] = true; };
        this._mouseUp = function (e) { if (e.button === 0) self.keys['mouse0'] = false; };
        document.addEventListener('keydown', this._keyDown);
        document.addEventListener('keyup', this._keyUp);
        this.canvas.addEventListener('mousemove', this._mouseMove);
        this.canvas.addEventListener('mousedown', this._mouseDown);
        this.canvas.addEventListener('mouseup', this._mouseUp);
        this.canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    };

    NierHackGame.prototype._removeInput = function () {
        document.removeEventListener('keydown', this._keyDown);
        document.removeEventListener('keyup', this._keyUp);
        this.canvas.removeEventListener('mousemove', this._mouseMove);
        this.canvas.removeEventListener('mousedown', this._mouseDown);
        this.canvas.removeEventListener('mouseup', this._mouseUp);
    };

    /* ────────────────────────────────────────────
       COLLISION
       ──────────────────────────────────────────── */
    NierHackGame.prototype._isWall = function (wx, wz) {
        var GRID = this.mazeGridSize;
        var gx = Math.round((wx + GRID) / 2);
        var gz = Math.round((wz + GRID) / 2);
        if (gx < 0 || gz < 0 || gx >= GRID || gz >= GRID) return true;
        return this.maze[gz][gx] === 1;
    };

    NierHackGame.prototype._checkBulletWallHit = function (pos) {
        var GRID = this.mazeGridSize;
        var gx = Math.round((pos.x + GRID) / 2);
        var gz = Math.round((pos.z + GRID) / 2);
        if (gx < 0 || gz < 0 || gx >= GRID || gz >= GRID) return true;
        return this.maze[gz][gx] === 1;
    };

    /* ────────────────────────────────────────────
       SHOOTING
       ──────────────────────────────────────────── */
    NierHackGame.prototype._playerShoot = function () {
        if (this.shootCooldown > 0) return;
        this.shootCooldown = 7;

        var pos = this.playerShip.position.clone();
        pos.y = 0.5;

        /* Use aim direction from mouse */
        var dir = this._aimDir.clone();
        if (dir.length() < 0.01) dir.set(0, 0, -1);

        var bulletGeo = new THREE.ConeGeometry(0.06, 0.35, 4);
        var bulletMat = new THREE.MeshBasicMaterial({ color: 0xC4362B });
        var bullet = new THREE.Mesh(bulletGeo, bulletMat);
        bullet.position.copy(pos);
        /* Orient cone along direction */
        var up = new THREE.Vector3(0, 1, 0);
        var quat = new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize());
        bullet.quaternion.copy(quat);
        this.scene.add(bullet);

        this.playerBullets.push({
            mesh: bullet,
            dir: dir.clone().normalize(),
            speed: 0.45,
            life: 100
        });
    };

    NierHackGame.prototype._enemyShoot = function (enemy) {
        var pos = enemy.mesh.position.clone();
        pos.y = 0.5;
        var dir = this.playerShip.position.clone().sub(pos);
        dir.y = 0;
        dir.normalize();

        /* Some enemies shoot burst patterns */
        var bullets = [dir];
        if (this.level >= 3 && Math.random() < 0.25) {
            /* Spread shot */
            var angle = Math.atan2(dir.z, dir.x);
            bullets.push(new THREE.Vector3(Math.cos(angle + 0.2), 0, Math.sin(angle + 0.2)).normalize());
            bullets.push(new THREE.Vector3(Math.cos(angle - 0.2), 0, Math.sin(angle - 0.2)).normalize());
        }

        for (var b = 0; b < bullets.length; b++) {
            var bulletGeo = new THREE.SphereGeometry(0.08, 4, 4);
            var bulletMat = new THREE.MeshBasicMaterial({ color: enemy.color || 0x3A6EA5 });
            var bullet = new THREE.Mesh(bulletGeo, bulletMat);
            bullet.position.copy(pos);
            this.scene.add(bullet);

            this.enemyBullets.push({
                mesh: bullet,
                dir: bullets[b],
                speed: 0.18 + this.level * 0.015,
                life: 160
            });
        }
    };

    /* ────────────────────────────────────────────
       PARTICLES
       ──────────────────────────────────────────── */
    NierHackGame.prototype._spawnParticles = function (position, color, count) {
        for (var i = 0; i < count; i++) {
            var size = 0.04 + Math.random() * 0.12;
            var geo = new THREE.BoxGeometry(size, size, size);
            var mat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 1 });
            var mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(position);
            this.scene.add(mesh);
            this.particles.push({
                mesh: mesh,
                vel: new THREE.Vector3(
                    (Math.random() - 0.5) * 0.2,
                    Math.random() * 0.15 + 0.05,
                    (Math.random() - 0.5) * 0.2
                ),
                life: 25 + Math.random() * 25
            });
        }
    };

    /* ────────────────────────────────────────────
       HUD UPDATE
       ──────────────────────────────────────────── */
    NierHackGame.prototype._updateHUD = function () {
        var healthEl = document.getElementById('nh-health');
        var healthBarEl = document.getElementById('nh-health-bar');
        var scoreEl = document.getElementById('nh-score');
        var levelEl = document.getElementById('nh-level');
        var enemiesEl = document.getElementById('nh-enemies');

        if (healthEl) healthEl.textContent = Math.max(0, Math.round(this.health)) + '%';
        if (healthBarEl) healthBarEl.style.width = Math.max(0, this.health) + '%';
        if (scoreEl) scoreEl.textContent = this.score;
        if (levelEl) levelEl.textContent = this.level + ' / ' + this.maxLevels + '+';
        if (enemiesEl) enemiesEl.textContent = this.enemies.length;
    };

    /* ────────────────────────────────────────────
       OVERLAY SCREENS
       ──────────────────────────────────────────── */
    NierHackGame.prototype._showOverlay = function (type) {
        var overlay = document.getElementById('nier-hack-overlay');
        if (!overlay) return;
        overlay.classList.remove('hidden');
        overlay.innerHTML = '';

        var self = this;
        var cfg = getLevelConfig(this.level);

        if (type === 'start') {
            overlay.innerHTML =
                '<h2>HACKING</h2>' +
                '<div class="sub">Infiltrate the system. Destroy all targets.<br>' + cfg.name + ' — ' + cfg.enemies + ' hostiles detected.</div>' +
                '<button class="nier-btn" id="btn-engage">ENGAGE</button>';
            document.getElementById('btn-engage').onclick = function () {
                overlay.classList.add('hidden');
                self.running = true;
            };
        } else if (type === 'gameover') {
            overlay.innerHTML =
                '<h2>CONNECTION LOST</h2>' +
                '<div class="sub">System intrusion failed at ' + cfg.name + '.</div>' +
                '<div class="score-display">' + self.score + '</div>' +
                '<div class="sub">Enemies destroyed: ' + self.totalEnemiesKilled + '</div>' +
                '<button class="nier-btn" id="btn-retry">RETRY</button>';
            document.getElementById('btn-retry').onclick = function () {
                self._restart();
            };
        } else if (type === 'levelclear') {
            var isFinal = self.level >= self.maxLevels;
            var title = isFinal ? 'SYSTEM BREACHED' : 'HACK COMPLETE';
            var subtitle = isFinal
                ? 'All firewalls neutralized. You are inside.'
                : cfg.name + ' cleared. Prepare for next sector.';
            overlay.innerHTML =
                '<h2>' + title + '</h2>' +
                '<div class="sub">' + subtitle + '</div>' +
                '<div class="score-display">' + self.score + '</div>' +
                '<button class="nier-btn" id="btn-next">' + (isFinal ? 'PLAY AGAIN' : 'NEXT LEVEL') + '</button>';
            document.getElementById('btn-next').onclick = function () {
                if (isFinal) {
                    self._restart();
                } else {
                    self.level++;
                    self.health = Math.min(100, self.health + 30);
                    self._buildLevel();
                    self._updateHUD();
                    overlay.classList.add('hidden');
                    self.running = true;
                }
            };
        }
    };

    NierHackGame.prototype._restart = function () {
        this.health = 100;
        this.score = 0;
        this.level = 1;
        this.totalEnemiesKilled = 0;
        this._buildLevel();
        this._updateHUD();
        this._showOverlay('start');
    };

    /* ────────────────────────────────────────────
       GAME LOOP
       ──────────────────────────────────────────── */
    NierHackGame.prototype._loop = function () {
        var self = this;
        requestAnimationFrame(function () { self._loop(); });

        if (!this.running) return;

        /* Check overlay is visible (paused) */
        var overlay = document.getElementById('nier-hack-overlay');
        if (overlay && !overlay.classList.contains('hidden')) {
            /* Still render for visual, but skip game logic */
            this._updateVisuals();
            this.renderer.render(this.scene, this.camera);
            return;
        }

        var dt = this.clock.getDelta();

        /* ── Player Movement ── */
        var moveSpeed = 0.08;
        var dx = 0, dz = 0;
        if (this.keys['w'] || this.keys['z'] || this.keys['arrowup']) dz = -1;
        if (this.keys['s'] || this.keys['arrowdown']) dz = 1;
        if (this.keys['a'] || this.keys['q'] || this.keys['arrowleft']) dx = -1;
        if (this.keys['d'] || this.keys['arrowright']) dx = 1;

        if (dx !== 0 && dz !== 0) { dx *= 0.707; dz *= 0.707; }

        var newX = this.playerShip.position.x + dx * moveSpeed;
        var newZ = this.playerShip.position.z + dz * moveSpeed;

        if (!this._isWall(newX, this.playerShip.position.z)) this.playerShip.position.x = newX;
        if (!this._isWall(this.playerShip.position.x, newZ)) this.playerShip.position.z = newZ;

        /* Sync invisible collision mesh */
        this.playerMesh.position.copy(this.playerShip.position);

        /* ── Player Aim ── */
        var raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(this.mouse.x, this.mouse.y), this.camera);
        var groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        var aimTarget = new THREE.Vector3();
        raycaster.ray.intersectPlane(groundPlane, aimTarget);
        if (aimTarget) {
            var lookDir = aimTarget.sub(this.playerShip.position);
            lookDir.y = 0;
            if (lookDir.length() > 0.01) {
                this._aimDir = lookDir.normalize();
                /* Rotate ship to face aim direction */
                var angle = Math.atan2(this._aimDir.x, this._aimDir.z);
                this.playerShip.rotation.y = angle;
            }
        }

        /* ── Player Shooting ── */
        if (this.keys['mouse0']) this._playerShoot();
        if (this.shootCooldown > 0) this.shootCooldown--;

        /* ── Update Player Bullets ── */
        var bulletsToRemove = [];
        for (var bi = 0; bi < this.playerBullets.length; bi++) {
            var b = this.playerBullets[bi];
            b.mesh.position.add(b.dir.clone().multiplyScalar(b.speed));
            b.life--;

            if (this._checkBulletWallHit(b.mesh.position) || b.life <= 0) {
                bulletsToRemove.push(bi);
                this._spawnParticles(b.mesh.position, 0xC4362B, 4);
                continue;
            }

            var hitEnemy = false;
            for (var ei = 0; ei < this.enemies.length; ei++) {
                var e = this.enemies[ei];
                if (b.mesh.position.distanceTo(e.mesh.position) < 0.7) {
                    e.hp--;
                    this._spawnParticles(e.mesh.position, e.color || 0x3A6EA5, 6);
                    bulletsToRemove.push(bi);
                    hitEnemy = true;
                    if (e.hp <= 0) {
                        this._spawnParticles(e.mesh.position, e.color || 0x3A6EA5, 18);
                        /* Score bonus for chasers */
                        var bonus = e.type === 'chaser' ? 200 : 100;
                        this.score += bonus * this.level;
                        this.enemiesKilled++;
                        this.totalEnemiesKilled++;
                        this.scene.remove(e.mesh);
                        this.enemies.splice(ei, 1);
                    }
                    break;
                }
            }
            if (hitEnemy) continue;
        }
        for (var ri = bulletsToRemove.length - 1; ri >= 0; ri--) {
            var idx = bulletsToRemove[ri];
            this.scene.remove(this.playerBullets[idx].mesh);
            this.playerBullets.splice(idx, 1);
        }

        /* ── Update Enemies ── */
        for (var eii = 0; eii < this.enemies.length; eii++) {
            var en = this.enemies[eii];

            en.moveTimer--;
            if (en.moveTimer <= 0) {
                en.moveTimer = 30 + Math.random() * 50;
                if (en.type === 'chaser') {
                    var toP = this.playerShip.position.clone().sub(en.mesh.position).normalize();
                    en.moveDir = { x: toP.x, z: toP.z };
                } else {
                    if (Math.random() < 0.5) {
                        var toP2 = this.playerShip.position.clone().sub(en.mesh.position).normalize();
                        en.moveDir = { x: toP2.x, z: toP2.z };
                    } else {
                        en.moveDir = { x: (Math.random() - 0.5), z: (Math.random() - 0.5) };
                    }
                }
            }

            var enNewX = en.mesh.position.x + en.moveDir.x * en.speed;
            var enNewZ = en.mesh.position.z + en.moveDir.z * en.speed;
            if (!this._isWall(enNewX, en.mesh.position.z)) en.mesh.position.x = enNewX;
            if (!this._isWall(en.mesh.position.x, enNewZ)) en.mesh.position.z = enNewZ;

            /* Spin ring animation */
            if (en.mesh.userData.ring) en.mesh.userData.ring.rotation.z += 0.05;
            /* Face player */
            var faceDir = this.playerShip.position.clone().sub(en.mesh.position);
            if (faceDir.length() > 0.1) {
                en.mesh.rotation.y = Math.atan2(faceDir.x, faceDir.z);
            }

            /* Enemy shooting */
            en.shootTimer--;
            if (en.shootTimer <= 0) {
                en.shootTimer = en.shootRate + Math.random() * 40 - this.level * 3;
                if (en.shootTimer < 25) en.shootTimer = 25;
                var distToPlayer = en.mesh.position.distanceTo(this.playerShip.position);
                if (distToPlayer < 18) {
                    this._enemyShoot(en);
                }
            }
        }

        /* ── Update Enemy Bullets ── */
        var eBulletsToRemove = [];
        for (var ebi = 0; ebi < this.enemyBullets.length; ebi++) {
            var eb = this.enemyBullets[ebi];
            eb.mesh.position.add(eb.dir.clone().multiplyScalar(eb.speed));
            eb.life--;

            if (this._checkBulletWallHit(eb.mesh.position) || eb.life <= 0) {
                eBulletsToRemove.push(ebi);
                this._spawnParticles(e.mesh.position, 0x3A6EA5, 3);
                continue;
            }

            if (eb.mesh.position.distanceTo(this.playerShip.position) < 0.6) {
                eBulletsToRemove.push(ebi);
                this.health -= 8 + this.level * 2;
                this.damageFlash = 10;
                this._spawnParticles(this.playerShip.position, 0xC4362B, 8);
            }
        }
        for (var eri = eBulletsToRemove.length - 1; eri >= 0; eri--) {
            var eidx = eBulletsToRemove[eri];
            this.scene.remove(this.enemyBullets[eidx].mesh);
            this.enemyBullets.splice(eidx, 1);
        }

        /* ── Update Pickups ── */
        var pickupRemove = [];
        for (var pi = 0; pi < this.pickups.length; pi++) {
            var pk = this.pickups[pi];
            pk.mesh.rotation.y += 0.04;
            pk.mesh.position.y = 0.5 + Math.sin(Date.now() * 0.003 + pi) * 0.15;
            if (pk.mesh.position.distanceTo(this.playerShip.position) < 1.0) {
                this.health = Math.min(100, this.health + pk.heal);
                this._spawnParticles(pk.mesh.position, 0x4A7C59, 10);
                pickupRemove.push(pi);
                this.scene.remove(pk.mesh);
            }
        }
        for (var pri = pickupRemove.length - 1; pri >= 0; pri--) {
            this.pickups.splice(pickupRemove[pri], 1);
        }

        /* ── Update Particles & Visuals ── */
        this._updateVisuals();

        /* ── Damage Flash ── */
        if (this.damageFlash > 0) {
            this.damageFlash--;
            this.scene.background.setHex(this.damageFlash % 2 === 0 ? 0x1A1A1A : 0x2A1A1A);
        } else {
            this.scene.background.setHex(0x1A1A1A);
        }

        /* ── Red light follows player ── */
        this.redLight.position.set(this.playerShip.position.x, 6, this.playerShip.position.z);

        /* ── Check Win/Lose ── */
        if (this.health <= 0) {
            this.health = 0;
            this.running = false;
            this._showOverlay('gameover');
        }
        if (this.enemies.length === 0 && this.enemiesKilled >= this.enemiesToKill) {
            this.running = false;
            this._showOverlay('levelclear');
        }

        this._updateHUD();
        this.renderer.render(this.scene, this.camera);
    };

    /* ── Update particles and animated visuals (called even when paused) ── */
    NierHackGame.prototype._updateVisuals = function () {
        /* Player ship hover bob */
        if (this.playerShip) {
            this.playerShip.position.y = 0.5 + Math.sin(Date.now() * 0.004) * 0.06;
        }

        /* Particles */
        var partRemove = [];
        for (var pti = 0; pti < this.particles.length; pti++) {
            var pt = this.particles[pti];
            pt.mesh.position.add(pt.vel);
            pt.vel.y -= 0.005;
            pt.life--;
            pt.mesh.material.opacity = Math.max(0, pt.life / 30);
            pt.mesh.scale.multiplyScalar(0.97);
            if (pt.life <= 0) {
                partRemove.push(pti);
                this.scene.remove(pt.mesh);
            }
        }
        for (var ptri = partRemove.length - 1; ptri >= 0; ptri--) {
            this.particles.splice(partRemove[ptri], 1);
        }

        /* Pickup float animation */
        for (var pi = 0; pi < this.pickups.length; pi++) {
            this.pickups[pi].mesh.rotation.y += 0.02;
        }

        /* Enemy ring spins even when paused */
        for (var ei = 0; ei < this.enemies.length; ei++) {
            var en = this.enemies[ei];
            if (en.mesh.userData.ring) en.mesh.userData.ring.rotation.z += 0.03;
        }
    };

    /* ────────────────────────────────────────────
       SHOW / HIDE
       ──────────────────────────────────────────── */
    NierHackGame.prototype.show = function () {
        if (this.section) this.section.style.display = 'block';
        if (!this.running) this.running = true;
    };

    NierHackGame.prototype.hide = function () {
        if (this.section) this.section.style.display = 'none';
        this.running = false;
    };

})();
