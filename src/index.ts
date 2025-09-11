import { config } from 'dotenv';
import express, { Request, Response } from 'express';
import { Emails } from './structs/emails';
import { Struct } from 'drizzle-struct/back-end';
import { DB } from './db';

config();

export type EmailMessage = {
	id: string;
	to: string;
	subject: string;
	text: string;
	html?: string;
};


export const init = async () => {
	await Struct.buildAll(DB);
};

export const startWorker = async () => {

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
};

export const main = async () => {
	await init();
	startServer();
	startWorker();
};

if (require.main === module) {
	main().catch((err) => {
		console.error('Error starting email service:', err);
		process.exit(1);
	});
}