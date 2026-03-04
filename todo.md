# Nice Print Web — TODO

## Backend
- [x] Database schema: conversions table (id, userId, filename, status, pageCount, createdAt)
- [x] Database schema: slides table (id, conversionId, pageNum, htmlContent, previewUrl)
- [x] Install pdf2image / poppler support via multer + python subprocess
- [x] POST /api/convert — upload PDF, kick off background processing
- [x] SSE endpoint GET /api/convert/:id/progress — stream real-time progress
- [x] GET /api/convert/:id/slides — return all slides HTML
- [x] GET /api/convert/:id/download — return combined HTML file (via S3 URL)
- [x] tRPC: conversions.list — fetch user's conversion history
- [x] tRPC: conversions.get — fetch single conversion with slides
- [x] tRPC: conversions.delete — delete a conversion
- [x] AI vision extraction using built-in LLM (invokeLLM with image_url)
- [x] Store slide HTML in DB, combined HTML in S3

## Frontend
- [x] Global design: Inter font, clean functional style
- [x] Home page: hero + upload zone (drag-and-drop, 16MB limit, PDF only)
- [x] Conversion page: real-time progress bar via SSE
- [x] Preview page: responsive grid of slide previews with iframe/html rendering
- [x] Download button: combined HTML + individual slide download
- [x] History page: list past conversions with status, date, page count
- [x] Error states: upload errors, conversion failures, empty states
- [x] Responsive layout for mobile

## Testing
- [x] Vitest: conversions router unit tests (7 tests passing)
- [x] Vitest: slide HTML generation helper tests

## Deployment
- [x] Push to GitHub nice-print repo (https://github.com/godlaugh/nice-print)

## Bug Fixes
- [x] Fix PDF-to-image conversion: replace pdf2pic (requires GraphicsMagick) with pdftoppm (poppler-utils, pre-installed)
- [x] E2E fix: replaced pdfinfo (not in Node.js PATH) with pdf-lib (pure JS) for page count — verified with full e2e simulation
- [x] Download outputs PDF (not HTML): server-side puppeteer-core + system Chromium renders HTML → A4 landscape PDF, e2e verified (21KB test PDF generated)
- [x] Improve AI prompt: LLM now faithfully reproduces original slide layout (flex/grid columns, cards, title position) — e2e verified with page 2 (two-column list layout correctly detected)
- [x] Add Re-process button to History page: re-run AI extraction on existing conversion without re-uploading PDF
- [x] Store original PDF in S3 during upload so re-processing is possible
- [x] Backend: POST /api/convert/:id/reprocess endpoint — reset slides, re-run processPdf
- [x] Frontend: Re-process button in History with loading state and redirect to Convert page on completion
- [x] Fix blank slides: root cause = LLM generates height:100vh which pushes content off-screen in iframe/Puppeteer. Fix: CSS override for 100vh + explicit rule in AI prompt to use min-height:600px instead. All 7 tests passing.
- [x] Fix slide overflow: enforce strict height:720px on .slide container so content never spills into next page
- [x] Fix aspect ratio: each slide is now exactly 1280x720px (16:9) with overflow:hidden
- [x] AI prompt: added font size guide (h1:36-42px, body:14-18px) and spacing guide, instructed LLM to reduce sizes for dense content
