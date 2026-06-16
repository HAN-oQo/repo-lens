import type { Metadata } from "next";
import "./globals.css";
import "highlight.js/styles/github-dark.css";

export const metadata: Metadata = {
  title: "Repo Lens — read, search & map any GitHub repo",
  description:
    "Paste a GitHub link to browse the file tree, read code & README, see the import dependency graph, and ask an AI about the repo.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
