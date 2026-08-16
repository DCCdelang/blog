// Wrapped in an IIFE so `canvas`, `c`, `width` and friends stay local instead
// of becoming globals that a second script on the page could collide with.
(function () {
  // The game fills the browser window. Everything below is measured in CSS
  // pixels and multiplied by `scale`, which is the viewport height compared to
  // the 300px tall board this started as. That way the game feels the same on a
  // laptop and on a big monitor instead of the blocks becoming specks.
  const BASE_HEIGHT = 300;

  let width = 0, height = 0, scale = 1;
  let score = 0, lives = 3, tick = 0, junk = [];
  let hero = { x: 0, y: 0, size: 10, speed: 2 };
  let keys = { left: false, right: false, up: false, down: false };
  let highScore = parseInt(window.localStorage.getItem('highScore'), 10) || 0;

  const canvas = document.createElement("canvas");
  const container = document.getElementById("game") || document.body;
  container.appendChild(canvas);
  const c = canvas.getContext("2d"); // Get 2D drawing context

  function resize() {
    // Cap the pixel ratio at 2: beyond that we are filling a lot more pixels
    // every frame for a game made of flat squares.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    scale = height / BASE_HEIGHT;

    // Back the canvas with real device pixels, but keep drawing in CSS pixels.
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    c.setTransform(dpr, 0, 0, dpr, 0, 0);

    hero.size = 10 * scale;
    hero.speed = 2 * scale;
    // Pull the hero back inside if the window just got smaller.
    hero.x = Math.max(0, Math.min(hero.x, width - hero.size));
    hero.y = Math.max(0, Math.min(hero.y, height - hero.size));
  }

  resize();
  hero.x = width / 2 - hero.size / 2;
  hero.y = height / 2 - hero.size / 2;
  window.addEventListener('resize', resize);

  // Respond to arrow keys and start our ~60fps game loop
  window.addEventListener('keydown', function (e) { keyChange(true, e) });
  window.addEventListener('keyup', function (e) { keyChange(false, e) });
  gameLoop();

  function gameLoop (timer) {
    // Clear the canvas
    c.fillStyle = 'ivory'
    c.fillRect(0, 0, width, height)

    // Move our hero (without going outside screen)
    if (keys.left && hero.x > 0) hero.x -= hero.speed
    if (keys.right && hero.x + hero.size < width) hero.x += hero.speed
    if (keys.up && hero.y > 0) hero.y -= hero.speed
    if (keys.down && hero.y + hero.size < height) hero.y += hero.speed

    // Move junk, removing if off screen
    for (let i = junk.length - 1; i >= 0; i--) {
      junk[i].x -= junk[i].speed
      if (junk[i].x + junk[i].size < 0) junk.splice(i, 1)
    }

    // See if we're touching any junk, and respond accordingly
    if (lives > 0) detectHit()

    // Draw our 'hero'
    c.fillStyle = 'blue'
    c.fillRect(hero.x, hero.y, hero.size, hero.size)

    // Draw all the junk flying at the hero
    for (let i = 0; i < junk.length; i++) {
      c.fillStyle = junk[i].good ? 'lime' : 'red'
      c.fillRect(junk[i].x, junk[i].y, junk[i].size, junk[i].size)
    }

    // Show time and score. The HUD stays a fixed size so it reads the same on
    // any window, rather than scaling up into a billboard.
    c.textAlign = 'left'
    c.fillStyle = 'black'
    c.font = '16px monospace'
    c.fillText('Lives: ' + lives + '     Score: ' + score, 12, 24)
    c.fillText('High score: ' + highScore, 12, 44)

    if (lives <= 0) {
      c.textAlign = 'center'
      c.fillStyle = 'black'
      c.font = '40px monospace'
      c.fillText('GAME OVER', width / 2, height / 2)
      c.font = '14px monospace'
      c.fillText('press R to restart', width / 2, height / 2 + 30)
    }

    // add random junk (getting faster over time), but not once we are dead
    if (lives > 0) {
      let gameSpeed = Math.max(2, 50 - Math.round((timer || 0) / 1000 / 3))
      // A wider window needs proportionally more junk, otherwise a big screen
      // ends up emptier and easier than a small one.
      let spawnEvery = Math.max(1, Math.round(gameSpeed * 400 / width))
      if (tick % spawnEvery == 0) {
        let points = Math.round(Math.random() * 11 + 4) // 4 to 15
        let size = points * scale
        junk.push({
          x: width, // just off the right edge of screen
          y: Math.random() * (height - size), // stays fully on screen
          speed: (Math.random() * 3 + 1) * scale, // 1 to 4, scaled
          good: Math.random() > 0.6, // mostly bad/red
          size: size,
          points: points // scored unscaled, so the high score compares across windows
        })
      }
    }

    // Run the loop again
    tick++
    window.requestAnimationFrame(gameLoop)
  }

  function keyChange (onOff, e) {
    // Restart after a game over
    if (onOff && e.key.toLowerCase() == 'r' && lives <= 0) {
      score = 0; lives = 3; tick = 0; junk = []
      hero.x = width / 2 - hero.size / 2
      hero.y = height / 2 - hero.size / 2
      return
    }
    for (let i = 0; i < Object.keys(keys).length; i++) {
      if (e.key.toLowerCase() == 'arrow' + Object.keys(keys)[i]) {
        keys[Object.keys(keys)[i]] = onOff
        e.preventDefault()
      }
    }
  }

  function detectHit () {
    for (let i = junk.length - 1; i >= 0; i--) {
      if (
          hero.x < junk[i].x + junk[i].size &&
          hero.x + hero.size > junk[i].x &&
          hero.y < junk[i].y + junk[i].size &&
          hero.y + hero.size > junk[i].y
      ) {
        if (junk[i].good) { // we got some good junk
          score += junk[i].points
          if (score > highScore) {
            highScore = score
            window.localStorage.setItem('highScore', highScore)
          }
        } else lives -= 1 // we hit a bad one; lose a life
        junk.splice(i, 1) // either way, we remove this junk
      }
    }
  }

  // Optional real fullscreen, for when filling the browser window is not enough.
  const fullscreenButton = document.getElementById('fullscreen');
  if (fullscreenButton && document.documentElement.requestFullscreen) {
    fullscreenButton.addEventListener('click', function () {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    });
  } else if (fullscreenButton) {
    fullscreenButton.style.display = 'none';
  }
})();
