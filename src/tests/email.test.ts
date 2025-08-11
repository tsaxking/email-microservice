import { config } from 'dotenv';
import { createClient } from 'redis';
import { v4 as uuidv4 } from 'uuid';

config();

async function main() {
  const redisClient = createClient();
  await redisClient.connect();

  const subscriber = redisClient.duplicate();
  await subscriber.connect();

  const queueKey = process.env.REDIS_NAME!;
  const statusChannel = queueKey + ':status';

  if (!queueKey) {
    console.error('Missing REDIS_NAME env var');
    process.exit(1);
  }

  const emailId = uuidv4();

  const testJob = {
    id: emailId,
    to: process.env.SENDGRID_FROM_EMAIL!, // or any test recipient
    subject: 'Test Email via Redis Queue with Status',
    text: 'This is a test email sent via the Redis queue system with status reporting.',
    html: `<p>This is a <strong>test email</strong> sent via the Redis queue system.</p>
           <p>Check link tracking: <a href="https://example.com">example.com</a></p>`,
  };

  // Listen for status message
  await subscriber.subscribe(statusChannel, (message) => {
    try {
      const statusMsg = JSON.parse(message);
      if (statusMsg.id === emailId) {
        if (statusMsg.status === 'success') {
          console.log('✅ Test email sent successfully!');
          process.exit(0);
        } else {
          console.error('❌ Test email failed:', statusMsg.error || 'Unknown error');
          process.exit(1);
        }
      }
    } catch (err) {
      console.error('Invalid status message:', err);
    }
  });

  // Push the job JSON to the Redis queue (list)
  await redisClient.lPush(queueKey, JSON.stringify(testJob));
  console.log(`Test email job pushed to Redis queue "${queueKey}" with id ${emailId}.`);

  // Add timeout if desired (e.g. fail after 30s)
  setTimeout(() => {
    console.error('❌ Timeout: did not receive status update within expected time');
    process.exit(1);
  }, 30000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
