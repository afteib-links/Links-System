const { query } = require('../db');

const OPEN_END = '9999-12-31';
const OPEN_START = '1900-01-01';

function normDate(d) {
  if (!d) return null;
  const s = String(d).slice(0, 10);
  return s || null;
}

function periodEnd(d) {
  return normDate(d) || OPEN_END;
}

function periodStart(d) {
  return normDate(d) || OPEN_START;
}

function periodsOverlap(startA, endA, startB, endB) {
  const a1 = periodStart(startA);
  const a2 = periodEnd(endA);
  const b1 = periodStart(startB);
  const b2 = periodEnd(endB);
  return a1 <= b2 && b1 <= a2;
}

function assertOwnerExclusive(data) {
  const baseId = data.base_project_id ? Number(data.base_project_id) : null;
  const projectId = data.project_id ? Number(data.project_id) : null;
  if (baseId && projectId) {
    const err = new Error('基本案件と個別案件の両方には紐付けできません');
    err.status = 400;
    err.code = 'validation_error';
    throw err;
  }
  if (!baseId && !projectId && data.require_owner) {
    const err = new Error('基本案件または個別案件の紐付けが必要です');
    err.status = 400;
    err.code = 'validation_error';
    throw err;
  }
}

async function findOverlappingPriceSet(owner, start, end, excludeId, conn = null) {
  const params = [];
  let ownerClause = '';
  if (owner.base_project_id) {
    ownerClause = 'base_project_id = ? AND project_id IS NULL';
    params.push(Number(owner.base_project_id));
  } else if (owner.project_id) {
    ownerClause = 'project_id = ? AND base_project_id IS NULL';
    params.push(Number(owner.project_id));
  } else {
    return null;
  }
  if (excludeId) {
    ownerClause += ' AND price_set_id <> ?';
    params.push(Number(excludeId));
  }
  const sql = `SELECT price_set_id, apply_start_date, apply_end_date, price_set_name
     FROM price_sets
     WHERE is_deleted = 0 AND ${ownerClause}`;
  let list;
  if (conn) {
    const [rows] = await conn.query(sql, params);
    list = rows;
  } else {
    list = await query(sql, params);
  }
  for (const row of list) {
    if (periodsOverlap(start, end, row.apply_start_date, row.apply_end_date)) {
      return row;
    }
  }
  return null;
}

async function validateNoOverlappingPeriods(owner, start, end, excludeId, conn = null) {
  const hit = await findOverlappingPriceSet(owner, start, end, excludeId, conn);
  if (hit) {
    const err = new Error(
      `適用期間が重複しています（既存: ${hit.price_set_name || hit.price_set_id}）`
    );
    err.status = 400;
    err.code = 'validation_error';
    throw err;
  }
}

async function listPriceSetsForBase(baseProjectId) {
  return query(
    `SELECT ps.*,
            (SELECT COUNT(*) FROM price_set_lines l
             WHERE l.price_set_id = ps.price_set_id AND l.is_deleted = 0) AS line_count
     FROM price_sets ps
     WHERE ps.is_deleted = 0 AND ps.base_project_id = ? AND ps.project_id IS NULL
     ORDER BY ps.apply_start_date ASC, ps.price_set_id ASC`,
    [Number(baseProjectId)]
  );
}

async function listPriceSetsForProject(projectId) {
  return query(
    `SELECT ps.*,
            (SELECT COUNT(*) FROM price_set_lines l
             WHERE l.price_set_id = ps.price_set_id AND l.is_deleted = 0) AS line_count
     FROM price_sets ps
     WHERE ps.is_deleted = 0 AND ps.project_id = ? AND ps.base_project_id IS NULL
     ORDER BY ps.apply_start_date ASC, ps.price_set_id ASC`,
    [Number(projectId)]
  );
}

async function softDeletePriceSetsForBase(baseProjectId, conn) {
  const exec = conn.query.bind(conn);
  const [sets] = await exec(
    `SELECT price_set_id FROM price_sets
     WHERE base_project_id = ? AND is_deleted = 0`,
    [Number(baseProjectId)]
  );
  for (const row of sets) {
    await exec(
      `UPDATE price_set_lines SET is_deleted = 1, version = version + 1
       WHERE price_set_id = ? AND is_deleted = 0`,
      [row.price_set_id]
    );
    await exec(
      `UPDATE price_sets SET is_deleted = 1, version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE price_set_id = ?`,
      [row.price_set_id]
    );
  }
}

async function softDeletePriceSetsForProject(projectId, conn) {
  const exec = conn.query.bind(conn);
  const [sets] = await exec(
    `SELECT price_set_id FROM price_sets
     WHERE project_id = ? AND is_deleted = 0`,
    [Number(projectId)]
  );
  for (const row of sets) {
    await exec(
      `UPDATE price_set_lines SET is_deleted = 1, version = version + 1
       WHERE price_set_id = ? AND is_deleted = 0`,
      [row.price_set_id]
    );
    await exec(
      `UPDATE price_sets SET is_deleted = 1, version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE price_set_id = ?`,
      [row.price_set_id]
    );
  }
}

async function allocatePriceSetNo(conn) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `PS-${today}-`;
  const [rows] = await conn.query(
    `SELECT price_set_no FROM price_sets
     WHERE price_set_no LIKE ? AND is_deleted = 0
     ORDER BY price_set_no DESC LIMIT 1`,
    [`${prefix}%`]
  );
  let next = 1;
  if (rows.length && rows[0].price_set_no) {
    const suffix = String(rows[0].price_set_no).slice(prefix.length);
    const n = Number(suffix);
    if (Number.isFinite(n)) next = n + 1;
  }
  return `${prefix}${String(next).padStart(3, '0')}`;
}

function assertValidFromRequired(applyStartDate) {
  if (!normDate(applyStartDate)) {
    const err = new Error('適用開始日（validFrom）は必須です');
    err.status = 400;
    err.code = 'validation_error';
    throw err;
  }
}

async function copyLines(conn, fromSetId, toSetId) {
  const [lines] = await conn.query(
    `SELECT weekday_code, calc_type_code, price_type_code,
            billing_unit_price, payment_unit_price, sort_order
     FROM price_set_lines
     WHERE price_set_id = ? AND is_deleted = 0
     ORDER BY sort_order ASC, price_set_line_id ASC`,
    [fromSetId]
  );
  for (const line of lines) {
    await conn.query(
      `INSERT INTO price_set_lines
        (price_set_id, weekday_code, calc_type_code, price_type_code,
         billing_unit_price, payment_unit_price, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        toSetId,
        line.weekday_code,
        line.calc_type_code,
        line.price_type_code,
        line.billing_unit_price,
        line.payment_unit_price,
        line.sort_order,
      ]
    );
  }
}

async function deepCopyPriceSets(conn, source, dest) {
  const fromBase = source.base_project_id != null;
  const [sets] = await conn.query(
    fromBase
      ? `SELECT * FROM price_sets
         WHERE base_project_id = ? AND is_deleted = 0 AND project_id IS NULL
         ORDER BY price_set_id ASC`
      : `SELECT * FROM price_sets
         WHERE project_id = ? AND is_deleted = 0 AND base_project_id IS NULL
         ORDER BY price_set_id ASC`,
    [Number(fromBase ? source.base_project_id : source.project_id)]
  );
  let copied = 0;
  for (const src of sets) {
    const priceSetNo = await allocatePriceSetNo(conn);
    const [result] = await conn.query(
      `INSERT INTO price_sets
        (price_set_no, price_set_name, company_id, base_project_id, project_id,
         apply_start_date, apply_end_date, note, extra_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        priceSetNo,
        src.price_set_name,
        dest.company_id != null ? Number(dest.company_id) : src.company_id,
        dest.base_project_id != null ? Number(dest.base_project_id) : null,
        dest.project_id != null ? Number(dest.project_id) : null,
        src.apply_start_date,
        src.apply_end_date,
        src.note,
        src.extra_data
          ? typeof src.extra_data === 'string'
            ? src.extra_data
            : JSON.stringify(src.extra_data)
          : null,
      ]
    );
    await copyLines(conn, src.price_set_id, result.insertId);
    copied += 1;
  }
  return copied;
}

async function deepCopyPriceSetsFromBaseToProject(baseProjectId, projectId, conn) {
  return deepCopyPriceSets(conn, { base_project_id: baseProjectId }, { project_id: projectId });
}

module.exports = {
  assertOwnerExclusive,
  assertValidFromRequired,
  validateNoOverlappingPeriods,
  listPriceSetsForBase,
  listPriceSetsForProject,
  softDeletePriceSetsForBase,
  softDeletePriceSetsForProject,
  deepCopyPriceSets,
  deepCopyPriceSetsFromBaseToProject,
  allocatePriceSetNo,
  periodsOverlap,
};
