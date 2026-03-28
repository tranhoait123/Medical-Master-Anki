import { GoogleGenAI, createUserContent } from "@google/genai";

export type ContentPart = { inlineData: { data: string; mimeType: string } } | string;

export class GeminiService {
    private ais: GoogleGenAI[];
    private currentKeyIndex = 0;
    private modelName = "gemini-3.1-flash-lite-preview"; // GA, stable, cost-effective, supports caching
    private fallbackModelName = "gemini-2.5-flash"; // GA fallback
    private cacheName: string | null = null;
    private maxRetries = 3;

    // Store params for auto-refresh
    private lastSystemPrompt: string = "";
    private lastContent: ContentPart | ContentPart[] | null = null;

    private get ai(): GoogleGenAI {
        return this.ais[this.currentKeyIndex];
    }

    private rotateKey(): boolean {
        if (this.currentKeyIndex + 1 < this.ais.length) {
            this.currentKeyIndex++;
            console.warn(`[API Key Rotation] Đã đổi sang phân mảnh API Key thứ ${this.currentKeyIndex + 1} do lỗi bị kiệt quệ Quota.`);
            return true;
        }
        return false;
    }

    constructor(apiKeys: string[], modelName?: string) {
        if (!apiKeys || apiKeys.length === 0) {
            throw new Error("Vui lòng cung cấp ít nhất 1 API Key");
        }
        this.ais = apiKeys.map(key => new GoogleGenAI({ apiKey: key }));
        if (modelName) {
            this.modelName = modelName;
        }
    }

    /**
     * Helper to delay execution (for retry backoff)
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Check if error is retryable (503, 429, etc.)
     */
    private isRetryableError(error: unknown): boolean {
        const err = error as { status?: number; message?: string };
        return err.status === 503 || err.status === 429 ||
            (err.message?.includes("overloaded") ?? false) ||
            (err.message?.includes("rate limit") ?? false);
    }

    /**
     * Create a cache with the given content (file or text).
     * The cache can then be used for subsequent generateContent calls.
     * If content is too small for caching (< 4096 tokens), falls back to non-cached mode.
     * @param systemInstruction - The system prompt to cache
     * @param content - The content to cache (inline data or text, or array of them)
     * @returns The cache name for later reference, or empty string if fallback mode
     */
    async createCache(
        systemInstruction: string,
        content: ContentPart | ContentPart[]
    ): Promise<string> {
        const contentInput = Array.isArray(content) ? content : [content];

        const contentParts = contentInput.map(c =>
            typeof c === "string" ? { text: c } : c
        );

        // Save for auto-recovery and non-cached fallback
        this.lastSystemPrompt = systemInstruction;
        this.lastContent = content;

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const cache = await this.ai.caches.create({
                    model: this.modelName,
                    config: {
                        contents: createUserContent(contentParts),
                        systemInstruction: systemInstruction,
                        ttl: "3600s", // 1 hour
                    },
                });

                this.cacheName = cache.name!;
                return this.cacheName;
            } catch (error: unknown) {
                const err = error as { status?: number; message?: string };
                // Cache too small error - fallback to non-cached mode
                if (err.status === 400 && err.message?.toLowerCase().includes("too small")) {
                    console.warn("Content too small for caching (< 4096 tokens). Using non-cached mode.");
                    this.cacheName = null;
                    return ""; // Empty string indicates non-cached mode
                }
                
                if (this.isRetryableError(error)) {
                    if (err.status === 429 || (err.message && err.message.toLowerCase().includes("quota"))) {
                        console.warn(`[Quota Exhausted in Cache Creation] Key index ${this.currentKeyIndex} is dead.`);
                        if (this.rotateKey()) {
                            attempt = 0; // Reset retry counter for new key
                            continue;
                        } else {
                            throw new Error("Tất cả API Key dự phòng đều đã kiệt quệ (Lỗi 429/Quota). Bạn cần bổ sung thêm Key mới.");
                        }
                    } else {
                        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
                        console.warn(`Attempt ${attempt}/${this.maxRetries} failed (${err.status || 'unknown'}). Retrying in ${backoffMs}ms...`);
                        await this.delay(backoffMs);
                        continue;
                    }
                }
                
                throw error;
            }
        }
        throw new Error("Lỗi kết nối API sau nhiều lần thử lại khi tạo Caching.");
    }

    /**
     * Generate content using the cached context.
     * This is much more token-efficient for repeated calls.
     * Includes retry logic for transient errors (503, 429).
     * Falls back to non-cached generation if cache is not available.
     * @param prompt - The specific prompt/command for this generation
     * @returns The generated text
     */
    async generateWithCache(prompt: string): Promise<string> {
        // Fallback to non-cached mode if cache not available (e.g., content too small)
        if (!this.cacheName) {
            console.warn("No cache available. Falling back to non-cached generation.");
            // Combine system prompt with user prompt for non-cached mode
            const fullPrompt = this.lastSystemPrompt
                ? `${this.lastSystemPrompt}\n\n${prompt}`
                : prompt;
            return this.generateContent(fullPrompt);
        }

        let lastError: unknown = null;

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const response = await this.ai.models.generateContent({
                    model: this.modelName,
                    contents: prompt,
                    config: {
                        cachedContent: this.cacheName,
                    },
                });
                return response.text ?? "";
            } catch (error: unknown) {
                lastError = error;
                const err = error as { status?: number; message?: string };

                // Check for cache expiration (404)
                if (err.status === 404 || (err.message && err.message.includes("not found"))) {
                    console.warn("Cache expired or not found. Attempting to refresh...");

                    if (this.lastSystemPrompt && this.lastContent) {
                        await this.createCache(this.lastSystemPrompt, this.lastContent);
                        continue; // Retry with new cache
                    }
                }

                // Check for retryable errors (503, 429)
                if (this.isRetryableError(error)) {
                    if (err.status === 429 || (err.message && err.message.toLowerCase().includes("quota"))) {
                        console.warn(`[Quota Exhausted] Key index ${this.currentKeyIndex} is dead.`);
                        if (this.rotateKey()) {
                            // MUST rebuild cache under the new key!
                            console.warn("Rebuilding cache under the new API key...");
                            if (this.lastSystemPrompt && this.lastContent) {
                                await this.createCache(this.lastSystemPrompt, this.lastContent);
                                attempt = 0; // Reset loop counter so the new key gets full 3 retries
                                continue;
                            }
                        } else {
                            throw new Error("Tất cả API Key dự phòng đều đã kiệt quệ (Lỗi 429/Quota). Bạn cần bổ sung thêm Key mới.");
                        }
                    } else {
                        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
                        console.warn(`Attempt ${attempt}/${this.maxRetries} failed (${err.status || 'unknown'}). Retrying in ${backoffMs}ms...`);
                        await this.delay(backoffMs);
                        continue;
                    }
                }

                throw error; // Non-retryable error
            }
        }

        throw lastError;
    }

    /**
     * Generate content without caching (for one-off requests or small inputs).
     * Includes retry logic for transient errors (503, 429).
     * @param prompt - The prompt string
     * @returns The generated text
     */
    async generateContent(prompt: string): Promise<string> {
        let lastError: unknown = null;
        let currentModel = this.modelName;

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const response = await this.ai.models.generateContent({
                    model: currentModel,
                    contents: prompt,
                });
                return response.text ?? "";
            } catch (error: unknown) {
                lastError = error;

                if (this.isRetryableError(error)) {
                    const err = error as { status?: number; message?: string };
                    if (err.status === 429 || (err.message && err.message.toLowerCase().includes("quota"))) {
                        if (this.rotateKey()) {
                            attempt = 0; // Reset attempt for new key
                            continue; // Retry with new key immediately
                        } else {
                            throw new Error("Tất cả API Key dự phòng đều đã kiệt quệ (Lỗi 429). Bạn cần bổ sung thêm Key mới.");
                        }
                    } else {
                        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
                        console.warn(`Attempt ${attempt}/${this.maxRetries} failed (retryable). Retrying in ${backoffMs}ms...`);
                        await this.delay(backoffMs);

                        // Try fallback model on last retry
                        if (attempt === this.maxRetries - 1) {
                            console.warn(`Switching to fallback model: ${this.fallbackModelName}`);
                            currentModel = this.fallbackModelName;
                        }
                    }
                } else {
                    throw error; // Non-retryable error, throw immediately
                }
            }
        }

        throw lastError;
    }

    /**
     * Delete the current cache to free resources.
     */
    async deleteCache(): Promise<void> {
        if (this.cacheName) {
            try {
                await this.ai.caches.delete({ name: this.cacheName });
            } catch (e) {
                console.warn("Failed to delete cache:", e);
            }
            this.cacheName = null;
        }
    }

    /**
     * Check if a cache is currently active.
     */
    hasCache(): boolean {
        return this.cacheName !== null;
    }
}
