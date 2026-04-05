import { GoogleGenAI, createUserContent } from "@google/genai";

export type ContentPart = 
    | { inlineData: { data: string; mimeType: string } } 
    | { fileData: { fileUri: string; mimeType: string } }
    | { text: string } 
    | string;

type InternalPart = 
    | { inlineData: { data: string; mimeType: string } } 
    | { fileData: { fileUri: string; mimeType: string } }
    | { text: string };

/**
 * GeminiService: Optimized for Google File API (No Context Caching dependency)
 * This version uses Direct Injection + File API for maximum stability on Free Tier.
 */
export class GeminiService {
    private ais: GoogleGenAI[];
    private currentKeyIndex = 0;
    private modelName = "gemini-1.5-flash"; 
    private lastSystemPrompt: string = "";
    private lastContentParts: InternalPart[] = [];
    private maxRetries = 6;
    private isKeyPinned = false; 

    constructor(apiKeys: string[], modelName?: string) {
        if (!apiKeys || apiKeys.length === 0) throw new Error("Vui lòng cung cấp ít nhất 1 API Key");
        this.ais = apiKeys.map(key => new GoogleGenAI({ apiKey: key }));
        if (modelName) this.modelName = modelName;
    }

    private get ai(): GoogleGenAI {
        return this.ais[this.currentKeyIndex];
    }

    private rotateKey(): boolean {
        if (this.isKeyPinned || this.ais.length <= 1) return false;
        this.currentKeyIndex = (this.currentKeyIndex + 1) % this.ais.length;
        return this.currentKeyIndex !== 0; 
    }

    private delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

    private extractStatusCode(error: unknown): number | undefined {
        if (!error || typeof error !== 'object') return undefined;
        const err = error as Record<string, unknown>;
        const status = err["status"];
        if (typeof status === 'number') return status;
        
        const internalErr = err["error"] as Record<string, unknown> | undefined;
        const code = internalErr?.["code"];
        if (typeof code === 'number') return code;
        
        return undefined;
    }

    private isRetryableError(error: unknown): boolean {
        const s = this.extractStatusCode(error);
        return s === 503 || s === 429;
    }

    /**
     * Set the system prompt and reference content (file or text) for current session.
     */
    setContext(systemPrompt: string, content: ContentPart | ContentPart[]): void {
        this.lastSystemPrompt = systemPrompt;
        const rawParts = Array.isArray(content) ? content : [content];
        this.lastContentParts = rawParts.map(p => typeof p === 'string' ? { text: p } : p);
    }

    /**
     * Main generation method: Uses Direct Injection with File API support.
     * Caching is intentionally avoided to prevent 429/403 errors on Free Tier.
     */
    async generateWithContext(prompt: string, onLog?: (m: string) => void): Promise<string> {
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const contextContents = createUserContent(this.lastContentParts);
                
                const request: Record<string, unknown> = { 
                    model: this.modelName,
                    contents: [
                        contextContents,
                        { role: "user", parts: [{ text: prompt }] }
                    ],
                    config: { systemInstruction: this.lastSystemPrompt }
                };

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const res = await this.ai.models.generateContent(request as any);
                return res.text ?? "";
            } catch (e: unknown) {
                if (this.isRetryableError(e) && this.rotateKey()) {
                    if (onLog) onLog(`🔄 Đang xoay vòng sang API Key dự phòng...`);
                    attempt = 1; await this.delay(1000); continue;
                }
                if (attempt === this.maxRetries) throw e;
                await this.delay(Math.min(1000 * Math.pow(2, attempt), 10000));
            }
        }
        return "";
    }

    async generateContent(prompt: string): Promise<string> {
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const res = await this.ai.models.generateContent({
                    model: this.modelName,
                    contents: [{ role: "user", parts: [{ text: prompt }] }]
                });
                return res.text ?? "";
            } catch (e: unknown) {
                if (this.isRetryableError(e) && this.rotateKey()) {
                    attempt = 1; await this.delay(1000); continue;
                }
                if (attempt === this.maxRetries) throw e;
                await this.delay(Math.min(1000 * Math.pow(2, attempt), 10000));
            }
        }
        return "";
    }

    /**
     * Standard Google File API upload. Files remain active for 48h.
     */
    async uploadFile(file: File, log?: (m: string) => void): Promise<{ fileData: { fileUri: string; mimeType: string } }> {
        if (log) log(`☁️ Đang upload file ${file.name} lên Google File API...`);
        const upload = await this.ai.files.upload({
            file, config: { displayName: file.name, mimeType: file.type }
        });
        
        let info = await this.ai.files.get({ name: upload.name! });
        while (info.state !== 'ACTIVE' && info.state !== 'FAILED') {
            await this.delay(2000);
            info = await this.ai.files.get({ name: upload.name! });
        }
        
        if (info.state === 'ACTIVE') {
            this.isKeyPinned = true;
            return { fileData: { fileUri: upload.uri!, mimeType: upload.mimeType! } };
        }
        throw new Error("File processing failed on Google side.");
    }
}
