# Cutoff Input Perkiraan Bon (Jam 12.00 WIB) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menutup input Perkiraan Bon pada menu Perkiraan Bon/Setor setelah jam cutoff WIB (default 12:00), dengan toggle on/off + pengaturan jam oleh admin, ditegakkan di frontend dan backend.

**Architecture:** Tabel `setting_perkiraan` + edge function `setting-perkiraan` (pola `setting-email`). Edge function `perkiraan` mempertahankan nilai Bon lama bila terkunci dan tetap menyimpan Setor. Frontend men-disable input Bon + banner/alert berdasarkan setting, memakai perhitungan WIB independen timezone device.

**Tech Stack:** Supabase PostgreSQL + Deno Edge Functions, vanilla HTML/CSS/JS SPA (`frontend/index.html`), polyfill `google.script.run` → `_GAS_MAP` → `callApi`.

## Global Constraints

- Zona waktu cutoff: **WIB (UTC+7)**, wajib dihitung eksplisit, tidak boleh bergantung timezone device/server.
- Jam cutoff default: `"12:00"`. Bila nilai DB invalid/kosong → fallback `12:00`.
- Toggle default: `true` (pembatasan aktif).
- Teks alert: `Mohon maaf input bon tidak bisa dilakukan diatas jam <jam> WIB` dengan `<jam>` format `HH.MM` (mis. `12.00`).
- Cakupan: hanya form Perkiraan Bon/Setor. Pesanan Nasabah tidak dibatasi.
- Edge function memakai `getSupabaseClient(req)` (service_role), CORS dari `_shared/cors.ts`, response `successResponse`/`errorResponse`.
- Frontend memakai pola `google.script.run.withSuccessHandler(...).<method>()` + `_GAS_MAP`; jangan panggil `fetch` langsung untuk endpoint baru.
- Tidak ada test runner di repo; verifikasi memakai deploy + uji manual (Deno lokal tidak terpasang).
- Repo memakai PowerShell (win32). Jangan commit file untracked yang tidak terkait.
- Setiap commit hanya menyertakan file yang relevan dengan task tersebut.

---

### Task 1: Tabel `setting_perkiraan` + Edge Function `setting-perkiraan`

**Files:**
- Create: `supabase/migrations/023_setting_perkiraan.sql`
- Create: `supabase/functions/setting-perkiraan/index.ts`
- Modify: `README.md` (tabel API Endpoints)

**Interfaces:**
- Produces:
  - Tabel `setting_perkiraan(id, cutoff_enabled boolean, cutoff_time text, created_at, updated_at)`.
  - `GET /setting-perkiraan` → `{ success: true, data: { cutoffEnabled: boolean, cutoffTime: string } }`.
  - `POST /setting-perkiraan` body `{ cutoffEnabled?: boolean, cutoffTime?: string }` → `{ success: true, data: true }`.

- [ ] **Step 1: Tulis migration**

Create `supabase/migrations/023_setting_perkiraan.sql`:

```sql
-- =============================================
-- MIGRASI: Pengaturan cut-off input Perkiraan Bon
-- File: 023_setting_perkiraan.sql
-- =============================================

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

- [ ] **Step 2: Jalankan migration**

Buka **Supabase Dashboard → SQL Editor**, copy-paste isi file di atas, klik **Run**.
Alternatif (jika project sudah ter-link): `supabase db push`.
Expected: tabel `setting_perkiraan` terbuat dengan 1 baris (`cutoff_enabled=true`, `cutoff_time='12:00'`).

Verifikasi cepat via SQL Editor:

```sql
SELECT cutoff_enabled, cutoff_time FROM setting_perkiraan;
```

Expected: `true | 12:00`.

- [ ] **Step 3: Tulis edge function**

Create `supabase/functions/setting-perkiraan/index.ts`:

```ts
// Edge Function: /api/setting-perkiraan
// Pengaturan batas waktu input Perkiraan Bon (cutoff) + toggle on/off

import { corsHeaders, successResponse, errorResponse } from "../_shared/cors.ts";
import { getSupabaseClient } from "../_shared/supabase.ts";
import { cleanStr } from "../_shared/utils.ts";

const DEFAULT_TIME = "12:00";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient(req);

    // GET
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("setting_perkiraan")
        .select("*")
        .order("id")
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (!data) return successResponse({ cutoffEnabled: true, cutoffTime: DEFAULT_TIME });

      return successResponse({
        cutoffEnabled: data.cutoff_enabled !== false,
        cutoffTime: cleanStr(data.cutoff_time) || DEFAULT_TIME,
      });
    }

    // POST - Save (upsert single row)
    if (req.method === "POST") {
      const obj = await req.json();

      const record = {
        cutoff_enabled: obj.cutoffEnabled !== undefined ? !!obj.cutoffEnabled : true,
        cutoff_time: cleanStr(obj.cutoffTime) || DEFAULT_TIME,
        updated_at: new Date().toISOString(),
      };

      const { data: existing } = await supabase
        .from("setting_perkiraan").select("id").order("id");

      if (existing && existing.length > 0) {
        await supabase.from("setting_perkiraan").update(record).eq("id", existing[0].id);
      } else {
        await supabase.from("setting_perkiraan").insert(record);
      }

      return successResponse(true);
    }

    return errorResponse("Method not allowed", 405);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return errorResponse("ERROR: " + msg, 500);
  }
});
```

- [ ] **Step 4: Deploy edge function**

Run:

```powershell
supabase functions deploy setting-perkiraan --no-verify-jwt
```

Expected: output `Deployed Functions ... setting-perkiraan`.

- [ ] **Step 5: Verifikasi GET & POST**

Run (ganti `<ANON_KEY>` dengan anon key di `frontend/config.js`):

```powershell
$headers = @{ "Content-Type" = "application/json"; "Authorization" = "Bearer <ANON_KEY>" }
Invoke-RestMethod -Uri "https://jwsfsczgyqphoyflpjnm.supabase.co/functions/v1/setting-perkiraan" -Headers $headers -Method GET | ConvertTo-Json -Depth 5
```

Expected: `data.cutoffEnabled = True`, `data.cutoffTime = "12:00"`.

```powershell
$body = '{ "cutoffEnabled": false, "cutoffTime": "13:30" }'
Invoke-RestMethod -Uri "https://jwsfsczgyqphoyflpjnm.supabase.co/functions/v1/setting-perkiraan" -Headers $headers -Method POST -Body $body | ConvertTo-Json -Depth 5
```

Expected: `data = True`. Lalu ulangi GET → `cutoffEnabled = False`, `cutoffTime = "13:30"`.
**Penting:** kembalikan ke nilai normal setelah tes:

```powershell
$body = '{ "cutoffEnabled": true, "cutoffTime": "12:00" }'
Invoke-RestMethod -Uri "https://jwsfsczgyqphoyflpjnm.supabase.co/functions/v1/setting-perkiraan" -Headers $headers -Method POST -Body $body | ConvertTo-Json -Depth 5
```

- [ ] **Step 6: Update README**

Di tabel `## API Endpoints`, tambahkan baris setelah `/api/setting-email`:

```markdown
| GET/POST | `/api/setting-perkiraan` | Pengaturan cutoff input Perkiraan Bon (jam + toggle) |
```

- [ ] **Step 7: Commit**

```powershell
git add supabase/migrations/023_setting_perkiraan.sql supabase/functions/setting-perkiraan/index.ts README.md
git commit -m "feat: tabel + edge function setting-perkiraan (cutoff input bon)"
```

---

### Task 2: Util WIB + Enforcement di Edge Function `perkiraan`

**Files:**
- Modify: `supabase/functions/_shared/utils.ts` (tambah 2 fungsi di akhir file)
- Modify: `supabase/functions/perkiraan/index.ts:1-9` (import) dan `:140-182` (blok POST)

**Interfaces:**
- Consumes: tabel `setting_perkiraan` dari Task 1.
- Produces:
  - `getWIBMinutes(): number`
  - `cutoffToMinutes(val: unknown): number`
  - `POST /perkiraan` → `{ success: true, data: { message: "Saved", bonLocked: boolean } }`

- [ ] **Step 1: Tambah util WIB**

Di akhir `supabase/functions/_shared/utils.ts`, tambahkan:

```ts
// WIB (GMT+7) menit sejak 00:00 — independen dari timezone server
export function getWIBMinutes(): number {
  const wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return wib.getUTCHours() * 60 + wib.getUTCMinutes();
}

// Parse "HH:MM" menjadi menit; fallback 12:00 (720) bila invalid
export function cutoffToMinutes(val: unknown): number {
  const str = cleanStr(val);
  const match = /^(\d{1,2}):(\d{2})/.exec(str);
  if (!match) return 12 * 60;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (isNaN(h) || isNaN(m)) return 12 * 60;
  return h * 60 + m;
}
```

- [ ] **Step 2: Update import di `perkiraan/index.ts`**

Baris 7 saat ini:

```ts
import { cleanStr, normalizeUnit, formatSafeString, getWIBISOString } from "../_shared/utils.ts";
```

Ganti menjadi:

```ts
import { cleanStr, normalizeUnit, formatSafeString, getWIBISOString, getWIBMinutes, cutoffToMinutes } from "../_shared/utils.ts";
```

- [ ] **Step 3: Tambah enforcement pada blok POST**

Di `supabase/functions/perkiraan/index.ts`, setelah blok `const record = { ... };` (setelah `waktu_input: getWIBISOString(), };`) dan sebelum `const { error } = await supabase.from("perkiraan_bon_setor").upsert(...)`, sisipkan:

```ts
      // Enforcement cutoff input Bon (WIB)
      let bonLocked = false;
      try {
        const { data: setting } = await supabase
          .from("setting_perkiraan")
          .select("cutoff_enabled, cutoff_time")
          .order("id")
          .limit(1)
          .maybeSingle();

        const cutoffEnabled = !setting || setting.cutoff_enabled !== false;
        const cutoffMenit = cutoffToMinutes(setting?.cutoff_time);

        if (cutoffEnabled && getWIBMinutes() >= cutoffMenit) {
          const { data: existing } = await supabase
            .from("perkiraan_bon_setor")
            .select("p100k_bon, p50k_bon")
            .eq("tanggal", record.tanggal)
            .eq("user_estim", record.user_estim)
            .maybeSingle();

          record.p100k_bon = parseInt(String(existing?.p100k_bon)) || 0;
          record.p50k_bon = parseInt(String(existing?.p50k_bon)) || 0;
          bonLocked = true;
        }
      } catch (e) {
        console.warn("[perkiraan] Gagal cek setting cutoff, lewati pembatasan:", e);
      }
```

- [ ] **Step 4: Ubah response POST**

Baris terakhir blok POST saat ini:

```ts
      return successResponse("Saved");
```

Ganti menjadi:

```ts
      return successResponse({ message: "Saved", bonLocked });
```

- [ ] **Step 5: Deploy edge function**

Run:

```powershell
supabase functions deploy perkiraan --no-verify-jwt
```

Expected: `Deployed Functions ... perkiraan`.

- [ ] **Step 6: Verifikasi enforcement (setelah cutoff)**

Set sementara cutoff ke jam yang sudah lewat (mis. `00:01`) via Task 1 endpoint:

```powershell
$headers = @{ "Content-Type" = "application/json"; "Authorization" = "Bearer <ANON_KEY>" }
Invoke-RestMethod -Uri "https://jwsfsczgyqphoyflpjnm.supabase.co/functions/v1/setting-perkiraan" -Headers $headers -Method POST -Body '{ "cutoffEnabled": true, "cutoffTime": "00:01" }' | ConvertTo-Json
```

Lalu kirim POST perkiraan dengan Bon acak untuk tanggal+user uji:

```powershell
Invoke-RestMethod -Uri "https://jwsfsczgyqphoyflpjnm.supabase.co/functions/v1/perkiraan" -Headers $headers -Method POST -Body '{ "tanggal": "2026-09-17", "userEstim": "TESTCUTOFF", "kodeWilayah": "ALL", "p100k_setor": 111, "p100k_bon": 999999, "p50k_setor": 222, "p50k_bon": 888888 }' | ConvertTo-Json -Depth 5
```

Expected: `data.bonLocked = True`. Cek di SQL Editor baris `user_estim='TESTCUTOFF'`: `p100k_bon`/`p50k_bon` **bukan** 999999/888888 (bernilai lama atau 0), sedangkan `p100k_setor=111`, `p50k_setor=222`.
Bersihkan setelah tes:

```sql
DELETE FROM perkiraan_bon_setor WHERE user_estim = 'TESTCUTOFF';
```

- [ ] **Step 7: Verifikasi tidak terkunci saat toggle OFF**

```powershell
Invoke-RestMethod -Uri ".../v1/setting-perkiraan" -Headers $headers -Method POST -Body '{ "cutoffEnabled": false, "cutoffTime": "00:01" }' | ConvertTo-Json
Invoke-RestMethod -Uri ".../v1/perkiraan" -Headers $headers -Method POST -Body '<body sama seperti Step 6>' | ConvertTo-Json -Depth 5
```

Expected: `data.bonLocked = False` dan nilai Bon tersimpan sesuai input.

- [ ] **Step 8: Kembalikan setting normal**

```powershell
Invoke-RestMethod -Uri ".../v1/setting-perkiraan" -Headers $headers -Method POST -Body '{ "cutoffEnabled": true, "cutoffTime": "12:00" }' | ConvertTo-Json
```

- [ ] **Step 9: Commit**

```powershell
git add supabase/functions/_shared/utils.ts supabase/functions/perkiraan/index.ts
git commit -m "feat: enforcement cutoff input bon di edge function perkiraan"
```

---

### Task 3: Frontend — Menu & Halaman Admin Pengaturan Perkiraan

**Files:**
- Modify: `frontend/index.html` (menu admin ~239, halaman baru ~510, `_GAS_MAP` ~1308, fungsi JS ~3804)

**Interfaces:**
- Consumes: `GET/POST /setting-perkiraan` dari Task 1.
- Produces (dipanggil Task 4):
  - `perkiraanCutoffSetting` (global `{ cutoffEnabled, cutoffTime }`)
  - `loadSettingPerkiraanCache()`
  - `isPerkiraanBonLocked()`
  - `applyPerkiraanCutoffState()`
  - `perkiraanCutoffAlertShown` (global boolean)

- [ ] **Step 1: Tambah menu admin**

Di `frontend/index.html`, setelah baris 239:

```html
      <div class="menu-item" onclick="nav('setting-email', this); loadSettingEmail();">✉️ Tujuan Email Laporan</div>
```

tambahkan (sebelum `</div>` penutup `.menu-admin`):

```html
      <div class="menu-item" onclick="nav('setting-perkiraan', this); loadSettingPerkiraan();">🕛 Pengaturan Perkiraan</div>
```

- [ ] **Step 2: Tambah halaman admin**

Setelah penutup halaman `setting-email` (baris 510 `</div>`) dan sebelum `<div id="perkiraan-teller" class="page">` (baris 512), sisipkan:

```html
      <div id="setting-perkiraan" class="page role-page-admin">
        <div class="header-page"><h3>Pengaturan Perkiraan Bon / Setor</h3></div>

        <div style="display:flex; align-items:center; gap:15px; margin-bottom:20px; padding:15px; background:#f8fafc; border-radius:8px; border:1px solid var(--border-color);">
          <div>
            <b style="font-size:1.1rem;">🕛 Pembatasan Input Bon</b>
            <p style="margin:4px 0 0 0; color:var(--text-muted); font-size:0.85rem;">Jika AKTIF, seluruh user tidak dapat menginput Perkiraan Bon setelah jam cutoff. Matikan saat ada kondisi urgent. Form Setor tetap dapat diisi.</p>
          </div>
          <label style="margin-left:auto; display:flex; align-items:center; cursor:pointer;">
            <input type="checkbox" id="sp-cutoff-enabled" onchange="onTogglePerkiraanCutoff()" style="width:48px; height:24px; accent-color:#059669; transform:scale(1.3); cursor:pointer;">
            <span style="margin-left:8px; font-weight:700;" id="sp-cutoff-label">AKTIF</span>
          </label>
        </div>

        <div class="form-row">
          <div class="form-group"><label>Jam Cutoff (WIB)</label><input type="time" id="sp-cutoff-time" value="12:00" style="background:var(--input-yellow);"></div>
        </div>

        <div style="display:flex; gap:15px; flex-wrap:wrap; margin-top:25px;">
          <button class="btn-refresh" style="flex:1; font-size:1.1rem; padding:15px; margin:0;" onclick="simpanSettingPerkiraan()">💾 SIMPAN PENGATURAN</button>
        </div>
      </div>
```

- [ ] **Step 3: Tambah mapping API**

Di `_GAS_MAP`, setelah baris 1308:

```js
      saveSettingEmail:           ['POST','/setting-email'],
```

tambahkan:

```js
      getSettingPerkiraan:        ['GET','/setting-perkiraan'],
      saveSettingPerkiraan:       ['POST','/setting-perkiraan'],
```

- [ ] **Step 4: Tambah global variable**

Di baris 1653:

```js
    let currentUser = {}; let globalHistoryData = []; let allUsersData = []; let globalPosisiHT = []; let globalHistoryPosisi = [];
```

Tambahkan baris baru setelahnya:

```js
    let perkiraanCutoffSetting = { cutoffEnabled: true, cutoffTime: '12:00' };
    let perkiraanCutoffAlertShown = false;
```

- [ ] **Step 5: Tambah fungsi admin + helper cutoff**

Setelah fungsi `onToggleNotif()` (selesai di baris 3804, tepat sebelum `function loadSettingEmail()`), sisipkan:

```js
    function loadSettingPerkiraan() {
      showLoader(true, "Memuat setelan perkiraan...");
      google.script.run.withSuccessHandler((res) => {
        showLoader(false);
        let enabled = (res && res.cutoffEnabled !== undefined) ? res.cutoffEnabled : true;
        let waktu = (res && res.cutoffTime) ? res.cutoffTime : '12:00';
        document.getElementById('sp-cutoff-enabled').checked = enabled;
        document.getElementById('sp-cutoff-time').value = waktu;
        onTogglePerkiraanCutoff();
      }).withFailureHandler((err) => {
        showLoader(false);
        alert("Gagal memuat setelan perkiraan: " + err.message);
      }).getSettingPerkiraan();
    }

    function onTogglePerkiraanCutoff() {
      let enabled = document.getElementById('sp-cutoff-enabled').checked;
      let lbl = document.getElementById('sp-cutoff-label');
      lbl.innerText = enabled ? 'AKTIF' : 'NONAKTIF';
      lbl.style.color = enabled ? '#059669' : '#dc2626';
    }

    function simpanSettingPerkiraan() {
      let obj = {
        cutoffEnabled: document.getElementById('sp-cutoff-enabled').checked,
        cutoffTime: document.getElementById('sp-cutoff-time').value || '12:00'
      };
      showLoader(true, "Menyimpan setelan...");
      google.script.run.withSuccessHandler(() => {
        showLoader(false); showToast(false); alert("Pengaturan Perkiraan berhasil disimpan.");
      }).withFailureHandler((err) => {
        showLoader(false); alert("Gagal menyimpan: " + err.message);
      }).saveSettingPerkiraan(obj);
    }

    function loadSettingPerkiraanCache() {
      google.script.run.withSuccessHandler((res) => {
        perkiraanCutoffSetting = {
          cutoffEnabled: (res && res.cutoffEnabled !== undefined) ? res.cutoffEnabled : true,
          cutoffTime: (res && res.cutoffTime) ? res.cutoffTime : '12:00'
        };
        applyPerkiraanCutoffState();
      }).withFailureHandler(() => {
        perkiraanCutoffSetting = { cutoffEnabled: true, cutoffTime: '12:00' };
        applyPerkiraanCutoffState();
      }).getSettingPerkiraan();
    }

    function getWIBMinutesClient() {
      let wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
      return wib.getUTCHours() * 60 + wib.getUTCMinutes();
    }

    function cutoffToMinutesClient(str) {
      if (!str || typeof str !== 'string' || str.indexOf(':') === -1) return 720;
      let parts = str.split(':');
      let h = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
      if (isNaN(h) || isNaN(m)) return 720;
      return h * 60 + m;
    }

    function isPerkiraanBonLocked() {
      if (!perkiraanCutoffSetting.cutoffEnabled) return false;
      return getWIBMinutesClient() >= cutoffToMinutesClient(perkiraanCutoffSetting.cutoffTime);
    }

    function applyPerkiraanCutoffState() {
      let locked = isPerkiraanBonLocked();
      let bon100 = document.getElementById('pt-100-bon');
      let bon50 = document.getElementById('pt-50-bon');
      let banner = document.getElementById('pt-cutoff-banner');
      let waktu = (perkiraanCutoffSetting.cutoffTime || '12:00').replace(':', '.');
      let pesan = "Mohon maaf input bon tidak bisa dilakukan diatas jam " + waktu + " WIB";
      if (bon100) bon100.disabled = locked;
      if (bon50) bon50.disabled = locked;
      if (banner) {
        banner.style.display = locked ? 'block' : 'none';
        banner.innerText = "⚠️ " + pesan + " Form Setor tetap dapat diisi.";
      }
      if (locked && !perkiraanCutoffAlertShown) {
        perkiraanCutoffAlertShown = true;
        alert(pesan);
      }
    }
```

- [ ] **Step 6: Verifikasi admin page**

Buka frontend (GitHub Pages atau `http://localhost` via server statis), login sebagai `admin`.
Expected:
1. Menu `🕛 Pengaturan Perkiraan` muncul di sisi kiri.
2. Klik menu → halaman muncul, toggle `AKTIF` hijau, jam `12:00` (atau nilai tersimpan).
3. Ubah jam ke `13:45`, simpan → muncul alert "Pengaturan Perkiraan berhasil disimpan."; reload halaman, nilai tetap `13:45`.
4. Kembalikan ke `12:00` saat selesai.

- [ ] **Step 7: Commit**

```powershell
git add frontend/index.html
git commit -m "feat: menu admin + halaman pengaturan cutoff perkiraan"
```

---

### Task 4: Frontend — Lock Input Bon + Banner/Alert di Halaman Perkiraan

**Files:**
- Modify: `frontend/index.html` (banner di halaman `perkiraan-teller` ~514, `initPerkiraanTeller` ~3460, `loadPerkiraanTeller` ~3479)

**Interfaces:**
- Consumes: `loadSettingPerkiraanCache()`, `applyPerkiraanCutoffState()`, `perkiraanCutoffAlertShown` dari Task 3.

- [ ] **Step 1: Tambah banner**

Di halaman `#perkiraan-teller` (baris 512-514), setelah baris:

```html
        <div class="form-row"><div class="form-group"><label>Tanggal Perkiraan (Default: Hari Kerja Berikutnya)</label><input type="date" id="pt-tgl" onchange="loadPerkiraanTeller()"></div></div>
```

sisipkan:

```html
        <div id="pt-cutoff-banner" style="display:none; background:#fef2f2; border:1px solid #fecaca; border-left:5px solid #dc2626; color:#b91c1c; padding:12px 16px; border-radius:8px; margin-bottom:16px; font-weight:600;"></div>
```

- [ ] **Step 2: Hook di `initPerkiraanTeller`**

Di baris 3460-3461:

```js
    function initPerkiraanTeller() {
      let tglEl = document.getElementById('pt-tgl');
```

Ganti menjadi:

```js
    function initPerkiraanTeller() {
      perkiraanCutoffAlertShown = false;
      loadSettingPerkiraanCache();
      let tglEl = document.getElementById('pt-tgl');
```

- [ ] **Step 3: Hook di `loadPerkiraanTeller`**

Di `loadPerkiraanTeller`, pada success handler, baris 3488:

```js
        calcPerkiraanTeller();
      }).getPerkiraanTeller(tgl, currentUser.userEstim);
```

Ganti menjadi:

```js
        calcPerkiraanTeller();
        applyPerkiraanCutoffState();
      }).getPerkiraanTeller(tgl, currentUser.userEstim);
```

- [ ] **Step 4: Verifikasi sebelum cutoff**

Set jam cutoff admin ke waktu yang **belum** lewat (mis. `23:59`), lalu login sebagai user `capem` atau `kf`, buka menu `📅 Perkiraan Bon/Setor`.
Expected: input Bon dan Setor aktif (tidak disabled), banner tidak muncul, tidak ada alert; bisa simpan.

- [ ] **Step 5: Verifikasi setelah cutoff**

Set jam cutoff admin ke waktu yang **sudah** lewat (mis. `00:01`), login sebagai `capem`/`kf`, buka menu Perkiraan.
Expected:
1. Muncul alert `Mohon maaf input bon tidak bisa dilakukan diatas jam 00.01 WIB`.
2. Banner merah muncul dengan pesan sama.
3. Input `pt-100-bon` dan `pt-50-bon` disabled (abu-abu), input Setor aktif.
4. Isi Setor lalu simpan → sukses, dan nilai Bon tidak berubah.

- [ ] **Step 6: Verifikasi toggle OFF**

Set cutoff `00:01` dengan toggle **NONAKTIF**, buka ulang menu Perkiraan oleh `capem`/`kf`.
Expected: input Bon aktif kembali, tidak ada alert/banner.

- [ ] **Step 7: Kembalikan setting normal**

Admin → Pengaturan Perkiraan → toggle `AKTIF`, jam `12:00`, simpan.

- [ ] **Step 8: Commit**

```powershell
git add frontend/index.html
git commit -m "feat: lock input bon + banner/alert cutoff di halaman perkiraan"
```

---

## Catatan Deploy

1. Jalankan migration Task 1 (SQL Editor / `supabase db push`).
2. `supabase functions deploy setting-perkiraan --no-verify-jwt`
3. `supabase functions deploy perkiraan --no-verify-jwt`
4. Push `frontend/index.html` ke `main` → GitHub Actions deploy GitHub Pages.

## Self-Review

- **Spec coverage:** tabel+function (Task 1), util+enforcement backend (Task 2), toggle admin + jam (Task 3), lock+alert+banner frontend (Task 4), README (Task 1). Semua bagian spec tercakup.
- **Placeholder scan:** tidak ada TBD/TODO; semua langkah berisi kode/commmand konkret.
- **Type consistency:** `cutoffEnabled`/`cutoffTime` konsisten di GET/POST & frontend; `bonLocked` konsisten; `applyPerkiraanCutoffState`/`loadSettingPerkiraanCache` didefinisikan Task 3 dan dipakai Task 4; `getWIBMinutes`/`cutoffToMinutes` didefinisikan Task 2 dan dipakai di file yang sama.
