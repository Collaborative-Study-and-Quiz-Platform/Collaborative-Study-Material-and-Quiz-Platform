import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '../quiz/quizApi'
import './notifications.css'

function NotificationCenter({ token }) {
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  const loadNotifications = useCallback(async (active = true) => {
    try {
      const data = await apiRequest('/api/notifications', { token })
      if (active) {
        setNotifications(data.notifications)
        setUnreadCount(data.unreadCount)
        setError('')
      }
    } catch (loadError) {
      if (active) setError(loadError.message || 'Unable to load notifications.')
    } finally {
      if (active) setIsLoading(false)
    }
  }, [token])

  useEffect(() => {
    let active = true
    loadNotifications(active)
    const timer = window.setInterval(() => loadNotifications(active), 60000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [loadNotifications])

  async function markAsRead(notificationId) {
    try {
      await apiRequest(`/api/notifications/${notificationId}/read`, {
        token,
        method: 'PATCH',
      })
      setNotifications((current) => current.map((notification) => (
        notification._id === notificationId
          ? { ...notification, readAt: new Date().toISOString() }
          : notification
      )))
      setUnreadCount((count) => Math.max(0, count - 1))
    } catch (markError) {
      setError(markError.message || 'Unable to update this notification.')
    }
  }

  async function markAllAsRead() {
    try {
      await apiRequest('/api/notifications/read-all', { token, method: 'PATCH' })
      const readAt = new Date().toISOString()
      setNotifications((current) => current.map((notification) => ({ ...notification, readAt })))
      setUnreadCount(0)
    } catch (markError) {
      setError(markError.message || 'Unable to update notifications.')
    }
  }

  return (
    <section className="notification-center" aria-labelledby="notifications-title">
      <div className="page-heading notification-heading">
        <div>
          <p className="eyebrow">Updates</p>
          <h1 id="notifications-title">Notifications</h1>
          <p>{unreadCount ? `${unreadCount} unread` : 'You are all caught up.'}</p>
        </div>
        {unreadCount > 0 && (
          <button type="button" className="notification-mark-all" onClick={markAllAsRead}>
            Mark all as read
          </button>
        )}
      </div>
      {error && <p className="feedback error" role="alert">{error}</p>}
      {isLoading ? (
        <p className="notification-state" role="status">Loading notifications...</p>
      ) : notifications.length === 0 ? (
        <p className="notification-state">No notifications yet.</p>
      ) : (
        <ul className="notification-list">
          {notifications.map((notification) => (
            <li
              className={`notification-card${notification.readAt ? '' : ' unread'}`}
              key={notification._id}
            >
              <div>
                <h2>{notification.title}</h2>
                <p>{notification.message}</p>
                <time dateTime={notification.createdAt}>
                  {new Date(notification.createdAt).toLocaleString()}
                </time>
              </div>
              {!notification.readAt && (
                <button
                  type="button"
                  className="notification-mark-read"
                  onClick={() => markAsRead(notification._id)}
                  aria-label={`Mark ${notification.title} as read`}
                >
                  Mark read
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default NotificationCenter
