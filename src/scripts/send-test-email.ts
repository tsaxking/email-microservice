import { Struct } from "drizzle-struct/back-end";
import { Emails } from "../structs/emails";
import { DB } from "../db";
import { uuid } from "../services/uuid";

export default async (recipient: string) => {
    await Struct.buildAll(DB).unwrap();
    console.log('Sending test email...');

    await Emails.send({
        id: uuid(),
        to: recipient,
        subject: 'SMTP Test Email',
        text: 'This is a test email sent from the email microservice using SMTP.',
    }).unwrap();
};