import express from "express";
import multer from "multer";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createConversion, getConversionById, getSlidesByConversion, updateConversionPdfKey } from "./db";
import { processPdf, reprocessPdf, sseClients, sendProgress } from "./pdfProcessor";
import { htmlToPdf } from "./htmlToPdf";
import { storagePut, storageGet } from "./storage";
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

    // Upload original PDF to S3 for potential re-processing later
    let originalPdfKey: string | undefined;
    try {
      const pdfBuffer = fs.readFileSync(req.file.path);
      const safeFilename = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      originalPdfKey = `originals/${conversionId}-${Date.now()}-${safeFilename}`;
      await storagePut(originalPdfKey, pdfBuffer, "application/pdf");
      await updateConversionPdfKey(conversionId, originalPdfKey);
    } catch (err) {
      console.warn("Could not store original PDF to S3 (re-process will be unavailable):", err);
    }

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

// GET /api/convert/:id/download-pdf — generate and stream a print-friendly PDF
router.get("/convert/:id/download-pdf", async (req, res) => {
  let user;
  try { user = await sdk.authenticateRequest(req); } catch { res.status(401).json({ error: "Unauthorized" }); return; }

  const conversionId = parseInt(req.params.id, 10);
  const conversion = await getConversionById(conversionId);
  if (!conversion || conversion.userId !== user.id) { res.status(404).json({ error: "Not found" }); return; }
  if (conversion.status !== "done") { res.status(400).json({ error: "Conversion not complete" }); return; }

  const slideList = await getSlidesByConversion(conversionId);
  const sorted = slideList.sort((a, b) => a.pageNum - b.pageNum);

  // Pass each slide's full HTML individually — htmlToPdf renders each at 1280×720px
  // and merges into a single PDF. This guarantees 1 slide = 1 PDF page.
  const slideHtmls = sorted.map((s) => s.htmlContent);

  try {
    const pdfBuffer = await htmlToPdf(slideHtmls);
    const safeName = (conversion.filename ?? "slides").replace(/\.pdf$/i, "").replace(/[^a-zA-Z0-9_\-\s]/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}_print.pdf"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.end(pdfBuffer);
  } catch (err: any) {
    console.error("PDF generation error:", err);
    res.status(500).json({ error: "Failed to generate PDF: " + (err.message ?? "unknown error") });
  }
});

// POST /api/convert/:id/reprocess — re-run AI extraction using stored original PDF
router.post("/convert/:id/reprocess", async (req, res) => {
  let user;
  try { user = await sdk.authenticateRequest(req); } catch { res.status(401).json({ error: "Unauthorized" }); return; }

  const conversionId = parseInt(req.params.id, 10);
  const conversion = await getConversionById(conversionId);
  if (!conversion || conversion.userId !== user.id) { res.status(404).json({ error: "Not found" }); return; }
  if (!conversion.originalPdfKey) { res.status(400).json({ error: "Original PDF not available for re-processing. Please upload the file again." }); return; }
  if (conversion.status === "processing" || conversion.status === "pending") {
    res.status(400).json({ error: "Conversion is already in progress" }); return;
  }

  try {
    // Download the original PDF from S3 to a temp file
    const { url: pdfUrl } = await storageGet(conversion.originalPdfKey);
    const response = await fetch(pdfUrl);
    if (!response.ok) throw new Error(`Failed to download original PDF: ${response.statusText}`);
    const pdfBuffer = Buffer.from(await response.arrayBuffer());

    const tmpPath = path.join(os.tmpdir(), `reprocess-${conversionId}-${Date.now()}.pdf`);
    fs.writeFileSync(tmpPath, pdfBuffer);

    // Start re-processing in background
    reprocessPdf(conversionId, tmpPath, conversion.filename).catch((err) => {
      console.error("Re-processing error:", err);
    });

    res.json({ success: true, message: "Re-processing started" });
  } catch (err: any) {
    console.error("Reprocess error:", err);
    res.status(500).json({ error: err.message ?? "Failed to start re-processing" });
  }
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
