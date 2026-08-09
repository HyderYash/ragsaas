"use client";

import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import Button from "@mui/material/Button";
import Link from "next/link";

export default function AppNavbar() {
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-950">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-950 text-white">
            <AutoAwesomeOutlinedIcon fontSize="small" />
          </span>
          RAG SaaS
        </Link>

        <nav className="hidden items-center gap-6 text-sm font-medium text-zinc-600 md:flex">
          <Link href="/" className="hover:text-zinc-950">
            Workspace
          </Link>
          <a href="#documents" className="hover:text-zinc-950">
            Documents
          </a>
          <a href="#chat" className="hover:text-zinc-950">
            Chat
          </a>
        </nav>

        <div className="flex items-center gap-2">
          <Show when="signed-out">
            <SignInButton>
              <Button variant="text" color="inherit" size="small">
                Sign in
              </Button>
            </SignInButton>
            <SignUpButton>
              <Button variant="contained" color="inherit" size="small">
                Sign up
              </Button>
            </SignUpButton>
          </Show>
          <Show when="signed-in">
            <UserButton />
          </Show>
        </div>
      </div>
    </header>
  );
}
