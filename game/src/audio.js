// Sound, synthesized live with WebAudio: no audio files, no network. Every method
// is a no-op until the first user gesture creates the context, so screenshot mode
// (no gesture) stays silent and never throws.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.42;
      master.connect(ctx.destination);
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      return false;
    }
  }

  function noise(duration, filterFreq, gainValue, type = 'lowpass') {
    if (!ctx) return;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start();
    source.stop(ctx.currentTime + duration);
  }

  function tone(freq, duration, gainValue, type = 'sine', slideTo = null) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  return {
    ensure,
    shot(kind, gain = 1) {
      if (!ctx) return;
      if (kind === 'sniper') {
        noise(0.28, 900, 0.9);
        tone(140, 0.22, 0.5, 'sawtooth', 50);
      } else if (kind === 'smg') {
        noise(0.09, 2400, 0.5);
        tone(220, 0.06, 0.25, 'square', 120);
      } else if (kind === 'pistol') {
        noise(0.12, 1800, 0.6);
        tone(180, 0.08, 0.3, 'square', 90);
      } else if (kind === 'bot') {
        // Distant shots sound distant: gain falls with range.
        noise(0.11, 1500, 0.28 * gain);
        tone(160, 0.07, 0.14 * gain, 'square', 80);
      } else {
        noise(0.14, 2000, 0.7);
        tone(170, 0.1, 0.35, 'sawtooth', 70);
      }
    },
    dry() {
      tone(1400, 0.04, 0.15, 'square');
    },
    reload() {
      setTimeout(() => tone(900, 0.05, 0.2, 'square'), 120);
      setTimeout(() => tone(650, 0.05, 0.2, 'square'), 700);
    },
    hit(kill) {
      tone(kill ? 1320 : 990, 0.06, 0.25, 'sine');
      if (kill) setTimeout(() => tone(1760, 0.09, 0.25, 'sine'), 70);
    },
    hurt() {
      noise(0.15, 500, 0.4);
      tone(90, 0.18, 0.4, 'sawtooth', 55);
    },
    beep(fuseLeft) {
      tone(fuseLeft < 10 ? 1500 : 1100, 0.07, 0.2, 'sine');
    },
    plant() {
      tone(700, 0.08, 0.25, 'sine');
      setTimeout(() => tone(1050, 0.1, 0.25, 'sine'), 100);
    },
    explosion() {
      noise(1.4, 300, 1.0);
      tone(70, 1.2, 0.8, 'sine', 28);
    },
    win() {
      tone(523, 0.14, 0.3, 'sine');
      setTimeout(() => tone(659, 0.14, 0.3, 'sine'), 140);
      setTimeout(() => tone(784, 0.24, 0.3, 'sine'), 280);
    },
    lose() {
      tone(392, 0.18, 0.3, 'sine');
      setTimeout(() => tone(311, 0.28, 0.3, 'sine'), 180);
    },
    buy() {
      tone(880, 0.06, 0.25, 'sine');
      setTimeout(() => tone(1174, 0.1, 0.25, 'sine'), 70);
    },
    radio() {
      tone(1250, 0.04, 0.12, 'square');
      setTimeout(() => tone(1250, 0.04, 0.1, 'square'), 90);
    },
    flashPop() {
      noise(0.3, 4000, 0.7, 'highpass');
      tone(2000, 0.2, 0.2, 'sine', 300);
    },
    step() {
      noise(0.05, 700, 0.08);
    },
  };
}
