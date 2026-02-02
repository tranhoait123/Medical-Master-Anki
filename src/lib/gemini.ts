import { GoogleGenAI, createUserContent } from "@google/genai";

export class GeminiService {
    private ai: GoogleGenAI;
    private modelName = "gemini-3-flash-preview";
    private cacheName: string | null = null;

    // Store params for auto-refresh
    private lastSystemPrompt: string = "";
    private lastContent: { inlineData: { data: string; mimeType: string } } | string | null = null;

    constructor(apiKey: string) {
        this.ai = new GoogleGenAI({ apiKey });
    }

    /**
     * Create a cache with the given content (file or text).
     * The cache can then be used for subsequent generateContent calls.
     * @param systemInstruction - The system prompt to cache
     * @param content - The content to cache (inline data or text)
     * @returns The cache name for later reference
     */
    async createCache(
        systemInstruction: string,
        content: { inlineData: { data: string; mimeType: string } } | string
    ): Promise<string> {
        const contentParts = typeof content === "string"
            ? [{ text: content }]
            : [content];

        // Save for auto-recovery
        this.lastSystemPrompt = systemInstruction;
        this.lastContent = content;

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
    }

    /**
     * Generate content using the cached context.
     * This is much more token-efficient for repeated calls.
     * @param prompt - The specific prompt/command for this generation
     * @returns The generated text
     */
    async generateWithCache(prompt: string): Promise<string> {
        if (!this.cacheName) {
            throw new Error("No cache available. Call createCache first.");
        }

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
            // Check for cache expiration (404 typically indicates cache not found)
            const err = error as { status?: number; message?: string };
            if (err.status === 404 || (err.message && err.message.includes("not found"))) {
                console.warn("Cache expired or not found. Attempting to refresh...", error);

                if (this.lastSystemPrompt && this.lastContent) {
                    // Re-create cache
                    await this.createCache(this.lastSystemPrompt, this.lastContent);

                    // Retry request with new cache
                    const response = await this.ai.models.generateContent({
                        model: this.modelName,
                        contents: prompt,
                        config: {
                            cachedContent: this.cacheName!,
                        },
                    });
                    return response.text ?? "";
                }
            }
            throw error; // Re-throw if not a cache error or can't recover
        }
    }

    /**
     * Generate content without caching (for one-off requests or small inputs).
     * Falls back to standard generation.
     * @param prompt - The prompt string
     * @returns The generated text
     */
    async generateContent(prompt: string): Promise<string> {
        const response = await this.ai.models.generateContent({
            model: this.modelName,
            contents: prompt,
        });

        return response.text ?? "";
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
