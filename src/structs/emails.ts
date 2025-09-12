import { integer, text } from 'drizzle-orm/pg-core';
import { Struct } from 'drizzle-struct/back-end';
import { attemptAsync, attempt } from 'ts-utils/check';
import { z } from 'zod';
import nodemailer from 'nodemailer';

export namespace Emails {
	const requiredEnvVars = ['SENDGRID_API_KEY', 'SENDGRID_FROM_EMAIL', 'PROXY_DOMAIN'] as const;

	for (const varName of requiredEnvVars) {
		if (!process.env[varName]) {
			throw new Error(`Missing required environment variable: ${varName}`);
		}
	}

	export const Email = new Struct({
		name: 'email',
		structure: {
			to: text('to').notNull(),
			subject: text('subject').notNull(),
			text: text('text').notNull(),
			html: text('html')
		}
	});

	export const TrackedLinks = new Struct({
		name: 'tracked_links',
		structure: {
			emailId: text('email_id').notNull(),
			url: text('url').notNull(),
			clicks: integer('clicks').default(0).notNull()
		}
	});

	const transporter = nodemailer.createTransport({
		service: 'gmail',
		auth: {
			user: process.env.EMAIL_USER,
			pass: process.env.EMAIL_PASS
		}
	});

	export const EmailSchema = z.union([
		z.object({
			id: z.uuidv4(),
			to: z.email(),
			subject: z.string().min(1),
			text: z.string().min(1),
			attachments: z
				.array(
					z.object({
						filename: z.string().min(1),
						path: z.string().min(1)
					})
				)
				.optional()
		}),
		z.object({
			id: z.uuidv4(),
			to: z.email(),
			subject: z.string().min(1),
			html: z.string().min(1),
			attachments: z
				.array(
					z.object({
						filename: z.string().min(1),
						path: z.string().min(1)
					})
				)
				.optional()
		})
	]);
	export const parse = (data: string) => {
		return attempt(() => {
			return EmailSchema.parse(JSON.parse(data));
		});
	};

	const trackLinks = (html: string) => {
		return attemptAsync(async () => {
			const urlRegex = /https?:\/\/[^\s"'<>]+/g;
			const matches = [...html.matchAll(urlRegex)];

			if (matches.length === 0) return html;

			for (const match of matches) {
				const url = match[0];

				if (!url) continue;
				if (!html.includes(url)) continue; // could have been replaced already

				const res = await TrackedLinks.new({
					emailId: match.input || '',
					url,
					clicks: 0
				}).unwrap();

				const trackedUrl = `${process.env.PROXY_DOMAIN}/r/${res.id}`;
				html = html.replaceAll(url, trackedUrl);
			}
			return html;
		});
	};

	export const send = (email: {
		id: string;
		to: string | string[];
		subject: string;
		text?: string;
		html?: string;
		attachments?: { filename: string; path: string }[];
	}) =>
		attemptAsync(async () => {
			if (!email.text && !email.html) {
				throw new Error('Either text or html must be provided');
			}

			const parsed = EmailSchema.parse(email);
			const createRes = await Email.new(
				{
					id: parsed.id,
					to: parsed.to,
					subject: parsed.subject,
					text: 'text' in parsed ? parsed.text : '',
					html: 'html' in parsed ? parsed.html : '',

					created: new Date(),
					updated: new Date(),
					archived: false,
					canUpdate: false,
					attributes: '[]',
					lifetime: 0
				},
				{
					overwriteGlobals: true,
					static: true
				}
			).unwrap();

			await transporter.sendMail({
				from: process.env.EMAIL_USER,
				to: parsed.to,
				subject: parsed.subject,
				text: 'text' in parsed ? parsed.text : undefined,
				html: 'html' in parsed ? await trackLinks(parsed.html).unwrap() : undefined
			});

			return createRes;
		});
}

export const _emails = Emails.Email.table;
export const _trackedLinks = Emails.TrackedLinks.table;
