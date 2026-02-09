import express from "express";
import cors from "cors";
import multer from "multer";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

const app = express();
const PORT = process.env.PORT || 3000;

/**
 * ✅ CORS that works with CodePen
 * - origin:true reflects the request Origin (good for codepen.io + cdpn.io)
 * - app.options("*", cors()) answers ALL preflight requests
 */
app.use(cors({
  origin: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));
app.options("*", cors());

// Simple health endpoint
app.get("/health", (req, res) => res.json({ ok: true }));

// Temp dirs (Render ephemeral)
const uploadDir = path.join(os.tmpdir(), "uploads");
const outputDir = path.join(os.tmpdir(), "outputs");
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });

// Upload handling (NOTE: huge uploads may still fail due to platform/browser limits)
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 } // 2GB
});

// In-memory job store (MVP)
const jobs = new Map();

function makeId() {
  return crypto.randomBytes(10).toString("hex");
}

app.post("/api/convert", upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const jobId = makeId();
    const inputPath = req.file.path;
    const outputPath = path.join(outputDir, `${jobId}.mov`);

    const keepAudio = req.body.keepAudio !== "0";
    const copyMeta = req.body.copyMeta !== "0";

    jobs.set(jobId, { status: "processing", progress: 1, error: null, outputPath });

    // ✅ Preserve native FPS + aspect: NO -r, NO fps filters, NO scaling
    const args = [
      "-y",
      "-i", inputPath,
      "-c:v", "prores_ks",
      "-profile:v", "4444xq",
      "-pix_fmt", "yuv444p12le",
      "-vendor", "apl0"
    ];

    if (copyMeta) args.push("-map_metadata", "0");

    args.push("-map", "0:v:0");

    if (keepAudio) {
      args.push("-map", "0:a?");
      args.push("-c:a", "pcm_s24le");
    } else {
      args.push("-an");
    }

    args.push(outputPath);

    const ff = spawn("ffmpeg", args);

    // crude progress (just shows activity)
    ff.stderr.on("data", () => {
      const j = jobs.get(jobId);
      if (!j || j.status !== "processing") return;
      j.progress = Math.min(99, (j.progress || 0) + 1);
    });

    ff.on("close", (code) => {
      // cleanup input
      try { fs.unlinkSync(inputPath); } catch {}

      const j = jobs.get(jobId);
      if (!j) return;

      if (code === 0) {
        j.status = "done";
        j.progress = 100;
      } else {
        j.status = "error";
        j.error = `ffmpeg exited with code ${code}`;
        try { fs.unlinkSync(outputPath); } catch {}
      }
    });

    return res.json({ jobId });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get("/api/status/:jobId", (req, res) => {
  const j = jobs.get(req.params.jobId);
  if (!j) return res.status(404).json({ status: "error", progress: 0, error: "Not found" });
  return res.json({ status: j.status, progress: j.progress || 0, error: j.error || null });
});

app.get("/api/download/:jobId", (req, res) => {
  const j = jobs.get(req.params.jobId);
  if (!j) return res.status(404).send("Not found");
  if (j.status !== "done") return res.status(400).send("Not ready");
  return res.download(j.outputPath, `prores4444xq-${req.params.jobId}.mov`);
});

app.listen(PORT, () => console.log("API listening on", PORT));
