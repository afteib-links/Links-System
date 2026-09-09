/**
 * 金額データ: 料金項目（曜日チェック × 日極/時間マトリクス）↔ price_set_lines 変換
 */
(() => {
  const WEEKDAY_CODES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'holiday', 'project_holiday', 'all'];

  const WEEKDAY_LABELS = {
    mon: '月',
    tue: '火',
    wed: '水',
    thu: '木',
    fri: '金',
    sat: '土',
    sun: '日',
    holiday: '祝',
    project_holiday: '休',
    all: 'ALL',
  };

  const ITEM_TYPES = [
    ['daily_basic', '基本日極'], ['hourly', '時間単価'], ['overtime', '時間外'],
    ['night', '深夜単価'], ['night_overtime', '深夜時間外'], ['unit', '単価'],
    ['distance', '距離単価'], ['table', 'テーブル'],
  ];

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

  function nextRowId() {
    return `fr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeRuleRow(row = {}, index = 0) {
    return {
      id: row.id || nextRowId(),
      item_name: row.item_name || row.name || '',
      item_type: row.item_type || 'daily_basic',
      billing: row.billing ?? '',
      payment: row.payment ?? '',
      billing_detail_name: row.billing_detail_name || '',
      payment_detail_name: row.payment_detail_name || '',
      condition_expression: row.condition_expression || '',
      billing_expression: row.billing_expression || '',
      payment_expression: row.payment_expression || '',
      has_admin_rule: Boolean(row.has_admin_rule),
      rule_state: row.rule_state || 'active',
      undefined_variables: [...(row.undefined_variables || [])],
      sort_order: Number(row.sort_order ?? (index + 1) * 10),
      lineIds: { ...(row.lineIds || {}) },
    };
  }

  function blankRuleRow(name = '基本料金', itemType = 'daily_basic') {
    return normalizeRuleRow({ item_name: name, item_type: itemType });
  }

  function legacyItemRows(item) {
    const mapping = {
      'daily|basic': 'daily_basic', 'hourly|basic': 'hourly', 'hourly|shortage': 'hourly',
      'daily|overtime': 'overtime', 'hourly|overtime': 'overtime',
      'daily|night': 'night', 'hourly|night': 'night',
      'daily|night_overtime': 'night_overtime', 'hourly|night_overtime': 'night_overtime',
      'distance|basic': 'distance', 'unit|basic': 'unit',
    };
    const rows = [];
    Object.entries(item.matrix || {}).forEach(([calc, cells]) => {
      Object.entries(cells || {}).forEach(([priceType, cell]) => {
        const type = mapping[`${calc}|${priceType}`];
        if (!type || (type === 'hourly' && priceType === 'shortage')) return;
        if (!cellHasValue(cell)) return;
        rows.push(normalizeRuleRow({
          item_name: `${item.name || '料金'} ${ITEM_TYPES.find(([code]) => code === type)?.[1] || type}`,
          item_type: type,
          billing: cell.billing,
          payment: cell.payment,
          lineIds: cell.lineIds,
        }, rows.length));
      });
    });
    return rows.length ? rows : [blankRuleRow(item.name || '基本料金')];
  }

  function ensureRowsModel(item, index = 0) {
    const normalized = normalizeItem(item, defaultPriceTypeCodes());
    return {
      ...normalized,
      sort_order: Number(item.sort_order ?? (index + 1) * 10),
      rows: Array.isArray(item.rows)
        ? item.rows.map(normalizeRuleRow)
        : legacyItemRows(normalized),
    };
  }

  function defaultFeeItemTemplates(codes) {
    return [
      {
        id: nextItemId(),
        name: '平日',
        weekdays: {
          mon: true,
          tue: true,
          wed: true,
          thu: true,
          fri: true,
          sat: false,
          sun: false,
          holiday: false,
          project_holiday: false,
          all: false,
        },
        rows: [blankRuleRow('平日基本料金')],
      },
      {
        id: nextItemId(),
        name: '休日',
        weekdays: {
          mon: false,
          tue: false,
          wed: false,
          thu: false,
          fri: false,
          sat: true,
          sun: true,
          holiday: true,
          project_holiday: false,
          all: false,
        },
        rows: [blankRuleRow('休日基本料金')],
      },
    ].map(ensureRowsModel);
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
    const inferred = item.mode === 'distance'
      ? ['distance']
      : Object.keys(item.matrix || {}).filter(Boolean);
    const calcTypes = [...new Set((Array.isArray(item.calc_types) && item.calc_types.length ? item.calc_types : inferred.length ? inferred : ['daily', 'hourly']).map(String))];
    const mode = calcTypes.length === 1 && calcTypes[0] === 'distance' ? 'distance' : 'weekdays';
    const weekdays = { ...emptyWeekdays(), ...(item.weekdays || {}) };
    const matrix = {};
    calcTypes.forEach((calc) => {
      matrix[calc] = {};
      const src = item.matrix?.[calc] || {};
      priceTypeCodes.forEach((pt) => {
        matrix[calc][pt] = normalizeCell(src[pt]);
      });
    });
    return {
      id: item.id || nextItemId(),
      name: item.name || '',
      billing_summary_template: item.billing_summary_template || '{企業名} {料金名}',
      payment_summary_template: item.payment_summary_template || '{パートナー名} {料金名}',
      mode,
      calc_types: calcTypes,
      weekdays,
      matrix,
    };
  }

  function attachLinesToItems(items, lines) {
    const list = lines || [];
    for (const item of items) {
      for (const calc of item.calc_types || []) {
        if (calc === 'distance') {
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
        calc_types: ['distance'],
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
        calc_types: [...new Set(groupList.map((group) => group.calc))],
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
      const items = extra.fee_items.map((it, index) => ensureRowsModel(it, index));
      if (items.some((item) => Array.isArray(item.rows))) return items;
      attachLinesToItems(items, row.lines || []);
      return items;
    }
    if ((row.lines || []).length) {
      return linesToFeeItems(row.lines, codes);
    }
    return null;
  }

  function itemsToLines(items) {
    if ((items || []).some((item) => Array.isArray(item.rows))) {
      const mapping = {
        daily_basic: ['daily', 'basic'], hourly: ['hourly', 'basic'], overtime: ['hourly', 'overtime'],
        night: ['hourly', 'night'], night_overtime: ['hourly', 'night_overtime'], unit: ['unit', 'basic'],
        distance: ['distance', 'basic'], table: ['distance', 'basic'],
      };
      const lines = [];
      let sort = 0;
      (items || []).forEach((item) => {
        const days = item.weekdays?.all ? ['all'] : WEEKDAY_CODES.filter((day) => day !== 'all' && item.weekdays?.[day]);
        (item.rows || []).forEach((raw) => {
          const row = normalizeRuleRow(raw);
          const pair = mapping[row.item_type];
          if (!pair) return;
          const targets = pair[0] === 'distance' ? ['all'] : days;
          targets.forEach((weekday) => lines.push({
            price_set_line_id: row.lineIds?.[weekday] || null,
            weekday_code: weekday, calc_type_code: pair[0], price_type_code: pair[1],
            billing_unit_price: Number(row.billing || 0), payment_unit_price: Number(row.payment || 0), sort_order: sort++,
          }));
        });
      });
      return lines;
    }
    const lines = [];
    let sort = 0;
    for (const item of items || []) {
      const days = WEEKDAY_CODES.filter((d) => item.weekdays?.[d]);
      for (const calc of item.calc_types || []) {
        for (const [pt, cell] of Object.entries(item.matrix?.[calc] || {})) {
          if (!cellHasValue(cell)) continue;
          const targetDays = calc === 'distance' ? ['all'] : days;
          for (const wd of targetDays) {
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
      billing_summary_template: it.billing_summary_template,
      payment_summary_template: it.payment_summary_template,
      mode: it.mode,
      calc_types: [...(it.calc_types || [])],
      weekdays: { ...it.weekdays },
      matrix: JSON.parse(JSON.stringify(it.matrix)),
      sort_order: it.sort_order,
      rows: Array.isArray(it.rows) ? it.rows.map((row, index) => normalizeRuleRow(row, index)) : undefined,
    }));
  }

  function duplicateFeeItem(item, codes) {
    const priceTypeCodes = defaultPriceTypeCodes(codes);
    const copy = ensureRowsModel(
      {
        ...item,
        id: nextItemId(),
        name: `${item.name || '項目'}（コピー）`,
        matrix: JSON.parse(JSON.stringify(item.matrix)),
        rows: (item.rows || []).map((row) => ({ ...row, id: nextRowId(), lineIds: {} })),
      }
    );
    if (Array.isArray(item.rows)) {
      copy.rows = item.rows.map((row, index) => normalizeRuleRow({ ...row, id: nextRowId(), lineIds: {} }, index));
      copy.sort_order = item.sort_order;
      return copy;
    }
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
      w.all = true;
    }
    item.weekdays = w;
    return item;
  }

  window.LinksPriceSetFeeModel = {
    WEEKDAY_CODES,
    WEEKDAY_LABELS,
    ITEM_TYPES,
    emptyWeekdays,
    emptyCell,
    defaultPriceTypeCodes,
    normalizeItem,
    defaultFeeItemTemplates,
    hydrateFeeItems,
    itemsToLines,
    feeItemsForExtraData,
    duplicateFeeItem,
    applyWeekdayPreset,
    cellHasValue,
    nextItemId,
    nextRowId,
    normalizeRuleRow,
    blankRuleRow,
    ensureRowsModel,
  };
})();
