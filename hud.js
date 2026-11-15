"use strict";

/**
 * HUD: đồng hồ vòng tua, tốc độ, số, và mô hình 12 xi-lanh chạy chậm
 * (slow-motion 1:100) hiển thị thứ tự nổ 1-7-5-11-3-9-6-12-2-8-4-10.
 */
class HUD {
  constructor() {
    this.phase = 0; // góc trục khuỷu hiển thị, 0..720 độ (chu trình 4 kỳ)
    this.showEngine = true;
  }

  update(dt, rpm) {
    // quay chậm 100 lần để nhìn được từng kỳ
    this.phase = (this.phase + rpm * 6 * 0.01 * dt) % 720;
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} W
   * @param {number} H
   * @param {object} s  dữ liệu hiển thị
   */
  draw(ctx, W, H, s) {
    const r = clamp(Math.min(W, H) * 0.17, 78, 170);
    this._tach(ctx, W - r - 22, H - r - 22, r, s);
    this._pedals(ctx, 24, H - 24, s);
    this._info(ctx, W - 22, 24, s);
    if (this.showEngine && W >= 640) this._engineView(ctx, 16, 16, 280, 214, s);

    if (s.fuelCut) {
      ctx.save();
      ctx.font = `800 ${Math.round(r * 0.2)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillStyle = "#ff3b47";
      ctx.shadowColor = "#ff3b47";
      ctx.shadowBlur = 14;
      ctx.fillText("GIỚI HẠN TUA", W - r - 22, H - r * 2 - 30);
      ctx.restore();
    }
  }

  _tach(ctx, cx, cy, r, s) {
    const a0 = Math.PI * 0.75;
    const sweep = Math.PI * 1.5;
    const ang = (v) => a0 + sweep * clamp(v / s.maxRpm, 0, 1);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(8,10,20,0.72)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.stroke();

    // vùng đỏ
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.86, ang(s.redline), ang(s.maxRpm));
    ctx.strokeStyle = "#ff2d3a";
    ctx.lineWidth = r * 0.07;
    ctx.stroke();

    // vạch chia
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let v = 0; v <= s.maxRpm; v += 500) {
      const major = v % 1000 === 0;
      const a = ang(v);
      const r1 = r * (major ? 0.74 : 0.8);
      const r2 = r * 0.9;
      ctx.strokeStyle = v >= s.redline ? "#ff5560" : "#d7dbe8";
      ctx.lineWidth = major ? 2.5 : 1.2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = v >= s.redline ? "#ff6b75" : "#e8ebf5";
        ctx.font = `700 ${Math.round(r * 0.13)}px system-ui, sans-serif`;
        ctx.fillText(String(v / 1000), cx + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6);
      }
    }

    // kim
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang(s.rpm));
    ctx.shadowColor = "#ff3b47";
    ctx.shadowBlur = 10;
    ctx.strokeStyle = "#ff3b47";
    ctx.lineWidth = Math.max(2.5, r * 0.03);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-r * 0.12, 0);
    ctx.lineTo(r * 0.84, 0);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "#1a1d2b";
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.08, 0, Math.PI * 2);
    ctx.fill();

    // chữ: x1000 rpm, số, tốc độ
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = `600 ${Math.round(r * 0.09)}px system-ui, sans-serif`;
    ctx.fillText("x1000 RPM", cx, cy - r * 0.32);

    ctx.fillStyle = s.gear === 0 ? "#ffd84a" : "#ffffff";
    ctx.font = `800 ${Math.round(r * 0.36)}px system-ui, sans-serif`;
    ctx.fillText(s.gear === 0 ? "N" : String(s.gear), cx, cy + r * 0.3);

    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${Math.round(r * 0.2)}px system-ui, sans-serif`;
    ctx.fillText(String(Math.round(s.speedKmh)), cx, cy + r * 0.6);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = `600 ${Math.round(r * 0.09)}px system-ui, sans-serif`;
    ctx.fillText("km/h · " + (s.auto ? "TỰ ĐỘNG" : "SỐ SÀN"), cx, cy + r * 0.78);
    ctx.restore();
  }

  _pedals(ctx, x, bottom, s) {
    const h = 96;
    const w = 14;
    const items = [
      { v: s.throttle, c: "#3ddc84", l: "GA" },
      { v: s.brake, c: "#ff4d5a", l: "PHANH" },
    ];
    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "600 10px system-ui, sans-serif";
    items.forEach((it, i) => {
      const bx = x + i * 34;
      ctx.fillStyle = "rgba(8,10,20,0.72)";
      roundRectPath(ctx, bx, bottom - h, w, h, 5);
      ctx.fill();
      ctx.fillStyle = it.c;
      const fh = h * clamp(it.v, 0, 1);
      roundRectPath(ctx, bx, bottom - fh, w, Math.max(fh, 0), 5);
      if (fh > 1) ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillText(it.l, bx + w / 2, bottom + 12);
    });
    ctx.restore();
  }

  _info(ctx, right, top, s) {
    ctx.save();
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    const rows = [
      [Math.round(s.hp) + " HP", "#ffffff"],
      [Math.round(Math.max(0, s.torque)) + " Nm", "#cfd3e6"],
    ];
    let z = "0–100 km/h: --";
    if (s.zero100.running) z = "0–100 km/h: " + s.zero100.time.toFixed(2) + " s";
    else if (s.zero100.result != null) z = "0–100 km/h: " + s.zero100.result.toFixed(2) + " s";
    rows.push([z, "#ffd84a"]);
    rows.push([(s.distance / 1000).toFixed(2) + " km", "#9aa0b8"]);
    ctx.font = "700 18px system-ui, sans-serif";
    rows.forEach((row, i) => {
      ctx.fillStyle = row[1];
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 4;
      ctx.fillText(row[0], right, top + i * 26);
    });
    if (s.muted) {
      ctx.fillStyle = "#ff8a8a";
      ctx.font = "600 13px system-ui, sans-serif";
      ctx.fillText("ĐÃ TẮT TIẾNG", right, top + rows.length * 26);
    }
    ctx.restore();
  }

  _engineView(ctx, x, y, w, h, s) {
    ctx.save();
    ctx.fillStyle = "rgba(8,10,20,0.68)";
    roundRectPath(ctx, x, y, w, h, 12);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#e8ebf5";
    ctx.font = "700 12px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("V12 · 60° · slow-mo 1:100", x + 14, y + 20);

    const order = s.firingOrder;
    const pad = 14;
    const cols = 6;
    const cellW = (w - pad * 2) / cols;
    const tubeW = cellW * 0.5;
    const tubeH = 52;
    const colors = { power: "#ff8a3d", exhaust: "#8a8fa3", intake: "#4aa8ff", compress: "#ffd84a" };

    for (let bank = 0; bank < 2; bank++) {
      const baseY = y + 34 + bank * (tubeH + 28);
      for (let col = 0; col < cols; col++) {
        const cyl = bank * 6 + col + 1;
        const slot = order.indexOf(cyl);
        const phi = (((this.phase - slot * 60) % 720) + 720) % 720;
        const stroke = phi < 180 ? "power" : phi < 360 ? "exhaust" : phi < 540 ? "intake" : "compress";
        const pos = (1 + Math.cos((phi * Math.PI) / 180)) / 2; // 1 = điểm chết trên
        const tx = x + pad + col * cellW + (cellW - tubeW) / 2;
        const pistonH = tubeH * 0.18;
        const py = baseY + (1 - pos) * (tubeH - pistonH);

        // buồng đốt
        ctx.fillStyle = colors[stroke];
        ctx.globalAlpha = 0.28;
        ctx.fillRect(tx, baseY, tubeW, py - baseY);
        ctx.globalAlpha = 1;

        // tia lửa nổ
        if (phi < 70) {
          const f = 1 - phi / 70;
          const g = ctx.createRadialGradient(tx + tubeW / 2, baseY + 6, 0, tx + tubeW / 2, baseY + 6, tubeW);
          g.addColorStop(0, `rgba(255,240,170,${0.95 * f})`);
          g.addColorStop(1, "rgba(255,120,30,0)");
          ctx.fillStyle = g;
          ctx.fillRect(tx - 4, baseY - 4, tubeW + 8, 34);
        }

        // thành xi-lanh + piston
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(tx, baseY, tubeW, tubeH);
        ctx.fillStyle = "#d7dbe8";
        ctx.fillRect(tx + 1, py, tubeW - 2, pistonH);
        ctx.fillStyle = "#1a1d2b";
        ctx.fillRect(tx + tubeW / 2 - 1, py + pistonH, 2, tubeH - (py - baseY) - pistonH);

        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.font = "600 10px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(String(cyl), tx + tubeW / 2, baseY + tubeH + 12);
      }
    }

    // chú thích
    const legend = [
      ["Nổ", colors.power],
      ["Xả", colors.exhaust],
      ["Hút", colors.intake],
      ["Nén", colors.compress],
    ];
    ctx.textAlign = "left";
    ctx.font = "600 10px system-ui, sans-serif";
    legend.forEach((l, i) => {
      const lx = x + pad + i * 62;
      ctx.fillStyle = l[1];
      ctx.fillRect(lx, y + h - 16, 8, 8);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.fillText(l[0], lx + 12, y + h - 8);
    });
    ctx.restore();
  }
}
