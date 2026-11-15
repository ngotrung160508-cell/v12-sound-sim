"use strict";

/**
 * VÒNG LẶP GAME: nhận phím, chạy vật lý, đồng bộ âm thanh, vẽ hình.
 */
(() => {
  const canvas = document.getElementById("game");
  const overlay = document.getElementById("overlay");
  const startBtn = document.getElementById("startBtn");

  const engine = new V12Engine();
  const car = new Drivetrain(engine);
  const audio = new EngineAudio();
  const scene = new Scene(canvas);
  const hud = new HUD();

  const keys = {};
  const touch = {};
  let started = false;
  let last = 0;
  let prevThrottleIn = 0;
  const zero100 = { armed: true, running: false, time: 0, result: null };

  // ---------------- Điều khiển ----------------
  function readInput() {
    const gas = keys.ArrowUp || keys.KeyW || keys.Space || touch.gas;
    const brake = keys.ArrowDown || keys.KeyS || touch.brake;
    const left = keys.ArrowLeft || keys.KeyA || touch.left;
    const right = keys.ArrowRight || keys.KeyD || touch.right;
    return {
      throttle: gas ? 1 : 0,
      brake: brake ? 1 : 0,
      steer: (right ? 1 : 0) - (left ? 1 : 0),
    };
  }

  function wakeAudio() {
    if (!audio.ready) audio.start();
    if (audio.ctx && audio.ctx.state === "suspended") {
      audio.ctx.resume();
    }
  }

  function doAction(name) {
    if (!started) return;
    wakeAudio();
    switch (name) {
      case "up": car.shiftUp(); break;
      case "down": car.shiftDown(); break;
      case "neutral": car.neutral(); break;
      case "auto": car.auto = !car.auto; break;
      case "mute": audio.setMuted(!audio.muted); break;
      case "view": hud.showEngine = !hud.showEngine; break;
      case "reset": resetGame(); break;
    }
  }

  const ACTIONS = {
    KeyE: "up", ShiftRight: "up", ShiftLeft: "up",
    KeyQ: "down", ControlLeft: "down",
    KeyN: "neutral", KeyT: "auto", KeyM: "mute", KeyH: "view", KeyR: "reset",
  };
  const BLOCK = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]);

  window.addEventListener("keydown", (e) => {
    if (BLOCK.has(e.code)) e.preventDefault();
    if (!e.repeat && ACTIONS[e.code]) doAction(ACTIONS[e.code]);
    keys[e.code] = true;
  });
  window.addEventListener("keyup", (e) => {
    keys[e.code] = false;
  });
  window.addEventListener("blur", () => {
    for (const k in keys) keys[k] = false;
    for (const k in touch) touch[k] = false;
  });

  // Nút cảm ứng đa điểm (hỗ trợ vừa giữ ga vừa bấm sang số/lái trên điện thoại)
  document.querySelectorAll("[data-hold]").forEach((el) => {
    const name = el.dataset.hold;
    const on = (e) => {
      e.preventDefault();
      wakeAudio();
      if (el.setPointerCapture && e.pointerId !== undefined) {
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
      }
      touch[name] = true;
    };
    const off = (e) => {
      e.preventDefault();
      touch[name] = false;
    };
    el.addEventListener("pointerdown", on);
    el.addEventListener("pointerup", off);
    el.addEventListener("pointercancel", off);
  });

  document.querySelectorAll("[data-action]").forEach((el) => {
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      doAction(el.dataset.action);
    });
  });

  window.addEventListener("resize", () => scene.resize());

  // ---------------- Khởi động ----------------
  function resetGame() {
    car.reset();
    scene.pos = 0;
    scene.playerX = 0;
    zero100.armed = true;
    zero100.running = false;
    zero100.result = null;
    engine.start();
    if (audio.ready) audio.pop(0.6);
  }

  function startSimulation(e) {
    if (e) e.preventDefault();
    if (started) return;
    wakeAudio();
    overlay.classList.add("hidden");
    started = true;
    engine.start();
  }

  startBtn.addEventListener("click", startSimulation);
  startBtn.addEventListener("pointerdown", startSimulation);

  // ---------------- Mỗi khung hình ----------------
  function step(dt) {
    const input = readInput();

    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) car.update(h, input);

    if (scene.offroad && car.speed > 6) {
      car.speed -= Math.min(car.speed - 6, (car.speed * 0.35 + 6) * dt);
    }

    // ---- Sự kiện hộp số / nổ máy ----
    for (const ev of car.events.splice(0)) {
      if (ev === "ignite") {
        audio.ignition();
        scene.flame = 0.6;
      } else if (ev === "up" && engine.throttle > 0.4 && engine.rpm > 3500) {
        audio.crackle(3, 0.35, engine.rpm);
        scene.flame = 0.7;
      } else if (ev === "down" && engine.rpm > 3000) {
        audio.crackle(2, 0.3, engine.rpm);
        scene.flame = 0.45;
      }
    }

    // ---- Nhả ga ở vòng tua cao => nổ pô ----
    if (engine.running) {
      if (prevThrottleIn > 0.5 && input.throttle === 0 && engine.rpm > 4500) {
        audio.crackle(4 + Math.floor(Math.random() * 3), 0.5, engine.rpm);
        scene.flame = 0.9;
      }
      if (input.throttle === 0 && engine.rpm > 5200 && car.speed > 10) {
        const prob = dt * 7 * (engine.rpm / 9000 - 0.4);
        if (Math.random() < prob) {
          audio.pop(0.3 + Math.random() * 0.5, 0, engine.rpm);
          scene.flame = Math.max(scene.flame, 0.4 + Math.random() * 0.4);
        }
      }
    }
    prevThrottleIn = input.throttle;

    // ---- Đồng hồ 0–100 km/h ----
    if (car.speed < 0.2 && !zero100.running) zero100.armed = true;
    if (zero100.armed && car.speed > 0.5) {
      zero100.armed = false;
      zero100.running = true;
      zero100.time = 0;
      zero100.result = null;
    }
    if (zero100.running) {
      zero100.time += dt;
      if (car.speedKmh >= 100) {
        zero100.result = zero100.time;
        zero100.running = false;
      } else if (car.speed < 0.2) {
        zero100.running = false;
      }
    }

    scene.update(dt, { speed: car.speed, steer: input.steer, rpm: engine.rpm });
    hud.update(dt, engine.rpm);

    audio.update({
      rpm: engine.rpm,
      throttle: engine.throttle,
      fuelCut: engine.fuelCut,
      speed: car.speed,
      gear: car.gear,
    });
  }

  function render() {
    const ctx = scene.ctx;
    scene.draw({
      speed: car.speed,
      brake: readInput().brake,
    });
    hud.draw(ctx, scene.w, scene.h, {
      rpm: engine.rpm,
      redline: engine.redline,
      maxRpm: engine.maxRpm,
      speedKmh: car.speedKmh,
      gear: car.gear,
      auto: car.auto,
      throttle: engine.throttle,
      brake: readInput().brake,
      torque: engine.torque,
      hp: engine.powerHp,
      fuelCut: engine.fuelCut,
      firingOrder: engine.firingOrder,
      zero100,
      muted: audio.muted,
      distance: car.distance,
    });
  }

  function frame(ts) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (ts - last) / 1000 || 0);
    last = ts;
    if (started) step(dt);
    render();
  }
  requestAnimationFrame(frame);
})();
