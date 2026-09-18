import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata={title:"YouTube Channel Finder",description:"Find and download YouTube channel videos."};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
