/* =====================================================================
   D-50 Editor — interface (Windows / Android, navigateurs Chromium)
   ===================================================================== */
(function () {
  'use strict';
  const { SECTIONS: S, PARTIAL, COMMON, PATCHP } = D50;
  const $ = id => document.getElementById(id);
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null) e.setAttribute(k, v);
    }
    kids.flat().forEach(k => e.append(k instanceof Node ? k : document.createTextNode(k)));
    return e;
  };

  /* ---------------- stockage local (facultatif) ---------------- */
  const store = {
    get(k, def) { try { const v = localStorage.getItem('d50.' + k); return v == null ? def : JSON.parse(v); } catch { return def; } },
    set(k, v) { try { localStorage.setItem('d50.' + k, JSON.stringify(v)); } catch { /* stockage indisponible */ } }
  };
  const b64 = u8 => btoa(String.fromCharCode(...u8));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  /* ---------------- état ---------------- */
  const cfg = Object.assign({ out: '', inp: '', dev: 0, ch: 0, auto: true, octave: 4, kbd: true }, store.get('cfg', {}));
  let patch = D50.initPatch();
  try { const e = store.get('edit'); if (e) patch = new D50.Patch(unb64(e)); } catch { }
  let bank = new Array(64).fill(null);
  try { const b = store.get('bank'); if (b) bank = b.map(x => (x ? new D50.Patch(unb64(x)) : null)); } catch { }
  let extra = new Map();
  let selSlot = 0, morphA = 0, morphB = 1;
  const undo = [], redo = [];
  const subtab = { upper: 'common', lower: 'common' };
  const controls = []; // {base, def, input, val, row}
  const envGraphs = []; // {base, kind, svg}
  const structDiags = []; // {base, pre}
  const groupsByType = []; // {group, tone, pi, only}

  const saveEdit = debounce(() => store.set('edit', b64(patch.data)), 400);
  const saveBank = () => store.set('bank', bank.map(p => (p ? b64(p.data) : null)));
  const saveCfg = () => store.set('cfg', cfg);

  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  function toast(msg, err) {
    const t = $('toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.className = 'toast', 2600);
  }

  /* ---------------- MIDI ---------------- */
  let access = null, out = null, inp = null;
  const hex = a => Array.from(a, b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  const logLines = [];
  function log(dir, data) {
    const s = `${new Date().toLocaleTimeString()} ${dir} ${data.length > 40 ? hex(data.slice(0, 24)) + ` … (${data.length} oct.)` : hex(data)}`;
    logLines.push(s); if (logLines.length > 400) logLines.shift();
    const L = $('log'); if (!L.closest('[hidden]')) { L.textContent = logLines.join('\n'); L.scrollTop = L.scrollHeight; }
  }

  async function connectMidi() {
    if (!navigator.requestMIDIAccess) {
      setStatus('Web MIDI non supporté — utilisez Chrome ou Edge'); toast('Web MIDI indisponible dans ce navigateur', true); return;
    }
    try {
      access = await navigator.requestMIDIAccess({ sysex: true });
      access.onstatechange = fillPorts;
      fillPorts();
    } catch (e) {
      setStatus('MIDI refusé'); toast('Accès MIDI (SysEx) refusé : ' + e.message, true);
    }
  }
  function fillPorts() {
    const fill = (sel, ports, cur) => {
      sel.innerHTML = '';
      sel.append(el('option', { value: '' }, '— aucun —'));
      ports.forEach(p => sel.append(el('option', { value: p.id }, p.name)));
      sel.value = ports.some(p => p.id === cur) ? cur : (ports[0] ? ports[0].id : '');
    };
    const outs = [...access.outputs.values()], ins = [...access.inputs.values()];
    fill($('selOut'), outs, cfg.out); fill($('selIn'), ins, cfg.inp);
    bindPorts();
  }
  function bindPorts() {
    if (!access) return;
    cfg.out = $('selOut').value; cfg.inp = $('selIn').value; saveCfg();
    out = cfg.out ? access.outputs.get(cfg.out) : null;
    if (inp) inp.onmidimessage = null;
    inp = cfg.inp ? access.inputs.get(cfg.inp) : null;
    if (inp) inp.onmidimessage = onMidi;
    setStatus(out ? 'MIDI : ' + out.name : 'MIDI : aucune sortie', !!out);
  }
  function setStatus(t, ok) { const s = $('midiStatus'); s.textContent = t; s.classList.toggle('ok', !!ok); }

  function sendRaw(msg) {
    if (!out) return false;
    try { out.send(msg); log('→', msg); return true; } catch (e) { toast('Erreur d\'envoi MIDI : ' + e.message, true); return false; }
  }
  // file d'attente pour les gros envois (espacement entre messages SysEx)
  const queue = []; let qBusy = false;
  function enqueue(msgs, gap = 40) {
    if (!out) { toast('Aucune sortie MIDI sélectionnée', true); return; }
    msgs.forEach(m => queue.push({ m, gap }));
    if (!qBusy) pump();
  }
  function pump() {
    const it = queue.shift(); if (!it) { qBusy = false; return; }
    qBusy = true; sendRaw(it.m); setTimeout(pump, it.gap);
  }
  // envoi temps réel de paramètres : regroupement par adresse
  const pending = new Map(); let pTimer = null;
  function sendParam(addr, bytes) {
    if (!cfg.auto || !out) return;
    pending.set(addr, bytes);
    if (!pTimer) pTimer = setTimeout(() => {
      pTimer = null;
      pending.forEach((b, a) => sendRaw(D50.dt1(cfg.dev, a, b)));
      pending.clear();
    }, 25);
  }
  const sendPatch = () => enqueue(D50.patchToTemp(cfg.dev, patch), 30);

  // réception SysEx : accumulation puis analyse après une pause
  let rx = [], rxTimer = null, awaitingReq = false;
  function onMidi(ev) {
    const d = ev.data;
    if (d[0] === 0xFE || d[0] === 0xF8) return; // active sensing / clock
    log('←', d);
    if (d[0] === 0xF0 || rx.length) {
      rx.push(...d);
      clearTimeout(rxTimer); rxTimer = setTimeout(processRx, 450);
    }
  }
  function processRx() {
    const bytes = rx; rx = [];
    const res = D50.importSyx(bytes);
    if (!res.count) return;
    awaitingReq = false;
    applyImport(res, 'reçu du D-50');
  }
  function applyImport(res, src) {
    const n = res.bank.filter(Boolean).length;
    if (res.bad) toast(`${res.bad} message(s) avec checksum incorrect`, true);
    if (n) {
      res.bank.forEach((p, i) => { if (p) bank[i] = p; });
      if (res.extra.size) extra = res.extra;
      saveBank(); renderBank();
      toast(`${n} patch(es) ${src} → bibliothèque`);
      if (!res.temp) showTab('library');
    }
    if (res.temp) { pushUndo(); patch = res.temp; refresh(); toast(`Patch « ${patch.name} » ${src}`); }
    if (!n && !res.temp) toast('Aucun patch D-50 complet trouvé', true);
  }

  /* ---------------- annuler / rétablir ---------------- */
  let gesture = false;
  function pushUndo() { undo.push(patch.data.slice()); if (undo.length > 100) undo.shift(); redo.length = 0; }
  function snapOnce() { if (!gesture) { pushUndo(); gesture = true; setTimeout(() => gesture = false, 700); } }
  function doUndo(from, to) {
    if (!from.length) return;
    to.push(patch.data.slice()); patch = new D50.Patch(from.pop()); refresh();
    if (cfg.auto) sendPatch();
  }

  /* ---------------- construction des contrôles ---------------- */
  const SELECT_KEYS = new Set(['revType', 'struct', 'chType', 'keyMode', 'pitchKF', 'tvfKF', 'hiEqF', 'loEqF', 'hiEqQ', 'tvfLfoSel', 'tvaLfoSel', 'pwLfoSel']);
  function makeParam(base, def) {
    const id = `p${base}_${def.o}`;
    const label = el('label', { for: id, title: def.l }, def.l);
    const val = el('span', { class: 'val' });
    let input;
    const useSelect = def.max <= 4 || SELECT_KEYS.has(def.k);
    if (useSelect) {
      input = el('select', { id });
      for (let v = def.min; v <= def.max; v++) input.append(el('option', { value: v }, def.f(v)));
    } else {
      input = el('input', { id, type: 'range', min: def.min, max: def.max, step: 1 });
    }
    input.addEventListener('input', () => {
      snapOnce();
      const v = +input.value;
      patch.set(base, def.o, v);
      val.textContent = useSelect ? '' : def.f(v);
      sendParam(base + def.o, [v]);
      afterChange(base, def);
    });
    // double-clic / double-tap : valeur par défaut d'init
    input.addEventListener('dblclick', () => {
      const v = D50.initPatch().get(base, def.o);
      input.value = v; input.dispatchEvent(new Event('input'));
    });
    const row = el('div', { class: 'param' }, label, input, useSelect ? '' : val);
    controls.push({ base, def, input, val, row, useSelect });
    return row;
  }
  function afterChange(base, def) {
    if (/ENV/.test(def.g)) updateEnvs();
    if (def.k === 'struct') { updateStruct(); updateTypes(); }
    saveEdit();
  }

  function buildGroups(container, table, base, order, extraFor = {}) {
    const grid = el('div', { class: 'grid' });
    const groups = {};
    order.forEach(g => {
      const box = el('div', { class: 'group' }, el('h3', {}, g.replace('-G', '').replace('-ENV', ' ENV')));
      if (extraFor[g]) box.append(extraFor[g]());
      groups[g] = box; grid.append(box);
    });
    table.forEach(def => (groups[def.g] || grid).append(makeParam(base, def)));
    container.append(grid);
    return groups;
  }

  function envSvg(base, kind) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'env'); svg.setAttribute('viewBox', '0 0 400 100'); svg.setAttribute('preserveAspectRatio', 'none');
    envGraphs.push({ base, kind, svg });
    return svg;
  }
  function updateEnvs() {
    envGraphs.forEach(({ base, kind, svg }) => {
      const g = (o) => patch.get(base, o);
      let pts;
      if (kind === 'penv') {
        const t = [12, 13, 14, 15].map(o => g(o) * 2 + 4), l = [16, 17, 18, 19, 20].map(o => g(o));
        pts = [[0, l[0]], [t[0], l[1]], [t[1], l[2]], [t[2], l[3]], [60, l[3]], [t[3], l[4]]];
      } else {
        const o0 = kind === 'tva' ? 39 : 22;
        const t = [0, 1, 2, 3, 4].map(i => g(o0 + i) + 3);
        const l = [5, 6, 7, 8].map(i => g(o0 + i)), end = g(o0 + 9) ? 100 : 0;
        pts = [[0, 0], [t[0], l[0]], [t[1], l[1]], [t[2], l[2]], [t[3], l[3]], [60, l[3]], [t[4], end]];
      }
      let x = 0; const abs = pts.map(([dt, lv]) => [(x += dt), lv]);
      const sx = 400 / Math.max(abs[abs.length - 1][0], 1);
      const P = abs.map(([px, lv]) => `${(px * sx).toFixed(1)},${(98 - lv * 0.96).toFixed(1)}`).join(' ');
      const mid = kind === 'penv' ? '<line x1="0" y1="50" x2="400" y2="50"/>' : '';
      svg.innerHTML = `${mid}<polygon class="fill" points="0,98 ${P} 400,98"/><polyline points="${P}"/>`;
    });
  }

  const DIAG = [
    'P1 (S) ─┐\n         ├─ mix → sortie\nP2 (S) ─┘',
    'P1 (S) ────────────┐\n   └──┐            ├─ mix\nP2 (S)─ RING MOD ───┘',
    'P1 (PCM) ─┐\n           ├─ mix → sortie\nP2 (S) ───┘',
    'P1 (PCM) ──────────┐\n   └──┐            ├─ mix\nP2 (S)─ RING MOD ───┘',
    'P1 (S) ────────────┐\n   └──┐            ├─ mix\nP2 (PCM)─ RING MOD ─┘',
    'P1 (PCM) ─┐\n           ├─ mix → sortie\nP2 (PCM) ─┘',
    'P1 (PCM) ──────────┐\n   └──┐            ├─ mix\nP2 (PCM)─ RING MOD ─┘',
  ];
  function updateStruct() { structDiags.forEach(({ base, pre }) => pre.textContent = DIAG[patch.get(base, 47)] || ''); }
  function updateTypes() {
    groupsByType.forEach(({ group, cBase, pi, only }) => {
      const type = D50.STRUCT_TYPES[patch.get(cBase, 47)][pi];
      group.classList.toggle('dim', only !== type);
    });
    controls.forEach(c => {
      if (!c.def.only || c.cBase == null) return;
      c.row.classList.toggle('dim', D50.STRUCT_TYPES[patch.get(c.cBase, 47)][c.pi] !== c.def.only);
    });
  }

  function buildPatchTab() {
    const root = $('tab-patch');
    buildGroups(root, PATCHP, S.PATCH, ['Clavier', 'Accord', 'Mix', 'Contrôle', 'Effets', 'Chase', 'MIDI']);
  }

  function buildToneTab(which) {
    const root = $('tab-' + which);
    const up = which === 'upper';
    const cBase = up ? S.UC : S.LC, p1 = up ? S.UP1 : S.LP1, p2 = up ? S.UP2 : S.LP2;
    const nameIn = el('input', { class: 'tone-name', maxlength: 10, spellcheck: 'false', 'aria-label': 'Nom du tone' });
    nameIn.addEventListener('input', () => {
      snapOnce(); patch.setToneName(cBase, nameIn.value);
      sendParam(cBase, Array.from(patch.data.slice(cBase, cBase + 10))); saveEdit();
    });
    nameIn.dataset.cbase = cBase;
    const panes = {};
    const btn = (k, t) => el('button', { 'data-sub': k, onclick: () => { subtab[which] = k; showSub(which); } }, t);
    const other = up ? 'Lower' : 'Upper';
    const tools = el('div', { class: 'tools' },
      el('button', { title: 'Copier Partial 1 vers Partial 2', onclick: () => copyBlock(p1, p2, 64) }, 'P1 → P2'),
      el('button', { title: 'Copier Partial 2 vers Partial 1', onclick: () => copyBlock(p2, p1, 64) }, 'P2 → P1'),
      el('button', { title: `Copier tout le tone vers ${other}`, onclick: () => copyBlock(p1, up ? S.LP1 : S.UP1, 192) }, `Tone → ${other}`));
    root.append(el('div', { class: 'subtabs' }, nameIn, btn('common', 'Common'), btn('p1', 'Partial 1'), btn('p2', 'Partial 2'), tools));

    panes.common = el('div', { 'data-pane': 'common' });
    const pre = el('div', { class: 'struct-diag' }); structDiags.push({ base: cBase, pre });
    buildGroups(panes.common, COMMON, cBase, ['Structure', 'P-ENV-G', 'P-ENV', 'Modulation', 'LFO', 'EQ', 'Chorus'],
      { 'Structure': () => pre, 'P-ENV-G': () => envSvg(cBase, 'penv') });

    [[p1, 'p1', 0], [p2, 'p2', 1]].forEach(([base, key, pi]) => {
      const pane = el('div', { 'data-pane': key });
      const start = controls.length;
      const groups = buildGroups(pane, PARTIAL, base, ['WG', 'TVF', 'TVF-ENV', 'TVA', 'TVA-ENV'],
        { 'TVF-ENV': () => envSvg(base, 'tvf'), 'TVA-ENV': () => envSvg(base, 'tva') });
      controls.slice(start).forEach(c => { c.cBase = cBase; c.pi = pi; });
      groupsByType.push({ group: groups['TVF'], cBase, pi, only: 'S' }, { group: groups['TVF-ENV'], cBase, pi, only: 'S' });
      panes[key] = pane;
    });
    Object.values(panes).forEach(p => root.append(p));
    showSub(which);
  }
  function showSub(which) {
    const root = $('tab-' + which);
    root.querySelectorAll('[data-pane]').forEach(p => p.hidden = p.dataset.pane !== subtab[which]);
    root.querySelectorAll('.subtabs [data-sub]').forEach(b => b.classList.toggle('active', b.dataset.sub === subtab[which]));
  }
  function copyBlock(from, to, len) {
    pushUndo();
    patch.data.copyWithin(to, from, from + len);
    refresh(); if (cfg.auto) sendPatch(); toast('Copié');
  }

  function refresh() {
    controls.forEach(c => {
      const v = patch.get(c.base, c.def.o);
      c.input.value = v;
      if (!c.useSelect) c.val.textContent = c.def.f(v);
    });
    $('patchName').value = patch.name;
    document.querySelectorAll('.tone-name').forEach(i => i.value = patch.toneName(+i.dataset.cbase));
    updateEnvs(); updateStruct(); updateTypes(); saveEdit();
  }

  /* ---------------- bibliothèque ---------------- */
  const slotName = i => `${Math.floor(i / 8) + 1}${(i % 8) + 1}`;
  function renderBank() {
    const B = $('bank'); B.innerHTML = '';
    bank.forEach((p, i) => {
      const b = el('button', {
        class: 'slot' + (p ? '' : ' empty') + (i === selSlot ? ' sel' : '') + (i === morphA ? ' a' : '') + (i === morphB ? ' b' : ''),
        title: 'Clic : sélectionner · Double-clic : charger dans l\'éditeur'
      }, el('span', { class: 'no' }, slotName(i)), el('span', { class: 'nm' }, p ? p.name || '(sans nom)' : '— vide —'));
      b.addEventListener('click', () => { selSlot = i; renderBank(); });
      b.addEventListener('dblclick', loadSlot);
      B.append(b);
    });
    ['morphA', 'morphB'].forEach(id => {
      const s = $(id), cur = id === 'morphA' ? morphA : morphB; s.innerHTML = '';
      bank.forEach((p, i) => s.append(el('option', { value: i }, `${slotName(i)} ${p ? p.name : '—'}`)));
      s.value = cur;
    });
  }
  function loadSlot() {
    const p = bank[selSlot]; if (!p) return toast('Case vide', true);
    pushUndo(); patch = p.clone(); refresh(); if (cfg.auto) sendPatch();
    toast(`${slotName(selSlot)} « ${patch.name} » chargé`);
  }

  /* ---------------- fichiers ---------------- */
  let fileTarget = 'auto';
  function openFile(target) { fileTarget = target; $('fileIn').value = ''; $('fileIn').click(); }
  $('fileIn').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    const res = D50.importSyx(bytes);
    if (!res.count) return toast('Fichier sans données D-50 (DT1) reconnues', true);
    if (fileTarget === 'library' && res.temp && !res.bank.some(Boolean)) {
      bank[selSlot] = res.temp; saveBank(); renderBank(); return toast(`Patch rangé en ${slotName(selSlot)}`);
    }
    applyImport(res, `importé de ${f.name}`);
  });
  function download(name, msgs) {
    const blob = new Blob([new Uint8Array(msgs.flat())], { type: 'application/octet-stream' });
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const safe = s => (s || 'patch').trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_') || 'patch';

  /* ---------------- clavier virtuel ---------------- */
  const held = new Map(); // pointerId|code -> note
  function noteOn(n) { sendRaw([0x90 | cfg.ch, n, +$('velo').value]); keyEl(n)?.classList.add('on'); }
  function noteOff(n) { sendRaw([0x80 | cfg.ch, n, 0]); keyEl(n)?.classList.remove('on'); }
  const keyEl = n => document.querySelector(`.key[data-n="${n}"]`);
  function buildKbd() {
    const K = $('kbd'); K.innerHTML = '';
    const octs = window.innerWidth < 560 ? 1 : window.innerWidth < 1000 ? 2 : 3;
    const lo = 12 * (cfg.octave + 1), count = 12 * octs + 1;
    const whites = [];
    for (let n = lo; n < lo + count; n++) if (![1, 3, 6, 8, 10].includes(n % 12)) whites.push(n);
    const w = 100 / whites.length;
    whites.forEach(n => K.append(el('div', { class: 'key', 'data-n': n })));
    for (let n = lo; n < lo + count; n++) if ([1, 3, 6, 8, 10].includes(n % 12)) {
      const idx = whites.indexOf(n - 1) + 1;
      K.append(el('div', { class: 'key black', 'data-n': n, style: `left:${idx * w - w * 0.3}%;width:${w * 0.6}%` }));
    }
    $('octLbl').textContent = D50.noteName(lo);
    K.classList.toggle('collapsed', !cfg.kbd);
  }
  const kbd = $('kbd');
  const noteAt = (x, y) => { const k = document.elementFromPoint(x, y); return k && k.classList.contains('key') ? +k.dataset.n : null; };
  kbd.addEventListener('pointerdown', e => {
    const n = noteAt(e.clientX, e.clientY); if (n == null) return;
    kbd.setPointerCapture(e.pointerId); held.set(e.pointerId, n); noteOn(n);
  });
  kbd.addEventListener('pointermove', e => {
    if (!held.has(e.pointerId)) return;
    const n = noteAt(e.clientX, e.clientY), cur = held.get(e.pointerId);
    if (n != null && n !== cur) { noteOff(cur); noteOn(n); held.set(e.pointerId, n); }
  });
  const release = e => { if (held.has(e.pointerId)) { noteOff(held.get(e.pointerId)); held.delete(e.pointerId); } };
  kbd.addEventListener('pointerup', release); kbd.addEventListener('pointercancel', release);
  // clavier d'ordinateur (positions physiques : rangée A S D F… = touches blanches)
  const CODES = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL', 'KeyP', 'Semicolon'];
  window.addEventListener('keydown', e => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.type !== 'range') return;
    const i = CODES.indexOf(e.code); if (i < 0) return;
    const n = 12 * (cfg.octave + 1) + i; held.set(e.code, n); noteOn(n); e.preventDefault();
  });
  window.addEventListener('keyup', e => { if (held.has(e.code)) { noteOff(held.get(e.code)); held.delete(e.code); } });

  /* ---------------- onglets ---------------- */
  function showTab(name) {
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('main > .panel').forEach(p => p.hidden = p.id !== 'tab-' + name);
    if (name === 'log') { const L = $('log'); L.textContent = logLines.join('\n'); L.scrollTop = L.scrollHeight; }
  }
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

  /* ---------------- câblage des boutons ---------------- */
  function init() {
    for (let i = 0; i < 16; i++) { $('selDev').append(el('option', { value: i }, String(i + 1))); $('selCh').append(el('option', { value: i }, String(i + 1))); }
    $('selDev').value = cfg.dev; $('selCh').value = cfg.ch; $('chkAuto').checked = cfg.auto;
    $('selDev').onchange = () => { cfg.dev = +$('selDev').value; saveCfg(); };
    $('selCh').onchange = () => { cfg.ch = +$('selCh').value; saveCfg(); };
    $('chkAuto').onchange = () => { cfg.auto = $('chkAuto').checked; saveCfg(); };
    $('selOut').onchange = bindPorts; $('selIn').onchange = bindPorts;
    $('btnSettings').onclick = () => $('settings').hidden = !$('settings').hidden;
    $('btnMidiConnect').onclick = connectMidi;

    Object.keys(D50.RECIPES).forEach(r => $('selRecipe').append(el('option', { value: r }, r)));
    $('selRecipe').value = store.get('recipe', 'Pad');
    $('selRecipe').onchange = () => store.set('recipe', $('selRecipe').value);

    $('patchName').addEventListener('input', () => {
      snapOnce(); patch.name = $('patchName').value;
      sendParam(S.PATCH, Array.from(patch.data.slice(S.PATCH, S.PATCH + 18))); saveEdit();
    });
    $('btnSend').onclick = () => { sendPatch(); if (out) toast('Patch envoyé au D-50'); };
    $('btnRequest').onclick = () => {
      if (!out) return toast('Aucune sortie MIDI', true);
      if (!inp) return toast('Choisissez une entrée MIDI pour recevoir', true);
      awaitingReq = true; sendRaw(D50.rq1(cfg.dev, 0, D50.PATCH_SIZE));
      setTimeout(() => { if (awaitingReq) toast('Pas de réponse : vérifiez Unit # / Exclusive ON, ou faites un dump depuis le D-50', true); }, 2500);
    };
    $('btnUndo').onclick = () => doUndo(undo, redo);
    $('btnRedo').onclick = () => doUndo(redo, undo);
    window.addEventListener('keydown', e => {
      if (!(e.ctrlKey || e.metaKey) || /INPUT|SELECT/.test(document.activeElement.tagName) && document.activeElement.type === 'text') return;
      if (e.key === 'z') { e.preventDefault(); doUndo(undo, redo); } else if (e.key === 'y') { e.preventDefault(); doUndo(redo, undo); }
    });
    $('btnInit').onclick = () => { pushUndo(); patch = D50.initPatch(); refresh(); if (cfg.auto) sendPatch(); };
    $('btnGen').onclick = () => {
      pushUndo();
      patch = D50.applyRecipe(D50.initPatch(), $('selRecipe').value, +$('wild').value / 100);
      refresh(); if (cfg.auto) sendPatch();
      toast(`Nouveau son « ${patch.name} » — ↶ pour revenir`);
    };
    $('btnOpen').onclick = () => openFile('auto');
    $('btnSavePatch').onclick = () => download(safe(patch.name) + '.syx', D50.patchToTemp(cfg.dev, patch));

    $('btnLibLoad').onclick = loadSlot;
    $('btnLibStore').onclick = () => {
      if (bank[selSlot] && !confirm(`Remplacer ${slotName(selSlot)} « ${bank[selSlot].name} » ?`)) return;
      bank[selSlot] = patch.clone(); saveBank(); renderBank(); toast(`Rangé en ${slotName(selSlot)}`);
    };
    $('btnLibWrite').onclick = () => {
      const p = bank[selSlot]; if (!p) return toast('Case vide', true);
      if (!confirm(`Écrire « ${p.name} » dans la mémoire ${slotName(selSlot)} du D-50 ?\n(Memory Protect doit être OFF)`)) return;
      enqueue(D50.patchToMemory(cfg.dev, p, selSlot), 40);
    };
    $('btnLibWriteAll').onclick = () => {
      if (!confirm('Envoyer les 64 patches et écraser TOUTE la mémoire interne du D-50 ?\n(Memory Protect doit être OFF)')) return;
      enqueue(D50.exportBankSyx(cfg.dev, bank, extra), 60); toast('Envoi de la banque…');
    };
    $('btnLibImport').onclick = () => openFile('library');
    $('btnLibExport').onclick = () => download('D50_bank.syx', D50.exportBankSyx(cfg.dev, bank, extra));
    $('btnLibSwap').onclick = () => { [bank[morphA], bank[morphB]] = [bank[morphB], bank[morphA]]; saveBank(); renderBank(); };
    $('morphA').onchange = () => { morphA = +$('morphA').value; renderBank(); };
    $('morphB').onchange = () => { morphB = +$('morphB').value; renderBank(); };
    const doMorph = () => {
      const a = bank[morphA], b = bank[morphB]; if (!a || !b) return toast('A et B doivent contenir un patch', true);
      pushUndo(); patch = D50.morph(a, b, +$('morphT').value / 100); refresh(); if (cfg.auto) sendPatch();
    };
    $('btnMorph').onclick = doMorph;
    $('morphT').addEventListener('change', () => { if (bank[morphA] && bank[morphB]) doMorph(); });

    $('btnClearLog').onclick = () => { logLines.length = 0; $('log').textContent = ''; };
    $('btnPanic').onclick = () => { for (let c = 0; c < 16; c++) sendRaw([0xB0 | c, 123, 0]); };

    $('octDown').onclick = () => { cfg.octave = Math.max(0, cfg.octave - 1); saveCfg(); buildKbd(); };
    $('octUp').onclick = () => { cfg.octave = Math.min(7, cfg.octave + 1); saveCfg(); buildKbd(); };
    $('btnKbdToggle').onclick = () => { cfg.kbd = !cfg.kbd; saveCfg(); buildKbd(); document.body.style.paddingBottom = cfg.kbd ? '' : '60px'; };
    window.addEventListener('resize', debounce(buildKbd, 200));

    buildPatchTab(); buildToneTab('upper'); buildToneTab('lower');
    refresh(); renderBank(); buildKbd();
    if (!cfg.kbd) document.body.style.paddingBottom = '60px';
    connectMidi();

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => { });
    }
  }
  init();
})();
