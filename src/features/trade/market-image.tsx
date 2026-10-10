"use client";
import Image from "next/image";
import { useState } from "react";
import styles from "./terminal.module.css";

export function MarketImage({ src }: { src?: string | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={styles.marketThumbnail}>
      {src && !failed ? (
        <Image
          src={src}
          alt=""
          width={56}
          height={56}
          unoptimized
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden="true">↗</span>
      )}
    </span>
  );
}
