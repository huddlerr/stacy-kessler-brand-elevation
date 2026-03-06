const Airtable = require('airtable');

function validateRegistration(body) {
  const errors = [];
  const required = ['name', 'email', 'height', 'experience', 'captain', 'threePoint', 'shirtSize', 'referral'];
  for (const field of required) {
    if (!body[field] || !String(body[field]).trim()) {
      errors.push(`${field} is required`);
    }
  }
  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    errors.push('Invalid email address');
  }
  if (body.captain && !['Yes', 'No'].includes(body.captain)) {
    errors.push('Captain must be Yes or No');
  }
  if (body.threePoint && !['Yes', 'No'].includes(body.threePoint)) {
    errors.push('3pt Contest must be Yes or No');
  }
  const validSizes = ['S', 'M', 'L', 'XL', '2XL', '3XL'];
  if (body.shirtSize && !validSizes.includes(body.shirtSize)) {
    errors.push('Invalid shirt size');
  }
  return errors;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const base = new Airtable({ apiKey: process.env.AIRTABLE_PAT }).base(
      process.env.AIRTABLE_BASE_ID
    );
    const table = base(process.env.AIRTABLE_TABLE_NAME || 'Tournament Registrations');

    const body = req.body;
    const errors = validateRegistration(body);
    if (errors.length) {
      return res.status(400).json({ error: errors.join(', ') });
    }

    const fields = {
      'Name': body.name.trim(),
      'Email': body.email.trim(),
      'Height': body.height.trim(),
      'Experience': body.experience.trim(),
      'Captain': body.captain,
      '3pt Contest': body.threePoint,
      'Shirt Size': body.shirtSize,
      'Referral': body.referral.trim(),
    };

    const record = await table.create(fields);

    res.status(201).json({
      success: true,
      id: record.getId(),
      message: 'Registration confirmed!'
    });
  } catch (err) {
    console.error('Registration error:', err.message);
    if (err.statusCode === 422) {
      return res.status(422).json({ error: 'Invalid data — check your fields match Airtable schema' });
    }
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
};
