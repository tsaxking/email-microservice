import { config } from 'dotenv';
import express, { Request, Response } from 'express';
import { Emails } from './structs/emails';
import { Struct } from 'drizzle-struct/back-end';
import { DB } from './db';
import redis from './services/redis';
import z from 'zod';
import { sleep } from 'ts-utils/sleep';
import { uuid } from './services/uuid';
import { ComplexEventEmitter } from 'ts-utils/event-emitter';

config();

const eventEmitter = new ComplexEventEmitter<{
	email: void;
	error: [Error];
}>();

export const on = eventEmitter.on.bind(eventEmitter);

export type EmailMessage = {
	id: string;
	to: string;
	subject: string;
	text: string;
	html?: string;
};

export const init = async () => {
	await Struct.buildAll(DB);
	await redis.init(1000);
};

type RedisEmail = {
	html?: string;
	text?: string;
	to: string | string[];
	subject: string;
	attachments?: { filename: string; path: string }[];
}

export const startWorker = () => {
	const queue = redis.createQueue<RedisEmail>(
		'email',
		z.object({
			html: z.string().optional(),
			text: z.string().optional(),
			to: z.union([z.string(), z.array(z.string())]),
			subject: z.union([z.string(), z.array(z.string())]),
			attachments: z
				.array(
					z.object({
						filename: z.string(),
						path: z.string(), // full path
					})
				)
				.optional(),
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		}) as any,
		Number(process.env.MAX_EMAIL_QUEUE) || 100,
	);

	let kill = false;

	setTimeout(async () => {
		while (true) {
			if (kill) break;
			await sleep(1000);
			const job = await queue.pop(1);
			if (job.isErr()) {
				console.error('Error popping job from queue:', job.error);
				continue;
			}

			const [item] = job.value;
			if (!item) continue;
			console.log('Received job:', item);


			const res = await Emails.send({
				id: uuid(),
				...item,
			});

			if (res.isErr()) {
				eventEmitter.emit('error', res.error);
				console.log('Emitted error event');
			} else {
				eventEmitter.emit('email');
				console.log('Emitted email event');
			}
		}
	});

	return () => {
		kill = true;
	};
};

export const startServer = () => {
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
			clicks: data.value.data.clicks + 1
		});

		res.redirect(data.value.data.url);
	});

	const PORT = parseInt(process.env.SERVER_PORT || '3000', 10);
	app.listen(PORT, () => {
		console.log(`Tracker server running at http://localhost:${PORT}`);
	});

	return () => {
		// kill app
		// app.close();
	}
};

export const main = async () => {
	await init();
	const stopServer = startServer();
	const stopWorker = startWorker();

	return () => {
		stopServer();
		stopWorker();
	}
};

if (require.main === module) {
	main().catch((err) => {
		console.error('Error starting email service:', err);
		process.exit(1);
	});
}