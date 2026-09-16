# Design: Batas Waktu Input Perkiraan Bon (Cutoff Jam 12.00 WIB)

Tanggal: 2026-09-16
Proyek: KasM (Kas Monitor) — Supabase Edge Functions + GitHub Pages frontend

## Ringkasan

Menambahkan aturan **tutup input Perkiraan Bon** pada menu Perkiraan Bon/Setor (role KF & Capem):

1. Setelah jam cutoff (default **12.00 WIB**), seluruh user tidak bisa lagi menginput **Bon** pada form Perkiraan (input Bon di-disable + alert). Form **Setor tetap bisa diisi/disimpan**.
2. Admin punya **toggle on/off** fasilitas pembatasan ini (untuk kondisi urgent) beserta **pengaturan jam cutoff**.
3. Pembatasan ditegakkan di **frontend + backend** (edge function `perkiraan`), jadi tidak bisa dibypass lewat API/devtools.

Pesan alert: `Mohon maaf input bon tidak bisa dilakukan diatas jam 12.00 WIB` (jam mengikuti setelan cutoff).

## Keputusan yang Sudah Disepakati

- **Acuan cutoff**: jam berjalan WIB saja (bukan bergantung tanggal yang dipilih). Begitu WIB ≥ cutoff, input Bon ditutup untuk tanggal mana pun.
- **Efek toggle admin**: **global untuk semua user**. OFF = pembatasan mati total (semua KF/Capem bisa input Bon kapan saja). ON = pembatasan berlaku.
- **Enforcement**: frontend + backend. Backend mempertahankan nilai Bon lama bila terkunci, Setor tetap disimpan.
- **Lokasi toggle**: menu admin baru khusus **"Pengaturan Perkiraan"**.
- **Jam cutoff**: bisa diatur admin (input jam), default `12:00`.
- **Cakupan**: hanya form Perkiraan Bon/Setor. Menu **Pesanan Nasabah tidak dibatasi**.
- **Out of scope (disepakati)**: recalc Pesanan Nasabah tetap menulis langsung ke tabel `perkiraan_bon_setor` (bisa mengubah Bon setelah cutoff dan mereset Setor ke 0). Tidak diubah pada fitur ini.

## Arsitektur

```
┌──────────────┐  GET  /setting-perkiraan   ┌────────────────────────────────┐
│  Frontend    │ ─────────────────────────▶ │ Edge Function setting-perkiraan│
│  (semua user │ ◀───────────────────────── │  GET  → { cutoffEnabled,       │
│   baca; admin│  POST /setting-perkiraan   │          cutoffTime }          │
│   tulis)     │ ─────────────────────────▶ │  POST → upsert baris tunggal   │
└──────────────┘                            └────────────────────────────────┘
                                                         │ setting_perkiraan (tabel)
┌──────────────┐  POST /perkiraan           ┌────────────────────────────────┐
│  Frontend    │  { tanggal, userEstim,     │ Edge Function perkiraan        │
│  KF/Capem    │    p100k_setor, p100k_bon, │  1. baca setting_perkiraan     │
│              │    p50k_setor, p50k_bon }  │  2. jika terkunci: paksa Bon = │
│  1. cek WIB  │ ─────────────────────────▶ │     nilai lama, Setor tetap    │
│  2. disable  │ ◀───────────────────────── │  3. upsert + notif TUKAB       │
│     input Bon│  { success, bonLocked }    └────────────────────────────────┘
└──────────────┘
```

## Backend

### 1. Migration `supabase/migrations/023_setting_perkiraan.sql`

```sql
CREATE TABLE IF NOT EXISTS setting_perkiraan (
  id SERIAL PRIMARY KEY,
  cutoff_enabled BOOLEAN NOT NULL DEFAULT true,
  cutoff_time TEXT NOT NULL DEFAULT '12:00',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE setting_perkiraan ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow authenticated access" ON setting_perkiraan
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Seed 1 baris default (guard anti-duplikat)
INSERT INTO setting_perkiraan (cutoff_enabled, cutoff_time)
SELECT true, '12:00' WHERE NOT EXISTS (SELECT 1 FROM setting_perkiraan);
```

### 2. Edge Function baru `setting-perkiraan` (`supabase/functions/setting-perkiraan/index.ts`)

Mengikuti pola `setting-email`.

- **GET**: baca baris pertama (`.order("id").limit(1).maybeSingle()`).
  - Jika tidak ada data → `successResponse({ cutoffEnabled: true, cutoffTime: "12:00" })`.
  - Jika ada → `successResponse({ cutoffEnabled: data.cutoff_enabled !== false, cutoffTime: String(data.cutoff_time || "12:00") })`.
- **POST**: body `{ cutoffEnabled, cutoffTime }` → update baris pertama bila ada, else insert. `cutoffEnabled` default `true`, `cutoffTime` default `"12:00"`.
- CORS + try/catch `errorResponse` pola existing.

### 3. Util baru di `supabase/functions/_shared/utils.ts`

- `getWIBMinutes(): number` — menit sejak 00:00 WIB (UTC+7), independen dari timezone server:
  ```ts
  export function getWIBMinutes(): number {
    const wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
    return wib.getUTCHours() * 60 + wib.getUTCMinutes();
  }
  ```
- `cutoffToMinutes(val: unknown): number` — parse `"HH:MM"` → menit; fallback `12 * 60` bila invalid/kosong.

### 4. Enforcement di `perkiraan/index.ts` (POST)

Sebelum upsert `record`:

1. Baca `setting_perkiraan` baris pertama. Default `cutoffEnabled = true`, `cutoffTime = "12:00"` bila tidak ada.
2. `cutoffMenit = cutoffToMinutes(cutoffTime)`; `wibMenit = getWIBMinutes()`.
3. Jika `cutoffEnabled === true` DAN `wibMenit >= cutoffMenit`:
   - Ambil baris lama: `perkiraan_bon_setor` dengan `eq("tanggal", obj.tanggal).eq("user_estim", obj.userEstim)`.
   - Paksa `record.p100k_bon = Number(existing?.p100k_bon) || 0` dan `record.p50k_bon = Number(existing?.p50k_bon) || 0`.
   - `record.p100k_setor` / `record.p50k_setor` tetap dari client.
   - Set flag `bonLocked = true`.
4. Lanjut upsert + trigger notif TUKAB seperti sekarang.
5. Response: `successResponse({ message: "Saved", bonLocked })`.

Dampak: pukul 11:59 simpan normal; 12:00+ perubahan Bon diabaikan (nilai lama dipertahankan), Setor tetap tersimpan. Baris baru saat terkunci → Bon `0`, hanya Setor.

## Frontend (`frontend/index.html`)

### 1. Menu admin baru

Tambah di `.menu-admin` (setelah item Notifikasi WA / Tujuan Email):

```html
<div class="menu-item" onclick="nav('setting-perkiraan', this); loadSettingPerkiraan();">🕛 Pengaturan Perkiraan</div>
```

### 2. Halaman admin baru

`<div id="setting-perkiraan" class="page role-page-admin">`, meniru pola toggle `fn-notif-enabled` pada halaman Notifikasi WA:

- Toggle `sp-cutoff-enabled` + label `sp-cutoff-label` (`AKTIF`/`NONAKTIF`), `onchange="onTogglePerkiraanCutoff()"`.
- Input jam `<input type="time" id="sp-cutoff-time" value="12:00">`.
- Penjelasan singkat: membatasi input Bon setelah jam cutoff; nonaktifkan saat urgent.
- Tombol `💾 SIMPAN PENGATURAN` → `simpanSettingPerkiraan()`.

### 3. Fungsi JS admin

- `loadSettingPerkiraan()` — panggil `getSettingPerkiraan()`, isi toggle/label/input jam; gagal → alert error.
- `simpanSettingPerkiraan()` — kirim `{ cutoffEnabled, cutoffTime }` via `saveSettingPerkiraan()`; sukses → `showToast(false)` + alert.
- `onTogglePerkiraanCutoff()` — update label `AKTIF`/`NONAKTIF` + warna (mirror `onToggleNotif`).

### 4. Mapping API di `_GAS_MAP`

```js
getSettingPerkiraan:  ['GET','/setting-perkiraan'],
saveSettingPerkiraan: ['POST','/setting-perkiraan'],
```

### 5. Halaman Perkiraan Bon/Setor (`perkiraan-teller`, role KF & Capem)

- Global cache `perkiraanCutoffSetting` (default `{ cutoffEnabled: true, cutoffTime: "12:00" }`).
- `initPerkiraanTeller()`: load setting via `getSettingPerkiraan()` (paralel dengan pengecekan hari kerja), simpan ke cache, lalu `applyPerkiraanCutoffState()` setelah data form di-render.
- `loadPerkiraanTeller()`: setelah render nilai, panggil `applyPerkiraanCutoffState()`.
- `getWIBMinutesClient()`:
  ```js
  function getWIBMinutesClient() {
    var wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
    return wib.getUTCHours() * 60 + wib.getUTCMinutes();
  }
  ```
- `applyPerkiraanCutoffState()`:
  - `cutoffMenit` = parse `perkiraanCutoffSetting.cutoffTime` (fallback 720).
  - `locked = perkiraanCutoffSetting.cutoffEnabled && getWIBMinutesClient() >= cutoffMenit`.
  - Jika locked:
    - `document.getElementById('pt-100-bon').disabled = true;` (idem `pt-50-bon`).
    - Tampilkan banner `#pt-cutoff-banner` dengan pesan.
    - `alert("Mohon maaf input bon tidak bisa dilakukan diatas jam " + cutoffDisplay + " WIB")` — tampil **sekali per kunjungan** menu (guard flag, mis. `perkiraanCutoffAlertShown` yang direset di `initPerkiraanTeller`). `cutoffDisplay` = `cutoffTime.replace(':', '.')` (mis. `12.00`).
  - Jika tidak locked: enable kembali input Bon, sembunyikan banner.
- Banner baru di dalam page `perkiraan-teller`, default hidden, id `pt-cutoff-banner`, warna merah muda, berisi pesan yang sama.
- Karena input Bon `disabled` tapi `data-val` tetap menyimpan nilai lama, `simpanPerkiraanTeller()` (untuk Setor) tetap mengirim nilai Bon lama → aman, tidak menghapus Bon. Backend juga menjaga.

## Data Flow

1. Admin membuka "Pengaturan Perkiraan", menyalakan/mematikan toggle & mengatur jam cutoff, simpan → `setting_perkiraan`.
2. KF/Capem membuka menu Perkiraan Bon/Setor. Frontend load setting, hitung WIB sekarang.
3. Bila terkunci: input Bon disabled + banner + alert; input Setor tetap aktif.
4. User simpan Setor → POST `/perkiraan`; backend cek setting + WIB, pertahankan Bon lama, simpan Setor, balas `bonLocked`.

## Error Handling

| Skenario | Perilaku |
|---|---|
| `getSettingPerkiraan` gagal | Fallback default (`enabled=true`, `12:00`); input Bon tetap diblock, tidak crash |
| `saveSettingPerkiraan` gagal | `alert` pesan error |
| `cutoff_time` invalid di DB | Backend & frontend fallback ke `12:00` |
| Baris perkiraan belum ada + terkunci | Bon dipaksa `0`, Setor tetap disimpan |
| Exception lain di edge function | Error 500 (`errorResponse`) |

## Testing / Verifikasi

Repo belum punya test runner. Verifikasi manual:

1. Sebelum cutoff: input Bon & Setor normal, tersimpan.
2. Setelah cutoff (set jam lewat admin ke waktu yang sudah lewat): buka menu Perkiraan → input Bon disabled, banner + alert muncul; isi Setor → simpan berhasil; Bon lama tidak berubah.
3. Admin toggle OFF → semua user bisa input Bon kapan saja.
4. Ubah jam cutoff → perilaku mengikuti jam baru saat menu dibuka.
5. Bypass API: POST `/perkiraan` langsung setelah cutoff dengan Bon baru → nilai Bon di DB tetap (tidak berubah), Setor tersimpan.
6. Timezone: jalankan dengan device timezone berbeda, cutoff harus mengikuti WIB.
7. Uji unit Deno opsional untuk `getWIBMinutes()` / `cutoffToMinutes()` bila `deno` tersedia.

## Batasan / Catatan

- Recalc Pesanan Nasabah (`pesanan-nasabah` POST/DELETE) tetap menulis langsung ke `perkiraan_bon_setor`; **bisa mengubah Bon setelah cutoff** dan **mereset Setor ke 0**. Di luar scope fitur ini (disepakati).
- Role pada aplikasi dikirim dari client (tidak diverifikasi token server-side), namun enforcement cutoff hanya bergantung pada waktu WIB + setelan global, bukan pada klaim role, sehingga tetap berlaku untuk semua user.
- Cutoff dihitung dari jam server/device; backend menjadi penentu final saat penyimpanan.
