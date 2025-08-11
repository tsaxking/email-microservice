import { config } from 'dotenv';
import { createClient } from 'redis';
import express, { Request, Response } from 'express';
import { Emails } from './structs/emails';

config();

export type EmailMessage = {
  id: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
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

      const parsed = Emails.parse(job);

      if (parsed.isErr()) {
        console.error('Failed to parse job:', parsed.error);
        continue;
      }

      const result = await Emails.send(parsed.value);

      if (result.isOk()) {
        console.log('✔', result.value);
      } else {
        console.error('✘', result.error);
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
    const id = req.params.id;
    if (!id) {
      return res.status(400).send('Missing id parameter');
    }

    const data = await Emails.TrackedLinks.fromId(id);

    if (data.isErr()) {
      return res.status(404).send('Tracked link not found');
    }

    if (!data.value) {
      return res.status(404).send('Tracked link not found');
    }

    await data.value.update({
      clicks: data.value.data.clicks + 1,
    });

    res.redirect(data.value.data.url);
  });

  const PORT = parseInt(process.env.SERVER_PORT || '3000', 10);
  app.listen(PORT, () => {
    console.log(`Tracker server running at http://localhost:${PORT}`);
  });
};

const main = async () => {
  startServer();
  startWorker();
};

main().catch(console.error);
