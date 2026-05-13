/* ═══════════════════════════════════════════════════════════════
   NIER AUTOMATA HACKING GAME  –  Three.js Twin-Stick Shooter
   ═══════════════════════════════════════════════════════════════
   Controls:
     WASD        → Move the ship
     Arrow Keys  → Aim / rotate the ship
     Left Click  → Shoot
   ═══════════════════════════════════════════════════════════════ */

(function () {
    "use strict";

    /* ── Constants ── */
    const MAZE_W = 18, MAZE_H = 14;
    const CELL = 1.8;
    const HALF = CELL / 2;
    const WALL_H = 1.2;
    const PLAYER_SPEED = 5.5;
    const BULLET_SPEED = 12;
    const ENEMY_BULLET_SPEED = 4.5;
    const SHOOT_COOLDOWN = 0.12;        // seconds between shots
    const MAX_HP = 100;
    const INVULN_TIME = 0.6;            // invulnerability after hit

    /* ── Level definitions ── */
    const LEVELS = [
        { name:"SECTOR A", enemies:3,  hpMul:1,   spdMul:1,   shootRate:2.5, patterns:["aimed"] },
        { name:"SECTOR B", enemies:4,  hpMul:1.2, spdMul:1.1, shootRate:2.2, patterns:["aimed","burst"] },
        { name:"SECTOR C", enemies:5,  hpMul:1.4, spdMul:1.2, shootRate:2.0, patterns:["aimed","burst","ring"] },
        { name:"SECTOR D", enemies:5,  hpMul:1.7, spdMul:1.3, shootRate:1.8, patterns:["aimed","burst","ring"] },
        { name:"SECTOR E", enemies:6,  hpMul:2.0, spdMul:1.4, shootRate:1.6, patterns:["aimed","burst","ring","spiral"] },
        { name:"SECTOR F", enemies:7,  hpMul:2.3, spdMul:1.5, shootRate:1.4, patterns:["aimed","ring","spiral","wall"] },
        { name:"SECTOR G", enemies:8,  hpMul:2.8, spdMul:1.7, shootRate:1.2, patterns:["aimed","burst","ring","spiral","wall"] },
        { name:"SECTOR Ω", enemies:10, hpMul:3.5, spdMul:2.0, shootRate:1.0, patterns:["aimed","burst","ring","spiral","wall"] },
    ];

    /* ── State ── */
    let scene, camera, renderer, clock;
    let playerGroup, playerPos, playerAngle, playerHP;
    let mazeGrid, wallMeshes, floorMesh;
    let enemies = [], playerBullets = [], enemyBullets = [], particles = [];
    let currentLevel = 0, score = 0, invulnTimer = 0, shootTimer = 0;
    let gameActive = false, gamePaused = false;
    let animFrameId = null;

    /* ── Input ── */
    const keys = {};
    let mouseDown = false;

    /* ── Object pools (reduce GC) ── */
    const _v2 = () => ({ x: 0, z: 0 });
    const _vec3Tmp = { x: 0, z: 0 };

    /* ── DOM refs ── */
    let canvas, overlay, hudHealth, hudHealthBar, hudScore, hudLevel, hudEnemies, hudLevelName;

    /* ══════════════════════════════
       MAZE GENERATION (DFS)
       ══════════════════════════════ */
    function generateMaze(w, h) {
        // Each cell has walls: top, right, bottom, left
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
        // Open some extra walls for wider play areas (remove ~25% of remaining internal walls)
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (Math.random() < 0.25) {
                    if (x < w - 1 && grid[y][x].right) { grid[y][x].right = false; grid[y][x + 1].left = false; }
                    if (y < h - 1 && grid[y][x].bottom) { grid[y][x].bottom = false; grid[y + 1][x].top = false; }
                }
            }
        }
        return grid;
    }

    /* Convert maze cell to world position (center of cell) */
    function cellToWorld(cx, cy) {
        return { x: cx * CELL + HALF, z: cy * CELL + HALF };
    }

    /* ══════════════════════════════
       THREE.JS SCENE SETUP
       ══════════════════════════════ */
    function initScene() {
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0xE0E0E0);
        scene.fog = new THREE.Fog(0xE0E0E0, 20, 40);

        // Orthographic camera (isometric-ish)
        const aspect = 960 / 540;
        const size = 12;
        camera = new THREE.OrthographicCamera(-size * aspect, size * aspect, size, -size, 0.1, 100);
        camera.position.set(15, 20, 15);
        camera.lookAt(15, 0, 12);

        renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(960, 540);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // Lights
        const amb = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(amb);
        const dir = new THREE.DirectionalLight(0xffffff, 0.7);
        dir.position.set(10, 20, 10);
        dir.castShadow = true;
        dir.shadow.mapSize.set(1024, 1024);
        dir.shadow.camera.left = -30; dir.shadow.camera.right = 30;
        dir.shadow.camera.top = 30; dir.shadow.camera.bottom = -30;
        scene.add(dir);

        clock = new THREE.Clock();
    }

    /* ══════════════════════════════
       BUILD MAZE MESHES
       ══════════════════════════════ */
    function buildMaze() {
        // Clear old
        wallMeshes.forEach(m => scene.remove(m));
        wallMeshes = [];
        if (floorMesh) scene.remove(floorMesh);

        // Floor
        const floorGeo = new THREE.PlaneGeometry(MAZE_W * CELL, MAZE_H * CELL);
        const floorMat = new THREE.MeshLambertMaterial({ color: 0xD8D8D8 });
        floorMesh = new THREE.Mesh(floorGeo, floorMat);
        floorMesh.rotation.x = -Math.PI / 2;
        floorMesh.position.set(MAZE_W * CELL / 2, 0, MAZE_H * CELL / 2);
        floorMesh.receiveShadow = true;
        scene.add(floorMesh);

        // Grid lines on floor
        const gridHelper = new THREE.GridHelper(Math.max(MAZE_W, MAZE_H) * CELL, Math.max(MAZE_W, MAZE_H), 0xC8C8C8, 0xD0D0D0);
        gridHelper.position.set(MAZE_W * CELL / 2, 0.01, MAZE_H * CELL / 2);
        scene.add(gridHelper);
        wallMeshes.push(gridHelper);

        // Walls — use instanced mesh for performance
        // First count walls
        let wallCount = 0;
        for (let y = 0; y < MAZE_H; y++) {
            for (let x = 0; x < MAZE_W; x++) {
                const c = mazeGrid[y][x];
                if (c.top) wallCount++;
                if (c.right && x === MAZE_W - 1) wallCount++;
                if (c.bottom && y === MAZE_H - 1) wallCount++;
                if (c.left && x === 0) wallCount++;
                // Internal walls: only draw top and left to avoid doubles
                if (c.top) wallCount++;
                if (c.left) wallCount++;
            }
        }
        // Simpler: draw each wall segment as a thin box
        const wallMat = new THREE.MeshLambertMaterial({ color: 0xF0F0F0 });
        const wallGeo = new THREE.BoxGeometry(CELL, WALL_H, 0.15);
        // Vertical wall geo
        const vWallGeo = new THREE.BoxGeometry(0.15, WALL_H, CELL);

        for (let y = 0; y < MAZE_H; y++) {
            for (let x = 0; x < MAZE_W; x++) {
                const c = mazeGrid[y][x];
                const wx = x * CELL;
                const wz = y * CELL;

                // Top wall (horizontal, at z = wy)
                if (c.top) {
                    const m = new THREE.Mesh(wallGeo, wallMat);
                    m.position.set(wx + HALF, WALL_H / 2, wz);
                    m.castShadow = true;
                    m.receiveShadow = true;
                    scene.add(m);
                    wallMeshes.push(m);
                }
                // Left wall (vertical, at x = wx)
                if (c.left) {
                    const m = new THREE.Mesh(vWallGeo, wallMat);
                    m.position.set(wx, WALL_H / 2, wz + HALF);
                    m.castShadow = true;
                    m.receiveShadow = true;
                    scene.add(m);
                    wallMeshes.push(m);
                }
                // Bottom wall (only for last row)
                if (y === MAZE_H - 1 && c.bottom) {
                    const m = new THREE.Mesh(wallGeo, wallMat);
                    m.position.set(wx + HALF, WALL_H / 2, wz + CELL);
                    m.castShadow = true;
                    scene.add(m);
                    wallMeshes.push(m);
                }
                // Right wall (only for last column)
                if (x === MAZE_W - 1 && c.right) {
                    const m = new THREE.Mesh(vWallGeo, wallMat);
                    m.position.set(wx + CELL, WALL_H / 2, wz + HALF);
                    m.castShadow = true;
                    scene.add(m);
                    wallMeshes.push(m);
                }
            }
        }
    }

    /* ══════════════════════════════
       PLAYER (SPACESHIP)
       ══════════════════════════════ */
    function createPlayer() {
        if (playerGroup) scene.remove(playerGroup);

        playerGroup = new THREE.Group();

        // Main body — elongated diamond/arrow shape
        const bodyShape = new THREE.Shape();
        bodyShape.moveTo(0, 0.45);       // nose
        bodyShape.lineTo(0.2, 0.05);     // right wing front
        bodyShape.lineTo(0.28, -0.35);   // right wing tip
        bodyShape.lineTo(0.08, -0.15);   // right wing inner
        bodyShape.lineTo(0, -0.25);      // tail center
        bodyShape.lineTo(-0.08, -0.15);  // left wing inner
        bodyShape.lineTo(-0.28, -0.35);  // left wing tip
        bodyShape.lineTo(-0.2, 0.05);    // left wing front
        bodyShape.closePath();

        const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, {
            depth: 0.12,
            bevelEnabled: true,
            bevelThickness: 0.02,
            bevelSize: 0.02,
            bevelSegments: 1,
        });
        const bodyMat = new THREE.MeshPhongMaterial({
            color: 0xFFFFFF,
            emissive: 0x222222,
            shininess: 80,
            specular: 0x444444,
        });
        const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
        bodyMesh.rotation.x = -Math.PI / 2;
        bodyMesh.position.y = 0.08;
        bodyMesh.castShadow = true;
        playerGroup.add(bodyMesh);

        // Engine glow
        const glowGeo = new THREE.CircleGeometry(0.1, 8);
        const glowMat = new THREE.MeshBasicMaterial({ color: 0xC4362B, transparent: true, opacity: 0.7 });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        glow.rotation.x = -Math.PI / 2;
        glow.position.set(0, 0.06, 0.15);
        playerGroup.add(glow);
        playerGroup.userData.glow = glow;

        scene.add(playerGroup);
    }

    /* ══════════════════════════════
       ENEMIES
       ══════════════════════════════ */
    function createEnemyMesh(type) {
        const group = new THREE.Group();
        let coreMesh;

        if (type === "core") {
            // Main core — pulsating sphere
            const coreGeo = new THREE.SphereGeometry(0.3, 12, 8);
            const coreMat = new THREE.MeshPhongMaterial({
                color: 0x1A1A1A,
                emissive: 0xC4362B,
                emissiveIntensity: 0.3,
                shininess: 60,
            });
            coreMesh = new THREE.Mesh(coreGeo, coreMat);
            coreMesh.position.y = 0.5;
            coreMesh.castShadow = true;
            group.add(coreMesh);

            // Ring around core
            const ringGeo = new THREE.TorusGeometry(0.45, 0.03, 8, 24);
            const ringMat = new THREE.MeshBasicMaterial({ color: 0xC4362B, transparent: true, opacity: 0.6 });
            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.rotation.x = Math.PI / 2;
            ring.position.y = 0.5;
            group.add(ring);
            group.userData.ring = ring;
        } else {
            // Square enemy
            const sqGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
            const sqMat = new THREE.MeshPhongMaterial({
                color: 0x1A1A1A,
                emissive: 0x3A6EA5,
                emissiveIntensity: 0.2,
            });
            coreMesh = new THREE.Mesh(sqGeo, sqMat);
            coreMesh.position.y = 0.4;
            coreMesh.castShadow = true;
            group.add(coreMesh);
        }

        group.userData.coreMesh = coreMesh;
        return group;
    }

    function spawnEnemies() {
        enemies.forEach(e => scene.remove(e.mesh));
        enemies = [];

        const lvl = LEVELS[currentLevel];
        const cells = [];

        // Get open cells (not near player start)
        for (let y = 0; y < MAZE_H; y++) {
            for (let x = 0; x < MAZE_W; x++) {
                if (x <= 2 && y <= 2) continue; // player start area
                cells.push({ x, y });
            }
        }

        // Shuffle
        for (let i = cells.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [cells[i], cells[j]] = [cells[j], cells[i]];
        }

        const count = Math.min(lvl.enemies, cells.length);
        for (let i = 0; i < count; i++) {
            const type = i === 0 ? "core" : "square";
            const mesh = createEnemyMesh(type);
            const pos = cellToWorld(cells[i].x, cells[i].y);
            mesh.position.set(pos.x, 0, pos.z);
            scene.add(mesh);

            const hp = Math.round((type === "core" ? 15 : 8) * lvl.hpMul);
            enemies.push({
                mesh,
                type,
                hp,
                maxHp: hp,
                pos: { x: pos.x, z: pos.z },
                speed: (0.8 + Math.random() * 0.4) * lvl.spdMul,
                moveDir: { x: 0, z: 0 },
                moveTimer: 0,
                shootTimer: Math.random() * lvl.shootRate,
                shootRate: lvl.shootRate,
                pattern: lvl.patterns[Math.floor(Math.random() * lvl.patterns.length)],
                patternTimer: 0,
                pulsePhase: Math.random() * Math.PI * 2,
            });
        }
    }

    /* ══════════════════════════════
       BULLETS
       ══════════════════════════════ */
    function createBulletMesh(color) {
        const geo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
        const mat = new THREE.MeshBasicMaterial({ color });
        return new THREE.Mesh(geo, mat);
    }

    function spawnPlayerBullet() {
        const mesh = createBulletMesh(0xFFFFFF);
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
        const mesh = createBulletMesh(0xFF3333);
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
        for (let i = 0; i < count; i++) {
            const geo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
            const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(x, 0.3 + Math.random() * 0.3, z);
            scene.add(mesh);
            const angle = Math.random() * Math.PI * 2;
            const spd = 1 + Math.random() * 3;
            particles.push({
                mesh,
                vx: Math.sin(angle) * spd,
                vy: 1 + Math.random() * 2,
                vz: Math.cos(angle) * spd,
                life: 0.4 + Math.random() * 0.4,
                maxLife: 0.4 + Math.random() * 0.4,
            });
        }
    }

    /* ══════════════════════════════
       COLLISION HELPERS
       ══════════════════════════════ */
    function isWallAt(wx, wz) {
        const cx = Math.floor(wx / CELL);
        const cz = Math.floor(wz / CELL);
        if (cx < 0 || cx >= MAZE_W || cz < 0 || cz >= MAZE_H) return true;
        // Check local position within cell
        const lx = wx - cx * CELL;
        const lz = wz - cz * CELL;
        const cell = mazeGrid[cz][cx];
        const margin = 0.15;
        if (lz < margin && cell.top) return true;
        if (lz > CELL - margin && cell.bottom) return true;
        if (lx < margin && cell.left) return true;
        if (lx > CELL - margin && cell.right) return true;
        return false;
    }

    function dist2d(ax, az, bx, bz) {
        const dx = ax - bx, dz = az - bz;
        return Math.sqrt(dx * dx + dz * dz);
    }

    /* ══════════════════════════════
       ENEMY AI & SHOOTING PATTERNS
       ══════════════════════════════ */
    function enemyShoot(enemy) {
        const ex = enemy.pos.x, ez = enemy.pos.z;
        const angle = Math.atan2(playerPos.x - ex, -(playerPos.z - ez));

        switch (enemy.pattern) {
            case "aimed": {
                spawnEnemyBullet(ex, ez, angle, ENEMY_BULLET_SPEED);
                break;
            }
            case "burst": {
                for (let i = -1; i <= 1; i++) {
                    spawnEnemyBullet(ex, ez, angle + i * 0.15, ENEMY_BULLET_SPEED);
                }
                break;
            }
            case "ring": {
                const count = 8 + currentLevel * 2;
                for (let i = 0; i < count; i++) {
                    const a = (i / count) * Math.PI * 2;
                    spawnEnemyBullet(ex, ez, a, ENEMY_BULLET_SPEED * 0.7);
                }
                break;
            }
            case "spiral": {
                for (let i = 0; i < 5; i++) {
                    const a = angle + i * 0.4;
                    spawnEnemyBullet(ex, ez, a, ENEMY_BULLET_SPEED * 0.8);
                }
                break;
            }
            case "wall": {
                const perpAngle = angle + Math.PI / 2;
                for (let i = -3; i <= 3; i++) {
                    const ox = ex + Math.sin(perpAngle) * i * 0.35;
                    const oz = ez - Math.cos(perpAngle) * i * 0.35;
                    spawnEnemyBullet(ox, oz, angle, ENEMY_BULLET_SPEED * 0.6);
                }
                break;
            }
        }
    }

    function updateEnemies(dt) {
        for (const e of enemies) {
            // Pulse animation
            e.pulsePhase += dt * 3;
            if (e.mesh.userData.coreMesh) {
                const s = 1 + Math.sin(e.pulsePhase) * 0.08;
                e.mesh.userData.coreMesh.scale.set(s, s, s);
            }
            if (e.mesh.userData.ring) {
                e.mesh.userData.ring.rotation.z += dt * 2;
            }

            // Movement — simple wander with wall avoidance
            e.moveTimer -= dt;
            if (e.moveTimer <= 0) {
                const toPlayer = Math.atan2(playerPos.x - e.pos.x, -(playerPos.z - e.pos.z));
                // Mix: 60% toward player, 40% random
                if (Math.random() < 0.6) {
                    e.moveDir = { x: Math.sin(toPlayer), z: -Math.cos(toPlayer) };
                } else {
                    const ra = Math.random() * Math.PI * 2;
                    e.moveDir = { x: Math.sin(ra), z: -Math.cos(ra) };
                }
                e.moveTimer = 0.5 + Math.random() * 1.5;
            }

            const nx = e.pos.x + e.moveDir.x * e.speed * dt;
            const nz = e.pos.z + e.moveDir.z * e.speed * dt;
            if (!isWallAt(nx, nz)) {
                e.pos.x = nx;
                e.pos.z = nz;
            } else {
                e.moveTimer = 0; // change direction immediately
            }
            e.mesh.position.set(e.pos.x, 0, e.pos.z);

            // Shooting
            e.shootTimer -= dt;
            if (e.shootTimer <= 0) {
                enemyShoot(e);
                e.shootTimer = e.shootRate * (0.8 + Math.random() * 0.4);
            }
        }
    }

    /* ══════════════════════════════
       UPDATE LOOP
       ══════════════════════════════ */
    function update(dt) {
        if (!gameActive || gamePaused) return;

        dt = Math.min(dt, 0.05); // clamp to avoid large jumps

        /* ── Player movement (WASD) ── */
        let dx = 0, dz = 0;
        if (keys["KeyW"] || keys["KeyZ"]) dz = -1;
        if (keys["KeyS"]) dz = 1;
        if (keys["KeyA"] || keys["KeyQ"]) dx = -1;
        if (keys["KeyD"]) dx = 1;

        if (dx !== 0 || dz !== 0) {
            const len = Math.sqrt(dx * dx + dz * dz);
            dx /= len; dz /= len;
            const nx = playerPos.x + dx * PLAYER_SPEED * dt;
            const nz = playerPos.z + dz * PLAYER_SPEED * dt;
            // Try X then Z separately for wall sliding
            if (!isWallAt(nx, playerPos.z)) playerPos.x = nx;
            if (!isWallAt(playerPos.x, nz)) playerPos.z = nz;
        }

        /* ── Aim with arrow keys ── */
        let aimX = 0, aimZ = 0;
        if (keys["ArrowUp"])    aimZ = -1;
        if (keys["ArrowDown"])  aimZ = 1;
        if (keys["ArrowLeft"])  aimX = -1;
        if (keys["ArrowRight"]) aimX = 1;

        if (aimX !== 0 || aimZ !== 0) {
            playerAngle = Math.atan2(aimX, -aimZ);
        }

        playerGroup.position.set(playerPos.x, 0, playerPos.z);
        playerGroup.rotation.y = playerAngle;

        // Engine glow pulse
        if (playerGroup.userData.glow) {
            const glowMat = playerGroup.userData.glow.material;
            glowMat.opacity = 0.5 + Math.sin(clock.elapsedTime * 8) * 0.3;
        }

        // Invulnerability flash
        if (invulnTimer > 0) {
            invulnTimer -= dt;
            playerGroup.visible = Math.floor(invulnTimer * 10) % 2 === 0;
        } else {
            playerGroup.visible = true;
        }

        /* ── Shoot (left click) ── */
        shootTimer -= dt;
        if (mouseDown && shootTimer <= 0) {
            spawnPlayerBullet();
            shootTimer = SHOOT_COOLDOWN;
        }

        /* ── Update player bullets ── */
        for (let i = playerBullets.length - 1; i >= 0; i--) {
            const b = playerBullets[i];
            b.mesh.position.x += b.vx * dt;
            b.mesh.position.z += b.vz * dt;
            b.life -= dt;

            // Wall collision
            if (isWallAt(b.mesh.position.x, b.mesh.position.z) || b.life <= 0) {
                if (b.life > 0) spawnParticles(b.mesh.position.x, b.mesh.position.z, 0xAAAAAA, 3);
                scene.remove(b.mesh);
                b.mesh.geometry.dispose();
                b.mesh.material.dispose();
                playerBullets.splice(i, 1);
                continue;
            }

            // Enemy collision
            let hit = false;
            for (let j = enemies.length - 1; j >= 0; j--) {
                const e = enemies[j];
                if (dist2d(b.mesh.position.x, b.mesh.position.z, e.pos.x, e.pos.z) < 0.45) {
                    e.hp--;
                    spawnParticles(e.pos.x, e.pos.z, 0xFFFFFF, 4);
                    if (e.hp <= 0) {
                        spawnParticles(e.pos.x, e.pos.z, 0xC4362B, 12);
                        scene.remove(e.mesh);
                        // Dispose enemy meshes
                        e.mesh.traverse(child => {
                            if (child.geometry) child.geometry.dispose();
                            if (child.material) child.material.dispose();
                        });
                        score += e.type === "core" ? 500 : 200;
                        enemies.splice(j, 1);
                    }
                    scene.remove(b.mesh);
                    b.mesh.geometry.dispose();
                    b.mesh.material.dispose();
                    playerBullets.splice(i, 1);
                    hit = true;
                    break;
                }
            }
            if (hit) continue;
        }

        /* ── Update enemy bullets ── */
        for (let i = enemyBullets.length - 1; i >= 0; i--) {
            const b = enemyBullets[i];
            b.mesh.position.x += b.vx * dt;
            b.mesh.position.z += b.vz * dt;
            b.life -= dt;

            if (isWallAt(b.mesh.position.x, b.mesh.position.z) || b.life <= 0) {
                scene.remove(b.mesh);
                b.mesh.geometry.dispose();
                b.mesh.material.dispose();
                enemyBullets.splice(i, 1);
                continue;
            }

            // Player collision
            if (invulnTimer <= 0 && dist2d(b.mesh.position.x, b.mesh.position.z, playerPos.x, playerPos.z) < 0.35) {
                playerHP -= 10;
                invulnTimer = INVULN_TIME;
                spawnParticles(playerPos.x, playerPos.z, 0xC4362B, 6);
                scene.remove(b.mesh);
                b.mesh.geometry.dispose();
                b.mesh.material.dispose();
                enemyBullets.splice(i, 1);
                if (playerHP <= 0) {
                    playerHP = 0;
                    gameOver();
                    return;
                }
                continue;
            }
        }

        /* ── Update particles ── */
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.mesh.position.x += p.vx * dt;
            p.mesh.position.y += p.vy * dt;
            p.mesh.position.z += p.vz * dt;
            p.vy -= 6 * dt; // gravity
            p.life -= dt;
            p.mesh.material.opacity = Math.max(0, p.life / p.maxLife);
            if (p.life <= 0) {
                scene.remove(p.mesh);
                p.mesh.geometry.dispose();
                p.mesh.material.dispose();
                particles.splice(i, 1);
            }
        }

        /* ── Update enemies ── */
        updateEnemies(dt);

        /* ── Check level clear ── */
        if (enemies.length === 0) {
            levelClear();
            return;
        }

        /* ── Update HUD ── */
        updateHUD();
    }

    /* ══════════════════════════════
       HUD
       ══════════════════════════════ */
    function updateHUD() {
        hudHealth.textContent = playerHP + "%";
        hudHealthBar.style.width = playerHP + "%";
        hudHealthBar.className = "health-bar-inner" + (playerHP < 30 ? " danger" : "");
        hudScore.textContent = score;
        hudLevel.textContent = (currentLevel + 1) + " / " + LEVELS.length;
        hudEnemies.textContent = enemies.length;
        hudLevelName.textContent = LEVELS[currentLevel].name;
    }

    /* ══════════════════════════════
       GAME STATE TRANSITIONS
       ══════════════════════════════ */
    function showOverlay(title, sub, btnText, callback) {
        overlay.innerHTML = `
            <div class="overlay-title">${title}</div>
            <div class="overlay-sub">${sub}</div>
            ${score > 0 ? `<div class="overlay-score">SCORE: ${score}</div>` : ""}
            <button class="overlay-btn">${btnText}</button>
        `;
        overlay.classList.remove("hidden");
        const btn = overlay.querySelector(".overlay-btn");
        btn.addEventListener("click", callback);
    }

    function hideOverlay() {
        overlay.classList.add("hidden");
        overlay.innerHTML = "";
    }

    function startLevel() {
        // Clear old objects
        clearBulletsAndParticles();
        enemies.forEach(e => {
            scene.remove(e.mesh);
            e.mesh.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
        });
        enemies = [];

        // Generate maze and build
        mazeGrid = generateMaze(MAZE_W, MAZE_H);
        buildMaze();

        // Reset player
        playerPos = cellToWorld(1, 1);
        playerAngle = 0;
        playerHP = MAX_HP;
        invulnTimer = 0;
        shootTimer = 0;
        playerGroup.position.set(playerPos.x, 0, playerPos.z);
        playerGroup.rotation.y = 0;
        playerGroup.visible = true;

        // Spawn enemies
        spawnEnemies();

        // Update camera to center on maze
        const cx = MAZE_W * CELL / 2;
        const cz = MAZE_H * CELL / 2;
        camera.position.set(cx + 8, 22, cz + 8);
        camera.lookAt(cx, 0, cz);

        gameActive = true;
        gamePaused = false;
        hideOverlay();
        updateHUD();
    }

    function levelClear() {
        gameActive = false;
        if (currentLevel < LEVELS.length - 1) {
            showOverlay(
                "SECTOR CLEARED",
                `${LEVELS[currentLevel].name} cleared — ${enemies.length === 0 ? "all enemies destroyed" : "complete"}`,
                "NEXT SECTOR",
                () => {
                    currentLevel++;
                    startLevel();
                }
            );
        } else {
            showOverlay(
                "HACK COMPLETE",
                "All sectors cleared — system compromised",
                "PLAY AGAIN",
                () => {
                    currentLevel = 0;
                    score = 0;
                    startLevel();
                }
            );
        }
    }

    function gameOver() {
        gameActive = false;
        showOverlay(
            "CONNECTION LOST",
            "Signal terminated — hack failed",
            "RETRY",
            () => {
                startLevel();
            }
        );
    }

    function clearBulletsAndParticles() {
        playerBullets.forEach(b => { scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); });
        playerBullets = [];
        enemyBullets.forEach(b => { scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); });
        enemyBullets = [];
        particles.forEach(p => { scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); });
        particles = [];
    }

    /* ══════════════════════════════
       RENDER LOOP
       ══════════════════════════════ */
    function animate() {
        animFrameId = requestAnimationFrame(animate);
        const dt = clock.getDelta();
        update(dt);
        renderer.render(scene, camera);
    }

    /* ══════════════════════════════
       INPUT HANDLING
       ══════════════════════════════ */
    function onKeyDown(e) {
        keys[e.code] = true;
        // Prevent page scroll with arrow keys when game is active
        if (gameActive && e.code.startsWith("Arrow")) e.preventDefault();
    }
    function onKeyUp(e) {
        keys[e.code] = false;
    }
    function onMouseDown(e) {
        if (e.button === 0) mouseDown = true;
    }
    function onMouseUp(e) {
        if (e.button === 0) mouseDown = false;
    }

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

            if (!canvas) return;

            if (!renderer) {
                initScene();
                createPlayer();

                // Input listeners
                document.addEventListener("keydown", onKeyDown);
                document.addEventListener("keyup", onKeyUp);
                canvas.addEventListener("mousedown", onMouseDown);
                canvas.addEventListener("mouseup", onMouseUp);
                canvas.addEventListener("mouseleave", onMouseUp);
                // Prevent context menu on right click
                canvas.addEventListener("contextmenu", e => e.preventDefault());
            }

            // Reset state
            currentLevel = 0;
            score = 0;

            // Show start overlay
            showOverlay(
                "HACKING INITIATED",
                "Breach the firewall — destroy all enemy cores",
                "START",
                () => {
                    startLevel();
                    if (!animFrameId) animate();
                }
            );

            if (!animFrameId) animate();
        },

        toggle: function () {
            const section = document.getElementById("nier-hack-section");
            if (!section) return;
            const isNier = document.documentElement.getAttribute("data-theme") === "nier";
            if (isNier) {
                this.init();
            } else {
                this.destroy();
            }
        },

        destroy: function () {
            gameActive = false;
            if (animFrameId) {
                cancelAnimationFrame(animFrameId);
                animFrameId = null;
            }
            mouseDown = false;
            // Clear all keys
            for (const k in keys) keys[k] = false;

            // Clean up scene objects
            clearBulletsAndParticles();
            enemies.forEach(e => {
                scene.remove(e.mesh);
                e.mesh.traverse(child => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) child.material.dispose();
                });
            });
            enemies = [];
            wallMeshes.forEach(m => {
                scene.remove(m);
                if (m.geometry) m.geometry.dispose();
                if (m.material) m.material.dispose();
            });
            wallMeshes = [];
            if (floorMesh) {
                scene.remove(floorMesh);
                floorMesh.geometry.dispose();
                floorMesh.material.dispose();
                floorMesh = null;
            }

            hideOverlay();
        },
    };
})();
