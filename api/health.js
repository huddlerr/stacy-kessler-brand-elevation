module.exports = function handler(req, res) {
  const configured = !!(process.env.AIRTABLE_PAT && process.env.AIRTABLE_BASE_ID);
  res.json({
    status: configured ? 'ok' : 'unconfigured',
    airtable: configured,
    timestamp: new Date().toISOString(),
  });
};
