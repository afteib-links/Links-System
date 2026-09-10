// Test double: only the control-table SQL used by the verification draft API.
function createStore() {
  const rows = new Map();
  return async (sql, p = []) => {
    if (sql.startsWith('INSERT')) { rows.set(p[0], { draft_id:p[0], revision:1, payload_json:p[1], approved_hash:null }); return { affectedRows:1 }; }
    if (sql.startsWith('SELECT *')) return rows.has(p[0]) ? [structuredClone(rows.get(p[0]))] : [];
    if (sql.startsWith('SELECT draft_id')) return [...rows.values()];
    if (sql.startsWith('UPDATE')) {
      const row = rows.get(p[1]); if (!row || row.revision !== p[2]) return { affectedRows:0 };
      if (sql.includes('payload_json =')) { row.payload_json = p[0]; row.revision++; row.approved_hash = null; }
      else row.approved_hash = p[0];
      return { affectedRows:1 };
    }
    throw new Error('Unexpected SQL in draft API test');
  };
}
module.exports = { createStore };
