import { motion, AnimatePresence } from "framer-motion";
import type { GenerationStats } from "../types.ts";

interface StatsPanelProps {
    showStats: boolean;
    stats: GenerationStats | null;
    generatedCardsCount: number;
    totalParsedCards: number;
    durationString: string;
    cardsPerMinute: number;
}

export function StatsPanel({
    showStats,
    stats,
    generatedCardsCount,
    totalParsedCards,
    durationString,
    cardsPerMinute
}: StatsPanelProps) {
    return (
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
                                {totalParsedCards}
                            </p>
                            <p className="text-xs text-muted-foreground uppercase">Total Cards</p>
                        </div>
                        <div className="text-center">
                            <p className="text-2xl font-bold text-foreground">{generatedCardsCount}</p>
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
                            ⏱️ Generated in {durationString} •
                            ~{cardsPerMinute} cards/min
                        </div>
                    )}
                </motion.div>
            )}
        </AnimatePresence>
    );
}
