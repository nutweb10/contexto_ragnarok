// RO Monster Hunt — Core Logic v2.6 (Firebase Edition)
// ─────────────────────────────────────────────────────
// Firebase Configuration — Fill in your own config from Firebase Console
// https://console.firebase.google.com/
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, doc, getDoc, setDoc, increment } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
    apiKey: "AIzaSyCV0EQU-Qx23AUdiHnTVso0GIyUnLn_Ij8",
    authDomain: "ro-monster-hunt.firebaseapp.com",
    projectId: "ro-monster-hunt",
    storageBucket: "ro-monster-hunt.firebasestorage.app",
    messagingSenderId: "442007769180",
    appId: "1:442007769180:web:5504d862099cf56af4d699"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const STATS_DOC = doc(db, 'gameStats', 'global');
// ─────────────────────────────────────────────────────

let monsterDatabase = [];
let secretMonster = null;
let guessHistory = [];
let nameGuessCount = 0;

// Track verified attributes
let attributeStatus = { race: false, property: false, size: false };

// Analyzer Sidebar Lists
let unsortedList = [];
let maybeList = new Set();
let notList = new Set();

// Global sets
let allRaces = new Set();
let allProperties = new Set();
let allSizes = new Set();
let allItems = new Set();
let allMaps = new Set();
let allMonsterNames = new Set();
let monsterCardSet = new Set();

const raceGroups = [
    ["undead", "demon", "angel", "formless"],
    ["brute", "dragon", "fish"],
    ["plant", "insect"],
    ["demi-human"]
];

const propertyGroups = [
    ["holy", "shadow", "ghost", "undead"],
    ["water", "earth", "fire", "wind"],
    ["poison"],
    ["neutral"]
];

// Server Stats (loaded from Firestore on game start)
let serverStats = {
    totalGames: 0,
    totalWins: 0,
    totalLosses: 0,
    totalGuesses: 0
};

// DOM Elements
const submitBtn = document.getElementById('submit-btn');
const resetBtn = document.getElementById('reset-btn');
const historyBody = document.getElementById('history-body');
const currentRank = document.getElementById('current-rank');
const modalContainer = document.getElementById('modal-container');
const modalSecretName = document.getElementById('modal-secret-name');
const modalClose = document.getElementById('modal-close');
const nameAttemptIndicator = document.getElementById('name-attempt-indicator');
const analyzerLockOverlay = document.getElementById('analyzer-lock-overlay');

// Sidebar Elements
const analyzerSearch = document.getElementById('analyzer-search');
const listUnsorted = document.getElementById('list-unsorted');
const listMaybe = document.getElementById('list-maybe');
const listNot = document.getElementById('list-not');
const countUnsorted = document.getElementById('count-unsorted');
const countMaybe = document.getElementById('count-maybe');
const countNot = document.getElementById('count-not');

const inputs = {
    name: document.getElementById('guess-name'),
    race: document.getElementById('guess-race'),
    property: document.getElementById('guess-property'),
    size: document.getElementById('guess-size'),
    item: document.getElementById('guess-item'),
    map: document.getElementById('guess-map')
};

// 1. Initialize Game
async function initGame() {
    try {
        const response = await fetch('data.csv');
        const csvData = await response.text();
        monsterDatabase = parseCSV(csvData);
        await loadServerStats();
        startNewGame();
        setupEventListeners();
    } catch (error) {
        console.error("Error loading game data:", error);
    }
}

// Load global stats from Firestore (called on game start)
async function loadServerStats() {
    try {
        const snapshot = await getDoc(STATS_DOC);
        if (snapshot.exists()) {
            serverStats = snapshot.data();
        } else {
            // First time — create initial document
            await setDoc(STATS_DOC, serverStats);
        }
    } catch (e) {
        console.warn('Could not load server stats:', e);
    }
    renderServerStats();
}

// Write result to Firestore on game end
async function updateServerStats(isWin, matchGuesses) {
    try {
        // setDoc with merge:true works even if document doesn't exist yet
        await setDoc(STATS_DOC, {
            totalGames: increment(1),
            totalWins: increment(isWin ? 1 : 0),
            totalLosses: increment(isWin ? 0 : 1),
            totalGuesses: increment(matchGuesses)
        }, { merge: true });
        await loadServerStats(); // Refresh display
    } catch (e) {
        console.warn('Could not update server stats:', e);
    }
}

function renderServerStats() {
    document.getElementById('global-total-games').textContent = serverStats.totalGames.toLocaleString();
    document.getElementById('global-total-wins').textContent = serverStats.totalWins.toLocaleString();
    document.getElementById('global-total-losses').textContent = serverStats.totalLosses.toLocaleString();
    const avg = serverStats.totalGames > 0
        ? (serverStats.totalGuesses / serverStats.totalGames).toFixed(1)
        : '0.0';
    document.getElementById('global-avg-guesses').textContent = avg;
}

function startNewGame() {
    secretMonster = monsterDatabase[Math.floor(Math.random() * monsterDatabase.length)];
    // Debug: console.log("Secret Monster:", secretMonster.name);

    guessHistory = [];
    nameGuessCount = 0;
    historyBody.innerHTML = '';
    currentRank.innerHTML = '<i data-lucide="crosshair"></i> Ready for Hunt';
    currentRank.className = "rank-badge cold";
    modalContainer.style.display = 'none';

    // Reset Lock Overlay (v2.5)
    if (analyzerLockOverlay) {
        analyzerLockOverlay.classList.remove('hidden');
    }

    document.getElementById('attempt-count').textContent = 'Guesses: 0';
    if (nameAttemptIndicator) {
        nameAttemptIndicator.textContent = '0/3';
        nameAttemptIndicator.style.color = 'var(--text-secondary)';
    }

    attributeStatus = { race: false, property: false, size: false };
    Object.values(inputs).forEach(input => {
        input.value = '';
        input.disabled = false;
        if (input.parentElement) input.parentElement.classList.remove('correct-field');
    });

    initAnalyzer();
    lucide.createIcons();
}

function initAnalyzer() {
    unsortedList = monsterDatabase.map(m => m.name);
    maybeList = new Set();
    notList = new Set();
    refreshAnalyzerUI();
}

// 2. CSV Parser
function parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    allRaces.clear(); allProperties.clear(); allSizes.clear(); allItems.clear(); allMaps.clear(); allMonsterNames.clear();

    const monsterNames = lines.slice(1).map(line => line.split(',')[0].trim().toLowerCase());
    monsterCardSet = new Set(monsterNames.map(name => `${name} card`));

    return lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.trim());
        const monster = {};
        headers.forEach((header, i) => {
            monster[header.toLowerCase()] = values[i] || '';
        });

        monster.items = [];
        for (let i = 1; i <= 8; i++) {
            const item = monster[`item${i}`];
            if (item) {
                const normItem = normalizeString(item);
                monster.items.push(normItem);
                if (normItem !== "monster card" && !monsterCardSet.has(normItem)) {
                    allItems.add(normItem);
                }
            }
        }
        monster.maps = [];
        for (let i = 1; i <= 5; i++) {
            const map = monster[`map${i}`];
            if (map) {
                const lcMap = map.toLowerCase();
                monster.maps.push(lcMap);
                allMaps.add(lcMap);
            }
        }
        monster.name_lc = monster.name.toLowerCase();
        monster.race_lc = monster.race.toLowerCase();
        monster.property_lc = monster.property.toLowerCase();
        monster.size_lc = monster.size.toLowerCase();
        allMonsterNames.add(monster.name_lc);
        allRaces.add(monster.race_lc);
        allProperties.add(monster.property_lc);
        allSizes.add(monster.size_lc);
        return monster;
    });
}

function normalizeString(str) {
    return str.replace(/\s*\[\d+\]/g, '').trim().toLowerCase();
}

// 3. Smart Matching Logic
function getMonsterCompatibility(monsterName) {
    const monster = monsterDatabase.find(m => m.name === monsterName);
    if (!monster) return { match: 0, high: false, attributes: 0 };
    let matches = 0;
    let totalVerified = 0;
    if (attributeStatus.race) {
        totalVerified++;
        if (monster.race_lc === secretMonster.race_lc) matches++;
    }
    if (attributeStatus.property) {
        totalVerified++;
        if (monster.property_lc === secretMonster.property_lc) matches++;
    }
    if (attributeStatus.size) {
        totalVerified++;
        if (monster.size_lc === secretMonster.size_lc) matches++;
    }
    if (totalVerified === 0) return { match: 0, high: false, attributes: 0 };
    const percentage = Math.round((matches / totalVerified) * 100);
    return {
        match: percentage, high: percentage === 100, attributes: matches, possible: matches === totalVerified
    };
}

function autoPruneAnalyzer() {
    if (!attributeStatus.race && !attributeStatus.property && !attributeStatus.size) return;
    let toPrune = [];
    unsortedList.forEach(name => {
        const stats = getMonsterCompatibility(name);
        if (!stats.possible) toPrune.push(name);
    });
    toPrune.forEach(name => {
        unsortedList = unsortedList.filter(n => n !== name);
        notList.add(name);
    });
    refreshAnalyzerUI();
}

function refreshAnalyzerUI() {
    const searchVal = analyzerSearch.value.toLowerCase();
    const sortFn = (a, b) => b.match - a.match || a.name.localeCompare(b.name);
    const sortedUnsorted = [...unsortedList]
        .map(name => ({ name, ...getMonsterCompatibility(name) }))
        .sort(sortFn)
        .filter(item => item.name.toLowerCase().includes(searchVal));
    const sortedMaybe = Array.from(maybeList).map(name => ({ name, ...getMonsterCompatibility(name) })).sort(sortFn);
    const sortedNot = Array.from(notList).map(name => ({ name, ...getMonsterCompatibility(name) })).sort(sortFn);
    renderAnalyzerList('unsorted', sortedUnsorted);
    renderAnalyzerList('maybe', sortedMaybe);
    renderAnalyzerList('not', sortedNot);
    updateAnalyzerCounters();
}

// 4. Scoring Algorithm
function calculateSimilarity(guesses) {
    const secret = secretMonster;
    let totalScore = 0;
    const gName = guesses.name.trim().toLowerCase();
    if (gName === secret.name_lc) return { score: 100, rank: "Target Found", feedback: "Match!" };
    if (gName !== "" && gName[0] === secret.name_lc[0]) totalScore += 10;

    const gRace = guesses.race.trim().toLowerCase();
    if (gRace !== "") {
        if (gRace === secret.race_lc) { totalScore += 20; attributeStatus.race = true; }
        else {
            const sG = raceGroups.findIndex(g => g.includes(secret.race_lc));
            const gG = raceGroups.findIndex(g => g.includes(gRace));
            if (sG !== -1 && sG === gG) totalScore += 10;
        }
    }
    const gProp = guesses.property.trim().toLowerCase();
    if (gProp !== "") {
        if (gProp === secret.property_lc) { totalScore += 20; attributeStatus.property = true; }
        else {
            const sG = propertyGroups.findIndex(g => g.includes(secret.property_lc));
            const gG = propertyGroups.findIndex(g => g.includes(gProp));
            if (sG !== -1 && sG === gG) totalScore += 10;
        }
    }
    const gSize = guesses.size.trim().toLowerCase();
    if (gSize === secret.size_lc) { totalScore += 20; attributeStatus.size = true; }

    const gItem = guesses.item.trim().toLowerCase();
    if (gItem !== "" && secret.items.includes(normalizeString(gItem))) totalScore += (20 - (secret.items.length - 1));

    const gMap = guesses.map.trim().toLowerCase();
    if (gMap !== "" && secret.maps.includes(gMap)) totalScore += (20 - (secret.maps.length - 1) * 2);

    totalScore = Math.min(100, Math.max(0, totalScore));
    return { score: totalScore, rank: getRank(totalScore), feedback: "Log" };
}

function getRank(score) {
    if (score >= 100) return "Target Found";
    if (score >= 86) return "Almost Found";
    if (score >= 61) return "Strong Presence";
    if (score >= 20) return "Faint Trail";
    return "No Trace";
}

// 5. UI Functions
function handleGuess() {
    // Unlock Analyzer (v2.5) on first guess
    if (analyzerLockOverlay) {
        analyzerLockOverlay.classList.add('hidden');
    }

    const rawItemGuess = inputs.item.value.trim().toLowerCase();
    if (rawItemGuess === "monster card" || monsterCardSet.has(rawItemGuess)) {
        inputs.item.value = '';
        alert("You cannot guess a Monster Card.");
        return;
    }

    const currentNameGuess = inputs.name.value.trim().toLowerCase();
    if (currentNameGuess !== "") {
        nameGuessCount++;
        nameAttemptIndicator.textContent = `${nameGuessCount}/3`;
        if (nameGuessCount >= 2) nameAttemptIndicator.style.color = 'var(--accent-danger)';
    }

    const currentGuesses = {
        name: inputs.name.value, race: inputs.race.value, property: inputs.property.value,
        size: inputs.size.value, item: inputs.item.value, map: inputs.map.value
    };

    const filledValues = Object.values(currentGuesses).filter(v => v.trim() !== "");
    if (filledValues.length === 0) return;

    const result = calculateSimilarity(currentGuesses);
    const guessWords = Object.values(currentGuesses).filter(v => v.trim() !== "");
    const guessObj = { words: guessWords, score: result.score, rank: result.rank, hint: result.feedback };

    guessHistory.unshift(guessObj);
    updateHistoryTable();
    updateRankBadge(result);
    updateVerifiedUI();
    autoPruneAnalyzer();

    Object.entries(inputs).forEach(([key, input]) => { if (!attributeStatus[key]) input.value = ''; });
    document.querySelectorAll('.autocomplete-items').forEach(el => el.style.display = 'none');

    if (result.score === 100) showGameOver(true);
    else if (nameGuessCount >= 3) showGameOver(false);
}

function updateVerifiedUI() {
    Object.entries(attributeStatus).forEach(([key, isCorrect]) => {
        if (isCorrect) {
            const input = inputs[key];
            const container = input.parentElement;
            if (container) container.classList.add('correct-field');
            input.disabled = true;
            input.value = secretMonster[`${key}_lc`].charAt(0).toUpperCase() + secretMonster[`${key}_lc`].slice(1);
        }
    });
    lucide.createIcons();
}

function updateHistoryTable() {
    historyBody.innerHTML = '';
    document.getElementById('attempt-count').textContent = `Guesses: ${guessHistory.length}`;
    guessHistory.forEach(guess => {
        const card = document.createElement('div');
        card.className = 'guess-card';
        const chipsHtml = guess.words.map(w => `<span class="guess-chip">${w}</span>`).join('');
        card.innerHTML = `<div class="chips-wrapper">${chipsHtml}</div><div class="card-score">${guess.score}</div>`;
        historyBody.appendChild(card);
    });
    lucide.createIcons();
}

function updateRankBadge(result) {
    const classMap = {
        "Target Found": "correct",
        "Almost Found": "very-close",
        "Strong Presence": "hot",
        "Faint Trail": "warm",
        "No Trace": "cold"
    };

    const rankClass = classMap[result.rank] || "cold";
    currentRank.innerHTML = `${getRankIcon(result.rank)} <span>${result.rank}</span>`;
    currentRank.className = `rank-badge ${rankClass}`;
    lucide.createIcons();
}

function getRankIcon(rank) {
    const iconSize = 'style="width: 16px; height: 16px; min-width: 16px;"';
    switch (rank) {
        case "Target Found": return `<i data-lucide="check-circle-2" ${iconSize}></i>`;
        case "Almost Found": return `<i data-lucide="radar" ${iconSize}></i>`;
        case "Strong Presence": return `<i data-lucide="flame" ${iconSize}></i>`;
        case "Faint Trail": return `<i data-lucide="wind" ${iconSize}></i>`;
        default: return `<i data-lucide="ghost" ${iconSize}></i>`;
    }
}

function showGameOver(isWin) {
    const modalTitle = document.getElementById('modal-title');
    const modalIcon = document.getElementById('modal-icon');
    const modalMessage = document.getElementById('modal-message');

    if (isWin) {
        modalTitle.textContent = "Target Defeated!";
        modalHeaderState('var(--accent-primary)', 'party-popper');
        modalMessage.textContent = "Well done, Adventurer.";
    } else {
        modalTitle.textContent = "Target Escaped...";
        modalHeaderState('var(--accent-danger)', 'ghost');
        modalMessage.textContent = "You ran out of name attempts.";
    }

    updateServerStats(isWin, guessHistory.length);
    modalSecretName.textContent = secretMonster.name;
    const stats = `<div style="margin-top: 15px; opacity: 0.8; font-size: 1.1rem;">${secretMonster.race} • ${secretMonster.property} • ${secretMonster.size}<br><small style="color: var(--text-secondary)">Known Locations: ${secretMonster.maps.join(', ')}</small></div>`;
    document.getElementById('victory-stats-container').innerHTML = stats;
    modalContainer.style.display = 'flex';
    lucide.createIcons();
}

function modalHeaderState(color, icon) {
    const t = document.getElementById('modal-title');
    const i = document.getElementById('modal-icon');
    t.style.color = color;
    i.setAttribute('data-lucide', icon);
    i.style.color = color;
}

// Sidebar Functions
function setupEventListeners() {
    submitBtn.onclick = handleGuess;
    resetBtn.onclick = startNewGame;
    modalClose.onclick = startNewGame;

    analyzerSearch.oninput = () => refreshAnalyzerUI();
    setupDropZones();

    Object.entries(inputs).forEach(([type, input]) => {
        const list = input.parentElement.querySelector('.autocomplete-items');
        input.oninput = (e) => {
            const val = e.target.value.toLowerCase();
            list.innerHTML = '';
            if (!val || val.length < 1) { list.style.display = 'none'; return; }
            let matches = [];
            if (type === 'name') matches = monsterDatabase.filter(m => m.name_lc.includes(val)).map(m => m.name);
            else if (type === 'map') matches = Array.from(allMaps).filter(m => m.includes(val));
            else if (type === 'item') matches = Array.from(allItems).filter(i => i.includes(val));
            else if (type === 'race') matches = Array.from(allRaces).filter(r => r.includes(val));
            else if (type === 'property') matches = Array.from(allProperties).filter(p => p.includes(val));
            else if (type === 'size') matches = Array.from(allSizes).filter(s => s.includes(val));
            matches = [...new Set(matches)].slice(0, 8);
            if (matches.length > 0) {
                matches.forEach(m => {
                    const div = document.createElement('div');
                    div.textContent = m;
                    div.onclick = () => { input.value = m; list.style.display = 'none'; };
                    list.appendChild(div);
                });
                list.style.display = 'block';
            } else list.style.display = 'none';
        };
        input.onkeydown = (e) => { if (e.key === 'Enter') handleGuess(); };
    });
}

function renderAnalyzerList(type, statsArray) {
    const container = type === 'unsorted' ? listUnsorted : (type === 'maybe' ? listMaybe : listNot);
    container.innerHTML = '';
    statsArray.forEach(item => {
        const div = document.createElement('div');
        div.className = `monster-tag ${item.high ? 'high-match' : ''}`;
        div.textContent = item.name;
        div.draggable = true;
        div.ondragstart = (e) => { e.dataTransfer.setData('monsterName', item.name); e.dataTransfer.setData('sourceList', type); };
        if (item.match > 0) {
            const b = document.createElement('span'); b.className = 'match-badge'; b.textContent = `${item.match}%`; div.prepend(b);
        }
        const actions = document.createElement('div'); actions.className = 'tag-actions';
        if (type !== 'maybe') addTagBtn(actions, '✔', 'maybe', item.name, type);
        if (type !== 'not') addTagBtn(actions, '✖', 'not', item.name, type);
        if (type !== 'unsorted') addTagBtn(actions, '↺', 'unsorted', item.name, type);
        div.appendChild(actions);
        container.appendChild(div);
    });
}

function addTagBtn(container, txt, target, name, source) {
    const b = document.createElement('button');
    b.className = `tag-btn ${target}`; b.innerHTML = txt;
    b.onclick = (e) => { e.stopPropagation(); moveMonster(name, source, target); };
    container.appendChild(b);
}

function moveMonster(name, source, target) {
    if (source === 'unsorted') unsortedList = unsortedList.filter(n => n !== name);
    else if (source === 'maybe') maybeList.delete(name);
    else notList.delete(name);
    if (target === 'unsorted') unsortedList.push(name);
    else if (target === 'maybe') maybeList.add(name);
    else notList.add(name);
    refreshAnalyzerUI();
}

function setupDropZones() {
    [listUnsorted, listMaybe, listNot].forEach(zone => {
        zone.ondrop = (e) => {
            const name = e.dataTransfer.getData('monsterName');
            const source = e.dataTransfer.getData('sourceList');
            const target = zone.id === 'list-unsorted' ? 'unsorted' : (zone.id === 'list-maybe' ? 'maybe' : 'not');
            moveMonster(name, source, target);
        };
        zone.ondragover = (e) => e.preventDefault();
    });
}

function updateAnalyzerCounters() {
    if (countUnsorted) countUnsorted.textContent = unsortedList.length;
    if (countMaybe) countMaybe.textContent = maybeList.size;
    if (countNot) countNot.textContent = notList.size;
}

initGame();
