import { GoogleGenAI, createUserContent } from "@google/genai";

export type ContentPart = { inlineData: { data: string; mimeType: string } } | { text: string } | string;

export class GeminiService {
    private ais: GoogleGenAI[];
    private currentKeyIndex = 0;
    private modelName = "gemini-3.1-flash-lite-preview"; // GA, stable, cost-effective, supports caching
    private fallbackModelName = "gemini-2.5-flash"; // GA fallback
    private cacheName: string | null = null;
    private maxRetries = 6;

    // Store params for auto-refresh
    private lastSystemPrompt: string = "";
    private lastContent: ContentPart | ContentPart[] | null = null;

    private keyUsageCount = 0; // Đếm số lần xoay vòng liên tiếp để tránh lặp vô hạn

    private get ai(): GoogleGenAI {
        return this.ais[this.currentKeyIndex];
    }

    private rotateKey(): boolean {
        if (this.ais.length <= 1) return false;
        
        this.currentKeyIndex = (this.currentKeyIndex + 1) % this.ais.length;
        this.keyUsageCount++;
        
        console.warn(`[API Key Rotation] Đã xoay vòng sang API Key #${this.currentKeyIndex + 1}`);
        
        // Nếu đã thử xoay vòng qua tất cả các khóa mà vẫn lỗi -> ngưng xoay vòng để tránh lặp vô hạn
        if (this.keyUsageCount >= this.ais.length * 2) {
             return false;
        }
        
        return true;
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
     * @param forceSkipCache - If true, bypasses actual cache creation and only saves context for fallback
     * @returns The cache name for later reference, or empty string if fallback mode
     */
    async createCache(
        systemInstruction: string,
        content: ContentPart | ContentPart[],
        forceSkipCache: boolean = false
    ): Promise<string> {
        const contentInput = Array.isArray(content) ? content : [content];

        const contentParts = contentInput.map(c =>
            typeof c === "string" ? { text: c } : c
        );

        // Save for auto-recovery and non-cached fallback
        this.lastSystemPrompt = systemInstruction;
        this.lastContent = contentParts;

        if (forceSkipCache) {
            console.log("forceSkipCache is true, skipping Caches API.");
            this.cacheName = null;
            return "";
        }

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
                const errMsg = err.message?.toLowerCase() || "";
                
                // Cache too small or model not supported for caching - fallback to non-cached mode
                if (err.status === 400 || errMsg.includes("too small") || errMsg.includes("minimum") || errMsg.includes("supported")) {
                    console.warn(`Content cannot be cached. Error: ${err.message}. Using non-cached mode.`);
                    this.cacheName = null;
                    return ""; // Empty string indicates non-cached mode
                }
                
                if (this.isRetryableError(error)) {
                    if (err.status === 429 || (err.message && err.message.toLowerCase().includes("quota"))) {
                        if (this.rotateKey()) {
                            attempt = 0; // Reset retry counter for new key
                            // Delay 1s when rotating to avoid hitting rate limit on the new key immediately
                            await this.delay(1000);
                            continue;
                        } else {
                            // Không còn key dự phòng -> Coi đây là lỗi Rate Limit (RPM) và chờ Delay Exponential Backoff
                            const backoffMs = Math.min(2000 * Math.pow(2, attempt - 1), 20000);
                            console.warn(`[Rate Limit / Quota] Chờ ${backoffMs}ms để tiếp tục thử lại...`);
                            await this.delay(backoffMs);
                            continue;
                        }
                    } else {
                        const backoffMs = Math.min(2000 * Math.pow(2, attempt - 1), 20000);
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
        // Fallback to non-cached mode if cache not available (e.g., content too small or skipped)
        if (!this.cacheName) {
            console.warn("No cache available. Falling back to non-cached generation with attached content.");
            let lastError: unknown = null;
            let currentModel = this.modelName;

            for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
                try {
                    const fallbackRequest = {
                        model: currentModel,
                        contents: [
                            ...(this.lastContent ? (Array.isArray(this.lastContent) ? this.lastContent : [this.lastContent]) : []),
                            { text: prompt }
                        ],
                        config: {
                            systemInstruction: this.lastSystemPrompt || undefined,
                        }
                    };
                    const response = await this.ai.models.generateContent(fallbackRequest);
                    return response.text ?? "";
                } catch (error: unknown) {
                    lastError = error;
                    if (this.isRetryableError(error)) {
                        const err = error as { status?: number; message?: string };
                        if (err.status === 429 || (err.message && err.message.toLowerCase().includes("quota"))) {
                            if (this.rotateKey()) {
                                attempt = 0;
                                await this.delay(1000);
                                continue;
                            } else {
                                const backoffMs = Math.min(2000 * Math.pow(2, attempt - 1), 20000);
                                await this.delay(backoffMs);
                                continue;
                            }
                        } else {
                            const backoffMs = Math.min(2000 * Math.pow(2, attempt - 1), 20000);
                            await this.delay(backoffMs);
                            
                            // Try fallback model on last retry
                            if (attempt === this.maxRetries - 1) {
                                currentModel = this.fallbackModelName;
                            }
                        }
                    } else {
                        throw error;
                    }
                }
            }
            throw lastError;
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
                        if (this.rotateKey()) {
                            // MUST rebuild cache under the new key!
                            console.warn("Rebuilding cache under the new API key...");
                            if (this.lastSystemPrompt && this.lastContent) {
                                await this.createCache(this.lastSystemPrompt, this.lastContent);
                                attempt = 0; // Reset loop counter so the new key gets full retries
                                continue;
                            }
                        } else {
                            // Không còn key dự phòng -> Trì hoãn và thử lại (có thể do Rate Limit theo Phút)
                            const backoffMs = Math.min(2000 * Math.pow(2, attempt - 1), 20000);
                            console.warn(`[Rate Limit] Chờ ${backoffMs}ms... (Attempt ${attempt}/${this.maxRetries})`);
                            await this.delay(backoffMs);
                            continue;
                        }
                    } else {
                        const backoffMs = Math.min(2000 * Math.pow(2, attempt - 1), 20000);
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
                            await this.delay(1000);
                            continue; // Retry with new key immediately
                        } else {
                            const backoffMs = Math.min(2000 * Math.pow(2, attempt - 1), 20000);
                            console.warn(`[Rate Limit] Chờ ${backoffMs}ms để thử lại... (Attempt ${attempt}/${this.maxRetries})`);
                            await this.delay(backoffMs);
                            continue;
                        }
                    } else {
                        const backoffMs = Math.min(2000 * Math.pow(2, attempt - 1), 20000);
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
