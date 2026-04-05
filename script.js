// Separate audio busses so metronome is NOT recorded
const musicOut = new Tone.Gain(1).toDestination();
const metOut = new Tone.Gain(1).toDestination();

const piano = new Tone.Sampler({
    urls: { C4: "C4.mp3", A4: "A4.mp3" },
    baseUrl: "https://tonejs.github.io/audio/salamander/",
    release: 2.0,
});
piano.connect(musicOut);

const metronome = new Tone.MembraneSynth({
    volume: -10,
    pitchDecay: 0.01,
    octaves: 2,
    envelope: { attack: 0.001, decay: 0.15, sustain: 0 },
});
metronome.connect(metOut);

const recorder = new Tone.Recorder();
musicOut.connect(recorder);

let octave = 4;
let baseChordType = "maj";
let extensions = new Set();
let currentKey = "C";
let currentProg = "manual";
let isRecording = false;
let recStartedAtMs = 0;
let recTimerId = null;
let metEnabled = false;
let metBeat = 0;
let metEventId = null;
let playProgressions = false;

const BASE_INTERVALS = {
    maj: [0, 4, 7],
    min: [0, 3, 7],
    dim: [0, 3, 6],
    sus: [0, 5, 7],
    m7: [0, 3, 7, 10],
    M7: [0, 4, 7, 11],
};

const EXT_INTERVALS = { "6": 9, "9": 14 };

const KEY_MAP = {
    a: "C",
    w: "C#",
    s: "D",
    e: "D#",
    d: "E",
    f: "F",
    t: "F#",
    g: "G",
    y: "G#",
    h: "A",
    u: "A#",
    j: "B",
};

const KEY_OPTIONS = {
    natural: ["C", "D", "E", "F", "G", "A", "B"],
    sharp: ["C#", "D#", "F#", "G#", "A#"],
    flat: ["Db", "Eb", "Gb", "Ab", "Bb"],
};

const PROGRESSIONS = {
    "251": [
        { d: 2, t: "min", l: "ii" },
        { d: 7, t: "maj", l: "V" },
        { d: 0, t: "maj", l: "I" },
        { d: 0, t: "maj", l: "I" },
    ],
    "1625": [
        { d: 0, t: "maj", l: "I" },
        { d: 9, t: "min", l: "vi" },
        { d: 2, t: "min", l: "ii" },
        { d: 7, t: "maj", l: "V" },
    ],
    "1564": [
        { d: 0, t: "maj", l: "I" },
        { d: 7, t: "maj", l: "V" },
        { d: 9, t: "min", l: "vi" },
        { d: 5, t: "maj", l: "IV" },
    ],
    "1645": [
        { d: 0, t: "maj", l: "I" },
        { d: 9, t: "min", l: "vi" },
        { d: 5, t: "maj", l: "IV" },
        { d: 7, t: "maj", l: "V" },
    ],
    "2536": [
        { d: 2, t: "min", l: "ii" },
        { d: 7, t: "maj", l: "V" },
        { d: 4, t: "min", l: "iii" },
        { d: 9, t: "min", l: "vi" },
    ],
    "4536": [
        { d: 5, t: "maj", l: "IV" },
        { d: 7, t: "maj", l: "V" },
        { d: 4, t: "min", l: "iii" },
        { d: 9, t: "min", l: "vi" },
    ],
    "1451": [
        { d: 0, t: "maj", l: "I" },
        { d: 5, t: "maj", l: "IV" },
        { d: 7, t: "maj", l: "V" },
        { d: 0, t: "maj", l: "I" },
    ],
};

function formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${mm}:${ss}`;
}

function setRecButtonIdle() {
    const btn = document.getElementById("rec-audio-btn");
    btn.classList.remove("recording");
    btn.innerText = "⏺ REC";
}

function setRecButtonRecording() {
    const btn = document.getElementById("rec-audio-btn");
    btn.classList.add("recording");
    btn.innerText = `⏹ ${formatTime(0)}`;
}

function startRecTimer() {
    stopRecTimer();
    recStartedAtMs = performance.now();
    setRecButtonRecording();
    recTimerId = window.setInterval(() => {
        const elapsedSec = (performance.now() - recStartedAtMs) / 1000;
        document.getElementById("rec-audio-btn").innerText = `⏹ ${formatTime(elapsedSec)}`;
    }, 250);
}

function stopRecTimer() {
    if (recTimerId !== null) {
        window.clearInterval(recTimerId);
        recTimerId = null;
    }
}

function updateMetButton() {
    const btn = document.getElementById("met-btn");
    if (metEnabled) {
        btn.classList.add("active");
        btn.innerText = "♩ MET ON";
    } else {
        btn.classList.remove("active");
        btn.innerText = "♩ MET";
    }
}

function enableMetronome() {
    metEnabled = true;
    metBeat = 0;
    if (metEventId === null) {
        metEventId = Tone.Transport.scheduleRepeat((time) => {
            if (!metEnabled) return;
            const isAccent = metBeat % 4 === 0;
            metronome.triggerAttackRelease(isAccent ? "G5" : "C4", "32n", time, isAccent ? 1.0 : 0.3);
            metBeat++;
        }, "4n");
    }
    updateMetButton();
}

function disableMetronome() {
    metEnabled = false;
    updateMetButton();
}

function updateTransportState() {
    const shouldRun = metEnabled || playProgressions;
    if (shouldRun && Tone.Transport.state !== "started") {
        metBeat = 0;
        Tone.Transport.start();
    } else if (!shouldRun && Tone.Transport.state === "started") {
        Tone.Transport.stop();
        piano.releaseAll();
        setFrogHandsOff();
    }
}

function buildKeyboard() {
    const container = document.getElementById("piano-keys");
    container.innerHTML = "";

    const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

    NOTES.forEach((note) => {
        const key = document.createElement("div");
        key.className = `key ${note.includes("#") ? "key-black" : "key-white"}`;
        key.dataset.base = note;

        const label = document.createElement("span");
        label.className = "key-label";
        const keyChar = Object.keys(KEY_MAP).find((k) => KEY_MAP[k] === note);
        label.innerText = keyChar ? keyChar.toUpperCase() : "";
        key.appendChild(label);

        const triggerKey = async (e) => {
            if (e.cancelable) e.preventDefault();
            await Tone.start();
            playKey(note);
        };

        key.addEventListener("mousedown", triggerKey);
        key.addEventListener("touchstart", triggerKey);

        container.appendChild(key);
    });
}

// Global release handler to prevent listener churn
const releaseAllKeys = () => {
    piano.releaseAll();
    document.querySelectorAll(".key.active-playing").forEach((k) => k.classList.remove("active-playing"));
    setFrogHandsOff();
};

window.addEventListener("mouseup", releaseAllKeys);
window.addEventListener("touchend", releaseAllKeys);

const chordDisplay = document.getElementById("chord-display");
const frogChar = document.getElementById("frog-character");

function setFrogHandsOn() {
    if (!frogChar) return;
    frogChar.src = "frog-maestro-handson.png";
    frogChar.classList.remove("playing");
    // Force reflow to restart animation if it was already playing
    void frogChar.offsetWidth;
    frogChar.classList.add("playing");
}

function setFrogHandsOff() {
    if (!frogChar) return;
    frogChar.src = "frog-maestro-handoff.png";
    frogChar.classList.remove("playing");
}

function playKey(note) {
    const root = `${note}${octave}`;

    const base = baseChordType ? BASE_INTERVALS[baseChordType] : [0];
    const intervals = Array.isArray(base) ? [...base] : [0];

    extensions.forEach((ext) => {
        const val = EXT_INTERVALS[ext];
        if (typeof val === "number") intervals.push(val);
    });

    const notes = intervals.map((s) => Tone.Frequency(root).transpose(s).toNote());

    piano.triggerAttack(notes);
    setFrogHandsOn();

    const chordText = `${note} ${baseChordType || ""} ${Array.from(extensions).join(" ")}`.trim();
    chordDisplay.innerText = chordText || note;

    const keyEl = document.querySelector(`[data-base="${note}"]`);
    if (keyEl) {
        keyEl.classList.add("active-playing");
    }
}

// Keyboard events
window.addEventListener("keydown", async (e) => {
    if (e.repeat) return;

    // Handle number keys 1-8 for chord pads
    const digit = parseInt(e.key);
    if (digit >= 1 && digit <= 8) {
        const pads = document.querySelectorAll(".pad-btn");
        const targetPad = pads[digit - 1];
        if (targetPad) {
            targetPad.click();
            return;
        }
    }

    // Existing piano key logic
    const n = KEY_MAP[e.key.toLowerCase()];
    if (n) {
        await Tone.start();
        playKey(n);
    }
});

window.addEventListener("keyup", () => {
    piano.releaseAll();
    document.querySelectorAll(".key.active-playing").forEach((k) => k.classList.remove("active-playing"));
    setFrogHandsOff();
});

// Pads (chord quality + extensions)
document.querySelectorAll(".pad-btn").forEach((pad) => {
    pad.addEventListener("click", (e) => {
        const target = e.currentTarget;
        const type = target.dataset.type;
        const isExt = target.classList.contains("extension");

        if (isExt) {
            if (extensions.has(type)) {
                extensions.delete(type);
            } else {
                extensions.add(type);
            }
            target.classList.toggle("active");
        } else {
            const wasActive = target.classList.contains("active");
            document.querySelectorAll(".pad-btn:not(.extension)").forEach((b) => b.classList.remove("active"));
            if (!wasActive) {
                target.classList.add("active");
                baseChordType = type;
            } else {
                baseChordType = null;
            }
        }
    });
});

// Loop / progressions
const loop = new Tone.Loop((time) => {
    if (!playProgressions) return;
    if (currentProg === "manual") return;

    const oneBar = Tone.Time("1m").toSeconds();
    const measure = Math.floor(Tone.Transport.seconds / oneBar) % 4;

    const steps = PROGRESSIONS[currentProg];
    if (!steps) return;

    const step = steps[measure];
    if (!step) return;

    const root = Tone.Frequency(currentKey + (octave - 1)).transpose(step.d);
    const base = BASE_INTERVALS[step.t] || BASE_INTERVALS.maj;
    const notes = base.map((s) => root.transpose(s).toNote());

    piano.triggerAttackRelease(notes, "1m", time);

    Tone.Draw.schedule(() => {
        const chordName = `${root.toNote().replace(/\d/, "")} ${step.t.toUpperCase()} (${step.l})`;
        chordDisplay.innerText = chordName;
        setFrogHandsOn();

        notes.forEach((n) => {
            const keyName = n.replace(/\d/g, "");
            const k = document.querySelector(`[data-base="${keyName}"]`);
            if (k) {
                k.classList.add("active-playing");
            }
        });
    }, time);

    Tone.Draw.schedule(() => {
        setFrogHandsOff();
        document.querySelectorAll(".key.active-playing").forEach((k) => k.classList.remove("active-playing"));
    }, time + Tone.Time("0:2:0").toSeconds());
}, "1m").start(0);

// Transport + controls
document.getElementById("rec-audio-btn").onclick = async (e) => {
    if (!isRecording) {
        await Tone.start();
        const overlay = document.getElementById("countdown-overlay");
        overlay.style.display = "flex";
        let count = 3;
        overlay.innerText = count;

        const timer = setInterval(() => {
            count--;
            if (count > 0) {
                overlay.innerText = count;
            } else {
                clearInterval(timer);
                overlay.style.display = "none";
                recorder.start();
                isRecording = true;
                startRecTimer();
                document.getElementById("recording-preview-zone").style.display = "none";
            }
        }, 1000);
    } else {
        const blob = await recorder.stop();
        isRecording = false;
        stopRecTimer();
        setRecButtonIdle();
        document.getElementById("audio-preview").src = URL.createObjectURL(blob);
        document.getElementById("recording-preview-zone").style.display = "flex";
    }
};

document.getElementById("met-btn").onclick = async () => {
    await Tone.start();
    if (!metEnabled) {
        enableMetronome();
    } else {
        disableMetronome();
    }
    updateTransportState();
};

document.getElementById("met-vol-ctrl").oninput = (e) => {
    metronome.volume.value = parseFloat(e.target.value);
};

document.getElementById("save-btn").onclick = () => {
    const src = document.getElementById("audio-preview").src;
    if (!src) return;
    const a = document.createElement("a");
    a.download = "orchid-session.webm";
    a.href = src;
    a.click();
};

document.getElementById("del-btn").onclick = () => {
    document.getElementById("recording-preview-zone").style.display = "none";
};

document.getElementById("key-ctrl").onchange = (e) => {
    currentKey = e.target.value;
};

function populateKeySelect(type) {
    const select = document.getElementById("key-ctrl");
    select.innerHTML = "";
    KEY_OPTIONS[type].forEach((k) => {
        const opt = document.createElement("option");
        opt.value = k;
        opt.innerText = k;
        select.appendChild(opt);
    });
    select.value = KEY_OPTIONS[type][0];
    currentKey = select.value;
}

document.querySelectorAll("#key-type-toggle button").forEach((btn) => {
    btn.onclick = (e) => {
        document.querySelectorAll("#key-type-toggle button").forEach((b) => {
            b.classList.remove("btn-black");
            b.classList.add("btn-outline");
        });
        e.target.classList.remove("btn-outline");
        e.target.classList.add("btn-black");
        populateKeySelect(e.target.dataset.type);
    };
});

document.getElementById("prog-ctrl").onchange = (e) => {
    currentProg = e.target.value;
};

document.getElementById("reset-btn").onclick = () => {
    currentProg = "manual";
    document.getElementById("prog-ctrl").value = "manual";

    // Reset Key Toggle to Natural
    document.querySelectorAll("#key-type-toggle button").forEach((b) => {
        b.classList.remove("btn-black");
        b.classList.add("btn-outline");
    });
    const natBtn = document.querySelector('#key-type-toggle button[data-type="natural"]');
    natBtn.classList.remove("btn-outline");
    natBtn.classList.add("btn-black");

    populateKeySelect("natural");

    octave = 4;
    updateOct();

    // Reset BPM
    Tone.Transport.bpm.value = 90;
    document.getElementById("bpm-ctrl").value = 90;

    // Stop Playback & Metronome
    playProgressions = false;
    disableMetronome();
    const playBtn = document.getElementById("play-btn");
    playBtn.innerText = "▶ PLAY";
    playBtn.classList.remove("playing");
    playhead.style.width = "0%";
    updateTransportState();
    piano.releaseAll();

    baseChordType = "maj";
    extensions.clear();
    document.querySelectorAll(".pad-btn").forEach((btn) => {
        btn.classList.remove("active");
        if (btn.dataset.type === "maj") btn.classList.add("active");
    });
    document.getElementById("chord-display").innerText = "—";
};

document.getElementById("bpm-ctrl").oninput = (e) => {
    const bpm = parseFloat(e.target.value);
    if (!Number.isNaN(bpm) && bpm > 0) {
        Tone.Transport.bpm.value = bpm;
    }
};

document.getElementById("oct-up").onclick = () => {
    if (octave < 6) octave++;
    updateOct();
};

document.getElementById("oct-down").onclick = () => {
    if (octave > 1) octave--;
    updateOct();
};

function updateOct() {
    document.getElementById("oct-label").innerText = octave;
    buildKeyboard();
}

document.getElementById("play-btn").onclick = () => {
    const btn = document.getElementById("play-btn");
    if (!playProgressions) {
        Tone.start();
        playProgressions = true;
        btn.innerText = "■ STOP";
        btn.classList.add("playing");
    } else {
        playProgressions = false;
        btn.innerText = "▶ PLAY";
        btn.classList.remove("playing");
        piano.releaseAll();
        setFrogHandsOff();
        document.querySelectorAll(".key.active-playing").forEach((k) => k.classList.remove("active-playing"));
    }
    updateTransportState();
};

const playhead = document.getElementById("playhead");

function updatePlayhead() {
    if (Tone.Transport.state === "started") {
        const span = Tone.Time("4m").toSeconds();
        const progress = (Tone.Transport.seconds % span) / span;
        playhead.style.width = progress * 100 + "%";
    }
    requestAnimationFrame(updatePlayhead);
}

for (let i = 0; i < 16; i++) {
    const line = document.createElement("div");
    line.className = "beat-line";
    if (i % 4 === 0) line.classList.add("bar-start");
    document.getElementById("beat-grid").appendChild(line);
}

updatePlayhead();
buildKeyboard();
updateMetButton();
populateKeySelect("natural");
setRecButtonIdle();
