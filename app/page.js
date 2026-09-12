"use client";

import dynamic from "next/dynamic";

const EscapeRoom = dynamic(() => import("../components/EscapeRoom"), {
  ssr: false,
});

export default function Home() {
  return <EscapeRoom />;
}
