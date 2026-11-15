# V12 Sound & Drive

Game lái xe chạy thẳng trên trình duyệt, tập trung vào **động cơ V12** và **tiếng pô**.
Toàn bộ âm thanh được **tổng hợp theo thời gian thực** bằng Web Audio API — không dùng file âm thanh nào.

## Chạy game

Cách nhanh nhất: mở file `index.html` bằng Chrome / Edge / Firefox, bấm **NỔ MÁY**.

Hoặc chạy bằng server nhỏ (cần Python 3):

```bash
python3 -m http.server 8080
# mở http://localhost:8080
```

## Điều khiển

| Phím | Chức năng |
|---|---|
| `↑` / `W` / `Space` | Ga |
| `↓` / `S` | Phanh |
| `←` `→` / `A` `D` | Lái |
| `E` / `Shift` | Lên số |
| `Q` / `Ctrl trái` | Xuống số |
| `T` | Chuyển số tự động ↔ số sàn |
| `N` | Về số mo (đạp ga để "gầm" máy) |
| `M` | Tắt / bật tiếng |
| `H` | Ẩn / hiện mô hình xi-lanh |
| `R` | Đề nổ lại |

Trên điện thoại có sẵn các nút cảm ứng.

Mẹo nghe tiếng pô: tăng ga lên vòng tua cao rồi **nhả ga đột ngột**, hoặc lên / xuống số khi đang đạp ga — xe sẽ nổ lẹt đẹt và phun lửa.

## Cấu trúc dự án

```
v12-engine-game/
├── index.html        Trang chính + màn hình bắt đầu + nút cảm ứng
├── style.css
├── package.json      (chỉ có lệnh `npm start` mở server tĩnh)
└── src/
    ├── util.js       Hàm tiện ích (clamp, lerp, smooth, bo góc)
    ├── engine.js     Động cơ V12 + hộp số 7 cấp + vật lý dọc xe
    ├── audio.js      Tổng hợp tiếng máy, khí xả, hút gió, nổ pô
    ├── road.js       Cảnh đường 3D giả, xe nhìn từ sau, lửa backfire
    ├── hud.js        Đồng hồ vòng tua, tốc độ, 12 xi-lanh chạy chậm
    └── main.js       Vòng lặp game, phím bấm, nối mọi module
```

## Cách hoạt động

### Động cơ V12 (`engine.js`)
- V12 4 kỳ có **6 lần nổ mỗi vòng quay** nên tần số nổ là `f = RPM / 10` (Hz).
  Ví dụ cầm chừng 900 rpm → 90 Hz; 8500 rpm → 850 Hz.
- Thứ tự nổ: `1-7-5-11-3-9-6-12-2-8-4-10`, mỗi lần nổ cách nhau 60° trục khuỷu.
- Mô-men xoắn nội suy từ đường cong thực (đỉnh ≈ 770 Nm ở 7200 rpm, ≈ 780 HP).
- Hộp số 7 cấp, ly hợp trượt khi xuất phát, giới hạn tua (cắt xăng ở 8800 rpm), phanh động cơ khi nhả ga, lực cản gió và lực bám của bánh xe cầu sau.

### Âm thanh (`audio.js`)
1. Bảy bộ dao động là các hoạ âm của tần số nổ, trong đó hai bộ lệch nhau vài cent mô phỏng hai bank xy-lanh nên tiếng máy "dày" hơn.
2. Méo tiếng (waveshaper) + bộ lọc thông thấp mở rộng theo ga và vòng tua.
3. Cộng hưởng ống xả: bộ lọc đỉnh + comb filter (delay có hồi tiếp).
4. Nhiễu điều chế theo nhịp nổ tạo tiếng khí xả; nhiễu băng thông tạo tiếng hút gió; thêm tiếng gió khi chạy nhanh.
5. `pop()` / `crackle()` tạo tiếng nổ pô: xung nhiễu + tiếng "thịch" trầm.

### Hình ảnh
- `road.js`: đường cong giả 3D theo từng dòng quét, đèn đường, núi thị sai, xe 4 ống pô.
- `hud.js`: mô hình 12 xi-lanh quay chậm 100 lần, tô màu theo từng kỳ (nổ, xả, hút, nén) và loé sáng khi bugi đánh lửa.

## Tuỳ chỉnh nhanh

| Muốn đổi | Sửa ở đâu |
|---|---|
| Công suất / vòng tua | `curve`, `redline`, `limiterRpm` trong `V12Engine` |
| Tỉ số truyền, khối lượng, cản gió | `ratios`, `finalDrive`, `mass`, `dragK` trong `Drivetrain` |
| "Giọng" V12 (trầm, gắt, rít) | mảng `defs` và các bộ lọc trong `EngineAudio.start()` |
| Độ to nhỏ tiếng pô | tham số `strength` của `pop()` |
| Hình dáng / màu xe | `_drawCar()` trong `road.js` |

## Ý tưởng mở rộng

- Thêm xe địch, va chạm và điểm số.
- Nhiều loại động cơ (V8, V10, flat-6) bằng cách đổi thứ tự nổ và bội số hoạ âm.
- Thêm turbo (tiếng whoosh / blow-off) hoặc hộp số ly hợp kép.
- Chuyển sang AudioWorklet để tổng hợp từng xung nổ riêng cho từng xi-lanh.
