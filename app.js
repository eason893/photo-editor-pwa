// ============================================================
// 图片编辑器 PWA - 主逻辑
// ============================================================

// ---------- 全局状态 ----------
const state = {
    currentPage: 'home',
    gridImages: [],        // 宫格拼图的图片数组
    gridTemplate: 2,       // 当前模板
    longImages: [],        // 长图拼接图片
    longDirection: 'vertical',
    editImage: null,       // 编辑页当前图片 (Image对象)
    editMode: null,        // crop / rotate / adjust / bw / compress
    cutoutImage: null,
    longLoadVersion: 0,
    bgColor: '#ffffff',
    emptyColor: 'auto',   // 空位颜色：'auto' 跟随背景 / '#ffffff' 白色 / '#000000' 黑色
    borderWidth: 4,
    borderRadius: 0,
    spacing: 4,
    fillMode: 'contain', // 'contain' 完整显示 / 'cover' 填满裁剪
    longSpacing: 0,
    longGapColor: '#ffffff',
    // 调色参数
    adjust: { brightness: 0, contrast: 0, saturate: 0, sharpness: 0, temperature: 0 },
    bwThreshold: 128,
    // 撤销/重做
    history: [],
    historyIndex: -1,
    // 裁剪
    crop: { x: 0, y: 0, w: 0, h: 0, active: false, aspect: null },
    // 长按交换
    swap: { type: null, index: -1 },  // type: 'grid' | 'long'
    // 局部色彩
    selectiveHue: 0,
    selectiveTolerance: 30,
    // 圆形裁剪
    circleCropSize: 80,
    circleCropBg: 'transparent',
    // 图片分割
    splitImage: null,
    splitGrid: '2x2',
    // 批量处理
    batchImages: []
};

// ---------- DOM 缓存 ----------
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ---------- 通用辅助函数 ----------
function getCssSize(canvas) {
    return {
        w: parseInt(canvas.style.width) || canvas.width,
        h: parseInt(canvas.style.height) || canvas.height
    };
}

function setupCanvas(canvas, img, opts = {}) {
    const dpr = window.devicePixelRatio || 1;
    const maxW = opts.maxW !== undefined ? opts.maxW : (window.innerWidth - 32);
    const maxH = opts.maxH;
    const ratio = maxH
        ? Math.min(maxW / img.width, maxH / img.height, 1)
        : Math.min(maxW / img.width, 1);
    const cssW = Math.round(img.width * ratio);
    const cssH = Math.round(img.height * ratio);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { ctx, cssW, cssH };
}

function applyColorDots(container, callback) {
    $$(container + ' .color-dot').forEach(dot => {
        dot.addEventListener('click', () => {
            $$(container + ' .color-dot').forEach(d => d.classList.remove('active'));
            dot.classList.add('active');
            callback(dot);
        });
    });
}

function hidePaintOverlay() {
    $('paintCanvas').style.display = 'none';
    paintState.active = false;
    paintState.mode = null;
}

function setEditImage(img) {
    state.editImage = img;
    state.bwOtsu = undefined;
    drawEdit();
    renderFilterPresets();
}

function applyPaintOverlay(toolsId) {
    if (!state.editImage) return;
    const pc = $('paintCanvas');
    const img = state.editImage;
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = img.width;
    fullCanvas.height = img.height;
    const ctx = fullCanvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    ctx.drawImage(pc, 0, 0, pc.width, pc.height, 0, 0, img.width, img.height);
    pushHistory();
    const newImg = new Image();
    newImg.onload = () => {
        setEditImage(newImg);
        hidePaintOverlay();
        $(toolsId).style.display = 'none';
        restoreEditTools();
    };
    newImg.src = fullCanvas.toDataURL();
}

// ---------- 页面导航 ----------
function showPage(pageId) {
    $$('.page').forEach(p => p.classList.remove('active'));
    const page = $(pageId);
    if (page) page.classList.add('active');
    state.currentPage = pageId;
}

$$('[data-action]').forEach(el => {
    el.addEventListener('click', () => {
        const action = el.dataset.action;
        if (action === 'grid') showPage('grid-page');
        else if (action === 'long') {
            state.longImages = [];
            state.longLoadVersion++;
            resetLongInput();
            showPage('long-page');
            renderLongSlots();
            drawLong();
        }
        else if (action === 'bw' || action === 'crop' || action === 'rotate' || action === 'adjust' || action === 'compress' || action === 'selective-color' || action === 'circle-crop') {
            state.editMode = action;
            const titles = { crop: '裁剪旋转', rotate: '裁剪旋转', adjust: '调色增强', bw: '黑白二值', compress: '压缩转换', 'selective-color': '局部色彩', 'circle-crop': '圆形裁剪' };
            $('editTitle').textContent = titles[action] || '图片编辑';
            $('cropTools').style.display = action === 'crop' || action === 'rotate' ? 'flex' : 'none';
            $('rotateTools').style.display = action === 'crop' || action === 'rotate' ? 'flex' : 'none';
            $('freeRotateTools').style.display = action === 'crop' || action === 'rotate' ? 'flex' : 'none';
            $('adjustTools').style.display = action === 'adjust' ? 'flex' : 'none';
            $('filterTools').style.display = action === 'adjust' ? 'flex' : 'none';
            $('bwTools').style.display = action === 'bw' ? 'flex' : 'none';
            $('compressTools').style.display = action === 'compress' ? 'flex' : 'none';
            $('selectiveColorTools').style.display = action === 'selective-color' ? 'flex' : 'none';
            $('circleCropTools').style.display = action === 'circle-crop' ? 'flex' : 'none';
            hideCropOverlay();
            $('textTools').style.display = 'none';
            if (action === 'crop' && state.editImage) {
                setTimeout(enterCropMode, 50);
            }
            if (action === 'circle-crop' && state.editImage) {
                setTimeout(showCircleCropPreview, 50);
            }
            showPage('edit-page');
        } else if (action === 'cutout') showPage('cutout-page');
        else if (action === 'split') {
            state.splitImage = null;
            state.splitGrid = '2x2';
            $('splitGrid').innerHTML = '';
            showPage('split-page');
        } else if (action === 'batch') {
            state.batchImages = [];
            renderBatchSlots();
            showPage('batch-page');
            initBatchFilterOptions();
        } else if (action === 'fill') {
            showPage('grid-page');
            state.gridTemplate = 9;
            updateTemplateBtns();
            renderSlots();
            drawGrid();
        }
    });
});

$$('[data-back]').forEach(el => {
    el.addEventListener('click', () => {
        // 清空所有图片状态
        state.gridImages = [];
        state.longImages = [];
        state.longLoadVersion++;
        state.editImage = null;
        state.cutoutImage = null;
        state.history = [];
        state.historyIndex = -1;
        state.bwOtsu = undefined;
        stickerState.placed = [];
        // 隐藏所有 overlay 和工具栏
        hideCropOverlay();
        hidePaintOverlay();
        hidePaintOverlay();
        hideCompareOverlay();
        $('textOverlay').style.display = 'none';
        textState.active = false;
        ['cropTools', 'rotateTools', 'adjustTools', 'bwTools', 'compressTools',
         'filterTools', 'textTools', 'mosaicTools', 'brushTools', 'stickerTools', 'borderTools',
         'selectiveColorTools', 'circleCropTools'
        ].forEach(id => { $(id).style.display = 'none'; });
        // 重置渲染
        renderSlots();
        drawGrid();
        renderLongSlots();
        resetLongInput();
        updateUndoRedoBtns();
        showPage('home');
    });
});

// ---------- 工具函数 ----------
function loadImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function showLoading(text) {
    $('loadingText').textContent = text || '处理中...';
    $('loading').style.display = 'flex';
}

function hideLoading() {
    $('loading').style.display = 'none';
}

// ---------- 撤销/重做 ----------
function pushHistory() {
    if (!state.editImage) return;
    // 截断 redo 栈
    state.history = state.history.slice(0, state.historyIndex + 1);
    // 保存当前 Image 的快照
    const snap = cloneImage(state.editImage);
    state.history.push(snap);
    state.historyIndex = state.history.length - 1;
    updateUndoRedoBtns();
}

function cloneImage(img) {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    const newImg = new Image();
    newImg.src = c.toDataURL();
    return newImg;
}

function undo() {
    if (state.historyIndex <= 0) return;
    state.historyIndex--;
    state.editImage = cloneImage(state.history[state.historyIndex]);
    drawEdit();
    updateUndoRedoBtns();
}

function redo() {
    if (state.historyIndex >= state.history.length - 1) return;
    state.historyIndex++;
    state.editImage = cloneImage(state.history[state.historyIndex]);
    drawEdit();
    updateUndoRedoBtns();
}

function updateUndoRedoBtns() {
    const undoBtn = $('undoBtn');
    const redoBtn = $('redoBtn');
    if (undoBtn) undoBtn.disabled = state.historyIndex <= 0;
    if (redoBtn) redoBtn.disabled = state.historyIndex >= state.history.length - 1;
}

function resetHistory() {
    state.history = [];
    state.historyIndex = -1;
    updateUndoRedoBtns();
}

// ============================================================
// 原图对比
// ============================================================

const compareState = {
    active: false,
    position: 0.5, // 0~1，分割线位置
    dragging: false,
    originalImage: null // 进入编辑页时的原图快照
};

$('compareBtn').addEventListener('click', () => {
    if (!state.editImage) return alert('请先选择图片');
    if (compareState.active) {
        hideCompareOverlay();
    } else {
        showCompareOverlay();
    }
});

function showCompareOverlay() {
    if (!state.editImage) return;
    // 保存原图快照（如果没有的话）
    if (!compareState.originalImage) {
        compareState.originalImage = state.history.length > 0 ? cloneImage(state.history[0]) : cloneImage(state.editImage);
    }
    compareState.active = true;
    compareState.position = 0.5;
    $('compareBtn').style.background = '#667eea';
    $('compareBtn').style.borderColor = '#667eea';
    $('compareBtn').style.color = '#fff';
    renderCompare();
    $('compareOverlay').style.display = 'block';
}

function hideCompareOverlay() {
    compareState.active = false;
    $('compareOverlay').style.display = 'none';
    $('compareBtn').style.background = '';
    $('compareBtn').style.borderColor = '';
    $('compareBtn').style.color = '';
}

function renderCompare() {
    if (!compareState.active || !state.editImage || !compareState.originalImage) return;

    const ec = $('editCanvas');
    const cssW = parseInt(ec.style.width) || ec.width;
    const cssH = parseInt(ec.style.height) || ec.height;
    const overlay = $('compareOverlay');
    overlay.style.width = cssW + 'px';
    overlay.style.height = cssH + 'px';

    const pos = compareState.position;

    // 左侧：原图
    const origDiv = $('compareOriginal');
    origDiv.style.clipPath = `inset(0 ${(1 - pos) * 100}% 0 0)`;

    // 绘制原图到临时 canvas
    let origCanvas = origDiv.querySelector('canvas');
    if (!origCanvas) {
        origCanvas = document.createElement('canvas');
        origCanvas.style.position = 'absolute';
        origCanvas.style.top = '0';
        origCanvas.style.left = '0';
        origDiv.appendChild(origCanvas);
    }
    origCanvas.width = cssW;
    origCanvas.height = cssH;
    origCanvas.style.width = cssW + 'px';
    origCanvas.style.height = cssH + 'px';
    const origCtx = origCanvas.getContext('2d');
    origCtx.drawImage(compareState.originalImage, 0, 0, cssW, cssH);

    // 分割线位置
    $('compareDivider').style.left = (pos * 100) + '%';
}

// 对比拖拽事件
function initCompareDrag() {
    const overlay = $('compareOverlay');

    function getPos(e) {
        const rect = overlay.getBoundingClientRect();
        const touch = e.touches ? e.touches[0] : e;
        return touch.clientX - rect.left;
    }

    function onStart(e) {
        if (!compareState.active) return;
        e.preventDefault();
        compareState.dragging = true;
        updatePos(e);
    }

    function onMove(e) {
        if (!compareState.dragging) return;
        e.preventDefault();
        updatePos(e);
    }

    function onEnd() {
        compareState.dragging = false;
    }

    function updatePos(e) {
        const x = getPos(e);
        const w = parseInt(overlay.style.width);
        compareState.position = Math.max(0.05, Math.min(0.95, x / w));
        renderCompare();
    }

    overlay.addEventListener('touchstart', onStart, { passive: false });
    overlay.addEventListener('mousedown', onStart);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchend', onEnd);
    document.addEventListener('mouseup', onEnd);
}
initCompareDrag();

function downloadCanvas(canvas, filename) {
    const formats = [
        { type: 'image/jpeg', ext: 'jpg', quality: 0.95 },
        { type: 'image/png', ext: 'png' },
    ];

    function tryFormat(idx) {
        if (idx >= formats.length) {
            hideLoading();
            alert('图片过大，无法导出');
            return;
        }
        const f = formats[idx];
        canvas.toBlob(blob => {
            if (!blob || blob.size === 0) {
                tryFormat(idx + 1);
                return;
            }
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.download = filename ? filename.replace(/\.\w+$/, '.' + f.ext) : 'image.' + f.ext;
            a.href = url;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }, f.type, f.quality);
    }

    tryFormat(0);
}

// 批量下载：生成 zip 文件后单次下载
function downloadBlobs(blobList, zipName) {
    // blobList: [{ blob, name }]
    if (blobList.length === 1) {
        // 单文件直接下载
        const url = URL.createObjectURL(blobList[0].blob);
        const a = document.createElement('a');
        a.download = blobList[0].name;
        a.href = url;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        return;
    }
    // 多文件打成 zip
    generateZip(blobList).then(zipBlob => {
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.download = zipName || 'images.zip';
        a.href = url;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    });
}

// 轻量 zip 生成器（无需外部依赖）
async function generateZip(fileList) {
    const entries = [];
    let offset = 0;
    // 准备文件数据
    for (const item of fileList) {
        const nameBytes = new TextEncoder().encode(item.name);
        const data = new Uint8Array(await item.blob.arrayBuffer());
        const crc = crc32(data);
        entries.push({ nameBytes, data, crc, offset });
        // local file header(30 + nameBytes.length) + data
        offset += 30 + nameBytes.length + data.length;
    }
    // 计算 central directory
    const cdEntries = [];
    let cdSize = 0;
    for (const e of entries) {
        const cd = new Uint8Array(46 + e.nameBytes.length);
        const dv = new DataView(cd.buffer);
        dv.setUint32(0, 0x02014b50, true); // central directory signature
        dv.setUint16(4, 20, true); // version made by
        dv.setUint16(6, 20, true); // version needed
        dv.setUint16(8, 0, true);  // flags
        dv.setUint16(10, 0, true); // compression: stored
        dv.setUint16(12, 0, true); // mod time
        dv.setUint16(14, 0, true); // mod date
        dv.setUint32(16, e.crc, true);
        dv.setUint32(20, e.data.length, true); // compressed size
        dv.setUint32(24, e.data.length, true); // uncompressed size
        dv.setUint16(28, e.nameBytes.length, true);
        dv.setUint16(30, 0, true); // extra length
        dv.setUint16(32, 0, true); // comment length
        dv.setUint16(34, 0, true); // disk number
        dv.setUint16(36, 0, true); // internal attrs
        dv.setUint32(38, 0, true); // external attrs
        dv.setUint32(42, e.offset, true); // local header offset
        cd.set(e.nameBytes, 46);
        cdEntries.push(cd);
        cdSize += cd.length;
    }
    // 组装最终 zip
    const totalSize = offset + cdSize + 22; // end of central directory = 22 bytes
    const zip = new Uint8Array(totalSize);
    let pos = 0;
    // Local file entries
    for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const dv = new DataView(zip.buffer, pos);
        dv.setUint32(0, 0x04034b50, true); // local file header signature
        dv.setUint16(4, 20, true); // version needed
        dv.setUint16(6, 0, true);  // flags
        dv.setUint16(8, 0, true);  // compression: stored
        dv.setUint16(10, 0, true); // mod time
        dv.setUint16(12, 0, true); // mod date
        dv.setUint32(14, e.crc, true);
        dv.setUint32(18, e.data.length, true); // compressed size
        dv.setUint32(22, e.data.length, true); // uncompressed size
        dv.setUint16(26, e.nameBytes.length, true);
        dv.setUint16(28, 0, true); // extra length
        pos += 30;
        zip.set(e.nameBytes, pos); pos += e.nameBytes.length;
        zip.set(e.data, pos); pos += e.data.length;
    }
    // Central directory
    for (const cd of cdEntries) {
        zip.set(cd, pos); pos += cd.length;
    }
    // End of central directory
    const dv = new DataView(zip.buffer, pos);
    dv.setUint32(0, 0x06054b50, true);
    dv.setUint16(4, 0, true); // disk number
    dv.setUint16(6, 0, true); // disk with cd
    dv.setUint16(8, entries.length, true);
    dv.setUint16(10, entries.length, true);
    dv.setUint32(12, cdSize, true);
    dv.setUint32(16, offset, true);
    dv.setUint16(20, 0, true); // comment length
    return new Blob([zip], { type: 'application/zip' });
}

function crc32(data) {
    let crc = 0xFFFFFFFF;
    const table = crc32.table || (crc32.table = (() => {
        const t = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            t[i] = c;
        }
        return t;
    })());
    for (let i = 0; i < data.length; i++) {
        crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ============================================================
// 宫格拼图
// ============================================================

// 模板布局定义 (归一化坐标 [x, y, w, h])
// 用函数生成确保精确对齐，避免浮点误差导致重叠
function buildTemplates() {
    const t = {};
    // 2格：左右
    t[2] = [[0,0,0.5,1],[0.5,0,0.5,1]];
    // 4格：2x2
    t[4] = [[0,0,0.5,0.5],[0.5,0,0.5,0.5],[0,0.5,0.5,0.5],[0.5,0.5,0.5,0.5]];
    // 6格：2x3
    const r6 = [0, 1/3, 2/3];
    t[6] = [];
    for (let row = 0; row < 3; row++) {
        t[6].push([0, r6[row], 0.5, 1/3]);
        t[6].push([0.5, r6[row], 0.5, 1/3]);
    }
    // 8格：2x4
    t[8] = [];
    for (let row = 0; row < 4; row++) {
        t[8].push([0, row * 0.25, 0.5, 0.25]);
        t[8].push([0.5, row * 0.25, 0.5, 0.25]);
    }
    // 9格：3x3
    const r9 = [0, 1/3, 2/3];
    t[9] = [];
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
            t[9].push([r9[col], r9[row], 1/3, 1/3]);
        }
    }
    return t;
}
const TEMPLATES = buildTemplates();

function updateTemplateBtns() {
    $$('.template-bar .tpl-btn[data-tpl]').forEach(b => {
        b.classList.toggle('active', parseInt(b.dataset.tpl) === state.gridTemplate);
    });
}

// 模板按钮
$$('.tpl-btn[data-tpl]').forEach(btn => {
    btn.addEventListener('click', () => {
        state.gridTemplate = parseInt(btn.dataset.tpl);
        updateTemplateBtns();
        renderSlots();
        drawGrid();
    });
});

// ---------- 长按交换 ----------
let longPressTimer = null;
let longPressTriggered = false;
let touchStartPos = null;

function addSlotInteraction(slot, index, type) {
    const start = e => {
        const touch = e.touches ? e.touches[0] : e;
        touchStartPos = { x: touch.clientX, y: touch.clientY };
        longPressTriggered = false;
        longPressTimer = setTimeout(() => {
            longPressTimer = null;
            longPressTriggered = true;
            if (state.swap.type === type && state.swap.index === index) {
                cancelSwap();
            } else {
                state.swap = { type, index };
                updateSwapUI();
            }
        }, 500);
    };

    const end = e => {
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }

        // 检测是否为轻点（移动距离小于 10px）
        let moved = false;
        if (touchStartPos) {
            const touch = e.changedTouches ? e.changedTouches[0] : e;
            const dx = touch.clientX - touchStartPos.x;
            const dy = touch.clientY - touchStartPos.y;
            moved = Math.abs(dx) > 10 || Math.abs(dy) > 10;
        }

        if (!moved) {
            if (longPressTriggered) {
                // 长按刚触发后的松手，忽略（等待用户点另一个槽位）
                longPressTriggered = false;
            } else {
                // 普通轻点
                handleSlotTap(index, type);
            }
        }
        longPressTriggered = false;
    };

    const cancel = () => {
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    };

    slot.addEventListener('touchstart', start, { passive: true });
    slot.addEventListener('touchend', end);
    slot.addEventListener('touchmove', cancel);
    slot.addEventListener('mousedown', start);
    slot.addEventListener('mouseup', end);
    slot.addEventListener('mouseleave', cancel);
}

function cancelSwap() {
    state.swap = { type: null, index: -1 };
    updateSwapUI();
}

function updateSwapUI() {
    $$('.slot').forEach(s => s.classList.remove('swap-selected'));
    if (state.swap.index >= 0) {
        const bar = state.swap.type === 'grid' ? $('slotsBar') : $('longSlotsBar');
        const slots = bar.querySelectorAll('.slot');
        if (slots[state.swap.index]) slots[state.swap.index].classList.add('swap-selected');
    }
}

function handleSlotTap(index, type) {
    // 交换模式下，点另一个有图的槽位则交换
    if (state.swap.type === type && state.swap.index >= 0 && state.swap.index !== index) {
        const arr = type === 'grid' ? state.gridImages : state.longImages;
        if (arr[state.swap.index] && arr[index]) {
            [arr[state.swap.index], arr[index]] = [arr[index], arr[state.swap.index]];
            cancelSwap();
            if (type === 'grid') { renderSlots(); drawGrid(); }
            else { renderLongSlots(); drawLong(); }
            return;
        }
    }
    // 非交换模式下，空槽位点击导入图片
    if (type === 'grid' && !state.gridImages[index]) {
        $('photoInput').click();
    }
    cancelSwap();
}

// 渲染槽位
function renderSlots() {
    const bar = $('slotsBar');
    bar.innerHTML = '';
    const count = state.gridTemplate;
    for (let i = 0; i < count; i++) {
        const slot = document.createElement('div');
        slot.className = 'slot' + (state.gridImages[i] ? ' filled' : '');
        if (state.gridImages[i]) {
            const img = document.createElement('img');
            img.src = state.gridImages[i].src;
            slot.appendChild(img);
            const rm = document.createElement('button');
            rm.className = 'remove-btn';
            rm.textContent = '×';
            rm.addEventListener('click', e => {
                e.stopPropagation();
                state.gridImages.splice(i, 1);
                renderSlots();
                drawGrid();
            });
            slot.appendChild(rm);
        }
        addSlotInteraction(slot, i, 'grid');
        bar.appendChild(slot);
    }
    updateSwapUI();
}

// 通用绘制逻辑（预览和导出共用）
function renderGridToCanvas(canvas, size, skipResize) {
    const ctx = canvas.getContext('2d');
    if (!skipResize) {
        canvas.width = size;
        canvas.height = size;
    }

    // 高质量图像缩放
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const tpl = TEMPLATES[state.gridTemplate];
    const gap = state.spacing;
    const br = state.borderRadius;

    // 先画满背景色
    ctx.fillStyle = state.bgColor;
    ctx.fillRect(0, 0, size, size);

    tpl.forEach((cell, i) => {
        // 用 Math.round 消除亚像素，确保精确对齐
        const px = Math.round(cell[0] * size + gap / 2);
        const py = Math.round(cell[1] * size + gap / 2);
        const pw = Math.round(cell[2] * size - gap);
        const ph = Math.round(cell[3] * size - gap);

        // 始终裁剪，防止图片溢出到相邻单元格
        ctx.save();
        if (br > 0) {
            roundRect(ctx, px, py, pw, ph, br);
        } else {
            ctx.beginPath();
            ctx.rect(px, py, pw, ph);
        }
        ctx.clip();

        if (state.gridImages[i]) {
            const img = state.gridImages[i];
            if (state.fillMode === 'cover') {
                const imgRatio = img.width / img.height;
                const cellRatio = pw / ph;
                let sx, sy, sw, sh;
                if (imgRatio > cellRatio) {
                    sh = img.height; sw = sh * cellRatio;
                    sx = (img.width - sw) / 2; sy = 0;
                } else {
                    sw = img.width; sh = sw / cellRatio;
                    sx = 0; sy = (img.height - sh) / 2;
                }
                ctx.drawImage(img, sx, sy, sw, sh, px, py, pw, ph);
            } else if (state.fillMode === 'stretch') {
                ctx.drawImage(img, px, py, pw, ph);
            } else {
                const scale = Math.min(pw / img.width, ph / img.height);
                const dw = Math.round(img.width * scale);
                const dh = Math.round(img.height * scale);
                const dx = px + Math.round((pw - dw) / 2);
                const dy = py + Math.round((ph - dh) / 2);
                ctx.drawImage(img, dx, dy, dw, dh);
            }
        } else {
            // 空位颜色
            const emptyColor = state.emptyColor === 'auto' ? state.bgColor : state.emptyColor;
            ctx.fillStyle = emptyColor;
            ctx.fillRect(px, py, pw, ph);
            // 只在跟随背景时显示加号（黑色和白色不显示）
            if (state.emptyColor === 'auto') {
                ctx.fillStyle = '#444';
                ctx.font = `${Math.min(pw, ph) * 0.3}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('+', px + pw / 2, py + ph / 2);
            }
        }
        ctx.restore();
    });
}

// 绘制宫格拼图（预览）
function drawGrid() {
    const canvas = $('gridCanvas');
    const dpr = window.devicePixelRatio || 1;
    const cssSize = Math.min(window.innerWidth - 32, 400);
    // 高 DPI 支持
    canvas.width = Math.round(cssSize * dpr);
    canvas.height = Math.round(cssSize * dpr);
    canvas.style.width = cssSize + 'px';
    canvas.style.height = cssSize + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    renderGridToCanvas(canvas, cssSize, true);
}

function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

// 导入图片（宫格）
$('addPhotosBtn').addEventListener('click', () => $('photoInput').click());
$('photoInput').addEventListener('change', async e => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    showLoading('加载图片...');
    for (const file of files) {
        if (state.gridImages.length >= state.gridTemplate) break;
        try {
            const img = await loadImage(file);
            state.gridImages.push(img);
        } catch (_) {}
    }
    hideLoading();
    renderSlots();
    drawGrid();
    e.target.value = '';
});

// 设置控件
$('borderRadius').addEventListener('input', e => {
    state.borderRadius = parseInt(e.target.value);
    $('radiusVal').textContent = state.borderRadius;
    drawGrid();
});
$('spacing').addEventListener('input', e => {
    state.spacing = parseInt(e.target.value);
    $('spacingVal').textContent = state.spacing;
    drawGrid();
});
$$('.fill-btn[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
        $$('.fill-btn[data-mode]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.fillMode = btn.dataset.mode;
        drawGrid();
    });
});
applyColorDots('#bgColors', dot => {
    state.bgColor = dot.dataset.color;
    drawGrid();
});
// 空位颜色
$$('.fill-btn[data-empty]').forEach(btn => {
    btn.addEventListener('click', () => {
        $$('.fill-btn[data-empty]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.emptyColor = btn.dataset.empty;
        drawGrid();
    });
});

// 导出（超清 2048px）
$('exportBtn').addEventListener('click', () => {
    const exportCanvas = document.createElement('canvas');
    renderGridToCanvas(exportCanvas, 2048);
    downloadCanvas(exportCanvas, 'collage.png');
});

// ============================================================
// 长图拼接
// ============================================================

$$('.tpl-btn[data-dir]').forEach(btn => {
    btn.addEventListener('click', () => {
        $$('.tpl-btn[data-dir]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.longDirection = btn.dataset.dir;
        drawLong();
    });
});

function resetLongInput() {
    const old = $('longPhotoInput');
    const fresh = old.cloneNode(true);
    old.parentNode.replaceChild(fresh, old);
    fresh.addEventListener('change', handleLongFiles);
}

function handleLongFiles(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    const version = ++state.longLoadVersion;
    showLoading('加载图片...');
    (async () => {
        for (const file of files) {
            if (state.longLoadVersion !== version) return; // 已过期，停止
            try {
                const img = await loadImage(file);
                if (state.longLoadVersion !== version) return;
                state.longImages.push(img);
            } catch (_) {}
        }
        if (state.longLoadVersion !== version) return;
        hideLoading();
        renderLongSlots();
        drawLong();
    })();
}

$('addLongPhotosBtn').addEventListener('click', () => $('longPhotoInput').click());
$('longPhotoInput').addEventListener('change', handleLongFiles);
$('clearLongPhotosBtn').addEventListener('click', () => {
    state.longImages = [];
    state.longLoadVersion++;
    resetLongInput();
    renderLongSlots();
    drawLong();
});

// 渲染长图图片列表
function renderLongSlots() {
    const bar = $('longSlotsBar');
    bar.innerHTML = '';
    state.longImages.forEach((img, i) => {
        const slot = document.createElement('div');
        slot.className = 'slot filled';
        const imgEl = document.createElement('img');
        imgEl.src = img.src;
        slot.appendChild(imgEl);
        const rm = document.createElement('button');
        rm.className = 'remove-btn';
        rm.textContent = '×';
        rm.addEventListener('click', e => {
            e.stopPropagation();
            state.longImages.splice(i, 1);
            renderLongSlots();
            drawLong();
        });
        slot.appendChild(rm);
        addSlotInteraction(slot, i, 'long');
        bar.appendChild(slot);
    });
    updateSwapUI();
}

$('longSpacing').addEventListener('input', e => {
    state.longSpacing = parseInt(e.target.value);
    $('longSpacingVal').textContent = state.longSpacing;
    $('longGapColorRow').style.display = state.longSpacing > 0 ? 'flex' : 'none';
    drawLong();
});

// 间隔色选择
applyColorDots('#longGapColors', dot => {
    state.longGapColor = dot.dataset.color;
    drawLong();
});

function drawLong() {
    const canvas = $('longCanvas');
    const dpr = window.devicePixelRatio || 1;
    if (!state.longImages.length) {
        const cssW = Math.min(window.innerWidth - 32, 500);
        const cssH = 200;
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        canvas.style.width = cssW + 'px';
        canvas.style.height = cssH + 'px';
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.fillStyle = '#16213e';
        ctx.fillRect(0, 0, cssW, cssH);
        ctx.fillStyle = '#444';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('请添加图片', cssW / 2, cssH / 2);
        return;
    }
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const sp = state.longSpacing;
    const maxPreview = Math.min(window.innerWidth - 32, 500);

    if (state.longDirection === 'vertical') {
        const targetW = maxPreview;
        let totalH = 0;
        const dims = state.longImages.map(img => {
            const ratio = targetW / img.width;
            const h = Math.round(img.height * ratio);
            totalH += h;
            return { w: targetW, h };
        });
        totalH += sp * (state.longImages.length - 1);

        const cssH = Math.min(totalH, 2000); // 预览高度限制
        const previewScale = totalH > 2000 ? 2000 / totalH : 1;

        canvas.width = Math.round(targetW * dpr);
        canvas.height = Math.round(cssH * dpr);
        canvas.style.width = targetW + 'px';
        canvas.style.height = cssH + 'px';
        ctx.scale(dpr, dpr);

        ctx.fillStyle = state.longGapColor;
        ctx.fillRect(0, 0, targetW, cssH);

        let y = 0;
        state.longImages.forEach((img, i) => {
            const dh = Math.round(dims[i].h * previewScale);
            ctx.drawImage(img, 0, y, targetW, dh);
            y += dh + Math.round(sp * previewScale);
        });
    } else {
        const targetH = 400;
        let totalW = 0;
        const dims = state.longImages.map(img => {
            const ratio = targetH / img.height;
            const w = Math.round(img.width * ratio);
            totalW += w;
            return { w, h: targetH };
        });
        totalW += sp * (state.longImages.length - 1);

        const cssW = Math.min(totalW, 2000);
        const previewScale = totalW > 2000 ? 2000 / totalW : 1;

        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(targetH * dpr);
        canvas.style.width = cssW + 'px';
        canvas.style.height = targetH + 'px';
        ctx.scale(dpr, dpr);

        ctx.fillStyle = state.longGapColor;
        ctx.fillRect(0, 0, cssW, targetH);

        let x = 0;
        state.longImages.forEach((img, i) => {
            const dw = Math.round(dims[i].w * previewScale);
            ctx.drawImage(img, x, 0, dw, targetH);
            x += dw + Math.round(sp * previewScale);
        });
    }
}

$('longExportBtn').addEventListener('click', () => {
    if (!state.longImages.length) return showLoading('请先添加图片');
    showLoading('生成高清图中...');

    // 用 setTimeout 让 loading 动画先显示出来
    setTimeout(() => {
        try {
            const sp = state.longSpacing;
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            const SIZE = 2048;

            if (state.longDirection === 'vertical') {
                const targetW = SIZE;
                const MAX_H = 32768;
                let totalH = 0;
                const dims = state.longImages.map(img => {
                    const ratio = targetW / img.width;
                    const h = Math.round(img.height * ratio);
                    totalH += h;
                    return { h };
                });
                totalH += sp * (state.longImages.length - 1);

                let hScale = totalH > MAX_H ? MAX_H / totalH : 1;

                canvas.width = targetW;
                canvas.height = Math.round(totalH * hScale);
                ctx.fillStyle = state.longGapColor;
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                let y = 0;
                state.longImages.forEach((img, i) => {
                    const dh = Math.round(dims[i].h * hScale);
                    ctx.drawImage(img, 0, y, targetW, dh);
                    y += dh + Math.round(sp * hScale);
                });
            } else {
                const targetH = SIZE;
                const MAX_W = 32768;
                let totalW = 0;
                const dims = state.longImages.map(img => {
                    const ratio = targetH / img.height;
                    const w = Math.round(img.width * ratio);
                    totalW += w;
                    return { w };
                });
                totalW += sp * (state.longImages.length - 1);

                let wScale = totalW > MAX_W ? MAX_W / totalW : 1;

                canvas.width = Math.round(totalW * wScale);
                canvas.height = targetH;
                ctx.fillStyle = state.longGapColor;
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                let x = 0;
                state.longImages.forEach((img, i) => {
                    const dw = Math.round(dims[i].w * wScale);
                    ctx.drawImage(img, x, 0, dw, targetH);
                    x += dw + Math.round(sp * wScale);
                });
            }

            downloadCanvas(canvas, 'long-image.png');
        } catch (e) {
            alert('导出失败，请减少图片数量');
        }
        hideLoading();
    }, 100);
});

// ============================================================
// 图片编辑（裁剪/旋转/调色/黑白/压缩）
// ============================================================

$('addEditPhotoBtn').addEventListener('click', () => $('editPhotoInput').click());
$('undoBtn').addEventListener('click', undo);
$('redoBtn').addEventListener('click', redo);
$('editPhotoInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    showLoading('加载图片...');
    try {
        state.editImage = await loadImage(file);
        state.bwOtsu = undefined;
        compareState.originalImage = null;
        hideCompareOverlay();
        resetHistory();
        pushHistory();
        drawEdit();
        renderFilterPresets();
        updateEstSize();
        if (state.editMode === 'crop' || state.editMode === 'rotate') {
            setTimeout(enterCropMode, 50);
        }
        if (state.editMode === 'circle-crop') {
            setTimeout(showCircleCropPreview, 50);
        }
        if (state.editMode === 'selective-color') {
            setTimeout(drawEditSelectiveColor, 50);
        }
    } catch (_) {}
    hideLoading();
    e.target.value = '';
});

function drawEdit() {
    if (!state.editImage) return;
    const canvas = $('editCanvas');
    const ctx = canvas.getContext('2d');
    const img = state.editImage;
    const dpr = window.devicePixelRatio || 1;
    const maxW = Math.min(window.innerWidth - 32, 500);
    const maxH = window.innerHeight * 0.5;

    // 边框模式需要额外空间
    const hasBorder = $('borderTools').style.display !== 'none' && borderState.style !== 'none' && borderState.width > 0;
    const borderPx = hasBorder ? borderState.width : 0;
    const totalW = img.width + borderPx * 2;
    const totalH = img.height + borderPx * 2;
    const ratio = Math.min(maxW / totalW, maxH / totalH, 1);

    // CSS 显示尺寸
    const cssW = Math.round(totalW * ratio);
    const cssH = Math.round(totalH * ratio);
    // Canvas 实际像素（考虑高 DPI）
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    ctx.scale(dpr, dpr);

    if (hasBorder) {
        // 先画边框背景
        if (borderState.style === 'shadow') {
            ctx.fillStyle = '#fff';
        } else {
            ctx.fillStyle = borderState.color;
        }
        ctx.fillRect(0, 0, cssW, cssH);

        // 圆角裁剪
        const bw = Math.round(borderPx * ratio);
        const imgW = Math.round(img.width * ratio);
        const imgH = Math.round(img.height * ratio);
        if (borderState.style === 'rounded') {
            const r = Math.min(bw * 1.5, cssW * 0.1, cssH * 0.1);
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(bw + r, bw);
            ctx.lineTo(bw + imgW - r, bw);
            ctx.quadraticCurveTo(bw + imgW, bw, bw + imgW, bw + r);
            ctx.lineTo(bw + imgW, bw + imgH - r);
            ctx.quadraticCurveTo(bw + imgW, bw + imgH, bw + imgW - r, bw + imgH);
            ctx.lineTo(bw + r, bw + imgH);
            ctx.quadraticCurveTo(bw, bw + imgH, bw, bw + imgH - r);
            ctx.lineTo(bw, bw + r);
            ctx.quadraticCurveTo(bw, bw, bw + r, bw);
            ctx.closePath();
            ctx.clip();
        }

        // 画图片到边框内
        if (state.editMode === 'adjust' || state.editMode === 'bw') {
            ctx.drawImage(img, 0, 0, img.width, img.height, bw, bw, imgW, imgH);
            // 像素操作需要用 canvas 实际尺寸
            applyAdjust(ctx, canvas.width, canvas.height);
            if (state.editMode === 'bw') applyBW(ctx, canvas.width, canvas.height, state.bwThreshold);
            if (state.adjust.sharpness > 0) applySharpen(ctx, canvas.width, canvas.height, state.adjust.sharpness / 100);
        } else {
            ctx.drawImage(img, 0, 0, img.width, img.height, bw, bw, imgW, imgH);
        }

        if (borderState.style === 'rounded') ctx.restore();

        // 阴影效果
        if (borderState.style === 'shadow') {
            const shadowW = Math.max(4, bw * 0.3);
            ctx.save();
            let grad = ctx.createLinearGradient(0, bw, 0, bw + shadowW);
            grad.addColorStop(0, 'rgba(0,0,0,0.25)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad; ctx.fillRect(bw, bw, imgW, shadowW);
            grad = ctx.createLinearGradient(bw, 0, bw + shadowW, 0);
            grad.addColorStop(0, 'rgba(0,0,0,0.2)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad; ctx.fillRect(bw, bw, shadowW, imgH);
            grad = ctx.createLinearGradient(0, bw + imgH, 0, bw + imgH - shadowW);
            grad.addColorStop(0, 'rgba(0,0,0,0.3)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad; ctx.fillRect(bw, bw + imgH - shadowW, imgW, shadowW);
            grad = ctx.createLinearGradient(bw + imgW, 0, bw + imgW - shadowW, 0);
            grad.addColorStop(0, 'rgba(0,0,0,0.3)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad; ctx.fillRect(bw + imgW - shadowW, bw, shadowW, imgH);
            ctx.restore();
        }
    } else {
        // 无边框，正常绘制
        if (state.editMode === 'adjust' || state.editMode === 'bw') {
            ctx.drawImage(img, 0, 0, cssW, cssH);
            // 像素操作需要用 canvas 实际尺寸
            applyAdjust(ctx, canvas.width, canvas.height);
            if (state.editMode === 'bw') applyBW(ctx, canvas.width, canvas.height, state.bwThreshold);
            if (state.adjust.sharpness > 0) applySharpen(ctx, canvas.width, canvas.height, state.adjust.sharpness / 100);
        } else {
            ctx.drawImage(img, 0, 0, cssW, cssH);
        }
    }
}

function applyAdjust(ctx, w, h, params) {
    const a = params || state.adjust;
    if (a.brightness === 0 && a.contrast === 0 && a.saturate === 0 && a.temperature === 0) return;

    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;

    const brightness = a.brightness / 100;
    const contrast = (a.contrast + 100) / 100;
    const saturate = (a.saturate + 100) / 100;
    const temperature = a.temperature / 100;

    for (let i = 0; i < d.length; i += 4) {
        let r = d[i], g = d[i+1], b = d[i+2];
        r += brightness * 255;
        g += brightness * 255;
        b += brightness * 255;
        r = ((r / 255 - 0.5) * contrast + 0.5) * 255;
        g = ((g / 255 - 0.5) * contrast + 0.5) * 255;
        b = ((b / 255 - 0.5) * contrast + 0.5) * 255;
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        r = gray + (r - gray) * saturate;
        g = gray + (g - gray) * saturate;
        b = gray + (b - gray) * saturate;
        r += temperature * 30;
        b -= temperature * 30;
        d[i] = Math.max(0, Math.min(255, Math.round(r)));
        d[i+1] = Math.max(0, Math.min(255, Math.round(g)));
        d[i+2] = Math.max(0, Math.min(255, Math.round(b)));
    }

    ctx.putImageData(imageData, 0, 0);
}

function applyAdjustDirect(ctx, w, h, brightness, contrast, saturate, temperature) {
    applyAdjust(ctx, w, h, { brightness, contrast, saturate, temperature });
}

// Otsu 自动阈值：最小化类内方差
function otsuThreshold(imageData) {
    const d = imageData.data;
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
        const gray = Math.round(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
        hist[gray]++;
    }
    const total = d.length / 4;
    let sumAll = 0;
    for (let i = 0; i < 256; i++) sumAll += i * hist[i];

    let sumBg = 0, wBg = 0, maxVar = -1, best = 128;
    for (let t = 0; t < 256; t++) {
        wBg += hist[t];
        if (wBg === 0) continue;
        const wFg = total - wBg;
        if (wFg === 0) break;
        sumBg += t * hist[t];
        const meanBg = sumBg / wBg;
        const meanFg = (sumAll - sumBg) / wFg;
        const variance = wBg * wFg * (meanBg - meanFg) * (meanBg - meanFg);
        if (variance > maxVar) { maxVar = variance; best = t; }
    }
    return best;
}

// 用原图灰度数据计算 Otsu 阈值（缓存）
function getOtsuThreshold() {
    if (state.bwOtsu !== undefined) return state.bwOtsu;
    if (!state.editImage) return 128;
    const img = state.editImage;
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height);
    state.bwOtsu = otsuThreshold(data);
    return state.bwOtsu;
}

function applyBW(ctx, w, h, offset) {
    const base = getOtsuThreshold();
    const threshold = Math.max(0, Math.min(255, base + (offset || 0)));
    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
        const gray = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        const val = gray > threshold ? 255 : 0;
        d[i] = d[i + 1] = d[i + 2] = val;
    }
    ctx.putImageData(imageData, 0, 0);
}

// 用原始分辨率生成黑白图并下载
function exportBWImage(threshold) {
    if (!state.editImage) return;
    const img = state.editImage;
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    applyBW(ctx, img.width, img.height, threshold);
    downloadCanvas(canvas, 'bw-image.png');
}

// 用原始分辨率生成调色图并下载
function exportAdjustedImage() {
    if (!state.editImage) return;
    const img = state.editImage;
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    applyAdjust(ctx, img.width, img.height);
    if (state.adjust.sharpness > 0) {
        applySharpen(ctx, img.width, img.height, state.adjust.sharpness / 100);
    }
    downloadCanvas(canvas, 'adjusted.png');
}

function applySharpen(ctx, w, h, amount) {
    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;
    const copy = new Uint8ClampedArray(d);
    const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];

    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            for (let c = 0; c < 3; c++) {
                let val = 0;
                for (let ky = -1; ky <= 1; ky++) {
                    for (let kx = -1; kx <= 1; kx++) {
                        const idx = ((y + ky) * w + (x + kx)) * 4 + c;
                        val += copy[idx] * kernel[(ky + 1) * 3 + (kx + 1)];
                    }
                }
                const idx = (y * w + x) * 4 + c;
                d[idx] = copy[idx] + (val - copy[idx]) * amount;
            }
        }
    }
    ctx.putImageData(imageData, 0, 0);
}

// ============================================================
// 交互式裁剪
// ============================================================

const cropState = {
    dragging: false,
    handle: null, // null = creating new, 'move' = moving, or handle name
    startX: 0, startY: 0,
    origCrop: null
};

function showCropOverlay() {
    const overlay = $('cropOverlay');
    const canvas = $('editCanvas');

    // overlay 使用 CSS 尺寸（不是 canvas 实际像素）
    const cssW = parseInt(canvas.style.width) || canvas.width;
    const cssH = parseInt(canvas.style.height) || canvas.height;

    overlay.style.display = 'block';
    overlay.style.width = cssW + 'px';
    overlay.style.height = cssH + 'px';

    // 默认选区 = 整张图
    state.crop = { x: 0, y: 0, w: cssW, h: cssH, active: true, aspect: null };
    updateCropUI();
}

function hideCropOverlay() {
    $('cropOverlay').style.display = 'none';
    state.crop.active = false;
}

function updateCropUI() {
    const c = state.crop;
    const sel = $('cropSelection');
    const overlay = $('cropOverlay');
    const ow = parseInt(overlay.style.width);
    const oh = parseInt(overlay.style.height);

    // 选区
    sel.style.left = c.x + 'px';
    sel.style.top = c.y + 'px';
    sel.style.width = c.w + 'px';
    sel.style.height = c.h + 'px';

    // 四块遮罩
    const top = $('cropOverlay').querySelector('.crop-mask-top');
    const right = $('cropOverlay').querySelector('.crop-mask-right');
    const bottom = $('cropOverlay').querySelector('.crop-mask-bottom');
    const left = $('cropOverlay').querySelector('.crop-mask-left');

    top.style.left = '0'; top.style.top = '0';
    top.style.width = ow + 'px'; top.style.height = c.y + 'px';

    left.style.left = '0'; left.style.top = c.y + 'px';
    left.style.width = c.x + 'px'; left.style.height = c.h + 'px';

    right.style.left = (c.x + c.w) + 'px'; right.style.top = c.y + 'px';
    right.style.width = (ow - c.x - c.w) + 'px'; right.style.height = c.h + 'px';

    bottom.style.left = '0'; bottom.style.top = (c.y + c.h) + 'px';
    bottom.style.width = ow + 'px'; bottom.style.height = (oh - c.y - c.h) + 'px';
}

function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

function getCropPointerPos(e) {
    const overlay = $('cropOverlay');
    const rect = overlay.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top
    };
}

function applyCropAspectRatio(dx, dy) {
    const c = state.crop;
    const aspect = c.aspect;
    if (!aspect) return { dx, dy };
    // 根据当前拖拽方向，保持宽高比
    if (Math.abs(dx) / aspect > Math.abs(dy)) {
        dy = dx / aspect * Math.sign(dy || 1);
    } else {
        dx = dy * aspect * Math.sign(dx || 1);
    }
    return { dx, dy };
}

function onCropPointerDown(e) {
    e.preventDefault();
    const pos = getCropPointerPos(e);
    const c = state.crop;
    const target = e.target;

    if (target.classList.contains('crop-handle')) {
        cropState.handle = target.dataset.handle;
    } else if (target.closest('.crop-selection') || target === $('cropSelection')) {
        cropState.handle = 'move';
    } else {
        // 点击遮罩区域，开始新选区
        cropState.handle = 'new';
        c.x = pos.x; c.y = pos.y; c.w = 1; c.h = 1;
    }

    cropState.dragging = true;
    cropState.startX = pos.x;
    cropState.startY = pos.y;
    cropState.origCrop = { ...c };
}

function onCropPointerMove(e) {
    if (!cropState.dragging) return;
    e.preventDefault();
    const pos = getCropPointerPos(e);
    const c = state.crop;
    const orig = cropState.origCrop;
    const overlay = $('cropOverlay');
    const maxW = parseInt(overlay.style.width);
    const maxH = parseInt(overlay.style.height);

    let dx = pos.x - cropState.startX;
    let dy = pos.y - cropState.startY;

    if (cropState.handle === 'new') {
        c.w = Math.max(10, pos.x - c.x);
        c.h = Math.max(10, pos.y - c.y);
        if (c.x + c.w > maxW) c.w = maxW - c.x;
        if (c.y + c.h > maxH) c.h = maxH - c.y;
        if (c.aspect) {
            c.h = c.w / c.aspect;
            if (c.y + c.h > maxH) { c.h = maxH - c.y; c.w = c.h * c.aspect; }
        }
    } else if (cropState.handle === 'move') {
        c.x = clamp(orig.x + dx, 0, maxW - c.w);
        c.y = clamp(orig.y + dy, 0, maxH - c.h);
    } else {
        // 手柄拖拽
        let nx = orig.x, ny = orig.y, nw = orig.w, nh = orig.h;
        const h = cropState.handle;

        if (h.includes('l')) { nx = orig.x + dx; nw = orig.w - dx; }
        if (h.includes('r')) { nw = orig.w + dx; }
        if (h.includes('t')) { ny = orig.y + dy; nh = orig.h - dy; }
        if (h.includes('b')) { nh = orig.h + dy; }

        // 中间手柄只单方向
        if (h === 'tm') { ny = orig.y + dy; nh = orig.h - dy; }
        if (h === 'bm') { nh = orig.h + dy; }
        if (h === 'ml') { nx = orig.x + dx; nw = orig.w - dx; }
        if (h === 'mr') { nw = orig.w + dx; }

        // 最小尺寸
        if (nw < 20) { nw = 20; if (h.includes('l')) nx = orig.x + orig.w - 20; }
        if (nh < 20) { nh = 20; if (h.includes('t')) ny = orig.y + orig.h - 20; }

        // 宽高比约束
        if (c.aspect && (h === 'tl' || h === 'tr' || h === 'bl' || h === 'br')) {
            const targetH = nw / c.aspect;
            if (h.includes('t')) { ny = orig.y + orig.h - targetH; }
            nh = targetH;
        }

        // 边界
        nx = clamp(nx, 0, maxW - 10);
        ny = clamp(ny, 0, maxH - 10);
        if (nx + nw > maxW) nw = maxW - nx;
        if (ny + nh > maxH) nh = maxH - ny;

        c.x = nx; c.y = ny; c.w = nw; c.h = nh;
    }

    updateCropUI();
}

function onCropPointerUp(e) {
    cropState.dragging = false;
    cropState.handle = null;
}

function initCropEvents() {
    const overlay = $('cropOverlay');
    overlay.addEventListener('mousedown', onCropPointerDown);
    overlay.addEventListener('touchstart', onCropPointerDown, { passive: false });
    document.addEventListener('mousemove', onCropPointerMove);
    document.addEventListener('touchmove', onCropPointerMove, { passive: false });
    document.addEventListener('mouseup', onCropPointerUp);
    document.addEventListener('touchend', onCropPointerUp);
}

// 裁剪比例按钮
$$('[data-crop]').forEach(btn => {
    btn.addEventListener('click', () => {
        if (!state.editImage) return alert('请先选择图片');
        $$('.tool-btn[data-crop]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const ratio = btn.dataset.crop;
        let aspect = null;
        if (ratio === '1:1') aspect = 1;
        else if (ratio === '4:3') aspect = 4 / 3;
        else if (ratio === '16:9') aspect = 16 / 9;
        else if (ratio === '3:4') aspect = 3 / 4;

        state.crop.aspect = aspect;

        if (aspect) {
            // 按比例调整选区
            const c = state.crop;
            const overlay = $('cropOverlay');
            const maxW = parseInt(overlay.style.width);
            const maxH = parseInt(overlay.style.height);
            if (c.w / c.h > aspect) {
                c.w = c.h * aspect;
            } else {
                c.h = c.w / aspect;
            }
            if (c.x + c.w > maxW) { c.w = maxW - c.x; c.h = c.w / aspect; }
            if (c.y + c.h > maxH) { c.h = maxH - c.y; c.w = c.h * aspect; }
            updateCropUI();
        }
    });
});

// 确认裁剪
$('cropConfirmBtn').addEventListener('click', () => {
    if (!state.editImage || !state.crop.active) return;
    const c = state.crop;
    const canvas = $('editCanvas');
    const img = state.editImage;

    // 使用 CSS 尺寸进行坐标转换
    const cssW = parseInt(canvas.style.width) || canvas.width;
    const cssH = parseInt(canvas.style.height) || canvas.height;
    const scaleX = img.width / cssW;
    const scaleY = img.height / cssH;
    const sx = Math.round(c.x * scaleX);
    const sy = Math.round(c.y * scaleY);
    const sw = Math.round(c.w * scaleX);
    const sh = Math.round(c.h * scaleY);

    pushHistory();

    const out = document.createElement('canvas');
    out.width = sw;
    out.height = sh;
    out.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

    const newImg = new Image();
    newImg.onload = () => {
        setEditImage(newImg);
        hideCropOverlay();
        showCropOverlay(); // 重置选区
    };
    newImg.src = out.toDataURL();
});

// 取消裁剪
$('cropCancelBtn').addEventListener('click', () => {
    hideCropOverlay();
});

// 进入裁剪模式时自动显示 overlay
function enterCropMode() {
    if (!state.editImage) return;
    showCropOverlay();
}

initCropEvents();

// 旋转
$$('[data-rotate]').forEach(btn => {
    btn.addEventListener('click', () => {
        if (!state.editImage) return alert('请先选择图片');
        pushHistory();
        const action = btn.dataset.rotate;
        const img = state.editImage;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        if (action === 'left' || action === 'right') {
            canvas.width = img.height;
            canvas.height = img.width;
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate((action === 'right' ? 90 : -90) * Math.PI / 180);
            ctx.drawImage(img, -img.width / 2, -img.height / 2);
        } else if (action === '180') {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate(Math.PI);
            ctx.drawImage(img, -img.width / 2, -img.height / 2);
        } else if (action === 'flipH') {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(img, 0, 0);
        } else {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.translate(0, canvas.height);
            ctx.scale(1, -1);
            ctx.drawImage(img, 0, 0);
        }

        const newImg = new Image();
        newImg.onload = () => setEditImage(newImg);
        newImg.src = canvas.toDataURL();
    });
});

// 任意角度旋转
const freeRotateState = {
    originalImage: null,
    angle: 0
};

function drawFreeRotatePreview(angle) {
    if (!freeRotateState.originalImage) return;
    const img = freeRotateState.originalImage;
    const rad = angle * Math.PI / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const newW = Math.round(img.width * cos + img.height * sin);
    const newH = Math.round(img.width * sin + img.height * cos);

    const canvas = $('editCanvas');
    const ctx = canvas.getContext('2d');
    const maxW = Math.min(window.innerWidth - 32, 500);
    const maxH = window.innerHeight * 0.5;
    const ratio = Math.min(maxW / newW, maxH / newH, 1);

    canvas.width = Math.round(newW * ratio);
    canvas.height = Math.round(newH * ratio);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(rad);
    ctx.drawImage(img, -img.width * ratio / 2, -img.height * ratio / 2, img.width * ratio, img.height * ratio);
    ctx.restore();
}

$('freeRotateAngle').addEventListener('input', e => {
    const angle = parseInt(e.target.value);
    $('freeRotateAngleVal').textContent = angle + '°';
    freeRotateState.angle = angle;
    drawFreeRotatePreview(angle);
});

$('freeRotateConfirm').addEventListener('click', () => {
    if (!freeRotateState.originalImage || freeRotateState.angle === 0) return;
    const img = freeRotateState.originalImage;
    const rad = freeRotateState.angle * Math.PI / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const newW = Math.round(img.width * cos + img.height * sin);
    const newH = Math.round(img.width * sin + img.height * cos);

    const canvas = document.createElement('canvas');
    canvas.width = newW;
    canvas.height = newH;
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.translate(newW / 2, newH / 2);
    ctx.rotate(rad);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();

    pushHistory();
    const newImg = new Image();
    newImg.onload = () => {
        setEditImage(newImg);
        freeRotateState.originalImage = null;
        freeRotateState.angle = 0;
        $('freeRotateAngle').value = 0;
        $('freeRotateAngleVal').textContent = '0°';
    };
    newImg.src = canvas.toDataURL();
});

$('freeRotateCancel').addEventListener('click', () => {
    freeRotateState.angle = 0;
    $('freeRotateAngle').value = 0;
    $('freeRotateAngleVal').textContent = '0°';
    if (freeRotateState.originalImage) {
        state.editImage = freeRotateState.originalImage;
        freeRotateState.originalImage = null;
    }
    drawEdit();
});

// 开始拖拽角度滑块时保存原图
$('freeRotateAngle').addEventListener('mousedown', () => {
    if (state.editImage && !freeRotateState.originalImage) {
        freeRotateState.originalImage = cloneImage(state.editImage);
    }
});
$('freeRotateAngle').addEventListener('touchstart', () => {
    if (state.editImage && !freeRotateState.originalImage) {
        freeRotateState.originalImage = cloneImage(state.editImage);
    }
}, { passive: true });

// 黑白阈值滑块
$('bwThreshold').addEventListener('input', e => {
    state.bwThreshold = parseInt(e.target.value);
    $('bwThresholdVal').textContent = state.bwThreshold;
    drawEdit();
});

// 调色滑块
['brightness', 'contrast', 'saturate', 'sharpness', 'temperature'].forEach(key => {
    const slider = $(key);
    const display = $(key === 'sharpness' ? 'sharpVal' : key === 'temperature' ? 'tempVal' : key + 'Val');
    if (!slider) return;
    slider.addEventListener('input', () => {
        state.adjust[key] = parseInt(slider.value);
        display.textContent = slider.value;
        drawEdit();
    });
});
// ============================================================
// 滤镜预设
// ============================================================

const FILTER_PRESETS = [
    { name: '原图', brightness: 0, contrast: 0, saturate: 0, sharpness: 0, temperature: 0 },
    { name: '暖色', brightness: 5, contrast: 10, saturate: 15, sharpness: 0, temperature: 30 },
    { name: '冷色', brightness: 0, contrast: 5, saturate: -10, sharpness: 0, temperature: -30 },
    { name: '复古', brightness: -5, contrast: -10, saturate: -30, sharpness: 0, temperature: 25 },
    { name: '黑白', brightness: 0, contrast: 20, saturate: -100, sharpness: 0, temperature: 0 },
    { name: '高对比', brightness: 0, contrast: 40, saturate: 10, sharpness: 20, temperature: 0 },
    { name: '柔和', brightness: 10, contrast: -15, saturate: -5, sharpness: 0, temperature: 5 },
    { name: '胶片', brightness: -5, contrast: 15, saturate: -20, sharpness: 0, temperature: 15 },
    { name: '日系', brightness: 15, contrast: -10, saturate: -15, sharpness: 0, temperature: -10 },
    { name: '清新', brightness: 10, contrast: 5, saturate: 10, sharpness: 10, temperature: -15 },
    { name: '暗调', brightness: -20, contrast: 25, saturate: -5, sharpness: 10, temperature: 0 },
    { name: '鲜艳', brightness: 5, contrast: 15, saturate: 50, sharpness: 15, temperature: 0 },
    { name: '奶油', brightness: 15, contrast: -10, saturate: -10, sharpness: 0, temperature: 20 },
    { name: '青橙', brightness: 0, contrast: 20, saturate: 20, sharpness: 10, temperature: -20 },
    { name: '莫兰迪', brightness: 5, contrast: -15, saturate: -40, sharpness: 0, temperature: 10 },
    { name: '夕阳', brightness: 5, contrast: 10, saturate: 25, sharpness: 0, temperature: 40 },
    { name: '赛博', brightness: -5, contrast: 30, saturate: 15, sharpness: 20, temperature: -25 },
];

function renderFilterPresets() {
    const container = $('filterScroll');
    container.innerHTML = '';
    FILTER_PRESETS.forEach((preset, i) => {
        const btn = document.createElement('button');
        btn.className = 'filter-btn' + (i === 0 ? ' active' : '');
        btn.dataset.filterIndex = i;

        const preview = document.createElement('canvas');
        preview.className = 'filter-preview';
        preview.width = 48;
        preview.height = 48;
        btn.appendChild(preview);

        const label = document.createElement('span');
        label.className = 'filter-label';
        label.textContent = preset.name;
        btn.appendChild(label);

        btn.addEventListener('click', () => {
            $$('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyFilterPreset(preset);
        });

        container.appendChild(btn);
    });
    updateFilterPreviews();
}

function applyFilterPreset(preset) {
    Object.keys(preset).forEach(key => {
        if (key === 'name') return;
        state.adjust[key] = preset[key];
        const slider = $(key);
        if (slider) slider.value = preset[key];
        const display = $(key === 'sharpness' ? 'sharpVal' : key === 'temperature' ? 'tempVal' : key + 'Val');
        if (display) display.textContent = preset[key];
    });
    drawEdit();
}

function updateFilterPreviews() {
    if (!state.editImage) return;
    const img = state.editImage;
    const thumbSize = 48;

    $$('.filter-preview').forEach((canvas, i) => {
        const preset = FILTER_PRESETS[i];
        const ctx = canvas.getContext('2d');
        canvas.width = thumbSize;
        canvas.height = thumbSize;

        // 居中裁剪缩略图
        const size = Math.min(img.width, img.height);
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, thumbSize, thumbSize);

        // 用像素操作应用滤镜预览
        const imageData = ctx.getImageData(0, 0, thumbSize, thumbSize);
        const d = imageData.data;
        const brightness = preset.brightness / 100;
        const contrast = (preset.contrast + 100) / 100;
        const saturate = (preset.saturate + 100) / 100;
        const temperature = preset.temperature / 100;

        for (let j = 0; j < d.length; j += 4) {
            let r = d[j], g = d[j+1], b = d[j+2];
            r += brightness * 255;
            g += brightness * 255;
            b += brightness * 255;
            r = ((r / 255 - 0.5) * contrast + 0.5) * 255;
            g = ((g / 255 - 0.5) * contrast + 0.5) * 255;
            b = ((b / 255 - 0.5) * contrast + 0.5) * 255;
            const gray = 0.299 * r + 0.587 * g + 0.114 * b;
            r = gray + (r - gray) * saturate;
            g = gray + (g - gray) * saturate;
            b = gray + (b - gray) * saturate;
            r += temperature * 30;
            b -= temperature * 30;
            d[j] = Math.max(0, Math.min(255, Math.round(r)));
            d[j+1] = Math.max(0, Math.min(255, Math.round(g)));
            d[j+2] = Math.max(0, Math.min(255, Math.round(b)));
        }
        ctx.putImageData(imageData, 0, 0);
    });
}

$('resetAdjust').addEventListener('click', () => {
    state.adjust = { brightness: 0, contrast: 0, saturate: 0, sharpness: 0, temperature: 0 };
    ['brightness', 'contrast', 'saturate', 'sharpness', 'temperature'].forEach(key => {
        $(key).value = 0;
    });
    ['brightnessVal', 'contrastVal', 'saturateVal', 'sharpVal', 'tempVal'].forEach(id => {
        $(id).textContent = '0';
    });
    // 重置滤镜预设选中到"原图"
    $$('.filter-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
    drawEdit();
});

// ============================================================
// 智能调节（基于直方图分析 + 百分位裁剪）
// ============================================================
$('autoAdjustBtn').addEventListener('click', () => {
    if (!state.editImage) return alert('请先选择图片');
    autoAdjustImage();
    drawEdit();
    renderFilterPresets();
});

function autoAdjustImage() {
    const img = state.editImage;
    // 采样分析
    const sampleSize = 256;
    const ratio = Math.min(sampleSize / img.width, sampleSize / img.height, 1);
    const w = Math.round(img.width * ratio);
    const h = Math.round(img.height * ratio);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;
    const pixels = w * h;

    // 1. 收集亮度和颜色数据
    const lumArr = new Uint8Array(pixels);
    const satArr = new Float32Array(pixels);
    let sumR = 0, sumG = 0, sumB = 0;
    let sumLum = 0;

    for (let i = 0; i < pixels; i++) {
        const idx = i * 4;
        const r = d[idx], g = d[idx+1], b = d[idx+2];
        sumR += r;
        sumG += g;
        sumB += b;

        const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        lumArr[i] = lum;
        sumLum += lum;

        // HSL 饱和度
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const l = (max + min) / 510; // 0~1
        satArr[i] = (max === min) ? 0 : (max - min) / (1 - Math.abs(2 * l - 1)) / 255;
    }

    // 2. 排序计算百分位（更鲁棒）
    lumArr.sort();
    const p5 = lumArr[Math.floor(pixels * 0.05)];
    const p50 = lumArr[Math.floor(pixels * 0.5)]; // 中位数
    const p95 = lumArr[Math.floor(pixels * 0.95)];
    const avgLum = sumLum / pixels;
    const avgR = sumR / pixels;
    const avgG = sumG / pixels;
    const avgB = sumB / pixels;

    // 排序饱和度
    satArr.sort();
    const medianSat = satArr[Math.floor(pixels * 0.5)];
    const avgSat = satArr.reduce((a, b) => a + b, 0) / pixels;

    // 3. 亮度调整（基于中位数和百分位）
    let brightness = 0;
    const targetMedian = 120;
    // 用中位数比平均值更鲁棒（不受极端像素影响）
    if (p50 < 80) {
        brightness = Math.min(45, Math.round((targetMedian - p50) * 0.35));
    } else if (p50 > 160) {
        brightness = Math.max(-35, Math.round((targetMedian - p50) * 0.25));
    } else {
        brightness = Math.round((targetMedian - p50) * 0.12);
    }
    // 暗图额外提亮
    if (p5 < 20) brightness = Math.min(50, brightness + 10);
    // 亮图额外压暗
    if (p95 > 245) brightness = Math.max(-40, brightness - 8);
    brightness = Math.max(-50, Math.min(50, brightness));

    // 4. 对比度调整（基于百分位动态范围 + S曲线思想）
    const darkRange = p50 - p5;
    const lightRange = p95 - p50;
    const dynamicRange = p95 - p5;
    let contrast = 0;

    if (dynamicRange < 120) {
        // 低对比度场景，显著增强
        contrast = Math.min(40, Math.round((160 - dynamicRange) * 0.35));
    } else if (dynamicRange > 220) {
        // 高对比度，轻微降低
        contrast = Math.max(-10, Math.round((210 - dynamicRange) * 0.15));
    } else {
        // 适中，微调
        contrast = Math.round((180 - dynamicRange) * 0.1);
    }
    // 暗部细节不足时增加对比
    if (darkRange < 25 && p5 < 40) contrast = Math.min(35, contrast + 8);
    // 亮部细节不足时降低对比
    if (lightRange < 25 && p95 > 220) contrast = Math.max(-15, contrast - 5);
    contrast = Math.max(-30, Math.min(45, contrast));

    // 5. 饱和度调整（基于中位数，更自然）
    let saturate = 0;
    const targetSat = 0.32;
    if (medianSat < 0.15) {
        // 严重欠饱和（如雾天、灰暗场景）
        saturate = Math.min(40, Math.round((targetSat - medianSat) * 70));
    } else if (medianSat > 0.55) {
        // 过饱和
        saturate = Math.max(-25, Math.round((targetSat - medianSat) * 35));
    } else {
        saturate = Math.round((targetSat - medianSat) * 25);
    }
    // 高对比图适当降低饱和度避免刺眼
    if (contrast > 25) saturate = Math.max(-10, saturate - 5);
    saturate = Math.max(-40, Math.min(45, saturate));

    // 6. 色温调整（改进的灰世界白平衡）
    let temperature = 0;
    const grayWorld = (avgR + avgG + avgB) / 3;
    const rDiff = avgR - grayWorld;
    const bDiff = avgB - grayWorld;
    // 只在有明显色偏时校正
    if (Math.abs(rDiff) > 8 || Math.abs(bDiff) > 8) {
        temperature = Math.round((bDiff - rDiff) * 0.25);
    }
    // 避免过度校正（保留部分氛围）
    temperature = Math.round(temperature * 0.7);
    temperature = Math.max(-35, Math.min(35, temperature));

    // 7. 锐化（根据图像清晰度自适应）
    let sharpness = 8;
    // 如果图像整体偏暗或低对比，稍微多锐化
    if (p50 < 80 || dynamicRange < 140) sharpness = 12;
    sharpness = Math.max(5, Math.min(15, sharpness));

    // 8. 应用调整
    state.adjust.brightness = brightness;
    state.adjust.contrast = contrast;
    state.adjust.saturate = saturate;
    state.adjust.temperature = temperature;
    state.adjust.sharpness = sharpness;

    // 更新 UI
    $('brightness').value = brightness;
    $('contrast').value = contrast;
    $('saturate').value = saturate;
    $('temperature').value = temperature;
    $('sharpness').value = sharpness;

    $('brightnessVal').textContent = brightness;
    $('contrastVal').textContent = contrast;
    $('saturateVal').textContent = saturate;
    $('tempVal').textContent = temperature;
    $('sharpVal').textContent = sharpness;

    // 取消滤镜预设选中
    $$('.filter-btn').forEach(b => b.classList.remove('active'));
}

// 压缩转换
// 预估大小（防抖 + 缩小采样）
let estTimer = null;
let estCanvas = null;

function formatSize(bytes) {
    const kb = bytes / 1024;
    if (kb > 1024) return (kb / 1024).toFixed(2) + ' MB';
    return kb.toFixed(1) + ' KB';
}

function updateEstSize() {
    if (!state.editImage) {
        $('estSize').textContent = '-';
        return;
    }
    const format = $('outputFormat').value;
    const quality = parseInt($('quality').value) / 100;

    if (!estCanvas) {
        estCanvas = document.createElement('canvas');
    }
    const img = state.editImage;
    // 用缩小的图估算，提高性能
    const maxEst = 300;
    const ratio = Math.min(maxEst / img.width, maxEst / img.height, 1);
    const w = Math.round(img.width * ratio);
    const h = Math.round(img.height * ratio);
    estCanvas.width = w;
    estCanvas.height = h;
    estCanvas.getContext('2d').drawImage(img, 0, 0, w, h);

    // 用 toBlob 获取实际大小
    try {
        estCanvas.toBlob(blob => {
            if (blob) {
                // 按像素比例推算原图大小
                const scale = (img.width * img.height) / (w * h);
                const estBytes = Math.round(blob.size * scale);
                $('estSize').textContent = formatSize(estBytes);
            } else {
                // toBlob 失败时用简单公式估算
                estimateByFormula(img, format, quality);
            }
        }, format, quality);
    } catch (e) {
        // toBlob 抛出异常时用简单公式估算
        estimateByFormula(img, format, quality);
    }
}

function estimateByFormula(img, format, quality) {
    const pixels = img.width * img.height;
    let bytesPerPixel;
    if (format === 'image/png') {
        bytesPerPixel = 3;
    } else {
        // JPG/WebP，质量越高越大
        bytesPerPixel = 0.3 + quality * 1.5;
    }
    const estBytes = Math.round(pixels * bytesPerPixel);
    $('estSize').textContent = formatSize(estBytes);
}

function debouncedEstSize() {
    clearTimeout(estTimer);
    estTimer = setTimeout(updateEstSize, 200);
}

$('quality').addEventListener('input', e => {
    $('qualityVal').textContent = e.target.value + '%';
    debouncedEstSize();
});

$('outputFormat').addEventListener('change', () => {
    const format = $('outputFormat').value;
    // PNG 无损格式，隐藏质量滑块
    if (format === 'image/png') {
        $('qualityRow').style.display = 'none';
        $('pngHint').style.display = 'block';
        $('webpHint').style.display = 'none';
    } else if (format === 'image/webp') {
        $('qualityRow').style.display = 'flex';
        $('pngHint').style.display = 'none';
        $('webpHint').style.display = 'block';
    } else {
        $('qualityRow').style.display = 'flex';
        $('pngHint').style.display = 'none';
        $('webpHint').style.display = 'none';
    }
    // 格式切换立即更新
    updateEstSize();
});

$('convertBtn').addEventListener('click', () => {
    if (!state.editImage) return alert('请先选择图片');
    const format = $('outputFormat').value;
    const quality = parseInt($('quality').value) / 100;

    // 用原分辨率导出
    const img = state.editImage;
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);

    canvas.toBlob(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const ext = format === 'image/jpeg' ? 'jpg' : format === 'image/png' ? 'png' : 'webp';
        a.download = `converted.${ext}`;
        a.href = url;
        a.click();
        URL.revokeObjectURL(url);
    }, format, quality);
});

// 编辑页保存（按模式选择导出方式）
$('editSaveBtn').addEventListener('click', () => {
    if (!state.editImage) return alert('请先选择图片');
    if (state.editMode === 'bw') {
        exportBWImage(state.bwThreshold);
    } else if (state.editMode === 'adjust') {
        exportAdjustedImage();
    } else {
        // 裁剪/旋转/文字：从 state.editImage 原分辨率导出
        exportEditImage();
    }
});

function exportEditImage() {
    if (!state.editImage) return;
    const img = state.editImage;
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    downloadCanvas(canvas, 'edited.png');
}

// ============================================================
// 文字/水印
// ============================================================

const textState = {
    color: '#ffffff',
    pos: { x: 0.5, y: 0.5 },
    bold: false,
    shadow: false,
    dragging: false,
    dragStartX: 0, dragStartY: 0,
    dragOrigX: 0, dragOrigY: 0,
    active: false
};

// 文字模式切换
$('textModeBtn').addEventListener('click', () => {
    if (!state.editImage) return alert('请先选择图片');
    const tools = $('textTools');
    const visible = tools.style.display !== 'none';
    if (visible) {
        // 关闭文字模式，恢复当前编辑模式的工具栏
        tools.style.display = 'none';
        $('textOverlay').style.display = 'none';
        textState.active = false;
        restoreEditTools();
    } else {
        // 进入文字模式，隐藏其他工具栏
        ['cropTools', 'rotateTools', 'adjustTools', 'bwTools', 'compressTools', 'filterTools'].forEach(id => {
            $(id).style.display = 'none';
        });
        hideCropOverlay();
        tools.style.display = 'flex';
        showTextOverlay();
    }
});

function restoreEditTools() {
    const m = state.editMode;
    if (m === 'crop' || m === 'rotate') {
        $('cropTools').style.display = 'flex';
        $('rotateTools').style.display = 'flex';
        $('freeRotateTools').style.display = 'flex';
        if (state.editImage) setTimeout(enterCropMode, 50);
    } else if (m === 'adjust') {
        $('adjustTools').style.display = 'flex';
        $('filterTools').style.display = 'flex';
    } else if (m === 'bw') {
        $('bwTools').style.display = 'flex';
    } else if (m === 'compress') {
        $('compressTools').style.display = 'flex';
    } else if (m === 'selective-color') {
        $('selectiveColorTools').style.display = 'flex';
    } else if (m === 'circle-crop') {
        $('circleCropTools').style.display = 'flex';
        if (state.editImage) setTimeout(showCircleCropPreview, 50);
    }
}

// 隐藏所有编辑模式工具栏
function hideAllEditTools() {
    ['cropTools', 'rotateTools', 'freeRotateTools', 'adjustTools', 'bwTools', 'compressTools',
     'filterTools', 'textTools', 'mosaicTools', 'brushTools', 'stickerTools', 'borderTools',
     'selectiveColorTools', 'circleCropTools'
    ].forEach(id => { $(id).style.display = 'none'; });
    hideCropOverlay();
    hidePaintOverlay();
    hideCompareOverlay();
    hideCircleCropPreview();
}

// 通用模式切换
function toggleEditMode(btnId, toolsId, overlayFn) {
    $(btnId).addEventListener('click', () => {
        if (!state.editImage) return alert('请先选择图片');
        const tools = $(toolsId);
        const visible = tools.style.display !== 'none';
        if (visible) {
            tools.style.display = 'none';
            if (overlayFn) overlayFn(false);
            restoreEditTools();
        } else {
            hideAllEditTools();
            tools.style.display = 'flex';
            if (overlayFn) overlayFn(true);
        }
    });
}

// 字号滑块
$('fontSize').addEventListener('input', e => {
    $('fontSizeVal').textContent = e.target.value;
});

// 透明度滑块
$('textOpacity').addEventListener('input', e => {
    $('textOpacityVal').textContent = e.target.value + '%';
});

// 文字拖拽 overlay
function showTextOverlay() {
    const overlay = $('textOverlay');
    const canvas = $('editCanvas');
    // 使用 CSS 尺寸（不是 canvas 实际像素）
    const cssW = parseInt(canvas.style.width) || canvas.width;
    const cssH = parseInt(canvas.style.height) || canvas.height;
    overlay.style.display = 'block';
    overlay.style.width = cssW + 'px';
    overlay.style.height = cssH + 'px';
    textState.active = true;
    updateTextPreview();
}

function updateTextPreview() {
    if (!textState.active) return;
    const preview = $('textPreview');
    const overlay = $('textOverlay');
    if (!overlay || overlay.style.display === 'none') return;
    const w = parseInt(overlay.style.width);
    const h = parseInt(overlay.style.height);

    preview.style.left = (textState.pos.x * w) + 'px';
    preview.style.top = (textState.pos.y * h) + 'px';

    const size = parseInt($('fontSize').value);
    const scaledSize = Math.max(10, Math.round(size * w / 1000));
    preview.style.fontSize = scaledSize + 'px';
    preview.style.fontFamily = $('fontFamily').value;
    preview.style.color = textState.color;
    preview.style.fontWeight = textState.bold ? 'bold' : 'normal';
    preview.style.opacity = parseInt($('textOpacity').value) / 100;
    if (textState.shadow) {
        preview.style.textShadow = '0 0 6px rgba(0,0,0,0.8)';
    } else {
        preview.style.textShadow = 'none';
    }

    const text = $('textInput').value;
    preview.textContent = text || '';
}

// 文字拖拽事件
function initTextDrag() {
    const overlay = $('textOverlay');
    const preview = $('textPreview');

    function getPos(e) {
        const touch = e.touches ? e.touches[0] : e;
        return { x: touch.clientX, y: touch.clientY };
    }

    function onStart(e) {
        e.preventDefault();
        textState.dragging = true;
        const p = getPos(e);
        textState.dragStartX = p.x;
        textState.dragStartY = p.y;
        textState.dragOrigX = textState.pos.x;
        textState.dragOrigY = textState.pos.y;
    }

    function onMove(e) {
        if (!textState.dragging) return;
        e.preventDefault();
        const p = getPos(e);
        const w = parseInt(overlay.style.width);
        const h = parseInt(overlay.style.height);
        const dx = p.x - textState.dragStartX;
        const dy = p.y - textState.dragStartY;
        textState.pos.x = Math.max(0, Math.min(1, textState.dragOrigX + dx / w));
        textState.pos.y = Math.max(0, Math.min(1, textState.dragOrigY + dy / h));
        updateTextPreview();
    }

    function onEnd() { textState.dragging = false; }

    preview.addEventListener('touchstart', onStart, { passive: false });
    preview.addEventListener('mousedown', onStart);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchend', onEnd);
    document.addEventListener('mouseup', onEnd);
}

initTextDrag();

// 实时更新文字预览
['textInput', 'fontSize', 'fontFamily', 'textOpacity'].forEach(id => {
    $(id).addEventListener('input', updateTextPreview);
});

// 文字颜色
applyColorDots('#textColors', dot => {
    textState.color = dot.dataset.color;
    updateTextPreview();
});

// 加粗/阴影切换
$('boldToggle').addEventListener('click', () => {
    textState.bold = !textState.bold;
    $('boldToggle').classList.toggle('active', textState.bold);
    updateTextPreview();
});
$('shadowToggle').addEventListener('click', () => {
    textState.shadow = !textState.shadow;
    $('shadowToggle').classList.toggle('active', textState.shadow);
    updateTextPreview();
});

// 添加文字
$('addTextBtn').addEventListener('click', () => {
    if (!state.editImage) return alert('请先选择图片');
    const text = $('textInput').value.trim();
    if (!text) return alert('请输入文字');

    const img = state.editImage;
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const size = parseInt($('fontSize').value);
    const fontFamily = $('fontFamily').value;
    const opacity = parseInt($('textOpacity').value) / 100;
    const bold = textState.bold;
    const shadow = textState.shadow;

    // 根据原图尺寸缩放字号（字号基于 1000px 宽度）
    const scaledSize = Math.round(size * img.width / 1000);

    ctx.font = `${bold ? 'bold ' : ''}${scaledSize}px ${fontFamily}`;
    ctx.textBaseline = 'top';
    ctx.globalAlpha = opacity;

    // 计算文字宽高
    const metrics = ctx.measureText(text);
    const textW = metrics.width;
    const textH = scaledSize * 1.2;

    // 位置计算（基于拖拽的归一化坐标）
    const tx = textState.pos.x * img.width - textW / 2;
    const ty = textState.pos.y * img.height - textH / 2;

    // 阴影
    if (shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.7)';
        ctx.shadowBlur = scaledSize * 0.15;
        ctx.shadowOffsetX = scaledSize * 0.05;
        ctx.shadowOffsetY = scaledSize * 0.05;
    }

    ctx.fillStyle = textState.color;
    ctx.fillText(text, tx, ty);
    ctx.globalAlpha = 1;
    ctx.shadowColor = 'transparent';

    pushHistory();

    const newImg = new Image();
    newImg.onload = () => setEditImage(newImg);
    newImg.src = canvas.toDataURL();
});

// ============================================================
// 马赛克/模糊 + 画笔 共用的 overlay canvas 逻辑
// ============================================================

const paintState = {
    active: false,
    drawing: false,
    mode: null, // 'mosaic' | 'brush'
    lastX: 0, lastY: 0,
    mosaicMode: 'pixel',
    mosaicSize: 15,
    brushSize: 8,
    brushColor: '#ff4757',
    brushOpacity: 100
};

function showPaintCanvas() {
    const pc = $('paintCanvas');
    const ec = $('editCanvas');
    if (!ec.width || !ec.height) return;
    const { w: cssW, h: cssH } = getCssSize(ec);
    pc.width = cssW;
    pc.height = cssH;
    pc.style.width = cssW + 'px';
    pc.style.height = cssH + 'px';
    pc.style.display = 'block';
    pc.getContext('2d').clearRect(0, 0, cssW, cssH);
}

// hideMosaicOverlay / hideBrushOverlay → hidePaintOverlay (统一辅助函数)

function getPaintPos(e) {
    const pc = $('paintCanvas');
    const rect = pc.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    return {
        x: (touch.clientX - rect.left) * (pc.width / rect.width),
        y: (touch.clientY - rect.top) * (pc.height / rect.height)
    };
}

function paintDot(ctx, x, y) {
    if (paintState.mode === 'mosaic') {
        applyMosaicAt(ctx, x, y, paintState.mosaicSize, paintState.mosaicMode);
    } else if (paintState.mode === 'brush') {
        ctx.globalAlpha = paintState.brushOpacity / 100;
        ctx.fillStyle = paintState.brushColor;
        ctx.beginPath();
        ctx.arc(x, y, paintState.brushSize / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}

function applyMosaicAt(ctx, cx, cy, size, mode) {
    const editCanvas = $('editCanvas');
    const editCtx = editCanvas.getContext('2d');
    const half = size / 2;
    const sx = Math.max(0, Math.floor(cx - half));
    const sy = Math.max(0, Math.floor(cy - half));
    const sw = Math.min(size, editCanvas.width - sx);
    const sh = Math.min(size, editCanvas.height - sy);
    if (sw <= 0 || sh <= 0) return;

    if (mode === 'pixel') {
        // 马赛克：取区域平均色
        const data = editCtx.getImageData(sx, sy, sw, sh);
        const d = data.data;
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < d.length; i += 4) {
            r += d[i]; g += d[i+1]; b += d[i+2]; count++;
        }
        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(sx, sy, sw, sh);
    } else {
        // 模糊：缩小再放大
        const tmp = document.createElement('canvas');
        const blurAmount = Math.max(1, Math.floor(size / 5));
        tmp.width = Math.max(1, Math.floor(sw / blurAmount));
        tmp.height = Math.max(1, Math.floor(sh / blurAmount));
        const tmpCtx = tmp.getContext('2d');
        tmpCtx.drawImage(editCanvas, sx, sy, sw, sh, 0, 0, tmp.width, tmp.height);
        ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, sx, sy, sw, sh);
    }
}

// ============================================================
// 统一 paintCanvas 事件系统（画笔/马赛克/贴纸共用）
// ============================================================
function initUnifiedCanvasEvents() {
    const pc = $('paintCanvas');
    let stickerLongPress = null;
    let stickerLPIdx = -1;
    let pinchStartDist = 0, pinchStartSize = 0, pinchIdx = -1;

    function getPos(e) {
        const rect = pc.getBoundingClientRect();
        const touch = e.touches ? e.touches[0] : e;
        return {
            x: (touch.clientX - rect.left) * (pc.width / rect.width),
            y: (touch.clientY - rect.top) * (pc.height / rect.height)
        };
    }
    function getTouchDist(e) {
        if (!e.touches || e.touches.length < 2) return 0;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }
    function findSticker(x, y) {
        for (let i = stickerState.placed.length - 1; i >= 0; i--) {
            const s = stickerState.placed[i];
            if (Math.abs(x - s.x) < s.size * 0.6 && Math.abs(y - s.y) < s.size * 0.6) return i;
        }
        return -1;
    }
    function clearStickerLP() {
        if (stickerLongPress) { clearTimeout(stickerLongPress); stickerLongPress = null; }
    }

    function onStart(e) {
        if (!paintState.active) return;
        const mode = paintState.mode;
        e.preventDefault();

        // ---- 贴纸模式 ----
        if (mode === 'sticker') {
            if (e.touches && e.touches.length === 2) {
                clearStickerLP(); stickerState.dragging = false;
                const rect = pc.getBoundingClientRect();
                const cx = ((e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left) * (pc.width / rect.width);
                const cy = ((e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top) * (pc.height / rect.height);
                pinchIdx = findSticker(cx, cy);
                if (pinchIdx >= 0) { pinchStartDist = getTouchDist(e); pinchStartSize = stickerState.placed[pinchIdx].size; }
                return;
            }
            const pos = getPos(e);
            stickerLPIdx = findSticker(pos.x, pos.y);
            if (stickerLPIdx >= 0) {
                const s = stickerState.placed[stickerLPIdx];
                stickerLongPress = setTimeout(() => {
                    stickerLongPress = null;
                    stickerState.dragging = true;
                    stickerState.dragIndex = stickerLPIdx;
                    stickerState.dragStartX = pos.x; stickerState.dragStartY = pos.y;
                    stickerState.dragOrigX = s.x; stickerState.dragOrigY = s.y;
                    drawStickersOnOverlay(stickerLPIdx);
                }, 400);
            }
            return;
        }

        // ---- 画笔/马赛克模式 ----
        paintState.drawing = true;
        const pos = getPos(e);
        paintState.lastX = pos.x; paintState.lastY = pos.y;
        paintDot(pc.getContext('2d'), pos.x, pos.y);
    }

    function onMove(e) {
        if (!paintState.active) return;
        const mode = paintState.mode;
        e.preventDefault();

        // ---- 贴纸模式 ----
        if (mode === 'sticker') {
            if (e.touches && e.touches.length === 2 && pinchIdx >= 0) {
                const scale = getTouchDist(e) / pinchStartDist;
                stickerState.placed[pinchIdx].size = Math.max(16, Math.min(200, Math.round(pinchStartSize * scale)));
                drawStickersOnOverlay(pinchIdx);
                return;
            }
            if (stickerState.dragging) {
                const pos = getPos(e);
                const s = stickerState.placed[stickerState.dragIndex];
                s.x = stickerState.dragOrigX + (pos.x - stickerState.dragStartX);
                s.y = stickerState.dragOrigY + (pos.y - stickerState.dragStartY);
                drawStickersOnOverlay(stickerState.dragIndex);
            } else if (stickerLPIdx >= 0) {
                const pos = getPos(e);
                const s = stickerState.placed[stickerLPIdx];
                if (Math.abs(pos.x - s.x) > 15 || Math.abs(pos.y - s.y) > 15) clearStickerLP();
            }
            return;
        }

        // ---- 画笔/马赛克模式 ----
        if (!paintState.drawing) return;
        const pos = getPos(e);
        const ctx = pc.getContext('2d');
        const dx = pos.x - paintState.lastX;
        const dy = pos.y - paintState.lastY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const step = mode === 'mosaic' ? paintState.mosaicSize / 3 : Math.max(2, paintState.brushSize / 4);
        const steps = Math.max(1, Math.floor(dist / step));
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            paintDot(ctx, paintState.lastX + dx * t, paintState.lastY + dy * t);
        }
        paintState.lastX = pos.x;
        paintState.lastY = pos.y;
    }

    function onEnd() {
        clearStickerLP();
        stickerState.dragging = false;
        pinchIdx = -1;
        if (paintState.mode === 'sticker') drawStickersOnOverlay(-1);
        paintState.drawing = false;
    }

    // 绑定一次，不再重复
    pc.addEventListener('touchstart', onStart, { passive: false });
    pc.addEventListener('touchmove', onMove, { passive: false });
    pc.addEventListener('touchend', onEnd);
    pc.addEventListener('mousedown', onStart);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
}
initUnifiedCanvasEvents();

// 马赛克模式切换
toggleEditMode('mosaicModeBtn', 'mosaicTools', on => {
    if (on) { paintState.mode = 'mosaic'; paintState.active = true; showPaintCanvas(); }
    else hidePaintOverlay();
});

// 马赛克设置
$$('[data-mosaic]').forEach(btn => {
    btn.addEventListener('click', () => {
        $$('[data-mosaic]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        paintState.mosaicMode = btn.dataset.mosaic;
    });
});
$('mosaicSize').addEventListener('input', e => {
    paintState.mosaicSize = parseInt(e.target.value);
    $('mosaicSizeVal').textContent = e.target.value;
});

// 应用马赛克
$('applyMosaicBtn').addEventListener('click', () => applyPaintOverlay('mosaicTools'));

// 画笔模式切换
toggleEditMode('brushModeBtn', 'brushTools', on => {
    if (on) { paintState.mode = 'brush'; paintState.active = true; showPaintCanvas(); }
    else hidePaintOverlay();
});

// 画笔设置
$('brushSize').addEventListener('input', e => {
    paintState.brushSize = parseInt(e.target.value);
    $('brushSizeVal').textContent = e.target.value;
});
$('brushOpacity').addEventListener('input', e => {
    paintState.brushOpacity = parseInt(e.target.value);
    $('brushOpacityVal').textContent = e.target.value + '%';
});
applyColorDots('#brushColors', dot => {
    paintState.brushColor = dot.dataset.color;
});

// 应用画笔
$('applyBrushBtn').addEventListener('click', () => applyPaintOverlay('brushTools'));

// ============================================================
// 贴纸/表情
// ============================================================

const EMOJI_LIST = [
    '😀','😂','🤣','😍','🥰','😎','🤔','😱',
    '👍','👏','🙌','💪','❤️','🔥','⭐','🎉',
    '🌸','🍕','🎮','📸','🎵','🏆','💎','🌈',
    '👻','💀','🤡','👽','🤖','💩','🎃','😈',
    '✅','❌','⚠️','💤','💢','❓','❗','💯'
];

const stickerState = {
    placed: [], // { emoji, x, y, size }
    dragging: false,
    dragIndex: -1,
    dragStartX: 0, dragStartY: 0,
    dragOrigX: 0, dragOrigY: 0
};

function renderStickerPanel() {
    const container = $('stickerScroll');
    container.innerHTML = '';
    EMOJI_LIST.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'sticker-btn';
        btn.textContent = emoji;
        btn.addEventListener('click', () => placeSticker(emoji));
        container.appendChild(btn);
    });
}
renderStickerPanel();

function placeSticker(emoji) {
    const pc = $('paintCanvas');
    // 放在画布中心
    stickerState.placed.push({
        emoji,
        x: pc.width / 2,
        y: pc.height / 2,
        size: Math.max(24, Math.round(pc.width / 10))
    });
    drawStickersOnOverlay();
}

function drawStickersOnOverlay(highlightIdx) {
    const pc = $('paintCanvas');
    const ctx = pc.getContext('2d');
    ctx.clearRect(0, 0, pc.width, pc.height);
    stickerState.placed.forEach((s, i) => {
        ctx.font = `${s.size}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(s.emoji, s.x, s.y);
        // 选中高亮
        if (i === highlightIdx) {
            ctx.strokeStyle = '#667eea';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(s.x - s.size * 0.55, s.y - s.size * 0.55, s.size * 1.1, s.size * 1.1);
            ctx.setLineDash([]);
        }
    });
}

toggleEditMode('stickerModeBtn', 'stickerTools', on => {
    if (on) { paintState.mode = 'sticker'; paintState.active = true; stickerState.placed = []; showPaintCanvas(); }
    else hidePaintOverlay();
});


// 贴纸应用（点击"添加"按钮由用户在贴纸面板选emoji触发 placeSticker，这里不需要额外按钮）
// 贴纸需要一个"完成"按钮来合并到图片，复用 applyMosaicBtn 的逻辑
// 我在贴纸面板加一个完成按钮

// 贴纸应用
$('applyStickerBtn').addEventListener('click', () => {
    if (!stickerState.placed.length) return;
    applyPaintOverlay('stickerTools');
});

// ============================================================
// 边框/相框
// ============================================================

const borderState = {
    style: 'none',
    width: 20,
    color: '#ffffff'
};

toggleEditMode('borderModeBtn', 'borderTools', () => drawEdit());

$$('[data-border]').forEach(btn => {
    btn.addEventListener('click', () => {
        $$('[data-border]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        borderState.style = btn.dataset.border;
        drawEdit();
    });
});
$('borderWidth').addEventListener('input', e => {
    borderState.width = parseInt(e.target.value);
    $('borderWidthVal').textContent = e.target.value;
    drawEdit();
});
applyColorDots('#borderColors', dot => {
    borderState.color = dot.dataset.color;
    drawEdit();
});

$('applyBorderBtn').addEventListener('click', () => {
    if (!state.editImage) return;
    const img = state.editImage;
    const bw = borderState.width;
    const style = borderState.style;

    if (style === 'none') return;

    pushHistory();

    let outW, outH;
    if (style === 'shadow') {
        outW = img.width + bw * 2;
        outH = img.height + bw * 2;
    } else {
        outW = img.width + bw * 2;
        outH = img.height + bw * 2;
    }

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');

    if (style === 'shadow') {
        // 卡片阴影：白色边框 + 四周内阴影
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, outW, outH);
        ctx.drawImage(img, 0, 0, img.width, img.height, bw, bw, img.width, img.height);
        const shadowW = Math.max(8, bw * 0.3);
        // 上
        let grad = ctx.createLinearGradient(0, bw, 0, bw + shadowW);
        grad.addColorStop(0, 'rgba(0,0,0,0.25)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad; ctx.fillRect(bw, bw, img.width, shadowW);
        // 左
        grad = ctx.createLinearGradient(bw, 0, bw + shadowW, 0);
        grad.addColorStop(0, 'rgba(0,0,0,0.2)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad; ctx.fillRect(bw, bw, shadowW, img.height);
        // 下
        grad = ctx.createLinearGradient(0, bw + img.height, 0, bw + img.height - shadowW);
        grad.addColorStop(0, 'rgba(0,0,0,0.3)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad; ctx.fillRect(bw, bw + img.height - shadowW, img.width, shadowW);
        // 右
        grad = ctx.createLinearGradient(bw + img.width, 0, bw + img.width - shadowW, 0);
        grad.addColorStop(0, 'rgba(0,0,0,0.3)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad; ctx.fillRect(bw + img.width - shadowW, bw, shadowW, img.height);
    } else if (style === 'rounded') {
        // 圆角边框
        ctx.fillStyle = borderState.color;
        ctx.fillRect(0, 0, outW, outH);
        const r = Math.min(Math.round(bw * 1.5), outW * 0.1, outH * 0.1);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(bw + r, bw);
        ctx.lineTo(bw + img.width - r, bw);
        ctx.quadraticCurveTo(bw + img.width, bw, bw + img.width, bw + r);
        ctx.lineTo(bw + img.width, bw + img.height - r);
        ctx.quadraticCurveTo(bw + img.width, bw + img.height, bw + img.width - r, bw + img.height);
        ctx.lineTo(bw + r, bw + img.height);
        ctx.quadraticCurveTo(bw, bw + img.height, bw, bw + img.height - r);
        ctx.lineTo(bw, bw + r);
        ctx.quadraticCurveTo(bw, bw, bw + r, bw);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(img, 0, 0, img.width, img.height, bw, bw, img.width, img.height);
        ctx.restore();
    } else {
        // 纯色边框
        ctx.fillStyle = borderState.color;
        ctx.fillRect(0, 0, outW, outH);
        ctx.drawImage(img, 0, 0, img.width, img.height, bw, bw, img.width, img.height);
    }

    const newImg = new Image();
    newImg.onload = () => {
        setEditImage(newImg);
        $('borderTools').style.display = 'none';
        restoreEditTools();
    };
    newImg.src = canvas.toDataURL();
});

// ============================================================
// 智能抠图
// ============================================================

const cutoutState = {
    bgColor: 'transparent' // 'transparent' | '#ffffff' | '#000000'
};

// 背景色选择
$$('[data-cutout-bg]').forEach(btn => {
    btn.addEventListener('click', () => {
        $$('[data-cutout-bg]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        cutoutState.bgColor = btn.dataset.cutoutBg;
        if (state.cutoutImage) drawCutout(state.cutoutImage);
    });
});

$('addCutoutPhotoBtn').addEventListener('click', () => $('cutoutPhotoInput').click());
$('cutoutPhotoInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    showLoading('加载图片...');
    try {
        state.cutoutImage = await loadImage(file);
        drawCutout(state.cutoutImage);
        $('cutoutTools').style.display = 'flex';
    } catch (_) {}
    hideLoading();
    e.target.value = '';
});

function drawCutout(img) {
    const canvas = $('cutoutCanvas');
    const { ctx, cssW, cssH } = setupCanvas(canvas, img, { maxW: Math.min(window.innerWidth - 32, 500), maxH: window.innerHeight * 0.5 });

    // 画背景
    if (cutoutState.bgColor !== 'transparent') {
        ctx.fillStyle = cutoutState.bgColor;
        ctx.fillRect(0, 0, cssW, cssH);
    } else {
        ctx.clearRect(0, 0, cssW, cssH);
    }

    ctx.drawImage(img, 0, 0, cssW, cssH);

    // 透明背景时显示棋盘格提示
    const wrap = canvas.parentElement;
    if (cutoutState.bgColor === 'transparent') {
        wrap.classList.add('checkerboard');
    } else {
        wrap.classList.remove('checkerboard');
    }
}

$('doCutoutBtn').addEventListener('click', async () => {
    const apiKey = $('apiKeyInput').value.trim();
    if (!apiKey) return alert('请输入 remove.bg API Key');
    if (!state.cutoutImage) return alert('请先选择图片');

    showLoading('AI 抠图中...');

    // 把canvas转成blob发送
    const canvas = $('cutoutCanvas');
    canvas.toBlob(async blob => {
        const formData = new FormData();
        formData.append('image_file', blob, 'image.png');
        formData.append('size', 'auto');

        try {
            const res = await fetch('https://api.remove.bg/v1.0/removebg', {
                method: 'POST',
                headers: { 'X-Api-Key': apiKey },
                body: formData
            });

            if (!res.ok) {
                const err = await res.json();
                hideLoading();
                return alert('抠图失败: ' + (err.errors?.[0]?.title || res.statusText));
            }

            const resultBlob = await res.blob();
            const url = URL.createObjectURL(resultBlob);
            const newImg = new Image();
            newImg.onload = () => {
                state.cutoutImage = newImg;
                drawCutout(newImg);
                hideLoading();
            };
            newImg.src = url;
        } catch (err) {
            hideLoading();
            alert('请求失败: ' + err.message);
        }
    }, 'image/png');
});

$('cutoutSaveBtn').addEventListener('click', () => {
    // 如果有背景色，导出时需要合并背景
    if (cutoutState.bgColor !== 'transparent') {
        const img = state.cutoutImage;
        if (!img) return;
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = cutoutState.bgColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        downloadCanvas(canvas, 'cutout.png');
    } else {
        downloadCanvas($('cutoutCanvas'), 'cutout.png');
    }
});

// ============================================================
// 局部色彩（保留单色）
// ============================================================

// 颜色选择
applyColorDots('#selectiveColors', dot => {
    state.selectiveHue = parseInt(dot.dataset.hue);
    drawEditSelectiveColor();
});

$('selectiveTolerance').addEventListener('input', e => {
    state.selectiveTolerance = parseInt(e.target.value);
    $('selectiveToleranceVal').textContent = e.target.value;
    drawEditSelectiveColor();
});

function drawEditSelectiveColor() {
    if (!state.editImage) return;
    const canvas = $('editCanvas');
    const img = state.editImage;
    const { ctx, cssW, cssH } = setupCanvas(canvas, img, { maxW: Math.min(window.innerWidth - 32, 500), maxH: window.innerHeight * 0.5 });
    ctx.drawImage(img, 0, 0, cssW, cssH);
    applySelectiveColor(ctx, canvas.width, canvas.height, state.selectiveHue, state.selectiveTolerance);
}

function applySelectiveColor(ctx, w, h, targetHue, tolerance) {
    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const delta = max - min;
        let hue = 0;
        if (delta > 0) {
            if (max === r) hue = 60 * (((g - b) / delta) % 6);
            else if (max === g) hue = 60 * ((b - r) / delta + 2);
            else hue = 60 * ((r - g) / delta + 4);
        }
        if (hue < 0) hue += 360;
        let diff = Math.abs(hue - targetHue);
        if (diff > 180) diff = 360 - diff;
        if (diff > tolerance) {
            const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
            d[i] = d[i + 1] = d[i + 2] = gray;
        }
    }
    ctx.putImageData(imageData, 0, 0);
}

$('applySelectiveColorBtn').addEventListener('click', () => {
    if (!state.editImage) return alert('请先选择图片');
    const img = state.editImage;
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    applySelectiveColor(ctx, img.width, img.height, state.selectiveHue, state.selectiveTolerance);
    pushHistory();
    const newImg = new Image();
    newImg.onload = () => setEditImage(newImg);
    newImg.src = canvas.toDataURL();
});

// ============================================================
// 圆形裁剪（可拖拽）
// ============================================================

const circleCropState = {
    cx: 0.5, cy: 0.5,  // 归一化中心坐标
    dragging: false,
    dragOffsetX: 0, dragOffsetY: 0,
    active: false
};

function showCircleCropPreview() {
    if (!state.editImage) return;
    drawEdit();
    circleCropState.active = true;
    const overlay = $('circleCropCanvas');
    const ec = $('editCanvas');
    const { w: cssW, h: cssH } = getCssSize(ec);
    overlay.width = cssW;
    overlay.height = cssH;
    overlay.style.width = cssW + 'px';
    overlay.style.height = cssH + 'px';
    overlay.style.display = 'block';
    drawCircleCropOverlay();
}

function hideCircleCropPreview() {
    circleCropState.active = false;
    $('circleCropCanvas').style.display = 'none';
}

function drawCircleCropOverlay() {
    if (!circleCropState.active) return;
    const overlay = $('circleCropCanvas');
    const ctx = overlay.getContext('2d');
    const w = overlay.width, h = overlay.height;
    ctx.clearRect(0, 0, w, h);
    const cx = circleCropState.cx * w;
    const cy = circleCropState.cy * h;
    const radius = Math.min(w, h) * state.circleCropSize / 200;
    // 半透明遮罩
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.clearRect(0, 0, w, h);
    ctx.restore();
    // 圆形边框
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    // 中心十字
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy); ctx.lineTo(cx + 8, cy);
    ctx.moveTo(cx, cy - 8); ctx.lineTo(cx, cy + 8);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
}

// 圆形裁剪拖拽
function initCircleCropDrag() {
    const overlay = $('circleCropCanvas');
    function getPos(e) {
        const rect = overlay.getBoundingClientRect();
        const touch = e.touches ? e.touches[0] : e;
        return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    }
    function onStart(e) {
        if (!circleCropState.active) return;
        e.preventDefault();
        const pos = getPos(e);
        const { w, h } = getCssSize(overlay);
        const cx = circleCropState.cx * w, cy = circleCropState.cy * h;
        const radius = Math.min(w, h) * state.circleCropSize / 200;
        const dx = pos.x - cx, dy = pos.y - cy;
        if (Math.sqrt(dx * dx + dy * dy) <= radius + 20) {
            circleCropState.dragging = true;
            circleCropState.dragOffsetX = dx;
            circleCropState.dragOffsetY = dy;
        }
    }
    function onMove(e) {
        if (!circleCropState.dragging) return;
        e.preventDefault();
        const pos = getPos(e);
        const { w, h } = getCssSize(overlay);
        const radius = Math.min(w, h) * state.circleCropSize / 200;
        let nx = (pos.x - circleCropState.dragOffsetX) / w;
        let ny = (pos.y - circleCropState.dragOffsetY) / h;
        // 限制边界
        nx = Math.max(radius / w, Math.min(1 - radius / w, nx));
        ny = Math.max(radius / h, Math.min(1 - radius / h, ny));
        circleCropState.cx = nx;
        circleCropState.cy = ny;
        drawCircleCropOverlay();
    }
    function onEnd() { circleCropState.dragging = false; }
    overlay.addEventListener('touchstart', onStart, { passive: false });
    overlay.addEventListener('mousedown', onStart);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchend', onEnd);
    document.addEventListener('mouseup', onEnd);
}
initCircleCropDrag();

$('circleCropSize').addEventListener('input', e => {
    state.circleCropSize = parseInt(e.target.value);
    $('circleCropSizeVal').textContent = e.target.value + '%';
    drawCircleCropOverlay();
});

$$('[data-circle-bg]').forEach(btn => {
    btn.addEventListener('click', () => {
        $$('[data-circle-bg]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.circleCropBg = btn.dataset.circleBg;
    });
});

$('circleCropConfirm').addEventListener('click', () => {
    if (!state.editImage) return alert('请先选择图片');
    const img = state.editImage;
    // 计算原图上的裁剪区域
    const ec = $('editCanvas');
    const { w: cssW, h: cssH } = getCssSize(ec);
    const scaleX = img.width / cssW;
    const scaleY = img.height / cssH;
    const radiusCss = Math.min(cssW, cssH) * state.circleCropSize / 200;
    const cxImg = circleCropState.cx * img.width;
    const cyImg = circleCropState.cy * img.height;
    const radiusImg = radiusCss * Math.min(scaleX, scaleY);
    // 输出为正方形，边长 = 直径
    const outSize = Math.round(radiusImg * 2);
    const canvas = document.createElement('canvas');
    canvas.width = outSize;
    canvas.height = outSize;
    const ctx = canvas.getContext('2d');
    if (state.circleCropBg !== 'transparent') {
        ctx.fillStyle = state.circleCropBg;
        ctx.fillRect(0, 0, outSize, outSize);
    }
    ctx.save();
    ctx.beginPath();
    ctx.arc(outSize / 2, outSize / 2, radiusImg, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img,
        cxImg - radiusImg, cyImg - radiusImg, outSize, outSize,
        0, 0, outSize, outSize
    );
    ctx.restore();
    pushHistory();
    const newImg = new Image();
    newImg.onload = () => {
        setEditImage(newImg);
        hideCircleCropPreview();
    };
    newImg.src = canvas.toDataURL();
});

$('circleCropCancel').addEventListener('click', () => {
    hideCircleCropPreview();
    drawEdit();
});

// ============================================================
// 图片分割
// ============================================================

$('addSplitPhotoBtn').addEventListener('click', () => $('splitPhotoInput').click());
$('splitPhotoInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    showLoading('加载图片...');
    try {
        state.splitImage = await loadImage(file);
        drawSplitPreview();
    } catch (_) {}
    hideLoading();
    e.target.value = '';
});

// 分割模板按钮
$$('.tpl-btn[data-split]').forEach(btn => {
    btn.addEventListener('click', () => {
        $$('.tpl-btn[data-split]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.splitGrid = btn.dataset.split;
        drawSplitPreview();
    });
});

function getSplitDims() {
    const parts = state.splitGrid.split('x');
    return { cols: parseInt(parts[0]), rows: parseInt(parts[1]) };
}

function drawSplitPreview() {
    if (!state.splitImage) return;
    const img = state.splitImage;
    const { cols, rows } = getSplitDims();
    const canvas = $('splitPreviewCanvas');
    const { ctx, cssW, cssH } = setupCanvas(canvas, img, { maxW: Math.min(window.innerWidth - 32, 400) });
    ctx.drawImage(img, 0, 0, cssW, cssH);
    // 画分割线
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    for (let c = 1; c < cols; c++) {
        const x = (cssW / cols) * c;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, cssH); ctx.stroke();
    }
    for (let r = 1; r < rows; r++) {
        const y = (cssH / rows) * r;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cssW, y); ctx.stroke();
    }
    ctx.setLineDash([]);
    // 渲染分割缩略图
    renderSplitGrid();
}

function renderSplitGrid() {
    if (!state.splitImage) return;
    const img = state.splitImage;
    const { cols, rows } = getSplitDims();
    const grid = $('splitGrid');
    grid.innerHTML = '';
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    const cellW = Math.round(img.width / cols);
    const cellH = Math.round(img.height / rows);
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const cell = document.createElement('div');
            cell.className = 'split-cell';
            const cv = document.createElement('canvas');
            cv.width = cellW;
            cv.height = cellH;
            cv.getContext('2d').drawImage(img, c * cellW, r * cellH, cellW, cellH, 0, 0, cellW, cellH);
            cell.appendChild(cv);
            grid.appendChild(cell);
        }
    }
}

$('splitExportBtn').addEventListener('click', async () => {
    if (!state.splitImage) return alert('请先选择图片');
    showLoading('生成分割图片...');
    const img = state.splitImage;
    const { cols, rows } = getSplitDims();
    const cellW = Math.round(img.width / cols);
    const cellH = Math.round(img.height / rows);
    const blobs = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const canvas = document.createElement('canvas');
            canvas.width = cellW;
            canvas.height = cellH;
            canvas.getContext('2d').drawImage(img, c * cellW, r * cellH, cellW, cellH, 0, 0, cellW, cellH);
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            blobs.push({ blob, name: `split_${r + 1}_${c + 1}.png` });
        }
    }
    hideLoading();
    downloadBlobs(blobs, 'split_images.zip');
});

// ============================================================
// 批量处理
// ============================================================

$('addBatchPhotosBtn').addEventListener('click', () => $('batchPhotoInput').click());
$('batchPhotoInput').addEventListener('change', async e => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    showLoading('加载图片...');
    for (const file of files) {
        try {
            const img = await loadImage(file);
            state.batchImages.push(img);
        } catch (_) {}
    }
    hideLoading();
    renderBatchSlots();
    e.target.value = '';
});

function initBatchFilterOptions() {
    const sel = $('batchFilterSelect');
    sel.innerHTML = '';
    FILTER_PRESETS.forEach((p, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = p.name;
        sel.appendChild(opt);
    });
}

function renderBatchSlots() {
    const bar = $('batchSlotsBar');
    bar.innerHTML = '';
    state.batchImages.forEach((img, i) => {
        const slot = document.createElement('div');
        slot.className = 'slot filled batch-thumb';
        const imgEl = document.createElement('img');
        imgEl.src = img.src;
        slot.appendChild(imgEl);
        const rm = document.createElement('button');
        rm.className = 'remove-btn';
        rm.textContent = '×';
        rm.addEventListener('click', e => {
            e.stopPropagation();
            state.batchImages.splice(i, 1);
            renderBatchSlots();
        });
        slot.appendChild(rm);
        bar.appendChild(slot);
    });
    $('batchSettings').style.display = state.batchImages.length ? 'block' : 'none';
    $('batchHint').textContent = `已选择 ${state.batchImages.length} 张图片`;
}

$('batchOperation').addEventListener('change', () => {
    const op = $('batchOperation').value;
    $('batchFilterRow').style.display = op === 'filter' ? 'flex' : 'none';
    $('batchQualityRow').style.display = op === 'compress' ? 'flex' : 'none';
    $('batchFormatRow').style.display = op === 'compress' ? 'flex' : 'none';
});

$('batchQuality').addEventListener('input', e => {
    $('batchQualityVal').textContent = e.target.value + '%';
});

function applyBatchOperation(img, op) {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    if (op === 'filter') {
        const presetIdx = parseInt($('batchFilterSelect').value);
        const preset = FILTER_PRESETS[presetIdx];
        if (preset) {
            applyAdjust(ctx, img.width, img.height, {
                brightness: preset.brightness,
                contrast: preset.contrast,
                saturate: preset.saturate,
                sharpness: preset.sharpness,
                temperature: preset.temperature
            });
            if (preset.sharpness > 0) applySharpen(ctx, img.width, img.height, preset.sharpness / 100);
        }
    } else if (op === 'bw') {
        const data = ctx.getImageData(0, 0, img.width, img.height);
        const threshold = otsuThreshold(data);
        for (let i = 0; i < data.data.length; i += 4) {
            const gray = data.data[i] * 0.299 + data.data[i + 1] * 0.587 + data.data[i + 2] * 0.114;
            const val = gray > threshold ? 255 : 0;
            data.data[i] = data.data[i + 1] = data.data[i + 2] = val;
        }
        ctx.putImageData(data, 0, 0);
    } else if (op === 'brightness') {
        applyAdjustDirect(ctx, img.width, img.height, 25, 0, 0, 0);
    } else if (op === 'contrast') {
        applyAdjustDirect(ctx, img.width, img.height, 0, 25, 0, 0);
    }
    return canvas;
}

function applyAdjustDirect(ctx, w, h, brightness, contrast, saturate, temperature) {
    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;
    const br = brightness / 100;
    const ct = (contrast + 100) / 100;
    const st = (saturate + 100) / 100;
    const tp = temperature / 100;
    for (let i = 0; i < d.length; i += 4) {
        let r = d[i], g = d[i + 1], b = d[i + 2];
        r += br * 255; g += br * 255; b += br * 255;
        r = ((r / 255 - 0.5) * ct + 0.5) * 255;
        g = ((g / 255 - 0.5) * ct + 0.5) * 255;
        b = ((b / 255 - 0.5) * ct + 0.5) * 255;
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        r = gray + (r - gray) * st;
        g = gray + (g - gray) * st;
        b = gray + (b - gray) * st;
        r += tp * 30; b -= tp * 30;
        d[i] = Math.max(0, Math.min(255, Math.round(r)));
        d[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
        d[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
    }
    ctx.putImageData(imageData, 0, 0);
}

$('batchExportBtn').addEventListener('click', async () => {
    if (!state.batchImages.length) return alert('请先选择图片');
    const op = $('batchOperation').value;
    showLoading('批量处理中...');
    const blobs = [];
    for (let i = 0; i < state.batchImages.length; i++) {
        const img = state.batchImages[i];
        $('loadingText').textContent = `处理中 ${i + 1}/${state.batchImages.length}...`;
        if (op === 'compress') {
            const format = $('batchFormat').value;
            const quality = parseInt($('batchQuality').value) / 100;
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            canvas.getContext('2d').drawImage(img, 0, 0);
            const blob = await new Promise(resolve => canvas.toBlob(resolve, format, quality));
            const ext = format === 'image/jpeg' ? 'jpg' : format === 'image/png' ? 'png' : 'webp';
            blobs.push({ blob, name: `batch_${i + 1}.${ext}` });
        } else {
            const canvas = applyBatchOperation(img, op);
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            blobs.push({ blob, name: `batch_${i + 1}.png` });
        }
    }
    hideLoading();
    downloadBlobs(blobs, 'batch_images.zip');
});

// ============================================================
// 初始化
// ============================================================

renderSlots();
drawGrid();

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
}
