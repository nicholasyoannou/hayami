export type BackgroundSender = chrome.runtime.MessageSender;
export type BackgroundSendResponse = (response?: any) => void;

/**
 * Shape of every `browser.runtime.onMessage` handler dispatched by
 * `background.ts`. Returning `true` keeps the message channel open so the
 * handler can call `sendResponse` asynchronously; `false` (or `undefined`)
 * signals a synchronous response or no response.
 */
export type BackgroundMessageHandler = (
  message: any,
  sender: BackgroundSender,
  sendResponse: BackgroundSendResponse,
) => boolean | void;
