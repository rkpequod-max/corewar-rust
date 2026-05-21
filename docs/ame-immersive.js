/* ═══════════════════════════════════════════════════════════════════
   L'ÂME DANS L'EAU — Light Rays Only Edition
   Volumetric underwater god rays — no geometry objects
   ═══════════════════════════════════════════════════════════════════ */
(function() {
    'use strict';

    var active = false;
    var renderer, scene, camera;
    var animId = null;
    var clock = null;
    var containerCanvas = null;
    var renderTarget = null;
    var screenQuad = null;
    var postScene = null;
    var postCamera = null;
    var customPostMaterial = null;

    var godRays = [];      // volumetric cones
    var fogPlanes = [];    // horizontal haze veils

    var cameraPos, cameraVel, cameraTarget;
    var keys = { w:false, a:false, s:false, d:false, Space:false, Control:false };
    var mouseX = 0, mouseY = 0;
    var cameraBobbing = 0;

    // Web Audio
    var audioCtx = null;
    var droneOsc = null;
    var droneFilter = null;
    var ambientLFO = null;
    var ambientLFOGain = null;
    var pentatonicTimer = null;

    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function isAme() { return document.documentElement.getAttribute('data-theme') === 'ame'; }
    function rand(a, b) { return Math.random() * (b - a) + a; }

    /* ── Post-processing shaders ── */
    var ScreenShader = {
        vertexShader: [
            'varying vec2 vUv;',
            'void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }'
        ].join('\n'),
        fragmentShader: [
            'uniform sampler2D tDiffuse;',
            'uniform float uTime;',
            'uniform float uDistortionStrength;',
            'varying vec2 vUv;',
            'void main() {',
            '  vec2 uv = vUv;',
            '  vec2 center = uv - 0.5;',
            '  float dist = length(center);',
            '  float ripple = sin(dist * 18.0 - uTime * 1.4) * uDistortionStrength * (1.0 - dist * 1.6);',
            '  uv += normalize(center) * ripple;',
            '  float ca = uDistortionStrength * 0.9;',
            '  float r = texture2D(tDiffuse, uv + vec2(ca, 0.0)).r;',
            '  float g = texture2D(tDiffuse, uv).g;',
            '  float b = texture2D(tDiffuse, uv - vec2(ca, 0.0)).b;',
            '  float vignette = 1.0 - dist * 1.2;',
            '  gl_FragColor = vec4(vec3(r,g,b) * vignette, 1.0);',
            '}'
        ].join('\n')
    };

    /* ── Volumetric ray shaders ── */
    var RayShader = {
        vertexShader: [
            'varying vec2 vUv;',
            'varying vec3 vNormal;',
            'varying vec3 vViewPosition;',
            'varying vec3 vLocalPosition;',
            'void main() {',
            '  vUv = uv;',
            '  vLocalPosition = position;',
            '  vNormal = normalMatrix * normal;',
            '  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
            '  vViewPosition = -mvPosition.xyz;',
            '  gl_Position = projectionMatrix * mvPosition;',
            '}'
        ].join('\n'),
        fragmentShader: [
            'uniform vec3 uColor;',
            'uniform float uOpacity;',
            'uniform float uTime;',
            'uniform float uHeight;',
            'uniform float uEdgePower;',
            'uniform float uCausticSpeed;',
            'uniform float uIsFloor;',
            'varying vec2 vUv;',
            'varying vec3 vNormal;',
            'varying vec3 vViewPosition;',
            'varying vec3 vLocalPosition;',
            'float getCaustics3D(vec3 localPos, float time) {',
            '  vec3 p = localPos;',
            '  if (uIsFloor > 0.5) {',
            '    p.x *= 0.15;',
            '    p.z *= 0.15;',
            '    p.y = time * uCausticSpeed * 0.5;',
            '  } else {',
            '    p.x *= 0.65;',
            '    p.z *= 0.65;',
            '    p.y *= 0.12;',
            '    p.y -= time * uCausticSpeed;',
            '  }',
            '  float k = 0.0;',
            '  for (int i = 0; i < 3; i++) {',
            '    float t = time * (0.8 + float(i) * 0.25);',
            '    p.x += sin(p.y + t) * 0.45;',
            '    p.z += cos(p.x + t) * 0.45;',
            '    p.y += sin(p.z + t) * 0.25;',
            '    k += sin(p.x) * cos(p.z) * sin(p.y);',
            '  }',
            '  k = (k / 3.0) * 0.5 + 0.5;',
            '  return pow(k, 2.5);',
            '}',
            'void main() {',
            '  float finalAlpha = uOpacity;',
            '  float caustics = getCaustics3D(vLocalPosition, uTime);',
            '  if (uIsFloor > 0.5) {',
            '    float dist = length(vLocalPosition.xz);',
            '    float distFade = 1.0 - smoothstep(10.0, 30.0, dist);',
            '    finalAlpha *= distFade * (0.4 + 0.6 * caustics);',
            '  } else {',
            '    float hPct = (vLocalPosition.y + uHeight * 0.5) / uHeight;',
            '    float verticalFade = smoothstep(0.0, 0.12, hPct) * (1.0 - smoothstep(0.55, 1.0, hPct));',
            '    vec3 normal = normalize(vNormal);',
            '    vec3 viewDir = normalize(vViewPosition);',
            '    float edgeFade = abs(dot(normal, viewDir));',
            '    edgeFade = pow(edgeFade, uEdgePower);',
            '    float cameraDist = length(vViewPosition);',
            '    float nearFade = smoothstep(3.0, 15.0, cameraDist);',
            '    finalAlpha *= verticalFade * edgeFade * nearFade * (0.2 + 0.8 * caustics);',
            '  }',
            '  vec3 finalColor = uColor * (0.4 + 0.6 * caustics);',
            '  gl_FragColor = vec4(finalColor, finalAlpha);',
            '}'
        ].join('\n')
    };

    function initAudio() {}
    function stopAudio() {}
    function resumeAudioContext() {}

    /* ── Build Scene ── */
    function initEngine() {
        containerCanvas = document.createElement('canvas');
        containerCanvas.id = 'ame-3d-bg';
        containerCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none;display:none;';
        document.body.appendChild(containerCanvas);

        var legacyBg = document.getElementById('underwater-bg');
        if (legacyBg) legacyBg.style.display = 'none';

        renderer = new THREE.WebGLRenderer({ canvas: containerCanvas, antialias: !reducedMotion, powerPreference: 'high-performance' });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setClearColor(0x030810, 1);

        scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0x050e1a, 0.018);

        camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
        camera.position.copy(cameraPos);

        renderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight);
        customPostMaterial = new THREE.ShaderMaterial({
            uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uDistortionStrength: { value: 0.004 } },
            vertexShader: ScreenShader.vertexShader,
            fragmentShader: ScreenShader.fragmentShader,
            depthWrite: false, depthTest: false
        });
        postScene = new THREE.Scene();
        postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        screenQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), customPostMaterial);
        postScene.add(screenQuad);

        // Dim ambient light only — no direct lights, rays create all illumination
        scene.add(new THREE.AmbientLight(0x06101e, 1.0));

        buildGodRays();
        buildFogVeils();
    }

    function buildGodRays() {
        // Layer A — wide diffuse halo rays (large, low opacity)
        var haloConfigs = [
            { rx:0,   rz:0,   w:22, h:120, op:0.055, col:0x4a8ec8 },
            { rx:-18, rz:12,  w:18, h:100, op:0.045, col:0x3a7ab8 },
            { rx:22,  rz:-8,  w:24, h:110, op:0.05,  col:0x2a6aac },
            { rx:-30, rz:-20, w:16, h:90,  op:0.04,  col:0x5898d0 },
            { rx:35,  rz:25,  w:20, h:105, op:0.05,  col:0x4080c0 },
            { rx:8,   rz:-35, w:26, h:115, op:0.045, col:0x2878b8 },
            { rx:-40, rz:5,   w:15, h:95,  op:0.04,  col:0x3a8acc },
        ];
        haloConfigs.forEach(function(cfg) {
            var geo = new THREE.ConeGeometry(cfg.w, cfg.h, 12, 1, true);
            var mat = new THREE.ShaderMaterial({
                uniforms: {
                    uColor: { value: new THREE.Color(cfg.col) },
                    uOpacity: { value: cfg.op },
                    uTime: { value: 0 },
                    uHeight: { value: cfg.h },
                    uEdgePower: { value: 1.5 },
                    uCausticSpeed: { value: 0.5 },
                    uIsFloor: { value: 0.0 }
                },
                vertexShader: RayShader.vertexShader,
                fragmentShader: RayShader.fragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide
            });
            var mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(cfg.rx, cfg.h * 0.5 + 5, cfg.rz);
            scene.add(mesh);
            godRays.push({ mesh: mesh, baseX: cfg.rx, baseZ: cfg.rz, baseOp: cfg.op, phase: rand(0, Math.PI * 2), type: 'halo' });
        });

        // Layer B — thin bright shafts
        var shaftConfigs = [
            { rx:3,   rz:-2,  w:2.5, h:80,  op:0.18, col:0x80c8f0 },
            { rx:-14, rz:7,   w:1.8, h:70,  op:0.14, col:0x70bce8 },
            { rx:18,  rz:-12, w:3.0, h:90,  op:0.16, col:0x60b0e0 },
            { rx:-6,  rz:22,  w:2.2, h:75,  op:0.15, col:0x90d0f8 },
            { rx:28,  rz:8,   w:1.5, h:65,  op:0.13, col:0x78c4ec },
            { rx:-25, rz:-15, w:2.8, h:85,  op:0.17, col:0x68bce4 },
            { rx:12,  rz:30,  w:2.0, h:72,  op:0.14, col:0x88ccf4 },
            { rx:-35, rz:18,  w:1.6, h:68,  op:0.12, col:0x5ab0e0 },
            { rx:40,  rz:-25, w:2.4, h:80,  op:0.15, col:0x70c0f0 },
            { rx:-8,  rz:-30, w:1.9, h:73,  op:0.13, col:0x62b8e8 },
        ];
        shaftConfigs.forEach(function(cfg) {
            var geo = new THREE.ConeGeometry(cfg.w, cfg.h, 10, 1, true);
            var mat = new THREE.ShaderMaterial({
                uniforms: {
                    uColor: { value: new THREE.Color(cfg.col) },
                    uOpacity: { value: cfg.op },
                    uTime: { value: 0 },
                    uHeight: { value: cfg.h },
                    uEdgePower: { value: 3.0 },
                    uCausticSpeed: { value: 1.2 },
                    uIsFloor: { value: 0.0 }
                },
                vertexShader: RayShader.vertexShader,
                fragmentShader: RayShader.fragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide
            });
            var mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(cfg.rx, cfg.h * 0.5 + 8, cfg.rz);
            scene.add(mesh);
            godRays.push({ mesh: mesh, baseX: cfg.rx, baseZ: cfg.rz, baseOp: cfg.op, phase: rand(0, Math.PI * 2), type: 'shaft' });
        });

        // Layer C — floor caustic glow patches
        var glowGeo = new THREE.PlaneGeometry(60, 60);
        var glowMat = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: new THREE.Color(0x1a4878) },
                uOpacity: { value: 0.12 },
                uTime: { value: 0 },
                uHeight: { value: 1.0 },
                uEdgePower: { value: 1.0 },
                uCausticSpeed: { value: 0.6 },
                uIsFloor: { value: 1.0 }
            },
            vertexShader: RayShader.vertexShader,
            fragmentShader: RayShader.fragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        var glowFloor = new THREE.Mesh(glowGeo, glowMat);
        glowFloor.rotation.x = -Math.PI / 2;
        glowFloor.position.y = -55;
        scene.add(glowFloor);
        godRays.push({ mesh: glowFloor, baseX: 0, baseZ: 0, baseOp: 0.12, phase: 0, type: 'floor' });
    }

    function buildFogVeils() {
        var depths = [-8, -16, -26, -38, -50];
        var opacities = [0.04, 0.06, 0.07, 0.08, 0.09];
        depths.forEach(function(y, i) {
            var geo = new THREE.PlaneGeometry(300, 300);
            var mat = new THREE.MeshBasicMaterial({
                color: 0x0a2040, transparent: true, opacity: opacities[i],
                blending: THREE.NormalBlending, depthWrite: false, side: THREE.DoubleSide
            });
            var mesh = new THREE.Mesh(geo, mat);
            mesh.rotation.x = -Math.PI / 2;
            mesh.position.y = y;
            scene.add(mesh);
            fogPlanes.push({ mesh: mesh, driftSpeed: rand(0.4, 1.2), baseY: y });
        });
    }

    /* ── Camera & Scroll ── */
    function updatePhysics(dt) {
        if (reducedMotion) return;
        var swimSpeed = 14.0;
        var forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        var right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        forward.y = 0; forward.normalize();
        right.y = 0; right.normalize();

        var vel = new THREE.Vector3();
        if (keys.w) vel.addScaledVector(forward, 1);
        if (keys.s) vel.addScaledVector(forward, -1);
        if (keys.a) vel.addScaledVector(right, -1);
        if (keys.d) vel.addScaledVector(right, 1);
        if (keys.Space) vel.y += 1.0;
        if (keys.Control) vel.y -= 1.0;
        vel.normalize().multiplyScalar(swimSpeed);

        cameraVel.lerp(vel, 0.05);
        cameraVel.y += 0.06 * dt;
        cameraPos.addScaledVector(cameraVel, dt);

        if (cameraPos.y > -2.0) { cameraPos.y = -2.0; cameraVel.y = 0; }
        if (cameraPos.y < -53.0) { cameraPos.y = -53.0; cameraVel.y = 0; }
        if (Math.abs(cameraPos.x) > 75) { cameraPos.x = Math.sign(cameraPos.x) * 75; }
        if (Math.abs(cameraPos.z) > 75) { cameraPos.z = Math.sign(cameraPos.z) * 75; }

        var isMoving = keys.w || keys.s || keys.a || keys.d || keys.Space || keys.Control;
        cameraBobbing += dt * (isMoving ? 3.2 : 1.0);
        var cur = cameraPos.clone();
        cur.y += Math.sin(cameraBobbing) * (isMoving ? 0.18 : 0.06);

        cameraTarget.copy(cur).add(new THREE.Vector3(
            Math.sin(-mouseX * 0.4),
            Math.tan(-mouseY * 0.4),
            -Math.cos(mouseX * 0.4)
        ));
        camera.position.copy(cur);
        camera.lookAt(cameraTarget);

        if (audioCtx && droneFilter) {
            var d = Math.min(Math.abs(cameraPos.y) / 50, 1.0);
            droneFilter.frequency.value = 320 * (1.0 - d * 0.6);
        }
    }

    function handleScrollDepth() {
        if (!active) return;
        var scrollY = window.scrollY || 0;
        var maxS = document.documentElement.scrollHeight - window.innerHeight;
        if (maxS <= 0) return;
        var pct = scrollY / maxS;
        cameraPos.y = THREE.MathUtils.lerp(cameraPos.y, -4.0 - pct * 44.0, 0.06);

        // Fog transitions with depth
        var r, g, b;
        if (pct < 0.3) {
            var t = pct / 0.3;
            r = THREE.MathUtils.lerp(0.05, 0.03, t);
            g = THREE.MathUtils.lerp(0.14, 0.08, t);
            b = THREE.MathUtils.lerp(0.26, 0.18, t);
            scene.fog.density = 0.015 + t * 0.006;
        } else if (pct < 0.7) {
            var t2 = (pct - 0.3) / 0.4;
            r = THREE.MathUtils.lerp(0.03, 0.01, t2);
            g = THREE.MathUtils.lerp(0.08, 0.03, t2);
            b = THREE.MathUtils.lerp(0.18, 0.08, t2);
            scene.fog.density = 0.021 + t2 * 0.005;
        } else {
            var t3 = (pct - 0.7) / 0.3;
            r = THREE.MathUtils.lerp(0.01, 0.002, t3);
            g = THREE.MathUtils.lerp(0.03, 0.003, t3);
            b = THREE.MathUtils.lerp(0.08, 0.008, t3);
            scene.fog.density = 0.026;
        }
        scene.fog.color.setRGB(r, g, b);
    }

    /* ── Animation Loop ── */
    function animate() {
        if (!active) return;
        animId = requestAnimationFrame(animate);
        var dt = clock.getDelta();
        var t = clock.getElapsedTime();

        // Animate each god ray
        godRays.forEach(function(ray) {
            var type = ray.type;
            var mesh = ray.mesh;

            if (mesh.material.uniforms && mesh.material.uniforms.uTime) {
                mesh.material.uniforms.uTime.value = t;
            }

            if (type === 'halo') {
                mesh.position.x = ray.baseX + Math.sin(t * 0.22 + ray.phase) * 5.0;
                mesh.position.z = ray.baseZ + Math.cos(t * 0.18 + ray.phase) * 4.0;
                mesh.rotation.z = Math.sin(t * 0.25 + ray.phase) * 0.06;
                mesh.rotation.x = Math.cos(t * 0.15 + ray.phase) * 0.04;
                if (mesh.material.uniforms && mesh.material.uniforms.uOpacity) {
                    mesh.material.uniforms.uOpacity.value = ray.baseOp * (0.7 + 0.3 * Math.sin(t * 0.9 + ray.phase));
                }
            } else if (type === 'shaft') {
                mesh.position.x = ray.baseX + Math.sin(t * 0.35 + ray.phase) * 3.5;
                mesh.position.z = ray.baseZ + Math.cos(t * 0.28 + ray.phase) * 3.0;
                mesh.rotation.z = Math.sin(t * 0.5 + ray.phase) * 0.09;
                if (mesh.material.uniforms && mesh.material.uniforms.uOpacity) {
                    mesh.material.uniforms.uOpacity.value = ray.baseOp * (0.65 + 0.35 * Math.sin(t * 1.6 + ray.phase));
                }
            } else if (type === 'floor') {
                if (mesh.material.uniforms && mesh.material.uniforms.uOpacity) {
                    mesh.material.uniforms.uOpacity.value = ray.baseOp * (0.6 + 0.4 * Math.sin(t * 0.4));
                }
            }
        });

        // Drift fog veils
        fogPlanes.forEach(function(veil) {
            veil.mesh.position.x = Math.sin(t * 0.09 * veil.driftSpeed) * 15;
            veil.mesh.position.z = Math.cos(t * 0.07 * veil.driftSpeed) * 15;
        });

        updatePhysics(dt);
        handleScrollDepth();

        // Render with post-processing
        renderer.setRenderTarget(renderTarget);
        renderer.render(scene, camera);
        renderer.setRenderTarget(null);
        customPostMaterial.uniforms.tDiffuse.value = renderTarget.texture;
        customPostMaterial.uniforms.uTime.value = t;
        renderer.render(postScene, postCamera);
    }

    /* ── Input ── */
    function onKeyDown(e) {
        if (!active) return;
        var m = { KeyW:'w', KeyA:'a', KeyS:'s', KeyD:'d', Space:'Space', ControlLeft:'Control', ControlRight:'Control' };
        if (m[e.code]) { keys[m[e.code]] = true; }
    }
    function onKeyUp(e) {
        if (!active) return;
        var m = { KeyW:'w', KeyA:'a', KeyS:'s', KeyD:'d', Space:'Space', ControlLeft:'Control', ControlRight:'Control' };
        if (m[e.code]) keys[m[e.code]] = false;
    }
    function onMouseMove(e) {
        if (!active) return;
        mouseX = (e.clientX / window.innerWidth) * 2 - 1;
        mouseY = -(e.clientY / window.innerHeight) * 2 + 1;
    }

    /* ── Activate / Deactivate ── */
    function activate() {
        if (active) return;
        if (typeof THREE === 'undefined') return;
        active = true;

        cameraPos = new THREE.Vector3(0, -5, 10);
        cameraVel = new THREE.Vector3();
        cameraTarget = new THREE.Vector3(0, -5, 0);
        clock = new THREE.Clock();

        initEngine();
        containerCanvas.style.display = 'block';
        initAudio();

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        window.addEventListener('mousemove', onMouseMove);

        animate();
    }

    function deactivate() {
        if (!active) return;
        active = false;
        if (animId) { cancelAnimationFrame(animId); animId = null; }
        stopAudio();

        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('mousemove', onMouseMove);

        // Dispose of god rays geometries and materials
        godRays.forEach(function(ray) {
            if (ray.mesh) {
                if (ray.mesh.geometry) ray.mesh.geometry.dispose();
                if (ray.mesh.material) ray.mesh.material.dispose();
                if (scene) scene.remove(ray.mesh);
            }
        });
        godRays = [];

        // Dispose of fog planes
        fogPlanes.forEach(function(veil) {
            if (veil.mesh) {
                if (veil.mesh.geometry) veil.mesh.geometry.dispose();
                if (veil.mesh.material) veil.mesh.material.dispose();
                if (scene) scene.remove(veil.mesh);
            }
        });
        fogPlanes = [];


        if (screenQuad) { screenQuad.geometry.dispose(); screenQuad.material.dispose(); }
        if (renderTarget) renderTarget.dispose();
        if (containerCanvas) { containerCanvas.remove(); containerCanvas = null; }
        if (renderer) { renderer.dispose(); renderer = null; }

        scene = null; camera = null; postScene = null; postCamera = null;

        var legacyBg = document.getElementById('underwater-bg');
        if (legacyBg) legacyBg.style.display = 'block';
    }

    function onWindowResize() {
        if (!active || !renderer) return;
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        if (renderTarget) renderTarget.setSize(window.innerWidth, window.innerHeight);
    }
    window.addEventListener('resize', onWindowResize);

    /* ── Theme Observer ── */
    var prevTheme = document.documentElement.getAttribute('data-theme');
    var observer = new MutationObserver(function() {
        var cur = document.documentElement.getAttribute('data-theme');
        if (cur === 'ame' && prevTheme !== 'ame') activate();
        else if (cur !== 'ame' && prevTheme === 'ame') deactivate();
        prevTheme = cur;
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    if (isAme()) activate();
})();
