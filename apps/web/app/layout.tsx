import type { ReactNode } from "react";
import "./styles.css";

export const metadata = {
  title: "SyncOS | Sync Comm Systems",
  description: "Sync Comm Systems telecom operations platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
