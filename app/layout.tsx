import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RescuerMap",
  description: "Wildfire evacuation zone dashboard for California",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-full flex flex-col">{children}</body>
    </html>
  );
}
