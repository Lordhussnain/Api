import fp from "fastify-plugin";
import { PrismaClient } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import { getQueue } from "./queues.js";
import { s3 } from "./s3.js";
import { PutObjectCommand, CreateBucketCommand } from "@aws-sdk/client-s3";

export default fp(async function (fastify, opts) {
  const prisma = new PrismaClient();

  // Ensure bucket exists (dev-time convenience)
  fastify.addHook("onReady", async () => {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET }));
    } catch (err) {
      // bucket might already exist — ignore
    }
  });

  // Create upload session & presign minimal (server-side direct upload to MinIO)
  fastify.post("/api/v1/uploads/sessions", async (req, reply) => {
    const { filename, size } = req.body;
    if (!filename) return reply.badRequest("filename required");
    // basic size guard
    if (size && size > 1024 * 1024 * 1024) return reply.status(413).send({ error: "file too large" });

    const sessionId = uuidv4();
    const key = `uploads/${sessionId}/${filename}`;

    // For simplicity: server-side create empty object placeholder (pre-create)
    await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: "" }));

    const session = await prisma.uploadSession.create({
      data: { id: sessionId, objectKey: key, size: size || 0, status: "created" }
    });

    return reply.code(201).send({ sessionId: session.id, key });
  });

  // Simple "complete" endpoint - assume file was uploaded to objectKey by client
  fastify.put("/api/v1/uploads/sessions/:id/complete", async (req, reply) => {
    const { id } = req.params;
    const session = await prisma.uploadSession.findUnique({ where: { id } });
    if (!session) return reply.notFound();
    // optional: head object to verify exists
    try {
      await s3.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: session.objectKey }));
    } catch (err) {
      return reply.status(400).send({ error: "uploaded object not found" });
    }
    await prisma.uploadSession.update({ where: { id }, data: { status: "uploaded" } });
    return reply.send({ sessionId: id });
  });

  // Create job (enqueue)
  fastify.post("/api/v1/jobs", async (req, reply) => {
    const { sessionId, outputs = [{ format: "docx" }] } = req.body;
    if (!sessionId) return reply.badRequest("sessionId required");
    const session = await prisma.uploadSession.findUnique({ where: { id: sessionId } });
    if (!session) return reply.notFound("upload session not found");

    const jobId = uuidv4();
    const job = await prisma.job.create({
      data: {
        id: jobId,
        sessionId,
        status: "queued",
        outputs: JSON.stringify(outputs),
      },
    });

    // Decide queues: naive example - enqueue libreoffice for docx/pptx else poppler
    const libFormats = ["docx", "pptx"];
    const hasLib = outputs.some(o => libFormats.includes(o.format));
    if (hasLib) {
      const queue = getQueue("libreoffice");
      await queue.add("convert", { jobId, s3InputKey: session.objectKey, outputs });
    }
    // always enqueue poppler for images/text extraction in parallel
    const queuePop = getQueue("poppler");
    await queuePop.add("extract", { jobId, s3InputKey: session.objectKey, outputs });

    return reply.code(202).send({ jobId, location: `/api/v1/jobs/${jobId}` });
  });

  // Get job status
  fastify.get("/api/v1/jobs/:jobId", async (req, reply) => {
    const { jobId } = req.params;
    const job = await prisma.job.findUnique({ where: { id: jobId }, include: { results: true, logs: true } });
    if (!job) return reply.notFound();
    return reply.send({
      jobId: job.id,
      status: job.status,
      outputs: job.outputs,
      results: job.results,
      logs: job.logs,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt
    });
  });
});
