// Request-start versions keep late list responses behind confirmed writes.
export function createRatingState() {
  let version = 0
  const summaries = new Map()
  return {
    begin: () => ++version,
    confirm(id, summary) { summaries.set(id, { version: ++version, summary }) },
    merge(materials, started) {
      return materials.map((material) => {
        const known = summaries.get(material._id)
        if (!known || known.version <= started) {
          summaries.set(material._id, { version: started, summary: material.ratingSummary })
          return material
        }
        return { ...material, ratingSummary: known.summary }
      })
    },
    snapshot: () => Object.fromEntries([...summaries].map(([id, entry]) => [id, entry.summary])),
  }
}
