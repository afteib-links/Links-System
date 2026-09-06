function yenInteger(value, label) {
  if (value == null || value === '') return 0;
  const number = Number(value);
  if (!Number.isFinite(number) || Math.round(number) !== number) {
    const err = new Error(`${label}は整数円で入力してください`);
    err.status = 400;
    throw err;
  }
  return number;
}

function accountBalance(opening, incoming, outgoing) {
  return Number(opening || 0) + Number(incoming || 0) - Number(outgoing || 0);
}

function mapBalanceRow(row) {
  const opening_balance = Number(row.opening_balance || 0);
  const incoming_total = Number(row.incoming_total || 0);
  const outgoing_total = Number(row.outgoing_total || 0);
  return {
    source_bank_account_id: Number(row.source_bank_account_id),
    account_label: row.account_label,
    bank_name: row.bank_name,
    masked_account_number: row.masked_account_number,
    opening_balance,
    incoming_total,
    outgoing_total,
    balance: accountBalance(opening_balance, incoming_total, outgoing_total),
  };
}

module.exports = { yenInteger, accountBalance, mapBalanceRow };
