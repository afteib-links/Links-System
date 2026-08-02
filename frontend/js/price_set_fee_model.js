/**
 * 金額データ: 料金項目（曜日チェック × 日極/時間マトリクス）↔ price_set_lines 変換
 */
(() => {
  const WEEKDAY_CODES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'holiday'];

  const WEEKDAY_LABELS = {
    mon: '月',
    tue: '火',
    wed: '水',
    thu: '木',
    fri: '金',
    sat: '土',
    sun: '日',
    holiday: '祝',
    all: '全日',
  };

  function emptyWeekdays() {
    const w = {};
    WEEKDAY_CODES.forEach((c) => {
      w[c] = false;
    });
    return w;
  }

  function emptyCell() {
    return { billing: '', payment: '', lineIds: {} };
  }

  function defaultPriceTypeCodes(codes) {
    const list = codes?.price_type || [];
    if (!list.length) return ['basic'];
    return list.map((c) => c.code_value || c.value || c.code);
  }

  function buildEmptyMatrix(priceTypeCodes, calcs = ['daily', 'hourly']) {
    const matrix = {};
    calcs.forEach((calc) => {
      matrix[calc] = {};
      priceTypeCodes.forEach((pt) => {
        matrix[calc][pt] = emptyCell();
      });
    });
    return matrix;
  }

  function buildDistanceMatrix(priceTypeCodes) {
    const matrix = { distance: {} };
    const pt = priceTypeCodes[0] || 'basic';
    matrix.distance[pt] = emptyCell();
    return matrix;
  }

  function nextItemId() {
    return `fi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function defaultFeeItemTemplates(codes) {
    const pts = defaultPriceTypeCodes(codes);
    const matrixStd = buildEmptyMatrix(pts);
    return [
      {
        id: nextItemId(),
        name: '平日',
        mode: 'weekdays',
        weekdays: {
          mon: true,
          tue: true,
          wed: true,
          thu: true,
          fri: true,
          sat: false,
          sun: false,
          holiday: false,
        },
        matrix: JSON.parse(JSON.stringify(matrixStd)),
      },
      {
        id: nextItemId(),
        name: '休日',
        mode: 'weekdays',
        weekdays: {
          mon: false,
          tue: false,
          wed: false,
          thu: false,
          fri: false,
          sat: true,
          sun: true,
          holiday: true,
        },
        matrix: JSON.parse(JSON.stringify(matrixStd)),
      },
      {
        id: nextItemId(),
        name: '距離超過',
        mode: 'distance',
        weekdays: emptyWeekdays(),
        matrix: buildDistanceMatrix(pts),
      },
    ];
  }

  function parseExtraData(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function cellHasValue(cell) {
    if (!cell) return false;
    const b = cell.billing;
    const p = cell.payment;
    if (b !== '' && b != null && Number(b) !== 0) return true;
    if (p !== '' && p != null && Number(p) !== 0) return true;
    const ids = cell.lineIds || {};
    return Object.keys(ids).length > 0 || cell.price_set_line_id;
  }

  function normalizeCell(cell) {
    if (!cell) return emptyCell();
    const lineIds = { ...(cell.lineIds || {}) };
    if (cell.price_set_line_id && !Object.keys(lineIds).length) {
      lineIds._single = cell.price_set_line_id;
    }
    return {
      billing: cell.billing ?? '',
      payment: cell.payment ?? '',
      lineIds,
    };
  }

  function normalizeItem(item, priceTypeCodes) {
    const mode = item.mode === 'distance' ? 'distance' : 'weekdays';
    const weekdays = { ...emptyWeekdays(), ...(item.weekdays || {}) };
    let matrix;
    if (mode === 'distance') {
      matrix = { distance: {} };
      const src = item.matrix?.distance || {};
      priceTypeCodes.forEach((pt) => {
        matrix.distance[pt] = normalizeCell(src[pt]);
      });
      if (!Object.keys(matrix.distance).length) {
        matrix = buildDistanceMatrix(priceTypeCodes);
      }
    } else {
      matrix = buildEmptyMatrix(priceTypeCodes);
      ['daily', 'hourly'].forEach((calc) => {
        const src = item.matrix?.[calc] || {};
        priceTypeCodes.forEach((pt) => {
          matrix[calc][pt] = normalizeCell(src[pt]);
        });
      });
    }
    return {
      id: item.id || nextItemId(),
      name: item.name || '',
      mode,
      weekdays,
      matrix,
    };
  }

  function attachLinesToItems(items, lines) {
    const list = lines || [];
    for (const item of items) {
      if (item.mode === 'distance') {
        for (const [pt, cell] of Object.entries(item.matrix.distance || {})) {
          const hit = list.find(
            (l) =>
              String(l.calc_type_code) === 'distance' &&
              String(l.price_type_code || '') === String(pt) &&
              (String(l.weekday_code) === 'all' || !l.weekday_code)
          );
          if (hit) {
            cell.lineIds = { all: hit.price_set_line_id };
            cell.billing = hit.billing_unit_price ?? '';
            cell.payment = hit.payment_unit_price ?? '';
          }
        }
        continue;
      }
      const days = WEEKDAY_CODES.filter((d) => item.weekdays[d]);
      for (const calc of ['daily', 'hourly']) {
        for (const [pt, cell] of Object.entries(item.matrix[calc] || {})) {
          const lineIds = {};
          let billing = '';
          let payment = '';
          for (const wd of days) {
            const hit = list.find(
              (l) =>
                String(l.weekday_code) === wd &&
                String(l.calc_type_code || '') === calc &&
                String(l.price_type_code || '') === String(pt)
            );
            if (hit) {
              lineIds[wd] = hit.price_set_line_id;
              billing = hit.billing_unit_price ?? billing;
              payment = hit.payment_unit_price ?? payment;
            }
          }
          cell.lineIds = lineIds;
          if (billing !== '') cell.billing = billing;
          if (payment !== '') cell.payment = payment;
        }
      }
    }
  }

  function linesToFeeItems(lines, codes) {
    const priceTypeCodes = defaultPriceTypeCodes(codes);
    const items = [];
    const distanceLines = (lines || []).filter((l) => String(l.calc_type_code) === 'distance');
    const otherLines = (lines || []).filter((l) => String(l.calc_type_code) !== 'distance');

    if (distanceLines.length) {
      const matrix = buildDistanceMatrix(priceTypeCodes);
      distanceLines.forEach((l) => {
        const pt = l.price_type_code || priceTypeCodes[0];
        if (!matrix.distance[pt]) matrix.distance[pt] = emptyCell();
        matrix.distance[pt].billing = l.billing_unit_price ?? '';
        matrix.distance[pt].payment = l.payment_unit_price ?? '';
        matrix.distance[pt].lineIds = { all: l.price_set_line_id };
      });
      items.push({
        id: nextItemId(),
        name: '距離超過',
        mode: 'distance',
        weekdays: emptyWeekdays(),
        matrix,
      });
    }

    const groups = new Map();
    for (const l of otherLines) {
      const wd = String(l.weekday_code || 'all');
      if (wd === 'all') {
        WEEKDAY_CODES.forEach((c) => {
          const key = `${l.calc_type_code}|${l.price_type_code}|${l.billing_unit_price}|${l.payment_unit_price}`;
          if (!groups.has(key)) {
            groups.set(key, {
              calc: l.calc_type_code || 'daily',
              pt: l.price_type_code || 'basic',
              billing: l.billing_unit_price,
              payment: l.payment_unit_price,
              weekdays: emptyWeekdays(),
              lineIdsByWd: {},
            });
          }
          const g = groups.get(key);
          g.weekdays[c] = true;
          g.lineIdsByWd[c] = l.price_set_line_id;
        });
        continue;
      }
      const key = `${l.calc_type_code}|${l.price_type_code}|${l.billing_unit_price}|${l.payment_unit_price}`;
      if (!groups.has(key)) {
        groups.set(key, {
          calc: l.calc_type_code || 'daily',
          pt: l.price_type_code || 'basic',
          billing: l.billing_unit_price,
          payment: l.payment_unit_price,
          weekdays: emptyWeekdays(),
          lineIdsByWd: {},
        });
      }
      const g = groups.get(key);
      if (WEEKDAY_CODES.includes(wd)) {
        g.weekdays[wd] = true;
        g.lineIdsByWd[wd] = l.price_set_line_id;
      }
    }

    const groupList = [...groups.values()];
    if (groupList.length) {
      const matrix = buildEmptyMatrix(priceTypeCodes);
      const weekdays = emptyWeekdays();
      groupList.forEach((g) => {
        WEEKDAY_CODES.forEach((c) => {
          if (g.weekdays[c]) weekdays[c] = true;
        });
        if (!matrix[g.calc]) matrix[g.calc] = {};
        if (!matrix[g.calc][g.pt]) matrix[g.calc][g.pt] = emptyCell();
        const cell = matrix[g.calc][g.pt];
        cell.billing = g.billing ?? '';
        cell.payment = g.payment ?? '';
        cell.lineIds = { ...g.lineIdsByWd };
      });
      items.unshift({
        id: nextItemId(),
        name: '料金項目',
        mode: 'weekdays',
        weekdays,
        matrix,
      });
    }

    return items.map((it) => normalizeItem(it, priceTypeCodes));
  }

  function hydrateFeeItems(row, codes) {
    const priceTypeCodes = defaultPriceTypeCodes(codes);
    const extra = parseExtraData(row.extra_data);
    if (extra?.fee_items?.length) {
      const items = extra.fee_items.map((it) => normalizeItem(it, priceTypeCodes));
      attachLinesToItems(items, row.lines || []);
      return items;
    }
    if ((row.lines || []).length) {
      return linesToFeeItems(row.lines, codes);
    }
    return null;
  }

  function itemsToLines(items) {
    const lines = [];
    let sort = 0;
    for (const item of items || []) {
      if (item.mode === 'distance') {
        for (const [pt, cell] of Object.entries(item.matrix?.distance || {})) {
          if (!cellHasValue(cell)) continue;
          const lid = cell.lineIds?.all || cell.lineIds?._single || null;
          lines.push({
            price_set_line_id: lid,
            weekday_code: 'all',
            calc_type_code: 'distance',
            price_type_code: pt,
            billing_unit_price: Number(cell.billing || 0),
            payment_unit_price: Number(cell.payment || 0),
            sort_order: sort++,
          });
        }
        continue;
      }
      const days = WEEKDAY_CODES.filter((d) => item.weekdays?.[d]);
      if (!days.length) continue;
      for (const calc of ['daily', 'hourly']) {
        for (const [pt, cell] of Object.entries(item.matrix?.[calc] || {})) {
          if (!cellHasValue(cell)) continue;
          for (const wd of days) {
            const lid = cell.lineIds?.[wd] || null;
            lines.push({
              price_set_line_id: lid,
              weekday_code: wd,
              calc_type_code: calc,
              price_type_code: pt,
              billing_unit_price: Number(cell.billing || 0),
              payment_unit_price: Number(cell.payment || 0),
              sort_order: sort++,
            });
          }
        }
      }
    }
    return lines;
  }

  function feeItemsForExtraData(items) {
    return (items || []).map((it) => ({
      id: it.id,
      name: it.name,
      mode: it.mode,
      weekdays: { ...it.weekdays },
      matrix: JSON.parse(JSON.stringify(it.matrix)),
    }));
  }

  function duplicateFeeItem(item, codes) {
    const priceTypeCodes = defaultPriceTypeCodes(codes);
    const copy = normalizeItem(
      {
        ...item,
        id: nextItemId(),
        name: `${item.name || '項目'}（コピー）`,
        matrix: JSON.parse(JSON.stringify(item.matrix)),
      },
      priceTypeCodes
    );
    const clearIds = (matrix) => {
      Object.values(matrix).forEach((row) => {
        Object.values(row).forEach((cell) => {
          cell.lineIds = {};
        });
      });
    };
    if (copy.mode === 'distance') clearIds(copy.matrix);
    else {
      clearIds(copy.matrix);
    }
    return copy;
  }

  function applyWeekdayPreset(item, preset) {
    const w = emptyWeekdays();
    if (preset === 'weekdays') {
      w.mon = w.tue = w.wed = w.thu = w.fri = true;
    } else if (preset === 'weekend') {
      w.sat = w.sun = true;
    } else if (preset === 'weekend_holiday') {
      w.sat = w.sun = w.holiday = true;
    } else if (preset === 'all') {
      WEEKDAY_CODES.forEach((c) => {
        w[c] = true;
      });
    }
    item.weekdays = w;
    return item;
  }

  window.LinksPriceSetFeeModel = {
    WEEKDAY_CODES,
    WEEKDAY_LABELS,
    emptyWeekdays,
    emptyCell,
    defaultPriceTypeCodes,
    defaultFeeItemTemplates,
    hydrateFeeItems,
    itemsToLines,
    feeItemsForExtraData,
    duplicateFeeItem,
    applyWeekdayPreset,
    cellHasValue,
    normalizeItem,
    nextItemId,
  };
})();
