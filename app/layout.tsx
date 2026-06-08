import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pinecrest Mission Control",
  description: "Task and follow-up dashboard for Pinecrest / Innovative BPS",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
