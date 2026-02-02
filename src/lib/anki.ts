export class AnkiConnectService {
    private url: string;
    private deckName: string;

    constructor(url: string = "http://127.0.0.1:8765", deckName: string = "Default") {
        this.url = url;
        this.deckName = deckName;
    }

    async invoke(action: string, params: Record<string, unknown> = {}) {
        const response = await fetch(this.url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            mode: "no-cors",
            body: JSON.stringify({ action, version: 6, params }),
        });

        return response;
    }

    // Refined invoke for actual usage
    async request(action: string, params: Record<string, unknown> = {}) {
        try {
            const res = await fetch(this.url, {
                method: "POST",
                body: JSON.stringify({ action, version: 6, params }),
            });
            const json = await res.json();
            if (json.error) {
                throw new Error(json.error);
            }
            return json.result;
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(`AnkiConnect Error: ${msg}. Ensure Anki is running and AnkiConnect is installed.`);
        }
    }

    async addNote(front: string, back: string) {
        return this.request("addNote", {
            note: {
                deckName: this.deckName,
                modelName: "Basic",
                fields: {
                    Front: front,
                    Back: back,
                },
                options: {
                    allowDuplicate: false,
                    duplicateScope: "deck",
                    duplicateScopeOptions: {
                        deckName: this.deckName,
                        checkChildren: false,
                        checkAllModels: false
                    }
                },
                tags: ["notebooklm-gen"],
            },
        });
    }
}
