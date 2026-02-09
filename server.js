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

// Allow CodePen
app.use(cors({
  origin: ["https://codepen.io", "https://cdpn.io"],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

app.get("/health", (req, res) => res.json({ ok: true }));

const uploadDir = path.join(os.tmpdir(), "uploads");
const outputDir = path.join(os.tmpdir(), "outputs");
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });

const upload = multer({ dest: uploadDir });
const jobs = new Map();

const makeId = () => crypto.randomBytes(8).toString("hex");

app.post("/api/convert", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const jobId = makeId();
  const input = req.file.path;
  const output = path.join(outputDir, `${jobId}.mov`);

  jobs.set(jobId, { status: "processing", progress: 1 });

  const ff = spawn("ffmpeg", [
    "-y",
    "-i", input,
    "-c:v", "prores_ks",
    "-profile:v", "4444xq",
    "-pix_fmt", "yuv444p12le",
    "-map", "0:v:0",
    "-map", "0:a?",
    "-c:a", "pcm_s24le",
    output
  ]);

  ff.on("close", (code) => {
    try { fs.unlinkSync(input); } catch {}
    const j = jobs.get(jobId);
    if (!j) return;

    if (code === 0) {
      j.status = "done";
      j.progress = 100;
      j.output = output;
    } else {
      j.status = "error";
    }
  });

  res.json({ jobId });
});

app.get("/api/status/:id", (req, res) => {
  res.json(jobs.get(req.params.id) || { status: "error", progress: 0 });
});

app.get("/api/download/:id", (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j || j.status !== "done") return res.status(404).end();
  res.download(j.output);
});

app.listen(PORT, () => console.log("Listening on", PORT));
