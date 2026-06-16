// Upload KasM009.xlsx data to Supabase
const XLSX = require('xlsx');
const https = require('https');

const SB_URL = 'https://jwsfsczgyqphoyflpjnm.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3c2ZzY3pneXFwaG95Zmxwam5tIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTYwMzQyNiwiZXhwIjoyMDk3MTc5NDI2fQ.wCkj-LN8oeL4TeEAYUaNk4zzV5SMeeDiF8LkZmoXXv8';

// Excel serial date → YYYY-MM-DD
function excelDate(serial) {
  if (!serial && serial !== 0) return null;
  // If already a string like "2026-01-15", return as-is
  if (typeof serial === 'string' && serial.match(/^\d{4}-\d{2}-\d{2}$/)) return serial;
  var n = Number(serial);
  if (isNaN(n) || n < 1) return null;
  // Excel date epoch: 1899-12-30
  var d = new Date(Math.round((n - 25569) * 86400 * 1000));
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

// Excel time fraction → HH:mm:ss
function excelTime(serial) {
  if (!serial && serial !== 0) return null;
  var n = Number(serial);
  if (isNaN(n) || n >= 1 || n < 0) return String(serial).substring(0, 5) || null;
  var totalSec = Math.round(n * 86400);
  var h = Math.floor(totalSec / 3600);
  var m = Math.floor((totalSec % 3600) / 60);
  var s = totalSec % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

// Ensure text with leading zeros (3-digit kode)
function padCode(val, len) {
  if (!val && val !== 0) return '';
  var s = String(val).replace(/'/g, '').trim();
  if (s.match(/^\d+$/)) return s.padStart(len || 3, '0');
  return s;
}

// Clean integer value
function cleanInt(val) {
  if (!val && val !== 0) return 0;
  return Math.round(Number(val)) || 0;
}

// Clean bigint
function cleanBigInt(val) {
  if (!val && val !== 0) return 0;
  return Math.round(Number(val)) || 0;
}

// API request helper
function apiPost(path, body) {
  return new Promise(function(resolve, reject) {
    var data = JSON.stringify(body);
    var url = new URL(SB_URL + '/rest/v1/' + path);
    var options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'apikey': SB_KEY,
        'Authorization': 'Bearer ' + SB_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    var req = https.request(options, function(res) {
      var body = '';
      res.on('data', function(c) { body += c; });
      res.on('end', function() {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
        else reject(new Error(res.statusCode + ': ' + body.substring(0, 200)));
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function uploadBatch(table, rows) {
  var batchSize = 500;
  var total = 0;
  for (var i = 0; i < rows.length; i += batchSize) {
    var batch = rows.slice(i, i + batchSize);
    try {
      await apiPost(table, batch);
      total += batch.length;
      process.stdout.write('\r' + table + ': ' + total + '/' + rows.length);
    } catch(e) {
      console.error('\nError batch ' + i + ': ' + e.message);
      // Try one by one
      for (var j = 0; j < batch.length; j++) {
        try {
          await apiPost(table, [batch[j]]);
          total++;
          process.stdout.write('\r' + table + ': ' + total + '/' + rows.length);
        } catch(e2) {
          console.error('\nRow error: ' + e2.message + ' | data: ' + JSON.stringify(batch[j]).substring(0,100));
        }
      }
    }
  }
  console.log(' ✓');
}

async function main() {
  // Read Excel
  var wb = XLSX.readFile('D:/Project/KasM009.xlsx');

  // === USERS ===
  console.log('\n--- Users ---');
  var ws = wb.Sheets['Users'];
  var data = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
  var users = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!r[4]) continue; // skip empty
    users.push({
      kode_wilayah: padCode(r[1], 3),
      kode_cabang: padCode(r[2], 3),
      nama_unit: String(r[3] || '').trim(),
      nama_user: String(r[4] || '').replace(/'/g, '').trim(),
      role: String(r[5] || 'teller').replace(/'/g, '').trim().toLowerCase(),
      user_estim: String(r[6] || '').replace(/'/g, '').trim(),
      password: String(r[7] || '')
    });
    // For existing users with same user_estim, skip (already seeded)
  }
  // Filter out duplicates by user_estim
  var seenEstim = new Set();
  var uniqueUsers = [];
  for (var u = 0; u < users.length; u++) {
    if (!seenEstim.has(users[u].user_estim)) {
      seenEstim.add(users[u].user_estim);
      uniqueUsers.push(users[u]);
    }
  }
  await uploadBatch('users', uniqueUsers);

  // === HARI LIBUR ===
  console.log('\n--- Hari Libur ---');
  ws = wb.Sheets['HariLibur'];
  data = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
  var hariLibur = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var tgl = excelDate(r[0]);
    if (!tgl) continue;
    hariLibur.push({ tanggal: tgl, keterangan: String(r[1] || '').trim() });
  }
  await uploadBatch('hari_libur', hariLibur);

  // === BON SETOR ===
  console.log('\n--- Bon Setor ---');
  ws = wb.Sheets['BonSetor'];
  data = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
  var bonSetor = [];
  var seenTrx = new Set();
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var idTrx = String(r[0] || '').replace(/'/g, '').trim();
    if (!idTrx) continue;
    var tgl = excelDate(r[1]);
    if (!tgl) continue;
    var key = idTrx + '_' + String(r[4]) + '_' + String(r[5]);
    // Skip exact duplicates within same batch
    // (original GAS could have duplicates from overwrites)
    bonSetor.push({
      id_transaksi: idTrx,
      tanggal: tgl,
      user_estim: String(r[2] || '').replace(/'/g, '').trim(),
      tipe: String(r[3] || '').trim(),
      kategori: String(r[4] || '').trim(),
      pecahan: String(r[5] || '').replace(/'/g, '').trim(),
      lembar: cleanInt(r[6]),
      nominal: cleanBigInt(r[7]),
      kode_cabang: padCode(r[8], 3),
      kode_wilayah: padCode(r[9], 3),
      scope: String(r[10] || 'KHASANAH').trim().toUpperCase()
    });
  }
  await uploadBatch('bon_setor', bonSetor);

  // === POSISI KAS ===
  console.log('\n--- Posisi Kas ---');
  ws = wb.Sheets['PosisiKas'];
  data = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
  var posisiKas = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var tgl = excelDate(r[0]);
    if (!tgl) continue;
    posisiKas.push({
      tanggal: tgl,
      user_estim: String(r[1] || '').replace(/'/g, '').trim(),
      saldo_kemarin: cleanBigInt(r[2]),
      penerimaan_debet: cleanBigInt(r[3]),
      penerimaan_antar_teller: cleanBigInt(r[4]),
      pembayaran_kredit: cleanBigInt(r[5]),
      pembayaran_antar_teller: cleanBigInt(r[6]),
      saldo_hari_ini: cleanBigInt(r[7]),
      saldo_fisik: cleanBigInt(r[8]),
      selisih: cleanBigInt(r[9]),
      kode_cabang: padCode(r[10], 3),
      kode_wilayah: padCode(r[11], 3),
      selisih_pembulatan: cleanBigInt(r[12])
    });
  }
  await uploadBatch('posisi_kas', posisiKas);

  // === SALDO AWAL HT ===
  console.log('\n--- Saldo Awal HT ---');
  ws = wb.Sheets['SaldoAwalHT'];
  data = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
  var saldoAwal = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var tgl = excelDate(r[0]);
    if (!tgl) continue;
    saldoAwal.push({
      tanggal: tgl,
      user_estim: String(r[1] || '').replace(/'/g, '').trim(),
      kategori: String(r[2] || '').trim(),
      pecahan: String(r[3] || '').replace(/'/g, '').trim(),
      lembar: cleanInt(r[4]),
      nominal: cleanBigInt(r[5]),
      kode_cabang: padCode(r[6], 3),
      kode_wilayah: padCode(r[7], 3)
    });
  }
  await uploadBatch('saldo_awal_ht', saldoAwal);

  // === DATA PEGAWAI ===
  console.log('\n--- Data Pegawai ---');
  ws = wb.Sheets['DataPegawai'];
  data = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
  var pegawai = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!r[0]) continue;
    pegawai.push({
      user_estim_teller: String(r[0] || '').replace(/'/g, '').trim(),
      nip_teller: String(r[1] || '').trim(),
      nama_teller: String(r[2] || '').trim(),
      nip_pimkas: String(r[3] || '').trim(),
      nama_pimkas: String(r[4] || '').trim(),
      user_estim_pimkas: String(r[5] || '').replace(/'/g, '').trim()
    });
  }
  await uploadBatch('data_pegawai', pegawai);

  // === DATA PEJABAT HT ===
  console.log('\n--- Data Pejabat HT ---');
  ws = wb.Sheets['DataPejabatHT'];
  data = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
  var pejabat = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!r[0]) continue;
    pejabat.push({
      kode_wilayah: padCode(r[0], 3),
      nip_penyelia: String(r[1] || '').trim(),
      nama_penyelia: String(r[2] || '').trim(),
      nip_pbo: String(r[3] || '').trim(),
      nama_pbo: String(r[4] || '').trim()
    });
  }
  await uploadBatch('data_pejabat_ht', pejabat);

  // === SETTING FONNTE ===
  console.log('\n--- Setting Fonnte ---');
  ws = wb.Sheets['SettingFonnte'];
  data = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
  var fonnte = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!r[0]) continue;
    fonnte.push({
      kode_wilayah: String(r[0] || 'ALL').replace(/'/g, '').trim(),
      token: String(r[1] || '').trim(),
      no_hp: String(r[2] || '').replace(/'/g, '').trim(),
      waktu: excelTime(r[3]) || '16:00',
      token_kf: String(r[4] || '').trim(),
      target_kf: String(r[5] || '').replace(/'/g, '').trim(),
      target_tukab: String(r[6] || '').replace(/'/g, '').trim(),
      waktu_perkiraan_h1: excelTime(r[7]) || '07:00',
      target_perkiraan_h1: String(r[8] || '').replace(/'/g, '').trim(),
      target_posisi_kas: String(r[9] || '').replace(/'/g, '').trim()
    });
  }
  await uploadBatch('setting_fonnte', fonnte);

  // === PERKIRAAN BON SETOR ===
  console.log('\n--- Perkiraan Bon Setor ---');
  ws = wb.Sheets['PerkiraanBonSetor'];
  data = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
  var perkiraan = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var tgl = excelDate(r[0]);
    if (!tgl || !r[1]) continue;
    var wInput = excelTime(r[7]);
    perkiraan.push({
      tanggal: tgl,
      user_estim: String(r[1] || '').replace(/'/g, '').trim(),
      kode_wilayah: padCode(r[2], 3),
      p100k_setor: cleanBigInt(r[3]),
      p100k_bon: cleanBigInt(r[4]),
      p50k_setor: cleanBigInt(r[5]),
      p50k_bon: cleanBigInt(r[6]),
      waktu_input: wInput ? (tgl + 'T' + wInput) : (tgl + 'T00:00:00')
    });
  }
  await uploadBatch('perkiraan_bon_setor', perkiraan);

  // === PESANAN NASABAH ===
  console.log('\n--- Pesanan Nasabah ---');
  ws = wb.Sheets['PesananNasabah'];
  data = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
  var pesanan = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!r[0]) continue;
    var tgl = excelDate(r[1]);
    if (!tgl) continue;
    var wInput = excelTime(r[7]);
    pesanan.push({
      id: String(r[0] || '').trim(),
      tanggal: tgl,
      user_estim: String(r[2] || '').replace(/'/g, '').trim(),
      kode_wilayah: padCode(r[3], 3),
      nama_nasabah: String(r[4] || '').trim(),
      p100k: cleanBigInt(r[5]),
      p50k: cleanBigInt(r[6]),
      waktu_input: wInput ? (tgl + 'T' + wInput) : (tgl + 'T00:00:00')
    });
  }
  await uploadBatch('pesanan_nasabah', pesanan);

  console.log('\n\n=== UPLOAD COMPLETE ===');
}

main().catch(function(e) { console.error('FATAL:', e.message); });
