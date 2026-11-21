"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type MediaAnalysis,
  type SessionStats,
  emptyStats,
  mergeStats,
  sessionOutcomePercents,
} from "@/lib/analysis";
import {
  analyzeFileLocally,
  type LocalDetectorPayload,
} from "@/lib/local-analysis";

const videoExtensions = /\.(mp4|webm|mov|m4v|mkv)$/i;

function labelDisplay(label: MediaAnalysis["syntheticLabel"]): {
  text: string;
  className: string;
} {
  switch (label) {
    case "likely_human":
      return {
        text: "Camera-like signals",
        className: "bg-emerald-500/15 text-emerald-200 ring-emerald-500/30",
      };
    case "likely_synthetic":
      return {
        text: "Synthetic-like signals",
        className: "bg-rose-500/15 text-rose-200 ring-rose-500/35",
      };
    default:
      return {
        text: "Uncertain",
        className: "bg-amber-500/15 text-amber-100 ring-amber-400/35",
      };
  }
}

export default function AiDetectorApp() {
  const [stats, setStats] = useState<SessionStats>(() => emptyStats());
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<MediaAnalysis | null>(null);
  const [detector, setDetector] = useState<LocalDetectorPayload | null>(null);
  const [copied, setCopied] = useState(false);
  const previewBlobRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const assignFile = useCallback((f: File | null) => {
    if (previewBlobRef.current) {
      URL.revokeObjectURL(previewBlobRef.current);
      previewBlobRef.current = null;
    }
    const url = f ? URL.createObjectURL(f) : null;
    previewBlobRef.current = url;
    setFile(f);
    setPreviewUrl(url);
  }, []);

  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        setStats(emptyStats());
        setAnalysis(null);
        setDetector(null);
        setCopied(false);
        setError(null);
      }
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  useEffect(() => {
    return () => {
      if (previewBlobRef.current) {
        URL.revokeObjectURL(previewBlobRef.current);
        previewBlobRef.current = null;
      }
    };
  }, []);

  const reset = useCallback(() => {
    assignFile(null);
    setAnalysis(null);
    setDetector(null);
    setError(null);
    setCopied(false);
  }, [assignFile]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer.files?.[0];
      if (f) {
        assignFile(f);
        setAnalysis(null);
        setDetector(null);
        setError(null);
      }
    },
    [assignFile]
  );

  const analyze = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setAnalysis(null);
    setDetector(null);
    setCopied(false);
    try {
      const { analysis: nextAnalysis, detector: nextDetector } =
        await analyzeFileLocally(file);
      setAnalysis(nextAnalysis);
      setDetector(nextDetector);
      setStats((s) => mergeStats(s, nextAnalysis.syntheticLabel));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }, [file]);

  const copyPrompt = useCallback(async () => {
    if (!analysis) return;
    await navigator.clipboard.writeText(analysis.promptSuggestion);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [analysis]);

  const pct = sessionOutcomePercents(stats);

  return (
    <div className="relative min-h-full text-zinc-100">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-32 top-20 h-[26rem] w-[26rem] rounded-full bg-violet-600/14 blur-[100px]" />
        <div className="absolute -right-24 top-1/4 h-[22rem] w-[22rem] rounded-full bg-blue-600/10 blur-[90px]" />
        <div className="absolute bottom-0 left-1/4 h-72 w-72 rounded-full bg-cyan-500/10 blur-[100px]" />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <header className="relative pt-8 sm:pt-11">
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 h-[min(100vw,32rem)] w-[min(100vw,32rem)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-violet-600/15 via-transparent to-cyan-500/10 blur-3xl"
          />
          <div className="relative mx-auto flex max-w-3xl flex-col items-center text-center">
            <h1 className="font-sans text-[clamp(2rem,8vw,3.75rem)] font-bold leading-[0.95] tracking-[-0.04em]">
              <span className="bg-gradient-to-br from-white via-white to-cyan-200/90 bg-clip-text text-transparent">
                AI Generated Media Detector
              </span>
            </h1>
            <p className="mt-4 max-w-2xl text-pretty text-sm leading-relaxed text-zinc-400 sm:mt-5 sm:text-base sm:leading-relaxed">
              Inspect pixel and metadata clues in photos or video. Results are
              heuristic and do not verify authenticity. Get a score, a verdict, and a full breakdown, all processed
              locally in your browser.
            </p>
          </div>
        </header>

        <section
          className="relative mx-auto mt-8 max-w-4xl sm:mt-10"
          aria-label="Session statistics"
        >
          <div className="rounded-2xl border border-white/[0.085] bg-zinc-900/35 p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset,0_24px_64px_-32px_rgba(0,0,0,0.65)] backdrop-blur-md sm:p-5">
            <h2 className="border-b border-white/[0.07] pb-3 text-center text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
              This visit
            </h2>
            <div className="mt-3 grid grid-cols-2 items-start gap-2 sm:mt-4 sm:grid-cols-4 sm:gap-3">
              <div className="rounded-lg border border-white/[0.08] bg-black/35 px-3 py-2.5 text-center sm:rounded-xl sm:px-3.5 sm:py-3">
                <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-zinc-500 sm:text-[10px]">
                  Scanned
                </p>
                <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-white sm:text-2xl">
                  {stats.total}
                </p>
              </div>
              <div className="rounded-lg border border-emerald-500/30 bg-black/35 px-3 py-2.5 text-center sm:rounded-xl sm:px-3.5 sm:py-3">
                <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-emerald-400/90 sm:text-[10px]">
                  Lean human
                </p>
                <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-emerald-300 sm:text-2xl">
                  {pct.human}%
                </p>
              </div>
              <div className="rounded-lg border border-amber-400/35 bg-black/35 px-3 py-2.5 text-center sm:rounded-xl sm:px-3.5 sm:py-3">
                <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-amber-300/95 sm:text-[10px]">
                  Uncertain
                </p>
                <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-amber-200 sm:text-2xl">
                  {pct.uncertain}%
                </p>
              </div>
              <div className="rounded-lg border border-fuchsia-400/35 bg-black/35 px-3 py-2.5 text-center sm:rounded-xl sm:px-3.5 sm:py-3">
                <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-fuchsia-300/95 sm:text-[10px]">
                  Lean AI
                </p>
                <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-fuchsia-200 sm:text-2xl">
                  {pct.synthetic}%
                </p>
              </div>
            </div>
          </div>
        </section>

        <div className="mx-auto mt-8 flex max-w-4xl flex-col gap-8 pb-20 sm:mt-10">
          <section aria-label="Upload media">
            <div className="overflow-hidden rounded-2xl border border-white/[0.085] bg-zinc-900/35 shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset,0_24px_64px_-32px_rgba(0,0,0,0.65)] backdrop-blur-md sm:rounded-3xl">
              <h2 className="border-b border-white/[0.07] py-3 text-center text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
                Source
              </h2>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDrop}
                className="group relative flex min-h-[240px] flex-col p-5 sm:min-h-[260px] sm:p-6"
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      assignFile(f);
                      setAnalysis(null);
                      setDetector(null);
                      setError(null);
                    }
                    e.target.value = "";
                  }}
                />

                {!file ? (
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/[0.18] bg-black/30 px-4 py-10 text-center transition group-hover:bg-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0b] sm:gap-4 sm:py-12"
                  >
                    <p className="text-lg font-semibold text-white">
                      Drop an image or video
                    </p>
                    <p className="text-sm text-zinc-500">
                      or click to browse · videos use sampled frames
                    </p>
                  </button>
                ) : (
                  <div className="flex flex-1 flex-col gap-4">
                    <div className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-black/50 sm:rounded-2xl">
                      {previewUrl &&
                        (file.type.startsWith("video/") ||
                        videoExtensions.test(file.name) ? (
                          <video
                            src={previewUrl}
                            controls
                            className="max-h-[280px] w-full object-contain"
                          />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={previewUrl}
                            alt="Preview"
                            className="max-h-[280px] w-full object-contain"
                          />
                        ))}
                      <button
                        type="button"
                        onClick={reset}
                        aria-label="Remove file"
                        className="absolute right-3 top-3 rounded-full bg-black/70 px-2.5 py-1 text-xs font-medium text-white ring-1 ring-white/20 backdrop-blur-md hover:bg-black/90"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={analyze}
                        disabled={busy}
                        className="inline-flex flex-1 items-center justify-center rounded-xl bg-gradient-to-r from-fuchsia-600 to-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-fuchsia-950/45 ring-1 ring-white/10 transition hover:from-fuchsia-500 hover:to-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busy ? "Analyzing…" : "Run scan"}
                      </button>
                      <button
                        type="button"
                        onClick={() => inputRef.current?.click()}
                        disabled={busy}
                        className="rounded-xl border border-white/15 bg-white/[0.06] px-4 py-3 text-sm font-medium text-zinc-200 hover:bg-white/10 disabled:opacity-50"
                      >
                        Replace
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {error && (
                <p className="mx-5 mb-5 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100 sm:mx-6 sm:mb-6">
                  {error}
                </p>
              )}
            </div>
          </section>

          <section aria-label="Analysis results">
            <div className="overflow-hidden rounded-2xl border border-white/[0.085] bg-zinc-900/35 shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset,0_24px_64px_-32px_rgba(0,0,0,0.65)] backdrop-blur-md sm:rounded-3xl">
              <h2 className="border-b border-white/[0.07] py-3 text-center text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
                Analysis
              </h2>
              <div className="p-5 sm:p-6">
              {!analysis ? (
                <div className="flex min-h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.18] bg-zinc-900/40 px-6 py-8 text-center sm:min-h-[260px] sm:rounded-3xl sm:px-8 sm:py-10">
                  <p className="max-w-sm text-base font-semibold tracking-tight text-zinc-200 sm:text-lg">
                    Results appear here after you run a scan.
                  </p>
                  <p className="mt-2 max-w-xs text-sm text-zinc-500">
                    Upload a photo or video to get started.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-6">
                  <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h2 className="text-xl font-semibold tracking-tight text-white">
                          {analysis.title}
                        </h2>
                        <span
                          className={`mt-3 inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ${labelDisplay(analysis.syntheticLabel).className}`}
                        >
                          {labelDisplay(analysis.syntheticLabel).text}
                        </span>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] uppercase tracking-wider text-zinc-500">
                          Heuristic score
                        </p>
                        <p className="text-3xl font-semibold tabular-nums text-white">
                          {analysis.syntheticScore}
                          <span className="text-lg text-zinc-500">/100</span>
                        </p>
                        <p className="mt-3 text-[10px] uppercase tracking-wider text-zinc-500">
                          Signal agreement
                        </p>
                        <p className="text-lg font-semibold tabular-nums text-zinc-200">
                          {analysis.verdictConfidence}
                          <span className="text-sm text-zinc-500">/100</span>
                        </p>
                      </div>
                    </div>
                    <div className="mt-5 h-2 overflow-hidden rounded-full bg-black/50 ring-1 ring-white/10">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-amber-400 to-rose-500 transition-all duration-500"
                        style={{ width: `${analysis.syntheticScore}%` }}
                      />
                    </div>
                    {detector?.provider === "local" && (
                      <div className="mt-5 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-sm">
                        <p className="font-semibold text-cyan-200">
                          Detection summary
                        </p>
                        <p className="mt-2 text-[13px] leading-relaxed text-cyan-100/90">
                          Heuristic index: {detector.signalScore}/100. This is not a
                          calibrated probability. {" · "}
                          {detector.frameCount} frame
                          {detector.frameCount === 1 ? "" : "s"} sampled
                          {detector.topSource &&
                            detector.topSource !== "none" && (
                              <>
                                {" · "}
                                Metadata:{" "}
                                <code className="rounded bg-black/25 px-1 py-0.5 text-xs text-cyan-100">
                                  {detector.topSource}
                                </code>
                              </>
                            )}
                        </p>
                        {detector.provenanceHint && (
                          <p className="mt-2 text-xs leading-relaxed text-cyan-200/65">
                            {detector.provenanceHint}
                          </p>
                        )}
                      </div>
                    )}
                    <p className="mt-5 text-sm leading-relaxed text-zinc-400">
                      {analysis.description}
                    </p>
                  </div>

                  <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-6 backdrop-blur-sm">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
                      In plain English
                    </h3>
                    <p className="mt-4 text-[15px] leading-7 text-zinc-200">
                      {analysis.plainEnglishSummary}
                    </p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-3xl border border-emerald-500/25 bg-emerald-500/[0.07] p-6">
                      <h3 className="text-sm font-semibold uppercase tracking-wider text-emerald-200/95">
                        Authentic signals
                      </h3>
                      <ul className="mt-4 space-y-3 text-sm leading-relaxed text-emerald-100/90">
                        {analysis.evidenceForAuthentic.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-3xl border border-rose-500/25 bg-rose-500/[0.07] p-6">
                      <h3 className="text-sm font-semibold uppercase tracking-wider text-rose-200/95">
                        AI / editing signals
                      </h3>
                      <ul className="mt-4 space-y-3 text-sm leading-relaxed text-rose-100/90">
                        {analysis.evidenceForSynthetic.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-sm">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
                      Detailed breakdown
                    </h3>
                    <div className="mt-5 space-y-4 text-[15px] leading-8 text-zinc-300">
                      {analysis.reasoning
                        .split(/\n\s*\n/)
                        .filter(Boolean)
                        .map((para, i) => (
                          <p key={i}>{para.trim()}</p>
                        ))}
                    </div>
                  </div>

                  <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-sm">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
                        Generative prompt
                      </h3>
                      <button
                        type="button"
                        onClick={copyPrompt}
                        className="rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-white/10"
                      >
                        {copied ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <p className="mt-4 rounded-2xl border border-white/10 bg-black/35 p-4 font-mono text-sm leading-relaxed text-zinc-200">
                      {analysis.promptSuggestion}
                    </p>
                  </div>

                  <div className="rounded-3xl border border-violet-500/20 bg-violet-500/[0.06] p-6 backdrop-blur-sm">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-violet-200/95">
                      Pixel level checklist
                    </h3>
                    <ul className="mt-4 space-y-2.5 text-sm leading-relaxed text-zinc-300">
                      {analysis.visualCues.map((c, i) => (
                        <li
                          key={i}
                          className="border-b border-white/5 pb-2.5 last:border-0 last:pb-0"
                        >
                          {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
