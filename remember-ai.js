// ==UserScript==
// @name         悬浮AI知识库 · 选中即现
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  选中文字即出现悬浮球，点击展开记忆库面板，可存入多个AI模型（带导入导出）
// @author       Kevinrzy103874
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // ==================== 配置 ====================
    const AI_MODELS = [
        { id: 'gemini', name: 'Gemini', short: 'Ge', color: '#1e3a8a' },
        { id: 'chatgpt', name: 'ChatGPT', short: 'CG', color: '#0b4f3b' },
        { id: 'deepseek', name: 'DeepSeek', short: 'DS', color: '#164863' },
        { id: 'doubao', name: '豆包', short: '豆', color: '#9b4d96' },
        { id: 'qianwen', name: '千问', short: 'QW', color: '#c2410c' },
        { id: 'kimi', name: 'Kimi', short: 'Ki', color: '#b45309' },
        { id: 'copilot', name: 'Copilot', short: 'Co', color: '#2c3e50' }
    ];

    const STORAGE_KEY = 'global_ai_knowledge_base';
    const ACTIVE_KEY = 'global_ai_active_models';

    // ==================== 初始化存储 ====================
    let knowledgeBase = new Map();  // modelId -> Set(记忆文本)
    let activeModels = new Set();   // 默认全选，后面会加载

    // 加载数据
    function loadFromStorage() {
        try {
            const saved = GM_getValue(STORAGE_KEY, '{}');
            const parsed = JSON.parse(saved);
            knowledgeBase.clear();
            for (const [modelId, arr] of Object.entries(parsed)) {
                knowledgeBase.set(modelId, new Set(arr));
            }

            const activeSaved = GM_getValue(ACTIVE_KEY, '[]');
            const activeArr = JSON.parse(activeSaved);
            if (activeArr.length > 0) {
                activeModels = new Set(activeArr);
            } else {
                activeModels = new Set(AI_MODELS.map(m => m.id));
            }
        } catch (e) {
            console.warn('加载存储失败', e);
            knowledgeBase.clear();
            activeModels = new Set(AI_MODELS.map(m => m.id));
        }
    }

    // 保存知识库
    function saveKnowledgeBase() {
        const obj = {};
        for (const [modelId, set] of knowledgeBase.entries()) {
            obj[modelId] = Array.from(set);
        }
        GM_setValue(STORAGE_KEY, JSON.stringify(obj));
    }

    // 保存激活状态
    function saveActiveModels() {
        GM_setValue(ACTIVE_KEY, JSON.stringify(Array.from(activeModels)));
    }

    // ==================== 导出/导入 ====================
    function exportKnowledgeBase() {
        const obj = {};
        for (const [modelId, set] of knowledgeBase.entries()) {
            obj[modelId] = Array.from(set);
        }
        const dataStr = JSON.stringify(obj, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ai-knowledge-${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function importKnowledgeBase() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.style.display = 'none';
        document.body.appendChild(input);

        input.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (!file) {
                document.body.removeChild(input);
                return;
            }

            const reader = new FileReader();
            reader.onload = function(loadEvent) {
                try {
                    const content = loadEvent.target.result;
                    const imported = JSON.parse(content);

                    if (typeof imported !== 'object' || imported === null) {
                        alert('无效的知识库文件');
                        document.body.removeChild(input);
                        return;
                    }

                    knowledgeBase.clear();
                    for (const [modelId, arr] of Object.entries(imported)) {
                        if (Array.isArray(arr) && AI_MODELS.some(m => m.id === modelId)) {
                            knowledgeBase.set(modelId, new Set(arr));
                        }
                    }

                    saveKnowledgeBase();
                    updateAllChipCounts();
                    updateTotalCount();
                    alert('导入成功！');
                } catch (err) {
                    alert('导入失败：' + err.message);
                } finally {
                    document.body.removeChild(input);
                }
            };
            reader.readAsText(file);
        });

        input.click();
    }

    // ==================== UI 元素 ====================
    let floatingBall = null;
    let memoryPanel = null;
    let currentSelectedText = '';
    let lastSelectionRange = null;
    let hidePanelTimer = null;

    // 创建悬浮球
    function createFloatingBall() {
        if (floatingBall) return;

        floatingBall = document.createElement('div');
        floatingBall.id = 'ai-floating-ball';
        floatingBall.innerHTML = '📋';
        floatingBall.title = '点击打开AI记忆库';

        const style = document.createElement('style');
        style.textContent = `
            #ai-floating-ball {
                position: fixed;
                width: 44px;
                height: 44px;
                background: #2563eb;
                color: white;
                border-radius: 50%;
                display: none;
                align-items: center;
                justify-content: center;
                font-size: 20px;
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(37,99,235,0.3);
                z-index: 999998;
                transition: transform 0.2s, background 0.2s;
                user-select: none;
                border: 2px solid white;
            }
            #ai-floating-ball:hover {
                background: #1d4ed8;
                transform: scale(1.1);
            }
            #ai-floating-ball:active {
                transform: scale(0.95);
            }
            #ai-memory-panel {
                position: fixed;
                width: 320px;
                background: white;
                border-radius: 16px;
                box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                z-index: 999999;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                border: 1px solid #e2e8f0;
                overflow: hidden;
                display: none;
                backdrop-filter: blur(4px);
            }
            .ai-panel-header {
                background: #f8fafc;
                padding: 12px 16px;
                border-bottom: 1px solid #e2e8f0;
                font-weight: 600;
                color: #1e293b;
                display: flex;
                justify-content: space-between;
                align-items: center;
                cursor: move;
            }
            .ai-panel-close {
                background: none;
                border: none;
                font-size: 18px;
                cursor: pointer;
                color: #64748b;
                width: 28px;
                height: 28px;
                border-radius: 6px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .ai-panel-close:hover {
                background: #e2e8f0;
            }
            .ai-panel-content {
                padding: 16px;
                max-height: 500px;
                overflow-y: auto;
            }
            .ai-selected-preview {
                background: #f1f5f9;
                padding: 10px 12px;
                border-radius: 12px;
                font-size: 0.85rem;
                color: #0f172a;
                margin-bottom: 16px;
                border: 1px solid #cbd5e1;
                max-height: 80px;
                overflow-y: auto;
                word-break: break-all;
            }
            .ai-model-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
                gap: 8px;
                margin-bottom: 16px;
            }
            .ai-model-chip {
                background: #f1f5f9;
                border: 1px solid #cbd5e1;
                border-radius: 30px;
                padding: 6px 10px;
                font-size: 0.8rem;
                display: flex;
                align-items: center;
                gap: 4px;
                cursor: pointer;
                user-select: none;
                transition: all 0.1s;
                color: #334155;
            }
            .ai-model-chip.active {
                background: #2563eb;
                border-color: #2563eb;
                color: white;
            }
            .ai-model-chip .badge {
                background: rgba(0,0,0,0.1);
                border-radius: 12px;
                padding: 2px 6px;
                margin-left: auto;
                font-size: 0.65rem;
            }
            .ai-model-chip.active .badge {
                background: rgba(255,255,255,0.2);
                color: white;
            }
            .ai-btn-primary {
                background: #2563eb;
                color: white;
                border: none;
                padding: 10px 16px;
                border-radius: 30px;
                font-weight: 500;
                font-size: 0.9rem;
                cursor: pointer;
                width: 100%;
                margin-bottom: 8px;
            }
            .ai-btn-primary:hover {
                background: #1d4ed8;
            }
            .ai-btn-secondary {
                background: #f1f5f9;
                border: 1px solid #cbd5e1;
                padding: 8px 12px;
                border-radius: 30px;
                font-weight: 500;
                font-size: 0.85rem;
                cursor: pointer;
                color: #1e293b;
                flex: 1;
            }
            .ai-btn-secondary:hover {
                background: #e2e8f0;
            }
            .ai-footer {
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 0.75rem;
                color: #64748b;
                border-top: 1px solid #e2e8f0;
                padding-top: 12px;
                margin-top: 8px;
            }
            .ai-link-btn {
                background: none;
                border: none;
                color: #2563eb;
                cursor: pointer;
                text-decoration: underline;
                font-size: 0.75rem;
            }
            .ai-button-group {
                display: flex;
                gap: 8px;
                margin: 12px 0;
            }
        `;

        document.head.appendChild(style);
        document.body.appendChild(floatingBall);

        // 悬浮球点击事件
        floatingBall.addEventListener('click', (e) => {
            e.stopPropagation();
            showMemoryPanel();
        });

        // 拖拽悬浮球
        makeDraggable(floatingBall);
    }

    // 创建记忆面板
    function createMemoryPanel() {
        if (memoryPanel) return;

        memoryPanel = document.createElement('div');
        memoryPanel.id = 'ai-memory-panel';
        memoryPanel.innerHTML = `
            <div class="ai-panel-header">
                <span>🧠 AI记忆库</span>
                <button class="ai-panel-close">✕</button>
            </div>
            <div class="ai-panel-content">
                <div class="ai-selected-preview" id="panelSelectedText">无选中文本</div>

                <div style="margin-bottom: 12px;">
                    <div style="font-size:0.75rem; color:#64748b; margin-bottom:6px;">注入目标：</div>
                    <div class="ai-model-grid" id="panelModelGrid"></div>
                </div>

                <button class="ai-btn-primary" id="panelInjectBtn">📥 注入记忆</button>

                <div class="ai-button-group">
                    <button class="ai-btn-secondary" id="panelExportBtn">📤 导出</button>
                    <button class="ai-btn-secondary" id="panelImportBtn">📥 导入</button>
                </div>

                <div class="ai-footer">
                    <span id="panelTotalMemories">0</span> 条记忆
                    <button class="ai-link-btn" id="panelShowAllBtn">查看全部</button>
                </div>
            </div>
        `;

        document.body.appendChild(memoryPanel);

        // 关闭按钮
        memoryPanel.querySelector('.ai-panel-close').addEventListener('click', () => {
            hideMemoryPanel();
        });

        // 点击外部关闭
        document.addEventListener('click', (e) => {
            if (memoryPanel.style.display === 'block' &&
                !memoryPanel.contains(e.target) &&
                e.target !== floatingBall) {
                hideMemoryPanel();
            }
        });

        // 面板内的事件
        document.getElementById('panelInjectBtn').addEventListener('click', injectToActive);
        document.getElementById('panelExportBtn').addEventListener('click', exportKnowledgeBase);
        document.getElementById('panelImportBtn').addEventListener('click', importKnowledgeBase);
        document.getElementById('panelShowAllBtn').addEventListener('click', showAllMemories);

        // 拖拽面板
        makeDraggable(memoryPanel, memoryPanel.querySelector('.ai-panel-header'));
    }

    // 显示记忆面板
    function showMemoryPanel() {
        if (!memoryPanel) createMemoryPanel();

        // 更新选中的文本显示
        const previewEl = document.getElementById('panelSelectedText');
        if (previewEl) {
            previewEl.textContent = currentSelectedText || '无选中文本';
            previewEl.style.color = currentSelectedText ? '#0f172a' : '#94a3b8';
        }

        // 渲染模型芯片
        renderPanelModels();

        // 更新总计数
        updatePanelTotalCount();

        // 定位面板到悬浮球附近
        if (floatingBall) {
            const rect = floatingBall.getBoundingClientRect();
            memoryPanel.style.top = rect.top + 'px';
            memoryPanel.style.left = (rect.left - 340) + 'px'; // 显示在左侧
        }

        memoryPanel.style.display = 'block';
        floatingBall.style.display = 'none'; // 隐藏悬浮球
    }

    // 隐藏记忆面板
    function hideMemoryPanel() {
        if (memoryPanel) {
            memoryPanel.style.display = 'none';
        }
        // 如果还有选中的文本，重新显示悬浮球
        if (currentSelectedText) {
            showFloatingBall();
        }
    }

    // 渲染面板内的模型芯片
    function renderPanelModels() {
        const grid = document.getElementById('panelModelGrid');
        if (!grid) return;

        grid.innerHTML = '';
        AI_MODELS.forEach(model => {
            const chip = document.createElement('div');
            chip.className = `ai-model-chip ${activeModels.has(model.id) ? 'active' : ''}`;
            chip.dataset.model = model.id;
            chip.innerHTML = `
                <span>${model.name}</span>
                <span class="badge" id="panel-count-${model.id}">0</span>
            `;
            chip.addEventListener('click', (e) => {
                e.stopPropagation();
                if (activeModels.has(model.id)) {
                    activeModels.delete(model.id);
                } else {
                    activeModels.add(model.id);
                }
                chip.classList.toggle('active');
                saveActiveModels();
            });
            grid.appendChild(chip);
        });

        // 更新计数
        AI_MODELS.forEach(model => {
            const span = document.getElementById(`panel-count-${model.id}`);
            if (span) {
                const memSet = knowledgeBase.get(model.id) || new Set();
                span.textContent = memSet.size;
            }
        });
    }

    // 更新面板总计数
    function updatePanelTotalCount() {
        const span = document.getElementById('panelTotalMemories');
        if (span) {
            let total = 0;
            for (let set of knowledgeBase.values()) total += set.size;
            span.textContent = total;
        }
    }

    // 更新所有芯片计数（用于外部更新后刷新）
    function updateAllChipCounts() {
        AI_MODELS.forEach(model => {
            const panelSpan = document.getElementById(`panel-count-${model.id}`);
            if (panelSpan) {
                const memSet = knowledgeBase.get(model.id) || new Set();
                panelSpan.textContent = memSet.size;
            }
        });
        updatePanelTotalCount();
    }

    // 更新总记忆数（别名）
    function updateTotalCount() {
        updatePanelTotalCount();
    }

    // 显示悬浮球
    function showFloatingBall() {
        if (!floatingBall) createFloatingBall();

        // 定位到选中文本附近
        if (lastSelectionRange) {
            const rect = lastSelectionRange.getBoundingClientRect();
            floatingBall.style.top = (rect.top - 50) + 'px';
            floatingBall.style.left = rect.left + 'px';
        } else {
            // 默认位置
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                const rect = range.getBoundingClientRect();
                floatingBall.style.top = (rect.top - 50) + 'px';
                floatingBall.style.left = rect.left + 'px';
            }
        }

        floatingBall.style.display = 'flex';
    }

    // 隐藏悬浮球
    function hideFloatingBall() {
        if (floatingBall) {
            floatingBall.style.display = 'none';
        }
    }

    // 处理文本选中
    function handleTextSelection() {
        const selection = window.getSelection();
        const text = selection.toString().trim();

        if (text && text.length > 0) {
            currentSelectedText = text;
            if (selection.rangeCount > 0) {
                lastSelectionRange = selection.getRangeAt(0);
            }

            // 清除之前的隐藏定时器
            if (hidePanelTimer) {
                clearTimeout(hidePanelTimer);
                hidePanelTimer = null;
            }

            // 显示悬浮球
            showFloatingBall();

            // 如果面板是打开的，更新预览
            if (memoryPanel && memoryPanel.style.display === 'block') {
                const previewEl = document.getElementById('panelSelectedText');
                if (previewEl) {
                    previewEl.textContent = text;
                    previewEl.style.color = '#0f172a';
                }
            }
        } else {
            // 没有选中文本，延迟隐藏
            if (!hidePanelTimer) {
                hidePanelTimer = setTimeout(() => {
                    currentSelectedText = '';
                    lastSelectionRange = null;
                    hideFloatingBall();

                    // 如果面板开着，但没选中文本了，可以关闭面板？(可选)
                    // 这里选择不自动关闭面板，让用户手动关闭

                    hidePanelTimer = null;
                }, 200);
            }
        }
    }

    // 注入到激活模型
    function injectToActive() {
        if (!currentSelectedText) {
            alert('没有选中的文本');
            return;
        }

        if (activeModels.size === 0) {
            alert('请至少选择一个AI模型');
            return;
        }

        activeModels.forEach(modelId => {
            if (!knowledgeBase.has(modelId)) {
                knowledgeBase.set(modelId, new Set());
            }
            knowledgeBase.get(modelId).add(currentSelectedText);
        });

        saveKnowledgeBase();
        updateAllChipCounts();

        // 反馈
        const btn = document.getElementById('panelInjectBtn');
        const originalText = btn.textContent;
        btn.textContent = '✅ 已注入';
        setTimeout(() => {
            btn.textContent = originalText;
        }, 800);
    }

    // 查看所有记忆
    function showAllMemories() {
        // 复用之前的模态框代码
        const oldModal = document.querySelector('.ai-modal');
        if (oldModal) oldModal.remove();

        const modal = document.createElement('div');
        modal.className = 'ai-modal';

        // 添加模态框样式
        const modalStyle = document.createElement('style');
        modalStyle.textContent = `
            .ai-modal {
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 1000000;
            }
            .ai-modal-content {
                background: white;
                border-radius: 20px;
                width: 600px;
                max-width: 90vw;
                max-height: 80vh;
                overflow: hidden;
                display: flex;
                flex-direction: column;
            }
            .ai-modal-header {
                padding: 16px;
                border-bottom: 1px solid #e2e8f0;
                display: flex;
                justify-content: space-between;
            }
            .ai-modal-body {
                padding: 16px;
                overflow-y: auto;
            }
            .ai-memory-item {
                background: #f8fafc;
                border-radius: 10px;
                padding: 10px;
                margin-bottom: 8px;
                border-left: 3px solid #2563eb;
                display: flex;
                justify-content: space-between;
            }
            .ai-memory-del {
                background: none;
                border: none;
                color: #ef4444;
                cursor: pointer;
            }
        `;
        document.head.appendChild(modalStyle);

        modal.innerHTML = `
            <div class="ai-modal-content">
                <div class="ai-modal-header">
                    <h3>🧠 所有AI记忆</h3>
                    <button class="ai-panel-close" id="modalClose">✕</button>
                </div>
                <div class="ai-modal-body" id="modalBody">
                    ${renderMemoryList()}
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById('modalClose').addEventListener('click', () => {
            modal.remove();
        });

        // 绑定删除事件
        modal.querySelectorAll('.ai-memory-del').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const model = btn.dataset.model;
                const text = btn.dataset.text;
                const memSet = knowledgeBase.get(model);
                if (memSet) {
                    memSet.delete(text);
                    if (memSet.size === 0) knowledgeBase.delete(model);
                    saveKnowledgeBase();

                    // 刷新列表
                    document.getElementById('modalBody').innerHTML = renderMemoryList();
                    updateAllChipCounts();

                    // 重新绑定事件
                    showAllMemories(); // 简单处理，实际应该重新绑定
                }
            });
        });
    }

    // 渲染记忆列表HTML
    function renderMemoryList() {
        if (knowledgeBase.size === 0) {
            return '<div style="text-align:center; color:#94a3b8; padding:2rem;">暂无记忆</div>';
        }

        let html = '';
        const entries = [];
        for (let [modelId, memSet] of knowledgeBase.entries()) {
            const model = AI_MODELS.find(m => m.id === modelId);
            if (!model) continue;
            memSet.forEach(text => {
                entries.push({ modelId, modelName: model.name, text });
            });
        }

        entries.sort((a, b) => a.modelName.localeCompare(b.modelName));

        entries.forEach(({ modelId, modelName, text }) => {
            html += `
                <div class="ai-memory-item">
                    <div><strong style="color:#2563eb;">${modelName}</strong>: ${escapeHtml(text)}</div>
                    <button class="ai-memory-del" data-model="${modelId}" data-text="${escapeHtml(text)}">✕</button>
                </div>
            `;
        });
        return html;
    }

    // 转义
    function escapeHtml(str) {
        return str.replace(/[&<>"]/g, function(m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            if (m === '"') return '&quot;';
            return m;
        });
    }

    // 拖拽功能
    function makeDraggable(element, handle = null) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        const dragHandle = handle || element;

        dragHandle.onmousedown = dragMouseDown;

        function dragMouseDown(e) {
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }

        function elementDrag(e) {
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            element.style.top = (element.offsetTop - pos2) + 'px';
            element.style.left = (element.offsetLeft - pos1) + 'px';
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
        }
    }

    // ==================== 初始化 ====================
    function init() {
        loadFromStorage();
        createFloatingBall();

        // 监听选中事件
        document.addEventListener('mouseup', handleTextSelection);
        document.addEventListener('keyup', (e) => {
            if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Meta') return;
            handleTextSelection();
        });

        // 油猴菜单
        GM_registerMenuCommand('📌 显示悬浮球', () => {
            if (floatingBall) floatingBall.style.display = 'flex';
        });

        GM_registerMenuCommand('🗑️ 清空所有记忆', () => {
            if (confirm('确定清空所有AI的记忆库吗？')) {
                knowledgeBase.clear();
                saveKnowledgeBase();
                updateAllChipCounts();
            }
        });

        GM_registerMenuCommand('📤 导出知识库', exportKnowledgeBase);
        GM_registerMenuCommand('📥 导入知识库', importKnowledgeBase);
    }

    // 启动
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
