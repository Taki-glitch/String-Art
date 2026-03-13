const state = {
  sourceImage: null,
  sourceData: null,
  resultCanvas: document.getElementById('result-canvas'),
  schemaCanvas: document.getElementById('schema-canvas'),
  instructions: [],
  nailPoints: [],
  cancel: false,
};

const ui = {
  imageInput: document.getElementById('image-input'),
  sourcePreviewWrap: document.getElementById('source-preview-wrap'),
  sourcePreview: document.getElementById('source-preview'),
  nails: document.getElementById('nails'),
  lines: document.getElementById('lines'),
  size: document.getElementById('size'),
  lineWeight: document.getElementById('line-weight'),
  colorMode: document.getElementById('color-mode'),
  summaryText: document.getElementById('summary-text'),
  generateBtn: document.getElementById('generate-btn'),
  cancelBtn: document.getElementById('cancel-btn'),
  exportPngBtn: document.getElementById('export-png-btn'),
  exportTxtBtn: document.getElementById('export-txt-btn'),
  exportPdfBtn: document.getElementById('export-pdf-btn'),
  progress: document.getElementById('progress'),
  status: document.getElementById('status'),
  instructionsList: document.getElementById('instructions-list'),
  stepsCount: document.getElementById('steps-count'),
};

function refreshSummary() {
  const c = ui.colorMode.checked ? ' · mode couleur' : '';
  ui.summaryText.textContent = `${ui.nails.value} clous · ${ui.lines.value} fils · ${ui.size.value}px · épaisseur ${ui.lineWeight.value}${c}`;
}

function createCirclePoints(nails, size) {
  const center = Math.floor(size / 2);
  const radius = Math.floor(size / 2) - 12;
  const points = [];
  for (let i = 0; i < nails; i += 1) {
    const angle = (2 * Math.PI * i) / nails;
    points.push([
      Math.round(center + radius * Math.cos(angle)),
      Math.round(center + radius * Math.sin(angle)),
    ]);
  }
  return points;
}

function bresenham(x0, y0, x1, y1) {
  const pts = [];
  let dx = Math.abs(x1 - x0);
  let sx = x0 < x1 ? 1 : -1;
  let dy = -Math.abs(y1 - y0);
  let sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    pts.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return pts;
}

function drawSourceToData(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.drawImage(state.sourceImage, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}

function toGray(data) {
  const out = new Float32Array(data.length / 4);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 1) {
    out[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return out;
}

function channelData(data, ch) {
  const out = new Float32Array(data.length / 4);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 1) out[j] = data[i + ch];
  return out;
}

function idx(x, y, size) {
  return y * size + x;
}

function renderInstructionsList(max = 300) {
  ui.instructionsList.innerHTML = '';
  const shown = state.instructions.slice(0, max);
  shown.forEach((s) => {
    const li = document.createElement('li');
    li.textContent = `Clou ${s.start} → Clou ${s.end} (${s.color})`;
    ui.instructionsList.appendChild(li);
  });
  ui.stepsCount.textContent = String(state.instructions.length);
}

function drawSchema(size) {
  const ctx = state.schemaCanvas.getContext('2d');
  state.schemaCanvas.width = size;
  state.schemaCanvas.height = size;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);

  const colorMap = { noir: '#111', rouge: '#d11', vert: '#1a8a1a', bleu: '#1456e0' };
  ctx.lineWidth = 1;
  state.instructions.forEach((s) => {
    const p1 = state.nailPoints[s.start];
    const p2 = state.nailPoints[s.end];
    ctx.strokeStyle = colorMap[s.color] || '#111';
    ctx.beginPath();
    ctx.moveTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.stroke();
  });

  ctx.fillStyle = '#000';
  ctx.font = '10px Arial';
  state.nailPoints.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p[0], p[1], 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(String(i), p[0] + 6, p[1] + 6);
  });
}

async function generateChannel(targetChannel, size, points, totalLines, lineWeight, colorName, renderedRgb, colorIndex) {
  const darknessTarget = new Float32Array(targetChannel.length);
  const darknessRendered = new Float32Array(targetChannel.length);
  for (let i = 0; i < targetChannel.length; i += 1) darknessTarget[i] = 255 - targetChannel[i];

  let current = 0;
  const minJump = Math.max(4, Math.floor(points.length * 0.03));
  const out = [];

  for (let step = 0; step < totalLines; step += 1) {
    if (state.cancel) return out;

    let best = null;
    let bestScore = -1;
    for (let candidate = 0; candidate < points.length; candidate += 1) {
      if (candidate === current) continue;
      const dist = Math.abs(candidate - current);
      const ringDist = Math.min(dist, points.length - dist);
      if (ringDist < minJump) continue;

      const linePts = bresenham(points[current][0], points[current][1], points[candidate][0], points[candidate][1]);
      let score = 0;
      for (let i = 0; i < linePts.length; i += 2) {
        const [x, y] = linePts[i];
        const k = idx(x, y, size);
        score += Math.max(0, darknessTarget[k] - darknessRendered[k]);
      }
      if (score > bestScore) {
        bestScore = score;
        best = { candidate, linePts };
      }
    }

    if (!best || bestScore < 1) break;

    best.linePts.forEach(([x, y]) => {
      const k = idx(x, y, size);
      darknessRendered[k] = Math.min(255, darknessRendered[k] + lineWeight);
      const val = Math.max(0, 255 - darknessRendered[k]);
      renderedRgb[(k * 4) + colorIndex] = Math.round(val);
      renderedRgb[(k * 4) + 3] = 255;
    });

    out.push({ start: current, end: best.candidate, color: colorName });
    current = best.candidate;

    if (step % 8 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  return out;
}

async function generate() {
  if (!state.sourceImage) {
    ui.status.textContent = 'Choisis une image avant de générer.';
    return;
  }

  state.cancel = false;
  ui.generateBtn.disabled = true;

  const nails = Math.max(40, Math.min(280, Number(ui.nails.value) || 160));
  const lines = Math.max(50, Math.min(4000, Number(ui.lines.value) || 900));
  const size = Math.max(300, Math.min(1000, Number(ui.size.value) || 700));
  const lineWeight = Math.max(4, Math.min(40, Number(ui.lineWeight.value) || 16));
  const colorMode = ui.colorMode.checked;

  ui.progress.value = 2;
  ui.status.textContent = 'Préparation...';

  const source = drawSourceToData(size);
  state.sourceData = source;
  state.nailPoints = createCirclePoints(nails, size);
  state.instructions = [];

  const resultCtx = state.resultCanvas.getContext('2d');
  state.resultCanvas.width = size;
  state.resultCanvas.height = size;
  const resultImage = resultCtx.createImageData(size, size);
  for (let i = 0; i < resultImage.data.length; i += 4) {
    resultImage.data[i] = 255;
    resultImage.data[i + 1] = 255;
    resultImage.data[i + 2] = 255;
    resultImage.data[i + 3] = 255;
  }

  if (!colorMode) {
    ui.status.textContent = 'Génération noir et blanc...';
    const gray = toGray(source);
    const instr = await generateChannel(gray, size, state.nailPoints, lines, lineWeight, 'noir', resultImage.data, 0);
    if (!state.cancel) {
      for (let i = 0; i < resultImage.data.length; i += 4) {
        resultImage.data[i + 1] = resultImage.data[i];
        resultImage.data[i + 2] = resultImage.data[i];
      }
      state.instructions.push(...instr);
    }
  } else {
    const split = Math.max(1, Math.floor(lines / 3));
    const channels = [
      { name: 'rouge', idx: 0, data: channelData(source, 0), p: 15 },
      { name: 'vert', idx: 1, data: channelData(source, 1), p: 45 },
      { name: 'bleu', idx: 2, data: channelData(source, 2), p: 75 },
    ];
    for (const ch of channels) {
      ui.progress.value = ch.p;
      ui.status.textContent = `Génération ${ch.name}...`;
      const instr = await generateChannel(ch.data, size, state.nailPoints, split, lineWeight, ch.name, resultImage.data, ch.idx);
      if (state.cancel) break;
      state.instructions.push(...instr);
    }
  }

  if (!state.cancel) {
    resultCtx.putImageData(resultImage, 0, 0);
    drawSchema(size);
    renderInstructionsList();
    ui.progress.value = 100;
    ui.status.textContent = `Terminé: ${state.instructions.length} fils.`;
  } else {
    ui.status.textContent = 'Génération annulée.';
  }

  ui.generateBtn.disabled = false;
}

function exportPng() {
  const url = state.resultCanvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = 'string-art-result.png';
  a.click();
}

function exportTxt() {
  const lines = state.instructions.map((s, i) => `${String(i + 1).padStart(4, '0')}. Clou ${s.start} -> Clou ${s.end} (${s.color})`);
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'instructions-string-art.txt';
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportPdf() {
  if (!window.jspdf?.jsPDF) {
    ui.status.textContent = 'jsPDF indisponible. Vérifie ta connexion internet.';
    return;
  }
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  pdf.setFontSize(14);
  pdf.text('String Art - Plan de réalisation', 40, 40);

  const schema = state.schemaCanvas.toDataURL('image/png');
  const result = state.resultCanvas.toDataURL('image/png');
  pdf.addImage(schema, 'PNG', 40, 60, 240, 240);
  pdf.addImage(result, 'PNG', 310, 60, 240, 240);

  let y = 330;
  pdf.setFontSize(10);
  state.instructions.forEach((s, i) => {
    if (y > 800) {
      pdf.addPage();
      y = 40;
    }
    pdf.text(`${String(i + 1).padStart(4, '0')}. Clou ${s.start} -> Clou ${s.end} (${s.color})`, 40, y);
    y += 12;
  });

  pdf.save('string-art-plan.pdf');
}

ui.imageInput.addEventListener('change', (e) => {
  const [file] = e.target.files;
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    ui.sourcePreview.src = ev.target.result;
    ui.sourcePreviewWrap.classList.remove('hidden');
    const img = new Image();
    img.onload = () => {
      state.sourceImage = img;
      ui.status.textContent = 'Image chargée. Prêt à générer.';
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

[ui.nails, ui.lines, ui.size, ui.lineWeight, ui.colorMode].forEach((el) => {
  el.addEventListener('input', refreshSummary);
  el.addEventListener('change', refreshSummary);
});

document.querySelectorAll('.preset-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const p = btn.dataset.preset;
    const map = {
      fast: { nails: 120, lines: 600, size: 540, lw: 18, color: false },
      balanced: { nails: 160, lines: 900, size: 700, lw: 16, color: false },
      detailed: { nails: 220, lines: 1800, size: 900, lw: 12, color: false },
      color: { nails: 180, lines: 1200, size: 800, lw: 14, color: true },
    };
    const v = map[p];
    if (!v) return;
    ui.nails.value = v.nails;
    ui.lines.value = v.lines;
    ui.size.value = v.size;
    ui.lineWeight.value = v.lw;
    ui.colorMode.checked = v.color;
    refreshSummary();
  });
});

ui.generateBtn.addEventListener('click', generate);
ui.cancelBtn.addEventListener('click', () => { state.cancel = true; });
ui.exportPngBtn.addEventListener('click', exportPng);
ui.exportTxtBtn.addEventListener('click', exportTxt);
ui.exportPdfBtn.addEventListener('click', exportPdf);

refreshSummary();
