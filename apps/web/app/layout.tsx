import type { ReactNode } from "react";
import "./styles.css";

export const metadata = {
  title: "SyncOS Command Center",
  description: "SyncOS read-only command center views",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
