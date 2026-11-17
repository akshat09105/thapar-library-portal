/**
 * Community Crowdsourced Vision & Seat Allocation Engine
 * Supports 4 locations: CSED, Lib Ground, Lib 1st, Lib 2nd
 * Persona A: Contributor (Add an image, model numbers empty seats, earns Rs 3)
 * Persona B: Student (View numbered vacant seats, reserve seat for 10 mins with @thapar.edu ID)
 */

const API_BASE = window.location.protocol.startsWith('http') ? '' : 'http://localhost:3000';

const DEFAULT_LOCATIONS = [
  { id: 'csed', name: 'CSED Building', icon: '💻', empty_seats_count: 0, seats: [], cooldown_until: 0, last_image: null },
  { id: 'lib_ground', name: 'Library Ground Floor', icon: '📚', empty_seats_count: 0, seats: [], cooldown_until: 0, last_image: null },
  { id: 'lib_floor1', name: 'Library 1st Floor', icon: '📖', empty_seats_count: 0, seats: [], cooldown_until: 0, last_image: null },
  { id: 'lib_floor2', name: 'Library 2nd Floor', icon: '🤫', empty_seats_count: 0, seats: [], cooldown_until: 0, last_image: null }
];

const CommunityState = {
  activePersona: 'student', // 'student' or 'contributor'
  activeLocationId: 'csed',
  locations: DEFAULT_LOCATIONS,
  activeBookings: [],
  totalDonations: 4250,
  contributor: null,
  selectedSeatForBooking: null,
  isInitialized: false
};

let lastCommunityFingerprint = "";

// 1. Initialize upon load (Instant zero-lag render without startup glitch)
document.addEventListener('DOMContentLoaded', () => {
  // Load saved contributor session if exists
  const savedContrib = localStorage.getItem('thapar_contributor_user');
  if (savedContrib) {
    try {
      CommunityState.contributor = JSON.parse(savedContrib);
    } catch (_) {}
  }

  // Ensure default mode is 'final'
  const savedMode = localStorage.getItem('thapar_portal_mode') || 'final';
  switchPortalMode(savedMode, false);

  // Pre-render immediately with default state to eliminate startup flicker/jump
  renderCommunityUI();

  // Setup upload listeners once
  setupCommunityUpload();

  // Initial fetch of community state from server
  fetchCommunityState();

  // Non-glitching interval: only diffs state, never wipes DOM unnecessarily
  setInterval(fetchCommunityState, 3500);
  setInterval(tickCooldownTimers, 1000);
});

// Mode Switcher (Final Submission Mode vs Classic Prototype)
window.switchPortalMode = function(mode, savePref = true) {
  if (savePref) localStorage.setItem('thapar_portal_mode', mode);
  const finalView = document.getElementById('finalSubmissionView');
  const classicView = document.getElementById('classicPrototypeView');
  const btnFinal = document.getElementById('toggleFinalModeBtn');
  const btnClassic = document.getElementById('toggleClassicModeBtn');

  if (mode === 'final') {
    if (finalView) finalView.classList.remove('hidden');
    if (classicView) classicView.classList.add('hidden');
    
    if (btnFinal) {
      btnFinal.className = "px-4 py-2 rounded-lg transition-all bg-thapar-red text-white shadow-sm font-bold flex items-center gap-1.5";
    }
    if (btnClassic) {
      btnClassic.className = "px-4 py-2 rounded-lg transition-all text-slate-600 hover:text-slate-900 flex items-center gap-1.5";
    }
  } else {
    if (finalView) finalView.classList.add('hidden');
    if (classicView) classicView.classList.remove('hidden');
    
    if (btnFinal) {
      btnFinal.className = "px-4 py-2 rounded-lg transition-all text-slate-600 hover:text-slate-900 flex items-center gap-1.5";
    }
    if (btnClassic) {
      btnClassic.className = "px-4 py-2 rounded-lg transition-all bg-slate-900 text-white shadow-sm font-bold flex items-center gap-1.5";
    }

    // Lazy load classic seat vision if not already initialized
    if (!window.classicSeatVisionLoaded && window.initSeatVision) {
      window.classicSeatVisionLoaded = true;
      window.initSeatVision();
    }
  }
};

// Persona Switcher (Student vs Contributor)
window.switchPersona = function(persona) {
  CommunityState.activePersona = persona;
  const studentSection = document.getElementById('studentPersonaSection');
  const contribSection = document.getElementById('contributorPersonaSection');
  const btnStudent = document.getElementById('roleStudentBtn');
  const btnContrib = document.getElementById('roleContributorBtn');
  const title = document.getElementById('finalPersonaTitle');
  const subtitle = document.getElementById('finalPersonaSubtitle');

  if (persona === 'student') {
    if (studentSection) studentSection.classList.remove('hidden');
    if (contribSection) contribSection.classList.add('hidden');

    if (btnStudent) {
      btnStudent.className = "flex-1 md:flex-none px-5 py-2.5 rounded-xl font-mono text-xs font-bold transition-all bg-white text-slate-900 shadow-sm border border-slate-200 flex items-center justify-center gap-2";
    }
    if (btnContrib) {
      btnContrib.className = "flex-1 md:flex-none px-5 py-2.5 rounded-xl font-mono text-xs font-bold transition-all text-slate-600 hover:text-slate-900 flex items-center justify-center gap-2";
    }

    if (title) title.textContent = "🎓 Student Portal • Find & Reserve Live Empty Seats";
    if (subtitle) subtitle.textContent = "Browse live campus photos, see numbered vacant desks, and reserve with your @thapar.edu ID.";
  } else {
    if (studentSection) studentSection.classList.add('hidden');
    if (contribSection) contribSection.classList.remove('hidden');

    if (btnStudent) {
      btnStudent.className = "flex-1 md:flex-none px-5 py-2.5 rounded-xl font-mono text-xs font-bold transition-all text-slate-600 hover:text-slate-900 flex items-center justify-center gap-2";
    }
    if (btnContrib) {
      btnContrib.className = "flex-1 md:flex-none px-5 py-2.5 rounded-xl font-mono text-xs font-bold transition-all bg-emerald-600 text-white shadow-sm flex items-center justify-center gap-2";
    }

    if (title) title.textContent = "📸 Contributor Portal • Add an Image & Earn ₹3";
    if (subtitle) subtitle.textContent = "Snap and add a fresh hall image to help peers find seats. Earn ₹3 into your purse for every verified upload.";

    renderContributorUI();
  }
};

// Fetch State from Server with Diff Caching (Prevents Startup Stutter & Flickers)
async function fetchCommunityState() {
  try {
    const res = await fetch(API_BASE + '/api/community/state');
    if (!res.ok) return;
    const data = await res.json();
    
    // Create state fingerprint to determine if anything actually changed
    const fingerprint = JSON.stringify({
      locs: (data.locations || []).map(l => ({
        id: l.id,
        c: l.empty_seats_count,
        cd: l.isCooldownActive,
        img: (l.last_image ? l.last_image.substring(0, 30) : '')
      })),
      bLen: (data.activeBookings || []).length,
      don: data.totalDonations
    });

    const hasChanged = (fingerprint !== lastCommunityFingerprint);
    lastCommunityFingerprint = fingerprint;

    CommunityState.locations = data.locations || [];
    CommunityState.activeBookings = data.activeBookings || [];
    CommunityState.totalDonations = data.totalDonations || 4250;

    // Only perform full DOM re-renders if data truly changed or first load
    if (hasChanged || !CommunityState.isInitialized) {
      CommunityState.isInitialized = true;
      renderCommunityUI();
    }
  } catch (err) {
    console.warn("Failed to fetch community state:", err);
  }
}

// Master UI Render
function renderCommunityUI() {
  renderLocationTabs();
  renderActiveLocationView();
  renderDonationSection();
  if (CommunityState.activePersona === 'contributor') {
    renderContributorUI();
  }
}

// 1-Sec Tick for Cooldown Countdown (Updates text in-place without re-rendering DOM)
function tickCooldownTimers() {
  const loc = CommunityState.locations.find(l => l.id === CommunityState.activeLocationId);
  if (!loc) return;

  if (loc.cooldown_until && loc.cooldown_until > Date.now()) {
    const secondsLeft = Math.max(0, Math.ceil((loc.cooldown_until - Date.now()) / 1000));
    const mins = Math.floor(secondsLeft / 60);
    const secs = String(secondsLeft % 60).padStart(2, '0');
    const timeStr = `${mins}:${secs}`;

    const studentCooldown = document.getElementById('activeLocCooldownBanner');
    if (studentCooldown) {
      studentCooldown.classList.remove('hidden');
      const timeSpan = studentCooldown.querySelector('.cooldown-time-val');
      if (timeSpan) timeSpan.textContent = timeStr;
    }

    const contribLockTimer = document.getElementById('contribLockTimerText');
    if (contribLockTimer) {
      contribLockTimer.textContent = `${timeStr} remaining until next contribution opens`;
    }
  } else {
    // Cooldown ended
    const studentCooldown = document.getElementById('activeLocCooldownBanner');
    if (studentCooldown && !studentCooldown.classList.contains('hidden')) {
      studentCooldown.classList.add('hidden');
    }
    const contribLockBox = document.getElementById('contribCooldownLockBox');
    const contribUploadForm = document.getElementById('contribUploadForm');
    if (contribLockBox && !contribLockBox.classList.contains('hidden')) {
      contribLockBox.classList.add('hidden');
      if (contribUploadForm) contribUploadForm.classList.remove('hidden');
    }
  }
}

// Render 4 Location Tabs
function renderLocationTabs() {
  const container = document.getElementById('communityLocationTabs');
  if (!container) return;

  const locs = [
    { id: 'csed', name: 'CSED Building', icon: '💻' },
    { id: 'lib_ground', name: 'Library Ground Floor', icon: '📚' },
    { id: 'lib_floor1', name: 'Library 1st Floor', icon: '📖' },
    { id: 'lib_floor2', name: 'Library 2nd Floor', icon: '🤫' }
  ];

  container.innerHTML = locs.map(l => {
    const data = CommunityState.locations.find(x => x.id === l.id);
    const vacantCount = data ? data.empty_seats_count : 0;
    const isSelected = CommunityState.activeLocationId === l.id;

    const activeClass = isSelected
      ? "bg-thapar-red text-white border-thapar-red shadow-md ring-2 ring-thapar-red/20"
      : "bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50";

    const badgeClass = isSelected
      ? "bg-white/20 text-white"
      : (vacantCount > 0 ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500");

    return `
      <button onclick="selectCommunityLocation('${l.id}')" class="p-3.5 rounded-2xl border text-left transition-all flex flex-col justify-between gap-2 ${activeClass}">
        <div class="flex items-center justify-between">
          <span class="text-base">${l.icon}</span>
          <span class="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${badgeClass}">
            ${vacantCount > 0 ? `${vacantCount} Vacant` : 'No Image Yet'}
          </span>
        </div>
        <div>
          <span class="text-xs font-mono font-bold block leading-tight">${l.name}</span>
          <span class="text-[10px] opacity-75 font-mono">Live Detection Grid</span>
        </div>
      </button>
    `;
  }).join('');
}

window.selectCommunityLocation = function(locId) {
  CommunityState.activeLocationId = locId;
  renderLocationTabs();
  renderActiveLocationView();
  if (CommunityState.activePersona === 'contributor') {
    renderContributorUI();
  }
};

// Render Active Location for Students
function renderActiveLocationView() {
  const loc = CommunityState.locations.find(l => l.id === CommunityState.activeLocationId);
  const titleEl = document.getElementById('activeLocTitle');
  const countEl = document.getElementById('activeLocVacantCount');
  const metaEl = document.getElementById('activeLocMeta');
  const emptyStateEl = document.getElementById('activeLocEmptyState');
  const liveContentEl = document.getElementById('activeLocLiveContent');
  const cooldownEl = document.getElementById('activeLocCooldownBanner');

  if (!loc) return;

  if (titleEl) titleEl.textContent = loc.name;
  if (countEl) countEl.textContent = loc.empty_seats_count || 0;

  // Metadata
  if (metaEl) {
    if (loc.last_updated_at > 0 && loc.contributor_name) {
      const minsAgo = Math.max(1, Math.round((Date.now() - loc.last_updated_at) / 60000));
      metaEl.innerHTML = `Photo contributed by <strong class="text-slate-700">${loc.contributor_name}</strong> (${loc.contributor_roll}) &bull; ${minsAgo}m ago`;
    } else {
      metaEl.textContent = "Awaiting first image upload from community contributor";
    }
  }

  // Cooldown status
  if (cooldownEl) {
    if (loc.isCooldownActive) {
      const secondsLeft = Math.max(0, Math.ceil((loc.cooldown_until - Date.now()) / 1000));
      const mins = Math.floor(secondsLeft / 60);
      const secs = String(secondsLeft % 60).padStart(2, '0');
      cooldownEl.innerHTML = `
        <span class="w-2 h-2 rounded-full bg-amber-500 animate-ping mr-2"></span>
        <span>Cooldown active: Next community photo update opens in <strong class="cooldown-time-val">${mins}:${secs}</strong> (Images refresh in 10-min windows)</span>
      `;
      cooldownEl.classList.remove('hidden');
    } else {
      cooldownEl.classList.add('hidden');
    }
  }

  // No image state: only show empty state if NO image was ever contributed
  if (!loc.last_image) {
    if (emptyStateEl) emptyStateEl.classList.remove('hidden');
    if (liveContentEl) liveContentEl.classList.add('hidden');
    return;
  }

  // If no vacant seats were detected by model
  if (!loc.seats) loc.seats = [];

  // Live content display
  if (emptyStateEl) emptyStateEl.classList.add('hidden');
  if (liveContentEl) liveContentEl.classList.remove('hidden');

  // Render Canvas with numbered boxes
  drawCanvasWithBoxes(loc);

  // Render clickable seat cards
  renderSeatBookingGrid(loc);
}

// Draw Image with Numbered Empty Seat Boxes
function drawCanvasWithBoxes(loc) {
  const canvas = document.getElementById('topViewCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const img = new Image();
  img.onload = () => {
    canvas.width = 640;
    canvas.height = 640;

    // Draw base image
    ctx.drawImage(img, 0, 0, 640, 640);

    const scaleX = 640 / (img.naturalWidth || 640);
    const scaleY = 640 / (img.naturalHeight || 640);

    // Overlay seats
    (loc.seats || []).forEach((seat) => {
      const box = seat.box.map((v, i) => Math.round(v * (i % 2 === 0 ? scaleX : scaleY)));
      const [x1, y1, x2, y2] = box;
      const w = x2 - x1;
      const h = y2 - y1;

      const isBooked = seat.status === 'BOOKED';

      // Box outline
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = isBooked ? '#f59e0b' : '#10b981';
      ctx.strokeRect(x1, y1, w, h);

      // Box tint
      ctx.fillStyle = isBooked ? 'rgba(245, 158, 11, 0.22)' : 'rgba(16, 185, 129, 0.20)';
      ctx.fillRect(x1, y1, w, h);

      // Seat Badge Pill
      const label = isBooked ? `${seat.id} [BOOKED]` : `${seat.id} [VACANT]`;
      ctx.font = 'bold 12px "Space Grotesk", monospace';
      const textMetrics = ctx.measureText(label);
      const badgeW = textMetrics.width + 12;
      const badgeH = 20;
      const badgeX = Math.max(0, x1);
      const badgeY = Math.max(0, y1 - badgeH - 3);

      ctx.fillStyle = isBooked ? '#b45309' : '#047857';
      ctx.fillRect(badgeX, badgeY, badgeW, badgeH);

      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, badgeX + 6, badgeY + 14);
    });
  };
  img.src = loc.last_image;
}

// Render Seat Grid for Booking
function renderSeatBookingGrid(loc) {
  const container = document.getElementById('seatCardsGrid');
  if (!container) return;

  const seats = loc.seats || [];
  if (seats.length === 0) {
    container.innerHTML = '<p class="text-xs text-slate-400 font-mono">No seats identified in image.</p>';
    return;
  }

  container.innerHTML = seats.map(s => {
    const isBooked = s.status === 'BOOKED';

    if (isBooked) {
      return `
        <div class="p-3 rounded-xl border border-amber-300 bg-amber-50/60 flex flex-col justify-between gap-1.5 opacity-80">
          <div class="flex items-center justify-between">
            <span class="text-xs font-mono font-bold text-amber-900">${s.id}</span>
            <span class="text-[9px] font-mono px-1.5 py-0.5 bg-amber-200 text-amber-900 rounded font-bold">RESERVED</span>
          </div>
          <span class="text-[11px] text-amber-700 font-mono">Booked (10m grace)</span>
          <button disabled class="w-full mt-1 py-1 text-[11px] font-mono bg-slate-200 text-slate-500 rounded-lg cursor-not-allowed">
            Occupied
          </button>
        </div>
      `;
    }

    return `
      <div class="p-3 rounded-xl border border-emerald-300 bg-emerald-50/60 hover:bg-emerald-50 transition-all flex flex-col justify-between gap-1.5 shadow-sm">
        <div class="flex items-center justify-between">
          <span class="text-xs font-mono font-bold text-emerald-900">${s.id}</span>
          <span class="text-[9px] font-mono px-1.5 py-0.5 bg-emerald-200 text-emerald-800 rounded font-bold">VACANT</span>
        </div>
        <span class="text-[11px] text-emerald-700 font-mono">Model Verified (640px)</span>
        <button onclick="openBookingModal('${loc.id}', '${s.id}')" class="w-full mt-1 py-1.5 text-xs font-mono font-bold bg-thapar-red hover:bg-thapar-darkRed text-white rounded-lg transition-all shadow-sm">
          Reserve Desk
        </button>
      </div>
    `;
  }).join('');
}

// Booking Modal Logic
window.openBookingModal = function(locId, seatId) {
  CommunityState.selectedSeatForBooking = { locId, seatId };
  const loc = CommunityState.locations.find(l => l.id === locId);
  
  document.getElementById('modalBookingSeatLabel').textContent = `${seatId} &bull; ${loc ? loc.name : locId.toUpperCase()}`;
  document.getElementById('communityBookingModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
};

window.closeBookingModal = function() {
  document.getElementById('communityBookingModal').classList.add('hidden');
  document.body.style.overflow = '';
};

window.confirmCommunityBooking = async function() {
  const roll = document.getElementById('bookRollInput').value.trim();
  const email = document.getElementById('bookEmailInput').value.trim().toLowerCase();

  if (!roll || !email) {
    showToast("Missing Details", "Please enter your Roll Number and @thapar.edu Email.", "error");
    return;
  }
  if (!email.endsWith('@thapar.edu')) {
    showToast("Invalid Email", "Only official @thapar.edu email addresses can reserve.", "error");
    return;
  }

  const { locId, seatId } = CommunityState.selectedSeatForBooking || {};
  if (!locId || !seatId) return;

  const btn = document.getElementById('btnConfirmBooking');
  btn.disabled = true;
  btn.textContent = "Confirming...";

  try {
    const res = await fetch(API_BASE + '/api/community/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locationId: locId,
        seatNumber: seatId,
        studentRoll: roll,
        studentEmail: email
      })
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      showToast("Booking Failed", data.error || "Unable to reserve seat.", "error");
      return;
    }

    closeBookingModal();
    showToast("Seat Reserved!", `You have booked ${seatId} for 10 minutes. Arrive and occupy!`, "success");
    await fetchCommunityState();
  } catch (err) {
    showToast("Network Error", err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Confirm 10-Minute Reservation";
  }
};

// ============================================================================
// CONTRIBUTOR FLOW (Earn Rs 3 per Upload)
// ============================================================================

function renderContributorUI() {
  const authSection = document.getElementById('contribAuthSection');
  const dashSection = document.getElementById('contribDashboardSection');

  if (!CommunityState.contributor) {
    if (authSection) authSection.classList.remove('hidden');
    if (dashSection) dashSection.classList.add('hidden');
    return;
  }

  if (authSection) authSection.classList.add('hidden');
  if (dashSection) dashSection.classList.remove('hidden');

  const c = CommunityState.contributor;
  const nameEl = document.getElementById('contribNameDisplay');
  const rollEl = document.getElementById('contribRollDisplay');
  const walletEl = document.getElementById('contribWalletBalance');
  const countEl = document.getElementById('contribTotalCount');

  if (nameEl) nameEl.textContent = c.name;
  if (rollEl) rollEl.textContent = c.roll_number;
  if (walletEl) walletEl.textContent = `₹${(c.wallet_balance || 0).toFixed(2)}`;
  if (countEl) countEl.textContent = `${c.total_contributions || 0} Uploads`;

  // Render upload controls for active location
  renderContributorUploadBox();
}

window.loginContributor = async function() {
  const name = document.getElementById('contribInputName').value.trim();
  const roll = document.getElementById('contribInputRoll').value.trim();
  const email = document.getElementById('contribInputEmail').value.trim().toLowerCase();

  if (!roll || !email) {
    showToast("Missing Details", "Please provide your Roll Number and @thapar.edu email.", "error");
    return;
  }
  if (!email.endsWith('@thapar.edu')) {
    showToast("Invalid Email", "Please enter your official @thapar.edu address.", "error");
    return;
  }

  try {
    const res = await fetch(API_BASE + '/api/community/contributor/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, roll, email })
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      showToast("Sign In Failed", data.error || "Authentication error.", "error");
      return;
    }

    CommunityState.contributor = data.contributor;
    localStorage.setItem('thapar_contributor_user', JSON.stringify(data.contributor));
    showToast("Purse Ready!", `Welcome, ${data.contributor.name}! ₹${data.contributor.wallet_balance} in your purse.`, "success");
    renderContributorUI();
  } catch (err) {
    showToast("Network Error", err.message, "error");
  }
};

window.logoutContributor = function() {
  CommunityState.contributor = null;
  localStorage.removeItem('thapar_contributor_user');
  renderContributorUI();
};

function renderContributorUploadBox() {
  const loc = CommunityState.locations.find(l => l.id === CommunityState.activeLocationId);
  const lockEl = document.getElementById('contribCooldownLockBox');
  const formEl = document.getElementById('contribUploadForm');
  const lockTimerEl = document.getElementById('contribLockTimerText');
  const locNameEl = document.getElementById('contribUploadLocName');

  if (!loc) return;
  if (locNameEl) locNameEl.textContent = loc.name;

  if (loc.isCooldownActive) {
    if (lockEl) lockEl.classList.remove('hidden');
    if (formEl) formEl.classList.add('hidden');
    const secondsLeft = Math.max(0, Math.ceil((loc.cooldown_until - Date.now()) / 1000));
    const mins = Math.floor(secondsLeft / 60);
    const secs = String(secondsLeft % 60).padStart(2, '0');
    if (lockTimerEl) lockTimerEl.textContent = `${mins}:${secs} remaining until next contribution opens`;
  } else {
    if (lockEl) lockEl.classList.add('hidden');
    if (formEl) formEl.classList.remove('hidden');
  }
}

let activeUploadBase64 = null;

function setupCommunityUpload() {
  const input = document.getElementById('communityFileInput');
  const dropZone = document.getElementById('communityDropZone');
  const previewImg = document.getElementById('communityImagePreview');
  const submitBtn = document.getElementById('btnSubmitContribution');

  if (input) {
    input.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleFileSelect(e.target.files[0]);
      }
    });
  }

  function handleFileSelect(file) {
    if (!file.type.startsWith('image/')) {
      alert("Please upload an image file (.jpg, .png, .webp)");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      activeUploadBase64 = e.target.result;
      if (previewImg) {
        previewImg.src = activeUploadBase64;
        previewImg.classList.remove('hidden');
      }
      if (submitBtn) submitBtn.disabled = false;
    };
    reader.readAsDataURL(file);
  }
}

// ============================================================================
// CLIENT-SIDE ONNX RUNNER FOR best.onnx (100% IDENTICAL WEIGHTS TO best.pt)
// Runs directly in browser via WebAssembly / WebGL on Vercel without Python!
// ============================================================================

let onnxSession = null;
let isOnnxLoading = false;

async function getOnnxSession() {
  if (onnxSession) return onnxSession;
  if (typeof ort === 'undefined') {
    console.warn("ONNX Runtime Web library not loaded yet.");
    return null;
  }
  if (isOnnxLoading) {
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 200));
      if (onnxSession) return onnxSession;
    }
  }
  try {
    isOnnxLoading = true;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/';
    
    // Load best.onnx directly from public directory
    onnxSession = await ort.InferenceSession.create('/best.onnx', {
      executionProviders: ['wasm']
    });
    console.log("✓ Custom best.onnx model loaded into browser memory!");
    return onnxSession;
  } catch (err) {
    console.warn("Browser ONNX initialization notice:", err);
    return null;
  } finally {
    isOnnxLoading = false;
  }
}

function calculateIoU(boxA, boxB) {
  const xA = Math.max(boxA[0], boxB[0]);
  const yA = Math.max(boxA[1], boxB[1]);
  const xB = Math.min(boxA[2], boxB[2]);
  const yB = Math.min(boxA[3], boxB[3]);
  const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
  const boxAArea = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1]);
  const boxBArea = (boxB[2] - boxB[0]) * (boxB[3] - boxB[1]);
  const unionArea = boxAArea + boxBArea - interArea;
  return unionArea > 0 ? interArea / unionArea : 0;
}

function nonMaxSuppression(boxes, iouThresh = 0.45) {
  boxes.sort((a, b) => b.confidence - a.confidence);
  const selected = [];
  for (let i = 0; i < boxes.length; i++) {
    const current = boxes[i];
    let keep = true;
    for (let j = 0; j < selected.length; j++) {
      if (calculateIoU(current.box, selected[j].box) > iouThresh) {
        keep = false;
        break;
      }
    }
    if (keep) selected.push(current);
  }
  return selected;
}

async function runBestModelInBrowser(imgSrc) {
  try {
    const session = await getOnnxSession();
    if (!session) return null;

    return new Promise((resolve) => {
      const img = new Image();
      img.onload = async () => {
        try {
          const origW = img.naturalWidth || 640;
          const origH = img.naturalHeight || 640;

          const canvas = document.createElement('canvas');
          canvas.width = 640;
          canvas.height = 640;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, 640, 640);
          const imgData = ctx.getImageData(0, 0, 640, 640).data;

          const float32Data = new Float32Array(3 * 640 * 640);
          const channelSize = 640 * 640;

          for (let i = 0; i < channelSize; i++) {
            float32Data[i] = imgData[i * 4] / 255.0;                      // R
            float32Data[channelSize + i] = imgData[i * 4 + 1] / 255.0;    // G
            float32Data[2 * channelSize + i] = imgData[i * 4 + 2] / 255.0;// B
          }

          const tensor = new ort.Tensor('float32', float32Data, [1, 3, 640, 640]);
          const inputName = session.inputNames[0] || 'images';
          const feeds = {};
          feeds[inputName] = tensor;

          const results = await session.run(feeds);
          const outputName = session.outputNames[0] || 'output0';
          const preds = results[outputName].data; // 5 * 8400

          const numAnchors = 8400;
          const rawBoxes = [];
          const confThresh = 0.20;

          for (let col = 0; col < numAnchors; col++) {
            const conf = preds[4 * numAnchors + col];
            if (conf >= confThresh) {
              const xc = preds[0 * numAnchors + col];
              const yc = preds[1 * numAnchors + col];
              const w = preds[2 * numAnchors + col];
              const h = preds[3 * numAnchors + col];

              const x1 = Math.round((xc - w / 2) * (origW / 640));
              const y1 = Math.round((yc - h / 2) * (origH / 640));
              const x2 = Math.round((xc + w / 2) * (origW / 640));
              const y2 = Math.round((yc + h / 2) * (origH / 640));

              rawBoxes.push({
                box: [x1, y1, x2, y2],
                confidence: conf
              });
            }
          }

          const nmsBoxes = nonMaxSuppression(rawBoxes, 0.45);
          const detectedSeats = nmsBoxes.map((b, i) => ({
            id: `Seat #${i + 1}`,
            box: b.box,
            confidence: Math.round(b.confidence * 1000) / 10,
            status: 'VACANT'
          }));

          resolve(detectedSeats);
        } catch (innerErr) {
          console.warn("ONNX tensor processing notice:", innerErr);
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = imgSrc;
    });
  } catch (err) {
    console.warn("runBestModelInBrowser error:", err);
    return null;
  }
}

window.submitTopViewContribution = function() { window.submitContribution(); };
window.submitContribution = async function() {
  if (!activeUploadBase64) {
    showToast("No Image Selected", "Please select or drop an image first.", "error");
    return;
  }
  if (!CommunityState.contributor) {
    showToast("Please Sign In", "Sign into your contributor purse first.", "error");
    return;
  }

  const btn = document.getElementById('btnSubmitContribution');
  btn.disabled = true;
  btn.innerHTML = `<span class="inline-block animate-spin mr-2">⚡</span> Running best.onnx Neural Model...`;

  try {
    // 1. Run client-side inference using the exact exported best.onnx model
    let clientDetectedSeats = null;
    try {
      clientDetectedSeats = await runBestModelInBrowser(activeUploadBase64);
      if (clientDetectedSeats && clientDetectedSeats.length > 0) {
        console.log("Client-side best.onnx verified empty seats:", clientDetectedSeats);
      }
    } catch (onnxErr) {
      console.warn("Browser best.onnx runner notice:", onnxErr);
    }

    // 2. Submit to server (sending clientSeats if detected)
    const res = await fetch(API_BASE + '/api/community/contribute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locationId: CommunityState.activeLocationId,
        imageBase64: activeUploadBase64,
        rollNumber: CommunityState.contributor.roll_number,
        name: CommunityState.contributor.name,
        clientSeats: clientDetectedSeats || []
      })
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      showToast("Upload Blocked", data.error || "Contribution failed.", "error");
      return;
    }

    // Update local contributor wallet
    CommunityState.contributor.wallet_balance = (CommunityState.contributor.wallet_balance || 0) + 3.0;
    CommunityState.contributor.total_contributions = (CommunityState.contributor.total_contributions || 0) + 1;
    localStorage.setItem('thapar_contributor_user', JSON.stringify(CommunityState.contributor));

    showToast("🎉 ₹3.00 Credited to Your Purse!", `Identified ${data.emptySeatsCount} empty seats via custom model!`, "success");

    // Reset upload input
    activeUploadBase64 = null;
    const previewImg = document.getElementById('communityImagePreview');
    if (previewImg) previewImg.classList.add('hidden');

    // Invalidate state fingerprint so full re-render happens
    lastCommunityFingerprint = "";
    await fetchCommunityState();

    // Automatically switch to Student Portal so the user immediately sees the image and booking options!
    switchPersona('student');
    renderCommunityUI();

    // Smooth scroll down to the active location card
    setTimeout(() => {
      const activeLocCard = document.getElementById('activeLocTitle');
      if (activeLocCard) {
        activeLocCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 150);
  } catch (err) {
    showToast("Network Error", err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "🚀 Process With Model & Claim ₹3 Reward";
  }
};

// ============================================================================
// DONATIONS SECTION
// ============================================================================

function renderDonationSection() {
  const total = CommunityState.totalDonations || 4250;
  const goal = 10000;
  const pct = Math.min(100, Math.round((total / goal) * 100));

  const totalEl = document.getElementById('donationTotalText');
  const barEl = document.getElementById('donationProgressBar');
  const pctEl = document.getElementById('donationPctText');

  if (totalEl) totalEl.textContent = `₹${total.toLocaleString('en-IN')}`;
  if (barEl) barEl.style.width = `${pct}%`;
  if (pctEl) pctEl.textContent = `${pct}% Funded`;
}

window.openDonationModal = function() {
  document.getElementById('donationModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
};

window.closeDonationModal = function() {
  document.getElementById('donationModal').classList.add('hidden');
  document.body.style.overflow = '';
};

window.selectDonationPreset = function(amt) {
  document.getElementById('customDonationInput').value = amt;
};

window.confirmCommunityDonation = async function() {
  const name = document.getElementById('donorNameInput').value.trim() || 'Generous Thaparian';
  const amt = parseFloat(document.getElementById('customDonationInput').value) || 50;

  try {
    const res = await fetch(API_BASE + '/api/community/donate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ donorName: name, amount: amt })
    });
    const data = await res.json();
    if (res.ok) {
      CommunityState.totalDonations = data.totalDonations;
      renderDonationSection();
      closeDonationModal();
      showToast("Thank You!", `Thank you ${name} for supporting Thapar seat visibility infrastructure!`, "success");
    }
  } catch (err) {
    showToast("Donation Error", err.message, "error");
  }
};

// Global Floating Toast Notification
function showToast(title, body, type = "info") {
  const toast = document.createElement("div");
  toast.className = "fixed bottom-6 right-6 z-50 p-4 rounded-2xl backdrop-blur-md border border-slate-700 shadow-2xl transition-all duration-300 transform translate-y-2 opacity-0 flex items-start gap-3 bg-slate-900 text-white font-mono text-xs max-w-sm";
  
  const icon = type === 'success' ? '✓' : (type === 'error' ? '⚠️' : 'ℹ️');
  const iconColor = type === 'success' ? 'text-emerald-400' : (type === 'error' ? 'text-rose-400' : 'text-blue-400');

  toast.innerHTML = `
    <span class="text-base ${iconColor} font-bold">${icon}</span>
    <div class="flex-grow">
      <p class="font-bold tracking-tight text-white">${title}</p>
      <p class="text-[11px] text-slate-300 mt-0.5 leading-relaxed">${body}</p>
    </div>
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.remove("translate-y-2", "opacity-0"), 50);
  setTimeout(() => {
    toast.classList.add("opacity-0", "translate-y-2");
    setTimeout(() => toast.remove(), 400);
  }, 4500);
}
