import MaterialActions from './MaterialActions'
import { updateDownloadCount, withDownloadCount } from './materialCounts'
import { useCallback, useEffect, useState } from 'react'

function groupMaterials(materials) {
  const courses = new Map()

  materials.forEach((material) => {
    const courseName = material.tags?.course || 'Course unavailable'
    const subjectName = material.tags?.subject || 'Subject unavailable'
    const topicName = material.tags?.topic || 'Topic unavailable'

    if (!courses.has(courseName)) courses.set(courseName, new Map())
    const subjects = courses.get(courseName)
    if (!subjects.has(subjectName)) subjects.set(subjectName, new Map())
    const topics = subjects.get(subjectName)
    if (!topics.has(topicName)) topics.set(topicName, [])
    topics.get(topicName).push(material)
  })

  return [...courses.entries()].map(([name, subjects]) => ({
    name,
    materialCount: [...subjects.values()].reduce(
      (total, topics) => total + [...topics.values()].reduce((count, items) => count + items.length, 0),
      0,
    ),
    subjects: [...subjects.entries()].map(([subjectName, topics]) => ({
      name: subjectName,
      materialCount: [...topics.values()].reduce((count, items) => count + items.length, 0),
      topics: [...topics.entries()].map(([topicName, items]) => ({
        name: topicName,
        materials: items,
      })),
    })),
  }))
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function MaterialRow({ material, token, apiBaseUrl, canAccessFiles, canDownload, onDownloaded, bookmarks }) {
  const fileSize = formatFileSize(material.fileSize)
  const uploadedDate = material.createdAt
    ? new Date(material.createdAt).toLocaleDateString()
    : ''

  return (
    <article className="material-row">
      <span className="file-badge">{material.fileType?.toUpperCase() || 'FILE'}</span>
      <div className="material-row-content">
        <h4>{material.originalFilename || 'Filename unavailable'}</h4>
        <p>
          {[
            material.mimeType,
            `${material.downloadCount ?? 0} downloads`,
            fileSize && `Size ${fileSize}`,
            uploadedDate && `Uploaded ${uploadedDate}`,
          ].filter(Boolean).join(' · ') || 'Additional file details unavailable'}
        </p>
      </div>
      {canAccessFiles && <MaterialActions material={material} token={token} apiBaseUrl={apiBaseUrl} canDownload={canDownload} onDownloaded={onDownloaded} bookmarks={bookmarks} />}
    </article>
  )
}

export default function MaterialLibrary({ token, apiBaseUrl, parseResponse, role, bookmarks, bookmarksOnly = false }) {
  const [browseMaterials, setMaterials] = useState([])
  const [browseCount, setResultCount] = useState(0)
  const [filterOptions, setFilterOptions] = useState({
    courses: [], subjects: [], topics: [],
  })
  const [filters, setFilters] = useState({
    keyword: '', course: '', subject: '', topic: '',
  })
  const [browseLoading, setIsLoading] = useState(true)
  const [browseError, setError] = useState('')

  const bookmarkCounts = new Map(bookmarks?.materials.map((material) => [material._id, material.downloadCount]))
  const materials = bookmarksOnly ? bookmarks.materials : browseMaterials.map((material) =>
    withDownloadCount(material, bookmarkCounts.get(material._id)))
  const resultCount = bookmarksOnly ? materials.length : browseCount
  const isLoading = bookmarksOnly ? bookmarks.loading && !bookmarks.hasLoaded : browseLoading
  const error = bookmarksOnly ? (!bookmarks.hasLoaded ? bookmarks.error : '') : browseError

  const loadMaterials = useCallback(async (nextFilters, includeOptions = false) => {
    setIsLoading(true)
    setError('')
    const params = new URLSearchParams()
    Object.entries(nextFilters).forEach(([key, value]) => {
      if (value.trim()) params.set(key, value.trim())
    })

    try {
      const data = await parseResponse(await fetch(
        `${apiBaseUrl}/api/materials?${params}`,
        { headers: { Authorization: `Bearer ${token}` } },
      ))
      const nextMaterials = Array.isArray(data.materials) ? data.materials : []
      setMaterials(nextMaterials)
      setResultCount(Number.isFinite(data.count) ? data.count : nextMaterials.length)
      if (includeOptions) {
        setFilterOptions({
          courses: [...new Set(nextMaterials.map((m) => m.tags?.course).filter(Boolean))].sort(),
          subjects: [...new Set(nextMaterials.map((m) => m.tags?.subject).filter(Boolean))].sort(),
          topics: [...new Set(nextMaterials.map((m) => m.tags?.topic).filter(Boolean))].sort(),
        })
      }
    } catch (requestError) {
      setError(requestError.message || 'Unable to load study materials.')
    } finally {
      setIsLoading(false)
    }
  }, [token, apiBaseUrl, parseResponse])

  useEffect(() => {
    if (bookmarksOnly) return
    const timer = window.setTimeout(
      () => loadMaterials({ keyword: '', course: '', subject: '', topic: '' }, true),
      0,
    )
    return () => window.clearTimeout(timer)
  }, [loadMaterials, bookmarksOnly])

  function updateFilter(event) {
    const { name, value } = event.target
    setFilters((current) => ({ ...current, [name]: value }))
  }

  function submitFilters(event) {
    event.preventDefault()
    loadMaterials(filters)
  }

  function clearFilters() {
    const emptyFilters = { keyword: '', course: '', subject: '', topic: '' }
    setFilters(emptyFilters)
    loadMaterials(emptyFilters)
  }

  async function refreshDownloadCount(id) {
    const completedCount = (materials.find((material) => material._id === id)?.downloadCount ?? 0) + 1
    bookmarks?.downloaded(id, completedCount)
    // Update only this row; preserve filters and the mounted disclosure tree.
    setMaterials((current) => updateDownloadCount(current, id, completedCount))
    try {
      // The server records completion after flushing the file response.
      await new Promise((resolve) => window.setTimeout(resolve, 150))
      const data = await parseResponse(await fetch(`${apiBaseUrl}/api/materials`, {
        headers: { Authorization: `Bearer ${token}` },
      }))
      const updated = data.materials?.find((material) => material._id === id)
      if (updated) {
        setMaterials((current) => updateDownloadCount(current, id, updated.downloadCount ?? 0))
        bookmarks?.downloaded(id, updated.downloadCount ?? 0)
      }
    } catch {
      // Keep the completed download's local count if refreshing is unavailable.
    }
  }

  const courseGroups = groupMaterials(materials)

  return (
    <section className="library" aria-labelledby="library-title">
      <div className="library-heading">
        <div>
          <p className="eyebrow">Study resources</p>
          <h1 id="library-title" tabIndex={-1}>{bookmarksOnly ? 'My Bookmarks' : role === 'instructor' ? 'My Uploads' : 'Browse materials'}</h1>
          <p>{bookmarksOnly ? 'Your saved study materials.' : role === 'instructor' ? 'Find and preview your uploaded study materials.' : 'Search materials shared by instructors.'}</p>
        </div>
      </div>

      {!bookmarksOnly && <form className="library-filters filter-panel" onSubmit={submitFilters}>
        <div className="field library-search">
          <label htmlFor="material-keyword">Keyword</label>
          <input
            id="material-keyword"
            name="keyword"
            type="search"
            value={filters.keyword}
            onChange={updateFilter}
            placeholder="File name, course, subject, topic"
          />
        </div>

        {[
          ['course', 'Course', filterOptions.courses],
          ['subject', 'Subject', filterOptions.subjects],
          ['topic', 'Topic', filterOptions.topics],
        ].map(([name, label, options]) => (
          <div className="field" key={name}>
            <label htmlFor={`material-filter-${name}`}>{label}</label>
            <select
              id={`material-filter-${name}`}
              name={name}
              value={filters[name]}
              onChange={updateFilter}
            >
              <option value="">All {label.toLowerCase()}s</option>
              {options.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
        ))}

        <div className="library-actions">
          <button type="submit" disabled={isLoading}>
            {isLoading ? 'Searching...' : 'Search'}
          </button>
          <button type="button" className="secondary-button" onClick={clearFilters} disabled={isLoading}>
            Clear
          </button>
        </div>
      </form>}

      {bookmarksOnly && bookmarks.loading && bookmarks.hasLoaded && <p role="status">Refreshing bookmarks…</p>}
      {!bookmarksOnly && bookmarks?.loading && <p role="status">Loading bookmarks…</p>}
      {bookmarks?.message && <p className="feedback success" role="status">{bookmarks.message}</p>}
      {bookmarks?.error && bookmarks.error !== error && <p className="feedback error" role="alert">{bookmarks.error}</p>}
      {bookmarks && (!bookmarks.ready || bookmarks.error) && <button type="button" className="secondary-button" onClick={bookmarks.reload} disabled={bookmarks.loading}>Retry bookmarks</button>}
      {error && <p className="feedback error" role="alert">{error}</p>}
      <p className="results-count" role="status" aria-live="polite">
        {isLoading
          ? 'Loading materials...'
          : error
            ? 'Materials unavailable.'
            : `${resultCount} material${resultCount === 1 ? '' : 's'} in ${courseGroups.length} course${courseGroups.length === 1 ? '' : 's'}`}
      </p>

      {isLoading && (
        <div className="explorer-state" role="status">
          <span className="loading-indicator" aria-hidden="true" />
          <p>Loading study materials…</p>
        </div>
      )}

      {!isLoading && !error && resultCount === 0 && (
        <div className="empty-state">
          <h2>{bookmarksOnly ? 'No bookmarks yet' : 'No materials found'}</h2>
          <p>{bookmarksOnly ? 'Bookmark materials from Browse materials to find them here.' : 'Try a different keyword or clear the filters to browse the library.'}</p>
        </div>
      )}

      {!isLoading && !error && resultCount > 0 && (
        <div className="material-explorer" aria-label="Study materials by course, subject, and topic">
          {courseGroups.map((course) => (
            <details className="explorer-course" key={course.name} open>
              <summary>
                <span className="tree-label">{course.name}</span>
                <span className="tree-count">{course.materialCount} material{course.materialCount === 1 ? '' : 's'}</span>
              </summary>
              <div className="explorer-subjects">
                {course.subjects.map((subject) => (
                  <details className="explorer-subject" key={subject.name}>
                    <summary>
                      <span className="tree-label">{subject.name}</span>
                      <span className="tree-count">{subject.materialCount} material{subject.materialCount === 1 ? '' : 's'}</span>
                    </summary>
                    <div className="explorer-topics">
                      {subject.topics.map((topic) => (
                        <details className="explorer-topic" key={topic.name}>
                          <summary>
                            <span className="tree-label">{topic.name}</span>
                            <span className="tree-count">{topic.materials.length} material{topic.materials.length === 1 ? '' : 's'}</span>
                          </summary>
                          <div className="topic-materials">
                            {topic.materials.map((material) => (
                              <MaterialRow key={material._id || `${topic.name}-${material.originalFilename}`} material={material}
                                token={token} apiBaseUrl={apiBaseUrl} canAccessFiles={role === 'student' || role === 'instructor'} canDownload={role === 'student'} onDownloaded={refreshDownloadCount} bookmarks={bookmarks} />
                            ))}
                          </div>
                        </details>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  )
}

