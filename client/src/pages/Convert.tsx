import { useEffect, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { ArrowLeft, Download, Printer, Loader2, CheckCircle2, AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";

type ProgressEvent = {
  status: "pending" | "processing" | "done" | "error";
  message?: string;
  current?: number;
  total?: number;
  pageCount?: number;
  downloadUrl?: string;
};

export default function Convert() {
  const { id } = useParams<{ id: string }>();
  const conversionId = parseInt(id ?? "0", 10);
  const [, navigate] = useLocation();
  const { isAuthenticated } = useAuth();

  const [progress, setProgress] = useState<ProgressEvent>({ status: "pending", message: "Starting conversion..." });
  const [sseConnected, setSseConnected] = useState(false);
  const [previewPage, setPreviewPage] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  const { data: conversionData, refetch } = trpc.conversions.get.useQuery(
    { id: conversionId },
    { enabled: isAuthenticated && progress.status === "done", retry: false }
  );

  // SSE connection
  useEffect(() => {
    if (!isAuthenticated || !conversionId) return;

    const es = new EventSource(`/api/convert/${conversionId}/progress`, { withCredentials: true });
    eventSourceRef.current = es;
    setSseConnected(true);

    es.onmessage = (e) => {
      try {
        const data: ProgressEvent = JSON.parse(e.data);
        setProgress(data);
        if (data.status === "done") {
          es.close();
          refetch();
        } else if (data.status === "error") {
          es.close();
          toast.error(data.message ?? "Conversion failed");
        }
      } catch {}
    };

    es.onerror = () => {
      es.close();
      setSseConnected(false);
    };

    return () => { es.close(); };
  }, [conversionId, isAuthenticated]);

  const progressPercent = progress.status === "done" ? 100
    : progress.current && progress.total
      ? Math.round((progress.current / progress.total) * 90)
      : progress.status === "processing" ? 10
      : 0;

  const slides = conversionData?.slides ?? [];
  const currentSlide = slides[previewPage];

  const handleDownload = () => {
    if (conversionData?.downloadUrl) {
      const a = document.createElement("a");
      a.href = conversionData.downloadUrl;
      a.download = `${conversionData.filename?.replace(".pdf", "") ?? "slides"}_print.html`;
      a.click();
    }
  };

  const handleDownloadSingle = (html: string, pageNum: number) => {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `slide_${pageNum}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-white sticky top-0 z-10">
        <div className="container flex items-center justify-between h-16">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            Back
          </Button>
          <div className="flex items-center gap-2">
            <Printer className="w-5 h-5 text-primary" />
            <span className="font-bold text-lg text-foreground">Nice Print</span>
          </div>
          {progress.status === "done" && conversionData?.downloadUrl && (
            <Button size="sm" onClick={handleDownload}>
              <Download className="w-4 h-4 mr-1.5" />
              Download All
            </Button>
          )}
          {progress.status !== "done" && <div className="w-24" />}
        </div>
      </header>

      <main className="flex-1 container py-10">
        {/* Progress Section */}
        <div className="max-w-2xl mx-auto mb-10">
          <div className="bg-card border border-border rounded-2xl p-8">
            <div className="flex items-center gap-3 mb-6">
              {progress.status === "done" ? (
                <CheckCircle2 className="w-6 h-6 text-green-500 shrink-0" />
              ) : progress.status === "error" ? (
                <AlertCircle className="w-6 h-6 text-destructive shrink-0" />
              ) : (
                <Loader2 className="w-6 h-6 text-primary animate-spin shrink-0" />
              )}
              <div>
                <p className="font-semibold text-foreground">
                  {progress.status === "done" ? "Conversion Complete!" :
                   progress.status === "error" ? "Conversion Failed" :
                   "Converting your PDF..."}
                </p>
                <p className="text-sm text-muted-foreground mt-0.5">{progress.message}</p>
              </div>
            </div>

            <Progress value={progressPercent} className="h-2 mb-3" />

            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {progress.current && progress.total
                  ? `Page ${progress.current} of ${progress.total}`
                  : progress.status === "done"
                  ? `${progress.pageCount ?? slides.length} pages converted`
                  : "Initializing..."}
              </span>
              <span>{progressPercent}%</span>
            </div>
          </div>
        </div>

        {/* Slides Preview */}
        {slides.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-foreground">
                Preview — {slides.length} Slides
              </h2>
              {conversionData?.downloadUrl && (
                <Button onClick={handleDownload}>
                  <Download className="w-4 h-4 mr-2" />
                  Download All Slides
                </Button>
              )}
            </div>

            {/* Main Preview */}
            <div className="bg-card border border-border rounded-2xl overflow-hidden mb-6">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
                <span className="text-sm font-medium text-foreground">
                  Slide {previewPage + 1} of {slides.length}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline" size="sm"
                    onClick={() => handleDownloadSingle(currentSlide.htmlContent, currentSlide.pageNum)}
                  >
                    <Download className="w-3.5 h-3.5 mr-1" />
                    This slide
                  </Button>
                  <Button variant="ghost" size="sm" disabled={previewPage === 0} onClick={() => setPreviewPage(p => p - 1)}>
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="sm" disabled={previewPage === slides.length - 1} onClick={() => setPreviewPage(p => p + 1)}>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className="relative w-full bg-white" style={{ paddingTop: "56.25%" }}>
                <iframe
                  key={previewPage}
                  srcDoc={currentSlide?.htmlContent ?? ""}
                  className="absolute inset-0 w-full h-full border-0"
                  title={`Slide ${previewPage + 1}`}
                  sandbox="allow-same-origin"
                  style={{ transform: "scale(1)", transformOrigin: "top left" }}
                />
              </div>
            </div>

            {/* Thumbnail Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {slides.map((slide, idx) => (
                <button
                  key={slide.id}
                  onClick={() => setPreviewPage(idx)}
                  className={`group relative rounded-lg overflow-hidden border-2 transition-all bg-white
                    ${previewPage === idx ? "border-primary shadow-md" : "border-border hover:border-primary/50"}`}
                >
                  <div className="relative w-full bg-white" style={{ paddingTop: "56.25%" }}>
                    <iframe
                      srcDoc={slide.htmlContent}
                      className="absolute inset-0 w-full h-full border-0 pointer-events-none"
                      title={`Slide ${slide.pageNum}`}
                      sandbox="allow-same-origin"
                      style={{ transform: "scale(0.25)", transformOrigin: "top left", width: "400%", height: "400%" }}
                    />
                  </div>
                  <div className={`absolute bottom-0 left-0 right-0 py-1 text-center text-xs font-medium
                    ${previewPage === idx ? "bg-primary text-primary-foreground" : "bg-black/50 text-white"}`}>
                    {slide.pageNum}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Error state */}
        {progress.status === "error" && (
          <div className="max-w-2xl mx-auto text-center py-12">
            <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">Conversion Failed</h3>
            <p className="text-muted-foreground mb-6">{progress.message}</p>
            <Button onClick={() => navigate("/")}>Try Again</Button>
          </div>
        )}
      </main>
    </div>
  );
}
