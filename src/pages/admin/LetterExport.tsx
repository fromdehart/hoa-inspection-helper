import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { useClerk } from "@clerk/clerk-react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { jsPDF } from "jspdf";
import JSZip from "jszip";

function sanitizeFilename(s: string) {
  return s.replace(/[/\\?%*:|"<>]/g, "-").slice(0, 120);
}

async function letterHtmlToPdfBlob(html: string): Promise<Blob> {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-9999px";
  host.style.top = "0";
  host.style.boxSizing = "border-box";
  host.style.width = "816px";
  // Small horizontal padding helps prevent list markers from appearing clipped.
  host.style.padding = "0 6px";
  host.style.background = "#fff";
  host.style.color = "#000";
  host.innerHTML = html;
  document.body.appendChild(host);
  try {
    const pdf = new jsPDF({ unit: "pt", format: "letter", orientation: "portrait" });
    const pageW = pdf.internal.pageSize.getWidth();
    const margin = 36;
    const maxW = pageW - margin * 2;

    await pdf.html(host, {
      x: margin,
      y: margin,
      width: maxW,
      windowWidth: host.scrollWidth,
      autoPaging: "text",
      html2canvas: {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff",
      },
    });

    return pdf.output("blob");
  } finally {
    document.body.removeChild(host);
  }
}

export default function LetterExport() {
  const navigate = useNavigate();
  const { signOut } = useClerk();
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");

  const letters = useQuery(api.properties.listGeneratedLetterBodies);

  const downloadZip = async () => {
    if (!letters?.length) return;
    setBusy(true);
    setLog("");
    const zip = new JSZip();
    try {
      for (let i = 0; i < letters.length; i++) {
        const row = letters[i];
        setLog(`Rendering ${i + 1} / ${letters.length}: ${row.address}`);
        const blob = await letterHtmlToPdfBlob(row.html);
        zip.file(`${sanitizeFilename(row.address)}.pdf`, blob);
      }
      setLog("Zipping…");
      const out = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(out);
      const a = document.createElement("a");
      a.href = url;
      a.download = `happier-block-letters-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setLog(`Done (${letters.length} PDFs).`);
    } catch (e) {
      console.error(e);
      setLog("Error: " + String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f7ff]">
      <div className="gradient-admin px-4 pt-8 pb-5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h1 className="font-extrabold text-white text-lg">📄 Export letters (PDF)</h1>
          <div className="flex gap-2">
            <button
              type="button"
              className="text-sm bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-full border border-white/30 transition-colors"
              onClick={() => navigate("/admin/dashboard")}
            >
              Dashboard
            </button>
            <button
              type="button"
              className="text-sm bg-white/10 hover:bg-white/20 text-white/80 px-3 py-1.5 rounded-full border border-white/20 transition-colors"
              onClick={() => void signOut({ redirectUrl: "/" })}
            >
              Logout
            </button>
          </div>
        </div>
      </div>
      <div className="max-w-xl mx-auto px-4 py-8">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-4">
          <p className="text-sm text-gray-600">
            Downloads a ZIP of PDFs built from stored, admin-generated letter HTML. Only properties with generated
            letters are included. Rendering uses your browser; large batches may take a minute.
          </p>
          <p className="text-sm font-semibold text-gray-800">
            Ready: {letters === undefined ? "…" : letters.length} letter(s)
          </p>
          {log && (
            <p className="text-xs font-mono text-gray-500 whitespace-pre-wrap bg-gray-50 rounded-xl p-3 border border-gray-100">
              {log}
            </p>
          )}
          <Button
            disabled={busy || !letters?.length}
            onClick={downloadZip}
            className="btn-bounce w-full h-12 text-base font-bold bg-violet-600 hover:bg-violet-700 text-white rounded-xl shadow-lg"
          >
            {busy ? "Working…" : "📥 Download ZIP of PDFs"}
          </Button>
        </div>
      </div>
    </div>
  );
}
