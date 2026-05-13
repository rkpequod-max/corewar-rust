/* ═══════════════════════════════════════════════════════════════
   NIER AUTOMATA HACKING GAME  –  Three.js Twin-Stick Shooter v3
   ═══════════════════════════════════════════════════════════════
   Controls:
     WASD        → Move the ship
     Arrow Keys  → Aim / rotate the ship
     Left Click  → Shoot
     F           → Fullscreen
   ═══════════════════════════════════════════════════════════════ */

(function () {
    "use strict";

    /* ── Constants ── */
    const MAZE_W = 14, MAZE_H = 10;
    const CELL = 2.0;
    const HALF = CELL / 2;
    const WALL_H = 1.2;
    const PLAYER_SPEED = 5.5;
    const BULLET_SPEED = 14;
    const ENEMY_BULLET_SPEED = 4.0;
    const SHOOT_COOLDOWN = 0.12;
    const MAX_HP = 100;
    const INVULN_TIME = 0.6;

    /* ── Level definitions ── */
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

    /* ── State ── */
    let scene, camera, renderer, clock;
    let playerGroup, playerPos = {x:0,z:0}, playerAngle = 0, playerHP = MAX_HP;
    let mazeGrid = null;
    let wallMeshes = [], floorMesh = null, gridHelper = null;
    let enemies = [], playerBullets = [], enemyBullets = [], particles = [];
    let currentLevel = 0, score = 0, invulnTimer = 0, shootTimer = 0;
    let gameActive = false, gamePaused = false;
    let animFrameId = null;
    let isFullscreen = false;
    let sceneReady = false;

    /* ── Input ── */
    const keys = {};
    let mouseDown = false;

    /* ── DOM refs ── */
    let canvas, overlay, hudHealth, hudHealthBar, hudScore, hudLevel, hudEnemies, hudLevelName;
    let fullscreenBtn;

    /* ── Shared geometries (created once, reused) ── */
    let wallGeoH, wallGeoV, bulletGeo;

    /* ══════════════════════════════
       MAZE GENERATION (DFS)
       ══════════════════════════════ */
    function generateMaze(w, h) {
        const grid = [];
        for (let y = 0; y < h; y++) {
            grid[y] = [];
            for (let x = 0; x < w; x++) {
                grid[y][x] = { top: true, right: true, bottom: true, left: true, visited: false };
            }
        }
        const stack = [{ x: 0, y: 0 }];
        grid[0][0].visited = true;
        const dirs = [
            { dx: 0, dy: -1, wall: "top",    opp: "bottom" },
            { dx: 1, dy: 0,  wall: "right",  opp: "left"   },
            { dx: 0, dy: 1,  wall: "bottom", opp: "top"    },
            { dx: -1, dy: 0, wall: "left",   opp: "right"  },
        ];
        while (stack.length) {
            const cur = stack[stack.length - 1];
            const neighbors = [];
            for (const d of dirs) {
                const nx = cur.x + d.dx, ny = cur.y + d.dy;
                if (nx >= 0 && nx < w && ny >= 0 && ny < h && !grid[ny][nx].visited)
                    neighbors.push({ x: nx, y: ny, wall: d.wall, opp: d.opp });
            }
            if (neighbors.length === 0) { stack.pop(); continue; }
            const next = neighbors[Math.floor(Math.random() * neighbors.length)];
            grid[cur.y][cur.x][next.wall] = false;
            grid[next.y][next.x][next.opp] = false;
            grid[next.y][next.x].visited = true;
            stack.push({ x: next.x, y: next.y });
        }
        // Open ~30% extra walls for wider play areas
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (Math.random() < 0.30) {
                    if (x < w - 1 && grid[y][x].right) { grid[y][x].right = false; grid[y][x+1].left = false; }
                    if (y < h - 1 && grid[y][x].bottom) { grid[y][x].bottom = false; grid[y+1][x].top = false; }
                }
            }
        }
        return grid;
    }

    function cellToWorld(cx, cy) {
        return { x: cx * CELL + HALF, z: cy * CELL + HALF };
    }

    /* ══════════════════════════════
       THREE.JS SCENE SETUP
       ══════════════════════════════ */
    function initScene() {
        try {
            scene = new THREE.Scene();
            scene.background = new THREE.Color(0xE0E0E0);
            scene.fog = new THREE.Fog(0xE0E0E0, 25, 50);

            const aspect = 960 / 540;
            const size = 10;
            camera = new THREE.OrthographicCamera(-size * aspect, size * aspect, size, -size, 0.1, 100);
            camera.position.set(14, 18, 14);
            camera.lookAt(14, 0, 10);

            renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            renderer.setSize(960, 540, false);

            const amb = new THREE.AmbientLight(0xffffff, 0.6);
            scene.add(amb);
            const dir = new THREE.DirectionalLight(0xffffff, 0.6);
            dir.position.set(10, 20, 10);
            scene.add(dir);

            clock = new THREE.Clock();

            // Shared geometries
            wallGeoH = new THREE.BoxGeometry(CELL + 0.15, WALL_H, 0.15);
            wallGeoV = new THREE.BoxGeometry(0.15, WALL_H, CELL + 0.15);
            bulletGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);

            sceneReady = true;
            console.log("[NierHack] Scene initialized OK");
        } catch (err) {
            console.error("[NierHack] Scene init FAILED:", err);
        }
    }

    /* ══════════════════════════════
       BUILD MAZE MESHES
       ══════════════════════════════ */
    function clearMazeMeshes() {
        wallMeshes.forEach(m => {
            scene.remove(m);
            m.geometry.dispose();
        });
        wallMeshes = [];
        if (gridHelper) { scene.remove(gridHelper); gridHelper.geometry.dispose(); gridHelper = null; }
        if (floorMesh) { scene.remove(floorMesh); floorMesh.geometry.dispose(); floorMesh = null; }
    }

    function buildMaze() {
        clearMazeMeshes();

        // Floor
        const floorGeo = new THREE.PlaneGeometry(MAZE_W * CELL + 1, MAZE_H * CELL + 1);
        const floorMat = new THREE.MeshLambertMaterial({ color: 0xD8D8D8 });
        floorMesh = new THREE.Mesh(floorGeo, floorMat);
        floorMesh.rotation.x = -Math.PI / 2;
        floorMesh.position.set(MAZE_W * CELL / 2, -0.01, MAZE_H * CELL / 2);
        floorMesh.receiveShadow = true;
        scene.add(floorMesh);

        // Grid
        gridHelper = new THREE.GridHelper(Math.max(MAZE_W, MAZE_H) * CELL, Math.max(MAZE_W, MAZE_H), 0xC0C0C0, 0xCCCCCC);
        gridHelper.position.set(MAZE_W * CELL / 2, 0.005, MAZE_H * CELL / 2);
        scene.add(gridHelper);

        // Walls — single shared material
        const wallMat = new THREE.MeshLambertMaterial({ color: 0xF0F0F0 });

        for (let y = 0; y < MAZE_H; y++) {
            for (let x = 0; x < MAZE_W; x++) {
                const c = mazeGrid[y][x];
                const wx = x * CELL;
                const wz = y * CELL;

                if (c.top) {
                    const m = new THREE.Mesh(wallGeoH, wallMat);
                    m.position.set(wx + HALF, WALL_H / 2, wz);
                    scene.add(m);
                    wallMeshes.push(m);
                }
                if (c.left) {
                    const m = new THREE.Mesh(wallGeoV, wallMat);
                    m.position.set(wx, WALL_H / 2, wz + HALF);
                    scene.add(m);
                    wallMeshes.push(m);
                }
                if (y === MAZE_H - 1 && c.bottom) {
                    const m = new THREE.Mesh(wallGeoH, wallMat);
                    m.position.set(wx + HALF, WALL_H / 2, wz + CELL);
                    scene.add(m);
                    wallMeshes.push(m);
                }
                if (x === MAZE_W - 1 && c.right) {
                    const m = new THREE.Mesh(wallGeoV, wallMat);
                    m.position.set(wx + CELL, WALL_H / 2, wz + HALF);
                    scene.add(m);
                    wallMeshes.push(m);
                }
            }
        }
        console.log("[NierHack] Maze built, walls:", wallMeshes.length);
    }

    /* ══════════════════════════════
       PLAYER (SPACESHIP)
       ══════════════════════════════ */
    function createPlayer() {
        if (playerGroup) scene.remove(playerGroup);
        playerGroup = new THREE.Group();

        // Arrow/ship shape
        const shape = new THREE.Shape();
        shape.moveTo(0, 0.5);
        shape.lineTo(0.22, 0.05);
        shape.lineTo(0.30, -0.38);
        shape.lineTo(0.09, -0.18);
        shape.lineTo(0, -0.28);
        shape.lineTo(-0.09, -0.18);
        shape.lineTo(-0.30, -0.38);
        shape.lineTo(-0.22, 0.05);
        shape.closePath();

        const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1 });
        const mat = new THREE.MeshPhongMaterial({ color: 0xFFFFFF, emissive: 0x222222, shininess: 80, specular: 0x444444 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 0.08;
        playerGroup.add(mesh);

        // Engine glow
        const glowGeo = new THREE.CircleGeometry(0.1, 8);
        const glowMat = new THREE.MeshBasicMaterial({ color: 0xC4362B, transparent: true, opacity: 0.7 });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        glow.rotation.x = -Math.PI / 2;
        glow.position.set(0, 0.06, 0.18);
        playerGroup.add(glow);
        playerGroup.userData.glow = glow;

        scene.add(playerGroup);
        console.log("[NierHack] Player created");
    }

    /* ══════════════════════════════
       ENEMIES
       ══════════════════════════════ */
    function createEnemyMesh(type) {
        const group = new THREE.Group();
        let coreMesh;
        if (type === "core") {
            const coreGeo = new THREE.SphereGeometry(0.3, 10, 6);
            const coreMat = new THREE.MeshPhongMaterial({ color: 0x1A1A1A, emissive: 0xC4362B, emissiveIntensity: 0.3 });
            coreMesh = new THREE.Mesh(coreGeo, coreMat);
            coreMesh.position.y = 0.5;
            group.add(coreMesh);
            const ringGeo = new THREE.TorusGeometry(0.45, 0.03, 6, 16);
            const ringMat = new THREE.MeshBasicMaterial({ color: 0xC4362B, transparent: true, opacity: 0.6 });
            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.rotation.x = Math.PI / 2;
            ring.position.y = 0.5;
            group.add(ring);
            group.userData.ring = ring;
        } else {
            const sqGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
            const sqMat = new THREE.MeshPhongMaterial({ color: 0x1A1A1A, emissive: 0x3A6EA5, emissiveIntensity: 0.2 });
            coreMesh = new THREE.Mesh(sqGeo, sqMat);
            coreMesh.position.y = 0.4;
            group.add(coreMesh);
        }
        group.userData.coreMesh = coreMesh;
        return group;
    }

    function spawnEnemies() {
        enemies.forEach(e => { scene.remove(e.mesh); e.mesh.traverse(c => { if(c.geometry) c.geometry.dispose(); if(c.material) c.material.dispose(); }); });
        enemies = [];
        const lvl = LEVELS[currentLevel];
        const cells = [];
        for (let y = 0; y < MAZE_H; y++)
            for (let x = 0; x < MAZE_W; x++)
                if (!(x <= 2 && y <= 2)) cells.push({ x, y });
        for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
        const count = Math.min(lvl.enemies, cells.length);
        for (let i = 0; i < count; i++) {
            const type = i === 0 ? "core" : "square";
            const mesh = createEnemyMesh(type);
            const pos = cellToWorld(cells[i].x, cells[i].y);
            mesh.position.set(pos.x, 0, pos.z);
            scene.add(mesh);
            const hp = Math.round((type === "core" ? 15 : 8) * lvl.hpMul);
            enemies.push({
                mesh, type, hp, maxHp: hp,
                pos: { x: pos.x, z: pos.z },
                speed: (0.8 + Math.random() * 0.4) * lvl.spdMul,
                moveDir: { x: 0, z: 0 }, moveTimer: 0,
                shootTimer: Math.random() * lvl.shootRate,
                shootRate: lvl.shootRate,
                pattern: lvl.patterns[Math.floor(Math.random() * lvl.patterns.length)],
                pulsePhase: Math.random() * Math.PI * 2,
            });
        }
        console.log("[NierHack] Enemies spawned:", count);
    }

    /* ══════════════════════════════
       BULLETS
       ══════════════════════════════ */
    const whiteBulletMat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF });
    const redBulletMat = new THREE.MeshBasicMaterial({ color: 0xFF3333 });

    function spawnPlayerBullet() {
        const mesh = new THREE.Mesh(bulletGeo, whiteBulletMat);
        mesh.position.set(playerPos.x, 0.4, playerPos.z);
        scene.add(mesh);
        playerBullets.push({
            mesh,
            vx: Math.sin(playerAngle) * BULLET_SPEED,
            vz: -Math.cos(playerAngle) * BULLET_SPEED,
            life: 3,
        });
    }

    function spawnEnemyBullet(x, z, angle, speed) {
        const mesh = new THREE.Mesh(bulletGeo, redBulletMat);
        mesh.position.set(x, 0.4, z);
        scene.add(mesh);
        enemyBullets.push({
            mesh,
            vx: Math.sin(angle) * speed,
            vz: -Math.cos(angle) * speed,
            life: 4,
        });
    }

    /* ══════════════════════════════
       PARTICLES
       ══════════════════════════════ */
    function spawnParticles(x, z, color, count) {
        const geo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
        for (let i = 0; i < count; i++) {
            const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(x, 0.3 + Math.random() * 0.3, z);
            scene.add(mesh);
            const angle = Math.random() * Math.PI * 2;
            const spd = 1 + Math.random() * 3;
            particles.push({
                mesh, mat,
                vx: Math.sin(angle) * spd,
                vy: 1 + Math.random() * 2,
                vz: Math.cos(angle) * spd,
                life: 0.4 + Math.random() * 0.4,
                maxLife: 0.8,
            });
        }
    }

    /* ══════════════════════════════
       COLLISION
       ══════════════════════════════ */
    function isWallAt(wx, wz) {
        if (!mazeGrid) return true;
        const cx = Math.floor(wx / CELL);
        const cz = Math.floor(wz / CELL);
        if (cx < 0 || cx >= MAZE_W || cz < 0 || cz >= MAZE_H) return true;
        const lx = wx - cx * CELL;
        const lz = wz - cz * CELL;
        const cell = mazeGrid[cz][cx];
        const m = 0.2;
        if (lz < m && cell.top) return true;
        if (lz > CELL - m && cell.bottom) return true;
        if (lx < m && cell.left) return true;
        if (lx > CELL - m && cell.right) return true;
        return false;
    }

    function dist2d(ax, az, bx, bz) {
        const dx = ax - bx, dz = az - bz;
        return Math.sqrt(dx * dx + dz * dz);
    }

    /* ══════════════════════════════
       ENEMY AI & SHOOTING
       ══════════════════════════════ */
    function enemyShoot(e) {
        const ex = e.pos.x, ez = e.pos.z;
        const angle = Math.atan2(playerPos.x - ex, -(playerPos.z - ez));
        switch (e.pattern) {
            case "aimed": spawnEnemyBullet(ex, ez, angle, ENEMY_BULLET_SPEED); break;
            case "burst": for (let i = -1; i <= 1; i++) spawnEnemyBullet(ex, ez, angle + i * 0.15, ENEMY_BULLET_SPEED); break;
            case "ring": { const n = 8 + currentLevel * 2; for (let i = 0; i < n; i++) spawnEnemyBullet(ex, ez, (i/n)*Math.PI*2, ENEMY_BULLET_SPEED*0.7); break; }
            case "spiral": for (let i = 0; i < 5; i++) spawnEnemyBullet(ex, ez, angle + i*0.4, ENEMY_BULLET_SPEED*0.8); break;
            case "wall": { const p = angle + Math.PI/2; for (let i = -3; i <= 3; i++) spawnEnemyBullet(ex+Math.sin(p)*i*0.35, ez-Math.cos(p)*i*0.35, angle, ENEMY_BULLET_SPEED*0.6); break; }
        }
    }

    function updateEnemies(dt) {
        for (const e of enemies) {
            e.pulsePhase += dt * 3;
            if (e.mesh.userData.coreMesh) { const s = 1 + Math.sin(e.pulsePhase) * 0.08; e.mesh.userData.coreMesh.scale.set(s,s,s); }
            if (e.mesh.userData.ring) e.mesh.userData.ring.rotation.z += dt * 2;
            e.moveTimer -= dt;
            if (e.moveTimer <= 0) {
                const toP = Math.atan2(playerPos.x - e.pos.x, -(playerPos.z - e.pos.z));
                if (Math.random() < 0.6) e.moveDir = { x: Math.sin(toP), z: -Math.cos(toP) };
                else { const ra = Math.random() * Math.PI * 2; e.moveDir = { x: Math.sin(ra), z: -Math.cos(ra) }; }
                e.moveTimer = 0.5 + Math.random() * 1.5;
            }
            const nx = e.pos.x + e.moveDir.x * e.speed * dt;
            const nz = e.pos.z + e.moveDir.z * e.speed * dt;
            if (!isWallAt(nx, nz)) { e.pos.x = nx; e.pos.z = nz; }
            else e.moveTimer = 0;
            e.mesh.position.set(e.pos.x, 0, e.pos.z);
            e.shootTimer -= dt;
            if (e.shootTimer <= 0) { enemyShoot(e); e.shootTimer = e.shootRate * (0.8 + Math.random() * 0.4); }
        }
    }

    /* ══════════════════════════════
       UPDATE LOOP
       ══════════════════════════════ */
    function update(dt) {
        if (!gameActive || gamePaused || !sceneReady) return;
        dt = Math.min(dt, 0.05);

        // Player movement
        let dx = 0, dz = 0;
        if (keys["KeyW"] || keys["KeyZ"]) dz = -1;
        if (keys["KeyS"]) dz = 1;
        if (keys["KeyA"] || keys["KeyQ"]) dx = -1;
        if (keys["KeyD"]) dx = 1;
        if (dx !== 0 || dz !== 0) {
            const len = Math.sqrt(dx*dx+dz*dz); dx/=len; dz/=len;
            const nx = playerPos.x + dx * PLAYER_SPEED * dt;
            const nz = playerPos.z + dz * PLAYER_SPEED * dt;
            if (!isWallAt(nx, playerPos.z)) playerPos.x = nx;
            if (!isWallAt(playerPos.x, nz)) playerPos.z = nz;
        }

        // Aim with arrow keys
        let aimX = 0, aimZ = 0;
        if (keys["ArrowUp"])    aimZ = -1;
        if (keys["ArrowDown"])  aimZ = 1;
        if (keys["ArrowLeft"])  aimX = -1;
        if (keys["ArrowRight"]) aimX = 1;
        if (aimX !== 0 || aimZ !== 0) playerAngle = Math.atan2(aimX, -aimZ);

        playerGroup.position.set(playerPos.x, 0, playerPos.z);
        playerGroup.rotation.y = playerAngle;

        if (playerGroup.userData.glow) playerGroup.userData.glow.material.opacity = 0.5 + Math.sin(clock.elapsedTime * 8) * 0.3;

        if (invulnTimer > 0) { invulnTimer -= dt; playerGroup.visible = Math.floor(invulnTimer * 10) % 2 === 0; }
        else playerGroup.visible = true;

        // Shoot
        shootTimer -= dt;
        if (mouseDown && shootTimer <= 0) { spawnPlayerBullet(); shootTimer = SHOOT_COOLDOWN; }

        // Player bullets
        for (let i = playerBullets.length - 1; i >= 0; i--) {
            const b = playerBullets[i];
            b.mesh.position.x += b.vx * dt;
            b.mesh.position.z += b.vz * dt;
            b.life -= dt;
            if (isWallAt(b.mesh.position.x, b.mesh.position.z) || b.life <= 0) {
                if (b.life > 0) spawnParticles(b.mesh.position.x, b.mesh.position.z, 0xAAAAAA, 3);
                scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose();
                playerBullets.splice(i, 1); continue;
            }
            let hit = false;
            for (let j = enemies.length - 1; j >= 0; j--) {
                const e = enemies[j];
                if (dist2d(b.mesh.position.x, b.mesh.position.z, e.pos.x, e.pos.z) < 0.45) {
                    e.hp--;
                    spawnParticles(e.pos.x, e.pos.z, 0xFFFFFF, 4);
                    if (e.hp <= 0) {
                        spawnParticles(e.pos.x, e.pos.z, 0xC4362B, 12);
                        scene.remove(e.mesh); e.mesh.traverse(c => { if(c.geometry)c.geometry.dispose(); if(c.material)c.material.dispose(); });
                        score += e.type === "core" ? 500 : 200;
                        enemies.splice(j, 1);
                    }
                    scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose();
                    playerBullets.splice(i, 1); hit = true; break;
                }
            }
            if (hit) continue;
        }

        // Enemy bullets
        for (let i = enemyBullets.length - 1; i >= 0; i--) {
            const b = enemyBullets[i];
            b.mesh.position.x += b.vx * dt;
            b.mesh.position.z += b.vz * dt;
            b.life -= dt;
            if (isWallAt(b.mesh.position.x, b.mesh.position.z) || b.life <= 0) {
                scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose();
                enemyBullets.splice(i, 1); continue;
            }
            if (invulnTimer <= 0 && dist2d(b.mesh.position.x, b.mesh.position.z, playerPos.x, playerPos.z) < 0.35) {
                playerHP -= 10; invulnTimer = INVULN_TIME;
                spawnParticles(playerPos.x, playerPos.z, 0xC4362B, 6);
                scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose();
                enemyBullets.splice(i, 1);
                if (playerHP <= 0) { playerHP = 0; gameOver(); return; }
                continue;
            }
        }

        // Particles
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.mesh.position.x += p.vx * dt;
            p.mesh.position.y += p.vy * dt;
            p.mesh.position.z += p.vz * dt;
            p.vy -= 6 * dt;
            p.life -= dt;
            p.mat.opacity = Math.max(0, p.life / p.maxLife);
            if (p.life <= 0) { scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mat.dispose(); particles.splice(i, 1); }
        }

        updateEnemies(dt);

        if (enemies.length === 0) { levelClear(); return; }

        updateHUD();
    }

    /* ══════════════════════════════
       HUD
       ══════════════════════════════ */
    function updateHUD() {
        if (hudHealth) hudHealth.textContent = playerHP + "%";
        if (hudHealthBar) { hudHealthBar.style.width = playerHP + "%"; hudHealthBar.className = "health-bar-inner" + (playerHP < 30 ? " danger" : ""); }
        if (hudScore) hudScore.textContent = score;
        if (hudLevel) hudLevel.textContent = (currentLevel + 1) + " / " + LEVELS.length;
        if (hudEnemies) hudEnemies.textContent = enemies.length;
        if (hudLevelName) hudLevelName.textContent = LEVELS[currentLevel].name;
    }

    /* ══════════════════════════════
       OVERLAY (using direct onclick for reliability)
       ══════════════════════════════ */
    function showOverlay(title, sub, btnText, btnAction) {
        if (!overlay) return;
        overlay.classList.remove("hidden");
        overlay.style.pointerEvents = "auto";
        const scoreHtml = score > 0 ? '<div class="overlay-score">SCORE: ' + score + '</div>' : '';
        overlay.innerHTML =
            '<div class="overlay-title">' + title + '</div>' +
            '<div class="overlay-sub">' + sub + '</div>' +
            scoreHtml +
            '<button class="overlay-btn" onclick="window._nierHackBtnAction()">' + btnText + '</button>';
        // Store action globally so onclick can reach it
        window._nierHackBtnAction = function() {
            console.log("[NierHack] Button clicked:", btnText);
            try { btnAction(); } catch(err) { console.error("[NierHack] Button action error:", err); }
        };
        // Focus the button
        const btn = overlay.querySelector(".overlay-btn");
        if (btn) btn.focus();
    }

    function hideOverlay() {
        if (!overlay) return;
        overlay.classList.add("hidden");
        overlay.style.pointerEvents = "none";
        overlay.innerHTML = "";
        window._nierHackBtnAction = null;
    }

    /* ══════════════════════════════
       GAME STATE TRANSITIONS
       ══════════════════════════════ */
    function startLevel() {
        console.log("[NierHack] Starting level", currentLevel);
        clearBulletsAndParticles();
        enemies.forEach(e => { scene.remove(e.mesh); e.mesh.traverse(c => { if(c.geometry)c.geometry.dispose(); if(c.material)c.material.dispose(); }); });
        enemies = [];

        mazeGrid = generateMaze(MAZE_W, MAZE_H);
        buildMaze();

        playerPos = cellToWorld(1, 1);
        playerAngle = 0;
        playerHP = MAX_HP;
        invulnTimer = 0;
        shootTimer = 0;
        playerGroup.position.set(playerPos.x, 0, playerPos.z);
        playerGroup.rotation.y = 0;
        playerGroup.visible = true;

        spawnEnemies();

        // Camera
        const cx = MAZE_W * CELL / 2;
        const cz = MAZE_H * CELL / 2;
        camera.position.set(cx + 6, 18, cz + 6);
        camera.lookAt(cx, 0, cz);

        gameActive = true;
        gamePaused = false;
        hideOverlay();
        updateHUD();
        console.log("[NierHack] Level started OK, enemies:", enemies.length);
    }

    function levelClear() {
        gameActive = false;
        console.log("[NierHack] Level cleared!");
        if (currentLevel < LEVELS.length - 1) {
            showOverlay("SECTOR CLEARED", LEVELS[currentLevel].name + " — all enemies destroyed", "NEXT SECTOR", function() { currentLevel++; startLevel(); });
        } else {
            showOverlay("HACK COMPLETE", "All sectors cleared — system compromised", "PLAY AGAIN", function() { currentLevel = 0; score = 0; startLevel(); });
        }
    }

    function gameOver() {
        gameActive = false;
        console.log("[NierHack] Game over!");
        showOverlay("CONNECTION LOST", "Signal terminated — hack failed", "RETRY", function() { startLevel(); });
    }

    function clearBulletsAndParticles() {
        playerBullets.forEach(b => { scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); });
        playerBullets = [];
        enemyBullets.forEach(b => { scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); });
        enemyBullets = [];
        particles.forEach(p => { scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mat.dispose(); });
        particles = [];
    }

    /* ══════════════════════════════
       FULLSCREEN
       ══════════════════════════════ */
    function toggleFullscreen() {
        const wrapper = document.getElementById("nier-hack-wrapper");
        if (!wrapper) return;
        if (!document.fullscreenElement) {
            wrapper.requestFullscreen().then(function() {
                isFullscreen = true;
                if (fullscreenBtn) fullscreenBtn.textContent = "⤓";
                resizeRenderer();
            }).catch(function(err) { console.warn("[NierHack] Fullscreen failed:", err); });
        } else {
            document.exitFullscreen().then(function() {
                isFullscreen = false;
                if (fullscreenBtn) fullscreenBtn.textContent = "⤒";
                resizeRenderer();
            });
        }
    }

    function resizeRenderer() {
        if (!renderer || !canvas) return;
        const w = canvas.clientWidth || 960;
        const h = canvas.clientHeight || 540;
        renderer.setSize(w, h, false);
        const aspect = w / h;
        const size = 10;
        camera.left = -size * aspect;
        camera.right = size * aspect;
        camera.top = size;
        camera.bottom = -size;
        camera.updateProjectionMatrix();
    }

    /* ══════════════════════════════
       RENDER LOOP
       ══════════════════════════════ */
    function animate() {
        animFrameId = requestAnimationFrame(animate);
        if (!sceneReady) return;
        const dt = clock.getDelta();
        update(dt);
        renderer.render(scene, camera);
    }

    /* ══════════════════════════════
       INPUT
       ══════════════════════════════ */
    function onKeyDown(e) {
        keys[e.code] = true;
        if (gameActive && e.code.startsWith("Arrow")) e.preventDefault();
        if (e.code === "KeyF") toggleFullscreen();
    }
    function onKeyUp(e) { keys[e.code] = false; }
    function onMouseDown(e) { if (e.button === 0) mouseDown = true; }
    function onMouseUp(e) { if (e.button === 0) mouseDown = false; }

    /* ══════════════════════════════
       PUBLIC API
       ══════════════════════════════ */
    window.NierHackGame = {
        init: function () {
            canvas = document.getElementById("nier-hack-canvas");
            overlay = document.getElementById("nier-hack-overlay");
            hudHealth = document.getElementById("nh-health");
            hudHealthBar = document.getElementById("nh-health-bar");
            hudScore = document.getElementById("nh-score");
            hudLevel = document.getElementById("nh-level");
            hudEnemies = document.getElementById("nh-enemies");
            hudLevelName = document.getElementById("nh-level-name");
            fullscreenBtn = document.getElementById("nh-fullscreen");

            if (!canvas) { console.error("[NierHack] Canvas not found"); return; }
            console.log("[NierHack] init() called, renderer=", !!renderer);

            if (!renderer) {
                initScene();
                if (!sceneReady) { console.error("[NierHack] Scene failed to init, aborting"); return; }
                createPlayer();

                document.addEventListener("keydown", onKeyDown);
                document.addEventListener("keyup", onKeyUp);
                canvas.addEventListener("mousedown", onMouseDown);
                canvas.addEventListener("mouseup", onMouseUp);
                canvas.addEventListener("mouseleave", onMouseUp);
                canvas.addEventListener("contextmenu", function(e) { e.preventDefault(); });

                window.addEventListener("resize", function() { if (isFullscreen) resizeRenderer(); });
                document.addEventListener("fullscreenchange", function() {
                    if (!document.fullscreenElement) { isFullscreen = false; if(fullscreenBtn) fullscreenBtn.textContent = "⤒"; resizeRenderer(); }
                });

                // Fullscreen button
                if (fullscreenBtn) fullscreenBtn.addEventListener("click", function(e) { e.stopPropagation(); toggleFullscreen(); });
            }

            currentLevel = 0;
            score = 0;
            mouseDown = false;

            showOverlay("HACKING INITIATED", "Breach the firewall — destroy all enemy cores", "START", function() {
                console.log("[NierHack] START clicked!");
                startLevel();
                if (!animFrameId) animate();
            });

            if (!animFrameId) animate();
        },

        toggle: function () {
            var isNier = document.documentElement.getAttribute("data-theme") === "nier";
            if (isNier) this.init();
            else this.destroy();
        },

        destroy: function () {
            gameActive = false;
            if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
            mouseDown = false;
            for (var k in keys) keys[k] = false;
            if (sceneReady) {
                clearBulletsAndParticles();
                enemies.forEach(function(e) { scene.remove(e.mesh); e.mesh.traverse(function(c) { if(c.geometry)c.geometry.dispose(); if(c.material)c.material.dispose(); }); });
                enemies = [];
                clearMazeMeshes();
            }
            hideOverlay();
        },
    };
})();
