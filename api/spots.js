const Airtable = require('airtable');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const base = new Airtable({ apiKey: process.env.AIRTABLE_PAT }).base(
      process.env.AIRTABLE_BASE_ID
    );
    const table = base(process.env.AIRTABLE_TABLE_NAME || 'Tournament Registrations');

    const records = await table.select({
      fields: ['Name'],
      pageSize: 100,
    }).firstPage();

    const total = 64;
    const registered = records.length;
    const remaining = Math.max(0, total - registered);

    res.json({ total, registered, remaining, spotsOpen: remaining > 0 });
  } catch (err) {
    console.error('Spots check error:', err.message);
    res.json({ total: 64, registered: 0, remaining: 64, spotsOpen: true });
  }
};
