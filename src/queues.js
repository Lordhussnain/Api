import { Queue } from "bullmq";
import IORedis from "ioredis";

const connection = new IORedis(process.env.REDIS_URL || "redis://redis:6379");

export function getQueue(name) {
  return new Queue(name, { connection });
}
