#!/usr/bin/env node
/**
 * Airtable Setup — AVL Hoops Tournament
 *
 * This script:
 *   1. Lists your Airtable bases so you can pick one (or creates a new one)
 *   2. Creates the "Tournament Registrations" table with the correct schema
 *   3. Writes the Base ID back to .env so the server is ready to go
 *
 * Usage:
 *   node scripts/setup-airtable.js
 *   node scripts/setup-airtable.js --base appXXXXXXXX   (skip base selection)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const PAT = process.env.AIRTABLE_PAT;
const HEADERS = {
  'Authorization': `Bearer ${PAT}`,
  'Content-Type': 'application/json',
};

if (!PAT || PAT.includes('YOUR')) {
  console.error('\n  ✗ Set AIRTABLE_PAT in .env first.\n');
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
    {
      name: 'Registered At',
      type: 'dateTime',
      options: {
        timeZone: 'America/New_York',
        dateFormat: { name: 'us' },
        timeFormat: { name: '12hour' },
      },
    },
  ],
};

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

function updateEnvFile(baseId) {
  const envPath = path.join(__dirname, '..', '.env');
  let content = fs.readFileSync(envPath, 'utf8');
  content = content.replace(/^AIRTABLE_BASE_ID=.*$/m, `AIRTABLE_BASE_ID=${baseId}`);
  fs.writeFileSync(envPath, content);
  console.log(`  ✓ .env updated with AIRTABLE_BASE_ID=${baseId}`);
}

async function listBases() {
  const res = await fetch('https://api.airtable.com/v0/meta/bases', { headers: HEADERS });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${res.status}`);
  }
  const data = await res.json();
  return data.bases || [];
}

async function createTable(baseId) {
  const url = `https://api.airtable.com/v0/meta/bases/${baseId}/tables`;
  const res = await fetch(url, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(TABLE_SCHEMA),
  });

  if (res.ok) {
    const data = await res.json();
    return { created: true, table: data };
  }

  const err = await res.json().catch(() => ({}));
  if (err.error?.type === 'DUPLICATE_TABLE_NAME') {
    return { created: false, exists: true };
  }
  throw new Error(err.error?.message || `Failed to create table (${res.status})`);
}

async function main() {
  console.log('\n  🏀 AVL Hoops — Airtable Setup');
  console.log('  ─────────────────────────────\n');

  // Check for --base flag
  const flagIdx = process.argv.indexOf('--base');
  let baseId = flagIdx !== -1 ? process.argv[flagIdx + 1] : process.env.AIRTABLE_BASE_ID;

  if (!baseId) {
    // List bases and let user pick
    console.log('  Fetching your Airtable bases...\n');
    const bases = await listBases();

    if (bases.length === 0) {
      console.log('  No bases found. Create one at https://airtable.com/create and re-run.\n');
      process.exit(1);
    }

    bases.forEach((b, i) => {
      console.log(`    [${i + 1}] ${b.name}  (${b.id})`);
    });
    console.log(`    [N] Create a new base\n`);

    const choice = await ask('  Which base? Enter number or N: ');

    if (choice.toUpperCase() === 'N') {
      console.log('\n  → Create a new base at https://airtable.com/create');
      console.log('  → Then re-run: node scripts/setup-airtable.js --base appYOUR_BASE_ID\n');
      process.exit(0);
    }

    const idx = parseInt(choice, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= bases.length) {
      console.error('  ✗ Invalid choice.\n');
      process.exit(1);
    }

    baseId = bases[idx].id;
    console.log(`\n  Selected: ${bases[idx].name} (${baseId})`);
  }

  // Save to .env
  updateEnvFile(baseId);

  // Create the table
  console.log(`\n  Creating "${TABLE_SCHEMA.name}" table...`);
  const result = await createTable(baseId);

  if (result.exists) {
    console.log('  ✓ Table already exists — you\'re all set!');
  } else {
    console.log(`  ✓ Table created! ID: ${result.table.id}`);
    console.log(`  ✓ Fields: ${result.table.fields.map(f => f.name).join(', ')}`);
  }

  console.log('\n  ──────────────────────────────');
  console.log('  Ready! Start the server with:');
  console.log('    npm start');
  console.log(`    → http://localhost:${process.env.PORT || 3000}/tournament\n`);
}

main().catch(err => {
  console.error(`\n  ✗ ${err.message}`);
  if (err.message.includes('scope')) {
    console.error('  Make sure your PAT has these scopes:');
    console.error('    data.records:read, data.records:write, schema.bases:read, schema.bases:write\n');
  }
  process.exit(1);
});
