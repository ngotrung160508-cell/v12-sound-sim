"use strict";

/**
 * audio.js — BỘ TỔNG HỢP ÂM THANH ĐỘNG CƠ V12 & HỆ THỐNG PÔ (Web Audio API)
 * Kiến trúc âm học:
 *  - Luồng Sub-Bass tách biệt (40Hz - 220Hz) + điều chế xung nổ piston.
 *  - Ống xả kép X-Pipe dùng vòng hồi tiếp có giảm chấn (Damped Waveguide) -> âm dày, không vang chói.
 *  - Dao động lệch pha tự nhiên (Organic Firing Jitter) khử hoàn toàn cảm giác tiếng synth điện tử.
 *  - Hỗ trợ chuyển van pô trực tiếp: setExhaustMode('street' | 'race').
 */
class EngineAudio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.mode = "race"; // 'street' | 'race'
    this.partials = [];
    this.pipeFeedbacks = [];
    this._flareUntil = 0;
  }

  start() {
    if (this.ready) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.ready = true;

    // ---------- 1. Master Output + Tăng lực siêu trầm & Cắt dải chói ----------
    const out = ctx.createGain();
    out.gain.value = this.muted ? 0 : 0.96;
    this.out = out;

    const masterSubShelf = ctx.createBiquadFilter();
    masterSubShelf.type = "lowshelf";
    masterSubShelf.frequency.value = 110;
    masterSubShelf.gain.value = 11.0;
    this.masterSubShelf = masterSubShelf;

    const masterHiCut = ctx.createBiquadFilter();
    masterHiCut.type = "lowpass";
    masterHiCut.frequency.value = 4400;
    masterHiCut.Q.value = 0.65;
    this.masterHiCut = masterHiCut;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10.5;
    comp.knee.value = 12;
    comp.ratio.value = 4.2;
    comp.attack.value = 0.004;
    comp.release.value = 0.15;

    // Vang phản xạ mặt đường (chỉ giữ dải trầm < 950Hz)
    const reverb = ctx.createConvolver();
    reverb.buffer = this._createReverbImpulse(0.5, 3.2);
    const revLp = ctx.createBiquadFilter();
    revLp.type = "lowpass";
    revLp.frequency.value = 950;
    const revGain = ctx.createGain();
    revGain.gain.value = 0.22;
    this.revGain = revGain;

    out.connect(masterSubShelf);
    masterSubShelf.connect(masterHiCut);
    masterHiCut.connect(comp);

    masterHiCut.connect(reverb);
    reverb.connect(revLp);
    revLp.connect(revGain);
    revGain.connect(comp);

    comp.connect(ctx.destination);

    // ---------- 2. Luồng Sub-Bass Sạch + Điều chế xung nổ buồng đốt ----------
    const subBus = ctx.createGain();
    subBus.gain.value = 0.88;
    this.subBus = subBus;

    const subPulseGate = ctx.createGain();
    subPulseGate.gain.value = 1.0;

    const subLp = ctx.createBiquadFilter();
    subLp.type = "lowpass";
    subLp.frequency.value = 225;
    subLp.Q.value = 0.95;

    subBus.connect(subPulseGate);
    subPulseGate.connect(subLp);
    subLp.connect(out);

    const firingOsc = ctx.createOscillator();
    firingOsc.type = "sine";
    firingOsc.frequency.value = 90;

    const firingDepth = ctx.createGain();
    firingDepth.gain.value = 0.2;
    firingOsc.connect(firingDepth);
    firingDepth.connect(subPulseGate.gain);
    firingOsc.start();

    this.firingOsc = firingOsc;
    this.firingDepth = firingDepth;

    // ---------- 3. Luồng Trung Trầm & Cộng Hưởng Cổ Góp Động ----------
    const tone = ctx.createGain();
    tone.gain.value = 0.62;
    this.tone = tone;

    const shaper = ctx.createWaveShaper();
    shaper.curve = this._distortionCurve(2.15);
    shaper.oversample = "4x";
    this.shaper = shaper;

    // Lọc thông thấp 2 tầng nối tiếp (24dB/oct) tạo độ ấm tự nhiên
    const lp1 = ctx.createBiquadFilter();
    lp1.type = "lowpass";
    lp1.Q.value = 0.85;
    this.lp1 = lp1;

    const lp2 = ctx.createBiquadFilter();
    lp2.type = "lowpass";
    lp2.Q.value = 0.7;
    this.lp2 = lp2;

    // Formant 1: Lực trầm buồng đốt dịch chuyển theo RPM
    const formant1 = ctx.createBiquadFilter();
    formant1.type = "peaking";
    formant1.frequency.value = 145;
    formant1.gain.value = 8.0;
    formant1.Q.value = 1.2;
    this.formant1 = formant1;

    // Formant 2: Tiếng gầm cổ góp V12 dịch chuyển theo RPM
    const formant2 = ctx.createBiquadFilter();
    formant2.type = "peaking";
    formant2.frequency.value = 460;
    formant2.gain.value = 6.8;
    formant2.Q.value = 1.35;
    this.formant2 = formant2;

    // Dải sáng mượt ở 1950Hz (chỉ mở khi tua > 5800 RPM)
    const scream = ctx.createBiquadFilter();
    scream.type = "peaking";
    scream.frequency.value = 1950;
    scream.gain.value = 0;
    scream.Q.value = 1.5;
    this.scream = scream;

    const pre = ctx.createGain();
    pre.gain.value = 0.55;
    this.pre = pre;

    tone.connect(shaper);
    shaper.connect(lp1);
    lp1.connect(lp2);
    lp2.connect(formant1);
    formant1.connect(formant2);
    formant2.connect(scream);
    scream.connect(pre);
    pre.connect(out);

    // ---------- 4. Ống xả kép X-Pipe có giảm chấn nhiệt (Damped Waveguide) ----------
    const valveBus = ctx.createGain();
    valveBus.gain.value = 0.45;
    this.valveBus = valveBus;
    pre.connect(valveBus);

    const pipeConfigs = [
      { dt: 0.0072, dampFreq: 950, pan: -0.24 },
      { dt: 0.0089, dampFreq: 860, pan: 0.24 },
    ];
    this.pipeFeedbacks = [];
    pipeConfigs.forEach((cfg) => {
      const delay = ctx.createDelay(0.05);
      delay.delayTime.value = cfg.dt;

      // Bộ lọc giảm chấn nằm TRONG vòng hồi tiếp giúp sóng dội ấm dần như ống thép thật
      const dampLp = ctx.createBiquadFilter();
      dampLp.type = "lowpass";
      dampLp.frequency.value = cfg.dampFreq;
      dampLp.Q.value = 0.7;

      const fb = ctx.createGain();
      fb.gain.value = 0.42;
      this.pipeFeedbacks.push(fb);

      const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (panner) panner.pan.value = cfg.pan;

      const wet = ctx.createGain();
      wet.gain.value = 0.38;

      valveBus.connect(delay);
      delay.connect(dampLp);
      dampLp.connect(fb);
      fb.connect(delay); // Vòng lặp đã được làm ấm qua dampLp

      if (panner) {
        dampLp.connect(panner);
        panner.connect(wet);
      } else {
        dampLp.connect(wet);
      }
      wet.connect(out);
    });

    // ---------- 5. Dàn hoạ âm 12 xy-lanh ----------
    const defs = [
      { m: 0.5, t: "sine",     g: 0.60, hi: -0.10, d: 0,   toSub: true },
      { m: 1.0, t: "triangle", g: 0.48, hi:  0.05, d: -6,  toSub: true },
      { m: 1.0, t: "sawtooth", g: 0.25, hi:  0.04, d: -10, toSub: false },
      { m: 1.0, t: "sawtooth", g: 0.25, hi:  0.04, d: 10,  toSub: false },
      { m: 1.5, t: "triangle", g: 0.20, hi:  0.08, d: -3,  toSub: false },
      { m: 2.0, t: "triangle", g: 0.16, hi:  0.10, d: 4,   toSub: false },
      { m: 3.0, t: "sawtooth", g: 0.06, hi:  0.13, d: -5,  toSub: false },
      { m: 4.0, t: "sine",     g: 0.02, hi:  0.13, d: 0,   toSub: false },
    ];

    this.partials = defs.map((def) => {
      const o = ctx.createOscillator();
      o.type = def.t;
      o.detune.value = def.d;
      o.frequency.value = 90 * def.m;
      const g = ctx.createGain();
      g.gain.value = 0;
      o.connect(g);
      g.connect(def.toSub ? subBus : tone);
      o.start();
      return { ...def, o, gn: g };
    });

    // ---------- 6. Tiếng rít hộp số êm ----------
    const whineOsc = ctx.createOscillator();
    whineOsc.type = "sine";
    whineOsc.frequency.value = 400;

    const whineGain = ctx.createGain();
    whineGain.gain.value = 0;

    whineOsc.connect(whineGain);
    whineGain.connect(out);
    whineOsc.start();

    this.whineOsc = whineOsc;
    this.whineGain = whineGain;

    // ---------- 7. Bộ tạo nhiễu hồng/nâu ấm (Smooth Brown/Pink Noise) ----------
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      data[i] = (lastOut + 0.08 * white) / 1.08;
      lastOut = data[i];
      data[i] *= 2.8;
    }
    this.noiseBuf = buf;

    const loopNoise = () => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      return s;
    };

    // 7a. Hút gió họng ga
    const n1 = loopNoise();
    const ibp = ctx.createBiquadFilter();
    ibp.type = "bandpass";
    ibp.Q.value = 1.2;
    const ig = ctx.createGain();
    ig.gain.value = 0;
    n1.connect(ibp);
    ibp.connect(ig);
    ig.connect(out);
    n1.start();
    this.intakeBp = ibp;
    this.intakeGain = ig;

    // 7b. Luồng khí xả trầm băm xung
    const n2 = loopNoise();
    const elp = ctx.createBiquadFilter();
    elp.type = "lowpass";
    elp.frequency.value = 320;
    elp.Q.value = 0.8;

    const modGain = ctx.createGain();
    modGain.gain.value = 1.0;

    const exLevel = ctx.createGain();
    exLevel.gain.value = 0;

    n2.connect(elp);
    elp.connect(modGain);
    modGain.connect(exLevel);
    exLevel.connect(valveBus);
    n2.start();

    const pulse = ctx.createOscillator();
    pulse.type = "triangle";
    pulse.frequency.value = 90;
    const pd = ctx.createGain();
    pd.gain.value = 0.58;
    pulse.connect(pd);
    pd.connect(modGain.gain);
    pulse.start();

    this.exhaustLp = elp;
    this.exhaustGain = exLevel;
    this.pulse = pulse;

    // 7c. Tiếng gió lướt trầm
    const n3 = loopNoise();
    const wbp = ctx.createBiquadFilter();
    wbp.type = "bandpass";
    wbp.frequency.value = 650;
    wbp.Q.value = 0.5;
    const wg = ctx.createGain();
    wg.gain.value = 0;
    n3.connect(wbp);
    wbp.connect(wg);
    wg.connect(out);
    n3.start();
    this.windGain = wg;

    this.setExhaustMode(this.mode);
  }

  /**
   * Chuyển đổi trực tiếp giữa 2 chế độ pô: 'street' | 'race'
   */
  setExhaustMode(mode) {
    if (mode !== "street" && mode !== "race") return;
    this.mode = mode;
    if (!this.ready) return;

    const ctx = this.ctx;
    const t = ctx.currentTime;
    const isRace = mode === "race";

    this.shaper.curve = this._distortionCurve(isRace ? 2.2 : 1.55);
    this.masterSubShelf.gain.setTargetAtTime(isRace ? 11.5 : 8.5, t, 0.06);
    this.masterHiCut.frequency.setTargetAtTime(isRace ? 4500 : 3000, t, 0.06);

    for (const fb of this.pipeFeedbacks) {
      fb.gain.setTargetAtTime(isRace ? 0.45 : 0.24, t, 0.06);
    }

    this.formant2.gain.setTargetAtTime(isRace ? 7.2 : 3.5, t, 0.06);
  }

  _distortionCurve(k) {
    const n = 4096;
    const c = new Float32Array(n);
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      c[i] = Math.tanh(k * x) / norm;
    }
    return c;
  }

  _createReverbImpulse(duration, decay) {
    const ctx = this.ctx;
    const length = ctx.sampleRate * duration;
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return impulse;
  }

  setMuted(m) {
    this.muted = m;
    if (this.ready) {
      this.out.gain.setTargetAtTime(m ? 0 : 0.96, this.ctx.currentTime, 0.04);
    }
  }

  /**
   * Gọi mỗi khung hình
   * @param {{rpm:number, throttle:number, fuelCut:boolean, speed:number, gear?:number}} s
   */
  update(s) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const isRace = this.mode === "race";

    const isFlaring = t < this._flareUntil;
    const rpm = Math.max(1, isFlaring ? Math.max(s.rpm || 0, 2450) : (s.rpm || 0));
    const n = Math.min(1, rpm / 9000);
    const thr = isFlaring ? 0.88 : (s.throttle || 0);
    const speed = s.speed || 0;
    const gear = s.gear !== undefined ? s.gear : 1;

    const inGear = gear > 0 ? 1 : 0.3;
    const lowRpmFactor = 1 - Math.min(1, rpm / 5000);
    const engineLoad = thr * inGear * (0.45 + 0.55 * lowRpmFactor);

    let f = this.firingHzOf(rpm);

    // Dao động tự nhiên giữa các nhịp nổ (Organic Firing Jitter) khử tiếng điện tử
    const jitter = Math.sin(t * 23.7) * 0.0022 + Math.cos(t * 37.3) * 0.0018;
    f *= 1 + jitter;

    // Rung cầm chừng bất đối xứng đặc trưng (Cam lope) ở tua < 1400 RPM
    if (rpm > 450 && rpm < 1400) {
      const chop = Math.sin(t * 11.4) * 0.0085 + Math.sin(t * 5.7) * 0.0055;
      f *= 1 + chop;
    }

    // Điều chế xung nổ piston
    this.firingOsc.frequency.setTargetAtTime(Math.max(5, f), t, 0.018);
    const pulseIntensity = (0.25 * (1 - n * 0.72)) * (0.45 + 0.55 * thr);
    this.firingDepth.gain.setTargetAtTime(pulseIntensity, t, 0.03);

    const cut = s.fuelCut ? 0.18 : 1.0;

    for (const p of this.partials) {
      p.o.frequency.setTargetAtTime(Math.max(5, f * p.m), t, 0.016);
      const overrunBoost = s.fuelCut && p.m >= 1.5 ? (isRace ? 1.45 : 1.15) : 1.0;
      const loadBoost = p.toSub ? 1 + engineLoad * (isRace ? 0.6 : 0.44) : 1.0;
      const g = Math.max(0, p.g + p.hi * n) * (0.36 + 0.64 * thr) * cut * overrunBoost * loadBoost;
      p.gn.gain.setTargetAtTime(g, t, 0.016);
    }

    const subBase = isRace ? 0.88 : 0.72;
    this.subBus.gain.setTargetAtTime(subBase + 0.36 * thr + 0.28 * engineLoad, t, 0.025);

    let valveTarget;
    if (isRace) {
      valveTarget = 1.2;
    } else {
      valveTarget = rpm > 4200 || thr > 0.75 || isFlaring ? 0.85 : 0.28;
    }
    this.valveBus.gain.setTargetAtTime(valveTarget, t, 0.055);

    // Cộng hưởng cổ góp dịch chuyển theo RPM
    this.formant1.frequency.setTargetAtTime(140 + n * 145, t, 0.04);
    this.formant1.gain.setTargetAtTime((isRace ? 8.0 : 5.2) + engineLoad * 6.5, t, 0.04);
    this.formant2.frequency.setTargetAtTime(430 + n * 520 + thr * 110, t, 0.04);

    // Lọc thông thấp 24dB/oct
    const maxCutoff = isRace ? 2250 : 1400;
    const thrCutoff = isRace ? 1100 : 720;
    const cutoff = (isRace ? 390 : 300) + maxCutoff * Math.pow(n, 1.35) + thrCutoff * thr;
    this.lp1.frequency.setTargetAtTime(cutoff, t, 0.032);
    this.lp2.frequency.setTargetAtTime(cutoff * 1.15, t, 0.032);

    this.scream.gain.setTargetAtTime(
      Math.max(0, (n - 0.6) * (isRace ? 14.5 : 6.5)) * (0.4 + 0.6 * thr),
      t,
      0.04
    );
    this.pre.gain.setTargetAtTime((isRace ? 0.54 : 0.42) + 0.3 * n + 0.22 * thr, t, 0.04);

    // Khí xả trầm
    const exMult = isRace ? 1.22 : 0.65;
    const ex = (0.06 + 0.34 * thr) * (s.fuelCut ? 0.65 : 1.0) * exMult;
    this.exhaustGain.gain.setTargetAtTime(ex, t, 0.032);
    this.exhaustLp.frequency.setTargetAtTime((isRace ? 270 : 200) + 760 * n + 380 * thr, t, 0.032);
    this.pulse.frequency.setTargetAtTime(Math.max(5, f), t, 0.016);

    // Hút gió
    this.intakeBp.frequency.setTargetAtTime(320 + rpm * 0.36, t, 0.04);
    this.intakeGain.gain.setTargetAtTime(
      0.01 + (isRace ? 0.25 : 0.16) * thr * Math.sin(n * Math.PI * 0.85),
      t,
      0.045
    );

    // Rít hộp số nhẹ
    const whineFreq = 320 + speed * 24;
    const whineMax = isRace ? 0.022 : 0.005;
    const whineLevel =
      gear > 0 && speed > 3 ? Math.min(whineMax, (speed / 100) * (0.008 + 0.014 * thr)) : 0;
    this.whineOsc.frequency.setTargetAtTime(whineFreq, t, 0.04);
    this.whineGain.gain.setTargetAtTime(whineLevel, t, 0.05);

    // Gió & không gian
    const sp = Math.min(1, speed / 100);
    this.windGain.gain.setTargetAtTime(sp * sp * 0.14, t, 0.08);
    this.revGain.gain.setTargetAtTime((isRace ? 0.22 : 0.12) + sp * 0.12, t, 0.1);
  }

  firingHzOf(rpm) {
    return rpm / 10;
  }

  /**
   * Tiếng nổ pô / Backfire 3 lớp: Nổ đanh trầm + Chấn động sub + Luồng khí cháy phụt
   */
  pop(strength = 1, delaySec = 0, rpm = 6000) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delaySec;
    const isRace = this.mode === "race";
    const modeScale = isRace ? 1.2 : 0.52;
    const s = strength * modeScale;
    const rpmNorm = Math.min(1, Math.max(0, rpm / 9000));

    // 1. Tiếng nổ đầm đầu xung (Low-Mid Crack)
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.55 + rpmNorm * 0.45 + Math.random() * 0.25;

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = (isRace ? 300 : 230) + rpmNorm * (isRace ? 560 : 330) + Math.random() * 180;
    bp.Q.value = 0.85;

    const g = ctx.createGain();
    const dur = 0.08 + (1 - rpmNorm) * 0.045 + Math.random() * 0.04;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.min(1.55, 1.15 * s), t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(bp);
    bp.connect(g);
    g.connect(this.out);
    src.start(t, Math.random() * 1.2);
    src.stop(t + dur + 0.04);

    // 2. Sóng chấn động siêu trầm (Sub-Bass Cannon)
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(125 + rpmNorm * 35 + Math.random() * 20, t);
    o.frequency.exponentialRampToValueAtTime(26, t + 0.14);

    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(Math.min(1.45, 1.15 * s), t + 0.004);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);

    o.connect(og);
    og.connect(this.out);
    o.start(t);
    o.stop(t + 0.18);

    // 3. Luồng khí lửa phụt đuôi pô (Gas-Expansion Whoomph)
    const flameSrc = ctx.createBufferSource();
    flameSrc.buffer = this.noiseBuf;
    const flameLp = ctx.createBiquadFilter();
    flameLp.type = "lowpass";
    flameLp.frequency.setValueAtTime(260, t);
    flameLp.frequency.exponentialRampToValueAtTime(85, t + 0.18);

    const fg = ctx.createGain();
    fg.gain.setValueAtTime(0.0001, t);
    fg.gain.linearRampToValueAtTime(Math.min(1.1, 0.65 * s), t + 0.015);
    fg.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);

    flameSrc.connect(flameLp);
    flameLp.connect(fg);
    fg.connect(this.out);
    flameSrc.start(t, Math.random());
    flameSrc.stop(t + 0.21);
  }

  /**
   * Chuỗi nổ lẹt đẹt khi nhả ga
   */
  crackle(count = 5, spread = 0.55, rpm = 5500) {
    if (!this.ready || this.muted) return;
    const actualCount = this.mode === "race" ? count : Math.max(2, Math.floor(count * 0.5));
    let cursor = 0;
    for (let i = 0; i < actualCount; i++) {
      cursor += (spread / actualCount) * (0.35 + Math.random() * 1.15);
      const decay = 1 - (i / actualCount) * 0.45;
      const strength = (0.45 + Math.random() * 0.65) * decay;
      this.pop(strength, cursor, rpm * decay);
    }
  }

  /**
   * Tiếng lốp nghiến mặt đường nhựa
   */
  tireScreech(duration = 0.65) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(680, t);
    bp.frequency.linearRampToValueAtTime(920, t + duration * 0.5);
    bp.frequency.linearRampToValueAtTime(740, t + duration);
    bp.Q.value = 3.2;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.28, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);

    src.connect(bp);
    bp.connect(g);
    g.connect(this.out);
    src.start(t, Math.random());
    src.stop(t + duration + 0.05);
  }

  /**
   * Hiệu ứng đề máy
   */
  ignition() {
    if (!this.ready) this.start();
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const starter = ctx.createOscillator();
    starter.type = "triangle";
    starter.frequency.setValueAtTime(85, t);
    starter.frequency.linearRampToValueAtTime(125, t + 0.2);
    starter.frequency.linearRampToValueAtTime(100, t + 0.32);
    starter.frequency.linearRampToValueAtTime(145, t + 0.42);

    const sFilter = ctx.createBiquadFilter();
    sFilter.type = "lowpass";
    sFilter.frequency.value = 420;

    const sGain = ctx.createGain();
    sGain.gain.setValueAtTime(0.001, t);
    sGain.gain.linearRampToValueAtTime(0.36, t + 0.04);
    sGain.gain.setValueAtTime(0.36, t + 0.38);
    sGain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);

    starter.connect(sFilter);
    sFilter.connect(sGain);
    sGain.connect(this.out);
    starter.start(t);
    starter.stop(t + 0.46);

    this.pop(1.45, 0.4, 2400);
    this.pop(0.85, 0.49, 2000);
    this.crackle(3, 0.45, 2200);

    this._flareUntil = t + 1.05;
  }
}