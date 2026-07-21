export const LOCAL_PREFERENCES_CHANGED_EVENT = 'rebook:local-preferences-changed'
export const READER_CONFIG_CHANGED_EVENT = 'rebook:reader-config-changed'

export function notifyLocalPreferencesChanged() {
  window.dispatchEvent(new Event(LOCAL_PREFERENCES_CHANGED_EVENT))
}

export function notifyReaderConfigChanged() {
  window.dispatchEvent(new Event(READER_CONFIG_CHANGED_EVENT))
  notifyLocalPreferencesChanged()
}
