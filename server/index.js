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
You are generating a compact "networking cheat sheet" for an engineering student speaking to a booth rep.
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
- At least 2 bullets must be QUESTIONS the user can ask a rep.
- At least 1 bullet must be "signal line" that makes user sound relevant
  (embedded/firmware/robotics angle if possible).
- Avoid vague filler words: "innovative", "leader", "commitment", "solutions", "powerful".
- Use concrete nouns: RTOS, C/C++, ARM, sensors, BLE, USB, FPGA, CAN, safety, etc.
- If you can't confidently infer specifics from the image, do NOT guess facts.
  Instead, output smart, specific QUESTIONS that uncover the right info.
- make it specific to the company, do not make it generic or random, it must relate to something the company does as a service, belives in, is working towards, etc

Good bullet examples (style):
- "Ask: What teams ship embedded/firmware here—device, edge, or tooling?"
- "Ask: What does your stack use—C/C++, RTOS, Linux, Zephyr, FreeRTOS?"
- "Signal: I build ESP32/Pico BLE+RTC gadgets—what problems do juniors own?"
- "Ask: What's a 90-day project for interns on your hardware/embedded team?"

When discussing stuff about myself and my background use the following infO: 
University of Texas at Austin – Austin, TX                                                       Anticipated Graduation:  May 2026                                                                                                         Bachelor of Science in Electrical and Computer Engineering                                                                      
GPA: 3.6/4.0  
Specialization: Computer Architecture and Embedded Systems
Relevant Courses: Embedded Systems Design Lab, Data Science Lab, Algorithms, Digital Logic Design, Circuit Theory	
                                                              
EXPERIENCE
TVC Firmware Engineer Lead - Avionics Team                                                                                 Jan 2023 - May 2025
Texas Rocket Engineering Lab (TREL) - Austin, TX
Developed embedded C/C++ firmware for a 2-axis thrust vector control (TVC) system running on a NI sbRIO-9637
Developed PWM-based actuator control system with microcontroller I/O and supporting driver electronics 
Tuned the TVC control loop to operate at 100 Hz, ensuring <10 ms command-to-actuation latency
Wrote Bash automation scripts to flash and synchronize firmware across 5 flight computers simultaneously in Linux
Built a valve control FSM to sequence pressurization/purge operations and aborts during all launch phases
Validated TVC behavior with simulation tests and system-level unit tests before integration
Interfaced with GNC and Structures teams to align software control and understand valve/actuator dynamics
Designed a 5000 lb-rated structural test stand in SOLIDWORKS, earning NASA/Virgin Galactic CDR approval
 
Robotics Software Engineer                                                                                                                Sep 2024 - Jan 2025
ECLAIR Robotics - Austin, TX
Collaborated on firmware–hardware integration for a PCR-testing robot with pipette control and data scanning
Built real-time number recognition using a parallel prefixing algorithm with 95% accuracy from pipette images
Engineered full preprocessing pipeline in Python using OpenCV and NumPy for OCR stability and noise reduction
Contributed to Arduino–Python serial interface for synchronized motion control between robot and host system
Organized version control and testing across the team via GitHub and Python unit test frameworks

PROJECTS
IoT Alarm Clock System                                                                                                        	           August 2025 - Present
Developed C firmware for a networked alarm clock using TM4C123 and  ESP8266, configurable via web browser
Interfaced ESP and MCU using UART to process MQTT messages (TCP) from HTML/iFrame-based web app
Wrote MQTT publish/subscribe logic to sync time, alarm, and theme states between browser and MCU via broker
Implemented LCD driver, SysTick clock, and GPIO-based input routines for real-time display and local control
Designed 4-bit resistor-ladder DAC to play buzzer melodies for alarms and themes via waveform sequencing
Integrated 12-bit ADC and photosensor to reflect ambient light level on LCD and Web App UI in real time
Enabled manual alarm/time config via debounced switches and atomic updates with critical section guards
Used oscilloscope and voltmeter to verify analog output, avoid race conditions, and ensure voltage stability

Digital Logic Stopwatch/Timer System                                                                                              Jan 2024 - May 2024
Designed a four-mode stopwatch/timer on Basys3 FPGA using Verilog, FSMs, and real-time I/O control
Achieved 10ms resolution by dividing 100 MHz clock input and driving seven-segment LED displays
Mapped tactile switch inputs to constrained I/O using .xdc pin assignments and debounce logic
Validated timing and logic with Vivado RTL simulation, constraint checks, and synthesis flow

The Legend of Sir Kit: Game System                                                                                               Jan 2023 – May 2023
Built an interactive 8-bit game system on a TM4C123 microcontroller using C, interrupt-driven control, and ARM 
Programmed periodic timers and GPIO interrupts to read joystick/buttons via 2 ADC channels at 100 Hz sampling
Generated in-game audio using a 6-bit DAC wave synthesis at ~11 kHz output rate via timer interrupts
Rendered gameplay to a ST7735 LCD over SPI with 16×16 custom sprite animations and tilemaps
Added multilingual UI support, real-time score display, and sprite-based cutscene transitions
Assembled hardware for joystick, speaker, buttons, LCD, and wiring harnesses with pin-mapped GPIO
Debugged ISR timing, sprite collisions, and animation sequencing for stable gameplay 

SKILLS
Technical Skills: Python, C/C++, Java, Verilog, ARM, C#, Javascript, HTML/CSS, Assembly, FSM, UART, 
Developer Tools: Git/GitHub, Xilinx Vivado, Keil uVision, VS Code, LTSpice, MongoDB, Linux, Arduino
Work Eligibility: Eligible to work in the U.S. with no restrictions

Any talking abouts myself should pertain to any of the above information

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
