import { Struct, type Blank } from 'drizzle-struct/back-end';
import redis from './redis';

export const createStructEventService = (struct: Struct<Blank, string>) => {
	if (struct.data.frontend === false) return;

	struct.on('create', (data) => {
		redis.emit(`struct:${struct.name}:create`, data);
	});

	struct.on('update', (data) => {
		redis.emit(`struct:${struct.name}:update`, data);
	});

	struct.on('archive', (data) => {
		redis.emit(`struct:${struct.name}:archive`, data);
	});

	struct.on('delete', (data) => {
		redis.emit(`struct:${struct.name}:delete`, data);
	});

	struct.on('restore', (data) => {
		redis.emit(`struct:${struct.name}:restore`, data);
	});

	struct.on('delete-version', (data) => {
		redis.emit(`struct:${struct.name}:delete-version`, data);
	});

	struct.on('restore-version', (data) => {
		redis.emit(`struct:${struct.name}:restore-version`, data);
	});

	struct.emit('build');
};
