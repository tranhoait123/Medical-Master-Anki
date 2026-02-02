import { Sun, Moon } from "lucide-react";

interface HeaderProps {
    isDarkMode: boolean;
    toggleTheme: () => void;
}

export function Header({ isDarkMode, toggleTheme }: HeaderProps) {
    return (
        <header className="flex flex-col items-center text-center space-y-4 pt-8 relative">
            <button
                onClick={toggleTheme}
                className="absolute top-2 right-0 p-2 rounded-full bg-card border border-border hover:bg-accent transition-colors"
                title={isDarkMode ? "Switch to Light Mode (Ctrl+D)" : "Switch to Dark Mode (Ctrl+D)"}
            >
                {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>

            <div className="relative group">
                <img
                    src="/src/assets/ponz-logo.jpg"
                    alt="PonZ Logo"
                    className="relative w-24 h-24 rounded-2xl shadow-md border border-border object-cover"
                />
            </div>

            <div className="space-y-1">
                <h1 className="text-4xl font-bold tracking-tight text-foreground">
                    Medical Master
                </h1>
                <p className="text-xs font-medium text-muted-foreground uppercase opacity-70">
                    Made by PonZ
                </p>
            </div>

            <p className="text-muted-foreground text-base max-w-lg">
                Upload medical documents (PDF, Text) to generate high-quality Anki flashcards using Gemini AI.
            </p>
        </header>
    );
}
