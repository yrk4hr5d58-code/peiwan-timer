/*
 * 陪玩计时 · 核心计算
 * 纯函数，无 DOM 依赖，可在浏览器和 Node.js 中运行。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PeiwanCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MINUTE_MS = 60 * 1000;
  var HOUR_MS = 60 * MINUTE_MS;
  var STORAGE_KEY = 'peiwan-timer-state-v1';
  var VERSION = 1;

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function round2(n) {
    if (!Number.isFinite(n)) return 0;
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function toNumber(value, fallback) {
    var n = typeof value === 'number' ? value : parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function cleanText(value, maxLength) {
    return String(value == null ? '' : value)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
  }

  function uid(prefix) {
    var id;
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      id = crypto.randomUUID();
    } else {
      id = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }
    return (prefix || 'id') + '_' + id;
  }

  /* ---------------- 时间与金额 ---------------- */

  /** 已完成的有效时长折算为整分钟，最低 1 分钟。 */
  function completeMinutes(durationMs) {
    var ms = Math.max(0, toNumber(durationMs, 0));
    return Math.max(1, Math.floor(ms / MINUTE_MS));
  }

  /** 计时过程中展示的整分钟数（未满 1 分钟为 0）。 */
  function elapsedMinutes(durationMs) {
    return Math.max(0, Math.floor(Math.max(0, toNumber(durationMs, 0)) / MINUTE_MS));
  }

  /** 按分钟计费，金额保留两位小数。 */
  function calcAmount(minutes, rate) {
    var m = Math.max(0, toNumber(minutes, 0));
    var r = Math.max(0, toNumber(rate, 0));
    return round2((m / 60) * r);
  }

  /** 计时器主显示：HH:MM（小时可超过两位）。 */
  function formatTimer(minutes) {
    var m = Math.max(0, Math.floor(toNumber(minutes, 0)));
    var h = Math.floor(m / 60);
    return pad2(h) + ':' + pad2(m % 60);
  }

  /** 账单时长：1小时25分 / 25分钟。 */
  function formatMinutesHuman(minutes) {
    var m = Math.max(0, Math.floor(toNumber(minutes, 0)));
    var h = Math.floor(m / 60);
    var rest = m % 60;
    if (h === 0) return rest + '分钟';
    if (rest === 0) return h + '小时';
    return h + '小时' + rest + '分';
  }

  /** 暂停累计等辅助信息：MM:SS，超过 1 小时为 H:MM:SS。 */
  function formatStopwatch(ms) {
    var total = Math.max(0, Math.floor(toNumber(ms, 0) / 1000));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    if (h > 0) return h + ':' + pad2(m) + ':' + pad2(s);
    return pad2(m) + ':' + pad2(s);
  }

  function formatMoneyPlain(value) {
    return round2(toNumber(value, 0)).toFixed(2);
  }

  function formatMoney(value) {
    var n = round2(toNumber(value, 0));
    var parts = n.toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return '¥' + parts.join('.');
  }

  function formatRate(rate) {
    var n = toNumber(rate, 0);
    if (Number.isInteger(n)) return String(n);
    return String(round2(n)).replace(/0+$/, '').replace(/\.$/, '');
  }

  /* ---------------- 本地日期 ---------------- */

  function dayKey(timestamp) {
    var d = new Date(toNumber(timestamp, Date.now()));
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function parseDayKey(key) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    if (!m) return new Date(NaN);
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  }

  function isValidDayKey(key) {
    var d = parseDayKey(key);
    return !Number.isNaN(d.getTime()) && dayKey(d.getTime()) === key;
  }

  function addDays(key, delta) {
    var d = parseDayKey(key);
    if (Number.isNaN(d.getTime())) return dayKey(Date.now());
    d.setDate(d.getDate() + Number(delta || 0));
    return dayKey(d.getTime());
  }

  function addMonths(key, delta) {
    var d = parseDayKey(key);
    if (Number.isNaN(d.getTime())) return dayKey(Date.now());
    var day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + Number(delta || 0));
    var lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, lastDay));
    return dayKey(d.getTime());
  }

  function addYears(key, delta) {
    var d = parseDayKey(key);
    if (Number.isNaN(d.getTime())) return dayKey(Date.now());
    var month = d.getMonth();
    var day = d.getDate();
    d.setDate(1);
    d.setFullYear(d.getFullYear() + Number(delta || 0));
    d.setMonth(month);
    var lastDay = new Date(d.getFullYear(), month + 1, 0).getDate();
    d.setDate(Math.min(day, lastDay));
    return dayKey(d.getTime());
  }

  function todayKey(now) {
    return dayKey(now == null ? Date.now() : now);
  }

  function weekdayCN(key, short) {
    var d = parseDayKey(key);
    var names = short
      ? ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
      : ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    return names[d.getDay()];
  }

  function formatDateCN(key, includeWeekday) {
    var d = parseDayKey(key);
    var text = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
    return includeWeekday ? text + ' ' + weekdayCN(key, true) : text;
  }

  function formatShortDate(key) {
    var d = parseDayKey(key);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function monthKey(key) {
    return String(key || '').slice(0, 7);
  }

  function yearKey(key) {
    return String(key || '').slice(0, 4);
  }

  function formatYearCN(year) {
    var text = String(year || '');
    return text ? text + '年' : '';
  }

  function formatMonthCN(key) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
    return m ? Number(m[1]) + '年' + Number(m[2]) + '月' : '';
  }

  function formatTimeHM(timestamp) {
    var d = new Date(toNumber(timestamp, 0));
    if (Number.isNaN(d.getTime())) return '--:--';
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function formatDateTime(timestamp) {
    var d = new Date(toNumber(timestamp, 0));
    if (Number.isNaN(d.getTime())) return '--';
    return formatDateCN(dayKey(d.getTime())) + ' ' + formatTimeHM(d.getTime());
  }

  /** datetime-local 输入值（精确到分钟）。 */
  function toDateTimeLocal(timestamp) {
    var d = new Date(toNumber(timestamp, Date.now()));
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function fromDateTimeLocal(value) {
    if (!value) return NaN;
    var d = new Date(String(value) + ':00');
    return Number.isNaN(d.getTime()) ? NaN : d.getTime();
  }

  /* ---------------- 订单 ---------------- */

  function orderMinutes(order) {
    return Math.max(1, Math.floor(toNumber(order && order.minutes, 1)));
  }

  function orderCommissionRate(order) {
    return clamp(toNumber(order && order.commission, 0), 0, 100);
  }

  function orderGross(order) {
    return calcAmount(orderMinutes(order), order && order.rate);
  }

  function orderCommission(order) {
    return round2(orderGross(order) * orderCommissionRate(order) / 100);
  }

  function orderAmount(order) {
    return round2(orderGross(order) - orderCommission(order));
  }

  function sortOrders(orders) {
    return orders.slice().sort(function (a, b) {
      return toNumber(b.startedAt, 0) - toNumber(a.startedAt, 0);
    });
  }

  function summarize(orders) {
    var minutes = 0;
    var gross = 0;
    var commission = 0;
    var amount = 0;
    (orders || []).forEach(function (order) {
      minutes += orderMinutes(order);
      gross += orderGross(order);
      commission += orderCommission(order);
      amount += orderAmount(order);
    });
    return {
      count: (orders || []).length,
      minutes: minutes,
      gross: round2(gross),
      commission: round2(commission),
      amount: round2(amount),
      durationText: formatMinutesHuman(minutes)
    };
  }

  function groupByDay(orders) {
    var map = Object.create(null);
    (orders || []).forEach(function (order) {
      var key = dayKey(order.startedAt);
      if (!map[key]) map[key] = [];
      map[key].push(order);
    });
    Object.keys(map).forEach(function (key) {
      map[key] = sortOrders(map[key]);
    });
    return map;
  }

  function ordersOfDay(orders, key) {
    return sortOrders((orders || []).filter(function (order) {
      return dayKey(order.startedAt) === key;
    }));
  }

  function ordersOfMonth(orders, month) {
    return (orders || []).filter(function (order) {
      return monthKey(dayKey(order.startedAt)) === month;
    });
  }

  function ordersOfYear(orders, year) {
    return (orders || []).filter(function (order) {
      return yearKey(dayKey(order.startedAt)) === String(year || '');
    });
  }

  function activeElapsed(active, now) {
    if (!active) return 0;
    var base = Math.max(0, toNumber(active.accumulatedMs, 0));
    var runningSince = toNumber(active.runningSince, 0);
    if (!runningSince) return base;
    return base + Math.max(0, toNumber(now, Date.now()) - runningSince);
  }

  function pauseTotal(active, now) {
    if (!active) return 0;
    return Math.max(0, toNumber(active.pauseTotalMs, 0)) +
      (active.runningSince ? 0 : Math.max(0, toNumber(now, Date.now()) - toNumber(active.pausedSince, 0)));
  }

  /* ---------------- 账单文本 / CSV ---------------- */

  function buildBillText(day, orders, settled) {
    var list = ordersOfDay(orders, day);
    var summary = summarize(list);
    var lines = [];
    lines.push('【陪玩账单】' + formatDateCN(day, true));
    lines.push('————————————————');
    if (!list.length) {
      lines.push('今日暂无已完成订单。');
    } else {
      list.forEach(function (order, index) {
        lines.push((index + 1) + '. ' + order.game);
        var commissionRate = orderCommissionRate(order);
        if (commissionRate > 0) {
          lines.push('   ' + formatMinutesHuman(orderMinutes(order)) + ' × ¥' +
            formatMoneyPlain(order.rate) + '/小时');
          lines.push('   原价 ' + formatMoney(orderGross(order)) + ' − 抽成 ' +
            formatRate(commissionRate) + '% ' + formatMoney(orderCommission(order)) +
            ' = 实收 ' + formatMoney(orderAmount(order)));
        } else {
          lines.push('   ' + formatMinutesHuman(orderMinutes(order)) + ' × ¥' +
            formatMoneyPlain(order.rate) + '/小时 = ' + formatMoney(orderAmount(order)));
        }
        if (order.note) lines.push('   备注：' + order.note);
      });
    }
    lines.push('————————————————');
    lines.push('共 ' + summary.count + ' 单 · 有效时长 ' + summary.durationText);
    if (summary.commission > 0) {
      lines.push('原价合计：' + formatMoney(summary.gross));
      lines.push('抽成合计：' + formatMoney(summary.commission));
      lines.push('实收合计：' + formatMoney(summary.amount));
    } else {
      lines.push('应收合计：' + formatMoney(summary.amount));
    }
    lines.push('状态：' + (settled ? '已结清' : '未结清'));
    return lines.join('\n');
  }

  function buildGroupedBillText(title, groups, statusText) {
    var list = groups || [];
    var totalCount = 0;
    var totalMinutes = 0;
    var totalGross = 0;
    var totalCommission = 0;
    var totalAmount = 0;
    var lines = [];
    lines.push('【陪玩账单】' + title);
    lines.push('————————————————');

    if (!list.length) {
      lines.push('本期暂无已完成订单。');
    } else {
      list.forEach(function (group, index) {
        var gross = toNumber(group.gross, 0);
        var commission = toNumber(group.commission, 0);
        totalCount += group.count;
        totalMinutes += group.minutes;
        totalGross += gross;
        totalCommission += commission;
        totalAmount += group.amount;
        lines.push((index + 1) + '. ' + group.label);
        lines.push('   ' + group.count + ' 单 · ' + formatMinutesHuman(group.minutes) +
          ' · 实收 ' + formatMoney(group.amount));
        if (commission > 0) {
          lines.push('   原价 ' + formatMoney(gross) + ' − 抽成 ' + formatMoney(commission));
        }
      });
    }

    lines.push('————————————————');
    lines.push('共 ' + totalCount + ' 单 · 有效时长 ' + formatMinutesHuman(totalMinutes));
    if (totalCommission > 0) {
      lines.push('原价合计：' + formatMoney(round2(totalGross)));
      lines.push('抽成合计：' + formatMoney(round2(totalCommission)));
      lines.push('实收合计：' + formatMoney(round2(totalAmount)));
    } else {
      lines.push('应收合计：' + formatMoney(round2(totalAmount)));
    }
    lines.push('结清情况：' + (statusText || '未结清'));
    return lines.join('\n');
  }

  function csvCell(value) {
    var text = String(value == null ? '' : value);
    if (/[",\r\n]/.test(text)) {
      return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
  }

  function buildCsv(orders) {
    var rows = [];
    rows.push([
      '日期', '开始时间', '游戏', '分钟数', '有效时长', '单价(元/小时)',
      '原价(元)', '抽成(%)', '抽成金额(元)', '实收(元)', '备注'
    ]);
    sortOrders(orders || []).forEach(function (order) {
      rows.push([
        dayKey(order.startedAt),
        formatTimeHM(order.startedAt),
        order.game,
        orderMinutes(order),
        formatMinutesHuman(orderMinutes(order)),
        formatMoneyPlain(order.rate),
        formatMoneyPlain(orderGross(order)),
        formatRate(orderCommissionRate(order)),
        formatMoneyPlain(orderCommission(order)),
        formatMoneyPlain(orderAmount(order)),
        order.note || ''
      ]);
    });
    return '\uFEFF' + rows.map(function (row) {
      return row.map(csvCell).join(',');
    }).join('\r\n');
  }

  /* ---------------- 状态规范化 ---------------- */

  function defaultState() {
    return {
      version: VERSION,
      active: null,
      orders: [],
      settledDays: {},
      games: [],
      createdAt: Date.now()
    };
  }

  function normalizeOrder(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var startedAt = toNumber(raw.startedAt, NaN);
    if (!Number.isFinite(startedAt)) return null;
    var minutes = Math.max(1, Math.round(toNumber(raw.minutes, 0)));
    var rate = Math.max(0, round2(toNumber(raw.rate, 0)));
    var game = cleanText(raw.game, 40) || '未命名游戏';
    var endedAt = toNumber(raw.endedAt, startedAt + minutes * MINUTE_MS);
    return {
      id: cleanText(raw.id, 80) || uid('order'),
      game: game,
      rate: rate,
      minutes: minutes,
      commission: round2(clamp(toNumber(raw.commission, 0), 0, 100)),
      note: cleanText(raw.note, 300),
      startedAt: startedAt,
      endedAt: endedAt,
      createdAt: toNumber(raw.createdAt, startedAt)
    };
  }

  function normalizeGame(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var name = cleanText(raw.name || raw.game, 40);
    if (!name) return null;
    var now = Date.now();
    return {
      id: cleanText(raw.id, 80) || uid('game'),
      name: name,
      rate: Math.max(0, round2(toNumber(raw.rate, 0))),
      createdAt: toNumber(raw.createdAt, now),
      lastUsedAt: toNumber(raw.lastUsedAt, now)
    };
  }

  function normalizeActive(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var startedAt = toNumber(raw.startedAt, NaN);
    if (!Number.isFinite(startedAt)) return null;
    var runningSince = toNumber(raw.runningSince, 0);
    if (runningSince > Date.now() + 60 * 1000) runningSince = 0;
    return {
      id: cleanText(raw.id, 80) || uid('active'),
      game: cleanText(raw.game, 40) || '未命名游戏',
      rate: Math.max(0, round2(toNumber(raw.rate, 0))),
      note: cleanText(raw.note, 300),
      startedAt: startedAt,
      accumulatedMs: Math.max(0, toNumber(raw.accumulatedMs, 0)),
      runningSince: runningSince || 0,
      pauseTotalMs: Math.max(0, toNumber(raw.pauseTotalMs, 0)),
      pausedSince: Math.max(0, toNumber(raw.pausedSince, 0)),
      createdAt: toNumber(raw.createdAt, startedAt)
    };
  }

  function normalizeState(raw) {
    var state = defaultState();
    if (!raw || typeof raw !== 'object') return state;

    var seen = Object.create(null);
    state.orders = (Array.isArray(raw.orders) ? raw.orders : [])
      .slice(-5000)
      .map(normalizeOrder)
      .filter(function (order) {
        if (!order || seen[order.id]) return false;
        seen[order.id] = true;
        return true;
      });

    state.active = normalizeActive(raw.active);

    if (raw.settledDays && typeof raw.settledDays === 'object') {
      Object.keys(raw.settledDays).forEach(function (key) {
        if (!isValidDayKey(key)) return;
        var value = raw.settledDays[key];
        if (!value) return;
        state.settledDays[key] = {
          settledAt: toNumber(value && value.settledAt, Date.now())
        };
      });
    }

    var games = [];
    var gameByName = Object.create(null);

    function addGame(item) {
      var game = normalizeGame(item);
      if (!game) return;
      var existing = gameByName[game.name];
      if (!existing) {
        gameByName[game.name] = game;
        games.push(game);
        return;
      }
      // 同名游戏只保留一条，采用最近使用的那条记录。
      if (game.lastUsedAt >= existing.lastUsedAt) {
        existing.rate = game.rate;
        existing.lastUsedAt = game.lastUsedAt;
        existing.createdAt = Math.min(existing.createdAt, game.createdAt);
      }
    }

    // 新版本使用 games；同时兼容旧版本的 recentGames。
    (Array.isArray(raw.games) ? raw.games : []).forEach(addGame);
    (Array.isArray(raw.recentGames) ? raw.recentGames : []).forEach(addGame);

    if (!games.length) {
      sortOrders(state.orders).forEach(function (order) {
        if (gameByName[order.game]) return;
        var derived = normalizeGame({
          name: order.game,
          rate: order.rate,
          createdAt: order.startedAt,
          lastUsedAt: order.startedAt
        });
        gameByName[order.game] = derived;
        games.push(derived);
      });
    }

    games.sort(function (a, b) { return b.lastUsedAt - a.lastUsedAt; });
    state.games = games.slice(0, 200);
    state.createdAt = toNumber(raw.createdAt, Date.now());
    state.version = VERSION;
    return state;
  }

  function upsertGamePreset(state, game, rate, now) {
    var name = cleanText(game, 40);
    if (!name) return null;
    var timestamp = toNumber(now, Date.now());
    var normalizedRate = Math.max(0, round2(toNumber(rate, 0)));
    if (!Array.isArray(state.games)) state.games = [];

    var existing = null;
    for (var i = 0; i < state.games.length; i++) {
      if (state.games[i].name === name) {
        existing = state.games[i];
        break;
      }
    }

    if (existing) {
      existing.rate = normalizedRate;
      existing.lastUsedAt = timestamp;
    } else {
      existing = {
        id: uid('game'),
        name: name,
        rate: normalizedRate,
        createdAt: timestamp,
        lastUsedAt: timestamp
      };
      state.games.unshift(existing);
    }

    state.games.sort(function (a, b) { return b.lastUsedAt - a.lastUsedAt; });
    state.games = state.games.slice(0, 200);
    return existing;
  }

  function ensureGamePreset(state, game, rate, now) {
    var name = cleanText(game, 40);
    if (!name) return null;
    var existing = null;
    var games = Array.isArray(state.games) ? state.games : [];
    for (var i = 0; i < games.length; i++) {
      if (games[i].name === name) {
        existing = games[i];
        break;
      }
    }
    if (!existing) return upsertGamePreset(state, name, rate, now);
    existing.lastUsedAt = Math.max(toNumber(existing.lastUsedAt, 0), toNumber(now, Date.now()));
    state.games.sort(function (a, b) { return b.lastUsedAt - a.lastUsedAt; });
    return existing;
  }

  function removeGamePreset(state, id) {
    if (!Array.isArray(state.games)) return null;
    var index = -1;
    for (var i = 0; i < state.games.length; i++) {
      if (state.games[i].id === id) {
        index = i;
        break;
      }
    }
    if (index < 0) return null;
    return state.games.splice(index, 1)[0];
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  return {
    MINUTE_MS: MINUTE_MS,
    HOUR_MS: HOUR_MS,
    STORAGE_KEY: STORAGE_KEY,
    VERSION: VERSION,
    pad2: pad2,
    round2: round2,
    clamp: clamp,
    cleanText: cleanText,
    uid: uid,
    completeMinutes: completeMinutes,
    elapsedMinutes: elapsedMinutes,
    calcAmount: calcAmount,
    formatTimer: formatTimer,
    formatMinutesHuman: formatMinutesHuman,
    formatStopwatch: formatStopwatch,
    formatMoneyPlain: formatMoneyPlain,
    formatMoney: formatMoney,
    formatRate: formatRate,
    dayKey: dayKey,
    parseDayKey: parseDayKey,
    isValidDayKey: isValidDayKey,
    addDays: addDays,
    addMonths: addMonths,
    addYears: addYears,
    todayKey: todayKey,
    weekdayCN: weekdayCN,
    formatDateCN: formatDateCN,
    formatShortDate: formatShortDate,
    monthKey: monthKey,
    yearKey: yearKey,
    formatMonthCN: formatMonthCN,
    formatYearCN: formatYearCN,
    formatTimeHM: formatTimeHM,
    formatDateTime: formatDateTime,
    toDateTimeLocal: toDateTimeLocal,
    fromDateTimeLocal: fromDateTimeLocal,
    orderMinutes: orderMinutes,
    orderCommissionRate: orderCommissionRate,
    orderGross: orderGross,
    orderCommission: orderCommission,
    orderAmount: orderAmount,
    sortOrders: sortOrders,
    summarize: summarize,
    groupByDay: groupByDay,
    ordersOfDay: ordersOfDay,
    ordersOfMonth: ordersOfMonth,
    ordersOfYear: ordersOfYear,
    activeElapsed: activeElapsed,
    pauseTotal: pauseTotal,
    buildBillText: buildBillText,
    buildGroupedBillText: buildGroupedBillText,
    buildCsv: buildCsv,
    defaultState: defaultState,
    normalizeState: normalizeState,
    normalizeGame: normalizeGame,
    upsertGamePreset: upsertGamePreset,
    ensureGamePreset: ensureGamePreset,
    removeGamePreset: removeGamePreset,
    touchRecentGame: upsertGamePreset,
    clone: clone
  };
});
