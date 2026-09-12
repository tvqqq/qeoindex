import { readFileSync, writeFileSync } from "node:fs"

const path = "components/live-market-board.tsx"
let source = readFileSync(path, "utf8")
const duplicatedClosure = `      }
    }

      }
    }

    const scheduleMessage = (raw: string) => {`
const correctClosure = `      }
    }

    const scheduleMessage = (raw: string) => {`

if (source.includes(duplicatedClosure)) {
  if (source.indexOf(duplicatedClosure) !== source.lastIndexOf(duplicatedClosure)) {
    throw new Error("Generated closure repair anchor is ambiguous")
  }
  source = source.replace(duplicatedClosure, correctClosure)
  writeFileSync(path, source)
  console.log("Repaired duplicated generated Market Board closure")
} else if (!source.includes(correctClosure)) {
  throw new Error("Expected Market Board queue closure anchor is missing")
} else {
  console.log("Generated Market Board closure is already correct")
}
