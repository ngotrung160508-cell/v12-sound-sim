"use strict";

/**
 * CẢNH 3D GIẢ (kiểu OutRun): trời hoàng hôn, núi, đường cong, đèn đường,
 * và chiếc xe nhìn từ phía sau với 4 ống pô có lửa backfire.
 */
class Scene {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.pos = 0; // quãng đường (m)
    this.playerX = 0; // vị trí ngang trên đường (-1..1 = hai mép)
    this.steer = 0;
    this.time = 0;
    this.flame = 0; // 0..1 ngọn lửa backfire
    this.offroad = false;
    this.shakeX = 0;
    this.shakeY = 0;
    this.stars = Array.from({ length: 70 }, (_, i) => ({
      x: Math.sin(i * 91.7) * 0.5 + 0.5,
      y: Math.sin(i * 37.3 + 1) * 0.5 + 0.5,
      r: 0.5 + (i % 3) * 0.4,
    }));
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.floor(this.w * dpr);
    this.canvas.height = Math.floor(this.h * dpr);
    this.canvas.style.width = this.w + "px";
    this.canvas.style.height = this.h + "px";
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Độ lệch ngang của đường tại quãng đường z (xấp xỉ -1..1)
  curveAt(z) {
    return (Math.sin(z * 0.0011) * 1.1 + Math.sin(z * 0.0027 + 1.7) * 0.7 + Math.sin(z * 0.0006 + 4) * 0.9) / 2.7;
  }

  update(dt, s) {
    this.time += dt;
    this.pos += s.speed * dt;

    // Lái: cần có tốc độ mới đổi hướng được
    this.steer += (s.steer - this.steer) * Math.min(1, dt * 6);
    const grip = clamp(s.speed / 12, 0, 1);
    this.playerX += this.steer * 2.0 * grip * dt;

    // Lực ly tâm đẩy xe ra ngoài khúc cua
    const d = (this.curveAt(this.pos + 30) - this.curveAt(this.pos)) / 30;
    this.playerX -= d * s.speed * s.speed * 0.16 * dt;
    this.playerX = clamp(this.playerX, -1.6, 1.6);
    this.offroad = Math.abs(this.playerX) > 1.05;

    // Rung xe: cầm chừng rung rõ, tăng theo vòng tua và ra ngoài đường
    const amp = 0.4 + (s.rpm / 9000) * 1.2 + (this.offroad ? 3 : 0) + (s.speed / 90) * 0.8;
    this.shakeX = (Math.sin(this.time * 57) + Math.sin(this.time * 91)) * 0.5 * amp;
    this.shakeY = (Math.sin(this.time * 73) + Math.sin(this.time * 113)) * 0.5 * amp * 0.7;

    this.flame = Math.max(0, this.flame - dt * 4);
  }

  // Toạ độ tâm đường + nửa bề rộng ở độ sâu p (0 = chân trời, 1 = đáy màn hình)
  roadAt(p, z) {
    const W = this.w;
    const half = W * (0.01 + 0.29 * p);
    const bend = this.curveAt(z) * Math.pow(1 - p, 2) * W * 0.42;
    const cx = W / 2 + bend - this.playerX * half + this.shakeX * 0.3;
    return { cx, half };
  }

  draw(s) {
    const ctx = this.ctx;
    const W = this.w;
    const H = this.h;
    const horizon = Math.round(H * 0.45);
    const rh = H - horizon;

    this._drawSky(horizon, s);

    // ----- Mặt đất + đường -----
    ctx.fillStyle = "#0c2b2e";
    ctx.fillRect(0, horizon, W, rh);

    for (let y = horizon + 1; y < H; y++) {
      const p = (y - horizon) / rh;
      const depth = 1 / p;
      const z = this.pos + depth * 45;
      const band = Math.floor(z / 18) & 1;
      const { cx, half } = this.roadAt(p, z);

      if (band) {
        ctx.fillStyle = "#0f3438";
        ctx.fillRect(0, y, W, 1);
      }
      ctx.fillStyle = band ? "#d9d9e8" : "#c62828"; // gờ giảm tốc
      ctx.fillRect(cx - half * 1.12, y, half * 2.24, 1);
      ctx.fillStyle = band ? "#2e2e3a" : "#33333f"; // mặt đường
      ctx.fillRect(cx - half, y, half * 2, 1);
      if (band) {
        ctx.fillStyle = "#e8e8f0"; // vạch giữa đứt đoạn
        ctx.fillRect(cx - half * 0.02, y, half * 0.04, 1);
      }
    }

    // Sương mù ở chân trời
    const fog = ctx.createLinearGradient(0, horizon - 4, 0, horizon + H * 0.16);
    fog.addColorStop(0, "rgba(255,122,89,0.65)");
    fog.addColorStop(1, "rgba(255,122,89,0)");
    ctx.fillStyle = fog;
    ctx.fillRect(0, horizon - 4, W, H * 0.16 + 4);

    this._drawLamps(horizon, rh);
    this._drawStreaks(horizon, s);
    this._drawCar(s);
  }

  _drawSky(horizon, s) {
    const ctx = this.ctx;
    const W = this.w;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, "#10163a");
    sky.addColorStop(0.55, "#5b2a86");
    sky.addColorStop(1, "#ff7a59");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, horizon + 1);

    // sao
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    for (const st of this.stars) {
      ctx.beginPath();
      ctx.arc(st.x * W, st.y * horizon * 0.6, st.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // mặt trời + vạch cắt
    const off = this.curveAt(this.pos + 400) * W * 0.12;
    const sx = W * 0.5 + off;
    const sr = this.h * 0.12;
    const sun = ctx.createLinearGradient(0, horizon - sr * 2, 0, horizon);
    sun.addColorStop(0, "#ffe27a");
    sun.addColorStop(1, "#ff3d81");
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, horizon);
    ctx.clip();
    ctx.fillStyle = sun;
    ctx.beginPath();
    ctx.arc(sx, horizon - sr * 0.4, sr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ff7a59";
    for (let i = 0; i < 5; i++) {
      const yy = horizon - sr * 0.4 + i * sr * 0.2;
      ctx.fillRect(sx - sr, yy, sr * 2, 1 + i * 1.2);
    }
    ctx.restore();

    // núi (thị sai theo hướng đường)
    const h = off * 1.6;
    ctx.fillStyle = "#1c1038";
    ctx.beginPath();
    ctx.moveTo(0, horizon);
    for (let x = 0; x <= W + 8; x += 8) {
      const xx = x + h;
      const mh =
        (30 + 22 * Math.sin(xx * 0.012) + 14 * Math.sin(xx * 0.031 + 2) + 8 * Math.sin(xx * 0.07)) *
        (this.h / 700);
      ctx.lineTo(x, horizon - Math.max(2, mh));
    }
    ctx.lineTo(W, horizon);
    ctx.closePath();
    ctx.fill();
  }

  _drawLamps(horizon, rh) {
    const ctx = this.ctx;
    const H = this.h;
    const spacing = 60;
    const k0 = Math.ceil((this.pos + 45) / spacing);
    for (let k = k0 + 14; k >= k0; k--) {
      const z = k * spacing;
      const d = z - this.pos;
      if (d < 46) continue;
      const p = 45 / d;
      const y = horizon + p * rh;
      if (y > H + 40) continue;
      const { cx, half } = this.roadAt(p, z);
      const hp = p * H * 0.5;
      for (const side of [-1, 1]) {
        const x = cx + side * half * 1.32;
        ctx.strokeStyle = "#15151f";
        ctx.lineWidth = Math.max(1, p * 5);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y - hp);
        ctx.lineTo(x - side * half * 0.16, y - hp - hp * 0.04);
        ctx.stroke();
        const lx = x - side * half * 0.16;
        const ly = y - hp - hp * 0.04;
        const r = Math.max(2, p * 26);
        const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, r);
        g.addColorStop(0, "rgba(255,226,160,0.95)");
        g.addColorStop(1, "rgba(255,180,90,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(lx, ly, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  _drawStreaks(horizon, s) {
    if (s.speed < 55) return;
    const ctx = this.ctx;
    const W = this.w;
    const H = this.h;
    const a = clamp((s.speed - 55) / 60, 0, 0.35);
    ctx.strokeStyle = `rgba(255,255,255,${a})`;
    ctx.lineWidth = 1;
    for (let i = 0; i < 26; i++) {
      const ang = (i / 26) * Math.PI * 2 + Math.sin(i * 12.9898) * 0.1;
      const t0 = (Math.sin(i * 78.233 + this.time * 3) * 0.5 + 0.5) * 0.5 + 0.15;
      const r0 = Math.max(W, H) * t0;
      const r1 = r0 + Math.max(W, H) * 0.12;
      ctx.beginPath();
      ctx.moveTo(W / 2 + Math.cos(ang) * r0, horizon + Math.sin(ang) * r0 * 0.6);
      ctx.lineTo(W / 2 + Math.cos(ang) * r1, horizon + Math.sin(ang) * r1 * 0.6);
      ctx.stroke();
    }
  }

  _drawCar(s) {
    const ctx = this.ctx;
    const W = this.w;
    const H = this.h;
    const u = Math.min(W * 0.22, H * 0.36); // đơn vị = bề rộng thân xe
    const cx = W / 2 + this.steer * u * 0.1 + this.shakeX;
    const by = H * 0.9 + this.shakeY;

    ctx.save();
    ctx.translate(cx, by);

    // bóng đổ
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.beginPath();
    ctx.ellipse(0, 0.01 * u, 0.62 * u, 0.07 * u, 0, 0, Math.PI * 2);
    ctx.fill();

    // lốp sau
    ctx.fillStyle = "#08080c";
    roundRectPath(ctx, -0.56 * u, -0.34 * u, 0.17 * u, 0.34 * u, 0.03 * u);
    ctx.fill();
    roundRectPath(ctx, 0.39 * u, -0.34 * u, 0.17 * u, 0.34 * u, 0.03 * u);
    ctx.fill();

    // thân đuôi xe
    const body = ctx.createLinearGradient(0, -0.36 * u, 0, -0.06 * u);
    body.addColorStop(0, "#e0222a");
    body.addColorStop(1, "#7d0d14");
    ctx.fillStyle = body;
    roundRectPath(ctx, -0.5 * u, -0.36 * u, 1.0 * u, 0.3 * u, 0.07 * u);
    ctx.fill();

    // cabin
    ctx.fillStyle = "#b81a22";
    ctx.beginPath();
    ctx.moveTo(-0.36 * u, -0.34 * u);
    ctx.lineTo(-0.27 * u, -0.56 * u);
    ctx.lineTo(0.27 * u, -0.56 * u);
    ctx.lineTo(0.36 * u, -0.34 * u);
    ctx.closePath();
    ctx.fill();
    // kính sau
    ctx.fillStyle = "#10131c";
    ctx.beginPath();
    ctx.moveTo(-0.31 * u, -0.355 * u);
    ctx.lineTo(-0.235 * u, -0.535 * u);
    ctx.lineTo(0.235 * u, -0.535 * u);
    ctx.lineTo(0.31 * u, -0.355 * u);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.beginPath();
    ctx.moveTo(-0.2 * u, -0.535 * u);
    ctx.lineTo(-0.05 * u, -0.535 * u);
    ctx.lineTo(-0.12 * u, -0.355 * u);
    ctx.lineTo(-0.25 * u, -0.355 * u);
    ctx.closePath();
    ctx.fill();

    // cánh gió
    ctx.fillStyle = "#1a1a22";
    ctx.fillRect(-0.47 * u, -0.4 * u, 0.94 * u, 0.035 * u);
    ctx.fillRect(-0.47 * u, -0.4 * u, 0.025 * u, 0.1 * u);
    ctx.fillRect(0.445 * u, -0.4 * u, 0.025 * u, 0.1 * u);

    // đèn hậu (sáng hơn khi phanh)
    const br = s.brake;
    ctx.shadowColor = "#ff2030";
    ctx.shadowBlur = (6 + 26 * br) * (u / 200);
    ctx.fillStyle = br > 0.1 ? "#ff4452" : "#a0121c";
    ctx.fillRect(-0.46 * u, -0.29 * u, 0.34 * u, 0.045 * u);
    ctx.fillRect(0.12 * u, -0.29 * u, 0.34 * u, 0.045 * u);
    ctx.fillRect(-0.12 * u, -0.28 * u, 0.24 * u, 0.02 * u);
    ctx.shadowBlur = 0;

    // bộ khuếch tán gió
    ctx.fillStyle = "#0d0d12";
    ctx.beginPath();
    ctx.moveTo(-0.48 * u, -0.2 * u);
    ctx.lineTo(0.48 * u, -0.2 * u);
    ctx.lineTo(0.42 * u, -0.03 * u);
    ctx.lineTo(-0.42 * u, -0.03 * u);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#1c1c26";
    for (let i = -3; i <= 3; i++) ctx.fillRect(i * 0.12 * u - 0.01 * u, -0.19 * u, 0.02 * u, 0.15 * u);

    // 4 ống pô (2 bên x 2 ống)
    const tips = [-0.28, -0.16, 0.16, 0.28];
    for (const tx of tips) {
      const ty = -0.085 * u;
      const rr = 0.037 * u;
      const chrome = ctx.createRadialGradient(tx * u - rr * 0.3, ty - rr * 0.3, rr * 0.1, tx * u, ty, rr);
      chrome.addColorStop(0, "#f2f4fa");
      chrome.addColorStop(1, "#6b7080");
      ctx.fillStyle = chrome;
      ctx.beginPath();
      ctx.arc(tx * u, ty, rr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#050507";
      ctx.beginPath();
      ctx.arc(tx * u, ty, rr * 0.68, 0, Math.PI * 2);
      ctx.fill();
    }

    // ngọn lửa backfire
    if (this.flame > 0.02) {
      const f = this.flame;
      ctx.globalCompositeOperation = "lighter";
      for (const tx of tips) {
        const ty = -0.085 * u;
        const len = u * (0.1 + 0.28 * f) * (0.7 + Math.random() * 0.6);
        const wid = u * 0.05 * (0.6 + f);
        const g = ctx.createRadialGradient(tx * u, ty + len * 0.3, 0, tx * u, ty + len * 0.3, len);
        g.addColorStop(0, `rgba(255,245,170,${0.95 * f})`);
        g.addColorStop(0.35, `rgba(255,150,40,${0.8 * f})`);
        g.addColorStop(1, "rgba(255,60,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(tx * u - wid, ty);
        ctx.lineTo(tx * u + wid, ty);
        ctx.lineTo(tx * u + (Math.random() - 0.5) * wid, ty + len);
        ctx.closePath();
        ctx.fill();
        // tia lửa
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = `rgba(255,${180 + Math.random() * 60},80,${f})`;
          ctx.fillRect(
            tx * u + (Math.random() - 0.5) * u * 0.14,
            ty + Math.random() * len * 1.2,
            Math.max(1, u * 0.008),
            Math.max(1, u * 0.008)
          );
        }
      }
      ctx.globalCompositeOperation = "source-over";
    }

    ctx.restore();
  }
}
