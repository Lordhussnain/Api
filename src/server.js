import Fastify from "fastify";
import sensible from "fastify-sensible";
import cors from "fastify-cors";
import routes from "./routes.js";
import dotenv from "dotenv";
import pino from "pino";

dotenv.config();
const logger = pino({ level: process.env.LOG_LEVEL || "info" });

const fastify = Fastify({ logger });

fastify.register(sensible);
fastify.register(cors, { origin: true });
fastify.register(routes);

const port = process.env.PORT || 3000;
fastify.listen({ port, host: "0.0.0.0" }).then(addr => logger.info(`API listening at ${addr}`));
