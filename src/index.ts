import { config } from 'dotenv';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import sgMail from '@sendgrid/mail';
import { createClient } from 'redis';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import express, { Request, Response } from 'express';

config();

sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');

const requiredEnvVars = [
  'SENDGRID_API_KEY',
  'SENDGRID_FROM_EMAIL',
  'REDIS_NAME',
  'PROXY_DOMAIN',
  'SERVER_PORT',
] as const;

for (const varName of requiredEnvVars) {
  if (!process.env[varName]) {
    throw new Error(`Missing required environment variable: ${varName}`);
  }
}

const DB_PATH = './tracker.db';
let db: Database<sqlite3.Database, sqlite3.Statement>;

const initDb = async () => {
  db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS tracked_links (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      clicks INTEGER DEFAULT 0
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS emails (
      id TEXT PRIMARY KEY,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      text TEXT NOT NULL,
      html TEXT,
      created_at INTEGER NOT NULL
    );
  `);
};

const trackLinks = async (html: string): Promise<string> => {
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

export type EmailMessage = {
  id: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
};


const sendEmail = async (message: EmailMessage) => {
  const schema = z.object({
    id: z.uuidv4(),
    to: z.email(),
    subject: z.string().min(1),
    text: z.string().min(1),
    html: z.string().optional(),
  });

  const parsed = schema.safeParse(message);

  if (!parsed.success) {
    return {
      success: false,
      message: 'Invalid email message format',
      errors: parsed.error.issues,
    };
  }

  let emailData = parsed.data;


  if (emailData.html) {
    emailData.html = await trackLinks(emailData.html);
  }

  // Save email to DB
  try {
    await db.run(
      `INSERT INTO emails (id, to_email, subject, text, html, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      emailData.id,
      emailData.to,
      emailData.subject,
      emailData.text,
      emailData.html || null,
      Date.now()
    );
  } catch (err) {
    console.error('Failed to save email to DB:', err);
    // You can decide whether to continue or fail here
  }

  try {
    await sgMail.send({
      ...emailData,
      from: process.env.SENDGRID_FROM_EMAIL!,
    });

    // Publish success status to Redis
    await client?.publish(
      process.env.REDIS_NAME! + ':status',
      JSON.stringify({
        id: emailData.id,
        status: 'success',
      })
    );

    return {
      success: true,
      message: 'Email sent successfully',
      id: emailData.id,
    };
  } catch (error: any) {
    // Publish failure status to Redis
    await client?.publish(
      process.env.REDIS_NAME! + ':status',
      JSON.stringify({
        id: emailData.id,
        status: 'failure',
        error: error.message,
      })
    );

    return {
      success: false,
      message: `Failed to send email: ${error.message}`,
      id: emailData.id,
    };
  }
};

let client: ReturnType<typeof createClient> | null = null;

const startWorker = async () => {
  client = createClient();
  await client.connect();

  const queueKey = process.env.REDIS_NAME!;
  console.log(`Listening to Redis queue "${queueKey}"`);

  while (true) {
    try {
      const res = await client.brPop(queueKey, 0);
      const job = res?.element;
      if (!job) continue;

      let data: unknown;
      try {
        data = JSON.parse(job);
      } catch (err) {
        console.error('Invalid JSON in job:', err);
        continue;
      }

      const result = await sendEmail(data as EmailMessage);

      if (result.success) {
        console.log('✔', result.message);
      } else {
        console.error('✘', result.message);
      }
    } catch (err) {
      console.error('Redis error:', err);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
};

const startServer = () => {
  const app = express();

  app.get('/r/:id', async (req: Request, res: Response) => {
    const { id } = req.params;
    const row = await db.get<{ url: string; clicks: number }>(
      'SELECT url, clicks FROM tracked_links WHERE id = ?',
      id
    );

    if (!row) return res.status(404).send('Link not found');

    await db.run(
      'UPDATE tracked_links SET clicks = ? WHERE id = ?',
      row.clicks + 1,
      id
    );
    res.redirect(row.url);
  });

  const PORT = parseInt(process.env.SERVER_PORT || '3000', 10);
  app.listen(PORT, () => {
    console.log(`Tracker server running at http://localhost:${PORT}`);
  });
};

const main = async () => {
  await initDb();
  startServer();
  startWorker();
};

main().catch(console.error);
