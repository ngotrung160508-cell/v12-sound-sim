"use strict";

(() => {
  const canvas = document.getElementById("dynoCanvas");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const startBtn = document.getElementById("startBtn");
  const gasPedal = document.getElementById("gasPedal");
  const idleSlider = document.getElementById("idleSlider");
  const idleVal = document.getElementById("idleVal");
  const btnLaunch = document.getElementById("btnLaunch");
  const btnColdStart = document.getElementById("btnColdStart");
  const btnPop = document.getElementById("btnPop");

  const audio = new EngineAudio();

  // Trạng thái động cơ V12 trên bàn thử Dyno
  const state = {
    started: false,
    rpm: 0,
    targetIdle: 950,
    redline: 8700,
    maxRpm: 9000,
    throttleIn: 0,
    throttle: 0,
    fuelCut: false,
    launchControl: false,
    flameIntensity: 0,
    backfireFlash: 0,
    exhaustTemp: 320, // °C
    hp: 0,
    torque: 0,
    mode: "race",
  };

  let w = 0, h = 0;
  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  // Mở rộng hàm chuyển van pô 3 chế độ (street / sport / race)
  const baseSetMode = audio.setExhaustMode.bind(audio);
  audio.setExhaustMode = (mode) => {
    state.mode = mode;
    if (mode === "sport") {
      baseSetMode("race");
      if (audio.ready) {
        const t = audio.ctx.currentTime;
        audio.masterHiCut.frequency.setTargetAtTime(3750, t, 0.06);
        audio.formant2.gain.setTargetAtTime(5.2, t, 0.06);
      }
    } else {
      baseSetMode(mode);
    }
  };

  // ---------------- Sự kiện điều khiển ----------------
  function setGas(pressed) {
    if (!state.started) return;
    if (state.throttleIn > 0.5 && !pressed && state.rpm > 4200) {
      // Nhả ga đột ngột ở tua cao => nổ chuỗi backfire + phụt lửa
      const pops = state.mode === "street" ? 2 : 5 + Math.floor(Math.random() * 4);
      audio.crackle(pops, 0.55, state.rpm);
      state.flameIntensity = 1.0;
      state.backfireFlash = 1.0;
    }
    state.throttleIn = pressed ? 1 : 0;
    gasPedal.classList.toggle("pressed", pressed);
  }

  // Cảm ứng & Chuột trên bàn đạp ga
  gasPedal.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    audio.resume();
    if (gasPedal.setPointerCapture) {
      try { gasPedal.setPointerCapture(e.pointerId); } catch (_) {}
    }
    setGas(true);
  });
  const releaseGas = (e) => {
    if (e) e.preventDefault();
    setGas(false);
  };
  gasPedal.addEventListener("pointerup", releaseGas);
  gasPedal.addEventListener("pointercancel", releaseGas);
  window.addEventListener("blur", () => setGas(false));

  // Bàn phím
  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (["Space", "KeyW", "ArrowUp"].includes(e.code)) {
      e.preventDefault();
      setGas(true);
    } else if (e.code === "Digit1") selectMode("street");
    else if (e.code === "Digit2") selectMode("sport");
    else if (e.code === "Digit3") selectMode("race");
    else if (e.code === "KeyB") triggerManualPop();
    else if (e.code === "KeyL") toggleLaunch();
    else if (e.code === "KeyR") triggerColdStart();
  });
  window.addEventListener("keyup", (e) => {
    if (["Space", "KeyW", "ArrowUp"].includes(e.code)) {
      setGas(false);
    }
  });

  // Chọn chế độ van pô
  function selectMode(mode) {
    document.querySelectorAll(".mode-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === mode);
    });
    audio.setExhaustMode(mode);
  }
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      audio.resume();
      selectMode(btn.dataset.mode);
    });
  });

  // Thanh chỉnh ga cầm chừng
  idleSlider.addEventListener("input", () => {
    state.targetIdle = Number(idleSlider.value);
    idleVal.textContent = state.targetIdle;
  });

  // Nút tiện ích
  function triggerColdStart() {
    if (!state.started) return;
    audio.resume();
    state.rpm = 450;
    state.flameIntensity = 0.85;
    audio.ignition();
  }
  function toggleLaunch() {
    state.launchControl = !state.launchControl;
    btnLaunch.classList.toggle("active", state.launchControl);
  }
  function triggerManualPop() {
    if (!state.started) return;
    audio.resume();
    audio.pop(1.35, 0, Math.max(state.rpm, 6200));
    state.flameIntensity = 1.0;
    state.backfireFlash = 1.0;
  }

  btnColdStart.addEventListener("pointerdown", (e) => { e.preventDefault(); triggerColdStart(); });
  btnLaunch.addEventListener("pointerdown", (e) => { e.preventDefault(); toggleLaunch(); });
  btnPop.addEventListener("pointerdown", (e) => { e.preventDefault(); triggerManualPop(); });

  // Nút Đề nổ máy ban đầu
  function startEngine(e) {
    if (e) e.preventDefault();
    if (state.started) return;
    audio.start();
    audio.setExhaustMode(state.mode);
    overlay.classList.add("hidden");
    state.started = true;
    state.rpm = 500;
    state.flameIntensity = 0.85;
    audio.ignition();
  }
  startBtn.addEventListener("click", startEngine);
  startBtn.addEventListener("pointerdown", startEngine);

  // ---------------- Cập nhật vật lý động cơ ----------------
  function updatePhysics(dt) {
    if (!state.started) return;

    // Bướm ga phản hồi siêu nhạy (Drive-by-wire)
    const resp = state.throttleIn > state.throttle ? 18 : 14;
    state.throttle += (state.throttleIn - state.throttle) * Math.min(1, resp * dt);

    // Giới hạn vòng tua (Redline hoặc Launch Control 4,500 RPM)
    const limiterRpm = state.launchControl ? 4500 : state.redline;
    if (state.rpm >= limiterRpm && state.throttle > 0.2) {
      state.fuelCut = true;
    } else if (state.rpm < limiterRpm - (state.launchControl ? 180 : 260)) {
      state.fuelCut = false;
    }

    // Lực kéo tăng tua (Free-revving inertia) & lực hãm động cơ
    const effectiveThr = state.fuelCut ? 0 : state.throttle;
    const revUpRate = 11500 * effectiveThr; // RPM/giây khi đạp lút ga
    const engineBrake = 2400 + (state.rpm / state.maxRpm) * 4200;

    if (effectiveThr > 0.02) {
      state.rpm += (revUpRate - engineBrake * 0.25) * dt;
    } else {
      state.rpm -= engineBrake * dt;
    }

    // Giữ mức cầm chừng (Idle)
    if (state.rpm < state.targetIdle) {
      state.rpm += (state.targetIdle - state.rpm) * Math.min(1, 10 * dt);
    }
    state.rpm = Math.max(400, Math.min(state.maxRpm, state.rpm));

    // Nổ lẹt đẹt ngẫu nhiên khi chạm giới hạn Launch Control hoặc tua cao
    if (state.fuelCut && Math.random() < dt * 14) {
      audio.pop(0.75 + Math.random() * 0.4, 0, state.rpm);
      state.flameIntensity = Math.max(state.flameIntensity, 0.8);
    }

    // Tính công suất (HP), mô-men xoắn (Nm) & nhiệt độ cổ pô
    const n = state.rpm / state.redline;
    const torqueCurve = Math.sin(Math.min(1, n * 1.15) * Math.PI * 0.82);
    state.torque = Math.round(720 * torqueCurve * (0.15 + 0.85 * effectiveThr));
    state.hp = Math.round((state.torque * state.rpm) / 7023);

    const targetTemp = 300 + n * 520 + effectiveThr * 140;
    state.exhaustTemp += (targetTemp - state.exhaustTemp) * Math.min(1, 1.5 * dt);

    // Giảm dần ngọn lửa pô
    state.flameIntensity = Math.max(0, state.flameIntensity - dt * 3.4);
    state.backfireFlash = Math.max(0, state.backfireFlash - dt * 5.0);

    audio.update({
      rpm: state.rpm,
      throttle: effectiveThr,
      fuelCut: state.fuelCut,
      speed: 0,
      gear: 0,
    });
  }

  // ---------------- Vẽ đồng hồ Dyno & 4 họng pô phụt lửa ----------------
  function render() {
    ctx.clearRect(0, 0, w, h);

    // Nền ánh sáng phản chiếu khi nổ pô
    if (state.backfireFlash > 0.01) {
      const grad = ctx.createRadialGradient(w / 2, h * 0.65, 10, w / 2, h * 0.65, w * 0.5);
      grad.addColorStop(0, `rgba(255, 120, 30, ${state.backfireFlash * 0.22})`);
      grad.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }

    const cx = w / 2;
    const cy = h * 0.44;
    const radius = Math.min(w * 0.36, h * 0.27, 195);

    // Vòng ngoài đồng hồ RPM
    const startAngle = Math.PI * 0.78;
    const endAngle = Math.PI * 2.22;
    const totalAngle = endAngle - startAngle;

    ctx.lineWidth = 14;
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.stroke();

    // Vùng Redline (7,500 - 9,000 RPM)
    const redStart = startAngle + (7500 / state.maxRpm) * totalAngle;
    ctx.strokeStyle = "rgba(255, 55, 70, 0.35)";
    ctx.beginPath();
    ctx.arc(cx, cy, radius, redStart, endAngle);
    ctx.stroke();

    // Cung sáng theo vòng tua hiện tại
    const rpmRatio = Math.min(1, state.rpm / state.maxRpm);
    const curAngle = startAngle + rpmRatio * totalAngle;
    const rpmGrad = ctx.createLinearGradient(cx - radius, cy, cx + radius, cy);
    rpmGrad.addColorStop(0, "#2ed573");
    rpmGrad.addColorStop(0.65, "#ffa502");
    rpmGrad.addColorStop(1, "#ff2e43");

    ctx.strokeStyle = rpmGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, curAngle);
    ctx.stroke();

    // Vạch chia số từ 0 đến 9 (x1000 RPM)
    ctx.font = "700 13px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 9; i++) {
      const a = startAngle + (i / 9) * totalAngle;
      const inner = radius - 22;
      const outer = radius - 10;
      ctx.strokeStyle = i >= 8 ? "#ff4757" : "rgba(255,255,255,0.45)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
      ctx.stroke();

      const tx = cx + Math.cos(a) * (radius - 36);
      const ty = cy + Math.sin(a) * (radius - 36);
      ctx.fillStyle = i >= 8 ? "#ff4757" : "#cfd6ea";
      ctx.fillText(String(i), tx, ty);
    }

    // Số RPM trung tâm
    ctx.fillStyle = state.fuelCut ? "#ff4757" : "#ffffff";
    ctx.font = `900 ${Math.round(radius * 0.28)}px system-ui`;
    ctx.fillText(Math.round(state.rpm).toString(), cx, cy - 6);

    ctx.fillStyle = "#8c96b2";
    ctx.font = "700 12px system-ui";
    ctx.fillText("RPM · 6.5L V12", cx, cy + radius * 0.2);

    // Thông số HP / Nm / Nhiệt độ ống xả
    const statY = cy + radius * 0.48;
    ctx.font = "700 13px system-ui";
    ctx.fillStyle = "#ffd32a";
    ctx.fillText(`${state.hp} HP   |   ${state.torque} Nm   |   ${Math.round(state.exhaustTemp)}°C`, cx, statY);

    // Vẽ 4 họng pô Titan ở phía dưới đồng hồ
    const pipeY = cy + radius + 34;
    const offsets = [-54, -18, 18, 54];
    offsets.forEach((ox) => {
      const px = cx + ox;
      // Viền ống pô Titan cháy xanh
      ctx.beginPath();
      ctx.arc(px, pipeY, 13, 0, Math.PI * 2);
      ctx.fillStyle = "#111420";
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = state.exhaustTemp > 600 ? "#4bcffa" : "#636e88";
      ctx.stroke();

      // Lửa xanh/cam phụt ra từ lòng ống pô khi nẹt ga hoặc nổ backfire
      if (state.flameIntensity > 0.05) {
        const fRadius = 11 + state.flameIntensity * (8 + Math.random() * 8);
        const fGrad = ctx.createRadialGradient(px, pipeY, 2, px, pipeY, fRadius);
        fGrad.addColorStop(0, "#ffffff");
        fGrad.addColorStop(0.35, "#38ada9");
        fGrad.addColorStop(0.7, "#ff9f1a");
        fGrad.addColorStop(1, "rgba(255, 60, 0, 0)");
        ctx.fillStyle = fGrad;
        ctx.beginPath();
        ctx.arc(px, pipeY, fRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  let last = 0;
  function loop(ts) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (ts - last) / 1000 || 0);
    last = ts;
    updatePhysics(dt);
    render();
  }
  requestAnimationFrame(loop);
})();
