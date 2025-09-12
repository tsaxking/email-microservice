import { config } from 'dotenv';
import { sleep } from 'ts-utils/sleep';
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { Redis } from 'redis-utils';
import z from 'zod';
import { main, on } from '..';
config();

describe('Email server integration', () => {
	let stop = () => {};
	beforeAll(async () => {
		console.log('Starting email server...');
		stop = await main();
		await sleep(5000);
	});

	afterAll(() => {
		stop();
	});

	it('Should send a test email', async () => {
		const testEmail = process.env.TEST_EMAIL_RECIPIENT;
		if (!testEmail) {
			throw new Error('TEST_EMAIL_RECIPIENT environment variable is not set');
		}

		const redis = new Redis({
			name: 'email-tester'
		});

		await redis.init(1000);

		const service = redis.createQueue(
			'email',
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			z.unknown() as any,
			10
		);

		on('email', () => {
			console.log('Email sent successfully');
			expect(true).toBe(true);
		});

		on('error', (err) => {
			console.error('Error event received:', err);
			expect(false).toBe(true);
		});

		service.add({
			text: 'This is a test email',
			to: testEmail,
			subject: 'Test Email from Email Microservice'
		});

		await sleep(5_000); // wait for 10 seconds to allow email to be sent
		expect(true).toBe(true);
	}, 10_000);
});
