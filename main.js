const assetInput = document.getElementById('assetInput');
const layerListContainer = document.getElementById('layerList');
const canvas = document.getElementById('previewCanvas');
const ctx = canvas.getContext('2d');
const canvasFrame = document.getElementById('canvasFrame');
const aspectSelect = document.getElementById('aspectSelect');

const currentTimeDisplay = document.getElementById('currentTimeDisplay');
const maxTimeDisplay = document.getElementById('maxTimeDisplay');
const timeSeeker = document.getElementById('timeSeeker');
const playBtn = document.getElementById('playBtn');
const recordBtn = document.getElementById('recordBtn');
const recordStatus = document.getElementById('recordStatus');

const offCanvas = document.createElement('canvas');
const offCtx = offCanvas.getContext('2d');

let layers = []; // [0]=最背面, [末尾]=最前面
let isPlaying = false;
let currentTime = 0;
let lastTimestamp = null;
let maxDuration = 10;

// アスペクト比変更
aspectSelect.addEventListener('change', () => {
  const [w, h] = aspectSelect.value.split('x').map(Number);
  canvas.width = w;
  canvas.height = h;
  canvasFrame.style.aspectRatio = `${w} / ${h}`;
  renderFrame();
});

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}

function updateTimelineBounds() {
  let highestEnd = 5;
  layers.forEach(l => {
    if (l.endTime > highestEnd) highestEnd = l.endTime;
  });
  maxDuration = Math.max(5, highestEnd);
  timeSeeker.max = maxDuration;
  maxTimeDisplay.textContent = formatTime(maxDuration);
}

// 素材追加イベント
assetInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files);

  files.forEach(file => {
    const url = URL.createObjectURL(file);
    const isVideo = file.type.startsWith('video/');

    const layer = {
      id: 'layer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      name: file.name,
      type: isVideo ? 'video' : 'image',
      element: isVideo ? document.createElement('video') : new Image(),
      ready: false,
      duration: isVideo ? 0 : 5,
      x: 0,
      y: 0,
      scale: 1.0,
      startTime: 0,
      endTime: 5,
      chromaEnabled: false,
      chromaThreshold: 1.2,
      minGreen: 80,
      collapsed: false
    };

    if (isVideo) {
      layer.element.src = url;
      layer.element.loop = true;
      layer.element.muted = true;
      layer.element.playsInline = true;
      layer.element.onloadedmetadata = () => {
        layer.ready = true;
        const dur = layer.element.duration || 10;
        layer.duration = dur;
        layer.startTime = 0;
        layer.endTime = parseFloat(dur.toFixed(2));
        updateTimelineBounds();
        renderAllLayerCards();
        renderFrame();
      };
    } else {
      layer.element.src = url;
      layer.element.onload = () => {
        layer.ready = true;
        layer.startTime = 0;
        layer.endTime = 5;
        updateTimelineBounds();
        renderAllLayerCards();
        renderFrame();
      };
    }

    layers.push(layer);
  });

  assetInput.value = '';
});

// レイヤーカード全体の描画
function renderAllLayerCards() {
  layerListContainer.innerHTML = '';

  layers.forEach((layer, index) => {
    const card = document.createElement('div');
    card.className = 'layer-card';
    card.id = `card_${layer.id}`;

    const durText = layer.type === 'video' ? `${layer.duration.toFixed(1)}s (動画)` : '5.0s (静止画)';
    const foldText = layer.collapsed ? '開く ▼' : '閉じる ▲';

    card.innerHTML = `
      <div class="layer-card-header">
        <div class="header-left">
          <button type="button" class="btn white-fold-btn" id="fold_btn_${layer.id}">${foldText}</button>
          <input type="text" class="layer-name-input" id="name_input_${layer.id}" value="${layer.name}" title="クリックして名前を変更" />
          <span class="duration-badge">${durText}</span>
        </div>
        <div class="header-actions">
          <button type="button" class="btn white-icon-btn" data-action="up" title="背面へ (上へ)">▲</button>
          <button type="button" class="btn white-icon-btn" data-action="down" title="前面へ (下へ)">▼</button>
          <button type="button" class="btn white-icon-btn delete" data-action="delete" title="削除">✕</button>
        </div>
      </div>

      <div class="layer-card-body" id="body_${layer.id}" style="display: ${layer.collapsed ? 'none' : 'flex'};">
        <div class="control-row">
          <label>表示開始 (秒):
            <input type="number" step="0.1" min="0" value="${layer.startTime}" data-prop="startTime" />
          </label>
          <label>表示終了 (秒):
            <input type="number" step="0.1" min="0.1" value="${layer.endTime}" data-prop="endTime" />
          </label>
        </div>

        <div class="control-row">
          <label>位置 X (%):
            <input type="range" min="-100" max="100" value="${layer.x}" data-prop="x" />
          </label>
          <label>位置 Y (%):
            <input type="range" min="-100" max="100" value="${layer.y}" data-prop="y" />
          </label>
        </div>

        <div class="control-row">
          <label>拡大率:
            <input type="range" min="0.1" max="3.0" step="0.05" value="${layer.scale}" data-prop="scale" />
          </label>
          <div class="chroma-toggle">
            <input type="checkbox" id="ck_${layer.id}" data-prop="chromaEnabled" ${layer.chromaEnabled ? 'checked' : ''} />
            <label for="ck_${layer.id}">グリーンバック透過</label>
          </div>
        </div>

        <div class="chroma-controls" id="chroma_box_${layer.id}" style="display: ${layer.chromaEnabled ? 'block' : 'none'};">
          <div class="control-row">
            <label>緑判定感度:
              <input type="range" min="1.0" max="2.0" step="0.05" value="${layer.chromaThreshold}" data-prop="chromaThreshold" />
            </label>
            <label>最低緑輝度:
              <input type="range" min="20" max="200" step="5" value="${layer.minGreen}" data-prop="minGreen" />
            </label>
          </div>
        </div>
      </div>
    `;

    // 1. 折りたたみ・展開ボタン
    const foldBtn = card.querySelector(`#fold_btn_${layer.id}`);
    const cardBody = card.querySelector(`#body_${layer.id}`);

    foldBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      layer.collapsed = !layer.collapsed;
      if (layer.collapsed) {
        cardBody.style.display = 'none';
        foldBtn.textContent = '開く ▼';
      } else {
        cardBody.style.display = 'flex';
        foldBtn.textContent = '閉じる ▲';
      }
    });

    // 2. 素材名変更イベント
    const nameInput = card.querySelector(`#name_input_${layer.id}`);
    nameInput.addEventListener('input', (e) => {
      layer.name = e.target.value;
    });

    // 3. 順序入れ替え・削除ボタン
    card.querySelectorAll('.header-actions button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        if (action === 'up' && index > 0) {
          [layers[index - 1], layers[index]] = [layers[index], layers[index - 1]];
          renderAllLayerCards();
          renderFrame();
        } else if (action === 'down' && index < layers.length - 1) {
          [layers[index + 1], layers[index]] = [layers[index], layers[index + 1]];
          renderAllLayerCards();
          renderFrame();
        } else if (action === 'delete') {
          layers = layers.filter(l => l.id !== layer.id);
          renderAllLayerCards();
          updateTimelineBounds();
          renderFrame();
        }
      });
    });

    // 4. 入力変更イベント
    card.querySelectorAll('.layer-card-body input').forEach(input => {
      input.addEventListener('input', (e) => {
        const prop = e.target.dataset.prop;
        if (e.target.type === 'checkbox') {
          layer[prop] = e.target.checked;
          const chromaBox = card.querySelector(`#chroma_box_${layer.id}`);
          chromaBox.style.display = e.target.checked ? 'block' : 'none';
        } else {
          layer[prop] = parseFloat(e.target.value);
          if (prop === 'endTime' || prop === 'startTime') {
            updateTimelineBounds();
          }
        }
        renderFrame();
      });
    });

    layerListContainer.appendChild(card);
  });
}

// 再生 / 一時停止
playBtn.addEventListener('click', () => {
  isPlaying = !isPlaying;
  playBtn.textContent = isPlaying ? '⏸ 一時停止' : '▶ 再生';
  if (isPlaying) {
    lastTimestamp = performance.now();
    requestAnimationFrame(animationLoop);
  }
});

// シークバー
timeSeeker.addEventListener('input', (e) => {
  currentTime = parseFloat(e.target.value);
  currentTimeDisplay.textContent = formatTime(currentTime);
  syncVideosToTime();
  renderFrame();
});

function syncVideosToTime() {
  layers.forEach(layer => {
    if (layer.type === 'video' && layer.ready) {
      if (currentTime >= layer.startTime && currentTime <= layer.endTime) {
        const dur = layer.element.duration || 1;
        const offset = (currentTime - layer.startTime) % dur;
        layer.element.currentTime = offset;
      }
    }
  });
}

function animationLoop(timestamp) {
  if (!isPlaying) return;

  const delta = (timestamp - lastTimestamp) / 1000;
  lastTimestamp = timestamp;

  currentTime += delta;
  if (currentTime > maxDuration) {
    currentTime = 0;
  }

  timeSeeker.value = currentTime;
  currentTimeDisplay.textContent = formatTime(currentTime);

  layers.forEach(layer => {
    if (layer.type === 'video' && layer.ready) {
      if (currentTime >= layer.startTime && currentTime <= layer.endTime) {
        if (layer.element.paused) layer.element.play();
      } else {
        if (!layer.element.paused) layer.element.pause();
      }
    }
  });

  renderFrame();
  requestAnimationFrame(animationLoop);
}

// レンダリング
function renderFrame() {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  layers.forEach(layer => {
    if (!layer.ready) return;
    if (currentTime < layer.startTime || currentTime > layer.endTime) return;

    const elem = layer.element;
    const origW = layer.type === 'video' ? elem.videoWidth : elem.width;
    const origH = layer.type === 'video' ? elem.videoHeight : elem.height;
    if (!origW || !origH) return;

    const drawW = canvas.width * layer.scale;
    const drawH = (origH / origW) * drawW;

    const posX = (canvas.width - drawW) / 2 + (layer.x / 100) * canvas.width;
    const posY = (canvas.height - drawH) / 2 + (layer.y / 100) * canvas.height;

    if (layer.chromaEnabled) {
      offCanvas.width = origW;
      offCanvas.height = origH;
      offCtx.drawImage(elem, 0, 0, origW, origH);
      const frame = offCtx.getImageData(0, 0, origW, origH);
      const data = frame.data;

      const thresh = layer.chromaThreshold;
      const minG = layer.minGreen;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        if (g > minG && g > r * thresh && g > b * thresh) {
          data[i + 3] = 0;
        }
      }
      offCtx.putImageData(frame, 0, 0);
      ctx.drawImage(offCanvas, posX, posY, drawW, drawH);
    } else {
      ctx.drawImage(elem, posX, posY, drawW, drawH);
    }
  });
}

// 動画書き出し
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

recordBtn.addEventListener('click', () => {
  if (!isRecording) {
    startExport();
  } else {
    stopExport();
  }
});

function startExport() {
  if (layers.length === 0) {
    alert("素材を1つ以上追加してください。");
    return;
  }

  currentTime = 0;
  timeSeeker.value = 0;
  currentTimeDisplay.textContent = formatTime(0);
  syncVideosToTime();

  const stream = canvas.captureStream(30);
  let options = { mimeType: 'video/webm;codecs=vp9' };
  if (!MediaRecorder.isTypeSupported(options.mimeType)) {
    options = { mimeType: 'video/webm' };
  }

  recordedChunks = [];
  try {
    mediaRecorder = new MediaRecorder(stream, options);
  } catch (e) {
    alert("録画の初期化に失敗しました。");
    return;
  }

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: options.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `video_export_${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);

    recordStatus.textContent = '保存完了！動画がダウンロードされました。';
    setTimeout(() => { recordStatus.textContent = ''; }, 3500);
  };

  mediaRecorder.start();
  isRecording = true;
  recordBtn.textContent = '録画停止 (保存)';
  recordStatus.textContent = '● タイムラインを録画・書き出し中...';

  if (!isPlaying) {
    playBtn.click();
  }
}

function stopExport() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  isRecording = false;
  recordBtn.textContent = '動画を録画・保存';
  recordStatus.textContent = 'ファイルを生成中...';
}

updateTimelineBounds();
renderFrame();
