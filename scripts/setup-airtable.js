#!/usr/bin/env node
/**
 * Airtable Table Setup Script
 *
 * Creates the "Tournament Registrations" table with the correct schema.
 * Uses the Airtable Web API (Metadata API) to create the table programmatically.
 *
 * Prerequisites:
 *   1. Create a Personal Access Token at https://airtable.com/create/tokens
 *      - Scopes: schema.bases:read, schema.bases:write, data.records:read, data.records:write
 *   2. Copy .env.example to .env and fill in your PAT and Base ID
 *   3. Run: node scripts/setup-airtable.js
 */

require('dotenv').config();

const PAT = process.env.AIRTABLE_PAT;
const BASE_ID = process.env.AIRTABLE_BASE_ID;

if (!PAT || PAT.startsWith('pat_YOUR') || !BASE_ID || BASE_ID.startsWith('app_YOUR')) {
  console.error('\n  ✗ Missing Airtable credentials.');
  console.error('  Copy .env.example → .env and fill in AIRTABLE_PAT and AIRTABLE_BASE_ID\n');
  process.exit(1);
}

const TABLE_SCHEMA = {
  name: process.env.AIRTABLE_TABLE_NAME || 'Tournament Registrations',
  fields: [
    { name: 'Name', type: 'singleLineText' },
    { name: 'Email', type: 'email' },
    { name: 'Height', type: 'singleLineText' },
    { name: 'Experience', type: 'multilineText' },
    {
      name: 'Captain',
      type: 'singleSelect',
      options: {
        choices: [
          { name: 'Yes', color: 'greenLight2' },
          { name: 'No', color: 'grayLight2' },
        ],
      },
    },
    {
      name: '3pt Contest',
      type: 'singleSelect',
      options: {
        choices: [
          { name: 'Yes', color: 'orangeLight2' },
          { name: 'No', color: 'grayLight2' },
        ],
      },
    },
    {
      name: 'Shirt Size',
      type: 'singleSelect',
      options: {
        choices: [
          { name: 'S', color: 'blueLight2' },
          { name: 'M', color: 'cyanLight2' },
          { name: 'L', color: 'tealLight2' },
          { name: 'XL', color: 'greenLight2' },
          { name: '2XL', color: 'yellowLight2' },
          { name: '3XL', color: 'orangeLight2' },
        ],
      },
    },
    { name: 'Referral', type: 'singleLineText' },
    { name: 'Photo', type: 'multipleAttachments' },
    { name: 'Registered At', type: 'dateTime', options: { timeZone: 'America/New_York', dateFormat: { name: 'us' }, timeFormat: { name: '12hour' } } },
  ],
};

async function createTable() {
  console.log('\n  🏀 AVL Hoops — Airtable Setup');
  console.log('  ─────────────────────────────\n');

  const url = `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PAT}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(TABLE_SCHEMA),
  });

  if (res.ok) {
    const data = await res.json();
    console.log(`  ✓ Table "${data.name}" created successfully!`);
    console.log(`  ✓ Table ID: ${data.id}`);
    console.log(`  ✓ Fields: ${data.fields.map(f => f.name).join(', ')}`);
    console.log('\n  Your tournament registration backend is ready.\n');
  } else {
    const err = await res.json();
    if (err.error?.type === 'DUPLICATE_TABLE_NAME') {
      console.log('  ✓ Table already exists — you\'re all set!\n');
    } else {
      console.error('  ✗ Failed to create table:', err.error?.message || JSON.stringify(err));
      console.error('  Make sure your PAT has schema.bases:write scope.\n');
      process.exit(1);
    }
  }
}

createTable().catch(err => {
  console.error('  ✗ Error:', err.message);
  process.exit(1);
});
