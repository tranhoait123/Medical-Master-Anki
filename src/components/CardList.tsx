import { motion } from "framer-motion";
import { Search, X, Trash2 } from "lucide-react";
import { cn } from "../lib/utils";

interface CardListProps {
    viewMode: "raw" | "preview";
    setViewMode: (mode: "raw" | "preview") => void;
    generatedCards: string[];
    filteredCards: { question: string; answer: string; chunkIdx: number; cardIdx: number }[];
    searchQuery: string;
    setSearchQuery: (query: string) => void;
    handleDeleteCard: (index: number) => void;
    handleCardUpdate: (index: number, newContent: string) => void;
    flippedCards: Set<number>;
    toggleCardFlip: (cardIndex: number) => void;
}

export function CardList({
    viewMode,
    setViewMode,
    generatedCards,
    filteredCards,
    searchQuery,
    setSearchQuery,
    handleDeleteCard,
    handleCardUpdate,
    flippedCards,
    toggleCardFlip
}: CardListProps) {
    return (
        <div className="space-y-4">
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

            {/* Search Bar */}
            {viewMode === "preview" && (
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search cards by question or answer..."
                        className="w-full pl-10 pr-4 py-2 rounded-lg bg-input border border-border focus:ring-2 focus:ring-primary outline-none transition-all text-sm"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery("")}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>
            )}

            {/* Card Display Area */}
            {viewMode === "preview" ? (
                /* Preview Mode - FlipCards */
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                    {filteredCards.length === 0 ? (
                        <div className="col-span-2 text-center py-12 text-muted-foreground">
                            {searchQuery ? "No cards match your search." : "No cards generated yet."}
                        </div>
                    ) : filteredCards.map((card, idx) => (
                        <motion.div
                            key={`${card.chunkIdx}-${card.cardIdx}`}
                            className="relative"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.02 }}
                            style={{ perspective: "1000px" }}
                        >
                            <div
                                onClick={() => toggleCardFlip(idx)}
                                className="cursor-pointer relative"
                                style={{
                                    transformStyle: "preserve-3d",
                                    transition: "transform 0.5s",
                                    transform: flippedCards.has(idx) ? "rotateY(180deg)" : "rotateY(0deg)",
                                }}
                            >
                                {/* Front - Question */}
                                <div 
                                    className="min-h-[180px] rounded-xl border-2 border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10 p-4 flex flex-col"
                                    style={{ backfaceVisibility: "hidden" }}
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-bold text-primary uppercase">Question</span>
                                        <span className="text-xs text-muted-foreground">#{idx + 1}</span>
                                    </div>
                                    <p className="text-sm text-foreground flex-1 overflow-y-auto">{card.question}</p>
                                    <p className="text-xs text-muted-foreground mt-2 text-center">👆 Click to reveal answer</p>
                                </div>
                                {/* Back - Answer (pre-rotated 180deg so it appears correctly when flipped) */}
                                <div 
                                    className="absolute inset-0 min-h-[180px] rounded-xl border-2 border-green-500/30 bg-gradient-to-br from-green-500/5 to-green-500/10 p-4 flex flex-col"
                                    style={{
                                        backfaceVisibility: "hidden",
                                        transform: "rotateY(180deg)",
                                    }}
                                >
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
        </div>
    );
}
