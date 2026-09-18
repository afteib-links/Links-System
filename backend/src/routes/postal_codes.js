const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { lookupPostalCode } = require('../services/postal_code');

const router = express.Router();
router.use(requireAuth);

router.get('/:postalCode', async (req, res) => {
  try {
    const addresses = await lookupPostalCode(req.params.postalCode);
    if (!addresses.length) {
      return res.status(404).json({ ok: false, message: '該当する住所が見つかりませんでした' });
    }
    return res.json({ ok: true, addresses });
  } catch (error) {
    const status = Number(error.statusCode) || 502;
    console.error('[postal-code/lookup]', error);
    return res.status(status).json({
      ok: false,
      message: status === 400 ? error.message : '住所を取得できませんでした。住所は手入力できます',
    });
  }
});

module.exports = router;
