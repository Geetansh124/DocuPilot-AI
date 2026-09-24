import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "DocuPilot AI", description: "Your intelligent document workspace" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
