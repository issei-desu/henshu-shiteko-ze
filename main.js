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
const exportStartInput = document.getElementById('exportStartInput');
const exportEndInput = document.getElementById('exportEndInput');
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

const openExportModalBtn = document.getElementById('openExportModalBtn');
const exportModal = document.getElementById('exportModal');
const closeExportModalBtn = document.getElementById('closeExportModalBtn');
const cancelExportModalBtn = document.getElementById('cancelExportModalBtn');

function openExportModal() {
  if (exportModal) {
    exportModal.style.display = 'flex';
    updateExportUIState();
  }
}

function closeExportModal() {
  if (exportModal) {
    exportModal.style.display = 'none';
  }
}

// グローバルスコープにも公開
window.openExportModal = openExportModal;
window.closeExportModal = closeExportModal;

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
// 音声管理 (Web Audio API)
// ========================================================
let audioCtx = null;
let audioDestNode = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
      audioDestNode = audioCtx.createMediaStreamDestination();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function connectLayerAudio(layer) {
  if (layer.type !== 'video' || !layer.element) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  if (!layer.audioSource) {
    try {
      layer.audioSource = ctx.createMediaElementSource(layer.element);
      layer.gainNode = ctx.createGain();
      layer.gainNode.gain.value = (layer.volume !== undefined ? layer.volume : 1.0);

      layer.audioSource.connect(layer.gainNode);
      // スピーカー出力（プレビュー再生用）
      layer.gainNode.connect(ctx.destination);
      // 録画ストリーム用（保存時音声合成用）
      if (audioDestNode) {
        layer.gainNode.connect(audioDestNode);
      }
    } catch (e) {
      console.warn('Audio connection error:', e);
    }
  }
}

// ========================================================
// 超軽量・容量ゼロの保存・復元システム (localStorage / JSON) & IndexedDB メディアストレージ
// ========================================================
const STORAGE_KEY = 'chroma_video_editor_autosave_v1';
let autoSaveTimer = null;

// IndexedDB の初期化とヘルパー (動画・画像 Blob の永続保存用)
const DB_NAME = 'chroma_editor_media_db';
const DB_VERSION = 1;
const STORE_NAME = 'media_files';

function openMediaDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      return reject(new Error('IndexedDB not supported'));
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveMediaBlob(id, blob, mimeType) {
  try {
    const db = await openMediaDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({ id, blob, mimeType, updatedAt: Date.now() });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('Media blob save error:', err);
  }
}

async function getMediaBlob(id) {
  try {
    const db = await openMediaDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result ? req.result.blob : null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Media blob fetch error:', err);
    return null;
  }
}

async function deleteMediaBlob(id) {
  try {
    const db = await openMediaDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('Media blob delete error:', err);
  }
}

async function clearMediaDB() {
  try {
    const db = await openMediaDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('Media blob clear error:', err);
  }
}

function getProjectData() {
  return {
    version: '1.0',
    timestamp: Date.now(),
    aspectRatio: aspectSelect.value,
    exportFormat: formatSelect ? formatSelect.value : 'mp4',
    exportMode: currentExportMode,
    exportStartTime: exportStartInput ? parseFloat(exportStartInput.value) || 0 : 0,
    exportEndTime: exportEndInput ? parseFloat(exportEndInput.value) || 5 : 5,
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
        if (l.type === 'video') {
          base.volume = (l.volume !== undefined ? l.volume : 1.0);
        }
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
        saveBadge.textContent = '保存完了 (動画・設定)';
        saveBadge.style.color = '#4ade80';
      }
    } catch (e) {
      console.warn('自動保存エラー:', e);
    }
  }, 400);
}

async function loadProject(project) {
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

  if (project.exportStartTime !== undefined && exportStartInput) {
    exportStartInput.value = project.exportStartTime;
  }
  if (project.exportEndTime !== undefined && exportEndInput) {
    exportEndInput.value = project.exportEndTime;
  } else if (project.exportDuration && exportEndInput) {
    exportEndInput.value = project.exportDuration;
  }

  // まずベースオブジェクトを作成（IndexedDBからの読み込み状態を保持）
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
        isLoadingMedia: true, // メディア復元中フラグ
        needsRelink: false
      };
    }
  });

  updateTimelineBounds();
  renderAllLayerCards();
  renderFrame();

  // IndexedDBから動画・画像Blobの自動復元
  for (const layer of layers) {
    if (layer.type === 'text') continue;
    try {
      const blob = await getMediaBlob(layer.id);
      if (blob) {
        const url = URL.createObjectURL(blob);
        if (layer.type === 'video') {
          const video = document.createElement('video');
          video.src = url;
          video.loop = true;
          video.playsInline = true;
          video.crossOrigin = 'anonymous';
          video.onloadedmetadata = () => {
            layer.element = video;
            layer.ready = true;
            layer.isLoadingMedia = false;
            layer.needsRelink = false;
            connectLayerAudio(layer);
            updateTimelineBounds();
            renderAllLayerCards();
            renderFrame();
          };
          video.onerror = () => {
            layer.isLoadingMedia = false;
            layer.needsRelink = true;
            renderAllLayerCards();
          };
        } else {
          const img = new Image();
          img.src = url;
          img.onload = () => {
            layer.element = img;
            layer.ready = true;
            layer.isLoadingMedia = false;
            layer.needsRelink = false;
            renderAllLayerCards();
            renderFrame();
          };
          img.onerror = () => {
            layer.isLoadingMedia = false;
            layer.needsRelink = true;
            renderAllLayerCards();
          };
        }
      } else {
        // IndexedDBに未保存（古いキャッシュデータ）の場合は再リンクを促す
        layer.isLoadingMedia = false;
        layer.needsRelink = true;
        renderAllLayerCards();
      }
    } catch (e) {
      layer.isLoadingMedia = false;
      layer.needsRelink = true;
      renderAllLayerCards();
    }
  }
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
    const layerId = 'layer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

    // IndexedDB に動画/画像ファイルを保存
    saveMediaBlob(layerId, file, file.type);

    const layer = {
      id: layerId,
      name: file.name,
      type: isVideo ? 'video' : 'image',
      element: isVideo ? document.createElement('video') : new Image(),
      ready: false,
      duration: isVideo ? 0 : 5,
      x: 0,
      y: 0,
      scale: 1.0,
      volume: 1.0,
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
      layer.element.playsInline = true;
      layer.element.crossOrigin = 'anonymous';
      layer.element.onloadedmetadata = () => {
        layer.ready = true;
        const dur = layer.element.duration || 10;
        layer.duration = dur;
        layer.startTime = 0;
        layer.endTime = parseFloat(dur.toFixed(2));
        connectLayerAudio(layer);
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
    const foldText = layer.collapsed ? '開' : '閉';

    let relinkHTML = '';
    if (layer.type !== 'text') {
      if (layer.isLoadingMedia) {
        relinkHTML = `
          <div class="relink-alert" style="background:#1d2a3a; border-color:#2a4a75;">
            <span class="relink-text" style="color:#7bb5ff;">ブラウザ内ストレージから素材を復元中... (${layer.name})</span>
          </div>
        `;
      } else if (layer.needsRelink && !layer.ready) {
        relinkHTML = `
          <div class="relink-alert">
            <span class="relink-text">素材ファイルの再読み込みが必要です（${layer.name}）</span>
            <label class="btn white-btn relink-btn">
              同じ（または新しい）ファイルを選択
              <input type="file" class="relink-input" accept="${layer.type === 'video' ? 'video/*' : 'image/*'}" hidden />
            </label>
            <div style="font-size:0.75rem; color:#8da4c4; margin-top:4px;">※一度選択すると次回以降は自動で記憶・復元されます</div>
          </div>
        `;
      }
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
            <div class="slider-num-wrap">
              <input type="range" min="-100" max="100" value="${layer.x}" data-prop="x" class="sync-slider" />
              <input type="number" min="-100" max="100" step="1" value="${layer.x}" data-prop="x" class="sync-number" />
            </div>
          </label>
          <label>位置 Y (% 上下):
            <div class="slider-num-wrap">
              <input type="range" min="-100" max="100" value="${layer.y}" data-prop="y" class="sync-slider" />
              <input type="number" min="-100" max="100" step="1" value="${layer.y}" data-prop="y" class="sync-number" />
            </div>
          </label>
        </div>

        <div class="control-row">
          <label>文字サイズ:
            <input type="range" min="16" max="150" step="1" value="${layer.fontSize || 60}" data-prop="fontSize" />
          </label>
          <label>拡大率:
            <div class="slider-num-wrap">
              <input type="range" min="0.1" max="3.0" step="0.05" value="${layer.scale}" data-prop="scale" class="sync-slider" />
              <input type="number" min="0.1" max="10.0" step="0.05" value="${layer.scale}" data-prop="scale" class="sync-number" />
            </div>
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
            <div class="slider-num-wrap">
              <input type="range" min="-100" max="100" value="${layer.x}" data-prop="x" class="sync-slider" />
              <input type="number" min="-100" max="100" step="1" value="${layer.x}" data-prop="x" class="sync-number" />
            </div>
          </label>
          <label>位置 Y (% 上下):
            <div class="slider-num-wrap">
              <input type="range" min="-100" max="100" value="${layer.y}" data-prop="y" class="sync-slider" />
              <input type="number" min="-100" max="100" step="1" value="${layer.y}" data-prop="y" class="sync-number" />
            </div>
          </label>
        </div>

        <div class="control-row">
          <label>拡大率:
            <div class="slider-num-wrap">
              <input type="range" min="0.1" max="3.0" step="0.05" value="${layer.scale}" data-prop="scale" class="sync-slider" />
              <input type="number" min="0.1" max="10.0" step="0.05" value="${layer.scale}" data-prop="scale" class="sync-number" />
            </div>
          </label>
          ${layer.type === 'video' ? `
          <label>音量 (%):
            <div class="slider-num-wrap">
              <input type="range" min="0" max="1" step="0.05" value="${layer.volume !== undefined ? layer.volume : 1}" data-prop="volume" class="sync-slider" />
              <input type="number" min="0" max="100" step="5" value="${Math.round((layer.volume !== undefined ? layer.volume : 1) * 100)}" data-prop="volume-percent" class="sync-number" />
            </div>
          </label>
          ` : `
          <div class="chroma-toggle">
            <input type="checkbox" id="ck_${layer.id}" data-prop="chromaEnabled" ${layer.chromaEnabled ? 'checked' : ''} />
            <label for="ck_${layer.id}">グリーンバック透過</label>
          </div>
          `}
        </div>

        ${layer.type === 'video' ? `
        <div class="control-row">
          <div class="chroma-toggle">
            <input type="checkbox" id="ck_${layer.id}" data-prop="chromaEnabled" ${layer.chromaEnabled ? 'checked' : ''} />
            <label for="ck_${layer.id}">グリーンバック透過</label>
          </div>
          <div></div>
        </div>
        ` : ''}

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
          <span class="drag-handle" title="長押し・ドラッグで並び替え">☰</span>
          <input type="text" class="layer-name-input" id="name_input_${layer.id}" value="${layer.name}" title="クリックして名前を変更" />
          <span class="duration-badge">${durText}</span>
        </div>
        <div class="header-actions">
          <button type="button" class="btn white-icon-btn delete" data-action="delete" title="削除">✕</button>
          <button type="button" class="btn white-fold-btn" id="fold_btn_${layer.id}">${foldText}</button>
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
        // 再リンク時も IndexedDB に保存更新
        saveMediaBlob(layer.id, file, file.type);
        const isVideo = file.type.startsWith('video/') || layer.type === 'video';
        if (isVideo) {
          layer.element = document.createElement('video');
          layer.element.src = url;
          layer.element.loop = true;
          layer.element.playsInline = true;
          layer.element.crossOrigin = 'anonymous';
          layer.element.onloadedmetadata = () => {
            layer.ready = true;
            layer.needsRelink = false;
            connectLayerAudio(layer);
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
        foldBtn.textContent = '開';
      } else {
        cardBody.style.display = 'flex';
        foldBtn.textContent = '閉';
      }
      triggerAutoSave();
    });

    // 2. 素材名変更イベント
    const nameInput = card.querySelector(`#name_input_${layer.id}`);
    nameInput.addEventListener('input', (e) => {
      layer.name = e.target.value;
      triggerAutoSave();
    });

    // 3. 削除ボタン
    const deleteBtn = card.querySelector('.header-actions button[data-action="delete"]');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteMediaBlob(layer.id);
        layers = layers.filter(l => l.id !== layer.id);
        renderAllLayerCards();
        updateTimelineBounds();
        renderFrame();
        triggerAutoSave();
      });
    }

    // 3.5 ドラッグ＆ドロップ（PCマウス & スマホタッチ両対応）
    const dragHandle = card.querySelector('.drag-handle');
    card.setAttribute('draggable', 'true');

    card.addEventListener('dragstart', (e) => {
      // 入力フォーム操作時はドラッグ開始しない
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') {
        e.preventDefault();
        return;
      }
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', index.toString());
      card.classList.add('is-dragging');
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('is-dragging');
      document.querySelectorAll('.layer-card').forEach(c => c.classList.remove('drag-over-top', 'drag-over-bottom'));
    });

    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = card.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (e.clientY < mid) {
        card.classList.add('drag-over-top');
        card.classList.remove('drag-over-bottom');
      } else {
        card.classList.add('drag-over-bottom');
        card.classList.remove('drag-over-top');
      }
    });

    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drag-over-top', 'drag-over-bottom');
      const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
      if (isNaN(fromIndex) || fromIndex === index) return;
      const rect = card.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      let targetIndex = e.clientY < mid ? index : index + 1;
      if (fromIndex < targetIndex) targetIndex--;
      if (fromIndex !== targetIndex) {
        const [movedLayer] = layers.splice(fromIndex, 1);
        layers.splice(targetIndex, 0, movedLayer);
        renderAllLayerCards();
        renderFrame();
        triggerAutoSave();
      }
    });

    // スマホ・タッチ操作でのリアルタイム並び替え (Touch Events)
    if (dragHandle) {
      let isTouching = false;
      let placeholder = null;
      let touchOffsetY = 0;
      let cardWidth = 0;
      let cardHeight = 0;
      let currentIndex = index;

      dragHandle.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        isTouching = true;
        currentIndex = layers.findIndex(l => l.id === layer.id);

        const touch = e.touches[0];
        const rect = card.getBoundingClientRect();
        touchOffsetY = touch.clientY - rect.top;
        cardWidth = rect.width;
        cardHeight = rect.height;

        // プレースホルダー（隙間）を作成して元の場所に挿入
        placeholder = document.createElement('div');
        placeholder.className = 'layer-card drag-placeholder';
        placeholder.style.height = `${cardHeight}px`;
        placeholder.style.width = `${cardWidth}px`;
        card.parentNode.insertBefore(placeholder, card);

        // 操作カードをフローティング化
        card.classList.add('is-touch-floating');
        card.style.position = 'fixed';
        card.style.top = `${rect.top}px`;
        card.style.left = `${rect.left}px`;
        card.style.width = `${cardWidth}px`;
        card.style.zIndex = '9999';

        if (e.cancelable) e.preventDefault();
      }, { passive: false });

      dragHandle.addEventListener('touchmove', (e) => {
        if (!isTouching || e.touches.length !== 1) return;
        if (e.cancelable) e.preventDefault();
        const touch = e.touches[0];
        const currentY = touch.clientY;

        // 指に合わせてカード枠を遅延なく即時追従
        card.style.top = `${currentY - touchOffsetY}px`;

        if (!placeholder || !placeholder.parentNode) return;

        // 現在のカード一覧（操作中のcardとplaceholderを除外した実体カード）
        const allChildren = Array.from(layerListContainer.children);
        const placeholderIdx = allChildren.indexOf(placeholder);
        const siblings = allChildren.filter(c => c !== card && c !== placeholder && c.classList.contains('layer-card'));

        for (let sibling of siblings) {
          const rect = sibling.getBoundingClientRect();
          const siblingCenterY = rect.top + rect.height / 2;
          const siblingIdx = allChildren.indexOf(sibling);

          // 下方向に移動：指が下のカードの中心を超えた時、placeholderをそのカードの直後に移動
          if (currentY > siblingCenterY && placeholderIdx < siblingIdx) {
            sibling.after(placeholder);
            break;
          }
          // 上方向に移動：指が上のカードの中心を超えた時、placeholderをそのカードの直前に移動
          else if (currentY < siblingCenterY && placeholderIdx > siblingIdx) {
            sibling.before(placeholder);
            break;
          }
        }
      }, { passive: false });

      const handleTouchEnd = (e) => {
        if (!isTouching) return;
        isTouching = false;

        // プレースホルダーの位置にカードを戻す
        if (placeholder && placeholder.parentNode) {
          // 現在のDOM上の並び順から新しいインデックスを特定
          const currentNodes = Array.from(layerListContainer.children);
          const newIdx = currentNodes.indexOf(placeholder);

          placeholder.parentNode.insertBefore(card, placeholder);
          placeholder.remove();
          placeholder = null;

          card.classList.remove('is-touch-floating');
          card.style.position = '';
          card.style.top = '';
          card.style.left = '';
          card.style.width = '';
          card.style.zIndex = '';

          const oldIdx = layers.findIndex(l => l.id === layer.id);
          if (oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) {
            const [moved] = layers.splice(oldIdx, 1);
            layers.splice(newIdx, 0, moved);
            renderAllLayerCards();
            renderFrame();
            triggerAutoSave();
          }
        } else {
          card.classList.remove('is-touch-floating');
          card.style.position = '';
          card.style.top = '';
          card.style.left = '';
          card.style.width = '';
          card.style.zIndex = '';
        }
      };

      dragHandle.addEventListener('touchend', handleTouchEnd);
      dragHandle.addEventListener('touchcancel', handleTouchEnd);
    }

    // 4. 入力変更イベント（スライダーと数値入力の双方向同期含む）
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
        } else if (prop === 'volume' || prop === 'volume-percent') {
          let vol = 1.0;
          if (prop === 'volume') {
            vol = Math.max(0, Math.min(1, parseFloat(e.target.value) || 0));
            const numPartner = card.querySelector(`.sync-number[data-prop="volume-percent"]`);
            if (numPartner) numPartner.value = Math.round(vol * 100);
          } else {
            const pct = Math.max(0, Math.min(100, parseFloat(e.target.value) || 0));
            vol = pct / 100;
            const sliderPartner = card.querySelector(`.sync-slider[data-prop="volume"]`);
            if (sliderPartner) sliderPartner.value = vol;
          }
          layer.volume = vol;
          if (layer.gainNode) {
            layer.gainNode.gain.value = vol;
          }
        } else {
          const val = parseFloat(e.target.value);
          layer[prop] = isNaN(val) ? 0 : val;

          // スライダーと数値入力欄の双方向同期
          const partner = card.querySelector(
            e.target.classList.contains('sync-slider')
              ? `.sync-number[data-prop="${prop}"]`
              : `.sync-slider[data-prop="${prop}"]`
          );
          if (partner && partner !== e.target) {
            partner.value = e.target.value;
          }

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
  playBtn.textContent = isPlaying ? '一時停止' : '再生';
  if (isPlaying) {
    getAudioContext();
    layers.forEach(l => {
      if (l.type === 'video') connectLayerAudio(l);
    });
    syncVideosToTime(true);
    lastTimestamp = performance.now();
    requestAnimationFrame(animationLoop);
  } else {
    layers.forEach(l => {
      if (l.type === 'video' && l.element && !l.element.paused) {
        l.element.pause();
      }
    });
  }
});

// シークバー
timeSeeker.addEventListener('input', (e) => {
  currentTime = parseFloat(e.target.value);
  currentTimeDisplay.textContent = formatTime(currentTime);
  syncVideosToTime(true);
  renderFrame();
});

function syncVideosToTime(force = false) {
  layers.forEach(layer => {
    if (layer.type === 'video' && layer.ready && layer.element) {
      if (currentTime >= layer.startTime && currentTime <= layer.endTime) {
        const dur = layer.element.duration || 1;
        const targetOffset = (currentTime - layer.startTime) % dur;
        // 0.1秒以上のズレがある場合、または強制同期(force)の時に currentTime を補正
        if (force || Math.abs(layer.element.currentTime - targetOffset) > 0.12) {
          layer.element.currentTime = targetOffset;
        }
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
    // ループ時に全動画を先頭（0秒時点）へ強制同期！
    syncVideosToTime(true);
  }

  timeSeeker.value = currentTime;
  currentTimeDisplay.textContent = formatTime(currentTime);

  layers.forEach(layer => {
    if (layer.type === 'video' && layer.ready && layer.element) {
      if (currentTime >= layer.startTime && currentTime <= layer.endTime) {
        const dur = layer.element.duration || 1;
        const expectedOffset = (currentTime - layer.startTime) % dur;
        // 通常再生中は 0.4秒以上の大きな乖離がある場合のみ currentTime を補正（過剰シークによるカクつき防止）
        if (Math.abs(layer.element.currentTime - expectedOffset) > 0.4) {
          layer.element.currentTime = expectedOffset;
        }
        if (layer.element.paused) {
          layer.element.play().catch(() => {});
        }
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
      const modeLabel = currentExportMode === 'instant' ? '高速書き出し中' : '指定秒数録画中';
      recordStatus.innerHTML = `<span>${modeLabel} (${activeRecordingExt.toUpperCase()}): <strong>${recordedSeconds.toFixed(1)}s / ${exportTargetDuration.toFixed(1)}s (${progress}%)</strong></span>`;

      if (recordedSeconds >= exportTargetDuration) {
        stopExport();
        return;
      }
    } else {
      recordStatus.innerHTML = `<span>自由録画中 (${activeRecordingExt.toUpperCase()}): <strong>${recordedSeconds.toFixed(1)}秒 経過</strong> [停止ボタンで保存]</span>`;
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

// 動画・高速一括レンダリング (実時間待たずに開始秒〜終了秒を一括生成)
let isInstantRendering = false;

async function exportInstantVideo(startTime, endTime, ext, mimeType) {
  if (layers.length === 0) {
    alert("素材を1つ以上追加してください。");
    return;
  }

  const duration = Math.max(0.1, endTime - startTime);
  const fps = 60;
  const totalFrames = Math.max(1, Math.round(duration * fps));
  const stepTime = 1 / fps;

  isInstantRendering = true;
  if (recordBtn) {
    recordBtn.disabled = true;
    recordBtn.textContent = 'レンダリング中...';
  }

  // 元の再生状態・時間を退避
  const wasPlaying = isPlaying;
  if (isPlaying) {
    isPlaying = false;
    if (playBtn) playBtn.textContent = '再生';
  }
  const savedCurrentTime = currentTime;

  // 音声コンテキストの初期化＆レイヤー接続
  getAudioContext();
  layers.forEach(l => {
    if (l.type === 'video') connectLayerAudio(l);
  });

  // MediaRecorder でストリームを 60fps 高滑らかキャプチャ
  const stream = canvas.captureStream(60);

  // 音声トラックをストリームに合成
  if (audioDestNode && audioDestNode.stream) {
    const audioTracks = audioDestNode.stream.getAudioTracks();
    audioTracks.forEach(track => {
      stream.addTrack(track);
    });
  }
  let options = mimeType ? { mimeType, videoBitsPerSecond: 16000000 } : { videoBitsPerSecond: 16000000 };
  let chunks = [];
  let recorder;

  try {
    recorder = new MediaRecorder(stream, options);
  } catch (err) {
    alert("書き出しの初期化に失敗しました: " + (err.message || err));
    isInstantRendering = false;
    if (recordBtn) recordBtn.disabled = false;
    updateExportUIState();
    return;
  }

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const exportPromise = new Promise((resolve) => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
      resolve(blob);
    };
  });

  recorder.start();

  // フレームごとの高速一括レンダリング
  for (let i = 0; i < totalFrames; i++) {
    currentTime = startTime + i * stepTime;
    timeSeeker.value = currentTime;
    currentTimeDisplay.textContent = formatTime(currentTime);

    // ビデオ素材のシーク同期
    layers.forEach(l => {
      if (l.type === 'video' && l.ready && l.element) {
        if (currentTime >= l.startTime && currentTime <= l.endTime) {
          const d = l.element.duration || 1;
          const off = (currentTime - l.startTime) % d;
          l.element.currentTime = off;
        }
      }
    });

    renderFrame();

    const progress = Math.min(100, Math.round(((i + 1) / totalFrames) * 100));
    recordStatus.innerHTML = `<span>高速保存中 (${ext.toUpperCase()}): <strong>${(i * stepTime).toFixed(1)}s / ${duration.toFixed(1)}s (${progress}%)</strong></span>`;

    // captureStream にフレームを確実に送るための微小ウェイト
    if (i % 2 === 0 || i === totalFrames - 1) {
      await new Promise(r => setTimeout(r, 16));
    }
  }

  recordStatus.textContent = 'ファイルを生成中...';
  await new Promise(r => setTimeout(r, 100));
  recorder.stop();

  const finalBlob = await exportPromise;

  // タイムラインを元の位置に復元
  currentTime = savedCurrentTime;
  timeSeeker.value = currentTime;
  currentTimeDisplay.textContent = formatTime(currentTime);
  syncVideosToTime();
  renderFrame();

  isInstantRendering = false;
  if (recordBtn) recordBtn.disabled = false;
  updateExportUIState();

  handleExportDone(finalBlob, ext);
}

async function exportInstantGif(startTime, endTime) {
  if (layers.length === 0) {
    alert("素材を1つ以上追加してください。");
    return;
  }
  isExportingGif = true;
  if (recordBtn) {
    recordBtn.disabled = true;
    recordBtn.textContent = 'フレーム抽出中...';
  }

  const duration = Math.max(0.2, endTime - startTime);
  const fps = 10;
  const totalFrames = Math.max(1, Math.round(duration * fps));
  const stepTime = duration / totalFrames;

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

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = targetW;
  tempCanvas.height = targetH;
  const tempCtx = tempCanvas.getContext('2d');
  const frames = [];

  const prevTime = currentTime;
  for (let i = 0; i < totalFrames; i++) {
    currentTime = startTime + i * stepTime;
    timeSeeker.value = currentTime;
    currentTimeDisplay.textContent = formatTime(currentTime);

    layers.forEach(l => {
      if (l.type === 'video' && l.ready && l.element) {
        if (currentTime >= l.startTime && currentTime <= l.endTime) {
          const d = l.element.duration || 1;
          const off = (currentTime - l.startTime) % d;
          l.element.currentTime = off;
        }
      }
    });

    renderFrame();

    tempCtx.drawImage(canvas, 0, 0, targetW, targetH);
    frames.push(tempCanvas.toDataURL('image/jpeg', 0.8));

    if (i % 4 === 0 || i === totalFrames - 1) {
      const progress = Math.min(100, Math.round(((i + 1) / totalFrames) * 100));
      recordStatus.innerHTML = `<span>GIFフレーム抽出中: <strong>${(i * stepTime).toFixed(1)}s / ${duration.toFixed(1)}s (${progress}%)</strong></span>`;
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

  recordStatus.innerHTML = `<span style="color:#00ffaa;font-weight:bold;">保存完了！</span> (${ext.toUpperCase()} 形式で保存されました)`;

  // iPhone / スマホ用 カメラロール保存エリアを表示
  if (shareActionArea) {
    shareActionArea.style.display = 'flex';
    if (saveToPhotosBtn) {
      if (ext === 'png' || ext === 'jpg' || ext === 'gif') {
        saveToPhotosBtn.textContent = 'カメラロール（写真）に保存 / 共有';
      } else {
        saveToPhotosBtn.textContent = 'iPhoneカメラロールに保存 (共有)';
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
      recordBtn.textContent = `静止画を保存 (.${selectedFormat})`;
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
      recordBtn.textContent = `録画停止 (保存)`;
      recordBtn.classList.add('recording');
      recordBtn.disabled = false;
    } else {
      recordBtn.classList.remove('recording');
      if (selectedFormat === 'gif') {
        if (currentExportMode === 'instant') {
          recordBtn.textContent = 'GIFをその場で保存 (.gif)';
        } else if (currentExportMode === 'timer') {
          recordBtn.textContent = '指定秒数でGIF録画 (.gif)';
        } else {
          recordBtn.textContent = 'GIF録画開始 (.gif)';
        }
      } else {
        const extUpper = selectedFormat.toUpperCase();
        if (currentExportMode === 'instant') {
          recordBtn.textContent = `その場で保存 (${extUpper})`;
        } else if (currentExportMode === 'timer') {
          recordBtn.textContent = `指定秒数で録画開始 (${extUpper})`;
        } else {
          recordBtn.textContent = `録画開始 (${extUpper})`;
        }
      }
    }
  }

  if (openExportModalBtn) {
    if (isRecording) {
      openExportModalBtn.textContent = '録画停止 (保存)';
      openExportModalBtn.classList.add('recording');
    } else {
      openExportModalBtn.textContent = '動画・画像を保存 (書き出し)';
      openExportModalBtn.classList.remove('recording');
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

if (useTimelineMaxBtn) {
  useTimelineMaxBtn.addEventListener('click', () => {
    if (exportStartInput) exportStartInput.value = 0;
    if (exportEndInput) {
      exportEndInput.value = parseFloat(maxDuration.toFixed(1));
    }
    triggerAutoSave();
  });
}

if (exportStartInput) {
  exportStartInput.addEventListener('change', () => {
    triggerAutoSave();
  });
}

if (exportEndInput) {
  exportEndInput.addEventListener('change', () => {
    triggerAutoSave();
  });
}

if (openExportModalBtn) {
  openExportModalBtn.addEventListener('click', () => {
    if (isRecording) {
      stopExport();
    } else {
      openExportModal();
    }
  });
}

if (closeExportModalBtn) {
  closeExportModalBtn.addEventListener('click', closeExportModal);
}

if (cancelExportModalBtn) {
  cancelExportModalBtn.addEventListener('click', closeExportModal);
}

if (exportModal) {
  exportModal.addEventListener('click', (e) => {
    if (e.target === exportModal) {
      closeExportModal();
    }
  });
}

if (recordBtn) {
  recordBtn.addEventListener('click', () => {
    if (!isRecording) {
      closeExportModal();
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

  const sTime = Math.max(0, parseFloat(exportStartInput ? exportStartInput.value : 0) || 0);
  let eTime = parseFloat(exportEndInput ? exportEndInput.value : 5) || 5;
  if (eTime <= sTime) eTime = sTime + 1;
  const dur = eTime - sTime;

  // GIFアニメーションの場合
  if (selectedFormat === 'gif') {
    if (currentExportMode === 'instant') {
      exportInstantGif(sTime, eTime);
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

    currentTime = sTime;
    timeSeeker.value = sTime;
    currentTimeDisplay.textContent = formatTime(sTime);
    syncVideosToTime();

    updateExportUIState();
    if (!isPlaying) playBtn.click();
    return;
  }

  // 動画形式 (mp4, webm, mkv)
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

  // 「その場で保存」モードなら、等速再生の録画ではなく高速一括レンダリングを実行！
  if (currentExportMode === 'instant') {
    exportInstantVideo(sTime, eTime, ext, mimeType);
    return;
  }

  // 録画モード (timer / manual) の場合
  currentTime = sTime;
  timeSeeker.value = sTime;
  currentTimeDisplay.textContent = formatTime(sTime);
  syncVideosToTime();

  // 音声コンテキストの初期化＆レイヤー接続
  getAudioContext();
  layers.forEach(l => {
    if (l.type === 'video') connectLayerAudio(l);
  });

  const stream = canvas.captureStream(60);

  // 音声トラックをストリームに合成
  if (audioDestNode && audioDestNode.stream) {
    const audioTracks = audioDestNode.stream.getAudioTracks();
    audioTracks.forEach(track => {
      stream.addTrack(track);
    });
  }

  let options = mimeType ? { mimeType, videoBitsPerSecond: 16000000 } : { videoBitsPerSecond: 16000000 };
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
          text: '素人が作った編集アプリから保存'
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
      clearMediaDB();
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
    if (saveBadge) saveBadge.textContent = '前回の作業を復元';
  } else {
    updateTimelineBounds();
    renderFrame();
  }
} catch (e) {
  updateTimelineBounds();
  renderFrame();
}
updateExportUIState();
