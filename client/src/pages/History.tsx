import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ArrowLeft, Printer, FileText, Download, Trash2, Loader2, Clock, CheckCircle2, AlertCircle, XCircle } from "lucide-react";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { icon: React.ReactNode; label: string; cls: string }> = {
    done: { icon: <CheckCircle2 className="w-3.5 h-3.5" />, label: "Done", cls: "text-green-700 bg-green-50 border-green-200" },
    processing: { icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />, label: "Processing", cls: "text-blue-700 bg-blue-50 border-blue-200" },
    pending: { icon: <Clock className="w-3.5 h-3.5" />, label: "Pending", cls: "text-yellow-700 bg-yellow-50 border-yellow-200" },
    error: { icon: <XCircle className="w-3.5 h-3.5" />, label: "Failed", cls: "text-red-700 bg-red-50 border-red-200" },
  };
  const s = map[status] ?? map.pending;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${s.cls}`}>
      {s.icon} {s.label}
    </span>
  );
}

export default function History() {
  const [, navigate] = useLocation();
  const { isAuthenticated, loading } = useAuth();

  const { data: conversions, isLoading, refetch } = trpc.conversions.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const deleteMutation = trpc.conversions.delete.useMutation({
    onSuccess: () => { toast.success("Deleted successfully"); refetch(); },
    onError: (err) => toast.error(err.message),
  });

  if (!isAuthenticated && !loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-foreground font-medium mb-4">Sign in to view your history</p>
          <Button asChild><a href={getLoginUrl()}>Sign in</a></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
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
          <div className="w-24" />
        </div>
      </header>

      <main className="flex-1 container py-10">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-2xl font-bold text-foreground mb-8">Conversion History</h1>

          {isLoading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : !conversions || conversions.length === 0 ? (
            <div className="text-center py-20 border-2 border-dashed border-border rounded-2xl">
              <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-foreground font-medium mb-2">No conversions yet</p>
              <p className="text-sm text-muted-foreground mb-6">Upload a PDF to get started.</p>
              <Button onClick={() => navigate("/")}>Upload PDF</Button>
            </div>
          ) : (
            <div className="space-y-3">
              {conversions.map((conv) => (
                <div
                  key={conv.id}
                  className="flex items-center gap-4 p-4 bg-card border border-border rounded-xl hover:border-primary/40 transition-colors"
                >
                  <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5 text-primary" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">{conv.filename}</p>
                    <div className="flex items-center gap-3 mt-1">
                      <StatusBadge status={conv.status} />
                      {conv.pageCount > 0 && (
                        <span className="text-xs text-muted-foreground">{conv.pageCount} pages</span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {new Date(conv.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {conv.status === "done" && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => navigate(`/convert/${conv.id}`)}>
                          View
                        </Button>
                        <Button size="sm" asChild>
                            <a href={`/api/convert/${conv.id}/download-pdf`} download={`${conv.filename?.replace(/\.pdf$/i, "") ?? "slides"}_print.pdf`}>
                              <Download className="w-3.5 h-3.5 mr-1" />
                              Download PDF
                            </a>
                          </Button>
                      </>
                    )}
                    {(conv.status === "processing" || conv.status === "pending") && (
                      <Button variant="outline" size="sm" onClick={() => navigate(`/convert/${conv.id}`)}>
                        <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                        View Progress
                      </Button>
                    )}
                    <Button
                      variant="ghost" size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => deleteMutation.mutate({ id: conv.id })}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
