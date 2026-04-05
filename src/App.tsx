import { useState, useRef, useEffect, useCallback } from "react";
import { GeminiService, type ContentPart } from "./lib/gemini";
import { fileToGenerativePart } from "./lib/file-processing";
import { PROMPTS } from "./prompts";
import {
  Upload, FileText, CheckCircle, Loader2, Download,
  Settings, AlertCircle, ChevronDown, ChevronUp, ListFilter,
  Trash2, RotateCcw, Sparkles, FileType,
  ClipboardPaste, Target, Key, Bot, Sun, Moon
} from "lucide-react";
import { cn } from "./lib/utils";
import { motion, AnimatePresence } from "framer-motion";

type AppState = "idle" | "uploading" | "analyzing" | "extracting" | "generating" | "complete" | "error";

const MODEL_OPTIONS = [
  { value: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash-Lite", desc: "Nhanh · Tiết kiệm · Khuyên dùng", icon: "⚡", badge: "Khuyên dùng" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", desc: "Cân bằng tốc độ và chất lượng", icon: "🧠" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", desc: "Chất lượng cao nhất · Chậm hơn", icon: "🏆" },
  { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", desc: "Siêu rẻ cho tài liệu dài", icon: "💨" },
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash", desc: "Preview · Ít ảo giác nhất", icon: "🔬" },
];

const STATUS_LABELS: Record<AppState, string> = {
  idle: "Sẵn sàng",
  uploading: "Đang tải lên...",
  analyzing: "Đang phân tích...",
  extracting: "Đang trích xuất...",
  generating: "Đang tạo thẻ...",
  complete: "Hoàn tất!",
  error: "Có lỗi xảy ra",
};

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
  const [selectedModel, setSelectedModel] = useState("gemini-3.1-flash-lite-preview");
  const [outline, setOutline] = useState("");
  const [showOutline, setShowOutline] = useState(false);
  const [hasGeneratedThisSession, setHasGeneratedThisSession] = useState(false);
  const [showLogs, setShowLogs] = useState(true);
  const [darkMode, setDarkMode] = useState(false);

  const [dragActive, setDragActive] = useState(false);
  const geminiRef = useRef<GeminiService | null>(null);

  // Dark mode toggle
  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

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
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setGeneratedCards(parsed);
          setHasGeneratedThisSession(true);
          setStatus("complete");
        }
      } catch (e) {
        console.error("Failed to load history", e);
        localStorage.removeItem("anki-cards-history");
      }
    }
  }, []);

  useEffect(() => {
    if (generatedCards.length > 0 && hasGeneratedThisSession) {
      localStorage.setItem("anki-cards-history", JSON.stringify(generatedCards));
    }
  }, [generatedCards, hasGeneratedThisSession]);

  const handleClearHistory = useCallback(() => {
    setGeneratedCards([]);
    setHasGeneratedThisSession(false);
    setStatus("idle");
    setLogs([]);
    setOutline("");
    setProgress(0);
    setErrorMsg("");
    localStorage.removeItem("anki-cards-history");
  }, []);

  const addLog = (msg: string) => setLogs((prev) => [...prev, msg]);

  // ========== CORE LOGIC ==========
  const handleAnalyze = async () => {
    if (!apiKey) {
      setErrorMsg("Vui lòng nhập Gemini API Key để bắt đầu.");
      return;
    }

    let contentName = "Tài liệu";
    const userFocus = topicScope.trim()
      ? `CHỦ ĐỀ CẦN TẬP TRUNG: "${topicScope}". (Chỉ trích xuất nội dung liên quan đến chủ đề này).`
      : "Xử lý toàn bộ tài liệu.";

    if (inputMode === "file") {
      if (!file) { setErrorMsg("Vui lòng tải lên file PDF hoặc tài liệu."); return; }
      contentName = file.name;
    } else {
      if (!textInput.trim()) { setErrorMsg("Vui lòng dán nội dung văn bản."); return; }
      contentName = "Văn bản dán";
    }

    try {
      setErrorMsg(""); setLogs([]); setGeneratedCards([]);
      setHasGeneratedThisSession(true); setStatus("uploading");
      setProgress(5); setShowLogs(true);
      addLog("🚀 Bắt đầu phân tích...");
      if (topicScope.trim()) addLog(`🎯 Phạm vi: ${topicScope}`);

      const keys = apiKey.split(',').map(k => k.trim()).filter(Boolean);
      if (keys.length === 0) { setErrorMsg("Vui lòng nhập ít nhất 1 API Key hợp lệ."); return; }
      const gemini = new GeminiService(keys, selectedModel);
      geminiRef.current = gemini;

      let filePart: ContentPart | null = null;
      if (inputMode === "file" && file) {
        addLog(`📄 Đang xử lý file: ${file.name}...`);
        
        if (file.size > 2 * 1024 * 1024) { // over 2MB
          addLog(`☁️ File lớn (>2MB): Đang tải lên hệ thống Google File API. Vui lòng đợi...`);
          try {
            filePart = await gemini.uploadFile(file, (msg) => addLog(msg));
            addLog("✅ Tải lên và xử lý file bởi Google thành công!");
          } catch (e: unknown) {
            const err = e instanceof Error ? e.message : String(e);
            addLog(`⚠️ Upload API thất bại (${err}). Đang dùng Fallback Base64 nội bộ...`);
            filePart = await fileToGenerativePart(file);
          }
        } else {
          filePart = await fileToGenerativePart(file);
          addLog("✅ File nhỏ: Đã chuyển đổi (Base64) thành công.");
        }
      } else {
        addLog("✅ Nội dung văn bản sẵn sàng.");
      }

      setStatus("analyzing"); setOutline(""); setShowOutline(false);
      addLog("🔵 Đang phân tích cấu trúc tài liệu...");

      const finalContent = inputMode === "file" && filePart ? filePart : textInput;
      gemini.setContext(PROMPTS.MedicalTutor, finalContent);
      setProgress(10);

      const phase1Command = `USER COMMAND: Giai đoạn 1 bài ${contentName}. ${userFocus}`;
      addLog("⏳ Gửi yêu cầu tới Gemini (Giai đoạn 1 — Lập dàn ý)...");
      const phase1Output = await gemini.generateWithContext(phase1Command, (m) => addLog(`   └─ ${m}`));
      setOutline(phase1Output); setProgress(30);
      addLog("✅ Dàn ý đã được tạo xong.");

      setStatus("extracting");
      addLog("🟠 Đang trích xuất các lệnh tạo thẻ...");
      const extractionPrompt = `${PROMPTS.DataExtractor}\n\n=== INPUT OUTLINE ===\n${phase1Output}`;
      const phase2Output = await gemini.generateContent(extractionPrompt);
      
      // Sử dụng Regex để bắt đúng các dòng "Giai đoạn 2" bất kể Markdown hay text bọc ngoài
      const phase2Match = phase2Output.match(/(Giai đoạn 2 phần .*?:)/gi);
      const cmds = phase2Match ? phase2Match.map(m => m.trim()) : [];

      if (cmds.length === 0) {
        console.warn("Raw phase2Output:", phase2Output);
        addLog("⚠️ Cảnh báo: Gemini không trả về đúng định dạng lệnh. Thử trích xuất thủ công...");
        // Fallback sang cách cũ nếu regex hụt
        const fallbackCmds = phase2Output.split("\n")
          .map(line => line.replace(/^[-*0-9.)]+\s*/, "").replace(/\*\*/g, "").trim())
          .filter(line => line.toLowerCase().includes("giai đoạn 2") && line.length > 10);
        
        if (fallbackCmds.length === 0) throw new Error("Không thể nhận diện lệnh xử lý. Kiểm tra lại tài liệu đầu vào.");
        cmds.push(...fallbackCmds);
      }
      
      // Tối ưu số lần gọi API (Gom nhóm các lệnh)
      // GIẢM BATCH_SIZE xuống còn 2 để ép Gemini tập trung sâu vào từng mục, 
      // tránh việc tóm tắt quá mức khi gửi nhiều mục cùng lúc.
      const BATCH_SIZE = 2; 
      const batchedCmds: string[][] = [];
      for (let i = 0; i < cmds.length; i += BATCH_SIZE) {
        batchedCmds.push(cmds.slice(i, i + BATCH_SIZE));
      }

      setProgress(50);
      addLog(`✅ Tìm được ${cmds.length} phần cần xử lý.`);
      addLog(`⚡ Đã tối ưu (Batching): Rút gọn từ ${cmds.length} xuống còn ${batchedCmds.length} lượt gọi API để tiết kiệm Quota/Key.`);
      await startGeneration(batchedCmds);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg || "Đã xảy ra lỗi không xác định.");
      setStatus("error"); addLog(`❌ Lỗi: ${msg}`);
    }
  };

  const startGeneration = async (batches: string[][]) => {
    try {
      setStatus("generating");
      addLog("🟣 Bắt đầu tạo thẻ Anki...");
      const gemini = geminiRef.current;
      if (!gemini) throw new Error("Service chưa được khởi tạo. Vui lòng thử lại.");

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        addLog(`⚙️ Xử lý cụm ${i + 1}/${batches.length} (gồm ${batch.length} phần nhỏ)...`);
        setProgress(50 + ((i + 1) / batches.length) * 50);
        try {
          const batchCommandsText = batch.map(b => `- ${b}`).join("\n");
          const prompt = `USER COMMAND (DEEP-LEVEL MODE):\nVui lòng MỞ RỘNG và TẠO THẺ ANKI CỰC KỲ CHI TIẾT cho các mục tiêu sau đây:\n${batchCommandsText}\n\nCRITICAL INSTRUCTION (NGUYÊN TẮC VÉT CẠN):\n1. Phải tạo ít nhất 5-10 thẻ cho mỗi mục tiêu nêu trên nếu tài liệu có dữ kiện.\n2. GIỮ NGUYÊN mọi thông số: liều lượng (mg, mcg), thời gian (phút, giờ, ngày), các phân độ y khoa, các lưu ý nhỏ.\n3. TUYỆT ĐỐI KHÔNG TÓM TẮT. Thà viết dài thành nhiều thẻ còn hơn viết ngắn mất ý.\n4. Sử dụng chuỗi [ANKI-SEP] để ngăn cách 3 thành phần: Câu hỏi[ANKI-SEP]Câu trả lời[ANKI-SEP]Tags.\n5. Chỉ phân tích nội dung trong tài liệu đã nạp. Mọi thẻ phải nằm trong Code Block.`;
          
          const cardOutput = await gemini.generateWithContext(prompt, (m) => addLog(`   └─ ${m}`));
          
          // ANKI LINE HEALING ENGINE (Siết chặt định dạng 100%)
          // Chúng ta sẽ parse từng dòng để đảm bảo không có lỗi chênh lệch cột khi import vào Anki.
          const healedBatch = cardOutput
            .replace(/```/g, "")
            .split("\n")
            .map(line => {
              const trimmedLine = line.trim();
              if (!trimmedLine) return null;
              
              // Hỗ trợ cả [ANKI-SEP] mới và [TAB] cũ làm fallback
              const separator = trimmedLine.includes("[ANKI-SEP]") ? "[ANKI-SEP]" : "[TAB]";
              let parts = trimmedLine.split(separator).map(p => p.trim());
              
              // Bỏ qua các dòng không có dấu phân cách (rác)
              if (parts.length < 2) return null;
              
              // HEALING: Đảm bảo luôn có 3 cột (Question, Answer, Tags)
              if (parts.length === 2) {
                // Nếu AI quên Tags, thêm Tags mặc định từ tài liệu
                parts.push("MedicalMaster::AutoGenerated");
              } else if (parts.length > 3) {
                // Nếu AI để dấu phân cách lung tung, gộp phần thừa vào Answer
                const question = parts[0];
                const tags = parts[parts.length - 1];
                const content = parts.slice(1, parts.length - 1).join(" - ");
                parts = [question, content, tags];
              }
              
              // Làm sạch nội dung: Xóa mọi ký tự Tab thực tế vô tình lọt vào content
              // để tránh làm hỏng cấu trúc file .txt
              return parts.map(p => p.replace(/\t/g, " ")).join("\t");
            })
            .filter(Boolean)
            .join("\n");
          
          // Cập nhật thẻ ngay lập tức để người dùng thấy tiến độ
          setGeneratedCards(prev => [...prev, healedBatch]);
        } catch (e: unknown) {
          const errMsg = e instanceof Error ? e.message : String(e);
          addLog(`⚠️ Cụm ${i + 1} bị lỗi: ${errMsg}. Bỏ qua...`);
        }
      }

      addLog("✅ Hoàn tất tất cả các phần!");
      setStatus("complete");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg); setStatus("error"); addLog(`❌ Lỗi: ${msg}`);
    } finally {
      // Cleanup logic if needed (File API handles its own TTL)
    }
  };

  const handleDownload = () => {
    const allText = generatedCards.join("\n");
    const cleanLines = allText.split("\n")
      .map(l => l.trim()).filter(l => l.length > 0)
      .filter(l => !l.startsWith("```"))
      .filter(l => !l.match(/^(html|xml|json|markdown|txt|text)$/i))
      .filter(l => l.includes("\t"));

    const processedLines = cleanLines.map(line => {
      const parts = line.split("\t");
      if (parts.length >= 3) {
        return `${parts[0]}\t${parts[1]}\t${parts[2].trim().replace(/\s+/g, "_")}`;
      }
      return line;
    });

    if (processedLines.length === 0) {
      alert("Không tìm thấy thẻ hợp lệ! Kiểm tra lại kết quả."); return;
    }

    const blob = new Blob([processedLines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `anki_${file?.name || topicScope.trim().replace(/\s+/g, '_') || "cards"}.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDragActive(false);
    if (e.dataTransfer.files?.[0]) setFile(e.dataTransfer.files[0]);
  };

  const totalCards = generatedCards.join("\n").split("\n").filter(l => l.includes("\t")).length;
  const isProcessing = status !== "idle" && status !== "complete" && status !== "error";

  return (
    <div className="min-h-screen bg-background text-foreground transition-colors duration-300">

      {/* ===== HEADER BAR ===== */}
      <header className="sticky top-0 z-50 glass-header border-b border-border/50">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src={darkMode ? "/ponz-dark.png" : "/ponz-header.png"}
              alt="PonZ"
              className="h-8 object-contain"
            />
            <div className="hidden sm:block h-6 w-px bg-border" />
            <div className="hidden sm:block">
              <h1 className="text-sm font-bold leading-tight">
                Medical Master <span className="pro-gradient-text font-black">Pro</span>
              </h1>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest leading-tight">
                Medical Engine by PonZ
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden sm:block text-[10px] text-muted-foreground uppercase tracking-wider font-bold">
              Mastered by PonZ
            </span>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="w-9 h-9 rounded-lg border border-border flex items-center justify-center hover:bg-muted/50 transition-colors"
              title={darkMode ? "Chế độ sáng" : "Chế độ tối"}
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* ===== MAIN CONTENT ===== */}
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">

        {/* Hero tagline */}
        <div className="text-center space-y-2 py-2">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Tạo thẻ <span className="pro-gradient-text">Anki Y khoa</span> tự động
          </h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Tải tài liệu lên → AI phân tích toàn diện → Xuất thẻ flashcard chất lượng cao.
            <span className="font-semibold text-foreground/80"> Học ít, hiểu sâu, nhớ lâu.</span>
          </p>
        </div>

        {/* Error */}
        <AnimatePresence>
          {errorMsg && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="app-card p-4 border-destructive/30 bg-destructive/5 flex items-start gap-3 text-sm"
            >
              <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-destructive">Lỗi</p>
                <p className="mt-0.5 text-muted-foreground">{errorMsg}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ===== CONFIGURATION ===== */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="w-full app-card p-4 flex items-center justify-between hover:shadow-md transition-all group"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg pro-gradient flex items-center justify-center">
                <Settings className="w-4 h-4 text-white" />
              </div>
              <div className="text-left">
                <h3 className="text-sm font-semibold">Cài đặt</h3>
                <p className="text-xs text-muted-foreground">API Key · Model AI</p>
              </div>
            </div>
            <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform duration-300", showConfig && "rotate-180")} />
          </button>

          <AnimatePresence>
            {showConfig && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="overflow-hidden"
              >
                <div className="pt-3 space-y-3">
                  {/* API Key */}
                  <div className="app-card p-4 space-y-3">
                    <label className="text-sm font-semibold flex items-center gap-2">
                      <Key className="w-3.5 h-3.5 text-amber-500" />
                      Gemini API Key
                    </label>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="Nhập 1 hoặc nhiều key, cách nhau bởi dấu phẩy (,)"
                      className="w-full p-3 rounded-lg bg-muted/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 outline-none transition-all text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      🔒 Key chỉ dùng trên trình duyệt của bạn, không gửi lên server.
                    </p>
                  </div>

                  {/* Model Selection */}
                  <div className="app-card p-4 space-y-3">
                    <label className="text-sm font-semibold flex items-center gap-2">
                      <Bot className="w-3.5 h-3.5 text-primary" />
                      Model AI
                    </label>
                    <div className="space-y-1.5">
                      {MODEL_OPTIONS.map((model) => (
                        <button
                          key={model.value}
                          onClick={() => setSelectedModel(model.value)}
                          className={cn(
                            "w-full p-3 rounded-lg text-left transition-all flex items-center gap-3",
                            selectedModel === model.value
                              ? "bg-primary/5 border border-primary/30 ring-1 ring-primary/20"
                              : "border border-transparent hover:bg-muted/50"
                          )}
                        >
                          <span className="text-lg">{model.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold flex items-center gap-2">
                              {model.label}
                              {model.badge && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full pro-gradient text-white font-bold uppercase tracking-wider">
                                  {model.badge}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">{model.desc}</p>
                          </div>
                          <div className={cn(
                            "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
                            selectedModel === model.value ? "border-primary bg-primary" : "border-border"
                          )}>
                            {selectedModel === model.value && <div className="w-2 h-2 rounded-full bg-white" />}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* ===== INPUT SECTION ===== */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="app-card overflow-hidden"
        >
          {/* Tabs */}
          <div className="flex border-b border-border">
            <button
              onClick={() => setInputMode("file")}
              className={cn(
                "flex-1 px-4 py-3 flex items-center justify-center gap-2 text-sm font-semibold transition-all relative",
                inputMode === "file" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <FileType className="w-4 h-4" />
              Tải File
              {inputMode === "file" && (
                <motion.div layoutId="tab-active" className="absolute bottom-0 left-0 right-0 h-0.5 pro-gradient" />
              )}
            </button>
            <button
              onClick={() => setInputMode("text")}
              className={cn(
                "flex-1 px-4 py-3 flex items-center justify-center gap-2 text-sm font-semibold transition-all relative",
                inputMode === "text" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <ClipboardPaste className="w-4 h-4" />
              Dán Văn Bản
              {inputMode === "text" && (
                <motion.div layoutId="tab-active" className="absolute bottom-0 left-0 right-0 h-0.5 pro-gradient" />
              )}
            </button>
          </div>

          <div className="p-5">
            {inputMode === "file" ? (
              <label
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                className={cn(
                  "flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-xl cursor-pointer transition-all duration-300",
                  dragActive
                    ? "border-primary bg-primary/5 scale-[1.01]"
                    : "border-border hover:border-primary/40 hover:bg-primary/[0.02]"
                )}
              >
                <input type="file" className="hidden" accept=".pdf,.txt,.md,.png,.jpg,.jpeg,.webp,.heic" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                {file ? (
                  <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="flex flex-col items-center gap-3">
                    <div className="w-14 h-14 rounded-2xl pro-gradient flex items-center justify-center pro-shadow">
                      <FileText className="w-7 h-7 text-white" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-bold">{file.name}</p>
                      <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                  </motion.div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-14 h-14 rounded-2xl pro-gradient flex items-center justify-center pro-shadow upload-icon-bounce">
                      <Upload className="w-7 h-7 text-white" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-bold uppercase tracking-wide">
                        {dragActive ? "Thả file vào đây" : "Kéo thả hoặc nhấn để tải tài liệu"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1 uppercase tracking-wider">
                        Mastered by PonZ - Y khoa & Chuyên nghiệp
                      </p>
                    </div>
                    <div className="px-4 py-2 bg-muted/50 rounded-full">
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                        Hỗ trợ: PDF / Ảnh / TXT (Tối đa 50MB/file)
                      </p>
                    </div>
                  </div>
                )}
              </label>
            ) : (
              <textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Dán nội dung bài giảng, ghi chú, hoặc văn bản y khoa vào đây..."
                className="w-full h-48 p-4 rounded-xl bg-muted/30 border border-border focus:border-primary/40 focus:ring-2 focus:ring-primary/20 outline-none transition-all resize-none text-sm custom-scrollbar"
              />
            )}

            {/* Topic Focus */}
            <div className="mt-4 space-y-2">
              <label className="text-sm font-semibold flex items-center gap-2">
                <Target className="w-3.5 h-3.5 text-amber-500" />
                Chủ đề tập trung
                <span className="text-xs text-muted-foreground font-normal">(Tùy chọn)</span>
              </label>
              <input
                type="text"
                value={topicScope}
                onChange={(e) => setTopicScope(e.target.value)}
                placeholder="VD: 'Chương 3: Tim mạch', 'Bài viêm phổi'..."
                className="w-full p-3 rounded-lg bg-muted/30 border border-border focus:border-primary/40 focus:ring-2 focus:ring-primary/20 outline-none transition-all text-sm"
              />
            </div>
          </div>
        </motion.div>

        {/* ===== ACTION BUTTON ===== */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="flex justify-center">
          <button
            onClick={() => handleAnalyze()}
            disabled={isProcessing}
            className={cn(
              "px-10 py-3.5 rounded-xl font-black text-base uppercase tracking-wider flex items-center gap-2.5 transition-all duration-300",
              !isProcessing
                ? "pro-gradient text-white pro-shadow-lg hover:scale-[1.03] active:scale-[0.97] hover:opacity-90"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            {isProcessing ? (
              <><Loader2 className="w-5 h-5 animate-spin" />{STATUS_LABELS[status]}</>
            ) : (
              <><Sparkles className="w-5 h-5" />Phân Tích & Tạo Thẻ</>
            )}
          </button>
        </motion.div>

        {/* ===== PROGRESS & LOGS ===== */}
        <AnimatePresence>
          {(isProcessing || logs.length > 0) && (
            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
              {/* Progress */}
              {isProcessing && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-semibold text-muted-foreground">
                    <span>{STATUS_LABELS[status]}</span>
                    <span className="font-mono">{Math.round(progress)}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden relative">
                    <motion.div
                      className="h-full pro-gradient rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.5, ease: "easeOut" }}
                    />
                    <div className="absolute inset-0 progress-shimmer" />
                  </div>
                </div>
              )}

              {/* Terminal */}
              <div className="terminal-window rounded-xl overflow-hidden">
                <button
                  onClick={() => setShowLogs(!showLogs)}
                  className="terminal-header w-full flex items-center justify-between hover:opacity-80 transition-opacity"
                >
                  <div className="flex items-center gap-2">
                    <span className="terminal-dot bg-red-500/80" />
                    <span className="terminal-dot bg-yellow-500/80" />
                    <span className="terminal-dot bg-green-500/80" />
                    <span className="text-xs text-gray-400 ml-2 font-mono">Nhật ký hoạt động</span>
                  </div>
                  <span className="text-xs text-gray-500 font-mono">{logs.length} dòng</span>
                </button>
                <AnimatePresence>
                  {showLogs && (
                    <motion.div initial={{ height: 0 }} animate={{ height: 220 }} exit={{ height: 0 }} className="overflow-hidden">
                      <div className="h-[220px] overflow-y-auto p-4 custom-scrollbar text-[13px] font-mono">
                        {logs.map((log, i) => (
                          <div key={i} className="mb-1.5 flex gap-2 text-emerald-400/90">
                            <span className="text-gray-600 select-none shrink-0 text-xs tabular-nums pt-0.5">
                              {String(i + 1).padStart(2, '0')}
                            </span>
                            <span className="break-all">{log}</span>
                          </div>
                        ))}
                        <div ref={logsEndRef} />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Outline */}
              {outline && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="app-card overflow-hidden">
                  <button
                    onClick={() => setShowOutline(!showOutline)}
                    className="w-full p-3.5 flex items-center justify-between text-sm font-semibold hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <ListFilter className="w-4 h-4 text-primary" />
                      Xem dàn ý tài liệu
                    </div>
                    {showOutline ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  <AnimatePresence>
                    {showOutline && (
                      <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                        <div className="p-4 pt-0 text-xs font-mono whitespace-pre-wrap text-muted-foreground border-t border-border max-h-72 overflow-y-auto custom-scrollbar">
                          {outline}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ===== RESULTS ===== */}
        <AnimatePresence>
          {status === "complete" && hasGeneratedThisSession && generatedCards.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: "spring", damping: 20 }}
              className="pro-gradient-border app-card overflow-hidden"
            >
              <div className="p-6 space-y-5">
                {/* Stats header */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                      <CheckCircle className="w-5 h-5 text-emerald-500" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-emerald-600 dark:text-emerald-400">Tạo thẻ thành công!</h3>
                      <p className="text-xs text-muted-foreground">Sẵn sàng import vào Anki Desktop</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-4 bg-muted/30 px-4 py-2.5 rounded-xl border border-border/50">
                      <div className="text-center">
                        <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Tổng thẻ</div>
                        <div className="text-xl font-black font-mono">{totalCards}</div>
                      </div>
                      <div className="w-px h-8 bg-border/50" />
                      <div className="text-center">
                        <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Phần</div>
                        <div className="text-xl font-black font-mono">{generatedCards.length}</div>
                      </div>
                    </div>
                    <button onClick={handleClearHistory} className="p-2.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all" title="Xóa kết quả">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Download actions */}
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4 border-t border-border/50">
                  <button
                    onClick={handleDownload}
                    className="w-full sm:w-auto pro-gradient text-white px-8 py-3 rounded-xl font-black uppercase tracking-wider flex items-center justify-center gap-2.5 transition-all pro-shadow hover:opacity-90 active:scale-[0.97]"
                  >
                    <Download className="w-5 h-5" />
                    Tải File .txt (Import Anki)
                  </button>
                  <button
                    onClick={() => handleAnalyze()}
                    className="w-full sm:w-auto px-6 py-3 rounded-xl font-bold flex items-center justify-center gap-2.5 border border-border hover:bg-muted/50 transition-all"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Tạo lại
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        <footer className="text-center py-6 space-y-1">
          <p className="text-xs text-muted-foreground/60 uppercase tracking-wider font-medium">
            Medical Master Anki v1.8 · Powered by Google Gemini
          </p>
          <p className="text-xs text-muted-foreground/40">
            Made with ❤️ by PonZ
          </p>
        </footer>

      </main>
    </div>
  );
}
