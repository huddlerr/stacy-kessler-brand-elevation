require('dotenv').config();
const express = require('express');
const Airtable = require('airtable');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const { RateLimiterMemory } = require('rate-limiter-flexible');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Rate limiter: 5 registrations per IP per hour
const rateLimiter = new RateLimiterMemory({
  points: 5,
  duration: 3600,
});

// Multer for photo uploads (10MB max, images only)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

// --- Airtable Setup ---
const base = new Airtable({ apiKey: process.env.AIRTABLE_PAT }).base(
  process.env.AIRTABLE_BASE_ID
);
const table = base(process.env.AIRTABLE_TABLE_NAME || 'Tournament Registrations');

// --- Validation ---
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

// ============================================================
// POST /api/register — Create registration in Airtable
// ============================================================
app.post('/api/register', upload.single('photo'), async (req, res) => {
  try {
    // Rate limit
    await rateLimiter.consume(req.ip);
  } catch {
    return res.status(429).json({ error: 'Too many registrations. Try again later.' });
  }

  try {
    const body = req.body;
    const errors = validateRegistration(body);
    if (errors.length) {
      return res.status(400).json({ error: errors.join(', ') });
    }

    // Build Airtable record
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

    // Photo: Airtable attachments require a public URL.
    // For file uploads, you'd upload to S3/Cloudinary first,
    // then pass the URL to Airtable's attachment field:
    //
    //   if (req.file) {
    //     const photoUrl = await uploadToCloudinary(req.file.buffer);
    //     fields['Photo'] = [{ url: photoUrl }];
    //   }

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
});

// ============================================================
// GET /api/spots — Check remaining spots (8 teams max)
// ============================================================
app.get('/api/spots', async (req, res) => {
  try {
    const records = await table.select({
      fields: ['Name'],
      pageSize: 100,
    }).firstPage();

    const total = 64; // 8 teams × 8 players
    const registered = records.length;
    const remaining = Math.max(0, total - registered);

    res.json({
      total,
      registered,
      remaining,
      spotsOpen: remaining > 0,
    });
  } catch (err) {
    console.error('Spots check error:', err.message);
    res.json({ total: 64, registered: 0, remaining: 64, spotsOpen: true });
  }
});

// ============================================================
// GET /api/health — Health check
// ============================================================
app.get('/api/health', (req, res) => {
  const configured = !!(process.env.AIRTABLE_PAT && process.env.AIRTABLE_BASE_ID);
  res.json({
    status: configured ? 'ok' : 'unconfigured',
    airtable: configured,
    timestamp: new Date().toISOString(),
  });
});

// --- Serve pages ---
app.get('/tournament', (req, res) => {
  res.sendFile(path.join(__dirname, 'tournament.html'));
});

app.listen(PORT, () => {
  console.log(`\n  🏀 AVL Hoops Tournament Server`);
  console.log(`  ──────────────────────────────`);
  console.log(`  Local:    http://localhost:${PORT}/tournament`);
  console.log(`  API:      http://localhost:${PORT}/api/health`);
  console.log(`  Airtable: ${process.env.AIRTABLE_PAT ? '✓ configured' : '✗ set AIRTABLE_PAT in .env'}\n`);
});
