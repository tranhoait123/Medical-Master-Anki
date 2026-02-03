import { useState, useRef, useEffect } from "react";
import { GeminiService } from "./lib/gemini";
import { fileToGenerativePart } from "./lib/file-processing";
import { AnkiConnectService } from "./lib/anki";
import { PROMPTS } from "./prompts";
import { Upload, FileText, CheckCircle, Loader2, Download, Play, Settings, AlertCircle, RefreshCw, Trash2, List, ChevronRight, ChevronDown, Target } from "lucide-react";
import { cn } from "./lib/utils";
import { motion, AnimatePresence } from "framer-motion";

type AppState = "idle" | "uploading" | "analyzing" | "scanning_toc" | "extracting" | "reviewing" | "generating" | "complete" | "error";

interface TOCItem {
  id: string;
  label: string;
  children: TOCItem[];
}

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
  const [outlineContent, setOutlineContent] = useState("");
  const [commands, setCommands] = useState<string[]>([]);
  const [toc, setToc] = useState<TOCItem[]>([]);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
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

  const clearHistory = () => {
    if (confirm("Are you sure you want to clear all history?")) {
      setGeneratedCards([]);
      localStorage.removeItem("anki-cards-history");
    }
  };

  const handleCardUpdate = (index: number, newContent: string) => {
    const newCards = [...generatedCards];
    newCards[index] = newContent;
    setGeneratedCards(newCards);
  };

  const handleDeleteCard = (index: number) => {
    const newCards = generatedCards.filter((_, i) => i !== index);
    setGeneratedCards(newCards);
  };

  // ... (existing code)



  const addLog = (msg: string) => setLogs((prev) => [...prev, msg]);

  const handleScanTOC = async () => {
    if (!apiKey) {
      setErrorMsg("Please enter a valid Gemini API Key.");
      return;
    }
    if (!file && inputMode === "file") {
      setErrorMsg("Please upload a file.");
      return;
    }
    if (!textInput.trim() && inputMode === "text") {
      setErrorMsg("Please paste some text.");
      return;
    }

    try {
      setErrorMsg("");
      setLogs([]);
      setStatus("scanning_toc");
      addLog("🚀 Starting TOC Scan...");

      let filePart: { inlineData: { data: string; mimeType: string } } | null = null;
      let contentToProcess = "";

      if (inputMode === "file" && file) {
        addLog(`📄 Processing file: ${file.name}...`);
        filePart = await fileToGenerativePart(file);
        addLog(`✅ File converted.`);
      } else {
        contentToProcess = textInput;
        addLog(`✅ Text content ready.`);
      }

      const gemini = new GeminiService(apiKey);
      const cacheContent = inputMode === "file" && filePart ? filePart : contentToProcess;

      // Create cache if not exists (or always create for simplicity in this flow)
      // Note: In a real app we might check if cache exists, but here we'll just create it to be safe/fresh.
      addLog("📦 Creating context cache for TOC...");
      await gemini.createCache(PROMPTS.MedicalTutor, cacheContent);
      geminiRef.current = gemini;

      addLog("🔍 Scanning for structure...");
      const tocResponse = await gemini.generateWithCache(PROMPTS.TOCExtractor);

      const cleanJson = tocResponse.replace(/```json/g, "").replace(/```/g, "").trim();
      const tocData = JSON.parse(cleanJson);

      if (tocData && tocData.items) {
        setToc(tocData.items);
        addLog("✅ Table of Contents extracted successfully.");
      } else {
        throw new Error("Invalid TOC format returned.");
      }

    } catch (err: unknown) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg || "Failed to scan TOC.");
      setStatus("error");
      addLog(`❌ Error: ${msg}`);
    }
  };

  const handleAnalyzeSection = async (sectionLabel: string) => {
    setTopicScope(sectionLabel);
    setSelectedSection(sectionLabel);
    // Proceed to analyze with this specific scope
    // We can reuse handleAnalyze but we need to make sure it respects the already set state/cache if possible
    // actually handleAnalyze does a fresh start. Let's adapt it or just call it.
    // Ideally we want to use the existing cache.

    // Let's modify handleAnalyze to support skip cache creation if already exists? 
    // Or just call handleAnalyze and let it recreate cache (safer but slower). 
    // Given the prompt "AI sẽ bắt đầu tập trung làm anki cho chính phần mục lục đó", 
    // it implies a full generation flow for that scope.

    // Check if we need to call handleAnalyze with a specific flag or just ensure topicScope is used.
    // React state updates are async, so calling handleAnalyze immediately after setTopicScope might read old state.
    // Better to pass scope as argument to a refactored analyze function, OR just trigger it via a useEffect or direct call with param.

    // For simplicity, let's call a modified version of analyze logic here directly or ensure handleAnalyze reads from param.
    await performAnalysis(sectionLabel);
  };

  const performAnalysis = async (specificScope: string) => {
    // Re-use logic from handleAnalyze but with specific scope
    if (!apiKey) return;

    try {
      setErrorMsg("");
      setLogs([]); // Clear logs for new run? Keep them? Let's clear for clarity.
      setGeneratedCards([]);
      setStatus("analyzing");
      addLog(`🚀 Starting analysis for section: ${specificScope}`);

      const gemini = geminiRef.current || new GeminiService(apiKey);
      // If we came from TOC scan, geminiRef is already set and cache created!
      // We should reuse it if possible.

      if (!gemini.hasCache()) {
        // Re-create cache if needed (shouldn't happen if we just scanned TOC)
        // But if user refreshed or something...
        // For now assume cache is there from Scan TOC.
        // If not, we might need to recreate it. 
        // Let's rely on the fact that handleScanTOC created it.
        let filePart = null;
        if (inputMode === "file" && file) {
          filePart = await fileToGenerativePart(file);
        }
        const cacheContent = inputMode === "file" && filePart ? filePart : textInput;
        await gemini.createCache(PROMPTS.MedicalTutor, cacheContent);
        geminiRef.current = gemini;
      }

      addLog("🔵 Analyzing specific section...");

      const phase1Command = `USER COMMAND: Giai đoạn 1. CHỦ ĐỀ CẦN TẬP TRUNG: "${specificScope}". (Chỉ trích xuất nội dung liên quan đến chủ đề này).`;
      const phase1Output = await gemini.generateWithCache(phase1Command);
      setOutlineContent(phase1Output);
      addLog("✅ Outline generated for section.");

      // Step 2: Extract concepts
      setStatus("extracting");
      addLog("🟠 Extracting generation commands...");

      const extractionPrompt = `${PROMPTS.DataExtractor}\n\n=== INPUT OUTLINE ===\n${phase1Output}`;
      const phase2Output = await gemini.generateContent(extractionPrompt);
      const cmds = phase2Output.split("\n").filter(line => line.trim().startsWith("Giai đoạn 2"));

      if (cmds.length === 0) {
        throw new Error("Could not identify processing commands.");
      }

      setCommands(cmds);
      addLog(`✅ Section analysis complete. Found ${cmds.length} chunks.`);

      // AUTO-START GENERATION
      // Show estimation via log
      addLog(`📊 Estimated: ~${cmds.length * 3}-${cmds.length * 8} cards | Time: ~${Math.ceil(cmds.length * 0.5)} mins`);

      // Call generation immediately with the local cmds
      await startGeneration(cmds);

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setStatus("error");
      addLog(`❌ Error: ${msg}`);
    }
  };

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

      const gemini = new GeminiService(apiKey);

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
      setOutlineContent(phase1Output);
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
            const back = parts[1];
            // Safe tag extraction
            const rawTag = parts.length > 2 ? parts[2].trim() : "";
            const tagsToSend = rawTag ? [rawTag] : [];

            await ankiService.addNote(front, back, tagsToSend);
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

        {/* Action Button */}
        <div className="flex justify-center pt-4">
          <button
            onClick={() => status === "reviewing" ? startGeneration() : handleAnalyze()}
            disabled={status !== "idle" && status !== "complete" && status !== "error" && status !== "reviewing"}
            className={cn(
              "px-8 py-3 rounded-full font-bold text-lg flex items-center gap-2 transition-all shadow-lg hover:shadow-primary/25",
              status === "idle" || status === "complete" || status === "error" || status === "reviewing"
                ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:scale-105 active:scale-95"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            {status !== "idle" && status !== "complete" && status !== "error" && status !== "reviewing" ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" /> Processing...
              </>
            ) : status === "reviewing" ? (
              <>
                <Play className="w-5 h-5" /> Start Generation ({commands.length} chunks)
              </>
            ) : (
              <>
                <Play className="w-5 h-5" /> Analyze {inputMode === "file" ? "File" : "Text"}
              </>
            )}
          </button>

          {/* New Scan Full File Button */}
          <button
            onClick={handleAnalyze} // Re-use handleAnalyze but explicit label
            disabled={status !== "idle" && status !== "complete" && status !== "error" && status !== "reviewing"}
            className={cn(
              "px-8 py-3 rounded-full font-bold text-lg flex items-center gap-2 transition-all shadow-lg hover:shadow-blue-500/25 ml-4",
              status === "idle" || status === "complete" || status === "error" || status === "reviewing"
                ? "bg-blue-600 text-white hover:bg-blue-700 hover:scale-105 active:scale-95"
                : "bg-muted text-muted-foreground cursor-not-allowed hidden" // Hide if busy to avoid clutter, or keep disabled
            )}
          >
            <Play className="w-5 h-5" /> Scan Full File
          </button>
          <button
            onClick={handleScanTOC}
            disabled={status !== "idle" && status !== "complete" && status !== "error" && status !== "reviewing" && status !== "scanning_toc"}
            className={cn(
              "px-8 py-3 rounded-full font-bold text-lg flex items-center gap-2 transition-all shadow-lg hover:shadow-purple-500/25 ml-4", // Added margin left
              status === "idle" || status === "complete" || status === "error" || status === "reviewing"
                ? "bg-purple-600 text-white hover:bg-purple-700 hover:scale-105 active:scale-95"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            {status === "scanning_toc" ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" /> Scanning...
              </>
            ) : (
              <>
                <List className="w-5 h-5" /> Scan Table of Contents
              </>
            )}
          </button>
        </div>

        {/* TOC Panel */}
        {toc.length > 0 && (status === "scanning_toc" || status === "idle" || status === "reviewing" || status === "extracting" || status === "analyzing" || status === "generating" || status === "complete") && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="bg-card border border-border rounded-lg p-6 space-y-4 shadow-lg"
          >
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-xl font-bold flex items-center gap-2 text-primary">
                <List className="w-5 h-5" /> Table of Contents
              </h3>
              <span className="text-xs text-muted-foreground">Click a section to generate Anki cards for it</span>
            </div>

            <div className="max-h-[500px] overflow-y-auto pr-2 custom-scrollbar space-y-1">
              {toc.map((item) => (
                <TOCNode key={item.id} item={item} onSelect={handleAnalyzeSection} selectedId={selectedSection} />
              ))}
            </div>
          </motion.div>
        )}

        {errorMsg && (
          <div className="bg-destructive/10 text-destructive p-4 rounded-lg flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            {errorMsg}
          </div>
        )}

        {/* Review Outline Panel - Visible during reviewing AND generating so user sees estimation */}
        {(status === "reviewing" || status === "generating") && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="bg-card border border-border rounded-lg p-6 space-y-4 shadow-lg"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold flex items-center gap-2 text-primary">
                <FileText className="w-5 h-5" /> Review Outline
              </h3>
              <div className="flex flex-col items-end gap-1">
                <div className="text-sm font-medium bg-secondary text-secondary-foreground px-3 py-1 rounded-full">
                  Estimated: ~{commands.length * 3}-{commands.length * 8} cards
                </div>
                <div className="text-xs text-muted-foreground">
                  Time: ~{Math.ceil(commands.length * 0.5)} mins
                </div>
              </div>
            </div>

            <p className="text-muted-foreground text-sm">
              Gemini has analyzed your document. Please review the outline below.
              If it looks good, click <b>Start Generation</b> above.
            </p>

            <div className="bg-muted/30 p-4 rounded-md h-64 overflow-y-auto border border-border custom-scrollbar">
              <pre className="whitespace-pre-wrap text-sm font-mono text-foreground/80">
                {outlineContent}
              </pre>
            </div>
          </motion.div>
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

        {/* Results with Edit Mode */}
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
                <button
                  onClick={clearHistory}
                  className="px-3 py-2 text-destructive hover:bg-destructive/10 rounded-md text-sm font-medium transition-colors"
                >
                  Clear History
                </button>
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

            {/* Editable Card List */}
            <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
              {generatedCards.map((card, idx) => {
                const parts = card.split("\t");
                const q = parts[0] || "";
                const a = parts[1] || "";
                const tag = parts[2] || "";

                return (
                  <div key={idx} className="p-4 rounded-lg bg-muted/30 border border-border space-y-3 group relative">
                    <button
                      onClick={() => handleDeleteCard(idx)}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 text-destructive hover:bg-destructive/10 rounded transition-all"
                      title="Delete Card"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-muted-foreground uppercase">Question (Front)</label>
                      <textarea
                        value={q}
                        onChange={(e) => handleCardUpdate(idx, `${e.target.value}\t${a}\t${tag}`)}
                        className="w-full p-2 bg-background border border-border rounded-md text-sm font-medium focus:ring-1 focus:ring-primary outline-none min-h-[60px]"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-muted-foreground uppercase">Answer (Back - HTML)</label>
                      <textarea
                        value={a}
                        onChange={(e) => handleCardUpdate(idx, `${q}\t${e.target.value}\t${tag}`)}
                        className="w-full p-2 bg-background border border-border rounded-md text-sm font-mono text-muted-foreground focus:ring-1 focus:ring-primary outline-none min-h-[100px]"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-muted-foreground uppercase">Tags (Hierarchical)</label>
                      <input
                        type="text"
                        value={tag}
                        onChange={(e) => handleCardUpdate(idx, `${q}\t${a}\t${e.target.value}`)}
                        placeholder="Deck::SubDeck::Topic"
                        className="w-full p-2 bg-background border border-border rounded-md text-sm font-mono text-blue-600 focus:ring-1 focus:ring-primary outline-none"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}


      </div>
    </div>
  );
}

function TOCNode({ item, onSelect, selectedId }: { item: TOCItem; onSelect: (label: string) => void; selectedId: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = item.children && item.children.length > 0;
  const isSelected = item.label === selectedId;

  return (
    <div className="ml-4">
      <div className="flex items-center gap-1 group">
        {hasChildren ? (
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        ) : (
          <span className="w-6" /> // Spacer
        )}

        <button
          onClick={() => onSelect(item.label)}
          className={cn(
            "flex-1 text-left py-1 px-2 rounded transition-colors text-sm font-medium truncate flex items-center gap-2",
            isSelected ? "bg-primary/20 text-primary font-bold" : "hover:bg-primary/10 hover:text-primary"
          )}
          title={item.label}
        >
          {item.label}
          {isSelected && <Target className="w-3 h-3 text-primary animate-pulse" />}
          {!isSelected && <Target className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-primary" />}
        </button>
      </div>

      {hasChildren && expanded && (
        <div className="border-l border-border ml-3 pl-1">
          {item.children.map((child) => (
            <TOCNode key={child.id} item={child} onSelect={onSelect} selectedId={selectedId} />
          ))}
        </div>
      )}
    </div>
  );
}
