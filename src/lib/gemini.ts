import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";
import type { Part } from "@google/generative-ai";

export class GeminiService {
    private genAI: GoogleGenerativeAI;
    private model: GenerativeModel;

    constructor(apiKey: string) {
        this.genAI = new GoogleGenerativeAI(apiKey);
        // Using Gemini 3.0 Flash Preview as requested for top-tier performance
        this.model = this.genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
    }

    async generateContent(prompt: string | (string | Part)[]): Promise<string> {
        const result = await this.model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    }

    async generateContentStream(prompt: string | (string | Part)[], onChunk: (text: string) => void): Promise<string> {
        const result = await this.model.generateContentStream(prompt);
        let fullText = "";
        for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            fullText += chunkText;
            onChunk(fullText);
        }
        return fullText;
    }
}
