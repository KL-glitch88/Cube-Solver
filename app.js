(() => {
  'use strict';

  const { faces, names, colours, standard } = Cube;
  const byId = id => document.getElementById(id);
  const net = byId('net');
  const results = byId('results');
  const canvas = byId('cube-view');
  const ctx = canvas.getContext('2d');
  const replay = byId('replay-turn');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const cornerPositions = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
  const sizeButtons = document.querySelectorAll('.cube-types button');
  const facePicker = byId('face-picker');
  const faceButtons = new Map();
  const drafts = new Map();
  let size = 2;
  let worker;
  let requestId = 0;
  let busy = false;
  let busyStart = 0;
  let busyTimer = 0;
  let solveFailed = false;
  const perFace = () => size * size;
  const positionLabel = index => size === 2 ? cornerPositions[index]
    : 'row ' + (Math.floor(index / size) + 1) + ', column ' + (index % size + 1);
  const notation = move => typeof move === 'string' ? move : move.notation;
  const edgeGuides = {
    U: ['Back', 'Right'], R: ['Top', 'Back'], F: ['Top', 'Right'],
    D: ['Front', 'Right'], L: ['Top', 'Front'], B: ['Top', 'Left'],
  };
  const faceGroups = {};
  const tiles = [];
  const swatches = new Map();
  const schemeInputs = [];
  let stickers = Array(24).fill('');
  let scheme = standard.slice();
  let selected = 'W';
  let activeFace = 'F';
  let report = null;
  let alternatives = [];
  let choice = 0;
  let solution = null;
  let step = 0;
  let animationFrame = 0;
  let previewAfterTurn = false;

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function button(text, className, onClick) {
    const element = node('button', text, className);
    element.type = 'button';
    element.addEventListener('click', onClick);
    return element;
  }

  function resetResult() {
    cancelAnimationFrame(animationFrame);
    clearInterval(busyTimer);
    busyTimer = 0;
    requestId++;
    busy = false;
    solveFailed = false;
    previewAfterTurn = false;
    report = null;
    solution = null;
    alternatives = [];
    choice = 0;
    step = 0;
  }

  function buildFaces() {
    net.replaceChildren();
    tiles.length = 0;
    faces.forEach(face => {
      const block = node('div', '', 'face');
      block.style.setProperty('--face', face);
      block.setAttribute('role', 'group');
      block.setAttribute('aria-label', names[face] + ' face');
      const title = node('div', '', 'face-name');
      title.append(node('b', face), node('span', names[face]));
      const grid = node('div', '', 'face-stickers');
      for (let i = 0; i < perFace(); i++) {
        const index = tiles.length;
        const tile = button('', 'tile', () => {
          stickers[index] = selected;
          focusFace(face);
          resetResult();
          draw();
        });
        tile.addEventListener('focus', () => focusFace(face));
        grid.append(tile);
        tiles.push(tile);
      }
      block.append(title, grid);
      net.append(block);
      faceGroups[face] = block;
    });
  }

  faces.forEach((face, fi) => {
    const tab = button(face, 'secondary', () => focusFace(face));
    tab.setAttribute('aria-label', names[face] + ' face');
    faceButtons.set(face, tab);
    facePicker.append(tab);
    const label = node('label', names[face] + ' (' + face + ')');
    const select = node('select');
    Object.entries(colours).forEach(([code, [name]]) => select.add(new Option(name, code)));
    select.value = scheme[fi];
    select.addEventListener('change', () => {
      scheme = schemeInputs.map(input => input.value);
      resetResult();
      draw();
    });
    schemeInputs.push(select);
    label.append(select);
    byId('scheme').append(label);
  });

  for (const code of ['W', 'Y', 'R', 'O', 'G', 'B', '']) {
    const swatch = button(code || 'Erase', code ? 'colour' : 'colour erase', () => {
      selected = code;
      drawPalette();
    });
    swatch.setAttribute('aria-label', code ? colours[code][0] : 'Erase a sticker');
    if (code) swatch.style.setProperty('--swatch', colours[code][1]);
    swatches.set(code, swatch);
    byId('palette').append(swatch);
  }

  function drawPalette() {
    swatches.forEach((swatch, code) => swatch.setAttribute('aria-pressed', String(code === selected)));
  }

  function focusFace(face) {
    activeFace = face;
    Object.entries(faceGroups).forEach(([key, group]) => group.classList.toggle('active', key === face));
    faceButtons.forEach((tab, key) => tab.setAttribute('aria-pressed', String(key === face)));
    const [above, right] = edgeGuides[face];
    byId('face-guide').replaceChildren(
      node('strong', names[face] + ' face (' + face + ')'),
      node('p', above + ' edge at the top.'),
      node('p', right + ' edge on the right.'),
    );
  }

  function drawEntry() {
    const flags = new Set(alternatives[choice]?.changes ?? report?.flags ?? report?.faults?.flatMap(fault => Cube.corners[fault.slot]) ?? []);
    const count = stickers.filter(Boolean).length;
    const progress = node('progress');
    progress.max = stickers.length;
    progress.value = count;
    progress.setAttribute('aria-label', 'Stickers entered');
    byId('progress').replaceChildren(progress, node('span', count + ' / ' + stickers.length));
    tiles.forEach((tile, index) => {
      const colour = stickers[index];
      tile.textContent = colour || '·';
      tile.dataset.filled = String(Boolean(colour));
      tile.style.setProperty('--swatch', colour ? colours[colour][1] : 'transparent');
      tile.classList.toggle('flag', flags.has(index));
      tile.setAttribute('aria-label', names[faces[Math.floor(index / perFace())]] + ' ' + positionLabel(index % perFace()) + ', ' + (colour ? colours[colour][0] : 'empty'));
    });
    const duplicate = new Set(scheme).size !== 6;
    byId('solve').disabled = duplicate || busy;
    byId('scheme-error').textContent = duplicate ? 'Choose each reference colour once.' : '';
  }

  function drawPreview() {
    const nextMove = solution?.moves[step];
    const repair = alternatives[choice];
    const data = solution ? solution.states[step + Number(previewAfterTurn)] : repair?.next ?? stickers;
    const label = nextMove ? (previewAfterTurn ? 'After move ' : 'Before move ') + (step + 1) : 'Solved';
    byId('preview-label').textContent = solution ? label : repair ? 'Suggested layout' : busy ? 'Checking…' : 'Live entry';
    replay.hidden = !nextMove || !ctx;
    replay.textContent = reducedMotion.matches ? (previewAfterTurn ? 'Show before turn' : 'Show after turn') : '↻ Replay turn';
    canvas.setAttribute('aria-label', ['U', 'F', 'R'].map(face => {
      const index = faces.indexOf(face) * perFace();
      return names[face] + ' face: ' + data.slice(index, index + perFace()).map(c => c ? colours[c][0] : 'empty').join(', ');
    }).join('. '));
    if (!ctx) return;
    const demo = size === 2 && !solution && !repair && stickers.every(c => !c);
    const visual = demo ? ['W', 'G', 'Y', 'W', 'B', 'R', 'O', 'Y', 'G', 'R', 'B', 'G'] : data;
    const flags = repair?.changes ?? report?.flags ?? report?.faults?.flatMap(fault => Cube.corners[fault.slot]) ?? [];
    paintCube(ctx, visual, { move: nextMove, size, completed: previewAfterTurn, flags });
    if (demo) canvas.setAttribute('aria-label', 'Illustration of a scrambled 2×2 cube');
  }

  function playTurn() {
    cancelAnimationFrame(animationFrame);
    const move = solution?.moves[step];
    if (!ctx || !move) return;
    if (reducedMotion.matches) {
      previewAfterTurn = !previewAfterTurn;
      drawPreview();
      return;
    }
    previewAfterTurn = false;
    drawPreview();
    const introStart = performance.now();
    const turnDelay = 280;
    const start = introStart + turnDelay;
    const duration = notation(move).endsWith('2') ? 920 : 680;
    const data = solution.states[step];
    const label = byId('preview-label');
    const playingLabel = 'Playing move ' + (step + 1) + ' · ' + notation(move);

    function easeInOutCubic(t) {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function frame(now) {
      if (now < start) {
        const intro = Math.min(1, (now - introStart) / (turnDelay * 0.85));
        const easedIntro = 1 - Math.pow(1 - intro, 3);
        paintCube(ctx, data, { move, size, fraction: 0, intro: easedIntro });
        animationFrame = requestAnimationFrame(frame);
        return;
      }
      const fraction = Math.min(1, (now - start) / duration);
      if (fraction >= 1) {
        previewAfterTurn = true;
        drawPreview();
        return;
      }
      if (label.textContent !== playingLabel) label.textContent = playingLabel;
      const eased = easeInOutCubic(fraction);
      paintCube(ctx, data, { move, size, fraction: eased, intro: 1 });
      animationFrame = requestAnimationFrame(frame);
    }
    animationFrame = requestAnimationFrame(frame);
  }

  function status(label, warning = false) {
    return node('div', label, warning ? 'result-status warn' : 'result-status');
  }

  function showResults() {
    if (matchMedia('(max-width: 700px)').matches) {
      const destination = solution?.moves[step] ? canvas.closest('.preview') : results;
      destination.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }

  function checkLargeCube(example) {
    const id = ++requestId;
    busy = true;
    busyStart = Date.now();
    clearInterval(busyTimer);
    busyTimer = setInterval(() => {
      if (id === requestId && busy) drawResults();
    }, 1000);
    draw();
    showResults();
    const fail = () => {
      if (id !== requestId) return;
      clearInterval(busyTimer);
      busyTimer = 0;
      busy = false;
      solveFailed = true;
      draw();
    };
    try {
      worker ??= new Worker('solver4-worker.js');
      worker.onerror = () => {
        worker.terminate();
        worker = undefined;
        fail();
      };
      worker.onmessageerror = worker.onerror;
      worker.onmessage = ({ data }) => {
        if (data.id !== requestId) return;
        if (data.failed) return fail();
        clearInterval(busyTimer);
        busyTimer = 0;
        busy = false;
        stickers = data.stickers;
        if (data.errors) {
          report = { errors: data.errors, flags: data.errors.flatMap(error => error.facelets ?? []) };
          alternatives = data.repairs;
        } else {
          solution = { states: data.states, moves: data.moves };
        }
        draw();
        showResults();
        if (!reducedMotion.matches) playTurn();
      };
      worker.postMessage({ id, stickers, scheme, example });
    } catch {
      fail();
    }
  }

  function renderLargeDiagnosis() {
    results.replaceChildren(status('Impossible layout', true), node('h3', 'Check the 4×4 sticker layout'));
    results.append(node('p', 'Compare the entries with your cube and check the selected colour scheme. The four centres of a colour can be on different faces in a scramble.'));
    const list = node('ul', '', 'result-faults');
    const descriptions = {
      'invalid-corner': 'These three colours cannot form a corner.',
      'mirrored-corner': 'These corner colours are in reverse order.',
      'duplicate-corner': 'This corner repeats a combination already entered.',
      'twisted-corner': 'The corners have a combined twist that normal turns cannot undo.',
      'invalid-wing': 'These two stickers cannot form an edge piece in this colour scheme.',
      'duplicate-wing': 'This edge piece repeats an orientation and colour pair already entered.',
      'flipped-edge': 'An edge piece cannot be flipped in isolation on this cube.',
      'parity': 'Two pieces appear swapped in a way normal turns cannot undo.',
      'duplicate-centre-colour': 'Each reference colour should appear once in the colour scheme.',
      'unknown-colour': 'One or more stickers do not match the six cube colours.',
    };
    const errorLabels = {
      'twisted-corner': 'Corner orientation',
      'flipped-edge': 'Edge orientation',
      'parity': 'Piece parity',
      'duplicate-centre-colour': 'Colour scheme',
      'unknown-colour': 'Sticker colour',
    };
    const cornerChipByLabel = {
      'top right front': 'URF',
      'top front left': 'UFL',
      'top left back': 'ULB',
      'top back right': 'UBR',
      'bottom front right': 'DFR',
      'bottom left front': 'DLF',
      'bottom back left': 'DBL',
      'bottom right back': 'DRB',
    };
    const largeChipTitle = label => {
      const cornerMatch = label.match(/^Reorient the (.+) corner$/);
      if (cornerMatch) return cornerChipByLabel[cornerMatch[1]] ?? label;
      const entryMatch = label.match(/^([URFDLB]) face · rotate entry (\d+°) clockwise$/);
      if (entryMatch) return names[entryMatch[1]] + ' (' + entryMatch[1] + ') · ' + entryMatch[2];
      return label;
    };
    const location = index => names[faces[Math.floor(index / 16)]] + ' ' + positionLabel(index % 16);
    for (const error of report.errors) {
      const colour = error.face && colours[scheme[faces.indexOf(error.face)]]?.[0];
      const prefix = colour
        || (error.facelets?.length ? error.facelets.map(location).join(' / ') : '')
        || errorLabels[error.code]
        || 'Layout check';
      const detail = error.code === 'colour-count' ? error.count + ' stickers entered, 16 expected.'
        : error.code === 'centre-count' ? error.count + ' centre stickers entered, 4 expected.'
        : descriptions[error.code] ?? 'Check the sticker colours.';
      listItem(list, prefix + ' ·', detail);
    }
    results.append(list);
    const repair = alternatives[choice];
    if (!repair) {
      results.append(node('p', 'Re-enter the listed positions. If no positions are listed, check the colour totals and centre squares on all six faces.'));
      return;
    }
    results.append(node('p', alternatives.length > 1
      ? 'Several corrections would make this layout solvable. Compare each suggestion with your cube to find what actually changed.'
      : 'Compare this possible correction with your cube before applying it.', 'compare-tip'));
    const options = node('div', '', 'candidate-list');
    if (alternatives.length > 1) {
      alternatives.forEach((candidate, index) => {
        const option = button(largeChipTitle(candidate.label), '', () => {
          choice = index;
          draw();
          results.querySelector('.candidate-list [aria-pressed=true]')?.focus({ preventScroll: true });
        });
        option.setAttribute('aria-label', candidate.label);
        option.setAttribute('aria-pressed', String(index === choice));
        options.append(option);
      });
    }
    const isEntryRepair = !repair.label.startsWith('Reorient');
    const card = node('div', '', 'repair-card');
    card.append(node('h4', repair.label));
    card.append(node('p', isEntryRepair
      ? 'Check how you held that face when you entered its colours. This changes the grid on screen only.'
      : 'If you know this piece was twisted, use your cube maker’s instructions to reseat it in the orientation below. Avoid forcing the piece. Other corners may also be valid candidates.'));
    const changes = node('ul', '', 'changes');
    for (const index of repair.changes) {
      listItem(changes, location(index) + ' ·', colours[stickers[index]][0] + ' → ' + colours[repair.next[index]][0]);
    }
    const actions = node('div', '', 'repair-actions');
    actions.append(button(isEntryRepair ? 'Correct the entry & solve' : 'Use this layout & solve', 'secondary', () => {
      stickers = repair.next.slice();
      runCheck();
    }));
    card.append(changes, actions);
    if (options.children.length) results.append(options);
    results.append(card);
  }


  function runCheck(scroll = true) {
    resetResult();
    if (size === 4) {
      const missing = stickers.filter(colour => !colour).length;
      if (missing) {
        report = { missing };
        draw();
      } else {
        checkLargeCube();
      }
      return;
    }
    report = Cube.analyse(stickers, scheme);
    if (report.valid) {
      const moves = Cube.solve(stickers, scheme);
      const states = [stickers.slice()];
      for (const move of moves) states.push(Cube.move(states.at(-1), move));
      solution = { moves, states };
    } else if (!report.missing) {
      alternatives = Cube.repairs(stickers, scheme, report);
    }
    draw();
    if (scroll && !report.missing) showResults();
    if (!reducedMotion.matches) playTurn();
  }

  function example(twisted) {
    if (new Set(scheme).size !== 6) {
      scheme = standard.slice();
      schemeInputs.forEach((input, index) => { input.value = scheme[index]; });
    }
    if (size === 4) {
      resetResult();
      checkLargeCube(twisted ? 'twisted' : 'scrambled');
      return;
    }
    const scramble = ['R', 'U', "F'", 'R2', "U'", 'F', 'R'];
    stickers = scramble.reduce(Cube.move, Cube.solved(scheme));
    if (twisted) stickers = Cube.twistCorner(stickers, 0);
    runCheck();
  }

  function turnText(move) {
    if (typeof move !== 'string') {
      const face = names[move.face].toLowerCase();
      const layers = move.from === 1 && move.to === 4 ? 'the whole cube'
        : move.from === 1 && move.to === 1 ? 'the outer ' + face + ' layer'
        : move.from === move.to ? 'only layer ' + move.from + ' from the ' + face + ' face'
        : 'layers ' + move.from + ' to ' + move.to + ' from the ' + face + ' face together';
      return 'Looking straight at the ' + face + ' face, turn ' + layers
        + (move.turns === 2 ? ' 180° in either direction.' : ' 90° ' + (move.turns === 1 ? 'clockwise.' : 'anticlockwise.'));
    }
    if (move.endsWith('2')) return 'Turn the ' + names[move[0]].toLowerCase() + ' face 180° in either direction.';
    return 'Turn the ' + names[move[0]].toLowerCase() + ' face 90° ' + (move.endsWith("'") ? 'anticlockwise' : 'clockwise') + '.';
  }

  function renderSolution() {
    const total = solution.moves.length;
    const done = step === total;
    const heading = total ? (done ? 'Cube solved' : total + (total === 1 ? ' turn to solve' : ' turns to solve')) : 'Already solved';
    results.replaceChildren(status(done ? 'All faces match' : 'Solvable layout'), node('h3', heading));
    if (!total) {
      results.append(node('p', 'All six faces are already solid colours.'));
      return;
    }
    results.append(node('p', 'Keep the same top and front reference. Judge direction while looking straight at the face you’re turning.'));
    const list = node('div', '', 'move-list');
    list.setAttribute('aria-label', 'Solution moves');
    solution.moves.forEach((move, i) => {
      const chip = button(notation(move), i < step ? 'done' : '', () => navigate(i, '.move-list button:nth-child(' + (i + 1) + ')'));
      chip.setAttribute('aria-label', 'Move ' + (i + 1) + ', ' + turnText(move));
      if (i === step) chip.setAttribute('aria-current', 'step');
      list.append(chip);
    });
    const nav = node('div', '', 'solution-nav');
    const back = button('Previous', 'secondary', () => navigate(step - 1, '#previous'));
    back.id = 'previous';
    back.disabled = step === 0;
    const next = button(step + 1 >= total ? 'Finish' : 'Next move →', 'primary', () => navigate(step + 1, '#next'));
    next.id = 'next';
    next.disabled = done;
    nav.append(back, next);
    results.append(node('div', done ? 'All ' + total + ' moves complete' : 'Move ' + (step + 1) + ' of ' + total, 'turn-label'),
      node('p', done ? 'Check that each face on your cube is a solid colour.' : turnText(solution.moves[step])), nav, list);
  }

  function navigate(index, selector) {
    cancelAnimationFrame(animationFrame);
    previewAfterTurn = false;
    step = index;
    drawPreview();
    renderSolution();
    const target = results.querySelector(selector);
    (target.disabled ? results.querySelector(step ? '#previous' : '#next') : target)?.focus({ preventScroll: true });
    if (solution.moves[step]) showResults();
    if (!reducedMotion.matches) playTurn();
  }

  function listItem(list, label, text) {
    const item = node('li');
    item.append(node('strong', label), document.createTextNode(' ' + text));
    list.append(item);
  }

  function describeRepair(repair) {
    if (repair.type === 'entry') return 'Rotate the ' + repair.detail + ' in this entry.';
    if (repair.type === 'twist') return 'Reorient the ' + Cube.cornerLabels[repair.slots[0]].toLowerCase() + ' corner.';
    if (repair.type === 'layout') return 'Closest solvable layout by sticker count';
    return 'Correct ' + repair.changes.length + (repair.changes.length === 1 ? ' sticker' : ' stickers');
  }

  function renderDiagnosis() {
    const badCounts = Object.entries(report.counts).filter(([, count]) => count !== 4);
    const twistsOnly = !report.faults.length && !badCounts.length && report.twist !== 0;
    results.replaceChildren(status('Impossible layout', true), node('h3', twistsOnly ? 'Corner twist mismatch' : 'Check the stickers and corners'));
    results.append(node('p', 'Recheck the face directions, sticker positions and colour scheme against your cube.'));
    const faults = node('ul', '', 'result-faults');
    for (const [colour, count] of badCounts) listItem(faults, colours[colour][0] + ' ·', count + ' entered, 4 expected.');
    for (const fault of report.faults) listItem(faults, Cube.cornerLabels[fault.slot] + ' ·', fault.type);
    if (twistsOnly) listItem(faults, 'Corner orientation ·', 'The corners have a combined twist that normal face turns cannot undo.');
    if (faults.children.length) results.append(faults);
    const repair = alternatives[choice];
    if (!repair) return;
    results.append(node('p', alternatives.length > 1 ? 'Several corrections would make this layout solvable. Compare each suggestion with your cube to find what actually changed.' : 'Compare this possible correction with your cube before applying it.', 'compare-tip'));
    const options = node('div', '', 'candidate-list');
    alternatives.forEach((candidate, i) => {
      if (alternatives.length === 1) return;
      const title = candidate.type === 'entry' ? candidate.detail :
        candidate.type === 'twist' ? Cube.cornerNames[candidate.slots[0]] :
          candidate.changes.length + ' stickers · ' + (i + 1);
      const option = button(title, '', () => {
        choice = i;
        draw();
        results.querySelector('.candidate-list [aria-pressed=true]')?.focus({ preventScroll: true });
      });
      option.setAttribute('aria-label', describeRepair(candidate));
      option.setAttribute('aria-pressed', String(choice === i));
      options.append(option);
    });
    const card = node('div', '', 'repair-card');
    card.append(node('h4', describeRepair(repair)));
    const tips = {
      entry: 'Check how you held that face when you entered its colours. This changes the grid on screen only.',
      twist: 'If you know this piece was twisted, use your cube maker’s instructions to reseat it in the orientation below. Avoid forcing the piece. Other corners may also be valid candidates.',
      stickers: 'If the entry is accurate and the stickers or tiles were actually moved, compare the target colours below before restoring them. Use the manufacturer’s instructions for removable parts.',
      layout: 'Use this as a comparison guide. It minimises the number of changed squares for the selected scheme. It may differ from the original physical layout, so check the cube and the manufacturer’s colour scheme before making changes.',
    };
    card.append(node('p', tips[repair.type]));
    const changes = node('ul', '', 'changes');
    for (const index of repair.changes) {
      listItem(changes, names[faces[Math.floor(index / perFace())]] + ' ' + positionLabel(index % perFace()) + ' ·',
        colours[stickers[index]][0] + ' → ' + colours[repair.next[index]][0]);
    }
    card.append(changes);
    const actions = node('div', '', 'repair-actions');
    actions.append(button(repair.type === 'entry' ? 'Correct the entry & solve' : 'Use this layout & solve', 'secondary', () => {
      stickers = repair.next.slice();
      runCheck();
    }));
    card.append(actions);
    results.append(options, card);
  }

  function drawResults() {
    if (solution) return renderSolution();
    if (busy || solveFailed) {
      const elapsed = busy ? Math.floor((Date.now() - busyStart) / 1000) : 0;
      const heading = busy
        ? (elapsed >= 2 ? 'Checking your 4×4… (' + elapsed + 's)' : 'Checking your 4×4…')
        : 'Could not calculate a solution';
      const busyCopy = elapsed >= 8
        ? 'Still searching — complex 4×4 scrambles and first-time table setup can take 10–20 seconds.'
        : 'The first solve prepares the search tables on this device.';
      const failedCopy = location.protocol === 'file:'
        ? 'The 4×4 solver runs in a web worker, which browsers block on file:// pages. Serve this folder over HTTP and reopen the page.'
        : 'Your colours are still entered. Try Check & solve again.';
      results.replaceChildren(node('h3', heading), node('p', busy ? busyCopy : failedCopy));
      return;
    }
    if (report && !report.missing) return size === 4 ? renderLargeDiagnosis() : renderDiagnosis();
    const heading = report ? 'Add the remaining ' + report.missing + (report.missing === 1 ? ' sticker' : ' stickers') : 'Ready when you are';
    results.replaceChildren(node('h3', heading), node('p', 'Enter all ' + stickers.length + ' stickers to check the layout and get the turns.'));
    results.append(button('Try a twisted-corner example', 'text-button demo-link', () => example(true)));
  }

  function draw() {
    drawEntry();
    drawPreview();
    drawResults();
  }

  replay.addEventListener('click', playTurn);
  canvas.addEventListener('click', () => {
    if (solution?.moves[step]) playTurn();
  });
  reducedMotion.addEventListener('change', () => {
    cancelAnimationFrame(animationFrame);
    drawPreview();
  });
  byId('solve').addEventListener('click', () => {
    runCheck();
    if (report?.missing) {
      const index = stickers.findIndex(colour => !colour);
      focusFace(faces[Math.floor(index / perFace())]);
      tiles[index].focus();
    }
  });
  byId('example').addEventListener('click', () => example(false));
  byId('clear').addEventListener('click', () => {
    stickers = Array(6 * perFace()).fill('');
    resetResult();
    focusFace('F');
    draw();
  });
  sizeButtons.forEach(button => button.addEventListener('click', () => {
    const nextSize = Number(button.dataset.size);
    if (size === nextSize) return;
    drafts.set(size, { stickers, scheme, selected, activeFace });
    const wasBusy = busy;
    resetResult();
    if (wasBusy) {
      worker?.terminate();
      worker = undefined;
    }
    size = nextSize;
    const draft = drafts.get(size);
    stickers = draft?.stickers ?? Array(6 * perFace()).fill('');
    scheme = draft?.scheme ?? standard.slice();
    selected = draft?.selected ?? 'W';
    schemeInputs.forEach((input, index) => { input.value = scheme[index]; });
    document.body.classList.toggle('cube-four', size === 4);
    facePicker.hidden = size !== 4;
    net.setAttribute('aria-label', size === 4 ? 'Sticker grid for selected face' : 'Unfolded cube faces');
    byId('cube-size-title').textContent = size + '×' + size + ' cube.';
    sizeButtons.forEach(tab => tab.setAttribute('aria-pressed', String(tab === button)));
    buildFaces();
    focusFace(draft?.activeFace ?? 'F');
    drawPalette();
    draw();
  }));
  buildFaces();
  focusFace(activeFace);
  drawPalette();
  draw();
})();
