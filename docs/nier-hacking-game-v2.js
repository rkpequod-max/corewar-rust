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
    const MAZE_W = 16, MAZE_H = 12;
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
    const C_RING     = 0xFFFFFF;
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
    let playerMesh, playerPos = {x:0,z:0}, playerAngle = 0, playerHP = MAX_HP;
    let mazeGrid = null;
    let wallMeshes = [], floorMesh = null, gridGroup = null;
    let enemies = [], pBullets = [], eBullets = [], particles = [];
    let curLvl = 0, score = 0, invulnT = 0, shootT = 0;
    let active = false, paused = false, rafId = null;
    let isFS = false, sceneOK = false;
    let screenFlash = 0;
    let shakeAmount = 0;
    const keys = {};
    let mouseDown = false;

    /* Shared geos & mats */
    let geoBullet, matPBullet, matEBullet, geoParticle;
    let geoWallH, geoWallV, matWall;
    let geoPlayer;

    /* DOM */
    let canvas, overlay, hudHP, hudBar, hudScore, hudLvl, hudEnm, hudName, fsBtn, flashEl;
    let pauseMenu, pauseItems, pauseIdx = 0;
    let pauseWasActive = false;

    /* ══════════════ MAZE ══════════════ */
    function genMaze(w, h) {
        const g = [];
        for (let y = 0; y < h; y++) { g[y]=[]; for (let x = 0; x < w; x++) g[y][x]={t:true,r:true,b:true,l:true,v:false}; }
        const stk = [{x:0,y:0}]; g[0][0].v=true;
        const ds=[{dx:0,dy:-1,w:"t",o:"b"},{dx:1,dy:0,w:"r",o:"l"},{dx:0,dy:1,w:"b",o:"t"},{dx:-1,dy:0,w:"l",o:"r"}];
        while(stk.length){
            const c=stk[stk.length-1], nb=[];
            for(const d of ds){const nx=c.x+d.dx,ny=c.y+d.dy;if(nx>=0&&nx<w&&ny>=0&&ny<h&&!g[ny][nx].v)nb.push({x:nx,y:ny,w:d.w,o:d.o});}
            if(!nb.length){stk.pop();continue;}
            const n=nb[Math.floor(Math.random()*nb.length)];
            g[c.y][c.x][n.w]=false; g[n.y][n.x][n.o]=false; g[n.y][n.x].v=true; stk.push({x:n.x,y:n.y});
        }
        for(let y=0;y<h;y++) for(let x=0;x<w;x++) if(Math.random()<0.30){
            if(x<w-1&&g[y][x].r){g[y][x].r=false;g[y][x+1].l=false;}
            if(y<h-1&&g[y][x].b){g[y][x].b=false;g[y+1][x].t=false;}
        }
        return g;
    }
    function c2w(cx,cy){return{x:cx*CELL+HALF,z:cy*CELL+HALF};}

    /* ══════════════ SCENE ══════════════ */
    function initScene(){
        try {
            scene = new THREE.Scene();
            scene.background = new THREE.Color(C_BG);
            /* No fog — flat 2D look, no halo */

            /* Top-down camera */
            const aspect = 960/540;
            const sz = 10;
            camera = new THREE.OrthographicCamera(-sz*aspect, sz*aspect, sz, -sz, 0.1, 100);
            camera.position.set(MAZE_W*CELL/2, 30, MAZE_H*CELL/2);
            camera.lookAt(MAZE_W*CELL/2, 0, MAZE_H*CELL/2);

            renderer = new THREE.WebGLRenderer({canvas:canvas, antialias:true});
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            renderer.setSize(960, 540, false);
            renderer.shadowMap.enabled = false; /* flat = no shadows */

            /* Flat lighting — ambient only for that 2D look */
            scene.add(new THREE.AmbientLight(0xFFFFFF, 1.0));
            /* No directional light — keeps the flat 2D Nier look without shadows */

            clock = new THREE.Clock();

            /* Shared resources */
            geoBullet  = new THREE.BoxGeometry(0.12, 0.12, 0.12);
            matPBullet = new THREE.MeshBasicMaterial({color:C_PBULLET});
            matEBullet = new THREE.MeshBasicMaterial({color:C_EBULLET});
            geoParticle= new THREE.BoxGeometry(0.06, 0.06, 0.06);
            geoWallH   = new THREE.BoxGeometry(CELL+0.15, 0.6, 0.15);
            geoWallV   = new THREE.BoxGeometry(0.15, 0.6, CELL+0.15);
            matWall    = new THREE.MeshBasicMaterial({color:C_WALL});

            /* Player triangle — flat shape */
            const shape = new THREE.Shape();
            shape.moveTo(0, 0.45);
            shape.lineTo(0.3, -0.3);
            shape.lineTo(0, -0.15);
            shape.lineTo(-0.3, -0.3);
            shape.closePath();
            geoPlayer = new THREE.ShapeGeometry(shape);

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
        const fg = new THREE.PlaneGeometry(MAZE_W*CELL+2, MAZE_H*CELL+2);
        const fm = new THREE.MeshBasicMaterial({color:C_BG});
        floorMesh = new THREE.Mesh(fg, fm);
        floorMesh.rotation.x=-Math.PI/2;
        floorMesh.position.set(MAZE_W*CELL/2, -0.01, MAZE_H*CELL/2);
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
            if(c.t){const m=new THREE.Mesh(geoWallH,matWall);m.position.set(wx+HALF,0.3,wz);scene.add(m);wallMeshes.push(m);}
            if(c.l){const m=new THREE.Mesh(geoWallV,matWall);m.position.set(wx,0.3,wz+HALF);scene.add(m);wallMeshes.push(m);}
            if(y===MAZE_H-1&&c.b){const m=new THREE.Mesh(geoWallH,matWall);m.position.set(wx+HALF,0.3,wz+CELL);scene.add(m);wallMeshes.push(m);}
            if(x===MAZE_W-1&&c.r){const m=new THREE.Mesh(geoWallV,matWall);m.position.set(wx+CELL,0.3,wz+HALF);scene.add(m);wallMeshes.push(m);}
        }

        /* Border */
        const bMat=new THREE.MeshBasicMaterial({color:0x808080});
        const bH=new THREE.BoxGeometry(MAZE_W*CELL+0.3,0.3,0.1);
        const bV=new THREE.BoxGeometry(0.1,0.3,MAZE_H*CELL+0.3);
        let m;
        m=new THREE.Mesh(bH,bMat);m.position.set(MAZE_W*CELL/2,0.15,-0.05);scene.add(m);wallMeshes.push(m);
        m=new THREE.Mesh(bH,bMat);m.position.set(MAZE_W*CELL/2,0.15,MAZE_H*CELL+0.05);scene.add(m);wallMeshes.push(m);
        m=new THREE.Mesh(bV,bMat);m.position.set(-0.05,0.15,MAZE_H*CELL/2);scene.add(m);wallMeshes.push(m);
        m=new THREE.Mesh(bV,bMat);m.position.set(MAZE_W*CELL+0.05,0.15,MAZE_H*CELL/2);scene.add(m);wallMeshes.push(m);
    }

    /* ══════════════ PLAYER ══════════════ */
    function createPlayer(){
        if(playerMesh)scene.remove(playerMesh);
        const mat=new THREE.MeshBasicMaterial({color:C_PLAYER, side:THREE.DoubleSide});
        playerMesh=new THREE.Mesh(geoPlayer, mat);
        playerMesh.rotation.x=-Math.PI/2;
        playerMesh.position.y=0.05;
        scene.add(playerMesh);
    }

    /* ══════════════ ENEMIES ══════════════ */
    function mkEnemy(type){
        const g=new THREE.Group();
        if(type==="core"){
            /* Black core with orange center + pulsing white rings */
            const cg=new THREE.CircleGeometry(0.25,16);
            const cm=new THREE.MeshBasicMaterial({color:C_ENEMY});
            const core=new THREE.Mesh(cg,cm);core.rotation.x=-Math.PI/2;core.position.y=0.02;g.add(core);
            g.userData.core=core;

            /* Orange center dot */
            const og=new THREE.CircleGeometry(0.1,8);
            const om=new THREE.MeshBasicMaterial({color:C_ENEMYEMT});
            const od=new THREE.Mesh(og,om);od.rotation.x=-Math.PI/2;od.position.y=0.025;g.add(od);
            g.userData.orangeDot=od;

            /* Concentric white rings */
            for(let i=0;i<3;i++){
                const rg=new THREE.RingGeometry(0.28+i*0.12, 0.30+i*0.12, 24);
                const rm=new THREE.MeshBasicMaterial({color:C_RING, transparent:true, opacity:0.5-i*0.12, side:THREE.DoubleSide});
                const ring=new THREE.Mesh(rg,rm);ring.rotation.x=-Math.PI/2;ring.position.y=0.03;g.add(ring);
            }
        } else {
            /* Black square enemy */
            const sg=new THREE.BoxGeometry(0.4,0.25,0.4);
            const sm=new THREE.MeshBasicMaterial({color:C_ENEMY});
            const sq=new THREE.Mesh(sg,sm);sq.position.y=0.12;g.add(sq);
            g.userData.core=sq;
        }
        return g;
    }

    function spawnEnemies(){
        enemies.forEach(e=>{scene.remove(e.mesh);e.mesh.traverse(c=>{if(c.geometry)c.geometry.dispose();if(c.material)c.material.dispose();});});
        enemies=[];
        const lvl=LEVELS[curLvl], cells=[];
        for(let y=0;y<MAZE_H;y++) for(let x=0;x<MAZE_W;x++) if(!(x<=2&&y<=2)) cells.push({x,y});
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
    function mkBullet(x,z,angle,speed,isPlayer){
        const mat=isPlayer?matPBullet:matEBullet;
        const m=new THREE.Mesh(geoBullet,mat);
        m.position.set(x,0.15,z);
        scene.add(m);
        const arr=isPlayer?pBullets:eBullets;
        arr.push({mesh:m,vx:Math.sin(angle)*speed,vz:-Math.cos(angle)*speed,life:3.5});
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
        const ex=e.pos.x,ez=e.pos.z,a=Math.atan2(playerPos.x-ex,-(playerPos.z-ez));
        switch(e.pat){
            case"aimed":mkBullet(ex,ez,a,ENEMY_BULLET_SPEED,false);break;
            case"burst":for(let i=-1;i<=1;i++)mkBullet(ex,ez,a+i*0.15,ENEMY_BULLET_SPEED,false);break;
            case"ring":{const n=8+curLvl*2;for(let i=0;i<n;i++)mkBullet(ex,ez,(i/n)*Math.PI*2,ENEMY_BULLET_SPEED*0.65,false);break;}
            case"spiral":for(let i=0;i<5;i++)mkBullet(ex,ez,a+i*0.4,ENEMY_BULLET_SPEED*0.8,false);break;
            case"wall":{const p=a+Math.PI/2;for(let i=-3;i<=3;i++)mkBullet(ex+Math.sin(p)*i*0.35,ez-Math.cos(p)*i*0.35,a,ENEMY_BULLET_SPEED*0.55,false);break;}
        }
    }
    function updEnemies(dt){
        for(const e of enemies){
            e.pp+=dt*4;
            /* Pulsing rings on core */
            if(e.type==="core"){
                const kids=e.mesh.children;
                for(let i=3;i<kids.length;i++){ /* ring children start at index 3 */
                    const s=1+Math.sin(e.pp+i*0.5)*0.1;
                    kids[i].scale.set(s,s,s);
                    if(kids[i].material) kids[i].material.opacity=Math.max(0,0.4-i*0.1+Math.sin(e.pp)*0.1);
                }
                /* Orange center pulse */
                if(e.mesh.userData.orangeDot){
                    const s=0.8+Math.sin(e.pp*2)*0.3;
                    e.mesh.userData.orangeDot.scale.set(s,s,s);
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

    /* ══════════════ UPDATE ══════════════ */
    function update(dt){
        if(!active||paused||!sceneOK)return;
        dt=Math.min(dt,0.05);

        /* Screen flash decay */
        if(screenFlash>0){screenFlash-=dt;if(flashEl)flashEl.style.opacity=Math.max(0,screenFlash/0.15*0.5).toString();}
        /* Shake decay */
        if(shakeAmount>0)shakeAmount*=0.9;
        if(shakeAmount<0.01)shakeAmount=0;

        /* Camera shake */
        const cx=MAZE_W*CELL/2, cz=MAZE_H*CELL/2;
        if(shakeAmount>0){
            camera.position.set(cx+(Math.random()-0.5)*shakeAmount, 30, cz+(Math.random()-0.5)*shakeAmount);
        } else {
            camera.position.set(cx, 30, cz);
        }
        camera.lookAt(cx,0,cz);

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

        playerMesh.position.set(playerPos.x,0.05,playerPos.z);
        playerMesh.rotation.z=-playerAngle;

        /* Invuln flash */
        if(invulnT>0){invulnT-=dt;playerMesh.visible=Math.floor(invulnT*12)%2===0;}
        else playerMesh.visible=true;

        /* Shoot */
        shootT-=dt;
        if(mouseDown&&shootT<=0){mkBullet(playerPos.x,playerPos.z,playerAngle,BULLET_SPEED,true);shootT=SHOOT_CD;}

        /* Player bullets */
        for(let i=pBullets.length-1;i>=0;i--){
            const b=pBullets[i];b.mesh.position.x+=b.vx*dt;b.mesh.position.z+=b.vz*dt;b.life-=dt;
            if(wallAt(b.mesh.position.x,b.mesh.position.z)||b.life<=0){
                if(b.life>0)spawnP(b.mesh.position.x,b.mesh.position.z,C_GRIDDIM,2);
                scene.remove(b.mesh);pBullets.splice(i,1);continue;}
            let hit=false;
            for(let j=enemies.length-1;j>=0;j--){
                const e=enemies[j];
                if(d2(b.mesh.position.x,b.mesh.position.z,e.pos.x,e.pos.z)<0.4){
                    e.hp--;spawnP(e.pos.x,e.pos.z,C_PARTICLE,3);
                    /* Flash core white on hit */
                    if(e.mesh.userData.core){e.mesh.userData.core.material.color.setHex(0xFFFFFF);setTimeout(()=>{if(e.mesh.userData.core)e.mesh.userData.core.material.color.setHex(C_ENEMY);},60);}
                    if(e.hp<=0){
                        spawnP(e.pos.x,e.pos.z,C_ENEMYEMT,10);spawnP(e.pos.x,e.pos.z,C_PARTICLE,8);
                        scene.remove(e.mesh);e.mesh.traverse(c=>{if(c.geometry)c.geometry.dispose();if(c.material)c.material.dispose();});
                        score+=e.type==="core"?500:200;enemies.splice(j,1);
                    }
                    scene.remove(b.mesh);pBullets.splice(i,1);hit=true;break;
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
                flashScreen(); shake(0.3);
                scene.remove(b.mesh);eBullets.splice(i,1);
                if(playerHP<=0){playerHP=0;gameOver();return;}
                continue;
            }
        }

        /* Particles */
        for(let i=particles.length-1;i>=0;i--){
            const p=particles[i];
            p.mesh.position.x+=p.vx*dt;p.mesh.position.y+=p.vy*dt;p.mesh.position.z+=p.vz*dt;
            p.vy-=5*dt;p.life-=dt;p.mat.opacity=Math.max(0,p.life/p.ml);
            if(p.life<=0){scene.remove(p.mesh);p.mat.dispose();particles.splice(i,1);}
        }

        updEnemies(dt);
        if(enemies.length===0){lvlClear();return;}
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
        window._nhBtn=function(){try{fn();}catch(e){console.error("[NH]",e);}};
        const b=overlay.querySelector(".nh-ov-btn");if(b)b.focus();
    }
    function hideOv(){if(!overlay)return;overlay.classList.add("hidden");overlay.style.pointerEvents="none";overlay.innerHTML="";window._nhBtn=null;}

    /* ══════════════ GAME STATES ══════════════ */
    function startLvl(){
        clearBP();
        enemies.forEach(e=>{scene.remove(e.mesh);e.mesh.traverse(c=>{if(c.geometry)c.geometry.dispose();if(c.material)c.material.dispose();});});
        enemies=[];
        mazeGrid=genMaze(MAZE_W,MAZE_H);buildMaze();
        playerPos=c2w(1,1);playerAngle=0;playerHP=MAX_HP;invulnT=0;shootT=0;
        playerMesh.position.set(playerPos.x,0.05,playerPos.z);playerMesh.rotation.z=0;playerMesh.visible=true;
        spawnEnemies();
        const cx=MAZE_W*CELL/2,cz=MAZE_H*CELL/2;
        camera.position.set(cx,30,cz);camera.lookAt(cx,0,cz);
        active=true;paused=false;hideOv();updHUD();
    }
    function lvlClear(){
        active=false;
        if(curLvl<LEVELS.length-1) showOv("HACKING COMPLETE",LEVELS[curLvl].name+" — all targets eliminated","NEXT SECTOR",function(){curLvl++;startLvl();});
        else showOv("SYSTEM COMPROMISED","All sectors breached — hack successful","RESTART",function(){curLvl=0;score=0;startLvl();});
    }
    function gameOver(){
        active=false;
        flashScreen();shake(0.5);
        showOv("CONNECTION LOST","Signal terminated — hack failed","RETRY",function(){startLvl();});
    }
    function clearBP(){
        pBullets.forEach(b=>{scene.remove(b.mesh);});pBullets=[];
        eBullets.forEach(b=>{scene.remove(b.mesh);});eBullets=[];
        particles.forEach(p=>{scene.remove(p.mesh);p.mat.dispose();});particles=[];
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
        const aspect=w/h,sz=10;
        camera.left=-sz*aspect;camera.right=sz*aspect;camera.top=sz;camera.bottom=-sz;
        camera.updateProjectionMatrix();
    }

    /* ══════════════ RENDER ══════════════ */
    function animate(){
        rafId=requestAnimationFrame(animate);
        if(!sceneOK)return;
        const dt=clock.getDelta();
        update(dt);
        renderer.render(scene,camera);
    }

    /* ══════════════ PAUSE MENU ══════════════ */
    function togglePause(){
        if(!active && !paused) return; /* not in gameplay */
        if(paused) resumeGame();
        else pauseGame();
    }
    function pauseGame(){
        if(!active) return;
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

    /* ══════════════ INPUT ══════════════ */
    function onKD(e){
        keys[e.code]=true;
        /* Pause menu navigation */
        if(paused && pauseWasActive){
            if(e.code==="ArrowUp"||e.code==="KeyW"||e.code==="KeyZ"){e.preventDefault();pauseIdx=(pauseIdx-1+pauseItems.length)%pauseItems.length;updPauseHL();return;}
            if(e.code==="ArrowDown"||e.code==="KeyS"){e.preventDefault();pauseIdx=(pauseIdx+1)%pauseItems.length;updPauseHL();return;}
            if(e.code==="Enter"||e.code==="Space"){e.preventDefault();pauseSelect();return;}
            if(e.code==="KeyP"||e.code==="Escape"){e.preventDefault();resumeGame();return;}
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
            canvas=document.getElementById("nier-hack-canvas");
            overlay=document.getElementById("nier-hack-overlay");
            hudHP=document.getElementById("nh-health");hudBar=document.getElementById("nh-bar");
            hudScore=document.getElementById("nh-score");hudLvl=document.getElementById("nh-level");
            hudEnm=document.getElementById("nh-enemies");hudName=document.getElementById("nh-level-name");
            fsBtn=document.getElementById("nh-fullscreen");flashEl=document.getElementById("nh-flash");
            pauseMenu=document.getElementById("nh-pause");
            if(pauseMenu){
                pauseItems=pauseMenu.querySelectorAll(".nh-pause-item");
                /* Mouse interaction for pause items */
                pauseItems.forEach(function(item,idx){
                    item.addEventListener("mouseenter",function(){pauseIdx=idx;updPauseHL();});
                    item.addEventListener("click",function(e){e.stopPropagation();pauseIdx=idx;updPauseHL();pauseSelect();});
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
            }
            curLvl=0;score=0;mouseDown=false;paused=false;pauseWasActive=false;
            hidePauseMenu();
            showOv("HACKING INITIATED","Breach the firewall — destroy all enemy cores","START",function(){startLvl();if(!rafId)animate();});
            if(!rafId)animate();
        },
        toggle:function(){
            if(document.documentElement.getAttribute("data-theme")==="nier")this.init();else this.destroy();
        },
        destroy:function(){
            active=false;paused=false;pauseWasActive=false;if(rafId){cancelAnimationFrame(rafId);rafId=null;}
            mouseDown=false;for(var k in keys)keys[k]=false;
            hidePauseMenu();
            if(sceneOK){clearBP();enemies.forEach(function(e){scene.remove(e.mesh);e.mesh.traverse(function(c){if(c.geometry)c.geometry.dispose();if(c.material)c.material.dispose();});});enemies=[];clearMaze();}
            hideOv();
        },
    };
})();
