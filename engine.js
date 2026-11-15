"use strict";

/**
 * ĐỘNG CƠ V12 + HỘP SỐ ISR 7 CẤP + MÔ PHỎNG TRƯỢT BÁNH (WHEELSPIN)
 */
class V12Engine {
  constructor() {
    this.idleRpm = 900;
    this.redline = 8500;
    this.limiterRpm = 8800; // Cắt xăng giới hạn tua
    this.maxRpm = 10000;
    this.firingOrder = [1, 7, 5, 11, 3, 9, 6, 12, 2, 8, 4, 10];

    // Đường cong mô-men xoắn thực tế của V12 hút khí tự nhiên (Nm)
    this.curve = [
      [0, 0],
      [800, 340],
      [1500, 490],
      [3000, 620],
      [4500, 695],
      [6000, 745],
      [7200, 770],
      [8200, 725],
      [8800, 610],
      [10000, 300],
    ];
    this.reset();
  }

  reset() {
    this.rpm = 0;
    this.throttle = 0;
    this.prevThrottle = 0;
    this.torque = 0;
    this.fuelCut = false;
    this.cutTimer = 0;
    this.running = false;
    this.starting = false;
    this.startTime = 0;
    this.cranked = false;
    this.blipTimer = 0;
  }

  start() {
    this.reset();
    this.starting = true;
  }

  torqueAt(rpm) {
    const c = this.curve;
    if (rpm <= c[0][0]) return c[0][1];
    for (let i = 1; i < c.length; i++) {
      if (rpm <= c[i][0]) {
        const [x0, y0] = c[i - 1];
        const [x1, y1] = c[i];
        return y0 + ((y1 - y0) * (rpm - x0)) / (x1 - x0);
      }
    }
    return c[c.length - 1][1];
  }

  frictionAt(rpm) {
    return 28 + 0.0072 * rpm;
  }

  firingHz(rpm = this.rpm) {
    return rpm / 10;
  }

  get powerHp() {
    return (Math.max(0, this.torque) * this.rpm) / 7121;
  }
}

/**
 * HỘP SỐ ISR 7 CẤP + LY HỢP + LAUNCH CONTROL + WHEELSPIN PHYSICS
 */
class Drivetrain {
  constructor(engine) {
    this.engine = engine;
    this.ratios = [0, 3.17, 2.1, 1.55, 1.22, 1.0, 0.84, 0.72];
    this.finalDrive = 3.15;
    this.wheelRadius = 0.34;    // m
    this.mass = 1650;           // kg
    this.dragK = 0.55;          // 0.5 * rho * Cd * A
    this.rollingF = 243;        // N
    this.drivelineEff = 0.88;
    this.maxTraction = 16200;   // Ngưỡng bám tối đa của lốp (N) — vượt ngưỡng này sẽ trượt bánh
    this.maxBrake = 22000;      // N
    this.auto = true;
    this.reset();
  }

  reset() {
    this.gear = 1;
    this.speed = 0;             // m/s
    this.distance = 0;          // m
    this.accel = 0;             // m/s²
    this.shiftTimer = 0;
    this.shiftCooldown = 0;
    this.clutchSlip = 0;
    this.wheelSlip = 0;         // Độ trượt bánh xe (0 = bám hoàn toàn, 1 = quay tít mất bám)
    this.launchActive = false;  // Đang giữ Launch Control
    this.prevLaunchActive = false;
    this.launchBoostTimer = 0;  // Thời gian búng lốp sau khi nhả phanh Launch Control
    this.screechCooldown = 0;   // Chống bắn sự kiện rít lốp chồng chéo
    this.overrunCooldown = 0;
    this.events = [];           // 'crank' | 'ignite' | 'up' | 'down' | 'overrun' | 'limiter' | 'screech'
  }

  _smoothstep(t) {
    const x = Math.max(0, Math.min(1, t));
    return x * x * (3 - 2 * x);
  }

  get speedKmh() {
    return this.speed * 3.6;
  }

  gearRatio(g = this.gear) {
    return this.ratios[g] * this.finalDrive;
  }

  lockedRpm(g = this.gear) {
    const r = this.gearRatio(g);
    if (!r) return 0;
    return (((this.speed / this.wheelRadius) * r) * 60) / (2 * Math.PI);
  }

  shiftUp() {
    if (this.gear >= 7 || this.shiftTimer > 0) return;
    this.gear++;
    this.shiftTimer = 0.11;
    this.shiftCooldown = 0.42;
    this.wheelSlip *= 0.35; // Sang số 2 lốp bắt đầu bám lại
    this.events.push("up");
  }

  shiftDown() {
    if (this.gear <= 0 || this.shiftTimer > 0) return;
    if (this.gear > 1 && this.lockedRpm(this.gear - 1) > this.engine.limiterRpm) return;
    this.gear--;
    this.shiftTimer = 0.13;
    this.shiftCooldown = 0.42;
    if (this.gear > 0 && this.speed > 2) {
      this.engine.blipTimer = 0.12;
    }
    this.events.push("down");
  }

  neutral() {
    if (this.gear === 0) return;
    this.gear = 0;
    this.shiftTimer = 0;
    this.wheelSlip = 0;
  }

  _autoShift() {
    const e = this.engine;
    if (this.shiftCooldown > 0 || this.shiftTimer > 0 || !e.running || this.launchActive) return;
    const thr = e.throttle;
    const upRpm = 6000 + thr * 2450;
    const downRpm = 2200 + thr * 1600;

    // Không sang số sớm khi bánh đang trượt mạnh ở số 1 trừ khi chạm sát redline
    if (this.gear === 1 && this.wheelSlip > 0.35 && e.rpm < 8350) return;

    if (this.gear < 7 && e.rpm > upRpm && this.speed > 1.5) {
      this.shiftUp();
      return;
    }
    if (this.gear > 1) {
      const lowerRpm = this.lockedRpm(this.gear - 1);
      const kickdown = thr > 0.88 && e.rpm < 4400;
      if ((e.rpm < downRpm || kickdown) && lowerRpm < 7700) {
        this.shiftDown();
      }
    }
  }

  /**
   * @param {number} dt bước thời gian (s)
   * @param {{throttle:number, brake:number}} input
   */
  update(dt, input) {
    const e = this.engine;
    this.shiftCooldown = Math.max(0, this.shiftCooldown - dt);
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    this.overrunCooldown = Math.max(0, this.overrunCooldown - dt);
    this.screechCooldown = Math.max(0, this.screechCooldown - dt);
    this.launchBoostTimer = Math.max(0, this.launchBoostTimer - dt);
    e.blipTimer = Math.max(0, e.blipTimer - dt);

    let driveForce = 0;

    // ---- 1. Quy trình đề nổ ----
    if (e.starting) {
      if (!e.cranked) {
        e.cranked = true;
        this.events.push("crank");
      }
      e.startTime += dt;
      if (e.startTime < 0.45) {
        e.rpm = 220 + 65 * Math.sin(e.startTime * 42);
        e.throttle = 0;
        e.torque = 0;
        this._integrate(dt, 0, input.brake);
        return;
      }
      e.starting = false;
      e.running = true;
      e.rpm = 2400;
      this.events.push("ignite");
    }

    if (!e.running) {
      this._integrate(dt, 0, input.brake);
      return;
    }

    // ---- 2. Ga điện tử + Rev-Match Blip ----
    e.prevThrottle = e.throttle;
    const rawTgt = e.blipTimer > 0 ? Math.max(input.throttle, 0.78) : input.throttle;
    const rate = rawTgt > e.throttle ? 11 : 14;
    e.throttle += (rawTgt - e.throttle) * Math.min(1, dt * rate);
    if (Math.abs(rawTgt - e.throttle) < 0.002) e.throttle = rawTgt;

    // Bắt khoảnh khắc nhả thốc ga để nổ pô lẹt đẹt
    if (
      e.prevThrottle > 0.55 &&
      input.throttle < 0.1 &&
      e.rpm > 4200 &&
      this.overrunCooldown <= 0
    ) {
      this.events.push("overrun");
      this.overrunCooldown = 0.75;
    }

    // ---- 3. Launch Control & Phát hiện nhả phanh đề-pa ----
    this.prevLaunchActive = this.launchActive;
    this.launchActive =
      this.gear === 1 &&
      this.speed < 0.8 &&
      input.brake > 0.7 &&
      input.throttle > 0.7;

    // Khoảnh khắc vừa rời chân phanh từ Launch Control trong khi vẫn giữ ga
    if (this.prevLaunchActive && !this.launchActive && input.throttle > 0.65) {
      this.launchBoostTimer = 0.85;
      this.wheelSlip = 0.85;
      if (this.screechCooldown <= 0) {
        this.events.push("screech");
        this.screechCooldown = 1.1;
      }
    }

    // ---- 4. Hộp số tự động ----
    if (this.auto && this.gear > 0) this._autoShift();

    // ---- 5. Cắt xăng giới hạn tua ----
    e.cutTimer = Math.max(0, e.cutTimer - dt);
    const hitLimit = this.launchActive ? e.rpm >= 4500 : e.rpm >= e.limiterRpm;
    if (hitLimit && e.cutTimer <= 0) {
      e.cutTimer = 0.065;
      if (!this.launchActive) this.events.push("limiter");
    }
    e.fuelCut = e.cutTimer > 0;

    // ---- 6. Truyền động, Ly hợp & Tính toán trượt bánh (Wheelspin) ----
    const ratio = this.gearRatio();
    const locked = this.lockedRpm();
    const engaged = this.gear > 0 && this.shiftTimer <= 0 && !this.launchActive;

    if (engaged) {
      const launchSpeed = ((2600 * 2 * Math.PI) / 60 / ratio) * this.wheelRadius;
      const k = this._smoothstep(this.speed / launchSpeed);

      // Tính lực mô-men xoắn truyền xuống bánh xe
      let torque =
        e.torqueAt(e.rpm) * e.throttle -
        e.frictionAt(e.rpm) * (1 - e.throttle);
      if (e.fuelCut) torque = -e.frictionAt(e.rpm) * 1.4;
      e.torque = torque;

      let wheelT = torque * ratio * this.drivelineEff;
      if (k < 1) {
        wheelT = torque > 0 ? wheelT * (0.65 + 0.35 * k) : wheelT * k;
      }
      const rawForce = wheelT / this.wheelRadius;

      // Đánh giá độ trượt lốp ở số 1 hoặc khi vừa bung Launch Control
      let targetSlip = 0;
      if (this.launchBoostTimer > 0 && input.throttle > 0.5) {
        targetSlip = 0.78 * (this.launchBoostTimer / 0.85);
      } else if (this.gear === 1 && this.speed < 13 && rawForce > this.maxTraction * 0.92) {
        // Lực kéo vượt ngưỡng bám của lốp ở số 1
        const excessRatio = (rawForce - this.maxTraction * 0.92) / (this.maxTraction * 0.45);
        targetSlip = Math.min(0.85, Math.max(0, excessRatio) * input.throttle);
      }

      // Làm mượt độ trượt bánh xe
      const slipRate = targetSlip > this.wheelSlip ? 12 : 6.5;
      this.wheelSlip += (targetSlip - this.wheelSlip) * Math.min(1, dt * slipRate);
      if (this.wheelSlip < 0.01) this.wheelSlip = 0;

      // Tự động bắn sự kiện 'screech' khi độ trượt vượt ngưỡng 0.42
      if (this.wheelSlip > 0.42 && this.screechCooldown <= 0) {
        this.events.push("screech");
        this.screechCooldown = 1.15;
      }

      // Khi bánh trượt, tua máy vọt cao hơn tốc độ thật của xe (wheelspin RPM flare)
      const spinBonusRpm = this.wheelSlip * 2600;
      const slipRpm = Math.max(e.idleRpm + e.throttle * 3200, locked + spinBonusRpm);
      const target = slipRpm + (locked + spinBonusRpm - slipRpm) * k;
      const follow = 10 + 22 * k;
      e.rpm += (target - e.rpm) * Math.min(1, dt * follow);
      this.clutchSlip = 1 - k;

      // Khi bánh trượt mất độ bám tĩnh, lực đẩy thực tế giảm nhẹ (~12%) so với maxTraction
      const gripFactor = 1 - this.wheelSlip * 0.14;
      driveForce = Math.min(rawForce, this.maxTraction * gripFactor);
    } else {
      this.wheelSlip = 0;
      let target;
      if (this.launchActive) {
        target = 4650;
      } else if (this.gear === 0) {
        target = e.idleRpm + e.throttle * (e.limiterRpm + 250 - e.idleRpm);
      } else {
        target = Math.max(e.idleRpm, locked);
      }

      const rate2 = target > e.rpm ? 9.5 : 5.0;
      e.rpm += (target - e.rpm) * Math.min(1, dt * rate2);
      if (e.fuelCut) e.rpm -= (this.launchActive ? 1800 : 1200) * dt;
      e.torque = e.torqueAt(e.rpm) * e.throttle;
      this.clutchSlip = 1;
    }

    this._integrate(dt, driveForce, input.brake);
  }

  _integrate(dt, driveForce, brake) {
    const v = this.speed;
    const brakeF = brake * this.maxBrake;
    const drag = this.dragK * v * v + (v > 0.05 ? this.rollingF : 0);
    let net = driveForce - brakeF - drag;
    if (v < 0.05 && net < 0) net = 0;
    this.accel = net / this.mass;
    this.speed = Math.max(0, v + this.accel * dt);
    this.distance += this.speed * dt;
  }
}