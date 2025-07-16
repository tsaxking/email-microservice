// index.js
const { config } = require('dotenv');
const { z } = require('zod');
const { randomUUID } = require('crypto');
const sgMail = require('@sendgrid/mail');
const redis = require('redis');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const express = require('express');

config();

sgMail.setApiKey(process.env.SENDGRID_API_KEY);


const requiredEnvVars = [
  'SENDGRID_API_KEY',
  'SENDGRID_FROM_EMAIL',
  'REDIS_NAME',
  'PROXY_DOMAIN',
  'SERVER_PORT'
];

for (const varName of requiredEnvVars) {
  if (!process.env[varName]) {
    throw new Error(`Missing required environment variable: ${varName}`);
  }
}

const DB_PATH = './tracker.db';
let db;

/** Set up SQLite and tracked_links table */
const initDb = async () => {
  db = await open({ filename: DB_PATH, driver: sqlite3.Database });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS tracked_links (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      clicks INTEGER DEFAULT 0
    );
  `);
};

/** Replaces URLs in HTML with tracked redirect links */
const trackLinks = async (html) => {
  const urlRegex = /https?:\/\/[^\s"'<>]+/g;

  const matches = [...html.matchAll(urlRegex)];

  for (const match of matches) {
    const originalUrl = match[0];
    const id = randomUUID();

    await db.run(
      'INSERT INTO tracked_links (id, url, clicks) VALUES (?, ?, 0)',
      id,
      originalUrl
    );

    const trackedUrl = `https://${process.env.PROXY_DOMAIN}/r/${id}`;
    html = html.replaceAll(originalUrl, trackedUrl);
  }

  return html;
};

/** Sends an email, with optional tracked HTML links */
const sendEmail = async (message) => {
  const parsed = z.object({
    to: z.email(),
    subject: z.string().min(1),
    text: z.string().min(1),
    html: z.string().optional()
  }).safeParse(message);

  if (!parsed.success) {
    return {
      success: false,
      message: 'Invalid email message format',
      errors: parsed.error.errors,
    };
  }

  const emailData = parsed.data;

  if (emailData.html) {
    emailData.html = await trackLinks(emailData.html);
  }

  try {
    await sgMail.send({
      ...emailData,
      from: process.env.SENDGRID_FROM_EMAIL || '',
    });

    return {
      success: true,
      message: 'Email sent successfully',
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to send email: ${error.message}`,
    };
  }
};

/** Runs the Redis queue worker */
const startWorker = async () => {
  const client = redis.createClient();
  await client.connect();

  const queueKey = process.env.REDIS_NAME || 'email_queue';
  console.log(`Listening to Redis queue "${queueKey}"`);

  while (true) {
    try {
      const res = await client.brPop(queueKey, 0);
      const job = res?.element;
      if (!job) continue;

      let data;
      try {
        data = JSON.parse(job);
      } catch (err) {
        console.error('Invalid JSON in job:', err);
        continue;
      }

      const result = await sendEmail(data);

      if (result.success) {
        console.log('✔', result.message);
      } else {
        console.error('✘', result.message);
      }
    } catch (err) {
      console.error('Redis error:', err);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
};

/** Starts the Express redirect tracker server */
const startServer = () => {
  const app = express();

  app.get('/r/:id', async (req, res) => {
    const { id } = req.params;
    const row = await db.get('SELECT url, clicks FROM tracked_links WHERE id = ?', id);

    if (!row) return res.status(404).send('Link not found');

    await db.run('UPDATE tracked_links SET clicks = ? WHERE id = ?', row.clicks + 1, id);
    res.redirect(row.url);
  });

  const PORT = process.env.SERVER_PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Tracker server running at http://localhost:${PORT}`);
  });
};

/** Boot everything */
const main = async () => {
  await initDb();
  startServer();
  startWorker();
};

main().catch(console.error);
