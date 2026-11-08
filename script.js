/**
 * =====================================================================
 * CHANGAVI MATHIALAGAN - Y2K / MYSPACE PERSONAL WEBSITE
 * Plain Vanilla JavaScript: Spinnable & Zoomable Boombox, Windows 98 Notepad,
 * and Multi-Input Horizontal CD Collection Carousel
 * =====================================================================
 */

// ---------------------------------------------------------------------
// CONFIGURATION & TUNING CONSTANTS
// ---------------------------------------------------------------------
const DRAG_THRESHOLD = 6;      // Pixels: movement under this counts as a click
const CLICK_MAX_MS = 250;      // Milliseconds: clicks must finish within this time
const FRICTION = 0.95;         // Momentum decay rate per frame (0.95 = 5% slowdown)
const MIN_VELOCITY = 0.03;     // Threshold (deg/frame) where momentum stops
const ZOOM_MS = 1000;          // Duration of the boombox zoom animation
const CD_STEP_PX = 170;        // Width of one album cover (150px) + gap (20px)

// Global state variables
let currentRotation = 0;       // Current boombox rotation in degrees
let isDragging = false;        // Pointer is currently down and dragging
let isTransitioning = false;   // CD waterfall site transition is active
let pointerStartX = 0;
let pointerStartY = 0;
let pointerStartTime = 0;
let lastPointerAngle = 0;
let momentumVelocity = 0;
let momentumRafId = null;
let pointerHistory = [];       // Track angular velocity over last ~100ms
let activePointerId = null;

// DOM Elements
const landingScreen = document.getElementById('landing-screen');
const mainPage = document.getElementById('main-page');
const transitionOverlay = document.getElementById('transition-overlay');
const boomboxBtn = document.getElementById('landing-boombox-btn');
const landingHint = document.getElementById('landing-hint');
const landingTitle = document.querySelector('.landing-title');
const mainHeading = document.getElementById('main-heading');

// CD waterfall transition settings
const CD_IMAGE_SRC = 'cd.png';  // CD picture that falls during the transition
const CD_COUNT = 110;           // How many CDs fall
const CD_SWAP_MS = 1300;        // When the page switches (while CDs are falling)
const CD_END_MS = 3300;         // When the CD layer is removed (after the last CD has fallen)
new Image().src = CD_IMAGE_SRC; // Preload so the first CDs don't pop in late

// Notepad elements
const notepadWindow = document.getElementById('notepad-window');
const notepadBody = document.getElementById('notepad-body');
const notepadTextarea = document.getElementById('notepad-textarea');
const notepadStatusText = document.getElementById('notepad-status-text');
const btnNotepadMinimize = document.getElementById('btn-notepad-minimize');
const btnNotepadClose = document.getElementById('btn-notepad-close');
const btnNotepadMaximize = document.getElementById('btn-notepad-maximize');

// CD Rack elements
const verticalCdList = document.getElementById('vertical-cd-list');
const boomboxCurrentCover = document.getElementById('boombox-current-cover');
const currentDiscTitle = document.getElementById('current-disc-title');

// ---------------------------------------------------------------------
// 1. BOOMBOX ROTATION & DRAG ENGINE (LANDING SCREEN)
// ---------------------------------------------------------------------

/**
 * Calculates pointer angle in degrees relative to the boombox's center
 */
function getPointerAngle(clientX, clientY, element) {
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  return Math.atan2(clientY - centerY, clientX - centerX) * (180 / Math.PI);
}

/**
 * Renders the boombox rotation using GPU transform
 */
function renderRotation() {
  if (boomboxBtn && !isTransitioning) {
    boomboxBtn.style.transform = `rotate(${currentRotation}deg)`;
  }
}

/**
 * Momentum physics loop: smoothly decelerates rotation on release
 */
function momentumLoop() {
  if (isDragging || isTransitioning) return;

  momentumVelocity *= FRICTION;
  currentRotation += momentumVelocity;
  renderRotation();

  if (Math.abs(momentumVelocity) > MIN_VELOCITY) {
    momentumRafId = requestAnimationFrame(momentumLoop);
  } else {
    momentumVelocity = 0;
    momentumRafId = null;
  }
}

/**
 * Handles pointerdown (mouse, touch, or stylus)
 */
function onBoomboxPointerDown(e) {
  if (isTransitioning) return;

  // Stop any running momentum immediately
  if (momentumRafId) {
    cancelAnimationFrame(momentumRafId);
    momentumRafId = null;
  }
  momentumVelocity = 0;

  isDragging = true;
  activePointerId = e.pointerId;
  boomboxBtn.setPointerCapture(e.pointerId);
  boomboxBtn.classList.add('is-dragging');

  pointerStartX = e.clientX;
  pointerStartY = e.clientY;
  pointerStartTime = performance.now();
  lastPointerAngle = getPointerAngle(e.clientX, e.clientY, boomboxBtn);

  // Initialize velocity tracking history
  pointerHistory = [{
    time: pointerStartTime,
    rotation: currentRotation
  }];
}

/**
 * Handles pointermove: calculates incremental angle changes
 */
function onBoomboxPointerMove(e) {
  if (!isDragging || e.pointerId !== activePointerId || isTransitioning) return;

  const currentAngle = getPointerAngle(e.clientX, e.clientY, boomboxBtn);
  let deltaAngle = currentAngle - lastPointerAngle;

  // Handle -180 / +180 boundary wraparound so rotation never jumps
  while (deltaAngle > 180) deltaAngle -= 360;
  while (deltaAngle < -180) deltaAngle += 360;

  currentRotation += deltaAngle;
  lastPointerAngle = currentAngle;

  const now = performance.now();
  pointerHistory.push({ time: now, rotation: currentRotation });

  // Keep history to entries within the last 120ms
  pointerHistory = pointerHistory.filter(entry => now - entry.time <= 120);

  renderRotation();
}

/**
 * Handles pointerup and pointercancel: detects Click vs Drag and applies momentum
 */
function onBoomboxPointerUp(e) {
  if (!isDragging || e.pointerId !== activePointerId) return;

  isDragging = false;
  boomboxBtn.classList.remove('is-dragging');
  try {
    boomboxBtn.releasePointerCapture(e.pointerId);
  } catch (err) {
    // Pointer capture might have already been released
  }

  const now = performance.now();
  const elapsed = now - pointerStartTime;
  const dist = Math.hypot(e.clientX - pointerStartX, e.clientY - pointerStartY);

  // RULE: Total movement under 6px and under 250ms counts as a click
  if (dist < DRAG_THRESHOLD && elapsed < CLICK_MAX_MS) {
    enterSite();
    return;
  }

  // Check if reduced motion is preferred
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) {
    return; // No momentum under reduced motion
  }

  // Calculate release velocity based on the last ~100ms of motion
  const recentEntries = pointerHistory.filter(item => now - item.time <= 100);
  if (recentEntries.length >= 2) {
    const oldest = recentEntries[0];
    const newest = recentEntries[recentEntries.length - 1];
    const timeDelta = newest.time - oldest.time;
    if (timeDelta > 0) {
      // Degrees per frame (normalized to 60fps / ~16.67ms per frame)
      const degDelta = newest.rotation - oldest.rotation;
      momentumVelocity = (degDelta / timeDelta) * 16.67;
    }
  }

  // Start momentum spin if above threshold
  if (Math.abs(momentumVelocity) > MIN_VELOCITY) {
    momentumRafId = requestAnimationFrame(momentumLoop);
  }
}

/**
 * Keyboard navigation on the boombox button (Enter/Space to zoom, Arrows to nudge)
 */
function onBoomboxKeyDown(e) {
  if (isTransitioning) return;

  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    enterSite();
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    currentRotation += 15;
    renderRotation();
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    currentRotation -= 15;
    renderRotation();
  }
}

// ---------------------------------------------------------------------
// 2. SITE ZOOM TRANSITION (LANDING -> MAIN PAGE)
// ---------------------------------------------------------------------

/**
 * Pours a waterfall of CDs down the screen and reveals the main profile page
 */
function enterSite() {
  if (isTransitioning) return;
  isTransitioning = true;

  // Cancel any active momentum
  if (momentumRafId) {
    cancelAnimationFrame(momentumRafId);
    momentumRafId = null;
  }

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // REDUCED MOTION: Quick cross-fade without zoom or physics
  if (prefersReducedMotion) {
    transitionOverlay.classList.add('active');
    setTimeout(() => {
      completeTransition();
      setTimeout(() => {
        transitionOverlay.classList.remove('active');
      }, 50);
    }, 200);
    return;
  }

  // FULL MOTION: a waterfall of CDs pours down the screen
  // 1. Quickly fade out landing title and hint
  if (landingTitle) landingTitle.style.opacity = '0';
  if (landingHint) landingHint.style.opacity = '0';

  // 2. Release the CDs
  launchCdWaterfall();

  // 3. Just before the screen is full of CDs, fade the aqua overlay in to hide the page swap
  setTimeout(() => {
    transitionOverlay.classList.add('active');
  }, CD_SWAP_MS - 300);

  // 4. Switch pages while the CDs keep falling, then fade the overlay out to reveal the main page
  setTimeout(() => {
    completeTransition();
    setTimeout(() => {
      transitionOverlay.classList.remove('active');
    }, 80);
  }, CD_SWAP_MS);
}

/**
 * Creates a layer of CD images that fall from the top of the screen like a waterfall.
 * CHANGE ME: tweak CD_COUNT / CD_SWAP_MS / CD_END_MS at the top of this section.
 */
function launchCdWaterfall() {
  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, {
    position: 'fixed',
    inset: '0',
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: '10001'
  });

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const baseSize = Math.max(64, Math.min(vw / 9, 150));

  for (let i = 0; i < CD_COUNT; i++) {
    const size = baseSize * (0.6 + Math.random() * 0.8);
    // Spread the CDs evenly across the width so the "waterfall" has no big gaps
    const x = ((i + Math.random()) / CD_COUNT) * vw - size / 2;
    const delay = Math.pow(Math.random(), 1.2) * 1500;
    const duration = 1000 + Math.random() * 600;
    const spin = (Math.random() < 0.5 ? -1 : 1) * (180 + Math.random() * 540);
    const drift = (Math.random() - 0.5) * 60;

    const img = document.createElement('img');
    img.src = CD_IMAGE_SRC;
    img.alt = '';
    img.draggable = false;
    Object.assign(img.style, {
      position: 'absolute',
      left: x + 'px',
      top: '0',
      width: size + 'px',
      height: 'auto',
      willChange: 'transform'
    });

    img.animate(
      [
        { transform: `translate3d(0, ${-size - 20}px, 0) rotate(0deg)` },
        { transform: `translate3d(${drift}px, ${vh + 20}px, 0) rotate(${spin}deg)` }
      ],
      {
        duration,
        delay,
        easing: 'cubic-bezier(0.45, 0.05, 0.9, 0.7)', // speeds up like gravity
        fill: 'both'
      }
    );

    layer.appendChild(img);
  }

  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), CD_END_MS);
}

/**
 * Hides landing screen, reveals main page, and moves keyboard focus
 */
function completeTransition() {
  // Hide landing screen completely from layout and assistive technology
  landingScreen.style.display = 'none';
  landingScreen.setAttribute('aria-hidden', 'true');
  landingScreen.setAttribute('inert', '');

  // Reveal main page
  mainPage.removeAttribute('inert');
  mainPage.removeAttribute('aria-hidden');

  // Scroll to top
  window.scrollTo(0, 0);

  // Move keyboard focus to main page heading for screen-reader & keyboard users
  if (mainHeading) {
    mainHeading.focus();
  }

  // Remove event listeners from landing boombox to clean up
  boomboxBtn.removeEventListener('pointerdown', onBoomboxPointerDown);
  boomboxBtn.removeEventListener('pointermove', onBoomboxPointerMove);
  boomboxBtn.removeEventListener('pointerup', onBoomboxPointerUp);
  boomboxBtn.removeEventListener('pointercancel', onBoomboxPointerUp);
  boomboxBtn.removeEventListener('keydown', onBoomboxKeyDown);
}

// ---------------------------------------------------------------------
// 3. WINDOWS 98 NOTEPAD CONTROLS & LIVE WORD COUNT
// ---------------------------------------------------------------------

/**
 * Counts whitespace-separated words in string
 */
function countWords(str) {
  const clean = str.trim();
  if (!clean) return 0;
  return clean.split(/\s+/).length;
}

/**
 * Updates status bar with live word count
 */
function updateWordCount() {
  if (!notepadTextarea || !notepadStatusText) return;
  const words = countWords(notepadTextarea.innerText || notepadTextarea.textContent || '');
  notepadStatusText.textContent = `${words} word${words === 1 ? '' : 's'}`;
}

/**
 * Initializes Notepad window controls (Minimize, Close, Maximize, Live Typing)
 */
function initNotepad() {
  if (!notepadTextarea) return;

  // Initialize word count on load
  updateWordCount();

  // Live word counter on text input
  notepadTextarea.addEventListener('input', updateWordCount);

  // Minimize Button: collapses the window body and toggles aria-expanded
  if (btnNotepadMinimize) {
    btnNotepadMinimize.addEventListener('click', () => {
      const isMin = notepadWindow.classList.toggle('is-minimized');
      btnNotepadMinimize.setAttribute('aria-expanded', isMin ? 'false' : 'true');
    });
  }

  // Close Button: shows a playful retro "nice try!" message for 2 seconds
  if (btnNotepadClose) {
    let closeTimeout = null;
    btnNotepadClose.addEventListener('click', () => {
      if (closeTimeout) clearTimeout(closeTimeout);
      notepadStatusText.textContent = 'nice try! :-)';
      closeTimeout = setTimeout(() => {
        updateWordCount();
      }, 2000);
    });
  }

  // Maximize Button: subtle active feedback
  if (btnNotepadMaximize) {
    btnNotepadMaximize.addEventListener('click', () => {
      notepadStatusText.textContent = 'window at maximum!';
      setTimeout(updateWordCount, 1500);
    });
  }
}

// ---------------------------------------------------------------------
// 4. VERTICAL CD RACK & INTERACTIVE BOOMBOX DISC LOADING
// ---------------------------------------------------------------------

/**
 * Initializes the vertical CD collection rack so clicking any album
 * dynamically replaces the album currently loaded into the CD player / boombox.
 */
function initCdRack() {
  const rackItems = document.querySelectorAll('.cd-rack-item');
  const boomboxCurrentCover = document.getElementById('boombox-current-cover');
  const currentDiscTitle = document.getElementById('current-disc-title');

  // If an album cover image is missing, show the CD picture instead of a broken image
  rackItems.forEach(item => {
    const cover = item.querySelector('.rack-cover');
    if (!cover) return;
    const useFallback = () => {
      if (cover.getAttribute('src') === CD_IMAGE_SRC) return;
      cover.src = CD_IMAGE_SRC;
      item.setAttribute('data-cover', CD_IMAGE_SRC);
    };
    cover.addEventListener('error', useFallback);
    if (cover.complete && cover.naturalWidth === 0) useFallback();
  });

  rackItems.forEach(item => {
    item.addEventListener('click', () => {
      const coverSrc = item.getAttribute('data-cover');
      const title = item.getAttribute('data-title') || 'Album';

      // 1. Update visual 'is-loaded' status in the rack
      rackItems.forEach(otherItem => {
        otherItem.classList.remove('is-loaded');
        const badge = otherItem.querySelector('.rack-status-badge');
        if (badge) badge.textContent = 'LOAD';
      });
      item.classList.add('is-loaded');
      const badge = item.querySelector('.rack-status-badge');
      if (badge) badge.textContent = 'LOADED';

      // 2. Insert disc into CD Player (Boombox peek) with tactile slide animation
      if (boomboxCurrentCover && coverSrc) {
        boomboxCurrentCover.src = coverSrc;
        boomboxCurrentCover.alt = `Currently loaded in CD player: ${title}`;

        // Re-trigger disc insert animation
        boomboxCurrentCover.classList.remove('disc-swap-anim');
        void boomboxCurrentCover.offsetWidth; // Force CSS reflow
        boomboxCurrentCover.classList.add('disc-swap-anim');
      }

      // 3. Update the Disc Loaded status pill below boombox
      if (currentDiscTitle) {
        currentDiscTitle.textContent = title;
      }
    });
  });
}

// ---------------------------------------------------------------------
// 5. Y2K GLITTER WAND CURSOR TRAIL & CLICK SPARKLES
// ---------------------------------------------------------------------

let lastTrailX = 0;
let lastTrailY = 0;
let lastTrailTime = 0;
const TRAIL_DISTANCE_THRESHOLD = 9;  // pixels: dropped every ~9px of motion
const TRAIL_THROTTLE_MS = 24;        // throttled for silky 60fps performance

/**
 * Spawns a magic fairy wand glitter sparkle trailing the cursor
 */
function spawnWandSparkle(x, y) {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) return;

  const symbols = ['✦', '★', '✧', '⋆', '✨', '•'];
  const colors = ['#ffffff', '#ffff80', '#ff96d6', '#00bbc3', '#b3fbff', '#ffebb3'];

  const sparkle = document.createElement('span');
  sparkle.className = 'wand-sparkle';
  sparkle.textContent = symbols[Math.floor(Math.random() * symbols.length)];
  sparkle.style.left = `${x}px`;
  sparkle.style.top = `${y}px`;

  const color = colors[Math.floor(Math.random() * colors.length)];
  sparkle.style.color = color;

  // Gentle fairy dust drift
  const driftX = (Math.random() - 0.5) * 22;
  const driftY = 10 + Math.random() * 18;
  sparkle.style.setProperty('--wand-vx', `${driftX}px`);
  sparkle.style.setProperty('--wand-vy', `${driftY}px`);
  sparkle.style.fontSize = `${11 + Math.random() * 10}px`;

  document.body.appendChild(sparkle);

  setTimeout(() => {
    sparkle.remove();
  }, 650);
}

/**
 * Wand cursor trail event handler
 */
function onPointerMoveTrail(e) {
  const now = performance.now();
  if (now - lastTrailTime < TRAIL_THROTTLE_MS) return;

  const dx = e.clientX - lastTrailX;
  const dy = e.clientY - lastTrailY;
  const dist = Math.hypot(dx, dy);

  if (dist >= TRAIL_DISTANCE_THRESHOLD) {
    lastTrailX = e.clientX;
    lastTrailY = e.clientY;
    lastTrailTime = now;
    spawnWandSparkle(e.clientX, e.clientY);
  }
}

/**
 * Creates playful retro sparkle burst on click / tap
 */
function createSparkleBurst(x, y) {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) return;

  const symbols = ['✦', '★', '✧', '⋆', '✨'];
  const colors = ['#ffffff', '#ffff80', '#ff96d6', '#00bbc3', '#ffeb3b'];
  const count = 4;

  for (let i = 0; i < count; i++) {
    const sparkle = document.createElement('span');
    sparkle.className = 'click-sparkle';
    sparkle.textContent = symbols[Math.floor(Math.random() * symbols.length)];
    sparkle.style.left = `${x}px`;
    sparkle.style.top = `${y}px`;
    sparkle.style.color = colors[Math.floor(Math.random() * colors.length)];

    // Random trajectory
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.8;
    const distance = 25 + Math.random() * 30;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance - 20;

    sparkle.style.setProperty('--dx', `${dx}px`);
    sparkle.style.setProperty('--dy', `${dy}px`);
    sparkle.style.fontSize = `${14 + Math.random() * 12}px`;

    document.body.appendChild(sparkle);

    setTimeout(() => {
      sparkle.remove();
    }, 750);
  }
}

function initSparkles() {
  // Wand glitter trail following cursor
  window.addEventListener('pointermove', onPointerMoveTrail, { passive: true });

  // Click / tap sparkle bursts
  document.addEventListener('pointerdown', (e) => {
    // Avoid creating burst inside interactive drag boombox on landing to keep physics pristine
    if (e.target.closest('#landing-boombox-btn')) return;
    createSparkleBurst(e.clientX, e.clientY);
  });
}

// ---------------------------------------------------------------------
// 6. INITIALIZATION ON DOM READY
// ---------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize Landing Boombox Controls
  if (boomboxBtn) {
    boomboxBtn.addEventListener('pointerdown', onBoomboxPointerDown);
    boomboxBtn.addEventListener('pointermove', onBoomboxPointerMove);
    boomboxBtn.addEventListener('pointerup', onBoomboxPointerUp);
    boomboxBtn.addEventListener('pointercancel', onBoomboxPointerUp);
    boomboxBtn.addEventListener('keydown', onBoomboxKeyDown);
  }

  // 2. Initialize Notepad Window
  initNotepad();

  // 3. Initialize Interactive CD Rack
  initCdRack();

  // 4. Initialize Interactive Sparkles
  initSparkles();

  // 5. Skip the landing screen when returning from another page (index.html#home)
  if (location.hash === '#home' && landingScreen && mainPage) {
    completeTransition();
  }
});