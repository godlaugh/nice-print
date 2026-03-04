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
- [ ] Push to GitHub nice-print repo
