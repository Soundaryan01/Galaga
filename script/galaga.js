/* -------------- Utilities & Globals -------------- */
function exitGame() {
    const confirmExit = confirm("Are you sure you want to exit?");
    if (confirmExit) {
        try { window.close(); } catch(e) {}
        setTimeout(() => {
            if (!window.closed) {
                alert("Please close this browser tab to exit the game.");
            }
        }, 100);
    }
}

function initGame(){
    loadAssets(() => {
        startGame();
    });
}

const assets = {};

function loadAssets(callback) {
    const sources = {
        player: "assets/player.png",
        enemy: "assets/enemy.png"
    };
    let loaded = 0, total = Object.keys(sources).length;

    for (let key in sources) {
        const img = new Image();
        img.src = sources[key];
        img.onload = () => {
            loaded++;
            if (loaded === total) callback();
        };
        assets[key] = img;
    }
}

let canvas, ctx;
let stars = [];
let keys = {};
let paused = false;
let pauseOverlay = null;
let playerBullets = [];
let enemyBullets = [];
let playerLives = 3;
let player = null;
let enemies = [];
let waveNumber = 1;
let gameLoopId = null;
let enemyShootIntervalId = null;
let score = 0;

/* -------------- Canvas + Stars -------------- */
function initCanvas() {
    canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    document.body.appendChild(canvas);
    ctx = canvas.getContext("2d");
}

function initStars(count = 100) {
    stars = [];
    for (let i = 0; i < count; i++) {
        stars.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            size: Math.random() * 2 + 1,
            brightness: Math.random() * 0.5 + 0.5
        });
    }
}

function renderBackground() {
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let star of stars) {
        ctx.fillStyle = `rgba(255,255,255,${star.brightness})`;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI*2);
        ctx.fill();

        // slow movement
        star.y += 0.05;
        if (star.y > canvas.height) star.y = 0;
    }
}

/* -------------- Input Controls -------------- */
function assignPlayerControls() {
    // (Call once on start)
    if (assignPlayerControls._assigned) return;
    assignPlayerControls._assigned = true;

    document.addEventListener("keydown", e => {
        keys[e.code] = true;

        // Toggle pause with P or Escape
        if (e.code === "KeyP" || e.code === "Escape") {
            togglePause();
        }
    });

    document.addEventListener("keyup", e => {
        keys[e.code] = false;
    });
}

/* -------------- Player Ship -------------- */
function createPlayerShip(x, y, width = 40, height = 40) {
    return {
        x, y, width, height,
        speed: 5,
        colors: { body: "cyan", cockpit: "white", outline: "white" },
        draw: function(ctx) {
            ctx.drawImage(assets.player, this.x, this.y, 40, 40);
        }
    };
}

function updatePlayerPosition() {
    if (!player) return;
    if (keys["ArrowLeft"] && player.x > 0) player.x -= player.speed;
    if (keys["ArrowRight"] && player.x < canvas.width - player.width) player.x += player.speed;
    if (keys["ArrowUp"] && player.y > 0) player.y -= player.speed;
    if (keys["ArrowDown"] && player.y < canvas.height - player.height) player.y += player.speed;
}

/* -------------- Bullets -------------- */
function createBullet(x, y, speed = -5, color = "cyan") {
    return { x, y, width: 4, height: 10, speed, color };
}

let spaceLock = false; // allow single shot per key press
function handlePlayerShooting() {
    if (keys["Space"]) {
        if (!spaceLock) {
            const bulletX = player.x + player.width/2 - 2;
            const bulletY = player.y;
            playerBullets.push(createBullet(bulletX, bulletY, -6, "cyan"));
            spaceLock = true;
        }
    } else {
        spaceLock = false;
    }
}

/* -------------- Enemies -------------- */
function createEnemyShip(x, y, width = 40, height = 40) {
    return {
        x, y, baseY: y, width, height,
        speed: 1.2,
        vx: (Math.random() > 0.5 ? 1 : -1) * (0.5 + Math.random()*0.7),
        colors: { body: "red", cockpit: "white", outline: "white" },
        alive: true,
        draw: function(ctx) {
            if (!this.alive) return;
            ctx.drawImage(assets.enemy, this.x, this.y, 40, 40);
        },
        update: function() {
            if (!this.alive) return;
            // Horizontal oscillation
            this.x += this.vx;
            if (this.x < 0) { this.x = 0; this.vx *= -1; }
            if (this.x > canvas.width - this.width) { this.x = canvas.width - this.width; this.vx *= -1; }
            // Slight bobbing
            this.y = this.baseY + Math.sin((Date.now()/500) + this.x/40) * 6;
        }
    };
}

function enemyShoot(enemy) {
    if (!enemy || !enemy.alive) return;
    const bulletX = enemy.x + enemy.width/2 - 2;
    const bulletY = enemy.y + enemy.height;
    enemyBullets.push(createBullet(bulletX, bulletY, 3.5, "red"));
}

/* Start/stop a single interval which randomly picks enemies to fire continuously */
function startEnemyShooting() {
    if (enemyShootIntervalId) return;
    enemyShootIntervalId = setInterval(() => {
        if (paused) return;
        if (enemies.length === 0) return;
        // Random chance each tick: choose a few enemies to shoot
        const shots = 1 + Math.floor(Math.random()*2); // 1 or 2 shots
        for (let i = 0; i < shots; i++) {
            const alive = enemies.filter(e => e.alive);
            if (alive.length === 0) break;
            const c = alive[Math.floor(Math.random() * alive.length)];
            enemyShoot(c);
        }
    }, 600); // every 600ms (adjust to taste)
}
function stopEnemyShooting() {
    if (enemyShootIntervalId) {
        clearInterval(enemyShootIntervalId);
        enemyShootIntervalId = null;
    }
}

/* -------------- Wave / Spawn -------------- */
function renderWave(wave) {
    enemies = [];
    const numEnemies = Math.floor(Math.random() * 6) + 8 + Math.min(3, Math.floor(wave/2)); // grow slowly
    const spacing = canvas.width / (numEnemies + 1);
    for (let i = 0; i < numEnemies; i++) {
        const x = spacing * (i + 1) - 20;
        const y = 50 + Math.random()*40;
        enemies.push(createEnemyShip(x, y));
    }
    // initial volley
    for (let e of enemies) {
        if (Math.random() < 0.35) enemyShoot(e);
    }
    startEnemyShooting();
}

/* -------------- Collisions / Game Logic -------------- */
function rectsOverlap(a, b) {
    return !(a.x + a.width < b.x || a.x > b.x + b.width || a.y + a.height < b.y || a.y > b.y + b.height);
}

let invincibleUntil = 0;
function checkCollisions() {
    // Player bullets vs enemies
    for (let i = playerBullets.length - 1; i >= 0; i--) {
        const pb = playerBullets[i];
        for (let j = 0; j < enemies.length; j++) {
            const en = enemies[j];
            if (!en.alive) continue;
            if (rectsOverlap(pb, en)) {
                // hit
                en.alive = false;
                playerBullets.splice(i, 1);
                score += 10;
                break;
            }
        }
    }

    // Enemy bullets vs player
    if (Date.now() < invincibleUntil) return; // temporary invincible after hit
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
        const eb = enemyBullets[i];
        if (player && rectsOverlap(eb, player)) {
            enemyBullets.splice(i, 1);
            playerLives -= 1;
            invincibleUntil = Date.now() + 1400; // 1.4s of invincibility
            // reset player position
            player.x = canvas.width/2 - player.width/2;
            player.y = canvas.height - 60;
            // clear bullets to give breathing room
            playerBullets = [];
            enemyBullets = [];
            if (playerLives <= 0) {
                gameOver();
            }
            return;
        }
    }
}

/* -------------- HUD / Overlays -------------- */
function drawHUD() {
    ctx.save();
    ctx.fillStyle = "#00ffff";
    ctx.font = "16px monospace";
    ctx.fillText(`Lives: ${playerLives}`, 12, 20);
    ctx.fillText(`Score: ${score}`, 12, 40);
    ctx.fillText(`Wave: ${waveNumber}`, canvas.width - 110, 20);

    // Draw player invincibility flicker
    if (Date.now() < invincibleUntil) {
        ctx.globalAlpha = 0.5;
    }
    ctx.restore();
}

/* -------------- Render Frame -------------- */
function renderGameFrame() {
    if (paused) return;
    // Render background
    renderBackground();

    // Update player & draw
    updatePlayerPosition();
    if (player) player.draw(ctx);

    // Update and draw enemies
    for (let en of enemies) {
        en.update();
        en.draw(ctx);
    }

    // Update and draw player bullets
    for (let i = playerBullets.length - 1; i >= 0; i--) {
        const b = playerBullets[i];
        b.y += b.speed;
        ctx.fillStyle = b.color;
        ctx.fillRect(b.x, b.y, b.width, b.height);
        if (b.y + b.height < 0) playerBullets.splice(i, 1);
    }

    // Update and draw enemy bullets
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
        const b = enemyBullets[i];
        b.y += b.speed;
        ctx.fillStyle = b.color;
        ctx.fillRect(b.x, b.y, b.width, b.height);
        if (b.y > canvas.height) enemyBullets.splice(i, 1);
    }

    // Handle player shooting
    handlePlayerShooting();

    // Collisions
    checkCollisions();

    // Draw HUD
    drawHUD();

    // Check wave cleared
    if (enemies.every(e => !e.alive)) {
        // next wave
        waveNumber += 1;
        renderWave(waveNumber);
    }
}

/* -------------- Game Loop -------------- */
function gameLoop() {
    if (!paused) {
        renderGameFrame();
    }
    gameLoopId = requestAnimationFrame(gameLoop);
}

/* -------------- Pause Menu -------------- */
function togglePause() {
    paused = !paused;

    if (paused) {
        // show overlay
        pauseOverlay = document.createElement("div");
        pauseOverlay.style.position = "absolute";
        pauseOverlay.style.top = 0;
        pauseOverlay.style.left = 0;
        pauseOverlay.style.width = "100%";
        pauseOverlay.style.height = "100%";
        pauseOverlay.style.backgroundColor = "rgba(0,0,0,0.7)";
        pauseOverlay.style.display = "flex";
        pauseOverlay.style.flexDirection = "column";
        pauseOverlay.style.justifyContent = "center";
        pauseOverlay.style.alignItems = "center";
        pauseOverlay.style.zIndex = 1000;

        const pausedText = document.createElement("h1");
        pausedText.innerText = "PAUSED";
        pausedText.style.color = "#00ffff";
        pausedText.style.fontFamily = "Arial";
        pausedText.style.marginBottom = "20px";
        pauseOverlay.appendChild(pausedText);

        const buttonsContainer = document.createElement("div");
        buttonsContainer.style.display = "flex";
        buttonsContainer.style.gap = "20px";

        const pauseCancelButton = document.createElement("button");
        pauseCancelButton.innerText = "Resume";
        pauseCancelButton.className = "game-btn";
        pauseCancelButton.onclick = () => {
            if (pauseOverlay && document.body.contains(pauseOverlay)) {
                document.body.removeChild(pauseOverlay);
            }
            paused = false;
        };
        buttonsContainer.appendChild(pauseCancelButton);

        const pauseExitButton = document.createElement("button");
        pauseExitButton.innerText = "Exit";
        pauseExitButton.className = "game-btn";
        pauseExitButton.onclick = () => location.reload();
        buttonsContainer.appendChild(pauseExitButton);

        pauseOverlay.appendChild(buttonsContainer);
        document.body.appendChild(pauseOverlay);

        // stop enemy shooting while paused
        stopEnemyShooting();
    } else {
        // resume
        if (pauseOverlay && document.body.contains(pauseOverlay)) {
            document.body.removeChild(pauseOverlay);
        }
        startEnemyShooting();
    }
}

/* -------------- Start / GameOver / Restart -------------- */
function startGame() {
    const menu = document.getElementById("mainMenu");
    if (menu) menu.style.display = "none";

    if (!canvas) initCanvas();
    if (stars.length === 0) initStars();

    if (!player) {
        player = createPlayerShip(canvas.width/2 - 20, canvas.height - 60);
    }

    assignPlayerControls();

    // reset state
    playerBullets = [];
    enemyBullets = [];
    playerLives = 3;
    score = 0;
    waveNumber = 1;
    initStars(120);
    renderWave(waveNumber);

    if (!gameLoopId) gameLoop();
}

function showUserDetails() {
    const username = prompt("Enter your name:", "Player1");
    if (username) {
        alert(`Welcome, ${username}!`);
    }
}

function gameOver() {
    // stop loop and shooting
    if (gameLoopId) {
        cancelAnimationFrame(gameLoopId);
        gameLoopId = null;
    }
    stopEnemyShooting();

    const overlay = document.createElement("div");
    overlay.style.position = "absolute";
    overlay.style.top = 0;
    overlay.style.left = 0;
    overlay.style.width = "100%";
    overlay.style.height = "100%";
    overlay.style.backgroundColor = "rgba(0,0,0,0.9)";
    overlay.style.display = "flex";
    overlay.style.flexDirection = "column";
    overlay.style.justifyContent = "center";
    overlay.style.alignItems = "center";
    overlay.style.zIndex = 2000;

    const txt = document.createElement("h1");
    txt.innerText = "GAME OVER";
    txt.style.color = "#ff5555";
    overlay.appendChild(txt);

    const s = document.createElement("p");
    s.innerText = `Score: ${score}`;
    s.style.color = "#fff";
    overlay.appendChild(s);

    const btns = document.createElement("div");
    btns.style.display = "flex";
    btns.style.gap = "12px";

    const restart = document.createElement("button");
    restart.innerText = "Restart";
    restart.className = "game-btn";
    restart.onclick = () => {
        if (overlay && document.body.contains(overlay)) document.body.removeChild(overlay);
        player = null;
        loadAssets(() => {
            startGame();
        });
    };
    btns.appendChild(restart);

    const exit = document.createElement("button");
    exit.innerText = "Exit";
    exit.className = "game-btn";
    exit.onclick = () => location.reload();
    btns.appendChild(exit);

    overlay.appendChild(btns);
    document.body.appendChild(overlay);
}

/* -------------- Initialization when page loads -------------- */
window.addEventListener("load", () => {
    initCanvas();
    initStars(120);

    // Show main menu is already present in HTML by default
});