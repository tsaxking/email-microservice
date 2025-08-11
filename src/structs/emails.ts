import { integer, text } from "drizzle-orm/pg-core";
import { Struct } from "drizzle-struct/back-end";
import { attemptAsync, attempt } from "ts-utils/check";
import sgMail from '@sendgrid/mail';
import { z } from "zod";
import { Redis } from '../services/redis';

export namespace Emails {
    const requiredEnvVars = [
        'SENDGRID_API_KEY',
        'SENDGRID_FROM_EMAIL',
        'PROXY_DOMAIN',
    ] as const;

    for (const varName of requiredEnvVars) {
    if (!process.env[varName]) {
        throw new Error(`Missing required environment variable: ${varName}`);
    }
    }
    sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');

    export const Email = new Struct({
        name: 'email',
        structure: {
            to: text('to').notNull(),
            subject: text('subject').notNull(),
            text: text('text').notNull(),
            html: text('html'),
        }
    });

    export const TrackedLinks = new Struct({
        name: 'tracked_links',
        structure: {
            emailId: text('email_id').notNull(),
            url: text('url').notNull(),
            clicks: integer('clicks').default(0).notNull(),
        }
    });

    export const EmailSchema = z.union([
            z.object({
                id: z.uuidv4(),
                to: z.email(),
                subject: z.string().min(1),
                text: z.string().min(1),
            }),
            z.object({
                id: z.uuidv4(),
                to: z.email(),
                subject: z.string().min(1),
                html: z.string().min(1),
            })
        ]);
;

    export const parse = (data: string) => {
        return attempt(() => {
            return EmailSchema.parse(JSON.parse(data));
        });
    }

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
                    clicks: 0,
                }).unwrap();

                const trackedUrl = `${process.env.PROXY_DOMAIN}/r/${res.id}`;
                html = html.replaceAll(url, trackedUrl);
            }
            return html;
        });
    };

    export const send = (email: {
        id: string;
        to: string;
        subject: string;
        text?: string;
        html?: string;
    }) => attemptAsync(async () => {
        const parsed = EmailSchema.parse(email);
        const createRes = await Email.new({
            id: parsed.id,
            to: parsed.to,
            subject: parsed.subject,
            text: 'text' in parsed ? parsed.text : '',
            html: 'html' in parsed ? parsed.html : '',

            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            archived: false,
            canUpdate: false,
            attributes: '[]',
            lifetime: 0,
        }, {
            overwriteGlobals: true,
            static: true,
        }).unwrap();

        const [response] = await sgMail.send({
            to: parsed.to,
            from: String(process.env.SENDGRID_FROM_EMAIL),
            subject: parsed.subject,
            text: 'text' in parsed ? await trackLinks(parsed.text).unwrap() : '',
            html: 'html' in parsed ? await trackLinks(parsed.html).unwrap() : '',
        });

        if (!response.statusCode.toString().startsWith('2')) {
            Redis.emit('email:send', {
                id: createRes.id,
                message: 'Failed to send email',
                status: 'error',
            });

            throw new Error('Failed to send email: ' + response.statusCode);
        }

        await Redis.emit('email:send', {
            id: createRes.id,
            message: 'Email sent successfully',
            status: 'success',
        }).unwrap();
    });
}

export const _emails = Emails.Email.table;
export const _trackedLinks = Emails.TrackedLinks.table;