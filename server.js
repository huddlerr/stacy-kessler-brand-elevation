require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Airtable = require('airtable');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const { RateLimiterMemory } = require('rate-limiter-flexible');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
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

app.get('/travel', (req, res) => {
  res.sendFile(path.join(__dirname, 'travel.html'));
});

// ============================================================
// Socket.IO — TravlTeam Real-Time Collaboration
// ============================================================
const trips = new Map(); // tripId -> { pins: [], cursors: {}, users: {} }

function getTrip(tripId) {
  if (!trips.has(tripId)) {
    trips.set(tripId, { pins: [], cursors: {}, users: {} });
  }
  return trips.get(tripId);
}

io.on('connection', (socket) => {
  let currentTrip = null;
  let userName = null;

  socket.on('join-trip', ({ tripId, name, color }) => {
    currentTrip = tripId;
    userName = name;
    socket.join(tripId);

    const trip = getTrip(tripId);
    trip.users[socket.id] = { name, color, id: socket.id };

    // Send existing state to the new user
    socket.emit('trip-state', {
      pins: trip.pins,
      users: Object.values(trip.users),
    });

    // Notify others
    socket.to(tripId).emit('user-joined', trip.users[socket.id]);
    io.to(tripId).emit('users-update', Object.values(trip.users));
  });

  socket.on('add-pin', (pin) => {
    if (!currentTrip) return;
    const trip = getTrip(currentTrip);
    const newPin = { ...pin, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), author: userName };
    trip.pins.push(newPin);
    io.to(currentTrip).emit('pin-added', newPin);
  });

  socket.on('vote-pin', ({ pinId, emoji }) => {
    if (!currentTrip) return;
    const trip = getTrip(currentTrip);
    const pin = trip.pins.find(p => p.id === pinId);
    if (pin) {
      if (!pin.votes) pin.votes = {};
      if (!pin.votes[emoji]) pin.votes[emoji] = [];
      const idx = pin.votes[emoji].indexOf(userName);
      if (idx > -1) pin.votes[emoji].splice(idx, 1);
      else pin.votes[emoji].push(userName);
      io.to(currentTrip).emit('pin-updated', pin);
    }
  });

  socket.on('delete-pin', ({ pinId }) => {
    if (!currentTrip) return;
    const trip = getTrip(currentTrip);
    trip.pins = trip.pins.filter(p => p.id !== pinId);
    io.to(currentTrip).emit('pin-deleted', { pinId });
  });

  socket.on('cursor-move', (pos) => {
    if (!currentTrip) return;
    socket.to(currentTrip).emit('cursor-update', {
      id: socket.id,
      name: userName,
      ...pos,
    });
  });

  socket.on('chat-message', (msg) => {
    if (!currentTrip) return;
    io.to(currentTrip).emit('chat-message', {
      author: userName,
      text: msg.text,
      time: new Date().toISOString(),
    });
  });

  socket.on('disconnect', () => {
    if (currentTrip) {
      const trip = getTrip(currentTrip);
      delete trip.users[socket.id];
      delete trip.cursors[socket.id];
      io.to(currentTrip).emit('users-update', Object.values(trip.users));
      io.to(currentTrip).emit('cursor-remove', { id: socket.id });
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  🏀 AVL Hoops + TravlTeam Server`);
  console.log(`  ──────────────────────────────`);
  console.log(`  Tournament: http://localhost:${PORT}/tournament`);
  console.log(`  TravlTeam:  http://localhost:${PORT}/travel`);
  console.log(`  API:        http://localhost:${PORT}/api/health`);
  console.log(`  Airtable:   ${process.env.AIRTABLE_PAT ? '✓ configured' : '✗ set AIRTABLE_PAT in .env'}\n`);
});
