import type { Metadata } from "next";
import MusicRoom from "./music-room";

export const metadata: Metadata = {
  title: "Anime Music Room — Senko",
  description: "A late-night listening room for official anime opening themes.",
};

export default function MusicPage() {
  return <MusicRoom />;
}
