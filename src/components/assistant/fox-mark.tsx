import Image from "next/image";

/** Senko's generated pixel-anime fox spirit. Decorative unless a title is given. */
export function FoxMark({ size = 25, title, className = "" }: { size?: number; title?: string; className?: string }) {
  return (
    <Image
      src="/senko-fox.png"
      width={size}
      height={size}
      sizes={`${size}px`}
      className={`object-contain ${className}`}
      style={{ imageRendering: "pixelated" }}
      alt={title ?? ""}
      aria-hidden={title ? undefined : true}
    />
  );
}
