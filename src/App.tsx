import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { GeminiService, type ContentPart } from "./lib/gemini";
import { fileToGenerativePart } from "./lib/file-processing";
import { AnkiConnectService } from "./lib/anki";
import { PROMPTS } from "./prompts";
import { CheckCircle, Loader2, Download, AlertCircle, RefreshCw, X } from "lucide-react";
import { cn } from "./lib/utils";
import { motion, AnimatePresence } from "framer-motion";

// Components
import { Header } from "./components/Header";
import { StatsPanel } from "./components/StatsPanel";
import { CardList } from "./components/CardList";
import { FileUpload } from "./components/FileUpload";

// Types
import type { AppState, Toast, GenerationStats } from "./types";

export default function App() {
  const [apiKey, setApiKey] = useState("");
  const [inputMode, setInputMode] = useState<"file" | "text">("file");
  const [files, setFiles] = useState<File[]>([]); // Multi-file support
  // const [file, setFile] = useState<File | null>(null); // Deprecated
  const [textInput, setTextInput] = useState("");
  const [topicScope, setTopicScope] = useState("");
  const [status, setStatus] = useState<AppState>("idle");
  const [logs, setLogs] = useState<string[]>([]);
  // const [progress, setProgress] = useState(0);
  const [generatedCards, setGeneratedCards] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [showConfig, setShowConfig] = useState(true);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "success" | "error">("idle");
  const [ankiUrl, setAnkiUrl] = useState("http://127.0.0.1:8765");
  const [deckName, setDeckName] = useState("Default");
  // const [outlineContent, setOutlineContent] = useState("");
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

  // Phase 3 Features: New State
  const [searchQuery, setSearchQuery] = useState("");
  const [exportFormat, setExportFormat] = useState<"csv" | "tsv">("csv");

  // Model Selection
  const [selectedModel, setSelectedModel] = useState("gemini-2.5-flash-lite");

  // Token Usage Tracking
  const [tokenUsage, setTokenUsage] = useState({ input: 0, output: 0, cached: 0 });
  const [currentChunkProgress, setCurrentChunkProgress] = useState({ current: 0, total: 0 });

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
          if (generatedCards.length > 0) {
            handleExport();
          }
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

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(e.dataTransfer.files);
      const validTypes = [".pdf", ".txt", ".md", ".png", ".jpg", ".jpeg", ".webp", ".heic"];

      const validFiles = droppedFiles.filter(file => {
        const ext = "." + file.name.split(".").pop()?.toLowerCase();
        return validTypes.includes(ext);
      });

      if (validFiles.length > 0) {
        setFiles(prev => [...prev, ...validFiles]);
        setInputMode("file");
        addToast(`Added ${validFiles.length} file(s)!`, "success");
      }

      if (validFiles.length < droppedFiles.length) {
        addToast(`Some files were skipped (invalid type).`, "error");
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

  // const clearHistory = () => { ... };

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

  // --- FILTERED CARDS (Search) ---
  const filteredCards = useMemo(() => {
    const allCards = parseAllCards();
    if (!searchQuery.trim()) return allCards;

    const query = searchQuery.toLowerCase();
    return allCards.filter(card =>
      card.question.toLowerCase().includes(query) ||
      card.answer.toLowerCase().includes(query)
    );
  }, [parseAllCards, searchQuery]);

  // --- EXPORT HANDLERS ---
  const handleExport = useCallback(() => {
    let content = "";

    // Determine filename
    let filenameName = files.length > 0 ? files[0].name : "data";
    if (files.length > 1) filenameName = `${files.length}_files_batch`;

    let filename = `anki_export_${filenameName}`;
    let mimeType = "text/plain";

    if (exportFormat === "csv") {
      content = generatedCards.join("\n");
      filename += ".csv";
      mimeType = "text/csv;charset=utf-8;";
    } else if (exportFormat === "tsv") {
      // TSV format - tab separated (better for Anki import)
      const cards = parseAllCards();
      content = cards.map(c => `${c.question}\t${c.answer}`).join("\n");
      filename += ".txt";
      mimeType = "text/tab-separated-values;charset=utf-8;";
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addToast(`Exported as ${exportFormat.toUpperCase()}!`, "success");
  }, [exportFormat, generatedCards, files, parseAllCards, addToast]);

  const addLog = (msg: string) => setLogs((prev) => [...prev, msg]);

  const handleAnalyze = async () => {
    if (!apiKey) {
      setErrorMsg("Please enter a valid Gemini API Key.");
      return;
    }

    // Validation
    if (inputMode === "file") {
      if (files.length === 0) {
        setErrorMsg("Please upload at least one file.");
        return;
      }
    } else {
      if (!textInput.trim()) {
        setErrorMsg("Please paste some text.");
        return;
      }
    }

    const contentName = inputMode === "file"
      ? (files.length === 1 ? files[0].name : `${files.length} Documents`)
      : "Text Data";

    const userFocus = topicScope.trim() ? `CHỦ ĐỀ CẦN TẬP TRUNG: "${topicScope}". (Chỉ trích xuất nội dung liên quan đến chủ đề này).` : "Xử lý toàn bộ tài liệu.";

    try {
      setErrorMsg("");
      setLogs([]);
      setGeneratedCards([]);
      setStatus("uploading");
      addLog("🚀 Starting analysis...");

      if (topicScope.trim()) {
        addLog(`🎯 Focus Scope: ${topicScope}`);
      }

      const gemini = new GeminiService(apiKey, selectedModel);
      geminiRef.current = gemini;
      addLog(`🤖 Using model: ${selectedModel}`);

      // 1. Prepare Content
      let contentInput: ContentPart | ContentPart[];

      if (inputMode === "file") {
        addLog(`� Processing ${files.length} file(s)...`);
        const parts = await Promise.all(files.map(f => fileToGenerativePart(f)));
        contentInput = parts;
        addLog(`✅ Files converted.`);
      } else {
        contentInput = textInput;
        addLog(`✅ Text content ready.`);
      }

      // Step 1: Create Cache
      setStatus("analyzing");
      addLog("� Creating Knowledge Base cache (saves ~90% tokens)...");

      const corePrompt = PROMPTS.MedicalTutor;
      await gemini.createCache(corePrompt, contentInput);

      addLog("✅ Cache created! Ready for processing.");

      // Phase 1: Generate outline using cached context
      const phase1Command = `USER COMMAND: Giai đoạn 1 bài ${contentName}. ${userFocus}`;
      addLog("⏳ Sending request to Gemini (Phase 1)...");
      const phase1Output = await gemini.generateWithCache(phase1Command);
      // setOutlineContent(phase1Output);
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
      if (!gemini) {
        throw new Error("Gemini service not initialized. Please re-analyze the document.");
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
      let estimatedInputTokens = 0;
      let estimatedOutputTokens = 0;

      // Helper function for delay (rate limit protection)
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      // Set initial progress
      setCurrentChunkProgress({ current: 0, total: commandsToProcess.length });

      for (let i = 0; i < commandsToProcess.length; i++) {
        const cmd = commandsToProcess[i];
        setCurrentChunkProgress({ current: i + 1, total: commandsToProcess.length });
        addLog(`📦 [${i + 1}/${commandsToProcess.length}] ${cmd.slice(0, 60)}...`);

        // Rate limit protection: wait 1.5s between requests (allows ~40 req/min, under 60 limit)
        if (i > 0) {
          await delay(1500);
        }

        try {
          // Use cached context - much cheaper!
          // Construct Prompt with History Awareness
          // History for duplicate detection (50 concepts for best duplicate prevention)
          const historyText = conceptHistory.length > 0
            ? `\n\n=== CÁC CÂU HỎI ĐÃ TẠO (TUYỆT ĐỐI KHÔNG LẶP LẠI) ===\n- ${conceptHistory.slice(-50).join("\n- ")}`
            : "";

          let cardOutput = "";
          let retried = false;

          // Retry logic with multiple strategies (optimized for token efficiency)
          // First attempt: full instructions + history
          // Retries: shorter prompts, no history (same chunk, already tried)
          const attempts = [
            {
              name: "Normal",
              prompt: `USER COMMAND: ${cmd}\n\n[SOURCE ONLY]${historyText}`
            },
            {
              name: "Paraphrase",
              prompt: `USER COMMAND: ${cmd}\n\n[PARAPHRASE - SOURCE ONLY]`
            },
            {
              name: "Simplify",
              prompt: `USER COMMAND: ${cmd}\n\n[SIMPLIFY - SOURCE ONLY]`
            }
          ];

          for (let attemptIdx = 0; attemptIdx < attempts.length; attemptIdx++) {
            const attempt = attempts[attemptIdx];
            try {
              if (attemptIdx > 0) {
                addLog(`⚠️ Chunk ${i + 1} blocked. Retrying with '${attempt.name}' mode (Attempt ${attemptIdx + 1}/${attempts.length})...`);
                await delay(2000 + (attemptIdx * 1000)); // Increase delay for each retry
                retried = true;
                retriedChunks++;
              }

              cardOutput = await gemini.generateWithCache(attempt.prompt);

              if (attemptIdx > 0) {
                addLog(`✅ Chunk ${i + 1} recovered with '${attempt.name}' mode.`);
              }
              break; // Success!
            } catch (err) {
              if (attemptIdx === attempts.length - 1) {
                // All attempts failed
                console.error(`Chunk ${i + 1} failed all attempts`, err);
                addLog(`❌ Chunk ${i + 1} failed all ${attempts.length} attempts. Skipping...`);
                blockedChunks++;
                cardOutput = ""; // Ensure empty output
              }
            }
          }

          // If no output generated after all retries, continue to next chunk
          if (!cardOutput) continue;

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

            // Estimate tokens (rough: 4 chars ≈ 1 token)
            const inputTokens = Math.round(cmd.length / 4) + 100; // prompt overhead
            const outputTokens = Math.round(cleanOutput.length / 4);
            estimatedInputTokens += inputTokens;
            estimatedOutputTokens += outputTokens;

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

      // Update token usage
      setTokenUsage({
        input: estimatedInputTokens,
        output: estimatedOutputTokens,
        cached: estimatedInputTokens * 10 // Rough estimate: cached context is ~10x prompt tokens
      });

      setGeneratedCards(allCards);
      setStatus("complete");
      addLog(`✅ Complete! ~${Math.round((estimatedInputTokens + estimatedOutputTokens) / 1000)}K tokens used`);
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

  // --- RENDER ---
  return (
    <div
      className="min-h-screen bg-background text-foreground transition-colors duration-300 flex flex-col items-center py-10 px-4 md:px-8 font-sans"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Toast Notifications */}
      <div className="fixed top-4 right-4 z-50 space-y-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              layout
              className={cn(
                "pointer-events-auto flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg border text-sm font-medium",
                toast.type === "success" ? "bg-card text-green-600 border-green-200" :
                  toast.type === "error" ? "bg-destructive text-destructive-foreground border-destructive" :
                    "bg-card text-foreground border-border"
              )}
            >
              {toast.type === "success" ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              {toast.message}
              <button onClick={() => removeToast(toast.id)} className="ml-auto hover:opacity-70 p-1">
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
            <div className="bg-background p-8 rounded-xl shadow-2xl border-2 border-primary border-dashed text-center">
              <Download className="w-16 h-16 text-primary mx-auto mb-4" />
              <p className="text-2xl font-bold text-primary">Drop files here to upload!</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="w-full max-w-3xl space-y-8 mt-4">
        <Header isDarkMode={isDarkMode} toggleTheme={toggleTheme} />

        {/* --- INPUT SECTION --- */}
        {status === "idle" || status === "complete" || status === "error" ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card border border-border rounded-lg p-6 space-y-6 shadow-sm"
          >
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Gemini API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full p-2 rounded-md bg-input border border-border focus:ring-2 focus:ring-primary outline-none transition-all"
                  placeholder="Enter your Gemini API Key..."
                />
              </div>

              <FileUpload
                files={files}
                setFiles={setFiles}
                inputMode={inputMode}
                setInputMode={setInputMode}
                textInput={textInput}
                setTextInput={setTextInput}
              />

              <div className="pt-2">
                <button
                  onClick={() => setShowConfig(!showConfig)}
                  className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
                >
                  {showConfig ? "Hide Advanced Options" : "Show Advanced Options"}
                </button>
              </div>

              <AnimatePresence>
                {showConfig && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden space-y-4"
                  >
                    <div className="space-y-2 pt-2">
                      <label className="text-sm font-medium">Topic Scope (Optional)</label>
                      <input
                        value={topicScope}
                        onChange={(e) => setTopicScope(e.target.value)}
                        className="w-full p-2 rounded-md bg-input border border-border"
                        placeholder="e.g. 'Cardiology', 'Chapter 1' (Focuses extraction)"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium">Anki Connect URL</label>
                        <input
                          value={ankiUrl}
                          onChange={(e) => setAnkiUrl(e.target.value)}
                          className="w-full p-2 rounded-md bg-input border border-border"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium">Deck Name</label>
                        <input
                          value={deckName}
                          onChange={(e) => setDeckName(e.target.value)}
                          className="w-full p-2 rounded-md bg-input border border-border"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="text-sm font-medium">AI Model</label>
                        <select
                          value={selectedModel}
                          onChange={(e) => setSelectedModel(e.target.value)}
                          className="w-full p-2 rounded-md bg-input border border-border"
                        >
                          <option value="gemini-2.5-flash-lite">⚡ 2.5 Flash-Lite (Rẻ nhất)</option>
                          <option value="gemini-2.5-flash">🧠 2.5 Flash (Thinking mode)</option>
                          <option value="gemini-3-flash-preview">🏆 3 Flash (Ít bịa nhất)</option>
                        </select>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {errorMsg && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="p-3 bg-destructive/10 text-destructive rounded-md text-sm flex items-center gap-2"
                >
                  <AlertCircle className="w-4 h-4" />
                  {errorMsg}
                </motion.div>
              )}

              <button
                onClick={handleAnalyze}
                disabled={inputMode === "file" ? files.length === 0 : !textInput.trim()}
                className={cn(
                  "w-full py-3 text-primary-foreground font-bold rounded-lg transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2",
                  "bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                Generate Anki Cards 🚀
              </button>
            </div>
          </motion.div>
        ) : null}

        {/* --- LOGS & PROGRESS --- */}
        {(status === "uploading" || status === "analyzing" || status === "extracting" || status === "generating") && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-muted/50 p-4 rounded-lg font-mono text-xs max-h-60 overflow-y-auto space-y-1 border border-border"
          >
            {/* Progress Bar for Generating */}
            {status === "generating" && currentChunkProgress.total > 0 && (
              <div className="mb-3 space-y-2">
                <div className="flex items-center justify-between text-sm font-medium">
                  <span>📦 Processing: {currentChunkProgress.current}/{currentChunkProgress.total} chunks</span>
                  <span>{Math.round((currentChunkProgress.current / currentChunkProgress.total) * 100)}%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div
                    className="bg-primary h-2 rounded-full transition-all duration-300"
                    style={{ width: `${(currentChunkProgress.current / currentChunkProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}
            {logs.map((log, i) => (
              <div key={i} className="text-muted-foreground break-words">{log}</div>
            ))}
            <div ref={logsEndRef} />
          </motion.div>
        )}

        {/* --- REVIEWING STATE --- */}
        {status === "reviewing" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card border border-border rounded-lg p-6 space-y-6 shadow-xl"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-blue-500" />
                  Review Generation Plan
                </h2>
                <span className="text-sm text-muted-foreground">{commands.length} sections found</span>
              </div>

              <div className="bg-muted/30 rounded-lg p-4 max-h-96 overflow-y-auto space-y-2 border border-border">
                {commands.map((cmd, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 bg-card rounded border border-border hover:border-primary/50 transition-colors">
                    <input
                      type="checkbox"
                      checked={selectedChunks.includes(i)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedChunks(prev => [...prev, i]);
                        } else {
                          setSelectedChunks(prev => prev.filter(idx => idx !== i));
                        }
                      }}
                      className="mt-1 w-4 h-4 accent-primary"
                    />
                    <div className="text-sm">
                      <span className="font-mono text-xs text-primary/70 block mb-1">Section {i + 1}</span>
                      {cmd}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => setStatus("idle")}
                  className="flex-1 py-3 px-4 rounded-lg border border-border hover:bg-muted transition-colors font-medium text-muted-foreground"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmGeneration}
                  disabled={selectedChunks.length === 0}
                  className="flex-[2] py-3 text-primary-foreground font-bold rounded-lg transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Confirm & Generate Cards 🚀
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* --- RESULTS --- */}
        {(status === "complete" || generatedCards.length > 0) && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card border border-border rounded-lg p-6 space-y-6 shadow-xl"
          >
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <h2 className="text-2xl font-bold text-green-500 flex items-center gap-2">
                <CheckCircle className="w-6 h-6" /> Generated ({filteredCards.length} cards)
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSyncAnki}
                  disabled={syncStatus === "syncing"}
                  className={cn(
                    "px-4 py-2 rounded-md font-medium flex items-center gap-2 transition-colors border border-border",
                    syncStatus === "success"
                      ? "bg-green-100 text-green-700 hover:bg-green-200"
                      : "bg-card hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  {syncStatus === "syncing" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  {syncStatus === "success" ? "Synced!" : "Sync to Anki"}
                </button>

                {/* Export Format Selector */}
                <div className="flex items-center gap-0 bg-card border border-border rounded-md overflow-hidden">
                  <select
                    value={exportFormat}
                    onChange={(e) => setExportFormat(e.target.value as "csv" | "tsv")}
                    className="bg-transparent text-sm px-2 py-2 outline-none cursor-pointer"
                  >
                    <option value="csv">CSV</option>
                    <option value="tsv">TSV</option>
                  </select>
                  <button
                    onClick={handleExport}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 font-medium flex items-center gap-2 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setShowStats(!showStats)}
                className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
              >
                {showStats ? "Hide Statistics" : "Show Statistics"}
              </button>
            </div>

            <StatsPanel
              showStats={showStats}
              stats={stats}
              generatedCardsCount={generatedCards.length}
              totalParsedCards={calculateStats()?.totalCards || 0}
              durationString={calculateStats()?.duration || "N/A"}
              cardsPerMinute={calculateStats()?.cardsPerMinute || 0}
              tokenUsage={tokenUsage}
            />

            <CardList
              viewMode={viewMode}
              setViewMode={setViewMode}
              generatedCards={generatedCards}
              filteredCards={filteredCards}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              handleDeleteCard={handleDeleteCard}
              handleCardUpdate={handleCardUpdate}
              flippedCards={flippedCards}
              toggleCardFlip={toggleCardFlip}
            />
          </motion.div>
        )}
      </div>
    </div>
  );
}
