import React, { useMemo, useRef, useState } from "react";
import "./app.css";

const DEVICE_NAME = "SXSW_Watch";
const SERVICE_UUID = "12345678-1234-1234-1234-1234567890ab";
const CHAR_UUID = "87654321-4321-4321-4321-ba0987654321";

// Local AI server (change to cloud URL later)
const AI_SERVER_URL = "http://localhost:8787";

const enc = new TextEncoder();
const dec = new TextDecoder();

function pad2(n) {
  return String(n).padStart(2, "0");
}
function fmtProtocolDateTime(dateObj) {
  // "YYYY-MM-DD HH:MM:SS" in LOCAL time
  const y = dateObj.getFullYear();
  const mo = pad2(dateObj.getMonth() + 1);
  const d = pad2(dateObj.getDate());
  const h = pad2(dateObj.getHours());
  const m = pad2(dateObj.getMinutes());
  const s = pad2(dateObj.getSeconds());
  return `${y}-${mo}-${d} ${h}:${m}:${s}`;
}

// Watch text helper: keep notes compact + readable
function bulletsToWatchText(bullets) {
  return bullets.map((b) => `• ${String(b).trim()}`).join("\n");
}

export default function App() {
  const [tab, setTab] = useState("Time");

  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [statusLine, setStatusLine] = useState("Not connected");
  const [lastRx, setLastRx] = useState("(none)");
  const [log, setLog] = useState([]);

  // Forms
  const [timeStr, setTimeStr] = useState(() => {
    const now = new Date();
    return `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  });

  const [dtLocal, setDtLocal] = useState(() => {
    const now = new Date();
    const y = now.getFullYear();
    const mo = pad2(now.getMonth() + 1);
    const d = pad2(now.getDate());
    const h = pad2(now.getHours());
    const m = pad2(now.getMinutes());
    const s = pad2(now.getSeconds());
    // datetime-local with seconds: "YYYY-MM-DDTHH:MM:SS"
    return `${y}-${mo}-${d}T${h}:${m}:${s}`;
  });

  const [company, setCompany] = useState("");
  const [noteText, setNoteText] = useState("");

  const [editCompany, setEditCompany] = useState("");
  const [editText, setEditText] = useState("");

  const [statusMsg, setStatusMsg] = useState("");

  // Search → show note on watch
  const [searchCompany, setSearchCompany] = useState("");

  // Raw
  const [rawCmd, setRawCmd] = useState("");

  // ================= AI NOTE GENERATOR =================
  const [aiCompanyHint, setAiCompanyHint] = useState("");
  const [aiImageFile, setAiImageFile] = useState(null);
  const [aiPreviewUrl, setAiPreviewUrl] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiResult, setAiResult] = useState(null); // { company, bullets }
  const [aiServerOnline, setAiServerOnline] = useState(true);

  // BLE refs
  const deviceRef = useRef(null);
  const serverRef = useRef(null);
  const charRef = useRef(null);

  const canUseWebBluetooth = useMemo(() => !!navigator?.bluetooth, []);

  function pushLog(line) {
    setLog((prev) => {
      const next = [...prev, { t: new Date(), line }];
      return next.length > 250 ? next.slice(next.length - 250) : next;
    });
  }

  async function connect() {
    if (!canUseWebBluetooth) {
      alert("Web Bluetooth not available. Use Chrome/Edge (desktop or Android).");
      return;
    }
    try {
      setConnecting(true);
      setStatusLine("Opening Bluetooth chooser…");
      pushLog("UI: Connect");

      const device = await navigator.bluetooth.requestDevice({
        filters: [{ name: DEVICE_NAME }],
        optionalServices: [SERVICE_UUID],
      });

      deviceRef.current = device;
      device.addEventListener("gattserverdisconnected", onDisconnected);

      setStatusLine("Connecting…");
      const server = await device.gatt.connect();
      serverRef.current = server;

      setStatusLine("Getting service…");
      const service = await server.getPrimaryService(SERVICE_UUID);

      setStatusLine("Getting characteristic…");
      const characteristic = await service.getCharacteristic(CHAR_UUID);
      charRef.current = characteristic;

      // Notifications (ACK etc.)
      try {
        await characteristic.startNotifications();
        characteristic.addEventListener("characteristicvaluechanged", (e) => {
          const value = e.target.value;
          const bytes = new Uint8Array(value.buffer);
          const text = dec.decode(bytes);
          setLastRx(text);
          pushLog(`RX: ${text}`);
        });
        pushLog("BLE: Notifications enabled");
      } catch {
        pushLog("BLE: Notifications not enabled (writes still OK)");
      }

      setConnected(true);
      setStatusLine("Connected ✅");
      pushLog("BLE: Connected");
    } catch (err) {
      pushLog(`ERR: ${err?.message || String(err)}`);
      setStatusLine("Connection failed");
      setConnected(false);
    } finally {
      setConnecting(false);
    }
  }

  function onDisconnected() {
    pushLog("BLE: Disconnected");
    setStatusLine("Disconnected");
    setConnected(false);
    serverRef.current = null;
    charRef.current = null;
  }

  function disconnect() {
    pushLog("UI: Disconnect");
    try {
      const device = deviceRef.current;
      if (device?.gatt?.connected) device.gatt.disconnect();
    } catch {}
  }

  async function sendCommand(cmd) {
    const ch = charRef.current;
    if (!ch) {
      alert("Not connected");
      return;
    }
    const trimmed = cmd.trim();
    if (!trimmed) return;

    try {
      pushLog(`TX: ${trimmed}`);
      setStatusLine("Sending…");
      await ch.writeValue(enc.encode(trimmed));
      setStatusLine("Connected ✅");
    } catch (err) {
      pushLog(`ERR: ${err?.message || String(err)}`);
      setStatusLine("Send failed");
    }
  }

  // --- Actions ---
  function setNowTime() {
    const now = new Date();
    setTimeStr(`${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`);
  }

  function setNowDateTime() {
    const now = new Date();
    const y = now.getFullYear();
    const mo = pad2(now.getMonth() + 1);
    const d = pad2(now.getDate());
    const h = pad2(now.getHours());
    const m = pad2(now.getMinutes());
    const s = pad2(now.getSeconds());
    setDtLocal(`${y}-${mo}-${d}T${h}:${m}:${s}`);
  }

  function sendTime() {
    const m = timeStr.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if (!m) return alert("Time must be HH:MM:SS");
    const h = +m[1], mi = +m[2], s = +m[3];
    if (h > 23 || mi > 59 || s > 59) return alert("Invalid time");
    sendCommand(`TIME:${h}:${mi}:${s}`);
  }

  function sendDateTime() {
    // datetime-local string: "YYYY-MM-DDTHH:MM:SS"
    const m = dtLocal.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return alert("Invalid datetime");
    const sec = m[6] ? +m[6] : 0;
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${pad2(sec)}`);
    sendCommand(`DATETIME:${fmtProtocolDateTime(d)}`);
  }

  // ✅ Sync button: always includes seconds + uses local time
  async function syncToWatch() {
    const now = new Date();
    await sendCommand(`DATETIME:${fmtProtocolDateTime(now)}`);
    await sendCommand(`STATUS:SYNCED ${now.toLocaleTimeString()}`);
  }

  function addNote() {
    const c = company.trim();
    const t = noteText.trim();
    if (!c || !t) return alert("Company and note text are required.");
    sendCommand(`NOTE:${c}|${t}`);
    setCompany("");
    setNoteText("");
  }

  function editNote() {
    const c = editCompany.trim();
    const t = editText.trim();
    if (!c || !t) return alert("Company and new text are required.");
    sendCommand(`EDIT:${c}|${t}`);
    setEditCompany("");
    setEditText("");
  }

  function deleteCurrentNote() {
    if (confirm("Delete the current note on the watch?")) {
      sendCommand("DELETE");
    }
  }

  function clearAllNotes() {
    if (confirm("Are you sure you want to delete ALL notes on the watch?")) {
      sendCommand("CLEAR");
    }
  }

  function sendStatus() {
    const s = statusMsg.trim();
    if (!s) return;
    sendCommand(`STATUS:${s}`);
    setStatusMsg("");
  }

  function showCompanyOnWatch() {
    const q = searchCompany.trim();
    if (!q) return;
    sendCommand(`SHOW:${q}`);
  }

  // ================= AI HANDLERS =================
  function onPickImage(file) {
    if (!file) return;
    setAiImageFile(file);
    setAiPreviewUrl(URL.createObjectURL(file));
    setAiResult(null);
    setAiError("");
  }

  async function generateAiNote() {
    // Works even if BLE isn't connected (you can generate first, send later)
    if (!aiImageFile && !aiCompanyHint.trim()) {
      alert("Upload/take a photo OR type a company name.");
      return;
    }

    setAiBusy(true);
    setAiError("");
    setAiResult(null);

    try {
      const fd = new FormData();
      if (aiImageFile) fd.append("image", aiImageFile);
      fd.append("companyHint", aiCompanyHint.trim());

      const r = await fetch(`${AI_SERVER_URL}/api/cheatsheet`, {
        method: "POST",
        body: fd,
      });

      // If server is down, fetch will throw before here
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "AI request failed");

      setAiServerOnline(true);
      setAiResult(data);
      pushLog(`AI: Generated note for ${data.company}`);
    } catch (e) {
      // If server is offline, don't break the whole app
      setAiServerOnline(false);
      setAiError(
        "AI server is offline. Start the server (npm start) or try again later."
      );
      pushLog(`AI ERR: ${e?.message || String(e)}`);
    } finally {
      setAiBusy(false);
    }
  }

  async function sendAiResultToWatch() {
    if (!aiResult?.company || !aiResult?.bullets?.length) return;
    if (!connected) {
      alert("Connect to the watch first.");
      return;
    }

    const text = bulletsToWatchText(aiResult.bullets);

    // Create the note
    await sendCommand(`NOTE:${aiResult.company}|${text}`);

    // Jump to it (requires SHOW support on watch)
    await sendCommand(`SHOW:${aiResult.company}`);
  }

  function clearAi() {
    setAiCompanyHint("");
    setAiImageFile(null);
    setAiPreviewUrl("");
    setAiResult(null);
    setAiError("");
    setAiServerOnline(true);
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <div className="logo" />
          <div>
            <div className="title">SXSW Watch</div>
            <div className="subtitle">Companion Panel</div>
          </div>
        </div>

        <div className="headerRight">
          <div className={`pill ${connected ? "ok" : "bad"}`}>
            {connected ? "Connected" : "Offline"}
          </div>

          {!connected ? (
            <button className="btn primary" onClick={connect} disabled={connecting}>
              {connecting ? "Connecting…" : "Connect"}
            </button>
          ) : (
            <button className="btn" onClick={disconnect}>Disconnect</button>
          )}
        </div>
      </header>

      <div className="tabs">
        {["Time", "Notes", "Status", "Logs"].map((t) => (
          <button
            key={t}
            className={`tab ${tab === t ? "active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
        <div className="spacer" />
        <div className="mini">
          <div className="miniLabel">Last RX</div>
          <div className="miniValue mono">{lastRx}</div>
        </div>
      </div>

      <main className="content">
        {tab === "Time" && (
          <div className="stack">
            <section className="card">
              <div className="cardTop">
                <h2>Time</h2>
                <button className="btn orange" onClick={syncToWatch} disabled={!connected}>
                  Sync to Watch
                </button>
              </div>
              <p className="muted">Set the watch clock quickly or sync it to your computer time.</p>

              <div className="formGrid">
                <div className="field">
                  <div className="label">Time (HH:MM:SS)</div>
                  <div className="row">
                    <input className="input" value={timeStr} onChange={(e) => setTimeStr(e.target.value)} />
                    <button className="btn ghost" onClick={setNowTime}>Now</button>
                    <button className="btn primary" onClick={sendTime} disabled={!connected}>Send</button>
                  </div>
                </div>

                <div className="field">
                  <div className="label">DateTime</div>
                  <div className="row">
                    <input
                      type="datetime-local"
                      step="1"
                      className="input"
                      value={dtLocal}
                      onChange={(e) => setDtLocal(e.target.value)}
                    />
                    <button className="btn ghost" onClick={setNowDateTime}>Now</button>
                    <button className="btn primary" onClick={sendDateTime} disabled={!connected}>Send</button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {tab === "Notes" && (
          <div className="stack">
            {/* Existing notes card */}
            <section className="card">
              <div className="cardTop">
                <h2>Notes</h2>
                <button className="btn danger" onClick={clearAllNotes} disabled={!connected}>
                  Clear All
                </button>
              </div>
              <p className="muted">
                Add/edit/delete notes using the same commands used in nRF Connect.
              </p>

              <div className="split">
                <div className="pane">
                  <div className="label">Add note</div>
                  <input className="input" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company" />
                  <textarea className="textarea" value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Notes…" rows={6} />
                  <button className="btn primary full" onClick={addNote} disabled={!connected}>Add</button>
                </div>

                <div className="pane">
                  <div className="label">Edit current note</div>
                  <input className="input" value={editCompany} onChange={(e) => setEditCompany(e.target.value)} placeholder="Company (updates title)" />
                  <textarea className="textarea" value={editText} onChange={(e) => setEditText(e.target.value)} placeholder="New text…" rows={4} />
                  <div className="row">
                    <button className="btn primary" onClick={editNote} disabled={!connected}>Send Edit</button>
                    <button className="btn danger" onClick={deleteCurrentNote} disabled={!connected}>Delete</button>
                  </div>

                  <div className="divider" />

                  <div className="label">Find company on watch</div>
                  <div className="row">
                    <input
                      className="input"
                      value={searchCompany}
                      onChange={(e) => setSearchCompany(e.target.value)}
                      placeholder="Search company name…"
                    />
                    <button className="btn orange" onClick={showCompanyOnWatch} disabled={!connected}>
                      Show on Watch
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* NEW: AI NOTE GENERATOR CARD */}
            <section className="card">
              <div className="cardTop">
                <h2>AI Note Generator</h2>
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <button className="btn ghost" onClick={clearAi}>
                    Clear
                  </button>
                  <button className="btn orange" onClick={generateAiNote} disabled={aiBusy}>
                    {aiBusy ? "Generating…" : "Generate"}
                  </button>
                </div>
              </div>

              <p className="muted">
                Upload/take a photo (booth logo, job listing) or type a company name. Generates a watch-sized networking cheat sheet.
              </p>

              {!aiServerOnline && (
                <div className="hint" style={{ color: "#ff9a3c" }}>
                  AI server offline — the rest of the app still works. Start it later to use AI.
                </div>
              )}

              <div className="split">
                <div className="pane">
                  <div className="label">Photo (upload or camera)</div>
                  <input
                    className="input"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(e) => onPickImage(e.target.files?.[0])}
                  />

                  {aiPreviewUrl && (
                    <img
                      src={aiPreviewUrl}
                      alt="preview"
                      style={{
                        width: "100%",
                        borderRadius: 14,
                        border: "1px solid rgba(255,255,255,0.12)",
                        marginTop: 10,
                      }}
                    />
                  )}

                  <div className="label" style={{ marginTop: 12 }}>Or company name</div>
                  <input
                    className="input"
                    value={aiCompanyHint}
                    onChange={(e) => setAiCompanyHint(e.target.value)}
                    placeholder="e.g., NVIDIA / Skyworks / Boston Dynamics"
                  />

                  <div className="hint">
                    Tip: photo works best, but name-only works too.
                  </div>
                </div>

                <div className="pane">
                  <div className="label">Result</div>

                  {aiError && (
                    <div className="hint" style={{ color: "#ff9a3c" }}>
                      {aiError}
                    </div>
                  )}

                  {!aiError && !aiResult && (
                    <div className="hint">
                      Click <span className="mono">Generate</span> to preview a watch-sized note.
                    </div>
                  )}

                  {aiResult && (
                    <>
                      <div className="kv" style={{ marginTop: 6 }}>
                        <div className="k">Company</div>
                        <div className="v">{aiResult.company}</div>
                      </div>

                      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                        {aiResult.bullets?.map((b, i) => (
                          <div key={i} className="mono" style={{ fontSize: 13 }}>
                            • {b}
                          </div>
                        ))}
                      </div>

                      <div className="row" style={{ marginTop: 12 }}>
                        <button className="btn primary" onClick={sendAiResultToWatch} disabled={!connected}>
                          Send to Watch
                        </button>
                        <button
                          className="btn ghost"
                          onClick={() => {
                            // also put it into the manual fields (optional convenience)
                            setCompany(aiResult.company);
                            setNoteText(bulletsToWatchText(aiResult.bullets || []));
                          }}
                        >
                          Copy to Manual
                        </button>
                      </div>

                      {!connected && (
                        <div className="hint">
                          Connect to the watch to send. You can still generate offline from BLE.
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </section>
          </div>
        )}

        {tab === "Status" && (
          <div className="stack">
            <section className="card">
              <h2>Status</h2>
              <p className="muted">Optional: update the status string shown on your watch.</p>

              <div className="row">
                <input className="input" value={statusMsg} onChange={(e) => setStatusMsg(e.target.value)} placeholder="e.g., Ready for SXSW" />
                <button className="btn primary" onClick={sendStatus} disabled={!connected}>Send</button>
              </div>

              <div className="divider" />

              <h3 className="h3">Raw command</h3>
              <p className="muted small">
                Useful when adding new commands later (AI photo features, etc.).
              </p>
              <div className="row">
                <input className="input" value={rawCmd} onChange={(e) => setRawCmd(e.target.value)} placeholder="TYPE:PAYLOAD" />
                <button
                  className="btn orange"
                  disabled={!connected || !rawCmd.trim()}
                  onClick={() => { sendCommand(rawCmd); setRawCmd(""); }}
                >
                  Send
                </button>
              </div>
            </section>
          </div>
        )}

        {tab === "Logs" && (
          <div className="stack">
            <section className="card">
              <div className="cardTop">
                <h2>Logs</h2>
                <button className="btn ghost" onClick={() => setLog([])}>Clear</button>
              </div>

              <div className="kv">
                <div className="k">Device</div><div className="v">{DEVICE_NAME}</div>
                <div className="k">State</div><div className="v">{statusLine}</div>
              </div>

              <div className="divider" />

              <div className="log">
                {log.length === 0 ? (
                  <div className="muted small">No activity yet.</div>
                ) : (
                  log.slice().reverse().map((x, idx) => (
                    <div key={idx} className="logline">
                      <span className="ts">{x.t.toLocaleTimeString()}</span>
                      <span className="mono">{x.line}</span>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}
      </main>

      <footer className="footer">
        <span className="muted small">
          Web Bluetooth works on Chrome/Edge (desktop + Android). AI works when the server is running.
        </span>
      </footer>
    </div>
  );
}
