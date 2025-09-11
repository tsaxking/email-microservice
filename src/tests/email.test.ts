import { config } from 'dotenv';
import { createClient } from 'redis';
import { sleep } from 'ts-utils/sleep';
import { v4 as uuidv4 } from 'uuid';
import { describe, it, expect, beforeAll } from 'vitest';
import { runTs } from '../utils/task';
import { Emails } from '../structs/emails';
import { Struct } from 'drizzle-struct/back-end';
import { DB } from '../db';
config();

describe('Email server integration', () => {
  beforeAll(async () => {
    // console.log('Starting email server...');
    // runTs('src/index.ts', 'main');
    // await sleep(5000);

    await Struct.buildAll(DB).unwrap();
  });


  it('Should send a test email', async () => {
    const testEmail = process.env.TEST_EMAIL_RECIPIENT;
    if (!testEmail) {
      throw new Error('TEST_EMAIL_RECIPIENT environment variable is not set');
    }

    await Emails.send({
      to: testEmail,
      subject: 'Test Email',
      text: 'This is a test email from the email microservice.',
      id: uuidv4(),
    }).unwrap();
  });
});
