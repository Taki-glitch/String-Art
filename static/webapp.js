const constrain = (val, min, max) => (val < min ? min : (val > max ? max : val));
const map = (value, x1, y1, x2, y2) => (value - x1) * (y2 - x2) / (y1 - x1) + x2;

class Color {
  constructor(r, g, b, a = 255) {
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a;
  }
}

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

class ImageBuffer {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }

  get_image_point(svgPoint, bbox) {
    const x = Math.floor(map(svgPoint.x, bbox.x, bbox.x + bbox.width, 0, this.width - 1));
    const y = Math.floor(map(svgPoint.y, bbox.y, bbox.y + bbox.height, 0, this.height - 1));
    return new Point(constrain(x, 0, this.width - 1), constrain(y, 0, this.height - 1));
  }
}

class Line {
  constructor(startIndex, endIndex, graph) {
    this.startIndex = startIndex;
    this.endIndex = endIndex;
    this.graph = graph;
    this.pixels = [];
    this.fade = 1 / (graph.downscaleFactor * 1.8);
    this.computePixelOverlap();
  }

  computePixelOverlap() {
    this.pixels = [];
    const start = this.graph.nailsPos[this.startIndex];
    const end = this.graph.nailsPos[this.endIndex];

    let x0 = start.x;
    let x1 = end.x;
    let y0 = start.y;
    let y1 = end.y;
    let dx = Math.abs(x1 - x0);
    let dy = Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1;
    let sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    while (true) {
      this.pixels.push(new Point(x0, y0));
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  getLineDiff(color) {
    const colorArr = [color.r, color.g, color.b, color.a];
    let totalDiff = 0;

    for (let i = 0; i < this.pixels.length; i += 1) {
      const p = this.pixels[i];
      const ind = (p.x + p.y * this.graph.img.width) * 4;
      let pixelDiff = 0;

      for (let j = 0; j < 4; j += 1) {
        const newC = colorArr[j] * this.fade + this.graph.currentData[ind + j] * (1 - this.fade);
        const diff = Math.abs(this.graph.origData[ind + j] - newC)
          - Math.abs(this.graph.currentData[ind + j] - this.graph.origData[ind + j]);
        pixelDiff += diff;
      }

      if (pixelDiff < 0) totalDiff += pixelDiff;
      if (pixelDiff > 0) totalDiff += pixelDiff / 5;
    }

    return Math.pow(totalDiff / Math.max(1, this.pixels.length), 3);
  }

  addToBuffer(color) {
    const colorArr = [color.r, color.g, color.b, color.a];
    for (let i = 0; i < this.pixels.length; i += 1) {
      const p = this.pixels[i];
      const ind = (p.x + p.y * this.graph.img.width) * 4;
      for (let c = 0; c < 4; c += 1) {
        const value = colorArr[c] * this.fade + this.graph.currentData[ind + c] * (1 - this.fade);
        this.graph.currentData[ind + c] = constrain(Math.round(value), 0, 255);
      }
    }
  }
}

class Thread {
  constructor(startNail, color, graph, colorName) {
    this.currentNail = startNail;
    this.color = color;
    this.colorName = colorName;
    this.graph = graph;
    this.nailOrder = [startNail];
    this.nextDist = Infinity;
    this.nextNail = startNail;
    this.nextLine = null;
    this.nextValid = false;
    this.prevConnections = [];
  }

  getNextNailWeight() {
    if (this.nextValid) return this.nextDist;

    const chords = this.graph.getConnections(this.currentNail);
    let minDist = Infinity;
    let minDistIndex = -1;

    chords.forEach((line, i) => {
      if (!line || i === this.currentNail) return;
      const ringDist = Math.abs(i - this.currentNail);
      const wrapped = Math.min(ringDist, this.graph.numNails - ringDist);
      if (wrapped <= this.graph.minJump) return;

      let dist = line.getLineDiff(this.color);
      if (this.prevConnections[this.currentNail] && this.prevConnections[this.currentNail][i] === true) {
        dist = 0;
      }
      if (dist < minDist) {
        minDist = dist;
        minDistIndex = i;
      }
    });

    if (minDist >= 0 || minDistIndex < 0) {
      minDist = Infinity;
      minDistIndex = -1;
    }

    this.nextDist = minDist;
    this.nextNail = minDistIndex;
    this.nextLine = minDistIndex >= 0 ? chords[minDistIndex] : null;
    this.nextValid = true;
    return minDist;
  }

  moveToNextNail() {
    if (!this.nextValid) this.getNextNailWeight();
    if (!this.nextLine || this.nextNail < 0) return false;

    if (!this.prevConnections[this.currentNail]) this.prevConnections[this.currentNail] = [];
    this.prevConnections[this.currentNail][this.nextNail] = true;

    this.nextLine.addToBuffer(this.color);
    const start = this.currentNail;
    this.currentNail = this.nextNail;
    this.nailOrder.push(this.currentNail);
    this.nextValid = false;

    this.graph.instructions.push({ start, end: this.currentNail, color: this.colorName });
    return true;
  }
}

const state = {
  sourceImage: null,
  instructions: [],
  nailPoints: [],
  cancel: false,
  anim: { running: false, index: 0, accumulator: 0, lastTs: undefined },
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
  resultCanvas: document.getElementById('result-canvas'),
  schemaCanvas: document.getElementById('schema-canvas'),
  animationCanvas: document.getElementById('animation-canvas'),
  speedInput: document.getElementById('speed-input'),
  progressInput: document.getElementById('progress-input'),
  playBtn: document.getElementById('play-btn'),
  pauseBtn: document.getElementById('pause-btn'),
  resetBtn: document.getElementById('reset-btn'),
  animationStatus: document.getElementById('animation-status'),
  trackPathway: document.getElementById('track-pathway'),
  trackMajor: document.getElementById('track-major'),
  trackGrade: document.getElementById('track-grade'),
  trackTopics: document.getElementById('track-topics'),
};

const schoolTracks = {
  general: {
    label: 'Voie générale',
    majors: {
      general: {
        label: 'Général',
        grades: {
          seconde: ['Fonctions et variations', 'Statistiques descriptives', 'Probabilités', 'Géométrie repérée'],
          premiere: ['Fonctions polynômes et dérivées', 'Suites numériques', 'Loi binomiale', 'Trigonométrie'],
          terminale: ['Limites et continuité', 'Intégration', 'Variables aléatoires', 'Algorithmique et Python'],
        },
      },
    },
  },
  techno: {
    label: 'Voie technologique',
    majors: {
      stmg: {
        label: 'STMG',
        grades: {
          seconde: ['Proportionnalité et pourcentages', 'Équations du 1er degré', 'Lecture de données économiques'],
          premiere: ['Indicateurs statistiques', 'Évolution et taux', 'Probabilités conditionnelles', 'Tableurs et simulation'],
          terminale: ['Suites appliquées à la gestion', 'Prise de décision sous incertitude', 'Graphes et optimisation'],
        },
      },
      st2s: {
        label: 'ST2S',
        grades: {
          seconde: ['Calculs de doses et échelles', 'Statistiques de santé', 'Tableaux et graphiques'],
          premiere: ['Fonctions usuelles en contexte sanitaire', 'Probabilités pour le risque', 'Variabilité biologique'],
          terminale: ['Intervalles de confiance', 'Tests statistiques simples', 'Modélisation de phénomènes de santé'],
        },
      },
    },
  },
  pro: {
    label: 'Voie professionnelle',
    majors: {
      assp: {
        label: 'ASSP',
        grades: {
          seconde: ['Grandeurs et conversions', 'Organisation des données', 'Calculs de proportion'],
          premiere: ['Dosages et débits', 'Tableaux de suivi', 'Géométrie appliquée aux espaces professionnels'],
          terminale: ['Lecture d’indicateurs qualité', 'Statistiques en situation professionnelle', 'Résolution de problèmes concrets'],
        },
      },
      metiers: {
        label: 'Métiers de la production/services',
        grades: {
          seconde: ['Calcul numérique appliqué', 'Unités et mesures', 'Représentations graphiques'],
          premiere: ['Fonctions en contexte métier', 'Proportionnalité avancée', 'Probabilités simples'],
          terminale: ['Optimisation de coûts', 'Contrôle qualité', 'Algorithmique métier'],
        },
      },
    },
  },
};

const graph = {
  downscaleFactor: 4,
  lineCache: new Map(),
  threads: [],
  instructions: [],
  init(size, numNails) {
    this.size = size;
    this.numNails = numNails;
    this.minJump = Math.max(2, Math.floor(numNails * 0.03));
    this.lineCache.clear();
    this.instructions = [];
    this.nailsPos = [];

    const center = size / 2;
    const radius = size / 2 - 12;
    for (let i = 0; i < numNails; i += 1) {
      const angle = (2 * Math.PI * i) / numNails;
      this.nailsPos.push(new Point(Math.round(center + radius * Math.cos(angle)), Math.round(center + radius * Math.sin(angle))));
    }
  },

  setupImageData(sourceData, colorMode) {
    const image = new ImageBuffer(sourceData, this.size, this.size);
    this.img = image;
    this.origData = new Uint8ClampedArray(sourceData);
    this.currentData = new Float32Array(sourceData.length);
    for (let i = 0; i < this.currentData.length; i += 4) {
      this.currentData[i] = 255;
      this.currentData[i + 1] = 255;
      this.currentData[i + 2] = 255;
      this.currentData[i + 3] = 255;
    }

    this.threads = [];
    if (!colorMode) {
      this.threads.push(new Thread(0, new Color(0, 0, 0, 255), this, 'noir'));
    } else {
      this.threads.push(new Thread(0, new Color(255, 0, 0, 255), this, 'rouge'));
      this.threads.push(new Thread(0, new Color(0, 255, 0, 255), this, 'vert'));
      this.threads.push(new Thread(0, new Color(0, 0, 255, 255), this, 'bleu'));
    }
  },

  getConnections(nailNum) {
    const ret = [];
    for (let i = 0; i < this.numNails; i += 1) {
      if (i === nailNum) {
        ret[i] = null;
        continue;
      }
      const key = `${Math.min(i, nailNum)}|${Math.max(i, nailNum)}`;
      if (this.lineCache.has(key)) {
        ret[i] = this.lineCache.get(key);
      } else {
        const line = new Line(nailNum, i, this);
        this.lineCache.set(key, line);
        ret[i] = line;
      }
    }
    return ret;
  },

  step() {
    let minThread = null;
    let minWeight = Infinity;

    for (let i = 0; i < this.threads.length; i += 1) {
      const weight = this.threads[i].getNextNailWeight();
      if (weight <= minWeight) {
        minWeight = weight;
        minThread = this.threads[i];
      }
    }

    if (!minThread || minWeight === Infinity) return false;
    return minThread.moveToNextNail();
  },
};

function refreshSummary() {
  const c = ui.colorMode.checked ? ' · mode couleur' : '';
  ui.summaryText.textContent = `${ui.nails.value} clous · ${ui.lines.value} fils · ${ui.size.value}px · épaisseur ${ui.lineWeight.value}${c}`;
}

function ensureSingleTrackMenu() {
  const menus = document.querySelectorAll('.track-menu-card');
  if (menus.length <= 1) return;
  menus.forEach((menu, index) => {
    if (index > 0) menu.remove();
  });
}

function fillSelect(select, entries) {
  select.innerHTML = '';
  entries.forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  });
}

function refreshTrackTopics() {
  if (!ui.trackPathway || !ui.trackMajor || !ui.trackGrade || !ui.trackTopics) return;
  const pathway = schoolTracks[ui.trackPathway.value];
  const major = pathway?.majors?.[ui.trackMajor.value];
  const topics = major?.grades?.[ui.trackGrade.value] || [];
  ui.trackTopics.innerHTML = '';
  topics.forEach((topic) => {
    const li = document.createElement('li');
    li.textContent = topic;
    ui.trackTopics.appendChild(li);
  });
}

function refreshTrackGrades() {
  if (!ui.trackPathway || !ui.trackMajor || !ui.trackGrade) return;
  const pathway = schoolTracks[ui.trackPathway.value];
  const major = pathway?.majors?.[ui.trackMajor.value];
  const grades = Object.keys(major?.grades || {}).map((grade) => [grade, grade[0].toUpperCase() + grade.slice(1)]);
  fillSelect(ui.trackGrade, grades);
  refreshTrackTopics();
}

function refreshTrackMajorsAndGrades() {
  if (!ui.trackPathway || !ui.trackMajor || !ui.trackGrade) return;
  const pathway = schoolTracks[ui.trackPathway.value];
  const majors = Object.entries(pathway.majors).map(([value, item]) => [value, item.label]);
  fillSelect(ui.trackMajor, majors);
  refreshTrackGrades();
}

function initTrackMenus() {
  if (!ui.trackPathway || !ui.trackMajor || !ui.trackGrade || !ui.trackTopics) return;
  const pathways = Object.entries(schoolTracks).map(([value, item]) => [value, item.label]);
  fillSelect(ui.trackPathway, pathways);
  refreshTrackMajorsAndGrades();
  ui.trackPathway.addEventListener('change', refreshTrackMajorsAndGrades);
  ui.trackMajor.addEventListener('change', refreshTrackGrades);
  ui.trackGrade.addEventListener('change', refreshTrackTopics);
}

function toGray(data) {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const g = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    out[i] = g;
    out[i + 1] = g;
    out[i + 2] = g;
    out[i + 3] = 255;
  }
  return out;
}

function drawSourceToData(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');

  const sourceRatio = state.sourceImage.width / state.sourceImage.height;
  let sx = 0; let sy = 0; let sw = state.sourceImage.width; let sh = state.sourceImage.height;
  if (sourceRatio > 1) {
    sw = state.sourceImage.height;
    sx = Math.floor((state.sourceImage.width - sw) / 2);
  } else {
    sh = state.sourceImage.width;
    sy = Math.floor((state.sourceImage.height - sh) / 2);
  }

  ctx.drawImage(state.sourceImage, sx, sy, sw, sh, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}

function renderInstructionsList(max = 300) {
  ui.instructionsList.innerHTML = '';
  state.instructions.slice(0, max).forEach((s) => {
    const li = document.createElement('li');
    li.textContent = `Clou ${s.start} → Clou ${s.end} (${s.color})`;
    ui.instructionsList.appendChild(li);
  });
  ui.stepsCount.textContent = String(state.instructions.length);
}

function drawSchema(size) {
  const ctx = ui.schemaCanvas.getContext('2d');
  ui.schemaCanvas.width = size;
  ui.schemaCanvas.height = size;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);

  const colors = { noir: '#111', rouge: '#d11', vert: '#198b19', bleu: '#1759e5' };
  state.instructions.forEach((s) => {
    const p1 = state.nailPoints[s.start];
    const p2 = state.nailPoints[s.end];
    ctx.strokeStyle = colors[s.color] || '#111';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  });

  ctx.fillStyle = '#000';
  ctx.font = '10px Arial';
  state.nailPoints.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(String(i), p.x + 6, p.y + 6);
  });
}

function drawResult(size) {
  const ctx = ui.resultCanvas.getContext('2d');
  ui.resultCanvas.width = size;
  ui.resultCanvas.height = size;
  ctx.fillStyle = '#f4eee1';
  ctx.fillRect(0, 0, size, size);

  const colors = {
    noir: 'rgba(20,20,20,0.15)',
    rouge: 'rgba(190,32,46,0.15)',
    vert: 'rgba(52,128,68,0.15)',
    bleu: 'rgba(40,90,170,0.15)',
  };

  state.instructions.forEach((step) => {
    const p1 = state.nailPoints[step.start];
    const p2 = state.nailPoints[step.end];
    ctx.strokeStyle = colors[step.color] || colors.noir;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  });

  const r = constrain(map(state.nailPoints.length, 40, 320, 2.8, 1.8), 1.8, 2.8);
  state.nailPoints.forEach((p) => {
    ctx.beginPath();
    ctx.fillStyle = '#555';
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawAnimationFrame(targetIndex) {
  const ctx = ui.animationCanvas.getContext('2d');
  const size = ui.animationCanvas.width;
  ctx.fillStyle = '#f4eee1';
  ctx.fillRect(0, 0, size, size);

  const colors = {
    noir: 'rgba(20,20,20,0.16)',
    rouge: 'rgba(190,32,46,0.16)',
    vert: 'rgba(52,128,68,0.16)',
    bleu: 'rgba(40,90,170,0.16)',
  };

  for (let i = 0; i < targetIndex; i += 1) {
    const step = state.instructions[i];
    const p1 = state.nailPoints[step.start];
    const p2 = state.nailPoints[step.end];
    ctx.strokeStyle = colors[step.color] || colors.noir;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  const r = constrain(map(state.nailPoints.length, 40, 320, 2.8, 1.8), 1.8, 2.8);
  state.nailPoints.forEach((p) => {
    ctx.beginPath();
    ctx.fillStyle = '#555';
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  });

  ui.animationStatus.textContent = `${targetIndex} / ${state.instructions.length} fils tracés`;
  ui.progressInput.value = String(targetIndex);
}

function resetAnimation() {
  state.anim.running = false;
  state.anim.index = 0;
  state.anim.accumulator = 0;
  state.anim.lastTs = undefined;
  drawAnimationFrame(0);
}

function tickAnimation(ts) {
  if (!state.anim.running) return;
  if (state.anim.lastTs === undefined) state.anim.lastTs = ts;
  const delta = (ts - state.anim.lastTs) / 1000;
  state.anim.lastTs = ts;
  state.anim.accumulator += delta;

  const speed = constrain(Number(ui.speedInput.value) || 1, 1, 240);
  const stepDuration = 1 / speed;
  while (state.anim.accumulator >= stepDuration && state.anim.index < state.instructions.length) {
    state.anim.index += 1;
    state.anim.accumulator -= stepDuration;
  }

  drawAnimationFrame(state.anim.index);
  if (state.anim.index >= state.instructions.length) {
    state.anim.running = false;
    return;
  }
  requestAnimationFrame(tickAnimation);
}

async function generate() {
  if (!state.sourceImage) {
    ui.status.textContent = 'Choisis une image avant de générer.';
    return;
  }

  state.cancel = false;
  state.anim.running = false;
  ui.generateBtn.disabled = true;

  const nails = Math.max(40, Math.min(320, Number(ui.nails.value) || 180));
  const lines = Math.max(50, Math.min(5000, Number(ui.lines.value) || 1200));
  const size = Math.max(300, Math.min(1000, Number(ui.size.value) || 760));
  const colorMode = ui.colorMode.checked;

  ui.progress.value = 5;
  ui.status.textContent = 'Préparation...';

  let source = drawSourceToData(size);
  if (!colorMode) source = toGray(source);

  graph.init(size, nails);
  graph.setupImageData(source, colorMode);

  state.nailPoints = graph.nailsPos;
  ui.resultCanvas.width = size;
  ui.resultCanvas.height = size;
  ui.schemaCanvas.width = size;
  ui.schemaCanvas.height = size;
  ui.animationCanvas.width = size;
  ui.animationCanvas.height = size;

  for (let i = 0; i < lines; i += 1) {
    if (state.cancel) break;
    const ok = graph.step();
    if (!ok) break;
    if (i % 8 === 0) {
      ui.progress.value = Math.floor((i / lines) * 100);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  state.instructions = graph.instructions;

  if (!state.cancel) {
    drawResult(size);
    drawSchema(size);
    renderInstructionsList();
    ui.progress.value = 100;
    ui.status.textContent = `Terminé: ${state.instructions.length} fils.`;
    ui.progressInput.max = String(state.instructions.length);
    resetAnimation();
  } else {
    ui.status.textContent = 'Génération annulée.';
  }

  ui.generateBtn.disabled = false;
}

function exportPng() {
  const a = document.createElement('a');
  a.href = ui.resultCanvas.toDataURL('image/png');
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
  pdf.addImage(ui.schemaCanvas.toDataURL('image/png'), 'PNG', 40, 60, 240, 240);
  pdf.addImage(ui.resultCanvas.toDataURL('image/png'), 'PNG', 310, 60, 240, 240);

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
    const presets = {
      fast: { nails: 120, lines: 600, size: 560, lw: 18, color: false },
      balanced: { nails: 180, lines: 1200, size: 760, lw: 16, color: false },
      detailed: { nails: 240, lines: 2200, size: 920, lw: 12, color: false },
      color: { nails: 200, lines: 1500, size: 820, lw: 14, color: true },
    };
    const v = presets[p];
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

ui.playBtn.addEventListener('click', () => {
  if (!state.instructions.length) return;
  if (state.anim.index >= state.instructions.length) resetAnimation();
  if (!state.anim.running) {
    state.anim.running = true;
    requestAnimationFrame(tickAnimation);
  }
});
ui.pauseBtn.addEventListener('click', () => { state.anim.running = false; });
ui.resetBtn.addEventListener('click', resetAnimation);
ui.progressInput.addEventListener('input', (e) => {
  state.anim.running = false;
  state.anim.index = constrain(Number(e.target.value) || 0, 0, state.instructions.length);
  drawAnimationFrame(state.anim.index);
});

refreshSummary();
ensureSingleTrackMenu();
initTrackMenus();
resetAnimation();
