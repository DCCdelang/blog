// The sounds are synthesised with the Web Audio API, so this soundboard needs
// no audio files to be shipped alongside it.

// The context is shared with the bass panel and created on the first click:
// browsers block audio that is not started by a user gesture.
function getAudioContext() {
    return window.SharedAudio.get();
}

// Play a single oscillator, sliding from startFreq to endFreq, with a short
// fade in and out so we do not hear a click at the start and end.
function playTone(options) {
    var ctx = getAudioContext();
    var now = ctx.currentTime;
    var duration = options.duration;

    var oscillator = ctx.createOscillator();
    oscillator.type = options.type || "sine";
    oscillator.frequency.setValueAtTime(options.startFreq, now);
    if (options.endFreq && options.endFreq !== options.startFreq) {
        oscillator.frequency.exponentialRampToValueAtTime(options.endFreq, now + duration);
    }

    var gain = ctx.createGain();
    var volume = options.volume || 0.3;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
}

// Play filtered white noise, which is what makes a snare or a hi-hat.
function playNoise(options) {
    var ctx = getAudioContext();
    var now = ctx.currentTime;
    var duration = options.duration;

    var buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
    var samples = buffer.getChannelData(0);
    for (var i = 0; i < samples.length; i++) {
        samples[i] = Math.random() * 2 - 1;
    }

    var source = ctx.createBufferSource();
    source.buffer = buffer;

    var filter = ctx.createBiquadFilter();
    filter.type = options.filterType || "highpass";
    filter.frequency.value = options.filterFreq || 1000;

    var gain = ctx.createGain();
    gain.gain.setValueAtTime(options.volume || 0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start(now);
}

// Play several tones at once.
function playChord(frequencies, duration) {
    frequencies.forEach(function (frequency) {
        playTone({ startFreq: frequency, duration: duration, type: "triangle", volume: 0.15 });
    });
}

var sounds = [
    {
        nm: "Beep",
        play: function () {
            playTone({ startFreq: 880, duration: 0.15, type: "square", volume: 0.2 });
        }
    },
    {
        nm: "Blip",
        play: function () {
            playTone({ startFreq: 320, endFreq: 1200, duration: 0.12, type: "sine" });
        }
    },
    {
        nm: "Laser",
        play: function () {
            playTone({ startFreq: 1400, endFreq: 120, duration: 0.35, type: "sawtooth", volume: 0.2 });
        }
    },
    {
        nm: "Kick drum",
        play: function () {
            playTone({ startFreq: 160, endFreq: 40, duration: 0.3, type: "sine", volume: 0.6 });
        }
    },
    {
        nm: "Snare",
        play: function () {
            playNoise({ duration: 0.2, filterType: "highpass", filterFreq: 1200, volume: 0.3 });
            playTone({ startFreq: 180, endFreq: 90, duration: 0.1, type: "triangle", volume: 0.2 });
        }
    },
    {
        nm: "Hi-hat",
        play: function () {
            playNoise({ duration: 0.06, filterType: "highpass", filterFreq: 7000, volume: 0.25 });
        }
    },
    {
        nm: "Chord (A minor)",
        play: function () {
            playChord([440, 523.25, 659.25], 0.8);
        }
    },
    {
        nm: "Game over",
        play: function () {
            [660, 550, 440, 330].forEach(function (frequency, index) {
                window.setTimeout(function () {
                    playTone({ startFreq: frequency, duration: 0.2, type: "square", volume: 0.2 });
                }, index * 150);
            });
        }
    }
];

function add_button(snd) {
    var button = document.createElement("button");
    button.innerHTML = snd.nm;
    var host = document.getElementById("soundboard") || document.getElementsByTagName("body")[0];
    host.appendChild(button);
    host.appendChild(document.createElement("br"));
    button.addEventListener("click", function () {
        snd.play();
    });
}

sounds.forEach(function (sound) {
    add_button(sound);
});
