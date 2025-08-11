import { config } from 'dotenv';
import { createClient } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import { describe, it, expect } from 'vitest';

config();

describe('Email server integration', () => {
  it(
    'should send a test email via Redis queue and receive success status',
    async () => {
      const redisClient = createClient();
      await redisClient.connect();

      const subscriber = redisClient.duplicate();
      await subscriber.connect();

      const queueKey = process.env.REDIS_NAME;
      if (!queueKey) throw new Error('Missing REDIS_NAME env var');

      const statusChannel = `${queueKey}:status`;
      const emailId = uuidv4();

      const testJob = {
        id: emailId,
        to: process.env.SENDGRID_FROM_EMAIL!, // or any test recipient
        subject: 'Test Email via Redis Queue with Status',
        text: 'This is a test email sent via the Redis queue system with status reporting.',
        html: `<p>This is a <strong>test email</strong> sent via the Redis queue system.</p>
               <p>Check link tracking: <a href="https://example.com">example.com</a></p>`,
      };

      const result = await new Promise<'success' | 'failure'>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout: did not receive status update within expected time'));
        }, 30000);

        subscriber.subscribe(statusChannel, (message) => {
          try {
            const statusMsg = JSON.parse(message);
            if (statusMsg.id === emailId) {
              clearTimeout(timeout);
              resolve(statusMsg.status);
            }
          } catch (err) {
            clearTimeout(timeout);
            reject(err);
          }
        });

        redisClient.lPush(queueKey, JSON.stringify(testJob)).catch((err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      expect(result).toBe('success');

      await subscriber.quit();
      await redisClient.quit();
    },
    { timeout: 35000 } // Vitest's own test timeout
  );
});
