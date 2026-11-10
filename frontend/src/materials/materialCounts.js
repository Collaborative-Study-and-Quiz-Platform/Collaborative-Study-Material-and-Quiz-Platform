// Keep completed downloads visible even when a later response is older.
export function withDownloadCount(material, knownCount = 0) {
  return { ...material, downloadCount: Math.max(material.downloadCount ?? 0, knownCount ?? 0) }
}

export function updateDownloadCount(materials, id, count) {
  return materials.map((material) => material._id === id
    ? withDownloadCount(material, count ?? (material.downloadCount ?? 0) + 1)
    : material)
}
