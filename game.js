(() => {
  'use strict';

  const canvas = document.getElementById('game-canvas');
  const context = canvas.getContext('2d');
  const scoreElement = document.getElementById('score');
  const highScoreElement = document.getElementById('high-score');
  const speedElement = document.getElementById('speed');
  const fragmentCountElement = document.getElementById('fragment-count');
  const shieldStatusElement = document.getElementById('shield-status');
  const toolStatusElement = document.getElementById('tool-status');
  const startPanel = document.getElementById('start-panel');
  const gameOverPanel = document.getElementById('game-over-panel');
  const finalScoreElement = document.getElementById('final-score');
  const newRecordElement = document.getElementById('new-record');
  const pauseBadge = document.getElementById('pause-badge');
  const pauseButton = document.getElementById('pause-button');
  const startButton = document.getElementById('start-button');
  const restartButton = document.getElementById('restart-button');

  const WORLD_WIDTH = canvas.width;
  const WORLD_HEIGHT = canvas.height;
  const GROUND_Y = 350;
  const STORAGE_KEY = 'pixel-dash-high-score';
  const random = (minimum, maximum) => Math.random() * (maximum - minimum) + minimum;
  const integer = (minimum, maximum) => Math.floor(random(minimum, maximum + 1));
  const padScore = value => String(Math.floor(value)).padStart(5, '0');
  const playerFrames = Array.from({ length: 8 }, (_, index) => {
    const frame = new Image();
    frame.src = `sprites/character-${String(index).padStart(2, '0')}.png`;
    return frame;
  });

  let state = 'ready';
  let player;
  let obstacles = [];
  let planeFragments = [];
  let particles = [];
  let score = 0;
  let highScore = Number(localStorage.getItem(STORAGE_KEY)) || 0;
  let elapsed = 0;
  let obstacleTimer = 0;
  let fragmentTimer = 150;
  let fragmentsCollected = 0;
  let planeMode = false;
  let planeTimer = 0;
  let flightInput = false;
  let boostPotionTimer = 260;
  let laserPickupTimer = 420;
  let boostPotions = [];
  let laserPickups = [];
  let laserBeamTimer = 0;
  let lastTime = 0;
  let deathTimer = 0;
  let flashTimer = 0;
  let shakeTimer = 0;
  let shakePower = 0;
  let audioContext;

  class Player {
    constructor() {
      this.x = 122;
      this.y = GROUND_Y - 58;
      this.width = 58;
      this.height = 58;
      this.animationTime = 0;
      this.velocityY = 0;
      this.gravity = 0.92;
      this.jumpForce = -16.5;
      this.isJumping = false;
      this.rotation = 0;
      this.deathVelocityX = 0;
      this.dead = false;
      this.isFlying = false;
      this.isBoosting = false;
      this.boostTimer = 0;
      this.boostVelocityX = 0;
      this.isShielded = false;
      this.shieldTimer = 0;
      this.laserTimer = 0;
    }

    jump() {
      if (state !== 'running' || this.isJumping) return;
      this.velocityY = this.jumpForce;
      this.isJumping = true;
      playTone(420, 0.08, 'square', 0.045);
    }

    update(delta) {
      this.animationTime += delta;
      if (this.dead) {
        this.x += this.deathVelocityX * delta;
        this.velocityY += this.gravity * 1.05 * delta;
        this.y += this.velocityY * delta;
        this.rotation += 0.22 * delta;
        return;
      }
      if (this.isFlying) {
        const lift = flightInput ? -0.78 : 0.42;
        this.velocityY = Math.max(-7, Math.min(6, this.velocityY + lift * delta));
        this.y += this.velocityY * delta;
        this.y = Math.max(62, Math.min(GROUND_Y - this.height - 8, this.y));
        this.rotation = this.velocityY * 0.025;
        return;
      }
      if (this.isBoosting) {
        this.x = Math.min(250, this.x + this.boostVelocityX * delta);
        this.rotation = Math.sin(elapsed * 18) * 0.035;
        this.boostTimer -= delta / 60;
        if (this.boostTimer <= 0) {
          this.isBoosting = false;
          this.boostVelocityX = 0;
          this.rotation = 0;
          this.x = 130;
          playTone(240, 0.12, 'triangle', 0.035);
        }
        return;
      }
      this.velocityY += this.gravity * delta;
      this.y += this.velocityY * delta;
      if (this.y + this.height >= GROUND_Y) {
        this.y = GROUND_Y - this.height;
        this.velocityY = 0;
        this.isJumping = false;
      }
    }

    draw() {
      context.save();
      context.translate(this.x + this.width / 2, this.y + this.height / 2);
      context.rotate(this.rotation);
      context.translate(-this.width / 2, -this.height / 2);
      if (this.isFlying) {
        context.fillStyle = '#25262b';
        context.fillRect(4, 17, 34, 25);
        context.fillRect(14, 10, 20, 12);
        context.fillRect(34, 22, 13, 8);
        context.fillRect(0, 38, 46, 6);
        context.fillStyle = '#d94b45';
        context.fillRect(10, 22, 7, 7);
        context.fillStyle = '#f0b94a';
        context.fillRect(27, 14, 5, 5);
        context.fillStyle = '#6ed1d7';
        context.fillRect(18, 29, 12, 4);
        drawShield(this.width / 2, this.height / 2);
      } else {
        const frame = playerFrames[Math.floor(this.animationTime / 8) % playerFrames.length];
        if (frame.complete && frame.naturalWidth > 0) {
          context.imageSmoothingEnabled = false;
          context.drawImage(frame, 0, 0, this.width, this.height);
        }
      }
      context.restore();
      if (this.isShielded && !this.isFlying) {
        context.save();
        context.translate(this.x + this.width / 2, this.y + this.height / 2);
        drawShield(0, 0);
        context.restore();
      }
      if (this.isBoosting) drawBoostTrail(this);
    }
  }

  class Obstacle {
    constructor() {
      this.width = integer(25, 48);
      this.height = integer(34, 76);
      this.x = WORLD_WIDTH + 20;
      this.y = GROUND_Y - this.height;
      this.variant = integer(0, 2);
      this.color = this.variant === 1 ? '#bc5147' : '#3e6571';
    }

    update(delta, speed) { this.x -= speed * delta; }

    draw() {
      context.save();
      context.fillStyle = this.color;
      context.fillRect(this.x + 5, this.y + 7, this.width - 10, this.height - 7);
      context.fillRect(this.x, this.y + 15, this.width, this.height - 15);
      context.fillStyle = '#24252b';
      context.fillRect(this.x + 5, this.y + 5, this.width - 10, 5);
      context.fillRect(this.x + 8, this.y + 20, 5, 5);
      if (this.variant === 0) context.fillRect(this.x + this.width - 13, this.y + 32, 5, 12);
      if (this.variant === 1) context.fillRect(this.x - 6, this.y + 25, 8, 5);
      if (this.variant === 2) {
        context.fillStyle = '#f0b94a';
        context.fillRect(this.x + this.width / 2 - 3, this.y + 13, 6, this.height - 25);
      }
      context.restore();
    }
  }

  class PlaneFragment {
    constructor() {
      this.width = 27;
      this.height = 27;
      this.x = WORLD_WIDTH + random(10, 90);
      const heights = [GROUND_Y - 29, GROUND_Y - 80, GROUND_Y - 127];
      this.y = heights[integer(0, heights.length - 1)];
      this.phase = random(0, Math.PI * 2);
    }

    update(delta, speed) {
      this.x -= speed * delta;
      this.phase += 0.08 * delta;
    }

    draw() {
      const bob = Math.sin(this.phase) * 3;
      context.save();
      context.translate(this.x, this.y + bob);
      context.fillStyle = '#f0b94a';
      context.fillRect(4, 10, 20, 8);
      context.fillRect(9, 5, 8, 18);
      context.fillStyle = '#25262b';
      context.fillRect(0, 12, 7, 4);
      context.fillRect(17, 7, 7, 4);
      context.fillRect(12, 18, 5, 7);
      context.fillStyle = '#d94b45';
      context.fillRect(8, 11, 5, 5);
      context.restore();
    }
  }

  class BoostPotion {
    constructor() {
      this.width = 30;
      this.height = 28;
      this.x = WORLD_WIDTH + random(50, 130);
      this.y = GROUND_Y - this.height;
      this.phase = random(0, Math.PI * 2);
    }

    update(delta, speed) {
      this.x -= speed * delta;
      this.phase += 0.05 * delta;
    }

    draw() {
      context.save();
      context.translate(this.x, this.y + Math.sin(this.phase) * 2);
      context.fillStyle = '#d94b45';
      context.fillRect(5, 8, 20, 18);
      context.fillStyle = '#25262b';
      context.fillRect(10, 3, 10, 7);
      context.fillStyle = '#f0b94a';
      context.fillRect(9, 12, 12, 5);
      context.fillStyle = '#6ed1d7';
      context.fillRect(12, 18, 7, 5);
      context.fillStyle = '#fff7d8';
      context.fillRect(21, 10, 5, 4);
      context.restore();
    }
  }

  class LaserPickup {
    constructor() {
      this.width = 30;
      this.height = 22;
      this.x = WORLD_WIDTH + random(60, 150);
      this.y = GROUND_Y - this.height;
      this.phase = random(0, Math.PI * 2);
    }

    update(delta, speed) {
      this.x -= speed * delta;
      this.phase += 0.08 * delta;
    }

    draw() {
      context.save();
      context.translate(this.x, this.y + Math.sin(this.phase) * 2);
      context.fillStyle = '#e08831';
      context.fillRect(2, 7, 25, 11);
      context.fillRect(10, 3, 9, 5);
      context.fillStyle = '#25262b';
      context.fillRect(25, 10, 7, 5);
      context.fillStyle = '#6ed1d7';
      context.fillRect(5, 10, 9, 5);
      context.restore();
    }
  }

  class Particle {
    constructor(x, y, options = {}) {
      this.x = x;
      this.y = y;
      this.velocityX = options.velocityX ?? random(-5, 5);
      this.velocityY = options.velocityY ?? random(-7, -1);
      this.gravity = options.gravity ?? 0.18;
      this.size = options.size ?? integer(3, 7);
      this.life = options.life ?? random(0.45, 1.1);
      this.maxLife = this.life;
      this.color = options.color ?? '#25262b';
      this.isSmoke = options.isSmoke ?? false;
      this.isFlame = options.isFlame ?? false;
    }

    update(delta) {
      this.velocityY += this.gravity * delta;
      this.x += this.velocityX * delta;
      this.y += this.velocityY * delta;
      this.velocityX *= Math.pow(0.985, delta);
      this.life -= 0.016 * delta;
    }

    draw() {
      context.save();
      context.globalAlpha = Math.max(0, this.life / this.maxLife) * (this.isSmoke ? 0.35 : 1);
      context.fillStyle = this.color;
      const size = this.isSmoke ? this.size * 1.8 : this.size;
      if (this.isFlame) {
        context.fillRect(this.x, this.y, size, size * 1.6);
        context.fillStyle = '#fff7d8';
        context.fillRect(this.x + size * 0.35, this.y + size * 0.25, size * 0.35, size * 0.8);
      } else {
        context.fillRect(this.x, this.y, size, size);
      }
      context.restore();
    }
  }

  function isColliding(first, second) {
    const padding = 7;
    return first.x + padding < second.x + second.width &&
      first.x + first.width - padding > second.x &&
      first.y + padding < second.y + second.height &&
      first.y + first.height - padding > second.y;
  }

  function startGame() {
    state = 'running';
    score = 0;
    elapsed = 0;
    obstacleTimer = 0;
    deathTimer = 0;
    flashTimer = 0;
    shakeTimer = 0;
    obstacles = [];
    planeFragments = [];
    boostPotions = [];
    laserPickups = [];
    particles = [];
    fragmentTimer = 150;
    fragmentsCollected = 0;
    planeMode = false;
    planeTimer = 0;
    flightInput = false;
    boostPotionTimer = 260;
    laserPickupTimer = 420;
    laserBeamTimer = 0;
    player = new Player();
    startPanel.classList.remove('active');
    gameOverPanel.classList.remove('active');
    pauseBadge.classList.remove('active');
    pauseButton.textContent = 'Ⅱ';
    updateFragmentHud();
    ensureAudio();
  }

  function togglePause() {
    if (state === 'running') {
      state = 'paused';
      pauseBadge.classList.add('active');
      pauseButton.textContent = '▶';
      pauseButton.setAttribute('aria-label', '繼續遊戲');
    } else if (state === 'paused') {
      state = 'running';
      pauseBadge.classList.remove('active');
      pauseButton.textContent = 'Ⅱ';
      pauseButton.setAttribute('aria-label', '暫停遊戲');
    }
  }

  function triggerDeath() {
    if (state !== 'running') return;
    state = 'dying';
    player.dead = true;
    player.deathVelocityX = -4.2;
    player.velocityY = -10;
    deathTimer = 1.12;
    flashTimer = 0.18;
    shakeTimer = 0.42;
    shakePower = 8;
    playTone(95, 0.22, 'sawtooth', 0.07);
    playTone(52, 0.38, 'square', 0.04, 0.04);
    createDeathParticles();
  }

  function activateBoostPotion() {
    player.isBoosting = true;
    player.boostTimer = 5;
    player.boostVelocityX = 10;
    playTone(320, 0.12, 'square', 0.045);
    playTone(620, 0.2, 'sawtooth', 0.04, 0.08);
    for (let index = 0; index < 20; index += 1) {
      particles.push(new Particle(player.x, player.y + player.height / 2, {
        velocityX: random(-3, 2), velocityY: random(-5, 4), gravity: 0.02,
        size: integer(2, 5), life: random(0.4, 0.9), color: index % 2 ? '#d94b45' : '#f0b94a'
      }));
    }
  }

  function fireLaser() {
    if (state !== 'running' || !player || player.laserTimer <= 0) return;
    laserBeamTimer = 0.16;
    playTone(740, 0.11, 'sawtooth', 0.035);
    obstacles = obstacles.filter(obstacle => {
      if (obstacle.x + obstacle.width <= player.x) return true;
      createExplosion(obstacle.x + obstacle.width / 2, obstacle.y + obstacle.height / 2, '#e08831');
      return false;
    });
  }

  function createExplosion(x, y, color = '#d94b45') {
    for (let index = 0; index < 16; index += 1) {
      particles.push(new Particle(x, y, {
        velocityX: random(-7, 7), velocityY: random(-8, 3), gravity: 0.25,
        size: integer(2, 6), life: random(0.35, 0.9), color
      }));
    }
  }

  function finishBoost() {
    player.isShielded = true;
    player.shieldTimer = 5;
    playTone(520, 0.12, 'triangle', 0.045);
    playTone(760, 0.18, 'sine', 0.035, 0.08);
    for (let index = 0; index < 14; index += 1) {
      particles.push(new Particle(player.x + player.width / 2, player.y + player.height / 2, {
        velocityX: random(-4, 4), velocityY: random(-4, 4), gravity: 0,
        size: integer(2, 5), life: random(0.45, 0.9), color: '#6ed1d7'
      }));
    }
  }

  function activatePlane() {
    planeMode = true;
    planeTimer = 5;
    player.isFlying = true;
    player.y = GROUND_Y - 105;
    player.velocityY = -1;
    playTone(660, 0.12, 'square', 0.045);
    playTone(880, 0.18, 'triangle', 0.04, 0.1);
    for (let index = 0; index < 18; index += 1) {
      particles.push(new Particle(player.x + player.width / 2, player.y + player.height / 2, {
        velocityX: random(-4, 4), velocityY: random(-5, 3), gravity: 0.03,
        size: integer(2, 5), life: random(0.45, 0.9), color: '#6ed1d7'
      }));
    }
    updateFragmentHud();
  }

  function deactivatePlane() {
    planeMode = false;
    planeTimer = 0;
    player.isFlying = false;
    player.y = GROUND_Y - player.height;
    player.velocityY = 0;
    player.rotation = 0;
    flightInput = false;
    planeFragments = planeFragments.filter(fragment => !isColliding(player, fragment));
    playTone(240, 0.12, 'triangle', 0.035);
    updateFragmentHud();
  }

  function collectFragment(fragmentIndex) {
    planeFragments.splice(fragmentIndex, 1);
    fragmentsCollected += 1;
    playTone(520, 0.07, 'square', 0.04);
    for (let index = 0; index < 7; index += 1) {
      particles.push(new Particle(player.x + player.width / 2, player.y + player.height / 2, {
        velocityX: random(-3, 3), velocityY: random(-5, 1), gravity: 0.1,
        size: integer(2, 4), life: random(0.35, 0.7), color: '#f0b94a'
      }));
    }
    if (fragmentsCollected >= 5 && !planeMode) activatePlane();
    updateFragmentHud();
  }

  function drawShield(centerX, centerY) {
    context.save();
    context.strokeStyle = 'rgba(110, 209, 215, .9)';
    context.lineWidth = 3;
    context.setLineDash([5, 4]);
    context.beginPath();
    context.arc(centerX, centerY, 35 + Math.sin(elapsed * 9) * 2, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = 'rgba(110, 209, 215, .1)';
    context.fill();
    context.restore();
  }

  function createDeathParticles() {
    const centerX = player.x + player.width / 2;
    const centerY = player.y + player.height / 2;
    for (let index = 0; index < 22; index += 1) {
      particles.push(new Particle(centerX, centerY, {
        velocityX: random(-8, 8), velocityY: random(-10, 2),
        gravity: 0.3, size: integer(3, 7), life: random(0.65, 1.2),
        color: index % 3 === 0 ? '#d94b45' : index % 3 === 1 ? '#f0b94a' : '#25262b'
      }));
    }
    for (let index = 0; index < 13; index += 1) {
      particles.push(new Particle(centerX + random(-14, 14), centerY + random(5, 20), {
        velocityX: random(-2.5, 2.5), velocityY: random(-4, -1),
        gravity: -0.02, size: integer(5, 12), life: random(0.7, 1.35),
        color: '#8b8d87', isSmoke: true
      }));
    }
  }

  function update(delta) {
    if (state === 'running') {
      const gameDelta = Math.min(delta, 2);
      elapsed += gameDelta / 60;
      score += gameDelta * 0.12;
      const baseSpeed = 5.3 + Math.min(elapsed * 0.1, 5.7);
      const spawnInterval = Math.max(58, 105 - elapsed * 1.7);
      const wasBoosting = player.isBoosting;
      player.update(gameDelta);
      if (wasBoosting && !player.isBoosting) finishBoost();
      if (player.isShielded) {
        player.shieldTimer -= gameDelta / 60;
        if (player.shieldTimer <= 0) {
          player.isShielded = false;
          player.shieldTimer = 0;
          playTone(220, 0.1, 'triangle', 0.03);
        }
      }
      const speed = player.isBoosting ? baseSpeed * 10 : baseSpeed;
      player.laserTimer = Math.max(0, player.laserTimer - gameDelta / 60);
      laserBeamTimer = Math.max(0, laserBeamTimer - gameDelta / 60);
      obstacleTimer += gameDelta;
      if (obstacleTimer >= spawnInterval) {
        obstacles.push(new Obstacle());
        obstacleTimer = 0;
      }
      fragmentTimer -= gameDelta;
      if (fragmentTimer <= 0 && planeFragments.length < 2 && !planeMode) {
        planeFragments.push(new PlaneFragment());
        fragmentTimer = random(190, 300);
      }
      boostPotionTimer -= gameDelta;
      if (boostPotionTimer <= 0 && boostPotions.length === 0 && obstacles.every(obstacle => Math.abs(obstacle.x - WORLD_WIDTH) > 150)) {
        boostPotions.push(new BoostPotion());
        boostPotionTimer = random(360, 560);
      }
      laserPickupTimer -= gameDelta;
      if (laserPickupTimer <= 0 && laserPickups.length === 0 && player.laserTimer <= 0 && obstacles.every(obstacle => Math.abs(obstacle.x - WORLD_WIDTH) > 180)) {
        laserPickups.push(new LaserPickup());
        laserPickupTimer = random(480, 700);
      }
      obstacles.forEach(obstacle => obstacle.update(gameDelta, speed));
      planeFragments.forEach(fragment => fragment.update(gameDelta, speed));
      boostPotions.forEach(potion => potion.update(gameDelta, speed));
      laserPickups.forEach(pickup => pickup.update(gameDelta, speed));
      obstacles = obstacles.filter(obstacle => obstacle.x + obstacle.width > -30);
      planeFragments = planeFragments.filter(fragment => fragment.x + fragment.width > -30);
      boostPotions = boostPotions.filter(potion => potion.x + potion.width > -30);
      laserPickups = laserPickups.filter(pickup => pickup.x + pickup.width > -30);
      particles.forEach(particle => particle.update(gameDelta));
      particles = particles.filter(particle => particle.life > 0);
      if (!planeMode) {
        for (let index = planeFragments.length - 1; index >= 0; index -= 1) {
          if (isColliding(player, planeFragments[index])) collectFragment(index);
        }
        if (!planeMode && !player.isBoosting && !player.isShielded && obstacles.some(obstacle => isColliding(player, obstacle))) triggerDeath();
      }
      for (let index = boostPotions.length - 1; index >= 0; index -= 1) {
        if (isColliding(player, boostPotions[index])) {
          boostPotions.splice(index, 1);
          activateBoostPotion();
          break;
        }
      }
      if (player.isBoosting) {
        obstacles = obstacles.filter(obstacle => {
          if (!isColliding(player, obstacle)) return true;
          createExplosion(obstacle.x + obstacle.width / 2, obstacle.y + obstacle.height / 2, '#d94b45');
          return false;
        });
        if (Math.random() < 0.65) {
          particles.push(new Particle(player.x - 4, player.y + random(18, 50), {
            velocityX: random(-5, -2), velocityY: random(-2, 2), gravity: 0.02,
            size: integer(3, 8), life: random(0.3, 0.7), color: Math.random() > 0.45 ? '#d94b45' : '#f0b94a', isFlame: true
          }));
        }
      }
      for (let index = laserPickups.length - 1; index >= 0; index -= 1) {
        if (isColliding(player, laserPickups[index])) {
          laserPickups.splice(index, 1);
          player.laserTimer = 10;
          playTone(520, 0.1, 'square', 0.045);
          createExplosion(player.x + player.width / 2, player.y + player.height / 2, '#6ed1d7');
          break;
        }
      }
      if (planeMode) {
        planeTimer -= gameDelta / 60;
        if (Math.random() < 0.35) {
          particles.push(new Particle(player.x + random(2, player.width - 2), player.y + random(8, player.height - 8), {
            velocityX: random(-1.8, 1.8), velocityY: random(-1.8, 1.8), gravity: 0,
            size: integer(2, 4), life: random(0.25, 0.55), color: '#6ed1d7'
          }));
        }
        if (planeTimer <= 0) deactivatePlane();
      }
      if (player.isShielded && Math.random() < 0.35) {
        particles.push(new Particle(player.x + random(2, player.width - 2), player.y + random(8, player.height - 8), {
          velocityX: random(-1.8, 1.8), velocityY: random(-1.8, 1.8), gravity: 0,
          size: integer(2, 4), life: random(0.25, 0.55), color: '#6ed1d7'
        }));
      }
      updateHud(speed);
    } else if (state === 'dying') {
      const slowDelta = Math.min(delta, 2) * 0.45;
      deathTimer -= delta / 60;
      player.update(slowDelta);
      particles.forEach(particle => particle.update(slowDelta));
      particles = particles.filter(particle => particle.life > 0);
      flashTimer = Math.max(0, flashTimer - delta / 60);
      shakeTimer = Math.max(0, shakeTimer - delta / 60);
      if (deathTimer <= 0) finishGame();
    }
  }

  function finishGame() {
    state = 'gameover';
    const roundedScore = Math.floor(score);
    const isNewRecord = roundedScore > highScore;
    if (isNewRecord) {
      highScore = roundedScore;
      localStorage.setItem(STORAGE_KEY, String(highScore));
    }
    finalScoreElement.textContent = padScore(roundedScore);
    highScoreElement.textContent = padScore(highScore);
    newRecordElement.style.visibility = isNewRecord ? 'visible' : 'hidden';
    gameOverPanel.classList.add('active');
    playTone(180, 0.12, 'triangle', 0.035);
  }

  function draw() {
    drawSky();
    context.save();
    if (shakeTimer > 0) context.translate(random(-shakePower, shakePower) * shakeTimer, random(-shakePower, shakePower) * shakeTimer);
    drawDecorations();
    planeFragments.forEach(fragment => fragment.draw());
    boostPotions.forEach(potion => potion.draw());
    laserPickups.forEach(pickup => pickup.draw());
    obstacles.forEach(obstacle => obstacle.draw());
    particles.forEach(particle => particle.draw());
    if (player) player.draw();
    drawGround();
    if (laserBeamTimer > 0) drawLaserBeam();
    context.restore();
    if (flashTimer > 0) {
      context.fillStyle = `rgba(255, 247, 235, ${flashTimer / 0.18 * 0.7})`;
      context.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    }
  }

  function drawSky() {
    const nightAmount = (Math.sin(elapsed * 0.07) + 1) / 2;
    const day = { red: 248, green: 242, blue: 220 };
    const night = { red: 45, green: 55, blue: 72 };
    const red = Math.round(day.red + (night.red - day.red) * nightAmount * 0.55);
    const green = Math.round(day.green + (night.green - day.green) * nightAmount * 0.55);
    const blue = Math.round(day.blue + (night.blue - day.blue) * nightAmount * 0.55);
    context.fillStyle = `rgb(${red}, ${green}, ${blue})`;
    context.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  }

  function drawDecorations() {
    const night = (Math.sin(elapsed * 0.07) + 1) / 2;
    context.fillStyle = night > 0.55 ? 'rgba(255, 239, 160, .7)' : 'rgba(75, 94, 98, .24)';
    for (let index = 0; index < 22; index += 1) {
      const x = (index * 137 - elapsed * (6 + index % 3 * 2)) % WORLD_WIDTH;
      const y = 45 + (index * 47) % 185;
      context.fillRect(x < 0 ? x + WORLD_WIDTH : x, y, index % 4 === 0 ? 3 : 2, index % 4 === 0 ? 3 : 2);
    }
    context.fillStyle = night > 0.55 ? '#e6d48c' : '#d8c79f';
    context.fillRect(770, 54, 28, 28);
    context.fillStyle = `rgb(${redValue(night)}, ${greenValue(night)}, ${blueValue(night)})`;
    context.fillRect(778, 48, 28, 28);
    context.fillStyle = 'rgba(53, 64, 70, .18)';
    for (let index = 0; index < 5; index += 1) {
      const x = ((index * 230 - elapsed * 2) % 1100) - 100;
      context.fillRect(x, 275 - index * 11, 95, 4);
      context.fillRect(x + 24, 267 - index * 11, 55, 4);
    }
  }

  function redValue(night) { return Math.round(216 - night * 100); }
  function greenValue(night) { return Math.round(203 - night * 95); }
  function blueValue(night) { return Math.round(160 - night * 60); }

  function drawGround() {
    context.fillStyle = '#25262b';
    context.fillRect(0, GROUND_Y, WORLD_WIDTH, 4);
    context.fillStyle = 'rgba(37,38,43,.42)';
    const offset = (elapsed * 50) % 42;
    for (let x = -42 + offset; x < WORLD_WIDTH; x += 42) context.fillRect(x, GROUND_Y + 14, 20, 3);
  }

  function drawBoostTrail(activePlayer) {
    context.save();
    context.globalAlpha = 0.75;
    context.fillStyle = '#d94b45';
    context.fillRect(activePlayer.x - 14, activePlayer.y + 22, 16, 8);
    context.fillStyle = '#f0b94a';
    context.fillRect(activePlayer.x - 24, activePlayer.y + 26, 13, 5);
    context.fillStyle = '#fff7d8';
    context.fillRect(activePlayer.x - 31, activePlayer.y + 28, 9, 3);
    context.strokeStyle = 'rgba(110, 209, 215, .9)';
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(activePlayer.x - 12, activePlayer.y + 12);
    context.lineTo(activePlayer.x - 70, activePlayer.y + 12);
    context.stroke();
    context.restore();
  }

  function drawLaserBeam() {
    context.save();
    context.globalAlpha = laserBeamTimer / 0.16;
    context.strokeStyle = '#6ed1d7';
    context.shadowColor = '#fff7d8';
    context.shadowBlur = 16;
    context.lineWidth = 8;
    context.beginPath();
    context.moveTo(player.x + player.width, player.y + player.height / 2);
    context.lineTo(WORLD_WIDTH, player.y + player.height / 2);
    context.stroke();
    context.restore();
  }

  function updateHud(speed = 5.3 + Math.min(elapsed * 0.1, 5.7)) {
    scoreElement.textContent = padScore(score);
    highScoreElement.textContent = padScore(highScore);
    speedElement.textContent = player && player.isBoosting ? '10.0x' : `${(speed / 5.3).toFixed(1)}x`;
    updateFragmentHud();
    toolStatusElement.textContent = player && player.laserTimer > 0 ? `光炮 ${player.laserTimer.toFixed(1)}s` : '工具待機';
    toolStatusElement.classList.toggle('active', Boolean(player && player.laserTimer > 0));
  }

  function updateFragmentHud() {
    fragmentCountElement.textContent = `${fragmentsCollected}/5`;
    if (player && player.isBoosting) {
      shieldStatusElement.textContent = `加速 ${Math.max(0, player.boostTimer).toFixed(1)}s`;
      shieldStatusElement.classList.add('active');
    } else if (player && player.isShielded) {
      shieldStatusElement.textContent = `護盾 ${Math.max(0, player.shieldTimer).toFixed(1)}s`;
      shieldStatusElement.classList.add('active');
    } else if (planeMode) {
      shieldStatusElement.textContent = `護盾 ${Math.max(0, planeTimer).toFixed(1)}s`;
      shieldStatusElement.classList.add('active');
    } else {
      shieldStatusElement.textContent = fragmentsCollected >= 5 ? '護盾結束' : '護盾待機';
      shieldStatusElement.classList.remove('active');
    }
  }

  function ensureAudio() {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
  }

  function playTone(frequency, duration, type, volume, delay = 0) {
    if (!audioContext) return;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, audioContext.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + delay + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(audioContext.currentTime + delay);
    oscillator.stop(audioContext.currentTime + delay + duration);
  }

  function handleAction(event) {
    if (event) event.preventDefault();
    if (state === 'ready' || state === 'gameover') startGame();
    else if (state === 'running') {
      if (planeMode) flightInput = true;
      else player.jump();
    }
  }

  function gameLoop(timestamp) {
    const delta = lastTime ? Math.min((timestamp - lastTime) / 16.67, 3) : 1;
    lastTime = timestamp;
    update(delta);
    draw();
    requestAnimationFrame(gameLoop);
  }

  startButton.addEventListener('click', startGame);
  restartButton.addEventListener('click', startGame);
  pauseButton.addEventListener('click', event => { event.stopPropagation(); togglePause(); });
  canvas.addEventListener('pointerdown', event => {
    if (event.button === 0 && state === 'running' && player && player.laserTimer > 0) {
      event.preventDefault();
      fireLaser();
      return;
    }
    handleAction(event);
  }, { passive: false });
  canvas.addEventListener('pointerup', () => { flightInput = false; });
  canvas.addEventListener('pointercancel', () => { flightInput = false; });
  window.addEventListener('keydown', event => {
    if (event.code === 'Space') {
      event.preventDefault();
      if (state === 'running' && planeMode) flightInput = true;
      else if (!event.repeat) handleAction();
    } else if (event.code === 'Enter') {
      event.preventDefault();
      if (!event.repeat) handleAction();
    } else if (event.code === 'KeyP') {
      event.preventDefault();
      togglePause();
    }
  });
  window.addEventListener('keyup', event => {
    if (event.code === 'Space') flightInput = false;
  });

  highScoreElement.textContent = padScore(highScore);
  updateHud();
  requestAnimationFrame(gameLoop);
})();
