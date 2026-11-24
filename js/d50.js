/* =====================================================================
   D-50 — modèle de données, table des paramètres, SysEx, générateur
   Roland D-50 / D-550 : ID modèle 0x14, format Roland DT1 / RQ1
   Zone temporaire (patch en cours d'édition) : 00 00 00 .. 00 03 3F
   Mémoire interne (64 patches de 448 octets)  : 02 00 00 ..
   ===================================================================== */
(function (global) {
  'use strict';

  const MODEL_ID = 0x14;
  const PATCH_SIZE = 448;            // 7 blocs de 64 octets
  const BANK_BASE = 0x02 << 14;      // 02 00 00 en adresse linéaire = 32768
  const BANK_COUNT = 64;

  // Ordre des blocs dans un patch (offsets linéaires)
  const SECTIONS = {
    UP1: 0, UP2: 64, UC: 128,   // Upper : partial 1, partial 2, common
    LP1: 192, LP2: 256, LC: 320, // Lower : partial 1, partial 2, common
    PATCH: 384                   // paramètres du patch
  };

  /* ---------------- utilitaires d'affichage ---------------- */
  const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const noteName = m => NOTE[m % 12] + (Math.floor(m / 12) - 1);
  const signed = off => v => { const n = v - off; return (n > 0 ? '+' : '') + n; };
  const list = arr => v => arr[v] ?? String(v);
  const raw = v => String(v);

  const KF_PITCH = ['-1', '-1/2', '-1/4', '0', '1/8', '1/4', '3/8', '1/2', '5/8', '3/4', '7/8', '1', '5/4', '3/2', '2', 's1', 's2'];
  const KF_TVF = KF_PITCH.slice(0, 15);
  const LFO_SEL = ['+1', '-1', '+2', '-2', '+3', '-3'];
  const BIAS = v => (v < 64 ? '<' : '>') + noteName(33 + (v % 64)); // A1..C7
  const LFO_WAVE = ['TRI', 'SAW', 'SQU', 'RND'];
  const LOW_EQ_F = ['63', '75', '88', '100', '125', '150', '175', '200', '250', '300', '350', '400', '500', '600', '700', '800'].map(s => s + ' Hz');
  const HI_EQ_F = ['250', '300', '350', '400', '500', '600', '700', '800', '1k', '1.25k', '1.5k', '1.75k', '2k', '2.5k', '3k', '3.5k', '4k', '5k', '6k', '7k', '8k', '10k'].map(s => s + ' Hz');
  const HI_EQ_Q = ['0.3', '0.5', '0.7', '1.0', '1.4', '2.0', '3.0', '4.0', '9.0'];
  const CHORUS = ['Chorus 1', 'Chorus 2', 'Flanger 1', 'Flanger 2', 'Feedback Chorus', 'Tremolo', 'Chorus Tremolo', 'Dimension'];
  const REVERB = ['Small Hall', 'Medium Hall', 'Large Hall', 'Chapel', 'Box', 'Small Metal Room', 'Small Room', 'Medium Room',
    'Medium Large Room', 'Large Room', 'Single Delay 102ms', 'Cross Delay 180ms', 'Cross Delay 224ms', 'Cross Delay 148-296ms',
    'Short Gate 200ms', 'Long Gate 480ms', 'Bright Hall', 'Large Cave', 'Steel Pan', 'Delay 248ms', 'Delay 338ms',
    'Cross Delay 157ms', 'Cross Delay 252ms', 'Cross Delay 274-137ms', 'Gate Reverb', 'Reverse Gate 360ms',
    'Reverse Gate 480ms', 'Slap Back 1', 'Slap Back 2', 'Slap Back 3', 'Twisted Space', 'Space'].map((n, i) => (i + 1) + ' ' + n);
  const STRUCT = ['1 : S + S', '2 : S + Ring(S,S)', '3 : P + S', '4 : P + Ring(P,S)', '5 : S + Ring(S,P)', '6 : P + P', '7 : P + Ring(P,P)'];
  // type de chaque partial selon la structure : S = synthé, P = PCM
  const STRUCT_TYPES = [['S', 'S'], ['S', 'S'], ['P', 'S'], ['P', 'S'], ['S', 'P'], ['P', 'P'], ['P', 'P']];
  const KEYMODE = ['Whole', 'Dual', 'Split', 'Separate', 'Whole-S', 'Dual-S', 'Split-US', 'Split-LS', 'Separate-S'];
  const ULMODE = ['U-L', 'U', 'L'];

  /* ---------------- tables des paramètres ----------------
     [offset, clé, libellé, min, max, formatteur, groupe]           */
  const P = (o, k, l, max, f = raw, g = '') => ({ o, k, l, min: 0, max, f, g });

  const PARTIAL = [
    P(0, 'pitchCoarse', 'Pitch coarse', 72, v => noteName(24 + v), 'WG'),
    P(1, 'pitchFine', 'Pitch fine', 100, signed(50), 'WG'),
    P(2, 'pitchKF', 'Pitch keyfollow', 16, list(KF_PITCH), 'WG'),
    P(3, 'modLFO', 'Mod LFO', 3, list(['OFF', '(+)', '(-)', 'A&L']), 'WG'),
    P(4, 'modPENV', 'Mod P-ENV', 2, list(['OFF', '(+)', '(-)']), 'WG'),
    P(5, 'modBender', 'Mod bender', 2, list(['OFF', 'KF', 'NORMAL']), 'WG'),
    P(6, 'waveform', 'Forme (synth)', 1, list(['SQU', 'SAW']), 'WG', 'S'),
    P(7, 'pcmWave', 'Onde PCM', 99, v => '#' + (v + 1), 'WG', 'P'),
    P(8, 'pw', 'Pulse width', 100, raw, 'WG', 'S'),
    P(9, 'pwVelo', 'PW vélocité', 14, signed(7), 'WG', 'S'),
    P(10, 'pwLfoSel', 'PW LFO select', 5, list(LFO_SEL), 'WG', 'S'),
    P(11, 'pwLfoDepth', 'PW LFO depth', 100, raw, 'WG', 'S'),
    P(12, 'pwAT', 'PW aftertouch', 14, signed(7), 'WG', 'S'),

    P(13, 'cutoff', 'Cutoff', 100, raw, 'TVF', 'S'),
    P(14, 'reso', 'Résonance', 30, raw, 'TVF', 'S'),
    P(15, 'tvfKF', 'Keyfollow', 14, list(KF_TVF), 'TVF', 'S'),
    P(16, 'tvfBiasPt', 'Bias point', 127, BIAS, 'TVF', 'S'),
    P(17, 'tvfBiasLv', 'Bias level', 14, signed(7), 'TVF', 'S'),
    P(18, 'tvfEnvDepth', 'ENV depth', 100, raw, 'TVF', 'S'),
    P(19, 'tvfEnvVelo', 'ENV vélocité', 100, raw, 'TVF', 'S'),
    P(20, 'tvfEnvDKF', 'ENV depth KF', 4, raw, 'TVF', 'S'),
    P(21, 'tvfEnvTKF', 'ENV time KF', 4, raw, 'TVF', 'S'),
    P(22, 'tvfT1', 'T1', 100, raw, 'TVF-ENV', 'S'),
    P(23, 'tvfT2', 'T2', 100, raw, 'TVF-ENV', 'S'),
    P(24, 'tvfT3', 'T3', 100, raw, 'TVF-ENV', 'S'),
    P(25, 'tvfT4', 'T4', 100, raw, 'TVF-ENV', 'S'),
    P(26, 'tvfT5', 'T5', 100, raw, 'TVF-ENV', 'S'),
    P(27, 'tvfL1', 'L1', 100, raw, 'TVF-ENV', 'S'),
    P(28, 'tvfL2', 'L2', 100, raw, 'TVF-ENV', 'S'),
    P(29, 'tvfL3', 'L3', 100, raw, 'TVF-ENV', 'S'),
    P(30, 'tvfSus', 'Sustain', 100, raw, 'TVF-ENV', 'S'),
    P(31, 'tvfEnd', 'End', 1, list(['0', '100']), 'TVF-ENV', 'S'),
    P(32, 'tvfLfoSel', 'LFO select', 5, list(LFO_SEL), 'TVF', 'S'),
    P(33, 'tvfLfoDepth', 'LFO depth', 100, raw, 'TVF', 'S'),
    P(34, 'tvfAT', 'Aftertouch', 14, signed(7), 'TVF', 'S'),

    P(35, 'tvaLevel', 'Niveau', 100, raw, 'TVA'),
    P(36, 'tvaVelo', 'Vélocité', 100, signed(50), 'TVA'),
    P(37, 'tvaBiasPt', 'Bias point', 127, BIAS, 'TVA'),
    P(38, 'tvaBiasLv', 'Bias level', 12, signed(12), 'TVA'),
    P(39, 'tvaT1', 'T1', 100, raw, 'TVA-ENV'),
    P(40, 'tvaT2', 'T2', 100, raw, 'TVA-ENV'),
    P(41, 'tvaT3', 'T3', 100, raw, 'TVA-ENV'),
    P(42, 'tvaT4', 'T4', 100, raw, 'TVA-ENV'),
    P(43, 'tvaT5', 'T5', 100, raw, 'TVA-ENV'),
    P(44, 'tvaL1', 'L1', 100, raw, 'TVA-ENV'),
    P(45, 'tvaL2', 'L2', 100, raw, 'TVA-ENV'),
    P(46, 'tvaL3', 'L3', 100, raw, 'TVA-ENV'),
    P(47, 'tvaSus', 'Sustain', 100, raw, 'TVA-ENV'),
    P(48, 'tvaEnd', 'End', 1, list(['0', '100']), 'TVA-ENV'),
    P(49, 'tvaVeloT1', 'Vélo → T1', 4, raw, 'TVA'),
    P(50, 'tvaTKF', 'Time KF', 4, raw, 'TVA'),
    P(51, 'tvaLfoSel', 'LFO select', 5, list(LFO_SEL), 'TVA'),
    P(52, 'tvaLfoDepth', 'LFO depth', 100, raw, 'TVA'),
    P(53, 'tvaAT', 'Aftertouch', 14, signed(7), 'TVA'),
  ];
  // p.only : 'S' = paramètre propre aux partials synthé (WG synth + TVF),
  //          'P' = propre aux partials PCM (les PCM n'ont pas de TVF)
  (function fixTypes() {
    const types = { 6: 'S', 7: 'P', 8: 'S', 9: 'S', 10: 'S', 11: 'S', 12: 'S' };
    PARTIAL.forEach(p => { p.only = types[p.o] || (p.g.startsWith('TVF') ? 'S' : null); });
  })();

  const COMMON = [
    // 0-9 : nom de tone (10 caractères)
    P(10, 'penvVelo', 'Vélocité', 2, raw, 'P-ENV'),
    P(11, 'penvTKF', 'Time KF', 4, raw, 'P-ENV'),
    P(12, 'penvT1', 'T1', 50, raw, 'P-ENV-G'),
    P(13, 'penvT2', 'T2', 50, raw, 'P-ENV-G'),
    P(14, 'penvT3', 'T3', 50, raw, 'P-ENV-G'),
    P(15, 'penvT4', 'T4', 50, raw, 'P-ENV-G'),
    P(16, 'penvL0', 'L0', 100, signed(50), 'P-ENV-G'),
    P(17, 'penvL1', 'L1', 100, signed(50), 'P-ENV-G'),
    P(18, 'penvL2', 'L2', 100, signed(50), 'P-ENV-G'),
    P(19, 'penvSus', 'Sustain', 100, signed(50), 'P-ENV-G'),
    P(20, 'penvEnd', 'End', 100, signed(50), 'P-ENV-G'),
    P(21, 'pmLfo', 'Pitch mod LFO', 100, raw, 'Modulation'),
    P(22, 'pmLever', 'Pitch mod levier', 100, raw, 'Modulation'),
    P(23, 'pmAT', 'Pitch mod aftertouch', 100, raw, 'Modulation'),
    P(24, 'lfo1Wave', 'LFO1 forme', 3, list(LFO_WAVE), 'LFO'),
    P(25, 'lfo1Rate', 'LFO1 vitesse', 100, raw, 'LFO'),
    P(26, 'lfo1Delay', 'LFO1 délai', 100, raw, 'LFO'),
    P(27, 'lfo1Sync', 'LFO1 sync', 2, list(['OFF', 'ON', 'KEY']), 'LFO'),
    P(28, 'lfo2Wave', 'LFO2 forme', 3, list(LFO_WAVE), 'LFO'),
    P(29, 'lfo2Rate', 'LFO2 vitesse', 100, raw, 'LFO'),
    P(30, 'lfo2Delay', 'LFO2 délai', 100, raw, 'LFO'),
    P(31, 'lfo2Sync', 'LFO2 sync', 1, list(['OFF', 'ON']), 'LFO'),
    P(32, 'lfo3Wave', 'LFO3 forme', 3, list(LFO_WAVE), 'LFO'),
    P(33, 'lfo3Rate', 'LFO3 vitesse', 100, raw, 'LFO'),
    P(34, 'lfo3Delay', 'LFO3 délai', 100, raw, 'LFO'),
    P(35, 'lfo3Sync', 'LFO3 sync', 1, list(['OFF', 'ON']), 'LFO'),
    P(36, 'loEqF', 'Low EQ fréq.', 15, list(LOW_EQ_F), 'EQ'),
    P(37, 'loEqG', 'Low EQ gain', 24, signed(12), 'EQ'),
    P(38, 'hiEqF', 'High EQ fréq.', 21, list(HI_EQ_F), 'EQ'),
    P(39, 'hiEqQ', 'High EQ Q', 8, list(HI_EQ_Q), 'EQ'),
    P(40, 'hiEqG', 'High EQ gain', 24, signed(12), 'EQ'),
    P(41, 'chType', 'Chorus type', 7, list(CHORUS), 'Chorus'),
    P(42, 'chRate', 'Chorus vitesse', 100, raw, 'Chorus'),
    P(43, 'chDepth', 'Chorus profondeur', 100, raw, 'Chorus'),
    P(44, 'chBal', 'Chorus balance', 100, raw, 'Chorus'),
    P(45, 'mute', 'Partials actifs', 3, list(['aucun', 'P1', 'P2', 'P1+P2']), 'Structure'),
    P(46, 'pBal', 'Balance P1/P2', 100, v => (100 - v) + ' / ' + v, 'Structure'),
    P(47, 'struct', 'Structure', 6, list(STRUCT), 'Structure'),
  ];

  const PATCHP = [
    // 0-17 : nom du patch (18 caractères)
    P(18, 'keyMode', 'Key mode', 8, list(KEYMODE), 'Clavier'),
    P(19, 'split', 'Point de split', 60, v => noteName(36 + v), 'Clavier'),
    P(20, 'portaMode', 'Mode portamento', 2, list(ULMODE), 'Clavier'),
    P(21, 'holdMode', 'Mode hold', 2, list(ULMODE), 'Clavier'),
    P(22, 'uShift', 'Upper transpo', 48, signed(24), 'Accord'),
    P(23, 'lShift', 'Lower transpo', 48, signed(24), 'Accord'),
    P(24, 'uFine', 'Upper fine', 100, signed(50), 'Accord'),
    P(25, 'lFine', 'Lower fine', 100, signed(50), 'Accord'),
    P(26, 'bendRange', 'Bender range', 12, raw, 'Contrôle'),
    P(27, 'atBend', 'Aftertouch bend', 24, signed(12), 'Contrôle'),
    P(28, 'portaTime', 'Portamento time', 100, raw, 'Contrôle'),
    P(29, 'outMode', 'Output mode', 3, v => String(v + 1), 'Effets'),
    P(30, 'revType', 'Reverb type', 31, list(REVERB), 'Effets'),
    P(31, 'revBal', 'Reverb balance', 100, raw, 'Effets'),
    P(32, 'volume', 'Volume total', 100, raw, 'Mix'),
    P(33, 'toneBal', 'Balance Lower/Upper', 100, v => (100 - v) + ' / ' + v, 'Mix'),
    P(34, 'chaseMode', 'Chase mode', 2, list(['U-L', 'U-L-L', 'U-U']), 'Chase'),
    P(35, 'chaseLevel', 'Chase level', 100, raw, 'Chase'),
    P(36, 'chaseTime', 'Chase time', 100, raw, 'Chase'),
    P(37, 'txCh', 'MIDI Tx canal', 16, v => (v === 0 ? 'Basic' : String(v)), 'MIDI'),
    P(38, 'sepCh', 'Canal Rx séparé', 16, v => (v === 0 ? 'OFF' : String(v)), 'MIDI'),
    P(39, 'txPC', 'Tx Program change', 100, v => (v === 0 ? 'OFF' : String(v)), 'MIDI'),
  ];

  /* ---------------- jeu de caractères D-50 ---------------- */
  const CHARSET = ' ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz1234567890-';
  const decodeName = (bytes) => Array.from(bytes, b => CHARSET[b] ?? ' ').join('');
  const encodeName = (str, len) => {
    const out = new Array(len).fill(0);
    for (let i = 0; i < len; i++) {
      const c = str[i] ?? ' ';
      const idx = CHARSET.indexOf(c);
      out[i] = idx < 0 ? 0 : idx;
    }
    return out;
  };

  /* ---------------- objet Patch ---------------- */
  class Patch {
    constructor(bytes) {
      this.data = new Uint8Array(PATCH_SIZE);
      if (bytes) this.data.set(bytes.slice(0, PATCH_SIZE));
    }
    clone() { return new Patch(this.data); }
    get(base, off) { return this.data[base + off]; }
    set(base, off, v) { this.data[base + off] = v & 0x7f; }
    get name() { return decodeName(this.data.slice(SECTIONS.PATCH, SECTIONS.PATCH + 18)).trimEnd(); }
    set name(s) { this.data.set(encodeName(s, 18), SECTIONS.PATCH); }
    toneName(cBase) { return decodeName(this.data.slice(cBase, cBase + 10)).trimEnd(); }
    setToneName(cBase, s) { this.data.set(encodeName(s, 10), cBase); }
  }

  /* ---------------- SysEx Roland ---------------- */
  const addr3 = n => [(n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
  const addrLin = (a, b, c) => (a << 14) | (b << 7) | c;
  const checksum = arr => (128 - (arr.reduce((s, x) => s + x, 0) % 128)) % 128;

  function dt1(dev, linAddr, data) {
    const body = [...addr3(linAddr), ...data];
    return [0xF0, 0x41, dev & 0x0f, MODEL_ID, 0x12, ...body, checksum(body), 0xF7];
  }
  function rq1(dev, linAddr, size) {
    const body = [...addr3(linAddr), ...addr3(size)];
    return [0xF0, 0x41, dev & 0x0f, MODEL_ID, 0x11, ...body, checksum(body), 0xF7];
  }

  /** Découpe un flux d'octets en messages SysEx (F0..F7) */
  function splitSysex(bytes) {
    const msgs = []; let cur = null;
    for (const b of bytes) {
      if (b === 0xF0) cur = [b];
      else if (cur) { cur.push(b); if (b === 0xF7) { msgs.push(cur); cur = null; } }
    }
    return msgs;
  }

  /** Analyse un message DT1 D-50 → {addr, data} ou null */
  function parseDT1(msg) {
    if (msg.length < 10 || msg[0] !== 0xF0 || msg[1] !== 0x41 || msg[3] !== MODEL_ID) return null;
    if (msg[4] !== 0x12 && msg[4] !== 0x42) return null; // DT1 ou DAT (handshake)
    const body = msg.slice(5, msg.length - 2);
    const sum = msg[msg.length - 2];
    const ok = checksum(body) === sum;
    return { addr: addrLin(body[0], body[1], body[2]), data: body.slice(3), ok, dev: msg[2] };
  }

  /** Mémoire éparse reconstituée à partir de messages DT1 */
  function memoryFromSysex(bytes) {
    const mem = new Map(); let bad = 0, count = 0;
    for (const m of splitSysex(bytes)) {
      const p = parseDT1(m); if (!p) continue;
      count++; if (!p.ok) bad++;
      p.data.forEach((v, i) => mem.set(p.addr + i, v));
    }
    return { mem, count, bad };
  }

  /** Extrait patch temporaire et/ou banque d'un fichier .syx */
  function importSyx(bytes) {
    const { mem, count, bad } = memoryFromSysex(bytes);
    const read = (base) => {
      for (let i = 0; i < PATCH_SIZE; i++) if (!mem.has(base + i)) return null;
      return new Patch(Array.from({ length: PATCH_SIZE }, (_, i) => mem.get(base + i)));
    };
    const temp = read(0);
    const bank = [];
    for (let i = 0; i < BANK_COUNT; i++) bank.push(read(BANK_BASE + i * PATCH_SIZE));
    // données supplémentaires (reverb data, etc.) conservées telles quelles
    const extra = new Map();
    const end = BANK_BASE + BANK_COUNT * PATCH_SIZE;
    mem.forEach((v, a) => { if (a >= end) extra.set(a, v); });
    return { temp, bank, extra, count, bad };
  }

  /** Génère des messages DT1 (blocs ≤ 256 octets) pour une zone continue */
  function dumpRegion(dev, linAddr, data, chunk = 256) {
    const out = [];
    for (let i = 0; i < data.length; i += chunk) out.push(dt1(dev, linAddr + i, Array.from(data.slice(i, i + chunk))));
    return out;
  }

  /** Messages pour envoyer un patch dans la zone temporaire (7 × 64 octets) */
  function patchToTemp(dev, patch) { return dumpRegion(dev, 0, patch.data, 64); }
  /** Messages pour écrire un patch dans une case mémoire (0..63) */
  function patchToMemory(dev, patch, slot) { return dumpRegion(dev, BANK_BASE + slot * PATCH_SIZE, patch.data, 64); }

  function exportBankSyx(dev, bank, extra) {
    const data = new Uint8Array(BANK_COUNT * PATCH_SIZE);
    bank.forEach((p, i) => data.set((p || initPatch()).data, i * PATCH_SIZE));
    const msgs = dumpRegion(dev, BANK_BASE, data, 256);
    if (extra && extra.size) {
      const addrs = [...extra.keys()].sort((a, b) => a - b);
      let start = addrs[0], buf = [];
      const flush = () => { if (buf.length) msgs.push(...dumpRegion(dev, start, buf, 256)); };
      addrs.forEach((a, i) => {
        if (i && a !== addrs[i - 1] + 1) { flush(); start = a; buf = []; }
        buf.push(extra.get(a));
      });
      flush();
    }
    return msgs;
  }

  /* ---------------- patch d'initialisation ---------------- */
  function initPartial(p, base, pcm) {
    const s = (k, v) => p.set(base, PARTIAL.find(x => x.k === k).o, v);
    s('pitchCoarse', 36); s('pitchFine', 50); s('pitchKF', 11); s('modLFO', 1); s('modPENV', 1); s('modBender', 2);
    s('waveform', 1); s('pcmWave', pcm ? 0 : 0); s('pw', 0); s('pwVelo', 7); s('pwLfoSel', 0); s('pwLfoDepth', 0); s('pwAT', 7);
    s('cutoff', 60); s('reso', 0); s('tvfKF', 7); s('tvfBiasPt', 64); s('tvfBiasLv', 7); s('tvfEnvDepth', 40); s('tvfEnvVelo', 30);
    s('tvfEnvDKF', 0); s('tvfEnvTKF', 0);
    ['tvfT1', 'tvfT2', 'tvfT3', 'tvfT4', 'tvfT5'].forEach((k, i) => s(k, [10, 30, 40, 30, 30][i]));
    s('tvfL1', 100); s('tvfL2', 70); s('tvfL3', 60); s('tvfSus', 50); s('tvfEnd', 0);
    s('tvfLfoSel', 0); s('tvfLfoDepth', 0); s('tvfAT', 7);
    s('tvaLevel', 100); s('tvaVelo', 60); s('tvaBiasPt', 64); s('tvaBiasLv', 12);
    ['tvaT1', 'tvaT2', 'tvaT3', 'tvaT4', 'tvaT5'].forEach((k, i) => s(k, [0, 20, 30, 30, 35][i]));
    s('tvaL1', 100); s('tvaL2', 90); s('tvaL3', 85); s('tvaSus', 80); s('tvaEnd', 0);
    s('tvaVeloT1', 0); s('tvaTKF', 0); s('tvaLfoSel', 0); s('tvaLfoDepth', 0); s('tvaAT', 7);
  }
  function initCommon(p, base, name) {
    p.setToneName(base, name);
    const s = (k, v) => p.set(base, COMMON.find(x => x.k === k).o, v);
    s('penvVelo', 0); s('penvTKF', 0);
    ['penvT1', 'penvT2', 'penvT3', 'penvT4'].forEach(k => s(k, 0));
    ['penvL0', 'penvL1', 'penvL2', 'penvSus', 'penvEnd'].forEach(k => s(k, 50));
    s('pmLfo', 0); s('pmLever', 30); s('pmAT', 0);
    s('lfo1Wave', 0); s('lfo1Rate', 60); s('lfo1Delay', 30); s('lfo1Sync', 0);
    s('lfo2Wave', 0); s('lfo2Rate', 40); s('lfo2Delay', 0); s('lfo2Sync', 0);
    s('lfo3Wave', 0); s('lfo3Rate', 20); s('lfo3Delay', 0); s('lfo3Sync', 0);
    s('loEqF', 4); s('loEqG', 12); s('hiEqF', 12); s('hiEqQ', 3); s('hiEqG', 12);
    s('chType', 0); s('chRate', 30); s('chDepth', 40); s('chBal', 50);
    s('mute', 3); s('pBal', 50); s('struct', 0);
  }
  function initPatch() {
    const p = new Patch();
    initPartial(p, SECTIONS.UP1); initPartial(p, SECTIONS.UP2);
    initPartial(p, SECTIONS.LP1); initPartial(p, SECTIONS.LP2);
    initCommon(p, SECTIONS.UC, 'Upper'); initCommon(p, SECTIONS.LC, 'Lower');
    p.name = 'Init Patch';
    const s = (k, v) => p.set(SECTIONS.PATCH, PATCHP.find(x => x.k === k).o, v);
    s('keyMode', 0); s('split', 24); s('portaMode', 0); s('holdMode', 0);
    s('uShift', 24); s('lShift', 24); s('uFine', 50); s('lFine', 50);
    s('bendRange', 2); s('atBend', 12); s('portaTime', 0); s('outMode', 0);
    s('revType', 1); s('revBal', 30); s('volume', 80); s('toneBal', 50);
    s('chaseMode', 0); s('chaseLevel', 50); s('chaseTime', 50);
    s('txCh', 0); s('sepCh', 0); s('txPC', 0);
    return p;
  }

  /* ---------------- générateur de sons ---------------- */
  const rnd = (a, b) => Math.round(a + Math.random() * (b - a));
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  // Chaque recette définit des plages [min,max] ; null = valeur d'init conservée
  const RECIPES = {
    'Pad': {
      struct: [0, 2, 5], keyMode: [1], chorus: [0, 1, 7], reverb: [0, 2, 16, 31],
      tva: { T1: [40, 75], T2: [30, 60], T3: [30, 60], T4: [40, 70], T5: [50, 80], L1: [80, 100], L2: [80, 100], L3: [80, 100], Sus: [80, 100] },
      tvf: { cutoff: [30, 65], reso: [0, 12], depth: [20, 60], T1: [40, 80], T2: [30, 70], L1: [60, 100], Sus: [30, 70] },
      detune: [3, 8], lfoDepth: [0, 15], pcm: [30, 99]
    },
    'Strings': {
      struct: [0, 2], keyMode: [1, 0], chorus: [0, 1, 7], reverb: [1, 2, 3],
      tva: { T1: [25, 50], T2: [20, 40], T3: [20, 40], T4: [30, 50], T5: [35, 55], L1: [90, 100], L2: [90, 100], L3: [90, 100], Sus: [90, 100] },
      tvf: { cutoff: [40, 70], reso: [0, 6], depth: [10, 40], T1: [25, 50], T2: [30, 60], L1: [70, 100], Sus: [50, 80] },
      detune: [4, 9], lfoDepth: [5, 25], pcm: [20, 60], saw: true
    },
    'Brass': {
      struct: [0, 2], keyMode: [0, 1], chorus: [0, 1], reverb: [0, 1, 6, 7],
      tva: { T1: [5, 20], T2: [20, 40], T3: [20, 40], T4: [20, 40], T5: [20, 35], L1: [95, 100], L2: [85, 100], L3: [80, 95], Sus: [80, 95] },
      tvf: { cutoff: [25, 50], reso: [0, 8], depth: [50, 80], T1: [10, 30], T2: [20, 50], L1: [90, 100], Sus: [40, 70] },
      detune: [2, 5], lfoDepth: [0, 8], pcm: [0, 40], saw: true
    },
    'Basse': {
      struct: [0, 2, 5], keyMode: [0], chorus: [1, 2], reverb: [4, 6],
      tva: { T1: [0, 3], T2: [20, 45], T3: [30, 50], T4: [30, 50], T5: [10, 25], L1: [100, 100], L2: [70, 90], L3: [60, 80], Sus: [55, 80] },
      tvf: { cutoff: [15, 40], reso: [5, 22], depth: [40, 80], T1: [0, 5], T2: [20, 45], L1: [90, 100], Sus: [10, 40] },
      detune: [0, 3], lfoDepth: [0, 0], pcm: [0, 30], octave: -12
    },
    'Lead': {
      struct: [0, 1], keyMode: [0, 4], chorus: [2, 3, 4], reverb: [10, 11, 12, 19],
      tva: { T1: [0, 10], T2: [20, 40], T3: [20, 40], T4: [20, 40], T5: [20, 35], L1: [100, 100], L2: [90, 100], L3: [85, 100], Sus: [85, 100] },
      tvf: { cutoff: [35, 70], reso: [8, 25], depth: [30, 70], T1: [0, 20], T2: [20, 50], L1: [80, 100], Sus: [40, 80] },
      detune: [1, 6], lfoDepth: [5, 20], pcm: [0, 50], porta: [10, 35]
    },
    'Cloche': {
      struct: [1, 3, 4, 6], keyMode: [1], chorus: [0, 7], reverb: [2, 3, 16],
      tva: { T1: [0, 2], T2: [40, 70], T3: [50, 80], T4: [60, 90], T5: [50, 75], L1: [100, 100], L2: [50, 80], L3: [20, 50], Sus: [0, 10] },
      tvf: { cutoff: [55, 90], reso: [0, 10], depth: [20, 50], T1: [0, 5], T2: [40, 80], L1: [100, 100], Sus: [10, 40] },
      detune: [0, 4], lfoDepth: [0, 5], pcm: [40, 99], ringPitch: true
    },
    'Texture / FX': {
      struct: [0, 1, 2, 3, 4, 5, 6], keyMode: [1, 0], chorus: [0, 1, 2, 3, 4, 5, 6, 7], reverb: [17, 18, 25, 26, 30, 31],
      tva: { T1: [20, 90], T2: [20, 90], T3: [20, 90], T4: [20, 90], T5: [40, 95], L1: [50, 100], L2: [30, 100], L3: [30, 100], Sus: [40, 100] },
      tvf: { cutoff: [20, 90], reso: [0, 30], depth: [0, 100], T1: [10, 90], T2: [10, 90], L1: [0, 100], Sus: [0, 100] },
      detune: [0, 20], lfoDepth: [10, 60], pcm: [0, 99], penv: true
    },
  };

  function applyRecipe(p, recipeName, wildness = 0.3) {
    const R = RECIPES[recipeName];
    const r = ([a, b]) => {
      const w = Math.round((b - a + 20) * wildness * (Math.random() - 0.5));
      return Math.max(0, Math.min(100, rnd(a, b) + w));
    };
    const setBy = (table, base, k, v) => {
      const d = table.find(x => x.k === k);
      p.set(base, d.o, Math.max(d.min, Math.min(d.max, v)));
    };
    const tones = [[SECTIONS.UC, SECTIONS.UP1, SECTIONS.UP2], [SECTIONS.LC, SECTIONS.LP1, SECTIONS.LP2]];
    tones.forEach(([c, p1, p2], ti) => {
      const st = pick(R.struct);
      setBy(COMMON, c, 'struct', st); setBy(COMMON, c, 'mute', 3); setBy(COMMON, c, 'pBal', rnd(35, 65));
      setBy(COMMON, c, 'chType', pick(R.chorus)); setBy(COMMON, c, 'chRate', rnd(10, 60));
      setBy(COMMON, c, 'chDepth', rnd(20, 70)); setBy(COMMON, c, 'chBal', rnd(30, 70));
      setBy(COMMON, c, 'lfo1Rate', rnd(40, 75)); setBy(COMMON, c, 'lfo1Delay', rnd(10, 60));
      setBy(COMMON, c, 'pmLfo', rnd(...R.lfoDepth.map(x => x / 4)));
      if (R.penv) {
        ['penvT1', 'penvT2', 'penvT3', 'penvT4'].forEach(k => setBy(COMMON, c, k, rnd(5, 50)));
        ['penvL0', 'penvL1', 'penvL2'].forEach(k => setBy(COMMON, c, k, rnd(30, 70)));
        setBy(COMMON, c, 'penvSus', 50); setBy(COMMON, c, 'penvEnd', 50);
      }
      [p1, p2].forEach((pb, pi) => {
        const type = STRUCT_TYPES[st][pi];
        const oct = 36 + (R.octave || 0) + (ti === 1 && R.keyMode.includes(1) && Math.random() < 0.3 ? 12 : 0);
        let coarse = oct;
        if (R.ringPitch && pi === 1) coarse = oct + pick([7, 12, 19, 24, 5]);
        setBy(PARTIAL, pb, 'pitchCoarse', coarse);
        const det = rnd(...R.detune);
        setBy(PARTIAL, pb, 'pitchFine', 50 + (pi === 0 ? -det : det) + (ti ? 1 : 0));
        setBy(PARTIAL, pb, 'waveform', R.saw ? 1 : rnd(0, 1));
        setBy(PARTIAL, pb, 'pw', R.saw ? rnd(0, 20) : rnd(0, 70));
        setBy(PARTIAL, pb, 'pwLfoDepth', rnd(0, 40));
        setBy(PARTIAL, pb, 'pcmWave', rnd(...R.pcm));
        setBy(PARTIAL, pb, 'cutoff', r(R.tvf.cutoff));
        setBy(PARTIAL, pb, 'reso', Math.min(30, r(R.tvf.reso)));
        setBy(PARTIAL, pb, 'tvfEnvDepth', r(R.tvf.depth));
        setBy(PARTIAL, pb, 'tvfT1', r(R.tvf.T1)); setBy(PARTIAL, pb, 'tvfT2', r(R.tvf.T2));
        setBy(PARTIAL, pb, 'tvfL1', r(R.tvf.L1)); setBy(PARTIAL, pb, 'tvfSus', r(R.tvf.Sus));
        setBy(PARTIAL, pb, 'tvfLfoDepth', rnd(0, R.lfoDepth[1]));
        ['T1', 'T2', 'T3', 'T4', 'T5', 'L1', 'L2', 'L3', 'Sus'].forEach(k => setBy(PARTIAL, pb, 'tva' + k, r(R.tva[k])));
        setBy(PARTIAL, pb, 'tvaLevel', type === 'P' ? rnd(70, 95) : rnd(85, 100));
        setBy(PARTIAL, pb, 'tvaVelo', rnd(55, 75));
      });
    });
    setBy(PATCHP, SECTIONS.PATCH, 'keyMode', pick(R.keyMode));
    setBy(PATCHP, SECTIONS.PATCH, 'revType', pick(R.reverb));
    setBy(PATCHP, SECTIONS.PATCH, 'revBal', rnd(20, 60));
    setBy(PATCHP, SECTIONS.PATCH, 'portaTime', R.porta ? rnd(...R.porta) : 0);
    setBy(PATCHP, SECTIONS.PATCH, 'uFine', 50 + rnd(0, 3));
    setBy(PATCHP, SECTIONS.PATCH, 'lFine', 50 - rnd(0, 3));
    p.name = (recipeName.split(' ')[0] + ' ' + Math.floor(Math.random() * 900 + 100)).slice(0, 18);
    p.setToneName(SECTIONS.UC, recipeName.slice(0, 5) + ' U');
    p.setToneName(SECTIONS.LC, recipeName.slice(0, 5) + ' L');
    return p;
  }

  /** Mélange de deux patches : chaque octet pris dans A ou B, ou interpolé */
  function morph(a, b, t) {
    const out = a.clone();
    const tables = [[PARTIAL, [0, 64, 192, 256]], [COMMON, [128, 320]], [PATCHP, [384]]];
    tables.forEach(([tab, bases]) => bases.forEach(base => tab.forEach(d => {
      const va = a.get(base, d.o), vb = b.get(base, d.o);
      const continuous = d.max >= 20 && d.f === raw;
      out.set(base, d.o, continuous ? Math.round(va + (vb - va) * t) : (t < 0.5 ? va : vb));
    })));
    out.name = (t < 0.5 ? a.name : b.name).slice(0, 14) + ' mx';
    return out;
  }

  global.D50 = {
    MODEL_ID, PATCH_SIZE, BANK_BASE, BANK_COUNT, SECTIONS, PARTIAL, COMMON, PATCHP,
    STRUCT_TYPES, RECIPES, Patch, dt1, rq1, splitSysex, parseDT1, importSyx,
    patchToTemp, patchToMemory, exportBankSyx, dumpRegion, initPatch, applyRecipe, morph, noteName
  };
})(window);
