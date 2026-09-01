export type OverlapCandidate = {
  line: number
  email: string
  start_date: string
  end_date: string
  submitted_at?: string
}

const submittedAtKey = (item: OverlapCandidate) => {
  const match = item.submitted_at?.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/)
  return match ? `${match[3]}${match[2]}${match[1]}${match[4]}${match[5]}` : String(item.line).padStart(8, '0')
}

export function supersededOverlaps(items: OverlapCandidate[]) {
  const skipped = new Map<number, number>()
  const byEmail = new Map<string, OverlapCandidate[]>()
  for (const item of items) {
    const list = byEmail.get(item.email) || []
    list.push(item); byEmail.set(item.email, list)
  }
  for (const list of byEmail.values()) {
    list.sort((a, b) => submittedAtKey(b).localeCompare(submittedAtKey(a)))
    const selected: OverlapCandidate[] = []
    for (const item of list) {
      const newer = selected.find((candidate) => item.start_date <= candidate.end_date && item.end_date >= candidate.start_date)
      if (newer) skipped.set(item.line, newer.line)
      else selected.push(item)
    }
  }
  return skipped
}
