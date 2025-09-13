import redis from './redis';
import { z } from 'zod';

class UUIDService {
	private readonly cache: string[] = [];
	private readonly queryService = redis.createClient(
		process.env.UUID_SERVICE_NAME || 'uuidServiceQueue',
		10
	);

	constructor(public readonly maxSize: number) {}

	get() {
		const uuid = this.cache.pop();
		if (uuid) return uuid;
		this.request();
		return crypto.randomUUID();
	}

	async request() {
		const res = await this.queryService.send<string[]>('reserve', {
			data: {
				count: this.maxSize
			},
			returnType: z.array(z.string())
		});
		if (res.isErr()) {
			console.error('Error reserving UUIDs:', res.error);
			return;
		}
		this.cache.push(...res.value);
	}
}

const uuidService = new UUIDService(10);

export const uuid = () => {
	return uuidService.get();
};
