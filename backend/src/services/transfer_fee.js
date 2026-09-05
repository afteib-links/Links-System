function resolveTransferFee(projectPattern, partnerPattern) {
  const selected = projectPattern || partnerPattern || null;
  if (!selected) {
    return { patternId: null, patternName: null, amount: 0, source: 'none' };
  }
  return {
    patternId: Number(selected.transfer_fee_pattern_id),
    patternName: String(selected.pattern_name || ''),
    amount: Number(selected.amount || 0),
    source: projectPattern ? 'project' : 'partner',
  };
}

module.exports = { resolveTransferFee };
