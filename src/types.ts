export type AppState = "idle" | "uploading" | "analyzing" | "extracting" | "reviewing" | "generating" | "complete" | "error";

export interface Toast {
    id: number;
    message: string;
    type: "success" | "error" | "info";
}

export interface Card {
    question: string;
    answer: string;
    chunkIdx: number;
    cardIdx: number;
}

export interface GenerationStats {
    totalCards: number;
    blockedChunks: number;
    retriedChunks: number;
    startTime: number;
    endTime: number;
}
