import express from "express";
import multer from "multer";
import * as os from "os";
import * as path from "path";
import { createConversion, getConversionById, getSlidesByConversion } from "./db";
import { processPdf, sseClients, sendProgress } from "./pdfProcessor";
import { sdk } from "./_core/sdk";

const router = express.Router();

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 16 * 1024 * 1024 }, // 16MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"));
    }
  },
});

// POST /api/convert — upload PDF and start conversion
router.post("/convert", upload.single("file"), async (req, res) => {
  try {
    let user;
    try { user = await sdk.authenticateRequest(req); } catch { res.status(401).json({ error: "Unauthorized" }); return; }

    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const conversionId = await createConversion({
      userId: user.id,
      filename: req.file.originalname,
      status: "pending",
      pageCount: 0,
    });

    // Start processing in background (don't await)
    processPdf(conversionId, req.file.path, req.file.originalname).catch((err) => {
      console.error("Background processing error:", err);
    });

    res.json({ conversionId });
  } catch (err: any) {
    console.error("Upload error:", err);
    res.status(500).json({ error: err.message ?? "Upload failed" });
  }
});

// GET /api/convert/:id/progress — SSE for real-time progress
router.get("/convert/:id/progress", async (req, res) => {
  let user;
  try { user = await sdk.authenticateRequest(req); } catch { res.status(401).json({ error: "Unauthorized" }); return; }

  const conversionId = parseInt(req.params.id, 10);
  const conversion = await getConversionById(conversionId);
  if (!conversion || conversion.userId !== user.id) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // If already done or error, send final state immediately
  if (conversion.status === "done" || conversion.status === "error") {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.write(`data: ${JSON.stringify({ status: conversion.status, message: conversion.status === "done" ? "Conversion complete!" : conversion.errorMessage, pageCount: conversion.pageCount, downloadUrl: conversion.downloadUrl })}\n\n`);
    res.end();
    return;
  }

  // Set up SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const write = (data: string) => {
    res.write(data);
  };

  if (!sseClients.has(conversionId)) {
    sseClients.set(conversionId, new Set());
  }
  sseClients.get(conversionId)!.add(write);

  // Heartbeat
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.get(conversionId)?.delete(write);
    if (sseClients.get(conversionId)?.size === 0) {
      sseClients.delete(conversionId);
    }
  });
});

// GET /api/convert/:id/slides — return slides data
router.get("/convert/:id/slides", async (req, res) => {
  let user;
  try { user = await sdk.authenticateRequest(req); } catch { res.status(401).json({ error: "Unauthorized" }); return; }

  const conversionId = parseInt(req.params.id, 10);
  const conversion = await getConversionById(conversionId);
  if (!conversion || conversion.userId !== user.id) { res.status(404).json({ error: "Not found" }); return; }

  const slideList = await getSlidesByConversion(conversionId);
  res.json({ conversion, slides: slideList.sort((a, b) => a.pageNum - b.pageNum) });
});

export default router;
