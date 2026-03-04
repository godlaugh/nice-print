import { fromPath } from "pdf2pic";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { invokeLLM } from "./_core/llm";
import { getDb } from "./db";
import { conversions, slides } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { storagePut } from "./storage";

// SSE clients map: conversionId -> response writers
export const sseClients = new Map<number, Set<(data: string) => void>>();

export function sendProgress(conversionId: number, data: object) {
  const clients = sseClients.get(conversionId);
  if (clients) {
    const msg = `data: ${JSON.stringify(data)}\n\n`;
    clients.forEach((write) => write(msg));
  }
}

function generatePrintSlideHtml(contentHtml: string, pageNum: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #fff; font-family: Arial, sans-serif; color: #000; }
  .slide {
    width: 1280px;
    min-height: 720px;
    background: #fff;
    color: #000;
    padding: 60px 80px 40px;
    position: relative;
    page-break-after: always;
  }
  h1 { font-size: 52px; font-weight: 700; margin-bottom: 30px; padding-bottom: 15px; border-bottom: 3px solid #000; }
  h2 { font-size: 40px; font-weight: 700; margin-bottom: 25px; padding-bottom: 12px; border-bottom: 2px solid #000; }
  h3 { font-size: 30px; font-weight: 700; margin-bottom: 15px; }
  p { font-size: 24px; line-height: 1.7; margin-bottom: 16px; }
  ul, ol { margin-left: 40px; margin-bottom: 20px; }
  li { font-size: 24px; line-height: 1.7; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; margin-top: 20px; }
  th, td { padding: 12px 16px; border: 1px solid #000; font-size: 22px; text-align: left; }
  th { font-weight: bold; background: #f0f0f0; }
  blockquote { border-left: 5px solid #000; padding: 12px 20px 12px 24px; background: #f9f9f9; margin: 20px 0; font-style: italic; }
  .page-num { position: absolute; bottom: 24px; right: 36px; font-size: 16px; color: #666; }
  @media print { body { background: none; } .slide { box-shadow: none; } }
</style>
</head>
<body>
<div class="slide">
${contentHtml}
<div class="page-num">${pageNum}</div>
</div>
</body>
</html>`;
}

async function extractSlideContent(imageBuffer: Buffer, pageNum: number): Promise<string> {
  // Upload image to S3 to get a URL for the LLM
  const key = `temp-slides/page-${pageNum}-${Date.now()}.jpg`;
  const { url } = await storagePut(key, imageBuffer, "image/jpeg");

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are a slide content extractor. Extract ALL text and structural content from the slide image.
Return ONLY clean HTML using basic tags: <h1>, <h2>, <h3>, <p>, <ul>, <li>, <ol>, <table>, <tr>, <th>, <td>, <blockquote>, <strong>, <em>.
Rules:
- Ignore ALL background colors, decorative images, and color blocks
- Keep ALL text content, including titles, subtitles, body text, bullet points, tables
- Preserve the logical hierarchy (headings → body → lists)
- Do NOT include <html>, <head>, <body>, <style> tags
- Output only the inner HTML content for the slide body`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Extract all content from this slide (page ${pageNum}). Return only clean HTML.`,
          },
          {
            type: "image_url",
            image_url: { url, detail: "high" },
          },
        ] as any,
      },
    ],
  });

  const rawContent = response.choices?.[0]?.message?.content;
  const content = typeof rawContent === "string" ? rawContent : "";
  // Strip any accidental code fences
  return content.replace(/```html?\n?/gi, "").replace(/```/g, "").trim();
}

export async function processPdf(conversionId: number, pdfPath: string, originalFilename: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nice-print-"));

  try {
    // Update status to processing
    await db.update(conversions).set({ status: "processing" }).where(eq(conversions.id, conversionId));
    sendProgress(conversionId, { status: "processing", message: "Converting PDF pages to images..." });

    // Convert PDF to images
    const converter = fromPath(pdfPath, {
      density: 150,
      saveFilename: "slide",
      savePath: tmpDir,
      format: "jpg",
      width: 1280,
      height: 720,
    });

    // Get page count first
    const { default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js" as any).catch(() => ({ default: null }));
    
    // Use pdf2pic to convert all pages
    const results = await converter.bulk(-1, { responseType: "buffer" });
    const pageCount = results.length;

    await db.update(conversions).set({ pageCount }).where(eq(conversions.id, conversionId));
    sendProgress(conversionId, { status: "processing", message: `Found ${pageCount} pages. Extracting content...`, pageCount });

    // Process each page
    const allSlideHtmls: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const pageNum = i + 1;

      sendProgress(conversionId, {
        status: "processing",
        message: `Extracting content from page ${pageNum}/${pageCount}...`,
        current: pageNum,
        total: pageCount,
      });

      let contentHtml = "<p>Content could not be extracted from this page.</p>";
      try {
        if (result.buffer) {
          contentHtml = await extractSlideContent(result.buffer, pageNum);
        }
      } catch (err) {
        console.error(`Error extracting page ${pageNum}:`, err);
        contentHtml = `<p><em>Error extracting content from page ${pageNum}.</em></p>`;
      }

      const fullHtml = generatePrintSlideHtml(contentHtml, pageNum);
      allSlideHtmls.push(fullHtml);

      // Save slide to DB
      await db.insert(slides).values({
        conversionId,
        pageNum,
        htmlContent: fullHtml,
      });
    }

    // Generate combined HTML and upload to S3
    const combinedHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Print-Friendly Slides — ${originalFilename}</title>
<style>
  body { background: #e0e0e0; display: flex; flex-direction: column; align-items: center; padding: 20px; font-family: Arial, sans-serif; }
  @media print { body { background: none; padding: 0; } }
</style>
</head>
<body>
${allSlideHtmls.map((h) => h.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? "").join("\n")}
</body>
</html>`;

    const downloadKey = `downloads/${conversionId}-${Date.now()}.html`;
    const { url: downloadUrl } = await storagePut(downloadKey, Buffer.from(combinedHtml, "utf-8"), "text/html");

    // Mark done
    await db.update(conversions).set({ status: "done", downloadUrl }).where(eq(conversions.id, conversionId));
    sendProgress(conversionId, { status: "done", message: "Conversion complete!", pageCount, downloadUrl });
  } catch (err: any) {
    console.error("PDF processing error:", err);
    await db.update(conversions).set({ status: "error", errorMessage: err.message ?? "Unknown error" }).where(eq(conversions.id, conversionId));
    sendProgress(conversionId, { status: "error", message: err.message ?? "Conversion failed" });
  } finally {
    // Cleanup temp dir
    fs.rmSync(tmpDir, { recursive: true, force: true });
    // Cleanup uploaded PDF
    try { fs.unlinkSync(pdfPath); } catch {}
  }
}
