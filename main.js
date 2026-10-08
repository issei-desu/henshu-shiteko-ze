const assetInput = document.getElementById('assetInput');
const addTextBtn = document.getElementById('addTextBtn');
const layerListContainer = document.getElementById('layerList');
const canvas = document.getElementById('previewCanvas');
const ctx = canvas.getContext('2d');
const canvasFrame = document.getElementById('canvasFrame');
const aspectSelect = document.getElementById('aspectSelect');
const formatSelect = document.getElementById('formatSelect');

const modeControlArea = document.getElementById('modeControlArea');
const durationSettingRow = document.getElementById('durationSettingRow');
const exportDurationInput = document.getElementById('exportDurationInput');
const useTimelineMaxBtn = document.getElementById('useTimelineMaxBtn');
const shareActionArea = document.getElementById('shareActionArea');
const saveToPhotosBtn = document.getElementById('saveToPhotosBtn');
const imagePreviewArea = document.getElementById('imagePreviewArea');
const modeTabs = document.querySelectorAll('.mode-tab');

const modeAutoBtn = document.getElementById('modeAutoBtn');
const modePcBtn = document.getElementById('modePcBtn');
const modeMobileBtn = document.getElementById('modeMobileBtn');

const saveProjectBtn = document.getElementById('saveProjectBtn');
const loadProjectInput = document.getElementById('loadProjectInput');
const resetProjectBtn = document.getElementById('resetProjectBtn');
const saveBadge = document.getElementById('saveBadge');

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

// エクスポート・録画関連の状態
let currentExportMode = 'instant'; // 'instant' | 'timer' | 'manual'
let isRecording = false;
let isRecordingGif = false;
let isExportingGif = false;
let recordedChunks = [];
let recordedSeconds = 0;
let exportTargetDuration = 5;
let gifRecordedFrames = [];
let lastGifCaptureTime = 0;
let activeRecordingExt = 'mp4';

let lastExportedFile = null;
let lastExportedBlob = null;
let lastExportedUrl = null;

// ========================================================
// 超軽量・容量ゼロの保存・復元システム (localStorage / JSON)
// ========================================================
const STORAGE_KEY = 'chroma_video_editor_autosave_v1';
let autoSaveTimer = null;

function getProjectData() {
  return {
    version: '1.0',
    timestamp: Date.now(),
    aspectRatio: aspectSelect.value,
    exportFormat: formatSelect ? formatSelect.value : 'mp4',
    exportMode: currentExportMode,
    exportDuration: exportDurationInput ? parseFloat(exportDurationInput.value) || 5 : 5,
    layers: layers.map(l => {
      const base = {
        id: l.id,
        name: l.name,
        type: l.type,
        duration: l.duration,
        startTime: l.startTime,
        endTime: l.endTime,
        x: l.x,
        y: l.y,
        scale: l.scale,
        collapsed: !!l.collapsed
      };
      if (l.type === 'text') {
        base.text = l.text;
        base.fontSize = l.fontSize;
        base.color = l.color;
        base.strokeColor = l.strokeColor;
        base.strokeWidth = l.strokeWidth;
      } else {
        base.chromaEnabled = l.chromaEnabled;
        base.chromaThreshold = l.chromaThreshold;
        base.minGreen = l.minGreen;
      }
      return base;
    })
  };
}

function triggerAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    try {
      const data = getProjectData();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      if (saveBadge) {
        saveBadge.textContent = '⚡ 保存完了';
        saveBadge.style.color = '#4ade80';
      }
    } catch (e) {
      console.warn('自動保存エラー:', e);
    }
  }, 400);
}

function loadProject(project) {
  if (!project || !Array.isArray(project.layers)) return;

  if (project.aspectRatio) {
    aspectSelect.value = project.aspectRatio;
    const [w, h] = project.aspectRatio.split('x').map(Number);
    canvas.width = w;
    canvas.height = h;
    canvasFrame.style.aspectRatio = `${w} / ${h}`;
  }

  if (project.exportFormat && formatSelect) {
    const opt = formatSelect.querySelector(`option[value="${project.exportFormat}"]`);
    if (opt && !opt.disabled) {
      formatSelect.value = project.exportFormat;
    }
  }

  if (project.exportMode && typeof setExportMode === 'function') {
    setExportMode(project.exportMode);
  }

  if (project.exportDuration && exportDurationInput) {
    exportDurationInput.value = project.exportDuration;
    exportTargetDuration = project.exportDuration;
  }

  layers = project.layers.map(saved => {
    if (saved.type === 'text') {
      return {
        ...saved,
        ready: true
      };
    } else {
      const isVideo = saved.type === 'video';
      const dummyElem = isVideo ? document.createElement('video') : new Image();
      return {
        ...saved,
        element: dummyElem,
        ready: false,
        needsRelink: true
      };
    }
  });

  updateTimelineBounds();
  renderAllLayerCards();
  renderFrame();
}

// アスペクト比変更
aspectSelect.addEventListener('change', () => {
  const [w, h] = aspectSelect.value.split('x').map(Number);
  canvas.width = w;
  canvas.height = h;
  canvasFrame.style.aspectRatio = `${w} / ${h}`;
  renderFrame();
  triggerAutoSave();
});

if (formatSelect) {
  formatSelect.addEventListener('change', () => {
    triggerAutoSave();
  });
}

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
        triggerAutoSave();
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
        triggerAutoSave();
      };
    }

    layers.push(layer);
  });

  assetInput.value = '';
  triggerAutoSave();
});

// テキスト追加イベント
addTextBtn.addEventListener('click', () => {
  const textCount = layers.filter(l => l.type === 'text').length + 1;
  const layer = {
    id: 'layer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    name: `テキスト ${textCount}`,
    type: 'text',
    text: 'テキストを入力',
    ready: true,
    duration: 5,
    fontSize: 60,
    color: '#ffffff',
    strokeColor: '#000000',
    strokeWidth: 4,
    x: 0,
    y: 0,
    scale: 1.0,
    startTime: 0,
    endTime: 5,
    collapsed: false
  };

  layers.push(layer);
  updateTimelineBounds();
  renderAllLayerCards();
  renderFrame();
  triggerAutoSave();
});

// レイヤーカード全体の描画
function renderAllLayerCards() {
  layerListContainer.innerHTML = '';

  layers.forEach((layer, index) => {
    const card = document.createElement('div');
    card.className = 'layer-card';
    card.id = `card_${layer.id}`;

    let durText = '5.0s (静止画)';
    if (layer.type === 'video') {
      durText = `${layer.duration.toFixed(1)}s (動画)`;
    } else if (layer.type === 'text') {
      durText = `${layer.duration.toFixed(1)}s (テキスト)`;
    }
    const foldText = layer.collapsed ? '開く ▼' : '閉じる ▲';

    let relinkHTML = '';
    if (layer.type !== 'text' && layer.needsRelink && !layer.ready) {
      relinkHTML = `
        <div class="relink-alert">
          <span class="relink-text">⚠️ 素材ファイルの再読み込みが必要です（${layer.name}）</span>
          <label class="btn white-btn relink-btn">
            📁 同じ（または新しい）ファイルを選択
            <input type="file" class="relink-input" accept="${layer.type === 'video' ? 'video/*' : 'image/*'}" hidden />
          </label>
        </div>
      `;
    }

    let controlsHTML = '';
    if (layer.type === 'text') {
      controlsHTML = `
        <div class="control-full">
          <label>テキスト内容:
            <textarea data-prop="text" rows="2">${layer.text || ''}</textarea>
          </label>
        </div>

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
          <label>位置 Y (% 上下):
            <input type="range" min="-100" max="100" value="${layer.y}" data-prop="y" />
          </label>
        </div>

        <div class="control-row">
          <label>文字サイズ:
            <input type="range" min="16" max="150" step="1" value="${layer.fontSize || 60}" data-prop="fontSize" />
          </label>
          <label>拡大率:
            <input type="range" min="0.1" max="3.0" step="0.05" value="${layer.scale}" data-prop="scale" />
          </label>
        </div>

        <div class="control-row">
          <label>文字色:
            <input type="color" value="${layer.color || '#ffffff'}" data-prop="color" />
          </label>
          <label>縁取り色:
            <input type="color" value="${layer.strokeColor || '#000000'}" data-prop="strokeColor" />
          </label>
        </div>

        <div class="control-row">
          <label>縁取り太さ:
            <input type="range" min="0" max="20" step="1" value="${layer.strokeWidth !== undefined ? layer.strokeWidth : 4}" data-prop="strokeWidth" />
          </label>
          <div></div>
        </div>
      `;
    } else {
      controlsHTML = `
        ${relinkHTML}
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
          <label>位置 Y (% 上下):
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
      `;
    }

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
        ${controlsHTML}
      </div>
    `;

    // 再リンクファイル選択リスナー
    const relinkInput = card.querySelector('.relink-input');
    if (relinkInput) {
      relinkInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        layer.name = file.name;
        const isVideo = file.type.startsWith('video/') || layer.type === 'video';
        if (isVideo) {
          layer.element = document.createElement('video');
          layer.element.src = url;
          layer.element.loop = true;
          layer.element.muted = true;
          layer.element.playsInline = true;
          layer.element.onloadedmetadata = () => {
            layer.ready = true;
            layer.needsRelink = false;
            renderAllLayerCards();
            renderFrame();
            triggerAutoSave();
          };
        } else {
          layer.element = new Image();
          layer.element.src = url;
          layer.element.onload = () => {
            layer.ready = true;
            layer.needsRelink = false;
            renderAllLayerCards();
            renderFrame();
            triggerAutoSave();
          };
        }
      });
    }

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
      triggerAutoSave();
    });

    // 2. 素材名変更イベント
    const nameInput = card.querySelector(`#name_input_${layer.id}`);
    nameInput.addEventListener('input', (e) => {
      layer.name = e.target.value;
      triggerAutoSave();
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
          triggerAutoSave();
        } else if (action === 'down' && index < layers.length - 1) {
          [layers[index + 1], layers[index]] = [layers[index], layers[index + 1]];
          renderAllLayerCards();
          renderFrame();
          triggerAutoSave();
        } else if (action === 'delete') {
          layers = layers.filter(l => l.id !== layer.id);
          renderAllLayerCards();
          updateTimelineBounds();
          renderFrame();
          triggerAutoSave();
        }
      });
    });

    // 4. 入力変更イベント
    card.querySelectorAll('.layer-card-body input, .layer-card-body textarea').forEach(input => {
      input.addEventListener('input', (e) => {
        const prop = e.target.dataset.prop;
        if (!prop) return;
        if (e.target.type === 'checkbox') {
          layer[prop] = e.target.checked;
          const chromaBox = card.querySelector(`#chroma_box_${layer.id}`);
          if (chromaBox) chromaBox.style.display = e.target.checked ? 'block' : 'none';
        } else if (e.target.type === 'color' || e.target.tagName === 'TEXTAREA') {
          layer[prop] = e.target.value;
        } else {
          layer[prop] = parseFloat(e.target.value);
          if (prop === 'endTime' || prop === 'startTime') {
            updateTimelineBounds();
          }
        }
        renderFrame();
        triggerAutoSave();
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

  // 録画・書き出し中の進捗計測 ＆ 自動停止処理
  if (isRecording) {
    recordedSeconds += delta;

    if (isRecordingGif) {
      // 10fps (約100msごと) にフレームをキャプチャ
      if (timestamp - lastGifCaptureTime >= 100) {
        lastGifCaptureTime = timestamp;
        captureGifFrame();
      }
    }

    if (currentExportMode === 'instant' || currentExportMode === 'timer') {
      const progress = Math.min(100, Math.round((recordedSeconds / exportTargetDuration) * 100));
      const modeLabel = currentExportMode === 'instant' ? '⚡ 高速書き出し中' : '⏱️ 指定秒数録画中';
      recordStatus.innerHTML = `<span>● ${modeLabel} (${activeRecordingExt.toUpperCase()}): <strong>${recordedSeconds.toFixed(1)}s / ${exportTargetDuration.toFixed(1)}s (${progress}%)</strong></span>`;

      if (recordedSeconds >= exportTargetDuration) {
        stopExport();
        return;
      }
    } else {
      recordStatus.innerHTML = `<span>● 自由録画中 (${activeRecordingExt.toUpperCase()}): <strong>${recordedSeconds.toFixed(1)}秒 経過</strong> [停止ボタンで保存]</span>`;
    }
  }

  requestAnimationFrame(animationLoop);
}

// レンダリング
function renderFrame() {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  layers.forEach(layer => {
    if (!layer.ready) return;
    if (currentTime < layer.startTime || currentTime > layer.endTime) return;

    // --- テキストレイヤーの描画 ---
    if (layer.type === 'text') {
      const computedFontSize = (layer.fontSize || 60) * (layer.scale || 1.0);
      ctx.save();
      ctx.font = `bold ${computedFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const lines = (layer.text || '').split('\n');
      const lineHeight = computedFontSize * 1.3;
      const totalHeight = lines.length * lineHeight;

      // 画面中央基準 + オフセット (Y軸反転: 上がプラス、下がマイナス)
      const posX = canvas.width / 2 + (layer.x / 100) * canvas.width;
      const posY = canvas.height / 2 - (layer.y / 100) * canvas.height;

      const startY = posY - (totalHeight / 2) + (lineHeight / 2);

      lines.forEach((line, i) => {
        const curY = startY + i * lineHeight;
        const strokeW = (layer.strokeWidth !== undefined ? layer.strokeWidth : 4) * (layer.scale || 1.0);
        if (strokeW > 0) {
          ctx.lineWidth = strokeW * 2;
          ctx.strokeStyle = layer.strokeColor || '#000000';
          ctx.lineJoin = 'round';
          ctx.miterLimit = 2;
          ctx.strokeText(line, posX, curY);
        }
        ctx.fillStyle = layer.color || '#ffffff';
        ctx.fillText(line, posX, curY);
      });
      ctx.restore();
      return;
    }

    // --- 画像 / 動画レイヤーの描画 ---
    const elem = layer.element;
    const origW = layer.type === 'video' ? elem.videoWidth : elem.width;
    const origH = layer.type === 'video' ? elem.videoHeight : elem.height;
    if (!origW || !origH) return;

    const drawW = canvas.width * layer.scale;
    const drawH = (origH / origW) * drawW;

    // Y軸反転: (canvas.height - drawH) / 2 - (layer.y / 100) * canvas.height
    const posX = (canvas.width - drawW) / 2 + (layer.x / 100) * canvas.width;
    const posY = (canvas.height - drawH) / 2 - (layer.y / 100) * canvas.height;

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

// ========================================================
// 動画・静止画・GIF 書き出し ＆ 3つの保存方式システム
// ========================================================
let mediaRecorder = null;
const gifMaxDim = 640;
let gifTempCanvas = null;
let gifTempCtx = null;

function dataURLtoBlob(dataurl) {
  const arr = dataurl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

function captureGifFrame() {
  if (!gifTempCanvas) {
    gifTempCanvas = document.createElement('canvas');
    let targetW = canvas.width;
    let targetH = canvas.height;
    if (targetW > gifMaxDim || targetH > gifMaxDim) {
      if (targetW >= targetH) {
        targetH = Math.round((targetH * gifMaxDim) / targetW);
        targetW = gifMaxDim;
      } else {
        targetW = Math.round((targetW * gifMaxDim) / targetH);
        targetH = gifMaxDim;
      }
    }
    gifTempCanvas.width = targetW;
    gifTempCanvas.height = targetH;
    gifTempCtx = gifTempCanvas.getContext('2d');
  }

  gifTempCtx.drawImage(canvas, 0, 0, gifTempCanvas.width, gifTempCanvas.height);
  gifRecordedFrames.push(gifTempCanvas.toDataURL('image/jpeg', 0.8));
}

function processRecordedGif() {
  if (gifRecordedFrames.length === 0) {
    alert('キャプチャされたフレームがありません。');
    isRecording = false;
    isRecordingGif = false;
    updateExportUIState();
    return;
  }

  recordStatus.textContent = `GIFエンコード中 (${gifRecordedFrames.length}フレーム)...`;
  if (recordBtn) recordBtn.disabled = true;

  if (typeof gifshot !== 'undefined') {
    gifshot.createGIF({
      images: gifRecordedFrames,
      gifWidth: gifTempCanvas.width,
      gifHeight: gifTempCanvas.height,
      interval: 0.1,
      numWorkers: 2,
      progressCallback: (p) => {
        recordStatus.textContent = `GIFエンコード中: ${Math.round(p * 100)}%`;
      }
    }, (obj) => {
      isRecording = false;
      isRecordingGif = false;
      if (recordBtn) recordBtn.disabled = false;
      updateExportUIState();

      if (obj.error) {
        alert('GIF生成に失敗しました: ' + obj.error);
        recordStatus.textContent = '';
        return;
      }

      const blob = dataURLtoBlob(obj.image);
      handleExportDone(blob, 'gif');
    });
  } else {
    alert('GIFライブラリ (gifshot) が読み込まれていません。');
    isRecording = false;
    isRecordingGif = false;
    if (recordBtn) recordBtn.disabled = false;
    updateExportUIState();
  }
}

async function exportInstantGif(targetDuration) {
  if (layers.length === 0) {
    alert("素材を1つ以上追加してください。");
    return;
  }
  isExportingGif = true;
  if (recordBtn) {
    recordBtn.disabled = true;
    recordBtn.textContent = '⌛ フレーム抽出中...';
  }

  const fps = 10;
  const duration = Math.max(0.5, Math.min(targetDuration, maxDuration || 10));
  const totalFrames = Math.max(1, Math.round(duration * fps));
  const stepTime = duration / totalFrames;

  let targetW = canvas.width;
  let targetH = canvas.height;
  if (targetW > gifMaxDim || targetH > gifMaxDim) {
    if (targetW >= targetH) {
      targetH = Math.round((targetH * gifMaxDim) / targetW);
      targetW = maxDim;
    } else {
      targetW = Math.round((targetW * gifMaxDim) / targetH);
      targetH = gifMaxDim;
    }
  }

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = targetW;
  tempCanvas.height = targetH;
  const tempCtx = tempCanvas.getContext('2d');
  const frames = [];

  const prevTime = currentTime;
  for (let i = 0; i < totalFrames; i++) {
    currentTime = i * stepTime;
    timeSeeker.value = currentTime;
    currentTimeDisplay.textContent = formatTime(currentTime);
    syncVideosToTime();
    renderFrame();

    tempCtx.drawImage(canvas, 0, 0, targetW, targetH);
    frames.push(tempCanvas.toDataURL('image/jpeg', 0.8));

    if (i % 4 === 0 || i === totalFrames - 1) {
      recordStatus.textContent = `GIFフレーム抽出中 (${i + 1} / ${totalFrames})...`;
      await new Promise(r => setTimeout(r, 10));
    }
  }

  currentTime = prevTime;
  timeSeeker.value = currentTime;
  currentTimeDisplay.textContent = formatTime(currentTime);
  syncVideosToTime();
  renderFrame();

  recordStatus.textContent = 'GIFエンコード中 (少々お待ちください)...';

  if (typeof gifshot !== 'undefined') {
    gifshot.createGIF({
      images: frames,
      gifWidth: targetW,
      gifHeight: targetH,
      interval: stepTime,
      numWorkers: 2,
      progressCallback: (p) => {
        recordStatus.textContent = `GIFエンコード中: ${Math.round(p * 100)}%`;
      }
    }, (obj) => {
      isExportingGif = false;
      if (recordBtn) recordBtn.disabled = false;
      updateExportUIState();

      if (obj.error) {
        alert("GIF生成に失敗しました: " + obj.error);
        recordStatus.textContent = '';
        return;
      }
      const blob = dataURLtoBlob(obj.image);
      handleExportDone(blob, 'gif');
    });
  } else {
    alert("GIFライブラリが読み込まれていません。");
    isExportingGif = false;
    if (recordBtn) recordBtn.disabled = false;
    updateExportUIState();
  }
}

function exportStaticImage(ext) {
  if (layers.length === 0) {
    alert("素材を1つ以上追加してください。");
    return;
  }
  renderFrame();
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  canvas.toBlob((blob) => {
    if (!blob) {
      alert("画像の書き出しに失敗しました。");
      return;
    }
    handleExportDone(blob, ext);
  }, mime, 0.95);
}

function handleExportDone(blob, ext) {
  const mimeType = blob.type || (ext === 'mp4' ? 'video/mp4' : (ext === 'gif' ? 'image/gif' : (ext === 'png' ? 'image/png' : (ext === 'jpg' ? 'image/jpeg' : 'video/webm'))));
  const filename = `video_export_${Date.now()}.${ext}`;
  const file = new File([blob], filename, { type: mimeType });
  lastExportedFile = file;
  lastExportedBlob = blob;
  lastExportedUrl = URL.createObjectURL(blob);

  // 通常ダウンロード (PC/ブラウザ)
  const a = document.createElement('a');
  a.href = lastExportedUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
  }, 250);

  recordStatus.innerHTML = `<span style="color:#00ffaa;font-weight:bold;">✅ 保存完了！</span> (${ext.toUpperCase()} 形式で保存されました)`;

  // iPhone / スマホ用 カメラロール保存エリアを表示
  if (shareActionArea) {
    shareActionArea.style.display = 'flex';
    if (saveToPhotosBtn) {
      if (ext === 'png' || ext === 'jpg' || ext === 'gif') {
        saveToPhotosBtn.textContent = '📱 カメラロール（写真）に保存 / 共有';
      } else {
        saveToPhotosBtn.textContent = '📱 iPhoneカメラロールに保存 (共有)';
      }
    }
    if (imagePreviewArea) {
      if (ext === 'png' || ext === 'jpg' || ext === 'gif') {
        imagePreviewArea.innerHTML = `<img src="${lastExportedUrl}" style="max-width:100%; max-height:160px; border-radius:6px; margin-top:6px; border:1px solid #444;" alt="プレビュー" /><div style="font-size:0.72rem; color:#8da4c4; margin-top:4px;">※iPhoneは画像を長押しして「写真に追加」も可能です</div>`;
        imagePreviewArea.style.display = 'block';
      } else {
        imagePreviewArea.style.display = 'none';
        imagePreviewArea.innerHTML = '';
      }
    }
  }

  updateExportUIState();
}

function updateExportUIState() {
  const selectedFormat = formatSelect ? formatSelect.value : 'mp4';

  if (modeTabs) {
    modeTabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.mode === currentExportMode);
    });
  }

  // 静止画形式の場合
  if (selectedFormat === 'png' || selectedFormat === 'jpg') {
    if (modeControlArea) modeControlArea.style.display = 'none';
    if (durationSettingRow) durationSettingRow.style.display = 'none';
    if (recordBtn) {
      recordBtn.textContent = `📷 静止画を保存 (.${selectedFormat})`;
      recordBtn.classList.remove('recording');
      recordBtn.disabled = false;
    }
    return;
  }

  // 動画・GIFの場合
  if (modeControlArea) modeControlArea.style.display = 'block';

  if (currentExportMode === 'manual') {
    if (durationSettingRow) durationSettingRow.style.display = 'none';
  } else {
    if (durationSettingRow) durationSettingRow.style.display = 'block';
  }

  if (recordBtn) {
    if (isRecording) {
      recordBtn.textContent = `⏹️ 録画停止 (保存)`;
      recordBtn.classList.add('recording');
      recordBtn.disabled = false;
    } else {
      recordBtn.classList.remove('recording');
      if (selectedFormat === 'gif') {
        if (currentExportMode === 'instant') {
          recordBtn.textContent = '⚡ GIFをその場で保存 (.gif)';
        } else if (currentExportMode === 'timer') {
          recordBtn.textContent = '⏱️ 指定秒数でGIF録画 (.gif)';
        } else {
          recordBtn.textContent = '🔴 GIF録画開始 (.gif)';
        }
      } else {
        const extUpper = selectedFormat.toUpperCase();
        if (currentExportMode === 'instant') {
          recordBtn.textContent = `⚡ その場で保存 (${extUpper})`;
        } else if (currentExportMode === 'timer') {
          recordBtn.textContent = `⏱️ 指定秒数で録画開始 (${extUpper})`;
        } else {
          recordBtn.textContent = `🔴 録画開始 (${extUpper})`;
        }
      }
    }
  }
}

function setExportMode(mode) {
  currentExportMode = mode;
  updateExportUIState();
  triggerAutoSave();
}

if (modeTabs) {
  modeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      if (isRecording) return;
      setExportMode(tab.dataset.mode);
    });
  });
}

if (formatSelect) {
  formatSelect.addEventListener('change', () => {
    updateExportUIState();
    triggerAutoSave();
  });
}

if (useTimelineMaxBtn && exportDurationInput) {
  useTimelineMaxBtn.addEventListener('click', () => {
    const val = Math.max(1, Math.min(180, Math.round(maxDuration * 10) / 10));
    exportDurationInput.value = val;
    exportTargetDuration = val;
    triggerAutoSave();
  });
}

if (exportDurationInput) {
  exportDurationInput.addEventListener('change', () => {
    exportTargetDuration = parseFloat(exportDurationInput.value) || 5;
    triggerAutoSave();
  });
}

if (recordBtn) {
  recordBtn.addEventListener('click', () => {
    if (!isRecording) {
      startExport();
    } else {
      stopExport();
    }
  });
}

function startExport() {
  if (layers.length === 0) {
    alert("素材を1つ以上追加してください。");
    return;
  }

  const selectedFormat = formatSelect ? formatSelect.value : 'mp4';

  // 静止画の場合
  if (selectedFormat === 'png' || selectedFormat === 'jpg') {
    exportStaticImage(selectedFormat);
    return;
  }

  const dur = parseFloat(exportDurationInput ? exportDurationInput.value : 5) || 5;

  // GIFアニメーションの場合
  if (selectedFormat === 'gif') {
    if (currentExportMode === 'instant') {
      exportInstantGif(dur);
      return;
    }
    // timer または manual モード
    isRecording = true;
    isRecordingGif = true;
    gifRecordedFrames = [];
    gifTempCanvas = null;
    recordedSeconds = 0;
    exportTargetDuration = dur;
    activeRecordingExt = 'gif';
    lastGifCaptureTime = performance.now();
    captureGifFrame();

    currentTime = 0;
    timeSeeker.value = 0;
    currentTimeDisplay.textContent = formatTime(0);
    syncVideosToTime();

    updateExportUIState();
    if (!isPlaying) playBtn.click();
    return;
  }

  // 動画形式 (mp4, webm, mkv)
  currentTime = 0;
  timeSeeker.value = 0;
  currentTimeDisplay.textContent = formatTime(0);
  syncVideosToTime();

  const stream = canvas.captureStream(30);
  let mimeType = '';
  let ext = selectedFormat;

  if (selectedFormat === 'mp4') {
    if (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')) {
      mimeType = 'video/mp4;codecs=avc1';
    } else if (MediaRecorder.isTypeSupported('video/mp4')) {
      mimeType = 'video/mp4';
    } else {
      mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : (MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : '');
      ext = 'webm';
      alert('お使いの環境はMP4形式の直接書き出しに対応していないため、WebM形式で保存します。');
    }
  } else if (selectedFormat === 'mkv') {
    if (MediaRecorder.isTypeSupported('video/x-matroska;codecs=avc1')) {
      mimeType = 'video/x-matroska;codecs=avc1';
    } else if (MediaRecorder.isTypeSupported('video/x-matroska')) {
      mimeType = 'video/x-matroska';
    } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
      mimeType = 'video/webm;codecs=vp9';
    } else {
      mimeType = 'video/webm';
    }
    ext = 'mkv';
  } else {
    // webm
    if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
      mimeType = 'video/webm;codecs=vp9';
    } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) {
      mimeType = 'video/webm;codecs=vp8';
    } else if (MediaRecorder.isTypeSupported('video/webm')) {
      mimeType = 'video/webm';
    } else if (MediaRecorder.isTypeSupported('video/mp4')) {
      mimeType = 'video/mp4';
      ext = 'mp4';
      alert('お使いの環境はWebM形式に対応していないため、MP4形式で保存します。');
    }
  }

  let options = mimeType ? { mimeType } : {};
  recordedChunks = [];

  try {
    mediaRecorder = new MediaRecorder(stream, options);
  } catch (e) {
    alert("録画の初期化に失敗しました: " + (e.message || e));
    return;
  }

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: mimeType || 'video/webm' });
    handleExportDone(blob, ext);
  };

  mediaRecorder.start();
  isRecording = true;
  isRecordingGif = false;
  recordedSeconds = 0;
  activeRecordingExt = ext;
  exportTargetDuration = dur;

  updateExportUIState();

  if (!isPlaying) {
    playBtn.click();
  }
}

function stopExport() {
  if (isRecordingGif) {
    processRecordedGif();
    return;
  }

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  isRecording = false;
  updateExportUIState();
  recordStatus.textContent = 'ファイルを生成中...';
}

// iPhone / スマホ用 カメラロール保存 (Web Share API)
if (saveToPhotosBtn) {
  saveToPhotosBtn.addEventListener('click', async () => {
    if (!lastExportedFile) {
      alert('保存されたファイルがありません。先に動画または画像を書き出してください。');
      return;
    }

    const ext = lastExportedFile.name.split('.').pop().toLowerCase();
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    if (isIOS && (ext === 'webm' || ext === 'mkv')) {
      alert('【ご注意】\niPhoneの写真アプリ（カメラロール）は WebM / MKV 形式に対応していません。\nカメラロールに直接保存したい場合は、保存形式で「MP4」を選択して書き出してください。');
      return;
    }

    if (navigator.canShare && navigator.canShare({ files: [lastExportedFile] })) {
      try {
        await navigator.share({
          files: [lastExportedFile],
          title: '編集動画の保存',
          text: 'Multi-Track Chroma Video Editorから保存'
        });
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.warn('共有エラー:', err);
        }
      }
    } else if (navigator.share) {
      try {
        await navigator.share({
          title: '編集動画の保存',
          url: lastExportedUrl
        });
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.warn('共有エラー:', err);
        }
      }
    } else {
      alert('お使いの環境は共有API（カメラロール直接保存）に対応していません。ダウンロードされたファイルをご利用ください。');
    }
  });
}

// PC / スマホ レイアウト切り替え機能
const LAYOUT_STORAGE_KEY = 'chroma_editor_layout_mode';

function setLayoutMode(mode, save = true) {
  document.body.classList.remove('force-pc', 'force-mobile');
  if (mode === 'pc') {
    document.body.classList.add('force-pc');
  } else if (mode === 'mobile') {
    document.body.classList.add('force-mobile');
  }

  if (modeAutoBtn) modeAutoBtn.classList.toggle('active', mode === 'auto');
  if (modePcBtn) modePcBtn.classList.toggle('active', mode === 'pc');
  if (modeMobileBtn) modeMobileBtn.classList.toggle('active', mode === 'mobile');

  if (save) {
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, mode);
    } catch (e) {}
  }
}

function initLayoutMode() {
  const urlParams = new URLSearchParams(window.location.search);
  const urlMode = urlParams.get('mode');

  if (urlMode === 'pc' || urlMode === 'mobile') {
    setLayoutMode(urlMode, true);
  } else {
    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY) || 'auto';
    setLayoutMode(saved, false);
  }

  if (modeAutoBtn) modeAutoBtn.addEventListener('click', () => setLayoutMode('auto'));
  if (modePcBtn) modePcBtn.addEventListener('click', () => setLayoutMode('pc'));
  if (modeMobileBtn) modeMobileBtn.addEventListener('click', () => setLayoutMode('mobile'));
}

// ========================================================
// ツールバー操作 (プロジェクト保存 / 読み込み / リセット)
// ========================================================
if (saveProjectBtn) {
  saveProjectBtn.addEventListener('click', () => {
    const data = getProjectData();
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `video_project_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);
  });
}

if (loadProjectInput) {
  loadProjectInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const project = JSON.parse(evt.target.result);
        loadProject(project);
        triggerAutoSave();
        alert('プロジェクトを読み込みました！');
      } catch (err) {
        alert('無効なプロジェクトファイルです。');
      }
    };
    reader.readAsText(file);
    loadProjectInput.value = '';
  });
}

if (resetProjectBtn) {
  resetProjectBtn.addEventListener('click', () => {
    if (confirm('現在の編集内容をクリアして初期状態に戻しますか？')) {
      layers = [];
      localStorage.removeItem(STORAGE_KEY);
      updateTimelineBounds();
      renderAllLayerCards();
      renderFrame();
      if (saveBadge) {
        saveBadge.textContent = 'クリア完了';
        saveBadge.style.color = '#ff8888';
      }
    }
  });
}

function initFormatSelect() {
  if (!formatSelect) return;

  const mp4Option = formatSelect.querySelector('option[value="mp4"]');
  const webmOption = formatSelect.querySelector('option[value="webm"]');
  const mkvOption = formatSelect.querySelector('option[value="mkv"]');
  const gifOption = formatSelect.querySelector('option[value="gif"]');
  const pngOption = formatSelect.querySelector('option[value="png"]');
  const jpgOption = formatSelect.querySelector('option[value="jpg"]');

  const hasMediaRecorder = typeof MediaRecorder !== 'undefined';
  const mp4Supported = hasMediaRecorder && (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1') || MediaRecorder.isTypeSupported('video/mp4'));
  const webmSupported = hasMediaRecorder && (MediaRecorder.isTypeSupported('video/webm;codecs=vp9') || MediaRecorder.isTypeSupported('video/webm'));

  if (mp4Option) {
    if (!mp4Supported) {
      mp4Option.textContent = 'MP4 (.mp4) ※一部環境非対応';
    } else {
      mp4Option.textContent = 'MP4 (.mp4) - 動画';
    }
  }

  if (webmOption) {
    if (!webmSupported) {
      webmOption.textContent = 'WebM (.webm) ※一部環境非対応';
    } else {
      webmOption.textContent = 'WebM (.webm) - 高圧縮動画';
    }
  }

  if (mkvOption) {
    mkvOption.textContent = 'MKV (.mkv) - 高画質動画';
  }

  if (gifOption) {
    gifOption.textContent = 'GIF (.gif) - アニメーション';
  }

  if (pngOption) {
    pngOption.textContent = 'PNG (.png) - 静止画';
  }

  if (jpgOption) {
    jpgOption.textContent = 'JPG (.jpg) - 静止画';
  }

  if (mp4Supported) {
    formatSelect.value = 'mp4';
  } else if (webmSupported) {
    formatSelect.value = 'webm';
  }
}

// ========================================================
// 起動時の初期化 (自動保存データ復元 ＆ レイアウト・UI設定)
// ========================================================
initLayoutMode();
initFormatSelect();
try {
  const savedStr = localStorage.getItem(STORAGE_KEY);
  if (savedStr) {
    const savedData = JSON.parse(savedStr);
    loadProject(savedData);
    if (saveBadge) saveBadge.textContent = '⚡ 前回の作業を復元';
  } else {
    updateTimelineBounds();
    renderFrame();
  }
} catch (e) {
  updateTimelineBounds();
  renderFrame();
}
updateExportUIState();
