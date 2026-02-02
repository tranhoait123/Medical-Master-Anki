import { useState, useRef, useEffect } from "react";
import { GeminiService } from "./lib/gemini";
import { fileToGenerativePart } from "./lib/file-processing";
import { AnkiConnectService } from "./lib/anki";
import { PROMPTS } from "./prompts";
import { Upload, FileText, CheckCircle, Loader2, Download, Play, Settings, AlertCircle, RefreshCw } from "lucide-react";
import { cn } from "./lib/utils";
import { motion, AnimatePresence } from "framer-motion";

type AppState = "idle" | "uploading" | "analyzing" | "extracting" | "generating" | "complete" | "error";

export default function App() {
  const [apiKey, setApiKey] = useState("");
  const [inputMode, setInputMode] = useState<"file" | "text">("file");
  const [file, setFile] = useState<File | null>(null);
  const [textInput, setTextInput] = useState("");
  const [topicScope, setTopicScope] = useState("");
  const [status, setStatus] = useState<AppState>("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [generatedCards, setGeneratedCards] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [showConfig, setShowConfig] = useState(true);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "success" | "error">("idle");
  const [ankiUrl, setAnkiUrl] = useState("http://127.0.0.1:8765");
  const [deckName, setDeckName] = useState("Default");


  // Scroll to bottom of logs
  const logsEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const addLog = (msg: string) => setLogs((prev) => [...prev, msg]);

  const handleGenerate = async () => {
    if (!apiKey) {
      setErrorMsg("Please enter a valid Gemini API Key.");
      return;
    }

    let contentToProcess = "";
    let contentName = "Data";

    const userFocus = topicScope.trim() ? `CHỦ ĐỀ CẦN TẬP TRUNG: "${topicScope}". (Chỉ trích xuất nội dung liên quan đến chủ đề này).` : "Xử lý toàn bộ tài liệu.";

    if (inputMode === "file") {
      if (!file) {
        setErrorMsg("Please upload a file.");
        return;
      }
      contentName = file.name;
    } else {
      if (!textInput.trim()) {
        setErrorMsg("Please paste some text.");
        return;
      }
      contentToProcess = textInput;
      contentName = "Pasted Text";
    }

    try {
      setErrorMsg("");
      setLogs([]);
      setGeneratedCards([]);
      setStatus("uploading");
      addLog("🚀 Starting process...");

      if (topicScope.trim()) {
        addLog(`🎯 Focus Scope: ${topicScope}`);
      }

      let filePart: { inlineData: { data: string; mimeType: string } } | null = null;

      // 1. Prepare Content
      if (inputMode === "file" && file) {
        addLog(`📄 Processing file: ${file.name}...`);
        // New Multimodal approach: Send file directly to Gemini
        filePart = await fileToGenerativePart(file);
        addLog(`✅ File converted for Multimodal processing.`);
      } else {
        addLog(`✅ Text content ready (${contentToProcess.length} chars).`);
      }

      const gemini = new GeminiService(apiKey);

      // Step 1: Analyze structure
      setStatus("analyzing");
      addLog("🔵 Analyzing document structure...");

      const corePrompt = PROMPTS.MedicalTutor;
      let phase1Input: string | (string | { inlineData: { data: string; mimeType: string } })[] = [];

      if (inputMode === "file" && filePart) {
        phase1Input = [
          corePrompt + `\n\nUSER COMMAND: Giai đoạn 1 bài ${contentName}. ${userFocus}\n\n(Please analyze the attached document)`,
          filePart
        ];
      } else {
        phase1Input = `${corePrompt}\n\n=== DOCUMENT CONTENT ===\n${contentToProcess}\n\n=== END DOCUMENT ===\n\nUSER COMMAND: Giai đoạn 1 bài ${contentName}. ${userFocus}`;
      }

      addLog("⏳ Sending request to Gemini (Phase 1)...");
      const phase1Output = await gemini.generateContent(phase1Input);
      addLog("✅ Outline generated.");

      // Step 2: Extract concepts
      setStatus("extracting");
      addLog("🟠 Extracting key concepts...");

      // Parse the outline to get generation commands
      const extractionPrompt = `${PROMPTS.DataExtractor}\n\n=== INPUT OUTLINE ===\n${phase1Output}`;

      const phase2Output = await gemini.generateContent(extractionPrompt);
      const commands = phase2Output.split("\n").filter(line => line.trim().startsWith("Giai đoạn 2"));

      addLog(`✅ Found ${commands.length} command(s) for card generation.`);
      if (commands.length === 0) {
        throw new Error("Could not identify processing commands. Please check input quality.");
      }

      // Step 3: Generate content
      setStatus("generating");
      addLog("🟣 Generating Anki cards...");

      const allCards: string[] = [];

      for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i];
        addLog(`Processing chunk ${i + 1}/${commands.length}: ${cmd.slice(0, 50)}...`);
        setProgress(((i + 1) / commands.length) * 100);

        // For Phase 3, we continue using the Master persona.
        // We re-send context + specific command.
        let cardInput: string | (string | { inlineData: { data: string; mimeType: string } })[] = "";

        if (inputMode === "file" && filePart) {
          cardInput = [
            corePrompt + `\n\nUSER COMMAND: ${cmd}\n\nCRITICAL INSTRUCTION: Analyze the attached document ONLY. Do NOT use external knowledge. If the information is not in the document, state "Missing data".\n\n(Please analyze the attached document)`,
            filePart
          ];
        } else {
          cardInput = `${corePrompt}\n\n=== DOCUMENT CONTENT ===\n${contentToProcess}\n\n=== END DOCUMENT ===\n\nUSER COMMAND: ${cmd}\n\nCRITICAL INSTRUCTION: Analyze the provided text ONLY. Do NOT use external knowledge.`;
        }

        const cardOutput = await gemini.generateContent(cardInput);

        // Clean output: remove potential markdown code blocks if the model wrapped them
        const cleanOutput = cardOutput.replace(/```/g, "").trim();
        allCards.push(cleanOutput);
      }

      addLog("✅ All chunks processed.");
      setGeneratedCards(allCards);
      setStatus("complete");

    } catch (err: unknown) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg || "An unknown error occurred.");
      setStatus("error");
      addLog(`❌ Error: ${msg}`);
    }
  };

  const handleSyncAnki = async () => {
    try {
      setSyncStatus("syncing");
      const ankiService = new AnkiConnectService(ankiUrl, deckName);

      // Parse cards
      let count = 0;
      for (const chunk of generatedCards) {
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          const parts = line.split("\t");
          if (parts.length >= 2) {
            const front = parts[0];
            const back = parts.slice(1).join("\t"); // Join remainder just in case
            await ankiService.addNote(front, back);
            count++;
          }
        }
      }
      setSyncStatus("success");
      addLog(`✅ Synced ${count} cards to Anki deck '${deckName}'`);
    } catch (err: unknown) {
      console.error(err);
      setSyncStatus("error");
      const msg = err instanceof Error ? err.message : String(err);
      addLog(`❌ Anki Sync Error: ${msg}`);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([generatedCards.join("\n\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `anki_export_${file?.name || "data"}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans p-8 flex flex-col items-center">
      <div className="w-full max-w-3xl space-y-8">

        {/* Header */}
        {/* Header */}
        <header className="flex flex-col items-center text-center space-y-4 pt-8">
          <div className="relative group">
            <img src="/src/assets/ponz-logo.jpg" alt="PonZ Logo" className="relative w-24 h-24 rounded-2xl shadow-md border border-border object-cover" />
          </div>

          <div className="space-y-1">
            <h1 className="text-4xl font-bold tracking-tight text-foreground">
              Medical Master
            </h1>
            <p className="text-xs font-medium text-muted-foreground uppercase opacity-70">
              Made by PonZ
            </p>
          </div>

          <p className="text-muted-foreground text-base max-w-lg">
            Automated Anki card generation pipeline powered by Gemini 3.0 Flash.
          </p>
        </header>

        {/* Configuration (API Key) */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Settings className="w-5 h-5" /> Configuration
            </h2>
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="text-sm text-primary hover:underline"
            >
              {showConfig ? "Hide" : "Show"}
            </button>
          </div>

          <AnimatePresence>
            {showConfig && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="bg-card border border-border rounded-lg p-6 space-y-4 shadow-sm"
              >
                <div className="space-y-2">
                  <label className="text-sm font-medium">Gemini API Key</label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Enter your AI Studio API key (starts with AIza...)"
                    className="w-full p-2 rounded-md bg-input border border-border focus:ring-2 focus:ring-primary outline-none transition-all"
                  />

                  <p className="text-xs text-muted-foreground">
                    Your key is used locally and never stored on our servers.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">AnkiConnect URL</label>
                    <input
                      type="text"
                      value={ankiUrl}
                      onChange={(e) => setAnkiUrl(e.target.value)}
                      className="w-full p-2 rounded-md bg-input border border-border focus:ring-2 focus:ring-primary outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Anki Deck Name</label>
                    <input
                      type="text"
                      value={deckName}
                      onChange={(e) => setDeckName(e.target.value)}
                      className="w-full p-2 rounded-md bg-input border border-border focus:ring-2 focus:ring-primary outline-none transition-all"
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>


        {/* Input Method Tabs */}
        <div className="w-full">
          <div className="flex space-x-4 mb-4 border-b border-border">
            <button
              onClick={() => setInputMode("file")}
              className={cn("pb-2 border-b-2 transition-colors font-medium", inputMode === "file" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              Upload File
            </button>
            <button
              onClick={() => setInputMode("text")}
              className={cn("pb-2 border-b-2 transition-colors font-medium", inputMode === "text" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              Paste Text
            </button>
          </div>

          {inputMode === "file" ? (
            <div className="space-y-4">
              <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all group">
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.txt,.md,.png,.jpg,.jpeg,.webp,.heic"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  {file ? (
                    <>
                      <FileText className="w-10 h-10 text-primary mb-2 group-hover:scale-110 transition-transform" />
                      <p className="text-sm font-medium text-foreground">{file.name}</p>
                      <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
                    </>
                  ) : (
                    <>
                      <Upload className="w-10 h-10 text-muted-foreground mb-2 group-hover:text-primary transition-colors" />
                      <p className="text-sm text-muted-foreground">Drop PDF or Text file here</p>
                      <p className="text-xs text-muted-foreground mt-1">Supports PDF, TXT, MD, Images</p>
                    </>
                  )}
                </div>
              </label>
            </div>
          ) : (
            <textarea
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Paste your medical text, notes, or article content here..."
              className="w-full h-40 p-4 rounded-lg bg-input border border-border focus:ring-2 focus:ring-primary outline-none transition-all resize-none text-sm font-mono"
            />
          )}

          {/* NEW: Topic Scope Input */}
          <div className="mt-6 space-y-2">
            <label className="text-sm font-medium text-foreground flex items-center gap-2">
              🎯 Topic / Lesson Focus (Optional)
            </label>
            <input
              type="text"
              value={topicScope}
              onChange={(e) => setTopicScope(e.target.value)}
              placeholder="E.g., 'Chương 3: Tim mạch', 'Bài viêm phổi', or leave empty to process all."
              className="w-full p-3 rounded-md bg-input border border-border focus:ring-2 focus:ring-primary outline-none transition-all placeholder:text-muted-foreground/50"
            />
            <p className="text-xs text-muted-foreground">
              If your file has multiple lessons, specify which one to process here.
            </p>
          </div>
        </div>

        {/* Action Button */}
        <div className="flex justify-center pt-4">
          <button
            onClick={handleGenerate}
            disabled={status !== "idle" && status !== "complete" && status !== "error"}
            className={cn(
              "px-8 py-3 rounded-full font-bold text-lg flex items-center gap-2 transition-all shadow-lg hover:shadow-primary/25",
              status === "idle" || status === "complete" || status === "error"
                ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:scale-105 active:scale-95"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            {status !== "idle" && status !== "complete" && status !== "error" ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" /> Processing...
              </>
            ) : (
              <>
                <Play className="w-5 h-5" /> Generate from {inputMode === "file" ? "File" : "Text"}
              </>
            )}
          </button>
        </div>

        {errorMsg && (
          <div className="bg-destructive/10 text-destructive p-4 rounded-lg flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            {errorMsg}
          </div>
        )}

        {/* Progress & Logs */}
        {(status !== "idle" || logs.length > 0) && (
          <div className="space-y-4">

            {/* Progress Bar */}
            {(status === "generating" || status === "complete") && (
              <div className="w-full space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground uppercase font-semibold tracking-wider">
                  <span>Progress</span>
                  <span>{Math.round(progress)}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-primary"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
              </div>
            )}

            <div className="bg-black/80 text-green-400 font-mono text-sm p-4 rounded-lg border border-border h-64 overflow-y-auto shadow-inner custom-scrollbar">
              {logs.map((log, i) => (
                <div key={i} className="mb-1 border-l-2 border-green-700 pl-2">
                  <span className="opacity-50 mr-2">{new Date().toLocaleTimeString()}</span>
                  {log}
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}

        {/* Results */}
        {status === "complete" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card border border-border rounded-lg p-6 space-y-6 shadow-xl"
          >
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <h2 className="text-2xl font-bold text-green-500 flex items-center gap-2">
                <CheckCircle className="w-6 h-6" /> Completed!
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSyncAnki}
                  disabled={syncStatus === "syncing"}
                  className={cn(
                    "px-4 py-2 rounded-md font-medium flex items-center gap-2 transition-colors border border-border",
                    syncStatus === "success" ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-card hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  {syncStatus === "syncing" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  {syncStatus === "success" ? "Synced!" : "Sync to Anki"}
                </button>
                <button
                  onClick={handleDownload}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md font-medium flex items-center gap-2 transition-colors shadow-sm"
                >
                  <Download className="w-4 h-4" /> Download .txt
                </button>
              </div>
            </div>

            {syncStatus === "error" && (
              <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">
                Failed to sync. Make sure Anki is running with AnkiConnect.
              </div>
            )}

            <div className="space-y-2">
              <p className="text-muted-foreground">Generated {generatedCards.length} chunks of cards.</p>
              <div className="bg-muted/50 p-4 rounded-md max-h-96 overflow-y-auto">
                <pre className="whitespace-pre-wrap text-xs text-foreground/80 font-mono">
                  {generatedCards.join("\n\n-------------------\n\n")}
                </pre>
              </div>
            </div>
          </motion.div>
        )}


      </div>
    </div>
  );
}
