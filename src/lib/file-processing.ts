/**
 * Converts a File object to a Google Generative AI Part object.
 */
export async function fileToGenerativePart(file: File): Promise<{ inlineData: { data: string; mimeType: string } }> {
    // Fallback MIME type for files with empty type (e.g., .txt on some browsers)
    const mimeType = file.type || getMimeFromExtension(file.name);

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64Data = (reader.result as string).split(',')[1];
            resolve({
                inlineData: {
                    data: base64Data,
                    mimeType,
                },
            });
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function getMimeFromExtension(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const mimeMap: Record<string, string> = {
        txt: 'text/plain',
        md: 'text/markdown',
        pdf: 'application/pdf',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        heic: 'image/heic',
    };
    return mimeMap[ext || ''] || 'application/octet-stream';
}

