(function () {
  'use strict';

  var C = window.PeiwanCore;
  var KEY = C.STORAGE_KEY;
  var BACKUP_KEY = KEY + '-safety';
  var SAVED_AT_KEY = KEY + '-saved-at';

  var state;
  var currentView = 'timer';
  var timerScreen = 'picker';
  var billMode = 'day';
  var selectedDay = C.todayKey();
  var currentBill = null;
  var lastToday = C.todayKey();
  var endContext = null;
  var editingOrderId = null;
  var editingOldDay = null;
  var editingPresetId = null;
  var deletedPreset = null;
  var presetUndoTimer = 0;
  var closeActionTaken = false;
  var closeAfterSettle = false;
  var confirmResolver = null;
  var toastTimer = 0;
  var lastSafetyBackup = 0;
  var storageOk = true;
  var recoveredFromBackup = false;
  var datePickerFallback = false;

  var $ = function (id) { return document.getElementById(id); };

  var el = {};

  function cacheElements() {
    [
      'headerDate', 'dataBtn', 'footerBackupBtn', 'storageBanner', 'storageBannerText',
      'statusPill', 'statusText', 'sessionCard',
      'timerPicker', 'timerSession', 'gameGrid', 'pickerManageBtn', 'pickerAddBtn',
      'backToPicker', 'sessionAvatar', 'sessionGameName', 'sessionGameRate',
      'gameInput', 'rateInput', 'noteInput', 'gameError', 'rateError',
      'presetDialog', 'presetClose', 'presetForm', 'presetName', 'presetRate', 'presetSubmit',
      'presetCancelEdit', 'presetFormHint', 'presetCount', 'presetList',
      'presetUndo', 'presetUndoText', 'presetUndoBtn',
      'timerDisplay', 'minuteFill', 'liveAmount', 'liveRate',
      'startBtn', 'pauseBtn', 'pauseBtnText', 'endBtn', 'metaStart', 'metaPause', 'metaRate',
      'view-timer', 'view-bills', 'prevPeriod', 'nextPeriod', 'dateBtn', 'dateLabel', 'datePicker',
      'monthPicker', 'yearSelect', 'todayBtn',
      'billTitle', 'billSubtitle',
      'billTotal', 'billGross', 'billCommission', 'billDuration', 'billCount', 'billDays',
      'settleBtn', 'settleText', 'periodStatus', 'billList', 'copyBillBtn', 'exportDayBtn', 'exportBtnText',
      'monthLabel', 'monthTitle', 'sideEyebrow', 'monthTotal', 'monthMeta', 'monthDeduction', 'monthSettled', 'monthUnsettled', 'topGames',
      'endDialog', 'endClose', 'endCancel', 'endConfirm', 'endAvatar', 'endGame', 'endTimeRange',
      'endHours', 'endMinutes', 'endDurationError', 'endRate',
      'endCommission', 'endCommissionError', 'endGross', 'endCommissionAmount', 'endAmount', 'endNote',
      'closeDialog', 'closeDialogX', 'closeTitle', 'closeSubtitle', 'closeAvatar', 'closeGame',
      'closeStatus', 'closeDuration', 'closeRate', 'closeAmount', 'closeRounding',
      'closeCancel', 'closePause', 'closePauseText', 'closeSettle', 'closeHint',
      'editDialog', 'editForm', 'editClose', 'editCancel', 'editSave', 'editDelete',
      'editGame', 'editRate', 'editStart', 'editHours', 'editMinutePart', 'editCommission', 'editNote', 'editAmount', 'editDurationPreview',
      'dataDialog', 'dataClose', 'dataOrderCount', 'dataDayCount', 'dataActiveState',
      'exportBackupBtn', 'importBackupBtn', 'exportAllBtn', 'importFile', 'clearAllBtn',
      'confirmDialog', 'confirmTitle', 'confirmMessage', 'confirmCancel', 'confirmOk',
      'toast', 'toastMessage', 'toastAction', 'toastClose'
    ].forEach(function (id) {
      el[id] = $(id);
    });
    el.sessionCard = document.querySelector('.session-card');
    el.tabs = Array.prototype.slice.call(document.querySelectorAll('.view-tab'));
    el.billModeTabs = Array.prototype.slice.call(document.querySelectorAll('.bill-mode-tab'));
    el.toastMarkUse = el.toast.querySelector('.toast-mark use');
  }

  /* ---------------- 基础工具 ---------------- */

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function initialOf(name) {
    var chars = Array.from(String(name || '游'));
    return escapeHtml(chars[0] || '游');
  }

  function hueOf(name) {
    var h = 0;
    var text = String(name || '');
    for (var i = 0; i < text.length; i++) {
      h = (h * 31 + text.charCodeAt(i)) % 360;
    }
    // 统一收在玫红 / 珊瑚色区间，保留一点区分度。
    return 305 + (h % 75);
  }

  function avatarHtml(name) {
    return '<span class="game-avatar" style="--h:' + hueOf(name) + '">' + initialOf(name) + '</span>';
  }

  function rateText(rate) {
    return Number(rate) > 0 ? '¥' + C.formatMoneyPlain(rate) + '/小时' : '未设置单价';
  }

  function uniqueOrderDays(orders) {
    var seen = Object.create(null);
    (orders || []).forEach(function (order) {
      seen[C.dayKey(order.startedAt)] = true;
    });
    return Object.keys(seen);
  }

  function isDialogOpen(dialog) {
    return !!(dialog && dialog.open);
  }

  function openDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === 'function' && dialog.open) {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  }

  /* ---------------- 持久化 ---------------- */

  function testStorage() {
    try {
      var testKey = '__peiwan_storage_test__';
      localStorage.setItem(testKey, '1');
      localStorage.removeItem(testKey);
      return true;
    } catch (e) {
      return false;
    }
  }

  function updateStorageBanner(message) {
    if (storageOk) {
      el.storageBanner.hidden = true;
      return;
    }
    el.storageBanner.hidden = false;
    el.storageBannerText.textContent = message || '当前浏览器无法保存数据，订单不会自动保留，请及时导出备份。';
  }

  function loadState() {
    storageOk = testStorage();
    if (!storageOk) {
      updateStorageBanner();
      return C.defaultState();
    }

    var raw = null;
    try {
      raw = localStorage.getItem(KEY);
    } catch (e) {
      storageOk = false;
      updateStorageBanner();
      return C.defaultState();
    }

    if (raw) {
      try {
        return C.normalizeState(JSON.parse(raw));
      } catch (e) {
        // 主数据损坏时继续尝试安全备份
      }
    }

    try {
      var backupRaw = localStorage.getItem(BACKUP_KEY);
      if (backupRaw) {
        var backup = JSON.parse(backupRaw);
        recoveredFromBackup = true;
        return C.normalizeState(backup && backup.state ? backup.state : backup);
      }
    } catch (e) {
      // 忽略损坏的备份
    }

    return C.defaultState();
  }

  function notifyDesktop(message) {
    try {
      if (window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {
        window.chrome.webview.postMessage(message);
      }
    } catch (e) {
      // 普通浏览器中没有桌面桥，忽略
    }
  }

  function persist() {
    if (!storageOk) return false;
    try {
      var payload = JSON.stringify(state);
      var now = Date.now();
      localStorage.setItem(KEY, payload);
      localStorage.setItem(SAVED_AT_KEY, String(now));
      notifyDesktop({ type: 'peiwan-save', savedAt: now, payload: payload });

      if (!lastSafetyBackup || now - lastSafetyBackup > 10 * 60 * 1000) {
        localStorage.setItem(BACKUP_KEY, JSON.stringify({ savedAt: now, state: state }));
        lastSafetyBackup = now;
      }
      return true;
    } catch (e) {
      storageOk = false;
      updateStorageBanner('本地存储写入失败，可能是空间不足。请立即导出备份。');
      showToast('保存失败，请导出备份', { tone: 'error', duration: 6500 });
      return false;
    }
  }

  /* ---------------- 提示 ---------------- */

  function hideToast() {
    clearTimeout(toastTimer);
    el.toast.classList.remove('show');
  }

  function showToast(message, options) {
    var opts = options || {};
    clearTimeout(toastTimer);
    el.toast.className = 'toast' + (opts.tone === 'error' ? ' is-error' : opts.tone === 'warn' ? ' is-warn' : '');
    el.toastMessage.textContent = message;
    el.toastMarkUse.setAttribute('href', opts.tone === 'error' || opts.tone === 'warn' ? '#i-alert' : '#i-check');

    if (opts.actionLabel && typeof opts.onAction === 'function') {
      el.toastAction.hidden = false;
      el.toastAction.textContent = opts.actionLabel;
      el.toastAction.onclick = function () {
        hideToast();
        opts.onAction();
      };
    } else {
      el.toastAction.hidden = true;
      el.toastAction.onclick = null;
    }

    // 下一帧再加 show，确保连续提示也有动画
    requestAnimationFrame(function () {
      el.toast.classList.add('show');
    });
    toastTimer = window.setTimeout(hideToast, opts.duration || 4600);
  }

  /* ---------------- 表单与校验 ---------------- */

  function hydrateForm() {
    if (state.active) {
      el.gameInput.value = state.active.game || '';
      el.rateInput.value = state.active.rate > 0 ? C.formatRate(state.active.rate) : '';
      el.noteInput.value = state.active.note || '';
      return;
    }
    var recent = state.games && state.games[0];
    if (recent) {
      el.gameInput.value = recent.name;
      el.rateInput.value = recent.rate > 0 ? C.formatRate(recent.rate) : '';
    } else {
      el.gameInput.value = '';
      el.rateInput.value = '';
    }
    el.noteInput.value = '';
  }

  function setFieldError(input, errorEl, message) {
    var shell = input.closest('.input-shell');
    if (shell) shell.classList.add('is-invalid');
    input.setAttribute('aria-invalid', 'true');
    errorEl.textContent = message;
  }

  function clearFieldError(input, errorEl) {
    var shell = input.closest('.input-shell');
    if (shell) shell.classList.remove('is-invalid');
    input.removeAttribute('aria-invalid');
    errorEl.textContent = '';
  }

  function clearFormErrors() {
    clearFieldError(el.gameInput, el.gameError);
    clearFieldError(el.rateInput, el.rateError);
  }

  function readForm() {
    var game = C.cleanText(el.gameInput.value, 40);
    var rate = parseFloat(el.rateInput.value);
    var valid = true;
    clearFormErrors();
    if (!game) {
      setFieldError(el.gameInput, el.gameError, '请填写游戏名称');
      valid = false;
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      setFieldError(el.rateInput, el.rateError, '请填写大于 0 的单价');
      valid = false;
    }
    return {
      valid: valid,
      game: game,
      rate: Number.isFinite(rate) && rate > 0 ? C.round2(rate) : 0,
      note: C.cleanText(el.noteInput.value, 300)
    };
  }

  /* ---------------- 渲染：计时台 ---------------- */

  function renderHeaderDate() {
    el.headerDate.textContent = C.formatShortDate(C.todayKey()) + ' ' + C.weekdayCN(C.todayKey(), true);
  }

  function renderGameGrid() {
    var games = state.games || [];
    el.pickerAddBtn.hidden = !games.length;
    if (!games.length) {
      el.gameGrid.innerHTML = '<div class="game-empty">' +
        '<svg><use href="#i-gamepad"/></svg>' +
        '<b>还没有游戏</b>' +
        '<span>先添加游戏和每小时单价，之后点一下就能开始。</span>' +
        '<button class="btn btn-primary btn-sm" type="button" data-add-game>添加第一个游戏</button>' +
        '</div>';
      return;
    }
    el.gameGrid.innerHTML = games.map(function (game) {
      return '<button class="game-card" type="button" data-game-card="' + escapeHtml(game.id) + '">' +
        avatarHtml(game.name) +
        '<span class="game-card-main"><b>' + escapeHtml(game.name) + '</b>' +
        '<small>点击进入计时台</small></span>' +
        '<span class="game-card-rate">¥' + C.formatRate(game.rate) + '<em>/小时</em></span>' +
        '<span class="game-card-arrow"><svg><use href="#i-right"/></svg></span>' +
        '</button>';
    }).join('');
  }

  function renderTimerScreen() {
    if (state.active) timerScreen = 'session';
    var showSession = timerScreen === 'session';
    el.timerPicker.hidden = showSession;
    el.timerSession.hidden = !showSession;
    el.backToPicker.hidden = !!state.active;
    if (!showSession) renderGameGrid();
  }

  function renderSession() {
    var active = state.active;
    var running = !!(active && active.runningSince);
    var paused = !!(active && !active.runningSince);

    el.statusPill.className = 'status-pill ' + (running ? 'is-running' : paused ? 'is-paused' : 'is-idle');
    el.statusText.textContent = running ? '计时中' : paused ? '已暂停' : '待开始';

    var game = active ? active.game : (el.gameInput.value || '');
    var currentRate = active ? active.rate : parseFloat(el.rateInput.value);
    el.sessionGameName.textContent = game || '未命名游戏';
    el.sessionGameRate.textContent = Number.isFinite(currentRate) && currentRate > 0
      ? '¥' + C.formatMoneyPlain(currentRate) + '/小时'
      : '未设置单价';
    el.sessionAvatar.textContent = initialOf(game || '游');
    el.sessionAvatar.style.setProperty('--h', String(hueOf(game || '游')));

    el.sessionCard.classList.toggle('is-paused', paused);
    el.startBtn.hidden = !!active;
    el.pauseBtn.hidden = !active;
    el.endBtn.hidden = !active;
    el.pauseBtnText.textContent = running ? '暂停' : '继续计时';
    el.pauseBtn.querySelector('use').setAttribute('href', running ? '#i-pause' : '#i-play');
    el.pauseBtn.title = running ? '暂停，暂停时间不计费' : '继续计时';

    el.metaStart.textContent = active ? C.formatTimeHM(active.startedAt) : '--:--';
    el.metaRate.textContent = Number.isFinite(currentRate) && currentRate > 0
      ? '¥' + C.formatMoneyPlain(currentRate) + '/小时'
      : '--';
  }

  function renderClock() {
    var active = state.active;
    if (!active) {
      el.timerDisplay.textContent = '00:00';
      el.minuteFill.style.width = '0%';
      el.liveAmount.textContent = '¥0.00';
      var idleRate = parseFloat(el.rateInput.value);
      el.liveRate.textContent = Number.isFinite(idleRate) && idleRate > 0
        ? '¥' + C.formatMoneyPlain(idleRate) + '/小时'
        : '¥0.00/小时';
      el.metaPause.textContent = '00:00';
      if (isDialogOpen(el.closeDialog)) cancelClosePrompt();
      document.title = '陪玩计时 · 接单小账本';
      return;
    }

    var now = Date.now();
    var elapsed = C.activeElapsed(active, now);
    var minutes = C.elapsedMinutes(elapsed);
    var amount = C.calcAmount(minutes, active.rate);
    var running = !!active.runningSince;

    el.timerDisplay.textContent = C.formatTimer(minutes);
    el.timerDisplay.setAttribute('aria-label', '有效计时 ' + minutes + ' 分钟');
    el.minuteFill.style.width = ((elapsed % C.MINUTE_MS) / C.MINUTE_MS * 100).toFixed(2) + '%';
    el.liveAmount.textContent = C.formatMoney(amount);
    el.liveRate.textContent = rateText(active.rate);
    el.metaPause.textContent = C.formatStopwatch(C.pauseTotal(active, now));
    el.metaRate.textContent = active.rate > 0
      ? '¥' + C.formatMoneyPlain(active.rate) + '/小时'
      : '--';

    if (isDialogOpen(el.closeDialog)) updateCloseSummary();

    document.title = (running ? '▶ ' : '⏸ ') + C.formatTimer(minutes) + ' · 陪玩计时';
  }

  /* ---------------- 游戏库 ---------------- */

  function presetById(id) {
    return (state.games || []).find(function (item) { return item.id === id; }) || null;
  }

  function applyGamePreset(id, fromDialog) {
    var preset = presetById(id);
    if (!preset) return;

    el.gameInput.value = preset.name;
    el.rateInput.value = C.formatRate(preset.rate);
    clearFormErrors();

    C.ensureGamePreset(state, preset.name, preset.rate, Date.now());

    if (state.active) {
      state.active.game = preset.name;
      state.active.rate = preset.rate;
    }

    timerScreen = 'session';
    persist();
    renderTimerScreen();
    renderSession();
    renderClock();
    if (isDialogOpen(el.presetDialog)) renderPresetList();

    if (fromDialog) closeDialog(el.presetDialog);
    showToast('已选择「' + preset.name + '」', {
      tone: 'success',
      duration: 2200
    });
  }

  function presetByName(name) {
    var target = C.cleanText(name, 40);
    return (state.games || []).find(function (item) { return item.name === target; }) || null;
  }

  function presetFormMessage(message, isError) {
    el.presetFormHint.textContent = message;
    el.presetFormHint.parentNode.classList.toggle('is-error', !!isError);
  }

  function updatePresetSubmitLabel() {
    if (editingPresetId) {
      el.presetSubmit.textContent = '保存修改';
      return;
    }
    var existing = presetByName(el.presetName.value);
    el.presetSubmit.textContent = existing ? '更新' : '添加';
  }

  function resetPresetForm(clearValues) {
    editingPresetId = null;
    el.presetCancelEdit.hidden = true;
    if (clearValues) {
      el.presetName.value = '';
      el.presetRate.value = '';
    }
    presetFormMessage('例如：英雄联盟 · 45 元/小时', false);
    updatePresetSubmitLabel();
  }

  function openPresetDialog(prefillCurrent) {
    hidePresetUndo();
    resetPresetForm(true);
    if (prefillCurrent) {
      var game = C.cleanText(el.gameInput.value, 40);
      el.presetName.value = game || '';
      var rate = parseFloat(el.rateInput.value);
      el.presetRate.value = Number.isFinite(rate) && rate > 0 ? C.formatRate(rate) : '';
    }
    updatePresetSubmitLabel();
    renderPresetList();
    openDialog(el.presetDialog);
    window.setTimeout(function () {
      el.presetName.focus();
      el.presetName.select();
    }, 30);
  }

  function renderPresetList() {
    var games = state.games || [];
    el.presetCount.textContent = games.length + ' 个';
    if (!games.length) {
      el.presetList.innerHTML = '<div class="preset-empty">' +
        '<svg><use href="#i-gamepad"/></svg>' +
        '<b>游戏库还是空的</b><span>把常玩的游戏和单价加进来，下次点一下就能用</span>' +
        '</div>';
      return;
    }

    el.presetList.innerHTML = games.map(function (game) {
      var editing = game.id === editingPresetId;
      return '<div class="preset-row' + (editing ? ' is-editing' : '') + '">' +
        avatarHtml(game.name) +
        '<div class="preset-main"><b>' + escapeHtml(game.name) + '</b><small>¥' +
        C.formatMoneyPlain(game.rate) + '/小时</small></div>' +
        '<button class="preset-use" type="button" data-use-preset="' + escapeHtml(game.id) + '">使用</button>' +
        '<button class="preset-icon" type="button" data-edit-preset="' + escapeHtml(game.id) + '" title="修改">' +
        '<svg><use href="#i-edit"/></svg></button>' +
        '<button class="preset-icon is-delete" type="button" data-delete-preset="' + escapeHtml(game.id) + '" title="删除">' +
        '<svg><use href="#i-trash"/></svg></button>' +
        '</div>';
    }).join('');
  }

  function startEditPreset(id) {
    var preset = presetById(id);
    if (!preset) return;
    editingPresetId = id;
    el.presetName.value = preset.name;
    el.presetRate.value = C.formatRate(preset.rate);
    el.presetCancelEdit.hidden = false;
    el.presetSubmit.textContent = '保存修改';
    presetFormMessage('正在修改「' + preset.name + '」', false);
    renderPresetList();
    el.presetName.focus();
    el.presetName.select();
  }

  function savePresetForm(event) {
    event.preventDefault();
    var name = C.cleanText(el.presetName.value, 40);
    var rate = parseFloat(el.presetRate.value);
    if (!name) {
      presetFormMessage('请填写游戏名称', true);
      el.presetName.focus();
      return;
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      presetFormMessage('请填写大于 0 的单价', true);
      el.presetRate.focus();
      return;
    }
    rate = C.round2(rate);

    if (editingPresetId) {
      var editing = presetById(editingPresetId);
      if (!editing) {
        resetPresetForm(true);
        renderPresetList();
        return;
      }
      var conflict = presetByName(name);
      if (conflict && conflict.id !== editing.id) {
        presetFormMessage('游戏库里已有同名游戏，请修改那一条', true);
        el.presetName.focus();
        return;
      }
      editing.name = name;
      editing.rate = rate;
      editing.lastUsedAt = Date.now();
      persist();
      resetPresetForm(true);
      renderGameGrid();
      renderPresetList();
      showToast('已保存「' + name + '」的修改', { tone: 'success', duration: 2400 });
      return;
    }

    var existed = !!presetByName(name);
    C.upsertGamePreset(state, name, rate, Date.now());
    persist();
    renderGameGrid();
    resetPresetForm(true);
    renderPresetList();
    showToast(
      existed ? '已更新「' + name + '」 · ' + rateText(rate) : '已添加「' + name + '」到游戏库',
      { tone: 'success', duration: 2600 }
    );
  }

  function hidePresetUndo() {
    clearTimeout(presetUndoTimer);
    el.presetUndo.hidden = true;
    deletedPreset = null;
  }

  function showPresetUndo(preset, index) {
    clearTimeout(presetUndoTimer);
    deletedPreset = { preset: preset, index: index };
    el.presetUndoText.textContent = '已删除「' + preset.name + '」';
    el.presetUndo.hidden = false;
    presetUndoTimer = window.setTimeout(hidePresetUndo, 8000);
  }

  function undoPresetDelete() {
    if (!deletedPreset) return;
    var removed = deletedPreset.preset;
    var index = deletedPreset.index;
    state.games.splice(Math.min(index, state.games.length), 0, removed);
    hidePresetUndo();
    persist();
    renderGameGrid();
    renderPresetList();
    presetFormMessage('已恢复「' + removed.name + '」', false);
  }

  function deletePreset(id) {
    var index = (state.games || []).findIndex(function (item) { return item.id === id; });
    if (index < 0) return;
    var removed = state.games[index];
    state.games.splice(index, 1);
    if (editingPresetId === id) resetPresetForm(true);
    persist();
    renderGameGrid();
    renderPresetList();
    showPresetUndo(removed, index);
  }

  /* ---------------- 渲染：账单中心 ---------------- */

  function updateBillModeTabs() {
    el.billModeTabs.forEach(function (tab) {
      var active = tab.getAttribute('data-bill-mode') === billMode;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function setBillMode(mode) {
    if (['day', 'month', 'year'].indexOf(mode) < 0) return;
    if (billMode === mode) {
      renderBills();
      return;
    }
    billMode = mode;
    renderBills();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function periodSettlement(orders) {
    var days = uniqueOrderDays(orders).sort();
    var settled = 0;
    days.forEach(function (day) {
      if (state.settledDays[day]) settled += 1;
    });
    var text;
    if (!days.length) text = '暂无订单';
    else if (settled === days.length) text = '已全部结清';
    else if (settled === 0) text = '未结清';
    else text = '部分结清 ' + settled + '/' + days.length + ' 天';
    return {
      days: days,
      settled: settled,
      unsettled: Math.max(0, days.length - settled),
      text: text
    };
  }

  function dayGroups(orders) {
    var map = C.groupByDay(orders);
    return Object.keys(map).sort().map(function (day) {
      var list = map[day];
      var summary = C.summarize(list);
      var settled = !!state.settledDays[day];
      return {
        key: day,
        label: C.formatShortDate(day) + ' ' + C.weekdayCN(day, true),
        badgeMain: String(Number(day.slice(8))),
        badgeSub: C.weekdayCN(day, true),
        sub: summary.count + ' 单 · ' + summary.durationText +
          (summary.commission > 0 ? ' · 原价 ¥' + C.formatMoneyPlain(summary.gross) +
            ' · 抽成 ¥' + C.formatMoneyPlain(summary.commission) : '') +
          ' · ' + (settled ? '已结清' : '待结清'),
        summary: summary
      };
    });
  }

  function monthGroups(orders) {
    var map = Object.create(null);
    orders.forEach(function (order) {
      var month = C.monthKey(C.dayKey(order.startedAt));
      if (!map[month]) map[month] = [];
      map[month].push(order);
    });
    return Object.keys(map).sort().map(function (month) {
      var list = map[month];
      var summary = C.summarize(list);
      var settlement = periodSettlement(list);
      return {
        key: month,
        label: C.formatMonthCN(month),
        badgeMain: String(Number(month.slice(5))),
        badgeSub: '月',
        sub: summary.count + ' 单 · ' + summary.durationText +
          (summary.commission > 0 ? ' · 原价 ¥' + C.formatMoneyPlain(summary.gross) +
            ' · 抽成 ¥' + C.formatMoneyPlain(summary.commission) : '') +
          ' · 已结清 ' + settlement.settled + '/' + settlement.days.length + ' 天',
        summary: summary
      };
    });
  }

  function billRow(order) {
    var note = order.note ? ' · <em>' + escapeHtml(order.note) + '</em>' : '';
    var commissionRate = C.orderCommissionRate(order);
    var commissionText = commissionRate > 0
      ? ' · 抽成 ' + C.formatRate(commissionRate) + '%'
      : '';
    return '<div class="bill-row">' +
      avatarHtml(order.game) +
      '<div class="bill-main"><b>' + escapeHtml(order.game) + '</b><small>' +
      C.formatTimeHM(order.startedAt) + ' 开始 · ' + C.formatMinutesHuman(C.orderMinutes(order)) + note +
      '</small></div>' +
      '<div class="bill-figures"><span>' + C.formatMinutesHuman(C.orderMinutes(order)) + ' × ¥' +
      C.formatMoneyPlain(order.rate) + commissionText + '</span><strong>' +
      C.formatMoney(C.orderAmount(order)) + '</strong></div>' +
      '<button class="bill-edit" type="button" data-edit-id="' + escapeHtml(order.id) + '" title="编辑订单" aria-label="编辑订单">' +
      '<svg><use href="#i-edit"/></svg></button>' +
      '</div>';
  }

  function periodRow(group, kind) {
    var attr = kind === 'day' ? 'data-drill-day' : 'data-drill-month';
    return '<div class="bill-row bill-row-period" role="button" tabindex="0" ' + attr + '="' +
      escapeHtml(group.key) + '" aria-label="' + escapeHtml(group.label + '，' + C.formatMoney(group.summary.amount)) + '">' +
      '<span class="period-badge"><b>' + escapeHtml(group.badgeMain) + '</b><small>' +
      escapeHtml(group.badgeSub) + '</small></span>' +
      '<div class="bill-main"><b>' + escapeHtml(group.label) + '</b><small>' + escapeHtml(group.sub) + '</small></div>' +
      '<div class="bill-figures"><strong>' + C.formatMoney(group.summary.amount) + '</strong></div>' +
      '<span class="period-arrow"><svg><use href="#i-right"/></svg></span>' +
      '</div>';
  }

  function renderBillEmpty(label) {
    el.billList.innerHTML = '<div class="bill-empty">' +
      '<span class="bill-empty-icon"><svg><use href="#i-receipt"/></svg></span>' +
      '<b>' + escapeHtml(label) + '</b>' +
      '<span>回到计时台开始接单，结束后会自动记到对应日期。</span>' +
      '<button class="btn btn-ghost btn-sm" type="button" data-go-timer>去计时</button>' +
      '</div>';
  }

  function renderOrderList(list) {
    if (!list.length) {
      renderBillEmpty('这一天还没有已完成订单');
      return;
    }
    el.billList.innerHTML = list.map(billRow).join('');
  }

  function renderPeriodList(groups, kind) {
    if (!groups.length) {
      renderBillEmpty(kind === 'day' ? '这个月还没有已完成订单' : '这一年还没有已完成订单');
      return;
    }
    el.billList.innerHTML = groups.map(function (group) {
      return periodRow(group, kind);
    }).join('');
  }

  function renderSideSummary() {
    var isYear = billMode === 'year';
    var scopeOrders;
    var label;
    var emptyText;
    if (isYear) {
      var year = C.yearKey(selectedDay);
      scopeOrders = C.ordersOfYear(state.orders, year);
      label = C.formatYearCN(year);
      emptyText = '这一年还没有订单';
      el.monthTitle.textContent = '年度合计';
      el.sideEyebrow.textContent = 'YEARLY';
    } else {
      var month = C.monthKey(selectedDay);
      scopeOrders = C.ordersOfMonth(state.orders, month);
      label = C.formatMonthCN(month);
      emptyText = '这个月还没有订单';
      el.monthTitle.textContent = billMode === 'month' ? '月度合计' : '本月合计';
      el.sideEyebrow.textContent = 'MONTHLY';
    }

    var summary = C.summarize(scopeOrders);
    var settlement = periodSettlement(scopeOrders);
    el.monthLabel.textContent = label;
    el.monthTotal.textContent = C.formatMoney(summary.amount);
    el.monthMeta.textContent = summary.count + ' 单 · ' + summary.durationText;
    el.monthDeduction.hidden = summary.commission <= 0;
    el.monthDeduction.textContent = '原价 ' + C.formatMoney(summary.gross) +
      ' · 抽成 ' + C.formatMoney(summary.commission);
    el.monthSettled.textContent = settlement.settled + ' 天';
    el.monthUnsettled.textContent = settlement.unsettled + ' 天';

    var byGame = Object.create(null);
    scopeOrders.forEach(function (order) {
      if (!byGame[order.game]) byGame[order.game] = { name: order.game, amount: 0, minutes: 0 };
      byGame[order.game].amount += C.orderAmount(order);
      byGame[order.game].minutes += C.orderMinutes(order);
    });
    var top = Object.keys(byGame).map(function (key) { return byGame[key]; })
      .sort(function (a, b) { return b.amount - a.amount; })
      .slice(0, 3);
    var max = top.length ? top[0].amount : 0;

    if (!top.length) {
      el.topGames.innerHTML = '<div class="top-games-empty">' + emptyText + '</div>';
      return;
    }
    el.topGames.innerHTML = top.map(function (item) {
      var width = max > 0 ? Math.max(6, Math.round(item.amount / max * 100)) : 0;
      return '<div class="top-game">' +
        '<span class="top-game-name" title="' + escapeHtml(item.name) + '">' + escapeHtml(item.name) + '</span>' +
        '<span class="top-game-bar"><i style="width:' + width + '%"></i></span>' +
        '<b>' + C.formatMoney(item.amount) + '</b>' +
        '</div>';
    }).join('');
  }

  function populateYearSelect() {
    var years = Object.create(null);
    years[Number(C.yearKey(C.todayKey()))] = true;
    years[Number(C.yearKey(selectedDay))] = true;
    state.orders.forEach(function (order) {
      years[Number(C.yearKey(C.dayKey(order.startedAt)))] = true;
    });
    var list = Object.keys(years).map(Number).sort(function (a, b) { return b - a; });
    el.yearSelect.innerHTML = list.map(function (year) {
      return '<option value="' + year + '">' + year + ' 年</option>';
    }).join('');
    el.yearSelect.value = C.yearKey(selectedDay);
  }

  function renderBills() {
    if (!C.isValidDayKey(selectedDay)) selectedDay = C.todayKey();
    var today = C.todayKey();
    var todayMonth = C.monthKey(today);
    var todayYear = C.yearKey(today);
    var isDay = billMode === 'day';
    var isMonth = billMode === 'month';
    var isYear = billMode === 'year';
    var month = C.monthKey(selectedDay);
    var year = C.yearKey(selectedDay);
    var orders = isDay ? C.ordersOfDay(state.orders, selectedDay) :
      (isMonth ? C.ordersOfMonth(state.orders, month) : C.ordersOfYear(state.orders, year));
    var summary = C.summarize(orders);
    var days = uniqueOrderDays(orders).sort();
    var settlement = periodSettlement(orders);
    var settled = !!state.settledDays[selectedDay];
    var groups = isMonth ? dayGroups(orders) : (isYear ? monthGroups(orders) : []);
    var statusText = isDay ? (orders.length ? (settled ? '已结清' : '未结清') : '暂无订单') : settlement.text;

    currentBill = {
      mode: billMode,
      orders: orders,
      groups: groups,
      title: isDay ? C.formatDateCN(selectedDay, true) :
        (isMonth ? C.formatMonthCN(month) : C.formatYearCN(year)),
      statusText: statusText,
      exportKey: isDay ? selectedDay : (isMonth ? month : year)
    };

    updateBillModeTabs();
    populateYearSelect();

    el.datePicker.value = selectedDay;
    el.datePicker.max = today;
    el.monthPicker.value = month;
    el.monthPicker.max = todayMonth;
    el.dateBtn.hidden = isYear;
    el.yearSelect.hidden = !isYear;
    el.yearSelect.value = year;

    el.dateLabel.textContent = isDay
      ? C.formatShortDate(selectedDay) + ' ' + C.weekdayCN(selectedDay, true)
      : (isMonth ? C.formatMonthCN(month) : C.formatYearCN(year));

    el.billTitle.textContent = isDay
      ? C.formatShortDate(selectedDay) + ' 账单'
      : (isMonth ? C.formatMonthCN(month) + ' 账单' : C.formatYearCN(year) + ' 账单');
    el.billSubtitle.textContent = isDay
      ? C.weekdayCN(selectedDay) + ' · ' + statusText
      : days.length + ' 个工作日 · ' + statusText;

    el.billTotal.textContent = C.formatMoney(summary.amount);
    el.billGross.textContent = C.formatMoney(summary.gross);
    el.billCommission.textContent = C.formatMoney(summary.commission);
    el.billDuration.textContent = summary.durationText;
    el.billCount.textContent = summary.count + ' 单';
    el.billDays.textContent = days.length + ' 天';

    el.settleBtn.hidden = !isDay;
    el.periodStatus.hidden = isDay;
    if (isDay) {
      el.settleBtn.classList.toggle('is-settled', settled);
      el.settleBtn.disabled = !orders.length;
      el.settleText.textContent = !orders.length ? '暂无可结订单' : settled ? '已结清' : '标记已结清';
      el.settleBtn.title = settled ? '点击撤销结清标记' : '标记这一天的账单为已结清';
    } else {
      el.periodStatus.className = 'period-status' +
        (settlement.days.length && settlement.settled === settlement.days.length ? ' is-all-settled' :
          (settlement.settled > 0 ? ' is-partial' : ''));
      el.periodStatus.textContent = settlement.text;
    }

    el.prevPeriod.setAttribute('aria-label', isDay ? '前一天' : isMonth ? '上个月' : '上一年');
    el.nextPeriod.setAttribute('aria-label', isDay ? '后一天' : isMonth ? '下个月' : '下一年');
    el.todayBtn.textContent = isDay ? '今天' : isMonth ? '本月' : '本年';
    el.todayBtn.disabled = isDay ? selectedDay === today :
      (isMonth ? month === todayMonth : year === todayYear);
    el.nextPeriod.disabled = isDay ? selectedDay >= today :
      (isMonth ? month >= todayMonth : year >= todayYear);

    el.exportBtnText.textContent = isDay ? '导出当日 CSV' : isMonth ? '导出本月 CSV' : '导出本年 CSV';
    el.copyBillBtn.disabled = !orders.length;
    el.exportDayBtn.disabled = !orders.length;

    if (isDay) renderOrderList(orders);
    else renderPeriodList(groups, isMonth ? 'day' : 'month');

    renderSideSummary();
  }

  /* ---------------- 渲染：全部 ---------------- */

  function renderDataStats() {
    var days = uniqueOrderDays(state.orders);
    el.dataOrderCount.textContent = state.orders.length + ' 笔';
    el.dataDayCount.textContent = days.length + ' 天';
    el.dataActiveState.textContent = !state.active ? '无' : state.active.runningSince ? '计时中' : '已暂停';
  }

  function renderAll() {
    renderHeaderDate();
    renderTimerScreen();
    renderSession();
    renderClock();
    renderBills();
    updateStorageBanner();
    if (isDialogOpen(el.dataDialog)) renderDataStats();
    if (isDialogOpen(el.presetDialog)) renderPresetList();
  }

  function switchView(view, skipScroll) {
    if (view !== 'timer' && view !== 'bills') return;
    currentView = view;
    el['view-timer'].hidden = view !== 'timer';
    el['view-bills'].hidden = view !== 'bills';
    el['view-timer'].classList.toggle('is-active', view === 'timer');
    el['view-bills'].classList.toggle('is-active', view === 'bills');
    el.tabs.forEach(function (tab) {
      var active = tab.getAttribute('data-view') === view;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (view === 'bills') {
      if (!C.isValidDayKey(selectedDay)) selectedDay = C.todayKey();
      renderBills();
    } else {
      renderTimerScreen();
      renderSession();
      renderClock();
    }
    if (!skipScroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------------- 计时操作 ---------------- */

  function startOrder() {
    var form = readForm();
    if (!form.valid) {
      showToast('请先填写游戏和单价', { tone: 'error' });
      (form.game ? el.rateInput : el.gameInput).focus();
      return;
    }

    var now = Date.now();
    state.active = {
      id: C.uid('active'),
      game: form.game,
      rate: form.rate,
      note: form.note,
      startedAt: now,
      accumulatedMs: 0,
      runningSince: now,
      pauseTotalMs: 0,
      pausedSince: 0,
      createdAt: now
    };
    C.ensureGamePreset(state, form.game, form.rate, now);
    el.gameInput.value = form.game;
    el.rateInput.value = C.formatRate(form.rate);
    el.noteInput.value = form.note;
    timerScreen = 'session';
    persist();
    renderAll();
    switchView('timer', true);
    showToast('开始接单 · 暂停时间不会计入账单', { tone: 'success' });
  }

  function togglePause() {
    var active = state.active;
    if (!active) return;
    var now = Date.now();
    if (active.runningSince) {
      active.accumulatedMs += Math.max(0, now - active.runningSince);
      active.runningSince = 0;
      active.pausedSince = now;
      persist();
      renderSession();
      renderClock();
      showToast('已暂停 · 暂停期间不计费', { tone: 'warn', duration: 3200 });
    } else {
      var pausedFor = active.pausedSince ? Math.max(0, now - active.pausedSince) : 0;
      active.pauseTotalMs = Math.max(0, active.pauseTotalMs || 0) + pausedFor;
      active.runningSince = now;
      active.pausedSince = 0;
      persist();
      renderSession();
      renderClock();
      showToast('继续计时', { duration: 1900 });
    }
  }

  function durationFromFields(hoursValue, minutesValue) {
    var hours = Number(hoursValue);
    var minutes = Number(minutesValue);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return NaN;
    if (hours < 0 || minutes < 0 || minutes > 59) return NaN;
    return hours * 60 + minutes;
  }

  function updateEndPreview() {
    if (!endContext) return;
    var total = durationFromFields(el.endHours.value, el.endMinutes.value);
    var durationValid = Number.isFinite(total) && total >= 1;
    var commission = Number(el.endCommission.value);
    var commissionValid = Number.isFinite(commission) && commission >= 0 && commission <= 100;

    el.endDurationError.textContent = durationValid ? '' : '请填写至少 1 分钟（分钟数 0–59）';
    el.endDurationError.parentNode.querySelector('.duration-editor').classList.toggle('is-invalid', !durationValid);
    el.endCommissionError.textContent = commissionValid ? '' : '抽成比例需在 0–100% 之间';
    el.endCommission.closest('.commission-editor').classList.toggle('is-invalid', !commissionValid);
    el.endConfirm.disabled = !(durationValid && commissionValid);

    if (!durationValid || !commissionValid) {
      endContext.minutes = 0;
      endContext.commission = 0;
      el.endGross.textContent = '¥0.00';
      el.endCommissionAmount.textContent = '−¥0.00';
      el.endAmount.textContent = '¥0.00';
      el.endNote.textContent = '请填写有效时长和抽成';
      return;
    }

    endContext.minutes = total;
    endContext.commission = C.round2(commission);
    var gross = C.calcAmount(total, endContext.rate);
    var commissionAmount = C.round2(gross * endContext.commission / 100);
    var net = C.round2(gross - commissionAmount);
    el.endGross.textContent = C.formatMoney(gross);
    el.endCommissionAmount.textContent = '−' + C.formatMoney(commissionAmount);
    el.endAmount.textContent = C.formatMoney(net);
    el.endNote.textContent = '共 ' + total + ' 分钟 · 整分钟计费' +
      (total !== endContext.originalMinutes ? ' · 已调整时长' : '') +
      (endContext.commission > 0 ? ' · 抽成 ' + C.formatRate(endContext.commission) + '%' : '');
  }

  function beginEnd(closeAfter) {
    var active = state.active;
    if (!active) {
      closeAfterSettle = false;
      return;
    }
    var form = readForm();
    if (!form.valid) {
      closeAfterSettle = false;
      showToast('请先补全游戏和单价', { tone: 'error' });
      return;
    }
    closeAfterSettle = !!closeAfter;

    var now = Date.now();
    var wasRunning = !!active.runningSince;
    active.game = form.game;
    active.rate = form.rate;
    active.note = form.note;
    if (wasRunning) {
      active.accumulatedMs += Math.max(0, now - active.runningSince);
      active.runningSince = 0;
      active.pausedSince = now;
    }
    var elapsed = Math.max(0, active.accumulatedMs);
    var minutes = C.completeMinutes(elapsed);

    endContext = {
      wasRunning: wasRunning,
      endedAt: now,
      startedAt: active.startedAt,
      minutes: minutes,
      originalMinutes: minutes,
      commission: 0,
      game: form.game,
      rate: form.rate,
      note: form.note,
      elapsedMs: elapsed
    };

    el.endAvatar.textContent = initialOf(form.game);
    el.endAvatar.style.setProperty('--h', String(hueOf(form.game)));
    el.endGame.textContent = form.game;
    el.endTimeRange.textContent = C.formatTimeHM(active.startedAt) + ' 开始 · ' + C.formatTimeHM(now) + ' 结束';
    el.endRate.textContent = '¥' + C.formatMoneyPlain(form.rate) + '/小时';
    el.endHours.value = String(Math.floor(minutes / 60));
    el.endMinutes.value = String(minutes % 60);
    el.endCommission.value = '0';
    el.endDurationError.textContent = '';
    el.endCommissionError.textContent = '';
    updateEndPreview();

    persist();
    renderSession();
    renderClock();
    openDialog(el.endDialog);
    window.setTimeout(function () { el.endHours.focus(); el.endHours.select(); }, 30);
  }

  function cancelEnd() {
    closeAfterSettle = false;
    if (!endContext) {
      closeDialog(el.endDialog);
      return;
    }
    var active = state.active;
    if (active && endContext.wasRunning) {
      var now = Date.now();
      if (active.pausedSince) {
        active.pauseTotalMs = Math.max(0, active.pauseTotalMs || 0) + Math.max(0, now - active.pausedSince);
      }
      active.runningSince = now;
      active.pausedSince = 0;
    }
    endContext = null;
    closeDialog(el.endDialog);
    timerScreen = 'session';
    persist();
    renderTimerScreen();
    renderSession();
    renderClock();
    if (state.active && state.active.runningSince) {
      showToast('已继续计时', { duration: 2000 });
    }
  }

  function confirmEnd() {
    if (!endContext || !state.active) {
      closeDialog(el.endDialog);
      return;
    }
    var ctx = endContext;
    normalizeDurationFields(el.endHours, el.endMinutes, 9999);
    var totalMinutes = durationFromFields(el.endHours.value, el.endMinutes.value);
    var commission = Number(el.endCommission.value);
    if (!Number.isFinite(totalMinutes) || totalMinutes < 1 ||
        !Number.isFinite(commission) || commission < 0 || commission > 100) {
      updateEndPreview();
      el.endHours.focus();
      return;
    }
    var day = C.dayKey(ctx.startedAt);
    var order = {
      id: C.uid('order'),
      game: ctx.game,
      rate: ctx.rate,
      minutes: totalMinutes,
      commission: C.round2(commission),
      note: ctx.note,
      startedAt: ctx.startedAt,
      endedAt: ctx.endedAt,
      createdAt: Date.now()
    };

    state.orders.push(order);
    state.active = null;
    C.ensureGamePreset(state, order.game, order.rate, Date.now());
    var invalidated = !!state.settledDays[day];
    if (invalidated) delete state.settledDays[day];

    var shouldClose = closeAfterSettle;
    closeAfterSettle = false;
    endContext = null;
    closeDialog(el.endDialog);
    el.noteInput.value = '';
    timerScreen = 'picker';
    persist();
    renderAll();

    if (shouldClose) {
      notifyDesktop({ type: 'close-app' });
      return;
    }

    var message = '已记账 ' + C.formatMoney(C.orderAmount(order));
    if (invalidated) message += ' · 当天账单已恢复未结清';
    showToast(message, {
      tone: 'success',
      duration: 6500,
      actionLabel: '查看账单',
      onAction: function () {
        selectedDay = day;
        switchView('bills');
      }
    });
  }

  /* ---------------- 关闭程序确认 ---------------- */

  function updateCloseSummary() {
    var active = state.active;
    if (!active) return;
    var now = Date.now();
    var elapsed = C.activeElapsed(active, now);
    var minutes = C.completeMinutes(elapsed);
    var amount = C.calcAmount(minutes, active.rate);
    var running = !!active.runningSince;
    var canSettle = !!C.cleanText(active.game, 40) && active.rate > 0;

    el.closeTitle.textContent = running ? '还在计时中' : '这一单已暂停';
    el.closeSubtitle.textContent = running
      ? '关闭程序前，要结束这一单吗？关闭前计时仍在继续。'
      : '这一单已暂停，关闭程序前要结束并结算吗？';
    el.closeAvatar.textContent = initialOf(active.game);
    el.closeAvatar.style.setProperty('--h', String(hueOf(active.game)));
    el.closeGame.textContent = active.game || '未命名游戏';
    el.closeStatus.textContent = (running ? '计时中' : '已暂停') + ' · 已计 ' + C.formatTimer(C.elapsedMinutes(elapsed));
    el.closeDuration.textContent = C.formatMinutesHuman(minutes);
    el.closeRate.textContent = active.rate > 0 ? '¥' + C.formatMoneyPlain(active.rate) + '/小时' : '--';
    el.closeAmount.textContent = C.formatMoney(amount);
    el.closeRounding.textContent = elapsed < C.MINUTE_MS
      ? '不足 1 分钟，按 1 分钟计'
      : '共 ' + minutes + ' 分钟 · 按整分钟结算';
    el.closePauseText.textContent = running ? '暂停并关闭' : '保持暂停并关闭';
    el.closeHint.textContent = running
      ? '「暂停并关闭」会暂停计时，下次打开可继续；不会生成订单。'
      : '当前已暂停；「保持暂停并关闭」不会生成订单，下次打开可继续。';
    el.closeSettle.disabled = !canSettle;
  }

  function showCloseDialog() {
    if (!state.active) return false;
    closeActionTaken = false;
    updateCloseSummary();
    if (!isDialogOpen(el.closeDialog)) openDialog(el.closeDialog);
    window.setTimeout(function () { el.closeCancel.focus(); }, 30);
    return true;
  }

  function openSettlementFromClose() {
    if (!state.active) return;
    closeActionTaken = true;
    closeDialog(el.closeDialog);
    notifyDesktop({ type: 'close-cancelled' });
    window.setTimeout(function () { beginEnd(true); }, 80);
  }

  function pauseActiveForClose() {
    var active = state.active;
    if (!active) return true;
    var now = Date.now();
    if (active.runningSince) {
      active.accumulatedMs += Math.max(0, now - active.runningSince);
      active.runningSince = 0;
      active.pausedSince = now;
    }
    persist();
    return true;
  }

  function finishCloseApp() {
    closeActionTaken = true;
    closeDialog(el.closeDialog);
    notifyDesktop({ type: 'close-app' });
  }

  function pauseAndClose() {
    pauseActiveForClose();
    finishCloseApp();
  }

  function cancelClosePrompt() {
    if (!isDialogOpen(el.closeDialog)) return;
    closeActionTaken = true;
    closeDialog(el.closeDialog);
    notifyDesktop({ type: 'close-cancelled' });
  }

  /* ---------------- 历史订单 ---------------- */

  function normalizeDurationFields(hoursEl, minutesEl, maxHours) {
    var hours = Number(hoursEl.value);
    var minutes = Number(minutesEl.value);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return;
    hours = Math.max(0, Math.round(hours));
    minutes = Math.max(0, Math.round(minutes));
    var total = Math.min(hours * 60 + minutes, (maxHours || 9999) * 60);
    hoursEl.value = String(Math.floor(total / 60));
    minutesEl.value = String(total % 60);
  }

  function openEdit(id) {
    var order = state.orders.find(function (item) { return item.id === id; });
    if (!order) return;
    editingOrderId = order.id;
    editingOldDay = C.dayKey(order.startedAt);
    el.editGame.value = order.game;
    el.editRate.value = C.formatRate(order.rate);
    el.editStart.value = C.toDateTimeLocal(order.startedAt);
    el.editStart.max = C.toDateTimeLocal(Date.now());
    el.editHours.value = String(Math.floor(C.orderMinutes(order) / 60));
    el.editMinutePart.value = String(C.orderMinutes(order) % 60);
    el.editCommission.value = C.formatRate(C.orderCommissionRate(order));
    el.editNote.value = order.note || '';
    clearEditInvalid();
    updateEditPreview();
    openDialog(el.editDialog);
    window.setTimeout(function () { el.editGame.focus(); el.editGame.select(); }, 30);
  }

  function updateEditPreview() {
    var minutes = durationFromFields(el.editHours.value, el.editMinutePart.value);
    if (!Number.isFinite(minutes)) minutes = 0;
    var rate = parseFloat(el.editRate.value) || 0;
    var commission = Number(el.editCommission.value);
    if (!Number.isFinite(commission)) commission = 0;
    var gross = C.calcAmount(minutes, rate);
    var commissionAmount = C.round2(gross * Math.max(0, Math.min(100, commission)) / 100);
    var net = C.round2(gross - commissionAmount);
    el.editAmount.textContent = C.formatMoney(net);
    el.editDurationPreview.textContent = minutes > 0
      ? C.formatMinutesHuman(minutes) + ' · 原价 ¥' + C.formatMoneyPlain(gross) +
        (commission > 0 ? ' · 抽成 ' + C.formatRate(commission) + '%' : '')
      : '请输入有效时长';
  }

  function clearEditInvalid() {
    [el.editGame, el.editRate, el.editStart, el.editHours, el.editMinutePart, el.editCommission].forEach(function (input) {
      input.removeAttribute('aria-invalid');
      var shell = input.closest('.input-shell');
      if (shell) shell.classList.remove('is-invalid');
    });
  }

  function markEditInvalid(input) {
    input.setAttribute('aria-invalid', 'true');
    var shell = input.closest('.input-shell');
    if (shell) shell.classList.add('is-invalid');
    input.focus();
  }

  function saveEdit(event) {
    event.preventDefault();
    if (!editingOrderId) return;
    clearEditInvalid();

    var game = C.cleanText(el.editGame.value, 40);
    var rate = parseFloat(el.editRate.value);
    var start = C.fromDateTimeLocal(el.editStart.value);
    normalizeDurationFields(el.editHours, el.editMinutePart, 8760);
    var minutes = durationFromFields(el.editHours.value, el.editMinutePart.value);
    var commission = Number(el.editCommission.value);

    if (!game) {
      markEditInvalid(el.editGame);
      showToast('游戏名称不能为空', { tone: 'error' });
      return;
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      markEditInvalid(el.editRate);
      showToast('单价需要大于 0', { tone: 'error' });
      return;
    }
    if (!Number.isFinite(start)) {
      markEditInvalid(el.editStart);
      showToast('开始时间格式不正确', { tone: 'error' });
      return;
    }
    if (start > Date.now() + 60 * 1000) {
      markEditInvalid(el.editStart);
      showToast('开始时间不能晚于现在', { tone: 'error' });
      return;
    }
    if (!Number.isFinite(minutes) || minutes < 1) {
      markEditInvalid(el.editHours);
      showToast('有效时长至少为 1 分钟', { tone: 'error' });
      return;
    }
    if (minutes > 525600) {
      markEditInvalid(el.editHours);
      showToast('有效时长不能超过 1 年', { tone: 'error' });
      return;
    }
    if (!Number.isFinite(commission) || commission < 0 || commission > 100) {
      markEditInvalid(el.editCommission);
      showToast('抽成比例需在 0–100% 之间', { tone: 'error' });
      return;
    }

    var order = state.orders.find(function (item) { return item.id === editingOrderId; });
    if (!order) {
      closeDialog(el.editDialog);
      return;
    }

    var newDay = C.dayKey(start);
    var invalidated = false;
    if (state.settledDays[editingOldDay]) {
      delete state.settledDays[editingOldDay];
      invalidated = true;
    }
    if (newDay !== editingOldDay && state.settledDays[newDay]) {
      delete state.settledDays[newDay];
      invalidated = true;
    }

    order.game = game;
    order.rate = C.round2(rate);
    order.minutes = minutes;
    order.commission = C.round2(commission);
    order.note = C.cleanText(el.editNote.value, 300);
    order.startedAt = start;
    order.endedAt = start + minutes * C.MINUTE_MS;

    if (state.active && state.active.id === order.id) {
      // 历史订单和进行中订单理论上不会重叠，这里仅作防御。
    }

    closeDialog(el.editDialog);
    persist();
    renderAll();
    showToast('订单已更新' + (invalidated ? ' · 相关账单已恢复未结清' : ''), { tone: 'success' });
  }

  function deleteOrder(id) {
    var index = state.orders.findIndex(function (item) { return item.id === id; });
    if (index < 0) return;
    var removed = state.orders[index];
    var day = C.dayKey(removed.startedAt);
    var wasSettled = !!state.settledDays[day];
    if (wasSettled) delete state.settledDays[day];
    state.orders.splice(index, 1);
    persist();
    renderAll();

    showToast('已删除「' + removed.game + '」', {
      tone: 'warn',
      duration: 8000,
      actionLabel: '撤销',
      onAction: function () {
        var insertAt = Math.min(index, state.orders.length);
        state.orders.splice(insertAt, 0, removed);
        if (wasSettled) state.settledDays[day] = { settledAt: Date.now() };
        persist();
        renderAll();
        showToast('已恢复订单', { tone: 'success', duration: 2200 });
      }
    });
  }

  /* ---------------- 账单操作 ---------------- */

  function toggleSettle() {
    if (billMode !== 'day') return;
    if (!C.ordersOfDay(state.orders, selectedDay).length) return;
    if (state.settledDays[selectedDay]) {
      delete state.settledDays[selectedDay];
      showToast('已取消结清标记', { duration: 2500 });
    } else {
      state.settledDays[selectedDay] = { settledAt: Date.now() };
      showToast('已标记为结清', { tone: 'success', duration: 2800 });
    }
    persist();
    renderBills();
  }

  function selectDay(day, nextMode) {
    if (!C.isValidDayKey(day)) return;
    selectedDay = day;
    if (nextMode) billMode = nextMode;
    renderBills();
  }

  function shiftPeriod(delta) {
    if (billMode === 'day') selectedDay = C.addDays(selectedDay, delta);
    else if (billMode === 'month') selectedDay = C.addMonths(selectedDay, delta);
    else selectedDay = C.addYears(selectedDay, delta);
    renderBills();
  }

  function goToday() {
    selectedDay = C.todayKey();
    renderBills();
  }

  function openDatePicker() {
    if (billMode === 'year') return;

    if (billMode === 'month') {
      el.monthPicker.value = C.monthKey(selectedDay);
      el.monthPicker.max = C.monthKey(C.todayKey());
      if (datePickerFallback) {
        var monthInput = window.prompt('输入月份（YYYY-MM）', C.monthKey(selectedDay));
        if (monthInput && /^\d{4}-\d{2}$/.test(monthInput)) {
          selectDay(monthInput + '-01', 'month');
        }
        return;
      }
      try {
        if (typeof el.monthPicker.showPicker === 'function') {
          el.monthPicker.showPicker();
          return;
        }
      } catch (e) {
        // 退回到手输月份
      }
      datePickerFallback = true;
      var monthFallback = window.prompt('输入月份（YYYY-MM）', C.monthKey(selectedDay));
      if (monthFallback && /^\d{4}-\d{2}$/.test(monthFallback)) {
        selectDay(monthFallback + '-01', 'month');
      }
      return;
    }

    el.datePicker.value = selectedDay;
    el.datePicker.max = C.todayKey();
    if (datePickerFallback) {
      var input = window.prompt('输入日期（YYYY-MM-DD）', selectedDay);
      if (input && C.isValidDayKey(input)) selectDay(input, 'day');
      return;
    }
    try {
      if (typeof el.datePicker.showPicker === 'function') {
        el.datePicker.showPicker();
        return;
      }
    } catch (e) {
      // 部分浏览器需要用户权限，退回到手输日期
    }
    datePickerFallback = true;
    var fallback = window.prompt('输入日期（YYYY-MM-DD）', selectedDay);
    if (fallback && C.isValidDayKey(fallback)) selectDay(fallback, 'day');
  }

  function copyBill() {
    if (!currentBill || !currentBill.orders.length) return;
    var text;
    if (currentBill.mode === 'day') {
      text = C.buildBillText(selectedDay, state.orders, !!state.settledDays[selectedDay]);
    } else {
      var groups = currentBill.groups.map(function (group) {
        return {
          label: group.label,
          count: group.summary.count,
          minutes: group.summary.minutes,
          gross: group.summary.gross,
          commission: group.summary.commission,
          amount: group.summary.amount
        };
      });
      text = C.buildGroupedBillText(currentBill.title, groups, currentBill.statusText);
    }
    copyText(text).then(function () {
      showToast('账单已复制到剪贴板', { tone: 'success' });
    }).catch(function () {
      showToast('复制失败，请检查浏览器剪贴板权限', { tone: 'error' });
    });
  }

  function copyText(text) {
    function legacyCopy() {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      area.style.top = '0';
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      area.remove();
      return ok;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        return navigator.clipboard.writeText(text).catch(function () {
          if (!legacyCopy()) throw new Error('copy failed');
        });
      } catch (e) {
        // 继续使用 textarea 方案
      }
    }
    return new Promise(function (resolve, reject) {
      if (legacyCopy()) resolve();
      else reject(new Error('copy failed'));
    });
  }

  function download(filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function exportPeriodCsv() {
    if (!currentBill || !currentBill.orders.length) return;
    var suffix = currentBill.exportKey;
    var label = currentBill.mode === 'day' ? '当日' : currentBill.mode === 'month' ? '本月' : '本年';
    download('陪玩账单_' + suffix + '.csv', C.buildCsv(currentBill.orders), 'text/csv;charset=utf-8');
    showToast(label + ' CSV 已导出', { tone: 'success' });
  }

  /* ---------------- 数据与备份 ---------------- */

  function openDataDialog() {
    renderDataStats();
    openDialog(el.dataDialog);
  }

  function exportBackup() {
    var payload = {
      app: 'peiwan-timer',
      version: C.VERSION,
      exportedAt: new Date().toISOString(),
      state: state
    };
    var now = new Date();
    var stamp = C.dayKey(now.getTime()) + '_' + C.pad2(now.getHours()) + C.pad2(now.getMinutes());
    download('陪玩计时备份_' + stamp + '.json', JSON.stringify(payload, null, 2), 'application/json');
    closeDialog(el.dataDialog);
    showToast('完整备份已导出', { tone: 'success' });
  }

  function exportAllCsv() {
    if (!state.orders.length) {
      showToast('还没有订单可以导出', { tone: 'warn' });
      return;
    }
    download('陪玩计时_全部订单_' + C.todayKey() + '.csv', C.buildCsv(state.orders), 'text/csv;charset=utf-8');
    closeDialog(el.dataDialog);
    showToast('全部订单 CSV 已导出', { tone: 'success' });
  }

  function importBackupFile(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast('备份文件过大，无法导入', { tone: 'error' });
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try {
        parsed = JSON.parse(String(reader.result || ''));
      } catch (e) {
        showToast('文件不是有效的 JSON 备份', { tone: 'error' });
        return;
      }
      var raw = Array.isArray(parsed) ? { orders: parsed } : (parsed && parsed.state ? parsed.state : parsed);
      if (!raw || typeof raw !== 'object' || !Array.isArray(raw.orders)) {
        showToast('没有找到可导入的订单数据', { tone: 'error' });
        return;
      }
      var imported = C.normalizeState(raw);
      if (imported.active) {
        imported.active.runningSince = 0;
        imported.active.pausedSince = Date.now();
      }

      if (isDialogOpen(el.dataDialog)) closeDialog(el.dataDialog);
      confirmAction({
        title: '导入这份备份？',
        message: '将用备份中的 ' + imported.orders.length + ' 笔订单覆盖当前全部数据，当前数据无法恢复。',
        confirmText: '确认导入',
        cancelText: '再想想',
        danger: true
      }).then(function (ok) {
        if (!ok) return;
        state = imported;
        timerScreen = state.active ? 'session' : 'picker';
        selectedDay = C.todayKey();
        lastToday = C.todayKey();
        lastSafetyBackup = 0;
        hydrateForm();
        persist();
        renderAll();
        switchView('timer', true);
        showToast('已导入 ' + state.orders.length + ' 笔订单' + (state.active ? '，进行中订单已暂停' : ''), {
          tone: 'success',
          duration: 5000
        });
      });
    };
    reader.onerror = function () {
      showToast('读取文件失败', { tone: 'error' });
    };
    reader.readAsText(file);
  }

  function clearAllData() {
    if (!state.orders.length && !state.active) {
      showToast('当前没有可清空的数据', { tone: 'warn' });
      return;
    }
    if (isDialogOpen(el.dataDialog)) closeDialog(el.dataDialog);
    confirmAction({
      title: '清空所有数据？',
      message: '全部订单、账单和计时进度都会被删除，此操作无法撤回。建议先导出备份。',
      confirmText: '确认清空',
      cancelText: '取消',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      try {
        localStorage.removeItem(KEY);
        localStorage.removeItem(BACKUP_KEY);
        localStorage.removeItem(SAVED_AT_KEY);
      } catch (e) {
        // 存储不可用时只清空内存
      }
      notifyDesktop({ type: 'peiwan-clear' });
      state = C.defaultState();
      timerScreen = 'picker';
      endContext = null;
      lastSafetyBackup = 0;
      hydrateForm();
      persist();
      renderAll();
      switchView('timer', true);
      showToast('所有数据已清空', { tone: 'success' });
    });
  }

  /* ---------------- 确认弹窗 ---------------- */

  function confirmAction(options) {
    var opts = options || {};
    return new Promise(function (resolve) {
      if (confirmResolver) confirmResolver(false);
      confirmResolver = resolve;
      el.confirmTitle.textContent = opts.title || '确认操作';
      el.confirmMessage.textContent = opts.message || '确定要继续吗？';
      el.confirmOk.textContent = opts.confirmText || '确定';
      el.confirmCancel.textContent = opts.cancelText || '取消';
      el.confirmOk.className = opts.danger === false ? 'btn btn-primary' : 'btn btn-danger';
      if (el.confirmDialog.open) closeDialog(el.confirmDialog);
      openDialog(el.confirmDialog);
      window.setTimeout(function () { el.confirmOk.focus(); }, 30);
    });
  }

  function resolveConfirm(value) {
    if (el.confirmDialog.open) closeDialog(el.confirmDialog);
    if (confirmResolver) {
      var resolver = confirmResolver;
      confirmResolver = null;
      resolver(!!value);
    }
  }

  /* ---------------- 事件绑定 ---------------- */

  function bindEvents() {
    el.tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        switchView(tab.getAttribute('data-view'));
      });
    });

    el.startBtn.addEventListener('click', startOrder);
    el.pauseBtn.addEventListener('click', togglePause);
    el.endBtn.addEventListener('click', function () { beginEnd(false); });

    el.gameInput.addEventListener('input', function () {
      clearFieldError(el.gameInput, el.gameError);
      if (state.active) {
        state.active.game = el.gameInput.value;
        persist();
      }
    });
    el.gameInput.addEventListener('blur', function () {
      var value = C.cleanText(el.gameInput.value, 40);
      el.gameInput.value = value;
      if (state.active) {
        state.active.game = value;
        persist();
      }
    });
    el.rateInput.addEventListener('input', function () {
      clearFieldError(el.rateInput, el.rateError);
      var rate = parseFloat(el.rateInput.value);
      if (state.active) {
        state.active.rate = Number.isFinite(rate) && rate > 0 ? C.round2(rate) : 0;
        persist();
        el.metaRate.textContent = state.active.rate > 0 ? '¥' + C.formatMoneyPlain(state.active.rate) + '/小时' : '--';
        renderClock();
      } else {
        el.liveRate.textContent = Number.isFinite(rate) && rate > 0
          ? '¥' + C.formatMoneyPlain(rate) + '/小时'
          : '¥0.00/小时';
        el.metaRate.textContent = Number.isFinite(rate) && rate > 0
          ? '¥' + C.formatMoneyPlain(rate) + '/小时'
          : '--';
      }
    });
    el.rateInput.addEventListener('blur', function () {
      var rate = parseFloat(el.rateInput.value);
      if (Number.isFinite(rate) && rate > 0) {
        el.rateInput.value = C.formatRate(C.round2(rate));
        if (state.active) {
          state.active.rate = C.round2(rate);
          persist();
        }
        renderClock();
      }
    });
    el.noteInput.addEventListener('input', function () {
      if (state.active) {
        state.active.note = el.noteInput.value;
        persist();
      }
    });

    el.pickerAddBtn.addEventListener('click', function () { openPresetDialog(false); });
    el.pickerManageBtn.addEventListener('click', function () { openPresetDialog(false); });
    el.backToPicker.addEventListener('click', function () {
      timerScreen = 'picker';
      renderTimerScreen();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    el.gameGrid.addEventListener('click', function (event) {
      var card = event.target.closest('[data-game-card]');
      if (card) {
        applyGamePreset(card.getAttribute('data-game-card'), false);
        return;
      }
      if (event.target.closest('[data-add-game]')) openPresetDialog(false);
    });

    el.billModeTabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        setBillMode(tab.getAttribute('data-bill-mode'));
      });
    });

    el.prevPeriod.addEventListener('click', function () { shiftPeriod(-1); });
    el.nextPeriod.addEventListener('click', function () { shiftPeriod(1); });
    el.todayBtn.addEventListener('click', goToday);
    el.dateBtn.addEventListener('click', openDatePicker);
    el.datePicker.addEventListener('change', function () {
      if (C.isValidDayKey(el.datePicker.value)) selectDay(el.datePicker.value, 'day');
      else el.datePicker.value = selectedDay;
    });
    el.monthPicker.addEventListener('change', function () {
      var value = el.monthPicker.value;
      if (!/^\d{4}-\d{2}$/.test(value)) return;
      var day = selectedDay.slice(8);
      var target = value + '-' + day;
      if (!C.isValidDayKey(target)) target = value + '-01';
      selectDay(target, 'month');
    });
    el.yearSelect.addEventListener('change', function () {
      var targetYear = Number(el.yearSelect.value);
      if (!Number.isFinite(targetYear)) return;
      selectedDay = C.addYears(selectedDay, targetYear - Number(C.yearKey(selectedDay)));
      billMode = 'year';
      renderBills();
    });

    el.settleBtn.addEventListener('click', toggleSettle);
    el.copyBillBtn.addEventListener('click', copyBill);
    el.exportDayBtn.addEventListener('click', exportPeriodCsv);

    function drillFromRow(event) {
      var dayRow = event.target.closest('[data-drill-day]');
      if (dayRow) {
        selectDay(dayRow.getAttribute('data-drill-day'), 'day');
        return true;
      }
      var monthRow = event.target.closest('[data-drill-month]');
      if (monthRow) {
        selectDay(monthRow.getAttribute('data-drill-month') + '-01', 'month');
        return true;
      }
      return false;
    }

    el.billList.addEventListener('click', function (event) {
      var editBtn = event.target.closest('[data-edit-id]');
      if (editBtn) {
        openEdit(editBtn.getAttribute('data-edit-id'));
        return;
      }
      if (drillFromRow(event)) return;
      if (event.target.closest('[data-go-timer]')) switchView('timer');
    });
    el.billList.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (!event.target.closest('[data-drill-day], [data-drill-month]')) return;
      event.preventDefault();
      drillFromRow(event);
    });

    // 结束订单
    el.endClose.addEventListener('click', cancelEnd);
    el.endCancel.addEventListener('click', cancelEnd);
    el.endConfirm.addEventListener('click', confirmEnd);
    el.endDialog.addEventListener('cancel', function (event) {
      event.preventDefault();
      cancelEnd();
    });
    el.endDialog.addEventListener('click', function (event) {
      if (event.target === el.endDialog) cancelEnd();
    });
    [el.endHours, el.endMinutes].forEach(function (input) {
      input.addEventListener('input', updateEndPreview);
      input.addEventListener('blur', function () {
        normalizeDurationFields(el.endHours, el.endMinutes, 9999);
        updateEndPreview();
      });
    });
    el.endCommission.addEventListener('input', updateEndPreview);

    // 关闭程序确认
    el.closeDialogX.addEventListener('click', cancelClosePrompt);
    el.closeCancel.addEventListener('click', cancelClosePrompt);
    el.closePause.addEventListener('click', pauseAndClose);
    el.closeSettle.addEventListener('click', openSettlementFromClose);
    el.closeDialog.addEventListener('click', function (event) {
      if (event.target === el.closeDialog) cancelClosePrompt();
    });
    el.closeDialog.addEventListener('close', function () {
      if (!closeActionTaken) notifyDesktop({ type: 'close-cancelled' });
      closeActionTaken = false;
    });

    // 编辑订单
    el.editClose.addEventListener('click', function () { closeDialog(el.editDialog); });
    el.editCancel.addEventListener('click', function () { closeDialog(el.editDialog); });
    el.editForm.addEventListener('submit', saveEdit);
    el.editGame.addEventListener('input', clearEditInvalid);
    el.editRate.addEventListener('input', function () { clearEditInvalid(); updateEditPreview(); });
    el.editCommission.addEventListener('input', function () { clearEditInvalid(); updateEditPreview(); });
    [el.editHours, el.editMinutePart].forEach(function (input) {
      input.addEventListener('input', function () { clearEditInvalid(); updateEditPreview(); });
      input.addEventListener('blur', function () {
        normalizeDurationFields(el.editHours, el.editMinutePart, 8760);
        updateEditPreview();
      });
    });
    el.editDelete.addEventListener('click', function () {
      var id = editingOrderId;
      closeDialog(el.editDialog);
      if (id) deleteOrder(id);
    });
    el.editDialog.addEventListener('click', function (event) {
      if (event.target === el.editDialog) closeDialog(el.editDialog);
    });
    el.editDialog.addEventListener('close', function () {
      editingOrderId = null;
      editingOldDay = null;
    });

    // 游戏库
    el.presetClose.addEventListener('click', function () { closeDialog(el.presetDialog); });
    el.presetDialog.addEventListener('click', function (event) {
      if (event.target === el.presetDialog) closeDialog(el.presetDialog);
    });
    el.presetForm.addEventListener('submit', savePresetForm);
    el.presetName.addEventListener('input', function () {
      presetFormMessage('例如：英雄联盟 · 45 元/小时', false);
      updatePresetSubmitLabel();
    });
    el.presetRate.addEventListener('input', function () {
      presetFormMessage('例如：英雄联盟 · 45 元/小时', false);
    });
    el.presetCancelEdit.addEventListener('click', function () {
      resetPresetForm(true);
      renderPresetList();
      el.presetName.focus();
    });
    el.presetUndoBtn.addEventListener('click', undoPresetDelete);
    el.presetList.addEventListener('click', function (event) {
      var useBtn = event.target.closest('[data-use-preset]');
      if (useBtn) {
        applyGamePreset(useBtn.getAttribute('data-use-preset'), true);
        return;
      }
      var editBtn = event.target.closest('[data-edit-preset]');
      if (editBtn) {
        startEditPreset(editBtn.getAttribute('data-edit-preset'));
        return;
      }
      var deleteBtn = event.target.closest('[data-delete-preset]');
      if (deleteBtn) deletePreset(deleteBtn.getAttribute('data-delete-preset'));
    });
    el.presetDialog.addEventListener('close', function () {
      hidePresetUndo();
      resetPresetForm(true);
    });

    // 数据与备份
    el.dataBtn.addEventListener('click', openDataDialog);
    el.footerBackupBtn.addEventListener('click', openDataDialog);
    el.dataClose.addEventListener('click', function () { closeDialog(el.dataDialog); });
    el.dataDialog.addEventListener('click', function (event) {
      if (event.target === el.dataDialog) closeDialog(el.dataDialog);
    });
    el.exportBackupBtn.addEventListener('click', exportBackup);
    el.exportAllBtn.addEventListener('click', exportAllCsv);
    el.importBackupBtn.addEventListener('click', function () { el.importFile.click(); });
    el.importFile.addEventListener('change', function () {
      var file = el.importFile.files && el.importFile.files[0];
      el.importFile.value = '';
      importBackupFile(file);
    });
    el.clearAllBtn.addEventListener('click', clearAllData);

    // 通用确认
    el.confirmCancel.addEventListener('click', function () { resolveConfirm(false); });
    el.confirmOk.addEventListener('click', function () { resolveConfirm(true); });
    el.confirmDialog.addEventListener('cancel', function (event) {
      event.preventDefault();
      resolveConfirm(false);
    });
    el.confirmDialog.addEventListener('click', function (event) {
      if (event.target === el.confirmDialog) resolveConfirm(false);
    });

    // Toast
    el.toastClose.addEventListener('click', hideToast);

    // 多标签页同步
    window.addEventListener('storage', function (event) {
      if (event.key !== KEY || !event.newValue) return;
      try {
        state = C.normalizeState(JSON.parse(event.newValue));
        if (state.active) timerScreen = 'session';
        hydrateForm();
        renderAll();
      } catch (e) {
        // 忽略无法解析的跨页数据
      }
    });

    // 回到页面时刷新（睡眠唤醒、切回标签）
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) renderClock();
    });

    // 快捷操作：空格暂停 / 继续（输入框和弹窗内不触发）
    document.addEventListener('keydown', function (event) {
      if (event.code !== 'Space') return;
      var target = event.target;
      var tag = target && target.tagName ? target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'button' || tag === 'select') return;
      if (document.querySelector('dialog[open]')) return;
      if (!state.active) return;
      event.preventDefault();
      togglePause();
    });
  }

  /* ---------------- 时钟与启动 ---------------- */

  function tick() {
    var today = C.todayKey();
    if (today !== lastToday) {
      if (selectedDay === lastToday) selectedDay = today;
      lastToday = today;
      renderAll();
    }
    renderClock();
  }

  function init() {
    cacheElements();
    window.PeiwanDesktop = {
      showCloseDialog: showCloseDialog,
      updateCloseSummary: updateCloseSummary,
      pauseAndClose: pauseAndClose
    };
    state = loadState();
    timerScreen = state.active ? 'session' : 'picker';
    lastToday = C.todayKey();
    selectedDay = lastToday;
    hydrateForm();
    bindEvents();
    renderAll();
    var initialView = 'timer';
    try {
      if (new URLSearchParams(window.location.search).get('view') === 'bills') initialView = 'bills';
    } catch (e) {
      // 旧环境不支持 URLSearchParams 时保持计时台
    }
    switchView(initialView, true);
    window.setInterval(tick, 500);
    renderClock();

    if (recoveredFromBackup) {
      window.setTimeout(function () {
        showToast('主数据异常，已从安全备份恢复', { tone: 'warn', duration: 6000 });
      }, 700);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
