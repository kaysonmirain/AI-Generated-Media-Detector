import type { MediaAnalysis } from "@/lib/analysis";

const videoExtensions = /\.(mp4|webm|mov|m4v|mkv)$/i;

type FrameMetrics = {
  width: number;
  height: number;
  sampleWidth: number;
  sampleHeight: number;
  meanLuma: number;
  contrast: number;
  meanSaturation: number;
  saturationStd: number;
  edgeMean: number;
  highEdgeRatio: number;
  smoothRatio: number;
  noiseResidual: number;
  posterizedBins: number;
  blockBoundaryRatio: number;
  highlightRatio: number;
  shadowRatio: number;
  channelCorrelation: number;
  blockVarianceMean: number;
  elaMean: number;
  elaUniformity: number;
};

type MetadataSignals = {
  hasExif: boolean;
  hasXmp: boolean;
  hasC2pa: boolean;
  hasCameraMake: boolean;
  generatorHints: string[];
  editingHints: string[];
};

export type LocalDetectorPayload = {
  provider: "local";
  aiProbability: number;
  humanProbability: number;
  topSource: string | null;
  provenanceHint: string | null;
  frameCount: number;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function round(n: number, places = 1) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function std(values: number[]) {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      values.length
  );
}

function pearson(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const meanA = average(a);
  const meanB = average(b);
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den ? num / den : 0;
}

function pushUnique(target: string[], item: string) {
  if (!target.includes(item)) target.push(item);
}

function saturation(r: number, g: number, b: number) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  if (max === 0) return 0;
  return (max - min) / max;
}

function computeFrameMetrics(
  imageData: ImageData,
  originalWidth: number,
  originalHeight: number,
  ela: { elaMean: number; elaUniformity: number }
): FrameMetrics {
  const { width, height, data } = imageData;
  const pixels = width * height;
  const luma = new Float32Array(pixels);
  const sats = new Float32Array(pixels);
  const hist = new Uint32Array(64);
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  let lumaSum = 0;
  let satSum = 0;
  let highlights = 0;
  let shadows = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const s = saturation(r, g, b);
    luma[p] = y;
    sats[p] = s;
    lumaSum += y;
    satSum += s;
    hist[clamp(Math.floor(y / 4), 0, 63)]++;
    if (y > 242) highlights++;
    if (y < 12) shadows++;
    if (p % 4 === 0) {
      rs.push(r);
      gs.push(g);
      bs.push(b);
    }
  }

  const meanLuma = lumaSum / pixels;
  const meanSaturation = satSum / pixels;
  let variance = 0;
  let saturationVariance = 0;
  for (let i = 0; i < pixels; i++) {
    variance += (luma[i] - meanLuma) ** 2;
    saturationVariance += (sats[i] - meanSaturation) ** 2;
  }

  let edgeSum = 0;
  let edgeCount = 0;
  let highEdges = 0;
  let smoothEdges = 0;
  let boundaryDiff = 0;
  let boundaryCount = 0;
  let nonBoundaryDiff = 0;
  let nonBoundaryCount = 0;
  let residualSum = 0;
  let residualCount = 0;
  const blockSize = 8;
  const blockVariances: number[] = [];

  for (let by = 0; by < height; by += blockSize) {
    for (let bx = 0; bx < width; bx += blockSize) {
      let blockSum = 0;
      let blockCount = 0;
      let blockVarSum = 0;
      for (let y = by; y < Math.min(by + blockSize, height); y++) {
        for (let x = bx; x < Math.min(bx + blockSize, width); x++) {
          blockSum += luma[y * width + x];
          blockCount++;
        }
      }
      const blockMean = blockCount ? blockSum / blockCount : 0;
      for (let y = by; y < Math.min(by + blockSize, height); y++) {
        for (let x = bx; x < Math.min(bx + blockSize, width); x++) {
          blockVarSum += (luma[y * width + x] - blockMean) ** 2;
        }
      }
      if (blockCount > 1) blockVariances.push(blockVarSum / blockCount);
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (x + 1 < width) {
        const diff = Math.abs(luma[i] - luma[i + 1]);
        edgeSum += diff;
        edgeCount++;
        if (diff > 34) highEdges++;
        if (diff < 3) smoothEdges++;
        if ((x + 1) % 8 === 0) {
          boundaryDiff += diff;
          boundaryCount++;
        } else {
          nonBoundaryDiff += diff;
          nonBoundaryCount++;
        }
      }
      if (y + 1 < height) {
        const diff = Math.abs(luma[i] - luma[i + width]);
        edgeSum += diff;
        edgeCount++;
        if (diff > 34) highEdges++;
        if (diff < 3) smoothEdges++;
        if ((y + 1) % 8 === 0) {
          boundaryDiff += diff;
          boundaryCount++;
        } else {
          nonBoundaryDiff += diff;
          nonBoundaryCount++;
        }
      }
      if (x > 0 && x + 1 < width && y > 0 && y + 1 < height) {
        const residual = Math.abs(
          4 * luma[i] -
            luma[i - 1] -
            luma[i + 1] -
            luma[i - width] -
            luma[i + width]
        );
        residualSum += residual;
        residualCount++;
      }
    }
  }

  const populatedBins = Array.from(hist).filter((count) => count > 0).length;
  const boundaryAvg = boundaryCount ? boundaryDiff / boundaryCount : 0;
  const nonBoundaryAvg = nonBoundaryCount
    ? nonBoundaryDiff / nonBoundaryCount
    : 1;

  const channelCorrelation = average([
    Math.abs(pearson(rs, gs)),
    Math.abs(pearson(gs, bs)),
    Math.abs(pearson(rs, bs)),
  ]);

  return {
    width: originalWidth,
    height: originalHeight,
    sampleWidth: width,
    sampleHeight: height,
    meanLuma,
    contrast: Math.sqrt(variance / pixels),
    meanSaturation,
    saturationStd: Math.sqrt(saturationVariance / pixels),
    edgeMean: edgeCount ? edgeSum / edgeCount : 0,
    highEdgeRatio: edgeCount ? highEdges / edgeCount : 0,
    smoothRatio: edgeCount ? smoothEdges / edgeCount : 0,
    noiseResidual: residualCount ? residualSum / residualCount : 0,
    posterizedBins: populatedBins,
    blockBoundaryRatio: boundaryAvg / Math.max(0.01, nonBoundaryAvg),
    highlightRatio: highlights / pixels,
    shadowRatio: shadows / pixels,
    channelCorrelation,
    blockVarianceMean: blockVariances.length
      ? average(blockVariances)
      : 0,
    elaMean: ela.elaMean,
    elaUniformity: ela.elaUniformity,
  };
}

async function computeEla(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { elaMean: 0, elaUniformity: 0 };

  const original = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("ELA recompression failed"));
    img.src = dataUrl;
  });

  const replay = document.createElement("canvas");
  replay.width = canvas.width;
  replay.height = canvas.height;
  const replayCtx = replay.getContext("2d", { willReadFrequently: true });
  if (!replayCtx) return { elaMean: 0, elaUniformity: 0 };

  replayCtx.drawImage(img, 0, 0);
  const recompressed = replayCtx.getImageData(0, 0, canvas.width, canvas.height);
  const diffs: number[] = [];

  for (let i = 0; i < original.data.length; i += 4) {
    diffs.push(
      (Math.abs(original.data[i] - recompressed.data[i]) +
        Math.abs(original.data[i + 1] - recompressed.data[i + 1]) +
        Math.abs(original.data[i + 2] - recompressed.data[i + 2])) /
        3
    );
  }

  const elaMean = average(diffs);
  const elaStd = std(diffs);
  return {
    elaMean,
    elaUniformity: elaMean > 0 ? elaStd / elaMean : 0,
  };
}

async function metricsFromCanvas(
  canvas: HTMLCanvasElement,
  originalWidth: number,
  originalHeight: number
) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas analysis is not available in this browser");
  const ela = await computeEla(canvas);
  return computeFrameMetrics(
    ctx.getImageData(0, 0, canvas.width, canvas.height),
    originalWidth,
    originalHeight,
    ela
  );
}

function makeCanvas(width: number, height: number) {
  const maxSide = 640;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  return canvas;
}

async function imageMetrics(file: File): Promise<FrameMetrics[]> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = makeCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas analysis is not available in this browser");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return [await metricsFromCanvas(canvas, bitmap.width, bitmap.height)];
  } finally {
    bitmap.close();
  }
}

async function videoMetrics(file: File, count: number): Promise<FrameMetrics[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = "anonymous";

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("Could not load video"));
    });

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) throw new Error("Video has no drawable dimensions");

    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas analysis is not available in this browser");

    const duration = video.duration;
    const usable = Number.isFinite(duration) && duration > 0 ? duration : 1;
    const frames: FrameMetrics[] = [];
    const n = Math.max(1, count);

    for (let i = 0; i < n; i++) {
      const t =
        n === 1
          ? Math.min(0.5, usable * 0.1)
          : usable * (0.08 + (0.84 * i) / (n - 1));
      video.currentTime = Math.min(t, Math.max(0, usable - 0.05));
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener("seeked", onSeeked);
          resolve();
        };
        video.addEventListener("seeked", onSeeked);
      });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(await metricsFromCanvas(canvas, width, height));
    }

    return frames;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function readMetadataSignals(file: File): Promise<MetadataSignals> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hasExif = findAscii(bytes, "Exif");
  const hasXmp = findAscii(bytes, "xmpmeta") || findAscii(bytes, "XMP");
  const hasC2pa =
    findAscii(bytes, "c2pa") || findAscii(bytes, "ContentCredentials");
  const hasCameraMake =
    findAscii(bytes, "Make") &&
    (findAscii(bytes, "Canon") ||
      findAscii(bytes, "NIKON") ||
      findAscii(bytes, "SONY") ||
      findAscii(bytes, "Apple") ||
      findAscii(bytes, "samsung") ||
      findAscii(bytes, "FUJIFILM") ||
      findAscii(bytes, "Panasonic") ||
      findAscii(bytes, "OLYMPUS"));
  const text = new TextDecoder("latin1")
    .decode(bytes.slice(0, Math.min(bytes.length, 5_000_000)))
    .toLowerCase();

  const generatorNeedles = [
    ["Midjourney", "midjourney"],
    ["DALL-E", "dall-e"],
    ["Stable Diffusion", "stable diffusion"],
    ["Adobe Firefly", "firefly"],
    ["ComfyUI", "comfyui"],
    ["AUTOMATIC1111", "automatic1111"],
    ["InvokeAI", "invokeai"],
    ["NovelAI", "novelai"],
    ["Leonardo", "leonardo.ai"],
    ["Stability AI", "stability.ai"],
    ["Flux", "black-forest-labs"],
    ["Ideogram", "ideogram"],
    ["Runway", "runway ml"],
    ["Sora", "sora"],
    ["Kling", "kling"],
    ["Pika", "pika labs"],
    ["Seedream", "seedream"],
    ["Imagen", "imagen"],
    ["Prompt metadata", "negative prompt"],
    ["CFG scale", "cfg scale"],
    ["DreamStudio", "dreamstudio"],
  ] as const;

  const editingNeedles = [
    ["Photoshop", "photoshop"],
    ["Lightroom", "lightroom"],
    ["Capture One", "capture one"],
    ["GIMP", "gimp"],
  ] as const;

  return {
    hasExif,
    hasXmp,
    hasC2pa,
    hasCameraMake,
    generatorHints: generatorNeedles
      .filter(([, needle]) => text.includes(needle))
      .map(([label]) => label),
    editingHints: editingNeedles
      .filter(([, needle]) => text.includes(needle))
      .map(([label]) => label),
  };
}

function findAscii(bytes: Uint8Array, needle: string) {
  const codes = Array.from(needle, (char) => char.charCodeAt(0));
  outer: for (let i = 0; i <= bytes.length - codes.length; i++) {
    for (let j = 0; j < codes.length; j++) {
      if (bytes[i + j] !== codes[j]) continue outer;
    }
    return true;
  }
  return false;
}

type AggregatedMetrics = ReturnType<typeof aggregate>;

function aggregate(frames: FrameMetrics[]) {
  return {
    width: frames[0]?.width ?? 0,
    height: frames[0]?.height ?? 0,
    meanLuma: average(frames.map((f) => f.meanLuma)),
    contrast: average(frames.map((f) => f.contrast)),
    meanSaturation: average(frames.map((f) => f.meanSaturation)),
    saturationStd: average(frames.map((f) => f.saturationStd)),
    edgeMean: average(frames.map((f) => f.edgeMean)),
    highEdgeRatio: average(frames.map((f) => f.highEdgeRatio)),
    smoothRatio: average(frames.map((f) => f.smoothRatio)),
    noiseResidual: average(frames.map((f) => f.noiseResidual)),
    posterizedBins: average(frames.map((f) => f.posterizedBins)),
    blockBoundaryRatio: average(frames.map((f) => f.blockBoundaryRatio)),
    highlightRatio: average(frames.map((f) => f.highlightRatio)),
    shadowRatio: average(frames.map((f) => f.shadowRatio)),
    channelCorrelation: average(frames.map((f) => f.channelCorrelation)),
    blockVarianceMean: average(frames.map((f) => f.blockVarianceMean)),
    elaMean: average(frames.map((f) => f.elaMean)),
    elaUniformity: average(frames.map((f) => f.elaUniformity)),
    temporalVariance: std(frames.map((f) => f.edgeMean + f.contrast)),
    frameScoreSpread: std(
      frames.map((f) => quickFrameAiScore(f))
    ),
  };
}

function quickFrameAiScore(f: FrameMetrics) {
  let s = 50;
  if (f.smoothRatio > 0.5) s += 15;
  if (f.noiseResidual < 6) s += 10;
  if (f.channelCorrelation > 0.94) s += 8;
  if (f.blockVarianceMean < 18) s += 8;
  if (f.elaUniformity < 0.55) s += 6;
  return s;
}

function textureSubscore(m: AggregatedMetrics) {
  let score = 50;
  if (m.smoothRatio > 0.62) score += 22;
  else if (m.smoothRatio > 0.48) score += 12;
  else if (m.smoothRatio < 0.32) score -= 14;

  if (m.noiseResidual < 4.5) score += 16;
  else if (m.noiseResidual < 7) score += 8;
  else if (m.noiseResidual > 18) score -= 12;
  else if (m.noiseResidual > 14) score -= 6;

  if (m.blockVarianceMean < 12) score += 14;
  else if (m.blockVarianceMean < 22) score += 6;
  else if (m.blockVarianceMean > 45) score -= 10;

  if (m.posterizedBins < 28) score += 10;
  else if (m.posterizedBins > 52) score -= 8;

  if (m.edgeMean < 4 && m.highEdgeRatio < 0.01) score += 8;
  else if (m.edgeMean > 10 && m.highEdgeRatio > 0.04) score -= 8;

  return clamp(score, 0, 100);
}

function colorSubscore(m: AggregatedMetrics) {
  let score = 50;
  if (m.channelCorrelation > 0.96) score += 18;
  else if (m.channelCorrelation > 0.93) score += 10;
  else if (m.channelCorrelation < 0.85) score -= 8;

  if (m.meanSaturation > 0.48 && m.saturationStd < 0.15) score += 10;
  else if (m.saturationStd > 0.28) score -= 5;

  return clamp(score, 0, 100);
}

function elaSubscore(m: AggregatedMetrics) {
  let score = 50;
  if (m.elaMean < 2.2 && m.elaUniformity < 0.5) score += 16;
  else if (m.elaUniformity < 0.62) score += 8;
  else if (m.elaUniformity > 1.1) score -= 10;
  else if (m.elaMean > 8) score -= 6;
  return clamp(score, 0, 100);
}

function metadataSubscore(metadata: MetadataSignals) {
  if (metadata.generatorHints.length) return 94;
  let score = 50;
  if (metadata.hasCameraMake) score -= 22;
  else if (metadata.hasExif) score -= 12;
  else score += 8;
  if (metadata.hasC2pa) score -= 10;
  return clamp(score, 0, 100);
}

function compressionSubscore(m: AggregatedMetrics) {
  let score = 50;
  if (m.blockBoundaryRatio > 1.4) score -= 6;
  if (m.highlightRatio > 0.18 || m.shadowRatio > 0.2) score += 4;
  return clamp(score, 0, 100);
}

function temporalSubscore(m: AggregatedMetrics, mediaType: "image" | "video") {
  if (mediaType !== "video") return 50;
  if (m.temporalVariance < 0.9) return 68;
  if (m.temporalVariance < 1.5) return 58;
  if (m.temporalVariance > 4) return 32;
  return 45;
}

function scoreLocalSignals(
  frames: FrameMetrics[],
  metadata: MetadataSignals,
  mediaType: "image" | "video"
) {
  const m = aggregate(frames);
  const authentic: string[] = [];
  const synthetic: string[] = [];
  const caveats: string[] = [];

  const texture = textureSubscore(m);
  const color = colorSubscore(m);
  const ela = elaSubscore(m);
  const meta = metadataSubscore(metadata);
  const compression = compressionSubscore(m);
  const temporal = temporalSubscore(m, mediaType);

  const hasGenerator = metadata.generatorHints.length > 0;
  const weights = hasGenerator
    ? { texture: 0.2, color: 0.1, ela: 0.15, meta: 0.35, compression: 0.08, temporal: mediaType === "video" ? 0.12 : 0 }
    : { texture: 0.28, color: 0.14, ela: 0.2, meta: 0.14, compression: 0.1, temporal: mediaType === "video" ? 0.14 : 0 };

  const weightSum =
    weights.texture +
    weights.color +
    weights.ela +
    weights.meta +
    weights.compression +
    weights.temporal;

  let score = Math.round(
    (texture * weights.texture +
      color * weights.color +
      ela * weights.ela +
      meta * weights.meta +
      compression * weights.compression +
      temporal * weights.temporal) /
      weightSum
  );

  let confidence = 50 + Math.abs(score - 50) * 0.65;

  if (hasGenerator) {
    confidence = Math.max(confidence, 88);
    pushUnique(
      synthetic,
      `Embedded metadata mentions ${metadata.generatorHints.join(", ")}.`
    );
  }

  if (metadata.hasCameraMake) {
    score = Math.min(score, 38);
    confidence = Math.max(confidence, 72);
    pushUnique(
      authentic,
      "Camera manufacturer metadata (Make/Model) was found, strongly suggesting a real device capture."
    );
  } else if (metadata.hasExif) {
    score -= 6;
    confidence += 5;
    pushUnique(
      authentic,
      "EXIF camera metadata is present, which is common in phone and camera photos."
    );
  } else {
    score += 4;
    pushUnique(
      synthetic,
      "No EXIF camera metadata was found (many apps strip this, so it is only a weak signal)."
    );
  }

  if (metadata.hasC2pa) {
    score = Math.min(score, 42);
    confidence += 6;
    pushUnique(
      authentic,
      "C2PA content credentials appear present, supporting provenance when intact."
    );
  }

  if (metadata.editingHints.length) {
    confidence -= 4;
    pushUnique(
      caveats,
      `Editing software metadata (${metadata.editingHints.join(", ")}) may have altered pixel signals.`
    );
  }

  if (m.smoothRatio > 0.58) {
    pushUnique(
      synthetic,
      "Large regions show ultra-smooth pixel transitions, typical of generated or heavily denoised media."
    );
  } else if (m.smoothRatio < 0.35) {
    pushUnique(
      authentic,
      "Micro-texture is preserved across the frame rather than looking uniformly smoothed."
    );
  }

  if (m.noiseResidual < 5.5) {
    pushUnique(
      synthetic,
      "High-frequency sensor noise is unusually low for a typical camera capture."
    );
  } else if (m.noiseResidual > 16) {
    pushUnique(
      authentic,
      "Fine-grain residual detail matches many real camera sensor pipelines."
    );
  }

  if (m.channelCorrelation > 0.94) {
    pushUnique(
      synthetic,
      "RGB color channels are highly correlated, a pattern common in diffusion-model output."
    );
  } else if (m.channelCorrelation < 0.86) {
    pushUnique(
      authentic,
      "Color channels show independent variation consistent with optical capture."
    );
  }

  if (m.blockVarianceMean < 14) {
    pushUnique(
      synthetic,
      "Local 8×8 block variance is low, suggesting rendered or over-smoothed surfaces."
    );
  } else if (m.blockVarianceMean > 40) {
    pushUnique(
      authentic,
      "Local block variance is healthy, indicating natural surface detail."
    );
  }

  if (m.elaUniformity < 0.58) {
    pushUnique(
      synthetic,
      "Recompression error (ELA) is unusually uniform, often seen in natively digital AI images."
    );
  } else if (m.elaUniformity > 1.05) {
    pushUnique(
      authentic,
      "Recompression error varies naturally across the frame like a photographed JPEG."
    );
  }

  if (m.posterizedBins < 30) {
    pushUnique(
      synthetic,
      "The luminance histogram uses few tone bands, suggesting rendering or heavy filtering."
    );
  }

  if (m.blockBoundaryRatio > 1.35) {
    confidence -= 8;
    pushUnique(
      caveats,
      "Visible JPEG block boundaries may hide or mimic AI artifacts."
    );
  }

  if (m.highlightRatio > 0.16 || m.shadowRatio > 0.18) {
    confidence -= 5;
    pushUnique(
      caveats,
      "Heavy highlight or shadow clipping reduces pixel-level signal reliability."
    );
  }

  if (mediaType === "video") {
    if (m.temporalVariance < 1.1) {
      pushUnique(
        synthetic,
        "Sampled frames are statistically very similar — possible rendered or low-motion clip."
      );
    } else {
      pushUnique(
        authentic,
        "Sampled frames vary in texture and contrast over time."
      );
    }
    if (m.frameScoreSpread > 12) {
      confidence -= 8;
      pushUnique(
        caveats,
        "Individual video frames disagreed on AI signals, lowering overall confidence."
      );
    }
  }

  score = clamp(score, 0, 100);
  confidence = clamp(
    Math.round(confidence),
    20,
    hasGenerator || metadata.hasCameraMake ? 94 : 88
  );

  if (score > 38 && score < 62) confidence = Math.min(confidence, 62);

  while (authentic.length < 2) {
    pushUnique(
      authentic,
      "No single signal is decisive on its own; texture and metadata were weighed together."
    );
  }
  while (synthetic.length < 2) {
    pushUnique(
      synthetic,
      "No embedded generator signature was found in scanned metadata."
    );
  }

  return { score, confidence, metrics: m, authentic, synthetic, caveats };
}

function labelFromScore(
  score: number,
  confidence: number
): MediaAnalysis["syntheticLabel"] {
  if (confidence < 55) return "uncertain";
  if (score <= 36) return "likely_human";
  if (score >= 64) return "likely_synthetic";
  return "uncertain";
}

function tonePhrase(metrics: AggregatedMetrics) {
  const contrast =
    metrics.contrast > 58
      ? "high-contrast"
      : metrics.contrast < 32
        ? "soft-contrast"
        : "moderate-contrast";
  const color =
    metrics.meanSaturation > 0.4
      ? "color-rich"
      : metrics.meanSaturation < 0.18
        ? "muted"
        : "natural-color";
  const texture =
    metrics.noiseResidual > 16
      ? "fine-grained"
      : metrics.smoothRatio > 0.5
        ? "smooth"
        : "lightly textured";
  return `${contrast}, ${color}, ${texture}`;
}

export async function analyzeFileLocally(file: File): Promise<{
  analysis: MediaAnalysis;
  detector: LocalDetectorPayload;
}> {
  const mediaType: "image" | "video" =
    file.type.startsWith("video/") || videoExtensions.test(file.name)
      ? "video"
      : "image";
  const [frames, metadata] = await Promise.all([
    mediaType === "video" ? videoMetrics(file, 6) : imageMetrics(file),
    readMetadataSignals(file),
  ]);
  const result = scoreLocalSignals(frames, metadata, mediaType);
  const label = labelFromScore(result.score, result.confidence);
  const dims = `${result.metrics.width}x${result.metrics.height}`;
  const frameText =
    mediaType === "video"
      ? `${frames.length} sampled video frames`
      : "the uploaded image";
  const caveatText = result.caveats.length
    ? ` ${result.caveats.join(" ")}`
    : "";
  const sourceHint = metadata.generatorHints[0] ?? null;
  const provenanceHint = metadata.hasC2pa
    ? "C2PA content credentials appear in the file."
    : metadata.hasXmp
      ? "XMP metadata is present but does not prove origin alone."
      : null;

  const analysis: MediaAnalysis = {
    title:
      label === "likely_synthetic"
        ? "Scan Leans AI Generated"
        : label === "likely_human"
          ? "Scan Leans Authentic"
          : "Scan Is Inconclusive",
    description: `AI Generated Media Detector analyzed ${frameText} locally in your browser to estimate how likely the file is AI generated vs a real capture. Signals include texture statistics, RGB channel correlation, recompression error (ELA), block variance, and embedded metadata. Dimensions: ${dims}. No data leaves your device.`,
    promptSuggestion: `${mediaType === "video" ? "Short video" : "Photo"} reference with a ${tonePhrase(result.metrics)} look, natural lighting, coherent edges, visible material texture, balanced shadows and highlights, realistic camera detail, documentary composition`,
    syntheticScore: result.score,
    syntheticLabel: label,
    verdictConfidence: result.confidence,
    plainEnglishSummary:
      label === "likely_synthetic"
        ? `Multiple pixel and metadata signals point toward AI generation or heavy processing. Score ${result.score}/100, confidence ${result.confidence}/100.${caveatText}`
        : label === "likely_human"
          ? `Texture, color channels, and metadata look consistent with a real camera capture. Score ${result.score}/100, confidence ${result.confidence}/100.${caveatText}`
          : `Signals are mixed. The scan cannot confidently classify this file. Score ${result.score}/100, confidence ${result.confidence}/100.${caveatText}`,
    evidenceForAuthentic: result.authentic.slice(0, 7),
    evidenceForSynthetic: result.synthetic.slice(0, 7),
    reasoning: `Local ensemble analysis sampled ${frameText} and computed forensic style metrics: smoothness (${round(result.metrics.smoothRatio * 100)}% smooth neighbors), residual noise (${round(result.metrics.noiseResidual)}), RGB channel correlation (${round(result.metrics.channelCorrelation, 3)}), block variance (${round(result.metrics.blockVarianceMean)}), ELA uniformity (${round(result.metrics.elaUniformity, 2)}), and ${round(result.metrics.posterizedBins, 0)}/64 luminance bands. Metadata: ${metadata.hasExif ? "EXIF present" : "no EXIF"}, ${metadata.generatorHints.length ? `generator hint (${metadata.generatorHints.join(", ")})` : "no generator string"}. The synthetic score ${result.score}/100 reflects a weighted blend of texture, color, ELA, metadata, and${mediaType === "video" ? " temporal" : ""} signals. Compression, screenshots, and social media re-exports can shift scores. Borderline cases stay uncertain rather than over confident.`,
    visualCues: [
      `${dims} source dimensions`,
      `${frames.length} frame${frames.length === 1 ? "" : "s"} analyzed locally`,
      `Smooth neighbor ratio ${round(result.metrics.smoothRatio * 100)}%`,
      `Residual detail ${round(result.metrics.noiseResidual)}`,
      `RGB correlation ${round(result.metrics.channelCorrelation, 3)}`,
      `Block variance ${round(result.metrics.blockVarianceMean)}`,
      `ELA uniformity ${round(result.metrics.elaUniformity, 2)}`,
      `Edge density ${round(result.metrics.edgeMean)}`,
      `Tone bands ${round(result.metrics.posterizedBins, 0)}/64`,
      metadata.hasExif ? "EXIF metadata present" : "No EXIF metadata",
      metadata.hasCameraMake ? "Camera Make/Model found" : "No camera Make/Model",
      metadata.generatorHints.length
        ? `Generator: ${metadata.generatorHints.join(", ")}`
        : "No generator metadata",
    ],
  };

  return {
    analysis,
    detector: {
      provider: "local",
      aiProbability: result.score / 100,
      humanProbability: 1 - result.score / 100,
      topSource: sourceHint,
      provenanceHint,
      frameCount: frames.length,
    },
  };
}
