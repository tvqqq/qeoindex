import type { ReactNode } from "react"

import styles from "./ai-council.module.css"

export default function AiCouncilLayout({ children }: { children: ReactNode }) {
  return <div className={styles.readable}>{children}</div>
}
