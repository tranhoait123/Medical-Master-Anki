import { useState, useRef, useEffect, useCallback } from "react";
import { GeminiService } from "./lib/gemini";
import { fileToGenerativePart } from "./lib/file-processing";
import { AnkiConnectService } from "./lib/anki";
import { PROMPTS } from "./prompts";
import { Upload, FileText, CheckCircle, Loader2, Download, Play, Settings, AlertCircle, RefreshCw, Trash2, Sun, Moon, X, BarChart3 } from "lucide-react";
import { cn } from "./lib/utils";
import { motion, AnimatePresence } from "framer-motion";

type AppState = "idle" | "uploading" | "analyzing" | "extracting" | "reviewing" | "generating" | "complete" | "error";

// Toast notification type
interface Toast {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

// Statistics type
interface GenerationStats {
  totalCards: number;
  blockedChunks: number;
  retriedChunks: number;
  startTime: number;
  endTime: number;
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
  const [selectedChunks, setSelectedChunks] = useState<number[]>([]);
  const geminiRef = useRef<GeminiService | null>(null);

  // Phase 1 Features: New State
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [stats, setStats] = useState<GenerationStats | null>(null);
  const [showStats, setShowStats] = useState(false);

  // Phase 2 Features: New State
  const [viewMode, setViewMode] = useState<"raw" | "preview">("preview");
  const [flippedCards, setFlippedCards] = useState<Set<number>>(new Set());

  // Scroll to bottom of logs
  const logsEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // --- DARK MODE ---
  useEffect(() => {
    const savedTheme = localStorage.getItem("theme");
    if (savedTheme === "light") {
      setIsDarkMode(false);
      document.documentElement.classList.add("light");
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setIsDarkMode(prev => {
      const newMode = !prev;
      if (newMode) {
        document.documentElement.classList.remove("light");
        localStorage.setItem("theme", "dark");
      } else {
        document.documentElement.classList.add("light");
        localStorage.setItem("theme", "light");
      }
      return newMode;
    });
  }, []);

  // --- TOAST NOTIFICATIONS ---
  const addToast = useCallback((message: string, type: Toast["type"] = "info") => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    // Auto remove after 4s
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // --- KEYBOARD SHORTCUTS ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + Enter: Analyze or Generate
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (status === "reviewing") {
          handleConfirmGeneration();
        } else if (status === "idle" || status === "complete" || status === "error") {
          handleAnalyze();
        }
      }
      // Ctrl/Cmd + S: Download CSV
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (generatedCards.length > 0) {
          handleDownload();
          addToast("CSV downloaded!", "success");
        }
      }
      // Ctrl/Cmd + D: Toggle dark mode
      if ((e.ctrlKey || e.metaKey) && e.key === "d") {
        e.preventDefault();
        toggleTheme();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, generatedCards.length, toggleTheme, addToast]);

  // --- DRAG & DROP ---
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      const validTypes = [".pdf", ".txt", ".md", ".png", ".jpg", ".jpeg", ".webp", ".heic"];
      const ext = "." + droppedFile.name.split(".").pop()?.toLowerCase();
      if (validTypes.includes(ext)) {
        setFile(droppedFile);
        setInputMode("file");
        addToast(`File "${droppedFile.name}" loaded!`, "success");
      } else {
        addToast("Invalid file type. Supported: PDF, TXT, MD, Images", "error");
      }
    }
  }, [addToast]);


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
      // Limit localStorage size to prevent overflow (~4MB limit, keep last 500 cards max)
      const dataToSave = generatedCards.slice(-500);
      try {
        const jsonData = JSON.stringify(dataToSave);
        if (jsonData.length < 4 * 1024 * 1024) { // 4MB limit
          localStorage.setItem("anki-cards-history", jsonData);
        } else {
          console.warn("Data too large for localStorage, saving last 100 cards only");
          localStorage.setItem("anki-cards-history", JSON.stringify(dataToSave.slice(-100)));
        }
      } catch (e) {
        console.error("Failed to save to localStorage", e);
      }
    }
  }, [generatedCards]);

  const clearHistory = () => {
    if (confirm("Are you sure you want to clear all history?")) {
      setGeneratedCards([]);
      localStorage.removeItem("anki-cards-history");
      addToast("History cleared!", "info");
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

  // --- STATISTICS CALCULATION ---
  const calculateStats = useCallback(() => {
    if (!stats) return null;

    const totalCards = generatedCards.reduce((acc, chunk) => {
      return acc + chunk.split("\n").filter(line => line.trim().startsWith('"')).length;
    }, 0);

    const duration = stats.endTime - stats.startTime;
    const minutes = Math.floor(duration / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);

    return {
      totalCards,
      blockedChunks: stats.blockedChunks,
      retriedChunks: stats.retriedChunks,
      duration: `${minutes}m ${seconds}s`,
      cardsPerMinute: duration > 0 ? Math.round(totalCards / (duration / 60000)) : 0
    };
  }, [stats, generatedCards]);

  // --- PARSE ALL CARDS FOR PREVIEW ---
  const parseAllCards = useCallback(() => {
    const cards: { question: string; answer: string; chunkIdx: number; cardIdx: number }[] = [];

    generatedCards.forEach((chunk, chunkIdx) => {
      const lines = chunk.split('\n').filter(line => line.trim().startsWith('"'));
      lines.forEach((line, cardIdx) => {
        // Parse CSV line: "Question","Answer"
        const trimmed = line.trim();
        if (!trimmed.startsWith('"')) return;

        let inQuote = false;
        let separatorIndex = -1;
        for (let i = 0; i < trimmed.length; i++) {
          if (trimmed[i] === '"') {
            if (trimmed[i + 1] === '"') {
              i++; // Skip escaped quote
            } else {
              inQuote = !inQuote;
            }
          } else if (trimmed[i] === ',' && !inQuote && trimmed[i - 1] === '"') {
            separatorIndex = i;
            break;
          }
        }

        if (separatorIndex !== -1) {
          const question = trimmed.slice(1, separatorIndex - 1).replace(/""/g, '"');
          const answer = trimmed.slice(separatorIndex + 2, -1).replace(/""/g, '"');
          cards.push({ question, answer, chunkIdx, cardIdx });
        }
      });
    });

    return cards;
  }, [generatedCards]);

  // --- FLIP CARD TOGGLE ---
  const toggleCardFlip = useCallback((cardIndex: number) => {
    setFlippedCards(prev => {
      const newSet = new Set(prev);
      if (newSet.has(cardIndex)) {
        newSet.delete(cardIndex);
      } else {
        newSet.add(cardIndex);
      }
      return newSet;
    });
  }, []);



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
      setSelectedChunks(cmds.map((_, i) => i)); // Default select all
      addLog(`✅ Analysis complete. Found ${cmds.length} chunks.`);
      setStatus("reviewing");

    } catch (err: unknown) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg || "An unknown error occurred.");
      setStatus("error");
      addLog(`❌ Error: ${msg}`);
    }
  };

  const handleConfirmGeneration = async () => {
    try {
      setStatus("generating");
      addLog("🟣 Starting generation (using cached context)...");

      const gemini = geminiRef.current;
      if (!gemini || !gemini.hasCache()) {
        throw new Error("Cache expired or not available. Please re-analyze the document.");
      }

      if (selectedChunks.length === 0) {
        setErrorMsg("Please select at least one part to generate.");
        setStatus("reviewing");
        return;
      }

      const commandsToProcess = selectedChunks.map(i => commands[i]);
      const allCards: string[] = [];
      const conceptHistory: string[] = []; // Store generated questions to prevent duplicates

      // Statistics tracking
      const startTime = Date.now();
      let retriedChunks = 0;
      let blockedChunks = 0;

      // Helper function for delay (rate limit protection)
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      for (let i = 0; i < commandsToProcess.length; i++) {
        const cmd = commandsToProcess[i];
        addLog(`Processing chunk ${i + 1}/${commandsToProcess.length}: ${cmd.slice(0, 50)}...`);
        setProgress(((i + 1) / commandsToProcess.length) * 100);

        // Rate limit protection: wait 1.5s between requests (allows ~40 req/min, under 60 limit)
        if (i > 0) {
          await delay(1500);
        }

        try {
          // Use cached context - much cheaper!
          // Construct Prompt with History Awareness
          const historyText = conceptHistory.length > 0
            ? `\n\n=== PREVIOUSLY GENERATED CONCEPTS ===\n(Do NOT create cards for these concepts again to avoid duplicates):\n- ${conceptHistory.slice(-50).join("\n- ")}`
            : "";

          let cardOutput = "";
          let retried = false;

          try {
            // First attempt: normal prompt
            cardOutput = await gemini.generateWithCache(
              `USER COMMAND: ${cmd}\n\nCRITICAL INSTRUCTION: Analyze the cached document ONLY. Do NOT use external knowledge.${historyText}`
            );
          } catch {
            // If blocked, retry with paraphrase prompt
            addLog(`⚠️ Chunk ${i + 1} blocked. Retrying with paraphrase mode...`);
            retried = true;
            retriedChunks++;

            try {
              // Add delay before retry to avoid rate limit
              await delay(2000);
              cardOutput = await gemini.generateWithCache(
                `USER COMMAND: ${cmd}\n\nIMPORTANT: Giải thích các khái niệm BẰNG LỜI CỦA BẠN (paraphrase). Không trích dẫn nguyên văn. Vẫn giữ đầy đủ thông tin nhưng diễn đạt lại theo cách khác. Output CSV format.${historyText}`
              );
              addLog(`✅ Chunk ${i + 1} recovered with paraphrase mode.`);
            } catch (retryErr) {
              // Both attempts failed, skip this chunk
              console.error(`Chunk ${i + 1} failed both attempts`, retryErr);
              addLog(`❌ Chunk ${i + 1} failed both attempts. Skipping...`);
              blockedChunks++;
              continue;
            }
          }

          // Clean output: remove code blocks and extract only valid CSV lines
          const rawOutput = cardOutput.replace(/```(?:csv)?/gi, "").trim();

          // Filter to keep only valid CSV lines: "Question","Answer"
          const csvLines = rawOutput.split('\n')
            .map(line => line.trim())
            .filter(line => {
              // Match lines that start with " and contain "," pattern (CSV format)
              return line.startsWith('"') && line.includes('","');
            });

          const cleanOutput = csvLines.join('\n');
          if (cleanOutput) {
            allCards.push(cleanOutput);
            if (retried) {
              addLog(`📝 Added ${csvLines.length} cards (paraphrased) from chunk ${i + 1}`);
            }
          }

          // Extract Questions/Concepts from output to add to history
          // Assuming format: "Question","Answer"
          const newQuestions = cleanOutput.split('\n')
            .map(line => {
              const match = line.match(/^"(.*)","(.*)"$/);
              return match ? match[1] : "";
            })
            .filter(q => q && q.length > 5);

          conceptHistory.push(...newQuestions);
        } catch (chunkErr) {
          console.error(`Error processing chunk ${i + 1}`, chunkErr);
          addLog(`⚠️ Chunk ${i + 1} blocked by AI Safety Filter (Recitation). Skipping...`);
          blockedChunks++;
        }
      }

      addLog("✅ All chunks processed.");
      addLog("🧹 Cleaning up cache...");
      await gemini.deleteCache();

      // Save statistics
      const endTime = Date.now();
      setStats({
        totalCards: allCards.reduce((acc, chunk) => acc + chunk.split('\n').filter(l => l.startsWith('"')).length, 0),
        blockedChunks,
        retriedChunks,
        startTime,
        endTime
      });

      setGeneratedCards(allCards);
      setStatus("complete");
      addToast(`Generation complete! ${allCards.length} chunks processed.`, "success");
    } catch (err: unknown) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg || "An unknown error occurred.");
      setStatus("error");
      addLog(`❌ Error: ${msg}`);

      // Cleanup cache on error
      if (geminiRef.current?.hasCache()) {
        try {
          await geminiRef.current.deleteCache();
          addLog("🧹 Cache cleaned up after error.");
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  };

  const handleSyncAnki = async () => {
    try {
      setSyncStatus("syncing");
      const ankiService = new AnkiConnectService(ankiUrl, deckName);

      // Helper to parse CSV line properly (handles quotes inside content)
      const parseCSVLine = (line: string): [string, string] | null => {
        // Match: "content1","content2" where content can have escaped quotes ""
        const trimmed = line.trim();
        if (!trimmed.startsWith('"')) return null;

        // Find the separator ","  by looking for "," pattern
        let inQuote = false;
        let separatorIndex = -1;
        for (let i = 0; i < trimmed.length; i++) {
          if (trimmed[i] === '"') {
            if (trimmed[i + 1] === '"') {
              i++; // Skip escaped quote
            } else {
              inQuote = !inQuote;
            }
          } else if (trimmed[i] === ',' && !inQuote && trimmed[i - 1] === '"') {
            separatorIndex = i;
            break;
          }
        }

        if (separatorIndex === -1) return null;

        const front = trimmed.slice(1, separatorIndex - 1).replace(/""/g, '"');
        const back = trimmed.slice(separatorIndex + 2, -1).replace(/""/g, '"');
        return [front, back];
      };

      // Rate limit helper
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      // Parse cards
      let count = 0;
      for (const chunk of generatedCards) {
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          const parsed = parseCSVLine(line);
          if (parsed) {
            const [front, back] = parsed;
            await ankiService.addNote(front, back);
            count++;
            // Rate limit: wait 100ms between each card to avoid overwhelming AnkiConnect
            await delay(100);
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
    const blob = new Blob([generatedCards.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `anki_export_${file?.name || "data"}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Fix memory leak: revoke the object URL after download
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="min-h-screen bg-background text-foreground font-sans p-8 flex flex-col items-center"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Toast Notifications */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        <AnimatePresence>
          {toasts.map(toast => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 100 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 100 }}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border min-w-[280px]",
                toast.type === "success" && "bg-green-500/10 border-green-500/30 text-green-400",
                toast.type === "error" && "bg-red-500/10 border-red-500/30 text-red-400",
                toast.type === "info" && "bg-blue-500/10 border-blue-500/30 text-blue-400"
              )}
            >
              {toast.type === "success" && <CheckCircle className="w-5 h-5" />}
              {toast.type === "error" && <AlertCircle className="w-5 h-5" />}
              {toast.type === "info" && <Settings className="w-5 h-5" />}
              <span className="text-sm font-medium flex-1">{toast.message}</span>
              <button onClick={() => removeToast(toast.id)} className="hover:opacity-70">
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Drag Overlay */}
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-primary/10 backdrop-blur-sm flex items-center justify-center pointer-events-none"
          >
            <div className="bg-card border-2 border-dashed border-primary rounded-2xl p-12 text-center">
              <Upload className="w-16 h-16 text-primary mx-auto mb-4" />
              <p className="text-xl font-bold text-foreground">Drop your file here</p>
              <p className="text-muted-foreground text-sm mt-1">PDF, TXT, MD, or Images</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="w-full max-w-3xl space-y-8">

        {/* Header */}
        <header className="flex flex-col items-center text-center space-y-4 pt-8 relative">
          {/* Theme Toggle - Top Right */}
          <button
            onClick={toggleTheme}
            className="absolute top-2 right-0 p-2 rounded-full bg-card border border-border hover:bg-accent transition-colors"
            title={isDarkMode ? "Switch to Light Mode (Ctrl+D)" : "Switch to Dark Mode (Ctrl+D)"}
          >
            {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>

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
            onClick={status === "reviewing" ? handleConfirmGeneration : handleAnalyze}
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
                <Play className="w-5 h-5" /> Start Generation ({selectedChunks.length} chunks)
              </>
            ) : (
              <>
                <Play className="w-5 h-5" /> Analyze {inputMode === "file" ? "File" : "Text"}
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

        {/* Review Outline Panel */}
        {status === "reviewing" && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="bg-card border border-border rounded-lg p-6 space-y-4 shadow-lg"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold flex items-center gap-2 text-primary">
                <FileText className="w-5 h-5" /> Review Outline
              </h3>
              <div className="text-sm font-medium bg-secondary text-secondary-foreground px-3 py-1 rounded-full">
                Estimated: ~{selectedChunks.length * 20}-{selectedChunks.length * 30} cards
              </div>
            </div>

            <p className="text-muted-foreground text-sm">
              Gemini has analyzed your document. Review the outline and <b>select which parts</b> to generate cards for.
            </p>

            <div className="bg-muted/30 p-4 rounded-md h-48 overflow-y-auto border border-border custom-scrollbar">
              <pre className="whitespace-pre-wrap text-sm font-mono text-foreground/80">
                {outlineContent}
              </pre>
            </div>

            {/* Selective Generation UI */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-foreground">📋 Select Chunks to Generate</h4>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelectedChunks(commands.map((_, i) => i))}
                    className="text-xs px-2 py-1 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                  >
                    Select All
                  </button>
                  <button
                    onClick={() => setSelectedChunks([])}
                    className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              <div className="max-h-48 overflow-y-auto space-y-2 border border-border rounded-md p-3 bg-background custom-scrollbar">
                {commands.map((cmd, idx) => (
                  <label
                    key={idx}
                    className={cn(
                      "flex items-start gap-3 p-2 rounded-md cursor-pointer transition-colors",
                      selectedChunks.includes(idx) ? "bg-primary/10 border border-primary/30" : "hover:bg-muted/50"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selectedChunks.includes(idx)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedChunks([...selectedChunks, idx].sort((a, b) => a - b));
                        } else {
                          setSelectedChunks(selectedChunks.filter(i => i !== idx));
                        }
                      }}
                      className="mt-1 w-4 h-4 rounded border-border text-primary focus:ring-primary"
                    />
                    <span className="text-sm text-foreground/80 flex-1">
                      <span className="font-mono text-xs text-muted-foreground mr-2">#{idx + 1}</span>
                      {cmd.replace(/^Giai đoạn 2 phần /, "")}
                    </span>
                  </label>
                ))}
              </div>

              <p className="text-xs text-muted-foreground">
                💡 Tip: Bỏ chọn những phần "Đại cương" hoặc "Tổng quan" nếu bạn chỉ muốn học chi tiết.
              </p>
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
                  onClick={() => setShowStats(!showStats)}
                  className={cn(
                    "px-3 py-2 rounded-md text-sm font-medium transition-colors border border-border flex items-center gap-2",
                    showStats ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                  )}
                  title="Show/Hide Statistics"
                >
                  <BarChart3 className="w-4 h-4" />
                </button>
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
                  onClick={() => {
                    handleDownload();
                    addToast("CSV downloaded!", "success");
                  }}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md font-medium flex items-center gap-2 transition-colors shadow-sm"
                >
                  <Download className="w-4 h-4" /> Download .csv
                </button>
              </div>
            </div>

            {/* Statistics Panel */}
            <AnimatePresence>
              {showStats && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-muted/30 rounded-lg border border-border">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-primary">
                        {generatedCards.reduce((acc, chunk) => acc + chunk.split("\n").filter(line => line.trim().startsWith('"')).length, 0)}
                      </p>
                      <p className="text-xs text-muted-foreground uppercase">Total Cards</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-foreground">{generatedCards.length}</p>
                      <p className="text-xs text-muted-foreground uppercase">Chunks</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-yellow-500">{stats?.retriedChunks || 0}</p>
                      <p className="text-xs text-muted-foreground uppercase">Retried</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-red-500">{stats?.blockedChunks || 0}</p>
                      <p className="text-xs text-muted-foreground uppercase">Blocked</p>
                    </div>
                  </div>
                  {stats && (
                    <div className="mt-2 text-center text-xs text-muted-foreground">
                      ⏱️ Generated in {calculateStats()?.duration || "N/A"} •
                      ~{calculateStats()?.cardsPerMinute || 0} cards/min
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Keyboard Shortcuts Hint */}
            <div className="text-xs text-muted-foreground text-center border-t border-border pt-3">
              ⌨️ <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">Ctrl+S</kbd> Download CSV •
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs ml-2">Ctrl+D</kbd> Toggle Theme •
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs ml-2">Ctrl+Enter</kbd> Analyze/Generate
            </div>

            {/* View Mode Toggle */}
            <div className="flex items-center justify-between border-t border-border pt-4">
              <span className="text-sm font-medium text-muted-foreground">View Mode:</span>
              <div className="flex rounded-lg border border-border overflow-hidden">
                <button
                  onClick={() => setViewMode("preview")}
                  className={cn(
                    "px-4 py-2 text-sm font-medium transition-colors",
                    viewMode === "preview" ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                  )}
                >
                  🎴 Preview
                </button>
                <button
                  onClick={() => setViewMode("raw")}
                  className={cn(
                    "px-4 py-2 text-sm font-medium transition-colors border-l border-border",
                    viewMode === "raw" ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                  )}
                >
                  📝 Raw CSV
                </button>
              </div>
            </div>

            {/* Card Display Area */}
            {viewMode === "preview" ? (
              /* Preview Mode - FlipCards */
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                {parseAllCards().map((card, idx) => (
                  <motion.div
                    key={`${card.chunkIdx}-${card.cardIdx}`}
                    className="relative"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.02 }}
                  >
                    <div
                      onClick={() => toggleCardFlip(idx)}
                      className="cursor-pointer transition-all duration-500"
                      style={{
                        transformStyle: "preserve-3d",
                        transform: flippedCards.has(idx) ? "rotateY(180deg)" : "rotateY(0deg)",
                      }}
                    >
                      {/* Front - Question */}
                      {!flippedCards.has(idx) ? (
                        <div className="min-h-[180px] rounded-xl border-2 border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10 p-4 flex flex-col">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold text-primary uppercase">Question</span>
                            <span className="text-xs text-muted-foreground">#{idx + 1}</span>
                          </div>
                          <p className="text-sm text-foreground flex-1 overflow-y-auto">{card.question}</p>
                          <p className="text-xs text-muted-foreground mt-2 text-center">👆 Click to reveal answer</p>
                        </div>
                      ) : (
                        /* Back - Answer */
                        <div className="min-h-[180px] rounded-xl border-2 border-green-500/30 bg-gradient-to-br from-green-500/5 to-green-500/10 p-4 flex flex-col">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold text-green-500 uppercase">Answer</span>
                            <span className="text-xs text-muted-foreground">#{idx + 1}</span>
                          </div>
                          <div
                            className="text-sm text-foreground flex-1 overflow-y-auto"
                            dangerouslySetInnerHTML={{ __html: card.answer }}
                          />
                          <p className="text-xs text-muted-foreground mt-2 text-center">👆 Click to flip back</p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              /* Raw Mode - Editable CSV */
              <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                {generatedCards.map((card, idx) => (
                  <div key={idx} className="p-4 rounded-lg bg-muted/30 border border-border space-y-3 group relative">
                    <button
                      onClick={() => handleDeleteCard(idx)}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 text-destructive hover:bg-destructive/10 rounded transition-all"
                      title="Delete Chunk"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-muted-foreground uppercase">CSV Content (Chunk {idx + 1})</label>
                      <textarea
                        value={card}
                        onChange={(e) => handleCardUpdate(idx, e.target.value)}
                        className="w-full p-2 bg-background border border-border rounded-md text-sm font-mono text-muted-foreground focus:ring-1 focus:ring-primary outline-none min-h-[150px]"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}


      </div>
    </div>
  );
}
