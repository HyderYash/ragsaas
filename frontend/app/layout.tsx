import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v13-appRouter";
import AppNavbar from "./components/navbar";
import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";


const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RAG SaaS",
  description: "OpenAI-powered document intelligence workspace",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AppRouterCacheProvider>
          <ClerkProvider
            appearance={{
              variables: {
                fontFamily: "inherit",
                fontSize: "0.875rem",
              },
            }}
          >
            <AppNavbar />
            {children}
          </ClerkProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
