# AI Generated Media Detector

Upload a photo or video and get a read on whether it looks AI-generated or like a real capture. All analysis happens in your browser — nothing gets sent to a server.

## How it was built

Next.js 16, React 19, TypeScript, and Tailwind CSS. The page is one client component: drag-and-drop upload, preview, session counters for the current visit, and a results panel with score, verdict, and breakdown.

The detector runs entirely on the client. Images go through `createImageBitmap` and onto a canvas; videos seek through a few frames and sample the same way. From the pixel data it measures things like edge smoothness, sensor-style noise, RGB channel correlation, 8×8 block variance, luminance histogram bands, and error-level analysis from JPEG recompression. It also reads raw file bytes for EXIF, C2PA, camera make/model, and strings tied to common generators (Midjourney, DALL·E, Stable Diffusion, etc.).

Each signal feeds a weighted score (0–100) with a label — likely authentic, uncertain, or likely synthetic — plus plain-language evidence on both sides and a more detailed write-up of what the scan found.

## Run it

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).
