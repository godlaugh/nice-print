import { useCallback, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Upload, FileText, Printer, History, LogOut, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

const MAX_FILE_SIZE = 16 * 1024 * 1024; // 16MB

export default function Home() {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const [, navigate] = useLocation();
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    if (file.type !== "application/pdf") {
      toast.error("Only PDF files are supported.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error("File size must be under 16MB.");
      return;
    }
    if (!isAuthenticated) {
      toast.error("Please sign in first.");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/convert", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error ?? "Upload failed");
      }

      const { conversionId } = await res.json();
      toast.success("Upload successful! Processing your PDF...");
      navigate(`/convert/${conversionId}`);
    } catch (err: any) {
      toast.error(err.message ?? "Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }, [isAuthenticated, navigate]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }, [handleFile]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Navbar */}
      <header className="border-b border-border bg-white sticky top-0 z-10">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <Printer className="w-6 h-6 text-primary" />
            <span className="font-bold text-xl text-foreground tracking-tight">Nice Print</span>
          </div>
          <nav className="flex items-center gap-3">
            {isAuthenticated && (
              <Button variant="ghost" size="sm" onClick={() => navigate("/history")}>
                <History className="w-4 h-4 mr-1.5" />
                History
              </Button>
            )}
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            ) : isAuthenticated ? (
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground hidden sm:block">{user?.name}</span>
                <Button variant="outline" size="sm" onClick={logout}>
                  <LogOut className="w-4 h-4 mr-1.5" />
                  Sign out
                </Button>
              </div>
            ) : (
              <Button size="sm" asChild>
                <a href={getLoginUrl()}>Sign in</a>
              </Button>
            )}
          </nav>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-16">
        <div className="max-w-2xl w-full text-center mb-10">
          <div className="inline-flex items-center gap-2 bg-accent text-accent-foreground text-sm font-medium px-3 py-1 rounded-full mb-6">
            <Printer className="w-3.5 h-3.5" />
            AI-powered PDF converter
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-4 leading-tight">
            Convert PDFs to<br />
            <span className="text-primary">Print-Friendly Slides</span>
          </h1>
          <p className="text-lg text-muted-foreground">
            Upload any PDF presentation and our AI will strip away heavy backgrounds,
            converting it to a clean white-background, black-text version — perfect for printing.
          </p>
        </div>

        {/* Upload Zone */}
        <div className="max-w-2xl w-full">
          {!isAuthenticated && !loading ? (
            <div className="border-2 border-dashed border-border rounded-2xl p-12 text-center bg-muted/30">
              <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-foreground font-medium mb-2">Sign in to start converting</p>
              <p className="text-sm text-muted-foreground mb-6">You need to be signed in to upload and convert PDFs.</p>
              <Button asChild>
                <a href={getLoginUrl()}>Sign in to continue</a>
              </Button>
            </div>
          ) : (
            <div
              className={`border-2 border-dashed rounded-2xl p-12 text-center transition-all cursor-pointer
                ${dragging ? "border-primary bg-accent/40 scale-[1.01]" : "border-border bg-muted/20 hover:border-primary hover:bg-accent/20"}
                ${uploading ? "pointer-events-none opacity-60" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => !uploading && fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={onFileChange}
              />
              {uploading ? (
                <>
                  <Loader2 className="w-12 h-12 text-primary mx-auto mb-4 animate-spin" />
                  <p className="text-foreground font-semibold text-lg">Uploading your PDF...</p>
                  <p className="text-sm text-muted-foreground mt-1">Please wait</p>
                </>
              ) : (
                <>
                  <Upload className="w-12 h-12 text-primary mx-auto mb-4" />
                  <p className="text-foreground font-semibold text-lg mb-1">
                    {dragging ? "Drop your PDF here" : "Drag & drop your PDF here"}
                  </p>
                  <p className="text-sm text-muted-foreground mb-6">or click to browse — PDF only, max 16MB</p>
                  <Button size="lg" className="px-8">
                    <Upload className="w-4 h-4 mr-2" />
                    Choose PDF File
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Features */}
        <div className="max-w-2xl w-full mt-16 grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[
            { icon: <Upload className="w-5 h-5" />, title: "Upload PDF", desc: "Drag & drop or click to upload any PDF presentation up to 16MB." },
            { icon: <CheckCircle2 className="w-5 h-5" />, title: "AI Extraction", desc: "GPT-4o vision analyzes each slide, preserving all text and structure." },
            { icon: <Printer className="w-5 h-5" />, title: "Print Ready", desc: "Download clean white-background HTML slides, optimized for printing." },
          ].map((f) => (
            <div key={f.title} className="flex flex-col items-center text-center p-6 rounded-xl border border-border bg-card">
              <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center text-primary mb-3">
                {f.icon}
              </div>
              <h3 className="font-semibold text-foreground mb-1">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t border-border py-6 text-center text-sm text-muted-foreground">
        Nice Print — Open source on{" "}
        <a href="https://github.com/godlaugh/nice-print" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
          GitHub
        </a>
      </footer>
    </div>
  );
}
