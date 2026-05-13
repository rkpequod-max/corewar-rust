/* ═══════════════════════════════════════════════════════════════════════
   NIER AUTOMATA HACKING MINI-GAME  —  Three.js Isometric Twin-Stick Shooter
   ═══════════════════════════════════════════════════════════════════════
   Faithful to the original Nier:Automata hacking sequences:
   • 3D isometric cube labyrinth
   • Twin-stick controls (WASD + mouse aim)
   • Shoot projectiles at enemies
   • Red / beige / black Nier palette
   • CRT scanline overlay
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    /* ── Only init when Nier theme is active ── */
    let gameInstance = null;
    let initialized = false;

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
       GAME CLASS
       ═════════════════════════════════════════ */
    function NierHackGame() {
        this.canvas = document.getElementById('nier-hack-canvas');
        this.section = document.getElementById('nier-hack-section');
        if (!this.canvas) return;

        /* ── State ── */
        this.running = false;
        this.health = 100;
        this.score = 0;
        this.level = 1;
        this.enemiesKilled = 0;
        this.enemiesToKill = 6;
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

        /* ── Three.js setup ── */
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.playerMesh = null;
        this.clock = null;

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
        this.scene.fog = new THREE.FogExp2(0x1A1A1A, 0.018);

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
        dirLight.shadow.camera.left = -20;
        dirLight.shadow.camera.right = 20;
        dirLight.shadow.camera.top = 20;
        dirLight.shadow.camera.bottom = -20;
        this.scene.add(dirLight);

        /* Subtle red point light */
        var redLight = new THREE.PointLight(0xC4362B, 0.3, 40);
        redLight.position.set(0, 8, 0);
        this.scene.add(redLight);

        /* Ground plane */
        var groundGeo = new THREE.PlaneGeometry(50, 50);
        var groundMat = new THREE.MeshStandardMaterial({
            color: 0x222222,
            roughness: 0.9,
            metalness: 0.1
        });
        var ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);

        /* Grid lines on ground */
        var gridHelper = new THREE.GridHelper(50, 50, 0x333333, 0x2A2A2A);
        gridHelper.position.y = 0.01;
        this.scene.add(gridHelper);

        /* Resize handler */
        var self = this;
        this._resizeHandler = function () {
            var w = self.canvas.clientWidth;
            var h = self.canvas.clientHeight;
            if (w === 0 || h === 0) return;
            var aspect = w / h;
            var d2 = 14;
            self.camera.left = -d2 * aspect;
            self.camera.right = d2 * aspect;
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
        /* Clear old walls & enemies */
        var self = this;
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

        /* Maze grid: 1 = wall, 0 = open */
        var GRID = 15;
        var maze = [];
        for (var y = 0; y < GRID; y++) {
            maze[y] = [];
            for (var x = 0; x < GRID; x++) {
                /* Border walls */
                if (x === 0 || y === 0 || x === GRID - 1 || y === GRID - 1) {
                    maze[y][x] = 1;
                } else {
                    maze[y][x] = 0;
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
            var dirs = [[0, -2], [0, 2], [-2, 0], [2, 0]];
            /* Shuffle */
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

        /* Add some extra openings for gameplay variety */
        for (var ey = 2; ey < GRID - 2; ey++) {
            for (var ex = 2; ex < GRID - 2; ex++) {
                if (maze[ey][ex] === 1 && Math.random() < 0.3) {
                    maze[ey][ex] = 0;
                }
            }
        }

        /* Build wall meshes */
        var wallGeo = new THREE.BoxGeometry(2, 2, 2);
        var wallMat = new THREE.MeshStandardMaterial({
            color: 0x2A2A2A,
            roughness: 0.7,
            metalness: 0.3
        });
        var wallMatAccent = new THREE.MeshStandardMaterial({
            color: 0x3A3A3A,
            roughness: 0.6,
            metalness: 0.4
        });

        for (var wy = 0; wy < GRID; wy++) {
            for (var wx = 0; wx < GRID; wx++) {
                if (maze[wy][wx] === 1) {
                    var mat = (Math.random() < 0.15) ? wallMatAccent : wallMat;
                    var wall = new THREE.Mesh(wallGeo, mat);
                    wall.position.set(wx * 2 - GRID, 1, wy * 2 - GRID);
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

        /* ── Player ── */
        if (this.playerMesh) this.scene.remove(this.playerMesh);
        var playerGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
        var playerMat = new THREE.MeshStandardMaterial({
            color: 0xC4362B,
            emissive: 0xC4362B,
            emissiveIntensity: 0.4,
            roughness: 0.3,
            metalness: 0.6
        });
        this.playerMesh = new THREE.Mesh(playerGeo, playerMat);
        this.playerMesh.position.set(1 * 2 - GRID, 0.5, 1 * 2 - GRID);
        this.playerMesh.castShadow = true;
        this.scene.add(this.playerMesh);

        /* Player glow */
        var glowGeo = new THREE.BoxGeometry(1.0, 1.0, 1.0);
        var glowMat = new THREE.MeshBasicMaterial({
            color: 0xC4362B,
            transparent: true,
            opacity: 0.15
        });
        this.playerGlow = new THREE.Mesh(glowGeo, glowMat);
        this.playerMesh.add(this.playerGlow);

        /* ── Enemies ── */
        this.enemiesKilled = 0;
        this.enemiesToKill = 4 + this.level * 2;
        this._spawnEnemies();

        /* ── Pickups (health) ── */
        this._spawnPickups();
    };

    NierHackGame.prototype._spawnEnemies = function () {
        var self = this;
        var GRID = this.mazeGridSize;
        var spawned = 0;
        var attempts = 0;
        while (spawned < this.enemiesToKill && attempts < 200) {
            attempts++;
            var ex = Math.floor(Math.random() * (GRID - 2)) + 1;
            var ey = Math.floor(Math.random() * (GRID - 2)) + 1;
            if (this.maze[ey][ex] !== 0) continue;
            /* Don't spawn too close to player */
            var px = Math.round((this.playerMesh.position.x + GRID) / 2);
            var py = Math.round((this.playerMesh.position.z + GRID) / 2);
            if (Math.abs(ex - px) + Math.abs(ey - py) < 4) continue;
            /* Don't spawn on existing enemy */
            var tooClose = false;
            for (var ei = 0; ei < this.enemies.length; ei++) {
                var ePos = this.enemies[ei].mesh.position;
                var eGridX = Math.round((ePos.x + GRID) / 2);
                var eGridZ = Math.round((ePos.z + GRID) / 2);
                if (eGridX === ex && eGridZ === ey) { tooClose = true; break; }
            }
            if (tooClose) continue;

            var enemyGeo = new THREE.BoxGeometry(0.7, 0.7, 0.7);
            var enemyMat = new THREE.MeshStandardMaterial({
                color: 0x3A6EA5,
                emissive: 0x3A6EA5,
                emissiveIntensity: 0.3,
                roughness: 0.4,
                metalness: 0.5
            });
            var enemyMesh = new THREE.Mesh(enemyGeo, enemyMat);
            enemyMesh.position.set(ex * 2 - GRID, 0.5, ey * 2 - GRID);
            enemyMesh.castShadow = true;
            this.scene.add(enemyMesh);

            this.enemies.push({
                mesh: enemyMesh,
                hp: 3,
                shootTimer: Math.random() * 60 + 40,
                moveTimer: 0,
                moveDir: { x: 0, z: 0 },
                speed: 0.02 + Math.random() * 0.02
            });
            spawned++;
        }
    };

    NierHackGame.prototype._spawnPickups = function () {
        var GRID = this.mazeGridSize;
        var count = 2;
        for (var i = 0; i < count; i++) {
            var attempts = 0;
            while (attempts < 50) {
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

        this._keyDown = function (e) { self.keys[e.key.toLowerCase()] = true; };
        this._keyUp = function (e) { self.keys[e.key.toLowerCase()] = false; };
        this._mouseMove = function (e) {
            var rect = self.canvas.getBoundingClientRect();
            self.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            self.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        };
        this._mouseDown = function (e) {
            if (e.button === 0) self.keys['mouse0'] = true;
        };
        this._mouseUp = function (e) {
            if (e.button === 0) self.keys['mouse0'] = false;
        };

        document.addEventListener('keydown', this._keyDown);
        document.addEventListener('keyup', this._keyUp);
        this.canvas.addEventListener('mousemove', this._mouseMove);
        this.canvas.addEventListener('mousedown', this._mouseDown);
        this.canvas.addEventListener('mouseup', this._mouseUp);

        /* Prevent right-click on canvas */
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
        /* Check if position is inside a wall cell */
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
        this.shootCooldown = 8;  /* frames */

        /* Raycast from mouse to find aim point on ground plane */
        var raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(this.mouse.x, this.mouse.y), this.camera);
        var groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        var target = new THREE.Vector3();
        raycaster.ray.intersectPlane(groundPlane, target);

        if (!target) return;

        var pos = this.playerMesh.position.clone();
        pos.y = 0.5;
        var dir = target.sub(pos).normalize();

        var bulletGeo = new THREE.BoxGeometry(0.15, 0.15, 0.4);
        var bulletMat = new THREE.MeshBasicMaterial({ color: 0xC4362B });
        var bullet = new THREE.Mesh(bulletGeo, bulletMat);
        bullet.position.copy(pos);
        bullet.lookAt(bullet.position.clone().add(dir));
        this.scene.add(bullet);

        this.playerBullets.push({
            mesh: bullet,
            dir: dir,
            speed: 0.4,
            life: 120
        });
    };

    NierHackGame.prototype._enemyShoot = function (enemy) {
        var pos = enemy.mesh.position.clone();
        pos.y = 0.5;
        var dir = this.playerMesh.position.clone().sub(pos).normalize();

        var bulletGeo = new THREE.BoxGeometry(0.12, 0.12, 0.3);
        var bulletMat = new THREE.MeshBasicMaterial({ color: 0x3A6EA5 });
        var bullet = new THREE.Mesh(bulletGeo, bulletMat);
        bullet.position.copy(pos);
        bullet.lookAt(bullet.position.clone().add(dir));
        this.scene.add(bullet);

        this.enemyBullets.push({
            mesh: bullet,
            dir: dir,
            speed: 0.18 + this.level * 0.02,
            life: 180
        });
    };

    /* ────────────────────────────────────────────
       PARTICLES
       ──────────────────────────────────────────── */
    NierHackGame.prototype._spawnParticles = function (position, color, count) {
        for (var i = 0; i < count; i++) {
            var size = 0.05 + Math.random() * 0.15;
            var geo = new THREE.BoxGeometry(size, size, size);
            var mat = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 1
            });
            var mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(position);
            this.scene.add(mesh);

            this.particles.push({
                mesh: mesh,
                vel: new THREE.Vector3(
                    (Math.random() - 0.5) * 0.2,
                    Math.random() * 0.15,
                    (Math.random() - 0.5) * 0.2
                ),
                life: 30 + Math.random() * 30
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
        if (levelEl) levelEl.textContent = this.level;
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

        if (type === 'start') {
            var h2 = document.createElement('h2');
            h2.textContent = 'HACKING';
            overlay.appendChild(h2);
            var sub = document.createElement('div');
            sub.className = 'sub';
            sub.textContent = 'Infiltrate the system. Destroy all targets.';
            overlay.appendChild(sub);
            var btn = document.createElement('button');
            btn.className = 'nier-btn';
            btn.textContent = 'ENGAGE';
            btn.onclick = function () {
                overlay.classList.add('hidden');
                self.running = true;
            };
            overlay.appendChild(btn);
        } else if (type === 'gameover') {
            var h2g = document.createElement('h2');
            h2g.textContent = 'CONNECTION LOST';
            overlay.appendChild(h2g);
            var subg = document.createElement('div');
            subg.className = 'sub';
            subg.textContent = 'System intrusion failed.';
            overlay.appendChild(subg);
            var sc = document.createElement('div');
            sc.className = 'score-display';
            sc.textContent = this.score;
            overlay.appendChild(sc);
            var btng = document.createElement('button');
            btng.className = 'nier-btn';
            btng.textContent = 'RETRY';
            btng.onclick = function () {
                self._restart();
            };
            overlay.appendChild(btng);
        } else if (type === 'levelclear') {
            var h2l = document.createElement('h2');
            h2l.textContent = 'HACK COMPLETE';
            overlay.appendChild(h2l);
            var subl = document.createElement('div');
            subl.className = 'sub';
            subl.textContent = 'Level ' + this.level + ' cleared.';
            overlay.appendChild(subl);
            var scl = document.createElement('div');
            scl.className = 'score-display';
            scl.textContent = this.score;
            overlay.appendChild(scl);
            var btnl = document.createElement('button');
            btnl.className = 'nier-btn';
            btnl.textContent = 'NEXT LEVEL';
            btnl.onclick = function () {
                self.level++;
                self.health = Math.min(100, this.health + 30);
                self._buildLevel();
                self._updateHUD();
                overlay.classList.add('hidden');
            };
            overlay.appendChild(btnl);
        }
    };

    NierHackGame.prototype._restart = function () {
        this.health = 100;
        this.score = 0;
        this.level = 1;
        this._buildLevel();
        this._updateHUD();
        this._showOverlay('start');
    };

    /* ────────────────────────────────────────────
       GAME LOOP
       ──────────────────────────────────────────── */
    NierHackGame.prototype._loop = function () {
        var self = this;
        if (!this.running) { requestAnimationFrame(function () { self._loop(); }); return; }

        requestAnimationFrame(function () { self._loop(); });

        var dt = this.clock.getDelta();

        /* Check overlay is hidden */
        var overlay = document.getElementById('nier-hack-overlay');
        if (overlay && !overlay.classList.contains('hidden')) {
            this.renderer.render(this.scene, this.camera);
            return;
        }

        /* ── Player Movement ── */
        var moveSpeed = 0.08;
        var dx = 0, dz = 0;
        if (this.keys['w'] || this.keys['z'] || this.keys['arrowup']) dz = -1;
        if (this.keys['s'] || this.keys['arrowdown']) dz = 1;
        if (this.keys['a'] || this.keys['q'] || this.keys['arrowleft']) dx = -1;
        if (this.keys['d'] || this.keys['arrowright']) dx = 1;

        /* Normalize diagonal */
        if (dx !== 0 && dz !== 0) {
            dx *= 0.707;
            dz *= 0.707;
        }

        var newX = this.playerMesh.position.x + dx * moveSpeed;
        var newZ = this.playerMesh.position.z + dz * moveSpeed;

        /* Collision: try X then Z separately */
        if (!this._isWall(newX, this.playerMesh.position.z)) {
            this.playerMesh.position.x = newX;
        }
        if (!this._isWall(this.playerMesh.position.x, newZ)) {
            this.playerMesh.position.z = newZ;
        }

        /* Player bob animation */
        this.playerMesh.position.y = 0.5 + Math.sin(Date.now() * 0.005) * 0.05;
        this.playerMesh.rotation.y += 0.02;

        /* ── Player Aim ── */
        var raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(this.mouse.x, this.mouse.y), this.camera);
        var groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        var aimTarget = new THREE.Vector3();
        raycaster.ray.intersectPlane(groundPlane, aimTarget);
        if (aimTarget) {
            var lookDir = aimTarget.sub(this.playerMesh.position);
            lookDir.y = 0;
            if (lookDir.length() > 0.01) {
                /* Store aim direction for shooting */
                this._aimDir = lookDir.normalize();
            }
        }

        /* ── Player Shooting ── */
        if (this.keys['mouse0']) {
            this._playerShoot();
        }
        if (this.shootCooldown > 0) this.shootCooldown--;

        /* ── Update Player Bullets ── */
        var bulletsToRemove = [];
        for (var bi = 0; bi < this.playerBullets.length; bi++) {
            var b = this.playerBullets[bi];
            b.mesh.position.add(b.dir.clone().multiplyScalar(b.speed));
            b.life--;

            /* Wall hit */
            if (this._checkBulletWallHit(b.mesh.position) || b.life <= 0) {
                bulletsToRemove.push(bi);
                this._spawnParticles(b.mesh.position, 0xC4362B, 4);
                continue;
            }

            /* Enemy hit */
            var hitEnemy = false;
            for (var ei = 0; ei < this.enemies.length; ei++) {
                var e = this.enemies[ei];
                if (b.mesh.position.distanceTo(e.mesh.position) < 0.6) {
                    e.hp--;
                    this._spawnParticles(e.mesh.position, 0x3A6EA5, 6);
                    bulletsToRemove.push(bi);
                    hitEnemy = true;
                    if (e.hp <= 0) {
                        this._spawnParticles(e.mesh.position, 0x3A6EA5, 15);
                        this.scene.remove(e.mesh);
                        this.enemies.splice(ei, 1);
                        this.score += 100 * this.level;
                        this.enemiesKilled++;
                    }
                    break;
                }
            }
            if (hitEnemy) continue;
        }
        /* Remove bullets (reverse order) */
        for (var ri = bulletsToRemove.length - 1; ri >= 0; ri--) {
            var idx = bulletsToRemove[ri];
            this.scene.remove(this.playerBullets[idx].mesh);
            this.playerBullets.splice(idx, 1);
        }

        /* ── Update Enemies ── */
        for (var eii = 0; eii < this.enemies.length; eii++) {
            var en = this.enemies[eii];

            /* Move toward player sometimes */
            en.moveTimer--;
            if (en.moveTimer <= 0) {
                en.moveTimer = 40 + Math.random() * 60;
                var toPlayer = this.playerMesh.position.clone().sub(en.mesh.position).normalize();
                en.moveDir = { x: toPlayer.x, z: toPlayer.z };
                /* Add some randomness */
                if (Math.random() < 0.3) {
                    en.moveDir = { x: (Math.random() - 0.5), z: (Math.random() - 0.5) };
                }
            }

            var enNewX = en.mesh.position.x + en.moveDir.x * en.speed;
            var enNewZ = en.mesh.position.z + en.moveDir.z * en.speed;
            if (!this._isWall(enNewX, en.mesh.position.z)) {
                en.mesh.position.x = enNewX;
            }
            if (!this._isWall(en.mesh.position.x, enNewZ)) {
                en.mesh.position.z = enNewZ;
            }

            /* Enemy rotation */
            en.mesh.rotation.y += 0.03;
            en.mesh.rotation.x += 0.01;

            /* Enemy shooting */
            en.shootTimer--;
            if (en.shootTimer <= 0) {
                en.shootTimer = 60 + Math.random() * 80 - this.level * 5;
                if (en.shootTimer < 30) en.shootTimer = 30;
                var distToPlayer = en.mesh.position.distanceTo(this.playerMesh.position);
                if (distToPlayer < 16) {
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

            /* Wall hit */
            if (this._checkBulletWallHit(eb.mesh.position) || eb.life <= 0) {
                eBulletsToRemove.push(ebi);
                this._spawnParticles(eb.mesh.position, 0x3A6EA5, 3);
                continue;
            }

            /* Player hit */
            if (eb.mesh.position.distanceTo(this.playerMesh.position) < 0.5) {
                eBulletsToRemove.push(ebi);
                this.health -= 10 + this.level * 2;
                this.damageFlash = 10;
                this._spawnParticles(this.playerMesh.position, 0xC4362B, 8);
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
            if (pk.mesh.position.distanceTo(this.playerMesh.position) < 0.8) {
                this.health = Math.min(100, this.health + pk.heal);
                this._spawnParticles(pk.mesh.position, 0x4A7C59, 10);
                pickupRemove.push(pi);
                this.scene.remove(pk.mesh);
            }
        }
        for (var pri = pickupRemove.length - 1; pri >= 0; pri--) {
            this.pickups.splice(pickupRemove[pri], 1);
        }

        /* ── Update Particles ── */
        var partRemove = [];
        for (var pti = 0; pti < this.particles.length; pti++) {
            var pt = this.particles[pti];
            pt.mesh.position.add(pt.vel);
            pt.vel.y -= 0.005;
            pt.life--;
            pt.mesh.material.opacity = pt.life / 30;
            pt.mesh.scale.multiplyScalar(0.97);
            if (pt.life <= 0) {
                partRemove.push(pti);
                this.scene.remove(pt.mesh);
            }
        }
        for (var ptri = partRemove.length - 1; ptri >= 0; ptri--) {
            this.particles.splice(partRemove[ptri], 1);
        }

        /* ── Damage Flash ── */
        if (this.damageFlash > 0) {
            this.damageFlash--;
            this.scene.background.setHex(this.damageFlash % 2 === 0 ? 0x1A1A1A : 0x2A1A1A);
        } else {
            this.scene.background.setHex(0x1A1A1A);
        }

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

        /* ── Render ── */
        this.renderer.render(this.scene, this.camera);
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
