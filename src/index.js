const { z } = require('zod');
const sgMail = require('@sendgrid/mail');
const { config } = require('dotenv');
const redis = require('redis');

config();
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const sendEmail = async (message) => {
  const parsed = z.object({
    to: z.string().email(),
    from: z.string().email(),
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

  try {
    await sgMail.send(parsed.data);
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

const main = async () => {
  const client = redis.createClient();

  client.on('error', (err) => {
    console.error('Redis Client Error', err);
  });

  await client.connect();

  const queueKey = process.env.REDIS_NAME || 'email_queue';

  console.log(`Waiting for email jobs on Redis queue "${queueKey}"...`);

  while (true) {
    try {
      // BRPOP blocks until an item is available in the list
      // It returns [key, value] when an item is popped
      const res = await client.brPop(queueKey, 0);
      const messageStr = res.element; // The popped message string

      let emailData;
      try {
        emailData = JSON.parse(messageStr);
      } catch (e) {
        console.error('Failed to parse queued message JSON:', e);
        continue; // Skip invalid message
      }

      const result = await sendEmail(emailData);

      if (result.success) {
        console.log('Email sent successfully');
      } else {
        console.error('Email sending failed:', result.message, result.errors || '');
        // Here you can decide to push the message back to queue for retry if needed
      }

    } catch (err) {
      console.error('Error processing email queue:', err);
      // Optional: wait a bit before retrying to avoid tight error loops
      await new Promise(res => setTimeout(res, 1000));
    }
  }
};

main().catch(console.error);
