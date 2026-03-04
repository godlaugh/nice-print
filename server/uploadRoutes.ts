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

  // Build a single combined HTML with all slides for PDF rendering
  const slideBodyParts = sorted.map((s) => {
    // Extract only the body content from each slide's full HTML
    const match = s.htmlContent.match(/<body>([\s\S]*?)<\/body>/);
    return match ? match[1] : s.htmlContent;
  });

  const combinedHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #fff; font-family: Arial, sans-serif; color: #000; }
  .slide {
    width: 100%;
    min-height: 100vh;
    background: #fff;
    color: #000;
    padding: 40px 60px 30px;
    page-break-after: always;
    position: relative;
  }
  h1 { font-size: 36px; font-weight: 700; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 3px solid #000; }
  h2 { font-size: 28px; font-weight: 700; margin-bottom: 18px; padding-bottom: 8px; border-bottom: 2px solid #000; }
  h3 { font-size: 22px; font-weight: 700; margin-bottom: 12px; }
  p { font-size: 16px; line-height: 1.7; margin-bottom: 12px; }
  ul, ol { margin-left: 28px; margin-bottom: 14px; }
  li { font-size: 16px; line-height: 1.7; margin-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; margin-top: 14px; }
  th, td { padding: 8px 12px; border: 1px solid #000; font-size: 14px; text-align: left; }
  th { font-weight: bold; background: #f0f0f0; }
  blockquote { border-left: 4px solid #000; padding: 8px 16px 8px 18px; background: #f9f9f9; margin: 14px 0; font-style: italic; }
  .page-num { position: absolute; bottom: 16px; right: 24px; font-size: 12px; color: #888; }
  @media print { .slide { page-break-after: always; } }
</style>
</head>
<body>
${slideBodyParts.join("\n")}
</body>
</html>`;

  try {
    const pdfBuffer = await htmlToPdf(combinedHtml);
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
