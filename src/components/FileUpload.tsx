import { Upload, FileText, X } from "lucide-react";
import { cn } from "../lib/utils";
import React from "react";

interface FileUploadProps {
    files: File[];
    setFiles: (files: File[]) => void;
    inputMode: "file" | "text";
    setInputMode: (mode: "file" | "text") => void;
    textInput: string;
    setTextInput: (text: string) => void;
}

export function FileUpload({
    files,
    setFiles,
    inputMode,
    setInputMode,
    textInput,
    setTextInput
}: FileUploadProps) {

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            // Append files
            setFiles([...files, ...Array.from(e.target.files)]);
        }
    };

    const removeFile = (index: number, e: React.MouseEvent) => {
        e.preventDefault(); // Prevent opening file dialog
        e.stopPropagation();
        setFiles(files.filter((_, i) => i !== index));
        // If we removed the last file, we might want to clear input value to allow re-selecting same file?
        // But since input is hidden inside label, it's fine.
    };

    return (
        <div className="w-full">
            <div className="flex space-x-4 mb-4 border-b border-border">
                <button
                    onClick={() => setInputMode("file")}
                    className={cn("pb-2 border-b-2 transition-colors font-medium", inputMode === "file" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
                >
                    Upload Files ({files.length})
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
                    <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all group relative overflow-hidden">
                        <input
                            type="file"
                            className="hidden"
                            multiple // Enable multi-file
                            accept=".pdf,.txt,.md,.png,.jpg,.jpeg,.webp,.heic"
                            onChange={handleFileChange}
                        />

                        {files.length > 0 ? (
                            <div className="w-full h-full p-4 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2 content-start">
                                {files.map((f, i) => (
                                    <div key={i} className="flex items-center gap-2 bg-background/80 p-2 rounded border border-border h-10">
                                        <FileText className="w-4 h-4 text-primary shrink-0" />
                                        <span className="text-xs truncate flex-1">{f.name}</span>
                                        <button
                                            onClick={(e) => removeFile(i, e)}
                                            className="text-muted-foreground hover:text-destructive p-1 rounded-md transition-colors"
                                            title="Remove file"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </div>
                                ))}
                                <div className="flex items-center justify-center p-2 text-xs text-muted-foreground border border-dashed border-border rounded hover:bg-accent/50 h-10">
                                    + Add more
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                <Upload className="w-10 h-10 text-muted-foreground mb-2 group-hover:text-primary transition-colors" />
                                <p className="text-sm text-muted-foreground">Drop PDF or Text files here</p>
                                <p className="text-xs text-muted-foreground mt-1">Supports PDF, TXT, MD, Images</p>
                            </div>
                        )}
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
        </div>
    );
}
