/* ── State ─────────────────────────────────────────────── */
const STORAGE_KEY = 'faceoff_stats';

const state = {
  category: 'mixed',
  questions: [],
  questionIndex: 0,
  nextBatch: null,
  prefetching: false,
  seen: [],
  score: 0,
  streak: 0,
  bestStreak: 0,
  totalAnswered: 0,
  difficulty: 1,
  loading: false,
  revealed: false,
};

/* ── Elements ──────────────────────────────────────────── */
const landing      = document.getElementById('landing');
const game         = document.getElementById('game');
const startBtn     = document.getElementById('startBtn');
const quitBtn      = document.getElementById('quitBtn');
const scoreValue   = document.getElementById('scoreValue');
const questionNum  = document.getElementById('questionNum');
const streakValue  = document.getElementById('streakValue');
const questionText = document.getElementById('questionText');
const cardA        = document.getElementById('cardA');
const cardB        = document.getElementById('cardB');
const nameA        = document.getElementById('nameA');
const nameB        = document.getElementById('nameB');
const valueA       = document.getElementById('valueA');
const valueB       = document.getElementById('valueB');
const resultArea   = document.getElementById('resultArea');
const resultText   = document.getElementById('resultText');
const funFact      = document.getElementById('funFact');
const nextBtn      = document.getElementById('nextBtn');
const loader       = document.getElementById('loader');
const bestDisplay  = document.getElementById('bestDisplay');

/* ── Landing ───────────────────────────────────────────── */
document.querySelectorAll('.cat-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelector('.cat-chip.active').classList.remove('active');
    chip.classList.add('active');
    state.category = chip.dataset.cat;
  });
});

startBtn.addEventListener('click', startGame);
quitBtn.addEventListener('click', quitGame);
nextBtn.addEventListener('click', nextQuestion);
cardA.addEventListener('click', () => handleChoice('A'));
cardB.addEventListener('click', () => handleChoice('B'));

// Show best score on landing
showBestScore();

/* ── Game lifecycle ────────────────────────────────────── */
function startGame() {
  state.questions = [];
  state.questionIndex = 0;
  state.nextBatch = null;
  state.prefetching = false;
  state.seen = [];
  state.score = 0;
  state.streak = 0;
  state.bestStreak = 0;
  state.totalAnswered = 0;
  state.difficulty = 1;
  state.revealed = false;

  updateScoreUI();
  game.classList.add('active');
  fetchQuestions();
}

function quitGame() {
  game.classList.remove('active');
  saveStats();
  showBestScore();
}

/* ── Fetch questions ───────────────────────────────────── */
async function fetchQuestions() {
  state.loading = true;
  loader.classList.remove('hidden');
  hideArena();

  try {
    const res = await fetch('/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: state.category,
        difficulty: state.difficulty,
        seen: state.seen,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const { questions } = await res.json();
    state.questions = questions;
    state.questionIndex = 0;

    showQuestion();
  } catch (err) {
    console.error('Fetch error:', err);
    resultArea.classList.remove('hidden');
    resultText.textContent = 'Something went wrong';
    resultText.className = 'result-text is-wrong';
    funFact.textContent = err.message;
    nextBtn.textContent = 'Try again';
  } finally {
    state.loading = false;
    loader.classList.add('hidden');
  }
}

async function prefetchBatch() {
  if (state.prefetching || state.nextBatch) return;
  state.prefetching = true;

  try {
    const res = await fetch('/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: state.category,
        difficulty: state.difficulty,
        seen: state.seen,
      }),
    });

    if (res.ok) {
      const { questions } = await res.json();
      state.nextBatch = questions;
    }
  } catch (e) {
    // Silently fail — we'll fetch again when needed
  } finally {
    state.prefetching = false;
  }
}

/* ── Show question ─────────────────────────────────────── */
function showQuestion() {
  const q = state.questions[state.questionIndex];
  if (!q) {
    // No more questions in batch
    if (state.nextBatch) {
      state.questions = state.nextBatch;
      state.nextBatch = null;
      state.questionIndex = 0;
      showQuestion();
      return;
    }
    fetchQuestions();
    return;
  }

  state.revealed = false;

  // Randomise which side A and B appear on
  questionText.innerHTML = `Which is <span>${esc(q.comparison)}</span>?`;

  nameA.textContent = q.itemA.name;
  nameB.textContent = q.itemB.name;
  valueA.textContent = q.itemA.value;
  valueB.textContent = q.itemB.value;

  // Reset card states
  valueA.className = 'face-value hidden';
  valueB.className = 'face-value hidden';
  cardA.className = 'face-card';
  cardB.className = 'face-card';
  cardA.disabled = false;
  cardB.disabled = false;

  resultArea.classList.add('hidden');
  nextBtn.textContent = 'Next question';
  showArena();

  questionNum.textContent = state.totalAnswered + 1;

  // Prefetch at question 6 of 8
  if (state.questionIndex >= 5) {
    prefetchBatch();
  }
}

/* ── Handle choice ─────────────────────────────────────── */
function handleChoice(side) {
  if (state.revealed || state.loading) return;
  state.revealed = true;

  const q = state.questions[state.questionIndex];
  const correctSide = getCorrectSide(q);
  const isCorrect = side === correctSide;

  // Track seen
  state.seen.push(`${q.itemA.name} vs ${q.itemB.name}`);
  state.totalAnswered++;

  // Update score
  if (isCorrect) {
    state.score++;
    state.streak++;
    if (state.streak > state.bestStreak) state.bestStreak = state.streak;
  } else {
    state.streak = 0;
  }

  // Update difficulty
  state.difficulty = calcDifficulty();

  // Disable cards
  cardA.disabled = true;
  cardB.disabled = true;

  // Reveal values
  const correctCard = correctSide === 'A' ? cardA : cardB;
  const wrongCard = correctSide === 'A' ? cardB : cardA;
  const correctVal = correctSide === 'A' ? valueA : valueB;
  const wrongVal = correctSide === 'A' ? valueB : valueA;

  correctCard.classList.add('correct');
  wrongCard.classList.add('wrong');
  correctVal.className = 'face-value correct-val';
  wrongVal.className = 'face-value wrong-val';

  // Result text
  if (isCorrect) {
    resultText.textContent = 'Correct!';
    resultText.className = 'result-text is-correct';
  } else {
    const winner = correctSide === 'A' ? q.itemA.name : q.itemB.name;
    resultText.textContent = `Wrong! It was ${winner}`;
    resultText.className = 'result-text is-wrong';
  }

  funFact.textContent = q.funFact || '';
  resultArea.classList.remove('hidden');

  updateScoreUI();
}

/* ── Next question ─────────────────────────────────────── */
function nextQuestion() {
  state.questionIndex++;
  showQuestion();
}

/* ── Helpers ───────────────────────────────────────────── */
function getCorrectSide(q) {
  const a = Number(q.itemA.numericValue);
  const b = Number(q.itemB.numericValue);
  if (q.lowerIsCorrect) {
    return a < b ? 'A' : 'B';
  }
  return a > b ? 'A' : 'B';
}

function calcDifficulty() {
  let d = Math.min(5, 1 + Math.floor(state.score / 8));
  const accuracy = state.totalAnswered > 0 ? state.score / state.totalAnswered : 1;
  if (accuracy < 0.5 && d > 1) d--;
  if (state.streak >= 5 && d < 5) d++;
  return d;
}

function updateScoreUI() {
  scoreValue.textContent = state.score;
  streakValue.textContent = state.streak;

  // Bump animation
  scoreValue.classList.add('bump');
  streakValue.classList.add('bump');
  setTimeout(() => {
    scoreValue.classList.remove('bump');
    streakValue.classList.remove('bump');
  }, 200);

  // Fire mode for streaks of 3+
  if (state.streak >= 3) {
    streakValue.classList.add('on-fire');
  } else {
    streakValue.classList.remove('on-fire');
  }
}

function showArena() {
  document.getElementById('arena').classList.remove('hidden');
}

function hideArena() {
  document.getElementById('arena').classList.add('hidden');
}

function saveStats() {
  try {
    const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const stats = {
      bestScore: Math.max(existing.bestScore || 0, state.score),
      bestStreak: Math.max(existing.bestStreak || 0, state.bestStreak),
      gamesPlayed: (existing.gamesPlayed || 0) + 1,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch (e) {}
}

function showBestScore() {
  try {
    const stats = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (stats.bestScore) {
      bestDisplay.innerHTML = `Best score: <span>${stats.bestScore}</span> | Best streak: <span>${stats.bestStreak}</span>`;
    }
  } catch (e) {}
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
