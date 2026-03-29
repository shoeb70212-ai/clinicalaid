/**
 * Voice dictation using the Web Speech API (SpeechRecognition).
 * Works in Chrome, Edge, and Safari 15+. Falls back gracefully on unsupported browsers.
 *
 * Returns a controller object to start/stop recording from React components.
 */

export interface VoiceController {
  start:     () => void
  stop:      () => void
  supported: boolean
}

type Callback = (transcript: string) => void

/**
 * Creates a voice controller for a single input field.
 * @param onResult   — called with the interim/final transcript text
 * @param onError    — called if the browser rejects speech
 * @param language   — BCP-47 language tag, e.g. 'en-IN', 'hi-IN', 'mr-IN', 'ta-IN'
 */
// Minimal interface for the parts of SpeechRecognition we actually use.
// The global SpeechRecognition type is not available in all TS DOM lib versions.
interface SR {
  lang:            string
  continuous:      boolean
  interimResults:  boolean
  onresult:        ((event: SpeechRecognitionEvent) => void) | null
  onerror:         ((event: SpeechRecognitionErrorEvent) => void) | null
  start():         void
  stop():          void
}
type SRCtor = new () => SR

export function createVoiceController(
  onResult: Callback,
  onError:  (msg: string) => void,
  language = 'en-IN',
): VoiceController {
  const win = window as unknown as Record<string, unknown>
  const SR = (win.SpeechRecognition ?? win.webkitSpeechRecognition) as SRCtor | undefined

  if (!SR) {
    return {
      supported: false,
      start: () => onError('Speech recognition is not supported in this browser.'),
      stop:  () => {},
    }
  }

  const recognition = new SR()
  recognition.lang        = language
  recognition.continuous  = true
  recognition.interimResults = true

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    // Iterate from 0 to accumulate the full running session transcript.
    // This lets callers append the session result to pre-existing text without
    // needing to track deltas themselves.
    let transcript = ''
    for (let i = 0; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript
    }
    onResult(transcript)
  }

  recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
    if (event.error !== 'aborted') onError(`Voice error: ${event.error}`)
  }

  return {
    supported: true,
    start: () => { try { recognition.start() } catch { /* already started */ } },
    stop:  () => { try { recognition.stop()  } catch { /* already stopped */ } },
  }
}

/** Legacy V1 stub — kept for backwards compatibility */
export function onVoiceInput(_callback: Callback): void {
  console.warn('Use createVoiceController() instead')
}
