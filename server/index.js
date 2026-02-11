import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import OpenAI from "openai";
import { z } from "zod";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// --- Simple API protection ---
// If API_TOKEN is set, require it for /api routes
app.use("/api", (req, res, next) => {
  const required = process.env.API_TOKEN;
  if (!required) return next(); // if you didn't set it, allow everything

  const got = req.get("x-api-token");
  if (got !== required) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});


const upload = multer({ storage: multer.memoryStorage() });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CheatSheet = z.object({
  company: z.string().min(1),
  bullets: z.array(z.string()).min(3).max(4),
});

function clampBullet(s) {
  return String(s).replace(/\s+/g, " ").trim().slice(0, 88);
}

app.post("/api/cheatsheet", upload.single("image"), async (req, res) => {
  try {
    const companyHint = (req.body.companyHint || "").trim();

    let imageDataUrl = null;
    if (req.file?.buffer) {
      const mime = req.file.mimetype || "image/jpeg";
      const b64 = req.file.buffer.toString("base64");
      imageDataUrl = `data:${mime};base64,${b64}`;
    }

    if (!imageDataUrl && !companyHint) {
      return res.status(400).json({ error: "Provide an image or a company name." });
    }

    const prompt = `
You are generating a compact "networking cheat sheet" for a software engineering student speaking to a booth rep.
The output must help the user START and SUSTAIN a useful conversation.

Input: An image of a booth/logo/job listing OR a company name hint.

Return JSON exactly:
{
  "company": "string",
  "bullets": ["string", "string", "string", "string"] // 3-4 items
}

Hard requirements:
- Each bullet must be <= 88 characters.
- Bullets must be HIGHLY ACTIONABLE for booth conversation.
- Maintain an embedded/firmware/robotics angle if possible
- Avoid vague filler words: "innovative", "leader", "commitment", "solutions", "powerful".
- Use concrete nouns: RTOS, C/C++, ARM, sensors, BLE, USB, FPGA, CAN, safety, etc.
- If you can't confidently infer specifics from the image, do NOT guess facts.
  Instead, output smart, specific QUESTIONS that uncover the right info.
- Do NOT include generic "nice to know" facts that don't lead to conversation. Each bullet should be a potential conversation starter or follow-up question that shows genuine interest and insight.
- make it specific to the company, do not make it generic or random, it must relate to something the company does as a service, believes in, is working towards, etc
- IMPORTANT: 2 bullets MUST be descriptions about the company that can be insightful or unique about the company: a unique fact, a project they work on, mission objective, etc. DOES NOT need to specific to my experience, but it is nice to have


Good bullet examples (style):
- "About: Apple focuses on innovation and sleekness of design to appeal to a broad audience when create devices for consumers"
- "Ask: What teams ship embedded/firmware here—device, edge, or tooling?"
- "Ask: What OS do you use, if any? Do teams build their own or use something off the shelf?"
- "Signal: I built a smartwatch with an ESP32-S3 - could this relate to any work you do here?"
- "Ask: What's a 90-day project for interns on your hardware/embedded team?"
- "About: SpaceX's Starship is designed for full reusability, aiming to reduce space travel costs and enable Mars colonization. It uses Raptor engines powered by liquid methane and liquid oxygen."
Each bullet must be true! If a company does NOT use embedded firmware, DO NOT ask or bring it up! only mention what they truly use / are seeking (which ties into the description bullets)

About Me: When possible keep questions speciifc to any work related to my experience in - 
- robotics
- c/c++ 
- embedded systems
- firmware
- hardware integration
- real-time control systems
- linux
- solidworks
- python
- opencv
- data science
- ARM microcontrollers
- FPGA design
- IoT devices
- edge ai
Projects: 
- custom smart watch
- thrust vector control for texas rocket engineering lab
- pcr automation robot for ECLAIR robotics
- iot alarm clock system
- honda pet "baby monitor" for vehicles device
- digital logic stopwatch/timer on FPGA

Company hint: ${companyHint ? companyHint : "(none)"}
`;


    const input = [
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          ...(imageDataUrl ? [{ type: "input_image", image_url: imageDataUrl }] : []),
        ],
      },
    ];

    // Use a vision-capable model
    const resp = await openai.responses.create({
      model: "gpt-4o-mini",
      input,
      max_output_tokens: 350,
    });

    // Extract text response
    const text =
      resp.output_text ||
      resp.output?.map((o) => o?.content?.map((c) => c?.text).join("")).join("") ||
      "";

    // Ask the model for JSON, then parse defensively (simple + reliable for now)
    // If you want strict schema parsing next, we can upgrade to structured outputs.
    let json;
    try {
      const match = text.match(/\{[\s\S]*\}/);
      json = match ? JSON.parse(match[0]) : null;
    } catch {
      json = null;
    }

    // If the model didn't give clean JSON, do a fallback second pass
    if (!json) {
      const resp2 = await openai.responses.create({
        model: "gpt-4o-mini",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: "Return ONLY valid JSON: {company: string, bullets: string[3-4]}" },
              ...(imageDataUrl ? [{ type: "input_image", image_url: imageDataUrl }] : []),
              { type: "input_text", text: `Company hint: ${companyHint || "(none)"}` },
            ],
          },
        ],
        max_output_tokens: 300,
      });
      const t2 = resp2.output_text || "";
      const match2 = t2.match(/\{[\s\S]*\}/);
      json = match2 ? JSON.parse(match2[0]) : null;
    }

    const parsed = CheatSheet.safeParse(json);
    if (!parsed.success) {
      return res.status(500).json({ error: "AI returned unexpected format." });
    }

    const company = parsed.data.company.trim();
    const bullets = parsed.data.bullets.map(clampBullet).slice(0, 4);

    return res.json({ company, bullets });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

const port = process.env.PORT || 8787;
app.listen(port, () => console.log(`Server running on http://localhost:${port}`));

app.get("/health", (req, res) => res.json({ ok: true }));
