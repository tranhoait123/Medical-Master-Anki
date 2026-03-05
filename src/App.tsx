import { useState, useRef, useEffect } from "react";
import { GeminiService } from "./lib/gemini";
import { fileToGenerativePart } from "./lib/file-processing";
import { PROMPTS } from "./prompts";
import { Upload, FileText, CheckCircle, Loader2, Download, Play, Settings, AlertCircle } from "lucide-react";
import { cn } from "./lib/utils";
import { motion, AnimatePresence } from "framer-motion";

type AppState = "idle" | "uploading" | "analyzing" | "scanning_toc" | "extracting" | "reviewing" | "generating" | "complete" | "error";



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
  const [selectedModel, setSelectedModel] = useState("gemini-2.5-flash");
  const [commands, setCommands] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const geminiRef = useRef<GeminiService | null>(null);



  // Scroll to bottom of logs
  const logsEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);


  // --- HISTORY & PERSISTENCE ---
  useEffect(() => {
    const saved = localStorage.getItem("anki-cards-history");
    if (saved) {
      try {
        setGeneratedCards(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load history", e);
      }
    }
  }, []);

  useEffect(() => {
    if (generatedCards.length > 0) {
      localStorage.setItem("anki-cards-history", JSON.stringify(generatedCards));
    }
  }, [generatedCards]);



  // ... (existing code)



  const addLog = (msg: string) => setLogs((prev) => [...prev, msg]);



  const handleAnalyze = async () => {
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
      addLog("🚀 Starting analysis...");

      if (topicScope.trim()) {
        addLog(`🎯 Focus Scope: ${topicScope}`);
      }

      let filePart: { inlineData: { data: string; mimeType: string } } | null = null;

      // 1. Prepare Content
      if (inputMode === "file" && file) {
        addLog(`📄 Processing file: ${file.name}...`);
        filePart = await fileToGenerativePart(file);
        addLog(`✅ File converted.`);
      } else {
        addLog(`✅ Text content ready.`);
      }

      const gemini = new GeminiService(apiKey, selectedModel);

      // Step 1: Analyze structure
      setStatus("analyzing");
      addLog("🔵 Analyzing document structure...");

      const corePrompt = PROMPTS.MedicalTutor;

      // Create content for caching
      const cacheContent = inputMode === "file" && filePart
        ? filePart
        : contentToProcess;

      // Create cache with system prompt + content
      addLog("📦 Creating context cache (saves ~90% tokens)...");
      await gemini.createCache(corePrompt, cacheContent);
      geminiRef.current = gemini;
      addLog("✅ Cache created! Subsequent calls will be much cheaper.");

      // Phase 1: Generate outline using cached context
      const phase1Command = `USER COMMAND: Giai đoạn 1 bài ${contentName}. ${userFocus}`;
      addLog("⏳ Sending request to Gemini (Phase 1)...");
      const phase1Output = await gemini.generateWithCache(phase1Command);
      addLog("✅ Outline generated.");

      // Step 2: Extract concepts
      setStatus("extracting");
      addLog("🟠 Extracting generation commands...");

      const extractionPrompt = `${PROMPTS.DataExtractor}\n\n=== INPUT OUTLINE ===\n${phase1Output}`;
      const phase2Output = await gemini.generateContent(extractionPrompt);
      const cmds = phase2Output.split("\n").filter(line => line.trim().startsWith("Giai đoạn 2"));

      if (cmds.length === 0) {
        throw new Error("Could not identify processing commands. Please check input quality.");
      }

      setCommands(cmds);
      addLog(`✅ Analysis complete. Found ${cmds.length} chunks.`);

      // AUTO-START GENERATION
      addLog(`📊 Estimated: ~${cmds.length * 3}-${cmds.length * 8} cards | Time: ~${Math.ceil(cmds.length * 0.5)} mins`);
      await startGeneration(cmds);

    } catch (err: unknown) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg || "An unknown error occurred.");
      setStatus("error");
      addLog(`❌ Error: ${msg}`);
    }
  };

  const startGeneration = async (directCommands?: string[]) => {
    try {
      setStatus("generating");
      addLog("🟣 Starting generation (using cached context)...");

      const gemini = geminiRef.current;
      if (!gemini || !gemini.hasCache()) {
        throw new Error("Cache expired or not available. Please re-analyze the document.");
      }

      const activeCommands = directCommands || commands;
      const allCards: string[] = [];

      for (let i = 0; i < activeCommands.length; i++) {
        const cmd = activeCommands[i];
        addLog(`Processing chunk ${i + 1}/${activeCommands.length}: ${cmd.slice(0, 50)}...`);
        setProgress(((i + 1) / activeCommands.length) * 100);

        try {
          // Use cached context - much cheaper!
          const cardOutput = await gemini.generateWithCache(
            `USER COMMAND: ${cmd}\n\nCRITICAL INSTRUCTION: Analyze the cached document ONLY. Do NOT use external knowledge.`
          );
          const cleanOutput = cardOutput.replace(/```/g, "").trim();
          allCards.push(cleanOutput);
        } catch (chunkErr) {
          console.error(`Error processing chunk ${i + 1}`, chunkErr);
          addLog(`⚠️ Chunk ${i + 1} blocked by AI Safety Filter (Recitation). Skipping...`);
        }
      }

      addLog("✅ All chunks processed.");
      addLog("🧹 Cleaning up cache...");
      await gemini.deleteCache();

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



  const handleDownload = () => {
    // Combine all chunks and clean line-by-line
    const allText = generatedCards.join("\n");
    const lines = allText.split("\n");

    const cleanLines = lines
      .map(line => line.trim())
      .filter(line => line.length > 0) // Remove empty lines
      .filter(line => !line.startsWith("```")) // Remove markdown code blocks
      .filter(line => !line.match(/^(html|xml|json|markdown)$/i)) // Remove language tags
      .filter(line => !line.match(/^(html|xml|json|markdown)$/i)) // Remove language tags
      .filter(line => line.includes("\t")); // Keep only valid Q<Tab>A lines

    // Post-process for tags in TXT export
    // Anki text import expects tags in the last column, separated by spaces.
    // If our tag is "Title Name::Chapter Name", Anki import splits at space.
    // We should replace spaces with dashes or underscores in the tag column specifically for TXT export, 
    // OR tell the user to map it to a field. But they asked for "field tag".
    // Users usually map the 3rd column to "Tags".
    // To preserve the long tag with spaces, we typically replace spaces with _ or -.

    const processedLines = cleanLines.map(line => {
      const parts = line.split("\t");
      if (parts.length >= 3) {
        const tag = parts[2].trim();
        // Replace spaces with underscores to keep it as one tag during import
        const safeTag = tag.replace(/\s+/g, "_");
        return `${parts[0]}\t${parts[1]}\t${safeTag}`;
      }
      return line;
    });

    if (processedLines.length === 0) {
      alert("No valid cards found to export! Please check the generation output.");
      return;
    }

    const blob = new Blob([processedLines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `anki_export_${file?.name || "data"}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
    }
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

                <div className="space-y-2">
                  <label className="text-sm font-medium">AI Model</label>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="w-full p-2 rounded-md bg-input border border-border focus:ring-2 focus:ring-primary outline-none transition-all"
                  >
                    <option value="gemini-2.5-flash">⚡ Gemini 2.5 Flash (Recommended)</option>
                    <option value="gemini-2.5-pro">🧠 Gemini 2.5 Pro</option>
                    <option value="gemini-2.5-flash-lite">💨 Gemini 2.5 Flash-Lite (Fastest)</option>
                    <option value="gemini-3-flash-preview">🔬 Gemini 3 Flash (Preview)</option>
                    <option value="gemini-3.1-flash-lite-preview">🔬 Gemini 3.1 Flash-Lite (Preview)</option>
                  </select>
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
              <label
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                className={cn(
                  "flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-lg cursor-pointer transition-all group",
                  dragActive ? "border-primary bg-primary/10 scale-[1.02]" : "border-border hover:border-primary/50 hover:bg-primary/5"
                )}
              >
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
                      <Upload className={cn("w-10 h-10 mb-2 transition-colors", dragActive ? "text-primary" : "text-muted-foreground group-hover:text-primary")} />
                      <p className="text-sm text-muted-foreground">
                        {dragActive ? "Drop file to upload" : "Drop PDF or Text file here"}
                      </p>
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
      </div>

      {errorMsg && (
        <div className="bg-destructive/10 text-destructive p-4 rounded-lg flex items-center gap-2 mb-6 text-sm font-medium">
          <AlertCircle className="w-5 h-5" />
          {errorMsg}
        </div>
      )}

      {/* Action Button */}
      <button
        onClick={() => handleAnalyze()}
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
            <Play className="w-5 h-5" /> Analyze & Generate
          </>
        )}
      </button>
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

      {/* Results with Download */}
      {(status === "complete" || generatedCards.length > 0) && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-card border border-border rounded-lg p-6 space-y-6 shadow-xl"
        >
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <h2 className="text-2xl font-bold text-green-500 flex items-center gap-2">
              <CheckCircle className="w-6 h-6" /> Generated Cards ({generatedCards.length})
            </h2>
            <div className="flex items-center gap-2">
              {/* Spacer if needed */}
            </div>
          </div>

          <div className="flex flex-col items-center justify-center p-8 space-y-4 text-center text-muted-foreground border-t border-border mt-4">
            <p>Everything is generated and ready! Import the .txt file directly into Anki.</p>
            <button
              onClick={handleDownload}
              className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-4 rounded-full font-bold text-lg flex items-center gap-3 transition-colors shadow-lg mt-2"
            >
              <Download className="w-6 h-6" /> Download .txt (Anki Import)
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
