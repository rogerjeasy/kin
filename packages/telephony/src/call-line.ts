/**
 * One live call, as the receptionist sees it. The Twilio adapter (a media
 * stream with speech to text and back) implements this beside the app that
 * answers the phone; tests and the web simulator use `scriptedLine`. The
 * call logic never knows which.
 */
export interface CallLine {
  /** Says a sentence to the caller. */
  say(text: string): Promise<void>;
  /** Waits for the caller's next words. `null` means the caller hung up; an empty string is silence. */
  listen(): Promise<string | null>;
  /** Ends the call from Kin's side. */
  hangUp(): Promise<void>;
}
